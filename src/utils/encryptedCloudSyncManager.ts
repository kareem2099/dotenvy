import * as crypto from 'crypto';
import * as vscode from 'vscode';
import { t } from '../i18n';
import { CloudSyncManager, CloudSecrets, CloudSyncResult } from './cloudSyncManager';
import { CloudSyncConfig } from '../types/environment';
import {
    CLOUD_ENVELOPE_STORAGE_PREFIX,
    CLOUD_ENCRYPT_ALGO,
    CLOUD_ENCRYPT_FORMAT_VERSION,
    CLOUD_KEY_STORAGE,
    CLOUD_SYNC_ALGO_KEY,
    CLOUD_SYNC_ENCRYPTED_KEY,
    CLOUD_SYNC_KDF_ITERATIONS,
    CLOUD_SYNC_KEY_SALT,
    CLOUD_SYNC_LAST_SYNC_KEY,
    CLOUD_SYNC_VERSION_KEY,
    CLOUD_SYNC_WRAPPED_KEY,
    KEY_LENGTH,
    LAST_SYNC_STORAGE,
    PBKDF2_ITERATIONS,
    PBKDF2_SALT_LENGTH,
} from '../constants';
import {
    CloudPayloadAuthError,
    CloudWrapRejectedError,
    WrappedDataKey,
    decryptPayload,
    encryptPayload,
    findEncryptedPayload,
    readRemoteWrap,
    unwrapDataKey,
    wrapDataKey,
} from './cloudKeyEnvelope';
import { promptCreatePassphrase, promptUnlockPassphrase } from './cloudSyncPassphrasePrompt';
import { normalizeDopplerProjectSlug } from './dopplerProjectSlug';

interface StoredCloudEnvelope {
    dek: string;
    salt: string;
    wrappedKey: string;
    iterations: number;
}

interface UnlockedPayload {
    secrets: CloudSecrets;
    dataKey: Buffer;
    cacheToSave?: StoredCloudEnvelope;
}

interface PreparedUpload {
    dataKey: Buffer;
    wrap: WrappedDataKey;
    cacheToSave: StoredCloudEnvelope;
}

/**
 * Encrypts cloud payloads with a random data key and wraps that key with a sync passphrase.
 * The wrap, salt, and iteration count travel with the Doppler metadata so another machine can unlock them.
 */
export class EncryptedCloudSyncManager extends CloudSyncManager {
    private encryptionEnabled: boolean;
    private wrappedManager: CloudSyncManager;

    constructor(config: CloudSyncConfig, wrappedManager: CloudSyncManager, encryptionEnabled = true) {
        super(config);
        this.wrappedManager = wrappedManager;
        this.encryptionEnabled = encryptionEnabled;
    }

    async fetchSecrets(context?: vscode.ExtensionContext): Promise<CloudSyncResult> {
        const result = await this.wrappedManager.fetchSecrets();
        if (!result.success || !result.secrets || !this.encryptionEnabled) {
            return result;
        }
        if (!context) {
            return { success: false, error: t('cloudSync.contextRequired') };
        }

        const payload = findEncryptedPayload(result.secrets);
        if (!payload) {
            return result;
        }

        const unlocked = await this.unlock(context, result.secrets, payload);
        if ('error' in unlocked) {
            return { success: false, error: unlocked.error };
        }

        if (unlocked.cacheToSave) {
            await this.commitCache(context, unlocked.cacheToSave);
        }
        await context.workspaceState.update(LAST_SYNC_STORAGE, new Date().toISOString());
        return { success: true, secrets: unlocked.secrets };
    }

    async pushSecrets(secrets: CloudSecrets, context?: vscode.ExtensionContext): Promise<CloudSyncResult> {
        if (!this.encryptionEnabled || !context) {
            return this.wrappedManager.pushSecrets(secrets, context);
        }
        return this.uploadEncrypted(secrets, context, 'push');
    }

    async replaceSecrets(secrets: CloudSecrets, context?: vscode.ExtensionContext): Promise<CloudSyncResult> {
        if (!this.encryptionEnabled || !context) {
            return this.wrappedManager.replaceSecrets(secrets, context);
        }
        return this.uploadEncrypted(secrets, context, 'replace');
    }

    async testConnection(): Promise<CloudSyncResult> {
        return this.wrappedManager.testConnection();
    }

    private async uploadEncrypted(
        secrets: CloudSecrets,
        context: vscode.ExtensionContext,
        mode: 'push' | 'replace',
    ): Promise<CloudSyncResult> {
        const remote = await this.wrappedManager.fetchSecrets();
        if (!remote.success) {
            return remote;
        }

        const prepared = await this.prepareUpload(context, remote.secrets ?? {});
        if ('error' in prepared) {
            return { success: false, error: prepared.error };
        }

        const envelope = this.sealSecrets(secrets, prepared.dataKey, prepared.wrap);
        const result = mode === 'replace'
            ? await this.wrappedManager.replaceSecrets(envelope, context)
            : await this.wrappedManager.pushSecrets(envelope, context);
        if (!result.success) {
            return result;
        }

        await this.commitCache(context, prepared.cacheToSave);
        await context.workspaceState.update(LAST_SYNC_STORAGE, new Date().toISOString());
        return result;
    }

    private async prepareUpload(
        context: vscode.ExtensionContext,
        raw: CloudSecrets,
    ): Promise<PreparedUpload | { error: string }> {
        const payload = findEncryptedPayload(raw);
        if (payload) {
            const unlocked = await this.unlock(context, raw, payload);
            if ('error' in unlocked) {
                return unlocked;
            }

            const remoteWrap = this.remoteWrapForUpload(raw);
            if ('error' in remoteWrap) {
                return remoteWrap;
            }
            if (remoteWrap.wrap) {
                return {
                    dataKey: unlocked.dataKey,
                    wrap: remoteWrap.wrap,
                    cacheToSave: this.cacheFrom(unlocked.dataKey, remoteWrap.wrap),
                };
            }

            return this.wrapExistingKey(unlocked.dataKey);
        }

        const cache = await this.readCache(context);
        if (cache) {
            return {
                dataKey: Buffer.from(cache.dek, 'base64'),
                wrap: { wrappedKey: cache.wrappedKey, salt: cache.salt, iterations: cache.iterations },
                cacheToSave: cache,
            };
        }

        return this.wrapExistingKey(crypto.randomBytes(KEY_LENGTH));
    }

    private async wrapExistingKey(dataKey: Buffer): Promise<PreparedUpload | { error: string }> {
        const created = await promptCreatePassphrase();
        if (created.status === 'mismatch') {
            return { error: t('cloudSync.passphraseMismatch') };
        }
        if (created.status !== 'ok') {
            return { error: t('cloudSync.passphraseCancelled') };
        }

        const wrap = wrapDataKey(dataKey, created.passphrase);
        return { dataKey, wrap, cacheToSave: this.cacheFrom(dataKey, wrap) };
    }

    private remoteWrapForUpload(raw: CloudSecrets): { wrap: WrappedDataKey | null } | { error: string } {
        try {
            return { wrap: readRemoteWrap(raw) };
        } catch (error) {
            if (error instanceof CloudWrapRejectedError) {
                return { error: t('cloudSync.wrapRejected') };
            }
            throw error;
        }
    }

    private async unlock(
        context: vscode.ExtensionContext,
        raw: CloudSecrets,
        payload: string,
    ): Promise<UnlockedPayload | { error: string }> {
        const remoteWrappedKey = raw[CLOUD_SYNC_WRAPPED_KEY]?.trim() ?? '';
        const cache = await this.readCache(context);

        if (cache && remoteWrappedKey && cache.wrappedKey === remoteWrappedKey) {
            const dataKey = Buffer.from(cache.dek, 'base64');
            const secrets = this.tryDecrypt(payload, dataKey);
            if (secrets) {
                return { secrets, dataKey };
            }
        }

        const cachedKey = cache ? Buffer.from(cache.dek, 'base64') : null;
        if (cachedKey) {
            const secrets = this.tryDecrypt(payload, cachedKey);
            if (secrets) {
                return { secrets, dataKey: cachedKey };
            }
        }

        const legacy = this.readLegacyKey(context);
        if (legacy) {
            const secrets = this.tryDecrypt(payload, legacy);
            if (secrets) {
                return { secrets, dataKey: legacy };
            }
        }

        if (!remoteWrappedKey) {
            return { error: t('cloudSync.legacyNeedsOriginalPush') };
        }

        let wrap: WrappedDataKey;
        try {
            const parsed = readRemoteWrap(raw);
            if (!parsed) {
                return { error: t('cloudSync.wrapRejected') };
            }
            wrap = parsed;
        } catch (error) {
            if (error instanceof CloudWrapRejectedError) {
                return { error: t('cloudSync.wrapRejected') };
            }
            throw error;
        }

        for (let attempt = 0; attempt < 3; attempt++) {
            const prompted = await promptUnlockPassphrase();
            if (prompted.status !== 'ok') {
                return { error: t('cloudSync.passphraseCancelled') };
            }

            try {
                const dataKey = unwrapDataKey(wrap.wrappedKey, wrap.salt, wrap.iterations, prompted.passphrase);
                const secrets = this.tryDecrypt(payload, dataKey);
                if (!secrets) {
                    return { error: t('cloudSync.corruptPayload') };
                }
                return {
                    secrets,
                    dataKey,
                    cacheToSave: this.cacheFrom(dataKey, wrap),
                };
            } catch (error) {
                if (error instanceof CloudPayloadAuthError) {
                    continue;
                }
                if (error instanceof CloudWrapRejectedError) {
                    return { error: t('cloudSync.wrapRejected') };
                }
                throw error;
            }
        }

        return { error: t('cloudSync.passphraseWrong') };
    }

    private tryDecrypt(payload: string, key: Buffer): CloudSecrets | null {
        try {
            const parsed: unknown = JSON.parse(decryptPayload(payload, key));
            if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
                return null;
            }
            return parsed as CloudSecrets;
        } catch {
            return null;
        }
    }

    private sealSecrets(secrets: CloudSecrets, dataKey: Buffer, wrap: WrappedDataKey): CloudSecrets {
        return {
            [CLOUD_SYNC_ENCRYPTED_KEY]: encryptPayload(JSON.stringify(secrets), dataKey),
            [CLOUD_SYNC_VERSION_KEY]: CLOUD_ENCRYPT_FORMAT_VERSION,
            [CLOUD_SYNC_LAST_SYNC_KEY]: new Date().toISOString(),
            [CLOUD_SYNC_ALGO_KEY]: CLOUD_ENCRYPT_ALGO,
            [CLOUD_SYNC_WRAPPED_KEY]: wrap.wrappedKey,
            [CLOUD_SYNC_KEY_SALT]: wrap.salt,
            [CLOUD_SYNC_KDF_ITERATIONS]: String(wrap.iterations),
        };
    }

    private cacheFrom(dataKey: Buffer, wrap: WrappedDataKey): StoredCloudEnvelope {
        return {
            dek: dataKey.toString('base64'),
            salt: wrap.salt,
            wrappedKey: wrap.wrappedKey,
            iterations: wrap.iterations,
        };
    }

    private envelopeStorageKey(): string {
        const project = this.config.project?.trim()
            ? normalizeDopplerProjectSlug(this.config.project)
            : this.config.project;
        return `${CLOUD_ENVELOPE_STORAGE_PREFIX}:${project}:${this.config.config}`;
    }

    private async readCache(context: vscode.ExtensionContext): Promise<StoredCloudEnvelope | null> {
        const raw = await context.secrets.get(this.envelopeStorageKey());
        if (!raw) {
            return null;
        }

        try {
            const parsed = JSON.parse(raw) as Partial<StoredCloudEnvelope>;
            if (!parsed.dek || !parsed.salt || !parsed.wrappedKey || parsed.iterations !== PBKDF2_ITERATIONS) {
                return null;
            }
            if (Buffer.from(parsed.dek, 'base64').length !== KEY_LENGTH) {
                return null;
            }
            if (Buffer.from(parsed.salt, 'base64').length !== PBKDF2_SALT_LENGTH) {
                return null;
            }
            return {
                dek: parsed.dek,
                salt: parsed.salt,
                wrappedKey: parsed.wrappedKey,
                iterations: PBKDF2_ITERATIONS,
            };
        } catch {
            return null;
        }
    }

    private readLegacyKey(context: vscode.ExtensionContext): Buffer | null {
        const stored = context.workspaceState.get<string>(CLOUD_KEY_STORAGE);
        if (!stored) {
            return null;
        }
        const key = Buffer.from(stored, 'base64');
        return key.length === KEY_LENGTH ? key : null;
    }

    private async commitCache(
        context: vscode.ExtensionContext,
        cache: StoredCloudEnvelope,
    ): Promise<void> {
        await context.secrets.store(this.envelopeStorageKey(), JSON.stringify(cache));
    }

    static async createManager(
        config: CloudSyncConfig,
        context: vscode.ExtensionContext
    ): Promise<CloudSyncManager> {
        const { createCloudSyncManager } = await import('./cloudSyncManagerFactory');
        return createCloudSyncManager(config, context);
    }

    static async createEncryptedManager(
        config: CloudSyncConfig,
        context: vscode.ExtensionContext,
        enableEncryption = true
    ): Promise<EncryptedCloudSyncManager> {
        let manager: CloudSyncManager;

        switch (config.provider) {
            case 'doppler':
                const { DopplerSyncManager } = await import('./dopplerSyncManager');
                manager = new DopplerSyncManager(config);
                break;
            default:
                throw new Error(t('cloudSync.unsupportedProvider', { provider: config.provider }));
        }

        return new EncryptedCloudSyncManager(config, manager, enableEncryption);
    }
}

/** @deprecated Import from `cloudSyncManagerFactory` instead. */
export { CloudEncryptionUtils, createCloudSyncManager } from './cloudSyncManagerFactory';

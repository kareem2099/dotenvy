import * as crypto from 'crypto';
import * as vscode from 'vscode';
import { CloudSyncManager, CloudSecrets, CloudSyncResult } from './cloudSyncManager';
import { CloudSyncConfig } from '../types/environment';
import {
    CLOUD_SYNC_ENCRYPTED_KEY,
    CLOUD_SYNC_VERSION_KEY,
    CLOUD_SYNC_LAST_SYNC_KEY,
    CLOUD_SYNC_ALGO_KEY,
    LEGACY_CLOUD_SYNC_ENCRYPTED_KEY,
    CLOUD_ENCRYPT_ALGO,
    CLOUD_ENCRYPT_FORMAT_VERSION,
    CLOUD_KEY_STORAGE,
    LAST_SYNC_STORAGE
} from '../constants';

/**
 * Encrypted wrapper that provides end-to-end encryption for cloud sync operations
 * Encrypts data before sending to cloud and decrypts after receiving from cloud
 * Updated with modern cryptographic parameters for enhanced security
 */
export class EncryptedCloudSyncManager extends CloudSyncManager {
    private static readonly KEY_LENGTH = 32;
    private static readonly IV_LENGTH = 12;

    private encryptionEnabled: boolean;
    private wrappedManager: CloudSyncManager;

    constructor(config: CloudSyncConfig, wrappedManager: CloudSyncManager, encryptionEnabled = true) {
        super(config);
        this.wrappedManager = wrappedManager;
        this.encryptionEnabled = encryptionEnabled;
    }

    /**
     * Get or create cloud encryption key for this workspace
     */
    private static async getCloudEncryptionKey(context: vscode.ExtensionContext): Promise<Buffer> {
        const storedKey = context.workspaceState.get(CLOUD_KEY_STORAGE) as string;
        if (storedKey) {
            return Buffer.from(storedKey, 'base64');
        }

        // Generate new cloud encryption key
        const key = crypto.randomBytes(this.KEY_LENGTH);
        await context.workspaceState.update(CLOUD_KEY_STORAGE, key.toString('base64'));
        return key;
    }

    /**
     * Encrypt cloud secrets payload
     */
    private static encryptCloudPayload(data: CloudSecrets, key: Buffer): string {
        const plaintext = JSON.stringify(data);
        const iv = crypto.randomBytes(this.IV_LENGTH);

        const cipher = crypto.createCipheriv(CLOUD_ENCRYPT_ALGO, key, iv);
        const encrypted = Buffer.concat([
            cipher.update(Buffer.from(plaintext, 'utf8')),
            cipher.final()
        ]);

        const authTag = cipher.getAuthTag();

        // Format: base64(iv).base64(tag).base64(encrypted)
        const payload = [
            iv.toString('base64'),
            authTag.toString('base64'),
            encrypted.toString('base64')
        ].join('.');

        return payload;
    }

    /**
     * Decrypt cloud secrets payload
     */
    private static decryptCloudPayload(encryptedPayload: string, key: Buffer): CloudSecrets {
        const parts = encryptedPayload.split('.');
        if (parts.length !== 3) {
            throw new Error('Invalid encrypted cloud payload format');
        }

        const [ivB64, tagB64, ctB64] = parts;

        try {
            const iv = Buffer.from(ivB64, 'base64');
            const authTag = Buffer.from(tagB64, 'base64');
            const ciphertext = Buffer.from(ctB64, 'base64');

            const decipher = crypto.createDecipheriv(CLOUD_ENCRYPT_ALGO, key, iv);
            decipher.setAuthTag(authTag);

            const decrypted = Buffer.concat([
                decipher.update(ciphertext),
                decipher.final()
            ]);

            return JSON.parse(decrypted.toString('utf8'));
        } catch (error) {
            throw new Error(`Cloud payload decryption failed: ${(error as Error).message}`, { cause: error });
        }
    }

    private static findEncryptedPayload(secrets: CloudSecrets): string | null {
        if (secrets[CLOUD_SYNC_ENCRYPTED_KEY]) {
            return secrets[CLOUD_SYNC_ENCRYPTED_KEY];
        }
        if (secrets[LEGACY_CLOUD_SYNC_ENCRYPTED_KEY]) {
            return secrets[LEGACY_CLOUD_SYNC_ENCRYPTED_KEY];
        }
        return null;
    }

    /**
     * Fetch secrets with automatic decryption
     */
    async fetchSecrets(context?: vscode.ExtensionContext): Promise<CloudSyncResult> {
        const result = await this.wrappedManager.fetchSecrets();

        if (!result.success || !result.secrets || !this.encryptionEnabled) {
            return result;
        }

        if (!context) {
            return {
                success: false,
                error: 'Extension context required for encrypted cloud sync'
            };
        }

        try {
            // Cloud providers may return data in special format for encrypted sync
            // Look for encrypted payload marker
            const encryptedPayload = EncryptedCloudSyncManager.findEncryptedPayload(result.secrets);
            if (!encryptedPayload) {
                // No encryption detected - return as-is for backward compatibility
                return result;
            }

            const key = await EncryptedCloudSyncManager.getCloudEncryptionKey(context);
            const decryptedSecrets = EncryptedCloudSyncManager.decryptCloudPayload(encryptedPayload, key);

            // Update last sync timestamp on successful fetch
            await context.workspaceState.update(LAST_SYNC_STORAGE, new Date().toISOString());

            return {
                success: true,
                secrets: decryptedSecrets
            };
        } catch (error) {
            return {
                success: false,
                error: `Failed to decrypt cloud secrets: ${(error as Error).message}`
            };
        }
    }

    /**
     * Push secrets with automatic encryption
     */
    async pushSecrets(secrets: CloudSecrets, context?: vscode.ExtensionContext): Promise<CloudSyncResult> {
        if (!this.encryptionEnabled || !context) {
            return this.wrappedManager.pushSecrets(secrets, context);
        }

        try {
            const key = await EncryptedCloudSyncManager.getCloudEncryptionKey(context);
            const encryptedPayload = EncryptedCloudSyncManager.encryptCloudPayload(secrets, key);

            // Store encrypted data under special key that cloud provider will recognize
            const encryptedSecrets: CloudSecrets = {
                [CLOUD_SYNC_ENCRYPTED_KEY]: encryptedPayload,
                [CLOUD_SYNC_VERSION_KEY]: CLOUD_ENCRYPT_FORMAT_VERSION,
                [CLOUD_SYNC_LAST_SYNC_KEY]: new Date().toISOString(),
                [CLOUD_SYNC_ALGO_KEY]: CLOUD_ENCRYPT_ALGO
            };

            const result = await this.wrappedManager.pushSecrets(encryptedSecrets, context);

            // Update last sync timestamp on successful push
            if (result.success) {
                await context.workspaceState.update(LAST_SYNC_STORAGE, new Date().toISOString());
            }

            return result;
        } catch (error) {
            return {
                success: false,
                error: `Failed to encrypt and push secrets: ${(error as Error).message}`
            };
        }
    }

    /**
     * Replace remote secrets, clearing orphans before pushing encrypted payload
     */
    async replaceSecrets(secrets: CloudSecrets, context?: vscode.ExtensionContext): Promise<CloudSyncResult> {
        if (!this.encryptionEnabled || !context) {
            return this.wrappedManager.replaceSecrets(secrets, context);
        }

        const cleanup = await this.wrappedManager.replaceSecrets({}, context);
        if (!cleanup.success) {
            return cleanup;
        }

        return this.pushSecrets(secrets, context);
    }

    /**
     * Test connection (no encryption needed)
     */
    async testConnection(): Promise<CloudSyncResult> {
        return this.wrappedManager.testConnection();
    }

    static async createManager(
        config: CloudSyncConfig,
        context: vscode.ExtensionContext
    ): Promise<CloudSyncManager> {
        const enableEncryption = !(config.encryptCloudSync === false);

        if (enableEncryption) {
            try {
                return await EncryptedCloudSyncManager.createEncryptedManager(config, context, true);
            } catch {
                // Fall back to standard sync
            }
        }

        switch (config.provider) {
            case 'doppler': {
                const { DopplerSyncManager } = await import('./dopplerSyncManager');
                return new DopplerSyncManager(config);
            }
            default:
                throw new Error(`Unsupported cloud provider: ${config.provider}`);
        }
    }

    /**
     * Get encrypted cloud manager factory
     */
    static async createEncryptedManager(
        config: CloudSyncConfig,
        context: vscode.ExtensionContext,
        enableEncryption = true
    ): Promise<EncryptedCloudSyncManager> {
        let manager: CloudSyncManager;

        // Import and create appropriate manager based on provider
        switch (config.provider) {
            case 'doppler':
                const { DopplerSyncManager } = await import('./dopplerSyncManager');
                manager = new DopplerSyncManager(config);
                break;
            default:
                throw new Error(`Unsupported cloud provider for encryption: ${config.provider}`);
        }

        return new EncryptedCloudSyncManager(config, manager, enableEncryption);
    }
}

/**
 * Utility functions for cloud encryption management
 */
export class CloudEncryptionUtils {
    /**
     * Check if workspace has cloud encryption enabled
     */
    static async isCloudEncryptionEnabled(context?: vscode.ExtensionContext): Promise<boolean> {
        // Parameter kept for API consistency, may be used in future for encryption settings
        void context;

        const config = vscode.workspace.getConfiguration('dotenvy');
        const cloudConfig = config.get<Partial<CloudSyncConfig>>('cloudSync');
        return !!(cloudConfig?.encryptCloudSync !== false); // Default to enabled
    }

    /**
     * Get cloud encryption status for workspace
     */
    static async getCloudEncryptionStatus(context: vscode.ExtensionContext): Promise<{
        enabled: boolean;
        hasKey: boolean;
        lastSync?: string;
    }> {
        const enabled = await this.isCloudEncryptionEnabled(context);

        const hasKey = !!(context.workspaceState.get(CLOUD_KEY_STORAGE) as string);

        // Check last sync from workspace storage
        const lastSync = context.workspaceState.get(LAST_SYNC_STORAGE) as string;

        return {
            enabled,
            hasKey,
            lastSync
        };
    }
}

import * as vscode from 'vscode';
import {
    CLOUD_ENVELOPE_STORAGE_PREFIX,
    CLOUD_KEY_STORAGE,
    LAST_SYNC_STORAGE,
} from '../constants';
import { CloudSyncConfig } from '../types/environment';
import { CloudSyncManager } from './cloudSyncManager';
import { EncryptedCloudSyncManager } from './encryptedCloudSyncManager';
import { t } from '../i18n';

export class CloudEncryptionUtils {
    static async isCloudEncryptionEnabled(context?: vscode.ExtensionContext): Promise<boolean> {
        void context;
        const config = vscode.workspace.getConfiguration('dotenvy');
        const cloudConfig = config.get<Partial<CloudSyncConfig>>('cloudSync');
        return !(cloudConfig?.encryptCloudSync === false);
    }

    static async getCloudEncryptionStatus(context: vscode.ExtensionContext): Promise<{
        enabled: boolean;
        hasKey: boolean;
        lastSync?: string;
    }> {
        const enabled = await this.isCloudEncryptionEnabled(context);
        const legacyKey = context.workspaceState.get<string>(CLOUD_KEY_STORAGE);
        const cloudConfig = vscode.workspace.getConfiguration('dotenvy').get<Partial<CloudSyncConfig>>('cloudSync');
        let envelope: string | undefined;
        if (cloudConfig?.project && cloudConfig?.config) {
            envelope = await context.secrets.get(
                `${CLOUD_ENVELOPE_STORAGE_PREFIX}:${cloudConfig.project}:${cloudConfig.config}`,
            );
        }
        const lastSync = context.workspaceState.get<string>(LAST_SYNC_STORAGE);
        return {
            enabled,
            hasKey: Boolean(legacyKey || envelope),
            lastSync,
        };
    }
}

export async function createCloudSyncManager(
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
            throw new Error(t('cloudSync.unsupportedProvider', { provider: config.provider }));
    }
}

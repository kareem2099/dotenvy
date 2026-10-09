/**
 * Dashboard cloud and validation status shared by the sidebar and the editor panel.
 */

import * as fs from 'fs';
import { CloudSyncManager, CloudSyncResult } from '../utils/cloudSyncManager';
import { DopplerSyncManager } from '../utils/dopplerSyncManager';
import { EnvironmentValidator } from '../utils/environmentValidator';
import { QuickEnvConfig } from '../types/environment';

export async function getCloudSyncStatus(
    _rootPath: string,
    config: QuickEnvConfig | null,
): Promise<{
    connected: boolean | CloudSyncResult;
    provider?: string;
    lastSync: null;
    error?: string;
} | null> {
    if (!config?.cloudSync) {
        return null;
    }

    try {
        let cloudManager: CloudSyncManager;

        switch (config.cloudSync.provider) {
            case 'doppler':
                cloudManager = new DopplerSyncManager(config.cloudSync);
                break;
            default:
                return {
                    connected: false,
                    lastSync: null,
                    error: `Unsupported provider: ${config.cloudSync.provider}`
                };
        }

        const connected = await cloudManager.testConnection();

        return {
            connected,
            provider: config.cloudSync.provider,
            lastSync: null // Would track actual sync times in real implementation
        };
    } catch (error) {
        return {
            connected: false,
            lastSync: null,
            error: (error as Error).message
        };
    }
}

export async function getValidationStatus(
    _rootPath: string,
    envPath: string,
    config: QuickEnvConfig | null,
): Promise<{ valid: boolean; errors?: number; lastValidated?: Date }> {
    if (!config?.validation || !fs.existsSync(envPath)) {
        return {
            valid: true
        };
    }

    try {
        const errors = EnvironmentValidator.validateFile(envPath, config.validation);
        return {
            valid: errors.length === 0,
            errors: errors.length,
            lastValidated: new Date()
        };
    } catch (error) {
        return {
            valid: false,
            errors: 1
        };
    }
}

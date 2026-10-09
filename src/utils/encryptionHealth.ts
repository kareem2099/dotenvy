/**
 * Health checks and key rotation for encrypted environment values.
 */

import * as vscode from 'vscode';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { EncryptedVarsManager } from './encryptedVars';
import { EncryptedEnvironmentFile } from './encryptedEnvironmentFile';

export class EncryptionHealthUtils {

    /**
     * Reports salt location, format version, and recommended encryption updates.
     */
    public static async checkEncryptionHealth(context: vscode.ExtensionContext): Promise<{
        currentFormatVersion: number;
        pbkdf2Iterations: number;
        hasWorkspaceSalt: boolean;
        recommendations: string[];
        needsUpdate: boolean;
    }> {
        const workspace = vscode.workspace.workspaceFolders?.[0]?.name || 'default';
        const saltSecretsKey = `${EncryptedVarsManager.SALT_STORAGE_KEY_PREFIX}${workspace}`;

        const saltInSecrets = await context.secrets.get(saltSecretsKey);
        const saltInState = context.workspaceState.get<string>(`dotenvy.salt.${workspace}`);
        const hasWorkspaceSalt = !!(saltInSecrets || saltInState);

        const recommendations: string[] = [];
        let needsUpdate = false;

        if (saltInState && !saltInSecrets) {
            recommendations.push('Salt found in workspaceState — will be migrated to SecretStorage on next key derivation');
            needsUpdate = true;
        }

        if (!hasWorkspaceSalt) {
            recommendations.push('No workspace salt found — will be created on next password operation');
        }

        const formatRecommendations = await this._checkEncryptedVarsFormat();
        recommendations.push(...formatRecommendations);

        return {
            currentFormatVersion: EncryptedVarsManager.FORMAT_VERSION,
            pbkdf2Iterations: EncryptedVarsManager.PBKDF2_ITERATIONS,
            hasWorkspaceSalt,
            recommendations,
            needsUpdate: needsUpdate || formatRecommendations.length > 0,
        };
    }

    private static async _checkEncryptedVarsFormat(): Promise<string[]> {
        const workspace = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (!workspace) { return []; }

        const envPath = path.join(workspace, '.env');
        try {
            if (!await fs.promises.access(envPath, fs.constants.F_OK).then(() => true).catch(() => false)) {
                return [];
            }
            return [];
        } catch (error) {
            return [`Could not check encryption format: ${error}`];
        }
    }

    /**
     * Re-encrypts encrypted variables with a newly generated key.
     */
    public static async rotateEncryptionKeys(context: vscode.ExtensionContext): Promise<{
        success: boolean;
        rotatedCount: number;
        error?: string;
    }> {
        try {
            const workspace = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
            if (!workspace) {
                return { success: false, rotatedCount: 0, error: 'No workspace found' };
            }

            const envPath = path.join(workspace, '.env');
            if (!await fs.promises.access(envPath, fs.constants.F_OK).then(() => true).catch(() => false)) {
                return { success: false, rotatedCount: 0, error: 'No .env file found' };
            }

            const newKey = crypto.randomBytes(EncryptedVarsManager.KEY_LENGTH);
            const parsedVars = await EncryptedEnvironmentFile.parseEnvFile(envPath, context);
            let rotatedCount = 0;

            const reEncryptedVars = new Map<string, { value: string; encrypted: boolean }>();
            for (const [k, data] of parsedVars) {
                if (data.encrypted) {
                    reEncryptedVars.set(k, { value: EncryptedVarsManager.encryptValue(data.value, newKey), encrypted: true });
                    rotatedCount++;
                } else {
                    reEncryptedVars.set(k, data);
                }
            }

            await EncryptedEnvironmentFile.writeEnvFile(envPath, reEncryptedVars, context, newKey);

            const workspaceName = vscode.workspace.workspaceFolders?.[0]?.name || 'default';
            const secretsKey = `${EncryptedVarsManager.SECRET_STORAGE_KEY_PREFIX}${workspaceName}`;
            await context.secrets.store(secretsKey, newKey.toString('base64'));

            return { success: true, rotatedCount };

        } catch (error) {
            return { success: false, rotatedCount: 0, error: `Key rotation failed: ${(error as Error).message}` };
        }
    }
}

import * as vscode from 'vscode';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { SessionManager } from './sessionManager';
import { logger } from './logger';
import { decryptValue as decryptCipherValue, encryptValue as encryptCipherValue, isEncrypted as isEncryptedValue } from './encryptionCipher';
import { EncryptedEnvironmentFile } from './encryptedEnvironmentFile';
export { EncryptedEnvironmentFile };
export { EncryptionHealthUtils } from './encryptionHealth';

export class EncryptedVarsManager {
    public static readonly SECRET_STORAGE_KEY_PREFIX = 'dotenvy.master.key.';
    public static readonly SALT_STORAGE_KEY_PREFIX = 'dotenvy.salt.';
    public static readonly FORMAT_VERSION = 2;
    public static readonly ENCRYPT_ALGO = 'aes-256-gcm';
    public static readonly KEY_LENGTH = 32;
    public static readonly IV_LENGTH = 12;
    public static readonly PBKDF2_ITERATIONS = 310000;
    public static readonly PBKDF2_SALT_LENGTH = 32;

    /**
     * Check if a master key already exists (In RAM/Session or in Secure Storage).
     */
    public static async hasMasterKey(context: vscode.ExtensionContext): Promise<boolean> {
        // 1. Check if we have an active Secure Project session (RAM)
        const session = SessionManager.getInstance();
        if (session.isLoggedIn() && session.getProjectKey()) {
            return true;
        }

        // 2. Check personal Secure Storage
        const workspaceName = vscode.workspace.workspaceFolders?.[0]?.name || 'default';
        const secretsKey = `${this.SECRET_STORAGE_KEY_PREFIX}${workspaceName}`;
        const existing = await context.secrets.get(secretsKey);
        if (existing) {
            return true;
        }

        // 3. Fallback: legacy key in workspaceState not yet migrated
        return !!context.workspaceState.get<string>(secretsKey);
    }

    /**
     * Check if workspace has a password-derived key (verifies salt exists in SecretStorage or legacy workspaceState).
     */
    public static async hasMasterPassword(context: vscode.ExtensionContext): Promise<boolean> {
        const workspaceName = vscode.workspace.workspaceFolders?.[0]?.name || 'default';
        const secretsSaltKey = `${this.SALT_STORAGE_KEY_PREFIX}${workspaceName}`;
        const salt = await context.secrets.get(secretsSaltKey);
        if (salt) {
            return true;
        }

        // Fallback: legacy salt in workspaceState not yet migrated
        const legacySaltKey = `dotenvy.salt.${workspaceName}`;
        return !!context.workspaceState.get<string>(legacySaltKey);
    }

    /**
     * Get or create master key for workspace.
     * Priority: SessionManager → SecretStorage → (migrate from workspaceState) → generate new
     */
    public static async ensureMasterKey(context: vscode.ExtensionContext): Promise<Buffer> {
        // 1. New multi-user system (SessionManager)
        const session = SessionManager.getInstance();
        if (session.isLoggedIn()) {
            const projectKey = session.getProjectKey();
            if (projectKey) { return projectKey; }
        }

        const workspace = vscode.workspace.workspaceFolders?.[0]?.name || 'default';
        const secretsKey = `${this.SECRET_STORAGE_KEY_PREFIX}${workspace}`;

        // 2. SecretStorage (new primary location)
        const stored = await context.secrets.get(secretsKey);
        if (stored) {
            return Buffer.from(stored, 'base64');
        }

        // 3. Migration — move existing key from workspaceState to SecretStorage
        const legacyKey = context.workspaceState.get<string>(secretsKey);
        if (legacyKey) {
            logger.info('Migrating master key from workspaceState → SecretStorage', 'EncryptedVarsManager');
            await context.secrets.store(secretsKey, legacyKey);
            await context.workspaceState.update(secretsKey, undefined); // clean up old location
            return Buffer.from(legacyKey, 'base64');
        }

        // 4. Generate a new key and store in SecretStorage
        const key = crypto.randomBytes(this.KEY_LENGTH);
        await context.secrets.store(secretsKey, key.toString('base64'));
        return key;
    }

    /**
     * Derive encryption key from master password + salt.
     * Salt is stored in SecretStorage (migrated from workspaceState if needed).
     */
    public static async deriveKeyFromPassword(
        password: string,
        context: vscode.ExtensionContext,
        workspace = 'default',
    ): Promise<Buffer> {
        const secretsSaltKey = `${this.SALT_STORAGE_KEY_PREFIX}${workspace}`;
        const legacySaltKey = `dotenvy.salt.${workspace}`; // old workspaceState key

        // 1. Try SecretStorage
        let salt = await context.secrets.get(secretsSaltKey);

        // 2. Migration — move salt from workspaceState to SecretStorage
        if (!salt) {
            const legacySalt = context.workspaceState.get<string>(legacySaltKey);
            if (legacySalt) {
                logger.info('Migrating salt from workspaceState → SecretStorage', 'EncryptedVarsManager');
                await context.secrets.store(secretsSaltKey, legacySalt);
                await context.workspaceState.update(legacySaltKey, undefined);
                salt = legacySalt;
            }
        }

        // 3. Generate new salt if none exists
        if (!salt) {
            salt = crypto.randomBytes(this.PBKDF2_SALT_LENGTH).toString('base64');
            await context.secrets.store(secretsSaltKey, salt);
        }

        return crypto.pbkdf2Sync(
            password,
            Buffer.from(salt, 'base64'),
            this.PBKDF2_ITERATIONS,
            this.KEY_LENGTH,
            'sha256',
        );
    }

    private static cipherSettings() {
        return {
            formatVersion: this.FORMAT_VERSION,
            algorithm: this.ENCRYPT_ALGO as 'aes-256-gcm',
            keyLength: this.KEY_LENGTH,
            ivLength: this.IV_LENGTH,
        };
    }

    /**
     * Encrypt a variable value using key.
     */
    public static encryptValue(plaintext: string, key: Buffer): string {
        return encryptCipherValue(plaintext, key, this.cipherSettings());
    }

    /**
     * Decrypt an encrypted variable value with backward compatibility.
     */
    public static decryptValue(encryptedValue: string, key: Buffer): string {
        return decryptCipherValue(encryptedValue, key, this.cipherSettings());
    }

    /**
     * Check if a value is encrypted.
     */
    public static isEncrypted(value: string): boolean {
        return isEncryptedValue(value);
    }

    /**
     * Set master password for workspace.
     */
    public static async setMasterPassword(
        password: string,
        context: vscode.ExtensionContext,
    ): Promise<void> {
        const workspace = vscode.workspace.workspaceFolders?.[0]?.name || 'default';
        const key = await this.deriveKeyFromPassword(password, context, workspace);
        const secretsKey = `${this.SECRET_STORAGE_KEY_PREFIX}${workspace}`;

        await context.secrets.store(secretsKey, key.toString('base64'));
        vscode.window.showInformationMessage('Master password set successfully');
    }

    /**
     * Change master password with automatic key rotation for existing encrypted variables.
     */
    public static async changeMasterPassword(
        oldPassword: string,
        newPassword: string,
        context: vscode.ExtensionContext,
    ): Promise<{ success: boolean; migratedCount: number; error?: string }> {
        try {
            const workspace = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
            if (!workspace) {
                return { success: false, migratedCount: 0, error: 'No workspace found' };
            }

            const envPath = path.join(workspace, '.env');
            if (!await fs.promises.access(envPath, fs.constants.F_OK).then(() => true).catch(() => false)) {
                await this.setMasterPassword(newPassword, context);
                return { success: true, migratedCount: 0 };
            }

            const workspaceName = vscode.workspace.workspaceFolders?.[0]?.name || 'default';
            const oldKey = await this.deriveKeyFromPassword(oldPassword, context, workspaceName);

            let parsedVars: Map<string, { value: string; encrypted: boolean; raw: string }>;
            try {
                parsedVars = await EncryptedEnvironmentFile.parseEnvFile(envPath, context, oldKey);
            } catch {
                return { success: false, migratedCount: 0, error: 'Old password is incorrect or cannot decrypt existing variables' };
            }

            // Verify all encrypted vars were actually decrypted
            for (const [, data] of parsedVars) {
                if (data.encrypted && data.value === data.raw) {
                    return { success: false, migratedCount: 0, error: 'Old password is incorrect - cannot decrypt existing variables' };
                }
            }

            let encryptedCount = 0;
            for (const [, data] of parsedVars) {
                if (data.encrypted) { encryptedCount++; }
            }

            if (encryptedCount === 0) {
                await this.setMasterPassword(newPassword, context);
                return { success: true, migratedCount: 0 };
            }

            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: 'Re-encrypting environment variables...',
                cancellable: false,
            }, async (progress) => {
                progress.report({ increment: 0, message: 'Deriving new key...' });
                const newKey = await this.deriveKeyFromPassword(newPassword, context, workspaceName);

                progress.report({ increment: 25, message: 'Re-encrypting variables...' });
                const reEncryptedVars = new Map<string, { value: string; encrypted: boolean }>();
                for (const [k, data] of parsedVars) {
                    reEncryptedVars.set(k, { value: data.value, encrypted: data.encrypted });
                }

                progress.report({ increment: 75, message: 'Saving changes...' });
                await EncryptedEnvironmentFile.writeEnvFile(envPath, reEncryptedVars, context, newKey);

                // Store new key in SecretStorage
                const secretsKey = `${this.SECRET_STORAGE_KEY_PREFIX}${workspaceName}`;
                await context.secrets.store(secretsKey, newKey.toString('base64'));

                progress.report({ increment: 100, message: 'Complete!' });
            });

            return { success: true, migratedCount: encryptedCount };

        } catch (error) {
            return { success: false, migratedCount: 0, error: `Password change failed: ${(error as Error).message}` };
        }
    }

    /**
     * Migrate existing encrypted variables from an auto-generated Master Key to a user-provided Master Password.
     */
    public static async migrateFromAutoKeyToPassword(
        newPassword: string,
        context: vscode.ExtensionContext,
    ): Promise<{ success: boolean; migratedCount: number; error?: string }> {
        try {
            const workspace = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
            if (!workspace) {
                return { success: false, migratedCount: 0, error: 'No workspace found' };
            }

            const envPath = path.join(workspace, '.env');
            if (!await fs.promises.access(envPath, fs.constants.F_OK).then(() => true).catch(() => false)) {
                await this.setMasterPassword(newPassword, context);
                return { success: true, migratedCount: 0 };
            }

            const currentKey = await this.ensureMasterKey(context);
            let parsedVars: Map<string, { value: string; encrypted: boolean; raw: string }>;
            try {
                parsedVars = await EncryptedEnvironmentFile.parseEnvFile(envPath, context, currentKey);
            } catch {
                return { success: false, migratedCount: 0, error: 'Could not decrypt variables with existing master key' };
            }

            for (const [, data] of parsedVars) {
                if (data.encrypted && data.value === data.raw) {
                    return { success: false, migratedCount: 0, error: 'Failed to decrypt some encrypted variables with current master key' };
                }
            }

            let encryptedCount = 0;
            for (const [, data] of parsedVars) {
                if (data.encrypted) { encryptedCount++; }
            }

            if (encryptedCount === 0) {
                await this.setMasterPassword(newPassword, context);
                return { success: true, migratedCount: 0 };
            }

            const workspaceName = vscode.workspace.workspaceFolders?.[0]?.name || 'default';
            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: 'Migrating environment variables to master password...',
                cancellable: false,
            }, async (progress) => {
                progress.report({ increment: 0, message: 'Deriving new key from password...' });
                const newKey = await this.deriveKeyFromPassword(newPassword, context, workspaceName);

                progress.report({ increment: 25, message: 'Re-encrypting variables...' });
                const reEncryptedVars = new Map<string, { value: string; encrypted: boolean }>();
                for (const [k, data] of parsedVars) {
                    reEncryptedVars.set(k, { value: data.value, encrypted: data.encrypted });
                }

                progress.report({ increment: 75, message: 'Saving changes...' });
                await EncryptedEnvironmentFile.writeEnvFile(envPath, reEncryptedVars, context, newKey);

                // Store new key in SecretStorage
                const secretsKey = `${this.SECRET_STORAGE_KEY_PREFIX}${workspaceName}`;
                await context.secrets.store(secretsKey, newKey.toString('base64'));

                progress.report({ increment: 100, message: 'Complete!' });
            });

            return { success: true, migratedCount: encryptedCount };

        } catch (error) {
            return { success: false, migratedCount: 0, error: `Migration failed: ${(error as Error).message}` };
        }
    }

    /**
     * Check if workspace has encrypted variables.
     */
    public static async workspaceHasEncryptedVars(): Promise<boolean> {
        const workspace = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (!workspace) { return false; }

        const envPath = path.join(workspace, '.env');
        if (!await fs.promises.access(envPath, fs.constants.F_OK).then(() => true).catch(() => false)) {
            return false;
        }

        const content = await fs.promises.readFile(envPath, 'utf8');
        return content.split('\n').some(line => {
            const parts = line.split('=');
            return parts.length >= 2 && this.isEncrypted(parts.slice(1).join('='));
        });
    }
}

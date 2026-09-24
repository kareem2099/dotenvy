import * as vscode from 'vscode';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { SessionManager } from './sessionManager';
import { logger } from './logger';

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

    /**
     * Encrypt a variable value using key.
     */
    public static encryptValue(plaintext: string, key: Buffer): string {
        if (key.length !== this.KEY_LENGTH) {
            throw new Error('Invalid key length');
        }

        const iv = crypto.randomBytes(this.IV_LENGTH);
        const cipher = crypto.createCipheriv(this.ENCRYPT_ALGO, key, iv, { authTagLength: 16 });

        const encrypted = Buffer.concat([
            cipher.update(Buffer.from(plaintext, 'utf8')),
            cipher.final(),
        ]);

        const tag = cipher.getAuthTag();

        const pack = [
            this.FORMAT_VERSION.toString(),
            iv.toString('base64'),
            tag.toString('base64'),
            encrypted.toString('base64'),
        ].join('|');

        return `ENC[${pack}]`;
    }

    /**
     * Decrypt an encrypted variable value with backward compatibility.
     */
    public static decryptValue(encryptedValue: string, key: Buffer): string {
        if (key.length !== this.KEY_LENGTH) {
            throw new Error('Invalid key length');
        }

        if (!encryptedValue.startsWith('ENC[') || !encryptedValue.endsWith(']')) {
            throw new Error('Invalid encrypted variable format');
        }

        const packData = encryptedValue.slice(4, -1);
        if (!packData) { throw new Error('Empty encrypted data'); }

        const parts = packData.split('|');
        if (parts.length !== 4) { throw new Error('Invalid encrypted data structure'); }

        const [versionStr, ivB64, tagB64, ctB64] = parts;

        if (!versionStr || !ivB64 || !tagB64 || !ctB64) {
            throw new Error('Missing encrypted data components');
        }

        const version = parseInt(versionStr, 10);
        if (isNaN(version)) { throw new Error('Invalid version number in encrypted data'); }

        let iv: Buffer, tag: Buffer, ct: Buffer;
        try {
            iv = Buffer.from(ivB64, 'base64');
            tag = Buffer.from(tagB64, 'base64');
            ct = Buffer.from(ctB64, 'base64');
        } catch (error) {
            throw new Error('Invalid base64 encoding in encrypted data', { cause: error });
        }

        if (iv.length !== this.IV_LENGTH) { throw new Error('Invalid IV length in encrypted data'); }
        if (tag.length !== 16) { throw new Error('Invalid authentication tag length in encrypted data'); }
        if (ct.length === 0) { throw new Error('Empty ciphertext in encrypted data'); }

        if (version === 1 || version === this.FORMAT_VERSION) {
            const decipher = crypto.createDecipheriv(this.ENCRYPT_ALGO, key, iv, { authTagLength: 16 });
            decipher.setAuthTag(tag);
            try {
                return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
            } catch (error) {
                throw new Error('Decryption failed - invalid key or corrupted data', { cause: error });
            }
        }

        throw new Error(`Unsupported encryption format version: ${version}. Please upgrade the extension.`);
    }

    /**
     * Check if a value is encrypted.
     */
    public static isEncrypted(value: string): boolean {
        return value.startsWith('ENC[') && value.endsWith(']');
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


// ─── Module-level flag — persists for the entire VS Code session ───────────
let _decryptionWarningShown = false;


export class EncryptionHealthUtils {

    public static async checkEncryptionHealth(context: vscode.ExtensionContext): Promise<{
        currentFormatVersion: number;
        pbkdf2Iterations: number;
        hasWorkspaceSalt: boolean;
        recommendations: string[];
        needsUpdate: boolean;
    }> {
        const workspace = vscode.workspace.workspaceFolders?.[0]?.name || 'default';
        const saltSecretsKey = `${EncryptedVarsManager.SALT_STORAGE_KEY_PREFIX}${workspace}`;

        // Check SecretStorage (new location)
        const saltInSecrets = await context.secrets.get(saltSecretsKey);
        // Also check old workspaceState location for migration detection
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
            // Placeholder — could scan version numbers inside ENC[...] blocks here
            return [];
        } catch (error) {
            return [`Could not check encryption format: ${error}`];
        }
    }

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

            // Store rotated key in SecretStorage
            const workspaceName = vscode.workspace.workspaceFolders?.[0]?.name || 'default';
            const secretsKey = `${EncryptedVarsManager.SECRET_STORAGE_KEY_PREFIX}${workspaceName}`;
            await context.secrets.store(secretsKey, newKey.toString('base64'));

            return { success: true, rotatedCount };

        } catch (error) {
            return { success: false, rotatedCount: 0, error: `Key rotation failed: ${(error as Error).message}` };
        }
    }
}


export class EncryptedEnvironmentFile {

    public static async parseEnvFile(
        filePath: string,
        context: vscode.ExtensionContext,
        masterKey?: Buffer,
    ): Promise<Map<string, { value: string; encrypted: boolean; raw: string }>> {

        const vars = new Map<string, { value: string; encrypted: boolean; raw: string }>();

        if (!await fs.promises.access(filePath, fs.constants.F_OK).then(() => true).catch(() => false)) {
            return vars;
        }

        if (!masterKey) {
            masterKey = await EncryptedVarsManager.ensureMasterKey(context);
        }

        const content = await fs.promises.readFile(filePath, 'utf8');

        for (const line of content.split('\n')) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith('#')) { continue; }

            const eqIndex = trimmed.indexOf('=');
            if (eqIndex === -1) { continue; }

            const key = trimmed.substring(0, eqIndex).trim();
            const value = trimmed.substring(eqIndex + 1).trim();

            let finalValue = value;
            let isEncrypted = false;

            if (EncryptedVarsManager.isEncrypted(value) && masterKey) {
                try {
                    finalValue = EncryptedVarsManager.decryptValue(value, masterKey);
                    isEncrypted = true;
                } catch (error) {
                    logger.warn(`Failed to decrypt '${key}' - invalid key. Keeping as encrypted.`, 'EncryptedEnvironmentFile');
                    finalValue = value;

                    if (!_decryptionWarningShown) {
                        _decryptionWarningShown = true;
                        vscode.window.showWarningMessage(
                            'DotEnvy: Some encrypted variables could not be decrypted. Master key may have changed.',
                            'Set Master Password',
                        ).then(action => {
                            if (action === 'Set Master Password') {
                                vscode.commands.executeCommand('dotenvy.setMasterPassword');
                                _decryptionWarningShown = false; // allow re-prompt if still broken
                            }
                        });
                    }
                }
            } else if (EncryptedVarsManager.isEncrypted(value)) {
                finalValue = value;
                isEncrypted = true;
            }

            vars.set(key, { value: finalValue, encrypted: isEncrypted, raw: value });
        }

        return vars;
    }

    public static async writeEnvFile(
        filePath: string,
        vars: Map<string, { value: string; encrypted: boolean }>,
        context: vscode.ExtensionContext,
        masterKey?: Buffer,
    ): Promise<void> {

        if (!masterKey) {
            masterKey = await EncryptedVarsManager.ensureMasterKey(context);
        }

        const lines: string[] = [];
        for (const [key, data] of vars) {
            if (data.encrypted && masterKey) {
                lines.push(`${key}=${EncryptedVarsManager.encryptValue(data.value, masterKey)}`);
            } else {
                lines.push(`${key}=${data.value}`);
            }
        }

        await fs.promises.writeFile(filePath, lines.join('\n') + '\n', 'utf8');
    }
}
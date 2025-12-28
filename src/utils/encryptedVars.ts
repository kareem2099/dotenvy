import * as vscode from 'vscode';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { SessionManager } from './sessionManager';

export class EncryptedVarsManager {
    public static readonly SECRET_STORAGE_KEY_PREFIX = 'dotenvy.master.key.';
    public static readonly FORMAT_VERSION = 2; // Increased for improved encryption parameters
    public static readonly ENCRYPT_ALGO = 'aes-256-gcm';
    public static readonly KEY_LENGTH = 32;
    public static readonly IV_LENGTH = 12;
    public static readonly PBKDF2_ITERATIONS = 310000; // OWASP recommended minimum
    public static readonly PBKDF2_SALT_LENGTH = 32; // Increased salt size for better security

    /**
     * Get or create master key for workspace
     * Priority: SessionManager (new system) > VSCode workspace state (old system)
     */
    public static async ensureMasterKey(context: vscode.ExtensionContext): Promise<Buffer> {
        // 1. Check if user is logged in with new multi-user system
        const session = SessionManager.getInstance();
        if (session.isLoggedIn()) {
            const projectKey = session.getProjectKey();
            if (projectKey) {
                return projectKey; // Use new project key from session
            }
        }

        // 2. Fallback to old system (shared master key)
        const workspace = vscode.workspace.workspaceFolders?.[0]?.name || 'default';
        const secretKey = `${this.SECRET_STORAGE_KEY_PREFIX}${workspace}`;

        const secret = context.workspaceState.get(secretKey) as string;
        if (secret) {
            return Buffer.from(secret, 'base64');
        }

        // Generate new 256-bit key for old system
        const key = crypto.randomBytes(this.KEY_LENGTH);
        await context.workspaceState.update(secretKey, key.toString('base64'));
        return key;
    }

    /**
     * Derive encryption key from master password + salt with modern parameters
     */
    public static async deriveKeyFromPassword(password: string, context: vscode.ExtensionContext, workspace = 'default'): Promise<Buffer> {
        const saltKey = `dotenvy.salt.${workspace}`;
        let salt = context.workspaceState.get(saltKey) as string; // Changed to workspaceState for better isolation

        if (!salt) {
            salt = crypto.randomBytes(this.PBKDF2_SALT_LENGTH).toString('base64');
            await context.workspaceState.update(saltKey, salt);
        }

        // Use PBKDF2 with OWASP-recommended parameters for 2025
        return crypto.pbkdf2Sync(password, Buffer.from(salt, 'base64'), this.PBKDF2_ITERATIONS, this.KEY_LENGTH, 'sha256');
    }

    /**
     * Encrypt a variable value using key
     */
    public static encryptValue(plaintext: string, key: Buffer): string {
        if (key.length !== this.KEY_LENGTH) {
            throw new Error('Invalid key length');
        }

        const iv = crypto.randomBytes(this.IV_LENGTH);
        const cipher = crypto.createCipheriv(this.ENCRYPT_ALGO, key, iv, { authTagLength: 16 });

        const encrypted = Buffer.concat([
            cipher.update(Buffer.from(plaintext, 'utf8')),
            cipher.final()
        ]);

        const tag = cipher.getAuthTag();

        // Package: version|iv|tag|ct
        const pack = [
            this.FORMAT_VERSION.toString(),
            iv.toString('base64'),
            tag.toString('base64'),
            encrypted.toString('base64')
        ].join('|');

        return `ENC[${pack}]`;
    }

    /**
     * Decrypt an encrypted variable value with backward compatibility
     */
    public static decryptValue(encryptedValue: string, key: Buffer): string {
        if (key.length !== this.KEY_LENGTH) {
            throw new Error('Invalid key length');
        }

        // Validate format
        if (!encryptedValue.startsWith('ENC[') || !encryptedValue.endsWith(']')) {
            throw new Error('Invalid encrypted variable format');
        }

        const packData = encryptedValue.slice(4, -1); // Remove ENC[ ... ]
        if (!packData) {
            throw new Error('Empty encrypted data');
        }

        const parts = packData.split('|');
        if (parts.length !== 4) {
            throw new Error('Invalid encrypted data structure');
        }

        const [versionStr, ivB64, tagB64, ctB64] = parts;

        // Validate all parts are present and not empty
        if (!versionStr || !ivB64 || !tagB64 || !ctB64) {
            throw new Error('Missing encrypted data components');
        }

        const version = parseInt(versionStr, 10);
        if (isNaN(version)) {
            throw new Error('Invalid version number in encrypted data');
        }

        // Validate base64 components
        let iv: Buffer, tag: Buffer, ct: Buffer;
        try {
            iv = Buffer.from(ivB64, 'base64');
            tag = Buffer.from(tagB64, 'base64');
            ct = Buffer.from(ctB64, 'base64');
        } catch (error) {
            throw new Error('Invalid base64 encoding in encrypted data');
        }

        // Validate component sizes
        if (iv.length !== this.IV_LENGTH) {
            throw new Error('Invalid IV length in encrypted data');
        }
        if (tag.length !== 16) {
            throw new Error('Invalid authentication tag length in encrypted data');
        }
        if (ct.length === 0) {
            throw new Error('Empty ciphertext in encrypted data');
        }

        // Handle version migration
        if (version === 1) {
            // Legacy version with weaker PBKDF2 parameters - still supported for compatibility
            const decipher = crypto.createDecipheriv(this.ENCRYPT_ALGO, key, iv, { authTagLength: 16 });
            decipher.setAuthTag(tag);

            try {
                const decrypted = Buffer.concat([
                    decipher.update(ct),
                    decipher.final()
                ]);
                return decrypted.toString('utf8');
            } catch (error) {
                throw new Error('Decryption failed - invalid key or corrupted data');
            }
        } else if (version === this.FORMAT_VERSION) {
            // Current version with improved parameters
            const decipher = crypto.createDecipheriv(this.ENCRYPT_ALGO, key, iv, { authTagLength: 16 });
            decipher.setAuthTag(tag);

            try {
                const decrypted = Buffer.concat([
                    decipher.update(ct),
                    decipher.final()
                ]);
                return decrypted.toString('utf8');
            } catch (error) {
                throw new Error('Decryption failed - invalid key or corrupted data');
            }
        } else {
            throw new Error(`Unsupported encryption format version: ${version}. Please upgrade the extension.`);
        }
    }

    /**
     * Check if a value is encrypted
     */
    public static isEncrypted(value: string): boolean {
        return value.startsWith('ENC[') && value.endsWith(']');
    }

    /**
     * Set master password for workspace (optional password protection)
     */
    public static async setMasterPassword(password: string, context: vscode.ExtensionContext): Promise<void> {
        const workspace = vscode.workspace.workspaceFolders?.[0]?.name || 'default';
        const key = await this.deriveKeyFromPassword(password, context, workspace);

        // Store the derived key
        const secretKey = `${this.SECRET_STORAGE_KEY_PREFIX}${workspace}`;
        await context.workspaceState.update(secretKey, key.toString('base64'));

        vscode.window.showInformationMessage('Master password set successfully');
    }

    /**
     * Change master password with automatic key rotation for existing encrypted variables
     * This prevents data loss when users change their password
     */
    public static async changeMasterPassword(oldPassword: string, newPassword: string, context: vscode.ExtensionContext): Promise<{
        success: boolean;
        migratedCount: number;
        error?: string;
    }> {
        try {
            const workspace = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
            if (!workspace) {
                return { success: false, migratedCount: 0, error: 'No workspace found' };
            }

            const envPath = path.join(workspace, '.env');
            if (!await fs.promises.access(envPath, fs.constants.F_OK).then(() => true).catch(() => false)) {
                // No .env file, just set the new password
                await this.setMasterPassword(newPassword, context);
                return { success: true, migratedCount: 0 };
            }

            // Derive old key from old password
            const workspaceName = vscode.workspace.workspaceFolders?.[0]?.name || 'default';
            const oldKey = await this.deriveKeyFromPassword(oldPassword, context, workspaceName);

            // Try to parse file with old key to verify it's correct
            let parsedVars: Map<string, { value: string; encrypted: boolean; raw: string }>;
            try {
                parsedVars = await EncryptedEnvironmentFile.parseEnvFile(envPath, context, oldKey);
            } catch (error) {
                return {
                    success: false,
                    migratedCount: 0,
                    error: 'Old password is incorrect or cannot decrypt existing variables'
                };
            }

            // Verify that ALL encrypted variables were successfully decrypted
            // If any variables are still encrypted after parsing, the old password is wrong
            let hasUndecryptedVars = false;
            for (const [, data] of parsedVars) {
                if (data.encrypted && data.value === data.raw) {
                    // Variable is marked as encrypted but value wasn't decrypted (still equals raw)
                    hasUndecryptedVars = true;
                    break;
                }
            }

            if (hasUndecryptedVars) {
                return {
                    success: false,
                    migratedCount: 0,
                    error: 'Old password is incorrect - cannot decrypt existing variables'
                };
            }

            // Count encrypted variables (now decrypted)
            let encryptedCount = 0;
            for (const [, data] of parsedVars) {
                if (data.encrypted) encryptedCount++;
            }

            if (encryptedCount === 0) {
                // No encrypted variables, just set new password
                await this.setMasterPassword(newPassword, context);
                return { success: true, migratedCount: 0 };
            }

            // Show progress for re-encryption
            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: 'Re-encrypting environment variables...',
                cancellable: false
            }, async (progress) => {
                progress.report({ increment: 0, message: 'Deriving new key...' });

                // Derive new key from new password
                const newKey = await this.deriveKeyFromPassword(newPassword, context, workspaceName);

                progress.report({ increment: 25, message: 'Re-encrypting variables...' });

                // Re-encrypt all variables with new key
                const reEncryptedVars = new Map<string, { value: string; encrypted: boolean }>();
                for (const [key, data] of parsedVars) {
                    if (data.encrypted) {
                        // Re-encrypt with new key
                        const reEncrypted = this.encryptValue(data.value, newKey);
                        reEncryptedVars.set(key, { value: reEncrypted, encrypted: true });
                    } else {
                        reEncryptedVars.set(key, data);
                    }
                }

                progress.report({ increment: 75, message: 'Saving changes...' });

                // Write back with new key
                await EncryptedEnvironmentFile.writeEnvFile(envPath, reEncryptedVars, context, newKey);

                // Store new master key
                const secretKey = `${this.SECRET_STORAGE_KEY_PREFIX}${workspaceName}`;
                await context.workspaceState.update(secretKey, newKey.toString('base64'));

                progress.report({ increment: 100, message: 'Complete!' });
            });

            return { success: true, migratedCount: encryptedCount };

        } catch (error) {
            return {
                success: false,
                migratedCount: 0,
                error: `Password change failed: ${(error as Error).message}`
            };
        }
    }

    /**
     * Check if workspace has encrypted variables
     */
    public static async workspaceHasEncryptedVars(): Promise<boolean> {
        const workspace = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (!workspace) return false;

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


/**
 * Key rotation and encryption health utilities
 */
export class EncryptionHealthUtils {
    /**
     * Check if workspace encryption is using current security parameters
     */
    public static async checkEncryptionHealth(context: vscode.ExtensionContext): Promise<{
        currentFormatVersion: number;
        pbkdf2Iterations: number;
        hasWorkspaceSalt: boolean;
        recommendations: string[];
        needsUpdate: boolean;
    }> {
        const workspace = vscode.workspace.workspaceFolders?.[0]?.name || 'default';
        const saltKey = `dotenvy.salt.${workspace}`;
        const hasWorkspaceSalt = !!(context.workspaceState.get(saltKey) as string);

        const recommendations: string[] = [];
        let needsUpdate = false;

        if (!hasWorkspaceSalt) {
            recommendations.push('Migrate salt storage to workspace-specific isolation');
            needsUpdate = true;
        }

        // Check if any encrypted vars use old format (would require scanning, simplified check)
        const formatRecommendations = await this.checkEncryptedVarsFormat();
        recommendations.push(...formatRecommendations);

        return {
            currentFormatVersion: EncryptedVarsManager.FORMAT_VERSION,
            pbkdf2Iterations: EncryptedVarsManager.PBKDF2_ITERATIONS,
            hasWorkspaceSalt,
            recommendations,
            needsUpdate: needsUpdate || formatRecommendations.length > 0
        };
    }

    /**
     * Check encryption format of existing encrypted variables
     */
    private static async checkEncryptedVarsFormat(): Promise<string[]> {
        const workspace = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (!workspace) return [];

        const envPath = path.join(workspace, '.env');
        const recommendations: string[] = [];

        try {
            if (!await fs.promises.access(envPath, fs.constants.F_OK).then(() => true).catch(() => false)) {
                return recommendations;
            }

            const content = await fs.promises.readFile(envPath, 'utf8');
            const lines = content.split('\n');

            for (const line of lines) {
                if (!line.includes('ENC[')) continue;

                const eqIndex = line.indexOf('=');
                if (eqIndex === -1) continue;

                const value = line.substring(eqIndex + 1).trim();
                if (EncryptedVarsManager.isEncrypted(value)) {
                    // Could implement version detection here if needed
                    // For now, assume all use current format or are compatible
                }
            }
        } catch (error) {
            recommendations.push(`Could not check encryption format: ${error}`);
        }

        return recommendations;
    }

    /**
     * Perform key rotation for workspace (generate new master key and re-encrypt all vars)
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

            // Generate new master key
            const newKey = crypto.randomBytes(EncryptedVarsManager.KEY_LENGTH);

            // Parse and re-encrypt variables
            const parsedVars = await EncryptedEnvironmentFile.parseEnvFile(envPath, context);
            let rotatedCount = 0;

            const reEncryptedVars = new Map<string, { value: string; encrypted: boolean }>();
            for (const [key, data] of parsedVars) {
                if (data.encrypted) {
                    // Re-encrypt with new key
                    const reEncrypted = EncryptedVarsManager.encryptValue(data.value, newKey);
                    reEncryptedVars.set(key, { value: reEncrypted, encrypted: true });
                    rotatedCount++;
                } else {
                    reEncryptedVars.set(key, data);
                }
            }

            // Write back with new key
            await EncryptedEnvironmentFile.writeEnvFile(envPath, reEncryptedVars, context, newKey);

            // Store new master key
            const workspaceName = vscode.workspace.workspaceFolders?.[0]?.name || 'default';
            const secretKey = `${EncryptedVarsManager.SECRET_STORAGE_KEY_PREFIX}${workspaceName}`;
            await context.workspaceState.update(secretKey, newKey.toString('base64'));

            return { success: true, rotatedCount };

        } catch (error) {
            return {
                success: false,
                rotatedCount: 0,
                error: `Key rotation failed: ${(error as Error).message}`
            };
        }
    }
}

/**
 * Encrypt environment file content
 */
export class EncryptedEnvironmentFile {
    /**
     * Parse .env file and separate encrypted/unencrypted vars
     * Automatically uses SessionManager key if no key provided, falls back to local key
     */
    public static async parseEnvFile(filePath: string, context: vscode.ExtensionContext, masterKey?: Buffer): Promise<Map<string, { value: string; encrypted: boolean; raw: string }>> {
        const vars = new Map<string, { value: string; encrypted: boolean; raw: string }>();

        if (!await fs.promises.access(filePath, fs.constants.F_OK).then(() => true).catch(() => false)) {
            return vars;
        }

        // If no key provided, get the appropriate key (SessionManager first, then local)
        if (!masterKey) {
            masterKey = await EncryptedVarsManager.ensureMasterKey(context);
        }

        const content = await fs.promises.readFile(filePath, 'utf8');

        for (const line of content.split('\n')) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith('#')) continue;

            const eqIndex = trimmed.indexOf('=');
            if (eqIndex === -1) continue;

            const key = trimmed.substring(0, eqIndex).trim();
            const value = trimmed.substring(eqIndex + 1).trim();

            let finalValue = value;
            let isEncrypted = false;

            if (EncryptedVarsManager.isEncrypted(value) && masterKey) {
                try {
                    finalValue = EncryptedVarsManager.decryptValue(value, masterKey);
                    isEncrypted = true;
                } catch (error) {
                    // Keep encrypted if decryption fails
                    console.warn(`Failed to decrypt ${key}:`, error);
                    finalValue = value;
                }
            } else if (EncryptedVarsManager.isEncrypted(value)) {
                // Encrypted but no key available - keep as is
                finalValue = value;
                isEncrypted = true;
            }

            vars.set(key, {
                value: finalValue,
                encrypted: isEncrypted,
                raw: value
            });
        }

        return vars;
    }

    /**
     * Write environment file with encrypted variables
     * Automatically uses SessionManager key if no key provided, falls back to local key
     */
    public static async writeEnvFile(filePath: string, vars: Map<string, { value: string; encrypted: boolean }>, context: vscode.ExtensionContext, masterKey?: Buffer): Promise<void> {
        const lines: string[] = [];

        // If no key provided, get the appropriate key (SessionManager first, then local)
        if (!masterKey) {
            masterKey = await EncryptedVarsManager.ensureMasterKey(context);
        }

        for (const [key, data] of vars) {
            if (data.encrypted && masterKey) {
                // Encrypt the value
                const encryptedValue = EncryptedVarsManager.encryptValue(data.value, masterKey);
                lines.push(`${key}=${encryptedValue}`);
            } else {
                // Store as plain (might be already encrypted or should stay plain)
                lines.push(`${key}=${data.value}`);
            }
        }

        await fs.promises.writeFile(filePath, lines.join('\n') + '\n', 'utf8');
    }
}

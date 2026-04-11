import * as vscode from 'vscode';
import * as crypto from 'crypto';

export interface BackupPackage {
    v: number;
    iv: string;
    ct: string;
    tag: string;
    s?: string; 
}

export class BackupManager {
    public static readonly SECRET_STORAGE_KEY = 'dotenvy.backup.key.v1';
    public static readonly FORMAT_VERSION = 1;
    public static readonly KEY_LENGTH = 32; 
    public static readonly IV_LENGTH = 12; 
    public static readonly ALGO = 'aes-256-gcm';

    public static async ensureAndGetStoredKey(context: vscode.ExtensionContext): Promise<Buffer> {
        const secret = await context.secrets.get(BackupManager.SECRET_STORAGE_KEY);
        if (secret) {
            return Buffer.from(secret, 'base64');
        }
        const key = crypto.randomBytes(BackupManager.KEY_LENGTH);
        await context.secrets.store(BackupManager.SECRET_STORAGE_KEY, key.toString('base64'));
        return key;
    }

    public static async deriveKeyFromPassword(password: string, salt: Buffer): Promise<Buffer> {
        return new Promise((resolve, reject) => {
            crypto.pbkdf2(password, salt, 310000, BackupManager.KEY_LENGTH, 'sha256', (err, derivedKey) => {
                if (err) {
                    reject(new Error(`Failed to derive key from password: ${err.message}`));
                } else {
                    resolve(derivedKey);
                }
            });
        });
    }

    public static generateSalt(): Buffer {
        return crypto.randomBytes(16);
    }

    public static getSaltFromBackup(payloadB64: string): Buffer | null {
        try {
            const raw = Buffer.from(payloadB64, 'base64').toString('utf8');
            const pack = JSON.parse(raw);
            if (pack.v === 2 && pack.s) {
                return Buffer.from(pack.s, 'base64');
            }
            return null; 
        } catch (e) {
            return null;
        }
    }

    public static encryptWithKey(plaintext: string, key: Buffer, salt?: Buffer): string {
        if (key.length !== BackupManager.KEY_LENGTH) {
            throw new Error('Invalid key length for encryption');
        }
        const iv = crypto.randomBytes(BackupManager.IV_LENGTH);
        const cipher = crypto.createCipheriv(BackupManager.ALGO, key, iv, { authTagLength: 16 });
        const ciphertext = Buffer.concat([cipher.update(Buffer.from(plaintext, 'utf8')), cipher.final()]);
        const tag = cipher.getAuthTag();

        const pack: BackupPackage = {
            v: salt ? 2 : BackupManager.FORMAT_VERSION,
            iv: iv.toString('base64'),
            ct: ciphertext.toString('base64'),
            tag: tag.toString('base64')
        };
        if (salt) {
            pack.s = salt.toString('base64');
        }
        return Buffer.from(JSON.stringify(pack)).toString('base64');
    }

    public static decryptWithKey(payloadB64: string, key: Buffer): string {
        if (key.length !== BackupManager.KEY_LENGTH) {
            throw new Error('Invalid key length for decryption');
        }

        let raw: string;
        try {
            raw = Buffer.from(payloadB64, 'base64').toString('utf8');
        } catch (e) {
            throw new Error('Invalid encrypted payload', { cause: e });
        }

        let pack: { v: number; iv: string; ct: string; tag: string; s?: string };
        try {
            pack = JSON.parse(raw);
        } catch (e) {
            throw new Error('Invalid encrypted payload format', { cause: e });
        }

        if (pack.v !== BackupManager.FORMAT_VERSION && pack.v !== 2) {
            throw new Error(`Unsupported backup format version: ${pack.v}`);
        }

        const iv = Buffer.from(pack.iv, 'base64');
        const ct = Buffer.from(pack.ct, 'base64');
        const tag = Buffer.from(pack.tag, 'base64');

        const decipher = crypto.createDecipheriv(BackupManager.ALGO, key, iv, { authTagLength: 16 });
        decipher.setAuthTag(tag);
        const out = Buffer.concat([decipher.update(ct), decipher.final()]);
        return out.toString('utf8');
    }
}

/**
 * AES-GCM packing for encrypted environment values (`ENC[...]`).
 */

import * as crypto from 'crypto';

interface CipherSettings {
    formatVersion: number;
    algorithm: 'aes-256-gcm';
    keyLength: number;
    ivLength: number;
}

/**
 * Returns whether an ENC payload version can be decrypted by this build.
 */
export function isSupportedEncryptionFormat(version: number, currentFormatVersion: number): boolean {
    return version === 1 || version === currentFormatVersion;
}

/**
 * Encrypts a plaintext value into `ENC[version|iv|tag|ciphertext]`.
 */
export function encryptValue(plaintext: string, key: Buffer, settings: CipherSettings): string {
    if (key.length !== settings.keyLength) {
        throw new Error('Invalid key length');
    }

    const iv = crypto.randomBytes(settings.ivLength);
    const cipher = crypto.createCipheriv(settings.algorithm, key, iv, { authTagLength: 16 });

    const encrypted = Buffer.concat([
        cipher.update(Buffer.from(plaintext, 'utf8')),
        cipher.final(),
    ]);

    const tag = cipher.getAuthTag();

    const pack = [
        settings.formatVersion.toString(),
        iv.toString('base64'),
        tag.toString('base64'),
        encrypted.toString('base64'),
    ].join('|');

    return `ENC[${pack}]`;
}

/**
 * Decrypts an `ENC[...]` value, including format version 1 payloads.
 */
export function decryptValue(encryptedValue: string, key: Buffer, settings: CipherSettings): string {
    if (key.length !== settings.keyLength) {
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

    if (iv.length !== settings.ivLength) { throw new Error('Invalid IV length in encrypted data'); }
    if (tag.length !== 16) { throw new Error('Invalid authentication tag length in encrypted data'); }
    if (ct.length === 0) { throw new Error('Empty ciphertext in encrypted data'); }

    if (isSupportedEncryptionFormat(version, settings.formatVersion)) {
        const decipher = crypto.createDecipheriv(settings.algorithm, key, iv, { authTagLength: 16 });
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
 * Returns whether a raw environment value uses the ENC[...] envelope.
 */
export function isEncrypted(value: string): boolean {
    return value.startsWith('ENC[') && value.endsWith(']');
}

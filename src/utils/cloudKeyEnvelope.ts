import * as crypto from 'crypto';
import {
    CLOUD_ENCRYPT_ALGO,
    CLOUD_SYNC_ENCRYPTED_KEY,
    CLOUD_SYNC_KDF_ITERATIONS,
    CLOUD_SYNC_KEY_SALT,
    CLOUD_SYNC_WRAPPED_KEY,
    IV_LENGTH,
    KEY_LENGTH,
    LEGACY_CLOUD_SYNC_ENCRYPTED_KEY,
    PBKDF2_ITERATIONS,
    PBKDF2_SALT_LENGTH,
} from '../constants';

export class CloudWrapRejectedError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'CloudWrapRejectedError';
    }
}

export class CloudPayloadAuthError extends Error {
    constructor() {
        super('Unsupported state or unable to authenticate data');
        this.name = 'CloudPayloadAuthError';
    }
}

export interface WrappedDataKey {
    wrappedKey: string;
    salt: string;
    iterations: number;
}

type SecretMap = { [key: string]: string };

export function findEncryptedPayload(secrets: SecretMap): string | null {
    if (secrets[CLOUD_SYNC_ENCRYPTED_KEY]) {
        return secrets[CLOUD_SYNC_ENCRYPTED_KEY].trim();
    }
    if (secrets[LEGACY_CLOUD_SYNC_ENCRYPTED_KEY]) {
        return secrets[LEGACY_CLOUD_SYNC_ENCRYPTED_KEY].trim();
    }
    return null;
}

export function readRemoteWrap(secrets: SecretMap): WrappedDataKey | null {
    const wrappedKey = secrets[CLOUD_SYNC_WRAPPED_KEY]?.trim();
    if (!wrappedKey) {
        return null;
    }

    const salt = secrets[CLOUD_SYNC_KEY_SALT]?.trim();
    const iterationsRaw = secrets[CLOUD_SYNC_KDF_ITERATIONS];
    if (!salt || iterationsRaw === undefined || String(iterationsRaw).trim() === '') {
        throw new CloudWrapRejectedError('Cloud key wrap is incomplete');
    }

    return {
        wrappedKey,
        salt,
        iterations: acceptedIterations(String(iterationsRaw).trim(), salt),
    };
}

export function encryptPayload(plaintext: string, key: Buffer): string {
    return seal(Buffer.from(plaintext, 'utf8'), key);
}

export function decryptPayload(encryptedPayload: string, key: Buffer): string {
    return open(encryptedPayload, key).toString('utf8');
}

export function wrapDataKey(dataKey: Buffer, passphrase: string): WrappedDataKey {
    if (dataKey.length !== KEY_LENGTH) {
        throw new Error('Invalid key length');
    }

    const salt = crypto.randomBytes(PBKDF2_SALT_LENGTH).toString('base64');
    const kek = deriveKek(passphrase, salt, PBKDF2_ITERATIONS);
    return {
        wrappedKey: seal(dataKey, kek),
        salt,
        iterations: PBKDF2_ITERATIONS,
    };
}

export function unwrapDataKey(
    wrappedKey: string,
    salt: string,
    iterations: string | number,
    passphrase: string,
): Buffer {
    const accepted = acceptedIterations(iterations, salt);
    const kek = deriveKek(passphrase, salt, accepted);
    const dataKey = open(wrappedKey, kek);
    if (dataKey.length !== KEY_LENGTH) {
        throw new CloudWrapRejectedError('Invalid wrapped cloud key length');
    }
    return dataKey;
}

function acceptedIterations(iterations: string | number, salt: string): number {
    if (iterations !== PBKDF2_ITERATIONS && iterations !== String(PBKDF2_ITERATIONS)) {
        throw new CloudWrapRejectedError('Unsupported cloud key iteration count');
    }

    const saltBytes = Buffer.from(salt, 'base64');
    if (saltBytes.length !== PBKDF2_SALT_LENGTH) {
        throw new CloudWrapRejectedError('Unsupported cloud key salt length');
    }

    return PBKDF2_ITERATIONS;
}

function deriveKek(passphrase: string, salt: string, iterations: number): Buffer {
    return crypto.pbkdf2Sync(passphrase, Buffer.from(salt, 'base64'), iterations, KEY_LENGTH, 'sha256');
}

function seal(plaintext: Buffer, key: Buffer): string {
    if (key.length !== KEY_LENGTH) {
        throw new Error('Invalid key length');
    }

    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(CLOUD_ENCRYPT_ALGO, key, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const authTag = cipher.getAuthTag();
    return [iv, authTag, encrypted].map(part => part.toString('base64')).join('.');
}

function open(packed: string, key: Buffer): Buffer {
    const parts = packed.split('.');
    if (parts.length !== 3) {
        throw new CloudWrapRejectedError('Invalid encrypted cloud payload format');
    }

    const iv = Buffer.from(parts[0], 'base64');
    const authTag = Buffer.from(parts[1], 'base64');
    const ciphertext = Buffer.from(parts[2], 'base64');
    if (iv.length !== IV_LENGTH || authTag.length !== 16) {
        throw new CloudWrapRejectedError('Invalid encrypted cloud payload format');
    }

    const decipher = crypto.createDecipheriv(CLOUD_ENCRYPT_ALGO, key, iv);
    decipher.setAuthTag(authTag);
    try {
        return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    } catch {
        throw new CloudPayloadAuthError();
    }
}

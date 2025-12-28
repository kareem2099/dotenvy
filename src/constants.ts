/**
 * Application-wide constants for DotEnvy
 * Centralizes magic strings and configuration values for better maintainability
 */

// ==========================================
// 1. Cloud Sync Constants
// ==========================================
export const CLOUD_SYNC_ENCRYPTED_KEY = '__dotenvy_encrypted__';
export const CLOUD_SYNC_VERSION_KEY = '__dotenvy_encryption_version__';
export const CLOUD_SYNC_LAST_SYNC_KEY = '__dotenvy_last_sync__';
export const CLOUD_SYNC_ALGO_KEY = '__dotenvy_encryption_algo__';

// ==========================================
// 2. User Management Constants
// ==========================================
export const USER_ENVELOPE_FILE = '.dotenvy.lock.json';
export const USER_ENVELOPE_VERSION = 1;

// ==========================================
// 3. Local Encryption Constants
// ==========================================
export const SECRET_STORAGE_KEY = 'dotenvy.master.key';
export const SALT_STORAGE_KEY = 'dotenvy.salt';
export const FORMAT_VERSION = 2;
export const ENCRYPT_ALGO = 'aes-256-gcm';
export const KEY_LENGTH = 32;
export const IV_LENGTH = 12;
export const PBKDF2_ITERATIONS = 310000;
export const PBKDF2_SALT_LENGTH = 32;

// ==========================================
// 4. Cloud Encryption Constants
// ==========================================
export const CLOUD_ENCRYPT_ALGO = 'aes-256-gcm';
export const CLOUD_ENCRYPT_FORMAT_VERSION = '2.0';
export const CLOUD_KEY_STORAGE = 'dotenvy.cloud.key';
export const LAST_SYNC_STORAGE = 'dotenvy.cloud.last.sync';

// ==========================================
// 5. Update & Versioning Constants
// ==========================================
export const EXTENSION_VERSION_KEY = 'dotenvy.version';

// ==========================================
// 6. UI & Validation Constants
// ==========================================
export const NOTIFICATION_TIMEOUT = 3000;
export const LOCK_BUTTON_TIMEOUT = 2500;
export const MIN_PASSWORD_LENGTH = 8;
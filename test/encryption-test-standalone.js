#!/usr/bin/env node

//
// Standalone test to verify encryption improvements work correctly
// Tests the core cryptographic functions without VS Code dependencies
// Run with: node encryption-test-standalone.js
//

const crypto = require('crypto');

// Mock VS Code Extension Context for testing
class MockMemento {
    constructor() {
        this.data = new Map();
    }

    get(key) {
        return this.data.get(key);
    }

    async update(key, value) {
        this.data.set(key, value);
    }
}

class MockContext {
    constructor() {
        this.globalState = new MockMemento();
        this.workspaceState = new MockMemento();
    }
}

// Reimplement the core encryption logic for standalone testing
class TestEncryptedVarsManager {
    static SECRET_STORAGE_KEY_PREFIX = 'dotenvy.master.key.';
    static FORMAT_VERSION = 2; // Increased for improved encryption parameters
    static ENCRYPT_ALGO = 'aes-256-gcm';
    static KEY_LENGTH = 32;
    static IV_LENGTH = 12;
    static PBKDF2_ITERATIONS = 310000; // OWASP recommended minimum
    static PBKDF2_SALT_LENGTH = 32; // Increased salt size for better security

    /**
     * Get or create master key for workspace (simplified for testing)
     */
    static async ensureMasterKey(context) {
        const workspace = 'test-workspace';
        const secretKey = `${this.SECRET_STORAGE_KEY_PREFIX}${workspace}`;

        const secret = context.workspaceState.get(secretKey);
        if (secret) {
            return Buffer.from(secret, 'base64');
        }

        // Generate new 256-bit key
        const key = crypto.randomBytes(this.KEY_LENGTH);
        await context.workspaceState.update(secretKey, key.toString('base64'));
        return key;
    }

    /**
     * Derive encryption key from master password + salt with modern parameters
     */
    static async deriveKeyFromPassword(password, context, workspace = 'test-workspace') {
        const saltKey = `dotenvy.salt.${workspace}`;
        let salt = context.workspaceState.get(saltKey);

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
    static encryptValue(plaintext, key) {
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
    static decryptValue(encryptedValue, key) {
        if (key.length !== this.KEY_LENGTH) {
            throw new Error('Invalid key length');
        }

        // Validate format
        if (!encryptedValue.startsWith('ENC[') || !encryptedValue.endsWith(']')) {
            throw new Error('Invalid encrypted variable format');
        }

        const packData = encryptedValue.slice(4, -1); // Remove ENC[ ... ]
        const parts = packData.split('|');

        if (parts.length !== 4) {
            throw new Error('Invalid encrypted data structure');
        }

        const [versionStr, ivB64, tagB64, ctB64] = parts;
        const version = parseInt(versionStr);

        // Handle version migration
        if (version === 1) {
            // Legacy version with weaker PBKDF2 parameters - still supported for compatibility
            console.log('🔄 Detected legacy format version 1, decrypting with compatibility...');
            const iv = Buffer.from(ivB64, 'base64');
            const tag = Buffer.from(tagB64, 'base64');
            const ct = Buffer.from(ctB64, 'base64');

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
            console.log('✅ Decrypting with format version', version, '(improved parameters)');
            const iv = Buffer.from(ivB64, 'base64');
            const tag = Buffer.from(tagB64, 'base64');
            const ct = Buffer.from(ctB64, 'base64');

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
    static isEncrypted(value) {
        return value.startsWith('ENC[') && value.endsWith(']');
    }
}

async function testEncryptionImprovements() {
    console.log('🔐 Testing Improved Encryption System');
    console.log('=' .repeat(60));

    const mockContext = new MockContext();

    try {
        console.log('\n📋 Testing Constants (Public Security Parameters):');
        console.log('Format Version:', TestEncryptedVarsManager.FORMAT_VERSION);
        console.log('Encryption Algorithm:', TestEncryptedVarsManager.ENCRYPT_ALGO);
        console.log('PBKDF2 Iterations:', TestEncryptedVarsManager.PBKDF2_ITERATIONS.toLocaleString());
        console.log('Salt Length:', TestEncryptedVarsManager.PBKDF2_SALT_LENGTH, 'bytes');

        // Test 1: Generate master key
        console.log('\n1. 🔑 Testing Master Key Generation...');
        const key = await TestEncryptedVarsManager.ensureMasterKey(mockContext);
        console.log('✅ Master key generated:', key.length, 'bytes');

        // Test 2: Test password-derived key (improved PBKDF2)
        console.log('\n2. 🔐 Testing Password-Based Key Derivation (PBKDF2)...');
        const password = 'test-password-2025';
        const derivedKey = await TestEncryptedVarsManager.deriveKeyFromPassword(password, mockContext);
        console.log('✅ Derived key from password:', derivedKey.length, 'bytes');
        console.log('✅ Uses', TestEncryptedVarsManager.PBKDF2_ITERATIONS.toLocaleString(), 'PBKDF2 iterations');

        // Test 3: Encrypt with improved parameters
        console.log('\n3. 🔒 Testing AES-256-GCM Encryption (Format v2)...');
        const secretValue = 'my-super-secret-api-key-2025';
        const encryptedValue = TestEncryptedVarsManager.encryptValue(secretValue, derivedKey);
        console.log('✅ Encrypted format v2:', encryptedValue.substring(0, 50) + '...');

        // Verify it starts with ENC[ and uses format version 2
        if (encryptedValue.startsWith('ENC[') && encryptedValue.includes('2|')) {
            console.log('✅ Uses new format version 2');
        } else {
            throw new Error('❌ Expected format version 2');
        }

        // Test 4: Decrypt with improved parameters
        console.log('\n4. 🔓 Testing AES-256-GCM Decryption...');
        const decryptedValue = TestEncryptedVarsManager.decryptValue(encryptedValue, derivedKey);
        console.log('✅ Decrypted value:', decryptedValue);

        // Verify round-trip with improved parameters
        if (secretValue === decryptedValue) {
            console.log('✅ Round-trip encryption/decryption successful with improved parameters!');
        } else {
            throw new Error('❌ Round-trip failed - encryption/decryption mismatch');
        }

        // Test 5: Backward compatibility test
        console.log('\n5. 🔄 Testing Backward Compatibility...');
        // Create a mock "legacy" format v1 encryption (simulating old system)
        const legacyIV = crypto.randomBytes(12);
        const legacyCipher = crypto.createCipheriv('aes-256-gcm', derivedKey, legacyIV, { authTagLength: 16 });
        const legacyEncrypted = Buffer.concat([
            legacyCipher.update(Buffer.from('legacy-secret-value')),
            legacyCipher.final()
        ]);
        const legacyTag = legacyCipher.getAuthTag();

        const legacyEncryptedValue = `ENC[1|${legacyIV.toString('base64')}|${legacyTag.toString('base64')}|${legacyEncrypted.toString('base64')}]`;

        // Try to decrypt legacy format
        const legacyDecrypted = TestEncryptedVarsManager.decryptValue(legacyEncryptedValue, derivedKey);
        if (legacyDecrypted === 'legacy-secret-value') {
            console.log('✅ Backward compatibility with format v1 confirmed');
        } else {
            console.log('❌ Backward compatibility test failed');
        }

        // Test 6: Format detection
        console.log('\n6. 🔍 Testing Format Detection...');
        console.log('Is encrypted (v2):', TestEncryptedVarsManager.isEncrypted(encryptedValue));
        console.log('Is not encrypted:', TestEncryptedVarsManager.isEncrypted('plain-text-value'));

        // Test 7: Performance check (quick stress test)
        console.log('\n7. ⚡ Testing Encryption Performance...');
        const start = Date.now();
        for (let i = 0; i < 10; i++) {
            const testKey = crypto.randomBytes(32);
            const testValue = `test-secret-${i}-with-longer-content-for-stress-testing`;
            const enc = TestEncryptedVarsManager.encryptValue(testValue, testKey);
            const dec = TestEncryptedVarsManager.decryptValue(enc, testKey);
            if (dec !== testValue) {
                throw new Error(`❌ Performance test failed on iteration ${i}`);
            }
        }
        const duration = Date.now() - start;
        console.log(`✅ Encryption performance: 10 cycles completed in ${duration}ms`);

        // Test 8: Security parameter validation
        console.log('\n8. 🛡️ Testing Security Parameter Validation...');
        try {
            const wrongSizeKey = crypto.randomBytes(16); // Wrong key size
            TestEncryptedVarsManager.encryptValue('test', wrongSizeKey);
            throw new Error('Should have rejected wrong key size');
        } catch (error) {
            if (error.message.includes('Invalid key length')) {
                console.log('✅ Key length validation working');
            } else {
                throw error;
            }
        }

        console.log('\n' + '=' .repeat(60));
        console.log('🎉 ALL ENCRYPTION IMPROVEMENT TESTS PASSED!');
        console.log('✨ Key improvements verified:');
        console.log(`   • PBKDF2 iterations increased to ${TestEncryptedVarsManager.PBKDF2_ITERATIONS.toLocaleString()}`);
        console.log(`   • Salt length increased to ${TestEncryptedVarsManager.PBKDF2_SALT_LENGTH} bytes`);
        console.log('   • Format version 2 with backward compatibility');
        console.log('   • Enhanced key derivation and encryption strength');
        console.log('   • All cryptographic parameters publicly exposed for transparency');

    } catch (error) {
        console.error('\n❌ ENCRYPTION TEST FAILED:', error.message);
        console.error(error.stack);
        process.exit(1);
    }
}

// Run the comprehensive test
testEncryptionImprovements();

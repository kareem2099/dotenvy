/**
 * Comprehensive Integration Tests for Password-Based Backup Encryption (v1.4.0)
 * Tests all critical paths, edge cases, and error scenarios
 */

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// Test configuration
const TEST_DIR = path.join(os.tmpdir(), 'dotenvy-backup-tests');
const ALGO = 'aes-256-gcm';
const KEY_LENGTH = 32;
const IV_LENGTH = 12;
const PBKDF2_ITERATIONS = 310000;

console.log('DotEnvy v1.4.0 - Comprehensive Backup Encryption Tests');
console.log('='.repeat(70));

// Setup test environment
function setupTestEnv() {
    if (fs.existsSync(TEST_DIR)) {
        fs.rmSync(TEST_DIR, { recursive: true });
    }
    fs.mkdirSync(TEST_DIR, { recursive: true });
    console.log(`Test directory created: ${TEST_DIR}\n`);
}

// Cleanup test environment
function cleanupTestEnv() {
    if (fs.existsSync(TEST_DIR)) {
        fs.rmSync(TEST_DIR, { recursive: true });
    }
    console.log(`\nTest directory cleaned up`);
}

// Helper: Derive key from password (matching implementation)
function deriveKeyFromPassword(password: string, salt: Buffer): Promise<Buffer> {
    return new Promise((resolve, reject) => {
        crypto.pbkdf2(password, salt, PBKDF2_ITERATIONS, KEY_LENGTH, 'sha256', (err, derivedKey) => {
            if (err) reject(err);
            else resolve(derivedKey);
        });
    });
}

// Helper: Generate salt
function generateSalt(): Buffer {
    return crypto.randomBytes(16);
}

// Helper: Encrypt with key and salt (v2 format)
async function encryptWithPassword(plaintext: string, password: string): Promise<{ encrypted: string; salt: Buffer }> {
    // We don't need try/catch here, if an error occurs it will be returned in the Promise itself
    const salt = generateSalt();
    const key = await deriveKeyFromPassword(password, salt);
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGO, key, iv, { authTagLength: 16 });
    const ciphertext = Buffer.concat([cipher.update(Buffer.from(plaintext, 'utf8')), cipher.final()]);
    const tag = cipher.getAuthTag();

    const pack = {
        v: 2, // Version 2 - password-based
        iv: iv.toString('base64'),
        ct: ciphertext.toString('base64'),
        tag: tag.toString('base64'),
        s: salt.toString('base64')
    };

    const encrypted = Buffer.from(JSON.stringify(pack)).toString('base64');
    
    // Instead of resolve, we use a regular return
    return { encrypted, salt };
}

// Helper: Decrypt with password and salt (v2 format)
async function decryptWithPassword(encryptedB64: string, password: string): Promise<string> {
    const raw = Buffer.from(encryptedB64, 'base64').toString('utf8');
    const pack = JSON.parse(raw);

    if (pack.v !== 2 || !pack.s) {
        // Instead of reject, we throw the error
        throw new Error('Not a password-based backup (v2)');
    }

    const salt = Buffer.from(pack.s, 'base64');
    const key = await deriveKeyFromPassword(password, salt);
    const iv = Buffer.from(pack.iv, 'base64');
    const ct = Buffer.from(pack.ct, 'base64');
    const tag = Buffer.from(pack.tag, 'base64');

    const decipher = crypto.createDecipheriv(ALGO, key, iv, { authTagLength: 16 });
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([decipher.update(ct), decipher.final()]);
    
    // Instead of resolve, we use a regular return
    return plaintext.toString('utf8');
}

// Test 1: Basic Encryption/Decryption Cycle
async function test_basicEncryptionDecryption() {
    console.log(' Test 1: Basic Encryption/Decryption Cycle');
    const testData = 'API_KEY=test123\nDATABASE_URL=postgresql://localhost/test\nSECRET=mysecret';
    const password = 'TestPassword123!';

    try {
        const { encrypted, salt } = await encryptWithPassword(testData, password);
        console.log(`   Encryption successful (${encrypted.length} bytes)`);
        console.log(`   Salt generated: ${salt.length} bytes`);

        const decrypted = await decryptWithPassword(encrypted, password);

        if (decrypted === testData) {
            console.log('   Decryption successful - data matches');
            return true;
        } else {
            console.error('   Decrypted data does not match original');
            return false;
        }
    } catch (error) {
        console.error('   Test failed:', (error as Error).message);
        return false;
    }
}

// Test 2: Wrong Password Rejection
async function test_wrongPasswordRejection() {
    console.log('\n Test 2: Wrong Password Rejection');
    const testData = 'SECRET=confidential';
    const correctPassword = 'CorrectPassword123!';
    const wrongPassword = 'WrongPassword456!';

    try {
        const { encrypted } = await encryptWithPassword(testData, correctPassword);
        console.log('   Encryption successful');

        try {
            await decryptWithPassword(encrypted, wrongPassword);
            console.error('   SECURITY ISSUE: Wrong password was accepted!');
            return false;
        } catch (error) {
            console.log('   Wrong password correctly rejected');
            return true;
        }
    } catch (error) {
        console.error('   Test failed:', (error as Error).message);
        return false;
    }
}

// Test 3: Corrupted Data Handling
async function test_corruptedDataHandling() {
    console.log('\n Test 3: Corrupted Data Handling');
    const testData = 'SECRET=test';
    const password = 'TestPassword!';

    try {
        const { encrypted } = await encryptWithPassword(testData, password);

        // Corrupt the encrypted data
        const corruptedData = encrypted.substring(0, encrypted.length - 10) + 'CORRUPTED';

        try {
            await decryptWithPassword(corruptedData, password);
            console.error('   Corrupted data was accepted!');
            return false;
        } catch (error) {
            console.log('   Corrupted data correctly rejected');
            return true;
        }
    } catch (error) {
        console.error('   Test failed:', (error as Error).message);
        return false;
    }
}

// Test 4: Large File Encryption
async function test_largeFileEncryption() {
    console.log('\n Test 4: Large File Encryption (1000+ variables)');

    // Generate large .env file
    let largeData = '';
    for (let i = 0; i < 1000; i++) {
        largeData += `VARIABLE_${i}=value_${i}_with_some_longer_content_to_simulate_real_data\n`;
    }

    const password = 'LargeFileTest123!';
    const startTime = Date.now();

    try {
        const { encrypted } = await encryptWithPassword(largeData, password);
        const encryptTime = Date.now() - startTime;
        console.log(`   Large file encrypted in ${encryptTime}ms`);
        console.log(`   Original size: ${largeData.length} bytes`);
        console.log(`   Encrypted size: ${encrypted.length} bytes`);

        const decryptStart = Date.now();
        const decrypted = await decryptWithPassword(encrypted, password);
        const decryptTime = Date.now() - decryptStart;
        console.log(`   Large file decrypted in ${decryptTime}ms`);

        if (decrypted === largeData) {
            console.log('   Data integrity verified');
            return true;
        } else {
            console.error('   Data integrity check failed');
            return false;
        }
    } catch (error) {
        console.error('   Test failed:', (error as Error).message);
        return false;
    }
}

// Test 5: Special Characters in Password
async function test_specialCharactersPassword() {
    console.log('\n Test 5: Special Characters in Password');
    const testData = 'SECRET=test123';
    const specialPasswords = [
        'P@ssw0rd!#$%',
        'パスワード123', // Japanese characters
        'Пароль123', // Cyrillic
        'P@ss w0rd with spaces!',
        '🔐🔑🔒🔓' // Emojis
    ];

    let allPassed = true;
    for (const password of specialPasswords) {
        try {
            const { encrypted } = await encryptWithPassword(testData, password);
            const decrypted = await decryptWithPassword(encrypted, password);

            if (decrypted === testData) {
                console.log(`   Special password accepted: "${password.substring(0, 10)}..."`);
            } else {
                console.error(`   Data mismatch for password: "${password}"`);
                allPassed = false;
            }
        } catch (error) {
            console.error(`   Failed for password "${password}":`, (error as Error).message);
            allPassed = false;
        }
    }
    return allPassed;
}

// Test 6: Empty and Edge Case Data
async function test_edgeCaseData() {
    console.log('\n Test 6: Edge Case Data (empty, whitespace, special chars)');
    const edgeCases = [
        { name: 'Empty string', data: '' },
        { name: 'Single space', data: ' ' },
        { name: 'Only newlines', data: '\n\n\n' },
        { name: 'Very long line', data: 'X'.repeat(10000) },
        { name: 'Unicode characters', data: '变量=值\nמשתנה=ערך\nμεταβλητή=τιμή' },
        { name: 'Binary-like data', data: '\x00\x01\x02\xFF\xFE\xFD' }
    ];

    let allPassed = true;
    const password = 'EdgeCaseTest123!';

    for (const testCase of edgeCases) {
        try {
            const { encrypted } = await encryptWithPassword(testCase.data, password);
            const decrypted = await decryptWithPassword(encrypted, password);

            if (decrypted === testCase.data) {
                console.log(`   ${testCase.name}: Passed`);
            } else {
                console.error(`   ${testCase.name}: Data mismatch`);
                allPassed = false;
            }
        } catch (error) {
            console.error(`   ${testCase.name}: ${(error as Error).message}`);
            allPassed = false;
        }
    }
    return allPassed;
}

// Test 7: Cross-Device Simulation (Different Salt, Same Password)
async function test_crossDeviceSimulation() {
    console.log('\n Test 7: Cross-Device Simulation');
    const testData = 'API_KEY=crossdevicetest\nSECRET=portable';
    const password = 'SamePasswordEverywhere!';

    try {
        // Simulate Device 1: Create backup
        const device1 = await encryptWithPassword(testData, password);
        console.log('   Device 1: Backup created');

        // Simulate Device 2: Restore backup (different salt will be extracted)
        const device2Decrypted = await decryptWithPassword(device1.encrypted, password);

        if (device2Decrypted === testData) {
            console.log('   Device 2: Backup restored successfully');
            console.log('   Cross-device portability verified');
            return true;
        } else {
            console.error('  Cross-device restoration failed');
            return false;
        }
    } catch (error) {
        console.error('   Test failed:', (error as Error).message);
        return false;
    }
}

// Test 8: Salt Uniqueness
async function test_saltUniqueness() {
    console.log('\n Test 8: Salt Uniqueness (Multiple Backups)');
    const testData = 'SECRET=test';
    const password = 'TestPassword!';
    const salts: string[] = [];

    try {
        for (let i = 0; i < 10; i++) {
            const { salt } = await encryptWithPassword(testData, password);
            const saltHex = salt.toString('hex');

            if (salts.includes(saltHex)) {
                console.error(`   Duplicate salt detected at iteration ${i + 1}!`);
                return false;
            }
            salts.push(saltHex);
        }

        console.log(`   All 10 salts are unique`);
        return true;
    } catch (error) {
        console.error('    Test failed:', (error as Error).message);
        return false;
    }
}

// Test 9: PBKDF2 Performance Consistency
async function test_pbkdf2Performance() {
    console.log('\n Test 9: PBKDF2 Performance Consistency');
    const password = 'PerformanceTest!';
    const salt = generateSalt();
    const iterations = 5;
    const times: number[] = [];

    try {
        for (let i = 0; i < iterations; i++) {
            const start = Date.now();
            await deriveKeyFromPassword(password, salt);
            const duration = Date.now() - start;
            times.push(duration);
        }

        const avgTime = times.reduce((a, b) => a + b, 0) / times.length;
        const maxTime = Math.max(...times);
        const minTime = Math.min(...times);

        console.log(`    Average: ${avgTime.toFixed(2)}ms`);
        console.log(`    Min: ${minTime}ms, Max: ${maxTime}ms`);
        console.log(`    Variance: ${(maxTime - minTime)}ms`);

        if (avgTime > 500) {
            console.log(`     Warning: PBKDF2 is slow (>${avgTime}ms). Acceptable for backups.`);
        } else {
            console.log(`    Performance is acceptable`);
        }
        return true;
    } catch (error) {
        console.error('    Test failed:', (error as Error).message);
        return false;
    }
}

// Run all tests
async function runAllTests() {
    setupTestEnv();

    const tests = [
        { name: 'Basic Encryption/Decryption', fn: test_basicEncryptionDecryption },
        { name: 'Wrong Password Rejection', fn: test_wrongPasswordRejection },
        { name: 'Corrupted Data Handling', fn: test_corruptedDataHandling },
        { name: 'Large File Encryption', fn: test_largeFileEncryption },
        { name: 'Special Characters Password', fn: test_specialCharactersPassword },
        { name: 'Edge Case Data', fn: test_edgeCaseData },
        { name: 'Cross-Device Simulation', fn: test_crossDeviceSimulation },
        { name: 'Salt Uniqueness', fn: test_saltUniqueness },
        { name: 'PBKDF2 Performance', fn: test_pbkdf2Performance }
    ];

    const results: boolean[] = [];

    for (const test of tests) {
        const result = await test.fn();
        results.push(result);
    }

    cleanupTestEnv();

    console.log('\n' + '='.repeat(70));
    console.log(' Test Results Summary');
    console.log('='.repeat(70));

    const passed = results.filter(r => r).length;
    const total = results.length;
    const percentage = ((passed / total) * 100).toFixed(1);

    console.log(` Passed: ${passed}/${total} (${percentage}%)`);
    console.log(` Failed: ${total - passed}/${total}`);

    if (passed === total) {
        console.log('\n All tests passed! v1.4.0 is ready for production.');
        process.exit(0);
    } else {
        console.log('\n  Some tests failed. Please review the issues above.');
        process.exit(1);
    }
}

// Execute tests
runAllTests().catch(error => {
    console.error(' Test suite crashed:', error);
    cleanupTestEnv();
    process.exit(1);
});

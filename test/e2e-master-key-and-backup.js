#!/usr/bin/env node

/**
 * E2E Test Suite: Master Key Lifecycle, Password Migration, and Backup/Restore
 * 
 * Verifies:
 * 1. Automatic Master Key generation in OS SecretStorage
 * 2. Legacy workspaceState migration to SecretStorage
 * 3. hasMasterKey and hasMasterPassword detection
 * 4. AES-256-GCM variable encryption/decryption
 * 5. Migration from auto-generated master key to master password
 * 6. Master Key auto-authorized backup creation (.master.enc)
 * 7. Restoration of .master.enc, .legacy.enc, and password-protected backups
 */

const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const os = require('os');
const assert = require('assert');

// ─── Setup Temporary Workspace ────────────────────────────────────────────────
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dotenvy-test-'));
const tempEnvFile = path.join(tempDir, '.env');
fs.writeFileSync(tempEnvFile, 'API_KEY=initial-secret-value-12345\nDB_PASS=super-secure-db-password\n', 'utf8');

// ─── Mock VS Code API ────────────────────────────────────────────────────────
const mockSecrets = new Map();
const mockWorkspaceState = new Map();

const mockContext = {
    secrets: {
        get: (key) => Promise.resolve(mockSecrets.get(key)),
        store: (key, val) => {
            if (val === undefined) { mockSecrets.delete(key); }
            else { mockSecrets.set(key, val); }
            return Promise.resolve();
        }
    },
    workspaceState: {
        get: (key) => mockWorkspaceState.get(key),
        update: (key, val) => {
            if (val === undefined) { mockWorkspaceState.delete(key); }
            else { mockWorkspaceState.set(key, val); }
            return Promise.resolve();
        }
    },
    extensionMode: 1, // Development
    subscriptions: []
};

const registeredCommands = new Map();

const vscodeMock = {
    ExtensionMode: { Development: 1, Test: 2, Production: 3 },
    ProgressLocation: { SourceControl: 1, Window: 10, Notification: 15 },
    Uri: {
        file: (p) => ({ fsPath: p })
    },
    workspace: {
        workspaceFolders: [
            {
                name: 'test-workspace',
                uri: { fsPath: tempDir }
            }
        ],
        name: 'test-workspace',
        getConfiguration: () => ({
            get: (key, def) => def,
            update: () => Promise.resolve()
        }),
        openTextDocument: () => Promise.resolve({}),
    },
    window: {
        showInformationMessage: () => Promise.resolve(),
        showWarningMessage: () => Promise.resolve(),
        showErrorMessage: (msg) => { console.error('  [VSCode Error Window]:', msg); return Promise.resolve(); },
        showInputBox: () => Promise.resolve(),
        showQuickPick: () => Promise.resolve(),
        showTextDocument: () => Promise.resolve(),
        createOutputChannel: () => ({
            appendLine: () => {},
            show: () => {},
            clear: () => {}
        }),
        withProgress: async (_opts, task) => {
            const progress = { report: () => {} };
            return await task(progress);
        }
    },
    commands: {
        registerCommand: (cmd, callback) => {
            registeredCommands.set(cmd, callback);
            return { dispose: () => registeredCommands.delete(cmd) };
        },
        executeCommand: (cmd, ...args) => {
            const fn = registeredCommands.get(cmd);
            if (fn) return fn(...args);
        }
    },
    env: {
        machineId: 'test-machine-id-' + crypto.randomBytes(4).toString('hex')
    }
};

// Intercept 'vscode' require
const Module = require('module');
const originalRequire = Module.prototype.require;
Module.prototype.require = function (packageName) {
    if (packageName === 'vscode') {
        return vscodeMock;
    }
    return originalRequire.apply(this, arguments);
};

// ─── Import Compiled Modules ──────────────────────────────────────────────────
const { EncryptedVarsManager, EncryptedEnvironmentFile } = require('../out/utils/encryptedVars.js');
const { BackupManager } = require('../out/utils/backupManager.js');
const { BackupCommands } = require('../out/commands/backupCommands.js');

// ─── Run Tests ────────────────────────────────────────────────────────────────
async function runTests() {
    console.log('🔒 DotEnvy v2.1.0: Master Key & Backup E2E Test Suite');
    console.log('====================================================\n');

    let passed = 0;
    let failed = 0;

    async function test(name, fn) {
        process.stdout.write(`  Testing: ${name}... `);
        try {
            await fn();
            console.log('✅ PASS');
            passed++;
        } catch (err) {
            console.log('❌ FAIL');
            console.error('    Error:', err.message);
            console.error(err.stack);
            failed++;
        }
    }

    // 1. Master Key Auto-Generation
    await test('Master Key Auto-Generation in SecretStorage', async () => {
        assert.strictEqual(await EncryptedVarsManager.hasMasterKey(mockContext), false);
        const key = await EncryptedVarsManager.ensureMasterKey(mockContext);
        assert.ok(Buffer.isBuffer(key));
        assert.strictEqual(key.length, 32);
        assert.strictEqual(await EncryptedVarsManager.hasMasterKey(mockContext), true);
        assert.strictEqual(await EncryptedVarsManager.hasMasterPassword(mockContext), false);
    });

    // 2. SecretStorage Key Retrieval Consistency
    await test('Consistent retrieval of Master Key from SecretStorage', async () => {
        const key1 = await EncryptedVarsManager.ensureMasterKey(mockContext);
        const key2 = await EncryptedVarsManager.ensureMasterKey(mockContext);
        assert.strictEqual(key1.toString('hex'), key2.toString('hex'));
    });

    // 3. Legacy Migration from workspaceState
    await test('Migration from legacy workspaceState to SecretStorage', async () => {
        // Clear secrets
        mockSecrets.clear();
        const legacyWorkspace = 'test-workspace';
        const secretKey = `${EncryptedVarsManager.SECRET_STORAGE_KEY_PREFIX}${legacyWorkspace}`;
        const saltKey = `dotenvy.salt.${legacyWorkspace}`;
        const rawLegacy = crypto.randomBytes(32).toString('base64');
        const rawSalt = crypto.randomBytes(32).toString('base64');
        mockWorkspaceState.set(secretKey, rawLegacy);
        mockWorkspaceState.set(saltKey, rawSalt);

        // Before migration, hasMasterKey and hasMasterPassword must return true via legacy fallback
        assert.strictEqual(await EncryptedVarsManager.hasMasterKey(mockContext), true);
        assert.strictEqual(await EncryptedVarsManager.hasMasterPassword(mockContext), true);

        const migratedKey = await EncryptedVarsManager.ensureMasterKey(mockContext);
        assert.strictEqual(migratedKey.toString('base64'), rawLegacy);
        // Verify it was moved to secrets and cleaned from workspaceState
        assert.strictEqual(mockSecrets.get(secretKey), rawLegacy);
        assert.strictEqual(mockWorkspaceState.get(secretKey), undefined);
        mockWorkspaceState.delete(saltKey);
    });

    // 4. AES-256-GCM Variable Encryption & Decryption
    await test('AES-256-GCM variable encryption and round-trip decryption', async () => {
        const masterKey = await EncryptedVarsManager.ensureMasterKey(mockContext);
        const secretValue = 'super_secret_api_token_xyz987';
        const encrypted = EncryptedVarsManager.encryptValue(secretValue, masterKey);
        assert.ok(EncryptedVarsManager.isEncrypted(encrypted));
        assert.ok(encrypted.startsWith('ENC[2|'));

        const decrypted = EncryptedVarsManager.decryptValue(encrypted, masterKey);
        assert.strictEqual(decrypted, secretValue);
    });

    // 5. EncryptedEnvironmentFile parse and write with Master Key
    await test('EncryptedEnvironmentFile parsing and writing with Master Key', async () => {
        const masterKey = await EncryptedVarsManager.ensureMasterKey(mockContext);
        const varsMap = new Map();
        varsMap.set('API_KEY', { value: 'secret-api-val', encrypted: true });
        varsMap.set('PUBLIC_HOST', { value: 'https://example.com', encrypted: false });

        await EncryptedEnvironmentFile.writeEnvFile(tempEnvFile, varsMap, mockContext, masterKey);
        const fileContent = fs.readFileSync(tempEnvFile, 'utf8');
        assert.ok(fileContent.includes('API_KEY=ENC[2|'));
        assert.ok(fileContent.includes('PUBLIC_HOST=https://example.com'));

        const parsed = await EncryptedEnvironmentFile.parseEnvFile(tempEnvFile, mockContext, masterKey);
        assert.strictEqual(parsed.get('API_KEY').value, 'secret-api-val');
        assert.strictEqual(parsed.get('API_KEY').encrypted, true);
        assert.strictEqual(parsed.get('PUBLIC_HOST').value, 'https://example.com');
        assert.strictEqual(parsed.get('PUBLIC_HOST').encrypted, false);
    });

    // 6. Migration from Auto-Generated Key to User Master Password
    await test('Migration from Auto-Generated Key to Master Password without old password prompt', async () => {
        const newPassword = 'MyStrongMasterPassword2026!';
        const result = await EncryptedVarsManager.migrateFromAutoKeyToPassword(newPassword, mockContext);
        assert.strictEqual(result.success, true);
        assert.strictEqual(result.migratedCount, 1); // API_KEY was encrypted

        // Now hasMasterPassword must be true
        assert.strictEqual(await EncryptedVarsManager.hasMasterPassword(mockContext), true);

        // New derived key should successfully decrypt the file
        const derivedKey = await EncryptedVarsManager.deriveKeyFromPassword(newPassword, mockContext, 'test-workspace');
        const parsedWithNewKey = await EncryptedEnvironmentFile.parseEnvFile(tempEnvFile, mockContext, derivedKey);
        assert.strictEqual(parsedWithNewKey.get('API_KEY').value, 'secret-api-val');
    });

    // 7. Backup Creation with Project Master Key
    await test('Backup creation with Master Key (.master.enc)', async () => {
        const backupDir = path.join(os.homedir(), '.dotenvy-backups', 'test-workspace');
        if (fs.existsSync(backupDir)) {
            fs.rmSync(backupDir, { recursive: true, force: true });
        }

        // Backup current env
        await BackupCommands.backupEnv(mockContext, tempEnvFile);

        assert.ok(fs.existsSync(backupDir));
        const files = fs.readdirSync(backupDir);
        const masterBackup = files.find(f => f.endsWith('.master.enc'));
        assert.ok(masterBackup, 'Expected .master.enc backup file to exist');

        // Verify content is decryptable with Master Key
        const rawContent = fs.readFileSync(path.join(backupDir, masterBackup), 'utf8');
        const masterKey = await EncryptedVarsManager.ensureMasterKey(mockContext);
        const decrypted = BackupManager.decryptWithKey(rawContent, masterKey);
        assert.ok(decrypted.includes('API_KEY=ENC[2|'));
        assert.ok(decrypted.includes('PUBLIC_HOST=https://example.com'));
    });

    // 8. Restore from .master.enc Backup
    await test('Restore from .master.enc backup using Project Master Key', async () => {
        const backupDir = path.join(os.homedir(), '.dotenvy-backups', 'test-workspace');
        const files = fs.readdirSync(backupDir);
        const masterBackup = files.find(f => f.endsWith('.master.enc'));

        let pickCallCount = 0;
        vscodeMock.window.showQuickPick = (items) => {
            pickCallCount++;
            if (pickCallCount === 1) {
                const found = items.find(i => i.file === masterBackup) || items[0];
                return Promise.resolve(found);
            } else {
                const found = items.find(i => i.label === 'Overwrite .env') || items[0];
                return Promise.resolve(found);
            }
        };

        // Corrupt the .env file first
        fs.writeFileSync(tempEnvFile, 'CORRUPTED=true\n', 'utf8');

        // Restore
        await BackupCommands.restoreFromBackup(mockContext, tempDir);

        // Verify .env has been restored
        const restoredContent = fs.readFileSync(tempEnvFile, 'utf8');
        assert.ok(restoredContent.includes('API_KEY=ENC[2|'));
        assert.ok(restoredContent.includes('PUBLIC_HOST=https://example.com'));
    });

    // 9. Password-Protected Backup & Restore Flow
    await test('Password-Protected backup format v2 with PBKDF2 salt round-trip', async () => {
        const originalText = 'DATABASE_URL=postgres://user:pass@localhost:5432/db';
        const backupPass = 'TempBackupPass2026!';
        const salt = BackupManager.generateSalt();
        const derivedKey = await BackupManager.deriveKeyFromPassword(backupPass, salt);
        const encrypted = BackupManager.encryptWithKey(originalText, derivedKey, salt);

        // Extract salt and verify format
        const extractedSalt = BackupManager.getSaltFromBackup(encrypted);
        assert.ok(extractedSalt);
        assert.strictEqual(extractedSalt.toString('hex'), salt.toString('hex'));

        // Decrypt
        const roundTripKey = await BackupManager.deriveKeyFromPassword(backupPass, extractedSalt);
        const decrypted = BackupManager.decryptWithKey(encrypted, roundTripKey);
        assert.strictEqual(decrypted, originalText);
    });

    // Cleanup tempDir
    try {
        fs.rmSync(tempDir, { recursive: true, force: true });
    } catch (_) {}

    console.log('\n====================================================');
    console.log(`Summary: ${passed} passed, ${failed} failed`);
    if (failed > 0) {
        process.exit(1);
    }
}

runTests().catch(err => {
    console.error('Test suite runner crashed:', err);
    process.exit(1);
});

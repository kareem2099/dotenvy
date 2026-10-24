/**
 * Encryption, master-key lifecycle, and backup round-trips against compiled code.
 */

const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const { createHarness, installVscodeMock, useWorkspace } = require('./support/vscodeMock');
const { createTempDir, removeTempDir, listHomeBackupNames } = require('./support/tempWorkspace');

const harness = installVscodeMock(createHarness());
const { encryptValue, decryptValue, isEncrypted, isSupportedEncryptionFormat } = require('../out/utils/encryptionCipher.js');
const { EncryptedVarsManager, EncryptedEnvironmentFile } = require('../out/utils/encryptedVars.js');
const { BackupManager } = require('../out/utils/backupManager.js');
const { BackupCommands } = require('../out/commands/backupCommands.js');

const CIPHER = {
    formatVersion: 2,
    algorithm: 'aes-256-gcm',
    keyLength: 32,
    ivLength: 12,
};

let workspaceDir;
let backupDir;
let envFile;
let homeBackupsBefore;

describe('encryption and backup', { concurrency: 1 }, () => {
    before(() => {
        workspaceDir = createTempDir('dotenvy-enc-');
        backupDir = createTempDir('dotenvy-backup-path-');
        envFile = path.join(workspaceDir, '.env');
        fs.writeFileSync(envFile, 'API_KEY=initial-secret-value-12345\nDB_PASS=super-secure-db-password\n', 'utf8');
        useWorkspace(harness, workspaceDir, 'test-workspace');
        harness.configValues.backupPath = backupDir;
        homeBackupsBefore = listHomeBackupNames();
    });

    after(() => {
        assert.deepEqual(listHomeBackupNames(), homeBackupsBefore);
        removeTempDir(workspaceDir);
        removeTempDir(backupDir);
    });

    test('round-trips a v2 payload and still decrypts format v1', () => {
        const key = crypto.randomBytes(32);
        const plaintext = 'my-super-secret-api-key-2025';
        const encrypted = encryptValue(plaintext, key, CIPHER);

        assert.equal(decryptValue(encrypted, key, CIPHER), plaintext);
        assert.equal(isEncrypted(encrypted), true);
        assert.equal(isEncrypted('plain-text-value'), false);
        assert.equal(isSupportedEncryptionFormat(1, CIPHER.formatVersion), true);
        assert.equal(isSupportedEncryptionFormat(3, CIPHER.formatVersion), false);

        const legacyIv = crypto.randomBytes(12);
        const legacyCipher = crypto.createCipheriv('aes-256-gcm', key, legacyIv, { authTagLength: 16 });
        const legacyEncrypted = Buffer.concat([
            legacyCipher.update(Buffer.from('legacy-secret-value')),
            legacyCipher.final(),
        ]);
        const legacyTag = legacyCipher.getAuthTag();
        const legacyValue = `ENC[1|${legacyIv.toString('base64')}|${legacyTag.toString('base64')}|${legacyEncrypted.toString('base64')}]`;

        assert.equal(decryptValue(legacyValue, key, CIPHER), 'legacy-secret-value');
    });

    test('rejects a short key and a tampered authentication tag', () => {
        const key = crypto.randomBytes(32);
        assert.throws(
            () => encryptValue('test', crypto.randomBytes(16), CIPHER),
            /Invalid key length/,
        );

        const encrypted = encryptValue('sealed', key, CIPHER);
        const parts = encrypted.slice(4, -1).split('|');
        const tag = Buffer.from(parts[2], 'base64');
        tag[0] ^= 0xff;
        parts[2] = tag.toString('base64');
        const tampered = `ENC[${parts.join('|')}]`;

        assert.throws(
            () => decryptValue(tampered, key, CIPHER),
            /Decryption failed/,
        );
    });

    test('master key, password migration, and master-key backup stay inside backupPath', async () => {
        assert.equal(await EncryptedVarsManager.hasMasterKey(harness.context), false);
        const key = await EncryptedVarsManager.ensureMasterKey(harness.context);
        assert.equal(key.length, 32);
        assert.equal(await EncryptedVarsManager.hasMasterKey(harness.context), true);
        assert.equal(await EncryptedVarsManager.hasMasterPassword(harness.context), false);

        const keyAgain = await EncryptedVarsManager.ensureMasterKey(harness.context);
        assert.equal(keyAgain.toString('hex'), key.toString('hex'));

        harness.secrets._clear();
        const legacyWorkspace = 'test-workspace';
        const secretKey = `${EncryptedVarsManager.SECRET_STORAGE_KEY_PREFIX}${legacyWorkspace}`;
        const saltKey = `dotenvy.salt.${legacyWorkspace}`;
        const rawLegacy = crypto.randomBytes(32).toString('base64');
        const rawSalt = crypto.randomBytes(32).toString('base64');
        await harness.workspaceState.update(secretKey, rawLegacy);
        await harness.workspaceState.update(saltKey, rawSalt);

        assert.equal(await EncryptedVarsManager.hasMasterKey(harness.context), true);
        assert.equal(await EncryptedVarsManager.hasMasterPassword(harness.context), true);

        const migratedKey = await EncryptedVarsManager.ensureMasterKey(harness.context);
        assert.equal(migratedKey.toString('base64'), rawLegacy);
        assert.equal(await harness.secrets.get(secretKey), rawLegacy);
        assert.equal(harness.workspaceState.get(secretKey), undefined);
        await harness.workspaceState.update(saltKey, undefined);

        const secretValue = 'super_secret_api_token_xyz987';
        const encrypted = EncryptedVarsManager.encryptValue(secretValue, migratedKey);
        assert.equal(EncryptedVarsManager.isEncrypted(encrypted), true);
        assert.ok(encrypted.startsWith('ENC[2|'));
        assert.equal(EncryptedVarsManager.decryptValue(encrypted, migratedKey), secretValue);

        const varsMap = new Map();
        varsMap.set('API_KEY', { value: 'secret-api-val', encrypted: true });
        varsMap.set('PUBLIC_HOST', { value: 'https://example.com', encrypted: false });
        await EncryptedEnvironmentFile.writeEnvFile(envFile, varsMap, harness.context, migratedKey);

        const fileContent = fs.readFileSync(envFile, 'utf8');
        assert.ok(fileContent.includes('API_KEY=ENC[2|'));
        assert.ok(fileContent.includes('PUBLIC_HOST=https://example.com'));

        const parsed = await EncryptedEnvironmentFile.parseEnvFile(envFile, harness.context, migratedKey);
        assert.equal(parsed.get('API_KEY').value, 'secret-api-val');
        assert.equal(parsed.get('API_KEY').encrypted, true);
        assert.equal(parsed.get('PUBLIC_HOST').value, 'https://example.com');
        assert.equal(parsed.get('PUBLIC_HOST').encrypted, false);

        const newPassword = 'MyStrongMasterPassword2026!';
        const migration = await EncryptedVarsManager.migrateFromAutoKeyToPassword(newPassword, harness.context);
        assert.equal(migration.success, true);
        assert.equal(migration.migratedCount, 1);
        assert.equal(await EncryptedVarsManager.hasMasterPassword(harness.context), true);

        const derivedKey = await EncryptedVarsManager.deriveKeyFromPassword(
            newPassword,
            harness.context,
            'test-workspace',
        );
        const parsedWithPassword = await EncryptedEnvironmentFile.parseEnvFile(envFile, harness.context, derivedKey);
        assert.equal(parsedWithPassword.get('API_KEY').value, 'secret-api-val');

        await BackupCommands.backupEnv(harness.context, envFile);
        const backupFiles = fs.readdirSync(backupDir);
        const masterBackup = backupFiles.find((fileName) => fileName.endsWith('.master.enc'));
        assert.ok(masterBackup);
        const masterKey = await EncryptedVarsManager.ensureMasterKey(harness.context);
        const decryptedBackup = BackupManager.decryptWithKey(
            fs.readFileSync(path.join(backupDir, masterBackup), 'utf8'),
            masterKey,
        );
        assert.ok(decryptedBackup.includes('API_KEY=ENC[2|'));
        assert.ok(decryptedBackup.includes('PUBLIC_HOST=https://example.com'));

        let pickCallCount = 0;
        harness.vscode.window.showQuickPick = (items) => {
            pickCallCount += 1;
            if (pickCallCount === 1) {
                return Promise.resolve(items.find((item) => item.file === masterBackup) || items[0]);
            }
            return Promise.resolve(items.find((item) => item.label === 'Overwrite .env') || items[0]);
        };
        fs.writeFileSync(envFile, 'CORRUPTED=true\n', 'utf8');
        await BackupCommands.restoreFromBackup(harness.context, workspaceDir);
        const restored = fs.readFileSync(envFile, 'utf8');
        assert.ok(restored.includes('API_KEY=ENC[2|'));
        assert.ok(restored.includes('PUBLIC_HOST=https://example.com'));

        const originalText = 'DATABASE_URL=postgres://user:pass@localhost:5432/db';
        const backupPass = 'TempBackupPass2026!';
        const salt = BackupManager.generateSalt();
        const passwordKey = await BackupManager.deriveKeyFromPassword(backupPass, salt);
        const packaged = BackupManager.encryptWithKey(originalText, passwordKey, salt);
        const extractedSalt = BackupManager.getSaltFromBackup(packaged);
        assert.ok(extractedSalt);
        assert.equal(extractedSalt.toString('hex'), salt.toString('hex'));
        const roundTripKey = await BackupManager.deriveKeyFromPassword(backupPass, extractedSalt);
        assert.equal(BackupManager.decryptWithKey(packaged, roundTripKey), originalText);
    });
});

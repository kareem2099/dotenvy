/**
 * Cloud payload encryption stays inside the DOTENVY_ENCRYPTED envelope,
 * and logout drops the in-memory project key.
 */

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');

const { createHarness, installVscodeMock, useWorkspace } = require('./support/vscodeMock');
const { createTempDir, removeTempDir } = require('./support/tempWorkspace');

const harness = installVscodeMock(createHarness());
const { EncryptedCloudSyncManager } = require('../out/utils/encryptedCloudSyncManager.js');
const { decryptPayload, encryptPayload, unwrapDataKey } = require('../out/utils/cloudKeyEnvelope.js');
const { SessionManager } = require('../out/utils/sessionManager.js');
const { EncryptedVarsManager } = require('../out/utils/encryptedVars.js');
const {
    CLOUD_KEY_STORAGE,
    CLOUD_SYNC_ENCRYPTED_KEY,
    CLOUD_SYNC_KDF_ITERATIONS,
    CLOUD_SYNC_KEY_SALT,
    CLOUD_SYNC_VERSION_KEY,
    CLOUD_SYNC_WRAPPED_KEY,
} = require('../out/constants.js');

const PASSPHRASE = 'sync-passphrase-1';
const CACHE_KEY = 'dotenvy.cloud.envelope:demo:dev';

function fakeCloud() {
    const remote = { secrets: null };
    return {
        remote,
        pushed: null,
        pushCalls: 0,
        replaceCalls: 0,
        async pushSecrets(secrets) {
            this.pushCalls += 1;
            this.pushed = secrets;
            this.remote.secrets = { ...secrets };
            return { success: true };
        },
        async fetchSecrets() {
            return { success: true, secrets: this.remote.secrets };
        },
        async replaceSecrets(secrets) {
            this.replaceCalls += 1;
            this.pushed = secrets;
            this.remote.secrets = { ...secrets };
            return { success: true };
        },
        async testConnection() {
            return { success: true };
        },
    };
}

function managerFor(cloud) {
    return new EncryptedCloudSyncManager(
        { provider: 'doppler', project: 'demo', config: 'dev', token: 'token' },
        cloud,
        true,
    );
}

function queuePassphrases(values) {
    const queue = [...values];
    let calls = 0;
    harness.vscode.window.showInputBox = async () => {
        calls += 1;
        return queue.shift();
    };
    return () => calls;
}

async function resetLocalKey() {
    harness.secrets._clear();
    await harness.workspaceState.update(CLOUD_KEY_STORAGE, undefined);
}

function flipTag(payload) {
    const parts = payload.split('.');
    const tag = Buffer.from(parts[1], 'base64');
    tag[0] ^= 0xff;
    parts[1] = tag.toString('base64');
    return parts.join('.');
}

describe('cloud payload and session', { concurrency: 1 }, () => {
    test('push encrypts the payload and fetch decrypts it; a flipped tag is rejected', async () => {
        await resetLocalKey();
        const cloud = fakeCloud();
        const manager = managerFor(cloud);
        const secrets = { DB: 'postgres', API: 'secret-value' };
        const calls = queuePassphrases([PASSPHRASE, PASSPHRASE]);

        const pushed = await manager.pushSecrets(secrets, harness.context);
        assert.equal(pushed.success, true);
        assert.equal(calls(), 2);
        assert.equal(cloud.pushed[CLOUD_SYNC_VERSION_KEY], '3.0');
        assert.equal(cloud.pushed[CLOUD_SYNC_KDF_ITERATIONS], '310000');
        assert.equal(typeof cloud.pushed[CLOUD_SYNC_KEY_SALT], 'string');
        assert.equal(typeof cloud.pushed[CLOUD_SYNC_WRAPPED_KEY], 'string');
        const payload = cloud.pushed[CLOUD_SYNC_ENCRYPTED_KEY];
        assert.equal(payload.includes('postgres'), false);
        assert.equal(payload.includes('secret-value'), false);
        assert.equal(harness.workspaceState.get(CLOUD_KEY_STORAGE), undefined);
        assert.equal(typeof await harness.secrets.get(CACHE_KEY), 'string');

        const fetchCalls = queuePassphrases([]);
        const fetched = await manager.fetchSecrets(harness.context);
        assert.equal(fetched.success, true);
        assert.deepEqual(fetched.secrets, secrets);
        assert.equal(fetchCalls(), 0);

        const cacheBefore = await harness.secrets.get(CACHE_KEY);
        cloud.remote.secrets = {
            ...cloud.pushed,
            [CLOUD_SYNC_ENCRYPTED_KEY]: flipTag(payload),
        };
        const rejected = await manager.fetchSecrets(harness.context);
        assert.equal(rejected.success, false);
        assert.equal(fetchCalls(), 0);
        assert.equal(await harness.secrets.get(CACHE_KEY), cacheBefore);
        assert.equal(harness.workspaceState.get(CLOUD_KEY_STORAGE), undefined);
    });

    test('a second machine decrypts version 3 after the passphrase and stores a cache', async () => {
        await resetLocalKey();
        const cloud = fakeCloud();
        const origin = managerFor(cloud);
        queuePassphrases([PASSPHRASE, PASSPHRASE]);
        const secrets = { DB: 'postgres' };
        const pushed = await origin.pushSecrets(secrets, harness.context);
        assert.equal(pushed.success, true);

        await resetLocalKey();
        const calls = queuePassphrases([PASSPHRASE]);
        const fetched = await managerFor(cloud).fetchSecrets(harness.context);
        assert.equal(fetched.success, true);
        assert.deepEqual(fetched.secrets, secrets);
        assert.equal(calls(), 1);
        assert.equal(typeof await harness.secrets.get(CACHE_KEY), 'string');
    });

    test('fetch with no cache and no wrap does not write a key', async () => {
        await resetLocalKey();
        const cloud = fakeCloud();
        const payload = encryptPayload(JSON.stringify({ DB: 'postgres' }), crypto.randomBytes(32));
        cloud.remote.secrets = { [CLOUD_SYNC_ENCRYPTED_KEY]: payload };
        const calls = queuePassphrases([PASSPHRASE]);

        const fetched = await managerFor(cloud).fetchSecrets(harness.context);
        assert.equal(fetched.success, false);
        assert.equal(calls(), 0);
        assert.equal(cloud.pushCalls, 0);
        assert.equal(cloud.replaceCalls, 0);
        assert.equal(await harness.secrets.get(CACHE_KEY), undefined);
        assert.equal(harness.workspaceState.get(CLOUD_KEY_STORAGE), undefined);
    });

    test('a poisoned legacy key is replaced after the passphrase without rewriting the payload', async () => {
        await resetLocalKey();
        const cloud = fakeCloud();
        queuePassphrases([PASSPHRASE, PASSPHRASE]);
        const secrets = { DB: 'postgres' };
        const pushed = await managerFor(cloud).pushSecrets(secrets, harness.context);
        assert.equal(pushed.success, true);
        const payload = cloud.remote.secrets[CLOUD_SYNC_ENCRYPTED_KEY];

        await resetLocalKey();
        await harness.workspaceState.update(CLOUD_KEY_STORAGE, crypto.randomBytes(32).toString('base64'));
        cloud.pushCalls = 0;
        cloud.replaceCalls = 0;
        queuePassphrases([PASSPHRASE]);

        const fetched = await managerFor(cloud).fetchSecrets(harness.context);
        assert.equal(fetched.success, true);
        assert.deepEqual(fetched.secrets, secrets);
        assert.equal(cloud.pushCalls, 0);
        assert.equal(cloud.replaceCalls, 0);
        assert.equal(cloud.remote.secrets[CLOUD_SYNC_ENCRYPTED_KEY], payload);
        assert.equal(typeof await harness.secrets.get(CACHE_KEY), 'string');

        const secondFetchCalls = queuePassphrases([]);
        const again = await managerFor(cloud).fetchSecrets(harness.context);
        assert.equal(again.success, true);
        assert.equal(secondFetchCalls(), 0);
    });

    test('push and replace refuse an unreadable legacy payload before any provider write', async () => {
        await resetLocalKey();
        const cloud = fakeCloud();
        const payload = encryptPayload(JSON.stringify({ DB: 'postgres' }), crypto.randomBytes(32));
        cloud.remote.secrets = { [CLOUD_SYNC_ENCRYPTED_KEY]: payload };
        const calls = queuePassphrases([PASSPHRASE, PASSPHRASE]);
        const manager = managerFor(cloud);

        const pushed = await manager.pushSecrets({ DB: 'other' }, harness.context);
        const replaced = await manager.replaceSecrets({ DB: 'other' }, harness.context);

        assert.equal(pushed.success, false);
        assert.equal(replaced.success, false);
        assert.equal(cloud.pushCalls, 0);
        assert.equal(cloud.replaceCalls, 0);
        assert.equal(calls(), 0);
        assert.equal(cloud.remote.secrets[CLOUD_SYNC_ENCRYPTED_KEY], payload);
        assert.equal(await harness.secrets.get(CACHE_KEY), undefined);
        assert.equal(harness.workspaceState.get(CLOUD_KEY_STORAGE), undefined);
    });

    test('a legacy local key is wrapped in place and not rotated', async () => {
        await resetLocalKey();
        const dataKey = crypto.randomBytes(32);
        const payload = encryptPayload(JSON.stringify({ DB: 'old' }), dataKey);
        const cloud = fakeCloud();
        cloud.remote.secrets = { [CLOUD_SYNC_ENCRYPTED_KEY]: payload };
        await harness.workspaceState.update(CLOUD_KEY_STORAGE, dataKey.toString('base64'));
        const calls = queuePassphrases([PASSPHRASE, PASSPHRASE]);

        const pushed = await managerFor(cloud).pushSecrets({ DB: 'new' }, harness.context);

        assert.equal(pushed.success, true);
        assert.equal(calls(), 2);
        assert.equal(cloud.pushCalls, 1);
        assert.equal(cloud.pushed[CLOUD_SYNC_VERSION_KEY], '3.0');
        const unwrapped = unwrapDataKey(
            cloud.pushed[CLOUD_SYNC_WRAPPED_KEY],
            cloud.pushed[CLOUD_SYNC_KEY_SALT],
            cloud.pushed[CLOUD_SYNC_KDF_ITERATIONS],
            PASSPHRASE,
        );
        assert.equal(unwrapped.equals(dataKey), true);
        assert.deepEqual(
            JSON.parse(decryptPayload(cloud.pushed[CLOUD_SYNC_ENCRYPTED_KEY], dataKey)),
            { DB: 'new' },
        );
        assert.equal(harness.workspaceState.get(CLOUD_KEY_STORAGE), dataKey.toString('base64'));
    });

    test('a new cloud data key does not erase a different legacy workspace key', async () => {
        await resetLocalKey();
        const legacy = crypto.randomBytes(32);
        await harness.workspaceState.update(CLOUD_KEY_STORAGE, legacy.toString('base64'));
        const cloud = fakeCloud();
        queuePassphrases([PASSPHRASE, PASSPHRASE]);

        const pushed = await managerFor(cloud).pushSecrets({ DB: 'new' }, harness.context);

        assert.equal(pushed.success, true);
        assert.equal(harness.workspaceState.get(CLOUD_KEY_STORAGE), legacy.toString('base64'));
        const unwrapped = unwrapDataKey(
            cloud.pushed[CLOUD_SYNC_WRAPPED_KEY],
            cloud.pushed[CLOUD_SYNC_KEY_SALT],
            cloud.pushed[CLOUD_SYNC_KDF_ITERATIONS],
            PASSPHRASE,
        );
        assert.equal(unwrapped.equals(legacy), false);
    });

    test('logout clears the project key so later decryption does not reuse it', async () => {
        const root = createTempDir('dotenvy-session-');
        try {
            useWorkspace(harness, root, 'session-workspace');
            const session = SessionManager.getInstance();
            session.logout();

            const projectKey = Buffer.alloc(32, 7);
            session.setSession('ada', projectKey);
            assert.equal(session.isLoggedIn(), true);
            assert.equal(session.getCurrentUser(), 'ada');

            const whileLoggedIn = await EncryptedVarsManager.ensureMasterKey(harness.context);
            assert.equal(whileLoggedIn.equals(projectKey), true);

            session.logout();
            assert.equal(session.isLoggedIn(), false);
            assert.equal(session.getCurrentUser(), null);
            assert.equal(session.getProjectKey(), null);

            const afterLogout = await EncryptedVarsManager.ensureMasterKey(harness.context);
            assert.equal(afterLogout.equals(projectKey), false);
        } finally {
            SessionManager.getInstance().logout();
            removeTempDir(root);
        }
    });
});

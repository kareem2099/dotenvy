/**
 * Cloud payload encryption stays inside the DOTENVY_ENCRYPTED envelope,
 * and logout drops the in-memory project key.
 */

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');

const { createHarness, installVscodeMock, useWorkspace } = require('./support/vscodeMock');
const { createTempDir, removeTempDir } = require('./support/tempWorkspace');

const harness = installVscodeMock(createHarness());
const { EncryptedCloudSyncManager } = require('../out/utils/encryptedCloudSyncManager.js');
const { SessionManager } = require('../out/utils/sessionManager.js');
const { EncryptedVarsManager } = require('../out/utils/encryptedVars.js');
const { CLOUD_SYNC_ENCRYPTED_KEY } = require('../out/constants.js');

function fakeCloud() {
    const remote = { secrets: null };
    return {
        remote,
        pushed: null,
        async pushSecrets(secrets) {
            this.pushed = secrets;
            return { success: true };
        },
        async fetchSecrets() {
            return { success: true, secrets: remote.secrets };
        },
        async replaceSecrets() {
            return { success: true };
        },
        async testConnection() {
            return { success: true };
        },
    };
}

describe('cloud payload and session', { concurrency: 1 }, () => {
    test('push encrypts the payload and fetch decrypts it; a flipped tag is rejected', async () => {
        const cloud = fakeCloud();
        const manager = new EncryptedCloudSyncManager(
            { provider: 'doppler', project: 'demo', config: 'dev', token: 'token' },
            cloud,
            true,
        );
        const secrets = { DB: 'postgres', API: 'secret-value' };

        const pushed = await manager.pushSecrets(secrets, harness.context);
        assert.equal(pushed.success, true);
        const payload = cloud.pushed[CLOUD_SYNC_ENCRYPTED_KEY];
        assert.equal(typeof payload, 'string');
        assert.equal(payload.includes('postgres'), false);
        assert.equal(payload.includes('secret-value'), false);

        cloud.remote.secrets = { [CLOUD_SYNC_ENCRYPTED_KEY]: payload };
        const fetched = await manager.fetchSecrets(harness.context);
        assert.equal(fetched.success, true);
        assert.deepEqual(fetched.secrets, secrets);

        const parts = payload.split('.');
        const tag = Buffer.from(parts[1], 'base64');
        tag[0] ^= 0xff;
        parts[1] = tag.toString('base64');
        cloud.remote.secrets = { [CLOUD_SYNC_ENCRYPTED_KEY]: parts.join('.') };
        const rejected = await manager.fetchSecrets(harness.context);
        assert.equal(rejected.success, false);
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

/**
 * Multi-user project envelope. Password length is enforced by command handlers, not here.
 */

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { createHarness, installVscodeMock, useWorkspace } = require('./support/vscodeMock');
const { createTempDir, removeTempDir } = require('./support/tempWorkspace');

const harness = installVscodeMock(createHarness());
const { UserManager } = require('../out/utils/userManager.js');

const ADMIN = { username: 'ada', password: 'admin-pass-1' };
const DEVELOPER = { username: 'grace', password: 'developer-pass' };

describe('user manager', { concurrency: 1 }, () => {
    test('addUser fails when the project has no envelope', async () => {
        const root = createTempDir('dotenvy-users-empty-');
        try {
            useWorkspace(harness, root);
            const added = await UserManager.addUser(ADMIN, DEVELOPER);
            assert.equal(added.success, false);
        } finally {
            removeTempDir(root);
        }
    });

    test('a corrupt envelope file loads as null', async () => {
        const root = createTempDir('dotenvy-users-corrupt-');
        try {
            useWorkspace(harness, root);
            fs.writeFileSync(path.join(root, '.dotenvy.lock.json'), '{', 'utf8');
            assert.equal(await UserManager.loadEnvelope(), null);
        } finally {
            removeTempDir(root);
        }
    });

    test('init, login, duplicate user, and last-admin revoke', async () => {
        const root = createTempDir('dotenvy-users-');
        try {
            useWorkspace(harness, root);

            const created = await UserManager.initializeSecureProject(ADMIN, 'demo');
            assert.equal(created.success, true);
            assert.equal(fs.existsSync(path.join(root, '.dotenvy.lock.json')), true);

            const second = await UserManager.initializeSecureProject(ADMIN, 'demo');
            assert.equal(second.success, false);

            const wrongPassword = await UserManager.accessProjectKey({
                username: ADMIN.username,
                password: 'not-the-password',
            });
            assert.equal(wrongPassword.success, false);
            assert.equal(wrongPassword.message, 'Invalid password');

            const missingUser = await UserManager.accessProjectKey({
                username: 'nobody',
                password: ADMIN.password,
            });
            assert.equal(missingUser.success, false);

            const opened = await UserManager.accessProjectKey(ADMIN);
            assert.equal(opened.success, true);
            assert.ok(Buffer.isBuffer(opened.projectKey));

            const duplicate = await UserManager.addUser(ADMIN, ADMIN);
            assert.equal(duplicate.success, false);

            const added = await UserManager.addUser(ADMIN, DEVELOPER);
            assert.equal(added.success, true);

            const revokeAdmin = await UserManager.revokeUser(ADMIN, ADMIN.username);
            assert.equal(revokeAdmin.success, false);
            assert.equal(revokeAdmin.message, 'Cannot revoke the last admin user');

            const revoked = await UserManager.revokeUser(ADMIN, DEVELOPER.username);
            assert.equal(revoked.success, true);

            const developerLogin = await UserManager.accessProjectKey(DEVELOPER);
            assert.equal(developerLogin.success, false);
        } finally {
            removeTempDir(root);
        }
    });
});

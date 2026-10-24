/**
 * Password length is enforced by the command prompts, not by UserManager.
 * Seven characters is rejected. Eight is accepted.
 */

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');

const { createHarness, installVscodeMock, useWorkspace } = require('./support/vscodeMock');
const { createTempDir, removeTempDir } = require('./support/tempWorkspace');

const harness = installVscodeMock(createHarness());
const { UserManager } = require('../out/utils/userManager.js');
const { InitSecureProjectCommand } = require('../out/commands/initSecureProject.js');
const { AddUserCommand } = require('../out/commands/addUser.js');
const { SetMasterPasswordCommand } = require('../out/commands/setMasterPassword.js');

const TOO_SHORT = '1234567';
const ACCEPTED = '12345678';

function assertPasswordBoundary(validateInput) {
    assert.equal(typeof validateInput(TOO_SHORT), 'string');
    assert.equal(validateInput(ACCEPTED), null);
    assert.equal(typeof validateInput(''), 'string');
}

function capturePrompts(replies) {
    const passwordValidators = [];
    let index = 0;
    harness.vscode.window.showInputBox = (options) => {
        if (options && options.password && typeof options.validateInput === 'function') {
            passwordValidators.push(options.validateInput);
        }
        const reply = replies[index];
        index += 1;
        return Promise.resolve(reply);
    };
    return passwordValidators;
}

describe('command password length', { concurrency: 1 }, () => {
    test('init rejects a 7-character admin password and accepts 8', async () => {
        const root = createTempDir('dotenvy-init-pw-');
        try {
            useWorkspace(harness, root, 'init-pw');
            const validators = capturePrompts(['Demo', 'ada', undefined]);
            await new InitSecureProjectCommand().execute();
            assert.equal(validators.length, 1);
            assertPasswordBoundary(validators[0]);
        } finally {
            removeTempDir(root);
        }
    });

    test('add user rejects a 7-character password on both password prompts', async () => {
        const root = createTempDir('dotenvy-add-pw-');
        try {
            useWorkspace(harness, root, 'add-pw');
            const created = await UserManager.initializeSecureProject(
                { username: 'ada', password: 'admin-pass-1' },
                'demo',
            );
            assert.equal(created.success, true);

            const validators = capturePrompts(['ada', 'admin-pass-1', 'bob', undefined]);
            await new AddUserCommand().execute();
            assert.equal(validators.length, 2);
            assertPasswordBoundary(validators[0]);
            assertPasswordBoundary(validators[1]);
        } finally {
            removeTempDir(root);
        }
    });

    test('set master password rejects a 7-character password and accepts 8', async () => {
        const root = createTempDir('dotenvy-master-pw-');
        try {
            useWorkspace(harness, root, 'master-pw');
            const validators = capturePrompts([undefined]);
            await new SetMasterPasswordCommand(harness.context).execute();
            assert.equal(validators.length, 1);
            assertPasswordBoundary(validators[0]);
        } finally {
            removeTempDir(root);
        }
    });
});

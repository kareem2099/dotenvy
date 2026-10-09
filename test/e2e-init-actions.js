/** Setup clicks -> actual receivers -> registered commands -> temporary workspace files. */
const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const Module = require('module');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dotenvy-init-'));
const folder = { name: 'Synthetic project', uri: { fsPath: root } };
const commands = new Map(), notices = [], opened = [], prompts = [], panelNotices = [];
let inputs = [], warningAnswer, failOpen = false, commandFailure = false;
const context = { subscriptions: [], workspaceState: { get: (_k, fallback) => fallback, update: async () => {} } };
const mock = {
    EventEmitter: class { event = () => ({ dispose() {} }); fire() {} },
    ProgressLocation: { Notification: 15 }, ViewColumn: { Beside: 2 },
    Uri: { file: fsPath => ({ fsPath }), joinPath: (uri, ...parts) => ({ fsPath: path.join(uri.fsPath, ...parts) }) },
    workspace: {
        workspaceFolders: [folder], getConfiguration: () => ({ get: (_k, fallback) => fallback }),
        openTextDocument: async uri => {
            // Make the asynchronous command result observable to its caller.
            await new Promise(resolve => setImmediate(resolve));
            if (failOpen) throw new Error('Synthetic editor failure');
            return { uri, getText: () => fs.readFileSync(uri.fsPath, 'utf8') };
        },
        fs: { delete: async uri => fs.promises.unlink(uri.fsPath) }
    },
    window: {
        createOutputChannel: () => ({ appendLine() {}, show() {}, clear() {} }),
        showInformationMessage: async message => { notices.push({ type: 'info', message }); },
        showErrorMessage: async message => { notices.push({ type: 'error', message }); },
        showWarningMessage: async () => warningAnswer,
        showInputBox: async options => { prompts.push(options); return inputs.shift(); },
        showTextDocument: async doc => { opened.push(doc.uri.fsPath); },
        withProgress: async (_options, callback) => callback({ report() {} })
    },
    commands: {
        registerCommand: (name, callback) => { commands.set(name, callback); return { dispose: () => commands.delete(name) }; },
        executeCommand: async name => {
            if (commandFailure) throw new Error('Synthetic dispatch failure');
            assert.ok(commands.has(name), `Registered command ${name}`);
            return commands.get(name)();
        }
    }
};
const originalRequire = Module.prototype.require;
Module.prototype.require = function (name) {
    if (name === 'vscode') return mock;
    if (name === '../extension') return { extensionContext: context, extensionUri: { fsPath: path.resolve(__dirname, '..') } };
    return originalRequire.apply(this, arguments);
};
const { EnvironmentWebviewProvider } = require('../out/providers/environmentWebviewProvider');
const { OpenEnvironmentPanelCommand } = require('../out/commands/openEnvironmentPanel');
const { InitDotenvyIgnoreCommand } = require('../out/commands/initDotenvyIgnore');
const { InitSecureProjectCommand } = require('../out/commands/initSecureProject');
const { DotenvyIgnore } = require('../out/utils/dotenvyIgnore');
const { UserManager } = require('../out/utils/userManager');
const { registerPanelNotifier } = require('../out/utils/panelNotification');
const { t } = require('../out/i18n');
const ignoreCommand = new InitDotenvyIgnoreCommand();
commands.set('dotenvy.initSecureProject', () => new InitSecureProjectCommand().execute());
const notifier = registerPanelNotifier(message => panelNotices.push(message));

// Execute the actual frontend functions exposed to onclick handlers.
let frontendMessage;
const sandbox = { window: { addEventListener() {} }, document: { addEventListener() {} },
    acquireVsCodeApi: () => ({ postMessage: message => { frontendMessage = message; } }) };
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname, '../resources/panel/panel.js'), 'utf8'), sandbox);

async function main() {
    try {
        for (const Provider of [EnvironmentWebviewProvider, OpenEnvironmentPanelCommand]) {
            const receiver = Object.create(Provider.prototype);
            receiver.environmentProvider = { rootPath: root };
            let refreshes = 0;
            receiver.refreshEnvironments = async () => { refreshes++; };
            const ignorePath = path.join(root, '.dotenvyignore');
            fs.rmSync(ignorePath, { force: true });
            sandbox.window.initDotenvyIgnore();
            await receiver.handleMessage(frontendMessage);
            assert.equal(fs.readFileSync(ignorePath, 'utf8'), DotenvyIgnore.DEFAULT_CONTENT, 'Click creates ignore file');
            assert.equal(opened.at(-1), ignorePath, 'Awaiting dispatch waits for editor opening');
            fs.writeFileSync(ignorePath, 'custom-pattern/**\n');
            await receiver.handleMessage(frontendMessage);
            assert.equal(fs.readFileSync(ignorePath, 'utf8'), 'custom-pattern/**\n', 'Existing patterns preserved');
            assert.equal(notices.at(-1).message, t('initIgnore.alreadyExists'));

            fs.rmSync(path.join(root, '.dotenvy.lock.json'), { force: true });
            inputs = ['Synthetic project', 'admin', 'Synthetic-Test-Password-123!', 'Synthetic-Test-Password-123!'];
            sandbox.window.initSecureProject();
            await receiver.handleMessage(frontendMessage);
            assert.equal(refreshes, 1, 'Setup refreshes the dashboard after completion');
            assert.equal(opened.at(-1), path.join(root, '.dotenvy.json'));
            assert.ok(fs.existsSync(path.join(root, '.dotenvy.json')));
            const envelope = await UserManager.loadEnvelope();
            assert.equal(envelope.users[0].username, 'admin');
            assert.equal(envelope.metadata.projectName, 'Synthetic project');
            const access = await UserManager.accessProjectKey({ username: 'admin', password: 'Synthetic-Test-Password-123!' });
            assert.equal(access.success, true, 'Generated wrapped key can be unlocked');
        }

        const envelopePath = path.join(root, '.dotenvy.lock.json');
        const originalEnvelope = fs.readFileSync(envelopePath, 'utf8');
        warningAnswer = t('initSecure.reinitConfirm');
        for (let cancelAt = 0; cancelAt < 4; cancelAt++) {
            inputs = ['Synthetic project', 'admin', 'Synthetic-Test-Password-123!', 'Synthetic-Test-Password-123!'].slice(0, cancelAt);
            await mock.commands.executeCommand('dotenvy.initSecureProject');
            assert.equal(fs.readFileSync(envelopePath, 'utf8'), originalEnvelope, 'Cancelling preserves existing keys');
            assert.equal(notices.at(-1).message, t('initSecure.cancelled'));
        }
        warningAnswer = undefined;
        const promptCount = prompts.length;
        await mock.commands.executeCommand('dotenvy.initSecureProject');
        assert.equal(prompts.length, promptCount, 'Declining reinitialization stops before input prompts');

        for (const folders of [undefined, []]) {
            mock.workspace.workspaceFolders = folders;
            for (const name of ['dotenvy.initSecureProject', 'dotenvy.initDotenvyIgnore']) {
                await mock.commands.executeCommand(name);
                assert.deepEqual(notices.at(-1), { type: 'error', message: t('common.noWorkspace') });
            }
        }
        mock.workspace.workspaceFolders = [folder];
        failOpen = true;
        await mock.commands.executeCommand('dotenvy.initDotenvyIgnore');
        assert.equal(notices.at(-1).type, 'error');
        assert.ok(notices.at(-1).message.includes('Synthetic editor failure'));
        failOpen = false;
        const createDefault = DotenvyIgnore.createDefault;
        DotenvyIgnore.createDefault = () => { throw new Error('Synthetic permission denied'); };
        await mock.commands.executeCommand('dotenvy.initDotenvyIgnore');
        assert.ok(notices.at(-1).message.includes('Synthetic permission denied'));
        DotenvyIgnore.createDefault = createDefault;

        commandFailure = true;
        const receiver = Object.create(EnvironmentWebviewProvider.prototype);
        receiver.environmentProvider = { rootPath: root };
        for (const action of ['initSecureProject', 'initDotenvyIgnore']) {
            await receiver.handleMessage({ type: action });
            assert.equal(notices.at(-1).type, 'error');
            assert.ok(notices.at(-1).message.includes('Synthetic dispatch failure'));
            assert.equal(panelNotices.at(-1).notificationType, 'error');
        }
        console.log('PASS: setup clicks, real files/key unlock, existing files, cancellation and visible errors');
    } finally {
        notifier.dispose(); ignoreCommand.dispose();
        fs.rmSync(root, { recursive: true, force: true });
    }
}
main().then(() => process.exit(0), error => { console.error(error); process.exit(1); });

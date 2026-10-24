/** Actual Doppler requests, secure token recovery and both dashboard receivers, with no live network. */
const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const Module = require('module');
const { EventEmitter } = require('events');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dotenvy-doppler-'));
const tokens = new Map(), state = new Map(), requests = [], urls = [], prompts = [];
const savedEnv = process.env.DOPPLER_TOKEN;
delete process.env.DOPPLER_TOKEN;
const config = { cloudSync: { provider: 'doppler', project: 'synthetic-project', config: 'dev', encryptCloudSync: false } };
fs.writeFileSync(path.join(root, '.dotenvy.json'), JSON.stringify(config));
let status = 200, errorChoice, input, frontendMessage;
const tokenKey = 'dotenvy:doppler:synthetic-project:token';
const context = { workspaceState: { get: (key, fallback) => state.get(key) ?? fallback, update: async (key, value) => state.set(key, value) },
    secrets: { get: async key => tokens.get(key), store: async (key, value) => tokens.set(key, value) } };
const httpsMock = { request: (options, callback) => {
    assert.equal(options.hostname, 'api.doppler.com');
    assert.ok(!options.path.includes('/secrets/'), 'Connection checks and dashboard refresh do not download secret values');
    requests.push(options);
    const req = new EventEmitter(); req.write = () => { throw new Error('No cloud writes in this test'); };
    req.end = () => queueMicrotask(() => {
        const res = new EventEmitter(); res.statusCode = status; callback(res);
        res.emit('data', status === 200 ? '{}' : JSON.stringify({ errors: ['Synthetic error ' + options.headers.Authorization] }));
        res.emit('end');
    });
    return req;
} };
const mock = {
    EventEmitter: class { event = () => ({ dispose() {} }); fire() {} },
    ProgressLocation: { Notification: 15 },
    Uri: { parse: url => ({ toString: () => url }), file: fsPath => ({ fsPath }) },
    workspace: { workspaceFolders: [{ uri: { fsPath: root } }], getConfiguration: () => ({ get: (_key, fallback) => fallback }) },
    env: { openExternal: async uri => { urls.push(uri.toString()); return true; } },
    window: { createOutputChannel: () => ({ appendLine() {}, show() {}, clear() {} }),
        showErrorMessage: async (_message, ...buttons) => buttons.includes(errorChoice) ? errorChoice : undefined,
        showInformationMessage: async () => {},
        showInputBox: async options => { prompts.push(options); return input; },
        withProgress: async (_options, task) => task({ report() {} }) }
};
const originalRequire = Module.prototype.require;
Module.prototype.require = function (name) {
    if (name === 'vscode') return mock;
    if (name === 'https') return httpsMock;
    if (name === '../extension') return { extensionContext: context };
    return originalRequire.apply(this, arguments);
};
const { DopplerSyncManager } = require('../out/utils/dopplerSyncManager');
const { ConfigUtils } = require('../out/utils/configUtils');
const { EnvironmentWebviewProvider } = require('../out/providers/environmentWebviewProvider');
const { OpenEnvironmentPanelCommand } = require('../out/commands/openEnvironmentPanel');
const { WorkspaceManager } = require('../out/providers/workspaceManager');
const { PullFromCloudCommand } = require('../out/commands/pullFromCloud');
const { PushToCloudCommand } = require('../out/commands/pushToCloud');
const { t } = require('../out/i18n');
const elements = Object.fromEntries(['cloud-status', 'last-sync', 'cloud-error'].map(id => [id, {}]));
const sandbox = { window: { addEventListener() {} }, document: { addEventListener() {}, getElementById: id => elements[id] },
    acquireVsCodeApi: () => ({ postMessage: message => { frontendMessage = message; } }) };
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname, '../resources/panel/panel.js'), 'utf8'), sandbox);
async function main() {
    try {
        // Explicit override > project-scoped storage > environment > legacy JSON.
        process.env.DOPPLER_TOKEN = '  synthetic-env-token  ';
        tokens.set(tokenKey, '  synthetic-stored-token  ');
        const legacy = { ...config.cloudSync, token: ' synthetic-legacy-token ' };
        assert.equal(await new DopplerSyncManager(legacy, ' synthetic-explicit-token ').getToken(), 'synthetic-explicit-token');
        assert.equal(await new DopplerSyncManager(legacy).getToken(), 'synthetic-stored-token');
        tokens.delete(tokenKey);
        assert.equal(await new DopplerSyncManager(legacy).getToken(), 'synthetic-env-token');
        delete process.env.DOPPLER_TOKEN;
        assert.equal(await new DopplerSyncManager(legacy).getToken(), 'synthetic-legacy-token');
        tokens.set(tokenKey, 'synthetic-stored-token');
        for (const code of [200, 401, 403]) {
            status = code; const before = requests.length;
            const result = await new DopplerSyncManager(config.cloudSync).testConnection();
            assert.equal(result.success, code === 200);
            assert.equal(requests.length - before, 1, 'Do not retry aliases on authentication/permission failures');
            assert.equal(requests.at(-1).headers.Authorization, 'Bearer synthetic-stored-token');
            if (code !== 200) {
                assert.ok(result.error.includes(String(code)));
                assert.equal(result.error.includes('synthetic-stored-token'), false, 'Do not echo an auth token from a rejected response');
            }
        }
        for (const Provider of [EnvironmentWebviewProvider, OpenEnvironmentPanelCommand]) {
            const receiver = Object.create(Provider.prototype);
            receiver.environmentProvider = { rootPath: root };
            for (const code of [200, 401, 403]) {
                status = code;
                const card = await receiver.getCloudSyncStatus(root, config);
                assert.equal(typeof card.connected, 'boolean');
                assert.equal(card.connected, code === 200, 'A failed result object is not a connected state');
                vm.runInContext(`updateCloudCard(${JSON.stringify({ cloudSync: card })})`, sandbox);
                assert.equal(elements['cloud-status'].className.includes('status-connected'), code === 200);
                assert.equal(elements['cloud-error'].hidden, code === 200);
                if (code !== 200) assert.ok(elements['cloud-error'].textContent.includes(String(code)));
            }
            sandbox.window.openDopplerDashboard();
            const before = requests.length;
            await receiver.handleMessage(frontendMessage);
            assert.equal(urls.at(-1), 'https://dashboard.doppler.com/workplace/projects/synthetic-project/configs/dev');
            assert.equal(requests.length, before, 'Opening the browser dashboard does not make an API request');
            for (const project of ['your-project-name', ' Your_Project_Name ', '']) {
                fs.writeFileSync(path.join(root, '.dotenvy.json'), JSON.stringify({
                    cloudSync: { ...config.cloudSync, project }
                }));
                sandbox.window.openDopplerDashboard();
                await receiver.handleMessage(frontendMessage);
                assert.equal(urls.at(-1), 'https://dashboard.doppler.com', 'A template/missing project opens the dashboard home');
                assert.equal(requests.length, before, 'Opening the dashboard does not authenticate or sync');
                assert.equal(JSON.parse(fs.readFileSync(path.join(root, '.dotenvy.json'))).cloudSync.project, project,
                    'Opening the dashboard preserves workspace settings');
            }
            fs.writeFileSync(path.join(root, '.dotenvy.json'), JSON.stringify(config));
        }
        assert.equal(DopplerSyncManager.getDashboardUrl('synthetic-project'),
            'https://dashboard.doppler.com/workplace/projects/synthetic-project');
        assert.equal(DopplerSyncManager.getDashboardUrl(undefined, 'dev'), 'https://dashboard.doppler.com');
        vm.runInContext('updateCloudCard({cloudSync:{connected:{success:false}}})', sandbox);
        assert.equal(elements['cloud-status'].className.includes('status-connected'), false, 'Old cached result objects must not appear connected');

        fs.writeFileSync(path.join(root, '.dotenvy.json'), JSON.stringify({ cloudSync: legacy }));
        errorChoice = t('doppler.setToken'); input = undefined;
        const before = tokens.get(tokenKey);
        assert.equal(await DopplerSyncManager.handleConnectionFailure(root, config.cloudSync, 'HTTP 401'), null);
        assert.equal(tokens.get(tokenKey), before, 'Cancelling token replacement preserves credentials');
        assert.equal(JSON.parse(fs.readFileSync(path.join(root, '.dotenvy.json'))).cloudSync.token, legacy.token);
        assert.equal(prompts.at(-1).password, true);
        input = '  synthetic-replacement-token  ';
        const recovered = await DopplerSyncManager.handleConnectionFailure(root, config.cloudSync, 'HTTP 401');
        assert.equal(tokens.get(tokenKey), 'synthetic-replacement-token');
        assert.equal('token' in recovered, false);
        assert.equal('token' in JSON.parse(fs.readFileSync(path.join(root, '.dotenvy.json'))).cloudSync, false);
        assert.equal(fs.readFileSync(path.join(root, '.dotenvy.json'), 'utf8').includes(input.trim()), false);
        process.env.DOPPLER_TOKEN = 'stale-environment-token';
        status = 200;
        assert.equal((await new DopplerSyncManager(recovered).testConnection()).success, true);
        assert.equal(requests.at(-1).headers.Authorization, 'Bearer synthetic-replacement-token');

        // Pull/Push must reach authentication even with no token property in JSON.
        WorkspaceManager.resolveWorkspacePath = async () => root;
        WorkspaceManager.getInstance = () => ({ getWorkspace: () => undefined });
        ConfigUtils.ensureWorkspaceConfigFile = async () => { throw new Error('Existing config does not require a JSON token'); };
        status = 401; errorChoice = undefined;
        for (const Command of [PullFromCloudCommand, PushToCloudCommand]) {
            const count = requests.length;
            await new Command().execute(root);
            assert.equal(requests.length, count + 1, 'Authenticate using the stored token before requesting config edits');
        }
        console.log('PASS: both Doppler buttons, boolean status, HTTP 401/403, token precedence/recovery and token-less JSON Pull/Push');
    } finally {
        if (savedEnv === undefined) delete process.env.DOPPLER_TOKEN; else process.env.DOPPLER_TOKEN = savedEnv;
        fs.rmSync(root, { recursive: true, force: true });
    }
}
main().then(() => process.exit(0), error => { console.error(error); process.exit(1); });

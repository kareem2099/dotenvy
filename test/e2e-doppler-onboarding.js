/** Real transport, device authorization, provisioning, persistence and both UI receivers. No live network. */
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const vm = require('vm');
const Module = require('module');
const { EventEmitter } = require('events');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dotenvy-onboarding-'));
const root = path.join(directory, 'my-app'); fs.mkdirSync(root);
const file = path.join(root, '.dotenvy.json');
const envFile = path.join(root, '.env'); fs.writeFileSync(envFile, 'UNCHANGED=synthetic-fixture\n');
const secrets = new Map(), requests = [], notifications = [], urls = [], state = new Map(), logs = [];
const account = 'synthetic-account-credential', service = 'synthetic-service-credential';
let options, cancellation, clipboard, progressMessages;
class CancellationError extends Error {}
function newCancellation() {
    const emitter = new EventEmitter();
    return { isCancellationRequested: false,
        onCancellationRequested(fn) { emitter.on('cancel', fn); return { dispose() { emitter.off('cancel', fn); } }; },
        cancel() { this.isCancellationRequested = true; emitter.emit('cancel'); } };
}
function responseFor(request) {
    const url = new URL('https://api.doppler.com' + request.path), endpoint = url.pathname;
    if (options.cancelAt === endpoint) cancellation.cancel();
    if (options.failure === endpoint) return [options.status || 403, { messages: [options.errorMessage || 'provider-response-private-fixture', account, service] }];
    if (endpoint.endsWith('/generate/2')) {
        assert.equal(url.searchParams.get('hostname'), 'DotEnvy');
        assert.equal(url.searchParams.get('version'), 'v3.77.0');
        return [200, { code: 'synthetic-code', polling_code: 'synthetic-private-poll-code',
            auth_url: options.badUrl || 'https://dashboard.doppler.com/workplace/auth/cli' }];
    }
    if (endpoint.endsWith('/authorize')) {
        assert.deepEqual(request.body, { code: 'synthetic-private-poll-code' });
        if (options.pending) { options.pending = false; return [409, { messages: ['Pending'] }]; }
        if (options.cancelAfterAuth) queueMicrotask(() => cancellation.cancel());
        if (options.changeSettings) fs.writeFileSync(file, JSON.stringify({ ...baseline, validation: { requiredVariables: ['CHANGED'] } }));
        return [200, { token: account }];
    }
    if (endpoint.endsWith('/revoke')) {
        assert.equal(request.headers.Authorization, undefined);
        assert.equal(request.body.token, account);
        return [200, {}];
    }
    assert.ok(!endpoint.includes('secrets'), 'Connecting never reads or uploads secret values');
    if (endpoint.endsWith('/ping')) { assert.equal(request.headers.Authorization, 'Bearer ' + service); return [200, {}]; }
    assert.equal(request.headers.Authorization, 'Bearer ' + account);
    if (endpoint === '/v3/projects/project') return options.existingProject ? [200, { project: { name: url.searchParams.get('project') } }] :
        [400, { messages: [options.projectMessage || 'Please provide a valid project'] }];
    if (endpoint === '/v3/projects') {
        if (request.method === 'GET') {
            if (options.cancelList) cancellation.cancel();
            if (options.projectListStatus) return [options.projectListStatus, { messages: ['provider-response-private-fixture', account] }];
            if (options.malformedList) return [200, { projects: options.malformedList }];
            const page = Number(url.searchParams.get('page'));
            assert.equal(url.searchParams.get('per_page'), '20');
            return [200, { projects: options.repeatPage || options.projectPages?.[page - 1] ||
                (options.existingProject ? [{ name: 'my-app' }] : []) }];
        }
        assert.equal(request.method, 'POST'); options.existingProject = true;
        return options.createRace ? [409, {}] : [200, { project: { name: request.body.name } }];
    }
    if (endpoint === '/v3/configs/config') return options.missingConfig ? [400, { messages: [options.configMessage || 'Could not find requested config'] }] : [200, { config: { name: url.searchParams.get('config') } }];
    if (endpoint === '/v3/environments') {
        assert.equal(request.body.project, url.searchParams.get('project'));
        options.missingConfig = false; return [200, { environment: { slug: 'dev' } }];
    }
    if (endpoint.endsWith('/tokens')) {
        // Reproduce the documented API rejecting missing JSON destination fields.
        if (!request.body.project || !request.body.config) return [400, { messages: ['project and config are required'] }];
        assert.equal(request.body.project, url.searchParams.get('project'));
        assert.equal(request.body.config, url.searchParams.get('config'));
        return [200, { token: { key: options.emptyService ? '' : service, slug: 'synthetic-service-id' } }];
    }
    if (endpoint.endsWith('/tokens/token')) { assert.equal(request.method, 'DELETE'); assert.equal(request.body.token, service); return [200, {}]; }
    throw new Error('Unexpected endpoint ' + endpoint);
}
const httpsMock = { request(request, callback) {
    assert.equal(request.hostname, 'api.doppler.com');
    const req = new EventEmitter(); let data = '', ended = false;
    req.write = chunk => { data += chunk; };
    req.setTimeout = () => req;
    req.destroy = () => { ended = true; queueMicrotask(() => req.emit('error', new Error(account))); };
    req.end = () => queueMicrotask(() => {
        if (ended) return;
        const entry = { ...request, body: data ? JSON.parse(data) : undefined }; requests.push(entry);
        let result;
        try { result = responseFor(entry); } catch (error) { req.emit('error', error); return; }
        const res = new EventEmitter(); res.statusCode = result[0]; callback(res);
        res.emit('data', options.oversized ? Buffer.alloc(600 * 1024) : Buffer.from(JSON.stringify(result[1]))); res.emit('end');
    }); return req;
} };
const context = { secrets: { get: async key => secrets.get(key), store: async (key, value) => secrets.set(key, value), delete: async key => secrets.delete(key) },
    workspaceState: { get: (key, fallback) => state.get(key) ?? fallback, update: async (key, value) => state.set(key, value) } };
const mock = { CancellationError, ProgressLocation: { Notification: 15 },
    EventEmitter: class { event = () => ({ dispose() {} }); fire() {} },
    Uri: { parse: value => ({ toString: () => value }), file: fsPath => ({ fsPath }) },
    env: { language: 'en', clipboard: { writeText: async text => { clipboard = text; } }, openExternal: async uri => { urls.push(uri.toString()); return !options.browserFailed; } },
    workspace: { workspaceFolders: [{ uri: { fsPath: root } }], getConfiguration: () => ({ get: (_key, fallback) => fallback }) },
    window: { createOutputChannel: () => ({ appendLine(line) { logs.push(line); }, show() {}, clear() {} }),
        showInformationMessage: async (message, button) => { notifications.push(message); return button; },
        showWarningMessage: async message => { notifications.push(message); },
        showErrorMessage: async message => { notifications.push(message); },
        withProgress: async (_settings, task) => task({ report: value => progressMessages.push(value.message) }, cancellation) } };
const originalRequire = Module.prototype.require;
Module.prototype.require = function(name) {
    if (name === 'vscode') return mock;
    if (name === 'https') return httpsMock;
    if (name === '../extension') return { extensionContext: context };
    return originalRequire.apply(this, arguments);
};
const { DopplerOnboarding } = require('../out/utils/dopplerOnboarding');
const { EnvironmentWebviewProvider } = require('../out/providers/environmentWebviewProvider');
const { OpenEnvironmentPanelCommand } = require('../out/commands/openEnvironmentPanel');
const { dopplerSetupRequest } = require('../out/utils/dopplerOnboardingApi');
const baseline = { environments: { development: '.env' }, validation: { requiredVariables: ['UNCHANGED'] },
    cloudSync: { provider: 'doppler', project: 'your-project-name', config: 'development', token: 'synthetic-old-placeholder', encryptCloudSync: true } };
function reset(changes = {}, config = baseline) {
    options = changes; cancellation = newCancellation(); requests.length = 0; urls.length = 0; notifications.length = 0; logs.length = 0;
    secrets.clear(); state.clear(); progressMessages = []; clipboard = undefined;
    if (config) fs.writeFileSync(file, JSON.stringify(config)); else fs.rmSync(file, { force: true });
    return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : undefined;
}
function assertPrivate() {
    const text = (fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '') + JSON.stringify([...state.values()]) + notifications.join(' ') + progressMessages.join(' ') + urls.join(' ') + logs.join(' ');
    for (const credential of [account, service, 'synthetic-private-poll-code', 'provider-response-private-fixture']) assert.ok(!text.includes(credential), 'Never persist/display credentials or provider response text');
    assert.equal(fs.readFileSync(envFile, 'utf8'), 'UNCHANGED=synthetic-fixture\n');
}
async function main() {
    try {
        reset({ pending: true, missingConfig: true });
        const first = DopplerOnboarding.connect(root);
        assert.equal(DopplerOnboarding.connect(root), first, 'Double click shares a single setup');
        assert.equal(await first, true);
        const settings = JSON.parse(fs.readFileSync(file));
        assert.equal(settings.cloudSync.project, 'my-app'); assert.equal(settings.cloudSync.config, 'dev');
        assert.equal(settings.cloudSync.token, undefined); assert.equal(settings.cloudSync.encryptCloudSync, true);
        assert.deepEqual(settings.environments, baseline.environments); assert.deepEqual(settings.validation, baseline.validation);
        assert.equal(secrets.get('dotenvy:doppler:my-app:token'), service);
        assert.equal(clipboard, 'synthetic-code');
        assert.equal(requests.filter(r => r.path === '/v3/projects').length, 1);
        assert.equal(requests.find(r => r.path.includes('/tokens?')).body.access, 'read/write');
        assert.ok(requests.at(-1).path.endsWith('/revoke'));
        assertPrivate();
        for (const Provider of [EnvironmentWebviewProvider, OpenEnvironmentPanelCommand]) {
            reset({ existingProject: true }, { ...baseline, cloudSync: { ...baseline.cloudSync, project: 'existing-app', config: 'prd' } });
            const receiver = Object.create(Provider.prototype); receiver.environmentProvider = { rootPath: root };
            let refreshed = 0; receiver.refreshEnvironments = async () => { refreshed++; };
            await receiver.handleMessage({ type: 'connectDoppler' });
            assert.equal(refreshed, 1);
            assert.equal(requests.filter(r => r.path === '/v3/projects').length, 0);
            assert.equal(JSON.parse(fs.readFileSync(file)).cloudSync.config, 'prd', 'Preserve explicitly selected environment');
            assertPrivate();
        }
        reset({}, null); assert.equal(await DopplerOnboarding.connect(root), true);
        assert.ok(JSON.parse(fs.readFileSync(file)).environments); assertPrivate();
        reset({ projectMessage: 'Project not found', missingConfig: true, configMessage: 'Config does not exist' });
        assert.equal(await DopplerOnboarding.connect(root), true); assertPrivate();
        // Exact reproduction of the reported findProject / 400 / UNCLASSIFIED.
        reset({ projectMessage: 'provider-response-private-fixture' });
        assert.equal(await DopplerOnboarding.connect(root), true);
        assert.ok(requests.some(r => r.method === 'GET' && r.path.startsWith('/v3/projects?')));
        assert.equal(requests.filter(r => r.method === 'POST' && r.path === '/v3/projects').length, 1);
        assertPrivate();
        const fullPage = Array.from({ length: 20 }, (_, i) => ({ name: 'other-project-' + i }));
        reset({ projectMessage: 'provider-response-private-fixture', projectPages: [fullPage, fullPage, [{ name: 'my-app' }]] });
        assert.equal(await DopplerOnboarding.connect(root), true);
        assert.equal(requests.filter(r => r.method === 'GET' && r.path.startsWith('/v3/projects?')).length, 3);
        assert.ok(!requests.some(r => r.method === 'POST' && r.path === '/v3/projects'), 'Reuse exact project on later pages');
        assertPrivate();
        reset({ projectMessage: 'provider-response-private-fixture', projectPages: [fullPage, []] });
        assert.equal(await DopplerOnboarding.connect(root), true);
        assert.equal(requests.filter(r => r.method === 'GET' && r.path.startsWith('/v3/projects?')).length, 2);
        assert.equal(requests.filter(r => r.method === 'POST' && r.path === '/v3/projects').length, 1);
        assertPrivate();
        reset({ projectMessage: 'provider-response-private-fixture', createRace: true });
        assert.equal(await DopplerOnboarding.connect(root), true); assertPrivate();
        for (const changes of [{ projectListStatus: 400 }, { projectListStatus: 403 },
            { malformedList: {} }, { malformedList: [{ slug: 'my-app' }] }, { repeatPage: fullPage }, { cancelList: true }]) {
            const before = reset({ projectMessage: 'provider-response-private-fixture', ...changes });
            secrets.set('dotenvy:doppler:my-app:token', 'synthetic-existing-connection');
            assert.equal(await DopplerOnboarding.connect(root), false);
            assert.ok(!requests.some(r => r.method === 'POST' && r.path === '/v3/projects'), 'Never create after incomplete/failed lookup');
            assert.equal(fs.readFileSync(file, 'utf8'), before);
            assert.equal(secrets.get('dotenvy:doppler:my-app:token'), 'synthetic-existing-connection');
            assert.ok(requests.some(r => r.path.endsWith('/revoke')));
            assertPrivate();
        }
        for (const [endpoint, stage, label] of [
            ['/v3/auth/cli/authorize', 'authorize', 'completing sign-in'],
            ['/v3/projects/project', 'listProjects', 'checking the project list'],
            ['/v3/configs/config/tokens', 'createServiceToken', 'creating the service token'],
        ]) {
            const before = reset({ failure: endpoint, status: 400, projectListStatus: 400 });
            assert.equal(await DopplerOnboarding.connect(root), false);
            assert.ok(notifications.some(n => n.includes(label) && n.includes('400')));
            assert.ok(logs.some(n => n.includes(`stage=${stage} status=400`)));
            assert.equal(fs.readFileSync(file, 'utf8'), before);
            assertPrivate();
        }
        for (const errorMessage of ['project parameter is required', 'config parameter is missing', 'No permission to access project not found']) {
            reset({ failure: '/v3/projects/project', status: 400, errorMessage });
            assert.equal(await DopplerOnboarding.connect(root), false);
            assert.ok(!requests.some(r => r.path === '/v3/projects'), 'Validation/permissions must not trigger project creation');
            assertPrivate();
        }
        for (const changes of [{ browserFailed: true }, { badUrl: 'https://evil.invalid/workplace/auth/cli' },
            { badUrl: 'https://dashboard.doppler.com.evil.invalid/workplace/auth/cli' },
            { failure: '/v3/projects/project', status: 403 }, { failure: '/v3/configs/config/ping' },
            { cancelAfterAuth: true }, { cancelAt: '/v3/configs/config/tokens' }, { emptyService: true }]) {
            const before = reset(changes); secrets.set('dotenvy:doppler:my-app:token', 'synthetic-existing-connection');
            assert.equal(await DopplerOnboarding.connect(root), false);
            assert.equal(fs.readFileSync(file, 'utf8'), before);
            assert.equal(secrets.get('dotenvy:doppler:my-app:token'), 'synthetic-existing-connection');
            if (changes.failure === '/v3/configs/config/ping') assert.ok(requests.some(r => r.method === 'DELETE'));
            if (changes.failure === '/v3/projects/project') assert.ok(!requests.some(r => r.path === '/v3/projects'));
            assertPrivate();
        }
        let before = reset(); cancellation.cancel(); assert.equal(await DopplerOnboarding.connect(root), false);
        assert.equal(requests.length, 0); assert.equal(fs.readFileSync(file, 'utf8'), before);
        reset({ changeSettings: true }); assert.equal(await DopplerOnboarding.connect(root), false);
        assert.deepEqual(JSON.parse(fs.readFileSync(file)).validation, { requiredVariables: ['CHANGED'] });
        assert.ok(requests.some(r => r.method === 'DELETE'), 'Revoke unused service credential when settings change');
        assertPrivate();
        before = reset(); secrets.set('dotenvy:doppler:my-app:token', 'synthetic-existing-connection');
        const originalWrite = fs.promises.writeFile;
        fs.promises.writeFile = async (name, ...args) => {
            if (String(name).startsWith(file + '.') && String(name).endsWith('.tmp')) throw new Error('Write failure containing ' + account);
            return originalWrite(name, ...args);
        };
        try { assert.equal(await DopplerOnboarding.connect(root), false); } finally { fs.promises.writeFile = originalWrite; }
        assert.equal(fs.readFileSync(file, 'utf8'), before);
        assert.equal(secrets.get('dotenvy:doppler:my-app:token'), 'synthetic-existing-connection');
        assert.ok(requests.some(r => r.method === 'DELETE')); assertPrivate();
        reset({ failure: '/v3/auth/cli/revoke' }); assert.equal(await DopplerOnboarding.connect(root), true);
        assert.ok([...secrets.keys()].some(k => k.includes('setup-cleanup')));
        options = { existingProject: true };
        assert.equal(await DopplerOnboarding.connect(root), true);
        assert.ok(![...secrets.keys()].some(k => k.includes('setup-cleanup')));
        assertPrivate();
        before = reset({ failure: '/v3/auth/cli/authorize', status: 401 });
        assert.equal(await DopplerOnboarding.connect(root), false); assert.equal(fs.readFileSync(file, 'utf8'), before); assertPrivate();
        reset(); fs.writeFileSync(file, '{ invalid private-fixture');
        assert.equal(await DopplerOnboarding.connect(root), false); assert.equal(requests.length, 0); assertPrivate();
        reset({ failure: '/probe', status: 302 });
        await assert.rejects(dopplerSetupRequest('/probe'), /302/); assert.equal(requests.length, 1, 'Never follow redirects');
        reset({ oversized: true }); await assert.rejects(dopplerSetupRequest('/v3/auth/cli/generate/2'));
        // Actual webview handler sends Connect before setup and Dashboard after connection.
        const nodes = {};
        for (const id of ['cloud-status', 'last-sync', 'cloud-error', 'btn-doppler', 'doppler-button-label']) nodes[id] = { setAttribute(key, value) { this[key] = value; } };
        let message;
        const sandbox = { window: { addEventListener() {} }, document: { addEventListener() {}, getElementById: id => nodes[id] }, acquireVsCodeApi: () => ({ postMessage: value => { message = value; } }) };
        vm.createContext(sandbox); vm.runInContext(fs.readFileSync(path.join(__dirname, '../resources/panel/panel.js'), 'utf8'), sandbox);
        sandbox.window.connectDoppler(); assert.equal(message.type, 'connectDoppler');
        vm.runInContext('updateCloudCard({cloudSync:{connected:true}})', sandbox);
        sandbox.window.connectDoppler(); assert.equal(message.type, 'openDopplerDashboard');
        assert.equal(nodes['doppler-button-label']['data-i18n'], 'panel.actions.doppler');
        vm.runInContext('updateCloudCard({cloudSync:{connected:false}})', sandbox);
        sandbox.window.connectDoppler(); assert.equal(message.type, 'connectDoppler');
        console.log('PASS: browser authorization, automatic project/dev setup, scoped SecretStorage, account-token revocation, cancellation, errors, both receivers and frontend');
    } finally { fs.rmSync(directory, { recursive: true, force: true }); }
}
main().then(() => process.exit(0), error => { console.error(error); process.exit(1); });

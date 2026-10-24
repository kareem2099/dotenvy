/** Real dashboard switches/editor saves -> local history -> provider -> frontend. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { createHarness, installVscodeMock, bindExtensionContext } = require('./support/vscodeMock');
const harness = installVscodeMock(createHarness());
const { vscode, context } = harness;
const container = { innerHTML: '', querySelector: () => null };
let receiveFrontend, receiveBackend, disposePanel;
const sent = [];
const frontend = [];
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../resources/panel/analytics.js'), 'utf8'), {
    acquireVsCodeApi: () => ({ postMessage: message => frontend.push(message) }),
    window: { addEventListener: (_event, callback) => { receiveFrontend = callback; } },
    document: { readyState: 'complete', getElementById: id => id === 'analytics-root' ? container : null,
        addEventListener() {} },
});
vscode.ViewColumn = { One: 1 };
vscode.window.createWebviewPanel = () => ({
    reveal() {},
    onDidDispose: callback => { disposePanel = callback; return { dispose() {} }; },
    webview: {
        cspSource: 'test', asWebviewUri: uri => ({ toString: () => uri.fsPath }),
        postMessage: message => {
            sent.push(message);
            receiveFrontend({ data: JSON.parse(JSON.stringify(message)) });
            return Promise.resolve(true);
        },
        onDidReceiveMessage: callback => { receiveBackend = callback; return { dispose() {} }; },
    },
});
vscode.workspace.getWorkspaceFolder = uri => vscode.workspace.workspaceFolders.find(folder => {
    const relative = path.relative(folder.uri.fsPath, uri.fsPath);
    return relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative);
});
bindExtensionContext(harness);
const { AnalyticsWebviewProvider } = require('../out/providers/analyticsWebviewProvider');
const { HistoryManager } = require('../out/utils/historyManager');
const { recordSavedEnvironment } = require('../out/utils/environmentHistory');
const { handleEnvironmentPanelMessage } = require('../out/providers/environmentPanelActions');
const { OpenEnvironmentPanelCommand } = require('../out/commands/openEnvironmentPanel');
const base = fs.mkdtempSync(path.join(os.tmpdir(), 'dotenvy-analytics-'));
const first = path.join(base, 'first'), second = path.join(base, 'second');
const config = root => path.join(root, '.dotenvy.json');
function latest() { return sent.filter(message => message.type === 'analyticsLoaded').at(-1); }
function writeConfig(root, history) { fs.writeFileSync(config(root), JSON.stringify({ history })); }
async function main() {
    try {
        fs.mkdirSync(first); fs.mkdirSync(second);
        writeConfig(first, { enabled: false, storagePath: 'custom', includeGitInfo: false });
        writeConfig(second, { enabled: true, autoCleanup: false, includeGitInfo: false });
        vscode.workspace.workspaceFolders = [first, second].map(root => ({ name: path.basename(root), uri: vscode.Uri.file(root) }));
        vscode.window.activeTextEditor = { document: { uri: vscode.Uri.file(path.join(second, 'app.ts')) } };
        AnalyticsWebviewProvider.init(vscode.Uri.file(path.join(__dirname, '..')), context);
        await AnalyticsWebviewProvider.openOrReveal();
        await receiveBackend(frontend[0]);
        assert.equal(latest().workspacePath, second, 'Use the active editor project, not the first folder');
        assert.equal(latest().analytics.dataRange.totalEntries, 0);
        assert.match(container.innerHTML, /empty-panel/);
        assert.doesNotMatch(container.innerHTML, /overview-card/);

        const env = { name: 'dev', fileName: '.env.dev', filePath: path.join(second, '.env.dev') };
        fs.writeFileSync(env.filePath, 'PORT=3000\nDEMO_LABEL=development\n');
        const host = { environmentProvider: { rootPath: second, getEnvironments: async () => [env] },
            context, refreshEnvironments: async () => {} };
        await handleEnvironmentPanelMessage({ type: 'switchEnvironment', environment: 'dev' }, host);
        assert.equal(fs.readFileSync(path.join(second, '.env'), 'utf8'), fs.readFileSync(env.filePath, 'utf8'));
        assert.equal(latest().analytics.dataRange.totalEntries, 1, 'Sidebar switch refreshes the open analytics automatically');
        assert.equal(latest().analytics.usagePatterns.environmentFrequency.dev, 1);
        assert.equal(latest().analytics.quickInsights.totalUniqueVariables, 2);
        assert.match(container.innerHTML, /overview-card/);
        assert.match(container.innerHTML, /<div class="ov-value">1<\/div>/);

        const dashboard = new OpenEnvironmentPanelCommand();
        dashboard.environmentProvider = host.environmentProvider;
        dashboard.refreshEnvironments = async () => {};
        await dashboard.handleMessage({ type: 'switchEnvironment', environment: 'dev' });
        assert.equal(latest().analytics.dataRange.totalEntries, 2, 'Full dashboard switch also records once');
        assert.equal((await HistoryManager.getHistory(second)).filter(entry => entry.action === 'switch').length, 2);
        assert.equal((await HistoryManager.getHistory(first)).length, 0);

        const saved = { uri: vscode.Uri.file(path.join(second, 'packages/api/.env.local')), getText: () => 'PORT=9000\n' };
        assert.equal(await recordSavedEnvironment(saved), second);
        assert.equal(latest().analytics.dataRange.totalEntries, 3);
        assert.ok((await HistoryManager.getHistory(second)).some(entry => entry.fileName === 'packages/api/.env.local'));
        assert.equal(await recordSavedEnvironment({ ...saved, uri: vscode.Uri.file(path.join(second, 'app.ts')) }), null);
        writeConfig(second, { enabled: true, trackManualEdits: false, autoCleanup: false, includeGitInfo: false });
        assert.equal(await recordSavedEnvironment(saved), null);
        writeConfig(second, { enabled: false });
        assert.equal(await recordSavedEnvironment(saved), null);
        assert.equal(latest().analytics.dataRange.totalEntries, 3);

        // Refresh must retain the displayed project even after the editor changes.
        vscode.window.activeTextEditor = { document: { uri: vscode.Uri.file(path.join(first, 'app.ts')) } };
        await receiveBackend({ type: 'refresh' });
        assert.equal(latest().workspacePath, second);
        await receiveBackend({ type: 'loadAnalytics', workspacePath: base });
        assert.equal(latest().workspacePath, second, 'Webview cannot request arbitrary local directories');

        let command;
        vscode.commands.executeCommand = async (...args) => { command = args; };
        await handleEnvironmentPanelMessage({ type: 'openAnalyticsPanel' }, host);
        assert.deepEqual(command, ['dotenvy.openAnalyticsPanel', second]);
        await AnalyticsWebviewProvider.openOrReveal(first);
        assert.equal(latest().workspacePath, first);
        assert.match(container.innerHTML, /empty-panel/);
        assert.equal(await HistoryManager.getHistoryDir(first), path.join(first, 'custom/history'));
        assert.equal(await HistoryManager.getHistoryDir(second), path.join(second, '.dotenvy/history'));
        const unconfigured = path.join(base, 'unconfigured');
        fs.mkdirSync(unconfigured);
        const defaults = await HistoryManager.getConfig(unconfigured);
        assert.equal(defaults.enabled, true, 'A folder without config cannot inherit disabled history from another folder');
        assert.equal(defaults.storagePath, undefined);
        disposePanel();
        console.log('Analytics: both switch routes, saved files, automatic rendering, empty state, settings and workspace isolation passed.');
    } finally {
        context.subscriptions.forEach(subscription => subscription.dispose());
        fs.rmSync(base, { recursive: true, force: true });
    }
}
main().then(() => process.exit(0)).catch(error => { console.error(error); process.exit(1); });

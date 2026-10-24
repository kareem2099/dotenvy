/** Regressions for PR #5: destination selection, complete env blocks, visible diffs and local corrections. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const dotenv = require('dotenv');
const {createHarness, installVscodeMock, useWorkspace, bindExtensionContext} = require('./support/vscodeMock');
const harness = installVscodeMock(createHarness());
const published = new Map(), events = {}, opened = [];
harness.vscode.languages = {createDiagnosticCollection: () => ({
    set: (uri, hits) => published.set(uri.fsPath, hits), delete: uri => published.delete(uri.fsPath), dispose() {},
})};
harness.vscode.Diagnostic = class { constructor(range, message, severity) { Object.assign(this, {range, message, severity}); } };
harness.vscode.Range = class { constructor(...args) { this.args = args; } };
harness.vscode.DiagnosticSeverity = {Warning: 1};
harness.vscode.Disposable = {from: (...items) => ({dispose: () => items.forEach(item => item.dispose())})};
for (const name of ['onDidOpenTextDocument', 'onDidChangeTextDocument', 'onDidCloseTextDocument'])
    harness.vscode.workspace[name] = callback => { events[name] = callback; return {dispose() {}}; };
harness.vscode.workspace.getWorkspaceFolder = uri => harness.vscode.workspace.workspaceFolders.find(folder => {
    const relative = path.relative(folder.uri.fsPath, uri.fsPath);
    return relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative);
});
harness.vscode.workspace.textDocuments = [];
harness.vscode.workspace.openTextDocument = async options => {
    assert.equal(options.language, 'plaintext');
    const document = {getText: () => options.content}; opened.push(document); return document;
};
harness.vscode.window.showTextDocument = async document => { assert.ok(opened.includes(document)); };
bindExtensionContext(harness);
const {DopplerSyncManager} = require('../out/utils/dopplerSyncManager');
const {ConfigUtils} = require('../out/utils/configUtils');
const {mergeEnvFileContent, parseEnvFile, writeSecretsToTargets} = require('../out/utils/envFileContent');
const {SecretDetector} = require('../out/utils/secretDetector');
const {FeedbackManager} = require('../out/utils/feedbackManager');
const {registerSecretDiagnostics} = require('../out/providers/secretDiagnostics');
const {WorkspaceManager} = require('../out/providers/workspaceManager');
const factory = require('../out/utils/cloudSyncManagerFactory');
const {DiffCloudCommand} = require('../out/commands/diffCloud');
const {CompareEnvironmentsCommand} = require('../out/commands/compareEnvironments');
const {logger, LogLevel} = require('../out/utils/logger');
const {LAST_SYNC_STORAGE} = require('../out/constants');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dotenvy-pr-integration-'));
useWorkspace(harness, root);
WorkspaceManager.resolveWorkspacePath = async () => root;
async function eventually(predicate) {
    for (let attempt = 0; attempt < 100; attempt++) {
        if (predicate()) return;
        await new Promise(resolve => setTimeout(resolve, 10));
    }
    assert.ok(predicate(), 'Async editor operation must finish');
}
async function main() {
    let diagnostics;
    try {
        const config = {cloudSync: {provider: 'doppler', project: 'synthetic-project', config: 'deev', encryptCloudSync: false}};
        fs.writeFileSync(path.join(root, '.dotenvy.json'), JSON.stringify(config));
        const manager = new DopplerSyncManager(config.cloudSync);
        const visited = [];
        manager.listConfigs = async () => [{name: 'prd'}];
        manager.makeDopplerRequest = async url => {
            const configName = new URL(url).searchParams.get('config'); visited.push(configName);
            if (configName !== 'prd') throw new Error('HTTP 404: Could not find requested config');
            return '{}';
        };
        const missing = await manager.testConnection();
        assert.equal(missing.success, false); assert.equal(missing.errorCode, 'CONFIG_NOT_FOUND');
        assert.deepEqual(visited, ['deev']);
        assert.equal(JSON.parse(fs.readFileSync(path.join(root, '.dotenvy.json'))).cloudSync.config, 'deev');
        harness.vscode.window.showQuickPick = async () => undefined;
        assert.equal(await DopplerSyncManager.promptConfigSelection(root, config.cloudSync), null);
        assert.equal((await ConfigUtils.readQuickEnvConfig(root)).cloudSync.config, 'deev');

        const {DotenvyIgnore} = require('../out/utils/dotenvyIgnore');
        const {PatternRegistry} = require('../out/utils/patternRegistry');
        const fixture = path.join(root, 'test', 'integration.ts');
        assert.equal(DotenvyIgnore.shouldIgnore(fixture, root), true);
        fs.writeFileSync(path.join(root, '.dotenvyignore'), '!test/integration.ts\n');
        assert.equal(DotenvyIgnore.shouldIgnore(fixture, root), false);
        assert.equal(PatternRegistry.shouldScanFile(fixture, root), true);
        fs.unlinkSync(path.join(root, '.dotenvyignore'));

        const {t, LocalizationService} = require('../out/i18n');
        for (const locale of ['en', 'ar', 'it', 'ru']) {
            await LocalizationService.getInstance().setLocale(locale);
            const missingToken = t('doppler.tokenRequired', {name: 'DOPPLER_TOKEN'});
            const before = harness.vscode.window.showErrorMessage;
            let actions;
            harness.vscode.window.showErrorMessage = async (_message, ...buttons) => { actions = buttons; };
            await DopplerSyncManager.handleConnectionFailure(root, config.cloudSync, missingToken);
            assert.ok(actions.includes(t('doppler.setToken')), 'Missing token recovery must work in every locale');
            harness.vscode.window.showErrorMessage = before;
        }
        await LocalizationService.getInstance().setLocale('en');

        const existing = '# before\r\nexport KEY="old\r\nREMAINDER\r\n# secret body\r\n"\r\nPORT=3000 # listen\r\n';
        const removed = mergeEnvFileContent(existing, {PORT: '4000'});
        assert.equal(removed, '# before\r\nPORT=4000 # listen\r\n');
        assert.doesNotMatch(removed, /old|REMAINDER|secret body|KEY=/);
        const updated = mergeEnvFileContent(existing, {KEY: '"fresh\nnext"', PORT: '4000'});
        assert.deepEqual(dotenv.parse(updated), {KEY: 'fresh\nnext', PORT: '4000'});
        assert.match(updated, /export KEY=/); assert.doesNotMatch(updated, /REMAINDER|secret body/);
        const quoted = mergeEnvFileContent('TOKEN="old # embedded" # actual\n', {TOKEN: '"new"'});
        assert.equal(quoted, 'TOKEN="new" # actual\n');
        assert.equal(mergeEnvFileContent('PORT=3000 # listen\n', {PORT: '3000 # listen'}), 'PORT=3000 # listen\n');
        const envPath = path.join(root, '.env.dev');
        fs.writeFileSync(envPath, existing);
        assert.equal(parseEnvFile(envPath).KEY, '"old\nREMAINDER\n# secret body\n"');
        await writeSecretsToTargets([{file: '.env.dev', absolutePath: envPath, keyPrefix: '', prefixes: [], catchAll: true, label: 'dev'}], {PORT: '4000'});
        assert.equal(fs.readFileSync(envPath, 'utf8'), removed);
        assert.equal(fs.readFileSync(envPath + '.backup', 'utf8'), existing);

        logger.setLevel(LogLevel.WARN);
        config.cloudSync.config = 'dev';
        config.cloudSync.envTargets = [{file: '.env.dev', catchAll: true}];
        await ConfigUtils.saveQuickEnvConfig(config, root);
        fs.writeFileSync(envPath, 'PORT=4000\nLOCAL_ONLY=private-local\n');
        fs.writeFileSync(path.join(root, '.env.prd'), 'PORT=9000\n');
        factory.createCloudSyncManager = async () => ({fetchSecrets: async () => ({success: true, secrets: {PORT: '9000', REMOTE_ONLY: 'private-remote'}})});
        await harness.workspaceState.update(LAST_SYNC_STORAGE, 'previous-sync');
        const before = fs.readFileSync(envPath, 'utf8');
        await new DiffCloudCommand().execute();
        assert.ok(opened.length > 0, 'Diff opens a document in production mode');
        const diff = opened.at(-1).getText();
        assert.match(diff, /\[cloud\] REMOTE_ONLY/); assert.match(diff, /\[local\] LOCAL_ONLY/); assert.match(diff, /\[changed\] PORT/);
        assert.doesNotMatch(diff, /private-local|private-remote|4000|9000/);
        assert.equal(fs.readFileSync(envPath, 'utf8'), before);
        assert.equal(harness.workspaceState.get(LAST_SYNC_STORAGE), 'previous-sync');
        await new CompareEnvironmentsCommand().execute();
        assert.match(opened.at(-1).getText(), /PORT/); assert.match(opened.at(-1).getText(), /\.env\.dev|\.env\.prd/);
        assert.doesNotMatch(opened.at(-1).getText(), /4000|9000/);

        await FeedbackManager.init(harness.context);
        const filePath = path.join(root, 'app.ts');
        // Synthetic fixture, assembled at runtime so repository secret scans
        // do not mistake an assignment-shaped example for a live credential.
        const diagnosticValue = ['sk', 'Ab3xY7kLm2Qp9Vw4Nz8R'].join('-');
        let text = `const token = "${diagnosticValue}";`;
        const uri = {scheme: 'file', fsPath: filePath, toString: () => filePath};
        const document = {uri, version: 1, isClosed: false, getText: () => text};
        harness.vscode.workspace.textDocuments = [document];
        diagnostics = registerSecretDiagnostics(harness.context);
        await eventually(() => published.get(filePath)?.length > 0);
        assert.equal(published.get(filePath).length, 1, 'Overlapping patterns produce one editor warning');
        const secrets = await SecretDetector.scanText(filePath, text);
        await FeedbackManager.recordFalsePositive(secrets[0]);
        await eventually(() => published.get(filePath)?.length === 0);
        assert.deepEqual(await SecretDetector.scanText(filePath, text), []);
        await FeedbackManager.clear();
        await eventually(() => published.get(filePath)?.length > 0);
        text = '// no candidate'; document.version++;
        events.onDidChangeTextDocument({document});
        await eventually(() => published.get(filePath)?.length === 0);
        document.isClosed = true; events.onDidCloseTextDocument(document);
        assert.equal(published.has(filePath), false);
        console.log('PASS: explicit Doppler destination, multiline deletion/update/backup, visible masked comparisons and correction-aware editor diagnostics');
    } finally {
        diagnostics?.dispose();
        fs.rmSync(root, {recursive: true, force: true});
    }
}
main().then(() => process.exit(0), error => {console.error(error);process.exit(1);});

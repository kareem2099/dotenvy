/** File-change notification selection must open the actual scanner panel with that file's results. */
const assert = require('assert/strict');
const path = require('path');
const Module = require('module');
const warnings = [], errors = [];
let extensionAvailable = true, created = 0, revealed = 0;
const extensionUri = { fsPath: path.resolve(__dirname, '..') };
const mock = {
    EventEmitter: class { event = () => ({ dispose() {} }); fire() {} },
    ViewColumn: { One: 1 },
    Uri: { joinPath: (uri, ...parts) => ({ fsPath: path.join(uri.fsPath, ...parts), toString() { return this.fsPath; } }) },
    extensions: { getExtension: id => {
        assert.equal(id, 'FreeRave.dotenvy'); return extensionAvailable ? { extensionUri } : undefined;
    } },
    window: {
        createOutputChannel: () => ({ appendLine() {}, show() {}, clear() {} }),
        showErrorMessage: message => { errors.push(message); },
        showWarningMessage: (message, ...buttons) => new Promise((resolve, reject) => { warnings.push({ message, buttons, resolve, reject }); }),
        createWebviewPanel: () => {
            created++;
            return { reveal() { revealed++; }, onDidDispose() {}, dispose() {},
                webview: { html: '', cspSource: 'test-webview', asWebviewUri: uri => uri, onDidReceiveMessage() {} } };
        }
    }
};
const originalRequire = Module.prototype.require;
Module.prototype.require = function (name) { return name === 'vscode' ? mock : originalRequire.apply(this, arguments); };
const { SecretDetector } = require('../out/utils/secretDetector');
const { SecretsPanel } = require('../out/providers/SecretsPanel');
const { LocalizationService } = require('../out/i18n');
const originalScan = SecretDetector.scanFile, originalShow = SecretsPanel.show;
let secrets = [{ file: 'sample.ts', sourceFile: '/synthetic-notification/sample.ts', line: 3, column: 4,
    content: 'Synt****1234', valueLength: 40, confidence: 'high', type: 'Generic API Key',
    reasoning: [], detectionMethod: 'pattern', suggestedEnvVar: 'API_KEY' }];
SecretDetector.scanFile = async () => secrets;
const settle = async () => { for (let i = 0; i < 3; i++) await new Promise(resolve => setImmediate(resolve)); };
async function notify() {
    await SecretDetector.performFileScan('/synthetic-notification/sample.ts');
    return warnings.at(-1);
}
async function main() {
    try {
        const notification = await notify();
        assert.equal(created, 0, 'Do not open a panel until the user chooses review');
        assert.ok(notification.buttons[0]);
        notification.resolve(notification.buttons[0]); await settle();
        assert.equal(created, 1, 'Notification click creates the actual results panel');
        assert.deepEqual(SecretsPanel.currentPanel._secrets, secrets);
        assert.equal(SecretsPanel.currentPanel._extensionUri, extensionUri);
        assert.match(SecretsPanel.currentPanel._panel.webview.html, /data-action="view"/);
        assert.match(SecretsPanel.currentPanel._panel.webview.html, /sample\.ts/);

        const dismiss = await notify(); dismiss.resolve(undefined); await settle();
        assert.equal(revealed, 0, 'Dismissing the notification does not open/reveal a panel');
        const changedLanguage = await notify();
        await LocalizationService.getInstance().setLocale('ar');
        secrets = [{ ...secrets[0], file: 'new.ts', sourceFile: '/synthetic-notification/new.ts' }];
        changedLanguage.resolve(changedLanguage.buttons[0]); await settle();
        assert.equal(revealed, 1, 'The original button still works after a locale change');
        assert.equal(SecretsPanel.currentPanel._secrets[0].file, 'sample.ts', 'Open the detections attached to this notification');
        const updated = await notify(); updated.resolve(updated.buttons[0]); await settle();
        assert.equal(created, 1, 'Reuse the existing scanner panel');
        assert.equal(revealed, 2);
        assert.equal(SecretsPanel.currentPanel._secrets[0].file, 'new.ts');

        const warningCount = warnings.length;
        let callbackResults;
        await SecretDetector.performFileScan('/synthetic-notification/sample.ts', result => { callbackResults = result; });
        assert.deepEqual(callbackResults, secrets);
        assert.equal(warnings.length, warningCount, 'Preserve explicit callback behavior');
        const saved = secrets; secrets = [];
        await SecretDetector.performFileScan('/synthetic-notification/sample.ts');
        assert.equal(warnings.length, warningCount, 'No warning for empty scan results');
        secrets = saved;

        extensionAvailable = false;
        const unavailable = await notify(); unavailable.resolve(unavailable.buttons[0]); await settle();
        assert.equal(errors.length, 1, 'Show extension-resolution errors');
        extensionAvailable = true;
        SecretsPanel.show = () => { throw new Error('Synthetic panel failure'); };
        const failure = await notify(); failure.resolve(failure.buttons[0]); await settle();
        assert.ok(errors.at(-1).includes('Synthetic panel failure'));
        const rejected = await notify(); rejected.reject(new Error('Synthetic notification failure')); await settle();
        assert.ok(errors.at(-1).includes('Synthetic notification failure'), 'Handle rejected notification promises');
        console.log('PASS: notification opens/reuses actual panel; correct results, dismiss, locale change, callbacks and visible failures');
    } finally {
        SecretsPanel.show = originalShow; SecretDetector.scanFile = originalScan;
        SecretsPanel.currentPanel?.dispose();
    }
}
main().then(() => process.exit(0), error => { console.error(error); process.exit(1); });

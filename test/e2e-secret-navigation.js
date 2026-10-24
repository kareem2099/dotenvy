/** Actual View click -> trusted detection -> real temporary source file and editor selection. */
const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const Module = require('module');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'dotenvy-navigation-'));
const folders = ['First', 'Second'].map(name => ({ name, uri: { fsPath: path.join(temp, name) } }));
const value = 'SyntheticNavigationValue0123456789';
const sourceLine = `const API_KEY = "${value}";`;
for (const folder of folders) {
    fs.mkdirSync(folder.uri.fsPath);
    fs.writeFileSync(path.join(folder.uri.fsPath, 'sample.ts'), sourceLine);
}
const opened = [], errors = [], selections = [], revealed = [], api = {};
class Range {
    constructor(line, start, endLine, end) {
        this.start = { line, character: start };
        this.end = { line: endLine, character: end };
    }
}
const vscode = {
    Range, Selection: class { constructor(start, end) { this.start = start; this.end = end; } },
    ViewColumn: { One: 1 }, TextEditorRevealType: { InCenter: 2 },
    EventEmitter: class { event = () => ({ dispose() {} }); fire() {} },
    Uri: { file: fsPath => ({ fsPath }), joinPath: (uri, ...parts) => ({ fsPath: path.join(uri.fsPath, ...parts), toString() { return this.fsPath; } }) },
    workspace: {
        workspaceFolders: folders,
        getWorkspaceFolder: uri => vscode.workspace.workspaceFolders?.find(folder => {
            const relative = path.relative(folder.uri.fsPath, uri.fsPath);
            return relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative);
        }),
        openTextDocument: async uri => {
            opened.push(uri.fsPath);
            const lines = fs.readFileSync(uri.fsPath, 'utf8').split('\n');
            return { uri, validateRange: range => {
                const clamp = point => {
                    const line = Math.min(point.line, lines.length - 1);
                    return { line, character: Math.min(point.character, lines[line].length) };
                };
                const start = clamp(range.start), end = clamp(range.end);
                return new Range(start.line, start.character, end.line, end.character);
            } };
        }
    },
    window: {
        createOutputChannel: () => ({ appendLine() {}, show() {}, clear() {} }),
        showErrorMessage: message => { errors.push(message); },
        showTextDocument: async (doc, options) => {
            selections.push({ file: doc.uri.fsPath, options });
            return { revealRange: (range, mode) => revealed.push({ range, mode }) };
        },
        createWebviewPanel: () => ({
            reveal() {}, onDidDispose: () => ({ dispose() {} }), dispose() {},
            webview: { html: '', cspSource: 'test-webview', asWebviewUri: uri => uri,
                onDidReceiveMessage: callback => { api.receive = callback; return { dispose() {} }; } }
        })
    }
};
const originalRequire = Module.prototype.require;
Module.prototype.require = function (name) { return name === 'vscode' ? vscode : originalRequire.apply(this, arguments); };
const { SecretsPanel } = require('../out/providers/SecretsPanel');
const { t } = require('../out/i18n');
const detection = index => ({
    file: `${folders[index].name}/sample.ts`, sourceFile: path.join(folders[index].uri.fsPath, 'sample.ts'),
    line: 1, column: sourceLine.indexOf(value) + 1, valueLength: value.length,
    content: 'Synt****6789', type: 'Generic API Key', confidence: 'high', suggestedEnvVar: 'API_KEY',
    reasoning: [], detectionMethod: 'pattern', riskScore: 90, context: ''
});
let panel;
async function loadFrontend(secret) {
    panel = SecretsPanel.show([secret], { fsPath: path.resolve(__dirname, '..') });
    await new Promise(resolve => setImmediate(resolve));
    const html = panel._panel.webview.html;
    assert.match(html, /data-action="view"/);
    const data = html.match(/<script type="application\/json" id="secrets-data">([\s\S]*?)<\/script>/)[1];
    const script = html.match(/<script nonce="[^"]+">([\s\S]*?)<\/script>/)[1];
    let clickHandler, pending;
    const document = {
        getElementById: id => id === 'secrets-data' ? { textContent: data } : { addEventListener() {} },
        addEventListener: (type, callback) => { if (type === 'click') clickHandler = callback; }
    };
    vm.runInNewContext(script, { document, acquireVsCodeApi: () => ({ postMessage: message => { pending = api.receive(message); } }) });
    return async () => {
        clickHandler({ target: { closest: () => ({ getAttribute: name => name === 'data-action' ? 'view' : '0' }) } });
        await pending;
    };
}
async function main() {
    try {
        for (const index of [0, 1]) {
            const secret = detection(index);
            await (await loadFrontend(secret))();
            assert.equal(opened.at(-1), secret.sourceFile, 'Display folder prefix must not be joined onto the root');
            assert.equal(errors.length, 0);
            const { options } = selections.at(-1);
            assert.equal(options.preview, false);
            assert.equal(options.selection.start.character, secret.column - 1);
            assert.equal(options.selection.end.character - options.selection.start.character, value.length, 'Select full value, not redacted text');
            assert.deepEqual(revealed.at(-1).range, options.selection);
            assert.equal(revealed.at(-1).mode, vscode.TextEditorRevealType.InCenter);
        }
        const secret = detection(1);
        await api.receive({ type: 'viewLocation', secret: { ...secret, sourceFile: '/forged-file.ts', valueLength: 999 } });
        assert.equal(opened.at(-1), secret.sourceFile, 'Use host detection rather than client-supplied source or length');
        assert.equal(selections.at(-1).options.selection.end.character - (secret.column - 1), value.length);

        fs.writeFileSync(secret.sourceFile, 'short');
        await (await loadFrontend(secret))();
        assert.equal(selections.at(-1).options.selection.start.character, 5);
        assert.equal(selections.at(-1).options.selection.end.character, 5, 'Clamp stale positions to current document');
        fs.writeFileSync(secret.sourceFile, sourceLine);

        const legacy = { ...secret, file: secret.sourceFile, sourceFile: undefined };
        await (await loadFrontend(legacy))();
        assert.equal(opened.at(-1), secret.sourceFile, 'Legacy absolute paths remain navigable');
        await (await loadFrontend({ ...secret, sourceFile: undefined }))();
        assert.ok(errors.at(-1).includes(t('secretsScanner.locationStale')));

        vscode.workspace.workspaceFolders = [folders[0]];
        const openedCount = opened.length;
        await (await loadFrontend(secret))();
        assert.equal(opened.length, openedCount, 'Closed workspace folder must not be opened through a stale detection');
        assert.ok(errors.at(-1).includes(t('secretsScanner.locationOutsideWorkspace')));
        vscode.workspace.workspaceFolders = folders;
        fs.unlinkSync(secret.sourceFile);
        await (await loadFrontend(secret))();
        assert.ok(errors.at(-1).includes('ENOENT'), 'Missing file must show a visible error');
        console.log('PASS: actual View clicks, workspace paths, full selection, trusted payload, stale ranges and visible failures');
    } finally {
        panel?.dispose();
        fs.rmSync(temp, { recursive: true, force: true });
    }
}
main().then(() => process.exit(0), error => { console.error(error); process.exit(1); });

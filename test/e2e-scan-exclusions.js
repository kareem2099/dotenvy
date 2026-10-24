/** Generated files and per-folder ignores must be excluded from all automatic scan entry points. */
const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'dotenvy-exclusions-'));
const folders = ['First', 'Second'].map(name => ({ uri: { fsPath: path.join(temp, name) } }));
const files = [], scanned = [], scheduled = [], handlers = {};
const relativeFiles = ['src/index.ts', 'src/checkout/client.ts', 'only-first.ts', 'only-second.ts', '.env', '.env.production',
    '.railway-credentials.json', 'htmlcov/coverage_html.js', 'nested/htmlcov/coverage_html.js', 'coverage/report.js',
    '.venv/library.py', 'venv/library.py', '__pycache__/example.py', '.pytest_cache/state.json',
    '.git/data.json', '.next/output.js', '.dotenvy/history.json', 'node_modules/library.js', 'out/extension.js'];
for (const [index, folder] of folders.entries()) {
    fs.mkdirSync(folder.uri.fsPath);
    fs.writeFileSync(path.join(folder.uri.fsPath, '.dotenvyignore'), index === 0 ? 'only-first.ts\n' : 'only-second.ts\n');
    for (const relative of relativeFiles) {
        const file = { scheme: 'file', fsPath: path.join(folder.uri.fsPath, relative) };
        fs.mkdirSync(path.dirname(file.fsPath), { recursive: true });
        fs.writeFileSync(file.fsPath, '// synthetic file\n'); files.push(file);
    }
}
const mock = {
    EventEmitter: class { event = () => ({ dispose() {} }); fire() {} },
    workspace: {
        workspaceFolders: folders,
        getWorkspaceFolder: uri => mock.workspace.workspaceFolders.find(folder => {
            const relative = path.relative(folder.uri.fsPath, uri.fsPath);
            return relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative);
        }),
        findFiles: async (_include, exclude) => {
            assert.ok(exclude.includes('**/htmlcov/**'), 'Exclude reports before file enumeration');
            // Return generated files anyway to verify defense in the scanner and cached-result path.
            return files;
        },
        createFileSystemWatcher: () => ({
            onDidChange: callback => { handlers.change = callback; },
            onDidCreate: callback => { handlers.create = callback; },
            onDidDelete: callback => { handlers.delete = callback; }, dispose() {}
        })
    },
    window: { createOutputChannel: () => ({ appendLine() {}, show() {}, clear() {} }), showInformationMessage() {} }
};
const originalRequire = Module.prototype.require;
Module.prototype.require = function (name) { return name === 'vscode' ? mock : originalRequire.apply(this, arguments); };
const { PatternRegistry } = require('../out/utils/patternRegistry');
const { SecretDetector } = require('../out/utils/secretDetector');
const { CacheManager } = require('../out/utils/cacheManager');
const expected = files.filter(file => {
    const root = mock.workspace.getWorkspaceFolder(file).uri.fsPath;
    const relative = path.relative(root, file.fsPath);
    return ['src/index.ts', 'src/checkout/client.ts', '.env', '.env.production', '.railway-credentials.json',
        root === folders[0].uri.fsPath ? 'only-second.ts' : 'only-first.ts'].includes(relative);
}).map(file => file.fsPath).sort();
const result = file => [{ file, line: 1, column: 1, content: 'masked', confidence: 'high' }];
const originalScan = SecretDetector.scanFile, originalEnhanced = SecretDetector.scanFileEnhanced;
const originalDebounce = SecretDetector.debounceFileScan;
async function main() {
    try {
        assert.equal(PatternRegistry.shouldScanFile(path.join(folders[0].uri.fsPath, 'htmlcov/coverage_html.js'), folders[0].uri.fsPath), false);
        assert.equal(PatternRegistry.shouldScanFile(path.join(temp, 'outside.ts'), folders[0].uri.fsPath), false);
        // Java/Spring projects keep credentials in src/main/resources.
        assert.equal(PatternRegistry.shouldScanFile(path.join(folders[0].uri.fsPath, 'src/main/resources/application.yml'), folders[0].uri.fsPath), true);
        SecretDetector.scanFile = async file => { scanned.push(file); return result(file); };
        SecretDetector.scanFileEnhanced = async file => { scanned.push(file); return result(file); };
        SecretDetector.debounceFileScan = file => { scheduled.push(file); };
        const plain = await SecretDetector.scanWorkspace();
        assert.deepEqual(scanned.slice().sort(), expected, 'Plain scan uses the correct folder ignore file');
        assert.deepEqual(plain.map(secret => secret.file).sort(), expected);
        scanned.length = 0; CacheManager.clearCache();
        const cachedReport = files.find(file => file.fsPath.includes('/htmlcov/'));
        CacheManager.cacheResults(cachedReport.fsPath, result(cachedReport.fsPath));
        const enhanced = await SecretDetector.scanWorkspaceEnhanced();
        assert.deepEqual(scanned.slice().sort(), expected);
        assert.deepEqual(enhanced.map(secret => secret.file).sort(), expected, 'Do not reintroduce excluded reports from cache');

        SecretDetector.startFileWatcher();
        for (const event of ['change', 'create']) {
            scheduled.length = 0;
            for (const file of files) await handlers[event](file);
            assert.deepEqual(scheduled.slice().sort(), expected, `${event} events obey generated and per-workspace exclusions`);
        }
        mock.workspace.workspaceFolders = [folders[1]];
        scheduled.length = 0;
        await handlers.change(files[0]);
        assert.equal(scheduled.length, 0, 'Do not scan a folder that has since been closed');
        console.log('PASS: htmlcov/caches skipped, source/env/credentials retained, per-folder ignores and watcher/cache consistency');
    } finally {
        SecretDetector.stopFileWatcher(); CacheManager.clearCache();
        SecretDetector.scanFile = originalScan; SecretDetector.scanFileEnhanced = originalEnhanced;
        SecretDetector.debounceFileScan = originalDebounce;
        fs.rmSync(temp, { recursive: true, force: true });
    }
}
main().then(() => process.exit(0), error => { console.error(error); process.exit(1); });

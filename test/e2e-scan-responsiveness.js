/** Large real scan must service timers; workspace scans must bound concurrent files. */
const assert = require('assert/strict');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const os = require('os');
const Module = require('module');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dotenvy-responsive-'));
const folder = { uri: { fsPath: root } };
const files = Array.from({ length: 12 }, (_, index) => ({ scheme: 'file', fsPath: path.join(root, `sample-${index}.ts`) }));
for (const file of files) fs.writeFileSync(file.fsPath, '// synthetic file\n');
const mock = {
    EventEmitter: class { event = () => ({ dispose() {} }); fire() {} },
    workspace: { workspaceFolders: [folder], findFiles: async () => files,
        getWorkspaceFolder: () => folder,
        asRelativePath: file => path.basename(file), getConfiguration: () => ({ get: () => false }) },
    window: { createOutputChannel: () => ({ appendLine() {}, show() {}, clear() {} }), showInformationMessage() {} }
};
const originalRequire = Module.prototype.require;
Module.prototype.require = function (name) { return name === 'vscode' ? mock : originalRequire.apply(this, arguments); };
const { SecretDetector } = require('../out/utils/secretDetector');
const { CacheManager } = require('../out/utils/cacheManager');
const originalRead = fsp.readFile, originalScan = SecretDetector.scanFileEnhanced;
let timer;
async function main() {
    try {
        const big = path.join(root, 'large.ts');
        const value = 'sk-SyntheticResponsivenessValue0123456789AbCdEf';
        fs.writeFileSync(big, '// ordinary source line without a candidate\n'.repeat(30000) + `const API_KEY = "${value}";\n`);
        let heartbeats = 0;
        fsp.readFile = async (...args) => {
            const content = await originalRead(...args);
            // Start only after I/O, so a timer during file loading cannot hide starvation.
            if (args[0] === big) timer = setInterval(() => { heartbeats++; }, 1);
            return content;
        };
        const result = await SecretDetector.scanFile(big);
        clearInterval(timer); fsp.readFile = originalRead;
        assert.ok(heartbeats > 1, 'Event-loop timers must run during line scanning, not just during file loading');
        assert.ok(result.some(secret => secret.sourceFile === big && secret.valueLength === value.length), 'Yielding must preserve full-value detections');

        CacheManager.clearCache();
        let active = 0, peak = 0;
        const completed = [];
        SecretDetector.scanFileEnhanced = async (file, index) => {
            active++; peak = Math.max(peak, active);
            try {
                await new Promise(resolve => setTimeout(resolve, 2 + (index % 3)));
                completed.push(file);
                return [{ file: path.basename(file), line: 1, column: 1, content: 'masked', confidence: 'high' }];
            } finally { active--; }
        };
        const workspaceResult = await SecretDetector.scanWorkspaceEnhanced();
        assert.ok(peak <= 4, 'Do not start unbounded file scans or overflow the inference queue');
        assert.ok(peak > 1, 'Keep useful file concurrency');
        assert.equal(completed.length, files.length);
        assert.equal(workspaceResult.length, files.length, 'Do not drop results when limiting concurrency');
        for (const file of files) {
            assert.equal(CacheManager.getCachedResults(file.fsPath)[0].file, path.basename(file.fsPath), 'Keep cache entries aligned with their source file');
        }
        console.log(`PASS: ${heartbeats} timer heartbeats during real line scanning; peak ${peak} file scans; all results retained`);
    } finally {
        clearInterval(timer); fsp.readFile = originalRead; SecretDetector.scanFileEnhanced = originalScan;
        CacheManager.clearCache(); fs.rmSync(root, { recursive: true, force: true });
    }
}
main().then(() => process.exit(0), error => { console.error(error); process.exit(1); });

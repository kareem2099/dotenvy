/** Imports are module paths; credentials beside them and in remote URLs still count. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { createHarness, installVscodeMock, useWorkspace, bindExtensionContext } = require('./support/vscodeMock');
const harness = installVscodeMock(createHarness());
bindExtensionContext(harness);
const { SecretDetector } = require('../out/utils/secretDetector');
const { scanText } = require('../out/utils/localSecretScan');
const { CacheManager } = require('../out/utils/cacheManager');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dotenvy-module-specifiers-'));
useWorkspace(harness, root);
harness.vscode.workspace.getWorkspaceFolder = () => harness.vscode.workspace.workspaceFolders[0];
const file = path.join(root, 'app.ts');
const key = 'sk-' + 'SyntheticModuleRegression0123456789AbCdEf';
const pathName = './providers/historyWebviewProvider';
const negativeCases = [
    `import { HistoryWebviewProvider } from '${pathName}';`,
    `import type { AnalyticsWebviewProvider } from './providers/analyticsWebviewProvider';`,
    `import './providers/environmentWebviewProvider';`,
    `import * as Settings from '@scope/environmentWebviewProvider123';`,
    `export { TimelineWebviewProvider } from './providers/timelineWebviewProvider';`,
    `export * from './providers/environmentWebviewProvider';`,
    `import {\n  HistoryWebviewProvider,\n  AnalyticsWebviewProvider\n} /* module comment */ from\n '${pathName}';`,
    `const lazy = import(\n '${pathName}'\n);`,
    `const legacy = require('${pathName}');`,
    `const resolved = require.resolve('${pathName}');`,
    `import legacy = require('${pathName}');`,
    `// preceding import comment\nimport { HistoryWebviewProvider } from '${pathName}';`,
    `import { hashModule } from './providers/0123456789abcdef0123456789abcdef';`,
];
async function main() {
    try {
        for (const source of negativeCases) {
            assert.equal((await SecretDetector.scanText(file, source)).length, 0, source);
            assert.equal(scanText(source).length, 0, 'Synchronous hook scanner: ' + source);
        }
        const actualImports = fs.readFileSync(path.join(__dirname, '../src/extension.ts'), 'utf8')
            .split('\n').filter(line => line.startsWith('import ')).join('\n');
        assert.equal((await SecretDetector.scanText(file, actualImports)).length, 0);
        assert.equal(scanText(actualImports).length, 0);

        const positives = [
            `import { X } from '${pathName}'; const API_KEY = '${key}';`,
            `const API_KEY = '${key}'; import { X } from '${pathName}';`,
            `import { X } from 'https://example.invalid/module?token=${key}';`,
            `import '${key}';`, // A known credential prefix must not become an ignored module.
            `// import { X } from '${key}';`,
            `const documentation = "import { X } from '${key}';";`,
            `const API_KEY = '${key}'; // import { X } from '${pathName}';`,
            `/* import { X } from '${pathName}'; */ const API_KEY = '${key}';`,
            `const require = '${key}';`,
            `API_KEY=${key}`, // .env-style content has no module declaration.
            `const secret = '${Buffer.from('SyntheticOnlyModuleRegression0123456789').toString('base64')}';`,
            `const digest = '${'0123456789abcdef'.repeat(2)}';`,
        ];
        for (const source of positives) {
            assert.ok((await SecretDetector.scanText(file, source)).length, 'Preserve credential: ' + source);
            assert.ok(scanText(source).length, 'Synchronous scanner preserves credential: ' + source);
        }
        const encoded = `const encodedValue = '${Buffer.from('SyntheticOnlyModuleRegression0123456789').toString('base64')}';`;
        assert.ok((await SecretDetector.scanText(file, encoded)).some(hit => hit.type === 'Base64 Encoded Data'));
        assert.ok(scanText(encoded).some(hit => hit.type === 'Base64 Encoded Data'));
        const imports = negativeCases.join('\n');
        fs.writeFileSync(file, imports);
        assert.equal((await SecretDetector.scanFile(file)).length, 0);
        harness.vscode.workspace.findFiles = async () => [{ scheme: 'file', fsPath: file }];
        assert.equal((await SecretDetector.scanWorkspace()).length, 0);
        CacheManager.clearCache();
        assert.equal((await SecretDetector.scanWorkspaceEnhanced()).length, 0);
        assert.equal((await SecretDetector.scanWorkspaceEnhanced()).length, 0, 'Cached rescan');
        console.log('Module specifiers: real extension imports, static/multiline/dynamic loading, editor/disk/workspace/hook scans passed; credentials retained.');
    } finally {
        CacheManager.clearCache();
        fs.rmSync(root, { recursive: true, force: true });
    }
}
main().then(() => process.exit(0)).catch(error => { console.error(error); process.exit(1); });

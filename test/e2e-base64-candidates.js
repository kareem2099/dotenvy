/** Public URLs/paths must not become Base64 hits; embedded credentials must survive. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { createHarness, installVscodeMock, useWorkspace, bindExtensionContext } = require('./support/vscodeMock');
const harness = installVscodeMock(createHarness());
bindExtensionContext(harness);
const { SecretDetector } = require('../out/utils/secretDetector');
const { scanText } = require('../out/utils/localSecretScan');
const { CacheManager } = require('../out/utils/cacheManager');
const { readDetectedValue } = require('../out/utils/detectedSecretValue');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dotenvy-base64-candidates-'));
useWorkspace(harness, root);
harness.vscode.workspace.getWorkspaceFolder = () => harness.vscode.workspace.workspaceFolders[0];
harness.vscode.workspace.openTextDocument = async uri => ({
    lineAt: index => ({ text: fs.readFileSync(uri.fsPath, 'utf8').split('\n')[index] }),
});
const file = path.join(root, 'links.ts');
const bytes = Buffer.from('Synthetic regression credential values 0123456789 ABCDEF');
const padded = bytes.toString('base64');
const key = 'sk-' + 'SyntheticURLRegression0123456789AbCdEf';
async function main() {
    try {
        const source = fs.readFileSync(path.join(__dirname, '../src/commands/feedback.ts'), 'utf8');
        assert.equal((await SecretDetector.scanText(file, source)).length, 0, 'Actual feedback.ts links');
        assert.equal(scanText(source).length, 0, 'Hook scanner: actual feedback.ts');
        const publicValues = [
            'https://github.com/kareem2099/dotenvy/issues/new?template=bug-report.yml',
            'https://marketplace.visualstudio.com/items?itemName=FreeRave.dotenvy#review-details',
            'https://github.com/kareem2099/dotenvy/discussions',
            'https://publicRepositoryDocumentationHost123456789/publicDocumentationPath12345',
            './providers/historyWebviewProvider',
            '/docs/publicDocumentationPath1234567890.html',
            'prefix.' + padded,
            'prefix-' + padded,
            padded + '.suffix',
            padded + '-suffix',
            padded + '===', // invalid padding must not yield a shortened valid substring.
            'A'.repeat(33), // impossible Base64 length, not a complete token.
            padded + 'AB', // noncanonical unused trailing bits in an unpadded token.
        ];
        for (const value of publicValues) {
            const line = `const link = '${value}';`;
            assert.equal((await SecretDetector.scanText(file, line)).length, 0, value);
            assert.equal(scanText(line).length, 0, 'Hook scanner: ' + value);
        }
        for (const length of [24, 25, 26, 27]) {
            const encoded = Buffer.from('Synthetic0123456789ABCDEFxyz'.slice(0, length)).toString('base64');
            for (const value of [encoded, encoded.replace(/=+$/, '')]) {
                const line = `const encodedValue = '${value}';`;
                const hits = await SecretDetector.scanText(file, line);
                assert.ok(hits.some(hit => hit.type === 'Base64 Encoded Data'), 'Padded/unpadded Base64');
                assert.ok(scanText(line).some(hit => hit.type === 'Base64 Encoded Data'));
            }
        }
        const embedded = [
            `const url = 'https://example.invalid/download?token=${padded}&mode=read';`,
            `const url = 'https://user:${padded}@example.invalid/download';`,
            `const url = 'https://example.invalid/#${padded}';`,
        ];
        for (const line of embedded) {
            const hits = await SecretDetector.scanText(file, line);
            const hit = hits.find(item => item.type === 'Base64 Encoded Data');
            assert.ok(hit, 'Credential within URL');
            assert.equal(hit.column - 1, line.indexOf(padded));
            assert.equal(hit.valueLength, padded.length);
            assert.equal(hit.valueDigest, crypto.createHash('sha256').update(padded).digest('hex'));
            fs.writeFileSync(file, line);
            assert.equal((await readDetectedValue(hit)).value, padded);
            const spans = scanText(line).filter(item => item.type === 'Base64 Encoded Data');
            assert.ok(spans.some(span => line.slice(span.start, span.end) === padded));
        }
        for (const line of [
            `const url = 'https://example.invalid/?token=${key}';`,
            `const url = 'https://example.invalid/public/path'; const API_KEY = '${key}';`,
        ]) {
            assert.ok((await SecretDetector.scanText(file, line)).length);
            assert.ok(scanText(line).length);
        }
        fs.writeFileSync(file, source);
        harness.vscode.workspace.findFiles = async () => [{ scheme: 'file', fsPath: file }];
        assert.equal((await SecretDetector.scanFile(file)).length, 0);
        assert.equal((await SecretDetector.scanWorkspace()).length, 0);
        assert.equal((await SecretDetector.scanWorkspaceEnhanced()).length, 0);
        console.log('Base64 candidates: actual feedback URLs, boundaries/padding, local paths, snapshots/disk/workspace/hooks and embedded credential spans passed.');
    } finally {
        CacheManager.clearCache();
        fs.rmSync(root, { recursive: true, force: true });
    }
}
main().then(() => process.exit(0)).catch(error => { console.error(error); process.exit(1); });

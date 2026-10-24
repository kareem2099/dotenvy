/** Security boundaries for Git uploads and the VSCE package manifest. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { minimatch } = require('minimatch');
const root = path.join(__dirname, '..');
const sensitive = [
    '.env', '.env.dev', '.env.backup', '.env.local', 'production.env', '.envrc',
    '.dotenvy.json', '.dotenvy.lock.json', '.dotenvyGit.json',
    '.dotenvy/history/2026-10.json', '.dotenvy-backups/project.zip',
    '.railway-credentials.json', '.railway/config.json', '.aws/credentials',
    '.ssh/id_ed25519', 'private.pem', 'private.key', 'client.p12', 'client.pfx',
    'app.keystore', 'credentials.json', 'gcp-credentials.json',
    'gcp-service-account.json', 'gcp-service_account.json', 'gcp-serviceaccount.json',
    'backup.master.enc', 'backup.bak', 'backup.backup', 'backups/env.json',
];
const safe = ['src/extension.ts', 'resources/icons/icon.png', 'resources/icons/activity-bar.svg',
    'resources/panel/panel.js', 'test/e2e-pr-integration.js', 'package.json', 'package-lock.json',
    '.vscode/launch.example.json', 'test/e2e-doppler-onboarding.js'];
const paths = sensitive.flatMap(name => [name, 'resources/private/' + name, 'packages/app/' + name]);

function packageExcluded(name) {
    let ignored = false;
    for (const raw of fs.readFileSync(path.join(root, '.vscodeignore'), 'utf8').split(/\r?\n/)) {
        const line = raw.trim();
        if (!line || line.startsWith('#')) continue;
        const negative = line.startsWith('!');
        if (minimatch(name, negative ? line.slice(1) : line, { dot: true })) ignored = !negative;
    }
    return ignored;
}
test('Git excludes local credential files at every depth and preserves source/test assets', () => {
    const result = spawnSync('git', ['check-ignore', '--no-index', '--', ...paths, '.vscode/launch.json', ...safe], {
        cwd: root, encoding: 'utf8', timeout: 5000,
    });
    assert.equal(result.status, 0, result.stderr);
    const ignored = new Set(result.stdout.split('\n'));
    for (const name of [...paths, '.vscode/launch.json']) assert.ok(ignored.has(name), name);
    for (const name of safe) assert.ok(!ignored.has(name), name);
    const tracked = spawnSync('git', ['ls-files', '.dotenvy.json', '.dotenvy.lock.json', '.vscode/launch.json'],
        { cwd: root, encoding: 'utf8', timeout: 5000 });
    assert.equal(tracked.status, 0);
    assert.equal(tracked.stdout, '', 'Ignore rules do not protect files already in the index');
});
test('Package allowlist ships bundles and runtime assets, and exclusions override it', () => {
    for (const name of [...paths, '.env.example', 'resources/private/.env.example', '.vscode/extensions.json',
        'test/releaseSafety.test.js', 'dotenvy-2.3.0.vsix', 'resources/private/archive.zip']) {
        assert.ok(packageExcluded(name), name);
    }
    for (const name of ['dist/extension.js', 'dist/git-hook.js', 'package.json', 'package.nls.ar.json',
        'resources/icons/icon.png', 'resources/icons/activity-bar.svg', 'resources/panel/panel.css',
        'resources/panel/panel.html', 'resources/panel/panel.js', 'README.md', 'CHANGELOG.md', 'LICENSE']) {
        assert.ok(!packageExcluded(name), name);
    }
    // Bundles replace the unbundled compiler output, sources and dependencies.
    for (const name of ['out/extension.js', 'out/utils/secretDetector.js', 'src/extension.ts',
        'dist/extension.js.map', 'resources/panel/styles/index.css', 'resources/icons/ICON_DESIGN.md',
        'node_modules/uuid/dist-node/index.js', 'esbuild.mjs', 'test/envFiles.test.js']) {
        assert.ok(packageExcluded(name), name);
    }
});

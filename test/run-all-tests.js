#!/usr/bin/env node

/**
 * DotEnvy test runner.
 * Lists test files explicitly so `node --test` does not rediscover helpers
 * or leftover scripts under test/.
 */

const { spawnSync } = require('child_process');
const path = require('path');

const testFiles = [
    'encryption.test.js',
    'llmScanner.test.js',
    'userManager.test.js',
    'secretsAndHook.test.js',
    'envFiles.test.js',
    'dopplerProjectSlug.test.js',
    'commandPasswords.test.js',
    'cloudAndSession.test.js',
    'historyAndTrash.test.js',
].map((fileName) => path.join(__dirname, fileName));

const result = spawnSync(
    process.execPath,
    ['--test', '--test-concurrency=1', '--test-force-exit', ...testFiles],
    { stdio: 'inherit' },
);

process.exit(result.status === null ? 1 : result.status);

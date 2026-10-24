#!/usr/bin/env node

/**
 * DotEnvy test runner.
 * Lists test files explicitly so `node --test` does not rediscover helpers
 * or leftover scripts under test/.
 */

const { spawnSync } = require('child_process');
const path = require('path');

const testSuites = [
    { name: 'Automatic Doppler Connection', file: 'e2e-doppler-onboarding.js', offline: true },
    { name: 'Base64 URL and Token Boundaries', file: 'e2e-base64-candidates.js', offline: true },
    { name: 'Module Specifier False Positives', file: 'e2e-module-specifiers.js', offline: true },
    { name: 'Analytics History and Dashboard Recording', file: 'e2e-analytics-history.js', offline: true },
    { name: "PR Integration Regressions", file: "e2e-pr-integration.js", offline: true },
    { name: 'Doppler Connection and Dashboard', file: 'e2e-doppler-connection.js', offline: true },
    { name: 'File Change Review Notification', file: 'e2e-secret-notification.js', offline: true },
    { name: 'Generated Files and Workspace Ignore Rules', file: 'e2e-scan-exclusions.js', offline: true },
    { name: 'Scanner Event Loop Responsiveness', file: 'e2e-scan-responsiveness.js', offline: true },
    { name: 'Secrets Scanner Source Navigation', file: 'e2e-secret-navigation.js', offline: true },
    { name: 'Dashboard Initialization Actions', file: 'e2e-init-actions.js', offline: true },
    { name: 'Security and Feedback Regressions', file: 'e2e-security-regressions.js', offline: true },
    { name: 'Encryption Algorithms & PBKDF2 Standalone', file: 'encryption-test-standalone.js' },
    { name: 'Master Key Lifecycle, Password Migration & Backups', file: 'e2e-master-key-and-backup.js' }
];

console.log('🧪 Running Complete DotEnvy Test Suite');
console.log('==============================================\n');

let allPassed = true;

for (const suite of testSuites) {
    console.log(`▶️  Starting: ${suite.name} (${suite.file})`);
    console.log('─'.repeat(50));
    
    const suitePath = path.join(__dirname, suite.file);
    const args = suite.offline ? ['--require', path.join(__dirname, 'deny-network.js'), suitePath] : [suitePath];
    const result = spawnSync(process.execPath, args, { stdio: 'inherit' });

    console.log('─'.repeat(50));
    if (result.status === 0) {
        console.log(`✅ [${suite.name}] Passed!\n`);
    } else {
        console.error(`❌ [${suite.name}] Failed with exit code ${result.status}\n`);
        allPassed = false;
    }
}

const nodeTests = ['cloudAndSession.test.js', 'commandPasswords.test.js', 'dopplerProjectSlug.test.js', 'encryption.test.js', 'envFiles.test.js', 'historyAndTrash.test.js', 'releaseSafety.test.js', 'secretsAndHook.test.js', 'userManager.test.js'].map(file => path.join(__dirname, file));
const nodeResult = spawnSync(process.execPath,
    ['--test', '--test-concurrency=1', '--test-force-exit', ...nodeTests], { stdio: 'inherit' });
if (nodeResult.status !== 0) allPassed = false;

console.log('==============================================');
if (allPassed) {
    console.log('🎉 ALL TEST SUITES PASSED!');
    process.exit(0);
} else {
    console.error('💥 SOME TEST SUITES FAILED. Check logs above.');
    process.exit(1);
}

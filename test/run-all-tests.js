#!/usr/bin/env node

/**
 * DotEnvy Master Test Runner
 * Executes all test suites and reports unified status.
 */

const { spawnSync } = require('child_process');
const path = require('path');

const testSuites = [
    { name: 'Post-Correction Community Consent', file: 'e2e-community-consent.js', offline: true },
    { name: 'Private Community Learning and Model Updates', file: 'e2e-community-learning.js' },
    { name: 'Local Transformer and Worker Parity', file: 'e2e-local-model.js', offline: true },
    { name: 'Security and Feedback Regressions', file: 'e2e-security-regressions.js', offline: true },
    { name: 'Encryption Algorithms & PBKDF2 Standalone', file: 'encryption-test-standalone.js' },
    { name: 'Offline AI Scanner and No-Network Contract', file: 'e2e-llm-logic.js', offline: true },
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

console.log('==============================================');
if (allPassed) {
    console.log('🎉 ALL TEST SUITES PASSED!');
    process.exit(0);
} else {
    console.error('💥 SOME TEST SUITES FAILED. Check logs above.');
    process.exit(1);
}

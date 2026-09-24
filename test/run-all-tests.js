#!/usr/bin/env node

/**
 * DotEnvy Master Test Runner
 * Executes all test suites and reports unified status.
 */

const { spawnSync } = require('child_process');
const path = require('path');

const testSuites = [
    { name: 'Encryption Algorithms & PBKDF2 Standalone', file: 'encryption-test-standalone.js' },
    { name: 'L1–L4 Multi-Layer AI Scanner & HMAC Logic', file: 'e2e-llm-logic.js' },
    { name: 'Master Key Lifecycle, Password Migration & Backups', file: 'e2e-master-key-and-backup.js' }
];

console.log('🧪 Running Complete DotEnvy v2.1.0 Test Suite');
console.log('==============================================\n');

let allPassed = true;

for (const suite of testSuites) {
    console.log(`▶️  Starting: ${suite.name} (${suite.file})`);
    console.log('─'.repeat(50));
    
    const suitePath = path.join(__dirname, suite.file);
    const result = spawnSync(process.execPath, [suitePath], { stdio: 'inherit' });

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
    console.log('🎉 ALL TEST SUITES PASSED! DotEnvy v2.1.0 is verified and ready.');
    process.exit(0);
} else {
    console.error('💥 SOME TEST SUITES FAILED. Check logs above.');
    process.exit(1);
}

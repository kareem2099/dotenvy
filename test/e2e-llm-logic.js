#!/usr/bin/env node

/**
 * E2E Logic Test: LLM Analyzer Layers & Community Sync
 *
 * Verifies that the L1-L4 detection system is working as expected
 * and that HMAC signing is correctly implemented.
 */

const crypto = require('crypto');
const path = require('path');
const https = require('https');
const assert = require('assert');

// ─── Mock VS Code ───────────────────────────────────────────────────────────
const mockConfig = new Map();
const vscodeMock = {
    ExtensionMode: { Development: 1, Test: 2, Production: 3 },
    window: {
        showInformationMessage: () => Promise.resolve(),
        showWarningMessage: () => Promise.resolve(),
        createOutputChannel: () => ({
            appendLine: () => {},
            show: () => {},
            clear: () => {}
        }),
    },
    workspace: {
        getConfiguration: () => ({
            get: (key, defaultVal) => mockConfig.has(key) ? mockConfig.get(key) : defaultVal
        })
    },
    env: {
        machineId: 'test-machine-id-' + crypto.randomBytes(4).toString('hex')
    }
};

// Override require to return mock for 'vscode'
const Module = require('module');
const originalRequire = Module.prototype.require;
Module.prototype.require = function (packageName) {
    if (packageName === 'vscode') {
        return vscodeMock;
    }
    return originalRequire.apply(this, arguments);
};

// ─── Import LLMAnalyzer ──────────────────────────────────────────────────────
// Note: We access the compiled JS from /out
const { LLMAnalyzer } = require('../out/utils/llmAnalyzer.js');

// ─── Test Suite ─────────────────────────────────────────────────────────────
async function runTests() {
    console.log('🧠 E2E Logic Test: LLM Analyzer Layers & Sync');
    console.log('=============================================\n');

    const mockSecrets = new Map();
    const mockContext = {
        secrets: {
            get: (key) => Promise.resolve(mockSecrets.get(key)),
            store: (key, val) => { mockSecrets.set(key, val); return Promise.resolve(); }
        },
        extensionMode: vscodeMock.ExtensionMode.Development
    };

    // Initialize Analyzer
    const analyzer = await LLMAnalyzer.initialize(mockContext);

    // Set a test secret
    const TEST_SECRET = 'test-shared-secret-key-12345';
    await analyzer.setSharedSecret(TEST_SECRET);

    console.log('✅ Analyzer initialized with mock context & secret.\n');

    // --- Test 1: L1 Regex Detection ---
    console.log('🔍 Test 1: L1 Regex Detection (Stripe Key)');
    const stripeKey = ['sk', 'test', '51P2uLkY4swARAAFa4Fd9ZkGQMockKey'].join('_');
    const l1Result = await analyzer.analyzeSecret(stripeKey, 'const key = "' + stripeKey + '";', 'STRIPE_KEY');

    if (l1Result === 'high') {
        console.log('✅ Pass: L1 caught the Stripe key via Regex.\n');
    } else {
        console.log('❌ Fail: L1 missed the Stripe key. Got:', l1Result, '\n');
    }

    // --- Test 2: L3 Entropy Gate ---
    console.log('🔍 Test 2: L3 Entropy Gate (Low Entropy)');
    const lowEntropy = 'password123';
    const l3Result = await analyzer.analyzeSecret(lowEntropy, 'pass=' + lowEntropy, 'PASSWORD');

    if (l3Result === 'low') {
        console.log('✅ Pass: L3 blocked low-entropy strings from hitting LLM.\n');
    } else {
        console.log('❌ Fail: L3 allowed low-entropy string to pass. Got:', l3Result, '\n');
    }

    // --- Test 3: HMAC Signing Logic ---
    console.log('🛡️  Test 3: HMAC Signing Logic');
    const testBody = JSON.stringify({ test: "data" });

    // We use 'any' cast here to access a private method for testing purposes
    const analyzer_any = analyzer;
    const { timestamp, signature } = analyzer_any.signRequest(testBody);

    if (timestamp && signature) {
        console.log(`✅ Signature generated: ${signature.substring(0, 10)}...`);

        // Manual verification of HMAC (Matches algorithm in llmAnalyzer.ts)
        const expected = crypto.createHmac('sha256', TEST_SECRET)
            .update(`${timestamp}.${testBody}`) // <--- FIXED: uses dot (.) not colon (:)
            .digest('hex');

        if (signature === expected) {
            console.log('✅ Pass: HMAC signature matches local calculation.');
        } else {
            console.log('❌ Fail: HMAC signature mismatch!');
            console.log('   Expected:', expected);
            console.log('   Got:     ', signature);
        }
    } else {
        console.log('❌ Fail: Could not generate signature.\n');
    }

    // --- Test 4: Community Blacklist Hashing ---
    console.log('\n📦 Test 4: Community Blacklist Hashing');
    const varName = 'DB_PASSWORD';
    const varValue = 'very-secret-password-123';
    const hash = analyzer.hashEntry(varName, varValue);

    console.log(`   Variable: ${varName}`);
    console.log(`   Hash:     ${hash}`);

    if (hash && hash.length === 64) {
        // Verify prefix logic (first 8 chars of value)
        const expectedValue = JSON.stringify([varName, varValue]);
        const expectedHash = crypto.createHash('sha256')
            .update(expectedValue)
            .digest('hex');

        if (hash === expectedHash) {
            console.log('✅ Pass: Blacklist hash matches algorithm expectations.\n');
        } else {
            console.log('❌ Fail: Hash mismatch!');
        }
    } else {
        console.log('❌ Fail: Invalid hash generated.\n');
    }

    // --- Test 5: Local Fallback Gate (Cloud Analysis Disabled) ---
    console.log('🔒 Test 5: Local-First Gate (enableCloudAnalysis = false)');
    mockConfig.set('secrets.enableCloudAnalysis', false);
    const candidateValue = 'd8f7a6b5c4e3f2a1b0c9d8e7f6a5b4c3';
    const highRiskContext = 'const DB_PASSWORD = "' + candidateValue + '";';

    // Monkey patch makeSignedRequest to detect any network invocation
    const originalMakeSignedRequest = analyzer.makeSignedRequest;
    let networkAttempted = false;
    analyzer.makeSignedRequest = async () => {
        networkAttempted = true;
        throw new Error('NETWORK CALL DETECTED: makeSignedRequest should not be called when cloud analysis is disabled!');
    };

    const localResult = await analyzer.analyzeSecret(candidateValue, highRiskContext, 'DB_PASSWORD');

    if (!networkAttempted && (localResult === 'high' || localResult === 'medium')) {
        console.log(`✅ Pass: Local fallback successfully evaluated (${localResult}) with ZERO outbound network calls.\n`);
    } else if (networkAttempted) {
        console.log('❌ Fail: Network request was triggered despite enableCloudAnalysis=false!\n');
    } else {
        console.log('❌ Fail: Unexpected local fallback result:', localResult, '\n');
    }

    // --- Test 6: Cloud Analysis Opt-In Gate (enableCloudAnalysis = true) ---
    console.log('☁️  Test 6: Cloud Analysis Opt-In Gate (enableCloudAnalysis = true)');
    mockConfig.set('secrets.enableCloudAnalysis', true);
    const endpointsCalled = [];
    analyzer.makeSignedRequest = async (endpoint, _data) => {
        endpointsCalled.push(endpoint);
        return { is_likely_secret: true, risk_level: 'high', enhanced_confidence: 'high' };
    };

    const cloudResult = await analyzer.analyzeSecret(candidateValue, highRiskContext, 'DB_PASSWORD');
    analyzer.makeSignedRequest = originalMakeSignedRequest;
    mockConfig.set('secrets.enableCloudAnalysis', false);

    if (endpointsCalled.includes('/extension/analyze') && cloudResult === 'high') {
        console.log(`✅ Pass: When cloud analysis is explicitly enabled, remote analyzer is properly contacted (${endpointsCalled.join(', ')}).\n`);
    } else {
        console.log('❌ Fail: Remote analyzer not contacted when enabled. Endpoints:', endpointsCalled, 'Result:', cloudResult, '\n');
    }

    assert.equal(l1Result, 'high');
    assert.equal(l3Result, 'low');
    assert.equal(signature, crypto.createHmac('sha256', TEST_SECRET).update(`${timestamp}.${testBody}`).digest('hex'));
    assert.equal(hash.length, 64);
    assert.equal(hash, crypto.createHash('sha256').update(JSON.stringify([varName, varValue])).digest('hex'));
    assert.equal(networkAttempted, false);
    assert.ok(['medium', 'high'].includes(localResult));
    assert.ok(endpointsCalled.includes('/extension/analyze'));
    assert.equal(cloudResult, 'high');
    console.log('🎉 E2E Logic tests completed successfully!');
}

runTests().catch(err => {
    console.error('\n❌ E2E Logic Test Failed!');
    console.error(err);
    process.exit(1);
});

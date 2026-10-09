/**
 * Local classifier and signed transport smoke tests.
 */

const { describe, test, before } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');

const { createHarness, installVscodeMock } = require('./support/vscodeMock');

installVscodeMock(createHarness());

const { LLMAnalyzer } = require('../out/utils/llmAnalyzer.js');
const { signRequest } = require('../out/utils/llmSignedTransport.js');
const { NUM_FEATURES } = require('../out/utils/featureExtractor.js');

describe('llm scanner local branches', () => {
    let analyzer;

    before(async () => {
        const harness = createHarness();
        analyzer = await LLMAnalyzer.initialize(harness.context);
    });

    test('a Stripe test key is not classified as low risk', async () => {
        const stripeKey = ['sk', 'test', '51P2uLkY4swARAAFa4Fd9ZkGQMockKey'].join('_');
        const risk = await analyzer.analyzeSecret(stripeKey, `const key = "${stripeKey}";`);
        assert.notEqual(risk, 'low');
    });

    test('extractFeatures returns the fixed feature vector size', () => {
        const features = analyzer.extractFeatures('password123', 'pass=password123', 'PASSWORD');
        assert.equal(features.length, NUM_FEATURES);
    });

    test('signRequest is HMAC-SHA256 over timestamp, a dot, and the body', () => {
        const secret = 'test-shared-secret-key-12345';
        const body = JSON.stringify({ test: 'data' });
        const signed = signRequest(secret, body);
        const expected = crypto.createHmac('sha256', secret).update(`${signed.timestamp}.${body}`).digest('hex');
        assert.equal(signed.signature, expected);
    });

    test('reports local inference mode', () => {
        const status = analyzer.getServiceStatus();
        assert.equal(status.mode, 'local');
        assert.equal(status.numFeatures, NUM_FEATURES);
    });
});

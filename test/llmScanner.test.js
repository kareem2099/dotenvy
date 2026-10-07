/**
 * Local scanner branches only. Network calls from device registration are stubbed
 * so a missing analysis service cannot hang or silently pass the suite.
 */

const { describe, test, before } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { EventEmitter } = require('events');

const { createHarness, installVscodeMock } = require('./support/vscodeMock');

installVscodeMock(createHarness());

function disableNetwork() {
    const request = () => {
        const req = new EventEmitter();
        req.end = () => {
            process.nextTick(() => req.emit('error', new Error('network disabled in tests')));
        };
        req.write = () => {};
        req.destroy = () => {};
        req.setTimeout = () => req;
        return req;
    };
    require('https').request = request;
    require('http').request = request;
}

disableNetwork();

const { LLMAnalyzer } = require('../out/utils/llmAnalyzer.js');
const { signRequest } = require('../out/utils/llmSignedTransport.js');

describe('llm scanner local branches', () => {
    let analyzer;

    before(async () => {
        const harness = createHarness();
        analyzer = await LLMAnalyzer.initialize(harness.context);
    });

    test('a Stripe test key is high risk before any network call', async () => {
        const stripeKey = ['sk', 'test', '51P2uLkY4swARAAFa4Fd9ZkGQMockKey'].join('_');
        const risk = await analyzer.analyzeSecret(stripeKey, `const key = "${stripeKey}";`);
        assert.equal(risk, 'high');
    });

    test('a low-entropy password stays low and does not reach the model', async () => {
        const risk = await analyzer.analyzeSecret('password123', 'pass=password123', 'PASSWORD');
        assert.equal(risk, 'low');
    });

    test('signRequest is HMAC-SHA256 over timestamp, a dot, and the body', () => {
        const secret = 'test-shared-secret-key-12345';
        const body = JSON.stringify({ test: 'data' });
        const signed = signRequest(secret, body);
        const expected = crypto.createHmac('sha256', secret).update(`${signed.timestamp}.${body}`).digest('hex');
        assert.equal(signed.signature, expected);
    });

    test('blacklist hash is the first 16 hex chars of sha256(name:value prefix)', () => {
        const variableName = 'DB_PASSWORD';
        const variableValue = 'very-secret-password-123';
        const expected = crypto.createHash('sha256')
            .update(`${variableName}:${variableValue.slice(0, 8)}`)
            .digest('hex')
            .substring(0, 16);
        assert.equal(analyzer.hashEntry(variableName, variableValue), expected);
    });
});

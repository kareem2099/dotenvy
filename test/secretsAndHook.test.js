/**
 * Secret patterns, ignore rules, entropy bands, and the pre-commit hook.
 */

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const { createHarness, installVscodeMock, useWorkspace, bindExtensionContext } = require('./support/vscodeMock');
const { createTempDir, removeTempDir } = require('./support/tempWorkspace');

const harness = installVscodeMock(createHarness());
bindExtensionContext(harness);

const { PatternRegistry } = require('../out/utils/patternRegistry.js');
const { DotenvyIgnore } = require('../out/utils/dotenvyIgnore.js');
const { EntropyAnalyzer } = require('../out/utils/entropyAnalyzer.js');
const { getRiskLevelFromScore } = require('../out/utils/secretContextHeuristics.js');
const { FileUtils } = require('../out/utils/fileUtils.js');
const { GitHookManager } = require('../out/utils/gitHookManager.js');
const { scanText } = require('../out/utils/localSecretScan.js');
const { FeedbackManager } = require('../out/utils/feedbackManager.js');

function pem(kind) {
    return `X-----BEGIN ${kind}-----\nMIIB\n-----END ${kind}-----Y`;
}

/** Build assignment-shaped fixtures without secret-like literals in source (for CI scanners). */
function envLikeAssignment(keyCodePoints, value) {
    return `${String.fromCharCode(...keyCodePoints)}="${value}"`;
}

const PATTERN_CASES = [
    { type: 'Generic API Key', positive: `sk_${'a'.repeat(20)}` },
    { type: 'Stripe Secret Key', positive: `sk-${'A'.repeat(20)}` },
    { type: 'Stripe Publishable Key', positive: `pk_${'a'.repeat(16)}` },
    { type: 'SendGrid API Key', positive: `sg.${'a'.repeat(16)}` },
    { type: 'DigitalOcean Token', positive: `dop_v1_${'a'.repeat(20)}` },
    { type: 'Vercel Token', positive: `vercel_${'a'.repeat(16)}` },
    { type: 'GitHub Personal Access Token', positive: `ghp_${'a'.repeat(20)}` },
    { type: 'GitHub OAuth Token', positive: `gho_${'a'.repeat(20)}` },
    { type: 'Slack API Token', positive: 'xoxb-111-222-abcDEF' },
    { type: 'AWS Access Key ID', positive: `AKIAI${'0123456789ABCDEF'}` },
    { type: 'OpenAI API Key', positive: `sk-${'A'.repeat(20)}` },
    { type: 'Mailgun API Key', positive: `MailgunApiKey-${'a'.repeat(20)}` },
    { type: 'Twilio Auth Token', positive: `TwilioAuthToken-${'a'.repeat(20)}` },
    { type: 'Sentry DSN', positive: `SENTRY_DSN=${'a'.repeat(20)}` },
    {
        type: 'Generic Password',
        positive: envLikeAssignment([112, 97, 115, 115, 119, 111, 114, 100], 'abcdefgh'),
    },
    {
        type: 'Generic Secret',
        positive: envLikeAssignment([115, 101, 99, 114, 101, 116], 'abcdefghijkl'),
    },
    { type: 'SSH RSA Private Key', positive: pem('RSA PRIVATE KEY') },
    { type: 'SSH DSA Private Key', positive: pem('DSA PRIVATE KEY') },
    { type: 'SSH EC Private Key', positive: pem('EC PRIVATE KEY') },
    { type: 'SSH OpenSSH Private Key', positive: pem('OPENSSH PRIVATE KEY') },
    { type: 'SSL Certificate', positive: pem('CERTIFICATE') },
    { type: 'JWT Token', positive: `eyJ${'A'.repeat(20)}` },
    { type: 'MD5 Hash', positive: 'ab'.repeat(16) },
    { type: 'SHA-1 Hash', positive: 'ab'.repeat(20) },
    { type: 'SHA-256 Hash', positive: 'ab'.repeat(32) },
    { type: 'Database URL', positive: ['postgres://user:', 'pass', '@host/db'].join('') },
    {
        type: 'MongoDB Atlas URL',
        positive: `mongodb+srv://user:${'pass' + 'word'}@host`,
    },
    { type: 'Redis URL', positive: 'redis://localhost1/data' },
    { type: 'Google Cloud Secret Manager', positive: 'projects/demo/secrets/api/versions/1' },
    { type: 'Base64 Encoded Data', positive: `${'Aa1+'.repeat(7)}Zz9x`, negative: '!'.repeat(32) },
];

function patternMatches(pattern, text) {
    pattern.regex.lastIndex = 0;
    return pattern.regex.test(text);
}

function runGit(cwd, args) {
    const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
    assert.equal(result.status, 0, (result.stderr || result.stdout || `git ${args.join(' ')}`).trim());
}

describe('secret patterns, ignore, and hook', { concurrency: 1 }, () => {
    test('each registered pattern matches its prefix and rejects a same-length decoy', () => {
        PatternRegistry.initialize();
        const patterns = PatternRegistry.getPatterns();
        assert.equal(patterns.length, PATTERN_CASES.length);

        for (const sample of PATTERN_CASES) {
            const pattern = patterns.find((entry) => entry.type === sample.type);
            assert.ok(pattern, sample.type);
            const negative = sample.negative || 'z'.repeat(sample.positive.length);
            assert.equal(patternMatches(pattern, sample.positive), true, `${sample.type} positive`);
            assert.equal(patternMatches(pattern, negative), false, `${sample.type} negative`);
        }
    });

    test('dotenvyignore comments, stars, negation, and builtin names', () => {
        const root = createTempDir('dotenvy-ignore-');
        try {
            fs.writeFileSync(path.join(root, '.dotenvyignore'), [
                '# comment',
                '',
                'keep/*',
                'tree/**',
                '!tree/keep.txt',
            ].join('\n'), 'utf8');

            const at = (relativePath) => DotenvyIgnore.shouldIgnore(path.join(root, relativePath), root);
            assert.equal(at('readme.md'), false);
            assert.equal(at(path.join('keep', 'file.txt')), true);
            assert.equal(at(path.join('keep', 'nested', 'file.txt')), false);
            assert.equal(at(path.join('tree', 'a', 'b.txt')), true);
            assert.equal(at(path.join('tree', 'keep.txt')), false);
            assert.equal(at(path.join('tree', 'drop.txt')), true);
        } finally {
            removeTempDir(root);
        }

        const bare = createTempDir('dotenvy-ignore-builtin-');
        try {
            const nested = path.join(bare, 'node_modules', 'pkg', 'index.js');
            const lockfile = path.join(bare, 'package-lock.json');
            const source = path.join(bare, 'src', 'app.js');
            assert.equal(DotenvyIgnore.isBuiltinIgnored(nested, bare), true);
            assert.equal(DotenvyIgnore.shouldIgnore(nested, bare), true);
            assert.equal(DotenvyIgnore.isBuiltinIgnored(lockfile, bare), true);
            assert.equal(DotenvyIgnore.shouldIgnore(lockfile, bare), true);
            assert.equal(DotenvyIgnore.shouldIgnore(source, bare), false);

            const testFixture = path.join(bare, 'test', 'e2e-llm-logic.js');
            assert.equal(DotenvyIgnore.isBuiltinIgnored(testFixture, bare), true);
            assert.equal(DotenvyIgnore.shouldIgnore(testFixture, bare), true);

            const colocatedTest = path.join(bare, 'src', 'app.test.js');
            assert.equal(DotenvyIgnore.isBuiltinIgnored(colocatedTest, bare), true);
        } finally {
            removeTempDir(bare);
        }
    });

    test('entropy confidence sits on either side of 3.5 and 4.5', () => {
        const justUnderHigh = 'abcdefghijklmnopqrstuv';
        const justOverHigh = 'abcdefghijklmnopqrstuvw';
        const justOverMedium = 'abcdefghijkl';
        const justUnderMedium = 'abcdefghijka';

        assert.equal(justUnderHigh.length >= 20, true);
        assert.equal(justOverHigh.length >= 20, true);
        assert.ok(EntropyAnalyzer.calculateEntropy(justUnderHigh) < 4.5);
        assert.ok(EntropyAnalyzer.calculateEntropy(justOverHigh) >= 4.5);
        assert.equal(EntropyAnalyzer.getConfidence(justUnderHigh), 'medium');
        assert.equal(EntropyAnalyzer.getConfidence(justOverHigh), 'high');

        assert.equal(justOverMedium.length, 12);
        assert.equal(justUnderMedium.length, 12);
        assert.ok(EntropyAnalyzer.calculateEntropy(justOverMedium) >= 3.5);
        assert.ok(EntropyAnalyzer.calculateEntropy(justUnderMedium) < 3.5);
        assert.equal(EntropyAnalyzer.getConfidence(justOverMedium), 'medium');
        assert.equal(EntropyAnalyzer.getConfidence(justUnderMedium), 'low');
        assert.equal(EntropyAnalyzer.getConfidence(''), 'low');
    });

    test('risk score bands include 0.5 and 0.8', () => {
        assert.equal(getRiskLevelFromScore(0.49), 'low');
        assert.equal(getRiskLevelFromScore(0.5), 'medium');
        assert.equal(getRiskLevelFromScore(0.79), 'medium');
        assert.equal(getRiskLevelFromScore(0.8), 'high');
    });

    test('checkForSecrets flags secret-like key names and skips comments', () => {
        const root = createTempDir('dotenvy-secrets-');
        const filePath = path.join(root, 'notes.txt');
        try {
            fs.writeFileSync(filePath, [
                '# PASSWORD=hidden',
                'NOEQUALS',
                'FOO=bar',
                'PASSWORD=x',
                'API_TOKEN=y',
            ].join('\n'), 'utf8');
            assert.deepEqual(FileUtils.checkForSecrets(filePath), [
                'PASSWORD (line 4)',
                'API_TOKEN (line 5)',
            ]);
        } finally {
            removeTempDir(root);
        }
    });

    test('pre-commit blocks a staged .env, allows it when configured, and still blocks PASSWORD=', async () => {
        const root = createTempDir('dotenvy-hook-');
        try {
            useWorkspace(harness, root, 'hook-workspace');
            runGit(root, ['init']);
            fs.writeFileSync(path.join(root, '.env'), 'FOO=bar\n', 'utf8');
            runGit(root, ['add', '.env']);

            const blockedEnv = await GitHookManager.runPreCommitChecks(root);
            assert.equal(blockedEnv.blocked, true);

            fs.writeFileSync(
                path.join(root, '.dotenvy.json'),
                JSON.stringify({ gitCommitHook: { blockEnvFiles: false } }),
                'utf8',
            );
            const allowedEnv = await GitHookManager.runPreCommitChecks(root);
            assert.equal(allowedEnv.blocked, false);

            fs.writeFileSync(path.join(root, 'notes.txt'), 'PASSWORD=x\n', 'utf8');
            runGit(root, ['add', 'notes.txt']);
            const blockedSecret = await GitHookManager.runPreCommitChecks(root);
            assert.equal(blockedSecret.blocked, true);
            assert.match(blockedSecret.message, /PASSWORD/);
        } finally {
            removeTempDir(root);
        }
    });

    test('local scan marks a Stripe secret key and ignores a short string', () => {
        const hits = scanText('NOTE=sk-Ab3xY7kLm2Qp9Vw4Nz8R\n');
        assert.equal(hits.some((hit) => hit.type === 'Stripe Secret Key'), true);
        assert.deepEqual(scanText('abcdef'), []);
    });

    test('pre-commit blocks a staged Stripe token on a neutral key', async () => {
        const root = createTempDir('dotenvy-hook-stripe-');
        try {
            useWorkspace(harness, root, 'hook-stripe');
            runGit(root, ['init']);
            fs.writeFileSync(
                path.join(root, '.dotenvy.json'),
                JSON.stringify({ gitCommitHook: { blockEnvFiles: false } }),
                'utf8',
            );
            fs.writeFileSync(path.join(root, 'notes.txt'), 'NOTE=sk-Ab3xY7kLm2Qp9Vw4Nz8R\n', 'utf8');
            runGit(root, ['add', 'notes.txt']);

            const blocked = await GitHookManager.runPreCommitChecks(root);
            assert.equal(blocked.blocked, true);
            assert.match(blocked.message, /Stripe Secret Key/);
        } finally {
            removeTempDir(root);
        }
    });

    test('getStats counts confirmed and false positives still waiting to send', async () => {
        FeedbackManager.init(harness.context);
        await harness.context.globalState.update('dotenvy.feedback.entries', [
            { user_action: 'confirmed_secret', sent: false },
            { user_action: 'marked_false_positive', sent: false },
        ]);
        try {
            const stats = await FeedbackManager.getStats();
            assert.equal(stats.confirmed, 1);
            assert.equal(stats.falsePositives, 1);
            assert.equal(stats.pending, 2);
            assert.equal(stats.total, 2);
        } finally {
            await harness.context.globalState.update('dotenvy.feedback.entries', []);
        }
    });
});

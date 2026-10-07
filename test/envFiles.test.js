/**
 * Environment file diff, validation, sync merge, and discovery.
 */

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { createHarness, installVscodeMock } = require('./support/vscodeMock');
const { createTempDir, removeTempDir } = require('./support/tempWorkspace');

installVscodeMock(createHarness());

const { EnvironmentDiffer } = require('../out/utils/environmentDiffer.js');
const { EnvironmentValidator } = require('../out/utils/environmentValidator.js');
const { formatEnvFileContent, mergeEnvFileContent, parseEnvFile } = require('../out/utils/envFileContent.js');
const { EnvSyncUtils, DOPPLER_RESERVED_KEYS } = require('../out/utils/envSyncUtils.js');
const { discoverEnvironments } = require('../out/utils/environmentDiscovery.js');
const { findValueConflicts } = require('../out/utils/crossEnvironmentConflicts.js');
const { diffCloudSecrets } = require('../out/utils/cloudSecretDiff.js');

function writeFile(filePath, content) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content, 'utf8');
}

function targetFor(filePath, fileName) {
    return {
        file: fileName,
        absolutePath: filePath,
        keyPrefix: '',
        prefixes: [],
        catchAll: true,
        label: fileName,
    };
}

describe('environment files', () => {
    test('diff reports added, removed, and changed keys and ignores comments', () => {
        const root = createTempDir('dotenvy-diff-');
        try {
            const fileA = path.join(root, 'a.env');
            const fileB = path.join(root, 'b.env');
            writeFile(fileA, 'ONLY_A=1\nSHARED=old\n\n# comment\n');
            writeFile(fileB, 'ONLY_B=2\nSHARED=new\n');

            const diff = EnvironmentDiffer.compareFiles(fileA, fileB);
            assert.deepEqual(diff.added.map((item) => item.key), ['ONLY_B']);
            assert.deepEqual(diff.removed.map((item) => item.key), ['ONLY_A']);
            assert.equal(diff.changed.length, 1);
            assert.equal(diff.changed[0].variable.key, 'SHARED');
            assert.equal(diff.changed[0].oldValue, 'old');
            assert.equal(diff.changed[0].newValue, 'new');
            assert.deepEqual(diff.unchanged, []);
        } finally {
            removeTempDir(root);
        }
    });

    test('validator flags syntax, missing keys, number type, and custom regex', () => {
        const root = createTempDir('dotenvy-validate-');
        const filePath = path.join(root, '.env');
        try {
            writeFile(filePath, 'NOT_A_PAIR\nPORT=12\nCOUNT=abc\nCODE=nope\n');
            const errors = EnvironmentValidator.validateFile(filePath, {
                requiredVariables: ['MISSING'],
                variableTypes: { PORT: 'number', COUNT: 'number' },
                customValidators: { CODE: '^yes$' },
            });

            assert.equal(errors.some((error) => error.type === 'syntax'), true);
            assert.equal(errors.some((error) => error.type === 'missing' && error.variable === 'MISSING'), true);
            assert.equal(errors.some((error) => error.type === 'type' && error.variable === 'PORT'), false);
            assert.equal(errors.some((error) => error.type === 'type' && error.variable === 'COUNT'), true);
            assert.equal(errors.some((error) => error.type === 'custom' && error.variable === 'CODE'), true);
        } finally {
            removeTempDir(root);
        }
    });

    test('merge pull keeps comments, spacing blocks, and updates values', () => {
        const original = [
            '# Backend local',
            '',
            'HOST=localhost  # bind address',
            'PORT=3000',
            '',
            'REMOVED=old',
        ].join('\n');

        const merged = mergeEnvFileContent(original, {
            HOST: '127.0.0.1',
            PORT: '3000',
            NEW: 'yes',
        });

        assert.match(merged, /# Backend local/);
        assert.match(merged, /HOST=127\.0\.0\.1  # bind address/);
        assert.match(merged, /PORT=3000/);
        assert.doesNotMatch(merged, /REMOVED=old/);
        assert.match(merged, /NEW=yes/);
        const root = createTempDir('dotenvy-merge-');
        const filePath = path.join(root, '.env');
        try {
            writeFile(filePath, merged);
            assert.deepEqual(parseEnvFile(filePath), {
                HOST: '127.0.0.1  # bind address',
                PORT: '3000',
                NEW: 'yes',
            });
        } finally {
            removeTempDir(root);
        }
    });

    test('format then parse keeps values, including embedded equals, and drops comments', () => {
        const root = createTempDir('dotenvy-parse-');
        const filePath = path.join(root, '.env');
        try {
            const secrets = { FOO: 'bar', URL: 'postgres://u:p@h/db' };
            writeFile(filePath, `# comment\n\n${formatEnvFileContent(secrets)}`);
            assert.deepEqual(parseEnvFile(filePath), secrets);

            writeFile(filePath, 'TOKEN=abc=def\n');
            assert.equal(parseEnvFile(filePath).TOKEN, 'abc=def');
        } finally {
            removeTempDir(root);
        }
    });

    test('cloud merge lets the later target win and pull preview hides metadata keys', () => {
        const root = createTempDir('dotenvy-sync-');
        try {
            const firstPath = path.join(root, 'first.env');
            const secondPath = path.join(root, 'second.env');
            const livePath = path.join(root, '.env');
            writeFile(firstPath, 'API=one\n');
            writeFile(secondPath, 'API=two\n');

            const merged = EnvSyncUtils.mergeTargetsSecretsForCloud(root, [
                targetFor(firstPath, 'first.env'),
                targetFor(secondPath, 'second.env'),
            ]);
            assert.equal(merged.secrets.API, 'two');
            assert.deepEqual(merged.duplicateKeys, ['API']);

            writeFile(livePath, 'KEEP=1\nOLD=a\nGONE=x\n');
            const cloud = {
                KEEP: '1',
                OLD: 'b',
                NEW: 'z',
                DOTENVY_ENCRYPTED: '1',
                __dotenvy_encrypted__: '1',
                [DOPPLER_RESERVED_KEYS[0]]: 'dev',
            };
            const liveTarget = targetFor(livePath, '.env');
            const split = EnvSyncUtils.splitSecretsAcrossTargets(cloud, [liveTarget], root);
            const written = split.get('.env');
            assert.deepEqual(Object.keys(written).sort(), ['KEEP', 'NEW', 'OLD']);

            const preview = EnvSyncUtils.calculatePullChanges([liveTarget], cloud);
            assert.deepEqual(preview.newKeys, ['NEW']);
            assert.deepEqual(preview.changedKeys, ['OLD']);
            assert.deepEqual(preview.removedKeys, ['GONE']);
        } finally {
            removeTempDir(root);
        }
    });

    test('the longer cloud prefix wins, and unmatched keys stay on the catch-all file', () => {
        const root = createTempDir('dotenvy-prefix-');
        try {
            const backendPath = path.join(root, 'backend.env');
            const frontendPath = path.join(root, 'frontend.env');
            const extraPath = path.join(root, 'extra.env');
            writeFile(backendPath, '');
            writeFile(frontendPath, '');
            writeFile(extraPath, '');

            const backend = {
                ...targetFor(backendPath, 'backend.env'),
                keyPrefix: 'BACKEND_',
                catchAll: true,
            };
            const frontend = {
                ...targetFor(frontendPath, 'frontend.env'),
                keyPrefix: 'FRONTEND_',
                prefixes: ['VITE_'],
                catchAll: false,
            };
            const extra = {
                ...targetFor(extraPath, 'extra.env'),
                keyPrefix: 'BACKEND_EXTRA_',
                catchAll: false,
            };

            const split = EnvSyncUtils.splitSecretsAcrossTargets({
                BACKEND_DB: 'postgres',
                BACKEND_EXTRA_FOO: 'nested',
                FRONTEND_API: 'https://app.example',
                VITE_TOKEN: 'vite-token',
                SHARED: 'plain',
            }, [backend, frontend, extra], root);

            assert.deepEqual(split.get('backend.env'), { DB: 'postgres', SHARED: 'plain' });
            assert.deepEqual(split.get('frontend.env'), {
                API: 'https://app.example',
                VITE_TOKEN: 'vite-token',
            });
            assert.deepEqual(split.get('extra.env'), { FOO: 'nested' });
        } finally {
            removeTempDir(root);
        }
    });

    test('discovery maps suffixed env files and skips root .env, examples, and node_modules', async () => {
        const root = createTempDir('dotenvy-discover-');
        try {
            writeFile(path.join(root, '.env'), 'A=1\n');
            writeFile(path.join(root, '.env.local'), 'A=1\n');
            writeFile(path.join(root, '.env.production'), 'A=1\n');
            writeFile(path.join(root, '.env.example'), 'A=1\n');
            writeFile(path.join(root, '.env.backup'), 'A=1\n');
            writeFile(path.join(root, '.env.template'), 'A=1\n');
            writeFile(path.join(root, 'notes.txt'), 'A=1\n');
            writeFile(path.join(root, 'node_modules', '.env.local'), 'A=1\n');
            writeFile(path.join(root, 'sub', '.env'), 'A=1\n');

            const found = await discoverEnvironments(root);
            assert.equal(found.local, '.env.local');
            assert.equal(found.production, '.env.production');
            assert.equal(found['sub-local'], 'sub/.env');
            assert.equal(Object.values(found).includes('.env'), false);
            assert.equal(Object.keys(found).includes('example'), false);
            assert.equal(Object.keys(found).includes('backup'), false);
            assert.equal(Object.keys(found).includes('template'), false);
            assert.equal(Object.values(found).some((value) => value.includes('node_modules')), false);
            assert.equal(Object.values(found).includes('notes.txt'), false);
        } finally {
            removeTempDir(root);
        }
    });

    test('value conflicts require the same key with different values', () => {
        const files = [
            {
                name: 'development',
                relativePath: '.env.development',
                content: 'API_KEY=one\n# COMMENTED=skip\nNOEQUALS\nSHARED=same\nONLY_DEV=1\nAPI_KEY=one\n',
            },
            {
                name: 'production',
                relativePath: '.env.production',
                content: 'API_KEY=two\nSHARED=same\nONLY_PROD=2\n',
            },
        ];

        const conflicts = findValueConflicts(files);
        assert.deepEqual(conflicts.map((conflict) => conflict.key), ['API_KEY']);

        const sameValue = findValueConflicts([
            { name: 'development', relativePath: '.env.development', content: 'API_KEY=old\nAPI_KEY=same\nSHARED=same\n# GONE=1\nBROKEN\n' },
            { name: 'production', relativePath: '.env.production', content: 'API_KEY=same\nSHARED=same\n' },
        ]);
        assert.deepEqual(sameValue, []);

        const onlyOneFile = findValueConflicts([
            { name: 'development', relativePath: '.env.development', content: 'ONLY_DEV=1\n' },
            { name: 'production', relativePath: '.env.production', content: 'ONLY_PROD=2\n' },
        ]);
        assert.deepEqual(onlyOneFile, []);
    });

    test('cloud diff drops remote metadata and keeps an unlisted DOPPLER_ key', () => {
        const reservedKey = DOPPLER_RESERVED_KEYS[0];
        const diff = diffCloudSecrets(
            { ONLY_LOCAL: 'local', BOTH: '1' },
            {
                ONLY_REMOTE: 'remote',
                BOTH: '2',
                DOTENVY_ENCRYPTED: 'cipher',
                __dotenvy_encrypted__: 'legacy',
                [reservedKey]: 'meta',
                DOPPLER_CUSTOM: 'stays',
            },
        );

        assert.deepEqual(diff.remoteOnly.sort(), ['DOPPLER_CUSTOM', 'ONLY_REMOTE']);
        assert.deepEqual(diff.localOnly, ['ONLY_LOCAL']);
        assert.deepEqual(diff.changed, ['BOTH']);
        assert.equal(diff.remoteOnly.includes('DOTENVY_ENCRYPTED'), false);
        assert.equal(diff.remoteOnly.includes('__dotenvy_encrypted__'), false);
        assert.equal(diff.remoteOnly.includes(reservedKey), false);
    });
});

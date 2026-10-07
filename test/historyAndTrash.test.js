/**
 * History filters, archive limits, entry diff, and the in-memory trash bin.
 */

const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { createHarness, installVscodeMock, useWorkspace, bindExtensionContext } = require('./support/vscodeMock');
const { createTempDir, removeTempDir } = require('./support/tempWorkspace');

const harness = installVscodeMock(createHarness());
bindExtensionContext(harness);

const { HistoryFilters } = require('../out/utils/historyFilters.js');
const { saveHistoryEntry, enforceMaxHistoryEntries, importHistoryArchive } = require('../out/utils/historyArchive.js');
const { HistoryManager } = require('../out/utils/historyManager.js');
const { calculateHistoryDiffWithBlame } = require('../out/utils/historyEntryDiff.js');
const { analyzeVariableChanges } = require('../out/utils/historyVariableChanges.js');
const { calculateStabilityMetrics } = require('../out/utils/historyStabilityMetrics.js');
const { TrashBinManager } = require('../out/utils/trashBinManager.js');

function historyEntry(overrides) {
    return {
        id: overrides.id,
        timestamp: overrides.timestamp,
        action: overrides.action || 'manual_edit',
        environmentName: overrides.environmentName || 'local',
        fileContent: overrides.fileContent || '',
        user: overrides.user,
        metadata: { workspace: overrides.workspace || 'ws' },
    };
}

describe('history and trash', { concurrency: 1 }, () => {
    let root;

    before(() => {
        root = createTempDir('dotenvy-history-');
        useWorkspace(harness, root, 'history-workspace');
    });

    after(() => {
        removeTempDir(root);
    });

    test('date edges are inclusive, search is literal, and invalid regex is rejected', async () => {
        const start = new Date('2026-06-01T00:00:00.000Z');
        const end = new Date('2026-06-02T00:00:00.000Z');
        const entries = [
            historyEntry({ id: 'before', timestamp: new Date(start.getTime() - 1), fileContent: 'A=1', user: 'ada' }),
            historyEntry({ id: 'start', timestamp: start, fileContent: 'NEEDLE=1', user: 'ada' }),
            historyEntry({ id: 'end', timestamp: end, fileContent: 'TOKEN=1\n', user: 'grace' }),
            historyEntry({ id: 'after', timestamp: new Date(end.getTime() + 1), fileContent: 'B=1', user: 'grace' }),
        ];

        const byDate = await HistoryFilters.applyFilters(entries, { dateRange: { start, end } });
        assert.deepEqual(byDate.entries.map((entry) => entry.id), ['start', 'end']);

        const bySearch = await HistoryFilters.applyFilters(entries, { searchQuery: 'NEEDLE' });
        assert.deepEqual(bySearch.entries.map((entry) => entry.id), ['start']);

        const byUser = await HistoryFilters.applyFilters(entries, { users: ['ada'] });
        assert.deepEqual(byUser.entries.map((entry) => entry.id), ['before', 'start']);

        const byVariable = await HistoryFilters.applyFilters(entries, { variables: ['TOKEN'] });
        assert.deepEqual(byVariable.entries.map((entry) => entry.id), ['end']);

        const regexCheck = HistoryFilters.validateRegex('[');
        assert.equal(regexCheck.valid, false);

        const literalBracket = await HistoryFilters.applyFilters(
            [
                historyEntry({ id: 'bracket', timestamp: start, fileContent: 'A=[x]' }),
                historyEntry({ id: 'plain', timestamp: start, fileContent: 'A=x' }),
            ],
            { searchQuery: '[', searchRegex: true },
        );
        assert.deepEqual(literalBracket.entries.map((entry) => entry.id), ['bracket']);
    });

    test('max history entries drops the oldest, and import counts only complete rows', async () => {
        fs.writeFileSync(
            path.join(root, '.dotenvy.json'),
            JSON.stringify({ history: { maxEntries: 2, enabled: true, autoCleanup: false } }),
            'utf8',
        );
        fs.mkdirSync(await HistoryManager.getHistoryDir(root), { recursive: true });

        const oldest = historyEntry({
            id: 'old',
            timestamp: new Date('2026-10-01T00:00:00.000Z'),
            fileContent: 'A=1',
        });
        const middle = historyEntry({
            id: 'mid',
            timestamp: new Date('2026-10-02T00:00:00.000Z'),
            fileContent: 'A=2',
        });
        const newest = historyEntry({
            id: 'new',
            timestamp: new Date('2026-10-03T00:00:00.000Z'),
            fileContent: 'A=3',
        });
        await saveHistoryEntry(root, oldest);
        await saveHistoryEntry(root, middle);
        await saveHistoryEntry(root, newest);
        await enforceMaxHistoryEntries(root);

        const kept = await HistoryManager.getHistory(root);
        assert.deepEqual(kept.map((entry) => entry.id), ['new', 'mid']);

        const importFile = path.join(root, 'archive.json');
        fs.writeFileSync(importFile, JSON.stringify({
            entries: [
                { id: 'imported', timestamp: '2026-10-04T00:00:00.000Z', action: 'import', fileContent: 'B=1' },
                { id: 'partial', timestamp: '2026-10-04T00:00:00.000Z', action: 'import' },
            ],
        }), 'utf8');
        assert.equal(await importHistoryArchive(root, importFile), 1);

        const badFile = path.join(root, 'bad.json');
        fs.writeFileSync(badFile, JSON.stringify({ foo: 1 }), 'utf8');
        assert.equal(await importHistoryArchive(root, badFile), 0);
    });

    test('history diff, variable frequency, and stability use a hand-built pair of snapshots', async () => {
        const diffRoot = createTempDir('dotenvy-diff-history-');
        try {
            useWorkspace(harness, diffRoot, 'diff-workspace');
            fs.mkdirSync(await HistoryManager.getHistoryDir(diffRoot), { recursive: true });
            await saveHistoryEntry(diffRoot, historyEntry({
                id: 'base',
                timestamp: new Date('2026-01-01T00:00:00.000Z'),
                fileContent: 'A=1\nB=2\n',
                environmentName: 'prod',
            }));

            const diff = await calculateHistoryDiffWithBlame(diffRoot, 'A=1\nC=3\n');
            assert.ok(diff);
            assert.deepEqual(diff.added.map((item) => item.key), ['C']);
            assert.deepEqual(diff.removed.map((item) => item.key), ['B']);
            assert.deepEqual(diff.changed, []);
            assert.deepEqual(diff.unchanged.map((item) => item.key), ['A']);

            const day = 24 * 60 * 60 * 1000;
            const first = historyEntry({
                id: 'v1',
                timestamp: new Date('2026-03-01T00:00:00.000Z'),
                environmentName: 'prod',
                fileContent: 'KEY=1\nOTHER=only\n',
            });
            const second = historyEntry({
                id: 'v2',
                timestamp: new Date(first.timestamp.getTime() + day),
                environmentName: 'prod',
                fileContent: 'KEY=2\n',
            });
            const changes = analyzeVariableChanges([first, second]);
            assert.equal(changes.changeFrequency.KEY, 1);
            assert.equal(changes.currentValue.KEY, '2');
            assert.equal(changes.changeFrequency.OTHER, 0);

            const stability = calculateStabilityMetrics([first, second]);
            assert.equal(stability.totalChanges.prod, 2);
        } finally {
            useWorkspace(harness, root, 'history-workspace');
            removeTempDir(diffRoot);
        }
    });

    test('trash clearWorkspace removes one workspace and leaves the other', () => {
        const bin = TrashBinManager.getInstance();
        bin.clearAll();
        const first = bin.push({
            key: 'A',
            oldValue: '1',
            environmentFile: '.env',
            workspacePath: path.join(root, 'one'),
            type: 'deleted',
        });
        bin.push({
            key: 'B',
            oldValue: '2',
            environmentFile: '.env',
            workspacePath: path.join(root, 'two'),
            type: 'deleted',
        });

        assert.equal(bin.remove(first.id), true);
        assert.equal(bin.getForWorkspace(path.join(root, 'one')).length, 0);

        bin.push({
            key: 'C',
            oldValue: '3',
            environmentFile: '.env',
            workspacePath: path.join(root, 'one'),
            type: 'modified',
            newValue: '4',
        });
        bin.clearWorkspace(path.join(root, 'one'));
        assert.equal(bin.getForWorkspace(path.join(root, 'one')).length, 0);
        assert.equal(bin.getForWorkspace(path.join(root, 'two')).length, 1);
        bin.clearAll();
    });
});

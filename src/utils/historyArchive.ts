/**
 * Retention, export, and import for environment history files.
 */

import * as fs from 'fs';
import * as path from 'path';
import { HistoryEntry } from '../types/environment';
import { HistoryManager } from './historyManager';
import { logger } from './logger';

function historyFilename(timestamp: Date): string {
    const year = timestamp.getFullYear();
    const month = String(timestamp.getMonth() + 1).padStart(2, '0');
    return `${year}-${month}.json`;
}

/**
 * Appends one history entry to the monthly history file for the workspace.
 */
export async function saveHistoryEntry(rootPath: string, entry: HistoryEntry): Promise<void> {
    entry.timestamp = new Date(entry.timestamp);
    const historyDir = await HistoryManager.getHistoryDir(rootPath);
    const filename = historyFilename(entry.timestamp);
    const filePath = path.join(historyDir, filename);

    let entries: HistoryEntry[] = [];

    if (fs.existsSync(filePath)) {
        try {
            const content = fs.readFileSync(filePath, 'utf8');
            entries = JSON.parse(content);

            entries.forEach(existing => {
                existing.timestamp = new Date(existing.timestamp);
            });
        } catch (error) {
            entries = [];
        }
    }

    entries.push(entry);
    entries.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

    const jsonContent = JSON.stringify(entries, null, 2);
    fs.writeFileSync(filePath, jsonContent, 'utf8');
}

/**
 * Drops history entries older than the configured retention window.
 */
export async function cleanupOldHistoryEntries(rootPath: string): Promise<number> {
    const config = await HistoryManager.getConfig();
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - config.retentionDays);

    const historyDir = await HistoryManager.getHistoryDir(rootPath);
    if (!fs.existsSync(historyDir)) return 0;

    let removedCount = 0;
    const files = fs.readdirSync(historyDir);

    for (const file of files) {
        if (!file.endsWith('.json') || file === 'analytics-cache.json') continue;

        const filePath = path.join(historyDir, file);
        try {
            const content = fs.readFileSync(filePath, 'utf8');
            const entries: HistoryEntry[] = JSON.parse(content);

            const filteredEntries = entries.filter(entry => {
                const entryDate = new Date(entry.timestamp);
                return entryDate >= cutoffDate;
            });

            if (filteredEntries.length === 0) {
                fs.unlinkSync(filePath);
                removedCount += entries.length;
            } else if (filteredEntries.length < entries.length) {
                const jsonContent = JSON.stringify(filteredEntries, null, 2);
                fs.writeFileSync(filePath, jsonContent, 'utf8');
                removedCount += (entries.length - filteredEntries.length);
            }
        } catch (error) {
            logger.error(`Failed to cleanup history file ${file}:`, error, 'HistoryManager');
        }
    }

    await enforceMaxHistoryEntries(rootPath);

    return removedCount;
}

/**
 * Trims stored history down to the configured maximum entry count.
 */
export async function enforceMaxHistoryEntries(rootPath: string): Promise<void> {
    const config = await HistoryManager.getConfig();
    const allEntries = await HistoryManager.getHistory(rootPath);

    if (allEntries.length <= config.maxEntries) return;

    const entriesToKeep = allEntries.slice(0, config.maxEntries);
    const historyDir = await HistoryManager.getHistoryDir(rootPath);
    const files = fs.readdirSync(historyDir);

    for (const file of files) {
        if (file.endsWith('.json') && file !== 'analytics-cache.json') {
            fs.unlinkSync(path.join(historyDir, file));
        }
    }

    for (const entry of entriesToKeep) {
        await saveHistoryEntry(rootPath, entry);
    }
}

/**
 * Writes the full workspace history to a JSON file.
 */
export async function exportHistoryArchive(rootPath: string, exportPath: string): Promise<void> {
    const entries = await HistoryManager.getHistory(rootPath);
    const exportData = {
        exportedAt: new Date().toISOString(),
        workspace: rootPath,
        entries
    };

    const jsonContent = JSON.stringify(exportData, null, 2);
    fs.writeFileSync(exportPath, jsonContent, 'utf8');
}

/**
 * Loads history entries from an export file into the workspace store.
 */
export async function importHistoryArchive(rootPath: string, importPath: string): Promise<number> {
    try {
        const content = fs.readFileSync(importPath, 'utf8');
        const importData = JSON.parse(content);

        if (!importData.entries || !Array.isArray(importData.entries)) {
            throw new Error('Invalid import file format');
        }

        let importedCount = 0;
        for (const entry of importData.entries) {
            if (entry.id && entry.timestamp && entry.action && entry.fileContent) {
                await saveHistoryEntry(rootPath, entry);
                importedCount++;
            }
        }

        return importedCount;
    } catch (error) {
        logger.error('Failed to import history:', error, 'HistoryManager');
        return 0;
    }
}

/**
 * History Manager for Environment Changes
 * ======================================
 *
 * Manages the complete history of environment file changes, providing
 * audit trails, rollback capabilities, and change visualization.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { HistoryEntry, HistoryConfig, HistoryStats, HistoryMetadata } from '../types/environment';
import { ConfigUtils } from './configUtils';
import { AnalyticsSummary } from './historyAnalytics';
import { HistoryFilterOptions, FilterResult } from './historyFilters';
import { EnvDiff } from './environmentDiffer';
import { logger } from './logger';
import { calculateHistoryDiffWithBlame, readHistoryGitInfo } from './historyEntryDiff';
import {
    cleanupOldHistoryEntries,
    exportHistoryArchive,
    importHistoryArchive,
    saveHistoryEntry,
} from './historyArchive';
import {
    applyHistoryFilters,
    clearHistoryAnalyticsCache,
    generateHistoryAnalytics,
    getHistoryAnalytics,
    getHistoryFilterOptions,
    getHistoryVariableHistory,
    validateHistoryRegex,
} from './historyInsights';

export class HistoryManager {
    private static readonly HISTORY_DIR = '.dotenvy';
    private static readonly HISTORY_SUBDIR = 'history';
    private static readonly DEFAULT_CONFIG: HistoryConfig = {
        enabled: true,
        retentionDays: 180,
        maxEntries: 1000,
        autoCleanup: true,
        trackManualEdits: true,
        includeGitInfo: true
    };

    /**
     * Get history configuration for a workspace
     */
    static async getConfig(): Promise<HistoryConfig> {
        const config = await ConfigUtils.readQuickEnvConfig();
        return {
            ...this.DEFAULT_CONFIG,
            ...config?.history
        };
    }

    /**
     * Get the history storage directory for a workspace
     */
    static async getHistoryDir(rootPath: string): Promise<string> {
        const config = await this.getConfig();
        const baseDir = config.storagePath || path.join(rootPath, this.HISTORY_DIR);
        return path.join(baseDir, this.HISTORY_SUBDIR);
    }

    /**
     * Ensure history directory exists
     */
    private static async ensureHistoryDir(rootPath: string): Promise<void> {
        const historyDir = await this.getHistoryDir(rootPath);
        if (!fs.existsSync(historyDir)) {
            fs.mkdirSync(historyDir, { recursive: true });
        }
    }

    /**
     * Generate a unique ID for history entries
     */
    private static generateId(): string {
        return crypto.randomUUID();
    }

    /**
     * Calculate checksum for content integrity
     */
    private static calculateChecksum(content: string): string {
        return crypto.createHash('sha256').update(content).digest('hex').substring(0, 16);
    }

    /**
     * Record a new history entry
     */
    static async recordEntry(
        rootPath: string,
        action: HistoryEntry['action'],
        environmentName: string,
        fileContent: string,
        fileName = '',
        options: {
            previousEnvironment?: string;
            reason?: string;
            tags?: string[];
            source?: HistoryMetadata['source'];
            diff?: EnvDiff | null;
        } = {}
    ): Promise<HistoryEntry | null> {
        const config = await this.getConfig();
        if (!config.enabled) return null;

        try {
            await this.ensureHistoryDir(rootPath);

            let diffWithBlame = options.diff;
            if (!diffWithBlame) {
                diffWithBlame = await calculateHistoryDiffWithBlame(rootPath, fileContent);
            }

            const entry: HistoryEntry = {
                id: this.generateId(),
                timestamp: new Date(),
                action,
                environmentName,
                fileName: fileName,
                previousEnvironment: options.previousEnvironment,
                fileContent,
                diff: diffWithBlame,
                metadata: {
                    workspace: rootPath,
                    reason: options.reason,
                    tags: options.tags,
                    source: options.source || 'auto',
                    checksum: this.calculateChecksum(fileContent)
                }
            };

            if (config.includeGitInfo) {
                try {
                    const gitInfo = await readHistoryGitInfo(rootPath);
                    entry.user = gitInfo.user;
                    entry.commitHash = gitInfo.commitHash;
                } catch (error) {
                    // Git info is optional, continue without it
                }
            }

            await saveHistoryEntry(rootPath, entry);

            if (config.autoCleanup) {
                await this.cleanupOldEntries(rootPath);
            }

            return entry;
        } catch (error) {
            logger.error('Failed to record history entry:', error, 'HistoryManager');
            return null;
        }
    }

    /**
     * Get all history entries for a workspace
     */
    static async getHistory(rootPath: string, limit?: number): Promise<HistoryEntry[]> {
        const historyDir = await this.getHistoryDir(rootPath);
        if (!fs.existsSync(historyDir)) return [];

        const entries: HistoryEntry[] = [];
        const files = fs.readdirSync(historyDir)
            .filter(file => file.endsWith('.json') && file !== 'analytics-cache.json')
            .sort()
            .reverse();

        for (const file of files) {
            try {
                const filePath = path.join(historyDir, file);
                const content = fs.readFileSync(filePath, 'utf8');
                const fileEntries: HistoryEntry[] = JSON.parse(content);

                fileEntries.forEach(entry => {
                    entry.timestamp = new Date(entry.timestamp);
                });

                entries.push(...fileEntries);

                if (limit && entries.length >= limit) break;
            } catch (error) {
                logger.error(`Failed to load history file ${file}:`, error, 'HistoryManager');
            }
        }

        entries.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

        return limit ? entries.slice(0, limit) : entries;
    }

    /**
     * Get a specific history entry by ID
     */
    static async getEntry(rootPath: string, entryId: string): Promise<HistoryEntry | null> {
        const allEntries = await this.getHistory(rootPath);
        return allEntries.find(entry => entry.id === entryId) || null;
    }

    /**
     * Rollback to a specific history entry
     */
    static async rollbackToEntry(
        rootPath: string,
        entryId: string,
        reason?: string
    ): Promise<boolean> {
        try {
            const entry = await this.getEntry(rootPath, entryId);
            if (!entry) return false;

            const envPath = path.join(rootPath, '.env');

            if (fs.existsSync(envPath)) {
                const backupPath = path.join(rootPath, '.env.rollback-backup');
                fs.copyFileSync(envPath, backupPath);
            }

            fs.writeFileSync(envPath, entry.fileContent, 'utf8');

            await this.recordEntry(
                rootPath,
                'rollback',
                entry.environmentName,
                entry.fileContent,
                entry.fileName || '',
                {
                    previousEnvironment: entry.environmentName,
                    reason: reason || `Rolled back to ${entry.timestamp.toISOString()}`,
                    source: 'manual'
                }
            );

            return true;
        } catch (error) {
            logger.error('Failed to rollback:', error, 'HistoryManager');
            return false;
        }
    }

    /**
     * Get history statistics
     */
    static async getStats(rootPath: string): Promise<HistoryStats> {
        const entries = await this.getHistory(rootPath);

        const entriesByAction: Record<string, number> = {};
        let oldestEntry: Date | undefined;
        let newestEntry: Date | undefined;
        let storageSize = 0;

        for (const entry of entries) {
            entriesByAction[entry.action] = (entriesByAction[entry.action] || 0) + 1;

            if (!oldestEntry || entry.timestamp < oldestEntry) oldestEntry = entry.timestamp;
            if (!newestEntry || entry.timestamp > newestEntry) newestEntry = entry.timestamp;
        }

        const historyDir = await this.getHistoryDir(rootPath);
        if (fs.existsSync(historyDir)) {
            const files = fs.readdirSync(historyDir);
            for (const file of files) {
                const filePath = path.join(historyDir, file);
                storageSize += fs.statSync(filePath).size;
            }
        }

        return {
            totalEntries: entries.length,
            oldestEntry,
            newestEntry,
            entriesByAction,
            storageSize
        };
    }

    /**
     * Clean up old history entries based on retention policy
     */
    static async cleanupOldEntries(rootPath: string): Promise<number> {
        return cleanupOldHistoryEntries(rootPath);
    }

    /**
     * Export history to a file
     */
    static async exportHistory(rootPath: string, exportPath: string): Promise<void> {
        return exportHistoryArchive(rootPath, exportPath);
    }

    /**
     * Import history from a file
     */
    static async importHistory(rootPath: string, importPath: string): Promise<number> {
        return importHistoryArchive(rootPath, importPath);
    }

    /**
     * Generate analytics for history data
     */
    static async generateAnalytics(rootPath: string): Promise<AnalyticsSummary> {
        return generateHistoryAnalytics(rootPath);
    }

    /**
     * Get cached analytics or generate new ones
     */
    static async getAnalytics(rootPath: string, forceRefresh = false): Promise<AnalyticsSummary> {
        return getHistoryAnalytics(rootPath, forceRefresh);
    }

    /**
     * Clear analytics cache
     */
    static async clearAnalyticsCache(rootPath: string): Promise<void> {
        return clearHistoryAnalyticsCache(rootPath);
    }

    /**
     * Apply filters to history entries
     */
    static async applyFilters(rootPath: string, filters: HistoryFilterOptions): Promise<FilterResult> {
        return applyHistoryFilters(rootPath, filters);
    }

    /**
     * Get variable-specific history
     */
    static async getVariableHistory(rootPath: string, variableName: string): Promise<Array<{
        entry: HistoryEntry;
        value: string;
        timestamp: Date;
    }>> {
        return getHistoryVariableHistory(rootPath, variableName);
    }

    /**
     * Get filter options (unique values for dropdowns)
     */
    static async getFilterOptions(rootPath: string): Promise<{
        users: string[];
        environments: string[];
        actions: string[];
        variables: string[];
        dateRangePresets: Array<{ id: string; range: { start?: Date; end?: Date } }>;
        stats: {
            totalEntries: number;
            dateRange: { start: Date; end: Date };
            uniqueUsers: number;
            uniqueEnvironments: number;
            uniqueVariables: number;
            uniqueActions: number;
        };
    }> {
        return getHistoryFilterOptions(rootPath);
    }

    /**
     * Validate regex pattern
     */
    static validateRegex(pattern: string): { valid: boolean; error?: string } {
        return validateHistoryRegex(pattern);
    }
}

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
import { HistoryAnalytics, AnalyticsSummary } from './historyAnalytics';
import { HistoryFilters, HistoryFilterOptions, FilterResult } from './historyFilters';

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
     * Get filename for a history entry based on timestamp
     */
    private static getHistoryFilename(timestamp: Date): string {
        const year = timestamp.getFullYear();
        const month = String(timestamp.getMonth() + 1).padStart(2, '0');
        return `${year}-${month}.json`;
    }

    /**
     * Record a new history entry
     */
    static async recordEntry(
        rootPath: string,
        action: HistoryEntry['action'],
        environmentName: string,
        fileContent: string,
        fileName: string = '', // Provide a default value for fileName
        options: {
            previousEnvironment?: string;
            reason?: string;
            tags?: string[];
            source?: HistoryMetadata['source'];
            diff?: any;
        } = {}
    ): Promise<HistoryEntry | null> {
        const config = await this.getConfig();
        if (!config.enabled) return null;

        try {
            await this.ensureHistoryDir(rootPath);

            // Calculate diff with blame information
            let diffWithBlame = options.diff;
            if (!diffWithBlame) {
                diffWithBlame = await this.calculateDiffWithBlame(rootPath, fileContent);
            }

            const entry: HistoryEntry = {
                id: this.generateId(),
                timestamp: new Date(),
                action,
                environmentName,
                fileName: fileName, // Store fileName
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

            // Add git information if enabled
            if (config.includeGitInfo) {
                try {
                    const gitInfo = await this.getGitInfo(rootPath);
                    entry.user = gitInfo.user;
                    entry.commitHash = gitInfo.commitHash;
                } catch (error) {
                    // Git info is optional, continue without it
                }
            }

            // Save the entry
            await this.saveEntry(rootPath, entry);

            // Auto cleanup if enabled
            if (config.autoCleanup) {
                await this.cleanupOldEntries(rootPath);
            }

            return entry;
        } catch (error) {
            console.error('Failed to record history entry:', error);
            return null;
        }
    }

    /**
     * Save a history entry to file
     */
    private static async saveEntry(rootPath: string, entry: HistoryEntry): Promise<void> {
        const historyDir = await this.getHistoryDir(rootPath);
        const filename = this.getHistoryFilename(entry.timestamp);
        const filePath = path.join(historyDir, filename);

        let entries: HistoryEntry[] = [];

        // Load existing entries for this month
        if (fs.existsSync(filePath)) {
            try {
                const content = fs.readFileSync(filePath, 'utf8');
                entries = JSON.parse(content);

                // Parse timestamps back to Date objects
                entries.forEach(entry => {
                    entry.timestamp = new Date(entry.timestamp);
                });
            } catch (error) {
                // If file is corrupted, start fresh
                entries = [];
            }
        }

        // Add new entry
        entries.push(entry);

        // Sort by timestamp (newest first)
        entries.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

        // Save back to file
        const jsonContent = JSON.stringify(entries, null, 2);
        fs.writeFileSync(filePath, jsonContent, 'utf8');
    }

    /**
     * Get git information for the current state
     */
    private static async getGitInfo(rootPath: string): Promise<{ user?: string; commitHash?: string }> {
        try {
            const { execSync } = require('child_process');

            // Get git user
            let user: string | undefined;
            try {
                user = execSync('git config user.name', { cwd: rootPath, encoding: 'utf8' }).trim();
            } catch (error) {
                // Git user not configured
            }

            // Get current commit hash
            let commitHash: string | undefined;
            try {
                commitHash = execSync('git rev-parse HEAD', { cwd: rootPath, encoding: 'utf8' }).trim();
            } catch (error) {
                // Not in a git repository or no commits
            }

            return { user, commitHash };
        } catch (error) {
            return {};
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
            .filter(file => file.endsWith('.json') && file !== 'analytics-cache.json') // Exclude analytics cache
            .sort()
            .reverse(); // Newest files first

        for (const file of files) {
            try {
                const filePath = path.join(historyDir, file);
                const content = fs.readFileSync(filePath, 'utf8');
                const fileEntries: HistoryEntry[] = JSON.parse(content);

                // Parse timestamps back to Date objects
                fileEntries.forEach(entry => {
                    entry.timestamp = new Date(entry.timestamp);
                });

                entries.push(...fileEntries);

                // Stop if we have enough entries
                if (limit && entries.length >= limit) break;
            } catch (error) {
                console.warn(`Failed to load history file ${file}:`, error);
            }
        }

        // Sort all entries by timestamp (newest first)
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

            // Create backup of current state
            if (fs.existsSync(envPath)) {
                const backupPath = path.join(rootPath, '.env.rollback-backup');
                fs.copyFileSync(envPath, backupPath);
            }

            // Write the historical content
            fs.writeFileSync(envPath, entry.fileContent, 'utf8');

            // Record the rollback in history
            await this.recordEntry(
                rootPath,
                'rollback',
                entry.environmentName,
                entry.fileContent,
                entry.fileName || '', // Pass fileName for rollback, default to empty string
                {
                    previousEnvironment: entry.environmentName,
                    reason: reason || `Rolled back to ${entry.timestamp.toISOString()}`,
                    source: 'manual'
                }
            );

            return true;
        } catch (error) {
            console.error('Failed to rollback:', error);
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
            // Count by action
            entriesByAction[entry.action] = (entriesByAction[entry.action] || 0) + 1;

            // Track oldest/newest
            if (!oldestEntry || entry.timestamp < oldestEntry) oldestEntry = entry.timestamp;
            if (!newestEntry || entry.timestamp > newestEntry) newestEntry = entry.timestamp;
        }

        // Calculate storage size
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
        const config = await this.getConfig();
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - config.retentionDays);

        const historyDir = await this.getHistoryDir(rootPath);
        if (!fs.existsSync(historyDir)) return 0;

        let removedCount = 0;
        const files = fs.readdirSync(historyDir);

        for (const file of files) {
            if (!file.endsWith('.json') || file === 'analytics-cache.json') continue;

            const filePath = path.join(historyDir, file);
            try {
                const content = fs.readFileSync(filePath, 'utf8');
                const entries: HistoryEntry[] = JSON.parse(content);

                // Filter out old entries
                const filteredEntries = entries.filter(entry => {
                    const entryDate = new Date(entry.timestamp);
                    return entryDate >= cutoffDate;
                });

                if (filteredEntries.length === 0) {
                    // Remove empty files
                    fs.unlinkSync(filePath);
                    removedCount += entries.length;
                } else if (filteredEntries.length < entries.length) {
                    // Update file with filtered entries
                    const jsonContent = JSON.stringify(filteredEntries, null, 2);
                    fs.writeFileSync(filePath, jsonContent, 'utf8');
                    removedCount += (entries.length - filteredEntries.length);
                }
            } catch (error) {
                console.warn(`Failed to cleanup history file ${file}:`, error);
            }
        }

        // Also enforce max entries limit
        await this.enforceMaxEntries(rootPath);

        return removedCount;
    }

    /**
     * Enforce maximum entries limit
     */
    private static async enforceMaxEntries(rootPath: string): Promise<void> {
        const config = await this.getConfig();
        const allEntries = await this.getHistory(rootPath);

        if (allEntries.length <= config.maxEntries) return;

        // Remove oldest entries (no need to keep reference to removed entries)
        const entriesToKeep = allEntries.slice(0, config.maxEntries);

        // Rebuild history files with only kept entries
        const historyDir = await this.getHistoryDir(rootPath);
        const files = fs.readdirSync(historyDir);

        // Clear all files except analytics cache
        for (const file of files) {
            if (file.endsWith('.json') && file !== 'analytics-cache.json') {
                fs.unlinkSync(path.join(historyDir, file));
            }
        }

        // Rewrite kept entries
        for (const entry of entriesToKeep) {
            await this.saveEntry(rootPath, entry);
        }
    }

    /**
     * Calculate diff with blame information
     */
    private static async calculateDiffWithBlame(rootPath: string, newContent: string): Promise<any> {
        try {
            // Get the most recent history entry to compare against
            const recentEntries = await this.getHistory(rootPath, 1);
            const previousEntry = recentEntries[0];

            if (!previousEntry) {
                // No previous entry, this is the first one
                return null;
            }

            // Create temporary files for diff calculation
            const tempDir = require('os').tmpdir();
            const tempOldFile = `${tempDir}/dotenvy-diff-old-${Date.now()}.env`;
            const tempNewFile = `${tempDir}/dotenvy-diff-new-${Date.now()}.env`;

            try {
                // Write contents to temp files
                fs.writeFileSync(tempOldFile, previousEntry.fileContent);
                fs.writeFileSync(tempNewFile, newContent);

                // Calculate diff
                const { EnvironmentDiffer } = require('./environmentDiffer');
                const diff = EnvironmentDiffer.compareFiles(tempOldFile, tempNewFile);

                // Add blame information to changed variables
                for (const change of diff.changed) {
                    change.blame = {
                        user: previousEntry.user,
                        timestamp: previousEntry.timestamp,
                        commitHash: previousEntry.commitHash
                    };
                }

                return diff;
            } finally {
                // Clean up temp files
                try {
                    if (fs.existsSync(tempOldFile)) fs.unlinkSync(tempOldFile);
                    if (fs.existsSync(tempNewFile)) fs.unlinkSync(tempNewFile);
                } catch (error) {
                    // Ignore cleanup errors
                }
            }
        } catch (error) {
            console.warn('Failed to calculate diff with blame:', error);
            return null;
        }
    }

    /**
     * Export history to a file
     */
    static async exportHistory(rootPath: string, exportPath: string): Promise<void> {
        const entries = await this.getHistory(rootPath);
        const exportData = {
            exportedAt: new Date().toISOString(),
            workspace: rootPath,
            entries
        };

        const jsonContent = JSON.stringify(exportData, null, 2);
        fs.writeFileSync(exportPath, jsonContent, 'utf8');
    }

    /**
     * Import history from a file
     */
    static async importHistory(rootPath: string, importPath: string): Promise<number> {
        try {
            const content = fs.readFileSync(importPath, 'utf8');
            const importData = JSON.parse(content);

            if (!importData.entries || !Array.isArray(importData.entries)) {
                throw new Error('Invalid import file format');
            }

            let importedCount = 0;
            for (const entry of importData.entries) {
                // Validate entry structure
                if (entry.id && entry.timestamp && entry.action && entry.fileContent) {
                    await this.saveEntry(rootPath, entry);
                    importedCount++;
                }
            }

            return importedCount;
        } catch (error) {
            console.error('Failed to import history:', error);
            return 0;
        }
    }

    /**
     * Generate analytics for history data
     */
    static async generateAnalytics(rootPath: string): Promise<AnalyticsSummary> {
        try {
            const entries = await this.getHistory(rootPath);
            return await HistoryAnalytics.generateAnalytics(entries);
        } catch (error) {
            console.error('Failed to generate analytics:', error);
            return HistoryAnalytics.generateAnalytics([]); // Return empty analytics
        }
    }

    /**
     * Get cached analytics or generate new ones
     */
    static async getAnalytics(rootPath: string, forceRefresh: boolean = false): Promise<AnalyticsSummary> {
        const cacheFile = path.join(await this.getHistoryDir(rootPath), 'analytics-cache.json');

        // Check if we have cached analytics and they're not too old
        if (!forceRefresh && fs.existsSync(cacheFile)) {
            try {
                const cacheContent = fs.readFileSync(cacheFile, 'utf8');
                const cached = JSON.parse(cacheContent);

                // Check if cache is less than 1 hour old
                const cacheAge = Date.now() - new Date(cached.generatedAt).getTime();
                if (cacheAge < 60 * 60 * 1000) { // 1 hour
                    // Parse dates back to Date objects
                    cached.generatedAt = new Date(cached.generatedAt);
                    cached.dataRange.start = new Date(cached.dataRange.start);
                    cached.dataRange.end = new Date(cached.dataRange.end);

                    // Parse dates in variable analytics
                    for (const key in cached.variableAnalytics.lastChanged) {
                        cached.variableAnalytics.lastChanged[key] = new Date(cached.variableAnalytics.lastChanged[key]);
                    }
                    for (const key in cached.variableAnalytics.firstSeen) {
                        cached.variableAnalytics.firstSeen[key] = new Date(cached.variableAnalytics.firstSeen[key]);
                    }
                    for (const key in cached.variableAnalytics.lifecycle) {
                        cached.variableAnalytics.lifecycle[key].created = new Date(cached.variableAnalytics.lifecycle[key].created);
                        cached.variableAnalytics.lifecycle[key].lastModified = new Date(cached.variableAnalytics.lifecycle[key].lastModified);
                    }

                    // Parse dates in stability metrics
                    for (const key in cached.stabilityMetrics.firstChange) {
                        cached.stabilityMetrics.firstChange[key] = new Date(cached.stabilityMetrics.firstChange[key]);
                    }
                    for (const key in cached.stabilityMetrics.lastChange) {
                        cached.stabilityMetrics.lastChange[key] = new Date(cached.stabilityMetrics.lastChange[key]);
                    }

                    return cached;
                }
            } catch (error) {
                // Cache is corrupted, generate fresh analytics
                console.warn('Analytics cache corrupted, regenerating:', error);
            }
        }

        // Generate fresh analytics
        const analytics = await this.generateAnalytics(rootPath);

        // Cache the results
        try {
            await this.ensureHistoryDir(rootPath);
            const cacheData = JSON.stringify(analytics, null, 2);
            fs.writeFileSync(cacheFile, cacheData, 'utf8');
        } catch (error) {
            console.warn('Failed to cache analytics:', error);
            // Continue without caching
        }

        return analytics;
    }

    /**
     * Clear analytics cache
     */
    static async clearAnalyticsCache(rootPath: string): Promise<void> {
        try {
            const cacheFile = path.join(await this.getHistoryDir(rootPath), 'analytics-cache.json');
            if (fs.existsSync(cacheFile)) {
                fs.unlinkSync(cacheFile);
            }
        } catch (error) {
            console.warn('Failed to clear analytics cache:', error);
        }
    }

    /**
     * Apply filters to history entries
     */
    static async applyFilters(rootPath: string, filters: HistoryFilterOptions): Promise<FilterResult> {
        const entries = await this.getHistory(rootPath);
        return await HistoryFilters.applyFilters(entries, filters);
    }

    /**
     * Get variable-specific history
     */
    static async getVariableHistory(rootPath: string, variableName: string): Promise<Array<{
        entry: HistoryEntry;
        value: string;
        timestamp: Date;
    }>> {
        const entries = await this.getHistory(rootPath);
        return HistoryFilters.getVariableHistory(entries, variableName);
    }

    /**
     * Get filter options (unique values for dropdowns)
     */
    static async getFilterOptions(rootPath: string): Promise<{
        users: string[];
        environments: string[];
        actions: string[];
        variables: string[];
        dateRangePresets: Array<{ label: string; range: { start?: Date; end?: Date } }>;
        stats: {
            totalEntries: number;
            dateRange: { start: Date; end: Date };
            uniqueUsers: number;
            uniqueEnvironments: number;
            uniqueVariables: number;
            uniqueActions: number;
        };
    }> {
        const entries = await this.getHistory(rootPath);

        return {
            users: HistoryFilters.getUniqueUsers(entries),
            environments: HistoryFilters.getUniqueEnvironments(entries),
            actions: HistoryFilters.getUniqueActions(entries),
            variables: HistoryFilters.getUniqueVariables(entries),
            dateRangePresets: HistoryFilters.getDateRangePresets(),
            stats: HistoryFilters.getFilterStats(entries)
        };
    }

    /**
     * Validate regex pattern
     */
    static validateRegex(pattern: string): { valid: boolean; error?: string } {
        return HistoryFilters.validateRegex(pattern);
    }
}

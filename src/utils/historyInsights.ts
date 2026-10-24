/**
 * Analytics cache, filters, and variable history over stored environment history.
 */

import * as fs from 'fs';
import * as path from 'path';
import { HistoryEntry } from '../types/environment';
import { HistoryAnalytics, AnalyticsSummary } from './historyAnalytics';
import { HistoryFilters, HistoryFilterOptions, FilterResult } from './historyFilters';
import { HistoryManager } from './historyManager';
import { logger } from './logger';

/**
 * Builds a fresh analytics summary for the workspace history.
 */
export async function generateHistoryAnalytics(rootPath: string): Promise<AnalyticsSummary> {
    try {
        const entries = await HistoryManager.getHistory(rootPath);
        return await HistoryAnalytics.generateAnalytics(entries);
    } catch (error) {
        logger.error('Failed to generate analytics:', error, 'HistoryManager');
        return HistoryAnalytics.generateAnalytics([]);
    }
}

/**
 * Returns cached analytics when they are less than an hour old, otherwise regenerates them.
 */
export async function getHistoryAnalytics(rootPath: string, forceRefresh = false): Promise<AnalyticsSummary> {
    const historyDir = await HistoryManager.getHistoryDir(rootPath);
    const cacheFile = path.join(historyDir, 'analytics-cache.json');

    if (!forceRefresh && fs.existsSync(cacheFile)) {
        try {
            const cacheContent = fs.readFileSync(cacheFile, 'utf8');
            const cached = JSON.parse(cacheContent);

            const cacheAge = Date.now() - new Date(cached.generatedAt).getTime();
            if (cacheAge < 60 * 60 * 1000) {
                cached.generatedAt = new Date(cached.generatedAt);
                cached.dataRange.start = new Date(cached.dataRange.start);
                cached.dataRange.end = new Date(cached.dataRange.end);

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

                for (const key in cached.stabilityMetrics.firstChange) {
                    cached.stabilityMetrics.firstChange[key] = new Date(cached.stabilityMetrics.firstChange[key]);
                }
                for (const key in cached.stabilityMetrics.lastChange) {
                    cached.stabilityMetrics.lastChange[key] = new Date(cached.stabilityMetrics.lastChange[key]);
                }

                return cached;
            }
        } catch (error) {
            logger.error('Analytics cache corrupted, regenerating:', error, 'HistoryManager');
        }
    }

    const analytics = await generateHistoryAnalytics(rootPath);

    try {
        if (!fs.existsSync(historyDir)) {
            fs.mkdirSync(historyDir, { recursive: true });
        }
        const cacheData = JSON.stringify(analytics, null, 2);
        fs.writeFileSync(cacheFile, cacheData, 'utf8');
    } catch (error) {
        logger.error('Failed to cache analytics:', error, 'HistoryManager');
    }

    return analytics;
}

/**
 * Deletes the cached analytics file for a workspace.
 */
export async function clearHistoryAnalyticsCache(rootPath: string): Promise<void> {
    try {
        const cacheFile = path.join(await HistoryManager.getHistoryDir(rootPath), 'analytics-cache.json');
        if (fs.existsSync(cacheFile)) {
            fs.unlinkSync(cacheFile);
        }
    } catch (error) {
        logger.error('Failed to clear analytics cache:', error, 'HistoryManager');
    }
}

/**
 * Applies history filters to the workspace entries.
 */
export async function applyHistoryFilters(rootPath: string, filters: HistoryFilterOptions): Promise<FilterResult> {
    const entries = await HistoryManager.getHistory(rootPath);
    return await HistoryFilters.applyFilters(entries, filters);
}

/**
 * Returns the recorded values of one variable across history.
 */
export async function getHistoryVariableHistory(rootPath: string, variableName: string): Promise<Array<{
    entry: HistoryEntry;
    value: string;
    timestamp: Date;
}>> {
    const entries = await HistoryManager.getHistory(rootPath);
    return HistoryFilters.getVariableHistory(entries, variableName);
}

/**
 * Returns distinct filter dropdown values for the workspace history.
 */
export async function getHistoryFilterOptions(rootPath: string): Promise<{
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
    const entries = await HistoryManager.getHistory(rootPath);

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
 * Checks whether a user-supplied regular expression can be compiled.
 */
export function validateHistoryRegex(pattern: string): { valid: boolean; error?: string } {
    return HistoryFilters.validateRegex(pattern);
}

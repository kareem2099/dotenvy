/**
 * History Filtering Utilities
 * ===========================
 *
 * Advanced filtering and search capabilities for environment history data,
 * including date ranges, regex search, user filtering, and variable-specific queries.
 */

import { HistoryEntry } from '../types/environment';

export interface DateRange {
    start?: Date;
    end?: Date;
}

export interface HistoryFilterOptions {
    dateRange?: DateRange;
    searchQuery?: string;
    searchRegex?: boolean;
    searchScope?: 'all' | 'environments' | 'variables' | 'values';
    users?: string[];
    environments?: string[];
    actions?: string[];
    variables?: string[];
}

export type AppliedFilterKind =
    | 'dateRange'
    | 'search'
    | 'users'
    | 'environments'
    | 'actions'
    | 'variables';

export interface AppliedFilterTag {
    kind: AppliedFilterKind;
    scope?: string;
    count?: number;
}

export interface FilterResult {
    entries: HistoryEntry[];
    totalCount: number;
    filteredCount: number;
    appliedFilterTags: AppliedFilterTag[];
}

export class HistoryFilters {
    /**
     * Apply comprehensive filters to history entries
     */
    static async applyFilters(
        entries: HistoryEntry[],
        filters: HistoryFilterOptions
    ): Promise<FilterResult> {
        let filteredEntries = [...entries];
        const appliedFilterTags: AppliedFilterTag[] = [];

        // Apply date range filter
        if (filters.dateRange) {
            filteredEntries = this.filterByDateRange(filteredEntries, filters.dateRange);
            appliedFilterTags.push({ kind: 'dateRange' });
        }

        // Apply search filter
        if (filters.searchQuery && filters.searchQuery.trim()) {
            filteredEntries = this.filterBySearch(
                filteredEntries,
                filters.searchQuery.trim(),
                filters.searchRegex || false,
                filters.searchScope || 'all'
            );
            appliedFilterTags.push({
                kind: 'search',
                scope: filters.searchScope || 'all',
            });
        }

        // Apply user filter
        if (filters.users && filters.users.length > 0) {
            filteredEntries = this.filterByUsers(filteredEntries, filters.users);
            appliedFilterTags.push({ kind: 'users', count: filters.users.length });
        }

        // Apply environment filter
        if (filters.environments && filters.environments.length > 0) {
            filteredEntries = this.filterByEnvironments(filteredEntries, filters.environments);
            appliedFilterTags.push({ kind: 'environments', count: filters.environments.length });
        }

        // Apply action filter
        if (filters.actions && filters.actions.length > 0) {
            filteredEntries = this.filterByActions(filteredEntries, filters.actions);
            appliedFilterTags.push({ kind: 'actions', count: filters.actions.length });
        }

        // Apply variable filter
        if (filters.variables && filters.variables.length > 0) {
            filteredEntries = this.filterByVariables(filteredEntries, filters.variables);
            appliedFilterTags.push({ kind: 'variables', count: filters.variables.length });
        }

        return {
            entries: filteredEntries,
            totalCount: entries.length,
            filteredCount: filteredEntries.length,
            appliedFilterTags,
        };
    }

    /**
     * Filter entries by date range
     */
    private static filterByDateRange(entries: HistoryEntry[], dateRange: DateRange): HistoryEntry[] {
        return entries.filter(entry => {
            const entryDate = new Date(entry.timestamp);

            if (dateRange.start && entryDate < dateRange.start) {
                return false;
            }

            if (dateRange.end && entryDate > dateRange.end) {
                return false;
            }

            return true;
        });
    }

    /**
     * Filter entries by search query with regex support
     */
    private static filterBySearch(
        entries: HistoryEntry[],
        query: string,
        useRegex: boolean,
        scope: string
    ): HistoryEntry[] {
        let regex: RegExp;

        try {
            regex = useRegex ? new RegExp(query, 'i') : new RegExp(this.escapeRegex(query), 'i');
        } catch (error) {
            // Invalid regex, fall back to literal search
            regex = new RegExp(this.escapeRegex(query), 'i');
        }

        return entries.filter(entry => {
            switch (scope) {
                case 'environments':
                    return regex.test(entry.environmentName);

                case 'variables':
                    if (!entry.fileContent) return false;
                    const variables = this.extractVariableKeys(entry.fileContent);
                    return variables.some(key => regex.test(key));

                case 'values':
                    if (!entry.fileContent) return false;
                    const values = this.extractVariableValues(entry.fileContent);
                    return values.some(value => regex.test(value));

                case 'all':
                default:
                    // Search in environment name, user, reason, and content
                    const searchableText = [
                        entry.environmentName,
                        entry.user || '',
                        entry.metadata?.reason || '',
                        entry.fileContent || ''
                    ].join(' ');

                    return regex.test(searchableText);
            }
        });
    }

    /**
     * Filter entries by users
     */
    private static filterByUsers(entries: HistoryEntry[], users: string[]): HistoryEntry[] {
        return entries.filter(entry => {
            if (!entry.user) return false;
            return users.includes(entry.user);
        });
    }

    /**
     * Filter entries by environments
     */
    private static filterByEnvironments(entries: HistoryEntry[], environments: string[]): HistoryEntry[] {
        return entries.filter(entry => environments.includes(entry.environmentName));
    }

    /**
     * Filter entries by actions
     */
    private static filterByActions(entries: HistoryEntry[], actions: string[]): HistoryEntry[] {
        return entries.filter(entry => actions.includes(entry.action));
    }

    /**
     * Filter entries by variables (entries that contain specific variables)
     */
    private static filterByVariables(entries: HistoryEntry[], variables: string[]): HistoryEntry[] {
        return entries.filter(entry => {
            if (!entry.fileContent) return false;
            const entryVariables = this.extractVariableKeys(entry.fileContent);
            return variables.some(variable => entryVariables.includes(variable));
        });
    }

    /**
     * Get variable-specific history
     */
    static getVariableHistory(entries: HistoryEntry[], variableName: string): Array<{
        entry: HistoryEntry;
        value: string;
        timestamp: Date;
    }> {
        const variableHistory: Array<{
            entry: HistoryEntry;
            value: string;
            timestamp: Date;
        }> = [];

        for (const entry of entries) {
            if (!entry.fileContent) continue;

            const variables = this.parseEnvironmentContent(entry.fileContent);
            if (variables[variableName] !== undefined) {
                variableHistory.push({
                    entry,
                    value: variables[variableName],
                    timestamp: new Date(entry.timestamp)
                });
            }
        }

        // Sort by timestamp (oldest first)
        return variableHistory.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
    }

    /**
     * Get all unique users from history
     */
    static getUniqueUsers(entries: HistoryEntry[]): string[] {
        const users = new Set<string>();
        entries.forEach(entry => {
            if (entry.user) {
                users.add(entry.user);
            }
        });
        return Array.from(users).sort();
    }

    /**
     * Get all unique environments from history
     */
    static getUniqueEnvironments(entries: HistoryEntry[]): string[] {
        const environments = new Set<string>();
        entries.forEach(entry => environments.add(entry.environmentName));
        return Array.from(environments).sort();
    }

    /**
     * Get all unique variables from history
     */
    static getUniqueVariables(entries: HistoryEntry[]): string[] {
        const variables = new Set<string>();
        entries.forEach(entry => {
            if (entry.fileContent) {
                const keys = this.extractVariableKeys(entry.fileContent);
                keys.forEach(key => variables.add(key));
            }
        });
        return Array.from(variables).sort();
    }

    /**
     * Get all unique actions from history
     */
    static getUniqueActions(entries: HistoryEntry[]): string[] {
        const actions = new Set<string>();
        entries.forEach(entry => actions.add(entry.action));
        return Array.from(actions).sort();
    }

    /**
     * Create common date range presets
     */
    static getDateRangePresets(): Array<{ id: string; range: DateRange }> {
        const now = new Date();
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

        return [
            {
                id: 'today',
                range: { start: today, end: new Date(today.getTime() + 24 * 60 * 60 * 1000 - 1) }
            },
            {
                id: 'last7days',
                range: { start: new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000) }
            },
            {
                id: 'last30days',
                range: { start: new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000) }
            },
            {
                id: 'last3months',
                range: { start: new Date(today.getTime() - 90 * 24 * 60 * 60 * 1000) }
            },
            {
                id: 'last6months',
                range: { start: new Date(today.getTime() - 180 * 24 * 60 * 60 * 1000) }
            },
            {
                id: 'lastyear',
                range: { start: new Date(today.getTime() - 365 * 24 * 60 * 60 * 1000) }
            }
        ];
    }

    /**
     * Parse environment file content into key-value pairs
     */
    private static parseEnvironmentContent(content: string): Record<string, string> {
        const variables: Record<string, string> = {};
        const lines = content.split('\n');

        for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed && !trimmed.startsWith('#') && trimmed.includes('=')) {
                const [key, ...valueParts] = trimmed.split('=');
                const value = valueParts.join('=').replace(/^["']|["']$/g, ''); // Remove quotes
                variables[key.trim()] = value;
            }
        }

        return variables;
    }

    /**
     * Extract variable keys from environment content
     */
    private static extractVariableKeys(content: string): string[] {
        return Object.keys(this.parseEnvironmentContent(content));
    }

    /**
     * Extract variable values from environment content
     */
    private static extractVariableValues(content: string): string[] {
        return Object.values(this.parseEnvironmentContent(content));
    }

    /**
     * Escape special regex characters
     */
    private static escapeRegex(string: string): string {
        return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    /**
     * Validate regex pattern
     */
    static validateRegex(pattern: string): { valid: boolean; error?: string } {
        try {
            new RegExp(pattern);
            return { valid: true };
        } catch (error) {
            return { valid: false, error: (error as Error).message };
        }
    }

    /**
     * Get filter statistics
     */
    static getFilterStats(entries: HistoryEntry[]): {
        totalEntries: number;
        dateRange: { start: Date; end: Date };
        uniqueUsers: number;
        uniqueEnvironments: number;
        uniqueVariables: number;
        uniqueActions: number;
    } {
        const users = new Set<string>();
        const environments = new Set<string>();
        const variables = new Set<string>();
        const actions = new Set<string>();
        let startDate = new Date();
        let endDate = new Date(0);

        entries.forEach(entry => {
            if (entry.user) users.add(entry.user);
            environments.add(entry.environmentName);
            actions.add(entry.action);

            if (entry.fileContent) {
                const keys = this.extractVariableKeys(entry.fileContent);
                keys.forEach(key => variables.add(key));
            }

            const entryDate = new Date(entry.timestamp);
            if (entryDate < startDate) startDate = entryDate;
            if (entryDate > endDate) endDate = entryDate;
        });

        return {
            totalEntries: entries.length,
            dateRange: { start: startDate, end: endDate },
            uniqueUsers: users.size,
            uniqueEnvironments: environments.size,
            uniqueVariables: variables.size,
            uniqueActions: actions.size
        };
    }
}

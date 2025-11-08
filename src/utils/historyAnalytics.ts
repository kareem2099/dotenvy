/**
 * History Analytics Module
 * ========================
 *
 * Provides comprehensive analytics and insights for environment history data,
 * including usage patterns, stability metrics, and activity analysis.
 */

import { HistoryEntry } from '../types/environment';

export interface UsagePatterns {
    environmentFrequency: Record<string, number>;
    peakHours: Record<number, number>; // hour (0-23) -> count
    peakDays: Record<number, number>; // day (0-6, 0=Sunday) -> count
    transitionMatrix: Record<string, Record<string, number>>;
    commonTransitions: Array<{
        from: string;
        to: string;
        count: number;
        percentage: number;
    }>;
}

export interface StabilityMetrics {
    churnRate: Record<string, number>; // env -> changes per day
    avgTimeBetweenChanges: Record<string, number>; // env -> hours
    stabilityScore: Record<string, number>; // 0-100 score
    totalChanges: Record<string, number>;
    firstChange: Record<string, Date>;
    lastChange: Record<string, Date>;
}

export interface ActivityHeatmap {
    calendar: Record<string, number>; // YYYY-MM-DD -> activity count
    hourly: Record<string, Record<number, number>>; // YYYY-MM-DD -> hour -> count
    monthly: Record<string, number>; // YYYY-MM -> total activity
}

export interface VariableAnalytics {
    changeFrequency: Record<string, number>; // variable -> change count
    lastChanged: Record<string, Date>;
    firstSeen: Record<string, Date>;
    currentValue: Record<string, string>;
    changeVelocity: Record<string, number>; // changes per day
    lifecycle: Record<string, VariableLifecycle>;
}

export interface VariableLifecycle {
    created: Date;
    lastModified: Date;
    totalChanges: number;
    currentValue: string;
    previousValues: string[];
}

export interface AnalyticsSummary {
    usagePatterns: UsagePatterns;
    stabilityMetrics: StabilityMetrics;
    activityHeatmap: ActivityHeatmap;
    variableAnalytics: VariableAnalytics;
    generatedAt: Date;
    dataRange: {
        start: Date;
        end: Date;
        totalEntries: number;
    };
}

export class HistoryAnalytics {
    /**
     * Generate comprehensive analytics from history entries
     */
    static async generateAnalytics(entries: HistoryEntry[]): Promise<AnalyticsSummary> {
        if (!entries || entries.length === 0) {
            return this.createEmptyAnalytics();
        }

        // Sort entries by timestamp (oldest first for proper analysis)
        const sortedEntries = [...entries].sort((a, b) =>
            new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
        );

        const dataRange = {
            start: new Date(sortedEntries[0].timestamp),
            end: new Date(sortedEntries[sortedEntries.length - 1].timestamp),
            totalEntries: entries.length
        };

        return {
            usagePatterns: this.analyzeUsagePatterns(sortedEntries),
            stabilityMetrics: this.calculateStabilityMetrics(sortedEntries),
            activityHeatmap: this.generateActivityHeatmap(sortedEntries),
            variableAnalytics: this.analyzeVariableChanges(sortedEntries),
            generatedAt: new Date(),
            dataRange
        };
    }

    /**
     * Analyze usage patterns from history entries
     */
    private static analyzeUsagePatterns(entries: HistoryEntry[]): UsagePatterns {
        const environmentFrequency: Record<string, number> = {};
        const peakHours: Record<number, number> = {};
        const peakDays: Record<number, number> = {};
        const transitionMatrix: Record<string, Record<string, number>> = {};

        let previousEnvironment: string | null = null;

        for (const entry of entries) {
            const env = entry.environmentName;
            const timestamp = new Date(entry.timestamp);

            // Count environment frequency
            environmentFrequency[env] = (environmentFrequency[env] || 0) + 1;

            // Count peak hours and days
            const hour = timestamp.getHours();
            const day = timestamp.getDay();
            peakHours[hour] = (peakHours[hour] || 0) + 1;
            peakDays[day] = (peakDays[day] || 0) + 1;

            // Track transitions
            if (previousEnvironment && previousEnvironment !== env) {
                if (!transitionMatrix[previousEnvironment]) {
                    transitionMatrix[previousEnvironment] = {};
                }
                transitionMatrix[previousEnvironment][env] =
                    (transitionMatrix[previousEnvironment][env] || 0) + 1;
            }

            // Update previous environment for next iteration
            if (entry.action === 'switch') {
                previousEnvironment = env;
            }
        }

        // Calculate common transitions
        const commonTransitions = this.calculateCommonTransitions(transitionMatrix, entries.length);

        return {
            environmentFrequency,
            peakHours,
            peakDays,
            transitionMatrix,
            commonTransitions
        };
    }

    /**
     * Calculate common transitions from transition matrix
     */
    private static calculateCommonTransitions(
        transitionMatrix: Record<string, Record<string, number>>,
        totalEntries: number
    ): Array<{ from: string; to: string; count: number; percentage: number }> {
        const transitions: Array<{ from: string; to: string; count: number }> = [];

        for (const from in transitionMatrix) {
            for (const to in transitionMatrix[from]) {
                transitions.push({
                    from,
                    to,
                    count: transitionMatrix[from][to]
                });
            }
        }

        // Sort by count descending and calculate percentages
        return transitions
            .sort((a, b) => b.count - a.count)
            .slice(0, 10) // Top 10 transitions
            .map(t => ({
                ...t,
                percentage: (t.count / totalEntries) * 100
            }));
    }

    /**
     * Calculate stability metrics for environments
     */
    private static calculateStabilityMetrics(entries: HistoryEntry[]): StabilityMetrics {
        const envData: Record<string, {
            changes: Date[];
            firstChange?: Date;
            lastChange?: Date;
        }> = {};

        // Group changes by environment
        for (const entry of entries) {
            const env = entry.environmentName;
            if (!envData[env]) {
                envData[env] = { changes: [] };
            }

            const changeTime = new Date(entry.timestamp);
            envData[env].changes.push(changeTime);

            const envEntry = envData[env];
            if (!envEntry.firstChange || changeTime < envEntry.firstChange) {
                envEntry.firstChange = changeTime;
            }
            if (!envEntry.lastChange || changeTime > envEntry.lastChange) {
                envEntry.lastChange = changeTime;
            }
        }

        const churnRate: Record<string, number> = {};
        const avgTimeBetweenChanges: Record<string, number> = {};
        const stabilityScore: Record<string, number> = {};
        const totalChanges: Record<string, number> = {};
        const firstChange: Record<string, Date> = {};
        const lastChange: Record<string, Date> = {};

        for (const env in envData) {
            const data = envData[env];
            const changes = data.changes.sort((a, b) => a.getTime() - b.getTime());
            totalChanges[env] = changes.length;

            if (data.firstChange) firstChange[env] = data.firstChange;
            if (data.lastChange) lastChange[env] = data.lastChange;

            if (changes.length > 1) {
                // Calculate time span in days
                const timeSpanMs = changes[changes.length - 1].getTime() - changes[0].getTime();
                const timeSpanDays = timeSpanMs / (1000 * 60 * 60 * 24);

                if (timeSpanDays > 0) {
                    churnRate[env] = changes.length / timeSpanDays;
                }

                // Calculate average time between changes in hours
                const intervals: number[] = [];
                for (let i = 1; i < changes.length; i++) {
                    const intervalMs = changes[i].getTime() - changes[i - 1].getTime();
                    intervals.push(intervalMs / (1000 * 60 * 60)); // Convert to hours
                }

                if (intervals.length > 0) {
                    avgTimeBetweenChanges[env] = intervals.reduce((sum, interval) => sum + interval, 0) / intervals.length;
                }

                // Calculate stability score (0-100, higher is more stable)
                const avgIntervalHours = avgTimeBetweenChanges[env] || 24; // Default 24 hours
                const changesPerWeek = (changes.length / timeSpanDays) * 7;

                // Score based on predictability and frequency
                // Lower churn rate and more predictable intervals = higher score
                const intervalVariance = this.calculateVariance(intervals);
                const predictabilityScore = Math.max(0, 100 - (intervalVariance / avgIntervalHours) * 50);
                const frequencyScore = Math.max(0, 100 - changesPerWeek * 10);

                stabilityScore[env] = Math.round((predictabilityScore + frequencyScore) / 2);
            } else {
                churnRate[env] = 0;
                avgTimeBetweenChanges[env] = 0;
                stabilityScore[env] = 100; // Single change = perfectly stable
            }
        }

        return {
            churnRate,
            avgTimeBetweenChanges,
            stabilityScore,
            totalChanges,
            firstChange,
            lastChange
        };
    }

    /**
     * Generate activity heatmap data
     */
    private static generateActivityHeatmap(entries: HistoryEntry[]): ActivityHeatmap {
        const calendar: Record<string, number> = {};
        const hourly: Record<string, Record<number, number>> = {};
        const monthly: Record<string, number> = {};

        for (const entry of entries) {
            const timestamp = new Date(entry.timestamp);
            const dateStr = timestamp.toISOString().split('T')[0]; // YYYY-MM-DD
            const monthStr = dateStr.substring(0, 7); // YYYY-MM
            const hour = timestamp.getHours();

            // Calendar heatmap
            calendar[dateStr] = (calendar[dateStr] || 0) + 1;

            // Hourly data
            if (!hourly[dateStr]) {
                hourly[dateStr] = {};
            }
            hourly[dateStr][hour] = (hourly[dateStr][hour] || 0) + 1;

            // Monthly totals
            monthly[monthStr] = (monthly[monthStr] || 0) + 1;
        }

        return {
            calendar,
            hourly,
            monthly
        };
    }

    /**
     * Analyze variable changes across history
     */
    private static analyzeVariableChanges(entries: HistoryEntry[]): VariableAnalytics {
        const variableData: Record<string, {
            changes: Array<{ timestamp: Date; value: string }>;
            firstSeen?: Date;
            lastChanged?: Date;
            currentValue?: string;
        }> = {};

        // Process each entry to track variable changes
        for (const entry of entries) {
            if (!entry.fileContent) continue;

            const lines = entry.fileContent.split('\n');
            const variablesInEntry: Record<string, string> = {};

            // Parse environment variables from this entry
            for (const line of lines) {
                const trimmed = line.trim();
                if (trimmed && !trimmed.startsWith('#') && trimmed.includes('=')) {
                    const [key, ...valueParts] = trimmed.split('=');
                    const value = valueParts.join('=').replace(/^["']|["']$/g, ''); // Remove quotes
                    variablesInEntry[key.trim()] = value;
                }
            }

            // Track changes for each variable
            for (const [key, value] of Object.entries(variablesInEntry)) {
                if (!variableData[key]) {
                    variableData[key] = { changes: [] };
                }

                const timestamp = new Date(entry.timestamp);
                const varEntry = variableData[key];
                varEntry.changes.push({ timestamp, value });
                varEntry.currentValue = value;

                if (!varEntry.firstSeen || timestamp < varEntry.firstSeen) {
                    varEntry.firstSeen = timestamp;
                }
                if (!varEntry.lastChanged || timestamp > varEntry.lastChanged) {
                    varEntry.lastChanged = timestamp;
                }
            }
        }

        // Calculate analytics for each variable
        const changeFrequency: Record<string, number> = {};
        const lastChanged: Record<string, Date> = {};
        const firstSeen: Record<string, Date> = {};
        const currentValue: Record<string, string> = {};
        const changeVelocity: Record<string, number> = {};
        const lifecycle: Record<string, VariableLifecycle> = {};

        for (const [key, data] of Object.entries(variableData)) {
            const changes = data.changes.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
            changeFrequency[key] = changes.length - 1; // Subtract 1 because first occurrence isn't a "change"

            if (data.firstSeen) firstSeen[key] = data.firstSeen;
            if (data.lastChanged) lastChanged[key] = data.lastChanged;
            if (data.currentValue) currentValue[key] = data.currentValue;

            // Calculate change velocity (changes per day)
            if (changes.length > 1 && data.firstSeen && data.lastChanged) {
                const timeSpanMs = data.lastChanged.getTime() - data.firstSeen.getTime();
                const timeSpanDays = timeSpanMs / (1000 * 60 * 60 * 24);
                if (timeSpanDays > 0) {
                    changeVelocity[key] = (changes.length - 1) / timeSpanDays;
                }
            }

            // Build lifecycle
            const uniqueValues = [...new Set(changes.map(c => c.value))];
            lifecycle[key] = {
                created: data.firstSeen!,
                lastModified: data.lastChanged!,
                totalChanges: changes.length - 1,
                currentValue: data.currentValue!,
                previousValues: uniqueValues.slice(0, -1) // All except current
            };
        }

        return {
            changeFrequency,
            lastChanged,
            firstSeen,
            currentValue,
            changeVelocity,
            lifecycle
        };
    }

    /**
     * Calculate variance of an array of numbers
     */
    private static calculateVariance(values: number[]): number {
        if (values.length === 0) return 0;

        const mean = values.reduce((sum, val) => sum + val, 0) / values.length;
        const squaredDiffs = values.map(val => Math.pow(val - mean, 2));
        return squaredDiffs.reduce((sum, val) => sum + val, 0) / values.length;
    }

    /**
     * Create empty analytics structure
     */
    private static createEmptyAnalytics(): AnalyticsSummary {
        return {
            usagePatterns: {
                environmentFrequency: {},
                peakHours: {},
                peakDays: {},
                transitionMatrix: {},
                commonTransitions: []
            },
            stabilityMetrics: {
                churnRate: {},
                avgTimeBetweenChanges: {},
                stabilityScore: {},
                totalChanges: {},
                firstChange: {},
                lastChange: {}
            },
            activityHeatmap: {
                calendar: {},
                hourly: {},
                monthly: {}
            },
            variableAnalytics: {
                changeFrequency: {},
                lastChanged: {},
                firstSeen: {},
                currentValue: {},
                changeVelocity: {},
                lifecycle: {}
            },
            generatedAt: new Date(),
            dataRange: {
                start: new Date(),
                end: new Date(),
                totalEntries: 0
            }
        };
    }

    /**
     * Get top N most frequent environments
     */
    static getTopEnvironments(analytics: AnalyticsSummary, limit: number = 5): Array<{ name: string; count: number }> {
        return Object.entries(analytics.usagePatterns.environmentFrequency)
            .sort(([, a], [, b]) => b - a)
            .slice(0, limit)
            .map(([name, count]) => ({ name, count }));
    }

    /**
     * Get peak activity hours
     */
    static getPeakHours(analytics: AnalyticsSummary): Array<{ hour: number; count: number; label: string }> {
        return Object.entries(analytics.usagePatterns.peakHours)
            .map(([hour, count]) => ({
                hour: parseInt(hour),
                count,
                label: this.formatHour(parseInt(hour))
            }))
            .sort((a, b) => b.count - a.count);
    }

    /**
     * Get most changed variables
     */
    static getMostChangedVariables(analytics: AnalyticsSummary, limit: number = 10): Array<{ name: string; changes: number }> {
        return Object.entries(analytics.variableAnalytics.changeFrequency)
            .sort(([, a], [, b]) => b - a)
            .slice(0, limit)
            .map(([name, changes]) => ({ name, changes }));
    }

    /**
     * Format hour for display
     */
    private static formatHour(hour: number): string {
        const period = hour >= 12 ? 'PM' : 'AM';
        const displayHour = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
        return `${displayHour} ${period}`;
    }
}

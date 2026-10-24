/**
 * History Analytics Module
 * ========================
 *
 * Provides comprehensive analytics and insights for environment history data,
 * including usage patterns, stability metrics, and activity analysis.
 */

import { HistoryEntry } from '../types/environment';
import { calculateStabilityMetrics } from './historyStabilityMetrics';
import { analyzeVariableChanges } from './historyVariableChanges';

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
            stabilityMetrics: calculateStabilityMetrics(sortedEntries),
            activityHeatmap: this.generateActivityHeatmap(sortedEntries),
            variableAnalytics: analyzeVariableChanges(sortedEntries),
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
    static getTopEnvironments(analytics: AnalyticsSummary, limit = 5): Array<{ name: string; count: number }> {
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
    static getMostChangedVariables(analytics: AnalyticsSummary, limit = 10): Array<{ name: string; changes: number }> {
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

/**
 * Environment stability scores derived from history timestamps.
 */

import { HistoryEntry } from '../types/environment';
import type { StabilityMetrics } from './historyAnalytics';

function calculateVariance(values: number[]): number {
    if (values.length === 0) return 0;

    const mean = values.reduce((sum, val) => sum + val, 0) / values.length;
    const squaredDiffs = values.map(val => Math.pow(val - mean, 2));
    return squaredDiffs.reduce((sum, val) => sum + val, 0) / values.length;
}

/**
 * Calculates churn, interval, and stability scores per environment.
 */
export function calculateStabilityMetrics(entries: HistoryEntry[]): StabilityMetrics {
    const envData: Record<string, {
        changes: Date[];
        firstChange?: Date;
        lastChange?: Date;
    }> = {};

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
            const timeSpanMs = changes[changes.length - 1].getTime() - changes[0].getTime();
            const timeSpanDays = timeSpanMs / (1000 * 60 * 60 * 24);

            if (timeSpanDays > 0) {
                churnRate[env] = changes.length / timeSpanDays;
            }

            const intervals: number[] = [];
            for (let i = 1; i < changes.length; i++) {
                const intervalMs = changes[i].getTime() - changes[i - 1].getTime();
                intervals.push(intervalMs / (1000 * 60 * 60));
            }

            if (intervals.length > 0) {
                avgTimeBetweenChanges[env] = intervals.reduce((sum, interval) => sum + interval, 0) / intervals.length;
            }

            const avgIntervalHours = avgTimeBetweenChanges[env] || 24;
            const changesPerWeek = (changes.length / timeSpanDays) * 7;

            const intervalVariance = calculateVariance(intervals);
            const predictabilityScore = Math.max(0, 100 - (intervalVariance / avgIntervalHours) * 50);
            const frequencyScore = Math.max(0, 100 - changesPerWeek * 10);

            stabilityScore[env] = Math.round((predictabilityScore + frequencyScore) / 2);
        } else {
            churnRate[env] = 0;
            avgTimeBetweenChanges[env] = 0;
            stabilityScore[env] = 100;
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

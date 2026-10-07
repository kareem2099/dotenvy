/**
 * Per-variable change frequency and lifecycle from environment history.
 */

import { HistoryEntry } from '../types/environment';
import type { VariableAnalytics, VariableLifecycle } from './historyAnalytics';

/**
 * Tracks how each environment variable changed across history entries.
 */
export function analyzeVariableChanges(entries: HistoryEntry[]): VariableAnalytics {
    const variableData: Record<string, {
        changes: Array<{ timestamp: Date; value: string }>;
        firstSeen?: Date;
        lastChanged?: Date;
        currentValue?: string;
    }> = {};

    for (const entry of entries) {
        if (!entry.fileContent) continue;

        const lines = entry.fileContent.split('\n');
        const variablesInEntry: Record<string, string> = {};

        for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed && !trimmed.startsWith('#') && trimmed.includes('=')) {
                const [key, ...valueParts] = trimmed.split('=');
                const value = valueParts.join('=').replace(/^["']|["']$/g, '');
                variablesInEntry[key.trim()] = value;
            }
        }

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

    const changeFrequency: Record<string, number> = {};
    const lastChanged: Record<string, Date> = {};
    const firstSeen: Record<string, Date> = {};
    const currentValue: Record<string, string> = {};
    const changeVelocity: Record<string, number> = {};
    const lifecycle: Record<string, VariableLifecycle> = {};

    for (const [key, data] of Object.entries(variableData)) {
        const changes = data.changes.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
        changeFrequency[key] = changes.length - 1;

        if (data.firstSeen) firstSeen[key] = data.firstSeen;
        if (data.lastChanged) lastChanged[key] = data.lastChanged;
        if (data.currentValue) currentValue[key] = data.currentValue;

        if (changes.length > 1 && data.firstSeen && data.lastChanged) {
            const timeSpanMs = data.lastChanged.getTime() - data.firstSeen.getTime();
            const timeSpanDays = timeSpanMs / (1000 * 60 * 60 * 24);
            if (timeSpanDays > 0) {
                changeVelocity[key] = (changes.length - 1) / timeSpanDays;
            }
        }

        const uniqueValues = [...new Set(changes.map(c => c.value))];
        lifecycle[key] = {
            created: data.firstSeen || new Date(),
            lastModified: data.lastChanged || new Date(),
            totalChanges: changes.length - 1,
            currentValue: data.currentValue || '',
            previousValues: uniqueValues.slice(0, -1)
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

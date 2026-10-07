/**
 * Labeled date-range presets for the history filter drawer.
 */

import type { DateRange } from './historyFilters';

/** Common ranges relative to the start of the local calendar day. */
export function getDateRangePresets(): Array<{ id: string; range: DateRange }> {
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

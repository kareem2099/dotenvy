/**
 * FeedbackManager
 * ===============
 * Collects user feedback on secret detections.
 * Stores locally + sends to Railway server for model retraining.
 */

import * as vscode from 'vscode';
import * as crypto from 'crypto';
import { DetectedSecret } from './secretScannerTypes';
import { LLMAnalyzer } from './llmAnalyzer';
import { logger } from './logger';

export type UserAction   = 'confirmed_secret' | 'ignored_warning' | 'marked_false_positive';
export type FeedbackLabel = 'high' | 'medium' | 'low' | 'false_positive';

export interface FeedbackEntry {
    id: string;
    timestamp: string;
    feature_schema: 2;
    user_action: UserAction;
    label: FeedbackLabel;
    features: number[];
    sent: boolean;
}

export class FeedbackManager {

    private static readonly STORAGE_KEY = 'dotenvy.feedback.features.v2';
    private static readonly MAX_ENTRIES = 500;
    private static context: vscode.ExtensionContext;
    private static saving: Promise<void> = Promise.resolve();
    private static flushing: Promise<void> | undefined;

    public static async init(context: vscode.ExtensionContext): Promise<void> {
        FeedbackManager.context = context;
        // Old queues contained source context. Purge rather than upload them later.
        await context.globalState.update('dotenvy.feedback.entries', undefined);
    }

    // ─── Public API ────────────────────────────────────────────────────────────

    /** Call when user clicks "Not a Secret" */
    public static async recordFalsePositive(secret: DetectedSecret): Promise<void> {
        await FeedbackManager.record(secret, 'marked_false_positive', 'false_positive');
    }

    /** Call when user clicks "Move to .env" */
    public static async recordConfirmed(secret: DetectedSecret): Promise<void> {
        await FeedbackManager.record(secret, 'confirmed_secret', 'high');
    }

    // ─── Core ──────────────────────────────────────────────────────────────────

    private static async record(
        secret: DetectedSecret,
        action: UserAction,
        label:  FeedbackLabel
    ): Promise<void> {
        if (!FeedbackManager.context) { return; }

        try {
            if (!secret.features || secret.features.length !== 35 ||
                secret.features.some(f => !Number.isFinite(f) || f < 0 || f > 1)) {
                throw new Error('Scan the file again to collect valid original-value features');
            }
            const entry: FeedbackEntry = {
                id: crypto.randomUUID(), timestamp: new Date().toISOString(),
                feature_schema: 2, user_action: action, label,
                features: [...secret.features], sent: false,
            };

            await FeedbackManager.save(entry);
            logger.info(`Feedback: ${action} → ${label}`, 'FeedbackManager');

            // Non-blocking flush (only if cloud analysis is explicitly enabled)
            if (LLMAnalyzer.isCloudAnalysisEnabled()) {
                FeedbackManager.flush().catch((_error) => {
                    logger.error('Failed to flush feedback', _error, 'FeedbackManager');
                });
            }

        } catch (error) {
            logger.error('Failed to record feedback', error, 'FeedbackManager');
        }
    }

    // ─── Storage ───────────────────────────────────────────────────────────────

    private static async save(entry: FeedbackEntry): Promise<void> {
        const operation = FeedbackManager.saving.then(async () => {
            const all = await FeedbackManager.load();
            all.push(entry);
            await FeedbackManager.context.globalState.update(
                FeedbackManager.STORAGE_KEY, all.slice(-FeedbackManager.MAX_ENTRIES));
        });
        FeedbackManager.saving = operation.catch(() => {});
        await operation;
    }

    private static async load(): Promise<FeedbackEntry[]> {
        return FeedbackManager.context.globalState.get<FeedbackEntry[]>(
            FeedbackManager.STORAGE_KEY, []
        );
    }

    // ─── Flush to server ───────────────────────────────────────────────────────

    public static async flush(): Promise<void> {
        if (!FeedbackManager.context || !LLMAnalyzer.isCloudAnalysisEnabled()) { return; }
        if (FeedbackManager.flushing) { return FeedbackManager.flushing; }
        FeedbackManager.flushing = FeedbackManager.flushPending().finally(() => {
            FeedbackManager.flushing = undefined;
        });
        return FeedbackManager.flushing;
    }

    private static async flushPending(): Promise<void> {
        try {
            await FeedbackManager.saving;
            const analyzer = LLMAnalyzer.getInstance();
            if (!analyzer.isConfigured()) { return; }
            const pending = (await FeedbackManager.load()).filter(e => !e.sent);
            for (let i = 0; i < pending.length; i += 20) {
                const batch = pending.slice(i, i + 20);
                await analyzer.sendFeedback(batch.map(e => ({
                    id: e.id, feature_schema: e.feature_schema, features: e.features,
                    user_action: e.user_action, label: e.label,
                })));
                const ids = new Set(batch.map(e => e.id));
                const operation = FeedbackManager.saving.then(async () => {
                    const current = await FeedbackManager.load();
                    current.forEach(e => { if (ids.has(e.id)) { e.sent = true; } });
                    await FeedbackManager.context.globalState.update(FeedbackManager.STORAGE_KEY, current);
                });
                FeedbackManager.saving = operation.catch(() => {});
                await operation;
            }
        } catch (error) {
            logger.warn(`Feedback flush deferred: ${error instanceof Error ? error.message : 'Unknown'}`, 'FeedbackManager');
        }
    }

    // ─── Stats ─────────────────────────────────────────────────────────────────

    public static async getStats(): Promise<{
        total: number; confirmed: number; falsePositives: number; pending: number;
    }> {
        const all = await FeedbackManager.load();
        return {
            total:          all.length,
            confirmed:      all.filter(e => e.user_action === 'confirmed_secret').length,
            falsePositives: all.filter(e => e.user_action === 'marked_false_positive').length,
            pending:        all.filter(e => !e.sent).length,
        };
    }

    public static async clearAll(): Promise<void> {
        await FeedbackManager.context.globalState.update(FeedbackManager.STORAGE_KEY, []);
    }

}

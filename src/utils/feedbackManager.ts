/**
 * FeedbackManager
 * ===============
 * Collects user feedback on secret detections.
 * Stores locally + sends to Railway server for model retraining.
 */

import * as vscode from 'vscode';
import * as crypto from 'crypto';
import { DetectedSecret } from './secretScannerTypes';
import { FeatureExtractor } from './featureExtractor';
import { LLMAnalyzer } from './llmAnalyzer';
import { logger } from './logger';

export type UserAction   = 'confirmed_secret' | 'ignored_warning' | 'marked_false_positive';
export type FeedbackLabel = 'high' | 'medium' | 'low' | 'false_positive';

export interface FeedbackEntry {
    id:                   string;
    timestamp:            string;
    secret_value:         string;     // already redacted
    context:              string;
    variable_name?:       string;
    user_action:          UserAction;
    label:                FeedbackLabel;
    features:             number[];   // 35-element vector
    original_confidence:  string;
    file_type:            string;     // extension only
    sent:                 boolean;
}

export class FeedbackManager {

    private static readonly STORAGE_KEY = 'dotenvy.feedback.entries';
    private static readonly MAX_ENTRIES = 500;
    private static context: vscode.ExtensionContext;

    public static init(context: vscode.ExtensionContext): void {
        FeedbackManager.context = context;
    }

    // ─── Public API ────────────────────────────────────────────────────────────

    /** Call when user clicks "Not a Secret" */
    public static async recordFalsePositive(secret: DetectedSecret): Promise<void> {
        await FeedbackManager.record(secret, 'marked_false_positive', 'false_positive');
    }

    /** Call when user clicks "Move to .env" */
    public static async recordConfirmed(secret: DetectedSecret): Promise<void> {
        const label: FeedbackLabel =
            secret.confidence === 'high'   ? 'high'   :
            secret.confidence === 'medium' ? 'medium' : 'low';
        await FeedbackManager.record(secret, 'confirmed_secret', label);
    }

    // ─── Core ──────────────────────────────────────────────────────────────────

    private static async record(
        secret: DetectedSecret,
        action: UserAction,
        label:  FeedbackLabel
    ): Promise<void> {
        if (!FeedbackManager.context) { return; }

        try {
            const variableName = FeedbackManager.extractVariableName(secret.context);
            const features     = FeatureExtractor.extract(secret.content, secret.context, variableName);

            const entry: FeedbackEntry = {
                id:                  crypto.randomUUID(),
                timestamp:           new Date().toISOString(),
                secret_value:        secret.content,
                context:             secret.context,
                variable_name:       variableName,
                user_action:         action,
                label,
                features,
                original_confidence: secret.confidence,
                file_type:           FeedbackManager.getExt(secret.file),
                sent:                false,
            };

            await FeedbackManager.save(entry);
            logger.info(`Feedback: ${action} → ${label}`, 'FeedbackManager');

            // Non-blocking flush
            FeedbackManager.flush().catch((_error) => {
                logger.error('Failed to flush feedback', _error, 'FeedbackManager');
            });

        } catch (error) {
            logger.error('Failed to record feedback', error, 'FeedbackManager');
        }
    }

    // ─── Storage ───────────────────────────────────────────────────────────────

    private static async save(entry: FeedbackEntry): Promise<void> {
        const all = await FeedbackManager.load();
        all.push(entry);
        await FeedbackManager.context.globalState.update(
            FeedbackManager.STORAGE_KEY,
            all.slice(-FeedbackManager.MAX_ENTRIES)
        );
    }

    private static async load(): Promise<FeedbackEntry[]> {
        return FeedbackManager.context.globalState.get<FeedbackEntry[]>(
            FeedbackManager.STORAGE_KEY, []
        );
    }

    // ─── Flush to server ───────────────────────────────────────────────────────

    public static async flush(): Promise<void> {
        if (!FeedbackManager.context) { return; }

        const all     = await FeedbackManager.load();
        const pending = all.filter(e => !e.sent);
        if (pending.length === 0) { return; }

        try {
            const analyzer = LLMAnalyzer.getInstance();
            if (!analyzer.isConfigured()) { return; }

            // Batch of 20
            for (let i = 0; i < pending.length; i += 20) {
                const batch = pending.slice(i, i + 20);
                await analyzer.sendFeedback(batch.map(e => ({
                    secret_value:  e.secret_value,
                    context:       e.context,
                    variable_name: e.variable_name,
                    features:      e.features,
                    user_action:   e.user_action,
                    label:         e.label,
                    timestamp:     e.timestamp,
                })));
                batch.forEach(e => { e.sent = true; });
            }

            await FeedbackManager.context.globalState.update(
                FeedbackManager.STORAGE_KEY, all
            );

            logger.info(`Feedback flushed: ${pending.length} entries`, 'FeedbackManager');

        } catch (error) {
            logger.warn(
                `Feedback flush failed (will retry): ${error instanceof Error ? error.message : 'Unknown'}`,
                'FeedbackManager'
            );
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

    // ─── Helpers ───────────────────────────────────────────────────────────────

    private static extractVariableName(context: string): string | undefined {
        const m = context.match(/(?:const|let|var)\s+(\w+)|(\w+)\s*[:=]/);
        return m ? (m[1] || m[2]) : undefined;
    }

    private static getExt(filePath: string): string {
        const parts = filePath.split('.');
        return parts.length > 1 ? `.${parts[parts.length - 1]}` : 'unknown';
    }
}
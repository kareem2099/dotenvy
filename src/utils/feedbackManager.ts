/** Local secret corrections: stored on this machine only, never uploaded. */
import * as vscode from 'vscode';
import * as crypto from 'crypto';
import { DetectedSecret } from './secretScannerTypes';
import { CacheManager } from './cacheManager';
import { logger } from './logger';

export interface FeedbackEntry {
    fingerprint: string;
    timestamp: string;
    user_action: 'confirmed_secret' | 'marked_false_positive';
    label: 'high' | 'false_positive';
}

export class FeedbackManager {
    private static readonly STORAGE_KEY = 'dotenvy.corrections.local.v1';
    private static readonly MAX_ENTRIES = 500;
    /** State left behind by the removed DotAegis integration. */
    private static readonly LEGACY_KEYS = ['dotenvy.feedback.entries', 'dotenvy.feedback.features.v2',
        'dotenvy.feedback.features.v3', 'dotenvy.community.consentPrompted.v1'];
    private static context?: vscode.ExtensionContext;
    private static saving: Promise<void> = Promise.resolve();
    private static readonly listeners = new Set<(sourceFile?: string) => void>();

    public static onDidChange(listener: (sourceFile?: string) => void): vscode.Disposable {
        this.listeners.add(listener);
        return { dispose: () => { this.listeners.delete(listener); } };
    }

    private static notifyChanged(sourceFile?: string): void {
        for (const listener of this.listeners) {
            try { listener(sourceFile); }
            catch { logger.warn('Correction observer unavailable.', 'FeedbackManager'); }
        }
    }

    public static async init(context: vscode.ExtensionContext): Promise<void> {
        this.context = context;
        for (const key of this.LEGACY_KEYS) { await context.globalState.update(key, undefined); }
    }

    private static fingerprint(sourceFile: string, variableName: string | undefined, valueDigest: string): string {
        return crypto.createHash('sha256').update(JSON.stringify([sourceFile, variableName || '', valueDigest])).digest('hex');
    }

    public static decision(sourceFile: string, variableName: string | undefined, valueDigest: string): FeedbackEntry['label'] | undefined {
        const key = this.fingerprint(sourceFile, variableName, valueDigest);
        return this.load().find(entry => entry.fingerprint === key)?.label;
    }

    public static async recordFalsePositive(secret: DetectedSecret): Promise<void> { await this.record(secret, 'false_positive'); }
    public static async recordConfirmed(secret: DetectedSecret): Promise<void> { await this.record(secret, 'high'); }

    private static load(): FeedbackEntry[] {
        return this.context?.globalState.get<FeedbackEntry[]>(this.STORAGE_KEY, []) || [];
    }

    private static async record(secret: DetectedSecret, label: FeedbackEntry['label']): Promise<void> {
        if (!this.context || !secret.sourceFile || !secret.valueDigest) { return; }
        const fingerprint = this.fingerprint(secret.sourceFile, secret.variableName, secret.valueDigest);
        const operation = this.saving.then(async () => {
            const all = this.load().filter(e => e.fingerprint !== fingerprint);
            all.push({fingerprint, timestamp: new Date().toISOString(), label,
                      user_action: label === 'high' ? 'confirmed_secret' : 'marked_false_positive'});
            await this.context?.globalState.update(this.STORAGE_KEY, all.slice(-this.MAX_ENTRIES));
            CacheManager.invalidateFileCache(secret.sourceFile!);
        });
        this.saving = operation.catch(() => {});
        await operation;
        this.notifyChanged(secret.sourceFile);
    }

    public static async getStats() {
        const all = this.load();
        return {total: all.length, falsePositives: all.filter(e => e.label === 'false_positive').length,
                confirmed: all.filter(e => e.label === 'high').length};
    }

    public static async clear(): Promise<void> {
        const operation = this.saving.then(async () => {
            await this.context?.globalState.update(this.STORAGE_KEY, undefined);
            CacheManager.clearCache();
        });
        this.saving = operation.catch(() => {});
        await operation;
        this.notifyChanged();
    }
}

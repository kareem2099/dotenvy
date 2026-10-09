/** Immediate local corrections and a separate opt-in numeric feedback queue. */
import * as vscode from 'vscode';
import * as crypto from 'crypto';
import { DetectedSecret } from './secretScannerTypes';
import { CacheManager } from './cacheManager';
import { LLMAnalyzer } from './llmAnalyzer';
import { CommunitySample, validSample, wireSample } from './aegisClient';
import { t } from '../i18n';
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
    private static readonly QUEUE_KEY = 'dotenvy.feedback.features.v3';
    private static readonly CONSENT_KEY = 'dotenvy.community.consentPrompted.v1';
    private static consentPending?: Promise<boolean>;
    private static uploading?: Promise<void>;
    private static context?: vscode.ExtensionContext;
    private static saving: Promise<void> = Promise.resolve();

    public static async init(context: vscode.ExtensionContext): Promise<void> {
        this.context = context;
        await context.globalState.update('dotenvy.feedback.entries', undefined);
        await context.globalState.update('dotenvy.feedback.features.v2', undefined);
        if (!LLMAnalyzer.isCommunityLearningEnabled()) { await this.clearQueue(); }
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
            if (LLMAnalyzer.isCommunityLearningEnabled() && secret.features) {
                const sample: CommunitySample = {id: crypto.randomUUID(), feature_schema: 2,
                    features: [...secret.features], label, user_action: label === 'high' ? 'confirmed_secret' : 'marked_false_positive'};
                if (validSample(sample)) {
                    const queue = this.queue();
                    queue.push(wireSample(sample));
                    await this.context?.globalState.update(this.QUEUE_KEY, queue.slice(-this.MAX_ENTRIES));
                }
            }
        });
        this.saving = operation.catch(() => {});
        await operation;
        void this.flush();
    }

    /** The local action has already completed before the panel calls this. */
    public static async offerAfterCorrection(secret: DetectedSecret, label: FeedbackEntry['label']): Promise<void> {
        if (LLMAnalyzer.isCommunityLearningEnabled() || !secret.sourceFile || !secret.valueDigest || !secret.features) { return; }
        const sample: CommunitySample = {id: crypto.randomUUID(), feature_schema: 2, features: [...secret.features],
            label, user_action: label === 'high' ? 'confirmed_secret' : 'marked_false_positive'};
        if (!validSample(sample)) { return; }
        try {
            if (!await this.requestCommunityConsent(false, true)) { return; }
            const operation = this.saving.then(async () => {
                // Share this explicitly consented correction only; never backfill local history.
                if (!LLMAnalyzer.isCommunityLearningEnabled() ||
                    this.decision(secret.sourceFile!, secret.variableName, secret.valueDigest!) !== label) { return; }
                const queue = this.queue();
                queue.push(wireSample(sample));
                await this.context?.globalState.update(this.QUEUE_KEY, queue.slice(-this.MAX_ENTRIES));
            });
            this.saving = operation.catch(() => {});
            await operation;
            void this.flush();
        } catch {
            // An optional sharing/prompt failure must never undo a successful local action.
            logger.warn('Community sharing unavailable; correction remains local.', 'FeedbackManager');
        }
    }

    public static async markCommunityChoice(): Promise<void> {
        await this.context?.globalState.update(this.CONSENT_KEY, true);
    }

    public static async requestCommunityConsent(force = true, includeCurrent = false): Promise<boolean> {
        if (!this.context) { return false; }
        if (LLMAnalyzer.isCommunityLearningEnabled()) { return true; }
        if (this.consentPending) { return this.consentPending; }
        const config = vscode.workspace.getConfiguration('dotenvy');
        if (!force && (this.context.globalState.get<boolean>(this.CONSENT_KEY, false) ||
            config.inspect<boolean>('secrets.enableCommunityLearning')?.globalValue === false)) { return false; }
        this.consentPending = (async () => {
            // Remember display/dismissal too: do not ask again after every secret or restart.
            await this.markCommunityChoice();
            const enable = t('extension.community.enable');
            const local = t('extension.community.keepLocal');
            const answer = await vscode.window.showInformationMessage(t('extension.community.prompt'),
                {modal: true, detail: t(includeCurrent ? 'extension.community.consentAfterCorrection' : 'extension.community.consent')},
                enable, local);
            if (answer !== enable) { return false; }
            await config.update('secrets.enableCommunityLearning', true, vscode.ConfigurationTarget.Global);
            return LLMAnalyzer.isCommunityLearningEnabled();
        })().finally(() => { this.consentPending = undefined; });
        return this.consentPending;
    }

    private static queue(): CommunitySample[] {
        return (this.context?.globalState.get<CommunitySample[]>(this.QUEUE_KEY, []) || []).filter(validSample).map(wireSample);
    }

    public static flush(): Promise<void> {
        if (this.uploading) { return this.uploading; }
        this.uploading = (async () => {
            try {
                await this.saving;
                if (!LLMAnalyzer.isCommunityLearningEnabled()) { return; }
                const batch = this.queue().slice(0, 20);
                if (!batch.length) { return; }
                const ids = await LLMAnalyzer.getInstance().sendFeedback(batch);
                const operation = this.saving.then(async () => {
                    const remaining = this.queue().filter(sample => !ids.includes(sample.id));
                    await this.context?.globalState.update(this.QUEUE_KEY, remaining);
                });
                this.saving = operation.catch(() => {});
                await operation;
            } catch { /* Keep stable IDs for a later acknowledged retry. */ }
        })().finally(() => {this.uploading = undefined;});
        return this.uploading;
    }

    public static async clearQueue(): Promise<void> {
        const operation = this.saving.then(() => this.context?.globalState.update(this.QUEUE_KEY, undefined));
        this.saving = operation.then(() => {}, () => {});
        await operation;
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
    }
}

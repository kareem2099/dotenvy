import * as vscode from 'vscode';
import { FeatureExtractor, NUM_FEATURES } from './featureExtractor';
import { LocalModelService } from './localModelService';
import { logger } from './logger';
import { AegisClient, CommunitySample, communityEnabled } from './aegisClient';
import { CacheManager } from './cacheManager';
import * as fs from 'fs';

/** Secret classification is entirely local, including when legacy cloud settings are true. */
export class LLMAnalyzer {
    private static instance: LLMAnalyzer | undefined;
    private model: LocalModelService;
    private readonly client: AegisClient;
    private refreshing?: Promise<void>;
    private closed = false;

    private constructor(context: vscode.ExtensionContext) {
        this.client = new AegisClient(context);
        this.model = new LocalModelService(this.client.cachedDirectory());
    }

    public static async initialize(context: vscode.ExtensionContext): Promise<LLMAnalyzer> {
        if (!this.instance) {
            this.instance = new LLMAnalyzer(context);
            context.subscriptions?.push(this.instance);
            try { await this.instance.model.ready; }
            catch {
                this.instance.model.dispose();
                await this.instance.client.clearCachedRevision();
                this.instance.model = new LocalModelService();
                try { await this.instance.model.ready; }
                catch { logger.warn('Local model unavailable; using local heuristics. No cloud fallback.', 'LLMAnalyzer'); }
            }
        }
        return this.instance;
    }

    public static getInstance(): LLMAnalyzer {
        if (!this.instance) { throw new Error('Initialize the local classifier before scanning'); }
        return this.instance;
    }

    public async analyzeSecret(secretValue: string, context: string, variableName?: string): Promise<'high' | 'medium' | 'low'> {
        const features = this.extractFeatures(secretValue, context, variableName);
        try {
            const result = await this.model.predict(features);
            return result.prediction === 'false_positive' ? 'low' : result.prediction;
        } catch {
            return this.fallbackAnalysis(features);
        }
    }

    public extractFeatures(secretValue: string, context: string, variableName?: string): number[] {
        return FeatureExtractor.extract(secretValue, context, variableName);
    }

    private fallbackAnalysis(features: number[]): 'high' | 'medium' | 'low' {
        const entropy = features[7] * 8, pattern = features[14], context = features[20], variable = features[25];
        if (pattern >= 1 && entropy > 4) { return 'high'; }
        if (entropy > 4.5 && (context > 0 || variable > 0)) { return 'high'; }
        if (entropy > 3.8 && (context > 0 || variable > 0)) { return 'medium'; }
        return entropy > 3.5 ? 'medium' : 'low';
    }

    public isModelAvailable(): boolean { return this.model.available; }
    public getServiceStatus() { return {mode: 'local', ready: this.model.available, numFeatures: NUM_FEATURES}; }
    public async sendFeedback(samples: CommunitySample[]): Promise<string[]> { return this.client.sendFeedback(samples); }
    public static isCommunityLearningEnabled(): boolean { return communityEnabled(); }
    public refreshModel(): Promise<void> {
        if (this.refreshing) { return this.refreshing; }
        this.refreshing = (async () => {
            let candidate: LocalModelService | undefined;
            let directory: string | undefined;
            try {
                const release = await this.client.fetchModel();
                if (!release || this.closed) { return; }
                directory = release.directory;
                candidate = new LocalModelService(directory);
                await candidate.ready;
                if (this.closed) { candidate.dispose(); return; }
                await this.client.acceptModel(directory, release.hash);
                if (this.closed) { candidate.dispose(); return; }
                const old = this.model;
                this.model = candidate;
                candidate = undefined;
                old.dispose();
                CacheManager.clearCache();
            } catch {
                candidate?.dispose();
                if (directory && directory !== this.client.cachedDirectory()) {
                    fs.rmSync(directory, {recursive: true, force: true});
                }
                logger.warn('Model update unavailable; retaining local classifier.', 'LLMAnalyzer');
            }
        })().finally(() => {this.refreshing = undefined;});
        return this.refreshing;
    }
    public dispose(): void { this.closed = true; this.client.dispose(); this.model.dispose(); LLMAnalyzer.instance = undefined; }
}

import * as https from 'https';
import * as http from 'http';
import * as crypto from 'crypto';
import * as vscode from 'vscode';

import { FeatureExtractor, NUM_FEATURES } from './featureExtractor';
import { logger } from './logger';

export interface LLMAnalysisRequest {
    secret_value: string;
    context: string;
    variable_name?: string;
}

export interface LLMAnalysisResponse {
    enhanced_confidence: string;
    method: string;
    error?: string;
    is_likely_secret?: boolean;
    risk_level?: string;
}

export interface LLMHealthResponse {
    status: string;
    message?: string;
}

const SECRET_STORAGE_KEY = 'dotenvy.llm.sharedSecret';

export class LLMAnalyzer {

    private static instance: LLMAnalyzer | null = null;
    private readonly serviceUrl = 'https://python-llm-production.up.railway.app';
    private sharedSecret: string | undefined;
    private readonly secrets: vscode.SecretStorage;
    private isConnected = false;
    private failureCount = 0;
    private readonly MAX_FAILURES = 3;
    private circuitBreakerOpen = false;
    private lastFailureTime = 0;
    private readonly CIRCUIT_BREAKER_TIMEOUT = 60_000;

    private constructor(context: vscode.ExtensionContext) {
        this.secrets = context.secrets;
    }

    public static async initialize(context: vscode.ExtensionContext): Promise<LLMAnalyzer> {
        if (!LLMAnalyzer.instance) {
            LLMAnalyzer.instance = new LLMAnalyzer(context);
        }
        await LLMAnalyzer.instance.loadSecret();
        return LLMAnalyzer.instance;
    }

    public static getInstance(): LLMAnalyzer {
        if (!LLMAnalyzer.instance) {
            throw new Error('[DotEnvy] Call await LLMAnalyzer.initialize(context) in activate() first.');
        }
        return LLMAnalyzer.instance;
    }

    private async loadSecret(): Promise<void> {
        this.sharedSecret = await this.secrets.get(SECRET_STORAGE_KEY);
        if (!this.sharedSecret) {
            logger.warn('[DotEnvy] ⚠️  Shared secret not found in SecretStorage.', 'LLMAnalyzer');
        } else {
            logger.info('[DotEnvy] ✅ Shared secret loaded from SecretStorage.', 'LLMAnalyzer');
        }
    }

    public async setSharedSecret(secret: string): Promise<void> {
        await this.secrets.store(SECRET_STORAGE_KEY, secret);
        this.sharedSecret = secret;
        logger.info('[DotEnvy] ✅ Shared secret saved to SecretStorage.', 'LLMAnalyzer');
    }

    public async clearSharedSecret(): Promise<void> {
        await this.secrets.delete(SECRET_STORAGE_KEY);
        this.sharedSecret = undefined;
    }

    public isConfigured(): boolean { return !!this.sharedSecret; }

    private signRequest(body: string): { timestamp: string; signature: string } {
        if (!this.sharedSecret) {
            throw new Error('[DotEnvy] Cannot sign — secret not loaded.');
        }
        const timestamp = String(Math.floor(Date.now() / 1000));
        const signature = crypto
            .createHmac('sha256', this.sharedSecret)
            .update(`${timestamp}.${body}`)
            .digest('hex');
        return { timestamp, signature };
    }

    private getMachineId(): string {
        try { return vscode.env.machineId || 'unknown-machine'; }
        catch { return 'unknown-machine'; }
    }

    private shouldResetCircuitBreaker(): boolean {
        if (!this.circuitBreakerOpen) { return false; }
        if (Date.now() - this.lastFailureTime > this.CIRCUIT_BREAKER_TIMEOUT) {
            this.circuitBreakerOpen = false;
            this.failureCount = 0;
            return true;
        }
        return false;
    }

    private recordFailure(): void {
        this.failureCount++;
        this.lastFailureTime = Date.now();
        if (this.failureCount >= this.MAX_FAILURES) {
            this.circuitBreakerOpen = true;
        }
    }

    private recordSuccess(): void {
        this.failureCount = 0;
        this.circuitBreakerOpen = false;
    }

    public async testConnection(): Promise<boolean> {
        try {
            const res = await this.makeRequest('/health', 'GET') as LLMHealthResponse;
            this.isConnected = res?.status === 'ok';
            if (this.isConnected) { this.recordSuccess(); }
            return this.isConnected;
        } catch {
            this.isConnected = false;
            this.recordFailure();
            return false;
        }
    }

    public async analyzeSecret(secretValue: string, context: string, variableName?: string): Promise<string> {
        this.shouldResetCircuitBreaker();

        if (this.circuitBreakerOpen || !this.sharedSecret) {
            return this.fallbackAnalysis(secretValue, context, variableName);
        }

        try {
            const response = await this.makeSignedRequest('/extension/analyze', {
                secret_value: secretValue, context, variable_name: variableName,
            }) as LLMAnalysisResponse;

            if (response) {
                this.recordSuccess();
                if (response.is_likely_secret &&
                    (response.risk_level === 'high' || response.risk_level === 'critical')) {
                    return 'high';
                }
                if (response.enhanced_confidence) {
                    const map: Record<string, string> = {
                        critical: 'high', high: 'high', medium: 'medium', low: 'low',
                    };
                    return map[response.enhanced_confidence.toLowerCase()] || response.enhanced_confidence;
                }
            }
        } catch (error) {
            this.recordFailure();
            logger.warn(
                `LLM failed, using fallback: ${error instanceof Error ? error.message : 'Unknown'}`,
                'LLMAnalyzer');
            }   

        return this.fallbackAnalysis(secretValue, context, variableName);
    }

    public async sendFeedback(payload: unknown[]): Promise<void> {
        await this.makeSignedRequest('/extension/feedback', { samples: payload });
    }

    // ✅ الآن يستخدم FeatureExtractor — carbon copy من feature_extractor.py
    public extractFeatures(secretValue: string, context: string, variableName?: string): number[] {
        return FeatureExtractor.extract(secretValue, context, variableName);
    }

    private async makeSignedRequest(endpoint: string, data: unknown): Promise<unknown> {
        const body = JSON.stringify(data);
        const { timestamp, signature } = this.signRequest(body);
        const machineId = this.getMachineId();

        return new Promise((resolve, reject) => {
            const url = new URL(endpoint, this.serviceUrl);
            const client = url.protocol === 'https:' ? https : http;
            const req = client.request({
                hostname: url.hostname,
                port: url.port || (url.protocol === 'https:' ? 443 : 80),
                path: url.pathname,
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(body),
                    'User-Agent': 'DotEnvy-Extension/2.0',
                    'X-Extension-Timestamp': timestamp,
                    'X-Extension-Signature': signature,
                    'X-Machine-ID': machineId,
                },
            }, (res) => {
                let rb = '';
                res.on('data', (c) => { rb += c.toString(); });
                res.on('end', () => {
                    if (res.statusCode && res.statusCode >= 400) {
                        reject(new Error(`HTTP ${res.statusCode}: ${rb}`)); return;
                    }
                    try { resolve(JSON.parse(rb)); } catch { resolve(rb); }
                });
            });
            req.on('error', reject);
            req.setTimeout(5000, () => { req.destroy(); reject(new Error('Timeout')); });
            req.write(body);
            req.end();
        });
    }

    private async makeRequest(endpoint: string, method = 'GET'): Promise<unknown> {
        return new Promise((resolve, reject) => {
            const url = new URL(endpoint, this.serviceUrl);
            const client = url.protocol === 'https:' ? https : http;
            const req = client.request({
                hostname: url.hostname,
                port: url.port || (url.protocol === 'https:' ? 443 : 80),
                path: url.pathname, method,
                headers: { 'User-Agent': 'DotEnvy-Extension/2.0' },
            }, (res) => {
                let b = '';
                res.on('data', (c) => { b += c.toString(); });
                res.on('end', () => { try { resolve(JSON.parse(b)); } catch { resolve(b); } });
            });
            req.on('error', reject);
            req.setTimeout(5000, () => { req.destroy(); reject(new Error('Timeout')); });
            req.end();
        });
    }

    private fallbackAnalysis(
        secretValue: string, 
        context: string,
        variableName?: string
    ): string {
        const features    = FeatureExtractor.extract(secretValue, context, variableName);
        const entropy     = features[7] * 8.0;   // f[7] = entropy/8
        const patternScore = features[14];         // f[14] = pattern match score
        const ctxHighRisk    = features[20];          // f[20] = high-risk context
        const varHighRisk  = features[25];          // f[25] = variable name high-risk score

        if (patternScore >= 1.0 && entropy > 4.0)                    { return 'high'; }
        if (entropy > 4.5 && (ctxHighRisk > 0 || varHighRisk > 0))   { return 'high'; }
        if (entropy > 3.8 && (ctxHighRisk > 0 || varHighRisk > 0))   { return 'medium'; }
        if (entropy > 3.5)                                            { return 'medium'; }
        return 'low';
    }

    public isServiceAvailable(): boolean { return this.isConnected && !this.circuitBreakerOpen; }

    public getServiceStatus() {
        return {
            connected: this.isConnected,
            circuitBreakerOpen: this.circuitBreakerOpen,
            failureCount: this.failureCount,
            configured: this.isConfigured(),
            numFeatures: NUM_FEATURES,
        };
    }

    public setServiceUrl(url: string): void {
        (this as unknown as { serviceUrl: string }).serviceUrl = url;
    }
}
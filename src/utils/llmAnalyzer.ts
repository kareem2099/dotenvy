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

const KNOWN_SECRET_PATTERNS: { name: string; regex: RegExp }[] = [
    { name: 'AWS Access Key', regex: /^AKIA[0-9A-Z]{16}/ },
    { name: 'Stripe Live Key', regex: /^sk_live_[0-9a-zA-Z]{24,}/ },
    { name: 'Stripe Test Key', regex: /^sk_test_[0-9a-zA-Z]{24,}/ },
    { name: 'GitHub Token', regex: /^ghp_[a-zA-Z0-9]{36}/ },
    { name: 'OpenAI Key', regex: /^sk-[a-zA-Z0-9]{48}/ },
    { name: 'Google API Key', regex: /^AIza[0-9A-Za-z\-_]{35}/ },
];

export class LLMAnalyzer {

    private static instance: LLMAnalyzer | null = null;
    private readonly serviceUrl = 'https://aegis.dotsuite.dev';
    private sharedSecret: string | undefined;
    private readonly secrets: vscode.SecretStorage;
    private readonly extensionMode: vscode.ExtensionMode;
    private isConnected = false;
    private failureCount = 0;
    private readonly MAX_FAILURES = 3;
    private circuitBreakerOpen = false;
    private lastFailureTime = 0;
    private readonly CIRCUIT_BREAKER_TIMEOUT = 60_000;
    private communityBlacklist: Set<string> = new Set();
    private readonly state: vscode.Memento;
    private machineId: string;

    private constructor(context: vscode.ExtensionContext) {
        this.secrets = context.secrets;
        this.extensionMode = context.extensionMode;
        this.state = context.globalState;
        this.machineId = this.state?.get<string>('dotenvy.llm.installationId') || vscode.env.machineId;
    }

    public static isCloudAnalysisEnabled(): boolean {
        return vscode.workspace?.getConfiguration?.('dotenvy')?.get<boolean>('secrets.enableCloudAnalysis', false) ?? false;
    }

    public static async initialize(context: vscode.ExtensionContext): Promise<LLMAnalyzer> {
        if (!LLMAnalyzer.instance) {
            LLMAnalyzer.instance = new LLMAnalyzer(context);
        }
        if (LLMAnalyzer.isCloudAnalysisEnabled()) {
            await LLMAnalyzer.instance.loadSecret();
            await LLMAnalyzer.instance.syncBlacklist().catch(() => { });
        }
        return LLMAnalyzer.instance;
    }

    public async onCloudAnalysisEnabled(): Promise<void> {
        await this.loadSecret();
        await this.syncBlacklist().catch(() => { });
    }

    public static getInstance(): LLMAnalyzer {
        if (!LLMAnalyzer.instance) {
            throw new Error('[DotEnvy] Call await LLMAnalyzer.initialize(context) in activate() first.');
        }
        return LLMAnalyzer.instance;
    }

    private async loadSecret(): Promise<void> {
        if (!LLMAnalyzer.isCloudAnalysisEnabled()) {
            return;
        }

        // 1. Try SecretStorage (Device-specific credential already stored)
        this.sharedSecret = await this.secrets.get(SECRET_STORAGE_KEY);
        if (this.sharedSecret) {
            logger.info('[DotEnvy] ✅ Device credentials loaded from SecretStorage.', 'LLMAnalyzer');
            return;
        }

        // A lost credential starts a new installation; machine IDs are not ownership proof.
        if (!this.state?.get<string>('dotenvy.llm.installationId')) {
            this.machineId = crypto.randomUUID();
            await this.state?.update('dotenvy.llm.installationId', this.machineId);
        }

        // 2. First run with cloud analysis enabled: Perform secure dynamic device registration with backend
        try {
            logger.info('[DotEnvy] 🔑 Initiating secure device handshake with backend...', 'LLMAnalyzer');
            await this.registerWithBackend();
        } catch (err) {
            logger.info(`[DotEnvy] ℹ️ Handshake deferred (offline or service unreachable): ${err}`, 'LLMAnalyzer');
        }
    }

    public async registerWithBackend(): Promise<boolean> {
        return new Promise((resolve) => {
            const machineId = this.getMachineId();
            const extVersion = vscode.extensions?.getExtension('FreeRave.dotenvy')?.packageJSON?.version || '2.2.2';
            const payload = JSON.stringify({
                machine_id: machineId,
                vscode_version: vscode.version || '',
                extension_version: extVersion
            });

            const url = new URL('/extension/register', this.serviceUrl);
            const client = url.protocol === 'https:' ? https : http;

            const req = client.request({
                hostname: url.hostname,
                port: url.port || (url.protocol === 'https:' ? 443 : 80),
                path: url.pathname,
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(payload),
                    'User-Agent': 'DotEnvy-Extension/2.2.2'
                }
            }, (res) => {
                let data = '';
                res.on('data', (chunk) => { data += chunk.toString(); });
                res.on('end', async () => {
                    try {
                        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
                            const parsed = JSON.parse(data);
                            if (parsed.client_secret) {
                                await this.setSharedSecret(parsed.client_secret);
                                logger.info('[DotEnvy] 🔑 Device handshake completed successfully.', 'LLMAnalyzer');
                                resolve(true);
                                return;
                            }
                        }
                        logger.info(`[DotEnvy] ℹ️ Device registration deferred: status ${res.statusCode}`, 'LLMAnalyzer');
                        resolve(false);
                    } catch (e) {
                        logger.info(`[DotEnvy] ℹ️ Device registration parse error: ${e}`, 'LLMAnalyzer');
                        resolve(false);
                    }
                });
            });

            req.on('error', (err) => {
                logger.info(`[DotEnvy] ℹ️ Device registration offline: ${err.message}`, 'LLMAnalyzer');
                resolve(false);
            });

            req.setTimeout(5000, () => {
                req.destroy();
                logger.info('[DotEnvy] ℹ️ Device registration timeout (will retry next session)', 'LLMAnalyzer');
                resolve(false);
            });

            req.write(payload);
            req.end();
        });
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
        return this.machineId;
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
        if (!LLMAnalyzer.isCloudAnalysisEnabled()) {
            return false;
        }
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
        // L1 — Regex (free, instant, 100% local)
        const regexHit = KNOWN_SECRET_PATTERNS.find(p => p.regex.test(secretValue));
        if (regexHit) {
            logger.info(`[DotEnvy] Regex match: ${regexHit.name}`, 'LLMAnalyzer');
            if (variableName && LLMAnalyzer.isCloudAnalysisEnabled()) {
                this.syncHashToServer(variableName, secretValue).catch(() => { });
            }
            return 'high';
        }

        // L2 — Community Blacklist (Local Cache - Fast Path)
        if (variableName && this.communityBlacklist.size > 0) {
            const h = this.hashEntry(variableName, secretValue);
            if (this.communityBlacklist.has(h)) {
                logger.info(`[DotEnvy] Community blacklist match: ${variableName}`, 'LLMAnalyzer');
                return 'high';
            }
        }

        // L3 — Entropy gate (skip LLM entirely for low-entropy values)
        const features = this.extractFeatures(secretValue, context, variableName);
        const entropy = features[7] * 8.0;   // f[7] = entropy/8
        if (entropy < 3.5) { return 'low'; }

        // Local-First Gate: If Cloud Analysis is disabled, evaluate 100% locally
        if (!LLMAnalyzer.isCloudAnalysisEnabled()) {
            return this.fallbackAnalysis(secretValue, context, variableName);
        }

        // L4 — LLM (The brain)
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
                let result = 'low';

                if (response.is_likely_secret &&
                    (response.risk_level === 'high' || response.risk_level === 'critical')) {
                    result = 'high';
                } else if (response.enhanced_confidence) {
                    const map: Record<string, string> = {
                        critical: 'high', high: 'high', medium: 'medium', low: 'low',
                    };
                    result = map[response.enhanced_confidence.toLowerCase()] || response.enhanced_confidence;
                }

                // If LLM says "high", sync to server to help the community
                if (result === 'high' && variableName && LLMAnalyzer.isCloudAnalysisEnabled()) {
                    this.syncHashToServer(variableName, secretValue).catch(() => { });
                }
                return result;
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
        if (!LLMAnalyzer.isCloudAnalysisEnabled() || !this.sharedSecret) {
            throw new Error('Cloud feedback is unavailable');
        }
        const response = await this.makeSignedRequest('/extension/feedback', { samples: payload }) as {
            status?: string; accepted_sample_ids?: string[];
        };
        const ids = payload.map(p => (p as {id: string}).id);
        if (response?.status !== 'queued' || !Array.isArray(response.accepted_sample_ids) ||
            !ids.every(id => response.accepted_sample_ids?.includes(id))) {
            throw new Error('Server did not acknowledge all feedback samples');
        }
    }

    // ✅ الآن يستخدم FeatureExtractor — carbon copy من feature_extractor.py
    public extractFeatures(secretValue: string, context: string, variableName?: string): number[] {
        return FeatureExtractor.extract(secretValue, context, variableName);
    }

    public hashEntry(variableName: string, value: string): string {
        return crypto
            .createHash('sha256')
            .update(JSON.stringify([variableName, value]))
            .digest('hex');
    }

    public async syncHashToServer(variableName: string, value: string): Promise<void> {
        if (!LLMAnalyzer.isCloudAnalysisEnabled() || !this.sharedSecret) { return; }
        const hash = this.hashEntry(variableName, value);
        try {
            await this.makeSignedRequest('/extension/blacklist/add', { hash, hash_version: 2 });
        } catch (e) {
            logger.warn(`Hash sync failed: ${e instanceof Error ? e.message : 'Unknown'}`, 'LLMAnalyzer');
        }
    }

    public async reportFalsePositive(variableName: string, value: string): Promise<void> {
        if (!LLMAnalyzer.isCloudAnalysisEnabled() || !this.sharedSecret) { return; }
        const hash = this.hashEntry(variableName, value);
        try {
            const res = await this.makeSignedRequest('/extension/blacklist/report_fp', { hash, hash_version: 2 }) as { status?: string };
            if (res && res.status === 'removed') {
                this.communityBlacklist.delete(hash);
                logger.info('[DotEnvy] 🚀 False positive threshold met. Hash removed from blacklist.', 'LLMAnalyzer');
            }
        } catch (e) {
            logger.warn(`FP report failed: ${e instanceof Error ? e.message : 'Unknown'}`, 'LLMAnalyzer');
        }
    }

    private async syncBlacklist(): Promise<void> {
        if (!LLMAnalyzer.isCloudAnalysisEnabled() || !this.sharedSecret) { return; }
        try {
            const res = await this.makeSignedGetRequest('/extension/blacklist') as { hashes: string[]; hash_version: number };
            if (res && res.hash_version === 2 && Array.isArray(res.hashes)) {
                this.communityBlacklist = new Set(res.hashes.filter(h => /^[0-9a-f]{64}$/.test(h)));
                logger.info(`[DotEnvy] 🔄 Community Blacklist synced (${this.communityBlacklist.size} hashes).`, 'LLMAnalyzer');
            }
        } catch (e) {
            logger.warn(`Blacklist sync failed: ${e instanceof Error ? e.message : 'Unknown'}`, 'LLMAnalyzer');
        }
    }

    private async makeSignedGetRequest(endpoint: string): Promise<unknown> {
        if (!this.sharedSecret) {
            throw new Error('[DotEnvy] Cannot sign — secret not loaded.');
        }
        const body = '';
        const timestamp = String(Math.floor(Date.now() / 1000));
        const signature = crypto
            .createHmac('sha256', this.sharedSecret)
            .update(`${timestamp}.${body}`)
            .digest('hex');

        return new Promise((resolve, reject) => {
            const url = new URL(endpoint, this.serviceUrl);
            const client = url.protocol === 'https:' ? https : http;
            const req = client.request({
                hostname: url.hostname,
                port: url.port || (url.protocol === 'https:' ? 443 : 80),
                path: url.pathname,
                method: 'GET',
                headers: {
                    'User-Agent': 'DotEnvy-Extension/2.2.2',
                    'X-Extension-Timestamp': timestamp,
                    'X-Extension-Signature': signature,
                    'X-Machine-ID': this.getMachineId(),
                },
            }, (res) => {
                let b = '';
                res.on('data', (c) => { b += c.toString(); });
                res.on('end', () => {
                    if (!res.statusCode || res.statusCode >= 400) { reject(new Error(`HTTP ${res.statusCode}`)); return; }
                    try { resolve(JSON.parse(b)); } catch { reject(new Error('Invalid server response')); }
                });
            });
            req.on('error', reject);
            req.setTimeout(5000, () => { req.destroy(); reject(new Error('Timeout')); });
            req.end();
        });
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
                    'User-Agent': 'DotEnvy-Extension/2.2.2',
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
                headers: { 'User-Agent': 'DotEnvy-Extension/2.2.2' },
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
        const features = FeatureExtractor.extract(secretValue, context, variableName);
        const entropy = features[7] * 8.0;   // f[7] = entropy/8
        const patternScore = features[14];         // f[14] = pattern match score
        const ctxHighRisk = features[20];          // f[20] = high-risk context
        const varHighRisk = features[25];          // f[25] = variable name high-risk score

        if (patternScore >= 1.0 && entropy > 4.0) { return 'high'; }
        if (entropy > 4.5 && (ctxHighRisk > 0 || varHighRisk > 0)) { return 'high'; }
        if (entropy > 3.8 && (ctxHighRisk > 0 || varHighRisk > 0)) { return 'medium'; }
        if (entropy > 3.5) { return 'medium'; }
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

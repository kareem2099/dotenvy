/**
 * LLM Analyzer - Secure Version
 * ==============================
 * 
 * Uses HMAC-SHA256 signatures instead of exposing an API key.
 * The shared secret is only used for signing — it's not an API key
 * and grants no direct access to any external service.
 */

import * as https from 'https';
import * as http from 'http';
import * as crypto from 'crypto';

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

export class LLMAnalyzer {
    private static instance: LLMAnalyzer;

    // ✅ No API key — just the service URL and a shared secret for signing
    private readonly serviceUrl = 'https://python-llm-production.up.railway.app';
    
    // This is NOT an API key. It's a shared secret used only to sign requests.
    // Even if someone extracts it, they can only call THIS proxy — not any real service.
    // Rate limiting on the server handles abuse.
    private readonly sharedSecret = process.env.EXTENSION_SHARED_SECRET || 'REPLACE_AT_BUILD_TIME';

    private isConnected = false;
    private failureCount = 0;
    private readonly MAX_FAILURES = 3;
    private circuitBreakerOpen = false;
    private lastFailureTime = 0;
    private readonly CIRCUIT_BREAKER_TIMEOUT = 60000;

    private constructor() {
        if (!this.sharedSecret || this.sharedSecret === 'REPLACE_AT_BUILD_TIME') {
            console.warn('⚠️  EXTENSION_SHARED_SECRET not set in build environment');
        }
    }

    public static getInstance(): LLMAnalyzer {
        if (!LLMAnalyzer.instance) {
            LLMAnalyzer.instance = new LLMAnalyzer();
        }
        return LLMAnalyzer.instance;
    }

    // ─── HMAC Signing ──────────────────────────────────────────────────────────

    /**
     * Sign a request body with HMAC-SHA256.
     * Matches the verification in extension_auth.py on the server.
     */
    private signRequest(body: string): { timestamp: string; signature: string } {
        const timestamp = String(Date.now() / 1000); // Unix timestamp
        const message = `${timestamp}.${body}`;
        const signature = crypto
            .createHmac('sha256', this.sharedSecret)
            .update(message)
            .digest('hex');

        return { timestamp, signature };
    }

    /**
     * Get VS Code machine ID for rate limiting identification.
     * Falls back to a random ID if not available.
     */
    private getMachineId(): string {
        try {
            // VS Code exposes machineId via env in some contexts
            return process.env.VSCODE_MACHINE_ID || 
                   process.env.HOSTNAME || 
                   'unknown-machine';
        } catch {
            return 'unknown-machine';
        }
    }

    // ─── Circuit Breaker ───────────────────────────────────────────────────────

    private shouldResetCircuitBreaker(): boolean {
        if (!this.circuitBreakerOpen) { return false; }
        const timeSinceLastFailure = Date.now() - this.lastFailureTime;
        if (timeSinceLastFailure > this.CIRCUIT_BREAKER_TIMEOUT) {
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
            console.warn(`⚠️  LLM service circuit breaker opened after ${this.MAX_FAILURES} failures`);
        }
    }

    private recordSuccess(): void {
        this.failureCount = 0;
        this.circuitBreakerOpen = false;
    }

    // ─── Public API ────────────────────────────────────────────────────────────

    public async testConnection(): Promise<boolean> {
        try {
            const response = await this.makeRequest('/health', 'GET') as LLMHealthResponse;
            this.isConnected = response?.status === 'ok';
            if (this.isConnected) { this.recordSuccess(); }
            return this.isConnected;
        } catch {
            this.isConnected = false;
            this.recordFailure();
            return false;
        }
    }

    public async analyzeSecret(
        secretValue: string,
        context: string,
        variableName?: string
    ): Promise<string> {
        this.shouldResetCircuitBreaker();

        if (this.circuitBreakerOpen) {
            return this.fallbackAnalysis(secretValue, context);
        }

        try {
            const request: LLMAnalysisRequest = {
                secret_value: secretValue,
                context,
                variable_name: variableName
            };

            // ✅ Calls /extension/analyze (HMAC-authenticated, no API key)
            const response = await this.makeSignedRequest('/extension/analyze', request) as LLMAnalysisResponse;

            if (response) {
                this.recordSuccess();
                if (response.is_likely_secret && (response.risk_level === 'high' || response.risk_level === 'critical')) {
                    return 'high';
                }
                if (response.enhanced_confidence) {
                    const confidenceMap: Record<string, string> = {
                        'critical': 'high', 'high': 'high', 'medium': 'medium', 'low': 'low'
                    };
                    return confidenceMap[response.enhanced_confidence.toLowerCase()] || response.enhanced_confidence;
                }
            }
        } catch (error) {
            this.recordFailure();
            console.warn('⚠️  LLM analysis failed, using fallback:', error instanceof Error ? error.message : 'Unknown error');
        }

        return this.fallbackAnalysis(secretValue, context);
    }

    // ─── HTTP Helpers ──────────────────────────────────────────────────────────

    /**
     * Make a signed POST request to the extension endpoint.
     * Adds HMAC headers automatically — no API key involved.
     */
    private async makeSignedRequest(endpoint: string, data: unknown): Promise<unknown> {
        const body = JSON.stringify(data);
        const { timestamp, signature } = this.signRequest(body);
        const machineId = this.getMachineId();

        return new Promise((resolve, reject) => {
            const url = new URL(endpoint, this.serviceUrl);
            const client = url.protocol === 'https:' ? https : http;

            const options = {
                hostname: url.hostname,
                port: url.port || (url.protocol === 'https:' ? 443 : 80),
                path: url.pathname,
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(body),
                    'User-Agent': 'DotEnvy-Extension/2.0',
                    // ✅ HMAC headers — no API key
                    'X-Extension-Timestamp': timestamp,
                    'X-Extension-Signature': signature,
                    'X-Machine-ID': machineId,
                }
            };

            const req = client.request(options, (res) => {
                let responseBody = '';
                res.on('data', (chunk) => responseBody += chunk.toString());
                res.on('end', () => {
                    if (res.statusCode && res.statusCode >= 400) {
                        reject(new Error(`Request failed: ${res.statusCode} ${responseBody}`));
                        return;
                    }
                    try {
                        resolve(JSON.parse(responseBody));
                    } catch {
                        resolve(responseBody);
                    }
                });
            });

            req.on('error', reject);
            req.setTimeout(3000, () => { req.destroy(); reject(new Error('Request timeout')); });
            req.write(body);
            req.end();
        });
    }

    /**
     * Simple GET request for health check (no auth needed).
     */
    private async makeRequest(endpoint: string, method = 'GET'): Promise<unknown> {
        return new Promise((resolve, reject) => {
            const url = new URL(endpoint, this.serviceUrl);
            const client = url.protocol === 'https:' ? https : http;

            const options = {
                hostname: url.hostname,
                port: url.port || (url.protocol === 'https:' ? 443 : 80),
                path: url.pathname,
                method,
                headers: { 'User-Agent': 'DotEnvy-Extension/2.0' }
            };

            const req = client.request(options, (res) => {
                let body = '';
                res.on('data', (chunk) => body += chunk.toString());
                res.on('end', () => {
                    try { resolve(JSON.parse(body)); } catch { resolve(body); }
                });
            });

            req.on('error', reject);
            req.setTimeout(3000, () => { req.destroy(); reject(new Error('Timeout')); });
            req.end();
        });
    }

    // ─── Fallback ──────────────────────────────────────────────────────────────

    private fallbackAnalysis(secretValue: string, context: string): string {
        const entropy = this.calculateEntropy(secretValue);
        const hasKeywords = this.analyzeContextRisk(context) > 0;
        const hasCommonPrefix = ['sk-', 'pk_', 'AKIAI', 'ghp_', 'xox'].some(p => secretValue.startsWith(p));

        if (hasCommonPrefix && entropy > 4.0) { return 'high'; }
        if (entropy > 4.5 && hasKeywords) { return 'high'; }
        if (entropy > 3.8 && hasKeywords) { return 'medium'; }
        if (entropy > 3.5) { return 'medium'; }
        return 'low';
    }

    private calculateEntropy(text: string): number {
        if (!text) { return 0; }
        const freq = new Map<string, number>();
        for (const char of text) { freq.set(char, (freq.get(char) || 0) + 1); }
        let entropy = 0;
        for (const count of freq.values()) {
            const p = count / text.length;
            entropy -= p * Math.log2(p);
        }
        return entropy;
    }

    private analyzeContextRisk(context: string): number {
        let risk = 0;
        for (const kw of ['auth', 'key', 'secret', 'token', 'password', 'config']) {
            if (context.toLowerCase().includes(kw)) { risk += 0.2; }
        }
        return Math.min(1.0, risk);
    }

    public isServiceAvailable(): boolean {
        return this.isConnected && !this.circuitBreakerOpen;
    }

    public getServiceStatus() {
        return {
            connected: this.isConnected,
            circuitBreakerOpen: this.circuitBreakerOpen,
            failureCount: this.failureCount,
            configured: !!this.sharedSecret && this.sharedSecret !== 'REPLACE_AT_BUILD_TIME'
        };
    }

    /**
     * Override the service URL (used in tests / dev environments).
     */
    public setServiceUrl(url: string): void {
        (this as unknown as { serviceUrl: string }).serviceUrl = url;
    }

    /**
     * Extract the same features the python-llm backend uses —
     * useful for local debugging and unit tests.
     * Returns a 35-element float array matching NUM_FEATURES on the server.
     */
    public extractFeatures(secretValue: string, context: string, variableName?: string): number[] {
        const entropy  = this.calculateEntropy(secretValue);
        const ctxRisk  = this.analyzeContextRisk(context);
        const len      = secretValue.length;

        // 1. Basic text (6)
        const hasUpper   = /[A-Z]/.test(secretValue) ? 1 : 0;
        const hasLower   = /[a-z]/.test(secretValue) ? 1 : 0;
        const hasDigit   = /\d/.test(secretValue) ? 1 : 0;
        const hasSpecial = /[^a-zA-Z0-9]/.test(secretValue) ? 1 : 0;
        const lenNorm    = Math.min(len / 64, 1.0);
        const uniqueRatio = new Set(secretValue).size / Math.max(len, 1);

        // 2. Entropy group (3)
        const bigrams  = this.ngramEntropy(secretValue, 2);
        const trigrams = this.ngramEntropy(secretValue, 3);

        // 3. Pattern matching (3)
        const knownPrefixes = ['sk-','pk_','AKIAI','AKIA','ghp_','xox','SG.','dop_v1_','vercel_','AIza','-----BEGIN'];
        const hasPrefix  = knownPrefixes.some(p => secretValue.startsWith(p)) ? 1 : 0;
        const isBase64   = /^[A-Za-z0-9+/=]+$/.test(secretValue) && len % 4 === 0 ? 1 : 0;
        const isHex      = /^[a-fA-F0-9]+$/.test(secretValue) ? 1 : 0;

        // 4. Context risk (5)
        const ctxAuth    = /auth|key|secret|token|password|credential/i.test(context) ? 1 : 0;
        const ctxBearer  = /bearer|authorization/i.test(context) ? 1 : 0;
        const ctxDB      = /database|db|mongo|postgres|mysql|redis/i.test(context) ? 1 : 0;
        const ctxCloud   = /aws|gcp|azure|cloud/i.test(context) ? 1 : 0;
        const ctxPayment = /stripe|payment|billing/i.test(context) ? 1 : 0;

        // 5. Variable name signals (4)
        const varLower   = (variableName || '').toLowerCase();
        const varIsKey   = /key|secret|token|password/.test(varLower) ? 1 : 0;
        const varIsEnv   = /^[A-Z_]+$/.test(variableName || '') ? 1 : 0;
        const varIsConst = /^[A-Z]/.test(variableName || '') ? 1 : 0;
        const varLen     = Math.min((variableName || '').length / 30, 1.0);

        // 6. Structural analysis (4)
        const hasDash    = secretValue.includes('-') ? 1 : 0;
        const hasUnderscore = secretValue.includes('_') ? 1 : 0;
        const hasDot     = secretValue.includes('.') ? 1 : 0;
        const hasSlash   = secretValue.includes('/') ? 1 : 0;

        // Pad remaining to 35 total
        const features = [
            // Basic (6)
            hasUpper, hasLower, hasDigit, hasSpecial, lenNorm, uniqueRatio,
            // Entropy (3)
            entropy / 6.0, bigrams / 6.0, trigrams / 6.0,
            // Pattern (3)
            hasPrefix, isBase64, isHex,
            // Context (5)
            ctxRisk, ctxAuth, ctxBearer, ctxDB, ctxCloud, ctxPayment,
            // Variable (4)
            varIsKey, varIsEnv, varIsConst, varLen,
            // Structural (4)
            hasDash, hasUnderscore, hasDot, hasSlash,
            // Padding to reach 35
            entropy > 4.5 ? 1 : 0,
            len > 32 ? 1 : 0,
            len > 64 ? 1 : 0,
            hasUpper && hasDigit ? 1 : 0,
            ctxAuth && hasPrefix ? 1 : 0,
        ].slice(0, 35);

        // Ensure exactly 35
        while (features.length < 35) { features.push(0); }
        return features;
    }

    private ngramEntropy(text: string, n: number): number {
        if (text.length < n) { return 0; }
        const freq = new Map<string, number>();
        for (let i = 0; i <= text.length - n; i++) {
            const gram = text.slice(i, i + n);
            freq.set(gram, (freq.get(gram) || 0) + 1);
        }
        const total = text.length - n + 1;
        let e = 0;
        for (const c of freq.values()) { const p = c / total; e -= p * Math.log2(p); }
        return e;
    }
}

export const llmAnalyzer = LLMAnalyzer.getInstance();
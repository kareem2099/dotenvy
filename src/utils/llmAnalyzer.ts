/**
 * LLM Analyzer - TypeScript Interface for Python LLM Service
 * ==========================================================
 *
 * This module provides a TypeScript interface to communicate with the
 * Python-based Custom LLM service for enhanced secret detection.
 */

import * as https from 'https';
import * as http from 'http';

export interface LLMAnalysisRequest {
    secret_value: string;
    context: string;
    variable_name?: string;
    features?: number[];
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

export interface LLMTrainingSample {
    secret_value: string;
    context: string;
    features: number[];
    user_action: string;
    label: string;
}

export class LLMAnalyzer {
    private static instance: LLMAnalyzer;
    private serviceUrl: string;
    private apiKey: string;
    private isConnected = false;
    private failureCount = 0;
    private readonly MAX_FAILURES = 3;
    private circuitBreakerOpen = false;
    private lastFailureTime = 0;
    private readonly CIRCUIT_BREAKER_TIMEOUT = 60000; // 1 minute

    private constructor() {
        this.serviceUrl = process.env.DOTENVY_LLM_SERVICE_URL || '';
        this.apiKey = process.env.LLM_API_KEY || '';

        // Validate URL
        if (this.serviceUrl && !this.isValidUrl(this.serviceUrl)) {
            console.error('❌ Invalid LLM service URL provided');
            this.serviceUrl = '';
        }

        if (!this.apiKey) {
            console.warn('⚠️  Warning: No API Key found in build environment!');
        }

        if (!this.serviceUrl) {
            console.warn('⚠️  Warning: No LLM service URL configured. Using fallback analysis only.');
        }
    }

    public static getInstance(): LLMAnalyzer {
        if (!LLMAnalyzer.instance) {
            LLMAnalyzer.instance = new LLMAnalyzer();
        }
        return LLMAnalyzer.instance;
    }

    /**
     * Validate URL format
     */
    private isValidUrl(url: string): boolean {
        try {
            const parsed = new URL(url);
            return parsed.protocol === 'http:' || parsed.protocol === 'https:';
        } catch {
            return false;
        }
    }

    /**
     * Check if circuit breaker should reset
     */
    private shouldResetCircuitBreaker(): boolean {
        if (!this.circuitBreakerOpen) return false;
        
        const timeSinceLastFailure = Date.now() - this.lastFailureTime;
        if (timeSinceLastFailure > this.CIRCUIT_BREAKER_TIMEOUT) {
            this.circuitBreakerOpen = false;
            this.failureCount = 0;
            console.log('✅ LLM service circuit breaker reset');
            return true;
        }
        return false;
    }

    /**
     * Record a failure and potentially open circuit breaker
     */
    private recordFailure(): void {
        this.failureCount++;
        this.lastFailureTime = Date.now();
        
        if (this.failureCount >= this.MAX_FAILURES) {
            this.circuitBreakerOpen = true;
            console.warn(`⚠️  LLM service circuit breaker opened after ${this.MAX_FAILURES} failures`);
        }
    }

    /**
     * Reset failure count on success
     */
    private recordSuccess(): void {
        this.failureCount = 0;
        this.circuitBreakerOpen = false;
    }

    /**
     * Test connection to the Python LLM service
     */
    public async testConnection(): Promise<boolean> {
        if (!this.serviceUrl) {
            this.isConnected = false;
            return false;
        }

        try {
            const response = await this.makeRequest('/health', 'GET') as LLMHealthResponse;
            this.isConnected = response && response.status === 'ok';
            if (this.isConnected) {
                this.recordSuccess();
            }
            return this.isConnected;
        } catch (error) {
            console.warn('⚠️  LLM service connection failed:', error instanceof Error ? error.message : 'Unknown error');
            this.isConnected = false;
            this.recordFailure();
            return false;
        }
    }

    /**
     * Analyze a potential secret using the LLM
     */
    public async analyzeSecret(
        secretValue: string,
        context: string,
        variableName?: string
    ): Promise<string> {
        // Check if service is configured
        if (!this.serviceUrl || !this.apiKey) {
            return this.fallbackAnalysis(secretValue, context);
        }

        // Check circuit breaker
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

            const response = await this.makeRequestWithRetry('/analyze', 'POST', request, 2) as LLMAnalysisResponse;

            if (response) {
                this.recordSuccess();

                // Handle all confidence levels
                if (response.is_likely_secret && (response.risk_level === 'high' || response.risk_level === 'critical')) {
                    return 'high';
                }
                
                if (response.enhanced_confidence) {
                    // Map LLM response to our confidence levels
                    const confidenceMap: Record<string, string> = {
                        'critical': 'high',
                        'high': 'high',
                        'medium': 'medium',
                        'low': 'low'
                    };
                    return confidenceMap[response.enhanced_confidence.toLowerCase()] || response.enhanced_confidence;
                }
            }

        } catch (error) {
            this.recordFailure();
            console.warn('⚠️  LLM analysis failed, using fallback:', error instanceof Error ? error.message : 'Unknown error');
        }

        // Fallback analysis
        return this.fallbackAnalysis(secretValue, context);
    }

    /**
     * Make HTTP request with retry logic
     */
    private async makeRequestWithRetry(
        endpoint: string,
        method: string,
        data?: unknown,
        retries = 2
    ): Promise<unknown> {
        let lastError: Error | undefined;

        for (let attempt = 0; attempt <= retries; attempt++) {
            try {
                return await this.makeRequest(endpoint, method, data);
            } catch (error) {
                lastError = error instanceof Error ? error : new Error('Unknown error');
                
                if (attempt < retries) {
                    // Exponential backoff: 100ms, 200ms, 400ms
                    const delay = Math.pow(2, attempt) * 100;
                    await new Promise(resolve => setTimeout(resolve, delay));
                }
            }
        }

        throw lastError;
    }

    /**
     * Extract features from secret and context (mimic original ML features)
     */
    public extractFeatures(secretValue: string, context: string, variableName?: string): number[] {
        const features: number[] = [];

        // Basic text features
        features.push(secretValue.length);
        features.push(this.calculateEntropy(secretValue));

        // Character analysis
        const specialChars = /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/;
        features.push(specialChars.test(secretValue) ? 1 : 0);
        features.push(/\d/.test(secretValue) ? 1 : 0);
        features.push(/[A-Z]/.test(secretValue) ? 1 : 0);
        features.push(/[a-z]/.test(secretValue) ? 1 : 0);

        // Pattern analysis
        const uniqueRatio = secretValue.length > 0 ? new Set(secretValue.split('')).size / secretValue.length : 0;
        features.push(uniqueRatio);

        // Common prefixes
        const prefixes = ['sk-', 'pk_', 'AKIAI', 'ghp_', 'xox'];
        features.push(prefixes.some(prefix => secretValue.startsWith(prefix)) ? 1 : 0);

        // Base64/hex patterns
        features.push(this.isBase64Like(secretValue) ? 1 : 0);
        features.push(this.isHexLike(secretValue) ? 1 : 0);

        // Context analysis
        features.push(this.analyzeContextRisk(context));
        features.push(this.isInQuotes(context) ? 1 : 0);
        features.push(this.countKeywords(context));

        // Variable name score
        features.push(this.scoreVariableName(variableName));

        return features;
    }

    /**
     * Fallback analysis when LLM service is unavailable
     */
    private fallbackAnalysis(secretValue: string, context: string): string {
        const entropy = this.calculateEntropy(secretValue);
        const hasKeywords = this.analyzeContextRisk(context) > 0;
        const hasCommonPrefix = ['sk-', 'pk_', 'AKIAI', 'ghp_', 'xox'].some(p => secretValue.startsWith(p));

        // Enhanced fallback logic
        if (hasCommonPrefix && entropy > 4.0) {
            return 'high';
        } else if (entropy > 4.5 && hasKeywords) {
            return 'high';
        } else if (entropy > 3.8 && hasKeywords) {
            return 'medium';
        } else if (entropy > 3.5) {
            return 'medium';
        } else {
            return 'low';
        }
    }

    /**
     * Make HTTP/HTTPS request to Python service
     */
    private async makeRequest(endpoint: string, method = 'GET', data?: unknown): Promise<unknown> {
        if (!this.serviceUrl) {
            throw new Error('LLM service URL not configured');
        }

        return new Promise((resolve, reject) => {
            const url = new URL(endpoint, this.serviceUrl);
            
            const client = url.protocol === 'https:' ? https : http;

            const options = {
                hostname: url.hostname,
                port: url.port || (url.protocol === 'https:' ? 443 : 80),
                path: url.pathname,
                method: method,
                headers: {
                    'Content-Type': 'application/json',
                    'User-Agent': 'DotEnvy-LLM-Client/1.5',
                    'Authorization': `Bearer ${this.apiKey}`
                }
            };

            const req = client.request(options, (res) => {
                let body = '';
                res.on('data', (chunk) => body += chunk.toString());
                res.on('end', () => {
                    if (res.statusCode && res.statusCode >= 400) {
                        reject(new Error(`Request failed with status ${res.statusCode}: ${body}`));
                        return;
                    }
                    try {
                        const response = JSON.parse(body);
                        resolve(response);
                    } catch (error) {
                        resolve(body);
                    }
                });
            });

            req.on('error', (error) => {
                reject(error);
            });

            if (data) {
                req.write(JSON.stringify(data));
            }

            // Timeout for extension performance
            req.setTimeout(3000, () => {
                req.destroy();
                reject(new Error('Request timeout'));
            });

            req.end();
        });
    }

    // Utility methods
    private calculateEntropy(text: string): number {
        if (!text) return 0;
        const charFreq: Map<string, number> = new Map();
        for (const char of text) {
            charFreq.set(char, (charFreq.get(char) || 0) + 1);
        }

        let entropy = 0;
        const len = text.length;
        for (const count of charFreq.values()) {
            const p = count / len;
            entropy -= p * Math.log2(p);
        }
        return entropy;
    }

    private isBase64Like(text: string): boolean {
        const base64Chars = /^[A-Za-z0-9+/=]+$/;
        return base64Chars.test(text) && text.length % 4 === 0 && text.length >= 16;
    }

    private isHexLike(text: string): boolean {
        const hexChars = /^[a-fA-F0-9]+$/;
        return hexChars.test(text) && text.length >= 32;
    }

    private analyzeContextRisk(context: string): number {
        let risk = 0.0;
        const keywords = ['auth', 'key', 'secret', 'token', 'password', 'config'];
        const lower = context.toLowerCase();
        for (const keyword of keywords) {
            if (lower.includes(keyword)) risk += 0.2;
        }
        return Math.min(1.0, risk);
    }

    private isInQuotes(context: string): boolean {
        return context.includes('"') || context.includes("'") || context.includes('`');
    }

    private countKeywords(context: string): number {
        const keywords = ['const', 'let', 'var', 'process.env', 'config', 'secret', 'key', 'token'];
        let count = 0;
        const lower = context.toLowerCase();
        for (const keyword of keywords) {
            if (lower.includes(keyword)) count++;
        }
        return count;
    }

    private scoreVariableName(name?: string): number {
        if (!name) return 0.0;
        if (name.toUpperCase() === name) return 0.8; // ALL_CAPS
        if (name.toLowerCase().includes('secret') || name.toLowerCase().includes('key') || name.toLowerCase().includes('token')) return 0.6;
        return 0.2;
    }

    /**
     * Check if LLM service is available
     */
    public isServiceAvailable(): boolean {
        return this.isConnected && !this.circuitBreakerOpen;
    }

    /**
     * Configure service URL
     */
    public setServiceUrl(url: string): void {
        if (url && !this.isValidUrl(url)) {
            console.error('❌ Invalid URL provided');
            return;
        }
        this.serviceUrl = url;
        this.isConnected = false;
        this.circuitBreakerOpen = false;
        this.failureCount = 0;
    }

    /**
     * Get service health status
     */
    public getServiceStatus(): {
        connected: boolean;
        circuitBreakerOpen: boolean;
        failureCount: number;
        configured: boolean;
    } {
        return {
            connected: this.isConnected,
            circuitBreakerOpen: this.circuitBreakerOpen,
            failureCount: this.failureCount,
            configured: !!(this.serviceUrl && this.apiKey)
        };
    }
}

// Export singleton instance
export const llmAnalyzer = LLMAnalyzer.getInstance();
/**
 * LLM Analyzer - TypeScript Interface for Python LLM Service
 * ==========================================================
 *
 * This module provides a TypeScript interface to communicate with the
 * Python-based Custom LLM service for enhanced secret detection.
 */

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
    private isConnected: boolean = false;

    private constructor() {
        // Default to local Python service
        this.serviceUrl = process.env.DOTENVY_LLM_SERVICE_URL || 'http://127.0.0.1:8000';
    }

    public static getInstance(): LLMAnalyzer {
        if (!LLMAnalyzer.instance) {
            LLMAnalyzer.instance = new LLMAnalyzer();
        }
        return LLMAnalyzer.instance;
    }

    /**
     * Test connection to the Python LLM service
     */
    public async testConnection(): Promise<boolean> {
        try {
            const response = await this.makeRequest('/health', 'GET');
            this.isConnected = response && response.status === 'ok';
            return this.isConnected;
        } catch (error) {
            console.warn('LLM service connection failed:', error);
            this.isConnected = false;
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
        if (!this.isConnected) {
            // Fallback to traditional analysis
            return this.fallbackAnalysis(secretValue, context);
        }

        try {
            const request: LLMAnalysisRequest = {
                secret_value: secretValue,
                context,
                variable_name: variableName
            };

            const response = await this.makeRequest('/analyze', 'POST', request) as LLMAnalysisResponse;

            if (response && response.enhanced_confidence) {
                return response.enhanced_confidence;
            }

        } catch (error) {
            console.warn('LLM analysis failed, using fallback:', error);
        }

        // Fallback analysis
        return this.fallbackAnalysis(secretValue, context);
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

        if (entropy > 4.5 && hasKeywords) {
            return 'high';
        } else if (entropy > 3.5) {
            return 'medium';
        } else {
            return 'low';
        }
    }

    /**
     * Make HTTP request to Python service
     */
    private async makeRequest(endpoint: string, method: string = 'GET', data?: any): Promise<any> {
        return new Promise((resolve, reject) => {
            const url = new URL(endpoint, this.serviceUrl);
            const options = {
                hostname: url.hostname,
                port: url.port,
                path: url.pathname,
                method: method,
                headers: {
                    'Content-Type': 'application/json',
                    'User-Agent': 'DotEnvy-LLM-Client/1.0'
                }
            };

            const req = http.request(options, (res) => {
                let body = '';
                res.on('data', (chunk) => body += chunk.toString());
                res.on('end', () => {
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

            req.setTimeout(5000, () => {
                req.abort();
                reject(new Error('Request timeout'));
            });

            req.end();
        });
    }

    // Utility methods (same as original MLLearner)
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
        return this.isConnected;
    }

    /**
     * Configure service URL
     */
    public setServiceUrl(url: string): void {
        this.serviceUrl = url;
        this.isConnected = false; // Reset connection status
    }
}

// Export singleton instance
export const llmAnalyzer = LLMAnalyzer.getInstance();

/**
 * Entropy Analyzer for Secret Detection
 * ===================================
 *
 * Analyzes strings for entropy (randomness) to determine if they might be
 * passwords, API keys, or other secrets.
 */

export class EntropyAnalyzer {
    private static readonly ALPHABET_SIZE = 95; // ASCII printable characters

    /**
     * Calculate Shannon entropy of a string
     */
    static calculateEntropy(text: string): number {
        if (!text || text.length === 0) return 0;

        const charFreq: Map<string, number> = new Map();
        const len = text.length;

        // Count character frequencies
        for (const char of text) {
            const count = charFreq.get(char) || 0;
            charFreq.set(char, count + 1);
        }

        let entropy = 0;
        for (const count of charFreq.values()) {
            const probability = count / len;
            entropy -= probability * Math.log2(probability);
        }

        return entropy;
    }

    /**
     * Get confidence score for a string being a secret (0-1)
     */
    static getConfidence(text: string): 'high' | 'medium' | 'low' {
        if (!text || text.length === 0) return 'low';

        const entropy = this.calculateEntropy(text);
        const length = text.length;

        // Base confidence on entropy and content analysis
        if (entropy >= 4.5 && length >= 20) {
            return 'high';
        } else if (entropy >= 3.5 && length >= 12) {
            return 'medium';
        } else {
            return 'low';
        }
    }

    /**
     * Check if a string is likely a secret based on entropy and patterns
     */
    static isLikelySecret(text: string): boolean {
        if (!text || text.length < 8) return false;

        const entropy = this.calculateEntropy(text);
        const hasVariety = this.hasCharacterVariety(text);

        // Must have reasonable entropy and character variety
        return entropy >= 2.5 && hasVariety;
    }

    /**
     * Check if string has variety of character types
     */
    private static hasCharacterVariety(text: string): boolean {
        const hasLower = /[a-z]/.test(text);
        const hasUpper = /[A-Z]/.test(text);
        const hasDigit = /\d/.test(text);
        const hasSpecial = /[^a-zA-Z0-9\s]/.test(text);

        // Reward variety of character types
        const varietyScore = [hasLower, hasUpper, hasDigit, hasSpecial].filter(Boolean).length;

        return varietyScore >= 2; // At least two different character types
    }

    /**
     * Analyze string patterns for secret-like qualities
     */
    static analyzeSecretQuality(text: string): {
        entropy: number;
        hasVariety: boolean;
        isLikelySecret: boolean;
        confidenceScore: number;
        assessment: string;
    } {
        const entropy = this.calculateEntropy(text);
        const hasVariety = this.hasCharacterVariety(text);
        const isLikelySecret = this.isLikelySecret(text);
        const confidence = this.getConfidence(text);

        let confidenceScore: number;
        switch (confidence) {
            case 'high': confidenceScore = 1.0; break;
            case 'medium': confidenceScore = 0.7; break;
            case 'low': confidenceScore = 0.3; break;
            default: confidenceScore = 0;
        }

        let assessment = `${confidence} confidence`;
        if (!hasVariety) assessment += ' (low character variety)';
        if (entropy < 2.0) assessment += ' (low entropy)';

        return {
            entropy,
            hasVariety,
            isLikelySecret,
            confidenceScore,
            assessment
        };
    }

    /**
     * Get detailed entropy analysis for debugging
     */
    static getDetailedAnalysis(text: string): {
        entropy: number;
        length: number;
        uniqueChars: number;
        charDistribution: Record<string, number>;
        characterTypes: {
            lowercase: boolean;
            uppercase: boolean;
            digits: boolean;
            special: boolean;
        };
    } {
        const entropy = this.calculateEntropy(text);
        const length = text.length;
        const uniqueChars = new Set(text).size;

        const charDistribution: Record<string, number> = {};
        for (const char of text) {
            charDistribution[char] = (charDistribution[char] || 0) + 1;
        }

        return {
            entropy,
            length,
            uniqueChars,
            charDistribution,
            characterTypes: {
                lowercase: /[a-z]/.test(text),
                uppercase: /[A-Z]/.test(text),
                digits: /\d/.test(text),
                special: /[^a-zA-Z0-9\s]/.test(text)
            }
        };
    }
}

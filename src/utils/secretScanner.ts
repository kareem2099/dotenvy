import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import * as path from 'path';
import { llmAnalyzer } from './llmAnalyzer';

export interface DetectedSecret {
    file: string;
    line: number;
    column: number;
    content: string;
    type: string;
    confidence: 'high' | 'medium' | 'low';
    suggestedEnvVar: string;
    context: string;
    riskScore: number;
    detectionMethod: 'pattern' | 'statistical' | 'contextual' | 'hybrid';
    reasoning: string[];
}

export interface StringContext {
    variableName?: string;
    isInConfig: boolean;
    isInAuth: boolean;
    isInComment: boolean;
    isInString: boolean;
    lineContent: string;
    surroundingCode: string;
}

export interface SecretScore {
    isLikelySecret: boolean;
    confidence: number;
    category: string;
    riskLevel: 'critical' | 'high' | 'medium' | 'low';
    reasoning: string[];
    detectionMethod: 'statistical' | 'contextual' | 'pattern' | 'hybrid';
}

export interface ScanProgress {
    current: number;
    total: number;
    percentage: number;
    currentFile: string;
    estimatedTimeRemaining: number;
    startTime: number;
}

export interface ScanCache {
    filePath: string;
    lastModified: number;
    scanResults: DetectedSecret[];
    fileHash: string;
}

interface SecretPattern {
    regex: RegExp;
    type: string;
    priority: number;
}

export class SecretScanner {
    private static scanProgressCallback?: (progress: ScanProgress) => void;
    private static scanCache = new Map<string, ScanCache>();
    private static readonly CACHE_DURATION = 5 * 60 * 1000; // 5 minutes
    private static readonly MAX_WORKERS = 4;
    
    // Compiled regex patterns for better performance
    private static compiledPatterns: SecretPattern[] | null = null;

    // Common secret patterns with priority (lower = higher priority)
    private static readonly SECRET_PATTERNS: Array<{ regex: RegExp; type: string; priority: number }> = [
        // Priority 1: High-confidence patterns with specific prefixes
        { regex: /\bsk-proj-[a-zA-Z0-9]{20,}/gi, type: 'OpenAI API Key', priority: 1 },
        { regex: /\bsk-[a-zA-Z0-9]{20,}/gi, type: 'Stripe Secret Key', priority: 1 },
        { regex: /\bpk_live_[a-zA-Z0-9]{20,}/gi, type: 'Stripe Publishable Key', priority: 1 },
        { regex: /\bpk_test_[a-zA-Z0-9]{20,}/gi, type: 'Stripe Test Key', priority: 1 },
        { regex: /\b(AKIAI[A-Z0-9]{16}|AKIA[A-Z0-9]{16})/g, type: 'AWS Access Key', priority: 1 },
        { regex: /\bghp_[a-zA-Z0-9]{36,}/gi, type: 'GitHub Personal Access Token', priority: 1 },
        { regex: /\bgithub_pat_[a-zA-Z0-9_-]{22,}/gi, type: 'GitHub Fine-grained PAT', priority: 1 },
        { regex: /\b(xoxb-[0-9]{10,}-[0-9]{10,}-[A-Za-z0-9]{24,})/gi, type: 'Slack Bot Token', priority: 1 },
        { regex: /\b(xoxp-[0-9]{10,}-[0-9]{10,}-[A-Za-z0-9]{24,})/gi, type: 'Slack User Token', priority: 1 },
        { regex: /\b[MTA][A-Za-z0-9_-]{23,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{27,}/gi, type: 'Discord Bot Token', priority: 1 },
        { regex: /\bSG\.[a-zA-Z0-9_-]{22,}\.[a-zA-Z0-9_-]{43,}/gi, type: 'SendGrid API Key', priority: 1 },
        { regex: /\bkey-[a-zA-Z0-9]{32,}/gi, type: 'Mailgun API Key', priority: 1 },
        { regex: /\bSK[a-f0-9]{32}/gi, type: 'Twilio Auth Token', priority: 1 },
        { regex: /\bdop_v1_[a-f0-9]{64}/gi, type: 'DigitalOcean Token', priority: 1 },
        { regex: /\bvercel_[a-zA-Z0-9_-]{24,}/gi, type: 'Vercel API Token', priority: 1 },

        // Priority 2: Sentry DSNs and Database URLs
        { regex: /\bhttps:\/\/[a-f0-9]{32}@[a-z0-9]+\.ingest\.sentry\.io\/[0-9]+/gi, type: 'Sentry DSN', priority: 2 },
        { regex: /\b(mysql|postgresql|sqlite|mongodb|redis):\/\/[A-Za-z0-9_-]+:[^@\s]{6,}@[^\s]+/gi, type: 'Database Connection URL', priority: 2 },
        { regex: /\bmongodb\+srv:\/\/[A-Za-z0-9_-]+:[^@\s]{6,}@[^\s]+/gi, type: 'MongoDB Atlas Connection', priority: 2 },

        // Priority 3: Generic tokens and passwords
        { regex: /Bearer\s+[A-Za-z0-9_-]{32,}/gi, type: 'Bearer Token', priority: 3 },
        { regex: /\bpassword\s*[:=]\s*["']?([A-Za-z0-9!@#$%^&*()_+\-=]{8,})["']?/gi, type: 'Password', priority: 3 },
        { regex: /\bsecret[\-_]*(key)?\s*[:=]\s*["']?([A-Za-z0-9_-]{12,})["']?/gi, type: 'Secret Key', priority: 3 },
        { regex: /jwt[\-_]*secret\s*[:=]\s*["']?([A-Za-z0-9_.-]{20,})["']?/gi, type: 'JWT Secret', priority: 3 },

        // Priority 4: Private keys and certificates
        { regex: /-----BEGIN\s+(RSA|DSA|EC|OPENSSH|PGP)\s+PRIVATE\s+KEY-----/gi, type: 'SSH Private Key', priority: 4 },
        { regex: /-----BEGIN\s+CERTIFICATE-----/gi, type: 'SSL Certificate', priority: 4 },

        // Priority 10: Low-confidence generic patterns (only if no higher priority match)
        { regex: /\b[a-f0-9]{64}\b/gi, type: 'Possible SHA256 Hash/Key', priority: 10 },
        { regex: /\b[a-f0-9]{40}\b/gi, type: 'Possible SHA1 Hash/Key', priority: 10 },
        { regex: /\b[a-f0-9]{32}\b/gi, type: 'Possible MD5 Hash/Key', priority: 10 },
    ];

    private static readonly IGNORED_FILES = [
        'node_modules',
        '.git',
        'dist',
        'build',
        'coverage',
        '.env',
        '*.env',
        '*.env*',
        '*backup*',
        '*.backup*',
        '*.log',
        'package-lock.json',
        'yarn.lock',
        '*.jpg',
        '*.png',
        '*.gif',
        '*.pdf',
        '*.zip',
        '*.tar.gz'
    ];

    private static readonly IGNORED_EXTENSIONS = [
        '.jpg', '.png', '.gif', '.pdf', '.zip', '.tar.gz',
        '.woff', '.woff2', '.eot', '.ttf', '.svg', '.ico'
    ];

    /**
     * Get compiled patterns (lazy initialization)
     */
    private static getCompiledPatterns(): SecretPattern[] {
        if (!this.compiledPatterns) {
            this.compiledPatterns = this.SECRET_PATTERNS.map(p => ({
                regex: new RegExp(p.regex.source, p.regex.flags),
                type: p.type,
                priority: p.priority
            }));
        }
        return this.compiledPatterns;
    }

    /**
     * Scan workspace files for potential secrets
     */
    public static async scanWorkspace(): Promise<DetectedSecret[]> {
        const secrets: DetectedSecret[] = [];
        const workspaceFolders = vscode.workspace.workspaceFolders;

        if (!workspaceFolders) {
            vscode.window.showInformationMessage('Open a workspace folder to scan for secrets.');
            return secrets;
        }

        const rootPath = workspaceFolders[0].uri.fsPath;

        try {
            const files = await vscode.workspace.findFiles(
                '**/*',
                this.getExcludePattern(),
                5000
            );

            for (const fileUri of files) {
                if (fileUri.scheme !== 'file') continue;

                const filePath = fileUri.fsPath;
                if (!this.shouldScanFile(filePath, rootPath)) continue;

                const fileSecrets = await this.scanFile(filePath);
                secrets.push(...fileSecrets);
            }

        } catch (error) {
            console.error('Error scanning workspace:', error);
        }

        return this.deduplicateSecrets(secrets);
    }

    /**
     * Scan a single file for secrets (async version)
     */
    public static async scanFile(filePath: string): Promise<DetectedSecret[]> {
        const secrets: DetectedSecret[] = [];

        try {
            const content = await fs.readFile(filePath, 'utf8');
            const lines = content.split('\n');

            for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
                const line = lines[lineIndex];
                if (line.length > 500) continue;

                const lineSecrets = await this.scanLine(line, lineIndex, lines, filePath);
                secrets.push(...lineSecrets);
            }

        } catch (error) {
            console.log(`Skipping file ${filePath}: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }

        return this.assignUniqueEnvVarNames(secrets);
    }

    /**
     * Scan a single line for secrets
     */
    private static async scanLine(
        line: string,
        lineIndex: number,
        allLines: string[],
        filePath: string
    ): Promise<DetectedSecret[]> {
        const secrets: DetectedSecret[] = [];
        const matchedPositions = new Set<string>();

        // Sort patterns by priority
        const patterns = this.getCompiledPatterns().sort((a, b) => a.priority - b.priority);

        for (const pattern of patterns) {
            const matches = [...line.matchAll(pattern.regex)];

            for (const match of matches) {
                const matchIndex = match.index ?? 0;
                const posKey = `${matchIndex}-${match[0].length}`;

                // Skip if this position already matched by higher priority pattern
                if (matchedPositions.has(posKey)) continue;

                const secretValue = match[0].trim();
                
                if (this.isLikelySecret(secretValue)) {
                    matchedPositions.add(posKey);

                    const context = this.getContextLine(allLines, lineIndex, matchIndex);
                    const secretScore = this.calculateSecretScore(secretValue, context);

                    let finalConfidence: 'high' | 'medium' | 'low' = this.mapConfidenceLevel(secretScore.confidence);
                    let detectionMethod = secretScore.detectionMethod;

                    // Try LLM analysis for medium/high confidence secrets
                    if (secretScore.confidence > 0.4) {
                        try {
                            const llmConfidence = await llmAnalyzer.analyzeSecret(secretValue, context);
                            
                            if (llmConfidence === 'high' || llmConfidence === 'critical') {
                                finalConfidence = 'high';
                                secretScore.confidence = 0.95;
                                secretScore.reasoning.push('✓ Verified by AI analysis');
                                detectionMethod = 'hybrid';
                            } else if (llmConfidence === 'medium') {
                                finalConfidence = 'medium';
                            } else if (llmConfidence === 'low') {
                                finalConfidence = 'low';
                            }
                        } catch (e) {
                            // Silent fallback to traditional analysis
                        }
                    }

                    const baseSecret: DetectedSecret = {
                        file: vscode.workspace.asRelativePath(filePath),
                        line: lineIndex + 1,
                        column: matchIndex + 1,
                        content: this.redactSecret(secretValue), // Redact for safety
                        type: pattern.type,
                        confidence: finalConfidence,
                        suggestedEnvVar: '',
                        context: context,
                        riskScore: secretScore.confidence,
                        detectionMethod: detectionMethod,
                        reasoning: secretScore.reasoning
                    };

                    secrets.push(baseSecret);
                }
            }
        }

        return secrets;
    }

    /**
     * Redact secret value for display (show first 4 and last 4 chars)
     */
    private static redactSecret(secret: string): string {
        if (secret.length <= 12) {
            return '****' + secret.slice(-2);
        }
        return secret.slice(0, 4) + '****' + secret.slice(-4);
    }

    /**
     * Map numeric confidence to categorical level
     */
    private static mapConfidenceLevel(confidence: number): 'high' | 'medium' | 'low' {
        if (confidence >= 0.7) return 'high';
        if (confidence >= 0.4) return 'medium';
        return 'low';
    }

    /**
     * Deduplicate secrets that are identical
     */
    private static deduplicateSecrets(secrets: DetectedSecret[]): DetectedSecret[] {
        const seen = new Map<string, DetectedSecret>();

        for (const secret of secrets) {
            const key = `${secret.file}:${secret.line}:${secret.column}:${secret.content}`;
            
            if (!seen.has(key)) {
                seen.set(key, secret);
            } else {
                // Keep the one with higher confidence
                const existing = seen.get(key);
                if (existing && this.getConfidenceScore(secret.confidence) > this.getConfidenceScore(existing.confidence)) {
                    seen.set(key, secret);
                }
            }
        }

        return Array.from(seen.values());
    }

    /**
     * Convert confidence level to numeric score
     */
    private static getConfidenceScore(confidence: 'high' | 'medium' | 'low'): number {
        const scores = { high: 3, medium: 2, low: 1 };
        return scores[confidence];
    }

    /**
     * Assign unique environment variable names to secrets
     */
    private static assignUniqueEnvVarNames(secrets: DetectedSecret[]): DetectedSecret[] {
        const usedNames = new Set<string>();

        return secrets.map(secret => {
            const baseName = this.generateBaseEnvVarName(secret);
            let finalName = baseName;
            let counter = 1;

            while (usedNames.has(finalName)) {
                finalName = `${baseName}_${counter}`;
                counter++;
            }

            usedNames.add(finalName);
            return {
                ...secret,
                suggestedEnvVar: finalName
            };
        });
    }

    /**
     * Check if a string looks like a real secret
     */
    private static isLikelySecret(value: string): boolean {
        const cleanValue = value.replace(/[-_.]/g, '');

        if (cleanValue.length < 10) return false;

        const uniqueChars = new Set(cleanValue).size;
        const entropyRatio = uniqueChars / cleanValue.length;

        if (cleanValue.length > 15 && entropyRatio < 0.5) return false;

        // Skip obvious non-secrets
        if (/^\d+$/.test(cleanValue)) return false;
        if (/^[a-zA-Z]+$/.test(cleanValue) && cleanValue.length < 20) return false;

        return true;
    }

    /**
     * Get confidence level for detected secret
     */
    private static getConfidence(value: string): 'high' | 'medium' | 'low' {
        const cleanValue = value.replace(/[-_.]/g, '');

        if (cleanValue.length > 30) return 'high';
        if (/^(sk|pk|AKIAI)/i.test(value)) return 'high';
        if (cleanValue.length > 20) return 'medium';

        return 'low';
    }

    /**
     * Generate base environment variable name
     */
    private static generateBaseEnvVarName(secret: DetectedSecret): string {
        const type = secret.type;

        // Map by type
        const typeMap: Record<string, string> = {
            'AWS Access Key': 'AWS_ACCESS_KEY_ID',
            'Stripe Secret Key': 'STRIPE_SECRET_KEY',
            'Stripe Publishable Key': 'STRIPE_PUBLISHABLE_KEY',
            'Stripe Test Key': 'STRIPE_TEST_KEY',
            'OpenAI API Key': 'OPENAI_API_KEY',
            'GitHub Personal Access Token': 'GITHUB_TOKEN',
            'GitHub Fine-grained PAT': 'GITHUB_TOKEN',
            'Slack Bot Token': 'SLACK_BOT_TOKEN',
            'Slack User Token': 'SLACK_USER_TOKEN',
            'Discord Bot Token': 'DISCORD_BOT_TOKEN',
            'JWT Secret': 'JWT_SECRET',
            'Database Connection URL': 'DATABASE_URL',
            'MongoDB Atlas Connection': 'MONGODB_URI',
            'SendGrid API Key': 'SENDGRID_API_KEY',
            'Mailgun API Key': 'MAILGUN_API_KEY',
            'Twilio Auth Token': 'TWILIO_AUTH_TOKEN',
            'Sentry DSN': 'SENTRY_DSN',
            'DigitalOcean Token': 'DIGITALOCEAN_TOKEN',
            'Vercel API Token': 'VERCEL_API_TOKEN',
            'SSH Private Key': 'SSH_PRIVATE_KEY',
            'SSL Certificate': 'SSL_CERTIFICATE',
            'Bearer Token': 'AUTH_BEARER_TOKEN',
            'Password': 'PASSWORD',
            'Secret Key': 'SECRET_KEY'
        };

        if (typeMap[type]) {
            return typeMap[type];
        }

        // Fallback based on secret content
        if (secret.content.startsWith('sk-')) return 'SECRET_KEY';
        if (secret.content.startsWith('pk_')) return 'PUBLIC_KEY';

        // File-based fallback
        const fileName = path.basename(secret.file, path.extname(secret.file));
        const baseName = fileName.toUpperCase().replace(/[^A-Z0-9]/g, '_');
        
        return `${baseName}_SECRET`;
    }

    /**
     * Get context line around the secret
     */
    private static getContextLine(lines: string[], lineIndex: number, matchIndex: number): string {
        const line = lines[lineIndex].trim();
        if (line.length > 100) {
            const start = Math.max(0, matchIndex - 20);
            const end = Math.min(line.length, matchIndex + 80);
            return '...' + line.substring(start, end) + '...';
        }
        return line;
    }

    /**
     * Build exclude pattern for file search
     */
    private static getExcludePattern(): string {
        return `{${this.IGNORED_FILES.join(',')}}`;
    }

    /**
     * Check if file should be scanned
     */
    private static shouldScanFile(filePath: string, rootPath: string): boolean {
        const relativePath = path.relative(rootPath, filePath);

        for (const ignored of this.IGNORED_FILES) {
            if (relativePath.includes(`/${ignored}/`) || relativePath.startsWith(`${ignored}/`)) {
                return false;
            }
        }

        const ext = path.extname(filePath).toLowerCase();
        if (this.IGNORED_EXTENSIONS.includes(ext)) {
            return false;
        }

        const scanExtensions = ['.js', '.ts', '.py', '.java', '.cpp', '.c', '.php', '.rb', '.go', '.rs', '.sh', '.json', '.yml', '.yaml', '.xml', '.html', '.css'];
        return scanExtensions.includes(ext) || path.basename(filePath).startsWith('.env');
    }

    /**
     * Calculate intelligent secret score
     */
    private static calculateSecretScore(secretValue: string, context: string): SecretScore {
        const entropy = this.calculateAdvancedEntropy(secretValue);
        const contextRisk = this.assessContextRisk(context);
        const patternScore = this.detectGenericPatterns(secretValue);
        const charDistribution = this.analyzeCharacterDistribution(secretValue);

        const reasons: string[] = [];

        if (entropy > 4.5) {
            reasons.push(`High entropy (${entropy.toFixed(2)})`);
        }

        if (contextRisk > 0.7) {
            reasons.push('High-risk context detected');
        }

        if (patternScore > 0.8) {
            reasons.push('Matches known secret pattern');
        }

        if (charDistribution.entropy > 4.0) {
            reasons.push('Diverse character set');
        }

        const confidence = Math.min(1.0, (entropy / 5.0) * 0.4 + contextRisk * 0.4 + patternScore * 0.2);
        const isLikelySecret = confidence > 0.6 && entropy > 3.5;

        const category = isLikelySecret ? this.categorizeSecret(secretValue) : 'Unknown';
        const riskLevel = isLikelySecret ? this.assessRiskLevel(secretValue, context) : 'low';
        const detectionMethod = this.determineDetectionMethod(entropy, contextRisk, patternScore);

        return {
            isLikelySecret,
            confidence,
            category,
            riskLevel,
            reasoning: reasons,
            detectionMethod
        };
    }

    private static calculateAdvancedEntropy(str: string): number {
        const charFreq = new Map<string, number>();
        for (const char of str) {
            charFreq.set(char, (charFreq.get(char) || 0) + 1);
        }

        let entropy = 0;
        const len = str.length;
        for (const count of charFreq.values()) {
            const p = count / len;
            entropy -= p * Math.log2(p);
        }
        return entropy;
    }

    private static analyzeCharacterDistribution(str: string): { entropy: number; hasSpecialChars: boolean; alphanumericRatio: number } {
        const entropy = this.calculateAdvancedEntropy(str);
        const hasSpecialChars = /[^a-zA-Z0-9]/.test(str);
        const alphanumericCount = (str.match(/[a-zA-Z0-9]/g) || []).length;
        const alphanumericRatio = alphanumericCount / str.length;

        return { entropy, hasSpecialChars, alphanumericRatio };
    }

    private static assessContextRisk(context: string): number {
        let risk = 0.0;
        const highRiskKeywords = ['auth', 'key', 'secret', 'token', 'password', 'credential', 'api'];
        const mediumRiskKeywords = ['header', 'bearer', 'authorization', 'db', 'database'];

        const contextLower = context.toLowerCase();

        for (const keyword of highRiskKeywords) {
            if (contextLower.includes(keyword)) risk += 0.2;
        }

        for (const keyword of mediumRiskKeywords) {
            if (contextLower.includes(keyword)) risk += 0.1;
        }

        if (contextLower.includes('=') || contextLower.includes(':')) risk += 0.1;

        return Math.min(1.0, risk);
    }

    private static detectGenericPatterns(str: string): number {
        let score = 0.0;

        if (str.length >= 20 && str.length <= 64) score += 0.2;
        else if (str.length >= 128) score += 0.3;

        const hasMixedCase = /[a-z]/.test(str) && /[A-Z]/.test(str);
        const hasDigits = /\d/.test(str);
        const hasSpecial = /[^a-zA-Z0-9]/.test(str);

        if (hasMixedCase && hasDigits) score += 0.3;
        if (hasSpecial) score += 0.2;

        const secretPrefixes = ['sk-', 'pk_', 'AKIAI', 'ghp_', 'xox', 'SG.', 'dop_v1_', 'vercel_'];
        for (const prefix of secretPrefixes) {
            if (str.startsWith(prefix)) {
                score += 0.4;
                break;
            }
        }

        if (/^[A-Za-z0-9+/=]+$/.test(str) && str.length % 4 === 0) score += 0.3;
        if (/^[a-fA-F0-9]+$/.test(str) && str.length >= 32) score += 0.2;

        return Math.min(1.0, score);
    }

    private static categorizeSecret(secretValue: string): string {
        if (/^(sk|pk)[_-]/.test(secretValue)) return 'API Key';
        if (/^(AKIAI|AKIA)/.test(secretValue)) return 'AWS API Key';
        if (/^ghp_/.test(secretValue)) return 'GitHub Token';
        if (/^xox[bap]-/.test(secretValue)) return 'Slack Token';
        if (/^SG\./.test(secretValue)) return 'SendGrid API Key';
        if (/^(mysql|postgresql|mongodb|redis):\/\//.test(secretValue)) return 'Database URL';
        if (/^Bearer\s+/.test(secretValue)) return 'Bearer Token';
        if (/-----BEGIN/.test(secretValue)) return 'Certificate/Private Key';
        if (secretValue.length >= 32) return 'Generic API Key/Token';
        return 'Potential Secret';
    }

    private static assessRiskLevel(secretValue: string, context: string): 'critical' | 'high' | 'medium' | 'low' {
        const contextLower = context.toLowerCase();

        if (contextLower.includes('authorization') || contextLower.includes('bearer')) return 'critical';
        if (contextLower.includes('stripe') || contextLower.includes('payment')) return 'high';
        if (contextLower.includes('aws') || contextLower.includes('cloud')) return 'high';
        if (contextLower.includes('api') || contextLower.includes('key')) return 'medium';

        return 'low';
    }

    private static determineDetectionMethod(entropy: number, contextRisk: number, patternScore: number): 'statistical' | 'contextual' | 'pattern' | 'hybrid' {
        const scores = {
            statistical: entropy / 5.0,
            contextual: contextRisk,
            pattern: patternScore
        };

        const highScoreCount = Object.values(scores).filter(score => score > 0.6).length;
        if (highScoreCount > 1) return 'hybrid';

        const maxMethod = Object.entries(scores).reduce((a, b) => scores[a[0] as keyof typeof scores] > scores[b[0] as keyof typeof scores] ? a : b)[0];
        return maxMethod as 'statistical' | 'contextual' | 'pattern';
    }

    public static setProgressCallback(callback: (progress: ScanProgress) => void): void {
        this.scanProgressCallback = callback;
    }

    private static calculateFileHash(content: string): string {
        let hash = 0;
        for (let i = 0; i < content.length; i++) {
            const char = content.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash;
        }
        return hash.toString();
    }

    private static shouldRescanFile(filePath: string): boolean {
        try {
            const stats = fsSync.statSync(filePath);
            const cached = this.scanCache.get(filePath);

            if (!cached) return true;
            if (stats.mtime.getTime() > cached.lastModified) return true;
            if (Date.now() - cached.lastModified > this.CACHE_DURATION) return true;

            return false;
        } catch {
            return true;
        }
    }

    private static getCachedResults(filePath: string): DetectedSecret[] | null {
        const cached = this.scanCache.get(filePath);
        return cached ? cached.scanResults : null;
    }

    private static async cacheResults(filePath: string, results: DetectedSecret[]): Promise<void> {
        try {
            const content = await fs.readFile(filePath, 'utf8');
            const stats = await fs.stat(filePath);
            const fileHash = this.calculateFileHash(content);

            this.scanCache.set(filePath, {
                filePath,
                lastModified: stats.mtime.getTime(),
                scanResults: results,
                fileHash
            });

            if (this.scanCache.size > 1000) {
                const oldestKey = Array.from(this.scanCache.keys())[0];
                this.scanCache.delete(oldestKey);
            }
        } catch (error) {
            console.warn('Failed to cache results:', error instanceof Error ? error.message : 'Unknown error');
        }
    }

    public static async scanWorkspaceEnhanced(progressCallback?: (progress: ScanProgress) => void): Promise<DetectedSecret[]> {
        const secrets: DetectedSecret[] = [];
        const workspaceFolders = vscode.workspace.workspaceFolders;

        if (!workspaceFolders) {
            vscode.window.showInformationMessage('Open a workspace folder to scan for secrets.');
            return secrets;
        }

        const rootPath = workspaceFolders[0].uri.fsPath;
        const startTime = Date.now();

        if (progressCallback) {
            this.setProgressCallback(progressCallback);
        }

        try {
            const files = await vscode.workspace.findFiles(
                '**/*',
                this.getExcludePattern(),
                5000
            );

            const filesToScan: string[] = [];
            const cachedResults: DetectedSecret[] = [];

            for (const fileUri of files) {
                if (fileUri.scheme !== 'file') continue;

                const filePath = fileUri.fsPath;
                if (!this.shouldScanFile(filePath, rootPath)) continue;

                if (this.shouldRescanFile(filePath)) {
                    filesToScan.push(filePath);
                } else {
                    const cached = this.getCachedResults(filePath);
                    if (cached) {
                        cachedResults.push(...cached);
                    }
                }
            }

            if (this.scanProgressCallback) {
                this.scanProgressCallback({
                    current: 0,
                    total: filesToScan.length,
                    percentage: 0,
                    currentFile: 'Preparing scan...',
                    estimatedTimeRemaining: 0,
                    startTime
                });
            }

            const scanPromises = filesToScan.map((filePath, index) =>
                this.scanFileEnhanced(filePath, index, filesToScan.length, startTime)
            );

            const scanResults = await Promise.all(scanPromises);

            for (const results of scanResults) {
                secrets.push(...results);
            }
            secrets.push(...cachedResults);

            for (let i = 0; i < scanResults.length; i++) {
                await this.cacheResults(filesToScan[i], scanResults[i]);
            }

        } catch (error) {
            console.error('Error in enhanced workspace scan:', error);
        }

        return this.deduplicateSecrets(secrets);
    }

    private static async scanFileEnhanced(filePath: string, index: number, total: number, startTime: number): Promise<DetectedSecret[]> {
        const secrets: DetectedSecret[] = [];

        try {
            const content = await fs.readFile(filePath, 'utf8');
            const lines = content.split('\n');

            if (this.scanProgressCallback) {
                const elapsed = Date.now() - startTime;
                const avgTimePerFile = elapsed / (index + 1);
                const remaining = (total - index - 1) * avgTimePerFile;

                this.scanProgressCallback({
                    current: index + 1,
                    total,
                    percentage: ((index + 1) / total) * 100,
                    currentFile: path.basename(filePath),
                    estimatedTimeRemaining: remaining,
                    startTime
                });
            }

            for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
                const line = lines[lineIndex];
                const lineSecrets = await this.scanLine(line, lineIndex, lines, filePath);
                secrets.push(...lineSecrets);
            }

        } catch (error) {
            console.log(`Skipping file ${filePath}: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }

        return this.assignUniqueEnvVarNames(secrets);
    }

    public static getCacheStats(): { size: number; hitRate: number; memoryUsage: number } {
        return {
            size: this.scanCache.size,
            hitRate: 0,
            memoryUsage: JSON.stringify([...this.scanCache.entries()]).length
        };
    }

    public static clearCache(): void {
        this.scanCache.clear();
    }

    public static getPerformanceMetrics(): {
        cacheSize: number;
        cacheMemoryUsage: number;
        averageScanTime: number;
        totalScans: number;
    } {
        return {
            cacheSize: this.scanCache.size,
            cacheMemoryUsage: JSON.stringify([...this.scanCache.entries()]).length,
            averageScanTime: 0,
            totalScans: 0
        };
    }
}
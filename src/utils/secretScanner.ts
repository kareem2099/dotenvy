import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

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

export class SecretScanner {
    private static scanProgressCallback?: (progress: ScanProgress) => void;
    private static scanCache = new Map<string, ScanCache>();
    private static readonly CACHE_DURATION = 5 * 60 * 1000; // 5 minutes
    private static readonly MAX_WORKERS = 4; // Parallel processing workers

    // Common secret patterns to scan for
    private static readonly SECRET_PATTERNS = [
        // API Keys - Major Platforms
        { regex: /\b(sk-|pk_|AKIAI|AKIAIOSFODNN7|aws_access_key|aws_secret_key)[A-Za-z0-9_-]{10,}/gi, type: 'AWS API Key' },
        { regex: /\bsk-[a-zA-Z0-9]{20,}/gi, type: 'Stripe Secret Key' },
        { regex: /\bpk_[a-zA-Z0-9]{20,}/gi, type: 'Stripe Publishable Key' },
        { regex: /\bgsk_[a-zA-Z0-9_-]{50,}/gi, type: 'OpenAI API Key' },
        { regex: /\b(ghp_|github_pat_)[a-zA-Z0-9_-]{20,}/gi, type: 'GitHub Personal Access Token' },
        { regex: /\b(xox[bap]-[0-9]{8,}[A-Za-z0-9_-]{20,})/gi, type: 'Slack API Token' },
        { regex: /\b[MTA][A-Za-z0-9_-]{24,}\.[A-Za-z0-9_-]{6,}\.?[A-Za-z0-9_-]{27,}/gi, type: 'Discord Bot Token' },

        // Email & Communications
        { regex: /\bSG\.[a-zA-Z0-9_-]{20,}/gi, type: 'SendGrid API Key' },
        { regex: /\b(key-[a-zA-Z0-9_-]{20,})/gi, type: 'Mailgun API Key' },
        { regex: /\b[A-Za-z0-9_-]{32}@[a-zA-Z0-9-]+\.mailgun\.org/gi, type: 'Mailgun Domain Key' },
        { regex: /\bSK[a-f0-9]{32,}/gi, type: 'Twilio Auth Token' },

        // Monitoring & Error Tracking
        { regex: /\bhttps:\/\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}@[a-z]+\.ingest\.sentry\.io\b/gi, type: 'Sentry DSN' },
        { regex: /\b(https:\/\/o\d+\.ingest\.sentry\.io\/\d+)/gi, type: 'Sentry DSN' },

        // Cloud & Infrastructure
        { regex: /\b[a-z0-9]{64}/gi, type: 'Firebase Service Account Key' },
        { regex: /\bdop_v1_[a-f0-9]{64}/gi, type: 'DigitalOcean Token' },
        { regex: /\bvcu-[a-f0-9-]{32,}/gi, type: 'Vultr API Key' },
        { regex: /\b[a-f0-9]{32}\.appspot\.com\b/gi, type: 'Google Cloud Service Key' },

        // Social Media & Marketing
        { regex: /\b[a-f0-9]{32}/gi, type: 'Facebook App Secret' },
        { regex: /\b[a-f0-9]{32}/gi, type: 'Instagram App Secret' },
        { regex: /\b[a-f0-9]{40}/gi, type: 'Twitter Bearer Token' },
        { regex: /\b[a-f0-9]{32}/gi, type: 'LinkedIn Client Secret' },
        { regex: /\b[a-f0-9]{32}/gi, type: 'Mailchimp API Key' },

        // Development Tools
        { regex: /\brun-[a-zA-Z0-9_-]{20,}/gi, type: 'Cloudflare API Token' },
        { regex: /\b[A-Za-z0-9_-]{24}/gi, type: 'Contentful Access Token' },
        { regex: /\b[a-f0-9]{32}/gi, type: 'Heroku OAuth Token' },
        { regex: /\bvercel_[a-zA-Z0-9_-]{20,}/gi, type: 'Vercel API Token' },

        // Generic API Keys/Tokens
        { regex: /\b[A-Za-z0-9_-]{32,}\b/g, type: 'API Key/Token (32+ chars)' },
        { regex: /Bearer\s+[A-Za-z0-9_-]{20,}/gi, type: 'Bearer Token' },
        { regex: /Token\s+[A-Za-z0-9_-]{20,}/gi, type: 'Auth Token' },

        // Database URLs
        { regex: /(mysql|postgresql|sqlite|mongodb|redis):\/\/[A-Za-z0-9_-]+:[^@]*@/gi, type: 'Database Connection URL' },
        { regex: /mongodb\+srv:\/\/[A-Za-z0-9_-]+:[^@]*@/gi, type: 'MongoDB Atlas Connection' },

        // Passwords and credentials
        { regex: /\bpassword\s*[:=]\s*[A-Za-z0-9_-]{6,}/gi, type: 'Password' },
        { regex: /\bsecret[\-_]*(key)?\s*[:=]\s*[A-Za-z0-9_-]{8,}/gi, type: 'Secret Key' },

        // JWT Secrets
        { regex: /jwt[\-_]*secret\s*[:=]\s*[A-Za-z0-9_.-]{20,}/gi, type: 'JWT Secret' },

        // SSH Keys (public markers)
        { regex: /-----BEGIN\s+(RSA|DSA|EC|OPENSSH|PGP) PRIVATE KEY-----/gi, type: 'SSH Private Key' },
        { regex: /-----BEGIN\s+CERTIFICATE-----/gi, type: 'SSL Certificate' },

        // Encryption keys
        { regex: /\b[a-f0-9]{32}\b/gi, type: 'MD5 Hash (possible key)' },
        { regex: /\b[a-f0-9]{64}\b/gi, type: 'SHA256 Hash (possible key)' },
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
        '.woff', '.woff2', '.eot', '.ttf'
    ];

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
            // Find all relevant files
            const files = await vscode.workspace.findFiles(
                '**/*',
                this.getExcludePattern(),
                5000 // Reasonable limit
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

        return secrets;
    }

    /**
     * Scan a single file for secrets
     */
    public static async scanFile(filePath: string): Promise<DetectedSecret[]> {
        const secrets: DetectedSecret[] = [];

        try {
            const content = fs.readFileSync(filePath, 'utf8');
            const lines = content.split('\n');

            for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
                const line = lines[lineIndex];

                for (const pattern of this.SECRET_PATTERNS) {
                    const matches = [...line.matchAll(new RegExp(pattern.regex.source, pattern.regex.flags))];

                    for (const match of matches) {
                        const secretValue = match[0].trim();
                        if (this.isLikelySecret(secretValue)) {
                            const context = this.getContextLine(lines, lineIndex, match.index!);
                            const secretScore = this.calculateSecretScore(secretValue, context);

                            const baseSecret: DetectedSecret = {
                                file: vscode.workspace.asRelativePath(filePath),
                                line: lineIndex + 1,
                                column: match.index! + 1,
                                content: secretValue,
                                type: pattern.type,
                                confidence: this.getConfidence(secretValue),
                                suggestedEnvVar: '', // Will be set after processing all
                                context: context,
                                riskScore: secretScore.confidence,
                                detectionMethod: secretScore.detectionMethod,
                                reasoning: secretScore.reasoning
                            };

                            secrets.push(baseSecret);
                        }
                    }
                }
            }

        } catch (error) {
            // Skip files that can't be read
            console.log(`Skipping file ${filePath}: ${error}`);
        }

        // Generate unique environment variable names
        return this.assignUniqueEnvVarNames(secrets);
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

            // Ensure uniqueness
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
     * Check if a string looks like a real secret (has sufficient entropy)
     */
    private static isLikelySecret(value: string): boolean {
        // Remove common separators
        const cleanValue = value.replace(/[-_.]/g, '');

        // Check minimum length
        if (cleanValue.length < 10) return false;

        // Check for sufficient complexity
        const uniqueChars = new Set(cleanValue).size;
        const entropyRatio = uniqueChars / cleanValue.length;

        // Require at least 60% unique characters for strings longer than 15 chars
        if (cleanValue.length > 15 && entropyRatio < 0.6) return false;

        // Skip obvious non-secrets
        if (/^\d+$/.test(cleanValue)) return false; // All digits
        if (/^[a-zA-Z]+$/.test(cleanValue)) return false; // All letters

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
     * Generate a unique environment variable name
     */
    private static generateUniqueEnvVar(secrets: DetectedSecret[], currentSecret: DetectedSecret): string {
        // First, check if there are any secrets that already match our type in this file
        const sameFileSecrets = secrets.filter(s =>
            s.file === currentSecret.file &&
            s.type === currentSecret.type &&
            s !== currentSecret
        );

        // If same type already exists, add a suffix
        let suffix = '';
        if (sameFileSecrets.length > 0) {
            suffix = `_${sameFileSecrets.length + 1}`;
        }

        return this.generateBaseEnvVarName(currentSecret) + suffix;
    }

    /**
     * Generate base environment variable name
     */
    private static generateBaseEnvVarName(secret: DetectedSecret): string {
        const type = secret.type;

        // Type-based suggestions - Major Platforms
        if (type.includes('AWS')) return 'AWS_ACCESS_KEY_ID';
        if (type.includes('Stripe Secret Key')) return 'STRIPE_SECRET_KEY';
        if (type.includes('Stripe Publishable Key')) return 'STRIPE_PUBLISHABLE_KEY';
        if (type.includes('OpenAI')) return 'OPENAI_API_KEY';
        if (type.includes('GitHub')) return 'GITHUB_TOKEN';
        if (type.includes('Slack')) return 'SLACK_BOT_TOKEN';
        if (type.includes('Discord')) return 'DISCORD_BOT_TOKEN';
        if (type.includes('JWT')) return 'JWT_SECRET';
        if (type.includes('Database')) return 'DATABASE_URL';
        if (type.includes('MongoDB')) return 'MONGODB_URI';

        // Email & Communications
        if (type.includes('SendGrid')) return 'SENDGRID_API_KEY';
        if (type.includes('Mailgun')) return 'MAILGUN_API_KEY';
        if (type.includes('Twilio')) return 'TWILIO_AUTH_TOKEN';

        // Monitoring & Error Tracking
        if (type.includes('Sentry')) return 'SENTRY_DSN';

        // Cloud & Infrastructure
        if (type.includes('Firebase')) return 'FIREBASE_SERVICE_ACCOUNT';
        if (type.includes('DigitalOcean')) return 'DIGITALOCEAN_TOKEN';
        if (type.includes('Vultr')) return 'VULTR_API_KEY';
        if (type.includes('Google Cloud')) return 'GOOGLE_CLOUD_KEY';

        // Social Media & Marketing
        if (type.includes('Facebook')) return 'FACEBOOK_APP_SECRET';
        if (type.includes('Instagram')) return 'INSTAGRAM_APP_SECRET';
        if (type.includes('Twitter')) return 'TWITTER_BEARER_TOKEN';
        if (type.includes('LinkedIn')) return 'LINKEDIN_CLIENT_SECRET';
        if (type.includes('Mailchimp')) return 'MAILCHIMP_API_KEY';

        // Development Tools
        if (type.includes('Cloudflare')) return 'CLOUDFLARE_API_TOKEN';
        if (type.includes('Contentful')) return 'CONTENTFUL_ACCESS_TOKEN';
        if (type.includes('Heroku')) return 'HEROKU_OAUTH_TOKEN';
        if (type.includes('Vercel')) return 'VERCEL_API_TOKEN';

        // Security & Cryptography
        if (type.includes('SSH Private Key')) return 'SSH_PRIVATE_KEY';
        if (type.includes('SSL Certificate')) return 'SSL_CERTIFICATE';

        // Generic API key/token types
        if (type.includes('Bearer Token')) return 'AUTH_BEARER_TOKEN';
        if (type.includes('Auth Token')) return 'AUTH_TOKEN';
        if (type.includes('API Key')) return 'API_KEY';
        if (type.includes('Password')) return 'PASSWORD';
        if (type.includes('Secret Key')) return 'SECRET_KEY';

        // Fallback based on secret content pattern
        if (secret.content.startsWith('sk-')) return 'STRIPE_SECRET_KEY';
        if (secret.content.startsWith('pk_')) return 'STRIPE_PUBLISHABLE_KEY';
        if (secret.content.startsWith('AKIAI') || secret.content.startsWith('AKIAIOS')) return 'AWS_ACCESS_KEY_ID';
        if (secret.content.startsWith('sk-proj-')) return 'OPENAI_API_KEY';
        if (secret.content.startsWith('ghp_')) return 'GITHUB_TOKEN';
        if (secret.content.startsWith('xoxb-') || secret.content.startsWith('xoxp-')) return 'SLACK_TOKEN';
        if (secret.content.startsWith('dop_v1_')) return 'DIGITALOCEAN_TOKEN';
        if (secret.content.startsWith('vercel_')) return 'VERCEL_TOKEN';

        // File-based fallback
        const fileName = path.basename(secret.file, path.extname(secret.file));
        const baseName = fileName.toUpperCase();
        const cleanBaseName = baseName.startsWith('.') ? `FILE_${baseName.substring(1)}` : baseName;

        if (type.includes('MD5') || type.includes('Hash')) return `${cleanBaseName}_HASH`;
        if (type.includes('Certificate') || type.includes('Key')) return `${cleanBaseName}_CERT`;

        return `${cleanBaseName}_SECRET`;
    }

    /**
     * Get context line around the secret
     */
    private static getContextLine(lines: string[], lineIndex: number, matchIndex: number): string {
        const line = lines[lineIndex].trim();
        if (line.length > 100) {
            // Extract around the match
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

        // Check if file is in ignored folders
        for (const ignored of this.IGNORED_FILES) {
            if (relativePath.includes(`/${ignored}/`) || relativePath.startsWith(`${ignored}/`)) {
                return false;
            }
        }

        // Check file extensions
        const ext = path.extname(filePath).toLowerCase();
        if (this.IGNORED_EXTENSIONS.includes(ext)) {
            return false;
        }

        // Only scan text-based code files
        const scanExtensions = ['.js', '.ts', '.py', '.java', '.cpp', '.c', '.php', '.rb', '.go', '.rs', '.sh', '.json', '.yml', '.yaml', '.xml', '.html', '.css'];
        return scanExtensions.includes(ext) || path.basename(filePath).startsWith('.env');
    }

    /**
     * Calculate intelligent secret score using advanced algorithms
     */
    private static calculateSecretScore(secretValue: string, context: string): SecretScore {
        const entropy = this.calculateAdvancedEntropy(secretValue);
        const contextRisk = this.assessContextRisk(context);
        const patternScore = this.detectGenericPatterns(secretValue);
        const charDistribution = this.analyzeCharacterDistribution(secretValue);

        const reasons: string[] = [];

        // Entropy analysis
        if (entropy > 4.5) {
            reasons.push(`High entropy (${entropy.toFixed(2)}) indicates random-looking string`);
        } else if (entropy < 3.0) {
            reasons.push(`Low entropy (${entropy.toFixed(2)}) suggests structured data`);
        }

        // Context analysis
        if (contextRisk > 0.7) {
            reasons.push('High-risk context (auth, config, API usage)');
        }

        // Pattern analysis
        if (patternScore > 0.8) {
            reasons.push('Matches known secret patterns');
        }

        // Character distribution
        if (charDistribution.entropy > 4.0) {
            reasons.push('Diverse character set typical of secrets');
        }

        const confidence = Math.min(1.0, (entropy / 5.0) * 0.4 + contextRisk * 0.4 + patternScore * 0.2);
        const isLikelySecret = confidence > 0.6 && entropy > 3.5;

        let category = 'Unknown';
        let riskLevel: 'critical' | 'high' | 'medium' | 'low' = 'low';

        if (isLikelySecret) {
            category = this.categorizeSecret(secretValue);
            riskLevel = this.assessRiskLevel(secretValue, context);
        }

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

    /**
     * Calculate advanced entropy with character frequency analysis
     */
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

    /**
     * Analyze character distribution patterns
     */
    private static analyzeCharacterDistribution(str: string): { entropy: number; hasSpecialChars: boolean; alphanumericRatio: number } {
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

        const hasSpecialChars = /[^a-zA-Z0-9]/.test(str);
        const alphanumericCount = (str.match(/[a-zA-Z0-9]/g) || []).length;
        const alphanumericRatio = alphanumericCount / len;

        return { entropy, hasSpecialChars, alphanumericRatio };
    }

    /**
     * Assess context risk based on surrounding code
     */
    private static assessContextRisk(context: string): number {
        let risk = 0.0;

        // High-risk keywords
        const highRiskKeywords = ['auth', 'key', 'secret', 'token', 'password', 'credential', 'api', 'config'];
        const mediumRiskKeywords = ['header', 'bearer', 'authorization', 'db', 'database', 'connection'];

        const contextLower = context.toLowerCase();

        for (const keyword of highRiskKeywords) {
            if (contextLower.includes(keyword)) {
                risk += 0.2;
            }
        }

        for (const keyword of mediumRiskKeywords) {
            if (contextLower.includes(keyword)) {
                risk += 0.1;
            }
        }

        // Check for assignment patterns
        if (contextLower.includes('=') || contextLower.includes(':')) {
            risk += 0.1;
        }

        // Check for object property patterns
        if (contextLower.includes('{\s*') || contextLower.includes(':\s*')) {
            risk += 0.15;
        }

        return Math.min(1.0, risk);
    }

    /**
     * Detect generic secret patterns using statistical analysis
     */
    private static detectGenericPatterns(str: string): number {
        let score = 0.0;

        // Length patterns typical of secrets
        if (str.length >= 20 && str.length <= 64) score += 0.2;
        else if (str.length >= 128) score += 0.3; // Very long strings often secrets

        // Character set patterns
        const hasMixedCase = /[a-z]/.test(str) && /[A-Z]/.test(str);
        const hasDigits = /\d/.test(str);
        const hasSpecial = /[^a-zA-Z0-9]/.test(str);

        if (hasMixedCase && hasDigits) score += 0.3;
        if (hasSpecial) score += 0.2;

        // Common secret prefixes
        const secretPrefixes = ['sk-', 'pk_', 'AKIAI', 'ghp_', 'xox', 'SG.', 'dop_v1_', 'vercel_'];
        for (const prefix of secretPrefixes) {
            if (str.startsWith(prefix)) {
                score += 0.4;
                break;
            }
        }

        // Base64-like patterns (alphanumeric + padding)
        if (/^[A-Za-z0-9+/=]+$/.test(str) && str.length % 4 === 0) {
            score += 0.3;
        }

        // Hex patterns
        if (/^[a-fA-F0-9]+$/.test(str) && str.length >= 32) {
            score += 0.2;
        }

        return Math.min(1.0, score);
    }

    /**
     * Categorize secret based on pattern analysis
     */
    private static categorizeSecret(secretValue: string): string {
        // API Keys
        if (/^(sk|pk)[_-]/.test(secretValue)) return 'API Key';
        if (/^(AKIAI|AKIAIOS)/.test(secretValue)) return 'AWS API Key';
        if (/^ghp_/.test(secretValue)) return 'GitHub Token';
        if (/^xox[bap]-/.test(secretValue)) return 'Slack Token';
        if (/^SG\./.test(secretValue)) return 'SendGrid API Key';
        if (/^dop_v1_/.test(secretValue)) return 'DigitalOcean Token';
        if (/^vercel_/.test(secretValue)) return 'Vercel Token';

        // Database URLs
        if (/^(mysql|postgresql|mongodb|redis):\/\//.test(secretValue)) return 'Database URL';

        // Tokens
        if (/^Bearer\s+/.test(secretValue)) return 'Bearer Token';
        if (/^Token\s+/.test(secretValue)) return 'Auth Token';

        // Certificates and keys
        if (/-----BEGIN/.test(secretValue)) return 'Certificate/Private Key';

        // Passwords
        if (secretValue.length >= 8 && /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(secretValue)) {
            return 'Password';
        }

        // Generic patterns
        if (secretValue.length >= 32) return 'Generic API Key/Token';
        if (secretValue.length >= 64) return 'Cryptographic Key';

        return 'Potential Secret';
    }

    /**
     * Assess risk level based on secret type and context
     */
    private static assessRiskLevel(secretValue: string, context: string): 'critical' | 'high' | 'medium' | 'low' {
        const contextLower = context.toLowerCase();

        // Critical if in auth headers or API calls
        if (contextLower.includes('authorization') || contextLower.includes('bearer')) {
            return 'critical';
        }

        // High risk for financial services
        if (contextLower.includes('stripe') || contextLower.includes('payment') || contextLower.includes('billing')) {
            return 'high';
        }

        // High risk for cloud infrastructure
        if (contextLower.includes('aws') || contextLower.includes('cloud') || contextLower.includes('infrastructure')) {
            return 'high';
        }

        // Medium risk for general APIs
        if (contextLower.includes('api') || contextLower.includes('key') || contextLower.includes('token')) {
            return 'medium';
        }

        // Low risk for database or config
        if (contextLower.includes('config') || contextLower.includes('database') || contextLower.includes('db')) {
            return 'low';
        }

        return 'medium';
    }

    /**
     * Determine the primary detection method used
     */
    private static determineDetectionMethod(entropy: number, contextRisk: number, patternScore: number): 'statistical' | 'contextual' | 'pattern' | 'hybrid' {
        const scores = {
            statistical: entropy / 5.0,
            contextual: contextRisk,
            pattern: patternScore
        };

        const maxMethod = Object.entries(scores).reduce((a, b) => scores[a[0] as keyof typeof scores] > scores[b[0] as keyof typeof scores] ? a : b)[0];

        // If multiple methods have high scores, it's hybrid
        const highScoreCount = Object.values(scores).filter(score => score > 0.6).length;
        if (highScoreCount > 1) {
            return 'hybrid';
        }

        return maxMethod as 'statistical' | 'contextual' | 'pattern';
    }

    /**
     * Set progress callback for real-time updates
     */
    public static setProgressCallback(callback: (progress: ScanProgress) => void): void {
        this.scanProgressCallback = callback;
    }

    /**
     * Calculate file hash for cache validation
     */
    private static calculateFileHash(content: string): string {
        let hash = 0;
        for (let i = 0; i < content.length; i++) {
            const char = content.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash; // Convert to 32-bit integer
        }
        return hash.toString();
    }

    /**
     * Check if file needs re-scanning based on cache
     */
    private static shouldRescanFile(filePath: string): boolean {
        try {
            const stats = fs.statSync(filePath);
            const cached = this.scanCache.get(filePath);

            if (!cached) return true;

            // Check if file was modified
            if (stats.mtime.getTime() > cached.lastModified) return true;

            // Check cache expiration
            if (Date.now() - cached.lastModified > this.CACHE_DURATION) return true;

            return false;
        } catch {
            return true; // Re-scan if we can't read file stats
        }
    }

    /**
     * Get cached results for file
     */
    private static getCachedResults(filePath: string): DetectedSecret[] | null {
        const cached = this.scanCache.get(filePath);
        return cached ? cached.scanResults : null;
    }

    /**
     * Cache scan results for file
     */
    private static cacheResults(filePath: string, results: DetectedSecret[]): void {
        try {
            const content = fs.readFileSync(filePath, 'utf8');
            const stats = fs.statSync(filePath);
            const fileHash = this.calculateFileHash(content);

            this.scanCache.set(filePath, {
                filePath,
                lastModified: stats.mtime.getTime(),
                scanResults: results,
                fileHash
            });

            // Clean old cache entries (simple LRU)
            if (this.scanCache.size > 1000) {
                const oldestKey = Array.from(this.scanCache.keys())[0];
                this.scanCache.delete(oldestKey);
            }
        } catch (error) {
            console.warn('Failed to cache results:', error);
        }
    }

    /**
     * Enhanced workspace scanning with performance optimizations
     */
    public static async scanWorkspaceEnhanced(progressCallback?: (progress: ScanProgress) => void): Promise<DetectedSecret[]> {
        const secrets: DetectedSecret[] = [];
        const workspaceFolders = vscode.workspace.workspaceFolders;

        if (!workspaceFolders) {
            vscode.window.showInformationMessage('Open a workspace folder to scan for secrets.');
            return secrets;
        }

        const rootPath = workspaceFolders[0].uri.fsPath;
        const startTime = Date.now();

        // Set progress callback
        if (progressCallback) {
            this.setProgressCallback(progressCallback);
        }

        try {
            // Find all relevant files
            const files = await vscode.workspace.findFiles(
                '**/*',
                this.getExcludePattern(),
                5000 // Reasonable limit
            );

            const filesToScan: string[] = [];
            const cachedResults: DetectedSecret[] = [];

            // Separate files that need scanning vs cached files
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

            // Update progress
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

            // Scan files with parallel processing
            const scanPromises = filesToScan.map((filePath, index) =>
                this.scanFileEnhanced(filePath, index, filesToScan.length, startTime)
            );

            const scanResults = await Promise.all(scanPromises);

            // Combine cached and new results
            for (const results of scanResults) {
                secrets.push(...results);
            }
            secrets.push(...cachedResults);

            // Cache new results
            scanResults.forEach((results, index) => {
                this.cacheResults(filesToScan[index], results);
            });

        } catch (error) {
            console.error('Error in enhanced workspace scan:', error);
        }

        return secrets;
    }

    /**
     * Enhanced file scanning with progress tracking
     */
    private static async scanFileEnhanced(filePath: string, index: number, total: number, startTime: number): Promise<DetectedSecret[]> {
        const secrets: DetectedSecret[] = [];

        try {
            const content = fs.readFileSync(filePath, 'utf8');
            const lines = content.split('\n');

            // Update progress
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

                for (const pattern of this.SECRET_PATTERNS) {
                    const matches = [...line.matchAll(new RegExp(pattern.regex.source, pattern.regex.flags))];

                    for (const match of matches) {
                        const secretValue = match[0].trim();
                        if (this.isLikelySecret(secretValue)) {
                            const context = this.getContextLine(lines, lineIndex, match.index!);
                            const secretScore = this.calculateSecretScore(secretValue, context);

                            const baseSecret: DetectedSecret = {
                                file: vscode.workspace.asRelativePath(filePath),
                                line: lineIndex + 1,
                                column: match.index! + 1,
                                content: secretValue,
                                type: pattern.type,
                                confidence: this.getConfidence(secretValue),
                                suggestedEnvVar: '',
                                context: context,
                                riskScore: secretScore.confidence,
                                detectionMethod: secretScore.detectionMethod,
                                reasoning: secretScore.reasoning
                            };

                            secrets.push(baseSecret);
                        }
                    }
                }
            }

        } catch (error) {
            console.log(`Skipping file ${filePath}: ${error}`);
        }

        return this.assignUniqueEnvVarNames(secrets);
    }

    /**
     * Get cache statistics
     */
    public static getCacheStats(): { size: number; hitRate: number; memoryUsage: number } {
        return {
            size: this.scanCache.size,
            hitRate: 0, // Would need to track hits vs misses
            memoryUsage: JSON.stringify([...this.scanCache.entries()]).length
        };
    }

    /**
     * Clear scan cache
     */
    public static clearCache(): void {
        this.scanCache.clear();
    }

    /**
     * Get performance metrics
     */
    public static getPerformanceMetrics(): {
        cacheSize: number;
        cacheMemoryUsage: number;
        averageScanTime: number;
        totalScans: number;
    } {
        return {
            cacheSize: this.scanCache.size,
            cacheMemoryUsage: JSON.stringify([...this.scanCache.entries()]).length,
            averageScanTime: 0, // Would need to track timing
            totalScans: 0 // Would need to track scan count
        };
    }
}

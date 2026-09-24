/**
 * Pattern Registry for Secret Detection
 * ===================================
 *
 * Centralized registry of regex patterns for detecting various types of secrets
 * and sensitive information in code files.
 */

import { PatternDefinition } from './secretScannerTypes';

export class PatternRegistry {
    private static patterns: PatternDefinition[] = [];
    private static excludePattern = '';

    /**
     * Initialize the pattern registry with default secret detection patterns
     */
    static initialize(): void {
        this.patterns = [
            // API Keys and Tokens — requires separator between prefix and value
            {
                // Must have _ or - separator so "secretDetector", "keyManager" etc. are excluded
                regex: /\b(sk|pk|api|key|token|secret)[_-][a-zA-Z0-9_-]{20,}\b/gi,
                type: 'Generic API Key',
                description: 'Generic API keys, tokens, and secrets (prefix_value format)',
                priority: 1,
                requiresEntropyCheck: true
            },
            {
                regex: /\b(sk-[a-zA-Z0-9]{20,})\b/g,
                type: 'Stripe Secret Key',
                description: 'Stripe secret API key starting with sk-',
                priority: 5,
                requiresEntropyCheck: false
            },
            {
                regex: /\b(pk_[a-zA-Z0-9]{16,})\b/g,
                type: 'Stripe Publishable Key',
                description: 'Stripe publishable API key starting with pk_',
                priority: 5,
                requiresEntropyCheck: false
            },
            {
                regex: /\b(sg\.[a-zA-Z0-9_-]{16,})\b/g,
                type: 'SendGrid API Key',
                description: 'SendGrid API key starting with sg.',
                priority: 5,
                requiresEntropyCheck: false
            },
            {
                regex: /\b(dop_v1_[a-zA-Z0-9_-]{20,})\b/g,
                type: 'DigitalOcean Token',
                description: 'Digital Ocean API token',
                priority: 5,
                requiresEntropyCheck: false
            },
            {
                regex: /\b(vercel_[a-zA-Z0-9_-]{16,})\b/g,
                type: 'Vercel Token',
                description: 'Vercel API token',
                priority: 5,
                requiresEntropyCheck: false
            },
            {
                regex: new RegExp('\\b(' + ['g', 'hp_', '[a-zA-Z0-9]{20,}'].join('') + ')\\b', 'g'),
                type: 'GitHub Personal Access Token',
                description: 'GitHub personal access token',
                priority: 5,
                requiresEntropyCheck: false
            },
            {
                regex: new RegExp('\\b(' + ['g', 'ho_', '[a-zA-Z0-9]{20,}'].join('') + ')\\b', 'g'),
                type: 'GitHub OAuth Token',
                description: 'GitHub OAuth access token',
                priority: 5,
                requiresEntropyCheck: false
            },
            {
                regex: /\b(xoxb|xoxp|xoxa|xoxr|xoxt)-[0-9-]+-[0-9-]+-[a-zA-Z0-9-]+\b/g,
                type: 'Slack API Token',
                description: 'Slack API token with varying prefixes',
                priority: 5,
                requiresEntropyCheck: false
            },
            {
                regex: new RegExp('\\b(' + ['A', 'KIAI', '[0-9A-Z]{16}'].join('') + ')\\b', 'g'),
                type: 'AWS Access Key ID',
                description: 'AWS access key identifier',
                priority: 5,
                requiresEntropyCheck: false
            },
            {
                regex: /\b(sk-[a-zA-Z0-9]{20,})\b/g,
                type: 'OpenAI API Key',
                description: 'OpenAI secret key',
                priority: 5,
                requiresEntropyCheck: false
            },
            {
                regex: /\b(MailgunApiKey-[a-zA-Z0-9]{20,})\b/g,
                type: 'Mailgun API Key',
                description: 'Mailgun API key',
                priority: 5,
                requiresEntropyCheck: false
            },
            {
                regex: /\b(TwilioAuthToken-[a-zA-Z0-9]{20,})\b/g,
                type: 'Twilio Auth Token',
                description: 'Twilio authentication token',
                priority: 5,
                requiresEntropyCheck: false
            },
            {
                regex: /\b(SENTRY_DSN|SENTRY_KEY|SENTRY_SECRET)[=:\s]*(["'`]?)[a-zA-Z0-9+/=\-_]{20,}["'`]?\b/gi,
                type: 'Sentry DSN',
                description: 'Sentry DSN or configuration',
                priority: 5,
                requiresEntropyCheck: false
            },

            // Passwords and Secrets — require explicit assignment with quoted value
            {
                // Only fires when password= or password: is followed by a quoted string
                // Prevents matching "changePassword()", "passwd_hash", etc.
                regex: /(?<![A-Za-z])\b(password|passwd|pwd)\b\s*[:=]\s*([\"'`])[^\s\"'`]{8,}\2/gi,
                type: 'Generic Password',
                description: 'Generic password assignment with quoted value',
                priority: 2,
                requiresEntropyCheck: true
            },
            {
                // Only match when the keyword is followed by = or : and then a quoted/unquoted value
                // Negative lookahead prevents matching class names, imports, TypeScript types
                regex: /(?<![.])\b(secret|token|key|auth)\b(?!\s*[({<])\s*[:=]\s*(["'`])[^\s"'`]{12,}\2/gi,
                type: 'Generic Secret',
                description: 'Generic secrets and tokens (assignment form only)',
                priority: 2,
                requiresEntropyCheck: true
            },

            // Cryptographic Keys
            {
                regex: /\b-----BEGIN\s+RSA\s+PRIVATE\s+KEY-----[\s\S]*?-----END\s+RSA\s+PRIVATE\s+KEY-----\b/gi,
                type: 'SSH RSA Private Key',
                description: 'RSA SSH private key with PEM headers',
                priority: 5,
                requiresEntropyCheck: false
            },
            {
                regex: /\b-----BEGIN\s+DSA\s+PRIVATE\s+KEY-----[\s\S]*?-----END\s+DSA\s+PRIVATE\s+KEY-----\b/gi,
                type: 'SSH DSA Private Key',
                description: 'DSA SSH private key with PEM headers',
                priority: 5,
                requiresEntropyCheck: false
            },
            {
                regex: /\b-----BEGIN\s+EC\s+PRIVATE\s+KEY-----[\s\S]*?-----END\s+EC\s+PRIVATE\s+KEY-----\b/gi,
                type: 'SSH EC Private Key',
                description: 'EC SSH private key with PEM headers',
                priority: 5,
                requiresEntropyCheck: false
            },
            {
                regex: /\b-----BEGIN\s+OPENSSH\s+PRIVATE\s+KEY-----[\s\S]*?-----END\s+OPENSSH\s+PRIVATE\s+KEY-----\b/gi,
                type: 'SSH OpenSSH Private Key',
                description: 'OpenSSH private key with PEM headers',
                priority: 5,
                requiresEntropyCheck: false
            },
            {
                regex: /\b(-----BEGIN\s+CERTIFICATE-----[\s\S]*?-----END\s+CERTIFICATE-----)\b/gi,
                type: 'SSL Certificate',
                description: 'SSL/TLS certificate in PEM format',
                priority: 4,
                requiresEntropyCheck: false
            },
            {
                regex: /\b(eyJ[A-Za-z0-9+/=]{20,})\b/g,
                type: 'JWT Token',
                description: 'JSON Web Token (JWT) with base64url encoded header',
                priority: 4,
                requiresEntropyCheck: false
            },
            {
                regex: /\b([A-Fa-f0-9]{32,})\b/g,
                type: 'MD5 Hash',
                description: '32-character hexadecimal string (potential MD5 hash)',
                priority: 1,
                requiresEntropyCheck: true
            },
            {
                regex: /\b([A-Fa-f0-9]{40,})\b/g,
                type: 'SHA-1 Hash',
                description: '40+ character hexadecimal string (potential SHA-1 hash)',
                priority: 1,
                requiresEntropyCheck: true
            },
            {
                regex: /\b([A-Fa-f0-9]{64,})\b/g,
                type: 'SHA-256 Hash',
                description: '64+ character hexadecimal string (potential SHA-256 hash)',
                priority: 1,
                requiresEntropyCheck: true
            },

            // Connection Strings and URLs
            {
                regex: /\b(mongodb|postgres|mysql|sqlite|redis):\/\/[^\s"'`]{15,}\b/gi,
                type: 'Database URL',
                description: 'Database connection URL',
                priority: 5,
                requiresEntropyCheck: false
            },
            {
                regex: /\b(mongodb\+srv):\/\/[^\s"'`]{15,}\b/gi,
                type: 'MongoDB Atlas URL',
                description: 'MongoDB Atlas connection URL',
                priority: 5,
                requiresEntropyCheck: false
            },
            {
                regex: /redis:\/\/[^\s"'`]{10,}/gi,
                type: 'Redis URL',
                description: 'Redis connection URL',
                priority: 5,
                requiresEntropyCheck: false
            },

            // Cloud and Service-Specific
            {
                regex: /\bprojects\/[^/]+\/(?:secrets|locations\/[^/]+\/secrets)\/[^/\s]+\/versions\/[^/\s]+\b/g,
                type: 'Google Cloud Secret Manager',
                description: 'Google Cloud Secret Manager reference',
                priority: 5,
                requiresEntropyCheck: false
            },
            {
                // Base64: must be 32+ chars, mix of upper+lower+digit or +/= chars
                // Excludes pure hex (caught by Hash patterns) and plain camelCase words
                regex: /\b([A-Za-z0-9+/]{32,}={0,2})\b/g,
                type: 'Base64 Encoded Data',
                description: 'Long base64 encoded string (32+ chars with mixed charset)',
                priority: 1,
                requiresEntropyCheck: true
            }
        ];

        this.excludePattern = `{**/*.git/**,**/.vscode/**,**/node_modules/**,**/build/**,**/dist/**,**/out/**,**/*.log,**/*.tmp,**/*.cache,**/coverage/**}`;
    }

    /**
     * Get all registered patterns
     */
    static getPatterns(): PatternDefinition[] {
        if (this.patterns.length === 0) {
            this.initialize();
        }
        return this.patterns;
    }

    /**
     * Add a custom pattern to the registry
     */
    static addPattern(pattern: PatternDefinition): void {
        this.patterns.push(pattern);
        this.patterns.sort((a, b) => b.priority - a.priority); // Higher priority first
    }

    /**
     * Remove pattern by type
     */
    static removePattern(type: string): void {
        this.patterns = this.patterns.filter(p => p.type !== type);
    }

    /**
     * Get the file exclusion pattern for workspace scanning
     */
    static getExcludePattern(): string {
        if (!this.excludePattern) {
            this.initialize();
        }
        return this.excludePattern;
    }

    /**
     * Check if a file should be scanned based on the exclude pattern
     */
    static shouldScanFile(filePath: string, workspaceRoot: string): boolean {
        // Don't scan files in excluded directories
        const relativePath = filePath.replace(workspaceRoot, '').replace(/^[/\\]/, '');

        // Check against common exclude patterns
        if (relativePath.includes('.git/') ||
            relativePath.includes('node_modules/') ||
            relativePath.includes('.vscode/') ||
            relativePath.includes('build/') ||
            relativePath.includes('dist/') ||
            relativePath.includes('out/') ||
            relativePath.includes('coverage/')) {
            return false;
        }

        // Only scan relevant file types
        const ext = filePath.toLowerCase().substring(filePath.lastIndexOf('.'));
        const allowedExtensions = ['.js', '.ts', '.jsx', '.tsx', '.py', '.java', '.cpp', '.c', '.h', '.hpp', '.cs', '.php', '.rb', '.go', '.rs', '.swift', '.kt', '.scala', '.sh', '.bash', '.zsh', '.fish', '.ps1', '.bat', '.cmd', '.yaml', '.yml', '.json', '.xml', '.env', '.dotenv', '.toml', '.ini', '.cfg', '.conf'];

        return allowedExtensions.includes(ext) || !ext; // Include files without extensions (shell scripts, etc.)
    }

    /**
     * Get patterns by priority level
     */
    static getPatternsByPriority(minPriority = 1): PatternDefinition[] {
        if (this.patterns.length === 0) {
            this.initialize();
        }
        return this.patterns.filter(p => p.priority >= minPriority);
    }

    /**
     * Get patterns for a specific category
     */
    static getPatternsByCategory(category: string): PatternDefinition[] {
        if (this.patterns.length === 0) {
            this.initialize();
        }
        return this.patterns.filter(p => p.type.toLowerCase().includes(category.toLowerCase()));
    }

    /**
     * Reset patterns to default configuration
     */
    static resetToDefaults(): void {
        this.patterns = [];
        this.initialize();
    }
}

// Initialize on module load
PatternRegistry.initialize();

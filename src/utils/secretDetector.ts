import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { DetectedSecret, ScanProgress } from './secretScannerTypes';
import { PatternRegistry } from './patternRegistry';
import { EntropyAnalyzer } from './entropyAnalyzer';
import { ContextEvaluator } from './contextEvaluator';
import { CacheManager } from './cacheManager';
import { llmAnalyzer } from './llmAnalyzer';

export class SecretDetector {
    private static scanProgressCallback?: (progress: ScanProgress) => void;
    private static readonly MAX_WORKERS = 4; // Parallel processing workers
    private static fileWatcher?: vscode.FileSystemWatcher;
    private static debounceTimers = new Map<string, NodeJS.Timeout>();
    private static readonly DEBOUNCE_DELAY = 1000; // 1 second delay for file changes
    private static isFileWatcherActive = false;

    /**
     * Set progress callback for real-time updates
     */
    public static setProgressCallback(callback: (progress: ScanProgress) => void): void {
        this.scanProgressCallback = callback;
    }

    /**
     * Start real-time file monitoring with debounced scanning
     */
    public static startFileWatcher(onSecretsFound?: (secrets: DetectedSecret[]) => void): void {
        if (this.isFileWatcherActive) {
            return; // Already watching
        }

        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders) {
            return;
        }

        // Watch all relevant files that could contain secrets
        this.fileWatcher = vscode.workspace.createFileSystemWatcher(
            PatternRegistry.getExcludePattern().replace('{', '{**/*').replace('}', '}'), // Watch all files except ignored ones
            false, // Don't ignore create events
            false, // Don't ignore change events
            false  // Don't ignore delete events
        );

        this.fileWatcher.onDidChange(async (uri) => {
            if (uri.scheme !== 'file') return;

            const filePath = uri.fsPath;
            if (!PatternRegistry.shouldScanFile(filePath, workspaceFolders[0].uri.fsPath)) {
                return; // Skip files we're not interested in
            }

            this.debounceFileScan(filePath, onSecretsFound);
        });

        this.fileWatcher.onDidCreate(async (uri) => {
            if (uri.scheme !== 'file') return;

            const filePath = uri.fsPath;
            if (!PatternRegistry.shouldScanFile(filePath, workspaceFolders[0].uri.fsPath)) {
                return;
            }

            this.debounceFileScan(filePath, onSecretsFound);
        });

        this.fileWatcher.onDidDelete((uri) => {
            if (uri.scheme !== 'file') return;

            const filePath = uri.fsPath;
            // Clear cache and debounce timer for deleted files
            CacheManager.invalidateFileCache(filePath);
            this.clearDebounceTimer(filePath);

            console.log(`Secret scanning: File deleted - ${path.basename(filePath)}`);
        });

        this.isFileWatcherActive = true;

        console.log('🔍 Real-time secret monitoring started');
    }

    /**
     * Stop file monitoring
     */
    public static stopFileWatcher(): void {
        if (this.fileWatcher) {
            this.fileWatcher.dispose();
            this.fileWatcher = undefined;
        }

        // Clear all debounce timers
        this.debounceTimers.forEach((timer) => clearTimeout(timer));
        this.debounceTimers.clear();

        this.isFileWatcherActive = false;

        console.log('🔍 Real-time secret monitoring stopped');
    }

    /**
     * Check if file watcher is active
     */
    public static isWatching(): boolean {
        return this.isFileWatcherActive;
    }

    /**
     * Debounce file scanning to avoid excessive processing during rapid file changes
     */
    private static debounceFileScan(filePath: string, onSecretsFound?: (secrets: DetectedSecret[]) => void): void {
        // Clear existing timer for this file
        this.clearDebounceTimer(filePath);

        // Set new debounced scan
        const timer = setTimeout(async () => {
            try {
                // Remove from timers map
                this.debounceTimers.delete(filePath);

                console.log(`🔍 Scanning changed file: ${path.basename(filePath)}`);

                // Invalidate cache for this file
                CacheManager.invalidateFileCache(filePath);

                // Scan the file for secrets
                const secrets = await this.scanFile(filePath);

                if (secrets.length > 0) {
                    console.log(`⚠️ Found ${secrets.length} potential secret(s) in ${path.basename(filePath)}`);

                    // Call callback if provided
                    if (onSecretsFound) {
                        onSecretsFound(secrets);
                    } else {
                        // Default: Show warning message
                        vscode.window.showWarningMessage(
                            `⚠️ ${secrets.length} potential secret(s) detected in ${path.basename(filePath)}`,
                            'Review Secrets'
                        ).then(selection => {
                            if (selection === 'Review Secrets') {
                                // Could open a panel or show details
                                console.log('Secrets found:', secrets);
                            }
                        });
                    }
                }
            } catch (error) {
                console.error(`Error scanning file ${filePath}:`, error);
            }
        }, this.DEBOUNCE_DELAY);

        this.debounceTimers.set(filePath, timer);
    }

    /**
     * Clear debounce timer for a specific file
     */
    private static clearDebounceTimer(filePath: string): void {
        const timer = this.debounceTimers.get(filePath);
        if (timer) {
            clearTimeout(timer);
            this.debounceTimers.delete(filePath);
        }
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
            // Find all relevant files
            const files = await vscode.workspace.findFiles(
                '**/*',
                PatternRegistry.getExcludePattern(),
                5000 // Reasonable limit
            );

            for (const fileUri of files) {
                if (fileUri.scheme !== 'file') continue;

                const filePath = fileUri.fsPath;
                if (!PatternRegistry.shouldScanFile(filePath, rootPath)) continue;

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

                for (const pattern of PatternRegistry.getPatterns()) {
                    const matches = [...line.matchAll(new RegExp(pattern.regex.source, pattern.regex.flags))];

                    for (const match of matches) {
                        const secretValue = match[0].trim();
                        if (EntropyAnalyzer.isLikelySecret(secretValue)) {
                            const context = ContextEvaluator.getContextLine(lines, lineIndex, match.index!);
                            const secretScore = ContextEvaluator.calculateSecretScore(secretValue, context);

                            // Extract variable name from context if possible
                            const variableName = this.extractVariableName(context);

                            const baselineConfidence = EntropyAnalyzer.getConfidence(secretValue);
                            const enhancedConfidence = await llmAnalyzer.analyzeSecret(secretValue, context, variableName);

                            const baseSecret: DetectedSecret = {
                                file: vscode.workspace.asRelativePath(filePath),
                                line: lineIndex + 1,
                                column: match.index! + 1,
                                content: secretValue,
                                type: pattern.type,
                                confidence: enhancedConfidence as 'high' | 'medium' | 'low',
                                suggestedEnvVar: '', // Will be set after processing all
                                context: context,
                                riskScore: secretScore.confidence,
                                detectionMethod: secretScore.detectionMethod,
                                reasoning: [...secretScore.reasoning, ...(enhancedConfidence !== baselineConfidence ? ['ML-enhanced confidence'] : [])]
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

        return this.assignUniqueEnvVarNames(secrets);
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
                PatternRegistry.getExcludePattern(),
                5000 // Reasonable limit
            );

            const filesToScan: string[] = [];
            const cachedResults: DetectedSecret[] = [];

            // Separate files that need scanning vs cached files
            for (const fileUri of files) {
                if (fileUri.scheme !== 'file') continue;

                const filePath = fileUri.fsPath;
                if (!PatternRegistry.shouldScanFile(filePath, rootPath)) continue;

                if (CacheManager.shouldRescanFile(filePath)) {
                    filesToScan.push(filePath);
                } else {
                    const cached = CacheManager.getCachedResults(filePath);
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
                CacheManager.cacheResults(filesToScan[index], results);
            });

        } catch (error) {
            console.error('Error in enhanced workspace scan:', error);
        }

        return secrets;
    }

    /**
     * Extract variable name from context (for ML learning)
     */
    private static extractVariableName(context: string): string | undefined {
        // Look for variable assignment patterns
        const patterns = [
            /(?:const|let|var)\s+(\w+)\s*[:=]/,
            /(\w+)\s*[:=]/,
            /(\w+)\s*\.\.\./
        ];

        for (const pattern of patterns) {
            const match = context.match(pattern);
            if (match && match[1] && !match[1].includes('.') && !match[1].includes('"') && !match[1].includes("'")) {
                return match[1];
            }
        }

        return undefined;
    }

    /**
     * Enhanced file scanning with progress tracking
     */
    private static async scanFileEnhanced(filePath: string, index: number, total: number, startTime: number): Promise<DetectedSecret[]> {
        const secrets: DetectedSecret[] = [];
        const scanStartTime = Date.now();

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

                for (const pattern of PatternRegistry.getPatterns()) {
                    const matches = [...line.matchAll(new RegExp(pattern.regex.source, pattern.regex.flags))];

                    for (const match of matches) {
                        const secretValue = match[0].trim();
                        if (EntropyAnalyzer.isLikelySecret(secretValue)) {
                            const context = ContextEvaluator.getContextLine(lines, lineIndex, match.index!);
                            const secretScore = ContextEvaluator.calculateSecretScore(secretValue, context);

                            // Extract variable name from context if possible
                            const variableName = this.extractVariableName(context);

                            const enhancedConfidence = await llmAnalyzer.analyzeSecret(secretValue, context, variableName);

                            const baseSecret: DetectedSecret = {
                                file: vscode.workspace.asRelativePath(filePath),
                                line: lineIndex + 1,
                                column: match.index! + 1,
                                content: secretValue,
                                type: pattern.type,
                                confidence: enhancedConfidence as 'high' | 'medium' | 'low',
                                suggestedEnvVar: '', // Will be set after processing all
                                context: context,
                                riskScore: secretScore.confidence,
                                detectionMethod: secretScore.detectionMethod,
                                reasoning: [...secretScore.reasoning, ...(enhancedConfidence !== EntropyAnalyzer.getConfidence(secretValue) ? ['ML-enhanced confidence'] : [])]
                            };

                            secrets.push(baseSecret);
                        }
                    }
                }
            }

            // Track performance
            const scanTime = Date.now() - scanStartTime;
            CacheManager.recordScanTime(filePath, scanTime);

        } catch (error) {
            console.log(`Skipping file ${filePath}: ${error}`);
        }

        return this.assignUniqueEnvVarNames(secrets);
    }
}

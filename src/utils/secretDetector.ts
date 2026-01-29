import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import * as path from 'path';
import { DetectedSecret, ScanProgress } from './secretScannerTypes';
import { PatternRegistry } from './patternRegistry';
import { EntropyAnalyzer } from './entropyAnalyzer';
import { ContextEvaluator } from './contextEvaluator';
import { CacheManager } from './cacheManager';
import { llmAnalyzer } from './llmAnalyzer';

export class SecretDetector {
    private static scanProgressCallback?: (progress: ScanProgress) => void;
    private static readonly MAX_WORKERS = 4;
    private static fileWatcher?: vscode.FileSystemWatcher;
    private static debounceTimers = new Map<string, NodeJS.Timeout>();
    private static readonly DEBOUNCE_DELAY = 1000;
    private static isFileWatcherActive = false;
    private static activeScanPromises = new Map<string, Promise<void>>();

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
            return;
        }

        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders) {
            return;
        }

        this.fileWatcher = vscode.workspace.createFileSystemWatcher(
            '**/*',
            false,
            false,
            false
        );

        this.fileWatcher.onDidChange(async (uri) => {
            if (uri.scheme !== 'file') return;

            const filePath = uri.fsPath;
            if (!PatternRegistry.shouldScanFile(filePath, workspaceFolders[0].uri.fsPath)) {
                return;
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
            CacheManager.invalidateFileCache(filePath);
            this.clearDebounceTimer(filePath);
            this.activeScanPromises.delete(filePath);

            console.log(`🗑️  File deleted - ${path.basename(filePath)}`);
        });

        this.isFileWatcherActive = true;
        console.log('🔍 Real-time secret monitoring started');
    }

    /**
     * Stop file monitoring
     */
    public static stopFileWatcher(): void {
        try {
            if (this.fileWatcher) {
                this.fileWatcher.dispose();
                this.fileWatcher = undefined;
            }

            this.debounceTimers.forEach((timer) => clearTimeout(timer));
            this.debounceTimers.clear();
            this.activeScanPromises.clear();

            this.isFileWatcherActive = false;
            console.log('🛑 Real-time secret monitoring stopped');
        } catch (error) {
            console.error('Error stopping file watcher:', error);
            this.fileWatcher = undefined;
            this.debounceTimers.clear();
            this.activeScanPromises.clear();
            this.isFileWatcherActive = false;
        }
    }

    /**
     * Check if file watcher is active
     */
    public static isWatching(): boolean {
        return this.isFileWatcherActive;
    }

    /**
     * Debounce file scanning to avoid excessive processing
     */
    private static debounceFileScan(filePath: string, onSecretsFound?: (secrets: DetectedSecret[]) => void): void {
        this.clearDebounceTimer(filePath);

        const timer = setTimeout(async () => {
            try {
                this.debounceTimers.delete(filePath);

                // Check if there's already an active scan for this file
                const activeScan = this.activeScanPromises.get(filePath);
                if (activeScan) {
                    await activeScan;
                    return;
                }

                // Create new scan promise
                const scanPromise = this.performFileScan(filePath, onSecretsFound);
                this.activeScanPromises.set(filePath, scanPromise);

                await scanPromise;
                this.activeScanPromises.delete(filePath);

            } catch (error) {
                console.error(`Error scanning file ${filePath}:`, error);
                this.activeScanPromises.delete(filePath);
            }
        }, this.DEBOUNCE_DELAY);

        this.debounceTimers.set(filePath, timer);
    }

    /**
     * Perform actual file scan
     */
    private static async performFileScan(
        filePath: string,
        onSecretsFound?: (secrets: DetectedSecret[]) => void
    ): Promise<void> {
        console.log(`🔍 Scanning changed file: ${path.basename(filePath)}`);

        CacheManager.invalidateFileCache(filePath);

        const secrets = await this.scanFile(filePath);

        if (secrets.length > 0) {
            console.log(`⚠️  Found ${secrets.length} potential secret(s) in ${path.basename(filePath)}`);

            if (onSecretsFound) {
                onSecretsFound(secrets);
            } else {
                vscode.window.showWarningMessage(
                    `⚠️ ${secrets.length} potential secret(s) detected in ${path.basename(filePath)}`,
                    'Review Secrets'
                ).then(selection => {
                    if (selection === 'Review Secrets') {
                        console.log('Secrets found:', secrets);
                    }
                });
            }
        }
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
            const files = await vscode.workspace.findFiles(
                '**/*',
                PatternRegistry.getExcludePattern(),
                5000
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

        return this.deduplicateSecrets(secrets);
    }

    /**
     * Scan a single file for secrets
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

        for (const pattern of PatternRegistry.getPatterns()) {
            const matches = [...line.matchAll(pattern.regex)];

            for (const match of matches) {
                const matchIndex = match.index ?? 0;
                const secretValue = match[0].trim();
                
                if (EntropyAnalyzer.isLikelySecret(secretValue)) {
                    const context = ContextEvaluator.getContextLine(allLines, lineIndex, matchIndex);
                    const secretScore = ContextEvaluator.calculateSecretScore(secretValue, context);

                    const variableName = this.extractVariableName(context);

                    const baselineConfidence = EntropyAnalyzer.getConfidence(secretValue);
                    let finalConfidence = baselineConfidence;
                    let detectionMethod = secretScore.detectionMethod;
                    const reasoning = [...secretScore.reasoning];

                    // Try LLM analysis
                    if (secretScore.confidence > 0.4) {
                        try {
                            const llmConfidence = await llmAnalyzer.analyzeSecret(secretValue, context, variableName);
                            
                            if (llmConfidence === 'high' || llmConfidence === 'critical') {
                                finalConfidence = 'high';
                                reasoning.push('✓ AI-verified');
                                detectionMethod = 'hybrid';
                            } else if (llmConfidence === 'medium') {
                                finalConfidence = 'medium';
                            } else if (llmConfidence === 'low') {
                                finalConfidence = 'low';
                            }
                        } catch (e) {
                            // Silent fallback
                        }
                    }

                    const baseSecret: DetectedSecret = {
                        file: vscode.workspace.asRelativePath(filePath),
                        line: lineIndex + 1,
                        column: matchIndex + 1,
                        content: this.redactSecret(secretValue),
                        type: pattern.type,
                        confidence: finalConfidence,
                        suggestedEnvVar: '',
                        context: context,
                        riskScore: secretScore.confidence,
                        detectionMethod: detectionMethod,
                        reasoning: reasoning
                    };

                    secrets.push(baseSecret);
                }
            }
        }

        return secrets;
    }

    /**
     * Redact secret value for safety
     */
    private static redactSecret(secret: string): string {
        if (secret.length <= 12) {
            return '****' + secret.slice(-2);
        }
        return secret.slice(0, 4) + '****' + secret.slice(-4);
    }

    /**
     * Deduplicate identical secrets
     */
    private static deduplicateSecrets(secrets: DetectedSecret[]): DetectedSecret[] {
        const seen = new Map<string, DetectedSecret>();

        for (const secret of secrets) {
            const key = `${secret.file}:${secret.line}:${secret.column}:${secret.content}`;
            
            if (!seen.has(key)) {
                seen.set(key, secret);
            } else {
                const existing = seen.get(key);
                if (existing && this.getConfidenceScore(secret.confidence) > this.getConfidenceScore(existing.confidence)) {
                    seen.set(key, secret);
                }
            }
        }

        return Array.from(seen.values());
    }

    /**
     * Convert confidence to numeric score
     */
    private static getConfidenceScore(confidence: 'high' | 'medium' | 'low'): number {
        const scores = { high: 3, medium: 2, low: 1 };
        return scores[confidence];
    }

    /**
     * Generate a unique environment variable name
     */
    private static generateUniqueEnvVar(secrets: DetectedSecret[], currentSecret: DetectedSecret): string {
        const sameFileSecrets = secrets.filter(s =>
            s.file === currentSecret.file &&
            s.type === currentSecret.type &&
            s !== currentSecret
        );

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

        const typeMap: Record<string, string> = {
            'AWS API Key': 'AWS_ACCESS_KEY_ID',
            'Stripe Secret Key': 'STRIPE_SECRET_KEY',
            'Stripe Publishable Key': 'STRIPE_PUBLISHABLE_KEY',
            'OpenAI API Key': 'OPENAI_API_KEY',
            'GitHub Personal Access Token': 'GITHUB_TOKEN',
            'GitHub Fine-grained PAT': 'GITHUB_TOKEN',
            'Slack Bot Token': 'SLACK_BOT_TOKEN',
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

        if (secret.content.startsWith('sk-')) return 'SECRET_KEY';
        if (secret.content.startsWith('pk_')) return 'PUBLIC_KEY';

        const fileName = path.basename(secret.file, path.extname(secret.file));
        const baseName = fileName.toUpperCase().replace(/[^A-Z0-9]/g, '_');
        
        return `${baseName}_SECRET`;
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

        if (progressCallback) {
            this.setProgressCallback(progressCallback);
        }

        try {
            const files = await vscode.workspace.findFiles(
                '**/*',
                PatternRegistry.getExcludePattern(),
                5000
            );

            const filesToScan: string[] = [];
            const cachedResults: DetectedSecret[] = [];

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
                CacheManager.cacheResults(filesToScan[i], scanResults[i]);
            }

        } catch (error) {
            console.error('Error in enhanced workspace scan:', error);
        }

        return this.deduplicateSecrets(secrets);
    }

    /**
     * Extract variable name from context
     */
    private static extractVariableName(context: string): string | undefined {
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
                if (line.length > 500) continue;

                const lineSecrets = await this.scanLine(line, lineIndex, lines, filePath);
                secrets.push(...lineSecrets);
            }

            const scanTime = Date.now() - scanStartTime;
            CacheManager.recordScanTime(filePath, scanTime);

        } catch (error) {
            console.log(`Skipping file ${filePath}: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }

        return this.assignUniqueEnvVarNames(secrets);
    }

    /**
     * Clean up resources on disposal
     */
    public static dispose(): void {
        this.stopFileWatcher();
    }
}
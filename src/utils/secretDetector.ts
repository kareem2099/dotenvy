import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as crypto from 'crypto';
import { DetectedSecret, ScanProgress } from './secretScannerTypes';
import { PatternRegistry } from './patternRegistry';
import { EntropyAnalyzer } from './entropyAnalyzer';
import { ContextEvaluator } from './contextEvaluator';
import { CacheManager } from './cacheManager';
import { FeedbackManager } from './feedbackManager';
import { DotenvyIgnore } from './dotenvyIgnore';
import { logger } from './logger';
import { t } from '../i18n';
import { indexModuleSpecifiers, isModuleSpecifierFinding, ModuleSpecifierSpan } from './moduleSpecifierContext';
import { isBase64Candidate } from './base64Candidate';

export class SecretDetector {
    private static scanProgressCallback?: (progress: ScanProgress) => void;
    private static readonly MAX_WORKERS = 4;
    private static lastScanYield = 0;
    private static readonly SCAN_SLICE_MS = 8;
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

    /** Apply the same exclusions to workspace scans and file watcher events. */
    private static shouldScanUri(uri: vscode.Uri): boolean {
        if (uri.scheme !== 'file') { return false; }
        const folder = vscode.workspace.getWorkspaceFolder(uri);
        if (!folder) { return false; }
        const root = folder.uri.fsPath;
        return PatternRegistry.shouldScanFile(uri.fsPath, root) && !DotenvyIgnore.shouldIgnore(uri.fsPath, root);
    }

    /**
     * Start real-time file monitoring with debounced scanning
     */
    public static startFileWatcher(onSecretsFound?: (secrets: DetectedSecret[]) => void): void {
        if (this.isFileWatcherActive) {
            return;
        }

        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders?.length) {
            return;
        }

        this.fileWatcher = vscode.workspace.createFileSystemWatcher(
            '**/*',
            false,
            false,
            false
        );

        this.fileWatcher.onDidChange(async (uri) => {
            const filePath = uri.fsPath;
            if (!this.shouldScanUri(uri)) {
                return;
            }

            this.debounceFileScan(filePath, onSecretsFound);
        });

        this.fileWatcher.onDidCreate(async (uri) => {
            const filePath = uri.fsPath;
            if (!this.shouldScanUri(uri)) {
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

            logger.info(`🗑️  File deleted - ${path.basename(filePath)}`, 'SecretDetector');
        });

        this.isFileWatcherActive = true;
        logger.info('🔍 Real-time secret monitoring started', 'SecretDetector');
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
            logger.info('🛑 Real-time secret monitoring stopped', 'SecretDetector');
        } catch (error) {
            logger.error('Error stopping file watcher:', error, 'SecretDetector');
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
                logger.error(`Error scanning file ${filePath}:`, error, 'SecretDetector');
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
        logger.info(`🔍 Scanning changed file: ${path.basename(filePath)}`, 'SecretDetector');

        CacheManager.invalidateFileCache(filePath);

        const secrets = await this.scanFile(filePath);

        if (secrets.length > 0) {
            logger.info(`⚠️  Found ${secrets.length} potential secret(s) in ${path.basename(filePath)}`, 'SecretDetector');

            if (onSecretsFound) {
                onSecretsFound(secrets);
            } else {
                // Keep the label stable if the user changes language while the notification is open.
                const reviewLabel = t('secretDetector.review');
                void Promise.resolve(vscode.window.showWarningMessage(
                    t('secretDetector.foundInFile', { count: secrets.length, fileName: path.basename(filePath) }),
                    reviewLabel
                )).then(async selection => {
                    if (selection !== reviewLabel) { return; }
                    const extension = vscode.extensions.getExtension('FreeRave.dotenvy');
                    if (!extension) { throw new Error(t('extension.error.noExtensionUri')); }
                    const { SecretsPanel } = await import('../providers/SecretsPanel');
                    SecretsPanel.show(secrets, extension.extensionUri);
                }).catch(error => {
                    logger.error('Failed to open detected secrets', error, 'SecretDetector');
                    void vscode.window.showErrorMessage(t('secretDetector.reviewFailed', {
                        message: error instanceof Error ? error.message : String(error)
                    }));
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

        if (!workspaceFolders?.length) {
            vscode.window.showInformationMessage(t('secretDetector.noWorkspace'));
            return secrets;
        }

        try {
            const files = await vscode.workspace.findFiles(
                '**/*',
                PatternRegistry.getExcludePattern(),
                5000
            );

            for (const fileUri of files) {
                if (!this.shouldScanUri(fileUri)) continue;
                const filePath = fileUri.fsPath;

                const fileSecrets = await this.scanFile(filePath);
                secrets.push(...fileSecrets);
            }

        } catch (error) {
            logger.error('Error scanning workspace:', error, 'SecretDetector');
        }

        return this.deduplicateSecrets(secrets);
    }

    /**
     * Scan a single file for secrets
     */
    public static async scanFile(filePath: string): Promise<DetectedSecret[]> {
        try {
            const content = await fs.readFile(filePath, 'utf8');
            return await this.scanText(filePath, content);
        } catch (error) {
            logger.info(`Skipping file ${filePath}: ${error instanceof Error ? error.message : 'Unknown error'}`, 'SecretDetector');
            return [];
        }
    }

    /** Scan an editor snapshot with the same model and corrections as saved files. */
    public static async scanText(filePath: string, content: string): Promise<DetectedSecret[]> {
        const secrets: DetectedSecret[] = [];
        const lines = content.split('\n');
        const modules = indexModuleSpecifiers(content);
        for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
            if (lines[lineIndex].length > 500) continue;
            secrets.push(...await this.scanLine(lines[lineIndex], lineIndex, lines, filePath, modules.get(lineIndex) ?? []));
        }
        return this.assignUniqueEnvVarNames(this.deduplicateSecrets(secrets));
    }

    /**
     * Scan a single line for secrets
     */
    private static async scanLine(
        line: string,
        lineIndex: number,
        allLines: string[],
        filePath: string,
        moduleSpecifiers?: readonly ModuleSpecifierSpan[]
    ): Promise<DetectedSecret[]> {
        const secrets: DetectedSecret[] = [];
        const modules = moduleSpecifiers ?? indexModuleSpecifiers(allLines.join('\n')).get(lineIndex) ?? [];

        // Most lines have no model call: awaiting scanLine alone only drains
        // microtasks and can starve clicks/timers throughout a large scan.
        if (Date.now() - this.lastScanYield >= this.SCAN_SLICE_MS) {
            await new Promise<void>(resolve => setImmediate(resolve));
            this.lastScanYield = Date.now();
        }

        for (const pattern of PatternRegistry.getPatterns()) {
            const matches = [...line.matchAll(pattern.regex)];

            for (const match of matches) {
                let matchIndex = (match.index ?? 0) + match[0].length - match[0].trimStart().length;
                let secretValue = match[0].trim();
                const isBase64 = pattern.type === 'Base64 Encoded Data';
                if (isBase64 && !isBase64Candidate(line, matchIndex, secretValue)) continue;
                // Assignment patterns include the variable name and quotes in match[0].
                const assignment = secretValue.match(/^[A-Za-z_]\w*\s*[:=]\s*(["'`])([\s\S]+)\1$/);
                if (assignment) {
                    matchIndex += secretValue.indexOf(assignment[1]) + 1;
                    secretValue = assignment[2];
                }
                // Different patterns can match fragments of one quoted value.
                // Classify and remember the complete literal consistently.
                // Base64 values may be credentials inside URL parameters. Keep
                // their exact spans instead of promoting a fragment to the URL.
                for (const literal of isBase64 ? [] : line.matchAll(/(["'`])([^"'`\n]*)\1/g)) {
                    const start = (literal.index ?? 0) + 1;
                    if (start <= matchIndex && start + literal[2].length >= matchIndex + secretValue.length) {
                        matchIndex = start;
                        secretValue = literal[2];
                        break;
                    }
                }
                
                if (isModuleSpecifierFinding(pattern.type, matchIndex, secretValue.length, modules)) continue;

                if (EntropyAnalyzer.isLikelySecret(secretValue)) {
                    const originalContext = ContextEvaluator.getContextLine(allLines, lineIndex, matchIndex);
                    const context = originalContext.split(secretValue).join('[REDACTED]')
                        .replace(/(["'`])[^"'`\n]*\1/g, '"[REDACTED]"');
                    const secretScore = ContextEvaluator.calculateSecretScore(secretValue, context);

                    const variableName = this.extractVariableName(context);
                    const valueDigest = crypto.createHash('sha256').update(secretValue).digest('hex');
                    const correction = FeedbackManager.decision(filePath, variableName, valueDigest);
                    if (correction === 'false_positive') { continue; }

                    const baselineConfidence = EntropyAnalyzer.getConfidence(secretValue);
                    let finalConfidence = baselineConfidence;
                    const detectionMethod = secretScore.detectionMethod;
                    let analysisSource: DetectedSecret['analysisSource'];
                    const reasoning = [...secretScore.reasoning];

                    if (correction === 'high') {
                        finalConfidence = 'high';
                        analysisSource = 'user-confirmed';
                        reasoning.push('Confirmed locally by you');
                    } else if (secretScore.confidence > 0.4) {
                        finalConfidence = this.ruleConfidence(secretValue, context, variableName);
                        analysisSource = 'heuristics';
                        reasoning.push(t('secretsScanner.rulesAssessment'));
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
                        analysisSource,
                        reasoning,
                        sourceFile: filePath,
                        valueLength: secretValue.length,
                        variableName,
                        valueDigest
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
    /** Known credential formats, risky surrounding code and risky names raise entropy-based suspicion. */
    private static ruleConfidence(secretValue: string, context: string, variableName?: string): 'high' | 'medium' | 'low' {
        const entropy = EntropyAnalyzer.calculateEntropy(secretValue.trim());
        const knownFormat = this.KNOWN_FORMATS.some(format => format.test(secretValue.trim()));
        const ctx = context.toLowerCase(), name = (variableName ?? '').toLowerCase();
        const risky = this.RISKY_CONTEXT.some(word => ctx.includes(word)) || this.RISKY_NAMES.some(word => name.includes(word));
        if (knownFormat && entropy > 4) { return 'high'; }
        if (entropy > 4.5 && risky) { return 'high'; }
        if (entropy > 3.8 && risky) { return 'medium'; }
        return entropy > 3.5 ? 'medium' : 'low';
    }

    private static readonly KNOWN_FORMATS = [
        /^sk-[a-zA-Z0-9]{20,}/, /^AKIA[A-Z0-9]{16}/, /^gh[po]_[a-zA-Z0-9]{36}/, /^xox[baprs]-[a-zA-Z0-9-]+/,
        /^SG\.[a-zA-Z0-9\-_]{22,}/, /^AIza[0-9A-Za-z\-_]{35}/, /^eyJ[a-zA-Z0-9\-_]+\.[a-zA-Z0-9\-_]+\.[a-zA-Z0-9\-_]+$/,
        /^-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY/m, /(mysql|postgresql|mongodb|redis|amqp):\/\/\S+:\S+@/,
    ];
    private static readonly RISKY_CONTEXT = ['password', 'secret', 'private_key', 'api_key', 'apikey',
        'auth_token', 'access_token', 'client_secret', 'credentials'];
    private static readonly RISKY_NAMES = ['secret', 'key', 'token', 'password', 'pwd', 'pass'];

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

        if (!workspaceFolders?.length) {
            vscode.window.showInformationMessage(t('secretDetector.noWorkspace'));
            return secrets;
        }

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
                if (!this.shouldScanUri(fileUri)) continue;
                const filePath = fileUri.fsPath;

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

            // Bound file reads and inference queues instead of starting up to
            // 5,000 scans concurrently. Keep result order aligned with caching.
            const scanResults: DetectedSecret[][] = new Array(filesToScan.length);
            let nextFile = 0;
            await Promise.all(Array.from({ length: Math.min(this.MAX_WORKERS, filesToScan.length) }, async () => {
                while (nextFile < filesToScan.length) {
                    const index = nextFile++;
                    scanResults[index] = await this.scanFileEnhanced(filesToScan[index], index, filesToScan.length, startTime);
                }
            }));

            for (const results of scanResults) {
                secrets.push(...results);
            }
            secrets.push(...cachedResults);

            for (let i = 0; i < scanResults.length; i++) {
                CacheManager.cacheResults(filesToScan[i], scanResults[i]);
            }

        } catch (error) {
            logger.error('Error in enhanced workspace scan:', error, 'SecretDetector');
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
            const modules = indexModuleSpecifiers(content);

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

                const lineSecrets = await this.scanLine(line, lineIndex, lines, filePath, modules.get(lineIndex) ?? []);
                secrets.push(...lineSecrets);
            }

            const scanTime = Date.now() - scanStartTime;
            CacheManager.recordScanTime(filePath, scanTime);

        } catch (error) {
            logger.info(`Skipping file ${filePath}: ${error instanceof Error ? error.message : 'Unknown error'}`, 'SecretDetector');
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

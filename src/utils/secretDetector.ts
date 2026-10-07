import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import * as path from 'path';
import { DetectedSecret, ScanProgress } from './secretScannerTypes';
import { PatternRegistry } from './patternRegistry';
import { EntropyAnalyzer } from './entropyAnalyzer';
import { ContextEvaluator } from './contextEvaluator';
import { CacheManager } from './cacheManager';
import { LLMAnalyzer } from './llmAnalyzer';
import { DotenvyIgnore } from './dotenvyIgnore';
import { logger } from './logger';
import { isSecretFileWatcherActive, startSecretFileWatcher, stopSecretFileWatcher } from './secretFileWatcher';
import { assignUniqueEnvVarNames, extractVariableName } from './secretEnvNames';
import { t } from '../i18n';

export class SecretDetector {
    private static scanProgressCallback?: (progress: ScanProgress) => void;
    private static readonly MAX_WORKERS = 4;

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
        startSecretFileWatcher(onSecretsFound);
    }

    /**
     * Stop file monitoring
     */
    public static stopFileWatcher(): void {
        stopSecretFileWatcher();
    }

    /**
     * Check if file watcher is active
     */
    public static isWatching(): boolean {
        return isSecretFileWatcherActive();
    }

    /**
     * Scan workspace files for potential secrets
     */
    public static async scanWorkspace(): Promise<DetectedSecret[]> {
        const secrets: DetectedSecret[] = [];
        const workspaceFolders = vscode.workspace.workspaceFolders;

        if (!workspaceFolders) {
            vscode.window.showInformationMessage(t('secretDetector.noWorkspace'));
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

                if (DotenvyIgnore.shouldIgnore(filePath, rootPath)) continue;

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
            logger.info(`Skipping file ${filePath}: ${error instanceof Error ? error.message : 'Unknown error'}`, 'SecretDetector');
        }

        return assignUniqueEnvVarNames(secrets);
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

                    const variableName = extractVariableName(context);

                    const baselineConfidence = EntropyAnalyzer.getConfidence(secretValue);
                    let finalConfidence = baselineConfidence;
                    let detectionMethod = secretScore.detectionMethod;
                    const reasoning = [...secretScore.reasoning];

                    // Try LLM analysis
                    if (secretScore.confidence > 0.4) {
                        try {
                            const llmConfidence = await LLMAnalyzer.getInstance().analyzeSecret(secretValue, context, variableName);
                            
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
     * Enhanced workspace scanning with performance optimizations
     */
    public static async scanWorkspaceEnhanced(progressCallback?: (progress: ScanProgress) => void): Promise<DetectedSecret[]> {
        const secrets: DetectedSecret[] = [];
        const workspaceFolders = vscode.workspace.workspaceFolders;

        if (!workspaceFolders) {
            vscode.window.showInformationMessage(t('secretDetector.noWorkspace'));
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

                if (DotenvyIgnore.shouldIgnore(filePath, rootPath)) continue;

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
            logger.error('Error in enhanced workspace scan:', error, 'SecretDetector');
        }

        return this.deduplicateSecrets(secrets);
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
            logger.info(`Skipping file ${filePath}: ${error instanceof Error ? error.message : 'Unknown error'}`, 'SecretDetector');
        }

        return assignUniqueEnvVarNames(secrets);
    }

    /**
     * Clean up resources on disposal
     */
    public static dispose(): void {
        this.stopFileWatcher();
    }
}
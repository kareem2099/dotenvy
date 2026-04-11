import * as vscode from 'vscode';
import { HistoryManager } from '../utils/historyManager';
import { WorkspaceManager } from './workspaceManager';
import { HistoryAnalytics } from '../utils/historyAnalytics';
import { HistoryFilterOptions } from '../utils/historyFilters';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { logger } from '../utils/logger';
import { loadWebviewHtml } from '../utils/webviewUtils';

export class HistoryWebviewProvider {
    public static readonly viewType = 'dotenvy.historyViewer';
    private static _panel?: vscode.WebviewPanel;
    private static _context?: vscode.ExtensionContext;
    private static _extensionUri?: vscode.Uri;

    /** Call once on activate to store context & uri */
    public static init(extensionUri: vscode.Uri, context: vscode.ExtensionContext) {
        HistoryWebviewProvider._extensionUri = extensionUri;
        HistoryWebviewProvider._context = context;
    }

    /** Open (or reveal) the History webview panel */
    public static async openOrReveal(): Promise<void> {
        const context      = HistoryWebviewProvider._context;
        const extensionUri = HistoryWebviewProvider._extensionUri;

        if (!context || !extensionUri) {
            vscode.window.showErrorMessage('History Manager not initialized.');
            return;
        }

        if (HistoryWebviewProvider._panel) {
            HistoryWebviewProvider._panel.reveal(vscode.ViewColumn.One);
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            HistoryWebviewProvider.viewType,
            'Environment History',
            vscode.ViewColumn.One,
            {
                enableScripts: true,
                localResourceRoots: [extensionUri],
                retainContextWhenHidden: true,
            }
        );

        HistoryWebviewProvider._panel = panel;
        panel.webview.html = HistoryWebviewProvider._getHtml(panel.webview, extensionUri);

        // Handle messages from the webview
        panel.webview.onDidReceiveMessage(async (message) => {
            await HistoryWebviewProvider._handleMessage(message);
        }, undefined, context.subscriptions);

        // When the panel is closed, clean up
        panel.onDidDispose(() => {
            HistoryWebviewProvider._panel = undefined;
        }, null, context.subscriptions);

        // Load initial history
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (workspaceFolders && workspaceFolders.length > 0) {
            await HistoryWebviewProvider.loadHistory(workspaceFolders[0].uri.fsPath);
        }
    }

    // ─── Public data methods ────────────────────────────────────────────────────

    public static async loadHistory(workspacePath: string): Promise<void> {
        try {
            const history = await HistoryManager.getHistory(workspacePath, 100);
            const stats = await HistoryManager.getStats(workspacePath);

            HistoryWebviewProvider._post({
                type: 'historyLoaded',
                history,
                stats,
                workspacePath
            });
        } catch (error) {
            logger.error('Failed to load history:', error, 'HistoryWebviewProvider');
            HistoryWebviewProvider._post({
                type: 'error',
                message: `Failed to load history: ${(error as Error).message}`
            });
        }
    }

    public static async loadAnalytics(workspacePath: string): Promise<void> {
        try {
            const historyData = await HistoryManager.getHistory(workspacePath, 1000);
            const analytics = await HistoryAnalytics.generateAnalytics(historyData);

            const topEnvironments = HistoryAnalytics.getTopEnvironments(analytics, 5);
            const peakHours = HistoryAnalytics.getPeakHours(analytics);
            const mostChangedVariables = HistoryAnalytics.getMostChangedVariables(analytics, 10);

            const enhancedAnalytics = {
                ...analytics,
                quickInsights: {
                    topEnvironments,
                    peakHours: peakHours.slice(0, 3),
                    mostChangedVariables: mostChangedVariables.slice(0, 5),
                    totalUniqueVariables: Object.keys(analytics.variableAnalytics.changeFrequency).length,
                    activityScore: HistoryWebviewProvider._calcActivityScore(analytics)
                }
            };

            HistoryWebviewProvider._post({
                type: 'analyticsLoaded',
                analytics: enhancedAnalytics,
                workspacePath
            });
        } catch (error) {
            logger.error('Failed to load analytics:', error, 'HistoryWebviewProvider');
            HistoryWebviewProvider._post({
                type: 'error',
                message: `Failed to load analytics: ${(error as Error).message}`
            });
        }
    }

    public static async applyFilters(workspacePath: string, filters: HistoryFilterOptions): Promise<void> {
        try {
            const result = await HistoryManager.applyFilters(workspacePath, filters);
            HistoryWebviewProvider._post({ type: 'filtersApplied', result, workspacePath });
        } catch (error) {
            logger.error('Failed to apply filters:', error, 'HistoryWebviewProvider');
            HistoryWebviewProvider._post({ type: 'error', message: `Failed to apply filters: ${(error as Error).message}` });
        }
    }

    public static async getFilterOptions(workspacePath: string): Promise<void> {
        try {
            const options = await HistoryManager.getFilterOptions(workspacePath);
            HistoryWebviewProvider._post({ type: 'filterOptionsLoaded', options, workspacePath });
        } catch (error) {
            logger.error('Failed to get filter options:', error, 'HistoryWebviewProvider');
            HistoryWebviewProvider._post({ type: 'error', message: `Failed to get filter options: ${(error as Error).message}` });
        }
    }

    public static async getVariableHistory(workspacePath: string, variableName: string): Promise<void> {
        try {
            const history = await HistoryManager.getVariableHistory(workspacePath, variableName);
            HistoryWebviewProvider._post({ type: 'variableHistoryLoaded', variableName, history, workspacePath });
        } catch (error) {
            logger.error('Failed to get variable history:', error, 'HistoryWebviewProvider');
            HistoryWebviewProvider._post({ type: 'error', message: `Failed to get variable history: ${(error as Error).message}` });
        }
    }

    public static validateRegex(pattern: string): void {
        const result = HistoryManager.validateRegex(pattern);
        HistoryWebviewProvider._post({ type: 'regexValidated', pattern, valid: result.valid, error: result.error });
    }

    // ─── Private helpers ────────────────────────────────────────────────────────

    private static _post(message: object): void {
        HistoryWebviewProvider._panel?.webview.postMessage(message);
    }

    private static async _handleMessage(message: { 
        type: string; 
        workspacePath: string; 
        entryId: string; 
        variableName: string;
        filters: HistoryFilterOptions;
        pattern: string;
        timestamp: string;
        environmentName: string;
        reason?: string;
    }): Promise<void> {
        switch (message.type) {
            case 'refresh': {
                const workspaceFolders = vscode.workspace.workspaceFolders;
                if (workspaceFolders && workspaceFolders.length > 0) {
                    await HistoryWebviewProvider.loadHistory(workspaceFolders[0].uri.fsPath);
                    await HistoryWebviewProvider.loadAnalytics(workspaceFolders[0].uri.fsPath);
                }
                break;
            }
            case 'loadHistory':
                await HistoryWebviewProvider.loadHistory(message.workspacePath);
                break;
            case 'loadAnalytics':
                await HistoryWebviewProvider.loadAnalytics(message.workspacePath);
                break;
            case 'viewEntry':
                await HistoryWebviewProvider._viewEntry(message.entryId, message.workspacePath);
                break;
            case 'rollback':
                await HistoryWebviewProvider._rollbackToEntry(message.entryId, message.workspacePath, message.reason);
                break;
            case 'diff':
                await HistoryWebviewProvider._showDiff(message.entryId, message.workspacePath);
                break;
            case 'applyFilters':
                await HistoryWebviewProvider.applyFilters(message.workspacePath, message.filters);
                break;
            case 'getFilterOptions':
                await HistoryWebviewProvider.getFilterOptions(message.workspacePath);
                break;
            case 'getVariableHistory':
                await HistoryWebviewProvider.getVariableHistory(message.workspacePath, message.variableName);
                break;
            case 'validateRegex':
                HistoryWebviewProvider.validateRegex(message.pattern);
                break;
            case 'openTimeline':
                await vscode.commands.executeCommand('dotenvy.openTimelinePanel');
                break;
            case 'copyContent':
                await HistoryWebviewProvider._copyContent(message.entryId, message.workspacePath);
                break;
            case 'confirmRollback':
                await HistoryWebviewProvider._confirmRollback(
                    message.entryId, message.workspacePath, message.timestamp, message.environmentName
                );
                break;
        }
    }

    private static async _viewEntry(entryId: string, workspacePath: string): Promise<void> {
        try {
            const entry = await HistoryManager.getEntry(workspacePath, entryId);
            if (entry) {
                HistoryWebviewProvider._post({ type: 'entryContent', entry });
            } else {
                HistoryWebviewProvider._post({ type: 'error', message: 'Entry not found' });
            }
        } catch (error) {
            logger.error('Failed to load entry:', error, 'HistoryWebviewProvider');
            HistoryWebviewProvider._post({ type: 'error', message: `Failed to load entry: ${(error as Error).message}` });
        }
    }

    private static async _rollbackToEntry(entryId: string, workspacePath: string, reason?: string): Promise<void> {
        try {
            const success = await HistoryManager.rollbackToEntry(workspacePath, entryId, reason);
            HistoryWebviewProvider._post({ type: 'rollbackResult', success, entryId });

            await HistoryWebviewProvider.loadHistory(workspacePath);

            const workspaceManager = WorkspaceManager.getInstance();
            const workspaceData = workspaceManager.getAllWorkspaces().find(
                ws => ws.workspace.uri.fsPath === workspacePath
            );
            if (workspaceData?.statusBarProvider) {
                workspaceData.statusBarProvider.forceRefresh();
            }
        } catch (error) {
            logger.error('Failed to rollback:', error, 'HistoryWebviewProvider');
            HistoryWebviewProvider._post({ type: 'error', message: `Rollback failed: ${(error as Error).message}` });
        }
    }

    private static async _showDiff(entryId: string, workspacePath: string): Promise<void> {
        try {
            const allEntries = await HistoryManager.getHistory(workspacePath);
            const entryIndex = allEntries.findIndex(e => e.id === entryId);
            if (entryIndex === -1) { return; }

            const entry = allEntries[entryIndex];

            // Find the version before this one for the same environment
            const envEntries = allEntries.filter(e => e.environmentName === entry.environmentName);
            const envIndex = envEntries.findIndex(e => e.id === entryId);
            const previousEntry = envEntries[envIndex + 1]; // Next in list is older

            const tempDir = os.tmpdir();
            let leftFile: string;
            let rightFile: string;
            let label: string;

            if (previousEntry) {
                // Scenario: View changes made IN this history entry
                const leftPath = path.join(tempDir, `dotenvy-prev-${entry.id}.env`);
                const rightPath = path.join(tempDir, `dotenvy-curr-${entry.id}.env`);

                fs.writeFileSync(leftPath, previousEntry.fileContent, 'utf8');
                fs.writeFileSync(rightPath, entry.fileContent, 'utf8');

                leftFile = leftPath;
                rightFile = rightPath;
                label = `History: ${entry.environmentName} (Changes at ${new Date(entry.timestamp).toLocaleString()})`;
            } else {
                // Fallback: Scenario: View changes between this entry and Current file
                const leftPath = path.join(tempDir, `dotenvy-snap-${entry.id}.env`);
                fs.writeFileSync(leftPath, entry.fileContent, 'utf8');

                const envFileName = entry.fileName || (entry.environmentName === 'local' ? '.env' : `.env.${entry.environmentName}`);
                const currentEnvPath = path.join(workspacePath, envFileName);

                leftFile = leftPath;
                rightFile = currentEnvPath;
                label = `History: ${entry.environmentName} (${new Date(entry.timestamp).toLocaleString()}) ↔ Current`;
            }

            await vscode.commands.executeCommand('vscode.diff', vscode.Uri.file(leftFile), vscode.Uri.file(rightFile), label, {
                preview: true,
            });

            // Clean up temp files after a short delay (diff editor may still be reading it)
            setTimeout(() => {
                try { if (leftFile.startsWith(tempDir)) fs.unlinkSync(leftFile); } catch { /* ignore */ }
                try { if (rightFile.startsWith(tempDir)) fs.unlinkSync(rightFile); } catch { /* ignore */ }
            }, 60_000);
        } catch (error) {
            logger.error('Failed to open diff:', error, 'HistoryWebviewProvider');
            vscode.window.showErrorMessage(`Failed to open diff: ${(error as Error).message}`);
        }
    }

    private static async _copyContent(entryId: string, workspacePath: string): Promise<void> {
        try {
            const entry = await HistoryManager.getEntry(workspacePath, entryId);
            if (entry) {
                await vscode.env.clipboard.writeText(entry.fileContent);
                vscode.window.showInformationMessage('Environment content copied to clipboard');
            }
        } catch (error) {
            logger.error('Failed to copy content:', error, 'HistoryWebviewProvider');
            vscode.window.showErrorMessage('Failed to copy environment content to clipboard');
        }
    }

    private static async _confirmRollback(
        entryId: string, workspacePath: string, timestamp: string, environmentName: string
    ): Promise<void> {
        try {
            const timestampDate = new Date(timestamp);
            const message = `Are you sure you want to rollback to the environment state from ${timestampDate.toLocaleString()}?\n\nThis will replace your current .env file with the historical version for environment "${environmentName}".`;

            const result = await vscode.window.showWarningMessage(
                message, { modal: true }, 'Rollback', 'Cancel'
            );

            if (result === 'Rollback') {
                const reason = await vscode.window.showInputBox({
                    prompt: 'Optional: Enter a reason for this rollback',
                    placeHolder: 'e.g., Reverting to stable configuration'
                });
                await HistoryWebviewProvider._rollbackToEntry(entryId, workspacePath, reason);
            }
        } catch (error) {
            logger.error('Failed to confirm rollback:', error, 'HistoryWebviewProvider');
            vscode.window.showErrorMessage('Failed to process rollback confirmation');
        }
    }

    private static _calcActivityScore(analytics: import('../utils/historyAnalytics').AnalyticsSummary): number {
        const entryScore = Math.min(analytics.dataRange.totalEntries / 10, 100);
        const stabilityScores = Object.values(analytics.stabilityMetrics.stabilityScore);
        const averageStability = stabilityScores.length > 0
            ? stabilityScores.reduce((sum, score) => sum + score, 0) / stabilityScores.length
            : 50;
        const variableFrequency = Object.values(analytics.variableAnalytics.changeFrequency);
        const totalChanges = variableFrequency.reduce((sum, freq) => sum + freq, 0);
        const frequencyScore = Math.min(totalChanges / 5, 100);
        return Math.round((entryScore * 0.4) + (averageStability * 0.3) + (frequencyScore * 0.3));
    }

    private static _getHtml(webview: vscode.Webview, extensionUri: vscode.Uri): string {
        return loadWebviewHtml({
            webview,
            extensionUri,
            templatePath: ['resources', 'panel', 'history-viewer.html'],
            tokens: {
                styleUri:  webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'resources', 'panel', 'panel.css')).toString(),
                scriptUri: webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'resources', 'panel', 'history-viewer.js')).toString(),
            },
        });
    }
}


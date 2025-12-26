import * as vscode from 'vscode';
import { HistoryManager } from '../utils/historyManager';
import { HistoryEntry, HistoryStats } from '../types/environment';
import { EnvironmentDiffer } from '../utils/environmentDiffer';
import { WorkspaceManager } from './workspaceManager';
import { HistoryAnalytics } from '../utils/historyAnalytics';
import { HistoryFilterOptions } from '../utils/historyFilters';
import * as fs from 'fs';
import * as os from 'os';

interface CachedHistoryData {
    history: HistoryEntry[];
    stats: HistoryStats;
}

export class HistoryWebviewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'dotenvy.historyViewer';
    private _view?: vscode.WebviewView;
    private cachedHistory: HistoryEntry[] | null = null;
    private cachedStats: import('../types/environment').HistoryStats | null = null;
    private cachedWorkspacePath: string | null = null;

    constructor(private readonly _extensionUri: vscode.Uri, private readonly _context: vscode.ExtensionContext) {}

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        context: vscode.WebviewViewResolveContext,
        token: vscode.CancellationToken,
    ) {
        this._view = webviewView;

        // Store context for state persistence
        this._context.globalState.update('history-webview-context', {
            lastResolveTime: Date.now()
        });

        // Handle cancellation token
        token.onCancellationRequested(() => {
            console.log('History webview resolution cancelled');
        });

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this._extensionUri]
        };

        webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

        // Handle messages from the webview
        const messageDisposable = webviewView.webview.onDidReceiveMessage(async (message) => {
            switch (message.type) {
                case 'refresh':
                    const workspaceFolders = vscode.workspace.workspaceFolders;
                    if (workspaceFolders && workspaceFolders.length > 0) {
                        await this.loadHistory(workspaceFolders[0].uri.fsPath);
                        await this.loadAnalytics(workspaceFolders[0].uri.fsPath);
                    }
                    break;
                case 'loadHistory':
                    await this.loadHistory(message.workspacePath);
                    break;
                case 'loadAnalytics':
                    await this.loadAnalytics(message.workspacePath);
                    break;
                case 'viewEntry':
                    await this.viewEntry(message.entryId, message.workspacePath);
                    break;
                case 'rollback':
                    await this.rollbackToEntry(message.entryId, message.workspacePath, message.reason);
                    break;
                case 'diff':
                    await this.showDiff(message.entryId, message.workspacePath);
                    break;
                case 'applyFilters':
                    await this.applyFilters(message.workspacePath, message.filters);
                    break;
                case 'getFilterOptions':
                    await this.getFilterOptions(message.workspacePath);
                    break;
                case 'getVariableHistory':
                    await this.getVariableHistory(message.workspacePath, message.variableName);
                    break;
                case 'validateRegex':
                    this.validateRegex(message.pattern);
                    break;
                case 'copyContent':
                    await this.copyContent(message.entryId, message.workspacePath);
                    break;
                case 'confirmRollback':
                    await this.confirmRollback(message.entryId, message.workspacePath, message.timestamp, message.environmentName);
                    break;
            }
        });

        // Handle visibility changes
        const visibilityDisposable = webviewView.onDidChangeVisibility(() => {
            if (webviewView.visible) {
                const workspaceFolders = vscode.workspace.workspaceFolders;
                if (workspaceFolders && workspaceFolders.length > 0) {
                    this.loadHistory(workspaceFolders[0].uri.fsPath);
                }
            }
        });

        this._context.subscriptions.push(messageDisposable, visibilityDisposable);

        // Load initial history if workspace is available
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (workspaceFolders && workspaceFolders.length > 0) {
            const workspacePath = workspaceFolders[0].uri.fsPath;

            // Try to load from persistent cache first
            const cacheKey = `history-cache-${workspacePath}`;
            const cachedData = this._context.globalState.get(cacheKey) as CachedHistoryData;

            if (cachedData && cachedData.history && cachedData.stats) {
                this.cachedHistory = cachedData.history;
                this.cachedStats = cachedData.stats;
                this.cachedWorkspacePath = workspacePath;
                this.displayCachedHistory();
            } else {
                this.loadHistory(workspacePath);
            }
        }
    }

    public async loadHistory(workspacePath: string): Promise<void> {
        try {
            const history = await HistoryManager.getHistory(workspacePath, 100);
            const stats = await HistoryManager.getStats(workspacePath);

            if (this._view) {
                this._view.webview.postMessage({
                    type: 'historyLoaded',
                    history: history,
                    stats: stats,
                    workspacePath: workspacePath
                });
            }
        } catch (error) {
            console.error('Failed to load history:', error);
            if (this._view) {
                this._view.webview.postMessage({
                    type: 'error',
                    message: `Failed to load history: ${(error as Error).message}`
                });
            }
        }
    }

    public async loadAnalytics(workspacePath: string): Promise<void> {
        try {
            // Get history data for comprehensive analytics
            const historyData = await HistoryManager.getHistory(workspacePath, 1000); // Get more data for detailed analysis

            // Use HistoryAnalytics for comprehensive analytics
            const analytics = await HistoryAnalytics.generateAnalytics(historyData);

            // Get top insights for quick display
            const topEnvironments = HistoryAnalytics.getTopEnvironments(analytics, 5);
            const peakHours = HistoryAnalytics.getPeakHours(analytics);
            const mostChangedVariables = HistoryAnalytics.getMostChangedVariables(analytics, 10);

            // Enhanced analytics with quick insights
            const enhancedAnalytics = {
                ...analytics,
                quickInsights: {
                    topEnvironments,
                    peakHours: peakHours.slice(0, 3), // Top 3 peak hours
                    mostChangedVariables: mostChangedVariables.slice(0, 5), // Top 5 most changed variables
                    totalUniqueVariables: Object.keys(analytics.variableAnalytics.changeFrequency).length,
                    activityScore: this.calculateActivityScore(analytics)
                }
            };

            if (this._view) {
                this._view.webview.postMessage({
                    type: 'analyticsLoaded',
                    analytics: enhancedAnalytics,
                    workspacePath: workspacePath
                });
            }
        } catch (error) {
            console.error('Failed to load analytics:', error);
            if (this._view) {
                this._view.webview.postMessage({
                    type: 'error',
                    message: `Failed to load analytics: ${(error as Error).message}`
                });
            }
        }
    }

    private async viewEntry(entryId: string, workspacePath: string): Promise<void> {
        try {
            const entry = await HistoryManager.getEntry(workspacePath, entryId);
            if (entry && this._view) {
                this._view.webview.postMessage({
                    type: 'entryContent',
                    entry: entry
                });
            } else if (this._view) {
                this._view.webview.postMessage({
                    type: 'error',
                    message: 'Entry not found'
                });
            }
        } catch (error) {
            console.error('Failed to load entry:', error);
            if (this._view) {
                this._view.webview.postMessage({
                    type: 'error',
                    message: `Failed to load entry: ${(error as Error).message}`
                });
            }
        }
    }

    private async rollbackToEntry(entryId: string, workspacePath: string, reason?: string): Promise<void> {
        try {
            const success = await HistoryManager.rollbackToEntry(workspacePath, entryId, reason);
            if (this._view) {
                this._view.webview.postMessage({
                    type: 'rollbackResult',
                    success: success,
                    entryId: entryId
                });

                // Refresh history after rollback
                await this.loadHistory(workspacePath);

                // Refresh status bar
                const workspaceManager = WorkspaceManager.getInstance();
                const workspaceData = workspaceManager.getAllWorkspaces().find(
                    ws => ws.workspace.uri.fsPath === workspacePath
                );
                if (workspaceData?.statusBarProvider) {
                    workspaceData.statusBarProvider.forceRefresh();
                }
            }
        } catch (error) {
            console.error('Failed to rollback:', error);
            if (this._view) {
                this._view.webview.postMessage({
                    type: 'error',
                    message: `Rollback failed: ${(error as Error).message}`
                });
            }
        }
    }

    private async showDiff(entryId: string, workspacePath: string): Promise<void> {
        try {
            const entry = await HistoryManager.getEntry(workspacePath, entryId);
            if (!entry) return;

            const currentEnvPath = `${workspacePath}/.env`;

            // Create temporary file for historical content
            const tempDir = os.tmpdir();
            const tempFile = `${tempDir}/dotenvy-history-${entry.id}.env`;
            fs.writeFileSync(tempFile, entry.fileContent);

            // Generate diff
            const diff = EnvironmentDiffer.compareFiles(tempFile, currentEnvPath);
            const diffText = EnvironmentDiffer.formatDiffForDisplay(diff, entry.environmentName, 'Current');

            // Clean up temp file
            fs.unlinkSync(tempFile);

            if (this._view) {
                this._view.webview.postMessage({
                    type: 'diffContent',
                    diff: diffText,
                    entry: entry
                });
            }
        } catch (error) {
            console.error('Failed to generate diff:', error);
            if (this._view) {
                this._view.webview.postMessage({
                    type: 'error',
                    message: `Failed to generate diff: ${(error as Error).message}`
                });
            }
        }
    }

    private displayCachedHistory(): void {
        if (this._view && this.cachedHistory && this.cachedStats && this.cachedWorkspacePath) {
            this._view.webview.postMessage({
                type: 'historyLoaded',
                history: this.cachedHistory,
                stats: this.cachedStats,
                workspacePath: this.cachedWorkspacePath
            });
        }
    }

    public async applyFilters(workspacePath: string, filters: HistoryFilterOptions): Promise<void> {
        try {
            const result = await HistoryManager.applyFilters(workspacePath, filters);

            if (this._view) {
                this._view.webview.postMessage({
                    type: 'filtersApplied',
                    result: result,
                    workspacePath: workspacePath
                });
            }
        } catch (error) {
            console.error('Failed to apply filters:', error);
            if (this._view) {
                this._view.webview.postMessage({
                    type: 'error',
                    message: `Failed to apply filters: ${(error as Error).message}`
                });
            }
        }
    }

    public async getFilterOptions(workspacePath: string): Promise<void> {
        try {
            const options = await HistoryManager.getFilterOptions(workspacePath);

            if (this._view) {
                this._view.webview.postMessage({
                    type: 'filterOptionsLoaded',
                    options: options,
                    workspacePath: workspacePath
                });
            }
        } catch (error) {
            console.error('Failed to get filter options:', error);
            if (this._view) {
                this._view.webview.postMessage({
                    type: 'error',
                    message: `Failed to get filter options: ${(error as Error).message}`
                });
            }
        }
    }

    public async getVariableHistory(workspacePath: string, variableName: string): Promise<void> {
        try {
            const history = await HistoryManager.getVariableHistory(workspacePath, variableName);

            if (this._view) {
                this._view.webview.postMessage({
                    type: 'variableHistoryLoaded',
                    variableName: variableName,
                    history: history,
                    workspacePath: workspacePath
                });
            }
        } catch (error) {
            console.error('Failed to get variable history:', error);
            if (this._view) {
                this._view.webview.postMessage({
                    type: 'error',
                    message: `Failed to get variable history: ${(error as Error).message}`
                });
            }
        }
    }

    public validateRegex(pattern: string): void {
        const result = HistoryManager.validateRegex(pattern);

        if (this._view) {
            this._view.webview.postMessage({
                type: 'regexValidated',
                pattern: pattern,
                valid: result.valid,
                error: result.error
            });
        }
    }

    private async copyContent(entryId: string, workspacePath: string): Promise<void> {
        try {
            const entry = await HistoryManager.getEntry(workspacePath, entryId);
            if (entry) {
                await vscode.env.clipboard.writeText(entry.fileContent);
                vscode.window.showInformationMessage('Environment content copied to clipboard');
            }
        } catch (error) {
            console.error('Failed to copy content:', error);
            vscode.window.showErrorMessage('Failed to copy environment content to clipboard');
        }
    }

    private async confirmRollback(entryId: string, workspacePath: string, timestamp: string, environmentName: string): Promise<void> {
        try {
            const timestampDate = new Date(timestamp);
            const message = `Are you sure you want to rollback to the environment state from ${timestampDate.toLocaleString()}?\n\nThis will replace your current .env file with the historical version for environment "${environmentName}".`;

            const result = await vscode.window.showWarningMessage(
                message,
                { modal: true },
                'Rollback',
                'Cancel'
            );

            if (result === 'Rollback') {
                // Ask for optional reason
                const reason = await vscode.window.showInputBox({
                    prompt: 'Optional: Enter a reason for this rollback',
                    placeHolder: 'e.g., Reverting to stable configuration'
                });

                // Proceed with rollback
                await this.rollbackToEntry(entryId, workspacePath, reason);
            }
        } catch (error) {
            console.error('Failed to confirm rollback:', error);
            vscode.window.showErrorMessage('Failed to process rollback confirmation');
        }
    }

    private calculateActivityScore(analytics: import('../utils/historyAnalytics').AnalyticsSummary): number {
        // Calculate a simple activity score based on:
        // - Number of entries
        // - Stability scores
        // - Variable change frequency

        const entryScore = Math.min(analytics.dataRange.totalEntries / 10, 100); // Up to 100 points for entries
        const stabilityScores = Object.values(analytics.stabilityMetrics.stabilityScore);
        const averageStability = stabilityScores.length > 0
            ? stabilityScores.reduce((sum, score) => sum + score, 0) / stabilityScores.length
            : 50;

        const variableFrequency = Object.values(analytics.variableAnalytics.changeFrequency);
        const totalChanges = variableFrequency.reduce((sum, freq) => sum + freq, 0);
        const frequencyScore = Math.min(totalChanges / 5, 100); // Up to 100 points for changes

        // Weighted average: 40% entries, 30% stability, 30% frequency
        return Math.round((entryScore * 0.4) + (averageStability * 0.3) + (frequencyScore * 0.3));
    }

    private _getHtmlForWebview(webview: vscode.Webview): string {
        const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'resources', 'panel', 'panel.css'));
        const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'resources', 'panel', 'history-viewer.js'));

        const nonce = getNonce();

        return `<!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <link href="${styleUri}" rel="stylesheet">
            <title>Environment History</title>
        </head>
        <body>
            <div class="history-container">
                <div class="history-header">
                    <h3>Environment History</h3>
                    <div class="history-stats" id="stats"></div>
                </div>

                <div class="history-toolbar">
                    <div class="view-toggles">
                        <button id="list-view-btn" class="btn-secondary view-toggle active" data-view="list">📋 List</button>
                        <button id="timeline-view-btn" class="btn-secondary view-toggle" data-view="timeline">📊 Timeline</button>
                        <button id="analytics-view-btn" class="btn-secondary view-toggle" data-view="analytics">📈 Analytics</button>
                    </div>
                    <button id="refresh-btn" class="btn-secondary">🔄 Refresh</button>
                    <button id="advanced-filters-btn" class="btn-secondary">🔍 Advanced Filters</button>
                </div>

                <div class="advanced-filters-panel" id="advanced-filters-panel" style="display: none;">
                    <div class="filters-section">
                        <h4>🔍 Search & Filter</h4>
                        <div class="filter-row">
                            <div class="filter-group">
                                <label for="advanced-search-input">Search Query:</label>
                                <input type="text" id="advanced-search-input" placeholder="Search environment content..." class="filter-input">
                                <div class="filter-options">
                                    <label><input type="checkbox" id="regex-toggle"> Regex</label>
                                    <select id="search-scope-select" class="filter-select-small">
                                        <option value="all">All Content</option>
                                        <option value="environments">Environments</option>
                                        <option value="variables">Variables</option>
                                        <option value="values">Values</option>
                                    </select>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div class="filters-section">
                        <h4>📅 Date Range</h4>
                        <div class="filter-row">
                            <div class="filter-group">
                                <label>Date Presets:</label>
                                <select id="date-preset-select" class="filter-select-small">
                                    <option value="">Custom Range</option>
                                </select>
                            </div>
                            <div class="filter-group">
                                <label for="date-from-input">From:</label>
                                <input type="date" id="date-from-input" class="filter-input">
                            </div>
                            <div class="filter-group">
                                <label for="date-to-input">To:</label>
                                <input type="date" id="date-to-input" class="filter-input">
                            </div>
                        </div>
                    </div>

                    <div class="filters-section">
                        <h4>👥 Users & Actions</h4>
                        <div class="filter-row">
                            <div class="filter-group">
                                <label>Users:</label>
                                <select id="user-filter-select" multiple class="filter-select-multi">
                                    <option value="">Loading...</option>
                                </select>
                            </div>
                            <div class="filter-group">
                                <label>Actions:</label>
                                <select id="action-filter-select" multiple class="filter-select-multi">
                                    <option value="switch">Switch</option>
                                    <option value="rollback">Rollback</option>
                                    <option value="manual_edit">Manual Edit</option>
                                    <option value="import">Import</option>
                                    <option value="initial">Initial</option>
                                </select>
                            </div>
                        </div>
                    </div>

                    <div class="filters-section">
                        <h4>🏷️ Environments & Variables</h4>
                        <div class="filter-row">
                            <div class="filter-group">
                                <label>Environments:</label>
                                <select id="environment-filter-select" multiple class="filter-select-multi">
                                    <option value="">Loading...</option>
                                </select>
                            </div>
                            <div class="filter-group">
                                <label>Variables:</label>
                                <select id="variable-filter-select" multiple class="filter-select-multi">
                                    <option value="">Loading...</option>
                                </select>
                            </div>
                        </div>
                    </div>

                    <div class="filters-actions">
                        <button id="apply-filters-btn" class="btn-primary">Apply Filters</button>
                        <button id="clear-filters-btn" class="btn-secondary">Clear All</button>
                        <button id="close-filters-btn" class="btn-secondary">Close</button>
                        <div class="filter-stats" id="filter-stats"></div>
                    </div>
                </div>

                <div class="history-views">
                    <div class="history-list active" id="history-list">
                        <div class="loading">Loading history...</div>
                    </div>

                    <div class="timeline-container" id="timeline-container" style="display: none;">
                        <div class="timeline-controls">
                            <button id="zoom-in-btn" class="btn-secondary" title="Zoom In">🔍+</button>
                            <button id="zoom-out-btn" class="btn-secondary" title="Zoom Out">🔍-</button>
                            <button id="fit-to-screen-btn" class="btn-secondary" title="Fit to Screen">📐</button>
                            <span class="zoom-level" id="zoom-level">100%</span>
                        </div>
                        <div class="timeline-wrapper">
                            <svg class="timeline-svg" id="timeline-svg" width="100%" height="400">
                                <defs>
                                    <marker id="arrowhead" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto">
                                        <polygon points="0 0, 10 3.5, 0 7" fill="#64748b" />
                                    </marker>
                                </defs>
                                <g class="timeline-content" id="timeline-content"></g>
                            </svg>
                        </div>
                        <div class="timeline-minimap" id="timeline-minimap" style="display: none;">
                            <svg class="minimap-svg" id="minimap-svg" width="100%" height="60"></svg>
                        </div>
                    </div>

                    <div class="analytics-container" id="analytics-container" style="display: none;">
                        <div class="analytics-content" id="analytics-content">
                            <div class="loading">Loading analytics...</div>
                        </div>
                    </div>
                </div>

                <div class="history-detail" id="history-detail" style="display: none;">
                    <div class="detail-header">
                        <button id="back-btn" class="btn-secondary">← Back</button>
                        <h4 id="detail-title"></h4>
                    </div>
                    <div class="detail-content" id="detail-content"></div>
                    <div class="detail-actions" id="detail-actions"></div>
                </div>
            </div>

            <script nonce="${nonce}" src="${scriptUri}"></script>
        </body>
        </html>`;
    }
}

function getNonce(): string {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}

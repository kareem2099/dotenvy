import * as vscode from 'vscode';
import { HistoryManager } from '../utils/historyManager';
import { HistoryAnalytics } from '../utils/historyAnalytics';
import { logger } from '../utils/logger';
import { loadWebviewHtml } from '../utils/webviewUtils';

export class AnalyticsWebviewProvider {
    public static readonly viewType = 'dotenvy.analyticsViewer';
    private static _panel?: vscode.WebviewPanel;
    private static _context?: vscode.ExtensionContext;
    private static _extensionUri?: vscode.Uri;

    /** Call once on activate */
    public static init(extensionUri: vscode.Uri, context: vscode.ExtensionContext) {
        AnalyticsWebviewProvider._extensionUri = extensionUri;
        AnalyticsWebviewProvider._context      = context;
    }

    /** Open (or reveal) the Analytics webview panel */
    public static async openOrReveal(): Promise<void> {
        const context      = AnalyticsWebviewProvider._context;
        const extensionUri = AnalyticsWebviewProvider._extensionUri;

        if (!context || !extensionUri) {
            vscode.window.showErrorMessage('Analytics Manager not initialized.');
            return;
        }

        if (AnalyticsWebviewProvider._panel) {
            AnalyticsWebviewProvider._panel.reveal(vscode.ViewColumn.One);
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            AnalyticsWebviewProvider.viewType,
            'Environment Analytics',
            vscode.ViewColumn.One,
            {
                enableScripts: true,
                localResourceRoots: [extensionUri],
                retainContextWhenHidden: true,
            }
        );

        AnalyticsWebviewProvider._panel = panel;
        panel.webview.html = AnalyticsWebviewProvider._getHtml(panel.webview, extensionUri);

        // Handle messages from the webview
        panel.webview.onDidReceiveMessage(async (message) => {
            await AnalyticsWebviewProvider._handleMessage(message);
        }, undefined, context.subscriptions);

        // Cleanup on close
        panel.onDidDispose(() => {
            AnalyticsWebviewProvider._panel = undefined;
        }, null, context.subscriptions);

        // Load data for the first workspace
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (workspaceFolders && workspaceFolders.length > 0) {
            await AnalyticsWebviewProvider.loadAnalytics(workspaceFolders[0].uri.fsPath);
        }
    }

    // ─── Data Loading ───────────────────────────────────────────────────────────

    public static async loadAnalytics(workspacePath: string): Promise<void> {
        try {
            const historyData = await HistoryManager.getHistory(workspacePath, 1000);
            const analytics   = await HistoryAnalytics.generateAnalytics(historyData);

            const topEnvironments      = HistoryAnalytics.getTopEnvironments(analytics, 5);
            const peakHours            = HistoryAnalytics.getPeakHours(analytics);
            const mostChangedVariables = HistoryAnalytics.getMostChangedVariables(analytics, 10);

            const enhanced = {
                ...analytics,
                quickInsights: {
                    topEnvironments,
                    peakHours: peakHours.slice(0, 3),
                    mostChangedVariables: mostChangedVariables.slice(0, 5),
                    totalUniqueVariables: Object.keys(analytics.variableAnalytics.changeFrequency).length,
                }
            };

            AnalyticsWebviewProvider._post({
                type: 'analyticsLoaded',
                analytics: enhanced,
                workspacePath,
            });
        } catch (error) {
            logger.error('Failed to load analytics:', error, 'AnalyticsWebviewProvider');
            AnalyticsWebviewProvider._post({
                type: 'error',
                message: `Failed to load analytics: ${(error as Error).message}`,
            });
        }
    }

    // ─── Private helpers ────────────────────────────────────────────────────────

    private static _post(message: object): void {
        AnalyticsWebviewProvider._panel?.webview.postMessage(message);
    }

    private static async _handleMessage(message: { type: string; workspacePath: string }): Promise<void> {
        switch (message.type) {
            case 'loadAnalytics':
                await AnalyticsWebviewProvider.loadAnalytics(message.workspacePath);
                break;
            case 'refresh': {
                const workspaceFolders = vscode.workspace.workspaceFolders;
                if (workspaceFolders && workspaceFolders.length > 0) {
                    await AnalyticsWebviewProvider.loadAnalytics(workspaceFolders[0].uri.fsPath);
                }
                break;
            }
        }
    }

    private static _getHtml(webview: vscode.Webview, extensionUri: vscode.Uri): string {
        return loadWebviewHtml({
            webview,
            extensionUri,
            templatePath: ['resources', 'panel', 'analytics.html'],
            tokens: {
                styleUri:      webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'resources', 'panel', 'panel.css')).toString(),
                extraStyleUri: webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'resources', 'panel', 'analytics.css')).toString(),
                scriptUri:     webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'resources', 'panel', 'analytics.js')).toString(),
            },
        });
    }
}

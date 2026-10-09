import * as vscode from 'vscode';
import { HistoryManager } from '../utils/historyManager';
import { HistoryAnalytics } from '../utils/historyAnalytics';
import { logger } from '../utils/logger';
import { loadWebviewHtml } from '../utils/webviewUtils';
import { postLocaleToPanel } from '../i18n/webviewLocale';
import { t } from '../i18n';

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

    public static refreshLocale(): void {
        postLocaleToPanel(AnalyticsWebviewProvider._panel, 'analytics.');
    }

    /** Open (or reveal) the Analytics webview panel */
    public static async openOrReveal(): Promise<void> {
        const context      = AnalyticsWebviewProvider._context;
        const extensionUri = AnalyticsWebviewProvider._extensionUri;

        if (!context || !extensionUri) {
            vscode.window.showErrorMessage(t('analytics.notInitialized'));
            return;
        }

        if (AnalyticsWebviewProvider._panel) {
            AnalyticsWebviewProvider._panel.reveal(vscode.ViewColumn.One);
            postLocaleToPanel(AnalyticsWebviewProvider._panel, 'analytics.');
            await AnalyticsWebviewProvider._loadForActiveWorkspace();
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            AnalyticsWebviewProvider.viewType,
            t('analytics.title'),
            vscode.ViewColumn.One,
            {
                enableScripts: true,
                localResourceRoots: [extensionUri],
                retainContextWhenHidden: true,
            }
        );

        AnalyticsWebviewProvider._panel = panel;
        panel.webview.html = AnalyticsWebviewProvider._getHtml(panel.webview, extensionUri);
        postLocaleToPanel(panel, 'analytics.');

        // Handle messages from the webview
        panel.webview.onDidReceiveMessage(async (message) => {
            await AnalyticsWebviewProvider._handleMessage(message);
        }, undefined, context.subscriptions);

        // Cleanup on close
        panel.onDidDispose(() => {
            AnalyticsWebviewProvider._panel = undefined;
        }, null, context.subscriptions);

        // Initial load is triggered from the webview after scripts are ready (avoids lost postMessage).
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
                errorMessage: (error as Error).message,
            });
        }
    }

    // ─── Private helpers ────────────────────────────────────────────────────────

    private static _post(message: object): void {
        AnalyticsWebviewProvider._panel?.webview.postMessage(message);
    }

    private static async _loadForActiveWorkspace(): Promise<void> {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0) {
            AnalyticsWebviewProvider._post({
                type: 'error',
                errorMessage: t('common.noWorkspace'),
            });
            return;
        }
        await AnalyticsWebviewProvider.loadAnalytics(workspaceFolders[0].uri.fsPath);
    }

    private static async _handleMessage(message: { type: string; workspacePath?: string }): Promise<void> {
        switch (message.type) {
            case 'webviewReady':
                postLocaleToPanel(AnalyticsWebviewProvider._panel, 'analytics.');
                await AnalyticsWebviewProvider._loadForActiveWorkspace();
                break;
            case 'loadAnalytics':
                if (message.workspacePath) {
                    await AnalyticsWebviewProvider.loadAnalytics(message.workspacePath);
                } else {
                    await AnalyticsWebviewProvider._loadForActiveWorkspace();
                }
                break;
            case 'refresh':
                await AnalyticsWebviewProvider._loadForActiveWorkspace();
                break;
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
                i18nScriptUri: webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'resources', 'panel', 'webview-i18n.js')).toString(),
            },
        });
    }
}

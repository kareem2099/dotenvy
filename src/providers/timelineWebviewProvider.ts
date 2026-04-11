import * as vscode from 'vscode';
import { HistoryManager } from '../utils/historyManager';
import { logger } from '../utils/logger';
import { loadWebviewHtml } from '../utils/webviewUtils';

export class TimelineWebviewProvider {
    public static readonly viewType = 'dotenvy.timelineViewer';
    private static _panel?: vscode.WebviewPanel;
    private static _context?: vscode.ExtensionContext;
    private static _extensionUri?: vscode.Uri;

    /** Call once on activate */
    public static init(extensionUri: vscode.Uri, context: vscode.ExtensionContext) {
        TimelineWebviewProvider._extensionUri = extensionUri;
        TimelineWebviewProvider._context      = context;
    }

    /** Open (or reveal) the Timeline webview panel */
    public static async openOrReveal(): Promise<void> {
        const context      = TimelineWebviewProvider._context;
        const extensionUri = TimelineWebviewProvider._extensionUri;

        if (!context || !extensionUri) {
            vscode.window.showErrorMessage('Timeline Manager not initialized.');
            return;
        }

        if (TimelineWebviewProvider._panel) {
            TimelineWebviewProvider._panel.reveal(vscode.ViewColumn.Two);
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            TimelineWebviewProvider.viewType,
            'Environment Timeline',
            vscode.ViewColumn.Two, // Open side-by-side by default for coolness
            {
                enableScripts: true,
                localResourceRoots: [extensionUri],
                retainContextWhenHidden: true,
            }
        );

        TimelineWebviewProvider._panel = panel;
        panel.webview.html = TimelineWebviewProvider._getHtml(panel.webview, extensionUri);

        // Handle messages from the webview
        panel.webview.onDidReceiveMessage(async (message) => {
            await TimelineWebviewProvider._handleMessage(message);
        }, undefined, context.subscriptions);

        // Cleanup on close
        panel.onDidDispose(() => {
            TimelineWebviewProvider._panel = undefined;
        }, null, context.subscriptions);

        // Load data for the first workspace
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (workspaceFolders && workspaceFolders.length > 0) {
            await TimelineWebviewProvider.loadTimeline(workspaceFolders[0].uri.fsPath);
        }
    }

    // ─── Data Loading ───────────────────────────────────────────────────────────

    public static async loadTimeline(workspacePath: string): Promise<void> {
        try {
            const history = await HistoryManager.getHistory(workspacePath);
            const stats   = await HistoryManager.getStats(workspacePath);

            TimelineWebviewProvider._post({
                type: 'historyLoaded',
                history,
                stats,
                workspacePath,
            });
        } catch (error) {
            logger.error('Failed to load timeline:', error, 'TimelineWebviewProvider');
            TimelineWebviewProvider._post({
                type: 'error',
                message: `Failed to load timeline: ${(error as Error).message}`,
            });
        }
    }

    // ─── Private helpers ────────────────────────────────────────────────────────

    private static _post(message: object): void {
        TimelineWebviewProvider._panel?.webview.postMessage(message);
    }

    private static async _handleMessage(message: { type: string; workspacePath: string }): Promise<void> {
        switch (message.type) {
            case 'loadHistory':
                await TimelineWebviewProvider.loadTimeline(message.workspacePath);
                break;
            case 'refresh': {
                const workspaceFolders = vscode.workspace.workspaceFolders;
                if (workspaceFolders && workspaceFolders.length > 0) {
                    await TimelineWebviewProvider.loadTimeline(workspaceFolders[0].uri.fsPath);
                }
                break;
            }
            case 'viewEntry': {
                // Tell History Panel to reveal this entry
                await vscode.commands.executeCommand('dotenvy.openHistoryPanel');
                // Give it a moment to load then maybe send a message (advanced)
                // For now, opening the panel is a good start.
                break;
            }
        }
    }

    private static _getHtml(webview: vscode.Webview, extensionUri: vscode.Uri): string {
        return loadWebviewHtml({
            webview,
            extensionUri,
            templatePath: ['resources', 'panel', 'timeline-viewer.html'],
            tokens: {
                styleUri:  webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'resources', 'panel', 'panel.css')).toString(),
                scriptUri: webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'resources', 'panel', 'timeline-viewer.js')).toString(),
            },
        });
    }
}

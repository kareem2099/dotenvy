import * as vscode from 'vscode';
import * as path from 'path';
import { HistoryManager } from '../utils/historyManager';
import { logger } from '../utils/logger';

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
        const context      = TimelineWebviewProvider._context!;
        const extensionUri = TimelineWebviewProvider._extensionUri!;

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

    private static async _handleMessage(message: { type: string; [key: string]: any }): Promise<void> {
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
        const styleUri  = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'resources', 'panel', 'panel.css'));
        const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'resources', 'panel', 'timeline-viewer.js'));
        const nonce     = getNonce();

        return `<!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <link href="${styleUri}" rel="stylesheet">
            <title>Environment Timeline</title>
        </head>
        <body class="timeline-only">
            <div class="history-container">
                <div class="history-header">
                    <h3>📊 Environment Timeline</h3>
                    <div class="history-stats" id="stats"></div>
                </div>

                <div class="history-toolbar">
                    <div class="view-info">Visualizing environment lifecycle and changes</div>
                    <button id="refresh-btn" class="btn-secondary">🔄 Refresh</button>
                </div>

                <div class="timeline-container standalone" id="timeline-container">
                    <div class="timeline-controls">
                        <button id="zoom-in-btn" class="btn-secondary" title="Zoom In">🔍+</button>
                        <button id="zoom-out-btn" class="btn-secondary" title="Zoom Out">🔍-</button>
                        <button id="fit-to-screen-btn" class="btn-secondary" title="Fit to Screen">📐</button>
                        <span class="zoom-level" id="zoom-level">100%</span>
                    </div>
                    <div class="timeline-wrapper">
                        <svg class="timeline-svg" id="timeline-svg" width="100%" height="600">
                            <defs>
                                <marker id="arrowhead" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto">
                                    <polygon points="0 0, 10 3.5, 0 7" fill="#64748b" />
                                </marker>
                            </defs>
                            <g class="timeline-content" id="timeline-content"></g>
                        </svg>
                    </div>
                    <div class="timeline-minimap" id="timeline-minimap" style="display: none;">
                        <svg class="minimap-svg" id="minimap-svg" width="100%" height="80"></svg>
                    </div>
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

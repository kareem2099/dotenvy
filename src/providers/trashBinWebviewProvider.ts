import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { TrashBinManager, TrashBinEntry } from '../utils/trashBinManager';
import { logger } from '../utils/logger';

export class TrashBinWebviewProvider {
    public static readonly viewType = 'dotenvy.trashBin';
    private static _panel?: vscode.WebviewPanel;
    private static _context?: vscode.ExtensionContext;
    private static _extensionUri?: vscode.Uri;

    public static init(extensionUri: vscode.Uri, context: vscode.ExtensionContext): void {
        TrashBinWebviewProvider._extensionUri = extensionUri;
        TrashBinWebviewProvider._context      = context;

        // Auto-refresh webview whenever manager changes
        TrashBinManager.getInstance().onDidChange(() => {
            TrashBinWebviewProvider._refreshIfOpen();
        });
    }

    public static async openOrReveal(): Promise<void> {
        const context      = TrashBinWebviewProvider._context!;
        const extensionUri = TrashBinWebviewProvider._extensionUri!;

        if (TrashBinWebviewProvider._panel) {
            TrashBinWebviewProvider._panel.reveal(vscode.ViewColumn.Two);
            TrashBinWebviewProvider._refreshIfOpen();
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            TrashBinWebviewProvider.viewType,
            '🗑️ Session Trash Bin',
            vscode.ViewColumn.Two,
            {
                enableScripts: true,
                localResourceRoots: [extensionUri],
                retainContextWhenHidden: true,
            }
        );

        TrashBinWebviewProvider._panel = panel;
        panel.webview.html = TrashBinWebviewProvider._getHtml(panel.webview, extensionUri);

        panel.webview.onDidReceiveMessage(async (msg) => {
            await TrashBinWebviewProvider._handleMessage(msg);
        }, undefined, context.subscriptions);

        panel.onDidDispose(() => {
            TrashBinWebviewProvider._panel = undefined;
        }, null, context.subscriptions);

        // Push current entries right after opening
        TrashBinWebviewProvider._refreshIfOpen();
    }

    // ─── Private ─────────────────────────────────────────────────────────────

    private static _refreshIfOpen(): void {
        if (!TrashBinWebviewProvider._panel) return;
        const entries = TrashBinManager.getInstance().getAll();
        TrashBinWebviewProvider._panel.webview.postMessage({ type: 'refresh', entries });
    }

    private static async _handleMessage(msg: { type: string; [k: string]: any }): Promise<void> {
        switch (msg.type) {
            case 'restore': {
                const entry = TrashBinManager.getInstance().getAll().find(e => e.id === msg.id);
                if (!entry) {
                    vscode.window.showErrorMessage('Entry no longer in trash bin.');
                    return;
                }
                await TrashBinWebviewProvider._restoreEntry(entry);
                break;
            }
            case 'clearAll': {
                const confirm = await vscode.window.showWarningMessage(
                    'Clear all entries from the Trash Bin?', { modal: true }, 'Clear All'
                );
                if (confirm === 'Clear All') {
                    TrashBinManager.getInstance().clearAll();
                }
                break;
            }
        }
    }

    private static async _restoreEntry(entry: TrashBinEntry): Promise<void> {
        try {
            const filePath = path.join(entry.workspacePath, entry.environmentFile);
            if (!fs.existsSync(filePath)) {
                vscode.window.showErrorMessage(`Cannot restore: ${entry.environmentFile} not found.`);
                return;
            }

            const raw  = fs.readFileSync(filePath, 'utf8');
            const lines = raw.split('\n');

            if (entry.type === 'deleted') {
                // Re-append the deleted line
                lines.push(`${entry.key}=${entry.oldValue}`);
                fs.writeFileSync(filePath, lines.join('\n'), 'utf8');
                vscode.window.showInformationMessage(`✅ Restored: ${entry.key}`);
            } else {
                // Revert to old value
                const idx = lines.findIndex(l => l.startsWith(`${entry.key}=`));
                if (idx !== -1) {
                    lines[idx] = `${entry.key}=${entry.oldValue}`;
                } else {
                    lines.push(`${entry.key}=${entry.oldValue}`);
                }
                fs.writeFileSync(filePath, lines.join('\n'), 'utf8');
                vscode.window.showInformationMessage(`✅ Reverted: ${entry.key}`);
            }

            TrashBinManager.getInstance().remove(entry.id);
        } catch (error) {
            logger.error('Restore failed:', error, 'TrashBinWebviewProvider');
            vscode.window.showErrorMessage(`Restore failed: ${(error as Error).message}`);
        }
    }

    private static _getHtml(webview: vscode.Webview, extensionUri: vscode.Uri): string {
        const styleUri  = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'resources', 'panel', 'panel.css'));
        const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'resources', 'panel', 'trash-bin.js'));
        const nonce     = getNonce();

        return `<!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <link href="${styleUri}" rel="stylesheet">
            <title>Session Trash Bin</title>
        </head>
        <body>
            <div class="trash-bin-container">
                <div class="trash-header">
                    <div>
                        <h3>🗑️ Session Trash Bin <span class="trash-count" id="trash-count">0</span></h3>
                        <p style="margin:0;font-size:0.8rem;opacity:0.6;">Variables deleted or modified this session. Clears on VS Code restart.</p>
                    </div>
                    <button class="btn-secondary" id="clear-all-btn">Clear All</button>
                </div>
                <div class="trash-list" id="trash-list">
                    <div class="trash-empty">🎉 Nothing in the bin — your variables are safe!</div>
                </div>
            </div>
            <script nonce="${nonce}" src="${scriptUri}"></script>
        </body>
        </html>`;
    }
}

function getNonce(): string {
    let text = '';
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) text += chars.charAt(Math.floor(Math.random() * chars.length));
    return text;
}

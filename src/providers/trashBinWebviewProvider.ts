import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { TrashBinManager, TrashBinEntry } from '../utils/trashBinManager';
import { logger } from '../utils/logger';
import { loadWebviewHtml } from '../utils/webviewUtils';

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
        const context      = TrashBinWebviewProvider._context;
        const extensionUri = TrashBinWebviewProvider._extensionUri;

        if (!context || !extensionUri) {
            vscode.window.showErrorMessage('Trash Bin Manager not initialized.');
            return;
        }

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

    private static async _handleMessage(msg: { type: string; id?: string }): Promise<void> {
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
        return loadWebviewHtml({
            webview,
            extensionUri,
            templatePath: ['resources', 'panel', 'trash-bin.html'],
            tokens: {
                styleUri:  webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'resources', 'panel', 'panel.css')).toString(),
                scriptUri: webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'resources', 'panel', 'trash-bin.js')).toString(),
            },
        });
    }
}

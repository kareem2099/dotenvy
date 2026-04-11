import * as vscode from 'vscode';
import * as path from 'path';
import { DetectedSecret } from '../utils/secretScannerTypes';
import { FeedbackManager } from '../utils/feedbackManager';
import { logger } from '../utils/logger';
import { loadWebviewHtml } from '../utils/webviewUtils';

export class SecretsPanel {
    public static currentPanel: SecretsPanel | undefined;
    private readonly _panel: vscode.WebviewPanel;
    private _secrets: DetectedSecret[] = [];
    private _disposables: vscode.Disposable[] = [];

    public static readonly viewType = 'dotenvy.secretsPanel';

    private _extensionUri: vscode.Uri;

    public static show(secrets: DetectedSecret[], extensionUri: vscode.Uri): SecretsPanel {
        const column = vscode.window.activeTextEditor?.viewColumn;

        if (SecretsPanel.currentPanel) {
            SecretsPanel.currentPanel._panel.reveal(column);
            SecretsPanel.currentPanel.update(secrets);
            return SecretsPanel.currentPanel;
        }

        const panel = vscode.window.createWebviewPanel(
            SecretsPanel.viewType,
            `🔍 DotEnvy — Secrets Scanner`,
            column || vscode.ViewColumn.One,
            { enableScripts: true, retainContextWhenHidden: true,
              localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'resources')] }
        );

        SecretsPanel.currentPanel = new SecretsPanel(panel, secrets, extensionUri);
        return SecretsPanel.currentPanel;
    }

    private constructor(panel: vscode.WebviewPanel, secrets: DetectedSecret[], extensionUri: vscode.Uri) {
        this._panel   = panel;
        this._secrets = secrets;
        this._extensionUri = extensionUri;
        this._render();
        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
        this._panel.webview.onDidReceiveMessage(
            async (msg) => { await this._handleMessage(msg); },
            null, this._disposables
        );
    }

    public update(secrets: DetectedSecret[]): void {
        this._secrets = secrets;
        this._render();
    }

    // ─── Messages ──────────────────────────────────────────────────────────────

    private async _handleMessage(message: { type: string; secret?: DetectedSecret }): Promise<void> {
        switch (message.type) {
            case 'viewLocation': if (message.secret) { await this._viewLocation(message.secret); } break;
            case 'moveToEnv':    if (message.secret) { await this._moveToEnv(message.secret); }    break;
            case 'ignore':       if (message.secret) { await this._ignore(message.secret); }       break;
        }
    }

    private async _viewLocation(secret: DetectedSecret): Promise<void> {
        try {
            const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
            if (!root) { return; }
            const filePath = path.isAbsolute(secret.file) ? secret.file : path.join(root, secret.file);
            const doc  = await vscode.workspace.openTextDocument(vscode.Uri.file(filePath));
            const ed   = await vscode.window.showTextDocument(doc);
            const line = secret.line - 1;
            const start = secret.column - 1;
            const range = new vscode.Range(line, start, line, start + secret.content.length);
            ed.revealRange(range, vscode.TextEditorRevealType.InCenter);
            ed.selection = new vscode.Selection(range.start, range.end);
        } catch (error) {
            logger.error('Failed to view secret location', error, 'SecretsPanel');
        }
    }

    private async _moveToEnv(secret: DetectedSecret): Promise<void> {
        try {
            const workspaceUri = vscode.workspace.workspaceFolders?.[0]?.uri;
            if (!workspaceUri) { return; }

            const envUri = vscode.Uri.joinPath(workspaceUri, '.env');
            let envContent = '';
            try {
                envContent = Buffer.from(await vscode.workspace.fs.readFile(envUri)).toString('utf8');
            } catch { /* new file */ }

            if (!envContent.split('\n').some(l => l.trim().startsWith(`${secret.suggestedEnvVar}=`))) {
                const ts = new Date().toISOString();
                const newContent = envContent
                    ? `${envContent.trimEnd()}\n\n# Added by DotEnvy on ${ts}\n${secret.suggestedEnvVar}=${secret.content}\n`
                    : `# Added by DotEnvy on ${ts}\n${secret.suggestedEnvVar}=${secret.content}\n`;
                await vscode.workspace.fs.writeFile(envUri, Buffer.from(newContent, 'utf8'));
            }

            // ✅ Training signal: confirmed secret
            await FeedbackManager.recordConfirmed(secret);

            this._remove(secret);
            vscode.window.showInformationMessage(`✅ ${secret.suggestedEnvVar} added to .env`);

        } catch (error) {
            logger.error('Failed to move secret to .env', error, 'SecretsPanel');
            vscode.window.showErrorMessage(`Failed: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    private async _ignore(secret: DetectedSecret): Promise<void> {
        // ✅ Training signal: false positive
        await FeedbackManager.recordFalsePositive(secret);
        this._remove(secret);

        const stats = await FeedbackManager.getStats();
        if (stats.falsePositives > 0 && stats.falsePositives % 5 === 0) {
            vscode.window.showInformationMessage(
                `🧠 Thanks! ${stats.falsePositives} false positives recorded — helping train the AI.`
            );
        }
    }

    private _remove(secret: DetectedSecret): void {
        this._secrets = this._secrets.filter(s =>
            !(s.file === secret.file && s.line === secret.line && s.column === secret.column)
        );
        this._render();
    }

    // ─── HTML ──────────────────────────────────────────────────────────────────

    private _render(): void { this._panel.webview.html = this._getHtml(); }

    private _getHtml(): string {
        const secrets = this._secrets;
        const high    = secrets.filter(s => s.confidence === 'high');
        const medium  = secrets.filter(s => s.confidence === 'medium');
        const low     = secrets.filter(s => s.confidence === 'low');

        const rows = secrets.map((s, i) => {
            const badge  = `<span class="badge ${s.confidence}">${s.confidence === 'high' ? 'HIGH' : s.confidence === 'medium' ? 'MED' : 'LOW'}</span>`;
            const method = s.detectionMethod === 'hybrid' ? '🤖 AI + Pattern' : s.detectionMethod === 'pattern' ? '🔎 Pattern' : '📊 Statistical';
            return `
            <div class="secret-row" data-confidence="${s.confidence}" data-index="${i}">
                <div class="secret-header">
                    ${badge}
                    <span class="secret-type">${this._e(s.type)}</span>
                    <span class="secret-method">${method}</span>
                    <span class="secret-loc">${this._e(s.file)}:${s.line}</span>
                </div>
                <div class="secret-body">
                    <code class="secret-value">${this._e(s.content)}</code>
                    <div class="secret-reasoning">${s.reasoning.map(r => `<span>${this._e(r)}</span>`).join('')}</div>
                    <div class="secret-env">→ <strong>${this._e(s.suggestedEnvVar)}</strong></div>
                </div>
                <div class="secret-actions">
                    <button class="btn-view"   onclick="viewLocation(${i})">📍 View</button>
                    <button class="btn-move"   onclick="moveToEnv(${i})">📥 Move to .env</button>
                    <button class="btn-ignore" onclick="ignore(${i})" title="Mark as false positive — trains the AI">👁️ Not a Secret</button>
                </div>
            </div>`;
        }).join('');

        const json = JSON.stringify(secrets).replace(/</g, '\\u003c');
        
        const statsHint = secrets.length > 0 
            ? '<div class="hint">🧠 Click <strong>Not a Secret</strong> on false positives — your feedback trains the AI to be smarter.</div>' 
            : '';
            
        const secretsContent = secrets.length === 0
            ? '<div class="empty"><div class="icon">✅</div><h3>No secrets detected!</h3><p>Your codebase looks clean.</p></div>'
            : `<div class="secrets-list" id="list">${rows}</div>`;

        return loadWebviewHtml({
            webview: this._panel.webview,
            extensionUri: this._extensionUri,
            templatePath: ['resources', 'panel', 'secrets-scanner.html'],
            tokens: {
                styleUri:       this._panel.webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'resources', 'panel', 'panel.css')).toString(),
                extraStyleUri:  this._panel.webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'resources', 'panel', 'secrets-scanner.css')).toString(),
                allCount:       secrets.length.toString(),
                highCount:      high.length.toString(),
                mediumCount:    medium.length.toString(),
                lowCount:       low.length.toString(),
                highActive:     high.length > 0 ? 'active' : 'inactive',
                mediumActive:   medium.length > 0 ? 'active' : 'inactive',
                lowActive:      low.length > 0 ? 'active' : 'inactive',
                statsHint:      statsHint,
                secretsContent: secretsContent,
                jsonSecrets:    json
            }
        });
    }

    private _e(s: string): string {
        return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    }

    public dispose(): void {
        SecretsPanel.currentPanel = undefined;
        this._panel.dispose();
        while (this._disposables.length) { this._disposables.pop()?.dispose(); }
    }
}
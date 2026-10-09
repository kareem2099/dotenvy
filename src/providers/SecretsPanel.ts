import * as vscode from 'vscode';
import * as path from 'path';
import { DetectedSecret } from '../utils/secretScannerTypes';
import { FeedbackManager } from '../utils/feedbackManager';
import { LLMAnalyzer } from '../utils/llmAnalyzer';
import { logger } from '../utils/logger';
import { loadWebviewHtml } from '../utils/webviewUtils';
import { t } from '../i18n';
import { readDetectedValue, encodeEnvValue } from '../utils/detectedSecretValue';

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
            `🔍 DotEnvy — ${t('secretsScanner.title')}`,
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
        const detection = this._secrets.find(s => s.file === message.secret?.file &&
            s.line === message.secret?.line && s.column === message.secret?.column);
        switch (message.type) {
            case 'viewLocation': if (detection) { await this._viewLocation(detection); } break;
            case 'moveToEnv':    if (detection) { await this._moveToEnv(detection); } break;
            case 'ignore':       if (detection) { await this._ignore(detection); } break;
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
            const { value, workspace } = await readDetectedValue(secret);
            const workspaceUri = workspace.uri;
            if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(secret.suggestedEnvVar)) {
                throw new Error('Invalid environment variable name.');
            }
            const encoded = encodeEnvValue(value);

            const envUri = vscode.Uri.joinPath(workspaceUri, '.env');
            let envContent = '';
            try {
                envContent = Buffer.from(await vscode.workspace.fs.readFile(envUri)).toString('utf8');
            } catch { /* new file */ }

            const existing = envContent.split('\n').find(l => l.trim().startsWith(`${secret.suggestedEnvVar}=`));
            if (existing && existing.trim() !== `${secret.suggestedEnvVar}=${encoded}`) {
                throw new Error('An environment variable with this name already has a different value.');
            }
            if (!existing) {
                const ts = new Date().toISOString();
                const newContent = envContent
                    ? `${envContent.trimEnd()}\n\n# Added by DotEnvy on ${ts}\n${secret.suggestedEnvVar}=${encoded}\n`
                    : `# Added by DotEnvy on ${ts}\n${secret.suggestedEnvVar}=${encoded}\n`;
                await vscode.workspace.fs.writeFile(envUri, Buffer.from(newContent, 'utf8'));
            }

            // ✅ Training signal: confirmed secret
            await FeedbackManager.recordConfirmed(secret);

            this._remove(secret);
            vscode.window.showInformationMessage(`✅ ${secret.suggestedEnvVar} added to .env`);
            await FeedbackManager.offerAfterCorrection(secret, 'high');

        } catch (error) {
            logger.error('Failed to move secret to .env', error, 'SecretsPanel');
            vscode.window.showErrorMessage(`Failed: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    private async _ignore(secret: DetectedSecret): Promise<void> {
        // Save the local decision first; separately ask about optional numeric sharing.
        await FeedbackManager.recordFalsePositive(secret);
        this._remove(secret);

        const stats = await FeedbackManager.getStats();
        if (stats.falsePositives > 0 && stats.falsePositives % 5 === 0) {
            vscode.window.showInformationMessage(
                t('secretsScanner.correctionsSaved', {count: stats.falsePositives})
            );
        }
        await FeedbackManager.offerAfterCorrection(secret, 'false_positive');
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
            const method = s.detectionMethod === 'hybrid'
                ? t('secretsScanner.methodAi')
                : s.detectionMethod === 'pattern'
                ? t('secretsScanner.methodPattern')
                : t('secretsScanner.methodStatistical');
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
                    <button class="btn-view"   data-action="view"   data-index="${i}">${t('secretsScanner.view')}</button>
                    <button class="btn-move"   data-action="move"   data-index="${i}">${t('secretsScanner.moveToEnv')}</button>
                    <button class="btn-ignore" data-action="ignore" data-index="${i}" title="${t('secretsScanner.notASecretTitle')}">${t('secretsScanner.notASecret')}</button>
                </div>
            </div>`;
        }).join('');

        const json = JSON.stringify(secrets).replace(/</g, '\\u003c');
        
        const hintText = LLMAnalyzer.getInstance().isModelAvailable()
            ? t('secretsScanner.hintLocal') : t('secretsScanner.hintFallback');
        const statsHint = secrets.length > 0 
            ? `<div class="hint">${hintText}</div>`
            : '';
            
        const secretsContent = secrets.length === 0
            ? `<div class="empty"><div class="icon">✅</div><h3>${t('secretsScanner.emptyTitle')}</h3><p>${t('secretsScanner.emptyDesc')}</p></div>`
            : `<div class="secrets-list" id="list">${rows}</div>`;

        return loadWebviewHtml({
            webview: this._panel.webview,
            extensionUri: this._extensionUri,
            templatePath: ['resources', 'panel', 'secrets-scanner.html'],
            tokens: {
                title:          t('secretsScanner.title'),
                headerTitle:    t('secretsScanner.headerTitle'),
                allLabel:       t('secretsScanner.all'),
                highLabel:      t('secretsScanner.high'),
                mediumLabel:    t('secretsScanner.medium'),
                lowLabel:       t('secretsScanner.low'),
                searchPlaceholder: t('secretsScanner.filterPlaceholder'),
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

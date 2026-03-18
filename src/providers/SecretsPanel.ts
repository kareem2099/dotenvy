import * as vscode from 'vscode';
import * as path from 'path';
import { DetectedSecret } from '../utils/secretScannerTypes';
import { FeedbackManager } from '../utils/feedbackManager';
import { logger } from '../utils/logger';

export class SecretsPanel {
    public static currentPanel: SecretsPanel | undefined;
    private readonly _panel: vscode.WebviewPanel;
    private _secrets: DetectedSecret[] = [];
    private _disposables: vscode.Disposable[] = [];

    public static readonly viewType = 'dotenvy.secretsPanel';

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

        SecretsPanel.currentPanel = new SecretsPanel(panel, secrets);
        return SecretsPanel.currentPanel;
    }

    private constructor(panel: vscode.WebviewPanel, secrets: DetectedSecret[]) {
        this._panel   = panel;
        this._secrets = secrets;
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

        return `<!DOCTYPE html><html lang="en"><head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{
  --bg:var(--vscode-editor-background,#0d1117);
  --bg2:var(--vscode-sideBar-background,#161b22);
  --bg3:var(--vscode-input-background,#1c2128);
  --border:var(--vscode-panel-border,#30363d);
  --text:var(--vscode-editor-foreground,#c9d1d9);
  --dim:var(--vscode-descriptionForeground,#8b949e);
  --red:#f85149;--orange:#d29922;--blue:#58a6ff;
  --green:#3fb950;--purple:#bc8cff;--accent:#f78166;
}
body{background:var(--bg);color:var(--text);font-family:var(--vscode-font-family,'Segoe UI',sans-serif);font-size:13px}
.header{background:var(--bg2);border-bottom:1px solid var(--border);padding:14px 20px;position:sticky;top:0;z-index:10;display:flex;align-items:center;gap:12px;flex-wrap:wrap}
.header-title{font-size:15px;font-weight:700;flex:1}.header-title span{color:var(--accent)}
.stats{display:flex;gap:8px;flex-wrap:wrap}
.stat{display:flex;align-items:center;gap:5px;padding:3px 10px;border-radius:20px;font-size:12px;font-weight:600;border:1px solid;cursor:pointer;transition:opacity .15s}
.stat:hover{opacity:.8}.stat.active{opacity:1}.stat.inactive{opacity:.35}
.stat-all{color:var(--text);border-color:var(--border);background:var(--bg3)}
.stat-high{color:var(--red);border-color:var(--red);background:rgba(248,81,73,.1)}
.stat-medium{color:var(--orange);border-color:var(--orange);background:rgba(210,153,34,.1)}
.stat-low{color:var(--blue);border-color:var(--blue);background:rgba(88,166,255,.1)}
.filter-bar{padding:10px 20px;background:var(--bg2);border-bottom:1px solid var(--border)}
.filter-bar input{width:100%;background:var(--bg3);border:1px solid var(--border);color:var(--text);padding:6px 10px;border-radius:6px;font-size:12px;outline:none}
.filter-bar input:focus{border-color:var(--blue)}
.hint{margin:12px 20px 0;padding:8px 12px;background:rgba(188,140,255,.08);border:1px solid rgba(188,140,255,.25);border-radius:6px;font-size:11px;color:var(--purple)}
.empty{text-align:center;padding:60px 20px;color:var(--dim)}
.empty .icon{font-size:48px;margin-bottom:12px}
.empty h3{font-size:16px;color:var(--green);margin-bottom:8px}
.secrets-list{padding:12px 20px;display:flex;flex-direction:column;gap:8px}
.secret-row{background:var(--bg2);border:1px solid var(--border);border-radius:8px;overflow:hidden;transition:border-color .15s}
.secret-row:hover{border-color:var(--blue)}
.secret-row[data-confidence=high]{border-left:3px solid var(--red)}
.secret-row[data-confidence=medium]{border-left:3px solid var(--orange)}
.secret-row[data-confidence=low]{border-left:3px solid var(--blue)}
.secret-header{padding:8px 12px;display:flex;align-items:center;gap:8px;flex-wrap:wrap;background:var(--bg3);border-bottom:1px solid var(--border)}
.badge{font-size:10px;font-weight:700;padding:2px 6px;border-radius:4px;letter-spacing:.5px}
.badge.high{background:rgba(248,81,73,.2);color:var(--red)}
.badge.medium{background:rgba(210,153,34,.2);color:var(--orange)}
.badge.low{background:rgba(88,166,255,.2);color:var(--blue)}
.secret-type{font-weight:600;font-size:12px}
.secret-method{color:var(--dim);font-size:11px;margin-left:auto}
.secret-loc{color:var(--blue);font-size:11px;font-family:monospace;text-overflow:ellipsis;overflow:hidden;white-space:nowrap;max-width:200px}
.secret-body{padding:10px 12px}
.secret-value{display:block;font-family:monospace;font-size:12px;background:var(--bg);border:1px solid var(--border);padding:6px 10px;border-radius:4px;margin-bottom:8px;word-break:break-all;color:var(--accent)}
.secret-reasoning{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px}
.secret-reasoning span{font-size:11px;color:var(--dim);background:var(--bg3);border:1px solid var(--border);padding:2px 6px;border-radius:4px}
.secret-env{font-size:11px;color:var(--green);font-family:monospace}
.secret-actions{padding:8px 12px;display:flex;gap:8px;border-top:1px solid var(--border);flex-wrap:wrap}
button{padding:5px 12px;border-radius:5px;border:1px solid var(--border);background:var(--bg3);color:var(--text);font-size:12px;cursor:pointer;transition:all .15s}
button:hover{border-color:var(--blue);color:var(--blue)}
.btn-move{background:rgba(63,185,80,.1);border-color:var(--green);color:var(--green)}
.btn-move:hover{background:rgba(63,185,80,.2)}
.btn-ignore{background:rgba(188,140,255,.08);border-color:rgba(188,140,255,.35);color:var(--purple);margin-left:auto}
.btn-ignore:hover{background:rgba(188,140,255,.15);border-color:var(--purple)}
.count-badge{background:var(--bg3);border:1px solid var(--border);border-radius:10px;padding:2px 8px;font-size:11px;color:var(--dim)}
</style></head><body>
<div class="header">
  <div class="header-title">🔍 <span>DotEnvy</span> — Secrets Scanner</div>
  <div class="stats">
    <div class="stat stat-all active" onclick="filterBy('all')">All <span class="count-badge">${secrets.length}</span></div>
    <div class="stat stat-high ${high.length>0?'active':'inactive'}" onclick="filterBy('high')">⚠️ High <span class="count-badge">${high.length}</span></div>
    <div class="stat stat-medium ${medium.length>0?'active':'inactive'}" onclick="filterBy('medium')">⚡ Medium <span class="count-badge">${medium.length}</span></div>
    <div class="stat stat-low ${low.length>0?'active':'inactive'}" onclick="filterBy('low')">ℹ️ Low <span class="count-badge">${low.length}</span></div>
  </div>
</div>
<div class="filter-bar">
  <input type="text" placeholder="Filter by file, type, or variable name..." oninput="filterSearch(this.value)">
</div>
${secrets.length>0?'<div class="hint">🧠 Click <strong>Not a Secret</strong> on false positives — your feedback trains the AI to be smarter.</div>':''}
${secrets.length===0
    ? '<div class="empty"><div class="icon">✅</div><h3>No secrets detected!</h3><p>Your codebase looks clean.</p></div>'
    : `<div class="secrets-list" id="list">${rows}</div>`}
<script>
const vscode=acquireVsCodeApi(),secrets=${json};
let f='all',q='';
function viewLocation(i){vscode.postMessage({type:'viewLocation',secret:secrets[i]})}
function moveToEnv(i){vscode.postMessage({type:'moveToEnv',secret:secrets[i]})}
function ignore(i){vscode.postMessage({type:'ignore',secret:secrets[i]})}
function filterBy(l){f=l;apply();document.querySelectorAll('.stat').forEach(e=>{const m=e.getAttribute('onclick').includes("'"+l+"'");e.classList.toggle('active',m);e.classList.toggle('inactive',!m)})}
function filterSearch(v){q=v.toLowerCase();apply()}
function apply(){document.querySelectorAll('.secret-row').forEach(r=>{const c=r.getAttribute('data-confidence'),i=parseInt(r.getAttribute('data-index')),s=secrets[i],t=(s.file+s.type+s.suggestedEnvVar+s.content).toLowerCase();r.style.display=(f==='all'||c===f)&&(!q||t.includes(q))?'':'none'})}
</script></body></html>`;
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
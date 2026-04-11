import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Generates a cryptographically-adequate random nonce for CSP.
 */
export function getNonce(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let text = '';
    for (let i = 0; i < 32; i++) {
        text += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return text;
}

export interface WebviewHtmlOptions {
    /** URI of the webview */
    webview: vscode.Webview;
    /** Root URI of the extension (context.extensionUri) */
    extensionUri: vscode.Uri;
    /** Path segments relative to extensionUri for the HTML template, e.g. ['resources', 'panel', 'history-viewer.html'] */
    templatePath: string[];
    /** Additional named resources to expose as {{PLACEHOLDER}} tokens.
     *  Keys become UPPER_SNAKE_CASE tokens, e.g. { scriptUri: '...' } → {{SCRIPT_URI}} */
    tokens?: Record<string, string>;
}

/**
 * Reads an HTML template from disk and substitutes runtime tokens:
 *
 *  {{NONCE}}        — fresh nonce (also injected into CSP automatically)
 *  {{CSP_SOURCE}}   — webview.cspSource
 *  {{STYLE_URI}}    — the first resources/panel/*.css resolved webview URI  (if tokens.styleUri supplied)
 *  {{SCRIPT_URI}}   — (if tokens.scriptUri supplied)
 *  … any extra key in `tokens`
 */
export function loadWebviewHtml(opts: WebviewHtmlOptions): string {
    const { webview, extensionUri, templatePath, tokens = {} } = opts;

    const filePath = path.join(extensionUri.fsPath, ...templatePath);
    if (!fs.existsSync(filePath)) {
        return `<!DOCTYPE html><html><body><h2>Template not found: ${filePath}</h2></body></html>`;
    }

    const nonce = getNonce();
    let html = fs.readFileSync(filePath, 'utf8');

    // Built-in tokens
    html = html.replace(/\{\{NONCE\}\}/g, nonce);
    html = html.replace(/\{\{CSP_SOURCE\}\}/g, webview.cspSource);

    // Extra caller-supplied tokens
    for (const [key, value] of Object.entries(tokens)) {
        const token = `{{${toSnakeUpper(key)}}}`;
        html = html.replace(new RegExp(escapeRegex(token), 'g'), value);
    }

    return html;
}

// ── helpers ────────────────────────────────────────────────────────────────

function toSnakeUpper(camel: string): string {
    return camel
        .replace(/([A-Z])/g, '_$1')
        .toUpperCase()
        .replace(/^_/, '');
}

function escapeRegex(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

import * as vscode from 'vscode';
import * as crypto from 'crypto';
import * as path from 'path';
import { DetectedSecret } from './secretScannerTypes';

/** Read from the current document, verify the detection, and keep plaintext transient. */
export async function readDetectedValue(secret: DetectedSecret): Promise<{ value: string; workspace: vscode.WorkspaceFolder }> {
    if (!secret.sourceFile || !secret.valueLength || !secret.valueDigest) {
        throw new Error('This detection is stale. Scan the file again.');
    }
    const source = vscode.Uri.file(secret.sourceFile);
    const workspace = vscode.workspace.getWorkspaceFolder(source);
    if (!workspace || path.relative(workspace.uri.fsPath, secret.sourceFile).startsWith('..')) {
        throw new Error('The detected file is outside the workspace.');
    }
    const document = await vscode.workspace.openTextDocument(source);
    const line = document.lineAt(secret.line - 1).text;
    const value = line.slice(secret.column - 1, secret.column - 1 + secret.valueLength);
    const digest = crypto.createHash('sha256').update(value).digest('hex');
    if (digest !== secret.valueDigest) {
        throw new Error('The source value changed. Scan the file again before moving it.');
    }
    return { value, workspace };
}

export function encodeEnvValue(value: string): string {
    return /^[A-Za-z0-9_./:@+-]+$/.test(value) ? value : JSON.stringify(value);
}

/**
 * Underlines local secret matches in open editors. Does not call the analysis service.
 */

import * as vscode from 'vscode';
import { DotenvyIgnore } from '../utils/dotenvyIgnore';
import { SecretDetector } from '../utils/secretDetector';
import { FeedbackManager } from '../utils/feedbackManager';
import { logger } from '../utils/logger';
import { PatternRegistry } from '../utils/patternRegistry';

const DEBOUNCE_MS = 50;

function shouldScanDocument(document: vscode.TextDocument): boolean {
	if (document.uri.scheme !== 'file') {
		return false;
	}

	const folder = vscode.workspace.getWorkspaceFolder(document.uri);
	if (!folder) {
		return false;
	}

	const rootPath = folder.uri.fsPath;
	const filePath = document.uri.fsPath;
	if (DotenvyIgnore.shouldIgnore(filePath, rootPath)) {
		return false;
	}

	return PatternRegistry.shouldScanFile(filePath, rootPath);
}

/**
 * Publishes warning diagnostics for locally classified matches, respecting saved corrections in open files.
 */
export function registerSecretDiagnostics(context: vscode.ExtensionContext): vscode.Disposable {
	const collection = vscode.languages.createDiagnosticCollection('dotenvy-secrets');
	const timers = new Map<string, NodeJS.Timeout>();

    const revisions = new Map<string, number>();
    let disposed = false;
    const refresh = async (document: vscode.TextDocument): Promise<void> => {
        const key = document.uri.toString();
        const revision = (revisions.get(key) ?? 0) + 1;
        revisions.set(key, revision);
        if (disposed) return;
        if (!shouldScanDocument(document)) {
            collection.delete(document.uri);
            return;
        }
        const version = document.version;
        try {
            const secrets = await SecretDetector.scanText(document.uri.fsPath, document.getText());
            if (disposed || document.isClosed || document.version !== version || revisions.get(key) !== revision) return;
            const diagnostics = secrets.map(secret => new vscode.Diagnostic(
                new vscode.Range(secret.line - 1, secret.column - 1,
                    secret.line - 1, secret.column - 1 + (secret.valueLength ?? secret.content.length)),
                secret.type, vscode.DiagnosticSeverity.Warning,
            ));
            collection.set(document.uri, diagnostics);
        } catch {
            logger.warn('Editor secret scan unavailable.', 'SecretDiagnostics');
        }
    };

	const schedule = (document: vscode.TextDocument): void => {
		const key = document.uri.toString();
		const existing = timers.get(key);
		if (existing) {
			clearTimeout(existing);
		}
		const timer = setTimeout(() => {
			timers.delete(key);
			void refresh(document);
		}, DEBOUNCE_MS);
		timers.set(key, timer);
	};

	const subscriptions: vscode.Disposable[] = [
        collection,
        FeedbackManager.onDidChange(sourceFile => {
            for (const document of vscode.workspace.textDocuments) {
                if (!sourceFile || document.uri.fsPath === sourceFile) schedule(document);
            }
        }),
		vscode.workspace.onDidOpenTextDocument(document => { void refresh(document); }),
		vscode.workspace.onDidChangeTextDocument(event => schedule(event.document)),
		vscode.workspace.onDidCloseTextDocument(document => {
			const key = document.uri.toString();
			const existing = timers.get(key);
			if (existing) {
				clearTimeout(existing);
				timers.delete(key);
			}
			revisions.set(key, (revisions.get(key) ?? 0) + 1);
			collection.delete(document.uri);
		}),
		{
			dispose: () => {
                disposed = true;
                revisions.clear();
				for (const timer of timers.values()) {
					clearTimeout(timer);
				}
				timers.clear();
			},
		},
	];

	for (const document of vscode.workspace.textDocuments) {
		void refresh(document);
	}

	const disposable = vscode.Disposable.from(...subscriptions);
	context.subscriptions.push(disposable);
	return disposable;
}

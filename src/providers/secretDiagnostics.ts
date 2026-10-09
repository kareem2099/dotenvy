/**
 * Underlines local secret matches in open editors. Does not call the analysis service.
 */

import * as vscode from 'vscode';
import { DotenvyIgnore } from '../utils/dotenvyIgnore';
import { scanText } from '../utils/localSecretScan';
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
 * Publishes warning diagnostics for pattern-and-entropy matches in open files.
 */
export function registerSecretDiagnostics(context: vscode.ExtensionContext): vscode.Disposable {
	const collection = vscode.languages.createDiagnosticCollection('dotenvy-secrets');
	const timers = new Map<string, NodeJS.Timeout>();

	const refresh = (document: vscode.TextDocument): void => {
		if (!shouldScanDocument(document)) {
			collection.delete(document.uri);
			return;
		}

		const diagnostics = scanText(document.getText()).map(span => new vscode.Diagnostic(
			new vscode.Range(span.line - 1, span.start, span.line - 1, span.end),
			span.type,
			vscode.DiagnosticSeverity.Warning,
		));
		collection.set(document.uri, diagnostics);
	};

	const schedule = (document: vscode.TextDocument): void => {
		const key = document.uri.toString();
		const existing = timers.get(key);
		if (existing) {
			clearTimeout(existing);
		}
		const timer = setTimeout(() => {
			timers.delete(key);
			refresh(document);
		}, DEBOUNCE_MS);
		timers.set(key, timer);
	};

	const subscriptions: vscode.Disposable[] = [
		collection,
		vscode.workspace.onDidOpenTextDocument(document => refresh(document)),
		vscode.workspace.onDidChangeTextDocument(event => schedule(event.document)),
		vscode.workspace.onDidCloseTextDocument(document => {
			const key = document.uri.toString();
			const existing = timers.get(key);
			if (existing) {
				clearTimeout(existing);
				timers.delete(key);
			}
			collection.delete(document.uri);
		}),
		{
			dispose: () => {
				for (const timer of timers.values()) {
					clearTimeout(timer);
				}
				timers.clear();
			},
		},
	];

	for (const document of vscode.workspace.textDocuments) {
		refresh(document);
	}

	const disposable = vscode.Disposable.from(...subscriptions);
	context.subscriptions.push(disposable);
	return disposable;
}

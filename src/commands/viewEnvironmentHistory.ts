import * as vscode from 'vscode';
import { HistoryManager } from '../utils/historyManager';
import { HistoryEntry } from '../types/environment';
import { EnvironmentDiffer } from '../utils/environmentDiffer';
import { WorkspaceManager } from '../providers/workspaceManager';
import { HistoryWebviewProvider } from '../providers/historyWebviewProvider';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { t } from '../i18n';

export class ViewEnvironmentHistoryCommand implements vscode.Disposable {
	private disposables: vscode.Disposable[] = [];
	private commandDisposable?: vscode.Disposable;

	constructor() {
		this.registerCommand();
	}

	private registerCommand(): vscode.Disposable {
		this.commandDisposable = vscode.commands.registerCommand('dotenvy.viewEnvironmentHistory', () => {
			// Open the full History WebviewPanel instead of the old QuickPick flow
			HistoryWebviewProvider.openOrReveal();
		});

		// Store for proper disposal
		this.disposables.push(this.commandDisposable);
		return this.commandDisposable;
	}

	public async execute(): Promise<void> {
		const workspaceManager = WorkspaceManager.getInstance();
		const allWorkspaces = workspaceManager.getAllWorkspaces();

		if (allWorkspaces.length === 0) {
			vscode.window.showErrorMessage(t('common.noWorkspace'));
			return;
		}

		// If multiple workspaces, let user choose which one
		let selectedWorkspace;
		if (allWorkspaces.length === 1) {
			selectedWorkspace = allWorkspaces[0];
		} else {
			const workspaceItems = workspaceManager.getWorkspaceQuickPickItems();
			const selectedItem = await vscode.window.showQuickPick(workspaceItems, {
				placeHolder: t('history.workspacePlaceholder')
			});

			if (!selectedItem) return;

			selectedWorkspace = allWorkspaces.find(
				ws => ws.workspace.name === selectedItem.label && ws.workspace.uri.fsPath === selectedItem.description
			);
		}

		if (!selectedWorkspace) return;

		const workspace = selectedWorkspace.workspace;
		const rootPath = workspace.uri.fsPath;

		try {
			// Get history entries
			const history = await HistoryManager.getHistory(rootPath, 50); // Limit to last 50 entries

			if (history.length === 0) {
				vscode.window.showInformationMessage(t('history.noneForWorkspace', { name: workspace.name }));
				return;
			}

			// Create quick pick items for history entries
			const historyItems = history.map(entry => ({
				label: `${entry.action.toUpperCase()}: ${entry.environmentName}`,
				description: this.formatTimestamp(entry.timestamp),
				detail: this.formatHistoryDetail(entry),
				entry: entry
			}));

			const selectedHistory = await vscode.window.showQuickPick(historyItems, {
				placeHolder: t('history.entryPlaceholder', { count: history.length }),
				matchOnDescription: true
			});

			if (!selectedHistory) return;

			// Show history entry details and actions
			await this.showHistoryEntryDetails(selectedHistory.entry, rootPath);

		} catch (error) {
			vscode.window.showErrorMessage(t('history.loadCommandFailed', { message: (error as Error).message }));
		}
	}

	private formatTimestamp(timestamp: Date): string {
		const now = new Date();
		const diffMs = now.getTime() - timestamp.getTime();
		const diffMinutes = Math.floor(diffMs / (1000 * 60));
		const diffHours = Math.floor(diffMinutes / 60);
		const diffDays = Math.floor(diffHours / 24);

		if (diffMinutes < 1) return t('history.justNow');
		if (diffMinutes < 60) return t('history.minutesAgo', { count: diffMinutes });
		if (diffHours < 24) return t('history.hoursAgo', { count: diffHours });
		if (diffDays < 7) return t('history.daysAgo', { count: diffDays });

		return timestamp.toLocaleDateString();
	}

	private formatHistoryDetail(entry: HistoryEntry): string {
		let detail = '';

		if (entry.previousEnvironment) {
			detail += t('history.fromTo', { from: entry.previousEnvironment, to: entry.environmentName });
		} else {
			detail += t('history.environmentDetail', { name: entry.environmentName });
		}

		if (entry.user) {
			detail += ` | ${t('history.userDetail', { user: entry.user })}`;
		}

		if (entry.metadata.reason) {
			detail += ` | ${entry.metadata.reason}`;
		}

		return detail;
	}

	private async showHistoryEntryDetails(entry: HistoryEntry, rootPath: string): Promise<void> {
		const actions = [
			{ label: t('history.viewContent'), description: t('history.viewContentDesc'), action: 'view' },
			{ label: t('history.viewDiff'), description: t('history.viewDiffDesc'), action: 'diff' },
			{ label: t('history.rollback'), description: t('history.rollbackDesc'), action: 'rollback' },
			{ label: t('history.copyContent'), description: t('history.copyContentDesc'), action: 'copy' }
		];

		const selectedAction = await vscode.window.showQuickPick(actions, {
			placeHolder: t('history.actionPlaceholder')
		});

		if (!selectedAction) return;

		switch (selectedAction.action) {
			case 'view':
				await this.viewHistoryContent(entry);
				break;
			case 'diff':
				await this.viewHistoryDiff(entry, rootPath);
				break;
			case 'rollback':
				await this.rollbackToHistoryEntry(entry, rootPath);
				break;
			case 'copy':
				await vscode.env.clipboard.writeText(entry.fileContent);
				vscode.window.showInformationMessage(t('history.copied'));
				break;
		}
	}

	private async viewHistoryContent(entry: HistoryEntry): Promise<void> {
		const doc = await vscode.workspace.openTextDocument({
			content: entry.fileContent,
			language: 'properties'
		});

		await vscode.window.showTextDocument(doc, { preview: true });
	}

	private async viewHistoryDiff(entry: HistoryEntry, rootPath: string): Promise<void> {
		// Use path module for cross-platform path operations
		const currentEnvPath = path.join(rootPath, '.env');

		try {
			// Create temporary file for historical content using path.join for proper path construction
			const tempDir = os.tmpdir();
			const tempFile = path.join(tempDir, `dotenvy-history-${entry.id}.env`);
			fs.writeFileSync(tempFile, entry.fileContent);

			// Generate diff
			const diff = EnvironmentDiffer.compareFiles(tempFile, currentEnvPath);
			const diffText = EnvironmentDiffer.formatDiffForDisplay(diff, entry.environmentName, 'Current');

			// Clean up temp file
			fs.unlinkSync(tempFile);

			// Show diff
			const doc = await vscode.workspace.openTextDocument({
				content: diffText,
				language: 'diff'
			});

			await vscode.window.showTextDocument(doc, { preview: true });

		} catch (error) {
			vscode.window.showErrorMessage(t('history.generateDiffFailed', { message: (error as Error).message }));
		}
	}

	private async rollbackToHistoryEntry(entry: HistoryEntry, rootPath: string): Promise<void> {
		const rollbackAction = t('history.rollbackAction');
		const confirm = await vscode.window.showWarningMessage(
			t('history.rollbackConfirm', {
				time: entry.timestamp.toLocaleString(),
				environment: entry.environmentName
			}),
			{ modal: true },
			rollbackAction,
			t('common.cancel')
		);

		if (confirm !== rollbackAction) return;

		const reason = await vscode.window.showInputBox({
			prompt: t('history.rollbackReasonPrompt'),
			placeHolder: t('history.rollbackReasonPlaceholder')
		});

		try {
			const success = await HistoryManager.rollbackToEntry(rootPath, entry.id, reason);

			if (success) {
				vscode.window.showInformationMessage(
					t('history.rollbackSuccess', { time: entry.timestamp.toLocaleString() })
				);

				// Refresh status bar and other UI elements
				const workspaceManager = WorkspaceManager.getInstance();
				const workspaceData = workspaceManager.getAllWorkspaces().find(
					ws => ws.workspace.uri.fsPath === rootPath
				);

				if (workspaceData?.statusBarProvider) {
					workspaceData.statusBarProvider.forceRefresh();
				}
			} else {
				vscode.window.showErrorMessage(t('history.rollbackFailed'));
			}
		} catch (error) {
			vscode.window.showErrorMessage(t('history.rollbackCommandFailed', { message: (error as Error).message }));
		}
	}

	public dispose(): void {
		// Dispose of all stored disposables for proper cleanup
		this.disposables.forEach(disposable => disposable.dispose());
		this.disposables.length = 0;

		// Clear references
		this.commandDisposable = undefined;
	}
}

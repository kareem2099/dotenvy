import * as vscode from 'vscode';
import { HistoryManager } from '../utils/historyManager';
import { HistoryEntry } from '../types/environment';
import { EnvironmentDiffer } from '../utils/environmentDiffer';
import { WorkspaceManager } from '../providers/workspaceManager';
import * as path from 'path';

export class ViewEnvironmentHistoryCommand implements vscode.Disposable {
	constructor() {
		this.registerCommand();
	}

	private registerCommand() {
		const disposable = vscode.commands.registerCommand('dotenvy.viewEnvironmentHistory', () => {
			this.execute();
		});
	}

	public async execute(): Promise<void> {
		const workspaceManager = WorkspaceManager.getInstance();
		const allWorkspaces = workspaceManager.getAllWorkspaces();

		if (allWorkspaces.length === 0) {
			vscode.window.showErrorMessage('No workspace folder open.');
			return;
		}

		// If multiple workspaces, let user choose which one
		let selectedWorkspace;
		if (allWorkspaces.length === 1) {
			selectedWorkspace = allWorkspaces[0];
		} else {
			const workspaceItems = workspaceManager.getWorkspaceQuickPickItems();
			const selectedItem = await vscode.window.showQuickPick(workspaceItems, {
				placeHolder: 'Select workspace to view history for'
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
				vscode.window.showInformationMessage(`No environment history found for workspace "${workspace.name}".`);
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
				placeHolder: `Select history entry (${history.length} total)`,
				matchOnDescription: true
			});

			if (!selectedHistory) return;

			// Show history entry details and actions
			await this.showHistoryEntryDetails(selectedHistory.entry, rootPath);

		} catch (error) {
			vscode.window.showErrorMessage(`Failed to load environment history: ${(error as Error).message}`);
		}
	}

	private formatTimestamp(timestamp: Date): string {
		const now = new Date();
		const diffMs = now.getTime() - timestamp.getTime();
		const diffMinutes = Math.floor(diffMs / (1000 * 60));
		const diffHours = Math.floor(diffMinutes / 60);
		const diffDays = Math.floor(diffHours / 24);

		if (diffMinutes < 1) return 'Just now';
		if (diffMinutes < 60) return `${diffMinutes}m ago`;
		if (diffHours < 24) return `${diffHours}h ago`;
		if (diffDays < 7) return `${diffDays}d ago`;

		return timestamp.toLocaleDateString();
	}

	private formatHistoryDetail(entry: HistoryEntry): string {
		let detail = '';

		if (entry.previousEnvironment) {
			detail += `From: ${entry.previousEnvironment} → To: ${entry.environmentName}`;
		} else {
			detail += `Environment: ${entry.environmentName}`;
		}

		if (entry.user) {
			detail += ` | User: ${entry.user}`;
		}

		if (entry.metadata.reason) {
			detail += ` | ${entry.metadata.reason}`;
		}

		return detail;
	}

	private async showHistoryEntryDetails(entry: HistoryEntry, rootPath: string): Promise<void> {
		const actions = [
			{ label: 'View Content', description: 'Show the .env file content at this point', action: 'view' },
			{ label: 'View Diff', description: 'Compare with current environment', action: 'diff' },
			{ label: 'Rollback', description: 'Restore this environment state', action: 'rollback' },
			{ label: 'Copy Content', description: 'Copy content to clipboard', action: 'copy' }
		];

		const selectedAction = await vscode.window.showQuickPick(actions, {
			placeHolder: `What would you like to do with this history entry?`
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
				vscode.window.showInformationMessage('Environment content copied to clipboard');
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
		const currentEnvPath = `${rootPath}/.env`;

		try {
			// Create temporary file for historical content
			const tempDir = require('os').tmpdir();
			const tempFile = `${tempDir}/dotenvy-history-${entry.id}.env`;
			require('fs').writeFileSync(tempFile, entry.fileContent);

			// Generate diff
			const diff = EnvironmentDiffer.compareFiles(tempFile, currentEnvPath);
			const diffText = EnvironmentDiffer.formatDiffForDisplay(diff, entry.environmentName, 'Current');

			// Clean up temp file
			require('fs').unlinkSync(tempFile);

			// Show diff
			const doc = await vscode.workspace.openTextDocument({
				content: diffText,
				language: 'diff'
			});

			await vscode.window.showTextDocument(doc, { preview: true });

		} catch (error) {
			vscode.window.showErrorMessage(`Failed to generate diff: ${(error as Error).message}`);
		}
	}

	private async rollbackToHistoryEntry(entry: HistoryEntry, rootPath: string): Promise<void> {
		const confirm = await vscode.window.showWarningMessage(
			`Are you sure you want to rollback to the environment state from ${entry.timestamp.toLocaleString()}?\n\n` +
			`This will replace your current .env file with the historical version.`,
			{ modal: true },
			'Rollback',
			'Cancel'
		);

		if (confirm !== 'Rollback') return;

		// Ask for rollback reason
		const reason = await vscode.window.showInputBox({
			prompt: 'Optional: Enter a reason for this rollback',
			placeHolder: 'e.g., Reverting accidental changes'
		});

		try {
			const success = await HistoryManager.rollbackToEntry(rootPath, entry.id, reason);

			if (success) {
				vscode.window.showInformationMessage(
					`Successfully rolled back to environment state from ${entry.timestamp.toLocaleString()}`
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
				vscode.window.showErrorMessage('Failed to rollback to the selected environment state');
			}
		} catch (error) {
			vscode.window.showErrorMessage(`Rollback failed: ${(error as Error).message}`);
		}
	}

	public dispose() {
		// Commands are disposed via vscode subscriptions
	}
}

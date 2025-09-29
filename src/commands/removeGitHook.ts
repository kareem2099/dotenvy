import * as vscode from 'vscode';
import { GitHookManager } from '../utils/gitHookManager';
import { GitUtils } from '../utils/gitUtils';
import { WorkspaceManager } from '../providers/workspaceManager';

export class RemoveGitHookCommand implements vscode.Disposable {
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
				placeHolder: 'Select workspace to remove Git hook from'
			});

			if (!selectedItem) return;

			selectedWorkspace = allWorkspaces.find(
				ws => ws.workspace.name === selectedItem.label && ws.workspace.uri.fsPath === selectedItem.description
			);
		}

		if (!selectedWorkspace) return;

		const workspace = selectedWorkspace.workspace;
		const workspacePath = workspace.uri.fsPath;

		// Check if it's a Git repository
		if (!await GitUtils.isGitRepository(workspacePath)) {
			vscode.window.showErrorMessage('This workspace is not a Git repository.');
			return;
		}

		// Check if hook is installed
		if (!GitHookManager.isHookInstalled(workspacePath)) {
			vscode.window.showInformationMessage('No dotenvy Git hook found to remove.');
			return;
		}

		// Confirm removal
		const confirm = await vscode.window.showWarningMessage(
			'Remove dotenvy pre-commit hook?',
			'Yes',
			'Cancel'
		);

		if (confirm !== 'Yes') {
			return;
		}

		try {
			await GitHookManager.removeHook(workspacePath);
			vscode.window.showInformationMessage('dotenvy commit hook successfully removed.');
		} catch (error) {
			vscode.window.showErrorMessage(`Failed to remove Git hook: ${(error as Error).message}`);
		}
	}

	public dispose() {
		// Commands are disposed via vscode subscriptions
	}
}

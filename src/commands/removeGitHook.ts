import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { GitHookManager } from '../utils/gitHookManager';
import { WorkspaceManager } from '../providers/workspaceManager';

export class RemoveGitHookCommand implements vscode.Disposable {
	public async execute(preferredWorkspacePath?: string): Promise<void> {
		const workspacePath = await WorkspaceManager.resolveWorkspacePath(preferredWorkspacePath, 'Select workspace to remove Git hook from');

		if (!workspacePath) {
			vscode.window.showErrorMessage('No workspace folder open.');
			return;
		}

		if (!fs.existsSync(path.join(workspacePath, '.git'))) {
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

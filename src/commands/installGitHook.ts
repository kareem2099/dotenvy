import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { GitHookManager } from '../utils/gitHookManager';
import { GitUtils } from '../utils/gitUtils';
import { WorkspaceManager } from '../providers/workspaceManager';
import { ConfigUtils } from '../utils/configUtils';

export class InstallGitHookCommand implements vscode.Disposable {
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
				placeHolder: 'Select workspace to install Git hook in'
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

		// Check if hook is already installed
		if (GitHookManager.isHookInstalled(workspacePath)) {
			const overwrite = await vscode.window.showWarningMessage(
				'Git hook is already installed. Overwrite?',
				'Yes',
				'Cancel'
			);

			if (overwrite !== 'Yes') {
				return;
			}
		}

		try {
			await GitHookManager.installHook(workspacePath);

			// Auto-configure the gitCommitHook settings in .dotenvy.json
			const configPath = path.join(workspacePath, '.dotenvyGit.json');
			let config: any = {};
			try {
				if (fs.existsSync(configPath)) {
					const content = fs.readFileSync(configPath, 'utf8');
					config = JSON.parse(content);
				}
			} catch (error) {
				// If error reading, proceed with empty config
			}

			if (!config.gitCommitHook) {
				config.gitCommitHook = {
					"blockEnvFiles": true,
					"blockSecrets": true,
					"blockValidationErrors": true,
					"customMessage": "Commit blocked due to security concerns"
				};
				fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
			}

			// Auto-add config files to .gitignore
			const gitignorePath = path.join(workspacePath, '.gitignore');
			let gitignoreContent = '';
			try {
				if (fs.existsSync(gitignorePath)) {
					gitignoreContent = fs.readFileSync(gitignorePath, 'utf8');
				}
			} catch (error) {
				// Ignore
			}

			const ignoreEntries = ['.dotenvy.json', '.dotenvyGit.json'];
			let updated = false;
			for (const entry of ignoreEntries) {
				if (!gitignoreContent.includes(entry)) {
					gitignoreContent += `\n${entry}`;
					updated = true;
				}
			}

			if (updated) {
				fs.writeFileSync(gitignorePath, gitignoreContent);
			}

			// Show information about what the hook does
			vscode.window.showInformationMessage(
				'Git commit hook installed! It will scan staged files for:\n\n' +
				'• .env files (blocks by default)\n' +
				'• Secrets in any file (API keys, passwords, etc.)\n' +
				'• Environment validation errors'
			);

		} catch (error) {
			vscode.window.showErrorMessage(`Failed to install Git hook: ${(error as Error).message}`);
		}
	}

	public dispose() {
		// Commands are disposed via vscode subscriptions
	}
}

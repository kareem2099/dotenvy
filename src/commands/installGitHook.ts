import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { GitHookManager } from '../utils/gitHookManager';
import { GitCommitHookConfig } from '../types/environment';
import { WorkspaceManager } from '../providers/workspaceManager';

interface GitHookFileConfig {
    gitCommitHook?: GitCommitHookConfig;
}

export class InstallGitHookCommand implements vscode.Disposable {
	public async execute(preferredWorkspacePath?: string): Promise<void> {
		const workspacePath = await WorkspaceManager.resolveWorkspacePath(preferredWorkspacePath, 'Select workspace to install Git hook in');

		if (!workspacePath) {
			vscode.window.showErrorMessage('No workspace folder open.');
			return;
		}

		if (!fs.existsSync(path.join(workspacePath, '.git'))) {
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
			let config: GitHookFileConfig = {};
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

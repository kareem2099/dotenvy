import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { GitHookManager } from '../utils/gitHookManager';
import { GitCommitHookConfig } from '../types/environment';
import { WorkspaceManager } from '../providers/workspaceManager';
import { showActionStart, showSyncToast } from '../utils/panelNotification';
import { t } from '../i18n';

interface GitHookFileConfig {
	gitCommitHook?: GitCommitHookConfig;
}

export class InstallGitHookCommand implements vscode.Disposable {
	public async execute(preferredWorkspacePath?: string): Promise<void> {
		showActionStart(t('gitHook.install.actionStart'));

		const workspacePath = await WorkspaceManager.resolveWorkspacePath(
			preferredWorkspacePath,
			t('common.selectWorkspace')
		);

		if (!workspacePath) {
			showSyncToast(t('gitHook.install.cancelledNoWorkspace'), 'info');
			return;
		}

		const gitRoot = GitHookManager.resolveGitRoot(workspacePath);
		if (!gitRoot) {
			showSyncToast(t('common.notGitRepo'), 'error');
			return;
		}

		const cancelLabel = t('common.cancel');
		if (GitHookManager.isHookInstalled(workspacePath)) {
			const yesLabel = t('common.yes');
			const overwrite = await vscode.window.showWarningMessage(
				t('gitHook.install.alreadyInstalled'),
				{ modal: true },
				yesLabel,
				cancelLabel
			);

			if (overwrite !== yesLabel) {
				showSyncToast(t('gitHook.install.cancelled'), 'info');
				return;
			}
		} else if (GitHookManager.hasPreCommitHook(workspacePath)) {
			const overwriteLabel = t('common.overwrite');
			const overwrite = await vscode.window.showWarningMessage(
				t('gitHook.install.existingHook'),
				{ modal: true },
				overwriteLabel,
				cancelLabel
			);

			if (overwrite !== overwriteLabel) {
				showSyncToast(t('gitHook.install.cancelled'), 'info');
				return;
			}
		}

		try {
			await GitHookManager.installHook(workspacePath);

			const configPath = path.join(workspacePath, '.dotenvyGit.json');
			let config: GitHookFileConfig = {};
			try {
				if (fs.existsSync(configPath)) {
					const content = fs.readFileSync(configPath, 'utf8');
					config = JSON.parse(content);
				}
			} catch {
				// proceed with empty config
			}

			if (!config.gitCommitHook) {
				config.gitCommitHook = {
					blockEnvFiles: true,
					blockSecrets: true,
					blockValidationErrors: true,
					customMessage: 'Commit blocked due to security concerns'
				};
				fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
			}

			const gitignorePath = path.join(workspacePath, '.gitignore');
			let gitignoreContent = '';
			try {
				if (fs.existsSync(gitignorePath)) {
					gitignoreContent = fs.readFileSync(gitignorePath, 'utf8');
				}
			} catch {
				// ignore
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

			showSyncToast(
				t('gitHook.install.success'),
				'success'
			);
		} catch (error) {
			showSyncToast(t('gitHook.install.failed', { message: (error as Error).message }), 'error');
		}
	}

	public dispose() {
		// Commands are disposed via vscode subscriptions
	}
}

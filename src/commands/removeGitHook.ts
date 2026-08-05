import * as vscode from 'vscode';
import { GitHookManager } from '../utils/gitHookManager';
import { WorkspaceManager } from '../providers/workspaceManager';
import { showActionStart, showSyncToast } from '../utils/panelNotification';
import { t } from '../i18n';

export class RemoveGitHookCommand implements vscode.Disposable {
	public async execute(preferredWorkspacePath?: string): Promise<void> {
		showActionStart(t('gitHook.remove.actionStart'));

		const workspacePath = await WorkspaceManager.resolveWorkspacePath(
			preferredWorkspacePath,
			t('common.selectWorkspace')
		);

		if (!workspacePath) {
			showSyncToast(t('gitHook.remove.cancelledNoWorkspace'), 'info');
			return;
		}

		const gitRoot = GitHookManager.resolveGitRoot(workspacePath);
		if (!gitRoot) {
			showSyncToast(t('common.notGitRepo'), 'error');
			return;
		}

		if (!GitHookManager.isHookInstalled(workspacePath)) {
			if (GitHookManager.hasPreCommitHook(workspacePath)) {
				showSyncToast(
					t('gitHook.remove.nonDotenvyHook'),
					'warning'
				);
			} else {
				showSyncToast(t('gitHook.remove.noneToRemove'), 'info');
			}
			return;
		}

		const removeLabel = t('common.remove');
		const cancelLabel = t('common.cancel');
		const confirm = await vscode.window.showWarningMessage(
			t('gitHook.remove.confirm'),
			{ modal: true },
			removeLabel,
			cancelLabel
		);

		if (confirm !== removeLabel) {
			showSyncToast(t('gitHook.remove.cancelled'), 'info');
			return;
		}

		try {
			await GitHookManager.removeHook(workspacePath);
			showSyncToast(t('gitHook.remove.success'), 'success');
		} catch (error) {
			showSyncToast(t('gitHook.remove.failed', { message: (error as Error).message }), 'error');
		}
	}

	public dispose() {
		// Commands are disposed via vscode subscriptions
	}
}

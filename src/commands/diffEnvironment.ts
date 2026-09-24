import * as vscode from 'vscode';
import { EnvironmentDiffer } from '../utils/environmentDiffer';
import { WorkspaceManager } from '../providers/workspaceManager';
import { showSyncToast } from '../utils/panelNotification';
import { t } from '../i18n';

export class DiffEnvironmentCommand implements vscode.Disposable {
	public async execute(): Promise<void> {
		const workspaceManager = WorkspaceManager.getInstance();
		const allWorkspaces = workspaceManager.getAllWorkspaces();

		if (allWorkspaces.length === 0) {
			showSyncToast(t('common.noWorkspace'), 'error');
			return;
		}

		// If multiple workspaces, let user choose which one
		let selectedWorkspace;
		if (allWorkspaces.length === 1) {
			selectedWorkspace = allWorkspaces[0];
		} else {
			const workspaceItems = workspaceManager.getWorkspaceQuickPickItems();
			const selectedItem = await vscode.window.showQuickPick(workspaceItems, {
				placeHolder: t('diff.workspacePlaceholder')
			});

			if (!selectedItem) return;

			selectedWorkspace = allWorkspaces.find(
				ws => ws.workspace.name === selectedItem.label && ws.workspace.uri.fsPath === selectedItem.description
			);
		}

		if (!selectedWorkspace) return;

		const workspace = selectedWorkspace.workspace;
		const rootPath = workspace.uri.fsPath;
		const environmentProvider = selectedWorkspace.environmentProvider;

        // Get all environments
        const environments = await environmentProvider.getEnvironments();
        if (environments.length < 2) {
            showSyncToast(t('diff.needTwo'), 'warning');
            return;
        }

        // Select source environment
        const items = environments.map(env => ({
            label: env.name,
            description: env.fileName,
            detail: env.filePath,
            env: env
        }));

        const sourceSelection = await vscode.window.showQuickPick(items, {
            placeHolder: t('diff.sourcePlaceholder')
        });

        if (!sourceSelection) return;

        // Select target environment
        const remainingItems = items.filter(item => item.env.name !== sourceSelection.env.name);
        const targetSelection = await vscode.window.showQuickPick(remainingItems, {
            placeHolder: t('diff.targetPlaceholder')
        });

        if (!targetSelection) return;

        // Perform diff
        try {
            // Ensure files are within workspace
            const sourcePath = sourceSelection.env.filePath;
            const targetPath = targetSelection.env.filePath;

            if (!sourcePath.startsWith(rootPath) || !targetPath.startsWith(rootPath)) {
                showSyncToast(t('diff.filesOutsideWorkspace'), 'error');
                return;
            }

            const diff = EnvironmentDiffer.compareFiles(sourcePath, targetPath);
            const diffText = EnvironmentDiffer.formatDiffForDisplay(diff, sourceSelection.env.name, targetSelection.env.name);

            // Show diff in a new document
            const doc = await vscode.workspace.openTextDocument({
                content: diffText,
                language: 'diff'
            });
            await vscode.window.showTextDocument(doc, { preview: true });

        } catch (error) {
            showSyncToast(t('diff.failed', { message: (error as Error).message }), 'error');
        }
    }

    public dispose() {
        // Commands are disposed via vscode subscriptions
    }
}

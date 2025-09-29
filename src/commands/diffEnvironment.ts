import * as vscode from 'vscode';
import { EnvironmentProvider } from '../providers/environmentProvider';
import { EnvironmentDiffer } from '../utils/environmentDiffer';
import { WorkspaceManager } from '../providers/workspaceManager';

export class DiffEnvironmentCommand implements vscode.Disposable {
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
				placeHolder: 'Select workspace for diff'
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
            vscode.window.showInformationMessage('Need at least 2 environment files to compare.');
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
            placeHolder: 'Select source environment (current state)'
        });

        if (!sourceSelection) return;

        // Select target environment
        const remainingItems = items.filter(item => item.env.name !== sourceSelection.env.name);
        const targetSelection = await vscode.window.showQuickPick(remainingItems, {
            placeHolder: 'Select target environment to compare'
        });

        if (!targetSelection) return;

        // Perform diff
        try {
            const diff = EnvironmentDiffer.compareFiles(sourceSelection.env.filePath, targetSelection.env.filePath);
            const diffText = EnvironmentDiffer.formatDiffForDisplay(diff, sourceSelection.env.name, targetSelection.env.name);

            // Show diff in a new document
            const doc = await vscode.workspace.openTextDocument({
                content: diffText,
                language: 'diff'
            });
            await vscode.window.showTextDocument(doc, { preview: true });

        } catch (error) {
            vscode.window.showErrorMessage(`Failed to compare environments: ${(error as Error).message}`);
        }
    }

    public dispose() {
        // Commands are disposed via vscode subscriptions
    }
}

import * as vscode from 'vscode';
import { Environment } from '../types/environment';
import { EnvironmentProvider } from '../providers/environmentProvider';
import { StatusBarProvider } from '../providers/statusBarProvider';
import { FileUtils } from '../utils/fileUtils';
import { SecretsGuard } from '../utils/secretsGuard';
import { EnvironmentValidator } from '../utils/environmentValidator';
import { EnvironmentDiffer } from '../utils/environmentDiffer';
import { ConfigUtils } from '../utils/configUtils';
import { WorkspaceManager } from '../providers/workspaceManager';

export class SwitchEnvironmentCommand implements vscode.Disposable {
	constructor() {
		this.registerCommand();
	}

	private registerCommand() {
		const disposable = vscode.commands.registerCommand('dotenvy.switchEnvironment', () => {
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
				placeHolder: 'Select workspace to operate on'
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
		const statusBarProvider = selectedWorkspace.statusBarProvider;

		statusBarProvider.setWorkspace(rootPath);

		const environments = await environmentProvider.getEnvironments();

		if (environments.length === 0) {
			vscode.window.showInformationMessage(`No .env.* files found in workspace "${workspace.name}".`);
			return;
		}

		// Create quick pick items
		const items = environments.map(env => ({
			label: env.name,
			description: env.fileName,
			detail: env.filePath,
			env: env
		}));

		const selected = await vscode.window.showQuickPick(items, {
			placeHolder: `Switch environment in "${workspace.name}"`
		});

		if (selected) {
			try {
				// Check if current .env exists for diff
				const currentEnvPath = `${rootPath}/.env`;
				let showDiffPreview = false;

				if (await this.fileExists(currentEnvPath)) {
					const action = await vscode.window.showQuickPick(
						[
							{ label: 'Switch Directly', description: 'Switch without preview', action: 'switch' },
							{ label: 'Preview Changes', description: 'Show diff before switching', action: 'preview' }
						],
						{
							placeHolder: `Switch to ${selected.env.name} - choose an action`
						}
					);

					if (!action) return;

					showDiffPreview = action.action === 'preview';
				}

				// Show diff preview if requested
				if (showDiffPreview) {
					try {
						const diff = EnvironmentDiffer.compareFiles(currentEnvPath, selected.env.filePath);
						const summary = EnvironmentDiffer.getDiffSummary(diff);

						const proceed = await vscode.window.showInformationMessage(
							`Switch to ${selected.env.name}\n\n` +
							`Changes: +${summary.addedCount} added, -${summary.removedCount} removed, ~${summary.changedCount} changed\n\n` +
							`Would you like to proceed or view detailed diff?`,
							'View Diff',
							'Switch Now',
							'Cancel'
						);

						if (proceed === 'Cancel') return;
						if (proceed === 'View Diff') {
							const diffText = EnvironmentDiffer.formatDiffForDisplay(diff, 'Current', selected.env.name);
							const doc = await vscode.workspace.openTextDocument({
								content: diffText,
								language: 'diff'
							});
							await vscode.window.showTextDocument(doc, { preview: true });

							// Ask again after showing diff
							const finalDecision = await vscode.window.showInformationMessage(
								`Still want to switch to ${selected.env.name}?`,
								'Yes, Switch',
								'Cancel'
							);

							if (finalDecision !== 'Yes, Switch') return;
						}
					} catch (error) {
						// If diff fails, continue with switch
						console.log('Failed to generate diff preview:', error);
					}
				}

				// Validate the selected environment file
				const validationRules = await ConfigUtils.getValidationRules();
				if (validationRules) {
					const validationErrors = EnvironmentValidator.validateFile(selected.env.filePath, validationRules);
					if (validationErrors.length > 0) {
						const errorDetails = EnvironmentValidator.formatErrors(validationErrors);
						const continueSwitch = await vscode.window.showWarningMessage(
							`⚠️ Validation errors found in ${selected.env.name}:\n\n${errorDetails}\n\nContinue switching anyway?`,
							'Continue Anyway',
							'Cancel'
						);

						if (continueSwitch !== 'Continue Anyway') {
							return; // User cancelled
						}
					}
				}

				await FileUtils.switchToEnvironment(selected.env, rootPath);

				// Warn if secrets detected in selected file
				const warnings = SecretsGuard.checkFile(selected.env.filePath);
				if (warnings.length > 0) {
					const msg = `⚠️ Selected environment file contains potential secrets: ${warnings.join(', ')}`;
					vscode.window.showWarningMessage(msg);
				} else {
					vscode.window.showInformationMessage(`Environment switched to ${selected.label} (workspace: "${workspace.name}")`);
				}

				statusBarProvider.forceRefresh();
			} catch (error) {
				vscode.window.showErrorMessage(`Failed to switch environment: ${(error as Error).message}`);
			}
		}
	}

	private async fileExists(filePath: string): Promise<boolean> {
		try {
			await vscode.workspace.fs.stat(vscode.Uri.file(filePath));
			return true;
		} catch {
			return false;
		}
	}

	public dispose() {
		// Commands are disposed via vscode subscriptions
	}
}

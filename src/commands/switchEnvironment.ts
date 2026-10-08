import * as vscode from 'vscode';
import { Environment } from '../types/environment';
import { EnvironmentProvider } from '../providers/environmentProvider';
import { StatusBarProvider } from '../providers/statusBarProvider';
import { FileUtils } from '../utils/fileUtils';
import { SecretsGuard } from '../utils/secretsGuard';
import { EnvironmentValidator } from '../utils/environmentValidator';
import { EnvironmentDiffer, EnvDiff } from '../utils/environmentDiffer';
import { ConfigUtils } from '../utils/configUtils';
import { WorkspaceManager } from '../providers/workspaceManager';
import { HistoryManager } from '../utils/historyManager';
import { logger } from '../utils/logger';
import { t } from '../i18n';

export class SwitchEnvironmentCommand implements vscode.Disposable {
	private disposables: vscode.Disposable[] = [];
	private commandDisposable?: vscode.Disposable;

	constructor() {
		this.registerCommand();
	}

	private registerCommand(): vscode.Disposable {
		this.commandDisposable = vscode.commands.registerCommand('dotenvy.switchEnvironment', () => {
			this.execute();
		});

		// Store for proper disposal lifecycle management
		this.disposables.push(this.commandDisposable);
		return this.commandDisposable;
	}

	public async execute(): Promise<void> {
		const workspaceManager = WorkspaceManager.getInstance();
		const allWorkspaces = workspaceManager.getAllWorkspaces();

		if (allWorkspaces.length === 0) {
			vscode.window.showErrorMessage(t('common.noWorkspace'));
			return;
		}

		// If multiple workspaces, let user choose which one
		let selectedWorkspace;
		if (allWorkspaces.length === 1) {
			selectedWorkspace = allWorkspaces[0];
		} else {
			const workspaceItems = workspaceManager.getWorkspaceQuickPickItems();
			const selectedItem = await vscode.window.showQuickPick(workspaceItems, {
				placeHolder: t('envSwitch.workspacePlaceholder')
			});

			if (!selectedItem) return;

			selectedWorkspace = allWorkspaces.find(
				ws => ws.workspace.name === selectedItem.label && ws.workspace.uri.fsPath === selectedItem.description
			);
		}

		if (!selectedWorkspace) return;

		const workspace = selectedWorkspace.workspace;
		const rootPath = workspace.uri.fsPath;
		// Use workspace providers or create fallbacks for maximum reliability
		let environmentProvider = selectedWorkspace.environmentProvider;
		if (!environmentProvider) {
			// Fallback: create provider if workspace data is incomplete
			environmentProvider = new EnvironmentProvider(rootPath);
		}


		// Type-annotate for better IntelliSense and type safety throughout the method
		const statusBarProvider: StatusBarProvider | undefined = selectedWorkspace.statusBarProvider;
		if (!statusBarProvider) {
			// Enhanced error message when status bar provider is unavailable
			vscode.window.showWarningMessage(t('envSwitch.statusBarUnavailable'));
		} else {
			statusBarProvider.setWorkspace(rootPath);
		}

		// Ensure we have Environment type protection when fetching environments
		const environments: Environment[] = await environmentProvider.getEnvironments();

		if (environments.length === 0) {
			vscode.window.showInformationMessage(t('envSwitch.noEnvFiles', { name: workspace.name }));
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
			placeHolder: t('envSwitch.placeholder', { name: workspace.name })
		});

		if (selected) {
			try {
				// Check if current .env exists for diff
				const currentEnvPath = `${rootPath}/.env`;
				let showDiffPreview = false;

				if (await this.fileExists(currentEnvPath)) {
					const action = await vscode.window.showQuickPick(
						[
							{ label: t('envSwitch.direct'), description: t('envSwitch.directDesc'), action: 'switch' },
							{ label: t('envSwitch.preview'), description: t('envSwitch.previewDesc'), action: 'preview' }
						],
						{
							placeHolder: t('envSwitch.chooseAction', { name: selected.env.name })
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

						const viewDiff = t('envSwitch.viewDiff');
						const switchNow = t('envSwitch.switchNow');
						const cancelLabel = t('common.cancel');
						const proceed = await vscode.window.showInformationMessage(
							t('envSwitch.summary', {
								name: selected.env.name,
								added: summary.addedCount,
								removed: summary.removedCount,
								changed: summary.changedCount
							}),
							viewDiff,
							switchNow,
							cancelLabel
						);

						if (proceed === cancelLabel) return;
						if (proceed === viewDiff) {
							const diffText = EnvironmentDiffer.formatDiffForDisplay(diff, 'Current', selected.env.name);
							const doc = await vscode.workspace.openTextDocument({
								content: diffText,
								language: 'diff'
							});
							await vscode.window.showTextDocument(doc, { preview: true });

							// Ask again after showing diff
							const yesSwitch = t('envSwitch.yesSwitch');
							const finalDecision = await vscode.window.showInformationMessage(
								t('envSwitch.confirmAgain', { name: selected.env.name }),
								yesSwitch,
								t('common.cancel')
							);

							if (finalDecision !== yesSwitch) return;
						}
					} catch (error) {
						// If diff fails, continue with switch
						logger.error('Failed to generate diff preview:', error, 'SwitchEnvironment');
					}
				}

				// Validate the selected environment file
				const validationRules = await ConfigUtils.getValidationRules();
				if (validationRules) {
					const validationErrors = EnvironmentValidator.validateFile(selected.env.filePath, validationRules);
					if (validationErrors.length > 0) {
						const errorDetails = EnvironmentValidator.formatErrors(validationErrors);
						const continueAnyway = t('envSwitch.continueAnyway');
						const continueSwitch = await vscode.window.showWarningMessage(
							t('envSwitch.validationErrors', { name: selected.env.name, details: errorDetails }),
							continueAnyway,
							t('common.cancel')
						);

						if (continueSwitch !== continueAnyway) {
							return; // User cancelled
						}
					}
				}

				// Read current .env content for history (before switching)
				let previousContent = '';
				let previousEnvironment = 'none';

				if (await this.fileExists(currentEnvPath)) {
					try {
						const currentEnvUri = vscode.Uri.file(currentEnvPath);
						const content = await vscode.workspace.fs.readFile(currentEnvUri);
						previousContent = content.toString();

						// Try to determine previous environment name
						const environments = await environmentProvider.getEnvironments();
						for (const env of environments) {
							try {
								const envContent = await vscode.workspace.fs.readFile(vscode.Uri.file(env.filePath));
								if (envContent.toString() === previousContent) {
									previousEnvironment = env.name;
									break;
								}
							} catch (error) {
								// Continue checking other environments
							}
						}
					} catch (error) {
						logger.error('Failed to read current .env for history:', error, 'SwitchEnvironment');
					}
				}

				// Read new environment content for diff
				let newContent = '';
				try {
					const newEnvUri = vscode.Uri.file(selected.env.filePath);
					const content = await vscode.workspace.fs.readFile(newEnvUri);
					newContent = content.toString();
				} catch (error) {
					logger.error('Failed to read new environment file:', error, 'SwitchEnvironment');
				}

				// Calculate diff if we have both contents
				let diff: EnvDiff | undefined = undefined;
				if (previousContent && newContent) {
					try {
						diff = EnvironmentDiffer.compareFiles(currentEnvPath, selected.env.filePath);
					} catch (error) {
						logger.error('Failed to calculate diff for history:', error, 'SwitchEnvironment');
					}
				}

				await FileUtils.switchToEnvironment(selected.env, rootPath);

				// Record history entry
				try {
					await HistoryManager.recordEntry(
						rootPath,
						'switch',
						selected.env.name,
						newContent,
						selected.env.fileName,
						{
							previousEnvironment: previousEnvironment !== 'none' ? previousEnvironment : undefined,
							reason: `Switched from ${previousEnvironment} to ${selected.env.name}`,
							source: 'auto',
							diff
						}
					);
				} catch (error) {
					logger.error('Failed to record history entry:', error, 'SwitchEnvironment');
				}

				// Warn if secrets detected in selected file
				const warnings = SecretsGuard.checkFile(selected.env.filePath);
				if (warnings.length > 0) {
					vscode.window.showWarningMessage(t('envSwitch.secrets', { warnings: warnings.join(', ') }));
				} else {
					vscode.window.showInformationMessage(t('envSwitch.switchedWorkspace', { name: selected.label, workspace: workspace.name }));
				}

				statusBarProvider.forceRefresh();
			} catch (error) {
				vscode.window.showErrorMessage(t('envSwitch.failed', { message: (error as Error).message }));
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

	public dispose(): void {
		// Dispose of all stored disposables for proper cleanup
		this.disposables.forEach(disposable => disposable.dispose());
		this.disposables.length = 0;

		// Clear references
		this.commandDisposable = undefined;
	}
}

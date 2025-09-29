import * as vscode from 'vscode';
import { EnvironmentProvider } from '../providers/environmentProvider';
import { EnvironmentValidator } from '../utils/environmentValidator';
import { ConfigUtils } from '../utils/configUtils';
import { WorkspaceManager } from '../providers/workspaceManager';

export class ValidateEnvironmentCommand implements vscode.Disposable {
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
				placeHolder: 'Select workspace to validate'
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

		// Get validation rules
		const validationRules = await ConfigUtils.getValidationRules();
		if (!validationRules) {
			vscode.window.showInformationMessage(
				'No validation rules configured. Add validation rules to your .dotenvy.json file.'
			);
			return;
		}

		// Get all environments
		const environments = await environmentProvider.getEnvironments();
		if (environments.length === 0) {
			vscode.window.showInformationMessage('No .env.* files found to validate.');
			return;
		}

		// Validate all environment files
		const validationResults = new Map<string, any>();

		for (const env of environments) {
			try {
				const errors = EnvironmentValidator.validateFile(env.filePath, validationRules);
				validationResults.set(env.name, {
					environment: env,
					errors: errors,
					isValid: errors.length === 0
				});
			} catch (error) {
				validationResults.set(env.name, {
					environment: env,
					errors: [{ message: `Failed to validate: ${(error as Error).message}` }],
					isValid: false
				});
			}
		}

		// Show results
		await this.showValidationResults(validationResults);
	}

	private async showValidationResults(validationResults: Map<string, any>): Promise<void> {
		const validEnvs = Array.from(validationResults.values()).filter(r => r.isValid);
		const invalidEnvs = Array.from(validationResults.values()).filter(r => !r.isValid);

		if (invalidEnvs.length === 0) {
			vscode.window.showInformationMessage(
				`✅ All ${validationResults.size} environment files passed validation!`
			);
			return;
		}

		// Show validation issues
		if (invalidEnvs.length === 1) {
			const result = invalidEnvs[0];
			const envName = result.environment.name;
			const errorDetails = EnvironmentValidator.formatErrors(result.errors);

			const showDetails = await vscode.window.showErrorMessage(
				`❌ Validation failed for ${envName}`,
				'Show Details'
			);

			if (showDetails === 'Show Details') {
				const doc = await vscode.workspace.openTextDocument({
					content: `Validation Report for ${envName}:\n\n${errorDetails}`,
					language: 'text'
				});
				await vscode.window.showTextDocument(doc, { preview: true });
			}
		} else {
			// Multiple invalid environments - show quick pick
			const items = invalidEnvs.map(result => ({
				label: `❌ ${result.environment.name}`,
				description: `${result.errors.length} validation error(s)`,
				detail: result.environment.fileName,
				result: result
			}));

			const validCount = validEnvs.length;
			const invalidCount = invalidEnvs.length;
			const totalCount = validationResults.size;

			const selected = await vscode.window.showQuickPick(items, {
				placeHolder: `Validation Results: ${validCount}/${totalCount} environments passed`
			});

			if (selected) {
				const errorDetails = EnvironmentValidator.formatErrors(selected.result.errors);
				const doc = await vscode.workspace.openTextDocument({
					content: `Validation Report for ${selected.result.environment.name}:\n\n${errorDetails}`,
					language: 'text'
				});
				await vscode.window.showTextDocument(doc, { preview: true });
			}
		}
	}

	public dispose() {
		// Commands are disposed via vscode subscriptions
	}
}

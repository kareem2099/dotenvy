import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { EnvironmentProvider } from '../providers/environmentProvider';
import { EnvironmentValidator } from '../utils/environmentValidator';
import { ConfigUtils } from '../utils/configUtils';
import { WorkspaceManager } from '../providers/workspaceManager';

export class ValidateEnvironmentCommand implements vscode.Disposable {
	/**
	 * Show validation menu and run the selected action.
	 */
	static async manageValidation(preferredWorkspacePath?: string): Promise<void> {
		const rootPath = await WorkspaceManager.resolveWorkspacePath(preferredWorkspacePath, 'Select workspace to validate');
		if (!rootPath) {
			vscode.window.showErrorMessage('No workspace folder open.');
			return;
		}

		const validationRules = await ConfigUtils.getValidationRules();
		const configPath = path.join(rootPath, '.dotenvy.json');
		const hasRules = !!validationRules;

		const options = hasRules
			? [
				{ label: '$(check) Validate All Environments', description: 'Run validation rules on every .env file', action: 'validate' as const },
				{ label: '$(gear) Open Validation Config', description: configPath, action: 'config' as const }
			]
			: [
				{ label: '$(gear) Configure Validation Rules', description: `Add rules to ${configPath}`, action: 'config' as const },
				{ label: '$(check) Validate All Environments', description: 'Requires validation rules in .dotenvy.json', action: 'validate' as const }
			];

		const choice = await vscode.window.showQuickPick(options, {
			placeHolder: hasRules ? 'Environment validation' : 'No validation rules configured yet'
		});

		if (!choice) {
			return;
		}

		if (choice.action === 'config') {
			await ValidateEnvironmentCommand.openValidationConfig(rootPath, configPath);
			return;
		}

		await new ValidateEnvironmentCommand().execute(rootPath);
	}

	private static async openValidationConfig(rootPath: string, configPath: string): Promise<void> {
		if (!fs.existsSync(configPath)) {
			const defaultConfig = {
				validation: {
					required: ['NODE_ENV'],
					types: {
						PORT: 'number'
					}
				}
			};
			fs.writeFileSync(configPath, JSON.stringify(defaultConfig, null, 2), 'utf8');
			vscode.window.showInformationMessage(`Created ${path.basename(configPath)} with sample validation rules.`);
		}

		const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(configPath));
		await vscode.window.showTextDocument(doc);
	}

	public async execute(preferredWorkspacePath?: string): Promise<void> {
		const rootPath = await WorkspaceManager.resolveWorkspacePath(preferredWorkspacePath, 'Select workspace to validate');

		if (!rootPath) {
			vscode.window.showErrorMessage('No workspace folder open.');
			return;
		}

		const environmentProvider = new EnvironmentProvider(rootPath);

		const validationRules = await ConfigUtils.getValidationRules();
		if (!validationRules) {
			const configPath = path.join(rootPath, '.dotenvy.json');
			const configure = await vscode.window.showInformationMessage(
				'No validation rules configured.',
				'Open Config',
				'Cancel'
			);

			if (configure === 'Open Config') {
				await ValidateEnvironmentCommand.openValidationConfig(rootPath, configPath);
			}
			return;
		}

		const environments = await environmentProvider.getEnvironments();
		if (environments.length === 0) {
			vscode.window.showInformationMessage('No .env.* files found to validate.');
			return;
		}

		const validationResults = new Map<string, Record<string, unknown>>();

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

		await this.showValidationResults(validationResults);
	}

	private async showValidationResults(validationResults: Map<string, Record<string, unknown>>): Promise<void> {
		const validEnvs = Array.from(validationResults.values()).filter(r => r.isValid);
		const invalidEnvs = Array.from(validationResults.values()).filter(r => !r.isValid);

		if (invalidEnvs.length === 0) {
			vscode.window.showInformationMessage(
				`✅ All ${validationResults.size} environment files passed validation!`
			);
			return;
		}

		if (invalidEnvs.length === 1) {
			const result = invalidEnvs[0] as Record<string, unknown>;
			const envName = (result.environment as Record<string, unknown>).name as string;
			const errorDetails = EnvironmentValidator.formatErrors(result.errors as Array<{ type: 'type' | 'syntax' | 'missing' | 'custom'; message: string; [key: string]: unknown }>);

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
			const items = invalidEnvs.map(result => {
				const resultRecord = result as Record<string, unknown>;
				const env = resultRecord.environment as Record<string, unknown>;
				return {
					label: `❌ ${env.name as string}`,
					description: `${(resultRecord.errors as Array<unknown>).length} validation error(s)`,
					detail: env.fileName as string,
					result: result
				};
			});

			const validCount = validEnvs.length;
			const invalidCount = invalidEnvs.length;
			const totalCount = validationResults.size;

			const selected = await vscode.window.showQuickPick(items, {
				placeHolder: `Validation Results: ${validCount}/${totalCount} passed, ${invalidCount} failed`
			});

			if (selected) {
				const selectedRecord = selected.result as Record<string, unknown>;
				const env = selectedRecord.environment as Record<string, unknown>;
				const errorDetails = EnvironmentValidator.formatErrors(selectedRecord.errors as Array<{ type: 'type' | 'syntax' | 'missing' | 'custom'; message: string; [key: string]: unknown }>);
				const doc = await vscode.workspace.openTextDocument({
					content: `Validation Report for ${env.name as string}:\n\n${errorDetails}`,
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

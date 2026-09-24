import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { EnvironmentProvider } from '../providers/environmentProvider';
import { EnvironmentValidator } from '../utils/environmentValidator';
import { ConfigUtils } from '../utils/configUtils';
import { WorkspaceManager } from '../providers/workspaceManager';
import { showActionStart, showSyncToast } from '../utils/panelNotification';
import { t } from '../i18n';

export class ValidateEnvironmentCommand implements vscode.Disposable {
	/**
	 * Show validation menu and run the selected action.
	 */
	static async manageValidation(preferredWorkspacePath?: string): Promise<void> {
		showActionStart(t('validate.actionStart'));

		const rootPath = await WorkspaceManager.resolveWorkspacePath(preferredWorkspacePath, t('common.selectWorkspace'));
		if (!rootPath) {
			showSyncToast(t('validate.cancelledNoWorkspace'), 'info');
			return;
		}

		const validationRules = await ConfigUtils.getValidationRules();
		const configPath = path.join(rootPath, '.dotenvy.json');
		const hasRules = !!validationRules;

		const options = hasRules
			? [
				{ label: `$(check) ${t('validate.validateAll')}`, description: t('validate.validateAllDesc'), action: 'validate' as const },
				{ label: `$(gear) ${t('validate.openConfigLabel')}`, description: configPath, action: 'config' as const }
			]
			: [
				{ label: `$(gear) ${t('validate.configureRules')}`, description: t('validate.configureRulesDesc', { path: configPath }), action: 'config' as const },
				{ label: `$(check) ${t('validate.validateAllRequiresRules')}`, description: t('validate.validateAllRequiresRulesDesc'), action: 'validate' as const }
			];

		const choice = await vscode.window.showQuickPick(options, {
			placeHolder: hasRules ? t('validate.placeholder') : t('validate.noRulesPlaceholder')
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
			showSyncToast(t('validate.configCreated', { fileName: path.basename(configPath) }), 'success');
		}

		const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(configPath));
		await vscode.window.showTextDocument(doc);
	}

	public async execute(preferredWorkspacePath?: string): Promise<void> {
		const rootPath = await WorkspaceManager.resolveWorkspacePath(preferredWorkspacePath, t('common.selectWorkspace'));

		if (!rootPath) {
			showSyncToast(t('validate.cancelledNoWorkspace'), 'info');
			return;
		}

		const environmentProvider = new EnvironmentProvider(rootPath);

		const validationRules = await ConfigUtils.getValidationRules();
		if (!validationRules) {
			const configPath = path.join(rootPath, '.dotenvy.json');
			const openConfigLabel = t('validate.openConfig');
			const cancelLabel = t('common.cancel');
			const configure = await vscode.window.showInformationMessage(
				t('validate.noRules'),
				openConfigLabel,
				cancelLabel
			);

			if (configure === openConfigLabel) {
				await ValidateEnvironmentCommand.openValidationConfig(rootPath, configPath);
			} else {
				showSyncToast(t('validate.cancelledNoRules'), 'info');
			}
			return;
		}

		const environments = await environmentProvider.getEnvironments();
		if (environments.length === 0) {
			showSyncToast(t('validate.noEnvFiles'), 'warning');
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
			showSyncToast(
				t('validate.allPassed', { count: validationResults.size }),
				'success'
			);
			return;
		}

		if (invalidEnvs.length === 1) {
			const result = invalidEnvs[0] as Record<string, unknown>;
			const envName = (result.environment as Record<string, unknown>).name as string;
			const errorDetails = EnvironmentValidator.formatErrors(result.errors as Array<{ type: 'type' | 'syntax' | 'missing' | 'custom'; message: string; [key: string]: unknown }>);

			showSyncToast(t('validate.failedFor', { name: envName }), 'error');

			const showDetailsLabel = t('validate.showDetailsBtn');
			const closeLabel = t('common.close');
			const showDetails = await vscode.window.showWarningMessage(
				t('validate.showDetails', { name: envName }),
				showDetailsLabel,
				closeLabel
			);

			if (showDetails === showDetailsLabel) {
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

			showSyncToast(
				t('validate.summary', { valid: validCount, total: totalCount, failed: invalidCount }),
				invalidCount > 0 ? 'error' : 'success'
			);

			const selected = await vscode.window.showQuickPick(items, {
				placeHolder: t('validate.resultsPlaceholder', { valid: validCount, total: totalCount, failed: invalidCount })
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

import * as vscode from 'vscode';
import * as path from 'path';
import { EnvironmentExporter, ExportOptions } from '../utils/environmentExporter';
import { t } from '../i18n';

export class ExportEnvironmentCommand implements vscode.Disposable {
	public async execute(): Promise<void> {
		try {
			// Get current environment file
			const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
			if (!workspaceFolder) {
				vscode.window.showErrorMessage(t('common.noWorkspace'));
				return;
			}

			// Get available environments
			const environments = await EnvironmentExporter.getAvailableEnvironments();
			if (environments.length === 0) {
				vscode.window.showErrorMessage(t('export.noEnvFiles'));
				return;
			}

			// Let user select environment to export
			const environmentItems = environments.map(env => ({
				label: env.name,
				description: env.path,
				detail: env.exists ? t('export.exists') : t('export.notFound'),
				env
			}));

			const selectedItem = await vscode.window.showQuickPick(environmentItems, {
				placeHolder: t('export.selectEnv')
			});

			if (!selectedItem) return;

			// Choose export format
			const format = await vscode.window.showQuickPick([
				{ label: t('export.json'), description: t('export.jsonDesc'), value: 'json' },
				{ label: t('export.csv'), description: t('export.csvDesc'), value: 'csv' },
				{ label: t('export.env'), description: t('export.envDesc'), value: 'env' },
				{ label: t('export.encryptedJson'), description: t('export.encryptedJsonDesc'), value: 'encrypted-json' }
			], {
				placeHolder: t('export.formatPlaceholder')
			});

			if (!format) return;

			// Configure export options
			const includeMetadata = format.value === 'json' ? await vscode.window.showQuickPick([
				{ label: t('export.includeMetadata'), description: t('export.includeMetadataDesc'), value: true },
				{ label: t('export.noMetadata'), description: t('export.noMetadataDesc'), value: false }
			], {
				placeHolder: t('export.metadataPlaceholder')
			}) : { value: false };

			if (!includeMetadata) return;

			const includeComments = (format.value === 'json' || format.value === 'env') ? await vscode.window.showQuickPick([
				{ label: t('export.includeComments'), description: t('export.includeCommentsDesc'), value: true },
				{ label: t('export.noComments'), description: t('export.noCommentsDesc'), value: false }
			], {
				placeHolder: t('export.commentsPlaceholder')
			}) : { value: false };

			if (!includeComments) return;

			// Choose destination
			const destination = await vscode.window.showQuickPick([
				{ label: t('export.saveFile'), description: t('export.saveFileDesc'), value: 'file' },
				{ label: t('export.clipboard'), description: t('export.clipboardDesc'), value: 'clipboard' }
			], {
				placeHolder: t('export.destinationPlaceholder')
			});

			if (!destination) return;

			// Prepare export options
			const exportOptions: ExportOptions = {
				format: format.value as 'json' | 'csv' | 'env' | 'encrypted-json',
				includeMetadata: includeMetadata.value,
				includeComments: includeComments.value,
				environmentName: selectedItem.env.name
			};

			// Perform export
			const result = await EnvironmentExporter.exportEnvironmentVariables(selectedItem.env.path, exportOptions);

			if (!result.success) {
				vscode.window.showErrorMessage(t('export.failed', { message: result.error ?? '' }));
				return;
			}

			// Handle destination
			if (destination.value === 'clipboard') {
				await vscode.env.clipboard.writeText(result.content);
				vscode.window.showInformationMessage(
					t('export.copied', { format: result.format })
				);
			} else {
				// Save to file
				const suggestedName = `environment-${selectedItem.env.name}.${format.value === 'env' ? 'env' : format.value}`;
				const fileUri = await vscode.window.showSaveDialog({
					defaultUri: vscode.Uri.file(path.join(workspaceFolder.uri.fsPath, suggestedName)),
					filters: {
						[t('export.filters')]: [format.value === 'env' ? 'env' : format.value],
						[t('export.allFiles')]: ['*']
					}
				});

				if (!fileUri) return; // User cancelled

				await vscode.workspace.fs.writeFile(fileUri, Buffer.from(result.content, 'utf8'));

				vscode.window.showInformationMessage(
					t('export.saved', { file: path.basename(fileUri.fsPath) })
				);
			}

		} catch (error) {
			vscode.window.showErrorMessage(
				t('export.failed', { message: (error as Error).message })
			);
		}
	}

	public dispose() {
		// Commands are disposed via vscode subscriptions
	}
}

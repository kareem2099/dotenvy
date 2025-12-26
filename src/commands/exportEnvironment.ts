import * as vscode from 'vscode';
import * as path from 'path';
import { EnvironmentExporter, ExportOptions } from '../utils/environmentExporter';

export class ExportEnvironmentCommand implements vscode.Disposable {
	public async execute(): Promise<void> {
		try {
			// Get current environment file
			const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
			if (!workspaceFolder) {
				vscode.window.showErrorMessage('No workspace folder open');
				return;
			}

			// Get available environments
			const environments = await EnvironmentExporter.getAvailableEnvironments();
			if (environments.length === 0) {
				vscode.window.showErrorMessage('No environment files found in workspace');
				return;
			}

			// Let user select environment to export
			const environmentItems = environments.map(env => ({
				label: env.name,
				description: env.path,
				detail: env.exists ? 'Exists' : 'Not found',
				env
			}));

			const selectedItem = await vscode.window.showQuickPick(environmentItems, {
				placeHolder: 'Select environment to export'
			});

			if (!selectedItem) return;

			// Choose export format
			const format = await vscode.window.showQuickPick([
				{ label: 'JSON', description: 'Full configuration with metadata', value: 'json' },
				{ label: 'CSV', description: 'Simple key-value pairs', value: 'csv' },
				{ label: '.env', description: 'Standard .env format', value: 'env' },
				{ label: 'Encrypted JSON', description: 'Secure encrypted format', value: 'encrypted-json' }
			], {
				placeHolder: 'Choose export format'
			});

			if (!format) return;

			// Configure export options
			const includeMetadata = format.value === 'json' ? await vscode.window.showQuickPick([
				{ label: 'Include metadata', description: 'Add export timestamp and source info', value: true },
				{ label: 'No metadata', description: 'Just variables', value: false }
			], {
				placeHolder: 'Include metadata?'
			}) : { value: false };

			if (!includeMetadata) return;

			const includeComments = (format.value === 'json' || format.value === 'env') ? await vscode.window.showQuickPick([
				{ label: 'Include comments', description: 'Preserve variable comments', value: true },
				{ label: 'No comments', description: 'Just variables', value: false }
			], {
				placeHolder: 'Include comments?'
			}) : { value: false };

			if (!includeComments) return;

			// Choose destination
			const destination = await vscode.window.showQuickPick([
				{ label: 'Save to file', description: 'Save to a file on disk', value: 'file' },
				{ label: 'Copy to clipboard', description: 'Copy to clipboard', value: 'clipboard' }
			], {
				placeHolder: 'Choose destination'
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
				vscode.window.showErrorMessage(`Export failed: ${result.error}`);
				return;
			}

			// Handle destination
			if (destination.value === 'clipboard') {
				await vscode.env.clipboard.writeText(result.content);
				vscode.window.showInformationMessage(
					`Environment exported to clipboard! (${result.format} format)`
				);
			} else {
				// Save to file
				const suggestedName = `environment-${selectedItem.env.name}.${format.value === 'env' ? 'env' : format.value}`;
				const fileUri = await vscode.window.showSaveDialog({
					defaultUri: vscode.Uri.file(path.join(workspaceFolder.uri.fsPath, suggestedName)),
					filters: {
						'Export Files': [format.value === 'env' ? 'env' : format.value],
						'All Files': ['*']
					}
				});

				if (!fileUri) return; // User cancelled

				await vscode.workspace.fs.writeFile(fileUri, Buffer.from(result.content, 'utf8'));

				vscode.window.showInformationMessage(
					`Environment exported successfully! Saved as: ${path.basename(fileUri.fsPath)}`
				);
			}

		} catch (error) {
			vscode.window.showErrorMessage(
				`Export failed: ${(error as Error).message}`
			);
		}
	}

	public dispose() {
		// Commands are disposed via vscode subscriptions
	}
}

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { WorkspaceManager } from '../providers/workspaceManager';
import { ConfigUtils } from '../utils/configUtils';
import { DopplerSyncManager } from '../utils/dopplerSyncManager';
import { CloudSyncManager, CloudSecrets } from '../utils/cloudSyncManager';
import { FileUtils } from '../utils/fileUtils';
import { StatusBarProvider } from '../providers/statusBarProvider';
import { extensionContext } from '../extension';
import { EncryptedCloudSyncManager } from '../utils/encryptedCloudSyncManager';

export class PullFromCloudCommand implements vscode.Disposable {
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
				placeHolder: 'Select workspace to pull from cloud'
			});

			if (!selectedItem) return;

			selectedWorkspace = allWorkspaces.find(
				ws => ws.workspace.name === selectedItem.label && ws.workspace.uri.fsPath === selectedItem.description
			);
		}

		if (!selectedWorkspace) return;

		const workspace = selectedWorkspace.workspace;
		const rootPath = workspace.uri.fsPath;
		// Use StatusBarProvider for explicit type safety and IntelliSense
		const statusBarProvider: StatusBarProvider | undefined = selectedWorkspace.statusBarProvider;

		// Check if cloud sync is configured
		const config = await ConfigUtils.readQuickEnvConfig();
		const configPath = path.join(rootPath, '.dotenvy.json');
		if (!config?.cloudSync || !config.cloudSync.project || !config.cloudSync.config || !config.cloudSync.token) {
			// Create basic configuration file automatically
			const basicConfig = {
				environments: {},
				cloudSync: {
					provider: 'doppler' as const,
					project: '',
					config: 'development',
					token: ''
				}
			};

			await fs.promises.writeFile(
				configPath,
				JSON.stringify(basicConfig, null, 2),
				'utf8'
			);

			// Auto-add to gitignore
			const gitignorePath = path.join(rootPath, '.gitignore');
			let gitignoreContent = '';
			try {
				if (fs.existsSync(gitignorePath)) {
					gitignoreContent = fs.readFileSync(gitignorePath, 'utf8');
				}
			} catch (error) {
				// Ignore
			}

			if (!gitignoreContent.includes('.dotenvy.json')) {
				gitignoreContent += '\n.dotenvy.json';
				fs.writeFileSync(gitignorePath, gitignoreContent);
			}

			// Store in VSCode storage too
			await ConfigUtils.saveQuickEnvConfig(basicConfig);

			// Open the file for user to edit
			const doc = await vscode.workspace.openTextDocument(configPath);
			await vscode.window.showTextDocument(doc);

			vscode.window.showInformationMessage(
				'Configuration file created! Fill in your project details and token, then save and try again.'
			);

			return;
		}

		try {
			const syncConfig = config.cloudSync!;
			let cloudManager: CloudSyncManager | undefined;

			// Check if encrypted cloud sync is enabled (default: enabled)
			const enableEncryption = !(syncConfig.encryptCloudSync === false);

			if (enableEncryption) {
				try {
					// Use the global extension context from the activated extension
					cloudManager = await EncryptedCloudSyncManager.createEncryptedManager(syncConfig, extensionContext, true);
					vscode.window.showInformationMessage('🔐 Encrypted cloud sync enabled');
				} catch (error) {
					vscode.window.showWarningMessage(`Encrypted cloud sync failed to initialize: ${(error as Error).message} - falling back to standard sync`);
				}
			}

			// Initialize standard cloud provider if encryption not used or failed
			if (!cloudManager) {
				switch (syncConfig.provider) {
					case 'doppler':
						cloudManager = new DopplerSyncManager(syncConfig);
						break;
					default:
						throw new Error(`Unsupported cloud provider: ${syncConfig.provider}`);
				}
			}

			// Test connection
			vscode.window.showInformationMessage(`🔄 Testing connection to ${syncConfig.provider}...`);
			const connectionResult = await cloudManager.testConnection();
			if (!connectionResult.success) {
				const errorDetails = connectionResult.error ? `${syncConfig.provider} error: ${connectionResult.error}` : `Cannot connect to ${syncConfig.provider}. Check your configuration.`;
				const reconfigure = await vscode.window.showErrorMessage(
					`❌ ${errorDetails}`,
					'Reconfigure',
					'Cancel'
				);

				if (reconfigure === 'Reconfigure') {
					// Ask user for new config file name
					const configFilename = await vscode.window.showInputBox({
						prompt: 'Enter config file name (e.g., .dotenvy.json, .env.config.json)',
						value: '.dotenvy.json',
						placeHolder: '.dotenvy.json'
					});

					if (!configFilename) return;

					// Delete existing config and create fresh one with new name
					try {
						await fs.promises.unlink(configPath);
					} catch (error) {
						// Ignore if file doesn't exist
					}

					const newConfigPath = path.join(rootPath, configFilename);
					const basicConfig = {
						environments: {},
						cloudSync: {
							provider: 'doppler' as const,
							project: '',
							config: 'development',
							token: ''
						}
					};

					await fs.promises.writeFile(
						newConfigPath,
						JSON.stringify(basicConfig, null, 2),
						'utf8'
					);

					// Add the new filename to gitignore
					const gitignorePath = path.join(rootPath, '.gitignore');
					let gitignoreContent = '';
					try {
						if (fs.existsSync(gitignorePath)) {
							gitignoreContent = fs.readFileSync(gitignorePath, 'utf8');
						}
					} catch (error) {
						// Ignore
					}

					if (!gitignoreContent.includes(configFilename)) {
						gitignoreContent += '\n' + configFilename;
						fs.writeFileSync(gitignorePath, gitignoreContent);
					}

					await ConfigUtils.saveQuickEnvConfig(basicConfig);

					// Open the file for user to edit
					const doc = await vscode.workspace.openTextDocument(newConfigPath);
					await vscode.window.showTextDocument(doc);

					vscode.window.showInformationMessage(
						`${configFilename} created! Fill in your project details and token, then save and try again.`
					);
				}

				return;
			}

			// Fetch secrets from cloud
			vscode.window.showInformationMessage(`📥 Fetching secrets from ${syncConfig.provider}...`);
			const result = await cloudManager.fetchSecrets();

			if (!result.success || !result.secrets) {
				vscode.window.showErrorMessage(`❌ Failed to fetch secrets: ${result.error}`);
				return;
			}

			// Show preview of what will be changed
			const currentEnvPath = path.join(rootPath, '.env');
			const currentSecrets: CloudSecrets = {};

			if (fs.existsSync(currentEnvPath)) {
				const envContent = fs.readFileSync(currentEnvPath, 'utf8');
				for (const line of envContent.split('\n')) {
					const trimmed = line.trim();
					if (!trimmed || trimmed.startsWith('#')) continue;

					const equalIndex = trimmed.indexOf('=');
					if (equalIndex === -1) continue;

					const key = trimmed.substring(0, equalIndex).trim();
					const value = trimmed.substring(equalIndex + 1);

					if (key) {
						currentSecrets[key] = value;
					}
				}
			}

			const secrets = result.secrets!; // We've already checked for success and secrets above
			// Calculate changes
			const newKeys = Object.keys(secrets).filter(key => !currentSecrets.hasOwnProperty(key));
			const changedKeys = Object.keys(secrets).filter(key =>
				currentSecrets.hasOwnProperty(key) && currentSecrets[key] !== secrets[key]
			);
			const removedKeys = Object.keys(currentSecrets).filter(key => !secrets.hasOwnProperty(key));

			const totalChanges = newKeys.length + changedKeys.length + removedKeys.length;

			if (totalChanges === 0) {
				vscode.window.showInformationMessage('✨ Local environment is already in sync with cloud!');
				return;
			}

			// Show change summary
			const proceed = await vscode.window.showInformationMessage(
				`Pull from ${syncConfig.provider} (${syncConfig.project}/${syncConfig.config})\n\n` +
				`Changes: +${newKeys.length} added, ~${changedKeys.length} modified, -${removedKeys.length} removed\n\n` +
				`Would you like to apply these changes?`,
				'View Details',
				'Apply Changes',
				'Cancel'
			);

			if (proceed === 'Cancel') return;

			if (proceed === 'View Details') {
				// Show detailed diff
				let details = `# Cloud Sync Changes\n`;
				details += `# ${syncConfig.provider}: ${syncConfig.project}/${syncConfig.config}\n\n`;

				if (newKeys.length > 0) {
					details += `## Added Variables (${newKeys.length})\n`;
					newKeys.forEach(key => {
						details += `+ ${key}=${secrets[key]}\n`;
					});
					details += '\n';
				}

				if (changedKeys.length > 0) {
					details += `## Modified Variables (${changedKeys.length})\n`;
					changedKeys.forEach(key => {
						details += `~ ${key}=${currentSecrets[key]} → ${secrets[key]}\n`;
					});
					details += '\n';
				}

				if (removedKeys.length > 0) {
					details += `## Removed Variables (${removedKeys.length})\n`;
					removedKeys.forEach(key => {
						details += `- ${key}=${currentSecrets[key]}\n`;
					});
					details += '\n';
				}

				const doc = await vscode.workspace.openTextDocument({
					content: details,
					language: 'diff'
				});
				await vscode.window.showTextDocument(doc, { preview: true });

				// Ask again after showing details
				const finalDecision = await vscode.window.showInformationMessage(
					`Apply these ${totalChanges} changes to local environment?`,
					'Yes, Apply',
					'Cancel'
				);

				if (finalDecision !== 'Yes, Apply') return;
			}

			// Apply changes - backup and write new .env file
			await FileUtils.backupEnvFile(rootPath);

			// Create new .env content
			let newEnvContent = '';
			for (const [key, value] of Object.entries(result.secrets)) {
				newEnvContent += `${key}=${value}\n`;
			}

			const envPath = path.join(rootPath, '.env');
			await fs.promises.writeFile(envPath, newEnvContent, 'utf8');

			// Update status bar
			statusBarProvider.setWorkspace(rootPath);
			statusBarProvider.forceRefresh();

			vscode.window.showInformationMessage(
				`✅ Successfully pulled ${Object.keys(result.secrets).length} secrets from ${syncConfig.provider}!`
			);

		} catch (error) {
			vscode.window.showErrorMessage(`Failed to pull from cloud: ${(error as Error).message}`);
		}
	}

	public dispose() {
		// Commands are disposed via vscode subscriptions
	}
}

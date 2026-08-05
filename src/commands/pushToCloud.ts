import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { WorkspaceManager } from '../providers/workspaceManager';
import { ConfigUtils } from '../utils/configUtils';
import { DopplerSyncManager } from '../utils/dopplerSyncManager';
import { CloudSyncManager } from '../utils/cloudSyncManager';
import { FileUtils } from '../utils/fileUtils';
import { extensionContext } from '../extension';
import { EncryptedCloudSyncManager } from '../utils/encryptedCloudSyncManager';

export class PushToCloudCommand implements vscode.Disposable {
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
				placeHolder: 'Select workspace to sync to cloud'
			});

			if (!selectedItem) return;

			selectedWorkspace = allWorkspaces.find(
				ws => ws.workspace.name === selectedItem.label && ws.workspace.uri.fsPath === selectedItem.description
			);
		}

		if (!selectedWorkspace) return;

		const workspace = selectedWorkspace.workspace;
		const rootPath = workspace.uri.fsPath;
		const configPath = path.join(rootPath, '.dotenvy.json');

		// Check if cloud sync is configured
		const config = await ConfigUtils.readQuickEnvConfig();
		if (!config?.cloudSync || !config.cloudSync.project || !config.cloudSync.config || !config.cloudSync.token) {
			await ConfigUtils.writeWorkspaceConfigFile(rootPath, config);

			// Open the file for user to edit
			const doc = await vscode.workspace.openTextDocument(configPath);
			await vscode.window.showTextDocument(doc);

			vscode.window.showInformationMessage(
				'Configuration file created! Environments and project name were auto-detected. Add your Doppler token, then save and try again.'
			);

			return;
		}

		try {
			const syncConfig = config.cloudSync;
			if (!syncConfig) {
				vscode.window.showErrorMessage('Cloud sync is not configured in .dotenvy.json.');
			}
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
				// Offer to reconfigure
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
					await ConfigUtils.writeWorkspaceConfigFile(rootPath, undefined, configFilename);

					// Open the file for user to edit
					const doc = await vscode.workspace.openTextDocument(newConfigPath);
					await vscode.window.showTextDocument(doc);

					vscode.window.showInformationMessage(
						`${configFilename} created! Environments and project name were auto-detected. Add your Doppler token, then save and try again.`
					);
				}

				return;
			}

			// Confirm sync
			const proceed = await vscode.window.showWarningMessage(
				`This will sync your local .env file to ${syncConfig.provider}.\n\nAre you sure?`,
				{ modal: true },
				'Yes, Sync',
				'Cancel'
			);

			if (proceed !== 'Yes, Sync') return;

			vscode.window.showInformationMessage('🔄 Pushing environment to cloud...');

			// Read current .env file
			const envPath = path.join(rootPath, '.env');
			if (!fs.existsSync(envPath)) {
				vscode.window.showErrorMessage('No .env file found to sync.');
				return;
			}

			// Use FileUtils to check for secrets in .env file before sync
			const secretWarnings = FileUtils.checkForSecrets(envPath);
			if (secretWarnings.length > 0) {
				const proceedAnyway = await vscode.window.showWarningMessage(
					`⚠️ Detected potential secrets in .env file:\n${secretWarnings.map(w => `• ${w}`).join('\n')}\n\nAre you sure you want to sync this to the cloud?`,
					{ modal: true },
					'Sync Anyway',
					'Cancel'
				);

				if (proceedAnyway !== 'Sync Anyway') {
					return; // User cancelled due to security concerns
				}
			}

			// Parse env file into secrets object
			const envContent = fs.readFileSync(envPath, 'utf8');
			const secrets: Record<string, string> = {};

			for (const line of envContent.split('\n')) {
				const trimmed = line.trim();
				if (!trimmed || trimmed.startsWith('#')) continue;

				const equalIndex = trimmed.indexOf('=');
				if (equalIndex === -1) continue;

				const key = trimmed.substring(0, equalIndex).trim();
				const value = trimmed.substring(equalIndex + 1);

				if (key) {
					secrets[key] = value;
				}
			}

			// Filter out reserved Doppler environment variables
			const dopplerReservedKeys = [
				'DOPPLER_CONFIG',
				'DOPPLER_ENVIRONMENT',
				'DOPPLER_PROJECT',
				'DOPPLER_ENVIRONMENT_ID',
				'DOPPLER_PROJECT_ID',
				'DOPPLER_CONFIG_ID',
				'DOPPLER_ENVIRONMENT_TOKEN_NAME',
				'DOPPLER_ENVIRONMENT_TOKEN_ID'
			];

			const filteredSecrets: Record<string, string> = {};
			let filteredCount = 0;

			for (const [key, value] of Object.entries(secrets)) {
				if (dopplerReservedKeys.includes(key)) {
					filteredCount++;
				} else {
					filteredSecrets[key] = value;
				}
			}

			if (filteredCount > 0) {
				vscode.window.showInformationMessage(
					`ℹ️ Filtered out ${filteredCount} reserved Doppler environment variable(s) from sync: ${dopplerReservedKeys.filter(k => secrets.hasOwnProperty(k)).join(', ')}`
				);
			}

			// Push to cloud (using filtered secrets)
			const result = await cloudManager.pushSecrets(filteredSecrets);

			if (result.success) {
				vscode.window.showInformationMessage(`✅ Successfully synced environment to ${syncConfig.provider}!`);
			} else {
				vscode.window.showErrorMessage(`❌ Failed to sync: ${result.error}`);
			}

		} catch (error) {
			vscode.window.showErrorMessage(`Failed to sync to cloud: ${(error as Error).message}`);
		}
	}

	public dispose() {
		// Commands are disposed via vscode subscriptions
	}
}

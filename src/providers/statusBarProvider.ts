import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { EnvironmentProvider } from './environmentProvider';
import { ConfigUtils } from '../utils/configUtils';
import { GitHookManager } from '../utils/gitHookManager';
import { DopplerSyncManager } from '../utils/dopplerSyncManager';
import { CloudSyncManager } from '../utils/cloudSyncManager';
import { EnvironmentValidator } from '../utils/environmentValidator';
import { FileUtils } from '../utils/fileUtils';
import { CloudEncryptionUtils } from '../utils/encryptedCloudSyncManager';
import {
	EnvironmentStatus,
	CloudSyncStatus,
	GitHookStatus,
	ValidationStatus,
	StatusBarSegment
} from '../types/environment';

export class StatusBarProvider implements vscode.Disposable {
	private statusBarItems: Map<string, vscode.StatusBarItem> = new Map();
	private environmentProvider: EnvironmentProvider | null = null;
	private rootPath: string | null = null;
	private updateInterval?: NodeJS.Timeout;

	constructor() {
		this.createStatusBarSegments();
		this.startPeriodicUpdates();

		// Update immediately
		setTimeout(() => this.updateAllStatuses(), 1000);
	}

	/**
	 * Create segmented status bar items
	 */
	private createStatusBarSegments(): void {
		const segments: StatusBarSegment[] = [
			{
				id: 'cloud',
				text: '☁️ ...',
				tooltip: 'Cloud sync status - Click to configure',
				command: 'dotenvy.pullFromCloud',
				priority: 110,
				show: true
			},
			{
				id: 'git',
				text: '🔗 ...',
				tooltip: 'Git hook status - Click to manage',
				command: 'dotenvy.installGitHook',
				priority: 105,
				show: true
			},
			{
				id: 'validate',
				text: '✅ ...',
				tooltip: 'Validation status - Click to validate',
				command: 'dotenvy.validateEnvironment',
				priority: 100,
				show: true
			},
			{
				id: 'env',
				text: '$(gear) Env: ...',
				tooltip: 'Current environment - Click to switch',
				command: 'dotenvy.switchEnvironment',
				priority: 95,
				show: true
			}
		];

		segments.forEach(segment => {
			const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, segment.priority);
			item.text = segment.text;
			item.tooltip = segment.tooltip;
			item.command = segment.command;
			item.show();
			this.statusBarItems.set(segment.id, item);
		});
	}

	/**
	 * Set the workspace for status updates
	 */
	public setWorkspace(rootPath: string): void {
		this.rootPath = rootPath;
		this.environmentProvider = new EnvironmentProvider(rootPath);
		this.updateAllStatuses();
	}

	/**
	 * Start periodic status updates
	 */
	private startPeriodicUpdates(): void {
		this.updateInterval = setInterval(() => {
			this.updateAllStatuses();
		}, 10000); // Update every 10 seconds
	}

	/**
	 * Update all status bar segments
	 */
	public async updateAllStatuses(): Promise<void> {
		if (!this.rootPath) {
			this.updateEnvironmentStatus('No workspace');
			return;
		}

		try {
			const status = await this.gatherEnvironmentStatus(this.rootPath);
			this.updateCloudStatus(status.cloudSyncStatus);
			this.updateGitHookStatus(status.gitHookStatus);
			this.updateValidationStatus(status.validationStatus);
			this.updateEnvironmentStatus(status.environment || 'None');
		} catch (error) {
			console.error('Error updating status bar:', error);
		}
	}

	/**
	 * Gather comprehensive environment status
	 */
	private async gatherEnvironmentStatus(rootPath: string): Promise<EnvironmentStatus> {
  const config = await ConfigUtils.readQuickEnvConfig();
		const envPath = path.join(rootPath, '.env');

		// Current environment
		const currentEnv = this.environmentProvider
			? await this.environmentProvider.getCurrentEnvironment()
			: null;

		// Cloud sync status
		const cloudSyncStatus = await this.checkCloudSyncStatus(rootPath, config);

		// Git hook status
		const gitHookStatus: GitHookStatus = {
			installed: GitHookManager.isHookInstalled(rootPath),
			enabled: !!config?.gitCommitHook,
			repoPath: rootPath
		};

		// Validation status
		const validationStatus = await this.checkValidationStatus(rootPath, envPath, config);

		return {
			environment: currentEnv?.name || null,
			cloudSyncStatus,
			gitHookStatus,
			validationStatus
		};
	}

	/**
	 * Check cloud sync configuration and connection
	 */
	private async checkCloudSyncStatus(rootPath: string, config: import('../types/environment').QuickEnvConfig | null): Promise<CloudSyncStatus> {
		const status: CloudSyncStatus = {
			connected: false,
			hasConfig: !!config?.cloudSync
		};

		if (!status.hasConfig) {
			return status;
		}

		try {
			if (!config?.cloudSync) {
				return status;
			}
			const syncConfig = config.cloudSync;
			status.provider = syncConfig.provider;
			// Use CloudEncryptionUtils for consistent encryption status checking
			status.encryptionEnabled = await CloudEncryptionUtils.isCloudEncryptionEnabled(); // Will use config from workspace

			let cloudManager: CloudSyncManager;
			switch (syncConfig.provider) {
				case 'doppler':
					cloudManager = new DopplerSyncManager(syncConfig);
					break;
				default:
					status.error = `Unsupported provider: ${syncConfig.provider}`;
					return status;
			}

			const testResult = await cloudManager.testConnection();
			status.connected = testResult.success;
			if (!testResult.success && testResult.error) {
				status.error = testResult.error;
			}
		} catch (error) {
			status.error = (error as Error).message;
		}

		return status;
	}

	/**
	 * Check validation status
	 */
	private async checkValidationStatus(rootPath: string, envPath: string, config: import('../types/environment').QuickEnvConfig | null): Promise<ValidationStatus> {
		const status: ValidationStatus = {
			valid: true,
			errors: 0,
			warnings: 0
		};

		if (!config?.validation || !fs.existsSync(envPath)) {
			// Even without validation config, check for obvious security issues
			if (fs.existsSync(envPath)) {
				const secretWarnings = FileUtils.checkForSecrets(envPath);
				status.warnings = secretWarnings.length;
			}
			return status;
		}

		try {
			const errors = EnvironmentValidator.validateFile(envPath, config.validation);
			status.valid = errors.length === 0;
			status.errors = errors.length;

			// Add security check for potential secrets
			const secretWarnings = FileUtils.checkForSecrets(envPath);
			status.warnings = (status.warnings || 0) + secretWarnings.length;

			status.lastValidated = new Date();
		} catch (error) {
			status.valid = false;
			status.errors = 1;
		}

		return status;
	}

	/**
	 * Update cloud sync status segment
	 */
	private updateCloudStatus(status: CloudSyncStatus): void {
		const item = this.statusBarItems.get('cloud');
		if (!item) return;

		if (!status.hasConfig) {
			item.text = '';
			item.hide();
			return;
		}

		let text = '';
		let tooltip = `Cloud Sync: ${status.provider || 'Unknown'}`;

		if (status.encryptionEnabled) {
			text = status.connected ? '🔐 ✓' : '🔐 ✗';
			tooltip += ' (Encrypted)';
		} else {
			text = status.connected ? '☁️ ✓' : '☁️ ✗';
		}

		if (status.connected) {
			tooltip += ' (Connected ✓)';
			item.color = new vscode.ThemeColor('statusBarItem.prominentForeground');
		} else {
			tooltip += ' (Not Connected ✗)';
			item.color = new vscode.ThemeColor('statusBarItem.warningForeground');
			if (status.error) {
				tooltip += ` - ${status.error}`;
			}
		}

		item.text = text;
		item.tooltip = tooltip;
		item.show();
	}

	/**
	 * Update git hook status segment
	 */
	private updateGitHookStatus(status: GitHookStatus): void {
		const item = this.statusBarItems.get('git');
		if (!item) return;

		let text: string;
		let tooltip: string;

		if (status.installed) {
			text = '🔗 ✓';
			tooltip = 'Git Commit Hook: Installed (Click to manage)';
			item.color = new vscode.ThemeColor('statusBarItem.prominentForeground');
		} else {
			text = status.enabled ? '🔗 ⚠️' : '';
			tooltip = status.enabled
				? 'Git Commit Hook: Not installed (Click to install)'
				: 'Git Commit Hook: Disabled';
			if (!status.enabled) {
				item.hide();
				return;
			}
			item.color = new vscode.ThemeColor('statusBarItem.warningForeground');
		}

		item.text = text;
		item.tooltip = tooltip;
		item.show();
	}

	/**
	 * Update validation status segment
	 */
	private updateValidationStatus(status: ValidationStatus): void {
		const item = this.statusBarItems.get('validate');
		if (!item) return;

		let text: string;
		let tooltip: string;

		if (status.valid) {
			text = '✅';
			tooltip = 'Environment: Valid';
			item.color = new vscode.ThemeColor('statusBarItem.prominentForeground');
		} else {
			const errorCount = status.errors || 0;
			text = errorCount > 0 ? `❌ ${errorCount}` : '⚠️';
			tooltip = errorCount > 0
				? `Environment: ${errorCount} validation error(s) (Click to fix)`
				: 'Environment: Validation warnings';
			item.color = new vscode.ThemeColor('statusBarItem.errorForeground');
		}

		item.text = text;
		item.tooltip = tooltip;
		item.show();
	}

	/**
	 * Update environment status segment
	 */
	private updateEnvironmentStatus(envName: string): void {
		const item = this.statusBarItems.get('env');
		if (!item) return;

		item.text = `$(gear) ${envName}`;
		item.tooltip = `Current environment: ${envName} (Click to switch)`;
		item.show();
	}

	/**
	 * Force refresh all statuses
	 */
	public forceRefresh(): void {
		this.updateAllStatuses();
	}

	public dispose(): void {
		if (this.updateInterval) {
			clearInterval(this.updateInterval);
		}
		this.statusBarItems.forEach(item => item.dispose());
		this.statusBarItems.clear();
	}
}

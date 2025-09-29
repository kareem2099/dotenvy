import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { QuickEnvConfig, EnvironmentValidationRules } from '../types/environment';
import { extensionContext } from '../extension';

export class ConfigUtils {
	private static readonly CONFIG_KEY = 'dotenvyConfig';
	private static readonly SECRET_PREFIX = 'dotenvy:';

	/**
	 * Read QuickEnv config from VSCode storage or .dotenvy.json file
	 */
	static async readQuickEnvConfig(): Promise<QuickEnvConfig | null> {
		const workspaceFolders = vscode.workspace.workspaceFolders;
		if (workspaceFolders && workspaceFolders.length > 0) {
			const workspacePath = workspaceFolders[0].uri.fsPath;
			const configFilePath = path.join(workspacePath, '.dotenvy.json');

			try {
				if (fs.existsSync(configFilePath)) {
					const configContent = fs.readFileSync(configFilePath, 'utf8');
					const config = JSON.parse(configContent) as QuickEnvConfig;
					// Also update VSCode storage for consistency
					await extensionContext.workspaceState.update(this.CONFIG_KEY, config);
					return config;
				}
			} catch (error) {
				console.warn('Failed to read config from .dotenvy.json:', error);
			}
		}

		// Fallback to VSCode storage
		const storageConfig = await extensionContext.workspaceState.get(`${this.CONFIG_KEY}`, {}) as QuickEnvConfig;
		return storageConfig || null;
	}

	/**
	 * Save QuickEnv config to VSCode storage and .dotenvy.json file
	 */
	static async saveQuickEnvConfig(config: QuickEnvConfig): Promise<void> {
		await extensionContext.workspaceState.update(this.CONFIG_KEY, config);

		// Also save to .dotenvy.json file if workspace is available
		const workspaceFolders = vscode.workspace.workspaceFolders;
		if (workspaceFolders && workspaceFolders.length > 0) {
			const workspacePath = workspaceFolders[0].uri.fsPath;
			const configFilePath = path.join(workspacePath, '.dotenvy.json');

			try {
				await fs.promises.writeFile(
					configFilePath,
					JSON.stringify(config, null, 2),
					'utf8'
				);
			} catch (error) {
				console.warn('Failed to save config to .dotenvy.json:', error);
			}
		}
	}

	/**
	 * Get secure value from VSCode secret storage
	 */
	static async getSecret(key: string): Promise<string | undefined> {
		return await extensionContext.secrets.get(`${this.SECRET_PREFIX}${key}`);
	}

	/**
	 * Save secure value to VSCode secret storage
	 */
	static async setSecret(key: string, value: string): Promise<void> {
		await extensionContext.secrets.store(`${this.SECRET_PREFIX}${key}`, value);
	}

	/**
	 * Delete secure value
	 */
	static async deleteSecret(key: string): Promise<void> {
		await extensionContext.secrets.delete(`${this.SECRET_PREFIX}${key}`);
	}

	/**
	 * Get custom environments from config
	 * Returns environments map if config exists, otherwise null to scan .env.* files
	 */
	static async getCustomEnvironments(): Promise<Map<string, string> | null> {
		const config = await this.readQuickEnvConfig();
		if (!config || !config.environments) {
			return null;
		}

		return new Map(Object.entries(config.environments));
	}

	/**
	 * Get git branch to environment mapping
	 */
	static async getGitBranchMapping(): Promise<Map<string, string> | null> {
		const config = await this.readQuickEnvConfig();
		if (!config || !config.gitBranchMapping) {
			return null;
		}

		return new Map(Object.entries(config.gitBranchMapping));
	}

	/**
	 * Check if auto-switch on branch change is enabled
	 */
	static async isAutoSwitchEnabled(): Promise<boolean> {
		const config = await this.readQuickEnvConfig();
		return config?.autoSwitchOnBranchChange ?? false;
	}

	/**
	 * Get validation rules from config
	 */
	static async getValidationRules(): Promise<EnvironmentValidationRules | null> {
		const config = await this.readQuickEnvConfig();
		return config?.validation || null;
	}
}

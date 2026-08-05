import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { QuickEnvConfig, EnvironmentValidationRules } from '../types/environment';
import { extensionContext } from '../extension';
import { logger } from './logger';

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
				logger.warn(`Failed to read config from .dotenvy.json:', ${error}`, 'ConfigUtils');
			}
		}

		// Fallback to VSCode storage
		const storageConfig = await extensionContext.workspaceState.get(`${this.CONFIG_KEY}`, {}) as QuickEnvConfig;
		return storageConfig || null;
	}

	/**
	 * Build a default .dotenvy.json config with auto-discovered environments and project name.
	 */
	static async buildDefaultConfig(rootPath: string): Promise<QuickEnvConfig> {
		return {
			environments: await this.discoverEnvironments(rootPath),
			cloudSync: {
				provider: 'doppler',
				project: this.resolveProjectName(rootPath),
				config: 'development',
				token: ''
			}
		};
	}

	/**
	 * Fill missing project/environments fields without overwriting user values.
	 */
	static async hydrateConfig(config: QuickEnvConfig, rootPath: string): Promise<QuickEnvConfig> {
		const hydrated: QuickEnvConfig = {
			...config,
			environments: { ...(config.environments ?? {}) },
			cloudSync: config.cloudSync
				? { ...config.cloudSync }
				: {
					provider: 'doppler',
					project: this.resolveProjectName(rootPath),
					config: 'development',
					token: ''
				}
		};

		if (!hydrated.environments || Object.keys(hydrated.environments).length === 0) {
			hydrated.environments = await this.discoverEnvironments(rootPath);
		}

		if (hydrated.cloudSync && !hydrated.cloudSync.project?.trim()) {
			hydrated.cloudSync.project = this.resolveProjectName(rootPath);
		}

		return hydrated;
	}

	/**
	 * Create or refresh .dotenvy.json in the selected workspace folder.
	 */
	static async writeWorkspaceConfigFile(
		rootPath: string,
		existingConfig?: QuickEnvConfig | null,
		configFilename = '.dotenvy.json'
	): Promise<QuickEnvConfig> {
		const configPath = path.join(rootPath, configFilename);
		const config = existingConfig
			? await this.hydrateConfig(existingConfig, rootPath)
			: await this.buildDefaultConfig(rootPath);

		if (fs.existsSync(configPath)) {
			await fs.promises.copyFile(configPath, `${configPath}.backup`);
		}

		await fs.promises.writeFile(configPath, JSON.stringify(config, null, 2), 'utf8');
		await this.ensureConfigInGitignore(rootPath, configFilename);
		await this.saveQuickEnvConfig(config);

		return config;
	}

	private static async ensureConfigInGitignore(rootPath: string, configFilename: string): Promise<void> {
		const gitignorePath = path.join(rootPath, '.gitignore');
		let gitignoreContent = '';

		try {
			if (fs.existsSync(gitignorePath)) {
				gitignoreContent = fs.readFileSync(gitignorePath, 'utf8');
			}
		} catch {
			// Ignore read errors
		}

		if (!gitignoreContent.includes(configFilename)) {
			gitignoreContent += `\n${configFilename}`;
			fs.writeFileSync(gitignorePath, gitignoreContent);
		}
	}

	/**
	 * Scan the workspace for .env.* files and map them to environment names.
	 */
	static async discoverEnvironments(rootPath: string): Promise<Record<string, string>> {
		const excludedSuffixes = new Set(['backup', 'example', 'template']);
		const excludeGlob = '**/{node_modules,.git,dist,build,out,.venv,.next,coverage}/**';
		const discovered: Array<{ name: string; relativePath: string }> = [];

		try {
			const pattern = new vscode.RelativePattern(rootPath, '**/.env.*');
			const files = await vscode.workspace.findFiles(pattern, excludeGlob, 200);

			for (const uri of files) {
				if (uri.scheme !== 'file') {
					continue;
				}

				const relativePath = path.relative(rootPath, uri.fsPath);
				if (!relativePath || relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
					continue;
				}

				const fileName = path.basename(uri.fsPath);
				if (!fileName.startsWith('.env.') || fileName === '.env') {
					continue;
				}

				const envName = fileName.substring(5);
				if (!envName || excludedSuffixes.has(envName.toLowerCase())) {
					continue;
				}

				discovered.push({
					name: envName,
					relativePath: relativePath.replace(/\\/g, '/')
				});
			}
		} catch (error) {
			logger.warn(`Failed to discover environments: ${error}`, 'ConfigUtils');
		}

		return this.buildEnvironmentMap(discovered);
	}

	/**
	 * Resolve Doppler project name from package.json or workspace folder.
	 */
	static resolveProjectName(rootPath: string): string {
		const packageJsonPath = path.join(rootPath, 'package.json');

		try {
			if (fs.existsSync(packageJsonPath)) {
				const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8')) as { name?: string };
				if (pkg.name?.trim()) {
					return this.normalizeProjectName(pkg.name);
				}
			}
		} catch (error) {
			logger.warn(`Failed to read package.json for project name: ${error}`, 'ConfigUtils');
		}

		return this.normalizeProjectName(path.basename(rootPath));
	}

	private static normalizeProjectName(name: string): string {
		const unscoped = name.startsWith('@') ? (name.split('/').pop() ?? name) : name;
		return unscoped.trim().toLowerCase().replace(/[_\s]+/g, '-');
	}

	private static buildEnvironmentMap(
		discovered: Array<{ name: string; relativePath: string }>
	): Record<string, string> {
		const nameCounts = new Map<string, number>();

		for (const entry of discovered) {
			nameCounts.set(entry.name, (nameCounts.get(entry.name) ?? 0) + 1);
		}

		const environments: Record<string, string> = {};

		for (const entry of discovered) {
			let key = entry.name;

			if ((nameCounts.get(entry.name) ?? 0) > 1) {
				const parentDir = path.basename(path.dirname(entry.relativePath));
				key = parentDir && parentDir !== '.' ? `${parentDir}-${entry.name}` : entry.name;
			}

			environments[key] = entry.relativePath;
		}

		return environments;
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
				logger.warn(`Failed to save config to .dotenvy.json:', ${error}`, 'ConfigUtils');
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
		if (!config?.environments || Object.keys(config.environments).length === 0) {
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

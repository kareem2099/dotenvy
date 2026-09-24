import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { QuickEnvConfig, EnvironmentValidationRules } from '../types/environment';
import { extensionContext } from '../extension';
import { logger } from './logger';

export class ConfigUtils {
	private static readonly CONFIG_KEY = 'dotenvyConfig';
	private static readonly SECRET_PREFIX = 'dotenvy:';

	private static readonly SKIPPED_DIRS = new Set([
		'node_modules', '.git', 'dist', 'build', 'out', '.venv', '.next', 'coverage', '__pycache__'
	]);

	private static readonly EXCLUDED_ENV_SUFFIXES = new Set(['backup', 'example', 'template']);

	/**
	 * Read QuickEnv config from VSCode storage or .dotenvy.json file
	 */
	static async readQuickEnvConfig(rootPath?: string): Promise<QuickEnvConfig | null> {
		const workspacePath = rootPath ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
		if (workspacePath) {
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
	static async buildDefaultConfig(rootPath: string, projectName?: string): Promise<QuickEnvConfig> {
		return {
			environments: await this.discoverEnvironments(rootPath),
			cloudSync: {
				provider: 'doppler',
				project: projectName?.trim()
					? this.normalizeProjectName(projectName)
					: this.resolveProjectName(rootPath),
				config: 'dev',
				token: ''
			}
		};
	}

	/**
	 * Fill missing project/environments fields without overwriting user values.
	 */
	static async hydrateConfig(
		config: QuickEnvConfig,
		rootPath: string,
		projectName?: string
	): Promise<QuickEnvConfig> {
		const hydrated: QuickEnvConfig = {
			...config,
			environments: { ...(config.environments ?? {}) },
			cloudSync: config.cloudSync
				? { ...config.cloudSync }
				: {
					provider: 'doppler',
					project: projectName?.trim()
						? this.normalizeProjectName(projectName)
						: this.resolveProjectName(rootPath),
					config: 'dev',
					token: ''
				}
		};

		if (!hydrated.environments || Object.keys(hydrated.environments).length === 0) {
			hydrated.environments = await this.discoverEnvironments(rootPath);
		}

		if (hydrated.cloudSync && !hydrated.cloudSync.project?.trim()) {
			hydrated.cloudSync.project = projectName?.trim()
				? this.normalizeProjectName(projectName)
				: this.resolveProjectName(rootPath);
		}

		return hydrated;
	}

	/**
	 * Create or refresh .dotenvy.json when missing or incomplete.
	 */
	static async ensureWorkspaceConfigFile(
		rootPath: string,
		projectName?: string,
		openInEditor = false
	): Promise<QuickEnvConfig | null> {
		const configPath = path.join(rootPath, '.dotenvy.json');
		let config: QuickEnvConfig;

		if (fs.existsSync(configPath)) {
			try {
				const content = fs.readFileSync(configPath, 'utf8');
				const existing = JSON.parse(content) as QuickEnvConfig;
				const hydrated = await this.hydrateConfig(existing, rootPath, projectName);
				const environmentsChanged = JSON.stringify(hydrated.environments ?? {}) !== JSON.stringify(existing.environments ?? {});
				const projectChanged = hydrated.cloudSync?.project !== existing.cloudSync?.project;

				if (environmentsChanged || projectChanged) {
					await fs.promises.writeFile(configPath, JSON.stringify(hydrated, null, 2), 'utf8');
					await this.saveQuickEnvConfig(hydrated, rootPath);
				}

				config = hydrated;
			} catch (error) {
				logger.warn(`Failed to read config from ${configPath}: ${error}`, 'ConfigUtils');
				config = await this.writeWorkspaceConfigFile(rootPath, null, '.dotenvy.json', projectName);
			}
		} else {
			config = await this.writeWorkspaceConfigFile(rootPath, null, '.dotenvy.json', projectName);
		}

		if (openInEditor) {
			await this.openWorkspaceConfigEditor(rootPath);
		}

		return config;
	}

	static async openWorkspaceConfigEditor(
		rootPath: string,
		configFilename = '.dotenvy.json'
	): Promise<void> {
		const configPath = path.join(rootPath, configFilename);
		const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(configPath));
		await vscode.window.showTextDocument(doc, {
			viewColumn: vscode.ViewColumn.Beside,
			preview: false
		});
	}

	/**
	 * Create or refresh .dotenvy.json in the selected workspace folder.
	 */
	static async writeWorkspaceConfigFile(
		rootPath: string,
		existingConfig?: QuickEnvConfig | null,
		configFilename = '.dotenvy.json',
		projectName?: string
	): Promise<QuickEnvConfig> {
		const configPath = path.join(rootPath, configFilename);
		const config = existingConfig
			? await this.hydrateConfig(existingConfig, rootPath, projectName)
			: await this.buildDefaultConfig(rootPath, projectName);

		if (fs.existsSync(configPath)) {
			await fs.promises.copyFile(configPath, `${configPath}.backup`);
		}

		await fs.promises.writeFile(configPath, JSON.stringify(config, null, 2), 'utf8');
		await this.ensureConfigInGitignore(rootPath, configFilename);
		await this.saveQuickEnvConfig(config, rootPath);

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
	 * Scan the workspace for .env files, including gitignored files in subfolders.
	 */
	static async discoverEnvironments(rootPath: string): Promise<Record<string, string>> {
		const discovered = await this.discoverEnvironmentEntries(rootPath);
		return this.buildEnvironmentMap(discovered);
	}

	static async discoverEnvironmentEntries(
		rootPath: string
	): Promise<Array<{ name: string; relativePath: string; absolutePath: string }>> {
		const discovered: Array<{ name: string; relativePath: string }> = [];

		try {
			const absolutePaths = await this.findEnvironmentFiles(rootPath);
			for (const absolutePath of absolutePaths) {
				const relativePath = path.relative(rootPath, absolutePath).replace(/\\/g, '/');
				const parsed = this.parseEnvironmentFile(relativePath);
				if (!parsed) {
					continue;
				}

				discovered.push({
					name: parsed.name,
					relativePath
				});
			}
		} catch (error) {
			logger.warn(`Failed to discover environments: ${error}`, 'ConfigUtils');
		}

		return discovered.map(entry => ({
			...entry,
			absolutePath: path.join(rootPath, entry.relativePath)
		}));
	}

	private static async findEnvironmentFiles(rootPath: string): Promise<string[]> {
		const results: string[] = [];
		await this.walkForEnvironmentFiles(rootPath, results);
		return results.sort();
	}

	private static async walkForEnvironmentFiles(currentDir: string, results: string[]): Promise<void> {
		let entries: fs.Dirent[];

		try {
			entries = await fs.promises.readdir(currentDir, { withFileTypes: true });
		} catch {
			return;
		}

		for (const entry of entries) {
			const entryPath = path.join(currentDir, entry.name);

			if (entry.isDirectory()) {
				if (this.SKIPPED_DIRS.has(entry.name)) {
					continue;
				}
				await this.walkForEnvironmentFiles(entryPath, results);
				continue;
			}

			if (!entry.isFile()) {
				continue;
			}

			if (entry.name === '.env' || entry.name.startsWith('.env.')) {
				results.push(entryPath);
			}
		}
	}

	private static parseEnvironmentFile(relativePath: string): { name: string } | null {
		const fileName = path.basename(relativePath);
		const parentDir = path.dirname(relativePath).replace(/\\/g, '/');

		if (fileName.startsWith('.env.')) {
			const envName = fileName.substring(5);
			if (!envName || this.EXCLUDED_ENV_SUFFIXES.has(envName.toLowerCase())) {
				return null;
			}
			return { name: envName };
		}

		if (fileName === '.env' && parentDir && parentDir !== '.') {
			const folderName = path.basename(parentDir);
			return { name: `${folderName}-local` };
		}

		return null;
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
	static async saveQuickEnvConfig(config: QuickEnvConfig, rootPath?: string): Promise<void> {
		await extensionContext.workspaceState.update(this.CONFIG_KEY, config);

		const workspacePath = rootPath ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
		if (workspacePath) {
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
	static async getCustomEnvironments(rootPath?: string): Promise<Map<string, string> | null> {
		const config = await this.readQuickEnvConfig(rootPath);
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

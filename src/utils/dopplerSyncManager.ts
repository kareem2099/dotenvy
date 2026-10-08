import * as https from 'https';
import * as vscode from 'vscode';
import { t } from '../i18n';
import { CloudSyncErrorCode, CloudSyncManager, CloudSecrets, CloudSyncResult } from './cloudSyncManager';
import { CloudSyncConfig } from '../types/environment';
import { isCloudMetadataKey } from '../constants';
import { DOPPLER_RESERVED_KEYS } from './envSyncUtils';
import {
	applyResolvedConfig as persistResolvedConfig,
	handleConnectionFailure as promptConnectionFailure,
	promptConfigSelection,
	promptProjectSelection,
} from './dopplerConfigPrompt';
import { normalizeDopplerProjectSlug } from './dopplerProjectSlug';
// Doppler API response format for individual secrets
type DopplerSecretData = {
	computed: string;
} | string;

export class DopplerSyncManager extends CloudSyncManager {
	private resolvedConfig?: string;

	constructor(config: CloudSyncConfig, token?: string) {
		const project = config.project?.trim()
			? normalizeDopplerProjectSlug(config.project)
			: config.project;
		super({ ...config, project }, token);
	}

	static getDashboardUrl(project?: string, config?: string): string {
		const base = 'https://dashboard.doppler.com';
		const trimmedProject = project?.trim() ? normalizeDopplerProjectSlug(project) : undefined;
		if (!trimmedProject) {
			return base;
		}

		const projectUrl = `${base}/workplace/projects/${encodeURIComponent(trimmedProject)}`;
		const trimmedConfig = config?.trim();
		if (!trimmedConfig) {
			return projectUrl;
		}

		return `${projectUrl}/configs/${encodeURIComponent(trimmedConfig)}`;
	}

	/**
	 * Fetch secrets from Doppler
	 */
	async fetchSecrets(): Promise<CloudSyncResult> {
		try {
			const effectiveConfig = this.resolvedConfig || this.config.config;
			const url = `https://api.doppler.com/v3/configs/config/secrets/download?project=${encodeURIComponent(this.config.project)}&config=${encodeURIComponent(effectiveConfig)}&format=json`;

			const response = await this.makeDopplerRequest(url);
			const parsed = JSON.parse(response);

			// Doppler returns secrets in { key: value } format, but we need to process it
			const secrets: CloudSecrets = {};

			for (const [key, secretData] of Object.entries(parsed) as [string, DopplerSecretData][]) {
				if (secretData && typeof secretData === 'object' && 'computed' in secretData) {
					secrets[key] = secretData.computed;
				} else if (typeof secretData === 'string') {
					secrets[key] = secretData;
				}
			}

			return {
				success: true,
				secrets: secrets
			};

		} catch (error) {
			return {
				success: false,
				error: t('doppler.fetchFailed', { message: (error as Error).message })
			};
		}
	}

	/**
	 * Push secrets to Doppler (sync local env to cloud)
	 * Uses bulk update endpoint for efficiency
	 */
	async pushSecrets(secrets: CloudSecrets, _context?: vscode.ExtensionContext): Promise<CloudSyncResult> {
		return this.applySecretChanges(secrets, []);
	}

	/**
	 * Replace all syncable secrets in Doppler with the provided set (delete orphans)
	 */
	async replaceSecrets(secrets: CloudSecrets, _context?: vscode.ExtensionContext): Promise<CloudSyncResult> {
		const remote = await this.fetchSecrets();
		if (!remote.success) {
			return remote;
		}

		const remoteSecrets = DopplerSyncManager.filterSyncableSecrets(remote.secrets ?? {});
		const localKeys = new Set(Object.keys(secrets));
		const keysToDelete = Object.keys(remoteSecrets).filter(key => !localKeys.has(key));

		for (const key of Object.keys(remote.secrets ?? {})) {
			if (key.startsWith('__dotenvy_') && !keysToDelete.includes(key)) {
				keysToDelete.push(key);
			}
		}

		return this.applySecretChanges(secrets, keysToDelete);
	}

	static filterSyncableSecrets(secrets: CloudSecrets): CloudSecrets {
		const filtered: CloudSecrets = {};
		for (const [key, value] of Object.entries(secrets)) {
			if (DOPPLER_RESERVED_KEYS.includes(key)) {
				continue;
			}
			if (isCloudMetadataKey(key)) {
				continue;
			}
			filtered[key] = value;
		}
		return filtered;
	}

	private async applySecretChanges(
		secrets: CloudSecrets,
		keysToDelete: string[]
	): Promise<CloudSyncResult> {
		try {
			const token = await this.getToken();
			this.token = token;
			const effectiveConfig = this.resolvedConfig || this.config.config;
			const normalizedSecrets = this.normalizeSecretValues(secrets);

			for (const key of keysToDelete) {
				await this.deleteSecret(key, effectiveConfig, token);
			}

			if (Object.keys(normalizedSecrets).length === 0) {
				return { success: true, secrets: normalizedSecrets };
			}

			const payload = {
				project: this.config.project,
				config: effectiveConfig,
				secrets: normalizedSecrets
			};

			const options: https.RequestOptions = {
				hostname: 'api.doppler.com',
				path: '/v3/configs/config/secrets',
				method: 'POST',
				headers: {
					'Authorization': `Bearer ${token}`,
					'Content-Type': 'application/json'
				}
			};

			await this.makeRequest(options, JSON.stringify(payload));

			return {
				success: true,
				secrets: normalizedSecrets
			};

		} catch (error) {
			return {
				success: false,
				error: t('doppler.pushFailed', { message: (error as Error).message })
			};
		}
	}

	private normalizeSecretValues(secrets: CloudSecrets): CloudSecrets {
		const normalized: CloudSecrets = {};
		for (const [key, value] of Object.entries(secrets)) {
			normalized[key] = value === undefined || value === null ? '' : String(value);
		}
		return normalized;
	}

	private async deleteSecret(name: string, config: string, token: string): Promise<void> {
		const query = new URLSearchParams({
			project: this.config.project,
			config,
			name
		});

		const options: https.RequestOptions = {
			hostname: 'api.doppler.com',
			path: `/v3/configs/config/secret?${query.toString()}`,
			method: 'DELETE',
			headers: {
				'Authorization': `Bearer ${token}`
			}
		};

		await this.makeRequest(options);
	}

	/**
	 * Test connection to Doppler
	 */
	async testConnection(): Promise<CloudSyncResult> {
		const listedConfigs = await this.listConfigs().catch(() => []);
		const listedNames = listedConfigs.map(entry => entry.name);
		const configNames = [...new Set([...this.getConfigNames(), ...listedNames])];

		for (const configName of configNames) {
			try {
				// Test by trying to fetch secrets from the config (minimal request)
				const url = `https://api.doppler.com/v3/configs/config/secrets/download?project=${encodeURIComponent(this.config.project)}&config=${encodeURIComponent(configName)}&format=json&include_dynamic_secrets=false`;

				await this.makeDopplerRequest(url);

				if (configName !== this.config.config) {
					this.resolvedConfig = configName;
				}
				return { success: true, resolvedConfig: configName };
			} catch (error) {
				const errorMessage = (error as Error).message;
				if (DopplerSyncManager.isInvalidProjectError(errorMessage)) {
					return {
						success: false,
						errorCode: 'INVALID_PROJECT',
						error: t('doppler.invalidProject', { project: this.config.project })
					};
				}

				if (!DopplerSyncManager.isConfigNotFoundError(errorMessage)) {
					return { success: false, error: t('doppler.authFailed', { message: errorMessage }) };
				}
			}
		}

		if (listedNames.length > 0) {
			return {
				success: false,
				errorCode: 'CONFIG_NOT_FOUND',
				error: t('doppler.configNotFoundWithList', {
					config: this.config.config,
					project: this.config.project,
					configs: listedNames.join(', ')
				})
			};
		}

		return {
			success: false,
			errorCode: 'CONFIG_NOT_FOUND',
			error: t('doppler.configNotFound', {
				config: this.config.config,
				project: this.config.project
			})
		};
	}

	async listConfigs(): Promise<Array<{ name: string; environment?: string }>> {
		const url = `https://api.doppler.com/v3/configs?project=${encodeURIComponent(this.config.project)}&per_page=100`;
		const response = await this.makeDopplerRequest(url);
		const parsed = JSON.parse(response) as {
			configs?: Array<{ name?: string; environment?: string }>;
		};

		return (parsed.configs ?? [])
			.filter(config => Boolean(config.name))
			.map(config => ({
				name: config.name as string,
				environment: config.environment
			}));
	}

	async listProjects(): Promise<Array<{ slug: string; name: string }>> {
		const response = await this.makeDopplerRequest('https://api.doppler.com/v3/projects?per_page=100');
		const parsed = JSON.parse(response) as {
			projects?: Array<{ slug?: string; name: string; id?: string }>;
		};

		return (parsed.projects ?? [])
			.map(project => ({
				slug: project.slug || project.name,
				name: project.name
			}))
			.filter(project => Boolean(project.slug));
	}

	static async promptProjectSelection(
		rootPath: string,
		syncConfig: CloudSyncConfig
	): Promise<CloudSyncConfig | null> {
		return promptProjectSelection(rootPath, syncConfig);
	}

	static isInvalidProjectError(error?: string): boolean {
		return Boolean(error && /valid project/i.test(error));
	}

	static isConfigNotFoundError(error?: string): boolean {
		return Boolean(
			error &&
			(/Could not find requested config/i.test(error) ||
				/Could not find config/i.test(error) ||
				/configNotFound/i.test(error) ||
				(/config/i.test(error) && /not found/i.test(error)))
		);
	}

	static async promptConfigSelection(
		rootPath: string,
		syncConfig: CloudSyncConfig
	): Promise<CloudSyncConfig | null> {
		return promptConfigSelection(rootPath, syncConfig);
	}

	static async applyResolvedConfig(
		rootPath: string,
		syncConfig: CloudSyncConfig,
		resolvedConfig?: string
	): Promise<CloudSyncConfig> {
		return persistResolvedConfig(rootPath, syncConfig, resolvedConfig);
	}

	static async handleConnectionFailure(
		rootPath: string,
		syncConfig: CloudSyncConfig,
		error?: string,
		errorCode?: CloudSyncErrorCode
	): Promise<CloudSyncConfig | null> {
		return promptConnectionFailure(rootPath, syncConfig, error, errorCode);
	}

	/**
	 * Get list of config names to try, including aliases
	 */
	private getConfigNames(): string[] {
		const configAliases: { [key: string]: string[] } = {
			'development': ['development', 'dev', 'develop'],
			'dev': ['dev', 'development', 'develop'],
			'develop': ['develop', 'dev', 'development'],
			'production': ['production', 'prod', 'prd'],
			'prod': ['prod', 'production', 'prd'],
			'prd': ['prd', 'prod', 'production'],
			'staging': ['staging', 'stg', 'stage'],
			'stg': ['stg', 'staging', 'stage'],
			'stage': ['stage', 'staging', 'stg']
		};

		const baseConfig = this.config.config.toLowerCase();
		const aliases = configAliases[baseConfig] || [this.config.config];

		// Return unique configs, starting with the original
		return [...new Set([this.config.config, ...aliases])];
	}

	/**
	 * Make authenticated request to Doppler API
	 */
	private async makeDopplerRequest(url: string, method = 'GET'): Promise<string> {
		const token = await this.getToken();
		this.token = token;

		const options: https.RequestOptions = {
			hostname: 'api.doppler.com',
			path: url.replace('https://api.doppler.com', ''),
			method: method,
			headers: {
				'Authorization': `Bearer ${token}`,
				'Content-Type': 'application/json'
			}
		};

		return this.makeRequest(options);
	}
}

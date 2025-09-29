import * as https from 'https';
import { CloudSyncManager, CloudSecrets, CloudSyncResult } from './cloudSyncManager';

export class DopplerSyncManager extends CloudSyncManager {
	private resolvedConfig?: string;

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

			for (const [key, secretData] of Object.entries(parsed) as [string, any][]) {
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
				error: `Failed to fetch from Doppler: ${(error as Error).message}`
			};
		}
	}

	/**
	 * Push secrets to Doppler (sync local env to cloud)
	 * Uses bulk update endpoint for efficiency
	 */
	async pushSecrets(secrets: CloudSecrets): Promise<CloudSyncResult> {
		try {
			const effectiveConfig = this.resolvedConfig || this.config.config;
			
			// Doppler's bulk secrets endpoint expects a change_requests array
			// originalName is required for each secret (same as name for new/update operations)
			const changeRequests = Object.entries(secrets).map(([key, value]) => ({
				name: key,
				originalName: key,
				value: value,
				shouldPrompt: false
			}));

			const url = `https://api.doppler.com/v3/configs/config/secrets`;
			const payload = {
				project: this.config.project,
				config: effectiveConfig,
				change_requests: changeRequests
			};

			const options: https.RequestOptions = {
				hostname: 'api.doppler.com',
				path: url.replace('https://api.doppler.com', ''),
				method: 'POST',
				headers: {
					'Authorization': `Bearer ${this.token}`,
					'Content-Type': 'application/json'
				}
			};

			await this.makeRequest(options, JSON.stringify(payload));

			return {
				success: true,
				secrets: secrets
			};

		} catch (error) {
			return {
				success: false,
				error: `Failed to push to Doppler: ${(error as Error).message}`
			};
		}
	}

	/**
	 * Test connection to Doppler
	 */
	async testConnection(): Promise<CloudSyncResult> {
		const configNames = this.getConfigNames();

		for (const configName of configNames) {
			try {
				// Test by trying to fetch secrets from the config (minimal request)
				const url = `https://api.doppler.com/v3/configs/config/secrets/download?project=${encodeURIComponent(this.config.project)}&config=${encodeURIComponent(configName)}&format=json&include_dynamic_secrets=false`;

				await this.makeDopplerRequest(url);

				// If we reach here, connection successful
				// If this was a different config than original, remember it
				if (configName !== this.config.config) {
					this.resolvedConfig = configName;
				}
				return { success: true };
			} catch (error) {
				// If it's not a "config not found" error, fail immediately
				const errorMessage = (error as Error).message;
				if (!errorMessage.includes("Could not find requested config") &&
					!errorMessage.includes("not found") &&
					!errorMessage.includes("404")) {
					return { success: false, error: `Authentication failed: ${errorMessage}` };
				}
				// Otherwise, try next config
			}
		}

		return { success: false, error: `Could not find config "${this.config.config}" in project "${this.config.project}". Please check your configuration.` };
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
	private async makeDopplerRequest(url: string, method: string = 'GET'): Promise<string> {
		const options: https.RequestOptions = {
			hostname: 'api.doppler.com',
			path: url.replace('https://api.doppler.com', ''),
			method: method,
			headers: {
				'Authorization': `Bearer ${this.token}`,
				'Content-Type': 'application/json'
			}
		};

		return this.makeRequest(options);
	}
}

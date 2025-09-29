import * as https from 'https';
import { CloudSyncConfig } from '../types/environment';

export interface CloudSecrets {
	[key: string]: string;
}

export interface CloudSyncResult {
	success: boolean;
	secrets?: CloudSecrets;
	error?: string;
}

/**
 * Abstract base class for cloud secret providers
 */
export abstract class CloudSyncManager {
	protected config: CloudSyncConfig;
	protected token?: string;

	constructor(config: CloudSyncConfig, token?: string) {
		this.config = config;
		// Use provided token or config token, will fetch from storage/envs if needed
		this.token = token || config.token;
	}

	/**
	 * Get authentication token for the provider (async)
	 */
	protected async getToken(): Promise<string> {
		// First check if provided in constructor
		if (this.token) return this.token;

		// Try environment variable
		const envVarName = `${this.config.provider.toUpperCase()}_TOKEN`;
		const envToken = process.env[envVarName];
		if (envToken) return envToken;

		// Try secret storage
		if (this.config.provider && this.config.project) {
			const { ConfigUtils } = await import('../utils/configUtils');
			const secretToken = await ConfigUtils.getSecret(`${this.config.provider}:${this.config.project}:token`);
			if (secretToken) return secretToken;
		}

		// Try config file's token field (for backward compatibility)
		if (this.config.token) return this.config.token;

		throw new Error(`${envVarName} environment variable is required, or specify token in config or VSCode secrets`);
	}

	/**
	 * Fetch secrets from the cloud provider
	 */
	abstract fetchSecrets(): Promise<CloudSyncResult>;

	/**
	 * Push local environment to cloud provider (if supported)
	 */
	abstract pushSecrets(secrets: CloudSecrets): Promise<CloudSyncResult>;

	/**
	 * Test connection to the cloud provider
	 */
	abstract testConnection(): Promise<CloudSyncResult>;

	/**
	 * Make HTTP request to cloud provider API
	 */
	protected async makeRequest(options: https.RequestOptions, data?: string): Promise<string> {
		return new Promise((resolve, reject) => {
			const req = https.request(options, (res) => {
				let body = '';

				res.on('data', (chunk) => {
					body += chunk;
				});

				res.on('end', () => {
					if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
						resolve(body);
					} else {
						reject(new Error(`HTTP ${res.statusCode}: ${body}`));
					}
				});
			});

			req.on('error', (error) => {
				reject(error);
			});

			if (data) {
				req.write(data);
			}

			req.end();
		});
	}
}

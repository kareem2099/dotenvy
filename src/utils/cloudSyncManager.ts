import * as https from 'https';
import * as vscode from 'vscode';
import { t } from '../i18n';
import { CloudSyncConfig } from '../types/environment';

export interface CloudSecrets {
	[key: string]: string;
}

export type CloudSyncErrorCode = 'CONFIG_NOT_FOUND' | 'INVALID_PROJECT';

export interface CloudSyncResult {
	success: boolean;
	secrets?: CloudSecrets;
	error?: string;
	/** Doppler config slug used after alias/API resolution */
	resolvedConfig?: string;
	errorCode?: CloudSyncErrorCode;
}

/**
 * Abstract base class for cloud secret providers
 */
export abstract class CloudSyncManager {
	protected config: CloudSyncConfig;
	protected token?: string;

	constructor(config: CloudSyncConfig, token?: string) {
		this.config = config;
        // Explicit overrides take precedence; legacy config values are a fallback.
        this.token = token?.trim() || undefined;
	}

	/**
	 * Get authentication token for the provider (async)
	 */
	protected async getToken(): Promise<string> {
		// First check if provided in constructor
		if (this.token) return this.token;

        // Project-scoped credentials set in the UI take precedence over process-wide defaults.
        if (this.config.provider && this.config.project) {
			const { ConfigUtils } = await import('../utils/configUtils');
            const secretToken = (await ConfigUtils.getSecret(`${this.config.provider}:${this.config.project}:token`))?.trim();
            if (secretToken) return secretToken;
        }

        const envVarName = `${this.config.provider.toUpperCase()}_TOKEN`;
        const envToken = process.env[envVarName]?.trim();
        if (envToken) return envToken;

		// Try config file's token field (for backward compatibility)
        if (this.config.token?.trim()) return this.config.token.trim();

		throw new Error(t('doppler.tokenRequired', { name: envVarName }));
	}

	/**
	 * Fetch secrets from the cloud provider
	 */
	abstract fetchSecrets(context?: vscode.ExtensionContext): Promise<CloudSyncResult>;

	/**
	 * Push local environment to cloud provider (if supported)
	 */
	abstract pushSecrets(secrets: CloudSecrets, context?: vscode.ExtensionContext): Promise<CloudSyncResult>;

	/**
	 * Replace remote secrets: upsert locals and delete orphans
	 */
	async replaceSecrets(secrets: CloudSecrets, context?: vscode.ExtensionContext): Promise<CloudSyncResult> {
		return this.pushSecrets(secrets, context);
	}

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

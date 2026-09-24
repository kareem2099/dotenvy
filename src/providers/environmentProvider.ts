import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { Environment } from '../types/environment';
import { ConfigUtils } from '../utils/configUtils';
import { logger } from '../utils/logger';

export class EnvironmentProvider {
	private rootPath: string;

	constructor(rootPath: string) {
		this.rootPath = rootPath;
	}

	/**
	 * Get all available environments
	 */
	public async getEnvironments(): Promise<Environment[]> {
		const customEnvs = await ConfigUtils.getCustomEnvironments(this.rootPath);
		if (customEnvs) {
			return Array.from(customEnvs.entries()).map(([name, fileName]) => ({
				name,
				fileName,
				filePath: path.join(this.rootPath, fileName)
			}));
		}

		try {
			const entries = await ConfigUtils.discoverEnvironmentEntries(this.rootPath);
			return entries.map(entry => ({
				name: entry.name,
				fileName: entry.relativePath,
				filePath: entry.absolutePath
			}));
		} catch (error) {
			logger.error('Error discovering environments:', error, 'EnvironmentProvider');
			return [];
		}
	}

	/**
	 * Get current environment by matching .env content with source files
	 */
	public async getCurrentEnvironment(): Promise<Environment | null> {
		const envPath = path.join(this.rootPath, '.env');

		try {
			if (!fs.existsSync(envPath)) {
				return null;
			}

			const envContent = fs.readFileSync(envPath, 'utf8');
			const envHash = crypto.createHash('md5').update(envContent).digest('hex');

			// Get all available environments and find the one that matches
			const environments = await this.getEnvironments();
			for (const env of environments) {
				try {
					const envFileContent = fs.readFileSync(env.filePath, 'utf8');
					const envFileHash = crypto.createHash('md5').update(envFileContent).digest('hex');

					if (envHash === envFileHash && envContent === envFileContent) {
						return env;
					}
				} catch {
					// Skip files that can't be read
					continue;
				}
			}

			return null; // No matching environment found
		} catch {
			return null;
		}
	}
}

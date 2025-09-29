import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { Environment } from '../types/environment';
import { ConfigUtils } from '../utils/configUtils';

export class EnvironmentProvider {
	private rootPath: string;

	constructor(rootPath: string) {
		this.rootPath = rootPath;
	}

	/**
	 * Get all available environments
	 */
	public async getEnvironments(): Promise<Environment[]> {
		// Check for custom config
		const customEnvs = await ConfigUtils.getCustomEnvironments();
		if (customEnvs) {
			return Array.from(customEnvs.entries()).map(([name, fileName]) => ({
				name,
				fileName,
				filePath: path.join(this.rootPath, fileName)
			}));
		}

		// Check if we have a workspace
		if (vscode.workspace.workspaceFolders) {
			// Use workspace findFiles for better performance
			const files = await vscode.workspace.findFiles('**/.env.*', '**/node_modules/**', 100);
			return files
				.filter(uri => uri.scheme === 'file' && path.dirname(uri.fsPath) === this.rootPath)
				.map(uri => {
					const fileName = path.basename(uri.fsPath);
					const envName = fileName.substring(5); // Remove .env.
					return {
						name: envName,
						fileName,
						filePath: uri.fsPath
					};
				})
				.filter(env => env.name.length > 0 && ![ 'backup', 'example', 'template' ].includes(env.name.toLowerCase())); // Filter out unwanted
		} else {
			// No workspace - use fs to find files in rootPath
			try {
				const files = fs.readdirSync(this.rootPath);
				return files
					.filter(file => file.startsWith('.env.') && file !== '.env')
					.map(fileName => {
						const envName = fileName.substring(5); // Remove .env.
						return {
							name: envName,
							fileName,
							filePath: path.join(this.rootPath, fileName)
						};
					})
					.filter(env => env.name.length > 0 && ![ 'backup', 'example', 'template' ].includes(env.name.toLowerCase()));
			} catch (error) {
				console.error('Error reading directory for environments:', error);
				return [];
			}
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

import * as fs from 'fs';
import * as path from 'path';
import { Uri } from 'vscode';
import { Environment } from '../types/environment';

export class FileUtils {
	/**
	 * Backup the current .env file
	 */
	static async backupEnvFile(rootPath: string | Uri): Promise<void> {
		const rootPathStr = typeof rootPath === 'string' ? rootPath : rootPath.fsPath;
		const envPath = path.join(rootPathStr, '.env');
		const backupPath = path.join(rootPathStr, '.env.backup');

		if (fs.existsSync(envPath)) {
			await fs.promises.copyFile(envPath, backupPath);
		}
	}

	/**
	 * Switch to a new environment file
	 */
	static async switchToEnvironment(env: Environment, rootPath: string | Uri): Promise<void> {
		const rootPathStr = typeof rootPath === 'string' ? rootPath : rootPath.fsPath;
		const targetPath = path.join(rootPathStr, '.env');

		// Backup current
		await this.backupEnvFile(rootPath);

		// Copy new
		await fs.promises.copyFile(env.filePath, targetPath);
	}

	/**
	 * Check if a file contains potential secrets
	 */
	static checkForSecrets(filePath: string | Uri): string[] {
		try {
			const filePathStr = typeof filePath === 'string' ? filePath : filePath.fsPath;
			const content = fs.readFileSync(filePathStr, 'utf8');
			const lines = content.split('\n');
			const secretIndicators = ['key', 'secret', 'password', 'token', 'auth'];
			const warnings: string[] = [];

			for (let i = 0; i < lines.length; i++) {
				const line = lines[i];
				if (line.startsWith('#') || !line.includes('=')) continue;

				const [key] = line.split('=');
				const lowerKey = key.toLowerCase().trim();

				for (const indicator of secretIndicators) {
					if (lowerKey.includes(indicator)) {
						warnings.push(`${key} (line ${i + 1})`);
						break;
					}
				}
			}

			return warnings;
		} catch {
			return [];
		}
	}
}

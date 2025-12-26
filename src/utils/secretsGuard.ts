import { FileUtils } from './fileUtils';
import * as vscode from 'vscode';

export class SecretsGuard {
	/**
	 * Check for potential secrets in a file
	 */
	static checkFile(filePath: string): string[] {
		return FileUtils.checkForSecrets(filePath);
	}

	/**
	 * Show warning if secrets are detected
	 */
	static async warnIfSecretsDetected(filePath: string): Promise<void> {
		const warnings = this.checkFile(filePath);
		if (warnings.length > 0) {
			const message = `⚠️ Potential secrets detected: ${warnings.join(', ')}. ` +
							'Ensure you are not committing sensitive data.';
			vscode.window.showWarningMessage(message);
		}
	}
}

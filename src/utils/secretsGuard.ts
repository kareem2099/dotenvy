import { FileUtils } from './fileUtils';

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
			// Import vscode dynamically to avoid circular imports in utils
			const vscode = require('vscode');
			vscode.window.showWarningMessage(message);
		}
	}
}

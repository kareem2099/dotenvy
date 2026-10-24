import { FileUtils } from './fileUtils';
import * as vscode from 'vscode';
import { t } from '../i18n';

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
			vscode.window.showWarningMessage(t('secrets.detectedWarning', { warnings: warnings.join(', ') }));
		}
	}
}

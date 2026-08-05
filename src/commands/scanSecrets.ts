import * as vscode from 'vscode';
import { SecretDetector } from '../utils/secretDetector';
import { SecretsPanel } from '../providers/SecretsPanel';
import { extensionUri } from '../extension';
import { logger } from '../utils/logger';
import { showActionStart, showSyncToast } from '../utils/panelNotification';
import { t } from '../i18n';

const SCAN_CANCELLED = '__dotenvy_scan_cancelled__';

export class ScanSecretsCommand implements vscode.Disposable {

	public async execute(): Promise<void> {
		showActionStart(t('scan.actionStart'));

		try {
			const secrets = await vscode.window.withProgress(
				{
					location: vscode.ProgressLocation.Notification,
					title: t('scan.progress.title'),
					cancellable: true,
				},
				async (progress, token) => {
					progress.report({ increment: 0, message: t('scan.progress.initializing') });

					return await SecretDetector.scanWorkspaceEnhanced((scanProgress) => {
						const remainingMin = Math.ceil(scanProgress.estimatedTimeRemaining / 60000);
						progress.report({
							increment: scanProgress.percentage / 100,
							message: t('scan.progress.fileStatus', {
								file: scanProgress.currentFile,
								percent: scanProgress.percentage.toFixed(1),
								minutes: remainingMin
							}),
						});

						if (token.isCancellationRequested) {
							throw new Error(SCAN_CANCELLED);
						}
					});
				}
			);

			if (secrets.length === 0) {
				showSyncToast(t('scan.noneFound'), 'success');
				return;
			}

			logger.info(`Scan complete — ${secrets.length} potential secret(s) found`, 'ScanSecrets');
			showSyncToast(t('scan.found', { count: secrets.length }), 'warning');
			SecretsPanel.show(secrets, extensionUri);
		} catch (error) {
			const message = (error as Error).message;
			if (message === SCAN_CANCELLED) {
				showSyncToast(t('scan.cancelled'), 'info');
				return;
			}
			showSyncToast(t('scan.failed', { message }), 'error');
		}
	}

	public dispose(): void { /* nothing to dispose */ }
}

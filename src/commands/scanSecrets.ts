import * as vscode from 'vscode';
import { SecretDetector } from '../utils/secretDetector';
import { SecretsPanel } from '../providers/SecretsPanel';
import { extensionUri } from '../extension';
import { logger } from '../utils/logger';

export class ScanSecretsCommand implements vscode.Disposable {

    public async execute(): Promise<void> {
        const secrets = await vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: '🔍 DotEnvy: Scanning for secrets...',
                cancellable: true,
            },
            async (progress, token) => {
                progress.report({ increment: 0, message: 'Initializing scan...' });

                return await SecretDetector.scanWorkspaceEnhanced((scanProgress) => {
                    const remainingMin = Math.ceil(scanProgress.estimatedTimeRemaining / 60000);
                    progress.report({
                        increment: scanProgress.percentage / 100,
                        message: `${scanProgress.currentFile} (${scanProgress.percentage.toFixed(1)}%) — ${remainingMin}min left`,
                    });

                    if (token.isCancellationRequested) {
                        throw new Error('Scan cancelled by user');
                    }
                });
            }
        );

        if (secrets.length === 0) {
            vscode.window.showInformationMessage('✅ DotEnvy: No secrets detected in your codebase!');
            return;
        }

        logger.info(`Scan complete — ${secrets.length} potential secret(s) found`, 'ScanSecrets');

        // ✅ Show ALL secrets in the panel
        SecretsPanel.show(secrets, extensionUri);
    }

    public dispose(): void { /* nothing to dispose */ }
}
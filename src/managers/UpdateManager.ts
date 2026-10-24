import * as vscode from 'vscode';
import { EXTENSION_VERSION_KEY } from '../constants';
import { logger } from '../utils/logger';
import { t } from '../i18n';

export class UpdateManager {
    private static readonly VERSION_KEY = EXTENSION_VERSION_KEY;

    public static async checkNewVersion(context: vscode.ExtensionContext) {
        try {
            const extensionId = context.extension.id;
            const extension = vscode.extensions.getExtension(extensionId);

            if (!extension) return;

            const currentVersion = extension.packageJSON.version;
            const previousVersion = context.globalState.get<string>(this.VERSION_KEY);

            if (currentVersion !== previousVersion) {
                await context.globalState.update(this.VERSION_KEY, currentVersion);

                if (!previousVersion) {
                    this.showWelcomeMessage();
                } else {
                    // We pass the context here
                    this.showUpdateNotification(currentVersion, context);
                }
            }
        } catch (error) {
            logger.error('Failed to check for updates:', error, 'UpdateManager');
        }
    }

    private static async showUpdateNotification(version: string, context: vscode.ExtensionContext) {
        const action = t('update.action');
        const message = t('update.notice', { version });

        const result = await vscode.window.showInformationMessage(message, action);

        if (result === action) {
            await this.showChangelog(context);
        }
    }

    private static showWelcomeMessage() {
        vscode.window.showInformationMessage(t('update.welcome'));
    }

    // We receive the context to get the extension path correctly
    public static async showChangelog(context: vscode.ExtensionContext) {
        // The safe way to access the file in the root
        const changelogUri = vscode.Uri.joinPath(context.extensionUri, 'CHANGELOG.md');

        try {
            await vscode.commands.executeCommand('markdown.showPreview', changelogUri);
        } catch (e) {
            const doc = await vscode.workspace.openTextDocument(changelogUri);
            await vscode.window.showTextDocument(doc);
        }
    }
}

import * as vscode from 'vscode';
import { DotenvyIgnore } from '../utils/dotenvyIgnore';
import { logger } from '../utils/logger';
import { showActionStart, showSyncToast } from '../utils/panelNotification';
import { t } from '../i18n';

/**
 * Creates a default .dotenvyignore in the workspace root.
 * If one already exists, opens it for editing instead.
 */
export class InitDotenvyIgnoreCommand implements vscode.Disposable {
    private commandDisposable?: vscode.Disposable;

    constructor() {
        this.commandDisposable = vscode.commands.registerCommand(
            'dotenvy.initDotenvyIgnore',
            () => this.execute()
        );
    }

    async execute(): Promise<void> {
        showActionStart(t('initIgnore.actionStart'));

        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders?.length) {
            showSyncToast(t('common.noWorkspace'), 'error');
            return;
        }

        try {
            const rootPath = workspaceFolders[0].uri.fsPath;
            const created = DotenvyIgnore.createDefault(rootPath);
            const uri = vscode.Uri.joinPath(workspaceFolders[0].uri, DotenvyIgnore.FILENAME);
            const doc = await vscode.workspace.openTextDocument(uri);
            await vscode.window.showTextDocument(doc);
            if (created) {
                logger.info(`${DotenvyIgnore.FILENAME} created`, 'InitDotenvyIgnore');
            }
            showSyncToast(t(created ? 'initIgnore.created' : 'initIgnore.alreadyExists'), created ? 'success' : 'info');
        } catch (error) {
            logger.error('Could not initialize ignore file', error, 'InitDotenvyIgnore');
            showSyncToast(t('initIgnore.error', { message: (error as Error).message }), 'error');
        }
    }

    dispose(): void {
        this.commandDisposable?.dispose();
    }
}

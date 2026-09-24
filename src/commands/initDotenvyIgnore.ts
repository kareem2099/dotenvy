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
            () => { this.execute(); }
        );
    }

    async execute(): Promise<void> {
        showActionStart(t('initIgnore.actionStart'));

        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders) {
            showSyncToast(t('common.noWorkspace'), 'error');
            return;
        }

        const rootPath = workspaceFolders[0].uri.fsPath;

        if (DotenvyIgnore.exists(rootPath)) {
            const uri = vscode.Uri.joinPath(workspaceFolders[0].uri, DotenvyIgnore.FILENAME);
            const doc = await vscode.workspace.openTextDocument(uri);
            await vscode.window.showTextDocument(doc);
            showSyncToast(
                t('initIgnore.alreadyExists'),
                'info'
            );
            return;
        }

        const created = DotenvyIgnore.createDefault(rootPath);

        if (created) {
            const uri = vscode.Uri.joinPath(workspaceFolders[0].uri, DotenvyIgnore.FILENAME);
            const doc = await vscode.workspace.openTextDocument(uri);
            await vscode.window.showTextDocument(doc);

            logger.info(`${DotenvyIgnore.FILENAME} created`, 'InitDotenvyIgnore');
            showSyncToast(
                t('initIgnore.created'),
                'success'
            );
        }
    }

    dispose(): void {
        this.commandDisposable?.dispose();
    }
}

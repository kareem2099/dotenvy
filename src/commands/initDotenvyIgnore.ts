import * as vscode from 'vscode';
import { DotenvyIgnore } from '../utils/dotenvyIgnore';
import { logger } from '../utils/logger';

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
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders) {
            vscode.window.showErrorMessage('No workspace folder open.');
            return;
        }

        const rootPath = workspaceFolders[0].uri.fsPath;

        if (DotenvyIgnore.exists(rootPath)) {
            // Already exists — just open it
            const uri = vscode.Uri.joinPath(workspaceFolders[0].uri, DotenvyIgnore.FILENAME);
            const doc = await vscode.workspace.openTextDocument(uri);
            await vscode.window.showTextDocument(doc);
            vscode.window.showInformationMessage(
                `📄 ${DotenvyIgnore.FILENAME} already exists — opened for editing.`
            );
            return;
        }

        // Create default file
        const created = DotenvyIgnore.createDefault(rootPath);

        if (created) {
            const uri = vscode.Uri.joinPath(workspaceFolders[0].uri, DotenvyIgnore.FILENAME);
            const doc = await vscode.workspace.openTextDocument(uri);
            await vscode.window.showTextDocument(doc);

            logger.info(`${DotenvyIgnore.FILENAME} created`, 'InitDotenvyIgnore');
            vscode.window.showInformationMessage(
                `✅ Created ${DotenvyIgnore.FILENAME} — customize it to exclude files from secret scanning.`
            );
        }
    }

    dispose(): void {
        this.commandDisposable?.dispose();
    }
}
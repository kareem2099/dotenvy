import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { Environment } from '../types/environment';
import { FileUtils } from './fileUtils';
import { HistoryManager } from './historyManager';

/** Dashboard switches must produce the same history as the command palette. */
export async function switchEnvironmentWithHistory(environment: Environment, rootPath: string): Promise<void> {
    await FileUtils.switchToEnvironment(environment, rootPath);
    await HistoryManager.recordEntry(rootPath, 'switch', environment.name,
        await fs.promises.readFile(path.join(rootPath, '.env'), 'utf8'), environment.fileName,
        { source: 'auto' });
}

/** Record explicit editor saves, including environment files in nested packages. */
export async function recordSavedEnvironment(document: vscode.TextDocument): Promise<string | null> {
    const fileName = path.basename(document.uri.fsPath);
    if (fileName !== '.env' && !fileName.startsWith('.env.')) return null;
    const folder = vscode.workspace.getWorkspaceFolder(document.uri);
    if (!folder) return null;
    const rootPath = folder.uri.fsPath;
    const config = await HistoryManager.getConfig(rootPath);
    if (!config.enabled || !config.trackManualEdits) return null;
    const entry = await HistoryManager.recordEntry(rootPath, 'modify',
        fileName === '.env' ? 'local' : fileName.substring(5), document.getText(),
        path.relative(rootPath, document.uri.fsPath), { source: 'auto' });
    return entry ? rootPath : null;
}

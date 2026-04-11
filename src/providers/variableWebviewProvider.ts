import * as vscode from 'vscode';
import * as path from 'path';
import { EncryptedEnvironmentFile } from '../utils/encryptedVars';
import { logger } from '../utils/logger';
import { TrashBinManager } from '../utils/trashBinManager';
import { loadWebviewHtml } from '../utils/webviewUtils';

export class VariableWebviewProvider {
    public static readonly viewType = 'dotenvy.variableManager';
    private static _panel?: vscode.WebviewPanel;
    private static _context?: vscode.ExtensionContext;
    private static _extensionUri?: vscode.Uri;

    public static init(extensionUri: vscode.Uri, context: vscode.ExtensionContext) {
        VariableWebviewProvider._extensionUri = extensionUri;
        VariableWebviewProvider._context = context;
    }

    public static async openOrReveal(fileName = '.env'): Promise<void> {
        const context      = VariableWebviewProvider._context;
        const extensionUri = VariableWebviewProvider._extensionUri;

        if (!context || !extensionUri) {
            vscode.window.showErrorMessage('Variable Manager not initialized.');
            return;
        }

        if (VariableWebviewProvider._panel) {
            VariableWebviewProvider._panel.reveal(vscode.ViewColumn.One);
            // If revealed with a different file, load that file
            await VariableWebviewProvider.loadVariables(fileName);
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            VariableWebviewProvider.viewType,
            `Variable Manager`,
            vscode.ViewColumn.One,
            {
                enableScripts: true,
                localResourceRoots: [extensionUri],
                retainContextWhenHidden: true,
            }
        );

        VariableWebviewProvider._panel = panel;
        panel.webview.html = VariableWebviewProvider._getHtml(panel.webview, extensionUri);

        panel.webview.onDidReceiveMessage(async (message) => {
            await VariableWebviewProvider._handleMessage(message);
        }, undefined, context.subscriptions);

        panel.onDidDispose(() => {
            VariableWebviewProvider._panel = undefined;
        }, null, context.subscriptions);

        // Initial load
        await VariableWebviewProvider.loadVariables(fileName);
    }

    public static async loadVariables(fileName: string): Promise<void> {
        try {
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (!workspaceFolders) return;
            
            const workspacePath = workspaceFolders[0].uri.fsPath;
            const filePath = path.join(workspacePath, fileName);
            
            const context = VariableWebviewProvider._context;
            if (!context) return;
            
            const varsMap = await EncryptedEnvironmentFile.parseEnvFile(filePath, context);
            
            const variables = Array.from(varsMap.entries()).map(([key, data]) => ({
                key,
                value: data.value,
                encrypted: data.encrypted
            }));

            VariableWebviewProvider._post({
                type: 'variablesLoaded',
                variables,
                fileName,
                workspacePath
            });
        } catch (error) {
            logger.error('Failed to load variables:', error, 'VariableWebviewProvider');
            VariableWebviewProvider._post({
                type: 'error',
                message: `Failed to load variables: ${(error as Error).message}`
            });
        }
    }

    private static _post(message: { 
        type: string; 
        variables?: { key: string; value: string; encrypted: boolean }[]; 
        fileName?: string; 
        workspacePath?: string;
        message?: string;
    }): void {
        VariableWebviewProvider._panel?.webview.postMessage(message);
    }

    private static async _handleMessage(message: { 
        type: string; 
        fileName?: string; 
        key?: string; 
        value?: string; 
        encrypted?: boolean;
    }): Promise<void> {
        const context = VariableWebviewProvider._context;
        if (!context) return;
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders) return;
        const workspacePath = workspaceFolders[0].uri.fsPath;
        const envFile = message.fileName || '.env';
        const filePath = path.join(workspacePath, envFile);

        switch (message.type) {
            case 'refresh':
                await VariableWebviewProvider.loadVariables(envFile);
                break;
                
            case 'updateVariable': {
                try {
                    if (!message.key) return;
                    const varsMap = await EncryptedEnvironmentFile.parseEnvFile(filePath, context);
                    const oldData = varsMap.get(message.key);
                    
                    // Track for trash bin before update
                    if (oldData && message.key && message.value) {
                        TrashBinManager.getInstance().push({
                            key: message.key,
                            oldValue: oldData.value,
                            newValue: message.value,
                            type: 'modified',
                            environmentFile: envFile,
                            workspacePath: workspacePath
                        });
                    }

                    if (message.key && message.value) {
                        varsMap.set(message.key, {
                            value: message.value,
                            encrypted: message.encrypted || false,
                            raw: message.value
                        });
                        
                        await EncryptedEnvironmentFile.writeEnvFile(filePath, varsMap, context);
                        await VariableWebviewProvider.loadVariables(envFile);
                        vscode.window.showInformationMessage(`Variable ${message.key} updated`);
                    }
                } catch (err) {
                    vscode.window.showErrorMessage(`Update failed: ${(err as Error).message}`);
                }
                break;
            }

            case 'deleteVariable': {
                try {
                    if (!message.key) return;
                    const varsMap = await EncryptedEnvironmentFile.parseEnvFile(filePath, context);
                    const data = varsMap.get(message.key);
                    
                    if (data && message.key) {
                        TrashBinManager.getInstance().push({
                            key: message.key,
                            oldValue: data.value,
                            type: 'deleted',
                            environmentFile: envFile,
                            workspacePath: workspacePath
                        });
                    }
                    
                    if (message.key) {
                        varsMap.delete(message.key);
                        await EncryptedEnvironmentFile.writeEnvFile(filePath, varsMap, context);
                        await VariableWebviewProvider.loadVariables(envFile);
                        vscode.window.showInformationMessage(`Variable ${message.key} deleted`);
                    }
                } catch (err) {
                    vscode.window.showErrorMessage(`Delete failed: ${(err as Error).message}`);
                }
                break;
            }

            case 'toggleVarEncryption': {
                try {
                    if (!message.key) return;
                    const varsMap = await EncryptedEnvironmentFile.parseEnvFile(filePath, context);
                    const data = varsMap.get(message.key);
                    if (data) {
                        data.encrypted = !data.encrypted;
                        varsMap.set(message.key, data);
                        await EncryptedEnvironmentFile.writeEnvFile(filePath, varsMap, context);
                        await VariableWebviewProvider.loadVariables(envFile);
                    }
                } catch (err) {
                    vscode.window.showErrorMessage(`Encryption toggle failed: ${(err as Error).message}`);
                }
                break;
            }

            case 'backupSelectedEnv': {
                const { BackupCommands } = await import('../commands/backupCommands');
                await BackupCommands.backupEnv(context, filePath);
                break;
            }

            case 'restoreFromBackup': {
                const { BackupCommands } = await import('../commands/backupCommands');
                await BackupCommands.restoreFromBackup(context, workspacePath);
                break;
            }

            case 'chooseBackupLocation': {
                const { BackupCommands } = await import('../commands/backupCommands');
                await BackupCommands.chooseBackupLocation();
                break;
            }
        }
    }

    private static _getHtml(webview: vscode.Webview, extensionUri: vscode.Uri): string {
        return loadWebviewHtml({
            webview,
            extensionUri,
            templatePath: ['resources', 'panel', 'variable-manager.html'],
            tokens: {
                styleUri:  webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'resources', 'panel', 'panel.css')).toString(),
                scriptUri: webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'resources', 'panel', 'variable-manager.js')).toString(),
            },
        });
    }
}



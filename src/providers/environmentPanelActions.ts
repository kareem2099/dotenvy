/**
 * Webview messages for the environment dashboard sidebar.
 */

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { EnvironmentProvider } from './environmentProvider';
import { LocalizationService, t } from '../i18n';
import { ConfigUtils } from '../utils/configUtils';
import { DopplerSyncManager } from '../utils/dopplerSyncManager';
import {
    deleteEnvironmentVariable,
    toggleEnvironmentVariableEncryption,
    updateEnvironmentVariable,
} from './environmentVariableActions';

/**
 * Provider collaborators the panel message handler calls back into.
 */
export interface EnvironmentPanelHost {
    environmentProvider: EnvironmentProvider;
    context: vscode.ExtensionContext;
    refreshEnvironments(): Promise<void>;
}

// Webview message interfaces for different message types
export interface BaseWebviewMessage {
    type: string;
}

export interface SwitchEnvironmentMessage extends BaseWebviewMessage {
    type: 'switchEnvironment';
    environment: string;
}

export interface EditFileMessage extends BaseWebviewMessage {
    type: 'editFile';
    fileName: string;
}

export interface DiffEnvironmentMessage extends BaseWebviewMessage {
    type: 'diffEnvironment';
    environment?: string;
}

export interface CreateEnvironmentMessage extends BaseWebviewMessage {
    type: 'createEnvironment';
}

export interface OpenVariableManagerMessage extends BaseWebviewMessage {
    type: 'openVariableManager';
    fileName: string;
}

export interface BackupMessage extends BaseWebviewMessage {
    type: 'backupCurrentEnv';
}

export interface ToggleVarEncryptionMessage extends BaseWebviewMessage {
    type: 'toggleVarEncryption';
    key: string;
}

export interface VariableActionMessage extends BaseWebviewMessage {
    type: 'updateVariable' | 'deleteVariable' | 'toggleVarEncryption';
    key: string;
}

export type WebviewMessage = BaseWebviewMessage | SwitchEnvironmentMessage | EditFileMessage | OpenVariableManagerMessage | DiffEnvironmentMessage | CreateEnvironmentMessage | BackupMessage | ToggleVarEncryptionMessage | VariableActionMessage;

export async function handleEnvironmentPanelMessage(message: WebviewMessage, host: EnvironmentPanelHost): Promise<void> {
        if (!host.environmentProvider) return;

        const rootPath = host.environmentProvider['rootPath'];

        switch (message.type) {
            case 'setLocale': {
                const localeMsg = message as { locale?: string };
                if (localeMsg.locale) {
                    await LocalizationService.getInstance().setLocale(localeMsg.locale);
                    await host.refreshEnvironments();
                }
                break;
            }

            case 'refresh':
                await host.refreshEnvironments();
                break;

            case 'openHistoryPanel':
                vscode.commands.executeCommand('dotenvy.openHistoryPanel');
                break;

            case 'openAnalyticsPanel':
                vscode.commands.executeCommand('dotenvy.openAnalyticsPanel');
                break;

            case 'openTrashBin':
                vscode.commands.executeCommand('dotenvy.openTrashBin');
                break;

            case 'openVariableManager':
                const varManagerMsg = message as OpenVariableManagerMessage;
                vscode.commands.executeCommand('dotenvy.openVariableManager', varManagerMsg.fileName);
                break;


            case 'switchEnvironment':
                const switchMsg = message as SwitchEnvironmentMessage;
                const selectedEnv = (await host.environmentProvider.getEnvironments())
                    .find(env => env.name === switchMsg.environment);

                if (selectedEnv) {
                    try {
                        const { FileUtils } = await import('../utils/fileUtils');
                        const { SecretsGuard } = await import('../utils/secretsGuard');

                        await FileUtils.switchToEnvironment(selectedEnv, rootPath);

                        const warnings = SecretsGuard.checkFile(selectedEnv.filePath);
                        if (warnings.length > 0) {
                            vscode.window.showWarningMessage(
                                t('envSwitch.secretsInFile', { warnings: warnings.join(', ') })
                            );
                        }

                        vscode.window.showInformationMessage(t('envSwitch.switched', { name: selectedEnv.name }));
                        await host.refreshEnvironments();
                    } catch (error) {
                        vscode.window.showErrorMessage(t('envSwitch.failed', { message: (error as Error).message }));
                    }
                }
                break;

            case 'editFile':
                // Ensure fileName is passed and used correctly
                const editMsg = message as EditFileMessage;
                const fileUri = vscode.Uri.file(path.join(rootPath, editMsg.fileName));
                const doc = await vscode.workspace.openTextDocument(fileUri);
                await vscode.window.showTextDocument(doc);
                break;

            case 'diffEnvironment':
                const diffMsg = message as DiffEnvironmentMessage;
                if (diffMsg.environment) {
                    const selectedEnv = (await host.environmentProvider.getEnvironments())
                        .find(env => env.name === diffMsg.environment);

                    if (selectedEnv) {
                        const { EnvironmentDiffer } = await import('../utils/environmentDiffer');
                        try {
                            const diff = EnvironmentDiffer.compareFiles(path.join(rootPath, '.env'), selectedEnv.filePath);
                            const diffText = EnvironmentDiffer.formatDiffForDisplay(diff, 'Current', selectedEnv.name);
                            const doc = await vscode.workspace.openTextDocument({
                                content: diffText,
                                language: 'diff'
                            });
                            await vscode.window.showTextDocument(doc, { preview: true });
                        } catch (error) {
                            vscode.window.showErrorMessage(t('webview.diffFailed', { message: (error as Error).message }));
                        }
                    }
                } else {
                    // General diff command - show quick pick
                    const { DiffEnvironmentCommand } = await import('../commands/diffEnvironment');
                    const diffCommand = new DiffEnvironmentCommand();
                    await diffCommand.execute();
                }
                break;

            case 'createEnvironment':
                const fileName = await vscode.window.showInputBox({
                    prompt: t('webview.createEnvPrompt'),
                    placeHolder: t('webview.createEnvPlaceholder'),
                    value: '.env.',
                    validateInput: (value: string) => {
                        if (!value.startsWith('.env.')) return t('webview.mustStartWithEnv');
                        if (fs.existsSync(path.join(rootPath, value))) return t('webview.fileExists');
                        return null;
                    }
                });

                if (fileName) {
                    try {
                        const templateContent = `# ${fileName} environment variables
# Copy from another environment file and modify as needed

API_KEY=your_api_key_here
DATABASE_URL=your_database_url_here
PORT=3000
NODE_ENV=${fileName.replace('.env.', '')}
DEBUG=false
`.replace(/\r?\n/g, '\n');

                        fs.writeFileSync(path.join(rootPath, fileName), templateContent, 'utf8');
                        vscode.window.showInformationMessage(t('webview.envCreated', { fileName }));
                        await host.refreshEnvironments();

                        // Open the new file for editing
                        const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(path.join(rootPath, fileName)));
                        await vscode.window.showTextDocument(doc);
                    } catch (error) {
                        vscode.window.showErrorMessage(t('webview.createFailed', { message: (error as Error).message }));
                    }
                }
                break;

            // Cloud sync actions
            case 'pullFromCloud':
                const { PullFromCloudCommand } = await import('../commands/pullFromCloud');
                const pullCommand = new PullFromCloudCommand();
                await pullCommand.execute();
                await host.refreshEnvironments();
                break;

            case 'pushToCloud':
                const { PushToCloudCommand } = await import('../commands/pushToCloud');
                const pushCommand = new PushToCloudCommand();
                await pushCommand.execute();
                break;

            // Git hook actions
            case 'instalGitHook': // Typo in frontend - should be installGitHook
            case 'installGitHook':
                const { InstallGitHookCommand: InstallHookCmd } = await import('../commands/installGitHook');
                const installHookCommand = new InstallHookCmd();
                await installHookCommand.execute();
                await host.refreshEnvironments();
                break;

            case 'removeGitHook':
                const { RemoveGitHookCommand } = await import('../commands/removeGitHook');
                const removeHookCommand = new RemoveGitHookCommand();
                await removeHookCommand.execute();
                await host.refreshEnvironments();
                break;

            case 'openDopplerDashboard': {
                const quickEnvConfig = await ConfigUtils.readQuickEnvConfig(rootPath);
                const dashboardUrl = DopplerSyncManager.getDashboardUrl(
                    quickEnvConfig?.cloudSync?.project,
                    quickEnvConfig?.cloudSync?.config
                );
                await vscode.env.openExternal(vscode.Uri.parse(dashboardUrl));
                break;
            }

            case 'initSecureProject':
                await vscode.commands.executeCommand('dotenvy.initSecureProject');
                await host.refreshEnvironments();
                break;

            case 'initDotenvyIgnore':
                await vscode.commands.executeCommand('dotenvy.initDotenvyIgnore');
                break;

            case 'openWorkspace':
                vscode.commands.executeCommand('vscode.openFolder');
                break;

            case 'manageGitHook':
                const { InstallGitHookCommand: ManageHookCmd } = await import('../commands/installGitHook');
                const manageHookCommand = new ManageHookCmd();
                await manageHookCommand.execute();
                await host.refreshEnvironments();
                break;

            // Validation actions
            case 'backupCurrentEnv': {
                const { BackupCommands } = await import('../commands/backupCommands');
                const targetFilePath = path.join(rootPath, '.env');
                await BackupCommands.backupEnv(host.context, targetFilePath);
                await host.refreshEnvironments();
                break;
            }

            case 'chooseBackupLocation': {
                const { BackupCommands } = await import('../commands/backupCommands');
                await BackupCommands.chooseBackupLocation();
                await host.refreshEnvironments();
                break;
            }

            case 'scanSecrets':
                const { ScanSecretsCommand } = await import('../commands/scanSecrets');
                const scanSecretsCommand = new ScanSecretsCommand();
                await scanSecretsCommand.execute();
                break;

            case 'validateEnvironment':
                const { ValidateEnvironmentCommand } = await import('../commands/validateEnvironment');
                const validateCommand = new ValidateEnvironmentCommand();
                await validateCommand.execute();
                await host.refreshEnvironments();
                break;

            case 'toggleVarEncryption': {
                const toggleMsg = message as VariableActionMessage;
                await toggleEnvironmentVariableEncryption(toggleMsg.key, rootPath, host);
                break;
            }

            case 'updateVariable': {
                const updateMsg = message as VariableActionMessage;
                await updateEnvironmentVariable(updateMsg.key, rootPath, host);
                break;
            }

            case 'deleteVariable': {
                const deleteMsg = message as VariableActionMessage;
                await deleteEnvironmentVariable(deleteMsg.key, rootPath, host);
                break;
            }

            case 'restoreFromBackup': {
                const { BackupCommands } = await import('../commands/backupCommands');
                await BackupCommands.restoreFromBackup(host.context, rootPath);
                await host.refreshEnvironments();
                break;
            }
        }
    }

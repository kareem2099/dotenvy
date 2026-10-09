import * as vscode from 'vscode';
import * as path from 'path';
import { UserManager } from '../utils/userManager';
import { UserCredentials } from '../types/user';
import { MIN_PASSWORD_LENGTH } from '../constants';
import { ConfigUtils } from '../utils/configUtils';
import { showActionStart, showSyncToast } from '../utils/panelNotification';
import { t } from '../i18n';

export class InitSecureProjectCommand implements vscode.Disposable {

    public async execute(): Promise<void> {
        showActionStart(t('initSecure.actionStart'));

        if (!vscode.workspace.workspaceFolders?.length) {
            showSyncToast(t('common.noWorkspace'), 'error');
            return;
        }

        try {
            // Check if already initialized
            const reinitializing = await UserManager.isSecureProjectInitialized();
            if (reinitializing) {
                const reinitLabel = t('initSecure.reinitConfirm');
                const choice = await vscode.window.showWarningMessage(
                    t('initSecure.reinitWarning'),
                    { modal: true },
                    reinitLabel
                );

                if (choice !== reinitLabel) {
                    showSyncToast(t('initSecure.cancelled'), 'info');
                    return;
                }
            }

            // Get project name
            const projectName = await vscode.window.showInputBox({
                prompt: t('initSecure.projectNamePrompt'),
                placeHolder: t('initSecure.projectNamePlaceholder'),
                value: vscode.workspace.workspaceFolders?.[0]?.name || 'Project'
            });

            if (projectName === undefined) {
                showSyncToast(t('initSecure.cancelled'), 'info');
                return;
            }

            // Get admin username
            const adminUsername = await vscode.window.showInputBox({
                prompt: t('initSecure.usernamePrompt'),
                placeHolder: t('initSecure.usernamePlaceholder'),
                validateInput: (value) => {
                    if (!value || value.trim().length < 3) {
                        return t('initSecure.usernameMinLength');
                    }
                    if (!/^[a-zA-Z0-9_-]+$/.test(value)) {
                        return t('initSecure.usernameChars');
                    }
                    return null;
                }
            });

            if (!adminUsername) {
                showSyncToast(t('initSecure.cancelled'), 'info');
                return; // User cancelled
            }

            // Get admin password
            const adminPassword = await vscode.window.showInputBox({
                prompt: t('initSecure.passwordPrompt'),
                password: true,
                placeHolder: t('initSecure.passwordPlaceholder'),
                validateInput: (value) => {
                    if (!value || value.length < MIN_PASSWORD_LENGTH) {
                        return t('initSecure.passwordMinLength', { min: MIN_PASSWORD_LENGTH });
                    }
                    return null;
                }
            });

            if (!adminPassword) {
                showSyncToast(t('initSecure.cancelled'), 'info');
                return; // User cancelled
            }

            // Confirm password
            const confirmPassword = await vscode.window.showInputBox({
                prompt: t('initSecure.confirmPasswordPrompt'),
                password: true,
                placeHolder: t('initSecure.confirmPasswordPlaceholder'),
                validateInput: (value) => {
                    if (value !== adminPassword) {
                        return t('initSecure.passwordMismatch');
                    }
                    return null;
                }
            });

            if (!confirmPassword) {
                showSyncToast(t('initSecure.cancelled'), 'info');
                return; // User cancelled
            }

            let workspacePath: string | undefined;

            // Show progress
            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: t('initSecure.progress.title'),
                cancellable: false
            }, async (progress) => {
                progress.report({ message: t('initSecure.progress.generating') });

                const adminCredentials: UserCredentials = {
                    username: adminUsername.trim(),
                    password: adminPassword
                };

                // Keep existing keys if any of the setup prompts is cancelled.
                if (reinitializing) {
                    const rootPath = vscode.workspace.workspaceFolders![0].uri.fsPath;
                    await vscode.workspace.fs.delete(vscode.Uri.file(path.join(rootPath, '.dotenvy.lock.json')));
                }

                const result = await UserManager.initializeSecureProject(adminCredentials, projectName?.trim());

                if (result.success) {
                    workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
                    if (workspacePath) {
                        await ConfigUtils.ensureWorkspaceConfigFile(workspacePath, undefined, false);
                    }

                    showSyncToast(result.message, 'success');
                    progress.report({ message: t('initSecure.progress.done') });
                } else {
                    showSyncToast(t('initSecure.failed', { message: result.message }), 'error');
                }
            });

            if (workspacePath) {
                await ConfigUtils.openWorkspaceConfigEditor(workspacePath);
            }

        } catch (error) {
            showSyncToast(t('initSecure.error', { message: (error as Error).message }), 'error');
        }
    }

    public dispose() {
        // Commands are disposed via vscode subscriptions
    }
}

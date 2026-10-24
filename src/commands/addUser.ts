import * as vscode from 'vscode';
import { UserManager } from '../utils/userManager';
import { UserCredentials } from '../types/user';
import { MIN_PASSWORD_LENGTH } from '../constants';
import { t } from '../i18n';

export class AddUserCommand implements vscode.Disposable {

    public async execute(): Promise<void> {
        try {
            // Check if project is initialized
            if (!await UserManager.isSecureProjectInitialized()) {
                vscode.window.showErrorMessage(t('users.notInitialized'));
                return;
            }

            // Get admin username
            const adminUsername = await vscode.window.showInputBox({
                prompt: t('addUser.adminUsernamePrompt'),
                placeHolder: t('addUser.adminUsernamePlaceholder'),
                validateInput: (value) => {
                    if (!value || value.trim().length < 3) {
                        return t('initSecure.usernameMinLength');
                    }
                    return null;
                }
            });

            if (!adminUsername) {
                return; // User cancelled
            }

            // Get admin password
            const adminPassword = await vscode.window.showInputBox({
                prompt: t('addUser.adminPasswordPrompt'),
                password: true,
                placeHolder: t('addUser.adminPasswordPlaceholder'),
                validateInput: (value) => {
                    if (!value || value.length < MIN_PASSWORD_LENGTH) {
                        return t('initSecure.passwordMinLength', { min: MIN_PASSWORD_LENGTH });
                    }
                    return null;
                }
            });

            if (!adminPassword) {
                return; // User cancelled
            }

            // Get new user username
            const newUsername = await vscode.window.showInputBox({
                prompt: t('addUser.newUsernamePrompt'),
                placeHolder: t('addUser.newUsernamePlaceholder'),
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

            if (!newUsername) {
                return; // User cancelled
            }

            // 🔥 UX FIX: Check existence HERE (Before asking for password)
            // This prevents the user from wasting time typing passwords if the name is taken.
            const userExists = await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: t('addUser.checking')
            }, async () => {
                return await UserManager.userExists(newUsername.trim());
            });

            if (userExists) {
                vscode.window.showErrorMessage(t('addUser.alreadyExists', { username: newUsername }));
                return;
            }

            // Get new user password (Only if username is valid)
            const newPassword = await vscode.window.showInputBox({
                prompt: t('addUser.passwordPrompt', { username: newUsername.trim() }),
                password: true,
                placeHolder: t('addUser.passwordPlaceholder'),
                validateInput: (value) => {
                    if (!value || value.length < MIN_PASSWORD_LENGTH) {
                        return t('initSecure.passwordMinLength', { min: MIN_PASSWORD_LENGTH });
                    }
                    return null;
                }
            });

            if (!newPassword) {
                return; // User cancelled
            }

            // Confirm new user password
            const confirmNewPassword = await vscode.window.showInputBox({
                prompt: t('addUser.confirmPrompt', { username: newUsername.trim() }),
                password: true,
                placeHolder: t('addUser.confirmPlaceholder'),
                validateInput: (value) => {
                    if (value !== newPassword) {
                        return t('initSecure.passwordMismatch');
                    }
                    return null;
                }
            });

            if (!confirmNewPassword) {
                return; // User cancelled
            }

            // Process creation
            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: t('addUser.progressTitle'),
                cancellable: false
            }, async (progress) => {
                progress.report({ message: t('addUser.progressMessage') });

                const adminCredentials: UserCredentials = {
                    username: adminUsername.trim(),
                    password: adminPassword
                };

                const newUserCredentials: UserCredentials = {
                    username: newUsername.trim(),
                    password: newPassword
                };

                const result = await UserManager.addUser(adminCredentials, newUserCredentials);

                if (result.success) {
                    vscode.window.showInformationMessage(result.message);
                } else {
                    vscode.window.showErrorMessage(t('addUser.failed', { message: result.message }));
                }
            });

        } catch (error) {
            vscode.window.showErrorMessage(t('addUser.error', { message: (error as Error).message }));
        }
    }

    public dispose() {
        // Commands are disposed via vscode subscriptions
    }
}

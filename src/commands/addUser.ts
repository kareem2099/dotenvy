import * as vscode from 'vscode';
import { UserManager } from '../utils/userManager';
import { UserCredentials } from '../types/user';
import { MIN_PASSWORD_LENGTH } from '../constants';

export class AddUserCommand implements vscode.Disposable {

    public async execute(): Promise<void> {
        try {
            // Check if project is initialized
            if (!await UserManager.isSecureProjectInitialized()) {
                vscode.window.showErrorMessage('Project not initialized. Run "DotEnvy: Init Secure Project" first.');
                return;
            }

            // Get admin username
            const adminUsername = await vscode.window.showInputBox({
                prompt: 'Enter your admin username',
                placeHolder: 'admin_username',
                validateInput: (value) => {
                    if (!value || value.trim().length < 3) {
                        return 'Username must be at least 3 characters long';
                    }
                    return null;
                }
            });

            if (!adminUsername) {
                return; // User cancelled
            }

            // Get admin password
            const adminPassword = await vscode.window.showInputBox({
                prompt: 'Enter your admin password',
                password: true,
                placeHolder: 'Your admin password',
                validateInput: (value) => {
                    if (!value || value.length < MIN_PASSWORD_LENGTH) {
                        return `Password must be at least ${MIN_PASSWORD_LENGTH} characters long`;
                    }
                    return null;
                }
            });

            if (!adminPassword) {
                return; // User cancelled
            }

            // Get new user username
            const newUsername = await vscode.window.showInputBox({
                prompt: 'Enter new user username',
                placeHolder: 'new_developer_username',
                validateInput: (value) => {
                    if (!value || value.trim().length < 3) {
                        return 'Username must be at least 3 characters long';
                    }
                    if (!/^[a-zA-Z0-9_-]+$/.test(value)) {
                        return 'Username can only contain letters, numbers, hyphens, and underscores';
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
                title: 'Checking availability...'
            }, async () => {
                return await UserManager.userExists(newUsername.trim());
            });

            if (userExists) {
                vscode.window.showErrorMessage(`User "${newUsername}" already exists! Please choose another name.`);
                return;
            }

            // Get new user password (Only if username is valid)
            const newPassword = await vscode.window.showInputBox({
                prompt: `Enter password for user "${newUsername.trim()}"`,
                password: true,
                placeHolder: 'Strong password for new user',
                validateInput: (value) => {
                    if (!value || value.length < MIN_PASSWORD_LENGTH) {
                        return `Password must be at least ${MIN_PASSWORD_LENGTH} characters long`;
                    }
                    return null;
                }
            });

            if (!newPassword) {
                return; // User cancelled
            }

            // Confirm new user password
            const confirmNewPassword = await vscode.window.showInputBox({
                prompt: `Confirm password for user "${newUsername.trim()}"`,
                password: true,
                placeHolder: 'Re-enter password',
                validateInput: (value) => {
                    if (value !== newPassword) {
                        return 'Passwords do not match';
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
                title: 'Adding User to Secure Project',
                cancellable: false
            }, async (progress) => {
                progress.report({ message: 'Verifying admin credentials & Encrypting key...' });

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
                    vscode.window.showErrorMessage(`Failed to add user: ${result.message}`);
                }
            });

        } catch (error) {
            vscode.window.showErrorMessage(`Error adding user: ${(error as Error).message}`);
        }
    }

    public dispose() {
        // Commands are disposed via vscode subscriptions
    }
}

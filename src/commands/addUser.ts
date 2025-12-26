import * as vscode from 'vscode';
import { UserManager } from '../utils/userManager';
import { UserCredentials } from '../types/user';

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
                    if (!value || value.length < 8) {
                        return 'Password must be at least 8 characters long';
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
                validateInput: async (value) => {
                    if (!value || value.trim().length < 3) {
                        return 'Username must be at least 3 characters long';
                    }
                    if (!/^[a-zA-Z0-9_-]+$/.test(value)) {
                        return 'Username can only contain letters, numbers, hyphens, and underscores';
                    }
                    // Check if user already exists
                    if (await UserManager.userExists(value.trim())) {
                        return 'User already exists';
                    }
                    return null;
                }
            });

            if (!newUsername) {
                return; // User cancelled
            }

            // Get new user password
            const newPassword = await vscode.window.showInputBox({
                prompt: `Enter password for user "${newUsername.trim()}"`,
                password: true,
                placeHolder: 'Strong password for new user',
                validateInput: (value) => {
                    if (!value || value.length < 8) {
                        return 'Password must be at least 8 characters long';
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

            // Show progress
            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: 'Adding User to Secure Project',
                cancellable: false
            }, async (progress) => {
                progress.report({ message: 'Verifying admin credentials...' });

                const adminCredentials: UserCredentials = {
                    username: adminUsername.trim(),
                    password: adminPassword
                };

                const newUserCredentials: UserCredentials = {
                    username: newUsername.trim(),
                    password: newPassword
                };

                progress.report({ message: 'Encrypting user access key...' });

                const result = await UserManager.addUser(adminCredentials, newUserCredentials);

                if (result.success) {
                    vscode.window.showInformationMessage(result.message);
                    progress.report({ message: 'User added successfully!' });
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

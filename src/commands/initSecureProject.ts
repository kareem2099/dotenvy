import * as vscode from 'vscode';
import * as path from 'path';
import { UserManager } from '../utils/userManager';
import { UserCredentials } from '../types/user';

export class InitSecureProjectCommand implements vscode.Disposable {

    public async execute(): Promise<void> {
        try {
            // Check if already initialized
            if (await UserManager.isSecureProjectInitialized()) {
                const choice = await vscode.window.showWarningMessage(
                    '⚠️ Project is already initialized. Re-initializing will DELETE all existing keys and users! Continue?',
                    { modal: true },
                    'Yes, Delete & Re-init'
                );

                if (choice !== 'Yes, Delete & Re-init') {
                    return;
                }

                // Delete the old lock file so UserManager will accept the new initialization
                const workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
                if (workspacePath) {
                    const lockFilePath = path.join(workspacePath, '.dotenvy.lock.json');
                    try {
                        await vscode.workspace.fs.delete(vscode.Uri.file(lockFilePath));
                    } catch (e) {
                        console.warn('Could not delete old lock file', e);
                    }
                }
            }

            // Get project name
            const projectName = await vscode.window.showInputBox({
                prompt: 'Enter project name (optional)',
                placeHolder: 'My Secure Project',
                value: vscode.workspace.workspaceFolders?.[0]?.name || 'Project'
            });

            // Get admin username
            const adminUsername = await vscode.window.showInputBox({
                prompt: 'Enter your username (admin)',
                placeHolder: 'your_username',
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

            if (!adminUsername) {
                return; // User cancelled
            }

            // Get admin password
            const adminPassword = await vscode.window.showInputBox({
                prompt: 'Enter your password for project encryption',
                password: true,
                placeHolder: 'Strong password for project access',
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

            // Confirm password
            const confirmPassword = await vscode.window.showInputBox({
                prompt: 'Confirm your password',
                password: true,
                placeHolder: 'Re-enter password',
                validateInput: (value) => {
                    if (value !== adminPassword) {
                        return 'Passwords do not match';
                    }
                    return null;
                }
            });

            if (!confirmPassword) {
                return; // User cancelled
            }

            // Show progress
            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: 'Initializing Secure Project',
                cancellable: false
            }, async (progress) => {
                progress.report({ message: 'Generating encryption keys...' });

                const adminCredentials: UserCredentials = {
                    username: adminUsername.trim(),
                    password: adminPassword
                };

                const result = await UserManager.initializeSecureProject(adminCredentials, projectName?.trim());

                if (result.success) {
                    vscode.window.showInformationMessage(result.message);
                    progress.report({ message: 'Secure project initialized successfully!' });
                } else {
                    vscode.window.showErrorMessage(`Failed to initialize project: ${result.message}`);
                }
            });

        } catch (error) {
            vscode.window.showErrorMessage(`Error initializing secure project: ${(error as Error).message}`);
        }
    }

    public dispose() {
        // Commands are disposed via vscode subscriptions
    }
}

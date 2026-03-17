import * as vscode from 'vscode';
import { UserManager } from '../utils/userManager';
import { SessionManager } from '../utils/sessionManager';
import { UserCredentials } from '../types/user';

export class LoginToSecureProjectCommand implements vscode.Disposable {

    public async execute(): Promise<void> {
        try {
            // 1. Check if project is secured
            if (!await UserManager.isSecureProjectInitialized()) {
                vscode.window.showInformationMessage('This project is not secured via DotEnvy yet.');
                return;
            }

            // 2. Check if already logged in
            const session = SessionManager.getInstance();
            if (session.isLoggedIn()) {
                const choice = await vscode.window.showInformationMessage(
                    `You are already logged in as '${session.getCurrentUser()}'. Logout?`,
                    'Logout', 'Cancel'
                );
                if (choice === 'Logout') {
                    session.logout();
                    vscode.window.showInformationMessage('Logged out successfully.');
                }
                return;
            }

            // 3. Get List of Users (To make it easy)
            const users = await UserManager.listUsers();
            if (users.length === 0) {
                vscode.window.showErrorMessage('No users found in lock file. Corrupt file?');
                return;
            }

            // 4. Select Username
            const selectedUser = await vscode.window.showQuickPick(
                users.map(u => u.username),
                { placeHolder: 'Select your username to login 🔐' }
            );

            if (!selectedUser) return;

            // 5. Enter Password
            const password = await vscode.window.showInputBox({
                prompt: `Enter password for ${selectedUser}`,
                password: true,
                placeHolder: 'Your secure password',
                ignoreFocusOut: true
            });

            if (!password) return;

            // 6. Attempt Decryption
            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: 'Unlocking Secure Vault...',
            }, async () => {
                const credentials: UserCredentials = {
                    username: selectedUser,
                    password: password
                };

                // Here's the magic: we use UserManager to decrypt
                const result = await UserManager.accessProjectKey(credentials);

                if (result.success && result.projectKey) {
                    // Store session information securely in memory
                    session.setSession(selectedUser, result.projectKey);
                    vscode.window.showInformationMessage(`🔓 Welcome back, ${selectedUser}! Environment unlocked.`);
                } else {
                    vscode.window.showErrorMessage(`⛔ Login failed: ${result.message}`);
                }
            });

        } catch (error) {
            vscode.window.showErrorMessage(`Login error: ${(error as Error).message}`);
        }
    }

    public dispose() {
        // Commands are disposed via vscode subscriptions
    }
}

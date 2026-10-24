import * as vscode from 'vscode';
import { UserManager } from '../utils/userManager';
import { SessionManager } from '../utils/sessionManager';
import { UserCredentials } from '../types/user';
import { t } from '../i18n';

export class LoginToSecureProjectCommand implements vscode.Disposable {

    public async execute(): Promise<void> {
        try {
            // 1. Check if project is secured
            if (!await UserManager.isSecureProjectInitialized()) {
                vscode.window.showInformationMessage(t('login.notSecured'));
                return;
            }

            // 2. Check if already logged in
            const session = SessionManager.getInstance();
            if (session.isLoggedIn()) {
                const logoutLabel = t('login.logout');
                const choice = await vscode.window.showInformationMessage(
                    t('login.alreadyIn', { user: session.getCurrentUser() ?? '' }),
                    logoutLabel, t('common.cancel')
                );
                if (choice === logoutLabel) {
                    session.logout();
                    vscode.window.showInformationMessage(t('login.loggedOut'));
                }
                return;
            }

            // 3. Get List of Users (To make it easy)
            const users = await UserManager.listUsers();
            if (users.length === 0) {
                vscode.window.showErrorMessage(t('login.noUsers'));
                return;
            }

            // 4. Select Username
            const selectedUser = await vscode.window.showQuickPick(
                users.map(u => u.username),
                { placeHolder: t('login.selectUser') }
            );

            if (!selectedUser) return;

            // 5. Enter Password
            const password = await vscode.window.showInputBox({
                prompt: t('login.passwordPrompt', { user: selectedUser }),
                password: true,
                placeHolder: t('login.passwordPlaceholder'),
                ignoreFocusOut: true
            });

            if (!password) return;

            // 6. Attempt Decryption
            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: t('login.unlocking'),
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
                    vscode.window.showInformationMessage(t('login.welcome', { user: selectedUser }));
                } else {
                    vscode.window.showErrorMessage(t('login.failed', { message: result.message ?? '' }));
                }
            });

        } catch (error) {
            vscode.window.showErrorMessage(t('login.error', { message: (error as Error).message }));
        }
    }

    public dispose() {
        // Commands are disposed via vscode subscriptions
    }
}

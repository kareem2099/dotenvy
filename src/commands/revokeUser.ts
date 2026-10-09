import * as vscode from 'vscode';
import { UserManager } from '../utils/userManager';
import { UserCredentials } from '../types/user';
import { t } from '../i18n';

export class RevokeUserCommand implements vscode.Disposable {

    public async execute(): Promise<void> {
        try {
            // Safety Check
            if (!await UserManager.isSecureProjectInitialized()) {
                vscode.window.showErrorMessage(t('users.notInitialized'));
                return;
            }

            // ==========================================
            // Step 1: Admin Authentication
            // ==========================================

            const adminUsername = await vscode.window.showInputBox({
                prompt: t('revoke.adminUsernamePrompt'),
                placeHolder: t('revoke.adminUsernamePlaceholder'),
                ignoreFocusOut: true
            });

            if (!adminUsername) return;

            const adminPassword = await vscode.window.showInputBox({
                prompt: t('revoke.adminPasswordPrompt', { username: adminUsername }),
                password: true,
                placeHolder: t('revoke.adminPasswordPlaceholder'),
                ignoreFocusOut: true
            });

            if (!adminPassword) return;

            const adminCredentials: UserCredentials = {
                username: adminUsername,
                password: adminPassword
            };

            // Verify Admin First (Fail Fast)
            const accessResult = await UserManager.accessProjectKey(adminCredentials);
            if (!accessResult.success) {
                vscode.window.showErrorMessage(t('revoke.accessDenied', { message: accessResult.message ?? '' }));
                return;
            }

            // ==========================================
            // Step 2: Select User to Revoke (QuickPick)
            // ==========================================

            // Get all users from the file
            const users = await UserManager.listUsers();

            // Create QuickPick items
            const items = users.map(u => ({
                label: u.username,
                description: u.role,
                detail: t('revoke.lastAccess', { time: u.lastAccess ? new Date(u.lastAccess).toLocaleString() : t('revoke.never') }),
                picked: false
            }));

            const selectedUser = await vscode.window.showQuickPick(items, {
                placeHolder: t('revoke.selectUser'),
                title: t('revoke.title'),
                matchOnDescription: true
            });

            if (!selectedUser) return; // Cancelled

            // Protection: if admin selects themselves
            if (selectedUser.label === adminUsername) {
                const revokeMe = t('revoke.yesRevokeMe');
                const confirm = await vscode.window.showWarningMessage(
                    t('revoke.selfWarning'),
                    revokeMe, t('common.cancel')
                );
                if (confirm !== revokeMe) return;
            } else {
                // Normal confirmation
                const revokeLabel = t('revoke.yesRevoke');
                const confirm = await vscode.window.showWarningMessage(
                    t('revoke.confirm', { username: selectedUser.label }),
                    { modal: true },
                    revokeLabel, t('common.cancel')
                );
                if (confirm !== revokeLabel) return;
            }

            // ==========================================
            // Step 3: Execute Revocation
            // ==========================================

            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: t('revoke.progress', { username: selectedUser.label }),
            }, async () => {
                const result = await UserManager.revokeUser(adminCredentials, selectedUser.label);

                if (result.success) {
                    vscode.window.showInformationMessage(t('revoke.success', { message: result.message }));
                } else {
                    vscode.window.showErrorMessage(t('revoke.failed', { message: result.message }));
                }
            });

        } catch (error) {
            vscode.window.showErrorMessage(t('common.errorWithMessage', { message: (error as Error).message }));
        }
    }

    public dispose() {
        // Commands are disposed via vscode subscriptions
    }
}

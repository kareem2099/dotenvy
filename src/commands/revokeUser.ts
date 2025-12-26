import * as vscode from 'vscode';
import { UserManager } from '../utils/userManager';
import { UserCredentials } from '../types/user';

export class RevokeUserCommand implements vscode.Disposable {

    public async execute(): Promise<void> {
        try {
            // Safety Check
            if (!await UserManager.isSecureProjectInitialized()) {
                vscode.window.showErrorMessage('Project not initialized. Run "DotEnvy: Init Secure Project" first.');
                return;
            }

            // ==========================================
            // Step 1: Admin Authentication
            // ==========================================

            const adminUsername = await vscode.window.showInputBox({
                prompt: 'Enter Admin Username (to authorize revocation)',
                placeHolder: 'admin_username',
                ignoreFocusOut: true
            });

            if (!adminUsername) return;

            const adminPassword = await vscode.window.showInputBox({
                prompt: `Enter password for admin '${adminUsername}'`,
                password: true,
                placeHolder: 'Admin password',
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
                vscode.window.showErrorMessage(`⛔ Access Denied: ${accessResult.message}`);
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
                detail: `Last access: ${u.lastAccess ? new Date(u.lastAccess).toLocaleString() : 'Never'}`,
                picked: false
            }));

            const selectedUser = await vscode.window.showQuickPick(items, {
                placeHolder: 'Select the user to REVOKE access',
                title: 'Revoke User Access 🚫',
                matchOnDescription: true
            });

            if (!selectedUser) return; // Cancelled

            // Protection: if admin selects themselves
            if (selectedUser.label === adminUsername) {
                const confirm = await vscode.window.showWarningMessage(
                    '⚠️ You are about to revoke your own access! Are you sure?',
                    'Yes, Revoke Me', 'Cancel'
                );
                if (confirm !== 'Yes, Revoke Me') return;
            } else {
                // Normal confirmation
                const confirm = await vscode.window.showWarningMessage(
                    `Are you sure you want to revoke access for '${selectedUser.label}'? They will lose access to secrets immediately.`,
                    { modal: true },
                    'Yes, Revoke', 'Cancel'
                );
                if (confirm !== 'Yes, Revoke') return;
            }

            // ==========================================
            // Step 3: Execute Revocation
            // ==========================================

            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: `Revoking access for ${selectedUser.label}...`,
            }, async () => {
                const result = await UserManager.revokeUser(adminCredentials, selectedUser.label);

                if (result.success) {
                    vscode.window.showInformationMessage(`✅ ${result.message}`);
                } else {
                    vscode.window.showErrorMessage(`❌ Failed: ${result.message}`);
                }
            });

        } catch (error) {
            vscode.window.showErrorMessage(`Error: ${(error as Error).message}`);
        }
    }

    public dispose() {
        // Commands are disposed via vscode subscriptions
    }
}

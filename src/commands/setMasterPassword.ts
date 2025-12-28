import * as vscode from 'vscode';
import { EncryptedVarsManager } from '../utils/encryptedVars';
import { MIN_PASSWORD_LENGTH } from '../constants';

export class SetMasterPasswordCommand implements vscode.Disposable {
	constructor(private readonly context: vscode.ExtensionContext) {}

	public async execute(): Promise<void> {
		// Check if workspace has existing encrypted variables
		const hasEncryptedVars = await EncryptedVarsManager.workspaceHasEncryptedVars();

		let oldPassword: string | undefined;

		if (hasEncryptedVars) {
			// If there are encrypted variables, we need the old password first for migration
			oldPassword = await vscode.window.showInputBox({
				prompt: 'Enter your current master password',
				password: true,
				placeHolder: 'Current password to decrypt existing variables',
				validateInput: (value) => {
					if (!value) {
						return 'Current password is required to migrate encrypted variables';
					}
					return null;
				}
			});

			if (!oldPassword) {
				return; // User cancelled
			}
		}

		// Ask for new password
		const newPassword = await vscode.window.showInputBox({
			prompt: 'Enter new master password for encrypting environment variables',
			password: true,
			placeHolder: 'Strong password for variable encryption',
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

		// Confirm new password
		const confirmPassword = await vscode.window.showInputBox({
			prompt: 'Confirm new master password',
			password: true,
			placeHolder: 'Re-enter new password',
			validateInput: (value) => {
				if (value !== newPassword) {
					return 'Passwords do not match';
				}
				return null;
			}
		});

		if (!confirmPassword) {
			return; // User cancelled
		}

		try {
			if (hasEncryptedVars && oldPassword) {
				// Use changeMasterPassword for migration
				const result = await EncryptedVarsManager.changeMasterPassword(oldPassword, newPassword, this.context);

				if (result.success) {
					if (result.migratedCount > 0) {
						vscode.window.showInformationMessage(
							`Master password changed successfully! Migrated ${result.migratedCount} encrypted variable(s).`
						);
					} else {
						vscode.window.showInformationMessage('Master password changed successfully!');
					}
				} else {
					vscode.window.showErrorMessage(`Failed to change master password: ${result.error}`);
				}
			} else {
				// No existing encrypted variables, use simple set
				await EncryptedVarsManager.setMasterPassword(newPassword, this.context);
			}
		} catch (error) {
			vscode.window.showErrorMessage(`Failed to set master password: ${(error as Error).message}`);
		}
	}

	public dispose() {
		// Commands are disposed via vscode subscriptions
	}
}

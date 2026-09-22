import * as vscode from 'vscode';
import { EncryptedVarsManager } from '../utils/encryptedVars';
import { MIN_PASSWORD_LENGTH } from '../constants';

export class SetMasterPasswordCommand implements vscode.Disposable {
	private commandDisposable: vscode.Disposable;

	constructor(private readonly context: vscode.ExtensionContext) {
		this.commandDisposable = vscode.commands.registerCommand('dotenvy.setMasterPassword', () => {
			this.execute();
		});
	}

	public async execute(): Promise<void> {
		const hasKeyInVault = await EncryptedVarsManager.hasMasterKey(this.context);
		const hasPasswordInVault = await EncryptedVarsManager.hasMasterPassword(this.context);
		const hasEncryptedVars = await EncryptedVarsManager.workspaceHasEncryptedVars();

		let oldPassword: string | undefined;

		// Path 1: User previously set a password AND there are encrypted variables to migrate
		if (hasEncryptedVars && hasPasswordInVault) {
			oldPassword = await vscode.window.showInputBox({
				prompt: '⚠️ Update Existing Password: Enter current master password',
				password: true,
				placeHolder: 'Current master password to decrypt existing variables',
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
			prompt: hasPasswordInVault 
				? '🔒 Change existing master password for encryption' 
				: (hasKeyInVault 
					? '🔐 Convert auto-generated master key to a master password' 
					: 'Enter new master password for encrypting environment variables'),
			password: true,
			placeHolder: hasPasswordInVault 
				? 'Enter NEW password (this will replace your current master password)' 
				: (hasKeyInVault 
					? 'Enter master password (existing encrypted variables will be migrated)' 
					: 'Strong password for variable encryption'),
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
			if (hasEncryptedVars && hasPasswordInVault && oldPassword) {
				// Path 1: Password-to-Password migration
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
			} else if (hasEncryptedVars && !hasPasswordInVault && hasKeyInVault) {
				// Path 2: Auto-Key to Password migration (no old password required)
				const result = await EncryptedVarsManager.migrateFromAutoKeyToPassword(newPassword, this.context);

				if (result.success) {
					if (result.migratedCount > 0) {
						vscode.window.showInformationMessage(
							`Master password set successfully! Migrated ${result.migratedCount} encrypted variable(s) from auto-generated key.`
						);
					} else {
						vscode.window.showInformationMessage('Master password set successfully!');
					}
				} else {
					vscode.window.showErrorMessage(`Failed to migrate to master password: ${result.error}`);
				}
			} else {
				// Path 3: Fresh set
				await EncryptedVarsManager.setMasterPassword(newPassword, this.context);
			}
		} catch (error) {
			vscode.window.showErrorMessage(`Failed to set master password: ${(error as Error).message}`);
		}
	}

	public dispose() {
		this.commandDisposable?.dispose();
	}
}

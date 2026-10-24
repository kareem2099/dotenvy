import * as vscode from 'vscode';
import { EncryptedVarsManager } from '../utils/encryptedVars';
import { MIN_PASSWORD_LENGTH } from '../constants';
import { t } from '../i18n';

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
				prompt: t('master.promptCurrent'),
				password: true,
				placeHolder: t('master.placeholderCurrent'),
				validateInput: (value) => {
					if (!value) {
						return t('master.currentRequired');
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
				? t('master.promptChange')
				: (hasKeyInVault
					? t('master.promptConvert')
					: t('master.promptNew')),
			password: true,
			placeHolder: hasPasswordInVault
				? t('master.placeholderChange')
				: (hasKeyInVault
					? t('master.placeholderConvert')
					: t('master.placeholderNew')),
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

		// Confirm new password
		const confirmPassword = await vscode.window.showInputBox({
			prompt: t('master.confirmPrompt'),
			password: true,
			placeHolder: t('master.confirmPlaceholder'),
			validateInput: (value) => {
				if (value !== newPassword) {
					return t('initSecure.passwordMismatch');
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
							t('master.changedMigrated', { count: result.migratedCount })
						);
					} else {
						vscode.window.showInformationMessage(t('master.changed'));
					}
				} else {
					vscode.window.showErrorMessage(t('master.changeFailed', { message: result.error ?? '' }));
				}
			} else if (hasEncryptedVars && !hasPasswordInVault && hasKeyInVault) {
				// Path 2: Auto-Key to Password migration (no old password required)
				const result = await EncryptedVarsManager.migrateFromAutoKeyToPassword(newPassword, this.context);

				if (result.success) {
					if (result.migratedCount > 0) {
						vscode.window.showInformationMessage(
							t('master.setMigrated', { count: result.migratedCount })
						);
					} else {
						vscode.window.showInformationMessage(t('master.set'));
					}
				} else {
					vscode.window.showErrorMessage(t('master.migrateFailed', { message: result.error ?? '' }));
				}
			} else {
				// Path 3: Fresh set
				await EncryptedVarsManager.setMasterPassword(newPassword, this.context);
			}
		} catch (error) {
			vscode.window.showErrorMessage(t('master.setFailed', { message: (error as Error).message }));
		}
	}

	public dispose() {
		this.commandDisposable?.dispose();
	}
}

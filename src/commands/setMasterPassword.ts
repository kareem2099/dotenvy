import * as vscode from 'vscode';
import { EncryptedVarsManager } from '../utils/encryptedVars';

export class SetMasterPasswordCommand implements vscode.Disposable {
	constructor(private readonly context: vscode.ExtensionContext) {}

	public async execute(): Promise<void> {
		const password = await vscode.window.showInputBox({
			prompt: 'Enter master password for encrypting environment variables',
			password: true,
			placeHolder: 'Strong password for variable encryption',
			validateInput: (value) => {
				if (!value || value.length < 8) {
					return 'Password must be at least 8 characters long';
				}
				return null;
			}
		});

		if (!password) {
			return; // User cancelled
		}

		const confirmPassword = await vscode.window.showInputBox({
			prompt: 'Confirm master password',
			password: true,
			placeHolder: 'Re-enter password',
			validateInput: (value) => {
				if (value !== password) {
					return 'Passwords do not match';
				}
				return null;
			}
		});

		if (!confirmPassword) {
			return; // User cancelled
		}

		try {
			await EncryptedVarsManager.setMasterPassword(password, this.context);
		} catch (error) {
			vscode.window.showErrorMessage(`Failed to set master password: ${(error as Error).message}`);
		}
	}

	public dispose() {
		// Commands are disposed via vscode subscriptions
	}
}

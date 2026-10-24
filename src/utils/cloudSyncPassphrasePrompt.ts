import * as vscode from 'vscode';
import { MIN_PASSWORD_LENGTH } from '../constants';
import { t } from '../i18n';

export type PassphrasePromptResult =
    | { status: 'ok'; passphrase: string }
    | { status: 'cancelled' }
    | { status: 'mismatch' };

export async function promptCreatePassphrase(): Promise<PassphrasePromptResult> {
    const created = await vscode.window.showInputBox({
        prompt: t('cloudSync.passphraseCreatePrompt'),
        password: true,
        ignoreFocusOut: true,
        validateInput: (value) => {
            if (!value || value.length < MIN_PASSWORD_LENGTH) {
                return t('cloudSync.passphraseMinLength', { min: MIN_PASSWORD_LENGTH });
            }
            return null;
        },
    });

    if (!created || created.length < MIN_PASSWORD_LENGTH) {
        return { status: 'cancelled' };
    }

    const confirmed = await vscode.window.showInputBox({
        prompt: t('cloudSync.passphraseConfirmPrompt'),
        password: true,
        ignoreFocusOut: true,
    });

    if (!confirmed) {
        return { status: 'cancelled' };
    }

    if (confirmed !== created) {
        return { status: 'mismatch' };
    }

    return { status: 'ok', passphrase: created };
}

export async function promptUnlockPassphrase(): Promise<PassphrasePromptResult> {
    const value = await vscode.window.showInputBox({
        prompt: t('cloudSync.passphraseUnlockPrompt'),
        password: true,
        ignoreFocusOut: true,
    });

    if (!value) {
        return { status: 'cancelled' };
    }

    return { status: 'ok', passphrase: value };
}

/**
 * Encrypt, update, and delete individual variables from the environment panel.
 */

import * as vscode from 'vscode';
import * as path from 'path';
import { EncryptedVarsManager, EncryptedEnvironmentFile } from '../utils/encryptedVars';
import { TrashBinManager } from '../utils/trashBinManager';
import { t } from '../i18n';

/**
 * Collaborators variable actions need from the environment panel.
 */
export interface EnvironmentVariableHost {
    context: vscode.ExtensionContext;
    refreshEnvironments(): Promise<void>;
}

/**
 * Toggles whether one `.env` value is stored encrypted.
 */
export async function toggleEnvironmentVariableEncryption(
    key: string,
    rootPath: string,
    host: EnvironmentVariableHost,
): Promise<void> {
    if (!key) {
        vscode.window.showErrorMessage(t('vars.noKey'));
        return;
    }

    const envFilePath = path.join(rootPath, '.env');

    try {
        const cryptoKey = await EncryptedVarsManager.ensureMasterKey(host.context);
        const currentVars = await EncryptedEnvironmentFile.parseEnvFile(envFilePath, host.context, cryptoKey);

        const varData = currentVars.get(key);
        if (!varData) {
            vscode.window.showErrorMessage(t('vars.notFound', { key }));
            return;
        }

        varData.encrypted = !varData.encrypted;
        currentVars.set(key, varData);

        await EncryptedEnvironmentFile.writeEnvFile(envFilePath, currentVars, host.context, cryptoKey);
        await host.refreshEnvironments();

        vscode.window.showInformationMessage(
            varData.encrypted ? t('vars.encrypted', { key }) : t('vars.decrypted', { key })
        );
    } catch (error) {
        vscode.window.showErrorMessage(t('vars.toggleFailed', { key, message: (error as Error).message }));
    }
}

/**
 * Prompts for a new value and writes it back to `.env`.
 */
export async function updateEnvironmentVariable(
    key: string,
    rootPath: string,
    host: EnvironmentVariableHost,
): Promise<void> {
    const envFilePath = path.join(rootPath, '.env');

    try {
        const cryptoKey = await EncryptedVarsManager.ensureMasterKey(host.context);
        const currentVars = await EncryptedEnvironmentFile.parseEnvFile(envFilePath, host.context, cryptoKey);

        const varData = currentVars.get(key);
        if (!varData) {
            vscode.window.showErrorMessage(t('vars.notFoundShort', { key }));
            return;
        }

        const newValue = await vscode.window.showInputBox({
            prompt: t('vars.newValuePrompt', { key }),
            value: varData.value,
            ignoreFocusOut: true
        });

        if (newValue !== undefined && newValue !== varData.value) {
            TrashBinManager.getInstance().push({
                key,
                oldValue: varData.value,
                newValue: newValue,
                environmentFile: '.env',
                workspacePath: rootPath,
                type: 'modified'
            });

            varData.value = newValue;
            currentVars.set(key, varData);
            await EncryptedEnvironmentFile.writeEnvFile(envFilePath, currentVars, host.context, cryptoKey);
            await host.refreshEnvironments();
            vscode.window.showInformationMessage(t('vars.updated', { key }));
        }
    } catch (error) {
        vscode.window.showErrorMessage(t('vars.updateFailed', { message: (error as Error).message }));
    }
}

/**
 * Confirms and deletes one variable from `.env`, keeping it in the trash bin.
 */
export async function deleteEnvironmentVariable(
    key: string,
    rootPath: string,
    host: EnvironmentVariableHost,
): Promise<void> {
    const envFilePath = path.join(rootPath, '.env');

    try {
        const cryptoKey = await EncryptedVarsManager.ensureMasterKey(host.context);
        const currentVars = await EncryptedEnvironmentFile.parseEnvFile(envFilePath, host.context, cryptoKey);

        const varData = currentVars.get(key);
        if (!varData) return;

        const deleteAction = t('vars.deleteAction');
        const confirm = await vscode.window.showWarningMessage(
            t('vars.deleteConfirm', { key }), { modal: true }, deleteAction
        );

        if (confirm === deleteAction) {
            TrashBinManager.getInstance().push({
                key,
                oldValue: varData.value,
                environmentFile: '.env',
                workspacePath: rootPath,
                type: 'deleted'
            });

            currentVars.delete(key);
            await EncryptedEnvironmentFile.writeEnvFile(envFilePath, currentVars, host.context, cryptoKey);
            await host.refreshEnvironments();
            vscode.window.showInformationMessage(t('vars.deleted', { key }));
        }
    } catch (error) {
        vscode.window.showErrorMessage(t('vars.deleteFailed', { message: (error as Error).message }));
    }
}

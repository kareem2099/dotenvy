/**
 * Encrypt, update, and delete individual variables from the environment panel.
 */

import * as vscode from 'vscode';
import * as path from 'path';
import { EncryptedVarsManager, EncryptedEnvironmentFile } from '../utils/encryptedVars';
import { TrashBinManager } from '../utils/trashBinManager';

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
        vscode.window.showErrorMessage('No variable key provided for encryption toggle');
        return;
    }

    const envFilePath = path.join(rootPath, '.env');

    try {
        const cryptoKey = await EncryptedVarsManager.ensureMasterKey(host.context);
        const currentVars = await EncryptedEnvironmentFile.parseEnvFile(envFilePath, host.context, cryptoKey);

        const varData = currentVars.get(key);
        if (!varData) {
            vscode.window.showErrorMessage(`Variable '${key}' not found in .env file`);
            return;
        }

        varData.encrypted = !varData.encrypted;
        currentVars.set(key, varData);

        await EncryptedEnvironmentFile.writeEnvFile(envFilePath, currentVars, host.context, cryptoKey);
        await host.refreshEnvironments();

        const action = varData.encrypted ? 'Encrypted' : 'Decrypted';
        const icon = varData.encrypted ? '🔒' : '🔓';
        vscode.window.showInformationMessage(`${icon} ${action} variable '${key}'`);
    } catch (error) {
        vscode.window.showErrorMessage(`Failed to toggle encryption for '${key}': ${(error as Error).message}`);
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
            vscode.window.showErrorMessage(`Variable '${key}' not found.`);
            return;
        }

        const newValue = await vscode.window.showInputBox({
            prompt: `Enter new value for ${key}`,
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
            vscode.window.showInformationMessage(`✅ Updated ${key}`);
        }
    } catch (error) {
        vscode.window.showErrorMessage(`Update failed: ${(error as Error).message}`);
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

        const confirm = await vscode.window.showWarningMessage(
            `Delete variable '${key}'?`, { modal: true }, 'Delete'
        );

        if (confirm === 'Delete') {
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
            vscode.window.showInformationMessage(`🗑️ Deleted ${key}`);
        }
    } catch (error) {
        vscode.window.showErrorMessage(`Delete failed: ${(error as Error).message}`);
    }
}

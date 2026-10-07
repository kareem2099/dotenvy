/**
 * Reads and writes `.env` files that may contain encrypted values.
 */

import * as vscode from 'vscode';
import * as fs from 'fs';
import { EncryptedVarsManager } from './encryptedVars';
import { logger } from './logger';

let decryptionWarningShown = false;

export class EncryptedEnvironmentFile {

    /**
     * Parses an environment file, decrypting ENC values when a master key is available.
     */
    public static async parseEnvFile(
        filePath: string,
        context: vscode.ExtensionContext,
        masterKey?: Buffer,
    ): Promise<Map<string, { value: string; encrypted: boolean; raw: string }>> {

        const vars = new Map<string, { value: string; encrypted: boolean; raw: string }>();

        if (!await fs.promises.access(filePath, fs.constants.F_OK).then(() => true).catch(() => false)) {
            return vars;
        }

        if (!masterKey) {
            masterKey = await EncryptedVarsManager.ensureMasterKey(context);
        }

        const content = await fs.promises.readFile(filePath, 'utf8');

        for (const line of content.split('\n')) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith('#')) { continue; }

            const eqIndex = trimmed.indexOf('=');
            if (eqIndex === -1) { continue; }

            const key = trimmed.substring(0, eqIndex).trim();
            const value = trimmed.substring(eqIndex + 1).trim();

            let finalValue = value;
            let encrypted = false;

            if (EncryptedVarsManager.isEncrypted(value) && masterKey) {
                try {
                    finalValue = EncryptedVarsManager.decryptValue(value, masterKey);
                    encrypted = true;
                } catch (error) {
                    logger.warn(`Failed to decrypt '${key}' - invalid key. Keeping as encrypted.`, 'EncryptedEnvironmentFile');
                    finalValue = value;

                    if (!decryptionWarningShown) {
                        decryptionWarningShown = true;
                        vscode.window.showWarningMessage(
                            'DotEnvy: Some encrypted variables could not be decrypted. Master key may have changed.',
                            'Set Master Password',
                        ).then(action => {
                            if (action === 'Set Master Password') {
                                vscode.commands.executeCommand('dotenvy.setMasterPassword');
                                decryptionWarningShown = false;
                            }
                        });
                    }
                }
            } else if (EncryptedVarsManager.isEncrypted(value)) {
                finalValue = value;
                encrypted = true;
            }

            vars.set(key, { value: finalValue, encrypted, raw: value });
        }

        return vars;
    }

    /**
     * Writes environment variables, encrypting entries marked as encrypted.
     */
    public static async writeEnvFile(
        filePath: string,
        vars: Map<string, { value: string; encrypted: boolean }>,
        context: vscode.ExtensionContext,
        masterKey?: Buffer,
    ): Promise<void> {

        if (!masterKey) {
            masterKey = await EncryptedVarsManager.ensureMasterKey(context);
        }

        const lines: string[] = [];
        for (const [key, data] of vars) {
            if (data.encrypted && masterKey) {
                lines.push(`${key}=${EncryptedVarsManager.encryptValue(data.value, masterKey)}`);
            } else {
                lines.push(`${key}=${data.value}`);
            }
        }

        await fs.promises.writeFile(filePath, lines.join('\n') + '\n', 'utf8');
    }
}

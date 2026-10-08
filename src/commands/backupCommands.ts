import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { logger } from '../utils/logger';
import { BackupManager } from '../utils/backupManager';
import { EncryptedVarsManager } from '../utils/encryptedVars';
import { t } from '../i18n';

export class BackupCommands {
    
    public static async chooseBackupLocation() {
        const folderUri = await vscode.window.showOpenDialog({
            canSelectFolders: true,
            canSelectFiles: false,
            canSelectMany: false,
            openLabel: t('backup.selectFolder')
        });

        if (folderUri && folderUri[0]) {
            const config = vscode.workspace.getConfiguration('dotenvy');
            await config.update('backupPath', folderUri[0].fsPath, vscode.ConfigurationTarget.Global);
            vscode.window.showInformationMessage(t('backup.locationSet', { path: folderUri[0].fsPath }));
        }
    }

    public static async backupEnv(context: vscode.ExtensionContext, filePath: string) {
        if (!fs.existsSync(filePath)) {
            vscode.window.showErrorMessage(t('backup.fileMissing', { file: path.basename(filePath) }));
            return;
        }

        // Check for Project Master Key (Auto-Authorization)
        const hasMasterKey = await EncryptedVarsManager.hasMasterKey(context);
        let encryptionChoice: { label: string; detail: string; value: string } | undefined;

        if (hasMasterKey) {
            encryptionChoice = {
                label: t('backup.masterKeyLabel'),
                detail: t('backup.masterKeyDetail'),
                value: 'master-key'
            };
        } else {
            const encryptionOptions = [
                { label: t('backup.passwordLabel'), detail: t('backup.passwordDetail'), value: 'password' },
                { label: t('backup.legacyLabel'), detail: t('backup.legacyDetail'), value: 'legacy' },
                { label: t('backup.noneLabel'), detail: t('backup.noneDetail'), value: 'none' }
            ];

            encryptionChoice = await vscode.window.showQuickPick(encryptionOptions, {
                placeHolder: t('backup.encryptPlaceholder'),
                ignoreFocusOut: true
            });
        }

        if (!encryptionChoice) return;

        const config = vscode.workspace.getConfiguration('dotenvy');
        const customBackupPath = config.get<string>('backupPath', '');
        let backupDir = customBackupPath;

        if (!backupDir || backupDir.trim() === '') {
            const homeDir = os.homedir();
            const workspaceName = vscode.workspace.name || 'default';
            backupDir = path.join(homeDir, '.dotenvy-backups', workspaceName);
        }

        if (!fs.existsSync(backupDir)) {
            fs.mkdirSync(backupDir, { recursive: true });
        }

        const content = fs.readFileSync(filePath, 'utf8');
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
        let filename: string;
        let backupPathOut: string;

        try {
            if (encryptionChoice.value === 'master-key') {
                const key = await EncryptedVarsManager.ensureMasterKey(context);
                const packaged = BackupManager.encryptWithKey(content, key);

                filename = `env.backup.${timestamp}.master.enc`;
                backupPathOut = path.join(backupDir, filename);
                fs.writeFileSync(backupPathOut, packaged, 'utf8');
                vscode.window.showInformationMessage(t('backup.masterCreated', { file: filename }));

            } else if (encryptionChoice.value === 'password') {
                const password = await vscode.window.showInputBox({
                    prompt: t('backup.passwordPrompt'),
                    password: true,
                    placeHolder: t('backup.passwordPlaceholder'),
                    ignoreFocusOut: true,
                    validateInput: (value: string) => {
                        if (!value || value.length === 0) return t('common.passwordEmpty');
                        if (value.length < 8) return t('common.passwordShort');
                        return null;
                    }
                });

                if (!password) {
                    vscode.window.showInformationMessage(t('backup.cancelled'));
                    return;
                }

                const passwordConfirm = await vscode.window.showInputBox({
                    prompt: t('backup.confirmPrompt'),
                    password: true,
                    placeHolder: t('backup.confirmPlaceholder'),
                    ignoreFocusOut: true
                });

                if (password !== passwordConfirm) {
                    vscode.window.showErrorMessage(t('backup.mismatch'));
                    return;
                }

                const salt = BackupManager.generateSalt();
                const key = await BackupManager.deriveKeyFromPassword(password, salt);
                const packaged = BackupManager.encryptWithKey(content, key, salt);

                filename = `env.backup.${timestamp}.enc`;
                backupPathOut = path.join(backupDir, filename);
                fs.writeFileSync(backupPathOut, packaged, 'utf8');
                vscode.window.showInformationMessage(t('backup.passwordCreated', { file: filename }));

            } else if (encryptionChoice.value === 'legacy') {
                const key = await BackupManager.ensureAndGetStoredKey(context);
                const packaged = BackupManager.encryptWithKey(content, key);

                filename = `env.backup.${timestamp}.legacy.enc`;
                backupPathOut = path.join(backupDir, filename);
                fs.writeFileSync(backupPathOut, packaged, 'utf8');
                vscode.window.showInformationMessage(t('backup.legacyCreated', { file: filename }));
                vscode.window.showWarningMessage(t('backup.legacyWarning'));
            } else {
                filename = `env.backup.${timestamp}.txt`;
                backupPathOut = path.join(backupDir, filename);
                fs.writeFileSync(backupPathOut, content, 'utf8');
                vscode.window.showInformationMessage(t('backup.plainCreated', { file: filename }));
            }
        } catch (error) {
            logger.error('Failed to create backup:', error, 'BackupCommands');
            vscode.window.showErrorMessage(t('backup.createFailed', { message: (error as Error).message }));
        }
    }

    public static async restoreFromBackup(context: vscode.ExtensionContext, rootPath: string) {
        const restoreConfig = vscode.workspace.getConfiguration('dotenvy');
        const restoreBackupPath = restoreConfig.get<string>('backupPath', '');
        let restoreBackupDir = restoreBackupPath;

        if (!restoreBackupDir || restoreBackupDir.trim() === '') {
            const homeDir = os.homedir();
            const workspaceName = vscode.workspace.name || 'default';
            restoreBackupDir = path.join(homeDir, '.dotenvy-backups', workspaceName);
        }

        if (!fs.existsSync(restoreBackupDir)) {
            vscode.window.showErrorMessage(t('backup.noDirectory'));
            return;
        }

        const allBackupFiles = fs.readdirSync(restoreBackupDir)
            .filter(file => file.startsWith('env.backup.'))
            .sort()
            .reverse();

        if (allBackupFiles.length === 0) {
            vscode.window.showInformationMessage(t('backup.noneFound'));
            return;
        }

        const selectedFile = await vscode.window.showQuickPick(
            allBackupFiles.map(file => {
                let type = t('backup.typePlain');
                if (file.endsWith('.enc')) {
                    if (file.includes('.master.')) {
                        type = t('backup.typeMaster');
                    } else if (file.includes('.legacy.')) {
                        type = t('backup.typeLegacy');
                    } else {
                        type = t('backup.typePassword');
                    }
                }
                return {
                    label: file.replace('env.backup.', '')
                        .replace('.master.enc', '')
                        .replace('.legacy.enc', '')
                        .replace('.enc', '')
                        .replace('.txt', ''),
                    description: type,
                    detail: file,
                    file: file
                };
            }),
            {
                placeHolder: t('backup.selectPlaceholder'),
                ignoreFocusOut: true
            }
        );

        if (!selectedFile) return;

        try {
            const backupPath = path.join(restoreBackupDir, selectedFile.file);
            const fileContent = fs.readFileSync(backupPath, 'utf8');
            let decryptedContent: string;

            if (selectedFile.file.endsWith('.enc')) {
                if (selectedFile.file.includes('.master.')) {
                    // Project Master Key backup
                    try {
                        const key = await EncryptedVarsManager.ensureMasterKey(context);
                        decryptedContent = BackupManager.decryptWithKey(fileContent, key);
                    } catch (error) {
                        vscode.window.showErrorMessage(t('backup.decryptMasterFailed'));
                        return;
                    }
                } else {
                    const salt = BackupManager.getSaltFromBackup(fileContent);
                    if (salt) {
                        const password = await vscode.window.showInputBox({
                            prompt: t('backup.restorePasswordPrompt'),
                            password: true,
                            placeHolder: t('backup.restorePasswordPlaceholder'),
                            ignoreFocusOut: true
                        });

                        if (!password) {
                            vscode.window.showInformationMessage(t('backup.restoreCancelled'));
                            return;
                        }

                        try {
                            const key = await BackupManager.deriveKeyFromPassword(password, salt);
                            decryptedContent = BackupManager.decryptWithKey(fileContent, key);
                        } catch (error) {
                            vscode.window.showErrorMessage(t('backup.wrongPassword'));
                            return;
                        }
                    } else {
                        vscode.window.showInformationMessage(t('backup.legacyDetected'));
                        try {
                            const key = await BackupManager.ensureAndGetStoredKey(context);
                            decryptedContent = BackupManager.decryptWithKey(fileContent, key);
                        } catch (error) {
                            vscode.window.showErrorMessage(t('backup.decryptLegacyFailed'));
                            return;
                        }
                    }
                }
            } else {
                decryptedContent = fileContent;
            }

            const restoreOptions = [
                { label: t('backup.overwriteLabel'), detail: t('backup.overwriteDetail'), value: 'overwrite' },
                { label: t('backup.newFileLabel'), detail: t('backup.newFileDetail'), value: 'new' }
            ];

            const restoreChoice = await vscode.window.showQuickPick(restoreOptions, {
                placeHolder: t('backup.restorePlaceholder'),
                ignoreFocusOut: true
            });

            if (!restoreChoice) return;

            let targetPath: string;
            if (restoreChoice.value === 'overwrite') {
                targetPath = path.join(rootPath, '.env');
            } else {
                targetPath = path.join(rootPath, '.env.restored');
            }

            fs.writeFileSync(targetPath, decryptedContent, 'utf8');
            vscode.window.showInformationMessage(t('backup.restored', { file: path.basename(targetPath) }));

            const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(targetPath));
            await vscode.window.showTextDocument(doc);
        } catch (error) {
            vscode.window.showErrorMessage(t('backup.restoreFailed', { message: (error as Error).message }));
        }
    }
}

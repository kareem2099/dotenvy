import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { logger } from '../utils/logger';
import { BackupManager } from '../utils/backupManager';

export class BackupCommands {
    
    public static async chooseBackupLocation() {
        const folderUri = await vscode.window.showOpenDialog({
            canSelectFolders: true,
            canSelectFiles: false,
            canSelectMany: false,
            openLabel: 'Select Backup Folder'
        });

        if (folderUri && folderUri[0]) {
            const config = vscode.workspace.getConfiguration('dotenvy');
            await config.update('backupPath', folderUri[0].fsPath, vscode.ConfigurationTarget.Global);
            vscode.window.showInformationMessage(`Backup location set to: ${folderUri[0].fsPath}`);
        }
    }

    public static async backupEnv(context: vscode.ExtensionContext, filePath: string) {
        if (!fs.existsSync(filePath)) {
            vscode.window.showErrorMessage(`No file found to backup at: ${path.basename(filePath)}`);
            return;
        }

        const encryptionOptions = [
            { label: '🔐 Password Protection (Recommended)', detail: 'Portable across devices - works anywhere with your password', value: 'password' },
            { label: '🔒 Legacy Encryption', detail: 'Uses VSCode SecretStorage (may become inaccessible)', value: 'legacy' },
            { label: '📄 No Encryption', detail: 'Plain text backup', value: 'none' }
        ];

        const encryptionChoice = await vscode.window.showQuickPick(encryptionOptions, {
            placeHolder: 'How would you like to encrypt your backup?',
            ignoreFocusOut: true
        });

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
            if (encryptionChoice.value === 'password') {
                const password = await vscode.window.showInputBox({
                    prompt: 'Enter a password to encrypt your backup',
                    password: true,
                    placeHolder: 'Enter password (min 8 characters recommended)',
                    ignoreFocusOut: true,
                    validateInput: (value: string) => {
                        if (!value || value.length === 0) return 'Password cannot be empty';
                        if (value.length < 8) return 'Warning: Password is short. Minimum 8 characters recommended.';
                        return null;
                    }
                });

                if (!password) {
                    vscode.window.showInformationMessage('Backup cancelled.');
                    return;
                }

                const passwordConfirm = await vscode.window.showInputBox({
                    prompt: 'Confirm your password',
                    password: true,
                    placeHolder: 'Re-enter password',
                    ignoreFocusOut: true
                });

                if (password !== passwordConfirm) {
                    vscode.window.showErrorMessage('Passwords do not match. Backup cancelled.');
                    return;
                }

                const salt = BackupManager.generateSalt();
                const key = await BackupManager.deriveKeyFromPassword(password, salt);
                const packaged = BackupManager.encryptWithKey(content, key, salt);

                filename = `env.backup.${timestamp}.enc`;
                backupPathOut = path.join(backupDir, filename);
                fs.writeFileSync(backupPathOut, packaged, 'utf8');
                vscode.window.showInformationMessage(`✅ Password-protected backup created!\n📁 ${filename}\n🔐 This backup is portable - works on any device with your password.`);

            } else if (encryptionChoice.value === 'legacy') {
                const key = await BackupManager.ensureAndGetStoredKey(context);
                const packaged = BackupManager.encryptWithKey(content, key);

                filename = `env.backup.${timestamp}.legacy.enc`;
                backupPathOut = path.join(backupDir, filename);
                fs.writeFileSync(backupPathOut, packaged, 'utf8');
                vscode.window.showInformationMessage(`Encrypted backup created: ${filename}`);
                vscode.window.showWarningMessage('⚠️ Legacy encrypted backups use a local key. If VS Code data is lost, backups may become inaccessible. Consider using password protection instead.');
            } else {
                filename = `env.backup.${timestamp}.txt`;
                backupPathOut = path.join(backupDir, filename);
                fs.writeFileSync(backupPathOut, content, 'utf8');
                vscode.window.showInformationMessage(`Backup created: ${filename}\n⚠️ This backup is not encrypted.`);
            }
        } catch (error) {
            logger.error('Failed to create backup:', error, 'BackupCommands');
            vscode.window.showErrorMessage(`Failed to create backup: ${(error as Error).message}`);
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
            vscode.window.showErrorMessage('No backup directory found.');
            return;
        }

        const allBackupFiles = fs.readdirSync(restoreBackupDir)
            .filter(file => file.startsWith('env.backup.'))
            .sort()
            .reverse();

        if (allBackupFiles.length === 0) {
            vscode.window.showInformationMessage('No backups found.');
            return;
        }

        const selectedFile = await vscode.window.showQuickPick(
            allBackupFiles.map(file => {
                let type = '📄 Plain text';
                if (file.endsWith('.enc')) {
                    type = file.includes('.legacy.') ? '🔒 Legacy encrypted' : '🔐 Password protected';
                }
                return {
                    label: file.replace('env.backup.', '').replace('.enc', '').replace('.legacy', '').replace('.txt', ''),
                    description: type,
                    detail: file,
                    file: file
                };
            }),
            {
                placeHolder: 'Select backup to restore',
                ignoreFocusOut: true
            }
        );

        if (!selectedFile) return;

        try {
            const backupPath = path.join(restoreBackupDir, selectedFile.file);
            const fileContent = fs.readFileSync(backupPath, 'utf8');
            let decryptedContent: string;

            if (selectedFile.file.endsWith('.enc')) {
                const salt = BackupManager.getSaltFromBackup(fileContent);
                if (salt) {
                    const password = await vscode.window.showInputBox({
                        prompt: 'Enter the password used to encrypt this backup',
                        password: true,
                        placeHolder: 'Enter password',
                        ignoreFocusOut: true
                    });

                    if (!password) {
                        vscode.window.showInformationMessage('Restore cancelled.');
                        return;
                    }

                    try {
                        const key = await BackupManager.deriveKeyFromPassword(password, salt);
                        decryptedContent = BackupManager.decryptWithKey(fileContent, key);
                    } catch (error) {
                        vscode.window.showErrorMessage('❌ Incorrect password or corrupted backup file.');
                        return;
                    }
                } else {
                    vscode.window.showInformationMessage('📦 Legacy encrypted backup detected. Using VSCode SecretStorage...');
                    try {
                        const key = await BackupManager.ensureAndGetStoredKey(context);
                        decryptedContent = BackupManager.decryptWithKey(fileContent, key);
                    } catch (error) {
                        vscode.window.showErrorMessage('❌ Failed to decrypt legacy backup. VSCode SecretStorage key may be missing.');
                        return;
                    }
                }
            } else {
                decryptedContent = fileContent;
            }

            const restoreOptions = [
                { label: 'Overwrite .env', detail: 'Replace current environment file' },
                { label: 'Create new file', detail: 'Save as .env.restored' }
            ];

            const restoreChoice = await vscode.window.showQuickPick(restoreOptions, {
                placeHolder: 'How to restore the backup?',
                ignoreFocusOut: true
            });

            if (!restoreChoice) return;

            let targetPath: string;
            if (restoreChoice.label === 'Overwrite .env') {
                targetPath = path.join(rootPath, '.env');
            } else {
                targetPath = path.join(rootPath, '.env.restored');
            }

            fs.writeFileSync(targetPath, decryptedContent, 'utf8');
            vscode.window.showInformationMessage(`✅ Restored backup to ${path.basename(targetPath)}`);

            const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(targetPath));
            await vscode.window.showTextDocument(doc);
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to restore backup: ${(error as Error).message}`);
        }
    }
}

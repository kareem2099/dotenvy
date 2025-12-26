import * as vscode from 'vscode';
import { EnvironmentProvider } from './environmentProvider';
import { ConfigUtils } from '../utils/configUtils';
import { GitHookManager } from '../utils/gitHookManager';
import { CloudSyncManager } from '../utils/cloudSyncManager';
import { DopplerSyncManager } from '../utils/dopplerSyncManager';
import { EnvironmentValidator } from '../utils/environmentValidator';
import { EncryptedVarsManager, EncryptedEnvironmentFile } from '../utils/encryptedVars';
import { extensionUri } from '../extension';
import { QuickEnvConfig } from '../types/environment';
import { CloudSyncResult } from '../utils/cloudSyncManager';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import * as os from 'os';

// Dashboard data interfaces
interface EnvironmentData {
    name: string;
    fileName: string;
    filePath: string;
    isActive: boolean;
    variableCount: number;
    fileSize: number;
}

interface CurrentFileData {
    content: string;
    path: string;
    variableCount: number;
}

interface CloudSyncStatus {
    connected: boolean | CloudSyncResult;
    provider?: string;
    lastSync?: Date | null;
    error?: string;
}

interface GitHookStatus {
    enabled: boolean;
    installed: boolean;
}

interface ValidationStatus {
    valid: boolean;
    errors?: number;
    warnings?: number;
    lastValidated?: Date;
}

interface BackupSettings {
    path: string;
    encrypt: boolean;
}

interface DashboardData {
    type: string;
    environments: EnvironmentData[];
    currentFile: CurrentFileData | null;
    currentEnvironment: string | null;
    cloudSync: CloudSyncStatus | null;
    gitHook: GitHookStatus;
    validation: ValidationStatus;
    hasWorkspace: boolean;
    backupSettings: BackupSettings;
}

// Webview message interfaces for different message types
interface BaseWebviewMessage {
    type: string;
}

interface SwitchEnvironmentMessage extends BaseWebviewMessage {
    type: 'switchEnvironment';
    environment: string;
}

interface EditFileMessage extends BaseWebviewMessage {
    type: 'editFile';
    fileName: string;
}

interface DiffEnvironmentMessage extends BaseWebviewMessage {
    type: 'diffEnvironment';
    environment?: string;
}

interface CreateEnvironmentMessage extends BaseWebviewMessage {
    type: 'createEnvironment';
}

interface BackupMessage extends BaseWebviewMessage {
    type: 'backupCurrentEnv';
}

type WebviewMessage = BaseWebviewMessage | SwitchEnvironmentMessage | EditFileMessage | DiffEnvironmentMessage | CreateEnvironmentMessage | BackupMessage;

export class EnvironmentWebviewProvider implements vscode.WebviewViewProvider {
    private _view?: vscode.WebviewView;
    private environmentProvider?: EnvironmentProvider;
    private cachedDashboardData: DashboardData | null = null;

    // SecretStorage key for the randomly generated backup encryption key
    private static readonly SECRET_STORAGE_KEY = 'dotenvy.backup.key.v1';
    private static readonly FORMAT_VERSION = 1;
    private static readonly KEY_LENGTH = 32; // 256 bits
    private static readonly IV_LENGTH = 12; // 96 bits for GCM
    private static readonly ALGO = 'aes-256-gcm';

    constructor(private readonly context: vscode.ExtensionContext) {}

    resolveWebviewView(view: vscode.WebviewView, context: vscode.WebviewViewResolveContext, token: vscode.CancellationToken): void | Thenable<void> {
        this._view = view;

        // Use context state for view-specific restoration
        const viewState = context.state;
        if (viewState) {
            console.log('Restoring webview state:', viewState);
        }

        // Store last resolution timestamp for diagnostics
        this.context.globalState.update('webview-last-resolved', Date.now());

        // Handle cancellation for long-running operations
        let isCancelled = false;
        token.onCancellationRequested(() => {
            console.log('Environment webview resolution cancelled');
            isCancelled = true;
        });

        // Check for cancellation before starting expensive operations
        if (isCancelled) {
            console.log('Cancelling webview initialization due to token cancellation');
            return;
        }

        const rootPath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd();
        this.environmentProvider = new EnvironmentProvider(rootPath);

        view.webview.options = {
            enableScripts: true,
            localResourceRoots: [
                vscode.Uri.joinPath(extensionUri, 'resources'),
                vscode.Uri.file(rootPath)
            ]
        };

        this.updateWebviewContent(view.webview);
        this.refreshEnvironments();

        view.webview.onDidReceiveMessage(async (message) => {
            await this.handleMessage(message);
        }, undefined, this.context.subscriptions);
    }

    private updateWebviewContent(webview: vscode.Webview): void {
        webview.html = this.getWebviewContent();
    }

    private getWebviewContent(): string {
        // Read the HTML file
        const htmlUri = vscode.Uri.joinPath(extensionUri, 'resources', 'panel', 'panel.html');
        let html = fs.readFileSync(htmlUri.fsPath, 'utf8');

        // Create webview URIs for CSS and JS resources
        const cssUri = this._view!.webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'resources', 'panel', 'panel.css'));
        const jsUri = this._view!.webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'resources', 'panel', 'panel.js'));

        // Replace placeholders with actual URIs
        html = html.replace('{{panelCssUri}}', cssUri.toString());
        html = html.replace('{{panelJsUri}}', jsUri.toString());

        return html;
    }

    private async refreshEnvironments(): Promise<void> {
        if (!this._view || !this.environmentProvider) return;

        const rootPath = this.environmentProvider['rootPath'];
        const envPath = path.join(rootPath, '.env');

        // Gather comprehensive dashboard data
        const config = await ConfigUtils.readQuickEnvConfig();
        const environments = await this.environmentProvider.getEnvironments();
        const currentEnvironment = await this.environmentProvider.getCurrentEnvironment();

        // Enhanced environment data with stats
        const enhancedEnvironments = await Promise.all(environments.map(async env => {
            let variableCount = 0;
            let fileSize = 0;

            try {
                const stats = fs.statSync(env.filePath);
                fileSize = stats.size;

                const content = fs.readFileSync(env.filePath, 'utf8');
                variableCount = content.split('\n').filter(line =>
                    line.trim() && !line.startsWith('#') && line.includes('=')
                ).length;
            } catch (e) {
                console.log(`Error reading ${env.fileName}:`, e);
            }

            return {
                name: env.name,
                fileName: env.fileName,
                filePath: env.filePath,
                isActive: currentEnvironment ? currentEnvironment.name === env.name : false,
                variableCount,
                fileSize
            };
        }));

        // Current environment file content with encrypted variable support
        let currentFile = null;
        if (fs.existsSync(envPath)) {
            try {
                // Try to get master key for decryption
                let masterKey: Buffer | undefined;
                try {
                    masterKey = await EncryptedVarsManager.ensureMasterKey(this.context);
                } catch (error) {
                    console.log('No master key available for decryption:', error);
                }

                // Parse environment file with possible decryption
                const parsedVars = await EncryptedEnvironmentFile.parseEnvFile(envPath, masterKey);

                // Reconstruct content with decrypted values
                const lines: string[] = [];
                for (const [key, data] of parsedVars) {
                    if (data.encrypted) {
                        lines.push(`${key}=${data.value}`); // Show decrypted value
                    } else {
                        lines.push(`${key}=${data.value}`);
                    }
                }

                const content = lines.join('\n');
                currentFile = {
                    content,
                    path: envPath,
                    variableCount: parsedVars.size,
                    encryptedVars: Array.from(parsedVars.values()).filter(v => v.encrypted).length
                };
            } catch (error) {
                console.log('Error reading current .env file:', error);
            }
        }

        // Cloud sync status
        const cloudSyncStatus = await this.getCloudSyncStatus(rootPath, config);

        // Git hook status
        const gitHookStatus = {
            enabled: !!config?.gitCommitHook,
            installed: GitHookManager.isHookInstalled(rootPath)
        };

        // Validation status
        const validationStatus = await this.getValidationStatus(rootPath, envPath, config);

        // Get backup configuration
        const backupConfig = vscode.workspace.getConfiguration('dotenvy');
        const backupPath = backupConfig.get<string>('backupPath', '');
        const encryptBackups = backupConfig.get<boolean>('encryptBackups', false);

        // Determine current environment name
        let currentEnvName = currentEnvironment?.name || null;
        if (!currentEnvName && fs.existsSync(envPath)) {
            // If .env exists but doesn't match any variant, call it 'local'
            currentEnvName = 'local';
        }

        // Prepare dashboard data
        const dashboardData = {
            type: 'refresh',
            environments: enhancedEnvironments,
            currentFile,
            currentEnvironment: currentEnvName,
            cloudSync: cloudSyncStatus,
            gitHook: gitHookStatus,
            validation: validationStatus,
            hasWorkspace: !!vscode.workspace.workspaceFolders,
            backupSettings: {
                path: backupPath,
                encrypt: encryptBackups
            }
        };

        // Cache the data persistently
        const cacheKey = `dashboard-cache-${rootPath}`;
        this.context.globalState.update(cacheKey, dashboardData);

        // Cache the data in memory
        this.cachedDashboardData = dashboardData;

        // Send comprehensive dashboard data
        this._view.webview.postMessage(dashboardData);
    }

    private async getCloudSyncStatus(rootPath: string, config: QuickEnvConfig | null) {
        if (!config?.cloudSync) {
            return null;
        }

        try {
            let cloudManager: CloudSyncManager;

            switch (config.cloudSync.provider) {
                case 'doppler':
                    cloudManager = new DopplerSyncManager(config.cloudSync);
                    break;
                default:
                    return {
                        connected: false,
                        error: `Unsupported provider: ${config.cloudSync.provider}`
                    };
            }

            const connected = await cloudManager.testConnection();

            return {
                connected,
                provider: config.cloudSync.provider,
                lastSync: null // Would track actual sync times in real implementation
            };

        } catch (error) {
            return {
                connected: false,
                error: (error as Error).message
            };
        }
    }

    private async getValidationStatus(rootPath: string, envPath: string, config: QuickEnvConfig | null) {
        if (!config?.validation || !fs.existsSync(envPath)) {
            return {
                valid: true
            };
        }

        try {
            const errors = EnvironmentValidator.validateFile(envPath, config.validation);
            return {
                valid: errors.length === 0,
                errors: errors.length,
                lastValidated: new Date()
            };
        } catch (error) {
            return {
                valid: false,
                errors: 1
            };
        }
    }

    private displayCachedDashboard(): void {
        if (this._view && this.cachedDashboardData) {
            this._view.webview.postMessage(this.cachedDashboardData);
        }
    }

    // ------------------------
    // Helper: Key management
    // ------------------------
    // Ensures there is a stored random key in SecretStorage and returns it as Buffer
    private async ensureAndGetStoredKey(): Promise<Buffer> {
        const secret = await this.context.secrets.get(EnvironmentWebviewProvider.SECRET_STORAGE_KEY);
        if (secret) {
            return Buffer.from(secret, 'base64');
        }
        const key = crypto.randomBytes(EnvironmentWebviewProvider.KEY_LENGTH);
        await this.context.secrets.store(EnvironmentWebviewProvider.SECRET_STORAGE_KEY, key.toString('base64'));
        return key;
    }

    // ------------------------
    // Helper: Encrypt / Decrypt (AES-256-GCM)
    // Returns base64(JSON) package with { v, iv, ct, tag }
    // ------------------------
    private encryptWithKey(plaintext: string, key: Buffer): string {
        if (key.length !== EnvironmentWebviewProvider.KEY_LENGTH) {
            throw new Error('Invalid key length for encryption');
        }
        const iv = crypto.randomBytes(EnvironmentWebviewProvider.IV_LENGTH);
        const cipher = crypto.createCipheriv(EnvironmentWebviewProvider.ALGO, key, iv, { authTagLength: 16 });
        const ciphertext = Buffer.concat([cipher.update(Buffer.from(plaintext, 'utf8')), cipher.final()]);
        const tag = cipher.getAuthTag();

        const pack = {
            v: EnvironmentWebviewProvider.FORMAT_VERSION,
            iv: iv.toString('base64'),
            ct: ciphertext.toString('base64'),
            tag: tag.toString('base64')
        };
        return Buffer.from(JSON.stringify(pack)).toString('base64');
    }

    private decryptWithKey(payloadB64: string, key: Buffer): string {
        if (key.length !== EnvironmentWebviewProvider.KEY_LENGTH) {
            throw new Error('Invalid key length for decryption');
        }

        let raw: string;
        try {
            raw = Buffer.from(payloadB64, 'base64').toString('utf8');
        } catch (e) {
            throw new Error('Invalid encrypted payload');
        }

        let pack: { v: number; iv: string; ct: string; tag: string; };
        try {
            pack = JSON.parse(raw);
        } catch (e) {
            throw new Error('Invalid encrypted payload format');
        }

        if (pack.v !== EnvironmentWebviewProvider.FORMAT_VERSION) {
            throw new Error('Unsupported backup format version');
        }

        const iv = Buffer.from(pack.iv, 'base64');
        const ct = Buffer.from(pack.ct, 'base64');
        const tag = Buffer.from(pack.tag, 'base64');

        const decipher = crypto.createDecipheriv(EnvironmentWebviewProvider.ALGO, key, iv, { authTagLength: 16 });
        decipher.setAuthTag(tag);
        const out = Buffer.concat([decipher.update(ct), decipher.final()]);
        return out.toString('utf8');
    }

    private async handleMessage(message: WebviewMessage): Promise<void> {
        if (!this.environmentProvider) return;

        const rootPath = this.environmentProvider['rootPath'];

        switch (message.type) {
            case 'refresh':
                await this.refreshEnvironments();
                break;

            case 'switchEnvironment':
                const switchMsg = message as SwitchEnvironmentMessage;
                const selectedEnv = (await this.environmentProvider.getEnvironments())
                    .find(env => env.name === switchMsg.environment);

                if (selectedEnv) {
                    try {
                        const { FileUtils } = await import('../utils/fileUtils');
                        const { SecretsGuard } = await import('../utils/secretsGuard');

                        await FileUtils.switchToEnvironment(selectedEnv, rootPath);

                        const warnings = SecretsGuard.checkFile(selectedEnv.filePath);
                        if (warnings.length > 0) {
                            vscode.window.showWarningMessage(
                                `⚠️ Selected environment contains potential secrets: ${warnings.join(', ')}`
                            );
                        }

                        vscode.window.showInformationMessage(`Environment switched to ${selectedEnv.name}`);
                        await this.refreshEnvironments();
                    } catch (error) {
                        vscode.window.showErrorMessage(`Failed to switch environment: ${(error as Error).message}`);
                    }
                }
                break;

            case 'editFile':
                // Ensure fileName is passed and used correctly
                const editMsg = message as EditFileMessage;
                const fileUri = vscode.Uri.file(path.join(rootPath, editMsg.fileName));
                const doc = await vscode.workspace.openTextDocument(fileUri);
                await vscode.window.showTextDocument(doc);
                break;

            case 'diffEnvironment':
                const diffMsg = message as DiffEnvironmentMessage;
                if (diffMsg.environment) {
                    const selectedEnv = (await this.environmentProvider.getEnvironments())
                        .find(env => env.name === diffMsg.environment);

                    if (selectedEnv) {
                        const { EnvironmentDiffer } = await import('../utils/environmentDiffer');
                        try {
                            const diff = EnvironmentDiffer.compareFiles(path.join(rootPath, '.env'), selectedEnv.filePath);
                            const diffText = EnvironmentDiffer.formatDiffForDisplay(diff, 'Current', selectedEnv.name);
                            const doc = await vscode.workspace.openTextDocument({
                                content: diffText,
                                language: 'diff'
                            });
                            await vscode.window.showTextDocument(doc, { preview: true });
                        } catch (error) {
                            vscode.window.showErrorMessage(`Failed to show diff: ${(error as Error).message}`);
                        }
                    }
                } else {
                    // General diff command - show quick pick
                    const { DiffEnvironmentCommand } = await import('../commands/diffEnvironment');
                    const diffCommand = new DiffEnvironmentCommand();
                    await diffCommand.execute();
                }
                break;

            case 'createEnvironment':
                const fileName = await vscode.window.showInputBox({
                    prompt: 'Enter environment file name (e.g., .env.staging)',
                    placeHolder: '.env.newenv',
                    value: '.env.',
                    validateInput: (value: string) => {
                        if (!value.startsWith('.env.')) return 'Must start with .env.';
                        if (fs.existsSync(path.join(rootPath, value))) return 'File already exists';
                        return null;
                    }
                });

                if (fileName) {
                    try {
                        const templateContent = `# ${fileName} environment variables
# Copy from another environment file and modify as needed

API_KEY=your_api_key_here
DATABASE_URL=your_database_url_here
PORT=3000
NODE_ENV=${fileName.replace('.env.', '')}
DEBUG=false
`.replace(/\r?\n/g, '\n');

                        fs.writeFileSync(path.join(rootPath, fileName), templateContent, 'utf8');
                        vscode.window.showInformationMessage(`Created ${fileName}`);
                        await this.refreshEnvironments();

                        // Open the new file for editing
                        const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(path.join(rootPath, fileName)));
                        await vscode.window.showTextDocument(doc);
                    } catch (error) {
                        vscode.window.showErrorMessage(`Failed to create environment file: ${(error as Error).message}`);
                    }
                }
                break;

            // Cloud sync actions
            case 'pullFromCloud':
                const { PullFromCloudCommand } = await import('../commands/pullFromCloud');
                const pullCommand = new PullFromCloudCommand();
                await pullCommand.execute();
                await this.refreshEnvironments();
                break;

            case 'pushToCloud':
                const { PushToCloudCommand } = await import('../commands/pushToCloud');
                const pushCommand = new PushToCloudCommand();
                await pushCommand.execute();
                break;

            // Git hook actions
            case 'instalGitHook': // Typo in frontend - should be installGitHook
            case 'installGitHook':
                const { InstallGitHookCommand: InstallHookCmd } = await import('../commands/installGitHook');
                const installHookCommand = new InstallHookCmd();
                await installHookCommand.execute();
                await this.refreshEnvironments();
                break;

            case 'removeGitHook':
                const { RemoveGitHookCommand } = await import('../commands/removeGitHook');
                const removeHookCommand = new RemoveGitHookCommand();
                await removeHookCommand.execute();
                await this.refreshEnvironments();
                break;

            case 'openWorkspace':
                vscode.commands.executeCommand('vscode.openFolder');
                break;

            case 'manageGitHook':
                const { InstallGitHookCommand: ManageHookCmd } = await import('../commands/installGitHook');
                const manageHookCommand = new ManageHookCmd();
                await manageHookCommand.execute();
                await this.refreshEnvironments();
                break;

            // Validation actions
            case 'backupCurrentEnv':
                if (!fs.existsSync(path.join(rootPath, '.env'))) {
                    vscode.window.showErrorMessage('No .env file found to backup.');
                    return;
                }

                // Get backup configuration
                const config = vscode.workspace.getConfiguration('dotenvy');
                const customBackupPath = config.get<string>('backupPath', '');
                const encryptBackups = config.get<boolean>('encryptBackups', false);

                // Determine backup directory
                let backupDir = customBackupPath;
                if (!backupDir || backupDir.trim() === '') {
                    // Default to ~/.dotenvy-backups/workspace-name or ~/.dotenvy-backups/default
                    const homeDir = os.homedir();
                    const workspaceName = vscode.workspace.name || 'default';
                    backupDir = path.join(homeDir, '.dotenvy-backups', workspaceName);
                }

                // Ensure backup directory exists
                if (!fs.existsSync(backupDir)) {
                    fs.mkdirSync(backupDir, { recursive: true });
                }

                // Create timestamped backup filename
                const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
                const filename = `env.backup.${timestamp}${encryptBackups ? '.enc' : ''}`;
                const backupPath = path.join(backupDir, filename);

                // Read and optionally encrypt content
                const content = fs.readFileSync(path.join(rootPath, '.env'), 'utf8');

                if (encryptBackups) {
                    // Simple encryption using Node.js crypto
                    try {
                        // Use stored key from vscode.SecretStorage (generate if not present)
                        const key = await this.ensureAndGetStoredKey(); // Buffer
                        const packaged = this.encryptWithKey(content, key);
                        fs.writeFileSync(backupPath, packaged, 'utf8');

                        vscode.window.showInformationMessage(`Encrypted backup created: ${filename}`);
                        vscode.window.showWarningMessage('⚠️ Encrypted backups use a local key. If VS Code data is lost, backups may become inaccessible. Keep plaintext copies for recovery.');
                    } catch (error) {
                        console.error('Failed to encrypt backup:', error);
                        vscode.window.showErrorMessage(`Failed to create encrypted backup: ${(error as Error).message}`);
                        return;
                    }
                } else {
                    fs.writeFileSync(backupPath, content, 'utf8');
                    vscode.window.showInformationMessage(`Backup created: ${filename}\nLocation: ${backupDir}`);
                }

                await this.refreshEnvironments();
                break;

            case 'chooseBackupLocation':
                // Show folder picker for backup location
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
                    await this.refreshEnvironments();
                }
                break;

            case 'scanSecrets':
                const { ScanSecretsCommand } = await import('../commands/scanSecrets');
                const scanSecretsCommand = new ScanSecretsCommand();
                await scanSecretsCommand.execute();
                break;

            case 'validateEnvironment':
                const { ValidateEnvironmentCommand } = await import('../commands/validateEnvironment');
                const validateCommand = new ValidateEnvironmentCommand();
                await validateCommand.execute();
                await this.refreshEnvironments();
                break;

            case 'restoreFromBackup':
                // Get backup configuration
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

                // List encrypted backup files
                const backupFiles = fs.readdirSync(restoreBackupDir)
                    .filter(file => file.endsWith('.enc') && file.startsWith('env.backup.'))
                    .sort()
                    .reverse(); // Most recent first

                if (backupFiles.length === 0) {
                    vscode.window.showInformationMessage('No encrypted backups found.');
                    return;
                }

                // Let user select backup
                const selectedFile = await vscode.window.showQuickPick(
                    backupFiles.map(file => ({
                        label: file.replace('env.backup.', '').replace('.enc', ''),
                        description: file,
                        file: file
                    })),
                    {
                        placeHolder: 'Select encrypted backup to restore'
                    }
                );

                if (!selectedFile) return;

                try {
                    const backupPath = path.join(restoreBackupDir, selectedFile.file);
                    const encryptedContent = fs.readFileSync(backupPath, 'utf8');

                    // Decrypt using stored key
                    const key = await this.ensureAndGetStoredKey();
                    const decryptedContent = this.decryptWithKey(encryptedContent, key);

                    // Ask where to restore
                    const restoreOptions = [
                        { label: 'Overwrite .env', detail: 'Replace current environment file' },
                        { label: 'Create new file', detail: 'Save as .env.restored' }
                    ];

                    const restoreChoice = await vscode.window.showQuickPick(restoreOptions, {
                        placeHolder: 'How to restore the backup?'
                    });

                    if (!restoreChoice) return;

                    let targetPath: string;
                    if (restoreChoice.label === 'Overwrite .env') {
                        targetPath = path.join(rootPath, '.env');
                    } else {
                        targetPath = path.join(rootPath, '.env.restored');
                    }

                    fs.writeFileSync(targetPath, decryptedContent, 'utf8');
                    vscode.window.showInformationMessage(`Restored backup to ${path.basename(targetPath)}`);

                    // Open the restored file
                    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(targetPath));
                    await vscode.window.showTextDocument(doc);

                    await this.refreshEnvironments();

                } catch (error) {
                    vscode.window.showErrorMessage(`Failed to restore backup: ${(error as Error).message}`);
                }
                break;
        }
    }
}

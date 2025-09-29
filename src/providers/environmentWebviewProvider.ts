import * as vscode from 'vscode';
import { EnvironmentProvider } from './environmentProvider';
import { ConfigUtils } from '../utils/configUtils';
import { GitHookManager } from '../utils/gitHookManager';
import { CloudSyncManager } from '../utils/cloudSyncManager';
import { DopplerSyncManager } from '../utils/dopplerSyncManager';
import { EnvironmentValidator } from '../utils/environmentValidator';
import { extensionUri } from '../extension';
import * as fs from 'fs';
import * as path from 'path';

export class EnvironmentWebviewProvider implements vscode.WebviewViewProvider {
    private _view?: vscode.WebviewView;
    private environmentProvider?: EnvironmentProvider;

    constructor(private context: vscode.ExtensionContext) {}

    resolveWebviewView(view: vscode.WebviewView, _context: vscode.WebviewViewResolveContext, _token: vscode.CancellationToken): void | Thenable<void> {
        this._view = view;

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

        // Current environment file content
        let currentFile = null;
        if (fs.existsSync(envPath)) {
            try {
                const content = fs.readFileSync(envPath, 'utf8');
                currentFile = {
                    content,
                    path: envPath,
                    variableCount: content.split('\n').filter(line =>
                        line.trim() && !line.startsWith('#') && line.includes('=')
                    ).length
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

        // Send comprehensive dashboard data
        this._view.webview.postMessage({
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
        });
    }

    private async getCloudSyncStatus(rootPath: string, config: any) {
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

    private async getValidationStatus(rootPath: string, envPath: string, config: any) {
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

    private async handleMessage(message: any): Promise<void> {
        if (!this.environmentProvider) return;

        const rootPath = this.environmentProvider['rootPath'];

        switch (message.type) {
            case 'switchEnvironment':
                const selectedEnv = (await this.environmentProvider.getEnvironments())
                    .find(env => env.name === message.environment);

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
                const fileUri = vscode.Uri.file(path.join(rootPath, message.fileName));
                const doc = await vscode.workspace.openTextDocument(fileUri);
                await vscode.window.showTextDocument(doc);
                break;

            case 'diffEnvironment':
                if (message.environment) {
                    const selectedEnv = (await this.environmentProvider.getEnvironments())
                        .find(env => env.name === message.environment);

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
                    const homeDir = require('os').homedir();
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
                    const crypto = require('crypto');
                    const algorithm = 'aes-256-cbc';
                    const password = 'dotenvy-backup-secure-key'; // In production, would use proper key management
                    const iv = crypto.randomBytes(16);
                    const cipher = crypto.createCipher(algorithm, password);
                    let encrypted = cipher.update(content, 'utf8', 'hex');
                    encrypted += cipher.final('hex');
                    fs.writeFileSync(backupPath, encrypted, 'utf8');
                    vscode.window.showInformationMessage(`Encrypted backup created: ${filename}`);
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
        }
    }
}

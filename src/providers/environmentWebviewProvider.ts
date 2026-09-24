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
import { logger } from '../utils/logger';
import { TrashBinManager } from '../utils/trashBinManager';
import { UserManager } from '../utils/userManager';
import { registerPanelNotifier, showActionStart, showSyncToast } from '../utils/panelNotification';
import { LocalizationService, t } from '../i18n';
import { getWebviewLocalePayload } from '../i18n/webviewLocale';

// Dashboard data interfaces
interface EnvironmentData {
    name: string;
    fileName: string;
    filePath: string;
    isActive: boolean;
    variableCount: number;
    fileSize: number;
}

interface VariableItem {
    key: string;
    value: string;
    isEncrypted: boolean;
    raw: string;
}

interface CurrentFileData {
    content: string;
    path: string;
    variableCount: number;
    encryptedVars?: number;
    variables?: VariableItem[];
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
    secureProjectInitialized: boolean;
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

interface OpenVariableManagerMessage extends BaseWebviewMessage {
    type: 'openVariableManager';
    fileName: string;
}

interface BackupMessage extends BaseWebviewMessage {
    type: 'backupCurrentEnv';
}

interface ToggleVarEncryptionMessage extends BaseWebviewMessage {
    type: 'toggleVarEncryption';
    key: string;
}

interface VariableActionMessage extends BaseWebviewMessage {
    type: 'updateVariable' | 'deleteVariable' | 'toggleVarEncryption';
    key: string;
}

type WebviewMessage = BaseWebviewMessage | SwitchEnvironmentMessage | EditFileMessage | OpenVariableManagerMessage | DiffEnvironmentMessage | CreateEnvironmentMessage | BackupMessage | ToggleVarEncryptionMessage | VariableActionMessage;

export class EnvironmentWebviewProvider implements vscode.WebviewViewProvider {
    private _view?: vscode.WebviewView;
    private environmentProvider?: EnvironmentProvider;
    private cachedDashboardData: DashboardData | null = null;

    constructor(private readonly context: vscode.ExtensionContext) { }

    resolveWebviewView(view: vscode.WebviewView, context: vscode.WebviewViewResolveContext, token: vscode.CancellationToken): void | Thenable<void> {
        this._view = view;

        // Use context state for view-specific restoration
        const viewState = context.state;
        if (viewState) {
            logger.info(`Restoring webview state:', ${viewState}`, 'environmentWebviewProvider');
        }

        // Store last resolution timestamp for diagnostics
        this.context.globalState.update('webview-last-resolved', Date.now());

        // Handle cancellation for long-running operations
        let isCancelled = false;
        token.onCancellationRequested(() => {
            logger.info('Environment webview resolution cancelled', 'environmentWebviewProvider');
            isCancelled = true;
        });

        // Check for cancellation before starting expensive operations
        if (isCancelled) {
            logger.info('Cancelling webview initialization due to token cancellation', 'environmentWebviewProvider');
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

        const panelNotifier = registerPanelNotifier(message => view.webview.postMessage(message));
        view.onDidDispose(() => panelNotifier.dispose());
    }

    async onWorkspaceFoldersChanged(): Promise<void> {
        const rootPath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd();
        this.environmentProvider = new EnvironmentProvider(rootPath);
        this.cachedDashboardData = null;

        if (!this._view) {
            return;
        }

        this._view.webview.options = {
            enableScripts: true,
            localResourceRoots: [
                vscode.Uri.joinPath(extensionUri, 'resources'),
                vscode.Uri.file(rootPath)
            ]
        };

        await this.refreshEnvironments();
    }

    private updateWebviewContent(webview: vscode.Webview): void {
        webview.html = this.getWebviewContent();
    }

    private getWebviewContent(): string {
        if (!this._view) {
            throw new Error('Webview view is not initialized');
        }
        // Read the HTML file
        const htmlUri = vscode.Uri.joinPath(extensionUri, 'resources', 'panel', 'panel.html');
        let html = fs.readFileSync(htmlUri.fsPath, 'utf8');

        // Create webview URIs for CSS and JS resources
        const cssUri = this._view.webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'resources', 'panel', 'panel.css'));
        const jsUri = this._view.webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'resources', 'panel', 'panel.js'));

        // Replace placeholders with actual URIs
        html = html.replace('{{panelCssUri}}', cssUri.toString());
        html = html.replace('{{panelJsUri}}', jsUri.toString());
        html = html.replace('<body>', '<body class="sidebar-view">');

        return html;
    }

    async refreshEnvironments(): Promise<void> {
        if (!this._view || !this.environmentProvider) return;

        const rootPath = this.environmentProvider['rootPath'];
        const envPath = path.join(rootPath, '.env');

        // Gather comprehensive dashboard data
        const config = await ConfigUtils.readQuickEnvConfig(rootPath);
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
                logger.error(`Error reading ${env.fileName}:`, e, 'environmentWebviewProvider');
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
                    logger.error('No master key available for decryption:', error, 'environmentWebviewProvider');
                }

                // Parse environment file with possible decryption
                const parsedVars = await EncryptedEnvironmentFile.parseEnvFile(envPath, this.context, masterKey);

                // Build variables list with encryption state for UI
                const variablesList = [];
                const lines: string[] = [];

                for (const [key, data] of parsedVars) {
                    // Reconstruct content for file preview
                    lines.push(`${key}=${data.value}`);

                    // Build rich data for UI list with lock states
                    variablesList.push({
                        key: key,
                        value: data.value, // Decrypted value for display
                        isEncrypted: data.encrypted, // Lock state for UI
                        raw: data.raw // Original encrypted/raw value
                    });
                }

                const content = lines.join('\n');
                currentFile = {
                    content,
                    path: envPath,
                    variableCount: parsedVars.size,
                    encryptedVars: Array.from(parsedVars.values()).filter(v => v.encrypted).length,
                    variables: variablesList // Send to frontend for lock icons
                };
            } catch (error) {
                logger.error('Error reading current .env file:', error, 'environmentWebviewProvider');
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

        const secureProjectInitialized = await UserManager.isSecureProjectInitialized();

        if (secureProjectInitialized) {
            await ConfigUtils.ensureWorkspaceConfigFile(rootPath);
        }

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
        const localePayload = getWebviewLocalePayload('panel.');

        const dashboardData = {
            type: 'refresh',
            locale: localePayload.locale,
            strings: localePayload.strings,
            environments: enhancedEnvironments,
            currentFile,
            currentEnvironment: currentEnvName,
            cloudSync: cloudSyncStatus,
            gitHook: gitHookStatus,
            validation: validationStatus,
            hasWorkspace: !!vscode.workspace.workspaceFolders,
            secureProjectInitialized,
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

    private async handleMessage(message: WebviewMessage): Promise<void> {
        if (!this.environmentProvider) return;

        const rootPath = this.environmentProvider['rootPath'];

        switch (message.type) {
            case 'setLocale': {
                const localeMsg = message as { locale?: string };
                if (localeMsg.locale) {
                    await LocalizationService.getInstance().setLocale(localeMsg.locale);
                    await this.refreshEnvironments();
                }
                break;
            }

            case 'refresh':
                await this.refreshEnvironments();
                break;

            case 'openDopplerDashboard': {
                const quickEnvConfig = await ConfigUtils.readQuickEnvConfig(rootPath);
                const dashboardUrl = DopplerSyncManager.getDashboardUrl(
                    quickEnvConfig?.cloudSync?.project,
                    quickEnvConfig?.cloudSync?.config
                );
                await vscode.env.openExternal(vscode.Uri.parse(dashboardUrl));
                break;
            }

            case 'openHistoryPanel':
                vscode.commands.executeCommand('dotenvy.openHistoryPanel');
                break;

            case 'openAnalyticsPanel':
                vscode.commands.executeCommand('dotenvy.openAnalyticsPanel');
                break;

            case 'openTrashBin':
                vscode.commands.executeCommand('dotenvy.openTrashBin');
                break;

            case 'openVariableManager':
                const varManagerMsg = message as OpenVariableManagerMessage;
                vscode.commands.executeCommand('dotenvy.openVariableManager', varManagerMsg.fileName);
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
                            showSyncToast(
                                t('webview.secretsInEnv', { warnings: warnings.join(', ') }),
                                'warning'
                            );
                        }

                        showSyncToast(t('webview.envSwitched', { name: selectedEnv.name }), 'success');
                        await this.refreshEnvironments();
                    } catch (error) {
                        showSyncToast(t('webview.switchFailed', { message: (error as Error).message }), 'error');
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
                            showSyncToast(t('webview.diffFailed', { message: (error as Error).message }), 'error');
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
                    prompt: t('webview.createEnvPrompt'),
                    placeHolder: t('webview.createEnvPlaceholder'),
                    value: '.env.',
                    validateInput: (value: string) => {
                        if (!value.startsWith('.env.')) return t('webview.mustStartWithEnv');
                        if (fs.existsSync(path.join(rootPath, value))) return t('webview.fileExists');
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
                        showSyncToast(t('webview.envCreated', { fileName }), 'success');
                        await this.refreshEnvironments();

                        // Open the new file for editing
                        const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(path.join(rootPath, fileName)));
                        await vscode.window.showTextDocument(doc);
                    } catch (error) {
                        showSyncToast(t('webview.createFailed', { message: (error as Error).message }), 'error');
                    }
                }
                break;

            // Cloud sync actions
            case 'pullFromCloud':
                try {
                    const { PullFromCloudCommand } = await import('../commands/pullFromCloud');
                    const pullCommand = new PullFromCloudCommand();
                    await pullCommand.execute(rootPath);
                    await this.refreshEnvironments();
                } catch (error) {
                    showSyncToast(t('pull.failed', { message: (error as Error).message }), 'error');
                }
                break;

            case 'pushToCloud':
                try {
                    const { PushToCloudCommand } = await import('../commands/pushToCloud');
                    const pushCommand = new PushToCloudCommand();
                    await pushCommand.execute(rootPath);
                    await this.refreshEnvironments();
                } catch (error) {
                    showSyncToast(t('push.failed', { message: (error as Error).message }), 'error');
                }
                break;

            // Git hook actions
            case 'instalGitHook': // Typo in frontend - should be installGitHook
            case 'installGitHook':
                await new (await import('../commands/installGitHook')).InstallGitHookCommand().execute(rootPath);
                await this.refreshEnvironments();
                break;

            case 'removeGitHook':
                await new (await import('../commands/removeGitHook')).RemoveGitHookCommand().execute(rootPath);
                await this.refreshEnvironments();
                break;

            case 'openWorkspace':
                vscode.commands.executeCommand('vscode.openFolder');
                break;

            case 'initSecureProject':
                await vscode.commands.executeCommand('dotenvy.initSecureProject');
                await this.refreshEnvironments();
                break;

            case 'initDotenvyIgnore':
                await vscode.commands.executeCommand('dotenvy.initDotenvyIgnore');
                break;

            case 'manageGitHook':
                await GitHookManager.manageHook(rootPath);
                await this.refreshEnvironments();
                break;

            // Validation actions
            case 'backupCurrentEnv': {
                const { BackupCommands } = await import('../commands/backupCommands');
                const targetFilePath = path.join(rootPath, '.env');
                await BackupCommands.backupEnv(this.context, targetFilePath);
                await this.refreshEnvironments();
                break;
            }

            case 'chooseBackupLocation': {
                const { BackupCommands } = await import('../commands/backupCommands');
                await BackupCommands.chooseBackupLocation();
                await this.refreshEnvironments();
                break;
            }

            case 'scanSecrets':
                const { ScanSecretsCommand } = await import('../commands/scanSecrets');
                const scanSecretsCommand = new ScanSecretsCommand();
                await scanSecretsCommand.execute();
                break;

            case 'validateEnvironment':
                await (await import('../commands/validateEnvironment')).ValidateEnvironmentCommand.manageValidation(rootPath);
                await this.refreshEnvironments();
                break;

            case 'toggleVarEncryption': {
                // Handle individual variable encryption toggle
                const toggleMsg = message as VariableActionMessage;
                const targetKey = toggleMsg.key;

                if (!targetKey) {
                    showSyncToast(t('webview.var.noKey'), 'error');
                    return;
                }

                const envFilePath = path.join(rootPath, '.env');

                try {
                    // 1. Get the appropriate key (Cloud or Local)
                    const cryptoKey = await EncryptedVarsManager.ensureMasterKey(this.context);

                    // 2. Parse current environment file
                    const currentVars = await EncryptedEnvironmentFile.parseEnvFile(envFilePath, this.context, cryptoKey);

                    // 3. Find and toggle the target variable
                    const varData = currentVars.get(targetKey);
                    if (!varData) {
                        showSyncToast(t('webview.var.notFound', { key: targetKey }), 'error');
                        return;
                    }

                    // 4. Toggle encryption state
                    varData.encrypted = !varData.encrypted;

                    // Update the map
                    currentVars.set(targetKey, varData);

                    // 5. Write back the file with the toggled variable
                    await EncryptedEnvironmentFile.writeEnvFile(envFilePath, currentVars, this.context, cryptoKey);

                    // 6. Refresh UI and show feedback
                    await this.refreshEnvironments();

                    if (varData.encrypted) {
                        showSyncToast(t('webview.var.encrypted', { key: targetKey }), 'success');
                    } else {
                        showSyncToast(t('webview.var.decrypted', { key: targetKey }), 'success');
                    }

                } catch (error) {
                    showSyncToast(t('webview.var.toggleFailed', { key: targetKey, message: (error as Error).message }), 'error');
                }
                break;
            }

            case 'updateVariable': {
                const updateMsg = message as VariableActionMessage;
                const targetKey = updateMsg.key;
                const envFilePath = path.join(rootPath, '.env');

                try {
                    const cryptoKey = await EncryptedVarsManager.ensureMasterKey(this.context);
                    const currentVars = await EncryptedEnvironmentFile.parseEnvFile(envFilePath, this.context, cryptoKey);

                    const varData = currentVars.get(targetKey);
                    if (!varData) {
                        showSyncToast(t('webview.var.notFound', { key: targetKey }), 'error');
                        return;
                    }

                    const newValue = await vscode.window.showInputBox({
                        prompt: `Enter new value for ${targetKey}`,
                        value: varData.value,
                        ignoreFocusOut: true
                    });

                    if (newValue !== undefined && newValue !== varData.value) {
                        // Push to Trash Bin BEFORE updating
                        TrashBinManager.getInstance().push({
                            key: targetKey,
                            oldValue: varData.value,
                            newValue: newValue,
                            environmentFile: '.env',
                            workspacePath: rootPath,
                            type: 'modified'
                        });

                        varData.value = newValue;
                        currentVars.set(targetKey, varData);
                        await EncryptedEnvironmentFile.writeEnvFile(envFilePath, currentVars, this.context, cryptoKey);
                        await this.refreshEnvironments();
                        showSyncToast(t('webview.var.updated', { key: targetKey }), 'success');
                    }
                } catch (error) {
                    showSyncToast(t('webview.var.updateFailed', { message: (error as Error).message }), 'error');
                }
                break;
            }

            case 'deleteVariable': {
                const deleteMsg = message as VariableActionMessage;
                const targetKey = deleteMsg.key;
                const envFilePath = path.join(rootPath, '.env');

                try {
                    const cryptoKey = await EncryptedVarsManager.ensureMasterKey(this.context);
                    const currentVars = await EncryptedEnvironmentFile.parseEnvFile(envFilePath, this.context, cryptoKey);

                    const varData = currentVars.get(targetKey);
                    if (!varData) return;

                    const confirm = await vscode.window.showWarningMessage(
                        t('webview.var.deleteConfirm', { key: targetKey }), { modal: true }, 'Delete'
                    );

                    if (confirm === 'Delete') {
                        // Push to Trash Bin
                        TrashBinManager.getInstance().push({
                            key: targetKey,
                            oldValue: varData.value,
                            environmentFile: '.env',
                            workspacePath: rootPath,
                            type: 'deleted'
                        });

                        currentVars.delete(targetKey);
                        await EncryptedEnvironmentFile.writeEnvFile(envFilePath, currentVars, this.context, cryptoKey);
                        await this.refreshEnvironments();
                        showSyncToast(t('webview.var.deleted', { key: targetKey }), 'success');
                    }
                } catch (error) {
                    showSyncToast(t('webview.var.deleteFailed', { message: (error as Error).message }), 'error');
                }
                break;
            }

            case 'restoreFromBackup': {
                const { BackupCommands } = await import('../commands/backupCommands');
                await BackupCommands.restoreFromBackup(this.context, rootPath);
                await this.refreshEnvironments();
                break;
            }
        }
    }
}


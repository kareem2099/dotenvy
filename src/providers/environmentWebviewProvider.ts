import * as vscode from 'vscode';
import { EnvironmentProvider } from './environmentProvider';
import { ConfigUtils } from '../utils/configUtils';
import { GitHookManager } from '../utils/gitHookManager';
import { getCloudSyncStatus, getValidationStatus } from './environmentDashboardStatus';
import { EncryptedVarsManager, EncryptedEnvironmentFile } from '../utils/encryptedVars';
import { extensionUri } from '../extension';
import { QuickEnvConfig } from '../types/environment';
import { CloudSyncResult } from '../utils/cloudSyncManager';
import * as fs from 'fs';
import * as path from 'path';
import { logger } from '../utils/logger';
import { UserManager } from '../utils/userManager';
import { registerPanelNotifier } from '../utils/panelNotification';
import { getWebviewLocalePayload } from '../i18n/webviewLocale';
import { handleEnvironmentPanelMessage } from './environmentPanelActions';

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
    locale?: string;
    strings?: Record<string, string>;
    locales?: Array<{ code: string; label: string }>;
    environments: EnvironmentData[];
    currentFile: CurrentFileData | null;
    currentEnvironment: string | null;
    cloudSync: CloudSyncStatus | null;
    gitHook: GitHookStatus;
    validation: ValidationStatus;
    hasWorkspace: boolean;
    secureProjectInitialized?: boolean;
    backupSettings: BackupSettings;
}

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
            if (!this.environmentProvider) {
                return;
            }
            await handleEnvironmentPanelMessage(message, {
                environmentProvider: this.environmentProvider,
                context: this.context,
                refreshEnvironments: () => this.refreshEnvironments(),
            });
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
        const localeJsUri = this._view.webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'resources', 'panel', 'panel-locale-menu.js'));

        // Replace placeholders with actual URIs
        html = html.replace('{{panelCssUri}}', cssUri.toString());
        html = html.replace('{{panelLocaleJsUri}}', localeJsUri.toString());
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

        const localePayload = getWebviewLocalePayload('panel.');

        // Prepare dashboard data
        const dashboardData = {
            type: 'refresh',
            locale: localePayload.locale,
            strings: localePayload.strings,
            locales: localePayload.locales,
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
        return getCloudSyncStatus(rootPath, config);
    }

    private async getValidationStatus(rootPath: string, envPath: string, config: QuickEnvConfig | null) {
        return getValidationStatus(rootPath, envPath, config);
    }

    private displayCachedDashboard(): void {
        if (this._view && this.cachedDashboardData) {
            this._view.webview.postMessage(this.cachedDashboardData);
        }
    }

}

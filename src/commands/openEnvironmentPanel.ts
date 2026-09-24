import * as vscode from 'vscode';
import { extensionUri } from '../extension';
import { EnvironmentProvider } from '../providers/environmentProvider';
import { ConfigUtils } from '../utils/configUtils';
import { GitHookManager } from '../utils/gitHookManager';
import { CloudSyncManager } from '../utils/cloudSyncManager';
import { DopplerSyncManager } from '../utils/dopplerSyncManager';
import { EnvironmentValidator } from '../utils/environmentValidator';
import { QuickEnvConfig } from '../types/environment';
import * as fs from 'fs';
import * as path from 'path';
import { logger } from '../utils/logger';
import { UserManager } from '../utils/userManager';
import { registerPanelNotifier, showSyncToast } from '../utils/panelNotification';
import { LocalizationService, t } from '../i18n';
import { getWebviewLocalePayload } from '../i18n/webviewLocale';

interface WebviewMessage {
    type: string;
    environment?: string;
    fileName?: string;
}

export class OpenEnvironmentPanelCommand implements vscode.Disposable {
    private panel?: vscode.WebviewPanel;
    private environmentProvider?: EnvironmentProvider;

    public async execute(): Promise<void> {
        const rootPath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd();
        const extUri = extensionUri;

        if (!extUri) {
            vscode.window.showErrorMessage(t('extension.error.noExtensionUri'));
            return;
        }

        this.environmentProvider = new EnvironmentProvider(rootPath);

        // Create or reveal webview panel
        if (!this.panel) {
            this.panel = vscode.window.createWebviewPanel(
                'dotenvy.environments',
                t('panel.title'),
                vscode.ViewColumn.One,
                {
                    enableScripts: true,
                    localResourceRoots: [
                        vscode.Uri.joinPath(extUri, 'resources'),
                        vscode.Uri.file(rootPath)
                    ]
                }
            );

            this.panel.webview.html = await this.getWebviewContent(extUri);

            const panelNotifier = registerPanelNotifier(message => this.panel?.webview.postMessage(message));

            this.panel.onDidDispose(() => {
                panelNotifier.dispose();
                this.panel = undefined;
            });

            this.panel.webview.onDidReceiveMessage(async (message) => {
                await this.handleMessage(message);
            });
        } else {
            this.panel.reveal(vscode.ViewColumn.One);
        }

        await this.refreshEnvironments();
    }

    private async refreshEnvironments(): Promise<void> {
        if (!this.panel || !this.environmentProvider) return;

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
                logger.error(`Error reading ${env.fileName}`, e, 'OpenEnvPanel');
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
                logger.error('Error reading current .env file:', error, 'OpenEnvPanel');
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

        const localePayload = getWebviewLocalePayload('panel.');

        // Send comprehensive dashboard data
        this.panel.webview.postMessage({
            type: 'refresh',
            locale: localePayload.locale,
            strings: localePayload.strings,
            environments: enhancedEnvironments,
            currentFile,
            currentEnvironment: currentEnvironment?.name || null,
            cloudSync: cloudSyncStatus,
            gitHook: gitHookStatus,
            validation: validationStatus,
            hasWorkspace: !!vscode.workspace.workspaceFolders,
            secureProjectInitialized
        });
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

    private async handleMessage(message: WebviewMessage): Promise<void> {
        if (!this.environmentProvider) return;

        const rootPath = this.environmentProvider['rootPath'];

        switch (message.type) {
            case 'setLocale': {
                const localeMsg = message as WebviewMessage & { locale?: string };
                if (localeMsg.locale) {
                    await LocalizationService.getInstance().setLocale(localeMsg.locale);
                    await this.refreshEnvironments();
                }
                break;
            }

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
                if (message.fileName) {
                    const fileUri = vscode.Uri.file(path.join(rootPath, message.fileName));
                    const doc = await vscode.workspace.openTextDocument(fileUri);
                    await vscode.window.showTextDocument(doc);
                }
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
                            showSyncToast(t('webview.diffFailed', { message: (error as Error).message }), 'error');
                        }
                    }
                } else {
                    // General diff command - show quick pick
                    const { DiffEnvironmentCommand } = await import('./diffEnvironment');
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
                    const { PullFromCloudCommand } = await import('./pullFromCloud');
                    const pullCommand = new PullFromCloudCommand();
                    await pullCommand.execute(rootPath);
                    await this.refreshEnvironments();
                } catch (error) {
                    showSyncToast(t('pull.failed', { message: (error as Error).message }), 'error');
                }
                break;

            case 'pushToCloud':
                try {
                    const { PushToCloudCommand } = await import('./pushToCloud');
                    const pushCommand = new PushToCloudCommand();
                    await pushCommand.execute(rootPath);
                    await this.refreshEnvironments();
                } catch (error) {
                    showSyncToast(t('push.failed', { message: (error as Error).message }), 'error');
                }
                break;

            // Git hook actions
            case 'instalGitHook':
            case 'installGitHook':
                await new (await import('./installGitHook')).InstallGitHookCommand().execute(rootPath);
                await this.refreshEnvironments();
                break;

            case 'removeGitHook':
                await new (await import('./removeGitHook')).RemoveGitHookCommand().execute(rootPath);
                await this.refreshEnvironments();
                break;

            case 'openDopplerDashboard': {
                const quickEnvConfig = await ConfigUtils.readQuickEnvConfig();
                const dashboardUrl = DopplerSyncManager.getDashboardUrl(
                    quickEnvConfig?.cloudSync?.project,
                    quickEnvConfig?.cloudSync?.config
                );
                await vscode.env.openExternal(vscode.Uri.parse(dashboardUrl));
                break;
            }

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
            case 'validateEnvironment':
                await (await import('./validateEnvironment')).ValidateEnvironmentCommand.manageValidation(rootPath);
                await this.refreshEnvironments();
                break;
        }
    }

    private async getWebviewContent(extensionUri: vscode.Uri): Promise<string> {
        if (!this.panel) {
            throw new Error('Panel not initialized');
        }

        // Read the HTML file
        const htmlUri = vscode.Uri.joinPath(extensionUri, 'resources', 'panel', 'panel.html');
        let html = (await vscode.workspace.fs.readFile(htmlUri)).toString();

        // Create webview URIs for CSS and JS resources
        const cssUri = this.panel.webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'resources', 'panel', 'panel.css'));
        const jsUri = this.panel.webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'resources', 'panel', 'panel.js'));

        // Replace placeholders with actual URIs
        html = html.replace('{{panelCssUri}}', cssUri.toString());
        html = html.replace('{{panelJsUri}}', jsUri.toString());

        return html;
    }

    public dispose() {
        this.panel?.dispose();
    }
}
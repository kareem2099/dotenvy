import * as vscode from 'vscode';
import { extensionUri } from '../extension';
import { EnvironmentProvider } from '../providers/environmentProvider';
import { ConfigUtils } from '../utils/configUtils';
import { GitHookManager } from '../utils/gitHookManager';
import { CloudSyncManager } from '../utils/cloudSyncManager';
import { DopplerSyncManager } from '../utils/dopplerSyncManager';
import { EnvironmentValidator } from '../utils/environmentValidator';
import * as fs from 'fs';
import * as path from 'path';

export class OpenEnvironmentPanelCommand implements vscode.Disposable {
    private panel?: vscode.WebviewPanel;
    private environmentProvider?: EnvironmentProvider;

    public async execute(): Promise<void> {
        const rootPath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd();
        const extUri = extensionUri;

        if (!extUri) {
            vscode.window.showErrorMessage('Could not find extension URI.');
            return;
        }

        this.environmentProvider = new EnvironmentProvider(rootPath);

        // Create or reveal webview panel
        if (!this.panel) {
            this.panel = vscode.window.createWebviewPanel(
                'dotenvy.environments',
                'Environment Manager',
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

            this.panel.onDidDispose(() => {
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

        // Send comprehensive dashboard data
        this.panel.webview.postMessage({
            type: 'refresh',
            environments: enhancedEnvironments,
            currentFile,
            currentEnvironment: currentEnvironment?.name || null,
            cloudSync: cloudSyncStatus,
            gitHook: gitHookStatus,
            validation: validationStatus,
            hasWorkspace: !!vscode.workspace.workspaceFolders
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
                    const { DiffEnvironmentCommand } = await import('./diffEnvironment');
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
                const { PullFromCloudCommand } = await import('./pullFromCloud');
                const pullCommand = new PullFromCloudCommand();
                await pullCommand.execute();
                await this.refreshEnvironments();
                break;

            case 'pushToCloud':
                const { PushToCloudCommand } = await import('./pushToCloud');
                const pushCommand = new PushToCloudCommand();
                await pushCommand.execute();
                break;

            // Git hook actions
            case 'instalGitHook': // Typo in frontend - should be installGitHook
            case 'installGitHook':
                const { InstallGitHookCommand: InstallHookCmd } = await import('./installGitHook');
                const installHookCommand = new InstallHookCmd();
                await installHookCommand.execute();
                await this.refreshEnvironments();
                break;

            case 'removeGitHook':
                const { RemoveGitHookCommand } = await import('./removeGitHook');
                const removeHookCommand = new RemoveGitHookCommand();
                await removeHookCommand.execute();
                await this.refreshEnvironments();
                break;

            case 'openWorkspace':
                vscode.commands.executeCommand('vscode.openFolder');
                break;

            case 'manageGitHook':
                const { InstallGitHookCommand: ManageHookCmd } = await import('./installGitHook');
                const manageHookCommand = new ManageHookCmd();
                await manageHookCommand.execute();
                await this.refreshEnvironments();
                break;

            // Validation actions
            case 'validateEnvironment':
                const { ValidateEnvironmentCommand } = await import('./validateEnvironment');
                const validateCommand = new ValidateEnvironmentCommand();
                await validateCommand.execute();
                await this.refreshEnvironments();
                break;
        }
    }

    private async getWebviewContent(extensionUri: vscode.Uri): Promise<string> {
        // Read the HTML file
        const htmlUri = vscode.Uri.joinPath(extensionUri, 'resources', 'panel', 'panel.html');
        let html = (await vscode.workspace.fs.readFile(htmlUri)).toString();

        // Create webview URIs for CSS and JS resources
        const cssUri = this.panel!.webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'resources', 'panel', 'panel.css'));
        const jsUri = this.panel!.webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'resources', 'panel', 'panel.js'));

        // Replace placeholders with actual URIs
        html = html.replace('{{panelCssUri}}', cssUri.toString());
        html = html.replace('{{panelJsUri}}', jsUri.toString());

        return html;
    }

    public dispose() {
        this.panel?.dispose();
    }
}

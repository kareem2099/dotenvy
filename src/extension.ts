import * as vscode from 'vscode';
import * as path from 'path';

// Import Commands
import { SwitchEnvironmentCommand } from './commands/switchEnvironment';
import { OpenEnvironmentPanelCommand } from './commands/openEnvironmentPanel';
import { ValidateEnvironmentCommand } from './commands/validateEnvironment';
import { DiffEnvironmentCommand } from './commands/diffEnvironment';
import { InstallGitHookCommand } from './commands/installGitHook';
import { RemoveGitHookCommand } from './commands/removeGitHook';
import { PullFromCloudCommand } from './commands/pullFromCloud';
import { PushToCloudCommand } from './commands/pushToCloud';
import { ScanSecretsCommand } from './commands/scanSecrets';
import { FeedbackCommand } from './commands/feedback';
import { ViewEnvironmentHistoryCommand } from './commands/viewEnvironmentHistory';
import { SetMasterPasswordCommand } from './commands/setMasterPassword';
import { ExportEnvironmentCommand } from './commands/exportEnvironment';
import { InitSecureProjectCommand } from './commands/initSecureProject';
import { AddUserCommand } from './commands/addUser';
import { RevokeUserCommand } from './commands/revokeUser';
import { LoginToSecureProjectCommand } from './commands/loginToSecureProject';

// Import Providers & Managers
import { HistoryWebviewProvider } from './providers/historyWebviewProvider';
import { WorkspaceManager } from './providers/workspaceManager';
import { EnvironmentTreeProvider } from './providers/environmentTreeProvider';
import { EnvironmentWebviewProvider } from './providers/environmentWebviewProvider';
import { CommandsTreeProvider } from './providers/commandsTreeProvider';
import { EnvironmentCompletionProvider } from './providers/environmentCompletionProvider';
import { HistoryManager } from './utils/historyManager';
import { UpdateManager } from './managers/UpdateManager';

// NEW: Import LLMAnalyzer (SecretStorage-based, no hardcoded secrets)
import { LLMAnalyzer } from './utils/llmAnalyzer';
import { FeedbackManager } from './utils/feedbackManager';
import { logger, LogLevel } from './utils/logger';
import { InitDotenvyIgnoreCommand } from './commands/initDotenvyIgnore';

export let extensionUri: vscode.Uri;
export let extensionContext: vscode.ExtensionContext;

export async function activate(context: vscode.ExtensionContext) {
    extensionUri = context.extensionUri;
    extensionContext = context;
    logger.setLevel(context.extensionMode === vscode.ExtensionMode.Development
        ? LogLevel.DEBUG
        : LogLevel.WARN
        );
    logger.info('DotEnvy extension is now active! 🚀' , 'Extension');

    // ─── 0. Initialize LLMAnalyzer (must be first — other commands depend on it) ──
    //
    // This replaces the old: export const llmAnalyzer = LLMAnalyzer.getInstance();
    //
    // Why here? Because initialize() needs ExtensionContext to access SecretStorage.
    // After this line, anywhere in the codebase you can call LLMAnalyzer.getInstance()
    // safely — it will return the already-initialized instance.
    //
    // First-time setup (call once from your onboarding UI or settings command):
    //   await LLMAnalyzer.getInstance().setSharedSecret('your-secret-here');
    await LLMAnalyzer.initialize(context);

    // ─── 1. Initialize workspace manager ──────────────────────────────────────
    const workspaceManager = WorkspaceManager.getInstance();
    await workspaceManager.initializeWorkspaces();

    const initialWorkspacePath =
        vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd();

    // ─── Providers Initialization ──────────────────────────────────────────────
    const treeProvider        = new EnvironmentTreeProvider(initialWorkspacePath);
    const webviewProvider     = new EnvironmentWebviewProvider(context);
    const historyWebviewProvider = new HistoryWebviewProvider(extensionUri, context);
    const completionProvider  = new EnvironmentCompletionProvider(initialWorkspacePath);
    const commandsTreeProvider = new CommandsTreeProvider();
    const initIgnoreCommand = new InitDotenvyIgnoreCommand();
    
    // ─── Registrations ─────────────────────────────────────────────────────────
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider('dotenvy.environments', webviewProvider),
        vscode.window.registerWebviewViewProvider(HistoryWebviewProvider.viewType, historyWebviewProvider),
        vscode.window.registerTreeDataProvider('dotenvy.explorer-environments', treeProvider),
        vscode.window.registerTreeDataProvider('dotenvy.commands', commandsTreeProvider),
    );

    // ─── 2. Completion Provider ────────────────────────────────────────────────
    const supportedLanguages = [
        'javascript', 'typescript', 'javascriptreact', 'typescriptreact',
        'vue', 'svelte', 'astro', 'html', 'json', 'jsonc',
        'go', 'python', 'rust', 'php', 'java',
    ];
    context.subscriptions.push(
        vscode.languages.registerCompletionItemProvider(
            supportedLanguages.map(lang => ({ language: lang, scheme: 'file' })),
            completionProvider,
            '.',
        ),
        completionProvider,
    );

    // ─── Workspace change listener ─────────────────────────────────────────────
    context.subscriptions.push(
        vscode.workspace.onDidChangeWorkspaceFolders(async (event) => {
            for (const removed of event.removed) {
                workspaceManager.removeWorkspace(removed.uri.fsPath);
            }
            for (const added of event.added) {
                await workspaceManager.addWorkspace(added);
            }
            treeProvider.refresh();
        }),
    );

    // ─── Commands Initialization ───────────────────────────────────────────────
    const switchEnvCommand         = new SwitchEnvironmentCommand();
    const openPanelCommand         = new OpenEnvironmentPanelCommand();
    const validateEnvCommand       = new ValidateEnvironmentCommand();
    const diffEnvCommand           = new DiffEnvironmentCommand();
    const installHookCommand       = new InstallGitHookCommand();
    const removeHookCommand        = new RemoveGitHookCommand();
    const pullFromCloudCommand     = new PullFromCloudCommand();
    const pushToCloudCommand       = new PushToCloudCommand();
    const scanSecretsCommand       = new ScanSecretsCommand();
    const feedbackCommand          = new FeedbackCommand();
    const viewHistoryCommand       = new ViewEnvironmentHistoryCommand();
    const setMasterPasswordCommand = new SetMasterPasswordCommand(context);
    const exportEnvironmentCommand = new ExportEnvironmentCommand();

    const initSecureProjectCommand   = new InitSecureProjectCommand();
    const addUserCommand             = new AddUserCommand();
    const revokeUserCommand          = new RevokeUserCommand();
    const loginToSecureProjectCommand = new LoginToSecureProjectCommand();

    context.subscriptions.push(
        switchEnvCommand, openPanelCommand, validateEnvCommand, diffEnvCommand,
        installHookCommand, removeHookCommand, pullFromCloudCommand, pushToCloudCommand,
        scanSecretsCommand, feedbackCommand, viewHistoryCommand, setMasterPasswordCommand,
        exportEnvironmentCommand, initIgnoreCommand,
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('dotenvy.initSecureProject',
            () => initSecureProjectCommand.execute()),
        vscode.commands.registerCommand('dotenvy.addUser',
            () => addUserCommand.execute()),
        vscode.commands.registerCommand('dotenvy.revokeUser',
            () => revokeUserCommand.execute()),
        vscode.commands.registerCommand('dotenvy.loginToSecureProject',
            () => loginToSecureProjectCommand.execute()),
        vscode.commands.registerCommand('dotenvy.showChangelog',
            () => UpdateManager.showChangelog(context)),

        // NEW: Setup command — lets the user store the shared secret via UI
        // Wire this to a settings button / onboarding flow in your webview
        vscode.commands.registerCommand('dotenvy.setupLLMSecret', async () => {
            const secret = await vscode.window.showInputBox({
                prompt: 'Enter DotEnvy LLM Shared Secret',
                password: true,           // hides input
                ignoreFocusOut: true,
                placeHolder: 'Paste your shared secret here...',
            });
            if (secret) {
                await LLMAnalyzer.getInstance().setSharedSecret(secret);
                vscode.window.showInformationMessage('✅ DotEnvy: LLM secret saved securely.');
            }
        }),
    

    vscode.commands.registerCommand('dotenvy.addToIgnore', async (uri: vscode.Uri) => {
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (!workspaceFolders) { return; }

            const rootPath     = workspaceFolders[0].uri.fsPath;
            const relativePath = path.relative(rootPath, uri.fsPath).replace(/\\/g, '/');
            const isDir        = (await vscode.workspace.fs.stat(uri)).type === vscode.FileType.Directory;
            const pattern      = isDir ? `${relativePath}/**` : relativePath;

            const ignoreUri = vscode.Uri.joinPath(workspaceFolders[0].uri, '.dotenvyignore');
            let content = '';
            try {
                content = Buffer.from(await vscode.workspace.fs.readFile(ignoreUri)).toString('utf8');
            } catch {
                const { DotenvyIgnore } = await import('./utils/dotenvyIgnore');
                DotenvyIgnore.createDefault(rootPath);
                content = Buffer.from(await vscode.workspace.fs.readFile(ignoreUri)).toString('utf8');
            }

            if (!content.includes(pattern)) {
                await vscode.workspace.fs.writeFile(
                    ignoreUri,
                    Buffer.from(`${content.trimEnd()}\n${pattern}\n`, 'utf8')
                );
                vscode.window.showInformationMessage(`✅ Added "${pattern}" to .dotenvyignore`);
            } else {
                vscode.window.showInformationMessage(`Already ignored: "${pattern}"`);
            }
        }),
    );

    // ─── History Recorder ──────────────────────────────────────────────────────
    context.subscriptions.push(
        vscode.workspace.onDidSaveTextDocument(async (document: vscode.TextDocument) => {
            const fileName = path.basename(document.uri.fsPath);

            if (fileName === '.env' || fileName.startsWith('.env.')) {
                const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
                if (!workspaceFolder) { return; }

                if (path.dirname(document.uri.fsPath) !== workspaceFolder.uri.fsPath) {
                    return;
                }

                const environmentName =
                    fileName === '.env' ? 'local' : fileName.substring(5);

                try {
                    await HistoryManager.recordEntry(
                        workspaceFolder.uri.fsPath,
                        'modify',
                        environmentName,
                        document.getText(),
                        fileName,
                        { source: 'auto' },
                    );
                    logger.info(`History recorded for ${fileName}`, 'extension');
                } catch (error) {
                    logger.error('Failed to record history:', error, 'extension');
                }
            }
        }),
    );

    // ─── Startup checks ────────────────────────────────────────────────────────
    
    // Test LLM connection on startup (non-blocking)
    LLMAnalyzer.getInstance().testConnection().then(connected => {
        if (connected) {
            logger.info('LLM Service is online.', 'extension');
        } else {
            logger.warn('LLM Service unreachable, using local fallback.', 'extension');
        }
    });

    UpdateManager.checkNewVersion(context);
    FeedbackManager.init(context);
}

export function deactivate() {
    logger.info('DotEnvy deactivated', 'Extension');
    logger.dispose();
}
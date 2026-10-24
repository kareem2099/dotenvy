import * as vscode from 'vscode';
import * as path from 'path';

// Import Commands
import { SwitchEnvironmentCommand } from './commands/switchEnvironment';
import { OpenEnvironmentPanelCommand } from './commands/openEnvironmentPanel';
import { ValidateEnvironmentCommand } from './commands/validateEnvironment';
import { DiffEnvironmentCommand } from './commands/diffEnvironment';
import { CompareEnvironmentsCommand } from './commands/compareEnvironments';
import { DiffCloudCommand } from './commands/diffCloud';
import { InstallGitHookCommand } from './commands/installGitHook';
import { RemoveGitHookCommand } from './commands/removeGitHook';
import { PullFromCloudCommand } from './commands/pullFromCloud';
import { PushToCloudCommand } from './commands/pushToCloud';
import { ScanSecretsCommand } from './commands/scanSecrets';
import { FeedbackCommand } from './commands/feedback';
import { ViewEnvironmentHistoryCommand } from './commands/viewEnvironmentHistory';
import { SetMasterPasswordCommand } from './commands/setMasterPassword';
import { InitSecureProjectCommand } from './commands/initSecureProject';
import { AddUserCommand } from './commands/addUser';
import { RevokeUserCommand } from './commands/revokeUser';
import { LoginToSecureProjectCommand } from './commands/loginToSecureProject';

// Import Providers & Managers
import { HistoryWebviewProvider } from './providers/historyWebviewProvider';
import { AnalyticsWebviewProvider } from './providers/analyticsWebviewProvider';
import { recordSavedEnvironment } from './utils/environmentHistory';
import { TimelineWebviewProvider } from './providers/timelineWebviewProvider';
import { WorkspaceManager } from './providers/workspaceManager';
import { EnvironmentWebviewProvider } from './providers/environmentWebviewProvider';
import { CommandsTreeProvider } from './providers/commandsTreeProvider';
import { EnvironmentCompletionProvider } from './providers/environmentCompletionProvider';
import { TrashBinWebviewProvider } from './providers/trashBinWebviewProvider';
import { VariableWebviewProvider } from './providers/variableWebviewProvider';
import { SecretDetector } from './utils/secretDetector';
import { registerSecretDiagnostics } from './providers/secretDiagnostics';
import { UpdateManager } from './managers/UpdateManager';
import { DopplerWatcherRegistry } from './utils/dopplerWatcher';

// Local user corrections for the secrets scanner.
import { FeedbackManager } from './utils/feedbackManager';
import { logger, LogLevel } from './utils/logger';
import { InitDotenvyIgnoreCommand } from './commands/initDotenvyIgnore';
import { LocalizationService, t } from './i18n';

export let extensionUri: vscode.Uri;
export let extensionContext: vscode.ExtensionContext;

export async function activate(context: vscode.ExtensionContext) {
    extensionUri = context.extensionUri;
    extensionContext = context;
    logger.setLevel(context.extensionMode === vscode.ExtensionMode.Development
        ? LogLevel.DEBUG
        : LogLevel.WARN
    );
    logger.info('DotEnvy extension is now active! 🚀', 'Extension');

    const localization = LocalizationService.getInstance();
    await localization.initialize(context);

    await FeedbackManager.init(context);

    // ─── 1. Initialize workspace manager ──────────────────────────────────────
    const workspaceManager = WorkspaceManager.getInstance();
    await workspaceManager.initializeWorkspaces();

    const initialWorkspacePath =
        vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd();

    // ─── Providers Initialization ──────────────────────────────────────────────
    const webviewProvider = new EnvironmentWebviewProvider(context);
    // Initialize the static History panel (no longer a sidebar view)
    HistoryWebviewProvider.init(extensionUri, context);
    // Initialize the static Analytics panel
    AnalyticsWebviewProvider.init(extensionUri, context);
    // Initialize the static Timeline panel
    TimelineWebviewProvider.init(extensionUri, context);
    // Initialize the static Trash Bin panel
    TrashBinWebviewProvider.init(extensionUri, context);
    // Initialize the static Variable Manager panel
    VariableWebviewProvider.init(extensionUri, context);
    const completionProvider = new EnvironmentCompletionProvider(initialWorkspacePath);
    const commandsTreeProvider = new CommandsTreeProvider();
    const initIgnoreCommand = new InitDotenvyIgnoreCommand();

    localization.onDidChangeLocale(() => {
        commandsTreeProvider.refresh();
        for (const ws of workspaceManager.getAllWorkspaces()) {
            ws.statusBarProvider.forceRefresh();
        }
        void vscode.commands.executeCommand('dotenvy.refreshLocalizedViews');
    });

    context.subscriptions.push(
        vscode.commands.registerCommand('dotenvy.refreshLocalizedViews', async () => {
            await webviewProvider.refreshEnvironments();
            HistoryWebviewProvider.refreshLocale();
            AnalyticsWebviewProvider.refreshLocale();
            TimelineWebviewProvider.refreshLocale();
            TrashBinWebviewProvider.refreshLocale();
            VariableWebviewProvider.refreshLocale();
            commandsTreeProvider.refresh();
        }),
    );

    // ─── Registrations ─────────────────────────────────────────────────────────
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider('dotenvy.environments', webviewProvider),
        vscode.window.registerTreeDataProvider('dotenvy.commands', commandsTreeProvider),
        // Command to open the History panel as a full WebviewPanel (tab)
        vscode.commands.registerCommand('dotenvy.openHistoryPanel', () => HistoryWebviewProvider.openOrReveal()),
        // Command to open the Analytics panel as a full WebviewPanel (tab)
        vscode.commands.registerCommand('dotenvy.openAnalyticsPanel', (rootPath?: string) => AnalyticsWebviewProvider.openOrReveal(rootPath)),
        // Command to open the Timeline panel as a full WebviewPanel (tab)
        vscode.commands.registerCommand('dotenvy.openTimelinePanel', () => TimelineWebviewProvider.openOrReveal()),
        // Command to open the Variable Manager panel as a full WebviewPanel (tab)
        vscode.commands.registerCommand('dotenvy.openVariableManager', (fileName?) => VariableWebviewProvider.openOrReveal(fileName)),
        // Command to open the Trash Bin panel as a full WebviewPanel (tab)
        vscode.commands.registerCommand('dotenvy.openTrashBin', () => TrashBinWebviewProvider.openOrReveal()),
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
                DopplerWatcherRegistry.remove(removed.uri.fsPath);
            }
            for (const added of event.added) {
                await workspaceManager.addWorkspace(added);
                DopplerWatcherRegistry.getOrCreate(added.uri.fsPath);
            }
        }),
    );

    // ─── Commands Initialization ───────────────────────────────────────────────
    const switchEnvCommand = new SwitchEnvironmentCommand();
    const openPanelCommand = new OpenEnvironmentPanelCommand();
    const diffEnvCommand = new DiffEnvironmentCommand();
    const compareEnvironmentsCommand = new CompareEnvironmentsCommand();
    const diffCloudCommand = new DiffCloudCommand();
    const installHookCommand = new InstallGitHookCommand();
    const removeHookCommand = new RemoveGitHookCommand();
    const pullFromCloudCommand = new PullFromCloudCommand();
    const pushToCloudCommand = new PushToCloudCommand();
    const scanSecretsCommand = new ScanSecretsCommand();
    const feedbackCommand = new FeedbackCommand();
    const viewHistoryCommand = new ViewEnvironmentHistoryCommand();
    const setMasterPasswordCommand = new SetMasterPasswordCommand(context);
    const initSecureProjectCommand = new InitSecureProjectCommand();
    const addUserCommand = new AddUserCommand();
    const revokeUserCommand = new RevokeUserCommand();
    const loginToSecureProjectCommand = new LoginToSecureProjectCommand();

    context.subscriptions.push(
        switchEnvCommand,
        viewHistoryCommand,
        setMasterPasswordCommand,
        initIgnoreCommand,
        vscode.commands.registerCommand('dotenvy.openEnvironmentPanel', () => openPanelCommand.execute()),
        vscode.commands.registerCommand('dotenvy.connectDoppler', async () => {
            const root = await WorkspaceManager.resolveWorkspacePath(undefined, t('common.selectWorkspace'));
            if (root) {
                await (await import('./utils/dopplerOnboarding')).DopplerOnboarding.connect(root);
                await webviewProvider.refreshEnvironments();
            }
        }),
        vscode.commands.registerCommand('dotenvy.validateEnvironment', () =>
            ValidateEnvironmentCommand.manageValidation()),
        vscode.commands.registerCommand('dotenvy.diffEnvironment', () => diffEnvCommand.execute()),
        vscode.commands.registerCommand('dotenvy.compareEnvironments', () => compareEnvironmentsCommand.execute()),
        vscode.commands.registerCommand('dotenvy.installGitHook', () => installHookCommand.execute()),
        vscode.commands.registerCommand('dotenvy.removeGitHook', () => removeHookCommand.execute()),
        vscode.commands.registerCommand('dotenvy.pullFromCloud', () => pullFromCloudCommand.execute()),
        vscode.commands.registerCommand('dotenvy.diffCloud', () => diffCloudCommand.execute()),
        vscode.commands.registerCommand('dotenvy.pushToCloud', () => pushToCloudCommand.execute()),
        vscode.commands.registerCommand('dotenvy.scanSecrets', () => scanSecretsCommand.execute()),
        vscode.commands.registerCommand('dotenvy.feedback', () => feedbackCommand.execute()),
        vscode.commands.registerCommand('dotenvy.backup', async () => {
            const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
            if (!workspaceFolder) {
                vscode.window.showErrorMessage(t('common.noWorkspace'));
                return;
            }
            const envPath = path.join(workspaceFolder.uri.fsPath, '.env');
            const { BackupCommands } = await import('./commands/backupCommands');
            await BackupCommands.backupEnv(context, envPath);
        }),
        vscode.commands.registerCommand('dotenvy.restore', async () => {
            const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
            if (!workspaceFolder) {
                vscode.window.showErrorMessage(t('common.noWorkspace'));
                return;
            }
            const { BackupCommands } = await import('./commands/backupCommands');
            await BackupCommands.restoreFromBackup(context, workspaceFolder.uri.fsPath);
        }),
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

        vscode.commands.registerCommand('dotenvy.resetSecretCorrections', async () => {
            await FeedbackManager.clear();
            vscode.window.showInformationMessage(t('extension.secretCorrections.cleared'));
        }),

        vscode.commands.registerCommand('dotenvy.addToIgnore', async (uri: vscode.Uri) => {
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (!workspaceFolders) { return; }

            const rootPath = workspaceFolders[0].uri.fsPath;
            const relativePath = path.relative(rootPath, uri.fsPath).replace(/\\/g, '/');
            const isDir = (await vscode.workspace.fs.stat(uri)).type === vscode.FileType.Directory;
            const pattern = isDir ? `${relativePath}/**` : relativePath;

            const ignoreUri = vscode.Uri.joinPath(workspaceFolders[0].uri, '.dotenvyignore');
            let content: string;
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
                vscode.window.showInformationMessage(t('extension.ignore.added', { pattern }));
            } else {
                vscode.window.showInformationMessage(t('extension.ignore.already', { pattern }));
            }
        }),
    );

    // ─── History Recorder ──────────────────────────────────────────────────────
    context.subscriptions.push(
        vscode.workspace.onDidSaveTextDocument(async (document: vscode.TextDocument) => {
            try {
                const rootPath = await recordSavedEnvironment(document);
                if (rootPath) await HistoryWebviewProvider.loadHistory(rootPath);
            } catch (error) {
                logger.error('Failed to record history:', error, 'extension');
            }
        }),
    );

    // ─── Startup checks ────────────────────────────────────────────────────────

    UpdateManager.checkNewVersion(context);

    // Start real-time secret monitoring
    SecretDetector.startFileWatcher();
    registerSecretDiagnostics(context);

    // ─── Doppler background watcher ───────────────────────────────────────────
    // Starts polling for each open workspace so the status bar badge stays live.
    for (const folder of vscode.workspace.workspaceFolders ?? []) {
        DopplerWatcherRegistry.getOrCreate(folder.uri.fsPath);
    }
    context.subscriptions.push({ dispose: () => DopplerWatcherRegistry.disposeAll() });
}

export function deactivate() {
    logger.info('DotEnvy deactivated', 'Extension');
    logger.dispose();
}

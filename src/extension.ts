import * as vscode from 'vscode';
import * as path from 'path'; // Import path module
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
import { HistoryWebviewProvider } from './providers/historyWebviewProvider';
import { WorkspaceManager } from './providers/workspaceManager';
import { EnvironmentTreeProvider } from './providers/environmentTreeProvider';
import { EnvironmentWebviewProvider } from './providers/environmentWebviewProvider';
import { CommandsTreeProvider } from './providers/commandsTreeProvider';
import { EnvironmentCompletionProvider } from './providers/environmentCompletionProvider';
import { HistoryManager } from './utils/historyManager';
import { UpdateManager } from './managers/UpdateManager'; // ✅ Added UpdateManager

export let extensionUri: vscode.Uri;
export let extensionContext: vscode.ExtensionContext;

export async function activate(context: vscode.ExtensionContext) {
    extensionUri = context.extensionUri;
    extensionContext = context;
    console.log('DotEnvy extension is now active! 🚀');

    // 1. Initialize workspace manager
    const workspaceManager = WorkspaceManager.getInstance();
    await workspaceManager.initializeWorkspaces();

    // Get Initial Workspace Path (For Providers)
    const initialWorkspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd();

    // --- Providers Initialization ---
    const treeProvider = new EnvironmentTreeProvider(initialWorkspacePath);
    const webviewProvider = new EnvironmentWebviewProvider(context);
    const historyWebviewProvider = new HistoryWebviewProvider(extensionUri, context);
    const completionProvider = new EnvironmentCompletionProvider(initialWorkspacePath);
    const commandsTreeProvider = new CommandsTreeProvider();

    // --- Registrations ---
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider('dotenvy.environments', webviewProvider),
        vscode.window.registerWebviewViewProvider(HistoryWebviewProvider.viewType, historyWebviewProvider),
        vscode.window.registerTreeDataProvider('dotenvy.explorer-environments', treeProvider),
        vscode.window.registerTreeDataProvider('dotenvy.commands', commandsTreeProvider)
    );

    // 2. Register Completion Provider (Performance Boost 🚀)
    const supportedLanguages = [
        'javascript', 'typescript', 'javascriptreact', 'typescriptreact',
        'vue', 'svelte', 'astro', 'html', 'json', 'jsonc', 'go', 'python', 'rust', 'php', 'java'
    ];
    context.subscriptions.push(
        vscode.languages.registerCompletionItemProvider(
            supportedLanguages.map(lang => ({ language: lang, scheme: 'file' })),
            completionProvider,
            '.' // Trigger character
        ),
        completionProvider // Ensure disposal
    );

    // Listen for workspace changes
    context.subscriptions.push(
        vscode.workspace.onDidChangeWorkspaceFolders(async (event) => {
            for (const removed of event.removed) workspaceManager.removeWorkspace(removed.uri.fsPath);
            for (const added of event.added) await workspaceManager.addWorkspace(added);
            
            // Refresh tree view on workspace change
            treeProvider.refresh();
        })
    );

    // --- Commands Initialization ---
    // Legacy Commands (Instantiated directly)
    const switchEnvCommand = new SwitchEnvironmentCommand();
    const openPanelCommand = new OpenEnvironmentPanelCommand();
    const validateEnvCommand = new ValidateEnvironmentCommand();
    const diffEnvCommand = new DiffEnvironmentCommand();
    const installHookCommand = new InstallGitHookCommand();
    const removeHookCommand = new RemoveGitHookCommand();
    const pullFromCloudCommand = new PullFromCloudCommand();
    const pushToCloudCommand = new PushToCloudCommand();
    const scanSecretsCommand = new ScanSecretsCommand();
    const feedbackCommand = new FeedbackCommand();
    const viewHistoryCommand = new ViewEnvironmentHistoryCommand();
    const setMasterPasswordCommand = new SetMasterPasswordCommand(context);
    const exportEnvironmentCommand = new ExportEnvironmentCommand();
    
    // Security Commands
    const initSecureProjectCommand = new InitSecureProjectCommand();
    const addUserCommand = new AddUserCommand();
    const revokeUserCommand = new RevokeUserCommand();
    const loginToSecureProjectCommand = new LoginToSecureProjectCommand();

    // Push Legacy Commands
    context.subscriptions.push(
        switchEnvCommand, openPanelCommand, validateEnvCommand, diffEnvCommand,
        installHookCommand, removeHookCommand, pullFromCloudCommand, pushToCloudCommand,
        scanSecretsCommand, feedbackCommand, viewHistoryCommand, setMasterPasswordCommand,
        exportEnvironmentCommand
    );

    // Register New Commands (Explicit Registration)
    context.subscriptions.push(
        vscode.commands.registerCommand('dotenvy.initSecureProject', () => initSecureProjectCommand.execute()),
        vscode.commands.registerCommand('dotenvy.addUser', () => addUserCommand.execute()),
        vscode.commands.registerCommand('dotenvy.revokeUser', () => revokeUserCommand.execute()),
        vscode.commands.registerCommand('dotenvy.loginToSecureProject', () => loginToSecureProjectCommand.execute()),
        // ✅ Add Changelog Command
        vscode.commands.registerCommand('dotenvy.showChangelog', () => UpdateManager.showChangelog(context))
    );

    // --- History Recorder (The Smart Watcher) ---
    context.subscriptions.push(
        vscode.workspace.onDidSaveTextDocument(async (document: vscode.TextDocument) => {
            const fileName = path.basename(document.uri.fsPath);
            
            // Check if it's an .env file
            if (fileName === '.env' || fileName.startsWith('.env.')) {
                // 🔥 Dynamic Workspace Detection (Fix for Multi-root workspaces)
                const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
                if (!workspaceFolder) return; // File is outside any workspace

                // Ensure the file is directly in the root of that workspace
                // (Change this logic if you want to support nested .env files)
                if (path.dirname(document.uri.fsPath) !== workspaceFolder.uri.fsPath) {
                    return; 
                }

                const environmentName = fileName === '.env' ? 'local' : fileName.substring(5);
                
                try {
                    await HistoryManager.recordEntry(
                        workspaceFolder.uri.fsPath, // Use the correct workspace path
                        'modify',
                        environmentName,
                        document.getText(),
                        fileName,
                        { source: 'auto' }
                    );
                    console.log(`[DotEnvy] History recorded for ${fileName}`);
                } catch (error) {
                    console.error(`Failed to record history:`, error);
                }
            }
        })
    );

    // ✅ Check for updates on startup
    UpdateManager.checkNewVersion(context);
}

export function deactivate() {
    // Cleanup handled by subscriptions
}
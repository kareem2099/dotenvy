import * as vscode from 'vscode';
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
import { HistoryWebviewProvider } from './providers/historyWebviewProvider';
import { WorkspaceManager } from './providers/workspaceManager';
import { EnvironmentTreeProvider } from './providers/environmentTreeProvider';
import { EnvironmentWebviewProvider } from './providers/environmentWebviewProvider';
import { CommandsTreeProvider } from './providers/commandsTreeProvider';
import { EnvironmentCompletionProvider } from './providers/environmentCompletionProvider';
import { HistoryManager } from './utils/historyManager'; // Import HistoryManager
import * as path from 'path'; // Import path module

export let extensionUri: vscode.Uri;
export let extensionContext: vscode.ExtensionContext;

export async function activate(context: vscode.ExtensionContext) {
    extensionUri = context.extensionUri;
    extensionContext = context;
	console.log('dotenvy extension is now active!');

	// Initialize workspace manager
	const workspaceManager = WorkspaceManager.getInstance();
	await workspaceManager.initializeWorkspaces();

	// Get Workspace Path
	const workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd();
	// --- Providers Initialization ---
	const treeProvider = new EnvironmentTreeProvider(workspacePath);
	const webviewProvider = new EnvironmentWebviewProvider(context);
	const historyWebviewProvider = new HistoryWebviewProvider(extensionUri, context);
	// 1. Initialize Completion Provider
	const completionProvider = new EnvironmentCompletionProvider(workspacePath);
	// --- Registrations ---
	const webviewDisposable = vscode.window.registerWebviewViewProvider('dotenvy.environments', webviewProvider);
	const historyWebviewDisposable = vscode.window.registerWebviewViewProvider(HistoryWebviewProvider.viewType, historyWebviewProvider);
	const treeDisposable2 = vscode.window.registerTreeDataProvider('dotenvy.explorer-environments', treeProvider);
	const commandsTreeProvider = new CommandsTreeProvider();
	const commandsTreeDisposable = vscode.window.registerTreeDataProvider('dotenvy.commands', commandsTreeProvider);
	// 2. Register Completion Provider with specific filters (Performance Boost 🚀)
	const supportedLanguages = [
        'javascript', 'typescript', 'javascriptreact', 'typescriptreact', 
        'vue', 'svelte', 'astro', 'html', 'json', 'jsonc', 'go', 'python', 'rust'
    ];
	const completionDisposable = vscode.languages.registerCompletionItemProvider(
		supportedLanguages.map(lang => ({ language: lang, scheme: 'file' })),
		completionProvider,
		'.' // Trigger character
	);
	
	//  3. Add 'completionProvider' itself to subscriptions 
    // This ensures dispose() is called to clean up the internal FileWatcher
	context.subscriptions.push(
		webviewDisposable,
		historyWebviewDisposable,
		treeDisposable2,
		commandsTreeDisposable,
		completionDisposable,
		completionProvider // Add the provider itself for proper disposal
	);

	// Listen for workspace changes
	const workspaceWatcher = vscode.workspace.onDidChangeWorkspaceFolders(async (event) => {
		// Remove old workspaces
		for (const removed of event.removed) {
			workspaceManager.removeWorkspace(removed.uri.fsPath);
		}

		// Add new workspaces
		for (const added of event.added) {
			await workspaceManager.addWorkspace(added);
		}
	});

	context.subscriptions.push(workspaceWatcher);

	// Register commands - they will use the workspace manager internally
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
	const initSecureProjectCommand = new InitSecureProjectCommand();
	const addUserCommand = new AddUserCommand();
	const revokeUserCommand = new RevokeUserCommand();

	

	// Push commands to context
	context.subscriptions.push(
	switchEnvCommand,
	openPanelCommand,
	validateEnvCommand,
	diffEnvCommand,
	installHookCommand,
	removeHookCommand,
	pullFromCloudCommand,
	pushToCloudCommand,
	scanSecretsCommand,
	feedbackCommand,
	viewHistoryCommand,
	setMasterPasswordCommand,
	exportEnvironmentCommand,
	initSecureProjectCommand,
	addUserCommand,
	revokeUserCommand
	);

	// Register Command Handlers
    context.subscriptions.push(
       
        vscode.commands.registerCommand('dotenvy.initSecureProject', () => initSecureProjectCommand.execute()),
        vscode.commands.registerCommand('dotenvy.addUser', () => addUserCommand.execute()),
        vscode.commands.registerCommand('dotenvy.revokeUser', () => revokeUserCommand.execute())
    );

    // Add listener for document save events
    const saveDocumentDisposable = vscode.workspace.onDidSaveTextDocument(async (document: vscode.TextDocument) => {
        const filePath = document.uri.fsPath;
        const fileName = path.basename(filePath);

        // Check if the saved file is an .env or .env.* file and is in the root workspace folder
        if ((fileName === '.env' || fileName.startsWith('.env.')) && path.dirname(filePath) === workspacePath) {
            // Determine environment name: '.env' maps to 'local', '.env.local' maps to 'local', '.env.development' maps to 'development'
            const environmentName = fileName === '.env' ? 'local' : fileName.substring(5); // Remove '.env.' (5 chars) to get the environment suffix
            const fileContent = document.getText();

            try {
                // Record the history entry
                await HistoryManager.recordEntry(
                    workspacePath,
                    'modify', // Action type
                    environmentName,
                    fileContent,
                    fileName, // Pass the actual fileName
                    { source: 'auto' } // Source of the change
                );
                // Optionally, provide user feedback
                console.log(`[DotEnvy] History recorded silently for ${fileName}`);
            } catch (error) {
                console.error(`Failed to record history for ${fileName}:`, error);
                // vscode.window.showErrorMessage(`Failed to record history for ${fileName}. See console for details.`);
            }
        }
    });

    context.subscriptions.push(saveDocumentDisposable);
}

export function deactivate() {
	// Cleanup will be handled by vscode context subscriptions
}

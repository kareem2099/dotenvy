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
import { WorkspaceManager } from './providers/workspaceManager';
import { EnvironmentTreeProvider } from './providers/environmentTreeProvider';
import { EnvironmentWebviewProvider } from './providers/environmentWebviewProvider';

export let extensionUri: vscode.Uri;
export let extensionContext: vscode.ExtensionContext;

export async function activate(context: vscode.ExtensionContext) {
    extensionUri = context.extensionUri;
    extensionContext = context;
	console.log('dotenvy extension is now active!');

	// Initialize workspace manager
	const workspaceManager = WorkspaceManager.getInstance();
	await workspaceManager.initializeWorkspaces();

	// Register tree data providers for views
	const workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd();
	const treeProvider = new EnvironmentTreeProvider(workspacePath);
	const webviewProvider = new EnvironmentWebviewProvider(context);
	const webviewDisposable = vscode.window.registerWebviewViewProvider('dotenvy.environments', webviewProvider);
	const treeDisposable2 = vscode.window.registerTreeDataProvider('dotenvy.explorer-environments', treeProvider);
	context.subscriptions.push(webviewDisposable, treeDisposable2);

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

	context.subscriptions.push(switchEnvCommand);
	context.subscriptions.push(openPanelCommand);
	context.subscriptions.push(validateEnvCommand);
	context.subscriptions.push(diffEnvCommand);
	context.subscriptions.push(installHookCommand);
	context.subscriptions.push(removeHookCommand);
	context.subscriptions.push(pullFromCloudCommand);
	context.subscriptions.push(pushToCloudCommand);
	context.subscriptions.push(scanSecretsCommand);
	context.subscriptions.push(feedbackCommand);

	// Register the openEnvironmentPanel command
	const openPanelDisposable = vscode.commands.registerCommand('dotenvy.openEnvironmentPanel', () => {
		openPanelCommand.execute();
	});

	// Register the validateEnvironment command
	const validateDisposable = vscode.commands.registerCommand('dotenvy.validateEnvironment', () => {
		validateEnvCommand.execute();
	});

	// Register the diffEnvironment command
	const diffDisposable = vscode.commands.registerCommand('dotenvy.diffEnvironment', () => {
		diffEnvCommand.execute();
	});

	// Register the install/remove hook commands
	const installHookDisposable = vscode.commands.registerCommand('dotenvy.installGitHook', () => {
		installHookCommand.execute();
	});

	const removeHookDisposable = vscode.commands.registerCommand('dotenvy.removeGitHook', () => {
		removeHookCommand.execute();
	});

	// Register the cloud sync commands
	const pullFromCloudDisposable = vscode.commands.registerCommand('dotenvy.pullFromCloud', () => {
		pullFromCloudCommand.execute();
	});

	const pushToCloudDisposable = vscode.commands.registerCommand('dotenvy.pushToCloud', () => {
		pushToCloudCommand.execute();
	});

	// Register the scan secrets command
	const scanSecretsDisposable = vscode.commands.registerCommand('dotenvy.scanSecrets', () => {
		scanSecretsCommand.execute();
	});

	// Register the feedback command
	const feedbackDisposable = vscode.commands.registerCommand('dotenvy.feedback', () => {
		feedbackCommand.execute();
	});

	context.subscriptions.push(openPanelDisposable);
	context.subscriptions.push(validateDisposable);
	context.subscriptions.push(diffDisposable);
	context.subscriptions.push(installHookDisposable);
	context.subscriptions.push(removeHookDisposable);
	context.subscriptions.push(pullFromCloudDisposable);
	context.subscriptions.push(pushToCloudDisposable);
	context.subscriptions.push(scanSecretsDisposable);
	context.subscriptions.push(feedbackDisposable);
}

export function deactivate() {
	// Cleanup will be handled by vscode context subscriptions
}

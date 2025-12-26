import * as vscode from 'vscode';
import { EnvironmentProvider } from './environmentProvider';
import { StatusBarProvider } from './statusBarProvider';
import { GitBranchWatcher } from './gitBranchWatcher';
import { EnvironmentTreeProvider } from './environmentTreeProvider';

export interface WorkspaceContext {
	workspace: vscode.WorkspaceFolder;
	environmentProvider: EnvironmentProvider;
	statusBarProvider: StatusBarProvider;
	gitBranchWatcher: GitBranchWatcher | null;
	treeProvider: EnvironmentTreeProvider;
	workspaceDisposables?: vscode.Disposable[];
}

export class WorkspaceManager {
	private static instance: WorkspaceManager;
	private workspaces = new Map<string, WorkspaceContext>();
	private activeWorkspace: string | null = null;

	static getInstance(): WorkspaceManager {
		if (!WorkspaceManager.instance) {
			WorkspaceManager.instance = new WorkspaceManager();
		}
		return WorkspaceManager.instance;
	}

	/**
	 * Initialize workspace context for all current workspaces
	 */
	async initializeWorkspaces(): Promise<void> {
		const workspaceFolders = vscode.workspace.workspaceFolders;
		if (!workspaceFolders) {
			return;
		}

		// Clear existing workspaces
		this.clearWorkspaces();

		// Initialize new workspaces
		for (const workspace of workspaceFolders) {
			await this.addWorkspace(workspace);
		}

		// Set active workspace to first one
		this.activeWorkspace = workspaceFolders[0].uri.fsPath;
	}

	/**
	 * Add a new workspace
	 */
	async addWorkspace(workspace: vscode.WorkspaceFolder): Promise<void> {
		const workspacePath = workspace.uri.fsPath;
		const workspaceName = workspace.name;

		// Create providers for this workspace
		const environmentProvider = new EnvironmentProvider(workspacePath);
		const statusBarProvider = new StatusBarProvider();
		const treeProvider = new EnvironmentTreeProvider(workspacePath);

		// Initialize status bar
		statusBarProvider.setWorkspace(workspacePath);

		// Initialize git branch watcher
		let gitBranchWatcher: GitBranchWatcher | null = null;
		const workspaceDisposables: vscode.Disposable[] = [];

		try {
			gitBranchWatcher = new GitBranchWatcher(workspacePath, statusBarProvider);
			// Subscribe to dispose event
			const disposable = {
				dispose: () => {
					gitBranchWatcher?.dispose();
				}
			};

			// Add to workspace disposables tracking for proper cleanup
			workspaceDisposables.push(disposable);

		} catch (error) {
			// Git watcher failed to initialize, continue without it
			console.log(`Git branch watcher not available for workspace ${workspaceName}`);
		}

		const context: WorkspaceContext = {
			workspace: workspace,
			environmentProvider,
			statusBarProvider,
			gitBranchWatcher,
			treeProvider,
			workspaceDisposables
		};

		this.workspaces.set(workspacePath, context);

		// Note: Tree providers are registered in package.json and work for the active workspace
	}

	/**
	 * Remove a workspace
	 */
	removeWorkspace(workspacePath: string): void {
		const context = this.workspaces.get(workspacePath);
		if (context) {
			context.gitBranchWatcher?.dispose();
			context.statusBarProvider.dispose();
			this.workspaces.delete(workspacePath);

			// Update active workspace if removed
			if (this.activeWorkspace === workspacePath) {
				const remaining = Array.from(this.workspaces.keys());
				this.activeWorkspace = remaining.length > 0 ? remaining[0] : null;
			}
		}
	}

	/**
	 * Clear all workspaces
	 */
	clearWorkspaces(): void {
		for (const [workspacePath, context] of this.workspaces) {
			// Log workspace cleanup for debugging
			console.log(`Clearing workspace: ${workspacePath}`);

			// Dispose all workspace-specific resources
			context.workspaceDisposables?.forEach(disposable => disposable.dispose());
			context.gitBranchWatcher?.dispose();
			context.statusBarProvider.dispose();
		}
		this.workspaces.clear();
		this.activeWorkspace = null;
	}

	/**
	 * Get active workspace context
	 */
	getActiveWorkspace(): WorkspaceContext | null {
		if (!this.activeWorkspace) return null;
		return this.workspaces.get(this.activeWorkspace) || null;
	}

	/**
	 * Set active workspace
	 */
	setActiveWorkspace(workspacePath: string): boolean {
		if (this.workspaces.has(workspacePath)) {
			this.activeWorkspace = workspacePath;
			return true;
		}
		return false;
	}

	/**
	 * Get workspace context by path
	 */
	getWorkspace(workspacePath: string): WorkspaceContext | null {
		return this.workspaces.get(workspacePath) || null;
	}

	/**
	 * Get all workspaces
	 */
	getAllWorkspaces(): WorkspaceContext[] {
		return Array.from(this.workspaces.values());
	}

	/**
	 * Get workspace names for quick pick
	 */
	getWorkspaceQuickPickItems(): vscode.QuickPickItem[] {
		return Array.from(this.workspaces.values()).map(context => ({
			label: context.workspace.name,
			description: context.workspace.uri.fsPath,
			detail: `${context.workspace.name} workspace`
		}));
	}
}

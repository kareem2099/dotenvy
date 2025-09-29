import * as vscode from 'vscode';
import { GitUtils } from '../utils/gitUtils';
import { ConfigUtils } from '../utils/configUtils';
import { EnvironmentProvider } from './environmentProvider';
import { StatusBarProvider } from './statusBarProvider';
import { FileUtils } from '../utils/fileUtils';
import { SecretsGuard } from '../utils/secretsGuard';

export class GitBranchWatcher implements vscode.Disposable {
	private workspaceRoot: string;
	private statusBarProvider: StatusBarProvider;
	private environmentProvider: EnvironmentProvider;
	private currentBranch: string | null = null;
	private watcher: vscode.FileSystemWatcher | null = null;
	private disposables: vscode.Disposable[] = [];

	constructor(workspaceRoot: string, statusBarProvider: StatusBarProvider) {
		this.workspaceRoot = workspaceRoot;
		this.statusBarProvider = statusBarProvider;
		this.environmentProvider = new EnvironmentProvider(workspaceRoot);

		this.initializeWatcher();
	}

	private async initializeWatcher() {
		// Check if auto-switch is enabled
  if (!(await ConfigUtils.isAutoSwitchEnabled())) {
    return;
  }

		// Check if this is a git repository
		if (!await GitUtils.isGitRepository(this.workspaceRoot)) {
			return;
		}

		// Initial branch check
		await this.checkForBranchChanges();

		// Watch for .git/HEAD changes to detect branch switches
		const headPath = vscode.Uri.joinPath(vscode.Uri.file(this.workspaceRoot), '.git', 'HEAD');
		this.watcher = vscode.workspace.createFileSystemWatcher(headPath.fsPath);

		this.watcher.onDidChange(() => {
			this.debouncedBranchCheck();
		});

		this.watcher.onDidCreate(() => {
			this.debouncedBranchCheck();
		});

		this.disposables.push(this.watcher);
	}

	private debouncedBranchCheck = this.debounce(async () => {
		await this.checkForBranchChanges();
	}, 500);

	private async checkForBranchChanges() {
		try {
			const branch = await GitUtils.getCurrentBranch(this.workspaceRoot);
			if (branch && branch !== this.currentBranch) {
				this.currentBranch = branch;
				await this.autoSwitchEnvironment(branch);
			}
		} catch (error) {
			console.log('Failed to check git branch:', error);
		}
	}

	private async autoSwitchEnvironment(branch: string) {
		const mapping = await ConfigUtils.getGitBranchMapping();
		if (!mapping) {
			return;
		}

		const environmentName = mapping.get(branch);
		if (!environmentName) {
			return; // No mapping for this branch
		}

		// Get available environments
		const environments = await this.environmentProvider.getEnvironments();
		const targetEnv = environments.find(env => env.name === environmentName);

		if (!targetEnv) {
			vscode.window.showWarningMessage(
				`dotenvy: Branch '${branch}' maps to '${environmentName}' but environment file not found.`
			);
			return;
		}

		try {
			// Auto-switch to the mapped environment
			await FileUtils.switchToEnvironment(targetEnv, this.workspaceRoot);

			// Check for secrets
			const warnings = SecretsGuard.checkFile(targetEnv.filePath);
			if (warnings.length > 0) {
				vscode.window.showWarningMessage(
					`🔄 Auto-switched to ${targetEnv.name} (branch: ${branch}) - ⚠️ Contains potential secrets: ${warnings.join(', ')}`
				);
			} else {
				vscode.window.showInformationMessage(
					`🔄 Auto-switched environment to ${targetEnv.name} (branch: ${branch})`
				);
			}

			// Update status bar
			this.statusBarProvider.forceRefresh();

		} catch (error) {
			vscode.window.showErrorMessage(
				`Failed to auto-switch environment: ${(error as Error).message}`
			);
		}
	}

	/**
	 * Debounce function to limit the frequency of branch checks
	 */
	private debounce(func: Function, delay: number) {
		let timeoutId: NodeJS.Timeout;
		return (...args: any[]) => {
			clearTimeout(timeoutId);
			timeoutId = setTimeout(() => func.apply(this, args), delay);
		};
	}

	public dispose() {
		this.disposables.forEach(disposable => disposable.dispose());
		this.disposables = [];
	}
}

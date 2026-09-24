import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { execSync } from 'child_process';
import { SecretsGuard } from './secretsGuard';
import { EnvironmentValidator } from './environmentValidator';
import { ConfigUtils } from './configUtils';
import { GitCommitHookConfig } from '../types/environment';
import { WorkspaceManager } from '../providers/workspaceManager';
import { showSyncToast } from './panelNotification';
import { spawn } from 'child_process';
import { t } from '../i18n';

const DOTENVY_HOOK_MARKER = 'dotenvy pre-commit hook';

export class GitHookManager {
	/**
	 * Show install/remove menu for the git hook.
	 */
	static async manageHook(preferredPath?: string): Promise<void> {
		const workspacePath = await WorkspaceManager.resolveWorkspacePath(preferredPath, t('common.selectWorkspace'));
		if (!workspacePath) {
			showSyncToast(t('gitHook.manage.cancelledNoWorkspace'), 'info');
			return;
		}

		const gitRoot = this.resolveGitRoot(workspacePath);
		if (!gitRoot) {
			showSyncToast(t('common.notGitRepo'), 'error');
			return;
		}

		const installed = this.isHookInstalled(workspacePath);
		const options = installed
			? [
				{ label: `$(trash) ${t('gitHook.manage.removeLabel')}`, description: t('gitHook.manage.removeDesc'), action: 'remove' as const },
				{ label: `$(refresh) ${t('gitHook.manage.reinstallLabel')}`, description: t('gitHook.manage.reinstallDesc'), action: 'install' as const }
			]
			: [
				{ label: `$(link) ${t('gitHook.manage.installLabel')}`, description: t('gitHook.manage.installDesc'), action: 'install' as const }
			];

		const choice = await vscode.window.showQuickPick(options, {
			placeHolder: installed ? t('gitHook.manage.installedPlaceholder') : t('gitHook.manage.installPlaceholder')
		});

		if (!choice) {
			showSyncToast(t('gitHook.manage.cancelled'), 'info');
			return;
		}

		if (choice.action === 'remove') {
			const { RemoveGitHookCommand } = await import('../commands/removeGitHook');
			await new RemoveGitHookCommand().execute(workspacePath);
			return;
		}

		const { InstallGitHookCommand } = await import('../commands/installGitHook');
		await new InstallGitHookCommand().execute(workspacePath);
	}

	/**
	 * Install pre-commit hook that blocks commits with sensitive data
	 */
	static async installHook(workspacePath: string): Promise<void> {
		const gitRoot = this.resolveGitRoot(workspacePath);
		if (!gitRoot) {
			throw new Error('Git repository not found. Open the folder that contains the repository root.');
		}

		const gitHooksPath = this.resolveHooksDirectory(gitRoot);
		const hookPath = path.join(gitHooksPath, 'pre-commit');

		if (!fs.existsSync(gitHooksPath)) {
			await fs.promises.mkdir(gitHooksPath, { recursive: true });
		}

		const hookScript = this.generateHookScript();

		try {
			await fs.promises.writeFile(hookPath, hookScript, { mode: 0o755 });
		} catch (error) {
			throw new Error(`Failed to install hook: ${error}`, { cause: error });
		}
	}

	/**
	 * Remove pre-commit hook
	 */
	static async removeHook(workspacePath: string): Promise<void> {
		const gitRoot = this.resolveGitRoot(workspacePath);
		if (!gitRoot) {
			throw new Error('Git repository not found. Open the folder that contains the repository root.');
		}

		const hookPath = path.join(this.resolveHooksDirectory(gitRoot), 'pre-commit');

		try {
			if (!fs.existsSync(hookPath)) {
				return;
			}

			const content = fs.readFileSync(hookPath, 'utf8');
			if (!this.isDotenvyHookContent(content)) {
				throw new Error(
					'A pre-commit hook exists but it was not installed by dotenvy. Remove it manually to avoid deleting another tool\'s hook.'
				);
			}

			await fs.promises.unlink(hookPath);
		} catch (error) {
			if (error instanceof Error && error.message.includes('not installed by dotenvy')) {
				throw error;
			}
			throw new Error(`Failed to remove hook: ${error}`, { cause: error });
		}
	}

	/**
	 * Check if dotenvy hook is installed
	 */
	static isHookInstalled(workspacePath: string): boolean {
		const content = this.readHookContent(workspacePath);
		return content !== null && this.isDotenvyHookContent(content);
	}

	/**
	 * Whether any pre-commit hook file exists (dotenvy or third-party)
	 */
	static hasPreCommitHook(workspacePath: string): boolean {
		return this.readHookContent(workspacePath) !== null;
	}

	static resolveGitRoot(workspacePath: string): string | null {
		try {
			const gitRoot = execSync('git rev-parse --show-toplevel', {
				cwd: workspacePath,
				encoding: 'utf8',
				stdio: ['ignore', 'pipe', 'ignore']
			}).trim();

			return gitRoot || null;
		} catch {
			if (fs.existsSync(path.join(workspacePath, '.git'))) {
				return workspacePath;
			}
			return null;
		}
	}

	static resolveHooksDirectory(gitRoot: string): string {
		try {
			const hooksPath = execSync('git config --get core.hooksPath', {
				cwd: gitRoot,
				encoding: 'utf8',
				stdio: ['ignore', 'pipe', 'ignore']
			}).trim();

			if (hooksPath) {
				return path.isAbsolute(hooksPath) ? hooksPath : path.join(gitRoot, hooksPath);
			}
		} catch {
			// Fall back to default hooks directory
		}

		return path.join(gitRoot, '.git', 'hooks');
	}

	private static readHookContent(workspacePath: string): string | null {
		const gitRoot = this.resolveGitRoot(workspacePath);
		if (!gitRoot) {
			return null;
		}

		const hookPath = path.join(this.resolveHooksDirectory(gitRoot), 'pre-commit');
		if (!fs.existsSync(hookPath)) {
			return null;
		}

		return fs.readFileSync(hookPath, 'utf8');
	}

	private static isDotenvyHookContent(content: string): boolean {
		return content.includes(DOTENVY_HOOK_MARKER) || content.includes('dotenvy-hook');
	}

	/**
	 * Run pre-commit checks on staged files
	 */
	static async runPreCommitChecks(workspacePath: string): Promise<{blocked: boolean, message: string}> {
		const config = await ConfigUtils.readQuickEnvConfig();
		const hookDefaults: GitCommitHookConfig = {
			blockEnvFiles: true,
			blockSecrets: true,
			blockValidationErrors: true
		};
		const hookConfig: GitCommitHookConfig = { ...hookDefaults, ...config?.gitCommitHook };

		const issues: string[] = [];

		try {
			// Get staged files
			const stagedFiles = await this.getStagedFiles(workspacePath);
			const stagedEnvFiles = stagedFiles.filter(file => file.startsWith('.env'));

			// Check 1: Block .env files
			if (hookConfig.blockEnvFiles && stagedEnvFiles.length > 0) {
				issues.push(`🚫 Blocked .env files in commit: ${stagedEnvFiles.join(', ')}\n   Use 'git add --intent-to-add' for templates instead.`);
			}

			// Check 2: Scan for secrets in all files
			if (hookConfig.blockSecrets) {
				for (const file of stagedFiles) {
					const secretsCheck = await this.scanFileForSecrets(workspacePath, file);
					if (secretsCheck.length > 0) {
						issues.push(`🚫 Secrets detected in ${file}:\n   ${secretsCheck.join(', ')}`);
					}
				}
			}

			// Check 3: Validation errors in .env files
			if (hookConfig.blockValidationErrors && stagedEnvFiles.length > 0) {
				const validationRules = await ConfigUtils.getValidationRules();
				if (validationRules) {
					for (const envFile of stagedEnvFiles) {
						const filePath = path.join(workspacePath, envFile);
						if (fs.existsSync(filePath)) {
							const errors = EnvironmentValidator.validateFile(filePath, validationRules);
							if (errors.length > 0) {
								const errorText = EnvironmentValidator.formatErrors(errors);
								issues.push(`🚫 Validation errors in ${envFile}:\n${errorText}`);
							}
						}
					}
				}
			}

		} catch (error) {
			issues.push(`🚫 Hook execution error: ${(error as Error).message}`);
		}

		if (issues.length > 0) {
			const customMessage = hookConfig.customMessage || 'dotenvy commit hook prevented this commit due to security concerns.';
			const message = `${customMessage}\n\n${issues.join('\n\n')}\n\nUse 'git commit --no-verify' to bypass (not recommended).`;

			return { blocked: true, message };
		}

		return { blocked: false, message: 'All checks passed!' };
	}

	/**
	 * Generate the pre-commit hook script
	 */
	private static generateHookScript(): string {
		return `#!/bin/sh
# ${DOTENVY_HOOK_MARKER} - prevents committing sensitive environment data
# Generated by dotenvy VS Code extension

# Get the workspace root (assuming hook is in .git/hooks/)
WORKSPACE_DIR="$(git rev-parse --show-toplevel)"

# Check if Node.js is available
if ! command -v node >/dev/null 2>&1; then
    echo "WARNING: Node.js not found. Skipping dotenvy checks."
    exit 0
fi

# Try to find and run the dotenvy hook
HOOK_SCRIPT=""
if [ -f "$WORKSPACE_DIR/node_modules/.bin/dotenvy-hook" ]; then
    HOOK_SCRIPT="$WORKSPACE_DIR/node_modules/.bin/dotenvy-hook"
elif command -v dotenvy-hook >/dev/null 2>&1; then
    HOOK_SCRIPT="dotenvy-hook"
else
    echo "WARNING: dotenvy-hook script not found. Install dotenvy globally or run 'npm install' in workspace."
    exit 0
fi

# Run the hook
exec "$HOOK_SCRIPT" "$WORKSPACE_DIR"
`.replace(/\r\n/g, '\n'); // Ensure Unix line endings
	}

	/**
	 * Get list of staged files
	 */
	private static async getStagedFiles(workspacePath: string): Promise<string[]> {
		try {
			const gitRoot = this.resolveGitRoot(workspacePath) ?? workspacePath;
			const result = await this.execGitCommand(gitRoot, ['diff', '--cached', '--name-only']);
			return result.split('\n').filter(line => line.trim().length > 0);
		} catch {
			return [];
		}
	}

	/**
	 * Execute a git command
	 */
	private static async execGitCommand(cwd: string, args: string[]): Promise<string> {
		return new Promise((resolve, reject) => {
			const git = spawn('git', args, { cwd });

			let stdout = '';
			let stderr = '';

			git.stdout.on('data', (data: Buffer) => {
				stdout += data.toString();
			});

			git.stderr.on('data', (data: Buffer) => {
				stderr += data.toString();
			});

			git.on('close', (code: number | null) => {
				if (code === 0) {
					resolve(stdout);
				} else {
					reject(new Error(`git command failed: ${stderr}`));
				}
			});

			git.on('error', (error: Error) => {
				reject(error);
			});
		});
	}

	/**
	 * Scan a file for secrets
	 */
	private static async scanFileForSecrets(workspacePath: string, filePath: string): Promise<string[]> {
		try {
			const gitRoot = this.resolveGitRoot(workspacePath) ?? workspacePath;
			const fullPath = path.join(gitRoot, filePath);
			const stats = await fs.promises.stat(fullPath);

			// Skip if file is too large (>1MB) or binary
			if (stats.size > 1024 * 1024) {
				return [];
			}

			const content = await fs.promises.readFile(fullPath, 'utf8');

			// Skip binary files
			if (content.includes('\0')) {
				return [];
			}

			return SecretsGuard.checkFile(fullPath);
		} catch {
			return [];
		}
	}
}

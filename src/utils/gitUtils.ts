import * as vscode from 'vscode';
import * as path from 'path';
import * as cp from 'child_process';

export class GitUtils {
	/**
	 * Get the current git branch name
	 */
	static async getCurrentBranch(rootPath: string): Promise<string | null> {
		try {
			const gitPath = path.join(rootPath, '.git');
			if (!vscode.workspace.fs.stat(vscode.Uri.file(gitPath))) {
				return null; // Not a git repository
			}

			const result = await this.execGitCommand(rootPath, ['rev-parse', '--abbrev-ref', 'HEAD']);
			return result.trim();
		} catch {
			return null;
		}
	}

	/**
	 * Execute a git command and return the output
	 */
	private static async execGitCommand(cwd: string, args: string[]): Promise<string> {
		return new Promise((resolve, reject) => {
			const git = cp.spawn('git', args, { cwd });

			let stdout = '';
			let stderr = '';

			git.stdout.on('data', (data) => {
				stdout += data.toString();
			});

			git.stderr.on('data', (data) => {
				stderr += data.toString();
			});

			git.on('close', (code) => {
				if (code === 0) {
					resolve(stdout);
				} else {
					reject(new Error(`git command failed: ${stderr}`));
				}
			});

			git.on('error', (error) => {
				reject(error);
			});
		});
	}

	/**
	 * Check if the workspace is a git repository
	 */
	static async isGitRepository(rootPath: string): Promise<boolean> {
		try {
			await this.getCurrentBranch(rootPath);
			return true;
		} catch {
			return false;
		}
	}
}

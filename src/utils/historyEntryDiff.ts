/**
 * Git attribution and blame for a new environment history snapshot.
 */

import * as fs from 'fs';
import * as os from 'os';
import { execSync } from 'child_process';
import { EnvDiff, EnvironmentDiffer } from './environmentDiffer';
import { HistoryManager } from './historyManager';
import { logger } from './logger';

/**
 * Reads the git user and HEAD commit for a workspace, when git is available.
 */
export async function readHistoryGitInfo(rootPath: string): Promise<{ user?: string; commitHash?: string }> {
    try {
        let user: string | undefined;
        try {
            user = execSync('git config user.name', { cwd: rootPath, encoding: 'utf8' }).trim();
        } catch (error) {
            // Git user not configured
        }

        let commitHash: string | undefined;
        try {
            commitHash = execSync('git rev-parse HEAD', { cwd: rootPath, encoding: 'utf8' }).trim();
        } catch (error) {
            // Not in a git repository or no commits
        }

        return { user, commitHash };
    } catch (error) {
        return {};
    }
}

/**
 * Diffs new environment content against the latest history entry and attaches blame.
 */
export async function calculateHistoryDiffWithBlame(rootPath: string, newContent: string): Promise<EnvDiff | null> {
    try {
        const recentEntries = await HistoryManager.getHistory(rootPath, 1);
        const previousEntry = recentEntries[0];

        if (!previousEntry) {
            return null;
        }

        const tempDir = os.tmpdir();
        const tempOldFile = `${tempDir}/dotenvy-diff-old-${Date.now()}.env`;
        const tempNewFile = `${tempDir}/dotenvy-diff-new-${Date.now()}.env`;

        try {
            fs.writeFileSync(tempOldFile, previousEntry.fileContent);
            fs.writeFileSync(tempNewFile, newContent);

            const diff = EnvironmentDiffer.compareFiles(tempOldFile, tempNewFile);

            for (const change of diff.changed) {
                change.blame = {
                    user: previousEntry.user,
                    timestamp: previousEntry.timestamp,
                    commitHash: previousEntry.commitHash
                };
            }

            return diff;
        } finally {
            try {
                if (fs.existsSync(tempOldFile)) fs.unlinkSync(tempOldFile);
                if (fs.existsSync(tempNewFile)) fs.unlinkSync(tempNewFile);
            } catch (error) {
                // Ignore cleanup errors
            }
        }
    } catch (error) {
        logger.error('Failed to calculate diff with blame:', error, 'HistoryManager');
        return null;
    }
}

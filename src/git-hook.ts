#!/usr/bin/env node

import { GitHookManager } from './utils/gitHookManager';

/**
 * CLI entry point for the dotenvy git pre-commit hook
 * Usage: dotenvy-hook /path/to/workspace
 */
async function main(): Promise<void> {
    const args = process.argv.slice(2);

    if (args.length !== 1) {
        console.error('Usage: dotenvy-hook <workspace-path>');
        process.exit(1);
    }

    const workspacePath = args[0];

    try {
        const result = await GitHookManager.runPreCommitChecks(workspacePath);

        if (result.blocked) {
            console.error(result.message);
            process.exit(1);
        } else {
            console.log(result.message);
            process.exit(0);
        }
    } catch (error) {
        console.error(`Hook execution failed: ${error}`);
        process.exit(1);
    }
}

main().catch((error) => {
    console.error(`Unexpected error: ${error}`);
    process.exit(1);
});

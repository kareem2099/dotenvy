/**
 * Debounced workspace file watcher that scans changed files for secrets.
 */

import * as vscode from 'vscode';
import * as path from 'path';
import { DetectedSecret } from './secretScannerTypes';
import { PatternRegistry } from './patternRegistry';
import { CacheManager } from './cacheManager';
import { DotenvyIgnore } from './dotenvyIgnore';
import { SecretDetector } from './secretDetector';
import { logger } from './logger';
import { t } from '../i18n';

const DEBOUNCE_DELAY = 1000;
let fileWatcher: vscode.FileSystemWatcher | undefined;
const debounceTimers = new Map<string, NodeJS.Timeout>();
let isFileWatcherActive = false;
const activeScanPromises = new Map<string, Promise<void>>();

function clearDebounceTimer(filePath: string): void {
    const timer = debounceTimers.get(filePath);
    if (timer) {
        clearTimeout(timer);
        debounceTimers.delete(filePath);
    }
}

async function performFileScan(
    filePath: string,
    onSecretsFound?: (secrets: DetectedSecret[]) => void
): Promise<void> {
    logger.info(`🔍 Scanning changed file: ${path.basename(filePath)}`, 'SecretDetector');

    CacheManager.invalidateFileCache(filePath);

    const secrets = await SecretDetector.scanFile(filePath);

    if (secrets.length > 0) {
        logger.info(`⚠️  Found ${secrets.length} potential secret(s) in ${path.basename(filePath)}`, 'SecretDetector');

        if (onSecretsFound) {
            onSecretsFound(secrets);
        } else {
            vscode.window.showWarningMessage(
                t('secretDetector.foundInFile', { count: secrets.length, fileName: path.basename(filePath) }),
                t('secretDetector.review')
            ).then(selection => {
                if (selection === t('secretDetector.review')) {
                    logger.info('Secrets found:', 'SecretDetector');
                }
            });
        }
    }
}

function debounceFileScan(filePath: string, onSecretsFound?: (secrets: DetectedSecret[]) => void): void {
    clearDebounceTimer(filePath);

    const timer = setTimeout(async () => {
        try {
            debounceTimers.delete(filePath);

            const activeScan = activeScanPromises.get(filePath);
            if (activeScan) {
                await activeScan;
                return;
            }

            const scanPromise = performFileScan(filePath, onSecretsFound);
            activeScanPromises.set(filePath, scanPromise);

            await scanPromise;
            activeScanPromises.delete(filePath);

        } catch (error) {
            logger.error(`Error scanning file ${filePath}:`, error, 'SecretDetector');
            activeScanPromises.delete(filePath);
        }
    }, DEBOUNCE_DELAY);

    debounceTimers.set(filePath, timer);
}

function shouldWatchPath(filePath: string, rootPath: string): boolean {
    if (!PatternRegistry.shouldScanFile(filePath, rootPath)) {
        return false;
    }
    if (DotenvyIgnore.shouldIgnore(filePath, rootPath)) {
        return false;
    }
    return true;
}

/**
 * Starts real-time file monitoring with debounced secret scanning.
 */
export function startSecretFileWatcher(onSecretsFound?: (secrets: DetectedSecret[]) => void): void {
    if (isFileWatcherActive) {
        return;
    }

    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) {
        return;
    }

    fileWatcher = vscode.workspace.createFileSystemWatcher(
        '**/*',
        false,
        false,
        false
    );

    fileWatcher.onDidChange(async (uri) => {
        if (uri.scheme !== 'file') return;

        const filePath = uri.fsPath;
        const rootPath = workspaceFolders[0].uri.fsPath;
        if (!shouldWatchPath(filePath, rootPath)) {
            return;
        }

        debounceFileScan(filePath, onSecretsFound);
    });

    fileWatcher.onDidCreate(async (uri) => {
        if (uri.scheme !== 'file') return;

        const filePath = uri.fsPath;
        const rootPath = workspaceFolders[0].uri.fsPath;
        if (!shouldWatchPath(filePath, rootPath)) {
            return;
        }

        debounceFileScan(filePath, onSecretsFound);
    });

    fileWatcher.onDidDelete((uri) => {
        if (uri.scheme !== 'file') return;

        const filePath = uri.fsPath;
        CacheManager.invalidateFileCache(filePath);
        clearDebounceTimer(filePath);
        activeScanPromises.delete(filePath);

        logger.info(`🗑️  File deleted - ${path.basename(filePath)}`, 'SecretDetector');
    });

    isFileWatcherActive = true;
    logger.info('🔍 Real-time secret monitoring started', 'SecretDetector');
}

/**
 * Stops file monitoring and clears pending scans.
 */
export function stopSecretFileWatcher(): void {
    try {
        if (fileWatcher) {
            fileWatcher.dispose();
            fileWatcher = undefined;
        }

        debounceTimers.forEach((timer) => clearTimeout(timer));
        debounceTimers.clear();
        activeScanPromises.clear();

        isFileWatcherActive = false;
        logger.info('🛑 Real-time secret monitoring stopped', 'SecretDetector');
    } catch (error) {
        logger.error('Error stopping file watcher:', error, 'SecretDetector');
        fileWatcher = undefined;
        debounceTimers.clear();
        activeScanPromises.clear();
        isFileWatcherActive = false;
    }
}

/**
 * Returns whether the secret file watcher is currently active.
 */
export function isSecretFileWatcherActive(): boolean {
    return isFileWatcherActive;
}

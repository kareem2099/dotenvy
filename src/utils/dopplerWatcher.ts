import * as vscode from 'vscode';
import { ConfigUtils } from './configUtils';
import { DopplerSyncManager } from './dopplerSyncManager';
import { EnvSyncUtils } from './envSyncUtils';
import { logger } from './logger';

export interface DopplerUpdateState {
    hasUpdates: boolean;
    /** Total number of changes detected (added + changed + removed) */
    totalChanges: number;
    added: number;
    changed: number;
    removed: number;
    lastChecked?: Date;
    error?: string;
}

type Listener = (state: DopplerUpdateState) => void;

/**
 * Polls Doppler in the background and notifies listeners when the remote
 * secrets diverge from the local env files.
 *
 * A single instance per workspace root is managed by DopplerWatcherRegistry.
 */
export class DopplerWatcher implements vscode.Disposable {
    private readonly rootPath: string;
    private intervalHandle?: NodeJS.Timeout;
    private readonly listeners: Set<Listener> = new Set();
    private currentState: DopplerUpdateState = {
        hasUpdates: false,
        totalChanges: 0,
        added: 0,
        changed: 0,
        removed: 0,
    };
    /** Avoid launching concurrent checks */
    private checking = false;

    constructor(rootPath: string, intervalMs = 5 * 60 * 1000) {
        this.rootPath = rootPath;
        // Check immediately on construction (non-blocking)
        void this.check();
        this.intervalHandle = setInterval(() => { void this.check(); }, intervalMs);
        this.intervalHandle.unref?.();
    }

    // ── Subscription ──────────────────────────────────────────────────────────

    public onDidChangeState(listener: Listener): vscode.Disposable {
        this.listeners.add(listener);
        return { dispose: () => { this.listeners.delete(listener); } };
    }

    public getState(): DopplerUpdateState {
        return { ...this.currentState };
    }

    // ── Core check ────────────────────────────────────────────────────────────

    public async check(): Promise<void> {
        if (this.checking) return;
        this.checking = true;
        try {
            const next = await this.fetchUpdateState();
            this.emit(next);
        } finally {
            this.checking = false;
        }
    }

    private async fetchUpdateState(): Promise<DopplerUpdateState> {
        const base: DopplerUpdateState = {
            hasUpdates: false,
            totalChanges: 0,
            added: 0,
            changed: 0,
            removed: 0,
            lastChecked: new Date(),
        };

        try {
            const config = await ConfigUtils.readQuickEnvConfig(this.rootPath);
            if (!config?.cloudSync || config.cloudSync.provider !== 'doppler' ||
                !config.cloudSync.project || !config.cloudSync.config) {
                return base; // Not connected to Doppler — nothing to watch
            }

            const syncConfig = config.cloudSync;
            const manager = new DopplerSyncManager(syncConfig);

            // Lightweight ping first — avoids downloading secrets on auth failure
            const connection = await manager.testConnection();
            if (!connection.success) {
                return { ...base, error: connection.error };
            }

            // Fetch remote secrets
            const result = await manager.fetchSecrets();
            if (!result.success || !result.secrets) {
                return { ...base, error: result.error };
            }

            const secrets = EnvSyncUtils.filterCloudMetadataKeys(
                EnvSyncUtils.filterDopplerReservedKeys(result.secrets)
            );

            const targets = await EnvSyncUtils.resolveSyncTargets(
                this.rootPath, syncConfig.config, config
            );
            if (targets.length === 0) {
                return base;
            }

            const summary = EnvSyncUtils.calculatePullChanges(targets, secrets);

            return {
                hasUpdates: summary.totalChanges > 0,
                totalChanges: summary.totalChanges,
                added: summary.newKeys.length,
                changed: summary.changedKeys.length,
                removed: summary.removedKeys.length,
                lastChecked: new Date(),
            };
        } catch (error) {
            logger.warn(`DopplerWatcher: check failed for ${this.rootPath}: ${(error as Error).message}`, 'DopplerWatcher');
            return { ...base, error: (error as Error).message };
        }
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    private emit(next: DopplerUpdateState): void {
        const prev = this.currentState;
        this.currentState = next;
        if (next.hasUpdates !== prev.hasUpdates ||
            next.totalChanges !== prev.totalChanges ||
            next.error !== prev.error) {
            for (const fn of this.listeners) {
                try { fn(next); } catch { /* listener errors must not break the watcher */ }
            }
        }
    }

    // ── Disposable ────────────────────────────────────────────────────────────

    public dispose(): void {
        if (this.intervalHandle) {
            clearInterval(this.intervalHandle);
            this.intervalHandle = undefined;
        }
        this.listeners.clear();
    }
}

/**
 * Singleton registry — one DopplerWatcher per workspace root.
 */
export class DopplerWatcherRegistry {
    private static readonly watchers = new Map<string, DopplerWatcher>();

    static getOrCreate(rootPath: string, intervalMs?: number): DopplerWatcher {
        const existing = this.watchers.get(rootPath);
        if (existing) return existing;
        const watcher = new DopplerWatcher(rootPath, intervalMs);
        this.watchers.set(rootPath, watcher);
        return watcher;
    }

    static get(rootPath: string): DopplerWatcher | undefined {
        return this.watchers.get(rootPath);
    }

    static remove(rootPath: string): void {
        const watcher = this.watchers.get(rootPath);
        if (watcher) {
            watcher.dispose();
            this.watchers.delete(rootPath);
        }
    }

    static disposeAll(): void {
        for (const [, watcher] of this.watchers) {
            watcher.dispose();
        }
        this.watchers.clear();
    }
}

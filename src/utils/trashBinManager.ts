/**
 * TrashBinManager — in-memory session-scoped store for deleted / modified variables.
 * Populated by VariableWebviewProvider.saveVariables() when a delete/edit is detected.
 * Cleared on VS Code restart (intentional — persistent rollbacks live in HistoryManager).
 */

export interface TrashBinEntry {
    id: string;
    timestamp: Date;
    key: string;
    oldValue: string;
    /** undefined = variable was deleted; defined = variable was modified */
    newValue?: string;
    environmentFile: string;   // e.g. ".env.local"
    workspacePath: string;
    type: 'deleted' | 'modified';
}

export class TrashBinManager {
    private static _instance: TrashBinManager | null = null;
    private _entries: TrashBinEntry[] = [];
    private _listeners: Array<() => void> = [];

    private constructor() {
        // Private constructor for singleton pattern
    }

    public static getInstance(): TrashBinManager {
        if (!TrashBinManager._instance) {
            TrashBinManager._instance = new TrashBinManager();
        }
        return TrashBinManager._instance;
    }

    // ─── Write ───────────────────────────────────────────────────────────────

    /** Push a new entry into the trash bin. */
    public push(entry: Omit<TrashBinEntry, 'id' | 'timestamp'>): TrashBinEntry {
        const full: TrashBinEntry = {
            ...entry,
            id: `tb-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            timestamp: new Date(),
        };
        this._entries.unshift(full); // newest first
        this._notify();
        return full;
    }

    /** Remove one entry by id (after Restore). */
    public remove(id: string): boolean {
        const before = this._entries.length;
        this._entries = this._entries.filter(e => e.id !== id);
        if (this._entries.length !== before) {
            this._notify();
            return true;
        }
        return false;
    }

    /** Wipe all entries for a given workspace. */
    public clearWorkspace(workspacePath: string): void {
        this._entries = this._entries.filter(e => e.workspacePath !== workspacePath);
        this._notify();
    }

    /** Wipe everything. */
    public clearAll(): void {
        this._entries = [];
        this._notify();
    }

    // ─── Read ────────────────────────────────────────────────────────────────

    public getAll(): TrashBinEntry[] {
        return [...this._entries];
    }

    public getForWorkspace(workspacePath: string): TrashBinEntry[] {
        return this._entries.filter(e => e.workspacePath === workspacePath);
    }

    public count(): number {
        return this._entries.length;
    }

    // ─── Listeners (for webview refresh) ────────────────────────────────────

    public onDidChange(listener: () => void): { dispose: () => void } {
        this._listeners.push(listener);
        return { dispose: () => { this._listeners = this._listeners.filter(l => l !== listener); } };
    }

    private _notify(): void {
        this._listeners.forEach(l => l());
    }
}

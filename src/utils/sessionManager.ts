import * as vscode from 'vscode';

export class SessionManager {
    private static instance: SessionManager;
    private projectKey: Buffer | null = null;
    private currentUser: string | null = null;

    public static getInstance(): SessionManager {
        if (!SessionManager.instance) {
            SessionManager.instance = new SessionManager();
        }
        return SessionManager.instance;
    }

    /**
     * Store the decrypted project key in memory
     */
    public setSession(username: string, key: Buffer) {
        this.currentUser = username;
        this.projectKey = key;
        vscode.commands.executeCommand('setContext', 'dotenvy.isLoggedIn', true);
    }

    /**
     * Get the project key to decrypt files
     */
    public getProjectKey(): Buffer | null {
        return this.projectKey;
    }

    /**
     * Check if a valid session exists
     */
    public isLoggedIn(): boolean {
        return this.projectKey !== null;
    }

    /**
     * Get current logged-in username
     */
    public getCurrentUser(): string | null {
        return this.currentUser;
    }

    /**
     * Clear session (Logout)
     */
    public logout() {
        this.projectKey = null;
        this.currentUser = null;
        vscode.commands.executeCommand('setContext', 'dotenvy.isLoggedIn', false);
    }
}

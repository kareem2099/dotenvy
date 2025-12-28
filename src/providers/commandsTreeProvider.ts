import * as vscode from 'vscode';

interface CommandInfo {
    command: string;
    title: string;
    category: string;
    keybinding?: string;
    description: string;
}

export class CommandsTreeProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<vscode.TreeItem | undefined | void> = new vscode.EventEmitter<vscode.TreeItem | undefined | void>();
    readonly onDidChangeTreeData: vscode.Event<vscode.TreeItem | undefined | void> = this._onDidChangeTreeData.event;

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
        return element;
    }

    async getChildren(element?: vscode.TreeItem): Promise<vscode.TreeItem[]> {
        if (!element) {
            // Root level - show all commands
            return this.getAllCommands().map(cmd => new CommandItem(cmd));
        }

        return [];
    }

    private getAllCommands(): CommandInfo[] {
        return [
            {
                command: 'dotenvy.openEnvironmentPanel',
                title: 'Open Environment Panel',
                category: 'DotEnvy',
                keybinding: 'Ctrl+Shift+E (Cmd+Shift+E on Mac)',
                description: 'Opens the main environment management panel to view and edit environment variables'
            },
            {
                command: 'dotenvy.validateEnvironment',
                title: 'Validate Environment',
                category: 'DotEnvy',
                keybinding: 'Ctrl+Shift+V (Cmd+Shift+V on Mac)',
                description: 'Validates the current environment file for syntax errors and missing variables'
            },
            {
                command: 'dotenvy.diffEnvironment',
                title: 'Diff Environment',
                category: 'DotEnvy',
                keybinding: 'Ctrl+Shift+D (Cmd+Shift+D on Mac)',
                description: 'Shows differences between current environment and another environment file'
            },
            {
                command: 'dotenvy.scanSecrets',
                title: 'Scan Secrets',
                category: 'DotEnvy',
                keybinding: 'Ctrl+Shift+S (Cmd+Shift+S on Mac)',
                description: 'Scans environment files for potential secrets and security issues'
            },
            {
                command: 'dotenvy.installGitHook',
                title: 'Install Git Hook',
                category: 'DotEnvy',
                description: 'Installs a git hook to automatically validate environment files before commits'
            },
            {
                command: 'dotenvy.removeGitHook',
                title: 'Remove Git Hook',
                category: 'DotEnvy',
                description: 'Removes the installed git hook for environment validation'
            },
            {
                command: 'dotenvy.pullFromCloud',
                title: 'Pull from Cloud',
                category: 'DotEnvy',
                description: 'Pulls environment variables from cloud storage (requires configuration)'
            },
            {
                command: 'dotenvy.pushToCloud',
                title: 'Push to Cloud',
                category: 'DotEnvy',
                description: 'Pushes environment variables to cloud storage (requires configuration)'
            },
            {
                command: 'dotenvy.feedback',
                title: 'Feedback',
                category: 'DotEnvy',
                description: 'Opens feedback form to report issues or suggest improvements'
            },
            {
                command: 'dotenvy.viewEnvironmentHistory',
                title: 'View Environment History',
                category: 'DotEnvy',
                description: 'Opens the environment history viewer to see past changes'
            },
            {
                command: 'dotenvy.initSecureProject',
                title: 'Init Secure Project',
                category: 'DotEnvy',
                description: 'Initialize a new secure project with multi-user key wrapping encryption'
            },
            {
                command: 'dotenvy.addUser',
                title: 'Add User to Secure Project',
                category: 'DotEnvy',
                description: 'Add a new developer to the secure project with individual access credentials'
            },
            {
                command: 'dotenvy.revokeUser',
                title: 'Revoke User Access',
                category: 'DotEnvy',
                description: 'Remove a user\'s access to the secure project environment'
            },
            {
                command: 'dotenvy.loginToSecureProject',
                title: 'Login to Secure Project',
                category: 'DotEnvy',
                description: 'Authenticate and unlock the secure project environment'
            }
        ];
    }
}

class CommandItem extends vscode.TreeItem {
    constructor(public readonly commandInfo: CommandInfo) {
        super(commandInfo.title, vscode.TreeItemCollapsibleState.None);
        this.tooltip = `${commandInfo.description}${commandInfo.keybinding ? `\n\nShortcut: ${commandInfo.keybinding}` : ''}`;
        this.iconPath = new vscode.ThemeIcon('tools');
        this.description = commandInfo.keybinding || '';

        // Add command to execute when clicked
        this.command = {
            command: commandInfo.command,
            title: commandInfo.title
        };
    }
}

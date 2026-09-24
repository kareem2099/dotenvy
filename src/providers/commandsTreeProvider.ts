import * as vscode from 'vscode';
import { t } from '../i18n';

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
                command: 'dotenvy.initSecureProject',
                title: t('tree.initSecure.title'),
                category: 'DotEnvy',
                description: t('tree.initSecure.desc')
            },
            {
                command: 'dotenvy.initDotenvyIgnore',
                title: t('tree.initIgnore.title'),
                category: 'DotEnvy',
                description: t('tree.initIgnore.desc')
            },
            {
                command: 'dotenvy.loginToSecureProject',
                title: t('tree.login.title'),
                category: 'DotEnvy',
                description: t('tree.login.desc')
            },
            {
                command: 'dotenvy.openEnvironmentPanel',
                title: t('tree.openPanel.title'),
                category: 'DotEnvy',
                keybinding: 'Ctrl+Shift+E (Cmd+Shift+E on Mac)',
                description: t('tree.openPanel.desc')
            },
            {
                command: 'dotenvy.validateEnvironment',
                title: t('tree.validate.title'),
                category: 'DotEnvy',
                keybinding: 'Ctrl+Shift+V (Cmd+Shift+V on Mac)',
                description: t('tree.validate.desc')
            },
            {
                command: 'dotenvy.diffEnvironment',
                title: t('tree.diff.title'),
                category: 'DotEnvy',
                keybinding: 'Ctrl+Shift+D (Cmd+Shift+D on Mac)',
                description: t('tree.diff.desc')
            },
            {
                command: 'dotenvy.scanSecrets',
                title: t('tree.scan.title'),
                category: 'DotEnvy',
                keybinding: 'Ctrl+Shift+S (Cmd+Shift+S on Mac)',
                description: t('tree.scan.desc')
            },
            {
                command: 'dotenvy.installGitHook',
                title: t('tree.installHook.title'),
                category: 'DotEnvy',
                description: t('tree.installHook.desc')
            },
            {
                command: 'dotenvy.removeGitHook',
                title: t('tree.removeHook.title'),
                category: 'DotEnvy',
                description: t('tree.removeHook.desc')
            },
            {
                command: 'dotenvy.pullFromCloud',
                title: t('tree.pull.title'),
                category: 'DotEnvy',
                description: t('tree.pull.desc')
            },
            {
                command: 'dotenvy.pushToCloud',
                title: t('tree.push.title'),
                category: 'DotEnvy',
                description: t('tree.push.desc')
            },
            {
                command: 'dotenvy.feedback',
                title: t('tree.feedback.title'),
                category: 'DotEnvy',
                description: t('tree.feedback.desc')
            },
            {
                command: 'dotenvy.viewEnvironmentHistory',
                title: t('tree.history.title'),
                category: 'DotEnvy',
                description: t('tree.history.desc')
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

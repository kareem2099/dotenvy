import * as vscode from 'vscode';
import { EnvironmentProvider } from '../providers/environmentProvider';
import { Environment } from '../types/environment';

export class EnvironmentTreeProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<vscode.TreeItem | undefined | void> = new vscode.EventEmitter<vscode.TreeItem | undefined | void>();
    readonly onDidChangeTreeData: vscode.Event<vscode.TreeItem | undefined | void> = this._onDidChangeTreeData.event;
    private cachedEnvironments: vscode.TreeItem[] | null = null;

    constructor(private workspaceRoot: string) {}

    refresh(): void {
        this.cachedEnvironments = null; // Clear cache on refresh
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
        return element;
    }

    async getChildren(element?: vscode.TreeItem): Promise<vscode.TreeItem[]> {
        if (!element) {
            // Check if workspace is open
            if (!vscode.workspace.workspaceFolders) {
                // No workspace - show welcome item
                return [new WelcomeItem()];
            }

            // Return cached environments if available
            if (this.cachedEnvironments) {
                return this.cachedEnvironments;
            }

            // Root level - show all environments
            const provider = new EnvironmentProvider(this.workspaceRoot);
            const environments = await provider.getEnvironments();

            this.cachedEnvironments = environments.map(env => new EnvironmentItem(
                env.name,
                env.fileName,
                vscode.TreeItemCollapsibleState.None,
                env
            ));

            return this.cachedEnvironments;
        }

        return [];
    }
}

class EnvironmentItem extends vscode.TreeItem {
    constructor(
        public readonly label: string,
        public readonly tooltip: string,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState,
        public readonly environment: Environment
    ) {
        super(label, collapsibleState);
        this.tooltip = tooltip;
        this.iconPath = new vscode.ThemeIcon('settings-gear');

        // Add command to open the panel when clicked
        this.command = {
            command: 'dotenvy.openEnvironmentPanel',
            title: 'Open Environment Panel',
            arguments: [environment]
        };
    }
}

class WelcomeItem extends vscode.TreeItem {
    constructor() {
        super('Open Environment Manager', vscode.TreeItemCollapsibleState.None);
        this.tooltip = 'Click to open the Environment Manager panel';
        this.iconPath = new vscode.ThemeIcon('rocket');

        // Add command to open the panel when clicked
        this.command = {
            command: 'dotenvy.openEnvironmentPanel',
            title: 'Open Environment Panel'
        };
    }
}

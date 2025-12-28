import * as vscode from 'vscode';
import { EXTENSION_VERSION_KEY } from '../constants';

export class UpdateManager {
    private static readonly VERSION_KEY = EXTENSION_VERSION_KEY;

    public static async checkNewVersion(context: vscode.ExtensionContext) {
        try {
            const extensionId = context.extension.id;
            const extension = vscode.extensions.getExtension(extensionId);

            if (!extension) return;

            const currentVersion = extension.packageJSON.version;
            const previousVersion = context.globalState.get<string>(this.VERSION_KEY);

            if (currentVersion !== previousVersion) {
                await context.globalState.update(this.VERSION_KEY, currentVersion);

                if (!previousVersion) {
                    this.showWelcomeMessage();
                } else {
                    // نمرر الـ context هنا
                    this.showUpdateNotification(currentVersion, context);
                }
            }
        } catch (error) {
            console.error('Failed to check for updates:', error);
        }
    }

    private static async showUpdateNotification(version: string, context: vscode.ExtensionContext) {
        const action = 'See What\'s New';
        const message = `DotEnvy updated to v${version}! 🚀 Check out the new features (Encryption V2 & Cloud Sync).`;

        const result = await vscode.window.showInformationMessage(message, action);

        if (result === action) {
            await this.showChangelog(context);
        }
    }

    private static showWelcomeMessage() {
        vscode.window.showInformationMessage('Welcome to DotEnvy! 🛡️ The best way to manage your .env files.');
    }

    // نستقبل الـ context عشان نجيب مسار الامتداد صح
    public static async showChangelog(context: vscode.ExtensionContext) {
        // ✅ الطريقة الآمنة للوصول للملف في الروت
        const changelogUri = vscode.Uri.joinPath(context.extensionUri, 'CHANGELOG.md');

        try {
            await vscode.commands.executeCommand('markdown.showPreview', changelogUri);
        } catch (e) {
            const doc = await vscode.workspace.openTextDocument(changelogUri);
            await vscode.window.showTextDocument(doc);
        }
    }
}

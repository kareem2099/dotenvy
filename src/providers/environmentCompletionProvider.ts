import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { EnvironmentProvider } from './environmentProvider';
import { EncryptedVarsManager } from '../utils/encryptedVars';

interface EnvVar {
    name: string;
    value: string;
    encrypted: boolean;
    description?: string;
}

export class EnvironmentCompletionProvider implements vscode.CompletionItemProvider {
    private environmentProvider: EnvironmentProvider;
    private rootPath: string;
    // Cache variables here
    private cachedVariables: EnvVar[] = [];
    // 🗑️ شلنا lastEnvPath لأنه كان مسبب زحمة ومش مستخدم حالياً
    private watcher: vscode.FileSystemWatcher | undefined;

    constructor(rootPath: string) {
        this.rootPath = rootPath;
        this.environmentProvider = new EnvironmentProvider(rootPath);
        
        // Initial load
        this.refreshVariables();

        // Watch for changes in .env files to update cache
        this.watcher = vscode.workspace.createFileSystemWatcher('**/.env*');
        this.watcher.onDidChange(() => this.refreshVariables());
        this.watcher.onDidCreate(() => this.refreshVariables());
        this.watcher.onDidDelete(() => this.refreshVariables());
    }

    // ✅ التعديل الجوهري: شلنا token و context من هنا خالص
    async provideCompletionItems(
        document: vscode.TextDocument,
        position: vscode.Position
    ): Promise<vscode.CompletionItem[] | null> {
        
        if (!this.isSupportedLanguage(document.languageId)) {
            return null;
        }

        const lineText = document.lineAt(position.line).text.substring(0, position.character);
        
        // Regex tweak: Allow spaces like "process . env ." just in case
        const processEnvMatch = lineText.match(/(process\s*\.\s*env\.|import\s*\.\s*meta\s*\.\s*env\.)([a-zA-Z0-9_]*)$/);
        
        if (!processEnvMatch) {
            return null;
        }

        const partialVariable = processEnvMatch[2] || '';

        // Use Cached Variables directly (Zero Latency!) 🚀
        const filteredVariables = this.cachedVariables.filter(variable => 
            variable.name.toLowerCase().includes(partialVariable.toLowerCase())
        );

        return filteredVariables.map(variable => {
            const item = new vscode.CompletionItem(variable.name, vscode.CompletionItemKind.Variable);
            item.insertText = variable.name;
            
            // Show value in the detail (Preview)
            const valuePreview = variable.encrypted ? '🔒 *Encrypted Value*' : `\`${variable.value}\``;
            
            item.detail = variable.encrypted ? 'Encrypted Variable' : variable.value;
            
            // Markdown Documentation
            const doc = new vscode.MarkdownString();
            doc.appendMarkdown(`**Key:** \`${variable.name}\`\n\n`);
            doc.appendMarkdown(`**Value:** ${valuePreview}\n\n`);
            if (variable.description) {
                doc.appendMarkdown(`---\n*${variable.description}*`);
            }
            item.documentation = doc;

            // Sort: Put exact matches first
            item.sortText = variable.name.startsWith(partialVariable) ? '0' : '1';

            return item;
        });
    }

    // Load variables into memory (Async)
    private async refreshVariables() {
        try {
            const currentEnv = await this.environmentProvider.getCurrentEnvironment();
            const envFilePath = currentEnv ? currentEnv.filePath : path.join(this.rootPath, '.env');
            
            if (!fs.existsSync(envFilePath)) {
                this.cachedVariables = [];
                return;
            }

            const content = await fs.promises.readFile(envFilePath, 'utf8'); // Use Async fs
            this.cachedVariables = this.parseEnvContent(content);
            // console.log('Environment variables cached:', this.cachedVariables.length); // شيلنا الـ log عشان الـ production

        } catch (error) {
            console.error('Error refreshing env variables:', error);
        }
    }

    private parseEnvContent(content: string): EnvVar[] {
        const variables: EnvVar[] = [];
        const lines = content.split('\n');
        let currentComment = '';

        for (const line of lines) {
            const trimmedLine = line.trim();
            if (!trimmedLine) continue;

            if (trimmedLine.startsWith('#')) {
                currentComment = trimmedLine.substring(1).trim();
                continue;
            }

            const eqIndex = trimmedLine.indexOf('=');
            if (eqIndex === -1) continue;

            const key = trimmedLine.substring(0, eqIndex).trim();
            let value = trimmedLine.substring(eqIndex + 1).trim();

            // Basic Quote Handling (Remove surrounding "" or '')
            if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
                value = value.slice(1, -1);
            }

            if (!key) continue;

            variables.push({
                name: key,
                value: value,
                encrypted: EncryptedVarsManager.isEncrypted(value),
                description: currentComment || undefined
            });

            currentComment = '';
        }
        return variables;
    }

    private isSupportedLanguage(languageId: string): boolean {
        return [
            'javascript', 'typescript', 'javascriptreact', 'typescriptreact',
            'vue', 'svelte', 'astro', 'html', 'json', 'jsonc', 'go', 'python', 'rust' 
        ].includes(languageId);
    }
    
    // Clean up watcher when extension is deactivated
    public dispose() {
        if (this.watcher) {
            this.watcher.dispose();
        }
    }
}
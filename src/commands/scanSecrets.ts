import * as vscode from 'vscode';
import * as path from 'path';
import { SecretScanner, DetectedSecret } from '../utils/secretScanner';

export class ScanSecretsCommand implements vscode.Disposable {
    private trackedSecrets = new Map<string, DetectedSecret[]>();

    public async execute(): Promise<void> {
        const secrets = await vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: '🔍 Scanning for secrets with AI...',
                cancellable: true
            },
            async (progress, token) => {
                progress.report({ increment: 0, message: '🤖 Initializing intelligent scan...' });

                // Use enhanced scanning with progress tracking
                return await SecretScanner.scanWorkspaceEnhanced((scanProgress) => {
                    const remainingMinutes = Math.ceil(scanProgress.estimatedTimeRemaining / 60000);
                    const message = `🔍 Scanning: ${scanProgress.currentFile} (${scanProgress.percentage.toFixed(1)}%) - ${remainingMinutes}min remaining`;

                    progress.report({
                        increment: scanProgress.percentage / 100,
                        message: message
                    });

                    // Check for cancellation
                    if (token.isCancellationRequested) {
                        throw new Error('Scan cancelled by user');
                    }
                });
            }
        );

        if (secrets.length === 0) {
            vscode.window.showInformationMessage('✅ No secrets detected in your codebase!');
            return;
        }

        this.trackedSecrets.clear();
        let notified = 0;

        for (const secret of secrets) {
            if (notified >= 5) {
                break;
            }

            await this.notifySecret(secret);
            notified++;

            const key = `${secret.file}:${secret.line}`;
            if (!this.trackedSecrets.has(key)) {
                this.trackedSecrets.set(key, []);
            }
            const secretList = this.trackedSecrets.get(key);
            if (secretList) {
                secretList.push(secret);
            }
        }

        if (secrets.length > notified) {
            vscode.window.showWarningMessage(
                `⚠️ Found ${secrets.length - notified} more secrets. Use "Scan for Secrets" to review all.`
            );
        }
    }

    private async notifySecret(secret: DetectedSecret): Promise<void> {
        // Skip if already migrated to env var
        if (this.isAlreadyMigrated(secret.content)) {
            return;
        }

        const confidenceIcon = secret.confidence === 'high' ? '⚠️' : secret.confidence === 'medium' ? '⚡' : 'ℹ️';
        const message = `${confidenceIcon} Potential ${secret.type} detected in ${secret.file}:${secret.line}`;

        const result = await vscode.window.showWarningMessage(
            message,
            { modal: false, detail: `Content: ${secret.content}\nSuggested env var: ${secret.suggestedEnvVar}` },
            'Move to .env',
            'View Location',
            'Ignore'
        );

        switch (result) {
            case 'Move to .env':
                await this.migrateSecret(secret);
                break;

            case 'View Location':
                await this.showSecretLocation(secret);
                break;

            case 'Ignore':
                break;
        }
    }

    private isAlreadyMigrated(content: string): boolean {
        // Check if content is already a process.env reference
        return /^process\.env\.[A-Z_][A-Z0-9_]*$/i.test(content.trim());
    }

    private isValidEnvVarName(name: string): boolean {
        // Valid env var names: uppercase letters, numbers, underscores, must start with letter or underscore
        return /^[A-Z_][A-Z0-9_]*$/i.test(name);
    }

    private async migrateSecret(secret: DetectedSecret): Promise<void> {
        try {
            // Validate environment variable name
            if (!this.isValidEnvVarName(secret.suggestedEnvVar)) {
                throw new Error(`Invalid environment variable name: ${secret.suggestedEnvVar}`);
            }

            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (!workspaceFolders) {
                throw new Error('No workspace folder open');
            }

            const workspaceRoot = workspaceFolders[0].uri.fsPath;
            
            // Fix path handling - use consistent path methods
            const filePath = path.isAbsolute(secret.file) 
                ? secret.file 
                : path.join(workspaceRoot, secret.file);
            
            // Validate path is within workspace (prevent path traversal)
            const relativePath = path.relative(workspaceRoot, filePath);
            if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
                throw new Error('Invalid file path: outside workspace');
            }

            const fileUri = vscode.Uri.file(filePath);
            const document = await vscode.workspace.openTextDocument(fileUri);
            
            // Verify the content at the specified location matches
            const line = secret.line - 1;
            if (line < 0 || line >= document.lineCount) {
                throw new Error('Invalid line number');
            }

            const lineText = document.lineAt(line).text;
            const startIdx = secret.column - 1;
            const endIdx = startIdx + secret.content.length;

            // Verify the secret content matches what's in the file
            const actualContent = lineText.substring(startIdx, endIdx);
            if (actualContent !== secret.content) {
                throw new Error('Secret content has changed. Please re-scan.');
            }

            const editor = await vscode.window.showTextDocument(document);

            // Find quotes around the secret
            let replaceStart = startIdx;
            let replaceEnd = endIdx;
            let replacement = `process.env.${secret.suggestedEnvVar}`;

            // Find opening quote (search BEFORE the secret starts)
            let quoteChar = '';
            let quoteStart = -1;
            for (let i = startIdx - 1; i >= 0; i--) {
                const char = lineText[i];
                if (char === '"' || char === "'" || char === '`') {
                    quoteChar = char;
                    quoteStart = i;
                    break;
                }
                // Stop if we hit non-whitespace that's not a quote
                if (char !== ' ' && char !== '\t') {
                    break;
                }
            }

            // Find closing quote
            let quoteEnd = -1;
            if (quoteChar) {
                for (let i = endIdx; i < lineText.length; i++) {
                    const char = lineText[i];
                    if (char === quoteChar) {
                        quoteEnd = i + 1;
                        break;
                    }
                }
            }

            // Replace the quoted string if we found both quotes
            if (quoteChar && quoteStart >= 0 && quoteEnd > endIdx) {
                replaceStart = quoteStart;
                replaceEnd = quoteEnd;
                
                // Handle template literals differently
                if (quoteChar === '`') {
                    replacement = `\`\${${replacement}}\``;
                } else {
                    // For regular quotes, don't add quotes - use unquoted env var
                    // This handles cases like: const x = "secret" -> const x = process.env.VAR
                    // No quotes needed around process.env
                }
            }

            const range = new vscode.Range(line, replaceStart, line, replaceEnd);

            // Perform the replacement
            const success = await editor.edit(editBuilder => {
                editBuilder.replace(range, replacement);
            });

            if (!success) {
                throw new Error('Failed to apply edit to document');
            }

            // Save the document
            await document.save();

            // Add to .env file
            await this.addSecretToEnv(secret);

            vscode.window.showInformationMessage(
                `✅ Secret migrated to .env: ${secret.suggestedEnvVar}\nCode updated in ${secret.file}`
            );

        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            vscode.window.showErrorMessage(`Failed to migrate secret: ${errorMessage}`);
        }
    }

    private async addSecretToEnv(secret: DetectedSecret): Promise<void> {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders) {
            throw new Error('No workspace folder open');
        }

        const workspaceUri = workspaceFolders[0].uri;
        const envUri = vscode.Uri.joinPath(workspaceUri, '.env');

        let envContent = '';
        try {
            const fileData = await vscode.workspace.fs.readFile(envUri);
            envContent = Buffer.from(fileData).toString('utf8');
        } catch {
            // File doesn't exist, will create
        }

        // Check if env var already exists
        const lines = envContent.split('\n');
        const varExists = lines.some(line => {
            const trimmed = line.trim();
            return trimmed.startsWith(`${secret.suggestedEnvVar}=`);
        });

        if (!varExists) {
            // Add the new env var with proper formatting
            const timestamp = new Date().toISOString();
            const newLine = `${secret.suggestedEnvVar}=${secret.content}`;
            const comment = `# Added by secret scan on ${timestamp}`;
            
            const newContent = envContent
                ? `${envContent.trimEnd()}\n\n${comment}\n${newLine}\n`
                : `${comment}\n${newLine}\n`;

            const buffer = Buffer.from(newContent, 'utf8');
            await vscode.workspace.fs.writeFile(envUri, buffer);

            // Ensure .env is in .gitignore
            await this.ensureEnvInGitignore(workspaceUri);
        }
    }

    private async ensureEnvInGitignore(workspaceUri: vscode.Uri): Promise<void> {
        const gitignoreUri = vscode.Uri.joinPath(workspaceUri, '.gitignore');
        
        let gitignoreContent = '';
        try {
            const fileData = await vscode.workspace.fs.readFile(gitignoreUri);
            gitignoreContent = Buffer.from(fileData).toString('utf8');
        } catch {
            // .gitignore doesn't exist, will create
        }

        // Check if .env is already ignored
        const lines = gitignoreContent.split('\n');
        const envIgnored = lines.some(line => {
            const trimmed = line.trim();
            return trimmed === '.env' || trimmed === '/.env' || trimmed === '*.env';
        });

        if (!envIgnored) {
            const newContent = gitignoreContent
                ? `${gitignoreContent.trimEnd()}\n\n# Environment variables\n.env\n`
                : `# Environment variables\n.env\n`;

            const buffer = Buffer.from(newContent, 'utf8');
            await vscode.workspace.fs.writeFile(gitignoreUri, buffer);

            vscode.window.showInformationMessage(
                '✅ Added .env to .gitignore to prevent committing secrets'
            );
        }
    }

    private async showSecretLocation(secret: DetectedSecret): Promise<void> {
        try {
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (!workspaceFolders) {
                throw new Error('No workspace folder open');
            }

            const workspaceRoot = workspaceFolders[0].uri.fsPath;
            const filePath = path.isAbsolute(secret.file)
                ? secret.file
                : path.join(workspaceRoot, secret.file);

            const fileUri = vscode.Uri.file(filePath);
            const document = await vscode.workspace.openTextDocument(fileUri);
            const editor = await vscode.window.showTextDocument(document);

            const line = secret.line - 1;
            const startCharacter = secret.column - 1;
            const range = new vscode.Range(
                line, 
                startCharacter, 
                line, 
                startCharacter + secret.content.length
            );

            editor.revealRange(range, vscode.TextEditorRevealType.InCenter);
            editor.selection = new vscode.Selection(range.start, range.end);
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            vscode.window.showErrorMessage(`Failed to show secret location: ${errorMessage}`);
        }
    }

    public dispose(): void {
        this.trackedSecrets.clear();
    }
}

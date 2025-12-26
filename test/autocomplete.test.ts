import * as assert from 'assert';
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { EnvironmentCompletionProvider } from '../src/providers/environmentCompletionProvider';

suite('Environment Completion Provider Tests', () => {
    let tempDir: string;
    let envFilePath: string;

    setup(async () => {
        // Create a temporary directory for testing
        tempDir = path.join(__dirname, 'temp-test');
        if (!fs.existsSync(tempDir)) {
            fs.mkdirSync(tempDir, { recursive: true });
        }

        // Create a test .env file
        envFilePath = path.join(tempDir, '.env');
        const envContent = `# Database Configuration
DB_HOST=localhost
DB_PORT=5432
DB_NAME=myapp

# API Configuration
API_KEY=secret123
API_URL=https://api.example.com

# Encrypted Variables
SECRET_TOKEN=ENC[1|abc123|def456|ghi789]

# Frontend Variables
FRONTEND_URL=https://app.example.com
ENABLE_FEATURE=true`;
        
        fs.writeFileSync(envFilePath, envContent);
    });

    teardown(() => {
        // Clean up temporary files
        if (fs.existsSync(envFilePath)) {
            fs.unlinkSync(envFilePath);
        }
        if (fs.existsSync(tempDir)) {
            fs.rmdirSync(tempDir);
        }
    });

    // Helper function to wait for cache to load
    const waitForCache = () => new Promise(resolve => setTimeout(resolve, 100));

    test('Should provide completions for process.env.', async () => {
        const provider = new EnvironmentCompletionProvider(tempDir);
        await waitForCache(); // ⏳ Give it a moment to read the file
        
        // Simulate typing "process.env.D"
        const document = {
            languageId: 'typescript',
            lineAt: () => ({
                text: 'process.env.D'
            })
        } as unknown as vscode.TextDocument;

        const position = new vscode.Position(0, 14); // Cursor at end of "process.env.D"
        
        // We removed token/context args, so calling with just 2 args is correct now!
        const completions = await provider.provideCompletionItems(document, position);
        
        assert.ok(completions, 'Should return completions');
        assert.ok(completions && completions.length > 0, 'Should return at least one completion');
        
        // Check that we get DB_HOST and DB_PORT
        const completionLabels = completions!.map(c => c.label as string);
        assert.ok(completionLabels.includes('DB_HOST'), 'Should include DB_HOST');
        assert.ok(completionLabels.includes('DB_PORT'), 'Should include DB_PORT');
    });

    test('Should provide completions for import.meta.env.', async () => {
        const provider = new EnvironmentCompletionProvider(tempDir);
        await waitForCache();

        // Simulate typing "import.meta.env.A"
        const document = {
            languageId: 'typescript',
            lineAt: () => ({
                text: 'import.meta.env.A'
            })
        } as unknown as vscode.TextDocument;

        const position = new vscode.Position(0, 18); 
        
        const completions = await provider.provideCompletionItems(document, position);
        
        assert.ok(completions, 'Should return completions');
        const completionLabels = completions!.map(c => c.label as string);
        assert.ok(completionLabels.includes('API_KEY'), 'Should include API_KEY');
    });

    test('Should show encrypted variables with special label', async () => {
        const provider = new EnvironmentCompletionProvider(tempDir);
        await waitForCache();

        // Simulate typing "process.env.S"
        const document = {
            languageId: 'typescript',
            lineAt: () => ({
                text: 'process.env.S'
            })
        } as unknown as vscode.TextDocument;

        const position = new vscode.Position(0, 14);
        
        const completions = await provider.provideCompletionItems(document, position);
        
        assert.ok(completions, 'Should return completions');
        const secretCompletion = completions!.find(c => c.label === 'SECRET_TOKEN');
        assert.ok(secretCompletion, 'Should include SECRET_TOKEN');
        
        // Check that it shows as encrypted
        assert.strictEqual(secretCompletion!.detail, 'Encrypted Variable', 'Should show encrypted detail');
    });

    test('Should provide descriptions from comments', async () => {
        const provider = new EnvironmentCompletionProvider(tempDir);
        await waitForCache();

        // Simulate typing "process.env.DB_"
        const document = {
            languageId: 'typescript',
            lineAt: () => ({
                text: 'process.env.DB_'
            })
        } as unknown as vscode.TextDocument;

        const position = new vscode.Position(0, 15);
        
        const completions = await provider.provideCompletionItems(document, position);
        
        assert.ok(completions, 'Should return completions');
        const dbHostCompletion = completions!.find(c => c.label === 'DB_HOST');
        assert.ok(dbHostCompletion, 'Should include DB_HOST');
        
        // Check that it has documentation
        assert.ok(dbHostCompletion!.documentation, 'Should have documentation');
    });

    test('Should not provide completions for unsupported languages', async () => {
        const provider = new EnvironmentCompletionProvider(tempDir);
        await waitForCache();

        // ✅ التعديل هنا: غيرنا python لـ cpp عشان إحنا بقينا ندعم بايثون خلاص
        const document = {
            languageId: 'cpp', // C++ is not in our supported list
            lineAt: () => ({
                text: 'std::getenv("'
            })
        } as unknown as vscode.TextDocument;

        const position = new vscode.Position(0, 13);
        
        const completions = await provider.provideCompletionItems(document, position);
        
        assert.strictEqual(completions, null, 'Should not provide completions for C++');
    });

    test('Should handle empty .env file', async () => {
        fs.writeFileSync(envFilePath, ''); // Overwrite with empty
        
        const provider = new EnvironmentCompletionProvider(tempDir);
        await waitForCache();

        const document = {
            languageId: 'typescript',
            lineAt: () => ({
                text: 'process.env.'
            })
        } as unknown as vscode.TextDocument;

        const position = new vscode.Position(0, 13);
        
        const completions = await provider.provideCompletionItems(document, position);
        
        assert.ok(completions, 'Should return completions array');
        assert.strictEqual(completions && completions.length, 0, 'Should return empty completions');
    });
});

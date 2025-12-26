import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { EncryptedVarsManager } from './encryptedVars';
import { FileUtils } from './fileUtils';

  export interface ExportOptions {
  format?: 'json' | 'csv' | 'env' | 'encrypted-json';
  includeComments?: boolean;
  maskSecrets?: boolean;
  includeMetadata?: boolean;
  environmentName?: string;
}

export interface ExportMetadata {
  version: string;
  tool: string;
  timestamp: string;
  source: {
    workspace: string;
    workspacePath: string;
    environment: string;
    environmentFile: string;
  };
  variables: {
    total: number;
    encrypted: number;
    plain: number;
  };
}

export interface ExportResult {
  success: boolean;
  content: string;
  format: string;
  metadata?: ExportMetadata;
  error?: string;
}

interface VariableData {
  value: string;
  encrypted: boolean;
  comment?: string;
}

interface VariableExportData {
  value: string;
  encrypted: boolean;
  comment?: string;
}

export class EnvironmentExporter {
  /**
   * Export environment variables to various formats
   */
  static async exportEnvironmentVariables(envPath: string, options: ExportOptions = {}): Promise<ExportResult> {
    try {
      const {
        format = 'json',
        includeComments = false,
        maskSecrets = false,
        includeMetadata = true,
        environmentName = this.detectEnvironmentName(envPath)
      } = options;

      // Read the environment file
      if (!await fs.promises.access(envPath, fs.constants.F_OK).catch(() => false)) {
        throw new Error(`Environment file not found: ${envPath}`);
      }

      const content = await fs.promises.readFile(envPath, 'utf8');
      const variables = await this.parseEnvironmentContent(content, envPath);

      // Create metadata if requested
      const metadata = includeMetadata ? await this.createMetadata(envPath, environmentName, variables) : undefined;

      // Export based on format
      let exportContent: string;

      switch (format) {
        case 'json':
          exportContent = this.exportToJson(variables, metadata, { includeComments, maskSecrets });
          break;
        case 'csv':
          exportContent = this.exportToCsv(variables);
          break;
        case 'env':
          exportContent = this.exportToEnv(variables, { includeComments });
          break;
        case 'encrypted-json':
          exportContent = await this.exportToEncryptedJson(variables, metadata, { includeComments, maskSecrets });
          break;
        default:
          throw new Error(`Unsupported export format: ${format}`);
      }

      return {
        success: true,
        content: exportContent,
        format,
        metadata
      };

    } catch (error) {
      return {
        success: false,
        content: '',
        format: options.format || 'json',
        error: (error as Error).message
      };
    }
  }

  /**
   * Parse environment file content into variables map
   */
  private static async parseEnvironmentContent(content: string, envPath: string): Promise<Map<string, { value: string; encrypted: boolean; comment?: string }>> {
    // Log the file being parsed using the envPath parameter
    console.log(`Parsing environment file: ${path.basename(envPath)}`);
    const variables = new Map<string, { value: string; encrypted: boolean; comment?: string }>();
    const lines = content.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();

      if (!line) continue;

      // Handle comments
      if (line.startsWith('#')) {
        // Check if next line is a variable assignment
        if (i + 1 < lines.length) {
          const nextLine = lines[i + 1].trim();
          if (nextLine.includes('=')) {
            // Take ownership of the next variable's comment
            continue;
          }
        }
        continue;
      }

      const eqIndex = line.indexOf('=');
      if (eqIndex === -1) continue;

      const key = line.substring(0, eqIndex).trim();
      const value = line.substring(eqIndex + 1).trim();

      if (!key) continue;

      // Check if variable is encrypted
      const isEncrypted = EncryptedVarsManager.isEncrypted(value);
      let comment: string | undefined;

      // Look for comment on current line after value
      const commentIndex = line.indexOf('#', eqIndex);
      if (commentIndex !== -1) {
        comment = line.substring(commentIndex + 1).trim();
      }

      variables.set(key, {
        value,
        encrypted: isEncrypted,
        comment
      });
    }

    return variables;
  }

  /**
   * Create export metadata
   */
  private static async createMetadata(envPath: string, environmentName: string, variables: Map<string, VariableData>): Promise<ExportMetadata> {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    const workspaceName = workspaceFolder?.name || 'unknown';
    const workspacePath = workspaceFolder?.uri.fsPath || '';

    let encryptedCount = 0;
    let plainCount = 0;

    for (const [, data] of variables) {
      if (data.encrypted) {
        encryptedCount++;
      } else {
        plainCount++;
      }
    }

    return {
      version: '1.0',
      tool: 'dotenvy',
      timestamp: new Date().toISOString(),
      source: {
        workspace: workspaceName,
        workspacePath,
        environment: environmentName,
        environmentFile: path.basename(envPath)
      },
      variables: {
        total: variables.size,
        encrypted: encryptedCount,
        plain: plainCount
      }
    };
  }

  /**
   * Export to JSON format
   */
  private static exportToJson(variables: Map<string, VariableData>, metadata?: ExportMetadata, options: { includeComments?: boolean; maskSecrets?: boolean } = {}): string {
    const exportData: { _metadata?: ExportMetadata; variables: Record<string, VariableExportData> } = {
      variables: {}
    };

    if (metadata) {
      exportData._metadata = metadata;
    }

    const vars: Record<string, VariableExportData> = {};
    for (const [key, data] of variables) {
      let value = data.value;

      // Use FileUtils for secret scanning if maskSecrets option is enabled
      if (options.maskSecrets) {
        // Check if this looks like a secret using FileUtils - create temporary file for scanning
        const tempFilePath = `/tmp/temp_${key}`;
        try {
          fs.writeFileSync(tempFilePath, `${key}=${data.value}`);
          const warnings = FileUtils.checkForSecrets(tempFilePath);
          if (warnings.length > 0 && !EncryptedVarsManager.isEncrypted(data.value)) {
            value = '*** MASKED SECRET ***';
          }
          fs.unlinkSync(tempFilePath);
        } catch (error) {
          // Ignore errors in masking, continue with original value
          console.warn(`Error masking secrets for ${key}:`, error);
        }
      }

      vars[key] = {
        value,
        encrypted: data.encrypted
      };

      if (options.includeComments && data.comment) {
        vars[key].comment = data.comment;
      }
    }

    exportData.variables = vars;
    return JSON.stringify(exportData, null, 2);
  }

  /**
   * Export to CSV format
   */
  private static exportToCsv(variables: Map<string, VariableData>): string {
    const lines: string[] = ['key,value,encrypted,comment'];

    for (const [key, data] of variables) {
      const csvKey = `"${key.replace(/"/g, '""')}"`;
      const csvValue = `"${data.value.replace(/"/g, '""')}"`;
      const csvEncrypted = data.encrypted ? 'true' : 'false';
      const csvComment = data.comment ? `"${data.comment.replace(/"/g, '""')}"` : '';

      lines.push(`${csvKey},${csvValue},${csvEncrypted},${csvComment}`);
    }

    return lines.join('\n');
  }

  /**
   * Export to .env format
   */
  private static exportToEnv(variables: Map<string, VariableData>, options: { includeComments?: boolean } = {}): string {
    const lines: string[] = [];

    for (const [key, data] of variables) {
      if (options.includeComments && data.comment) {
        lines.push(`# ${data.comment}`);
      }

      lines.push(`${key}=${data.value}`);
    }

    return lines.join('\n') + '\n';
  }

  /**
   * Export to encrypted JSON format
   */
  private static async exportToEncryptedJson(variables: Map<string, VariableData>, metadata?: ExportMetadata, options: { includeComments?: boolean; maskSecrets?: boolean } = {}): Promise<string> {
    const jsonString = this.exportToJson(variables, metadata, options);

    // Get master key if available
    const extensionContext = (global as { extensionContext?: vscode.ExtensionContext }).extensionContext;
    if (!extensionContext) {
      throw new Error('Extension context not available for encrypted export');
    }

    let masterKey: Buffer;
    try {
      masterKey = await EncryptedVarsManager.ensureMasterKey(extensionContext);
    } catch {
      throw new Error('Master key not available. Set a master password first for encrypted exports.');
    }

    const encryptedContent = EncryptedVarsManager.encryptValue(jsonString, masterKey);

    return JSON.stringify({
      encrypted: true,
      version: '1.0',
      content: encryptedContent,
      format: 'dotenvy-encrypted-json',
      _metadata: metadata
    }, null, 2);
  }

  /**
   * Detect environment name from file path
   */
  private static detectEnvironmentName(envPath: string): string {
    const basename = path.basename(envPath);

    if (basename === '.env') {
      return 'local';
    }

    if (basename.startsWith('.env.')) {
      return basename.substring(5); // Remove '.env.' prefix
    }

    return basename;
  }

  /**
   * Get available environments in workspace
   */
  static async getAvailableEnvironments(): Promise<Array<{ name: string; path: string; exists: boolean }>> {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
      return [];
    }

    const workspacePath = workspaceFolder.uri.fsPath;

    // Find all .env and .env.* files
    const envFiles: string[] = [];
    try {
      const entries = await fs.promises.readdir(workspacePath);
      for (const entry of entries) {
        const fullPath = path.join(workspacePath, entry);
        if ((entry === '.env' || entry.startsWith('.env.')) && fs.existsSync(fullPath)) {
          envFiles.push(fullPath);
        }
      }
    } catch (error) {
      console.warn('Error scanning workspace for environment files:', error);
    }

    return envFiles.map(filePath => ({
      name: this.detectEnvironmentName(filePath),
      path: filePath,
      exists: fs.existsSync(filePath)
    }));
  }

  /**
   * Validate export options
   */
  static validateExportOptions(options: ExportOptions): { valid: boolean; error?: string } {
    const supportedFormats = ['json', 'csv', 'env', 'encrypted-json'];

    if (options.format && !supportedFormats.includes(options.format)) {
      return { valid: false, error: `Unsupported format: ${options.format}. Supported: ${supportedFormats.join(', ')}` };
    }

    return { valid: true };
  }
}

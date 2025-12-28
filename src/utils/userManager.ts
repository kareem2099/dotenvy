import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import * as vscode from 'vscode';
import {
  USER_ENVELOPE_FILE,
  USER_ENVELOPE_VERSION,
  PBKDF2_ITERATIONS,
  PBKDF2_SALT_LENGTH,
  KEY_LENGTH
} from '../constants';
import {
  UserEntry,
  RawUserEntry,
  ProjectKeyEnvelope,
  UserCredentials,
  UserManagementResult,
  ProjectKeyAccessResult
} from '../types/user';

export class UserManager {

  /**
   * Get the path to the users file
   */
  private static getUsersFilePath(): string | null {
    const workspace = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    return workspace ? path.join(workspace, USER_ENVELOPE_FILE) : null;
  }

  /**
   * Check if the project has been initialized with secure multi-user access
   */
  public static async isSecureProjectInitialized(): Promise<boolean> {
    const filePath = this.getUsersFilePath();
    if (!filePath) return false;

    try {
      await fs.promises.access(filePath, fs.constants.F_OK);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Load the project key envelope from file
   */
  public static async loadEnvelope(): Promise<ProjectKeyEnvelope | null> {
    const filePath = this.getUsersFilePath();
    if (!filePath) return null;

    try {
      const content = await fs.promises.readFile(filePath, 'utf8');
      const envelope = JSON.parse(content);

      // Convert date strings back to Date objects
      envelope.metadata.createdAt = new Date(envelope.metadata.createdAt);
      envelope.users = envelope.users.map((user: RawUserEntry) => ({
        ...user,
        createdAt: new Date(user.createdAt),
        lastAccess: user.lastAccess ? new Date(user.lastAccess) : undefined
      }));

      return envelope;
    } catch (error) {
      console.error('Failed to load envelope:', error);
      return null;
    }
  }

  /**
   * Save the project key envelope to file
   */
  private static async saveEnvelope(envelope: ProjectKeyEnvelope): Promise<void> {
    const filePath = this.getUsersFilePath();
    if (!filePath) {
      throw new Error('No workspace found');
    }

    const content = JSON.stringify(envelope, null, 2);
    await fs.promises.writeFile(filePath, content, 'utf8');
  }

  /**
   * Generate a new project key
   */
  private static generateProjectKey(): Buffer {
    return crypto.randomBytes(KEY_LENGTH);
  }

  /**
   * Derive encryption key from password with salt
   */
  private static deriveKeyFromPassword(password: string, existingSalt?: string): { key: Buffer; salt: string } {
    const saltBuffer = existingSalt ? Buffer.from(existingSalt, 'base64') : crypto.randomBytes(PBKDF2_SALT_LENGTH);
    const saltString = saltBuffer.toString('base64');

    const key = crypto.pbkdf2Sync(password, saltBuffer, PBKDF2_ITERATIONS, KEY_LENGTH, 'sha256');
    return { key, salt: saltString };
  }

  /**
   * Encrypt data with AES-GCM
   */
  private static encryptData(data: Buffer, key: Buffer): { iv: string; content: string; authTag: string } {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);

    const encrypted = Buffer.concat([
      cipher.update(data),
      cipher.final()
    ]);

    const authTag = cipher.getAuthTag();

    return {
      iv: iv.toString('base64'),
      content: encrypted.toString('base64'),
      authTag: authTag.toString('base64')
    };
  }

  /**
   * Decrypt data with AES-GCM
   */
  private static decryptData(encryptedObj: { iv: string; content: string; authTag: string }, key: Buffer): Buffer {
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(encryptedObj.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(encryptedObj.authTag, 'base64'));

    return Buffer.concat([
      decipher.update(Buffer.from(encryptedObj.content, 'base64')),
      decipher.final()
    ]);
  }

  /**
   * Initialize a new secure project
   */
  public static async initializeSecureProject(
    adminCredentials: UserCredentials,
    projectName?: string
  ): Promise<UserManagementResult> {
    try {
      if (await this.isSecureProjectInitialized()) {
        return { success: false, message: 'Project is already initialized with secure access' };
      }

      // Generate the Holy Grail (Project Key)
      const projectKey = this.generateProjectKey();

      // Derive Admin Key (and generate salt)
      const { key: adminKey, salt: adminSalt } = this.deriveKeyFromPassword(adminCredentials.password);

      // Encrypt Project Key with Admin's derived key
      const encryptedData = this.encryptData(projectKey, adminKey);

      // Create Admin User Entry
      const adminUser: UserEntry = {
        username: adminCredentials.username,
        wrappedKey: encryptedData.content,
        salt: adminSalt,
        iv: encryptedData.iv,
        authTag: encryptedData.authTag,
        createdAt: new Date(),
        role: 'admin'
      };

      // Create Envelope
      const envelope: ProjectKeyEnvelope = {
        version: USER_ENVELOPE_VERSION,
        users: [adminUser],
        metadata: {
          createdAt: new Date(),
          createdBy: adminCredentials.username,
          projectName
        }
      };

      await this.saveEnvelope(envelope);

      return {
        success: true,
        message: `Secure project initialized successfully. Admin: ${adminCredentials.username}`,
        user: adminUser
      };

    } catch (error) {
      return {
        success: false,
        message: 'Failed to initialize secure project',
        error: (error as Error).message
      };
    }
  }

  /**
   * Add a new user to the project
   */
  public static async addUser(
    adminCredentials: UserCredentials,
    newUserCredentials: UserCredentials
  ): Promise<UserManagementResult> {
    try {
      const envelope = await this.loadEnvelope();
      if (!envelope) {
        return { success: false, message: 'Project not initialized. Run "Init Secure Project" first.' };
      }

      // Verify admin credentials and get project key
      const accessResult = await this.accessProjectKey(adminCredentials);
      if (!accessResult.success || !accessResult.projectKey) {
        return {
          success: false,
          message: accessResult.message,
          error: accessResult.error
        };
      }

      // Check if user already exists
      if (envelope.users.find(u => u.username === newUserCredentials.username)) {
        return { success: false, message: `User ${newUserCredentials.username} already exists` };
      }

      // Generate key for new user (with new salt)
      const { key: newUserKey, salt: newUserSalt } = this.deriveKeyFromPassword(newUserCredentials.password);

      // Encrypt the project key with new user's key
      const encryptedData = this.encryptData(accessResult.projectKey, newUserKey);

      // Add new user
      const newUser: UserEntry = {
        username: newUserCredentials.username,
        wrappedKey: encryptedData.content,
        salt: newUserSalt,
        iv: encryptedData.iv,
        authTag: encryptedData.authTag,
        createdAt: new Date(),
        role: 'developer'
      };

      envelope.users.push(newUser);
      await this.saveEnvelope(envelope);

      return {
        success: true,
        message: `User ${newUserCredentials.username} added successfully`,
        user: newUser
      };

    } catch (error) {
      return {
        success: false,
        message: 'Failed to add user',
        error: (error as Error).message
      };
    }
  }

  /**
   * Revoke user access
   */
  public static async revokeUser(
    adminCredentials: UserCredentials,
    usernameToRevoke: string
  ): Promise<UserManagementResult> {
    try {
      const envelope = await this.loadEnvelope();
      if (!envelope) {
        return { success: false, message: 'Project not initialized' };
      }

      // Verify admin credentials
      const accessResult = await this.accessProjectKey(adminCredentials);
      if (!accessResult.success) {
        return {
          success: false,
          message: accessResult.message,
          error: accessResult.error
        };
      }

      // Find user to revoke
      const userIndex = envelope.users.findIndex(u => u.username === usernameToRevoke);
      if (userIndex === -1) {
        return { success: false, message: `User ${usernameToRevoke} not found` };
      }

      const user = envelope.users[userIndex];

      // Cannot revoke the last admin
      if (user.role === 'admin' && envelope.users.filter(u => u.role === 'admin').length === 1) {
        return { success: false, message: 'Cannot revoke the last admin user' };
      }

      // Remove user
      envelope.users.splice(userIndex, 1);
      await this.saveEnvelope(envelope);

      return {
        success: true,
        message: `User ${usernameToRevoke} access revoked successfully`,
        user
      };

    } catch (error) {
      return {
        success: false,
        message: 'Failed to revoke user',
        error: (error as Error).message
      };
    }
  }

  /**
   * Access project key using user credentials
   */
  public static async accessProjectKey(credentials: UserCredentials): Promise<ProjectKeyAccessResult> {
    try {
      const envelope = await this.loadEnvelope();
      if (!envelope) {
        return { success: false, message: 'Project not initialized. Run "Init Secure Project" first.' };
      }

      // Find user
      const user = envelope.users.find(u => u.username === credentials.username);
      if (!user) {
        return { success: false, message: `User ${credentials.username} not found` };
      }

      // Derive key using the STORED salt (critical!)
      const { key: userKey } = this.deriveKeyFromPassword(credentials.password, user.salt);

      // Decrypt the wrapped project key
      try {
        const projectKey = this.decryptData({
          iv: user.iv,
          content: user.wrappedKey,
          authTag: user.authTag || ''
        }, userKey);

        // Update last access
        user.lastAccess = new Date();
        await this.saveEnvelope(envelope);

        return {
          success: true,
          projectKey,
          message: 'Project key accessed successfully'
        };

      } catch (error) {
        return {
          success: false,
          message: 'Invalid password',
          error: 'Decryption failed'
        };
      }

    } catch (error) {
      return {
        success: false,
        message: 'Failed to access project key',
        error: (error as Error).message
      };
    }
  }

  /**
   * List all users in the project
   */
  public static async listUsers(): Promise<UserEntry[]> {
    const envelope = await this.loadEnvelope();
    return envelope?.users || [];
  }

  /**
   * Check if user exists
   */
  public static async userExists(username: string): Promise<boolean> {
    const users = await this.listUsers();
    return users.some(u => u.username === username);
  }
}

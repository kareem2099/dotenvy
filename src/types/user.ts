export interface UserEntry {
  username: string;
  wrappedKey: string; // Encrypted project key with user's password
  salt: string; // PBKDF2 salt used for key derivation
  iv: string; // Initialization vector for AES-GCM
  authTag?: string; // Authentication tag for AES-GCM integrity
  createdAt: Date;
  lastAccess?: Date;
  role: 'admin' | 'developer';
}

export interface ProjectKeyEnvelope {
  version: number;
  projectKeyEncrypted?: string; // Optional: kept for backward compatibility, but each user now has their own wrapped key
  users: UserEntry[];
  metadata: {
    createdAt: Date;
    createdBy: string;
    projectName?: string;
  };
}

export interface UserCredentials {
  username: string;
  password: string;
}

export interface UserManagementResult {
  success: boolean;
  message: string;
  user?: UserEntry;
  error?: string;
}

export interface ProjectKeyAccessResult {
  success: boolean;
  projectKey?: Buffer;
  message: string;
  error?: string;
}

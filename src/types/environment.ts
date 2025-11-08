import * as vscode from 'vscode';
import { EnvDiff } from '../utils/environmentDiffer';

export interface Environment {
	name: string;
	fileName: string;
	filePath: string;
}

export interface EnvironmentValidationRules {
	requiredVariables?: string[];
	variableTypes?: {[varName: string]: 'string' | 'number' | 'boolean' | 'url'};
	customValidators?: {[varName: string]: string}; // Regex patterns
}

export interface GitCommitHookConfig {
	blockEnvFiles?: boolean;
	blockSecrets?: boolean;
	blockValidationErrors?: boolean;
	customMessage?: string;
}

export interface CloudSyncConfig {
	provider: 'doppler' | 'vault';
	project: string;
	config: string;
	token?: string; // Optional, can be set via env var or secure storage
	baseUrl?: string; // For custom Vault installations
}

export interface QuickEnvConfig {
	environments: {[key: string]: string};
	gitBranchMapping?: {[branch: string]: string};
	autoSwitchOnBranchChange?: boolean;
	validation?: EnvironmentValidationRules;
	gitCommitHook?: GitCommitHookConfig;
	cloudSync?: CloudSyncConfig;
	history?: HistoryConfig;
}

export interface StatusBarItem {
	text: string;
	tooltip: string;
	command?: string;
	alignment?: vscode.StatusBarAlignment;
	priority?: number;
}

export interface EnvironmentStatus {
	environment: string | null;
	cloudSyncStatus: CloudSyncStatus;
	gitHookStatus: GitHookStatus;
	validationStatus: ValidationStatus;
	lastSyncTime?: Date;
	isEnabled?: boolean;
}

export interface CloudSyncStatus {
	connected: boolean;
	provider?: string;
	lastSync?: Date;
	hasConfig?: boolean;
	error?: string;
}

export interface GitHookStatus {
	installed: boolean;
	enabled: boolean;
	repoPath?: string;
}

export interface ValidationStatus {
	valid: boolean;
	errors?: number;
	warnings?: number;
	lastValidated?: Date;
}

export interface StatusBarSegment {
	id: string;
	text: string;
	tooltip: string;
	color?: string;
	command?: string;
	priority: number;
	show: boolean;
}

// History & Rollback Types
export interface HistoryEntry {
	id: string;
	timestamp: Date;
	action: 'switch' | 'manual_edit' | 'rollback' | 'import' | 'initial' | 'modify';
	environmentName: string;
	fileName?: string; // Added fileName property
	previousEnvironment?: string;
	user?: string;
	commitHash?: string;
	diff?: EnvDiff; // This is the field that needs to be compatible with the updated EnvDiff
	fileContent: string;
	metadata: HistoryMetadata;
}

export interface HistoryMetadata {
	workspace: string;
	reason?: string;
	tags?: string[];
	source?: 'auto' | 'manual' | 'git';
	checksum?: string; // For integrity verification
}

export interface HistoryConfig {
	enabled: boolean;
	retentionDays: number;
	maxEntries: number;
	autoCleanup: boolean;
	trackManualEdits: boolean;
	includeGitInfo: boolean;
	storagePath?: string;
}

export interface HistoryStats {
	totalEntries: number;
	oldestEntry?: Date;
	newestEntry?: Date;
	entriesByAction: Record<string, number>;
	storageSize: number;
}

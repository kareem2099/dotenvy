import * as fs from 'fs';
import { QuickEnvConfig } from '../types/environment';
import { CloudSecrets } from './cloudSyncManager';
import { isCloudMetadataKey } from '../constants';
import { resolveSyncTargets as resolveSyncTargetList } from './syncTargetResolver';
import {
	backupEnvFile as backupEnvFileOnDisk,
	formatEnvFileContent as formatEnvFileContentText,
	parseEnvFile as parseEnvFileContent,
	resolveEnvFileForSync as resolveEnvFileForSyncTarget,
	writeSecretsToTargets as writeSecretsToTargetFiles,
} from './envFileContent';

export interface ResolvedEnvFile {
	envPath: string;
	envName: string;
	relativePath: string;
}

export interface ResolvedSyncTarget {
	file: string;
	absolutePath: string;
	/** Doppler key prefix, e.g. BACKEND_ — empty for single-file sync */
	keyPrefix: string;
	prefixes: string[];
	catchAll: boolean;
	label: string;
}

export interface MergedEnvSecrets {
	secrets: CloudSecrets;
	duplicateKeys: string[];
	sourceFiles: string[];
}

export interface ReplacePreview {
	keysToDelete: string[];
	keysToUpsert: string[];
}

export interface PullChangeSummary {
	newKeys: string[];
	changedKeys: string[];
	removedKeys: string[];
	totalChanges: number;
	byFile: Record<string, { newKeys: string[]; changedKeys: string[]; removedKeys: string[] }>;
}

export const DOPPLER_RESERVED_KEYS = [
	'DOPPLER_CONFIG',
	'DOPPLER_ENVIRONMENT',
	'DOPPLER_PROJECT',
	'DOPPLER_ENVIRONMENT_ID',
	'DOPPLER_PROJECT_ID',
	'DOPPLER_CONFIG_ID',
	'DOPPLER_ENVIRONMENT_TOKEN_NAME',
	'DOPPLER_ENVIRONMENT_TOKEN_ID'
];

export class EnvSyncUtils {
	/**
	 * Chooses the environment files and key prefixes for a cloud sync.
	 */
	static async resolveSyncTargets(
		rootPath: string,
		dopplerConfig?: string,
		config?: QuickEnvConfig | null
	): Promise<ResolvedSyncTarget[]> {
		return resolveSyncTargetList(rootPath, dopplerConfig, config);
	}

	static mergeTargetsSecretsForCloud(rootPath: string, targets: ResolvedSyncTarget[]): MergedEnvSecrets {
		const secrets: CloudSecrets = {};
		const duplicateKeys: string[] = [];
		const sourceFiles: string[] = [];

		for (const target of targets) {
			if (!fs.existsSync(target.absolutePath)) {
				continue;
			}

			sourceFiles.push(target.file);
			const fileSecrets = this.parseEnvFile(target.absolutePath);

			for (const [key, value] of Object.entries(fileSecrets)) {
				const cloudKey = target.keyPrefix ? `${target.keyPrefix}${key}` : key;
				if (Object.prototype.hasOwnProperty.call(secrets, cloudKey) && secrets[cloudKey] !== value) {
					if (!duplicateKeys.includes(cloudKey)) {
						duplicateKeys.push(cloudKey);
					}
				}
				secrets[cloudKey] = value;
			}
		}

		return { secrets, duplicateKeys, sourceFiles };
	}

	/** @deprecated Use mergeTargetsSecretsForCloud for Doppler push */
	static mergeTargetsSecrets(rootPath: string, targets: ResolvedSyncTarget[]): MergedEnvSecrets {
		return this.mergeTargetsSecretsForCloud(rootPath, targets);
	}

	static splitSecretsAcrossTargets(
		cloudSecrets: CloudSecrets,
		targets: ResolvedSyncTarget[],
		_rootPath: string
	): Map<string, CloudSecrets> {
		const filteredSecrets = this.filterCloudMetadataKeys(
			this.filterDopplerReservedKeys(cloudSecrets)
		);
		const localIndex = this.buildLocalKeyIndex(targets);
		const result = new Map<string, CloudSecrets>();

		for (const target of targets) {
			result.set(target.file, {});
		}

		for (const [key, value] of Object.entries(filteredSecrets)) {
			const resolved = this.resolveTargetForCloudKey(key, targets, localIndex);
			if (!resolved) {
				continue;
			}

			const bucket = result.get(resolved.target.file);
			if (bucket) {
				bucket[resolved.localKey] = value;
			}
		}

		return result;
	}

	static calculatePullChanges(
		targets: ResolvedSyncTarget[],
		cloudSecrets: CloudSecrets
	): PullChangeSummary {
		const splitSecrets = this.splitSecretsAcrossTargets(cloudSecrets, targets, '');
		const byFile: PullChangeSummary['byFile'] = {};
		const newKeys: string[] = [];
		const changedKeys: string[] = [];
		const removedKeys: string[] = [];

		for (const target of targets) {
			const currentSecrets = this.parseEnvFile(target.absolutePath);
			const nextSecrets = splitSecrets.get(target.file) ?? {};
			const fileNew: string[] = [];
			const fileChanged: string[] = [];
			const fileRemoved: string[] = [];

			for (const key of Object.keys(nextSecrets)) {
				if (!Object.prototype.hasOwnProperty.call(currentSecrets, key)) {
					fileNew.push(key);
					newKeys.push(key);
				} else if (currentSecrets[key] !== nextSecrets[key]) {
					fileChanged.push(key);
					changedKeys.push(key);
				}
			}

			for (const key of Object.keys(currentSecrets)) {
				if (!Object.prototype.hasOwnProperty.call(nextSecrets, key)) {
					fileRemoved.push(key);
					removedKeys.push(key);
				}
			}

			byFile[target.file] = {
				newKeys: fileNew,
				changedKeys: fileChanged,
				removedKeys: fileRemoved
			};
		}

		return {
			newKeys,
			changedKeys,
			removedKeys,
			totalChanges: newKeys.length + changedKeys.length + removedKeys.length,
			byFile
		};
	}

	static filterCloudMetadataKeys(secrets: CloudSecrets): CloudSecrets {
		const filtered: CloudSecrets = {};
		for (const [key, value] of Object.entries(secrets)) {
			if (!isCloudMetadataKey(key)) {
				filtered[key] = value;
			}
		}
		return filtered;
	}

	static filterDopplerReservedKeys(secrets: CloudSecrets): CloudSecrets {
		const filtered: CloudSecrets = {};
		for (const [key, value] of Object.entries(secrets)) {
			if (!DOPPLER_RESERVED_KEYS.includes(key)) {
				filtered[key] = value;
			}
		}
		return filtered;
	}

	/**
	 * Serializes secrets as KEY=value lines.
	 */
	static formatEnvFileContent(secrets: CloudSecrets): string {
		return formatEnvFileContentText(secrets);
	}

	/**
	 * Splits cloud secrets across targets and writes each file.
	 */
	static async writeSecretsToTargets(
		targets: ResolvedSyncTarget[],
		cloudSecrets: CloudSecrets
	): Promise<string[]> {
		return writeSecretsToTargetFiles(targets, cloudSecrets);
	}

	/**
	 * Resolves the single environment file a sync should use.
	 */
	static async resolveEnvFileForSync(
		rootPath: string,
		dopplerConfig?: string
	): Promise<ResolvedEnvFile | null> {
		return resolveEnvFileForSyncTarget(rootPath, dopplerConfig);
	}

	/**
	 * Parses a plaintext env file into a secret map.
	 */
	static parseEnvFile(envPath: string): CloudSecrets {
		return parseEnvFileContent(envPath);
	}

	/**
	 * Copies an environment file to a sibling .backup before it is overwritten.
	 */
	static async backupEnvFile(envPath: string): Promise<void> {
		return backupEnvFileOnDisk(envPath);
	}

	private static resolveTargetForCloudKey(
		cloudKey: string,
		targets: ResolvedSyncTarget[],
		localIndex: Map<string, string>
	): { target: ResolvedSyncTarget; localKey: string } | undefined {
		const sortedTargets = [...targets].sort(
			(a, b) => b.keyPrefix.length - a.keyPrefix.length
		);

		for (const target of sortedTargets) {
			if (target.keyPrefix && cloudKey.startsWith(target.keyPrefix)) {
				return {
					target,
					localKey: cloudKey.slice(target.keyPrefix.length)
				};
			}
		}

		const fallbackTarget = this.resolveTargetForKey(cloudKey, targets, localIndex);
		if (!fallbackTarget) {
			return undefined;
		}

		return { target: fallbackTarget, localKey: cloudKey };
	}

	private static buildLocalKeyIndex(targets: ResolvedSyncTarget[]): Map<string, string> {
		const index = new Map<string, string>();

		for (const target of targets) {
			const secrets = this.parseEnvFile(target.absolutePath);
			for (const key of Object.keys(secrets)) {
				if (!index.has(key)) {
					index.set(key, target.file);
				}
			}
		}

		return index;
	}

	private static resolveTargetForKey(
		key: string,
		targets: ResolvedSyncTarget[],
		localIndex: Map<string, string>
	): ResolvedSyncTarget | undefined {
		const stickyFile = localIndex.get(key);
		if (stickyFile) {
			return targets.find(target => target.file === stickyFile);
		}

		for (const target of targets) {
			if (target.prefixes.some(prefix => key.startsWith(prefix))) {
				return target;
			}
		}

		const catchAll = targets.find(target => target.catchAll);
		if (catchAll) {
			return catchAll;
		}

		return targets[0];
	}
}

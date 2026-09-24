import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { Environment, EnvSyncTarget, QuickEnvConfig } from '../types/environment';
import { EnvironmentProvider } from '../providers/environmentProvider';
import { CloudSecrets } from './cloudSyncManager';
import { ConfigUtils } from './configUtils';
import { isCloudMetadataKey } from '../constants';

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

const CONFIG_ENV_ALIASES: Record<string, string[]> = {
	dev: ['dev', 'development', 'develop'],
	development: ['development', 'dev', 'develop'],
	develop: ['develop', 'dev', 'development'],
	stg: ['stg', 'staging', 'stage'],
	staging: ['staging', 'stg', 'stage'],
	stage: ['stage', 'staging', 'stg'],
	prd: ['prd', 'production', 'prod'],
	prod: ['prod', 'production', 'prd'],
	production: ['production', 'prod', 'prd']
};

const AUTO_FRONTEND_PATH_PATTERN = /(?:^|\/)(frontend|client|web|ui|app)(?:\/|$)/i;
const AUTO_FRONTEND_PREFIXES = ['VITE_', 'NEXT_PUBLIC_', 'NUXT_PUBLIC_', 'REACT_APP_', 'PUBLIC_'];

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
	static async resolveSyncTargets(
		rootPath: string,
		dopplerConfig?: string,
		config?: QuickEnvConfig | null
	): Promise<ResolvedSyncTarget[]> {
		const quickConfig = config ?? await ConfigUtils.readQuickEnvConfig(rootPath);
		const explicitTargets = quickConfig?.cloudSync?.envTargets;

		if (explicitTargets && explicitTargets.length > 0) {
			return this.applyKeyPrefixes(this.normalizeTargets(rootPath, explicitTargets));
		}

		const discoveredFiles = await this.collectEnvFilesForConfig(rootPath, dopplerConfig, quickConfig);
		if (discoveredFiles.length > 1) {
			return this.applyKeyPrefixes(this.buildAutoTargets(rootPath, discoveredFiles));
		}

		if (discoveredFiles.length === 1) {
			return this.applyKeyPrefixes(discoveredFiles);
		}

		return this.applyKeyPrefixes(await this.resolveFallbackSingleTarget(rootPath, dopplerConfig));
	}

	private static async resolveFallbackSingleTarget(
		rootPath: string,
		dopplerConfig?: string
	): Promise<ResolvedSyncTarget[]> {
		const rootEnvPath = path.join(rootPath, '.env');
		if (fs.existsSync(rootEnvPath)) {
			return [{
				file: '.env',
				absolutePath: rootEnvPath,
				keyPrefix: '',
				prefixes: [],
				catchAll: true,
				label: 'local'
			}];
		}

		const provider = new EnvironmentProvider(rootPath);
		const environments = await provider.getEnvironments().then(envs =>
			envs.filter(env => fs.existsSync(env.filePath))
		);

		if (environments.length === 0) {
			return [];
		}

		const current = await provider.getCurrentEnvironment();
		if (current && fs.existsSync(current.filePath)) {
			const resolved = this.toResolvedEnvFile(rootPath, current);
			return [{
				file: resolved.relativePath,
				absolutePath: resolved.envPath,
				keyPrefix: '',
				prefixes: [],
				catchAll: true,
				label: resolved.envName
			}];
		}

		if (dopplerConfig) {
			const matched = environments.filter(env => this.environmentMatchesConfig(env, dopplerConfig));
			if (matched.length === 1) {
				const resolved = this.toResolvedEnvFile(rootPath, matched[0]);
				return [{
					file: resolved.relativePath,
					absolutePath: resolved.envPath,
					keyPrefix: '',
					prefixes: [],
					catchAll: true,
					label: resolved.envName
				}];
			}
			if (matched.length > 1) {
				return this.buildAutoTargets(
					rootPath,
					matched.map(env => {
						const resolved = this.toResolvedEnvFile(rootPath, env);
						return {
							file: resolved.relativePath,
							absolutePath: resolved.envPath,
							keyPrefix: '',
							prefixes: [],
							catchAll: false,
							label: resolved.envName
						};
					})
				);
			}
		}

		if (environments.length === 1) {
			const resolved = this.toResolvedEnvFile(rootPath, environments[0]);
			return [{
				file: resolved.relativePath,
				absolutePath: resolved.envPath,
				keyPrefix: '',
				prefixes: [],
				catchAll: true,
				label: resolved.envName
			}];
		}

		const selected = await vscode.window.showQuickPick(
			environments.map(env => ({
				label: env.name,
				description: env.fileName,
				env
			})),
			{ placeHolder: 'Select environment file to sync with cloud' }
		);

		if (!selected) {
			return [];
		}

		const resolved = this.toResolvedEnvFile(rootPath, selected.env);
		return [{
			file: resolved.relativePath,
			absolutePath: resolved.envPath,
			keyPrefix: '',
			prefixes: [],
			catchAll: true,
			label: resolved.envName
		}];
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

	static formatEnvFileContent(secrets: CloudSecrets): string {
		return Object.entries(secrets)
			.map(([key, value]) => `${key}=${value}`)
			.join('\n') + (Object.keys(secrets).length > 0 ? '\n' : '');
	}

	static async writeSecretsToTargets(
		targets: ResolvedSyncTarget[],
		cloudSecrets: CloudSecrets
	): Promise<string[]> {
		const splitSecrets = this.splitSecretsAcrossTargets(cloudSecrets, targets, '');
		const writtenFiles: string[] = [];

		for (const target of targets) {
			const secrets = splitSecrets.get(target.file) ?? {};
			await this.backupEnvFile(target.absolutePath);
			await fs.promises.mkdir(path.dirname(target.absolutePath), { recursive: true });
			await fs.promises.writeFile(
				target.absolutePath,
				this.formatEnvFileContent(secrets),
				'utf8'
			);
			writtenFiles.push(target.file);
		}

		return writtenFiles;
	}

	static async resolveEnvFileForSync(
		rootPath: string,
		dopplerConfig?: string
	): Promise<ResolvedEnvFile | null> {
		const targets = await this.resolveSyncTargets(rootPath, dopplerConfig);
		if (targets.length === 1) {
			return {
				envPath: targets[0].absolutePath,
				envName: targets[0].label,
				relativePath: targets[0].file
			};
		}

		if (targets.length > 1) {
			return null;
		}

		const rootEnvPath = path.join(rootPath, '.env');
		if (fs.existsSync(rootEnvPath)) {
			const provider = new EnvironmentProvider(rootPath);
			const current = await provider.getCurrentEnvironment();
			return {
				envPath: rootEnvPath,
				envName: current?.name ?? 'local',
				relativePath: '.env'
			};
		}

		const provider = new EnvironmentProvider(rootPath);
		const environments = await provider.getEnvironments().then(envs =>
			envs.filter(env => fs.existsSync(env.filePath))
		);

		if (environments.length === 0) {
			return null;
		}

		const current = await provider.getCurrentEnvironment();
		if (current && fs.existsSync(current.filePath)) {
			return this.toResolvedEnvFile(rootPath, current);
		}

		if (dopplerConfig) {
			const matched = this.findEnvironmentForConfig(environments, dopplerConfig);
			if (matched) {
				return this.toResolvedEnvFile(rootPath, matched);
			}
		}

		if (environments.length === 1) {
			return this.toResolvedEnvFile(rootPath, environments[0]);
		}

		const selected = await vscode.window.showQuickPick(
			environments.map(env => ({
				label: env.name,
				description: env.fileName,
				env
			})),
			{ placeHolder: 'Select environment file to sync with cloud' }
		);

		if (!selected) {
			return null;
		}

		return this.toResolvedEnvFile(rootPath, selected.env);
	}

	static parseEnvFile(envPath: string): CloudSecrets {
		const secrets: CloudSecrets = {};

		if (!fs.existsSync(envPath)) {
			return secrets;
		}

		const envContent = fs.readFileSync(envPath, 'utf8');
		for (const line of envContent.split('\n')) {
			const trimmed = line.trim();
			if (!trimmed || trimmed.startsWith('#')) {
				continue;
			}

			const equalIndex = trimmed.indexOf('=');
			if (equalIndex === -1) {
				continue;
			}

			const key = trimmed.substring(0, equalIndex).trim();
			const value = trimmed.substring(equalIndex + 1);
			if (key) {
				secrets[key] = value;
			}
		}

		return secrets;
	}

	static async backupEnvFile(envPath: string): Promise<void> {
		if (!fs.existsSync(envPath)) {
			return;
		}

		await fs.promises.copyFile(envPath, `${envPath}.backup`);
	}

	private static normalizeTargets(rootPath: string, targets: EnvSyncTarget[]): ResolvedSyncTarget[] {
		return targets.map(target => ({
			file: target.file.replace(/\\/g, '/'),
			absolutePath: path.join(rootPath, target.file),
			keyPrefix: target.keyPrefix ?? '',
			prefixes: target.prefixes ?? [],
			catchAll: !!target.catchAll,
			label: target.label ?? path.basename(target.file)
		}));
	}

	private static applyKeyPrefixes(targets: ResolvedSyncTarget[]): ResolvedSyncTarget[] {
		if (targets.length <= 1) {
			return targets.map(target => ({ ...target, keyPrefix: '' }));
		}

		return targets.map(target => ({
			...target,
			keyPrefix: target.keyPrefix || this.deriveKeyPrefix(target.file)
		}));
	}

	private static deriveKeyPrefix(file: string): string {
		const normalized = file.replace(/\\/g, '/');
		const parent = path.dirname(normalized);
		if (!parent || parent === '.') {
			return '';
		}

		const folder = path.basename(parent).toLowerCase();
		if (folder === 'backend') {
			return 'BACKEND_';
		}
		if (['frontend', 'client', 'web', 'ui', 'app'].includes(folder)) {
			return 'FRONTEND_';
		}

		return `${folder.toUpperCase()}_`;
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

	private static async collectEnvFilesForConfig(
		rootPath: string,
		dopplerConfig: string | undefined,
		_config: QuickEnvConfig | null
	): Promise<ResolvedSyncTarget[]> {
		const provider = new EnvironmentProvider(rootPath);
		let environments = await provider.getEnvironments();
		environments = environments.filter(env => fs.existsSync(env.filePath));

		if (dopplerConfig) {
			const matched = environments.filter(env => this.environmentMatchesConfig(env, dopplerConfig));
			if (matched.length > 0) {
				environments = matched;
			}
		}

		const uniquePaths = new Map<string, Environment>();
		for (const env of environments) {
			const relativePath = path.relative(rootPath, env.filePath).replace(/\\/g, '/');
			if (relativePath === '.env' && environments.length > 1) {
				continue;
			}
			if (!uniquePaths.has(relativePath)) {
				uniquePaths.set(relativePath, env);
			}
		}

		const files = Array.from(uniquePaths.entries()).map(([relativePath, env]) => ({
			file: relativePath,
			absolutePath: env.filePath,
			keyPrefix: '',
			prefixes: [] as string[],
			catchAll: false,
			label: env.name
		}));

		if (files.length > 1) {
			return this.buildAutoTargets(rootPath, files);
		}

		return files;
	}

	private static buildAutoTargets(
		rootPath: string,
		files: ResolvedSyncTarget[]
	): ResolvedSyncTarget[] {
		const frontendFiles = files.filter(file => AUTO_FRONTEND_PATH_PATTERN.test(file.file));
		const backendFiles = files.filter(file => !AUTO_FRONTEND_PATH_PATTERN.test(file.file));

		if (frontendFiles.length === 0 || backendFiles.length === 0) {
			return files.map((file, index) => ({
				...file,
				prefixes: index === 0 ? [] : AUTO_FRONTEND_PREFIXES,
				catchAll: index === 0
			}));
		}

		return files.map(file => {
			const isFrontend = frontendFiles.some(frontend => frontend.file === file.file);
			return {
				...file,
				prefixes: isFrontend ? [...AUTO_FRONTEND_PREFIXES] : [],
				catchAll: !isFrontend
			};
		});
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

	private static environmentMatchesConfig(env: Environment, dopplerConfig: string): boolean {
		const aliases = CONFIG_ENV_ALIASES[dopplerConfig.toLowerCase()] ?? [dopplerConfig.toLowerCase()];
		const envName = env.name.toLowerCase();
		const fileName = path.basename(env.filePath).toLowerCase();

		return aliases.some(alias => {
			if (envName === alias || envName.endsWith(`-${alias}`)) {
				return true;
			}

			return fileName === `.env.${alias}` || fileName === `.env.${alias}.local`;
		});
	}

	private static findEnvironmentForConfig(
		environments: Environment[],
		dopplerConfig: string
	): Environment | undefined {
		return environments.find(env => this.environmentMatchesConfig(env, dopplerConfig));
	}

	private static toResolvedEnvFile(rootPath: string, env: Environment): ResolvedEnvFile {
		return {
			envPath: env.filePath,
			envName: env.name,
			relativePath: path.relative(rootPath, env.filePath).replace(/\\/g, '/')
		};
	}
}

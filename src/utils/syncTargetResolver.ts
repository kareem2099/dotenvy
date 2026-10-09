/**
 * Resolves which environment files a Doppler config should sync.
 */

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { Environment, EnvSyncTarget, QuickEnvConfig } from '../types/environment';
import { EnvironmentProvider } from '../providers/environmentProvider';
import { ConfigUtils } from './configUtils';
import type { ResolvedEnvFile, ResolvedSyncTarget } from './envSyncUtils';
import { t } from '../i18n';

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

/**
 * Maps an environment file path to the sync record used by cloud pull and push.
 */
export function toResolvedEnvFile(rootPath: string, env: Environment): ResolvedEnvFile {
	return {
		envPath: env.filePath,
		envName: env.name,
		relativePath: path.relative(rootPath, env.filePath).replace(/\\/g, '/')
	};
}

function environmentMatchesConfig(env: Environment, dopplerConfig: string): boolean {
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

/**
 * Finds the environment whose name or filename matches a Doppler config.
 */
export function findEnvironmentForConfig(
	environments: Environment[],
	dopplerConfig: string
): Environment | undefined {
	return environments.find(env => environmentMatchesConfig(env, dopplerConfig));
}

function normalizeTargets(rootPath: string, targets: EnvSyncTarget[]): ResolvedSyncTarget[] {
	return targets.map(target => ({
		file: target.file.replace(/\\/g, '/'),
		absolutePath: path.join(rootPath, target.file),
		keyPrefix: target.keyPrefix ?? '',
		prefixes: target.prefixes ?? [],
		catchAll: !!target.catchAll,
		label: target.label ?? path.basename(target.file)
	}));
}

function deriveKeyPrefix(file: string): string {
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

function applyKeyPrefixes(targets: ResolvedSyncTarget[]): ResolvedSyncTarget[] {
	if (targets.length <= 1) {
		return targets.map(target => ({ ...target, keyPrefix: '' }));
	}

	return targets.map(target => ({
		...target,
		keyPrefix: target.keyPrefix || deriveKeyPrefix(target.file)
	}));
}

function buildAutoTargets(
	_rootPath: string,
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

async function collectEnvFilesForConfig(
	rootPath: string,
	dopplerConfig: string | undefined,
	_config: QuickEnvConfig | null
): Promise<ResolvedSyncTarget[]> {
	const provider = new EnvironmentProvider(rootPath);
	let environments = await provider.getEnvironments();
	environments = environments.filter(env => fs.existsSync(env.filePath));

	if (dopplerConfig) {
		const matched = environments.filter(env => environmentMatchesConfig(env, dopplerConfig));
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
		return buildAutoTargets(rootPath, files);
	}

	return files;
}

async function resolveFallbackSingleTarget(
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
		const resolved = toResolvedEnvFile(rootPath, current);
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
		const matched = environments.filter(env => environmentMatchesConfig(env, dopplerConfig));
		if (matched.length === 1) {
			const resolved = toResolvedEnvFile(rootPath, matched[0]);
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
			return buildAutoTargets(
				rootPath,
				matched.map(env => {
					const resolved = toResolvedEnvFile(rootPath, env);
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
		const resolved = toResolvedEnvFile(rootPath, environments[0]);
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
		{ placeHolder: t('envSwitch.syncFilePlaceholder') }
	);

	if (!selected) {
		return [];
	}

	const resolved = toResolvedEnvFile(rootPath, selected.env);
	return [{
		file: resolved.relativePath,
		absolutePath: resolved.envPath,
		keyPrefix: '',
		prefixes: [],
		catchAll: true,
		label: resolved.envName
	}];
}

/**
 * Chooses the environment files and key prefixes for a cloud sync.
 */
export async function resolveSyncTargets(
	rootPath: string,
	dopplerConfig?: string,
	config?: QuickEnvConfig | null
): Promise<ResolvedSyncTarget[]> {
	const quickConfig = config ?? await ConfigUtils.readQuickEnvConfig(rootPath);
	const explicitTargets = quickConfig?.cloudSync?.envTargets;

	if (explicitTargets && explicitTargets.length > 0) {
		return applyKeyPrefixes(normalizeTargets(rootPath, explicitTargets));
	}

	const discoveredFiles = await collectEnvFilesForConfig(rootPath, dopplerConfig, quickConfig);
	if (discoveredFiles.length > 1) {
		return applyKeyPrefixes(buildAutoTargets(rootPath, discoveredFiles));
	}

	if (discoveredFiles.length === 1) {
		return applyKeyPrefixes(discoveredFiles);
	}

	return applyKeyPrefixes(await resolveFallbackSingleTarget(rootPath, dopplerConfig));
}

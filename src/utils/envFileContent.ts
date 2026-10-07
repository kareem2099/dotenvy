/**
 * Reads, writes, and backs up plaintext environment files during cloud sync.
 */

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { EnvironmentProvider } from '../providers/environmentProvider';
import { CloudSecrets } from './cloudSyncManager';
import { EnvSyncUtils, ResolvedEnvFile, ResolvedSyncTarget } from './envSyncUtils';
import { findEnvironmentForConfig, resolveSyncTargets, toResolvedEnvFile } from './syncTargetResolver';

/**
 * Serializes secrets as KEY=value lines.
 */
export function formatEnvFileContent(secrets: CloudSecrets): string {
	return Object.entries(secrets)
		.map(([key, value]) => `${key}=${value}`)
		.join('\n') + (Object.keys(secrets).length > 0 ? '\n' : '');
}

/**
 * Parses a plaintext env file into a secret map. Missing files yield an empty map.
 */
export function parseEnvFile(envPath: string): CloudSecrets {
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

/**
 * Copies an environment file to a sibling `.backup` before it is overwritten.
 */
export async function backupEnvFile(envPath: string): Promise<void> {
	if (!fs.existsSync(envPath)) {
		return;
	}

	await fs.promises.copyFile(envPath, `${envPath}.backup`);
}

/**
 * Splits cloud secrets across targets and writes each file, backing up first.
 */
export async function writeSecretsToTargets(
	targets: ResolvedSyncTarget[],
	cloudSecrets: CloudSecrets
): Promise<string[]> {
	const splitSecrets = EnvSyncUtils.splitSecretsAcrossTargets(cloudSecrets, targets, '');
	const writtenFiles: string[] = [];

	for (const target of targets) {
		const secrets = splitSecrets.get(target.file) ?? {};
		await backupEnvFile(target.absolutePath);
		await fs.promises.mkdir(path.dirname(target.absolutePath), { recursive: true });
		await fs.promises.writeFile(
			target.absolutePath,
			formatEnvFileContent(secrets),
			'utf8'
		);
		writtenFiles.push(target.file);
	}

	return writtenFiles;
}

/**
 * Resolves the single environment file a sync should use, or null when the user must pick among several.
 */
export async function resolveEnvFileForSync(
	rootPath: string,
	dopplerConfig?: string
): Promise<ResolvedEnvFile | null> {
	const targets = await resolveSyncTargets(rootPath, dopplerConfig);
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
		return toResolvedEnvFile(rootPath, current);
	}

	if (dopplerConfig) {
		const matched = findEnvironmentForConfig(environments, dopplerConfig);
		if (matched) {
			return toResolvedEnvFile(rootPath, matched);
		}
	}

	if (environments.length === 1) {
		return toResolvedEnvFile(rootPath, environments[0]);
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

	return toResolvedEnvFile(rootPath, selected.env);
}

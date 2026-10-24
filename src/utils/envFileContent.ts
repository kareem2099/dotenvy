/**
 * Reads, writes, and backs up plaintext environment files during cloud sync.
 */

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { EnvironmentProvider } from '../providers/environmentProvider';
import { CloudSecrets } from './cloudSyncManager';
import { EnvSyncUtils, ResolvedEnvFile, ResolvedSyncTarget } from './envSyncUtils';
import { isRegularEnvFile } from './environmentDiscovery';
import { findEnvironmentForConfig, resolveSyncTargets, toResolvedEnvFile } from './syncTargetResolver';
import { t } from '../i18n';

/**
 * Serializes secrets as KEY=value lines.
 */
export function formatEnvFileContent(secrets: CloudSecrets): string {
	return Object.entries(secrets)
		.map(([key, value]) => `${key}=${value}`)
		.join('\n') + (Object.keys(secrets).length > 0 ? '\n' : '');
}

interface EnvAssignment {
	key: string;
	prefix: string;
	separator: string;
	value: string;
	lastLine: number;
}

/** Read a complete assignment, including quoted multiline values. */
function readAssignment(lines: string[], firstLine: number): EnvAssignment | null {
	const match = lines[firstLine].match(/^(\s*(?:export\s+)?)([A-Za-z_][A-Za-z0-9_]*)(\s*=\s*)(.*)$/);
	if (!match) return null;
	let value = match[4];
	let lastLine = firstLine;
	const quote = value[0];
	if (quote === '"' || quote === "'" || quote === '`') {
		let cursor = 1;
		let closed = false;
		while (!closed) {
			for (; cursor < value.length; cursor++) {
				if (value[cursor] === '\\' && quote !== "'") { cursor++; continue; }
				if (value[cursor] === quote) { closed = true; break; }
			}
			if (closed || lastLine + 1 >= lines.length) break;
			value += '\n' + lines[++lastLine];
		}
	}
	return { key: match[2], prefix: match[1], separator: match[3], value, lastLine };
}

function inlineComment(value: string): string {
	let quote: string | undefined;
	for (let i = 0; i < value.length; i++) {
		const char = value[i];
		if (quote) {
			if (char === '\\' && quote !== "'") { i++; continue; }
			if (char === quote) quote = undefined;
		} else if (i === 0 && (char === '"' || char === "'" || char === '`')) {
			quote = char;
		} else if (char === '#') {
			const whitespace = value.slice(0, i).match(/\s*$/)?.[0] ?? '';
			return whitespace + value.slice(i);
		}
	}
	return '';
}

/** Update complete assignments while keeping comments, spacing and key order. */
export function mergeEnvFileContent(existingContent: string, secrets: CloudSecrets): string {
	if (!existingContent.trim()) return formatEnvFileContent(secrets);
	const newline = existingContent.includes('\r\n') ? '\r\n' : '\n';
	const lines = existingContent.split(/\r?\n/);
	const remaining = new Set(Object.keys(secrets));
	const output: string[] = [];
	for (let index = 0; index < lines.length; index++) {
		const assignment = readAssignment(lines, index);
		if (!assignment) { output.push(lines[index]); continue; }
		index = assignment.lastLine;
		if (!Object.prototype.hasOwnProperty.call(secrets, assignment.key)) continue;
		remaining.delete(assignment.key);
		const value = secrets[assignment.key];
		// A value read from a local file may already include its inline comment.
		const suffix = inlineComment(value) ? '' : inlineComment(assignment.value);
		output.push(`${assignment.prefix}${assignment.key}${assignment.separator}${value}${suffix}`.replace(/\r?\n/g, newline));
	}
	if (remaining.size && output.length && output[output.length - 1] !== '') output.push('');
	for (const key of remaining) output.push(`${key}=${secrets[key]}`.replace(/\r?\n/g, newline));
	const text = output.join(newline);
	return text && !text.endsWith(newline) ? text + newline : text;
}

/** Read raw env value syntax so cloud round trips preserve quotes and multiline values. */
export function parseEnvFile(envPath: string): CloudSecrets {
	const envContent = readEnvFileIfPresent(envPath);
	if (envContent === null) return {};
	const secrets: CloudSecrets = {};
	const lines = envContent.split(/\r?\n/);
	for (let index = 0; index < lines.length; index++) {
		const assignment = readAssignment(lines, index);
		if (!assignment) continue;
		secrets[assignment.key] = assignment.value;
		index = assignment.lastLine;
	}
	return secrets;
}

/**
 * Copies an environment file to a sibling `.backup` before it is overwritten.
 */
export async function backupEnvFile(envPath: string): Promise<void> {
	if (!isRegularEnvFile(envPath)) {
		return;
	}

	await fs.promises.copyFile(envPath, `${envPath}.backup`);
}

async function writeTextFile(filePath: string, content: string): Promise<void> {
	let lastError: unknown;
	for (let attempt = 0; attempt < 3; attempt++) {
		try {
			await writeTextFileOnce(filePath, content);
			return;
		} catch (error) {
			lastError = error;
			const code = (error as NodeJS.ErrnoException).code;
			if ((code !== 'EPERM' && code !== 'EACCES') || attempt === 2) {
				throw error;
			}
			await clearReadOnlyAttribute(filePath);
			await new Promise(resolve => setTimeout(resolve, 40 * (attempt + 1)));
		}
	}

	throw lastError;
}

/**
 * Replaces an existing file in place. `writeFile` on Windows returns EPERM
 * when the target is hidden, which is how many `.env` files are stored.
 */
async function writeTextFileOnce(filePath: string, content: string): Promise<void> {
	let handle: fs.promises.FileHandle;
	try {
		handle = await fs.promises.open(filePath, 'r+');
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
			await fs.promises.writeFile(filePath, content, 'utf8');
			return;
		}
		throw error;
	}

	try {
		await handle.truncate(0);
		await handle.writeFile(content, 'utf8');
	} finally {
		await handle.close();
	}
}

async function clearReadOnlyAttribute(filePath: string): Promise<void> {
	try {
		if (process.platform === 'win32') {
			await fs.promises.chmod(filePath, 0o666);
			return;
		}
		const stats = await fs.promises.stat(filePath);
		await fs.promises.chmod(filePath, stats.mode | 0o200);
	} catch (error) {
		const code = (error as NodeJS.ErrnoException).code;
		if (code === 'ENOENT') {
			return;
		}
		throw error;
	}
}

/** Returns null for a missing path or one that is not a regular file (e.g. a `.env` directory). */
function readEnvFileIfPresent(envPath: string): string | null {
	let stats: fs.Stats;
	try {
		stats = fs.statSync(envPath);
	} catch (error) {
		const code = (error as NodeJS.ErrnoException).code;
		if (code === 'ENOENT' || code === 'ENOTDIR') {
			return null;
		}
		throw error;
	}

	if (!stats.isFile()) {
		return null;
	}

	try {
		return fs.readFileSync(envPath, 'utf8');
	} catch (error) {
		const code = (error as NodeJS.ErrnoException).code;
		if (code === 'ENOENT') {
			return null;
		}
		throw error;
	}
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
		let content = formatEnvFileContent(secrets);
		const existing = readEnvFileIfPresent(target.absolutePath);
		if (existing !== null) {
			content = mergeEnvFileContent(existing, secrets);
		}
		await writeTextFile(target.absolutePath, content);
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
		{ placeHolder: t('envSwitch.syncFilePlaceholder') }
	);

	if (!selected) {
		return null;
	}

	return toResolvedEnvFile(rootPath, selected.env);
}

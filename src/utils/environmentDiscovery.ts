/**
 * Walks a workspace for environment files and maps them to environment names.
 */

import * as fs from 'fs';
import * as path from 'path';
import { logger } from './logger';

const SKIPPED_DIRS = new Set([
	'node_modules', '.git', 'dist', 'build', 'out', '.venv', '.next', 'coverage', '__pycache__'
]);

const EXCLUDED_ENV_SUFFIXES = new Set(['backup', 'example', 'template']);

/**
 * Returns a name-to-relative-path map of environment files under the workspace.
 */
export async function discoverEnvironments(rootPath: string): Promise<Record<string, string>> {
	const discovered = await discoverEnvironmentEntries(rootPath);
	return buildEnvironmentMap(discovered);
}

/**
 * Returns discovered environment files with name, relative path, and absolute path.
 */
export async function discoverEnvironmentEntries(
	rootPath: string
): Promise<Array<{ name: string; relativePath: string; absolutePath: string }>> {
	const discovered: Array<{ name: string; relativePath: string }> = [];

	try {
		const absolutePaths = await findEnvironmentFiles(rootPath);
		for (const absolutePath of absolutePaths) {
			const relativePath = path.relative(rootPath, absolutePath).replace(/\\/g, '/');
			const parsed = parseEnvironmentFile(relativePath);
			if (!parsed) {
				continue;
			}

			discovered.push({
				name: parsed.name,
				relativePath
			});
		}
	} catch (error) {
		logger.warn(`Failed to discover environments: ${error}`, 'ConfigUtils');
	}

	return discovered.map(entry => ({
		...entry,
		absolutePath: path.join(rootPath, entry.relativePath)
	}));
}

async function findEnvironmentFiles(rootPath: string): Promise<string[]> {
	const results: string[] = [];
	await walkForEnvironmentFiles(rootPath, results);
	return results.sort();
}

async function walkForEnvironmentFiles(currentDir: string, results: string[]): Promise<void> {
	let entries: fs.Dirent[];

	try {
		entries = await fs.promises.readdir(currentDir, { withFileTypes: true });
	} catch {
		return;
	}

	for (const entry of entries) {
		const entryPath = path.join(currentDir, entry.name);

		if (entry.isDirectory()) {
			if (SKIPPED_DIRS.has(entry.name)) {
				continue;
			}
			await walkForEnvironmentFiles(entryPath, results);
			continue;
		}

		if (!entry.isFile()) {
			continue;
		}

		if (entry.name === '.env' || entry.name.startsWith('.env.')) {
			results.push(entryPath);
		}
	}
}

function parseEnvironmentFile(relativePath: string): { name: string } | null {
	const fileName = path.basename(relativePath);
	const parentDir = path.dirname(relativePath).replace(/\\/g, '/');

	if (fileName.startsWith('.env.')) {
		const envName = fileName.substring(5);
		if (!envName || EXCLUDED_ENV_SUFFIXES.has(envName.toLowerCase())) {
			return null;
		}
		return { name: envName };
	}

	if (fileName === '.env' && parentDir && parentDir !== '.') {
		const folderName = path.basename(parentDir);
		return { name: `${folderName}-local` };
	}

	return null;
}

function isDirectory(filePath: string): boolean {
	try {
		return fs.statSync(filePath).isDirectory();
	} catch {
		return false;
	}
}

/**
 * Returns true when the path is a regular file.
 * Missing paths and unreadable paths are not regular files.
 */
export function isRegularEnvFile(filePath: string): boolean {
	try {
		return fs.statSync(filePath).isFile();
	} catch {
		return false;
	}
}

/**
 * Missing env files can be created. Directories cannot be overwritten.
 */
export function isCreatableEnvPath(filePath: string): boolean {
	return !isDirectory(filePath);
}

/**
 * Walks up to the git root looking for `.dotenvy.json`.
 * Paths inside that file are relative to the directory that contains it.
 */
export function findDotenvyConfigRoot(startPath: string): string {
	const start = path.resolve(startPath);
	let current = start;

	while (true) {
		if (fs.existsSync(path.join(current, '.dotenvy.json'))) {
			return current;
		}

		const parent = path.dirname(current);
		if (parent === current || fs.existsSync(path.join(current, '.git'))) {
			return start;
		}

		current = parent;
	}
}

function dedupeWorkspaceFolderPrefix(rootPath: string, relativeFile: string): string | null {
	const parts = relativeFile.split('/').filter(part => part && part !== '.');
	if (parts.length < 2) {
		return null;
	}

	if (parts[0].toLowerCase() !== path.basename(rootPath).toLowerCase()) {
		return null;
	}

	return path.join(rootPath, ...parts.slice(1));
}

/**
 * Resolves a configured env path against the workspace.
 * A workspace already opened at `backend` must not turn `backend/.env`
 * into `backend/backend/.env` when that nested file is not present.
 */
export function resolveConfiguredEnvPath(rootPath: string, relativeFile: string): string {
	const normalized = relativeFile.replace(/\\/g, '/').replace(/^\.\//, '');
	if (path.isAbsolute(relativeFile) || path.isAbsolute(normalized)) {
		return relativeFile;
	}

	const direct = path.join(rootPath, normalized);
	if (isRegularEnvFile(direct)) {
		return direct;
	}

	const alternatives: string[] = [];
	const configRoot = findDotenvyConfigRoot(rootPath);
	if (path.resolve(configRoot) !== path.resolve(rootPath)) {
		alternatives.push(path.join(configRoot, normalized));
	}

	const deduped = dedupeWorkspaceFolderPrefix(rootPath, normalized);
	if (deduped && !alternatives.includes(deduped)) {
		alternatives.push(deduped);
	}

	for (const candidate of alternatives) {
		if (isRegularEnvFile(candidate)) {
			return candidate;
		}
	}

	for (const candidate of alternatives) {
		if (!isDirectory(candidate)) {
			return candidate;
		}
	}

	if (!isDirectory(direct)) {
		return direct;
	}

	return alternatives[0] ?? direct;
}

/**
 * Relative name used by the panel. Absolute when the file sits outside the workspace,
 * because `path.join` keeps an absolute second segment on Windows.
 */
export function envFileNameForWorkspace(rootPath: string, filePath: string): string {
	const relative = path.relative(rootPath, filePath);
	if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
		return filePath;
	}

	return relative.replace(/\\/g, '/');
}

function buildEnvironmentMap(
	discovered: Array<{ name: string; relativePath: string }>
): Record<string, string> {
	const nameCounts = new Map<string, number>();

	for (const entry of discovered) {
		nameCounts.set(entry.name, (nameCounts.get(entry.name) ?? 0) + 1);
	}

	const environments: Record<string, string> = {};

	for (const entry of discovered) {
		let key = entry.name;

		if ((nameCounts.get(entry.name) ?? 0) > 1) {
			const parentDir = path.basename(path.dirname(entry.relativePath));
			key = parentDir && parentDir !== '.' ? `${parentDir}-${entry.name}` : entry.name;
		}

		environments[key] = entry.relativePath;
	}

	return environments;
}

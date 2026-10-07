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

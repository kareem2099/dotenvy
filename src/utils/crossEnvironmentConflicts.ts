/**
 * Finds keys that have more than one distinct value across environment files.
 * A missing key is not a conflict. The last value of a repeated key wins.
 */

export interface EnvironmentFileContent {
	name: string;
	relativePath: string;
	content: string;
}

export interface ValueOccurrence {
	name: string;
	relativePath: string;
	value: string;
}

export interface ValueConflict {
	key: string;
	occurrences: ValueOccurrence[];
}

/**
 * Parses plaintext env content. Blank lines, comments, and lines without "=" are skipped.
 */
function parseEnvContent(content: string): Record<string, string> {
	const secrets: Record<string, string> = {};

	for (const line of content.split('\n')) {
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
 * Returns keys present in at least two files whose distinct values are more than one.
 */
export function findValueConflicts(files: EnvironmentFileContent[]): ValueConflict[] {
	const byKey = new Map<string, ValueOccurrence[]>();

	for (const file of files) {
		const parsed = parseEnvContent(file.content);
		for (const [key, value] of Object.entries(parsed)) {
			const occurrences = byKey.get(key) ?? [];
			occurrences.push({
				name: file.name,
				relativePath: file.relativePath,
				value,
			});
			byKey.set(key, occurrences);
		}
	}

	const conflicts: ValueConflict[] = [];
	for (const [key, occurrences] of byKey) {
		if (occurrences.length < 2) {
			continue;
		}
		const distinctValues = new Set(occurrences.map(occurrence => occurrence.value));
		if (distinctValues.size > 1) {
			conflicts.push({ key, occurrences });
		}
	}

	return conflicts;
}

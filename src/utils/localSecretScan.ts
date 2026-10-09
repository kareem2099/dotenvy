/**
 * Synchronous local secret scan: pattern match, then entropy. No network.
 */

import { EntropyAnalyzer } from './entropyAnalyzer';
import { PatternRegistry } from './patternRegistry';

export interface LocalSecretSpan {
	line: number;
	start: number;
	end: number;
	type: string;
}

const MAX_LINE_LENGTH = 500;

function globalCopy(regex: RegExp): RegExp {
	const flags = regex.flags.includes('g') ? regex.flags : `${regex.flags}g`;
	return new RegExp(regex.source, flags);
}

/**
 * Returns every pattern hit on lines up to 500 characters that also looks like a secret.
 * The same span can appear once per matching pattern. Line numbers are 1-based.
 */
export function scanText(text: string): LocalSecretSpan[] {
	const spans: LocalSecretSpan[] = [];
	const lines = text.split('\n');

	for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
		const line = lines[lineIndex];
		if (line.length > MAX_LINE_LENGTH) {
			continue;
		}

		for (const pattern of PatternRegistry.getPatterns()) {
			const regex = globalCopy(pattern.regex);
			for (const match of line.matchAll(regex)) {
				const secretValue = match[0];
				if (secretValue.length === 0 || !EntropyAnalyzer.isLikelySecret(secretValue)) {
					continue;
				}
				const start = match.index ?? 0;
				spans.push({
					line: lineIndex + 1,
					start,
					end: start + secretValue.length,
					type: pattern.type,
				});
			}
		}
	}

	return spans;
}

/**
 * DotenvyIgnore
 * =============
 * Reads .dotenvyignore from workspace root and matches file paths against it.
 *
 * Syntax (same as .gitignore):
 *   - Lines starting with # are comments
 *   - Blank lines are ignored
 *   - * matches anything except /
 *   - ** matches anything including /
 *   - Trailing / means directory only
 *   - ! prefix negates a pattern (un-ignore)
 *
 * Example .dotenvyignore:
 *   # DotEnvy own files
 *   .dotenvy/**
 *
 *   # Test files
 *   **\/*.test.ts
 *   **\/*.spec.ts
 *
 *   # Docs with example secrets
 *   docs/**
 *   README.md
 *   SECURITY.md
 *
 *   # Specific files
 *   k8s/secrets.yaml
 */

import * as fs   from 'fs';
import * as path from 'path';
import { logger } from './logger';

// ─── Types ─────────────────────────────────────────────────────────────────────

interface ParsedPattern {
    raw:    string;
    negate: boolean;
    regex:  RegExp;
}

// ─── DotenvyIgnore ─────────────────────────────────────────────────────────────

export class DotenvyIgnore {

    public static readonly FILENAME = '.dotenvyignore';

    /** Default content written when user runs "Init .dotenvyignore" */
    public static readonly DEFAULT_CONTENT = `# .dotenvyignore
# ================
# Files and folders DotEnvy will NOT scan for secrets.
# Syntax is identical to .gitignore.
#
# Lines starting with # are comments.
# Use * to match within a folder, ** to match across folders.
# Prefix with ! to un-ignore a previously ignored pattern.

# ── DotEnvy's own data ───────────────────────────────────────────────────────
.dotenvy/**
.dotenvy-backups/**

# ── Build output ─────────────────────────────────────────────────────────────
out/**
dist/**
build/**

# ── Test files (often contain example/fake secrets) ──────────────────────────
**/*.test.ts
**/*.test.js
**/*.spec.ts
**/*.spec.js
tests/**
test/**
__tests__/**

# ── Documentation (example secrets in docs are expected) ─────────────────────
docs/**
README.md
CHANGELOG.md
SECURITY.md
*.md

# ── CI / deployment config ───────────────────────────────────────────────────
.github/**
k8s/**
helm/**
docker-compose*.yml

# ── Lock files ────────────────────────────────────────────────────────────────
package-lock.json
yarn.lock
pnpm-lock.yaml
`;

    // ─── Cache ────────────────────────────────────────────────────────────────

    private static cache = new Map<string, {
        patterns:  ParsedPattern[];
        mtime:     number;
    }>();

    // ─── Public API ───────────────────────────────────────────────────────────

    /**
     * Returns true if the file should be SKIPPED (is ignored).
     */
    public static shouldIgnore(filePath: string, rootPath: string): boolean {
        const patterns = DotenvyIgnore.loadPatterns(rootPath);
        if (patterns.length === 0) { return false; }

        const relative = path.relative(rootPath, filePath).replace(/\\/g, '/');

        let ignored = false;

        for (const p of patterns) {
            if (p.negate) {
                // Negation: un-ignore if it matched a previous ignore
                if (ignored && DotenvyIgnore.matchPattern(relative, p.regex)) {
                    ignored = false;
                }
            } else {
                if (DotenvyIgnore.matchPattern(relative, p.regex)) {
                    ignored = true;
                }
            }
        }

        return ignored;
    }

    /**
     * Check if .dotenvyignore exists in the workspace.
     */
    public static exists(rootPath: string): boolean {
        return fs.existsSync(path.join(rootPath, DotenvyIgnore.FILENAME));
    }

    /**
     * Create default .dotenvyignore in workspace root.
     * Returns false if file already exists.
     */
    public static createDefault(rootPath: string): boolean {
        const filePath = path.join(rootPath, DotenvyIgnore.FILENAME);
        if (fs.existsSync(filePath)) { return false; }
        fs.writeFileSync(filePath, DotenvyIgnore.DEFAULT_CONTENT, 'utf8');
        logger.info(`Created ${DotenvyIgnore.FILENAME}`, 'DotenvyIgnore');
        return true;
    }

    // ─── Pattern loading ──────────────────────────────────────────────────────

    private static loadPatterns(rootPath: string): ParsedPattern[] {
        const filePath = path.join(rootPath, DotenvyIgnore.FILENAME);

        try {
            const stat = fs.statSync(filePath);
            const mtime = stat.mtime.getTime();

            // Return cached if file hasn't changed
            const cached = DotenvyIgnore.cache.get(rootPath);
            if (cached && cached.mtime === mtime) {
                return cached.patterns;
            }

            const content  = fs.readFileSync(filePath, 'utf8');
            const patterns = DotenvyIgnore.parseFile(content);

            DotenvyIgnore.cache.set(rootPath, { patterns, mtime });

            logger.debug(
                `Loaded ${patterns.length} patterns from ${DotenvyIgnore.FILENAME}`,
                'DotenvyIgnore'
            );

            return patterns;

        } catch {
            // File doesn't exist — that's fine
            return [];
        }
    }

    // ─── Parsing ──────────────────────────────────────────────────────────────

    private static parseFile(content: string): ParsedPattern[] {
        return content
            .split('\n')
            .map(line => line.trim())
            .filter(line => line.length > 0 && !line.startsWith('#'))
            .map(line => DotenvyIgnore.parseLine(line))
            .filter((p): p is ParsedPattern => p !== null);
    }

    private static parseLine(raw: string): ParsedPattern | null {
        let pattern = raw;
        let negate  = false;

        // Negation
        if (pattern.startsWith('!')) {
            negate  = true;
            pattern = pattern.slice(1);
        }

        // Trailing slash means directory — match everything inside
        if (pattern.endsWith('/')) {
            pattern = pattern + '**';
        }

        try {
            const regex = DotenvyIgnore.globToRegex(pattern);
            return { raw, negate, regex };
        } catch {
            logger.warn(`Invalid pattern in .dotenvyignore: ${raw}`, 'DotenvyIgnore');
            return null;
        }
    }

    // ─── Glob → RegExp ────────────────────────────────────────────────────────

    /**
     * Convert a glob pattern to a RegExp.
     * Supports: * ** ? [abc] {a,b}
     */
    private static globToRegex(glob: string): RegExp {
        let regexStr: string;
        let i = 0;

        // If pattern has no slash (except trailing), match in any directory
        const hasSlash = glob.includes('/') && !glob.startsWith('/');
        const anchored = glob.startsWith('/');

        if (anchored) {
            glob     = glob.slice(1);
            regexStr = '^';
        } else if (!hasSlash) {
            // Match in any directory: prepend (**/)? 
            regexStr = '(?:^|.*/)';
        } else {
            regexStr = '^';
        }

        while (i < glob.length) {
            const c = glob[i];

            if (c === '*') {
                if (glob[i + 1] === '*') {
                    // ** — match anything including /
                    if (glob[i + 2] === '/') {
                        regexStr += '(?:.+/)?';
                        i += 3;
                    } else {
                        regexStr += '.*';
                        i += 2;
                    }
                } else {
                    // * — match anything except /
                    regexStr += '[^/]*';
                    i++;
                }
            } else if (c === '?') {
                regexStr += '[^/]';
                i++;
            } else if (c === '{') {
                // {a,b,c} → (a|b|c)
                const end = glob.indexOf('}', i);
                if (end === -1) {
                    regexStr += '\\{';
                    i++;
                } else {
                    const options = glob.slice(i + 1, end).split(',');
                    regexStr += `(?:${options.map(DotenvyIgnore.escapeRegex).join('|')})`;
                    i = end + 1;
                }
            } else if (c === '[') {
                // Character class — pass through
                const end = glob.indexOf(']', i);
                if (end === -1) {
                    regexStr += '\\[';
                    i++;
                } else {
                    regexStr += glob.slice(i, end + 1);
                    i = end + 1;
                }
            } else {
                regexStr += DotenvyIgnore.escapeRegex(c);
                i++;
            }
        }

        regexStr += '$';
        return new RegExp(regexStr, 'i');
    }

    private static escapeRegex(str: string): string {
        return str.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }

    private static matchPattern(relativePath: string, regex: RegExp): boolean {
        return regex.test(relativePath);
    }
}
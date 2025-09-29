import * as fs from 'fs';
import { Environment } from '../types/environment';

export interface EnvVariable {
    key: string;
    value: string;
    line: number;
}

export interface EnvDiff {
    added: EnvVariable[];
    removed: EnvVariable[];
    changed: {
        variable: EnvVariable;
        oldValue: string;
        newValue: string;
    }[];
    unchanged: EnvVariable[];
}

export class EnvironmentDiffer {
    /**
     * Compare two environment files and return detailed diff
     */
    static compareFiles(filePathA: string, filePathB: string): EnvDiff {
        const varsA = this.parseEnvFile(filePathA);
        const varsB = this.parseEnvFile(filePathB);

        const added: EnvVariable[] = [];
        const removed: EnvVariable[] = [];
        const changed: EnvDiff['changed'] = [];
        const unchanged: EnvVariable[] = [];

        // Create maps for easier lookup
        const mapA = new Map(varsA.map(v => [v.key, v]));
        const mapB = new Map(varsB.map(v => [v.key, v]));

        // Find added, changed, and unchanged variables
        for (const varB of varsB) {
            const varA = mapA.get(varB.key);
            if (!varA) {
                // Added in file B
                added.push(varB);
            } else if (varA.value !== varB.value) {
                // Changed
                changed.push({
                    variable: varB,
                    oldValue: varA.value,
                    newValue: varB.value
                });
            } else {
                // Unchanged
                unchanged.push(varB);
            }
        }

        // Find removed variables (exist in A but not in B)
        for (const varA of varsA) {
            if (!mapB.has(varA.key)) {
                removed.push(varA);
            }
        }

        return {
            added,
            removed,
            changed,
            unchanged
        };
    }

    /**
     * Parse environment file into variables array
     */
    private static parseEnvFile(filePath: string): EnvVariable[] {
        const variables: EnvVariable[] = [];
        const content = fs.readFileSync(filePath, 'utf8');
        const lines = content.split('\n');

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();

            // Skip empty lines and comments
            if (!line || line.startsWith('#')) {
                continue;
            }

            // Parse key=value
            const equalIndex = line.indexOf('=');
            if (equalIndex === -1) {
                continue; // Invalid line format
            }

            const key = line.substring(0, equalIndex).trim();
            const value = line.substring(equalIndex + 1);

            if (key) {
                variables.push({
                    key,
                    value,
                    line: i + 1
                });
            }
        }

        return variables;
    }

    /**
     * Get diff summary statistics
     */
    static getDiffSummary(diff: EnvDiff): {
        totalVariables: number;
        addedCount: number;
        removedCount: number;
        changedCount: number;
    } {
        return {
            totalVariables: diff.added.length + diff.removed.length + diff.changed.length + diff.unchanged.length,
            addedCount: diff.added.length,
            removedCount: diff.removed.length,
            changedCount: diff.changed.length
        };
    }

    /**
     * Format diff for display
     */
    static formatDiffForDisplay(diff: EnvDiff, nameA: string, nameB: string): string {
        const summary = this.getDiffSummary(diff);

        let result = `# Environment Diff: ${nameA} → ${nameB}\n`;
        result += `# Total variables: ${summary.totalVariables}\n`;
        result += `# Changes: +${summary.addedCount} -${summary.removedCount} ~${summary.changedCount}\n\n`;

        // Sort variables by status and alphabetically
        const allVars = [
            ...diff.added.map(v => ({ type: 'added', var: v })),
            ...diff.removed.map(v => ({ type: 'removed', var: v })),
            ...diff.changed.map(c => ({ type: 'changed', var: c.variable, oldValue: c.oldValue })),
            ...diff.unchanged.map(v => ({ type: 'unchanged', var: v }))
        ].sort((a, b) => {
            // Sort by type priority, then alphabetically by key
            const typeOrder: Record<string, number> = { 'added': 0, 'removed': 1, 'changed': 2, 'unchanged': 3 };
            const typeDiff = typeOrder[a.type] - typeOrder[b.type];
            if (typeDiff !== 0) return typeDiff;
            return a.var.key.localeCompare(b.var.key);
        });

        for (const item of allVars) {
            const { type, var: variable } = item;
            const oldValue = (item as any).oldValue;

            switch (type) {
                case 'added':
                    result += `+ ${variable.key}=${variable.value}\n`;
                    break;
                case 'removed':
                    result += `- ${variable.key}=${variable.value}\n`;
                    break;
                case 'changed':
                    result += `~ ${variable.key}=${oldValue} → ${variable.value}\n`;
                    break;
                case 'unchanged':
                    result += `  ${variable.key}=${variable.value}\n`;
                    break;
            }
        }

        return result;
    }
}

import * as fs from 'fs';

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
        blame?: {
            user?: string;
            timestamp?: Date;
            commitHash?: string;
        };
        // New field for granular changes
        valueChanges?: {
            type: 'insert' | 'delete' | 'replace';
            original: string;
            modified: string;
            position: number;
        }[];
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
                const valueChanges = this.calculateGranularDiff(varA.value, varB.value);
                changed.push({
                    variable: varB,
                    oldValue: varA.value,
                    newValue: varB.value,
                    valueChanges: valueChanges
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
     * Calculate granular diff between two strings (e.g., values of environment variables)
     * This is a simplified implementation using basic string comparison.
     * For more advanced diffing, a library like 'diff' could be used.
     */
    private static calculateGranularDiff(original: string, modified: string): EnvDiff['changed'][0]['valueChanges'] {
        const changes: EnvDiff['changed'][0]['valueChanges'] = [];
        let i = 0; // Pointer for original string
        let j = 0; // Pointer for modified string

        while (i < original.length || j < modified.length) {
            if (i < original.length && j < modified.length && original[i] === modified[j]) {
                // Characters match, move both pointers
                i++;
                j++;
            } else {
                // Mismatch found, determine type of change
                let startI = i;
                let startJ = j;

                // Find end of differing segment in original
                while (i < original.length && (j >= modified.length || original[i] !== modified[j])) {
                    i++;
                }
                const originalSegment = original.substring(startI, i);

                // Find end of differing segment in modified
                while (j < modified.length && (i >= original.length || original[i] !== modified[j])) {
                    j++;
                }
                const modifiedSegment = modified.substring(startJ, j);

                if (originalSegment.length > 0 && modifiedSegment.length > 0) {
                    // Replace
                    changes.push({
                        type: 'replace',
                        original: originalSegment,
                        modified: modifiedSegment,
                        position: startJ
                    });
                } else if (modifiedSegment.length > 0) {
                    // Insert
                    changes.push({
                        type: 'insert',
                        original: '',
                        modified: modifiedSegment,
                        position: startJ
                    });
                } else if (originalSegment.length > 0) {
                    // Delete
                    changes.push({
                        type: 'delete',
                        original: originalSegment,
                        modified: '',
                        position: startJ
                    });
                }
            }
        }
        return changes;
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
            ...diff.changed.map(c => ({ type: 'changed', var: c.variable, oldValue: c.oldValue, blame: c.blame, valueChanges: c.valueChanges })),
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
            const blame = (item as any).blame;
            const valueChanges = (item as any).valueChanges;

            switch (type) {
                case 'added':
                    result += `+ ${variable.key}=${variable.value}\n`;
                    break;
                case 'removed':
                    result += `- ${variable.key}=${variable.value}\n`;
                    break;
                case 'changed':
                    result += `~ ${variable.key}=${oldValue} → ${variable.value}`;
                    if (blame) {
                        const timestamp = blame.timestamp ? new Date(blame.timestamp).toLocaleString() : 'Unknown';
                        result += ` [${blame.user || 'Unknown'} @ ${timestamp}]`;
                        if (blame.commitHash) {
                            result += ` (${blame.commitHash.substring(0, 7)})`;
                        }
                    }
                    // Add granular diff information if available
                    if (valueChanges && valueChanges.length > 0) {
                        result += '\n  Granular changes:\n';
                        for (const change of valueChanges) {
                            switch (change.type) {
                                case 'insert':
                                    result += `    + '${change.modified}' at position ${change.position}\n`;
                                    break;
                                case 'delete':
                                    result += `    - '${change.original}' at position ${change.position}\n`;
                                    break;
                                case 'replace':
                                    result += `    ~ '${change.original}' → '${change.modified}' at position ${change.position}\n`;
                                    break;
                            }
                        }
                    }
                    result += '\n';
                    break;
                case 'unchanged':
                    result += `  ${variable.key}=${variable.value}\n`;
                    break;
            }
        }

        return result;
    }
}

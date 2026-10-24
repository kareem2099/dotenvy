/**
 * Reports keys whose values differ across discovered environment files.
 */

import * as fs from 'fs/promises';
import * as vscode from 'vscode';
import { t } from '../i18n';
import { WorkspaceManager } from '../providers/workspaceManager';
import { findValueConflicts } from '../utils/crossEnvironmentConflicts';
import { discoverEnvironmentEntries } from '../utils/environmentDiscovery';
import { showSyncToast } from '../utils/panelNotification';

export class CompareEnvironmentsCommand implements vscode.Disposable {
	public async execute(): Promise<void> {
		const rootPath = await WorkspaceManager.resolveWorkspacePath(
			undefined,
			t('common.selectWorkspace')
		);
		if (!rootPath) {
			showSyncToast(t('common.noWorkspace'), 'error');
			return;
		}

		try {
			const entries = await discoverEnvironmentEntries(rootPath);
			if (entries.length < 2) {
				showSyncToast(t('compare.needTwo'), 'warning');
				return;
			}

			const files = [];
			for (const entry of entries) {
				const content = await fs.readFile(entry.absolutePath, 'utf8');
				files.push({
					name: entry.name,
					relativePath: entry.relativePath,
					content,
				});
			}

			const conflicts = findValueConflicts(files);
			if (conflicts.length === 0) {
				showSyncToast(t('compare.none'), 'info');
				return;
			}

            const details = [t('compare.found', {count: conflicts.length}),
                ...conflicts.flatMap(conflict => conflict.occurrences.map(occurrence =>
                    `${conflict.key} | ${occurrence.name} | ${occurrence.relativePath}`)),
            ].join('\n');
            const document = await vscode.workspace.openTextDocument({ content: details, language: 'plaintext' });
            await vscode.window.showTextDocument(document, { preview: false });
			showSyncToast(t('compare.found', { count: conflicts.length }), 'warning');
		} catch (error) {
			showSyncToast(t('compare.failed', { message: (error as Error).message }), 'error');
		}
	}

	public dispose(): void {
		// Registered commands are disposed with the extension subscriptions.
	}
}

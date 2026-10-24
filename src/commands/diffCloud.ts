/**
 * Compares local environment keys with Doppler and does not write files.
 */

import * as vscode from 'vscode';
import { t } from '../i18n';
import { LAST_SYNC_STORAGE } from '../constants';
import { extensionContext } from '../extension';
import { WorkspaceManager } from '../providers/workspaceManager';
import { diffCloudSecrets } from '../utils/cloudSecretDiff';
import { ConfigUtils } from '../utils/configUtils';
import { createCloudSyncManager } from '../utils/cloudSyncManagerFactory';
import { EnvSyncUtils } from '../utils/envSyncUtils';
import { showSyncToast } from '../utils/panelNotification';

export class DiffCloudCommand implements vscode.Disposable {
	public async execute(): Promise<void> {
		const rootPath = await WorkspaceManager.resolveWorkspacePath(
			undefined,
			t('common.selectWorkspace')
		);
		if (!rootPath) {
			showSyncToast(t('common.noWorkspace'), 'error');
			return;
		}

		const config = await ConfigUtils.readQuickEnvConfig(rootPath);
		const syncConfig = config?.cloudSync;
		if (!syncConfig?.project || !syncConfig.config) {
			showSyncToast(t('cloudDiff.notConfigured'), 'warning');
			return;
		}

		const previousLastSync = extensionContext.workspaceState.get<string>(LAST_SYNC_STORAGE);
		try {
			const cloudManager = await createCloudSyncManager(syncConfig, extensionContext);
			const result = await cloudManager.fetchSecrets(extensionContext);
			if (!result.success || !result.secrets) {
				showSyncToast(t('cloudDiff.fetchFailed', { error: result.error ?? '' }), 'error');
				return;
			}

			const targets = await EnvSyncUtils.resolveSyncTargets(rootPath, syncConfig.config, config);
			const merged = EnvSyncUtils.mergeTargetsSecretsForCloud(rootPath, targets);
			const diff = diffCloudSecrets(merged.secrets, result.secrets);
			const differenceCount = diff.remoteOnly.length + diff.localOnly.length + diff.changed.length;

			if (differenceCount === 0) {
				showSyncToast(t('cloudDiff.aligned'), 'info');
				return;
			}

            const details = [
                t('cloudDiff.summary', {remoteOnly: diff.remoteOnly.length, localOnly: diff.localOnly.length, changed: diff.changed.length}),
                ...diff.remoteOnly.map(key => `[cloud] ${key}`),
                ...diff.localOnly.map(key => `[local] ${key}`),
                ...diff.changed.map(key => `[changed] ${key}`),
            ].join('\n');
            const document = await vscode.workspace.openTextDocument({ content: details, language: 'plaintext' });
            await vscode.window.showTextDocument(document, { preview: false });
			showSyncToast(t('cloudDiff.summary', {
				remoteOnly: diff.remoteOnly.length,
				localOnly: diff.localOnly.length,
				changed: diff.changed.length,
			}), 'warning');
		} catch (error) {
			showSyncToast(t('cloudDiff.fetchFailed', { error: (error as Error).message }), 'error');
		} finally {
			await extensionContext.workspaceState.update(LAST_SYNC_STORAGE, previousLastSync);
		}
	}

	public dispose(): void {
		// Registered commands are disposed with the extension subscriptions.
	}
}

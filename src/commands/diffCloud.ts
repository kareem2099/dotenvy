/**
 * Compares local environment keys with Doppler and does not write files.
 */

import * as vscode from 'vscode';
import { t } from '../i18n';
import { LAST_SYNC_STORAGE } from '../constants';
import { extensionContext } from '../extension';
import { WorkspaceManager } from '../providers/workspaceManager';
import { diffCloudSecrets } from '../utils/cloudSecretDiff';
import { CloudSecrets } from '../utils/cloudSyncManager';
import { ConfigUtils } from '../utils/configUtils';
import { createCloudSyncManager } from '../utils/encryptedCloudSyncManager';
import { EnvSyncUtils } from '../utils/envSyncUtils';
import { logger } from '../utils/logger';
import { showSyncToast } from '../utils/panelNotification';

function logSecretList(title: string, keys: string[], secrets: CloudSecrets): void {
	logger.info(title, 'DiffCloud');
	for (const key of keys) {
		logger.info(`${key}=${secrets[key] ?? ''}`, 'DiffCloud');
	}
}

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
		if (!syncConfig?.project || !syncConfig.config || !syncConfig.token) {
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
			const filteredRemote = EnvSyncUtils.filterCloudMetadataKeys(
				EnvSyncUtils.filterDopplerReservedKeys(result.secrets)
			);
			const diff = diffCloudSecrets(merged.secrets, result.secrets);
			const differenceCount = diff.remoteOnly.length + diff.localOnly.length + diff.changed.length;

			if (differenceCount === 0) {
				showSyncToast(t('cloudDiff.aligned'), 'info');
				return;
			}

			logSecretList('Only in cloud', diff.remoteOnly, filteredRemote);
			logSecretList('Only local', diff.localOnly, merged.secrets);
			logger.info('Different values', 'DiffCloud');
			for (const key of diff.changed) {
				logger.info(
					`${key} local=${merged.secrets[key] ?? ''} remote=${filteredRemote[key] ?? ''}`,
					'DiffCloud'
				);
			}
			logger.show();
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

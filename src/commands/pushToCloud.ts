import * as vscode from 'vscode';
import * as fs from 'fs';
import { WorkspaceManager } from '../providers/workspaceManager';
import { ConfigUtils } from '../utils/configUtils';
import { DopplerSyncManager } from '../utils/dopplerSyncManager';
import { CloudSyncManager } from '../utils/cloudSyncManager';
import { FileUtils } from '../utils/fileUtils';
import { EnvSyncUtils } from '../utils/envSyncUtils';
import { extensionContext } from '../extension';
import { EncryptedCloudSyncManager } from '../utils/encryptedCloudSyncManager';
import { showActionStart, showSyncToast } from '../utils/panelNotification';
import { t } from '../i18n';

export class PushToCloudCommand implements vscode.Disposable {
	public async execute(preferredWorkspacePath?: string): Promise<void> {
		showActionStart(t('push.actionStart'));

		await vscode.window.withProgress(
			{
				location: vscode.ProgressLocation.Notification,
				title: t('push.progress.title'),
				cancellable: false
			},
			async progress => this.runPush(preferredWorkspacePath, progress)
		);
	}

	private async runPush(
		preferredWorkspacePath: string | undefined,
		progress: vscode.Progress<{ message?: string }>
	): Promise<void> {
		const rootPath = await WorkspaceManager.resolveWorkspacePath(
			preferredWorkspacePath,
			t('common.selectWorkspace')
		);

		if (!rootPath) {
			showSyncToast(t('push.cancelledNoWorkspace'), 'info');
			return;
		}

		progress.report({ message: 'Lettura configurazione...' });
		const config = await ConfigUtils.readQuickEnvConfig(rootPath);

		if (!config?.cloudSync || !config.cloudSync.project || !config.cloudSync.config || !config.cloudSync.token) {
			await ConfigUtils.ensureWorkspaceConfigFile(rootPath, undefined, true);
			showSyncToast(
				t('push.configCreated'),
				'warning'
			);
			return;
		}

		try {
			let syncConfig = config.cloudSync;
			if (!syncConfig) {
				showSyncToast(t('push.cloudSyncNotConfigured'), 'error');
				return;
			}

			let cloudManager: CloudSyncManager;
			const enableEncryption = !(syncConfig.encryptCloudSync === false);

			progress.report({ message: 'Connessione al provider cloud...' });
			try {
				cloudManager = await EncryptedCloudSyncManager.createManager(syncConfig, extensionContext);
				if (enableEncryption) {
					showSyncToast(t('push.encryptionEnabled'), 'info');
				}
			} catch (error) {
				showSyncToast(t('push.initFailed', { message: (error as Error).message }), 'error');
				return;
			}

			const connectionResult = await cloudManager.testConnection();
			if (!connectionResult.success) {
				const updatedSyncConfig = await DopplerSyncManager.handleConnectionFailure(
					rootPath,
					syncConfig,
					connectionResult.error
				);

				if (!updatedSyncConfig) {
					showSyncToast(t('push.cancelled'), 'info');
					return;
				}

				syncConfig = updatedSyncConfig;
				cloudManager = await EncryptedCloudSyncManager.createManager(syncConfig, extensionContext);
				const retryResult = await cloudManager.testConnection();
				if (!retryResult.success) {
					showSyncToast(
						retryResult.error ?? '',
						'error'
					);
					return;
				}
			}

			const syncTargets = await EnvSyncUtils.resolveSyncTargets(rootPath, syncConfig.config, config);
			if (syncTargets.length === 0) {
				showSyncToast(
					t('push.noEnvFiles'),
					'error'
				);
				return;
			}

			const targetSummary = syncTargets.map(target => target.file).join(', ');
			const usesPrefixes = syncTargets.some(target => target.keyPrefix.length > 0);
			const pushMode = syncConfig.pushMode ?? 'replace';

			const openConfigLabel = t('push.openConfig');
			if (enableEncryption && usesPrefixes) {
				const disableEncryption = await vscode.window.showWarningMessage(
					t('push.encryptionWithPrefixes'),
					{ modal: true },
					openConfigLabel,
					t('push.continueEncrypted')
				);

				if (disableEncryption === openConfigLabel) {
					await ConfigUtils.openWorkspaceConfigEditor(rootPath);
					showSyncToast(t('push.cancelledConfigureEncryption'), 'info');
					return;
				}
			}

			const yesSyncLabel = t('push.yesSync');
			const cancelLabel = t('common.cancel');
			const proceed = await vscode.window.showWarningMessage(
				syncTargets.length === 1
					? t('push.confirmSyncSingle', {
						targets: targetSummary,
						provider: syncConfig.provider,
						project: syncConfig.project,
						config: syncConfig.config,
						mode: pushMode
					})
					: t('push.confirmSyncMulti', {
						count: syncTargets.length,
						provider: syncConfig.provider,
						project: syncConfig.project,
						config: syncConfig.config,
						mode: pushMode,
						targets: targetSummary,
						prefixNote: usesPrefixes ? t('push.prefixNote') : ''
					}),
				{ modal: true },
				yesSyncLabel,
				cancelLabel
			);

			if (proceed !== yesSyncLabel) {
				showSyncToast(t('push.cancelled'), 'info');
				return;
			}

			progress.report({ message: 'Preparazione secrets...' });
			const merged = EnvSyncUtils.mergeTargetsSecretsForCloud(rootPath, syncTargets);
			if (merged.duplicateKeys.length > 0) {
				const continueLabel = t('common.continue');
				const duplicateWarning = await vscode.window.showWarningMessage(
					t('push.duplicateKeys', { keys: merged.duplicateKeys.join(', ') }),
					{ modal: true },
					continueLabel,
					cancelLabel
				);
				if (duplicateWarning !== continueLabel) {
					showSyncToast(t('push.cancelled'), 'info');
					return;
				}
			}

			const syncAnywayLabel = t('push.syncAnyway');
			for (const target of syncTargets) {
				if (!fs.existsSync(target.absolutePath)) {
					continue;
				}

				const secretWarnings = FileUtils.checkForSecrets(target.absolutePath);
				if (secretWarnings.length > 0) {
					const proceedAnyway = await vscode.window.showWarningMessage(
						t('push.secretsDetected', {
							file: target.file,
							warnings: secretWarnings.map(w => `• ${w}`).join('\n')
						}),
						{ modal: true },
						syncAnywayLabel,
						cancelLabel
					);

					if (proceedAnyway !== syncAnywayLabel) {
						showSyncToast(t('push.cancelled'), 'info');
						return;
					}
				}
			}

			const filteredSecrets = EnvSyncUtils.filterDopplerReservedKeys(merged.secrets);
			const filteredCount = Object.keys(merged.secrets).length - Object.keys(filteredSecrets).length;

			if (filteredCount > 0) {
				showSyncToast(
					t('push.filteredReserved', { count: filteredCount }),
					'info'
				);
			}

			let keysToDelete: string[] = [];
			if (pushMode === 'replace') {
				progress.report({ message: 'Confronto con secrets remoti...' });
				const remotePreview = await cloudManager.fetchSecrets(extensionContext);
				if (remotePreview.success && remotePreview.secrets) {
					const remoteFiltered = DopplerSyncManager.filterSyncableSecrets(remotePreview.secrets);
					const localKeys = new Set(Object.keys(filteredSecrets));
					keysToDelete = Object.keys(remoteFiltered).filter(key => !localKeys.has(key));
				}

				if (keysToDelete.length > 0) {
					const deletePreview = keysToDelete.slice(0, 8).join(', ');
					const deleteSuffix = keysToDelete.length > 8 ? ` (+${keysToDelete.length - 8} more)` : '';
					const yesReplaceLabel = t('push.yesReplace');
					const replaceConfirm = await vscode.window.showWarningMessage(
						t('push.replaceDelete', { count: keysToDelete.length, preview: `${deletePreview}${deleteSuffix}` }),
						{ modal: true },
						yesReplaceLabel,
						cancelLabel
					);

					if (replaceConfirm !== yesReplaceLabel) {
						showSyncToast(t('push.cancelled'), 'info');
						return;
					}
				}
			}

			progress.report({ message: `Upload su ${syncConfig.provider}...` });
			const result = pushMode === 'replace'
				? await cloudManager.replaceSecrets(filteredSecrets, extensionContext)
				: await cloudManager.pushSecrets(filteredSecrets, extensionContext);

			if (result.success) {
				const deletedMsg = pushMode === 'replace' && keysToDelete.length > 0
					? t('push.deletedOrphans', { count: keysToDelete.length })
					: '';
				showSyncToast(
					t('push.synced', { provider: syncConfig.provider, deletedMsg }),
					'success'
				);
			} else {
				showSyncToast(t('push.syncFailed', { error: result.error ?? '' }), 'error');
			}
		} catch (error) {
			showSyncToast(t('push.failed', { message: (error as Error).message }), 'error');
		}
	}

	public dispose() {
		// Commands are disposed via vscode subscriptions
	}
}

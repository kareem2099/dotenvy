import * as vscode from 'vscode';
import { WorkspaceManager } from '../providers/workspaceManager';
import { ConfigUtils } from '../utils/configUtils';
import { DopplerSyncManager } from '../utils/dopplerSyncManager';
import { CloudSyncManager } from '../utils/cloudSyncManager';
import { EnvSyncUtils } from '../utils/envSyncUtils';
import { StatusBarProvider } from '../providers/statusBarProvider';
import { extensionContext } from '../extension';
import { createCloudSyncManager } from '../utils/encryptedCloudSyncManager';
import { showActionStart, showSyncToast } from '../utils/panelNotification';
import { t } from '../i18n';

export class PullFromCloudCommand implements vscode.Disposable {
	public async execute(preferredWorkspacePath?: string): Promise<void> {
		showActionStart(t('pull.actionStart'));

		await vscode.window.withProgress(
			{
				location: vscode.ProgressLocation.Notification,
				title: t('pull.progress.title'),
				cancellable: false
			},
			async progress => this.runPull(preferredWorkspacePath, progress)
		);
	}

	private async runPull(
		preferredWorkspacePath: string | undefined,
		progress: vscode.Progress<{ message?: string }>
	): Promise<void> {
		const rootPath = await WorkspaceManager.resolveWorkspacePath(
			preferredWorkspacePath,
			t('common.selectWorkspace')
		);

		if (!rootPath) {
			showSyncToast(t('pull.cancelledNoWorkspace'), 'info');
			return;
		}

		const workspaceContext = WorkspaceManager.getInstance().getWorkspace(rootPath);
		const statusBarProvider: StatusBarProvider | undefined = workspaceContext?.statusBarProvider;

		progress.report({ message: t('pull.progress.readingConfig') });
		const config = await ConfigUtils.readQuickEnvConfig(rootPath);

		if (!config?.cloudSync || !config.cloudSync.project || !config.cloudSync.config || !config.cloudSync.token) {
			await ConfigUtils.ensureWorkspaceConfigFile(rootPath, undefined, true);
			showSyncToast(
				t('pull.configCreated'),
				'warning'
			);
			return;
		}

		try {
			let syncConfig = config.cloudSync;
			if (!syncConfig) {
				showSyncToast(t('pull.cloudSyncNotConfigured'), 'error');
				return;
			}

			let cloudManager: CloudSyncManager;

			progress.report({ message: t('pull.progress.connectingCloud') });
			try {
				cloudManager = await createCloudSyncManager(syncConfig, extensionContext);
			} catch (error) {
				showSyncToast(t('pull.initFailed', { message: (error as Error).message }), 'error');
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
					showSyncToast(t('pull.cancelled'), 'info');
					return;
				}

				syncConfig = updatedSyncConfig;
				cloudManager = await createCloudSyncManager(syncConfig, extensionContext);
				const retryResult = await cloudManager.testConnection();
				if (!retryResult.success) {
					showSyncToast(
						retryResult.error ?? t('pull.connectionFailed'),
						'error'
					);
					return;
				}
			}

			progress.report({ message: t('pull.progress.downloading', { provider: syncConfig.provider }) });
			const result = await cloudManager.fetchSecrets(extensionContext);

			if (!result.success || !result.secrets) {
				showSyncToast(t('pull.downloadFailed', { error: result.error ?? 'no secrets received' }), 'error');
				return;
			}

			const syncTargets = await EnvSyncUtils.resolveSyncTargets(rootPath, syncConfig.config, config);
			if (syncTargets.length === 0) {
				showSyncToast(
					t('pull.noEnvFiles'),
					'error'
				);
				return;
			}

			const secrets = EnvSyncUtils.filterCloudMetadataKeys(
				EnvSyncUtils.filterDopplerReservedKeys(result.secrets)
			);
			const changeSummary = EnvSyncUtils.calculatePullChanges(syncTargets, secrets);

			if (changeSummary.totalChanges === 0) {
				showSyncToast(t('pull.alreadySynced'), 'success');
				return;
			}

			const targetSummary = syncTargets.map(target => target.file).join(', ');
			const applyLabel = t('pull.apply');
			const detailsLabel = t('pull.details');
			const cancelLabel = t('common.cancel');
			const proceed = await vscode.window.showWarningMessage(
				t('pull.confirmPull', {
					provider: syncConfig.provider,
					project: syncConfig.project,
					config: syncConfig.config,
					targets: targetSummary,
					added: changeSummary.newKeys.length,
					changed: changeSummary.changedKeys.length,
					removed: changeSummary.removedKeys.length
				}),
				{ modal: true },
				applyLabel,
				detailsLabel,
				cancelLabel
			);

			if (proceed === cancelLabel || proceed === undefined) {
				showSyncToast(t('pull.cancelled'), 'info');
				return;
			}

			if (proceed === detailsLabel) {
				const splitSecrets = EnvSyncUtils.splitSecretsAcrossTargets(secrets, syncTargets, rootPath);
				let details = `# Cloud Sync Changes\n`;
				details += `# ${syncConfig.provider}: ${syncConfig.project}/${syncConfig.config}\n\n`;

				for (const target of syncTargets) {
					const fileChanges = changeSummary.byFile[target.file];
					const fileSecrets = splitSecrets.get(target.file) ?? {};
					if (!fileChanges) {
						continue;
					}

					const fileTotal = fileChanges.newKeys.length + fileChanges.changedKeys.length + fileChanges.removedKeys.length;
					if (fileTotal === 0) {
						continue;
					}

					details += `## ${target.file}\n`;

					if (fileChanges.newKeys.length > 0) {
						details += `### Added (${fileChanges.newKeys.length})\n`;
						fileChanges.newKeys.forEach(key => {
							details += `+ ${key}=${fileSecrets[key]}\n`;
						});
						details += '\n';
					}

					if (fileChanges.changedKeys.length > 0) {
						details += `### Modified (${fileChanges.changedKeys.length})\n`;
						const currentSecrets = EnvSyncUtils.parseEnvFile(target.absolutePath);
						fileChanges.changedKeys.forEach(key => {
							details += `~ ${key}=${currentSecrets[key]} → ${fileSecrets[key]}\n`;
						});
						details += '\n';
					}

					if (fileChanges.removedKeys.length > 0) {
						details += `### Removed (${fileChanges.removedKeys.length})\n`;
						const currentSecrets = EnvSyncUtils.parseEnvFile(target.absolutePath);
						fileChanges.removedKeys.forEach(key => {
							details += `- ${key}=${currentSecrets[key]}\n`;
						});
						details += '\n';
					}
				}

				const doc = await vscode.workspace.openTextDocument({
					content: details,
					language: 'diff'
				});
				await vscode.window.showTextDocument(doc, { preview: true });

				const yesApplyLabel = t('pull.yesApply');
				const finalDecision = await vscode.window.showWarningMessage(
					t('pull.confirmApply', { count: changeSummary.totalChanges }),
					{ modal: true },
					yesApplyLabel,
					cancelLabel
				);

				if (finalDecision !== yesApplyLabel) {
					showSyncToast(t('pull.cancelled'), 'info');
					return;
				}
			}

			progress.report({ message: t('pull.progress.writingFiles') });
			const writtenFiles = await EnvSyncUtils.writeSecretsToTargets(syncTargets, secrets);

			if (statusBarProvider) {
				statusBarProvider.setWorkspace(rootPath);
				statusBarProvider.forceRefresh();
			}

			showSyncToast(
				t('pull.completed', {
					count: Object.keys(secrets).length,
					files: writtenFiles.join(', '),
					provider: syncConfig.provider
				}),
				'success'
			);
		} catch (error) {
			showSyncToast(t('pull.failed', { message: (error as Error).message }), 'error');
		}
	}

	public dispose() {
		// Commands are disposed via vscode subscriptions
	}
}

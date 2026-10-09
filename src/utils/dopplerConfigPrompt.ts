/**
 * VS Code prompts that pick a Doppler project or config and persist the choice.
 */

import * as vscode from 'vscode';
import { t } from '../i18n';
import { CloudSyncErrorCode } from './cloudSyncManager';
import { DopplerSyncManager } from './dopplerSyncManager';
import { CloudSyncConfig } from '../types/environment';

export async function promptProjectSelection(
    rootPath: string,
    syncConfig: CloudSyncConfig,
): Promise<CloudSyncConfig | null> {
    const manager = new DopplerSyncManager(syncConfig);

    try {
        const projects = await manager.listProjects();
        if (projects.length === 0) {
            vscode.window.showErrorMessage(t('doppler.noProjects'));
            return null;
        }

        const selected = await vscode.window.showQuickPick(
            projects.map(project => ({
                label: project.name,
                description: project.slug,
                slug: project.slug
            })),
            {
                placeHolder: t('doppler.selectProject'),
                matchOnDescription: true
            }
        );

        if (!selected) {
            return null;
        }

        const { ConfigUtils } = await import('./configUtils');
        const config = await ConfigUtils.readQuickEnvConfig(rootPath);
        if (!config?.cloudSync) {
            return null;
        }

        config.cloudSync.project = selected.slug;
        await ConfigUtils.saveQuickEnvConfig(config, rootPath);
        vscode.window.showInformationMessage(t('doppler.projectSet', { slug: selected.slug }));
        return config.cloudSync;
    } catch (error) {
        vscode.window.showErrorMessage(t('doppler.listFailed', { message: (error as Error).message }));
        return null;
    }
}

export async function promptConfigSelection(
    rootPath: string,
    syncConfig: CloudSyncConfig,
): Promise<CloudSyncConfig | null> {
    const manager = new DopplerSyncManager(syncConfig);

    try {
        const configs = await manager.listConfigs();
        if (configs.length === 0) {
            vscode.window.showErrorMessage(t('doppler.noConfigs'));
            return null;
        }

        const selected = await vscode.window.showQuickPick(
            configs.map(config => ({
                label: config.name,
                description: config.environment ?? '',
                name: config.name
            })),
            {
                placeHolder: t('doppler.selectConfig'),
                matchOnDescription: true
            }
        );

        if (!selected) {
            return null;
        }

        const { ConfigUtils } = await import('./configUtils');
        const config = await ConfigUtils.readQuickEnvConfig(rootPath);
        if (!config?.cloudSync) {
            return null;
        }

        config.cloudSync.config = selected.name;
        await ConfigUtils.saveQuickEnvConfig(config, rootPath);
        vscode.window.showInformationMessage(t('doppler.configSet', { name: selected.name }));
        return config.cloudSync;
    } catch (error) {
        vscode.window.showErrorMessage(t('doppler.configListFailed', { message: (error as Error).message }));
        return null;
    }
}

export async function applyResolvedConfig(
    rootPath: string,
    syncConfig: CloudSyncConfig,
    resolvedConfig?: string,
): Promise<CloudSyncConfig> {
    if (!resolvedConfig || resolvedConfig === syncConfig.config) {
        return syncConfig;
    }

    const { ConfigUtils } = await import('./configUtils');
    const config = await ConfigUtils.readQuickEnvConfig(rootPath);
    if (!config?.cloudSync) {
        return { ...syncConfig, config: resolvedConfig };
    }

    config.cloudSync.config = resolvedConfig;
    await ConfigUtils.saveQuickEnvConfig(config, rootPath);
    return config.cloudSync;
}

export async function handleConnectionFailure(
    rootPath: string,
    syncConfig: CloudSyncConfig,
    error?: string,
    errorCode?: CloudSyncErrorCode,
): Promise<CloudSyncConfig | null> {
    const errorDetails = error ? t('doppler.errorDetails', { error }) : t('doppler.cannotConnect');
    const actions: string[] = [];

    if (errorCode === 'INVALID_PROJECT' || DopplerSyncManager.isInvalidProjectError(error)) {
        actions.push(t('doppler.selectProjectAction'));
    }

    if (errorCode === 'CONFIG_NOT_FOUND' || DopplerSyncManager.isConfigNotFoundError(error)) {
        actions.push(t('doppler.selectConfigAction'));
    }

    actions.push(t('doppler.openConfig'), t('common.cancel'));

    const choice = await vscode.window.showErrorMessage(`❌ ${errorDetails}`, ...actions);

    if (choice === t('doppler.selectProjectAction')) {
        return promptProjectSelection(rootPath, syncConfig);
    }

    if (choice === t('doppler.selectConfigAction')) {
        return promptConfigSelection(rootPath, syncConfig);
    }

    if (choice === t('doppler.openConfig')) {
        const { ConfigUtils } = await import('./configUtils');
        await ConfigUtils.openWorkspaceConfigEditor(rootPath);
    }

    return null;
}

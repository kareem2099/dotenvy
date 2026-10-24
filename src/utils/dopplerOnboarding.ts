import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { ConfigUtils } from './configUtils';
import { GitUtils } from './gitUtils';
import { normalizeDopplerProjectSlug } from './dopplerProjectSlug';
import { QuickEnvConfig } from '../types/environment';
import { t } from '../i18n';
import { checkDopplerCancellation, dopplerSetupRequest, DopplerSetupError, DopplerSetupStage, waitForDopplerPoll } from './dopplerOnboardingApi';
import { logger } from './logger';

const activeConnections = new Map<string, Promise<boolean>>();

function readSettings(root: string): { text?: string; config?: QuickEnvConfig } {
    const file = path.join(root, '.dotenvy.json');
    if (!fs.existsSync(file)) return {};
    try {
        const text = fs.readFileSync(file, 'utf8');
        const config = JSON.parse(text);
        if (!config || typeof config !== 'object' || Array.isArray(config)) throw new Error();
        return { text, config };
    } catch { throw new Error(t('doppler.connect.invalidSettings')); }
}

function requiredString(value: unknown, stage: DopplerSetupStage): string {
    if (typeof value !== 'string' || !value.trim()) throw new DopplerSetupError(undefined, undefined, stage);
    return value.trim();
}

async function revokeSetupCredential(endpoint: string, account: string | undefined, token: string, method = 'POST'): Promise<void> {
    try { await dopplerSetupRequest(endpoint, method, account, { token }); }
    catch (error) {
        // Retry cleanup safely after a previous successful revocation or host exit.
        if (!(error instanceof DopplerSetupError) || (error.status !== 404 && error.reason !== 'TOKEN_INVALID')) throw error;
    }
}

/** Authorization URLs may contain a one-time code, but never a bearer token. */
function authorizationUrl(value: unknown): string {
    let url: URL;
    try { url = new URL(requiredString(value, 'generateCode')); } catch { throw new DopplerSetupError(undefined, undefined, 'generateCode'); }
    if (url.protocol !== 'https:' || url.hostname !== 'dashboard.doppler.com' || url.port ||
        url.username || url.password || !['/workplace/auth/cli', '/workplace/auth/cli/'].includes(url.pathname)) throw new DopplerSetupError(undefined, undefined, 'generateCode');
    return url.toString();
}

/**
 * Native implementation of Doppler's CLI device authorization protocol.
 * See DopplerHQ/cli pkg/http/api.go (generate/2, authorize, revoke).
 * These login endpoints are owned by Doppler but are not a public OAuth app API.
 * No CLI installation, account token in files, localhost callback or third-party relay.
 */
async function authorize(progress: vscode.Progress<{ message?: string }>, cancellation: vscode.CancellationToken): Promise<string> {
    progress.report({ message: t('doppler.connect.signIn') });
    // Doppler validates this as a CLI protocol version, not the extension version.
    const query = new URLSearchParams({ hostname: 'DotEnvy', version: 'v3.77.0',
        os: process.platform === 'win32' ? 'windows' : process.platform,
        arch: process.arch === 'x64' ? 'amd64' : process.arch === 'ia32' ? '386' : process.arch });
    const session = await dopplerSetupRequest(`/v3/auth/cli/generate/2?${query}`, 'GET', undefined, undefined, cancellation);
    const code = requiredString(session.code, 'generateCode');
    const pollingCode = requiredString(session.polling_code, 'generateCode');
    const url = authorizationUrl(session.auth_url);
    checkDopplerCancellation(cancellation);
    if (!await vscode.env.openExternal(vscode.Uri.parse(url))) throw new Error(t('doppler.connect.browserFailed'));
    progress.report({ message: t('doppler.connect.waiting', { code }) });
    // The user can copy the one-time code without exposing an API token.
    void vscode.window.showInformationMessage(t('doppler.connect.code', { code }), t('doppler.connect.copyCode'))
        .then(async choice => {
            if (choice === t('doppler.connect.copyCode') && !cancellation.isCancellationRequested) {
                await vscode.env.clipboard.writeText(code);
            }
        });
    const deadline = Date.now() + 5 * 60 * 1000;
    while (Date.now() < deadline) {
        checkDopplerCancellation(cancellation);
        try {
            // Finish an in-flight authorization response so cancellation cannot lose
            // a newly minted credential before we can revoke it.
            const response = await dopplerSetupRequest('/v3/auth/cli/authorize', 'POST', undefined, { code: pollingCode });
            return requiredString(response.token, 'authorize');
        } catch (error) {
            if (!(error instanceof DopplerSetupError) || error.status !== 409) throw error;
        }
        await waitForDopplerPoll(2000, cancellation);
    }
    throw new Error(t('doppler.connect.expired'));
}

/** Verify an ambiguous lookup using project objects, not provider error wording. */
async function projectExists(project: string, accountToken: string, cancellation: vscode.CancellationToken): Promise<boolean> {
    const query = new URLSearchParams({ project });
    try {
        await dopplerSetupRequest(`/v3/projects/project?${query}`, 'GET', accountToken, undefined, cancellation);
        return true;
    } catch (error) {
        if (!(error instanceof DopplerSetupError)) throw error;
        if (error.status === 404 || error.reason === 'INVALID_PROJECT') return false;
        // Only an unclassified 400 gets the read-only fallback. Authentication,
        // permission and parameter failures must never become "project missing".
        if (error.status !== 400 || error.reason !== undefined) throw error;
    }
    const pageSize = 20;
    for (let page = 1; page <= 100; page++) {
        const pagination = new URLSearchParams({ page: String(page), per_page: String(pageSize) });
        const response = await dopplerSetupRequest(`/v3/projects?${pagination}`, 'GET', accountToken, undefined, cancellation);
        const projects = response.projects;
        if (!Array.isArray(projects) || projects.length > pageSize || projects.some(entry =>
            !entry || typeof entry !== 'object' || typeof entry.name !== 'string' || !entry.name.trim())) {
            throw new DopplerSetupError(undefined, 'INCOMPLETE_PROJECT_LIST', 'listProjects');
        }
        if (projects.some(entry => entry.name === project)) return true;
        if (projects.length < pageSize) return false;
    }
    // Do not create a duplicate when pagination is incomplete or never ends.
    throw new DopplerSetupError(undefined, 'INCOMPLETE_PROJECT_LIST', 'listProjects');
}

async function provision(root: string, progress: vscode.Progress<{ message?: string }>, cancellation: vscode.CancellationToken): Promise<boolean> {
    const initial = readSettings(root);
    const previousCloud = initial.config?.cloudSync?.provider === 'doppler' ? initial.config.cloudSync : undefined;
    const explicitProject = previousCloud?.project?.trim() && normalizeDopplerProjectSlug(previousCloud.project) !== 'your-project-name';
    const project = normalizeDopplerProjectSlug(explicitProject ? previousCloud!.project : ConfigUtils.resolveProjectName(root))
        .replace(/[^a-z0-9_-]/g, '-').replace(/^-+|-+$/g, '').slice(0, 64) || 'dotenvy-project';
    const configName = explicitProject ? previousCloud?.config?.trim() || 'dev' : 'dev';
    const destination = new URLSearchParams({ project, config: configName });
    const pendingKey = `doppler:setup-cleanup:${crypto.createHash('sha256').update(root).digest('hex')}`;
    let accountToken: string | undefined;
    let serviceToken: string | undefined;
    let committed = false;
    try {
        // Retry cleanup from interrupted network failures before starting another login.
        const pending = await ConfigUtils.getSecret(pendingKey);
        if (pending) {
            const credentials = JSON.parse(pending) as { account: string; service?: string; destination: string };
            const target = new URLSearchParams(credentials.destination);
            const saved = readSettings(root).config?.cloudSync;
            const activeService = credentials.service && saved?.project === target.get('project') && saved?.config === target.get('config') &&
                await ConfigUtils.getSecret(`doppler:${saved.project}:token`) === credentials.service;
            if (credentials.service && !activeService) await revokeSetupCredential(`/v3/configs/config/tokens/token?${credentials.destination}`, credentials.account, credentials.service, 'DELETE');
            await revokeSetupCredential('/v3/auth/cli/revoke', undefined, credentials.account);
            await ConfigUtils.deleteSecret(pendingKey);
        }
        accountToken = await authorize(progress, cancellation);
        // Recover revocation on the next Connect even if the extension host exits.
        await ConfigUtils.setSecret(pendingKey, JSON.stringify({ account: accountToken, destination: destination.toString() }));
        checkDopplerCancellation(cancellation);
        progress.report({ message: t('doppler.connect.settingUp', { project, config: configName }) });
        const projectQuery = new URLSearchParams({ project });
        if (!await projectExists(project, accountToken, cancellation)) {
            try {
                await dopplerSetupRequest('/v3/projects', 'POST', accountToken,
                    { name: project, description: 'Connected with DotEnvy' }, cancellation);
            } catch (createError) {
                if (!(createError instanceof DopplerSetupError) || createError.status !== 409) throw createError;
                if (!await projectExists(project, accountToken, cancellation)) throw createError;
            }
        }
        try {
            await dopplerSetupRequest(`/v3/configs/config?${destination}`, 'GET', accountToken, undefined, cancellation);
        } catch (error) {
            if (!(error instanceof DopplerSetupError) || (error.status !== 404 && error.reason !== 'CONFIG_NOT_FOUND') || configName !== 'dev') throw error;
            // Workplaces can customize the default environments of a new project.
            await dopplerSetupRequest(`/v3/environments?${projectQuery}`, 'POST', accountToken,
                { project, name: 'Development', slug: 'dev', personal_configs: false }, cancellation);
            await dopplerSetupRequest(`/v3/configs/config?${destination}`, 'GET', accountToken, undefined, cancellation);
        }
        const created = await dopplerSetupRequest(`/v3/configs/config/tokens?${destination}`, 'POST', accountToken,
            { project, config: configName, name: `DotEnvy-${crypto.randomBytes(4).toString('hex')}`, access: 'read/write' });
        serviceToken = requiredString((created.token as { key?: unknown } | undefined)?.key, 'createServiceToken');
        await ConfigUtils.setSecret(pendingKey, JSON.stringify({ account: accountToken, service: serviceToken, destination: destination.toString() }));
        // Probe access without downloading secret values.
        await dopplerSetupRequest(`/v3/configs/config/ping?${destination}`, 'GET', serviceToken, undefined, cancellation);
        const settings: QuickEnvConfig = { ...(initial.config ?? await ConfigUtils.buildDefaultConfig(root)),
            cloudSync: { ...previousCloud, provider: 'doppler', project, config: configName } };
        delete settings.cloudSync!.token;
        checkDopplerCancellation(cancellation);
        if (readSettings(root).text !== initial.text) throw new Error(t('doppler.connect.settingsChanged'));
        await GitUtils.ensureGitignoreEntries(root, ['.dotenvy.json', '.dotenvy.json.backup', '.dotenvy.lock.json', '.env', '.env.*']);
        const storageKey = `doppler:${project}:token`;
        const oldToken = await ConfigUtils.getSecret(storageKey);
        await ConfigUtils.setSecret(storageKey, serviceToken);
        const configPath = path.join(root, '.dotenvy.json');
        const temporary = `${configPath}.${crypto.randomBytes(8).toString('hex')}.tmp`;
        try {
            await fs.promises.writeFile(temporary, JSON.stringify(settings, null, 2), { mode: 0o600, flag: 'wx' });
            checkDopplerCancellation(cancellation);
            if (readSettings(root).text !== initial.text) throw new Error(t('doppler.connect.settingsChanged'));
            await fs.promises.rename(temporary, configPath);
            committed = true;
        } catch (error) {
            if (oldToken !== undefined) await ConfigUtils.setSecret(storageKey, oldToken);
            else await ConfigUtils.deleteSecret(storageKey);
            throw error;
        } finally { await fs.promises.rm(temporary, { force: true }); }
        // Refresh cached settings without persisting a bearer token.
        try { await ConfigUtils.readQuickEnvConfig(root); } catch { /* The committed file remains authoritative. */ }
        return true;
    } finally {
        if (accountToken) {
            let unusedService = committed ? undefined : serviceToken;
            try {
                if (unusedService) {
                    await revokeSetupCredential(`/v3/configs/config/tokens/token?${destination}`, accountToken, unusedService, 'DELETE');
                    unusedService = undefined;
                }
                await revokeSetupCredential('/v3/auth/cli/revoke', undefined, accountToken);
                await ConfigUtils.deleteSecret(pendingKey);
            } catch {
                // Retain only in SecretStorage so a later Connect can retry revocation.
                try {
                    await ConfigUtils.setSecret(pendingKey, JSON.stringify({ account: accountToken, service: unusedService, destination: destination.toString() }));
                } catch { /* A previous pending record may still exist; always report cleanup failure. */ }
                void vscode.window.showWarningMessage(t('doppler.connect.cleanupPending'));
            }
        }
    }
}

export class DopplerOnboarding {
    static connect(root: string): Promise<boolean> {
        const active = activeConnections.get(root);
        if (active) return active;
        const task = (async () => {
            try {
                const success = await vscode.window.withProgress({
                    location: vscode.ProgressLocation.Notification, title: t('doppler.connect.title'), cancellable: true,
                }, (progress, cancellation) => provision(root, progress, cancellation));
                if (success) void vscode.window.showInformationMessage(t('doppler.connect.success'));
                return success;
            } catch (error) {
                if (error instanceof DopplerSetupError) {
                    // Only fixed stage/reason identifiers and HTTP status; never raw responses.
                    logger.warn(`Doppler setup failed: stage=${error.stage} status=${error.status ?? 'none'} reason=${error.reason ?? 'UNCLASSIFIED'}`);
                }
                if (error instanceof vscode.CancellationError) void vscode.window.showInformationMessage(t('doppler.connect.cancelled'));
                else void vscode.window.showErrorMessage(error instanceof DopplerSetupError ? error.message :
                    // Filesystem/JSON failures may contain user data; whitelist our own messages.
                    [t('doppler.connect.invalidSettings'), t('doppler.connect.browserFailed'), t('doppler.connect.expired'), t('doppler.connect.settingsChanged')]
                        .includes((error as Error).message) ? (error as Error).message : t('doppler.connect.failed'));
                return false;
            } finally { activeConnections.delete(root); }
        })();
        activeConnections.set(root, task);
        return task;
    }

}

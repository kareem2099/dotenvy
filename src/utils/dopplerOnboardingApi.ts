import * as https from 'https';
import * as vscode from 'vscode';
import { t } from '../i18n';

export type DopplerSetupStage = 'generateCode' | 'authorize' | 'findProject' | 'listProjects' | 'createProject' |
    'findConfig' | 'createEnvironment' | 'createServiceToken' | 'verifyToken' | 'revokeCredential' | 'request';
type DopplerSetupReason = 'INVALID_PROJECT' | 'CONFIG_NOT_FOUND' | 'TOKEN_INVALID' | 'PARAMETER_REQUIRED' | 'ACCESS_DENIED' | 'INCOMPLETE_PROJECT_LIST';

/** Fixed labels only: paths, query values and provider response text never reach diagnostics. */
function requestStage(endpoint: string, method: string): DopplerSetupStage {
    switch (endpoint.split('?')[0]) {
        case '/v3/auth/cli/generate/2': return 'generateCode';
        case '/v3/auth/cli/authorize': return 'authorize';
        case '/v3/projects/project': return 'findProject';
        case '/v3/projects': return method === 'POST' ? 'createProject' : 'listProjects';
        case '/v3/configs/config': return 'findConfig';
        case '/v3/environments': return 'createEnvironment';
        case '/v3/configs/config/tokens': return method === 'POST' ? 'createServiceToken' : 'request';
        case '/v3/configs/config/ping': return 'verifyToken';
        case '/v3/auth/cli/revoke':
        case '/v3/configs/config/tokens/token': return 'revokeCredential';
        default: return 'request';
    }
}

/** No API response bodies, credentials or authorization codes in error messages. */
export class DopplerSetupError extends Error {
    constructor(public readonly status?: number, public readonly reason?: DopplerSetupReason,
        public readonly stage: DopplerSetupStage = 'request') {
        const label = t(`doppler.connect.stage.${stage}`);
        super(status ? t('doppler.connect.httpError', { status, stage: label }) : t('doppler.connect.networkError', { stage: label }));
    }
}

export function checkDopplerCancellation(cancellation?: vscode.CancellationToken): void {
    if (cancellation?.isCancellationRequested) throw new vscode.CancellationError();
}

/** Fixed HTTPS origin, no redirects, bounded responses and cancellable requests. */
export async function dopplerSetupRequest(
    endpoint: string, method = 'GET', token?: string, data?: Record<string, unknown>,
    cancellation?: vscode.CancellationToken,
): Promise<Record<string, unknown>> {
    checkDopplerCancellation(cancellation);
    const body = data ? JSON.stringify(data) : undefined;
    const stage = requestStage(endpoint, method);
    const failure = (status?: number, reason?: DopplerSetupReason) => new DopplerSetupError(status, reason, stage);
    return new Promise((resolve, reject) => {
        const request = https.request({
            hostname: 'api.doppler.com', path: endpoint, method,
            headers: {
                'Accept': 'application/json', 'Content-Type': 'application/json',
                'User-Agent': 'DotEnvy',
                ...(token ? { Authorization: `Bearer ${token}` } : {}),
                ...(body ? { 'Content-Length': Buffer.byteLength(body) } : {}),
            },
        }, response => {
            const chunks: Buffer[] = [];
            let size = 0;
            response.on('data', (chunk: Buffer) => {
                size += chunk.length;
                if (size > 512 * 1024) {
                    reject(failure());
                    request.destroy(failure());
                }
                else chunks.push(Buffer.from(chunk));
            });
            response.on('error', () => request.destroy(failure()));
            response.on('end', () => {
                clearTimeout(deadline);
                subscription?.dispose();
                if (size > 512 * 1024) return;
                if (!response.statusCode || response.statusCode < 200 || response.statusCode >= 300) {
                    const text = Buffer.concat(chunks).toString('utf8');
                    const reason = response.statusCode === 403 ? 'ACCESS_DENIED' : response.statusCode === 400 ?
                        (/\b(?:project|config)\b.{0,40}\b(?:required|missing)\b|\bmissing\b.{0,40}\b(?:project|config)\b/i.test(text) ? 'PARAMETER_REQUIRED' :
                            /\bpermission|\baccess denied|\bnot authorized|\bnot allowed/i.test(text) ? 'ACCESS_DENIED' :
                                /valid project|could not find.*project|project.{0,40}(?:not found|does not exist)/i.test(text) ? 'INVALID_PROJECT' :
                            /could not find.*config|config.{0,40}(?:not found|does not exist)/i.test(text) ? 'CONFIG_NOT_FOUND' :
                                /invalid.*token|token.*(?:not found|already revoked|not valid)|valid (?:cli |service )?token/i.test(text) ? 'TOKEN_INVALID' : undefined) : undefined;
                    reject(failure(response.statusCode, reason));
                    return;
                }
                try {
                    const text = Buffer.concat(chunks).toString('utf8');
                    const parsed = text ? JSON.parse(text) : {};
                    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error();
                    if (parsed.success === false) throw new Error();
                    resolve(parsed);
                } catch { reject(failure()); }
            });
        });
        request.on('error', () => {
            clearTimeout(deadline);
            subscription?.dispose();
            reject(cancellation?.isCancellationRequested ? new vscode.CancellationError() : failure());
        });
        request.setTimeout(15000, () => request.destroy(failure()));
        const deadline = setTimeout(() => request.destroy(failure()), 15000);
        const subscription = cancellation?.onCancellationRequested(() => request.destroy(new vscode.CancellationError()));
        if (body) request.write(body);
        request.end();
    });
}

export async function waitForDopplerPoll(milliseconds: number, cancellation: vscode.CancellationToken): Promise<void> {
    checkDopplerCancellation(cancellation);
    await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => { subscription.dispose(); resolve(); }, milliseconds);
        const subscription = cancellation.onCancellationRequested(() => {
            clearTimeout(timer); subscription.dispose(); reject(new vscode.CancellationError());
        });
    });
}

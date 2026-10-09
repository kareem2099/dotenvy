/** Aegis receives numeric corrections only; scanning has no network path. */
import * as vscode from 'vscode';
import * as https from 'https';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

export interface CommunitySample {
    id: string;
    feature_schema: 2;
    features: number[];
    label: 'high' | 'false_positive';
    user_action: 'confirmed_secret' | 'marked_false_positive';
}
export function communityEnabled(): boolean {
    return vscode.workspace.getConfiguration('dotenvy').get<boolean>('secrets.enableCommunityLearning', false);
}
export function updatesEnabled(): boolean {
    return vscode.workspace.getConfiguration('dotenvy').get<boolean>('secrets.enableModelUpdates', true);
}
export function validSample(sample: CommunitySample): boolean {
    return !!sample && /^[a-zA-Z0-9_-]{1,64}$/.test(sample.id) && sample.feature_schema === 2 &&
        Array.isArray(sample.features) && sample.features.length === 35 &&
        sample.features.every(f => typeof f === 'number' && Number.isFinite(f) && f >= 0 && f <= 1) &&
        ((sample.label === 'high' && sample.user_action === 'confirmed_secret') ||
         (sample.label === 'false_positive' && sample.user_action === 'marked_false_positive'));
}
/** Rebuild the wire object explicitly: never serialize a detection/state object. */
export function wireSample(sample: CommunitySample): CommunitySample {
    if (!validSample(sample)) { throw new Error('Invalid numeric correction'); }
    return {id: sample.id, feature_schema: 2, features: [...sample.features],
        label: sample.label, user_action: sample.user_action};
}

export class AegisClient {
    private static readonly URL = 'https://aegis.dotsuite.dev';
    private registering?: Promise<void>;
    private closed = false;
    private readonly activeRequests = new Set<import("http").ClientRequest>();
    constructor(private readonly context: vscode.ExtensionContext) {}

    private request(endpoint: '/extension/register' | '/extension/feedback' | '/model/release',
                    body = '', headers: Record<string, string> = {}): Promise<{status: number; data: unknown}> {
        if (this.closed) { return Promise.reject(new Error('Aegis client stopped')); }
        return new Promise((resolve, reject) => {
            const url = new URL(endpoint, AegisClient.URL);
            const req = https.request(url, {method: body ? 'POST' : 'GET', headers: {
                'User-Agent': 'DotEnvy-Extension/2.2.4',
                ...(body ? {'Content-Type': 'application/json', 'Content-Length': String(Buffer.byteLength(body))} : {}),
                ...headers}}, res => {
                const chunks: Buffer[] = []; let size = 0;
                res.on('data', (chunk: Buffer) => {
                    size += chunk.length;
                    if (size > 2 * 1024 * 1024) { req.destroy(new Error('Aegis response too large')); return; }
                    chunks.push(chunk);
                });
                res.on('error', reject);
                res.on('end', () => {
                    const status = res.statusCode || 0;
                    if (status === 304) { resolve({status, data: undefined}); return; }
                    if (status !== 200) { reject(new Error(`Aegis HTTP ${status}`)); return; }
                    try { resolve({status, data: JSON.parse(Buffer.concat(chunks).toString('utf8'))}); }
                    catch { reject(new Error('Invalid Aegis response')); }
                });
            });
            this.activeRequests.add(req);
            req.once('close', () => this.activeRequests.delete(req));
            req.on('error', reject);
            req.setTimeout(10000, () => req.destroy(new Error('Aegis timeout')));
            req.end(body || undefined);
        });
    }

    private async credentials(): Promise<void> {
        if (!communityEnabled()) { throw new Error('Community learning disabled'); }
        if (this.registering) { return this.registering; }
        this.registering = (async () => {
            const existing = await this.context.secrets.get('dotenvy.llm.sharedSecret');
            if (existing) { return; }
            // A saved ID without its credential cannot prove ownership: make a new installation.
            const machine = crypto.randomUUID();
            await this.context.globalState.update('dotenvy.llm.installationId', machine);
            if (!communityEnabled()) { throw new Error('Community learning disabled'); }
            const result = await this.request('/extension/register', JSON.stringify({machine_id: machine,
                vscode_version: vscode.version || '', extension_version: '2.2.4'}));
            const secret = (result.data as {client_secret?: string}).client_secret;
            if (typeof secret !== 'string' || secret.length < 32 || secret.length > 512) { throw new Error('Invalid device credential'); }
            await this.context.secrets.store('dotenvy.llm.sharedSecret', secret);
        })().finally(() => {this.registering = undefined;});
        return this.registering;
    }

    async sendFeedback(samples: CommunitySample[]): Promise<string[]> {
        if (!communityEnabled() || samples.length < 1 || samples.length > 20) { throw new Error('Feedback unavailable'); }
        const body = JSON.stringify({samples: samples.map(wireSample)});
        await this.credentials();
        if (!communityEnabled()) { throw new Error('Community learning disabled'); }
        const secret = await this.context.secrets.get('dotenvy.llm.sharedSecret');
        const machine = this.context.globalState.get<string>('dotenvy.llm.installationId') || vscode.env.machineId;
        if (!secret || !machine) { throw new Error('Device credential unavailable'); }
        const timestamp = String(Math.floor(Date.now() / 1000));
        const result = await this.request('/extension/feedback', body, {'X-Machine-ID': machine,
            'X-Extension-Timestamp': timestamp,
            'X-Extension-Signature': crypto.createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex')});
        const response = result.data as {status?: string; accepted_sample_ids?: string[]};
        if (response.status !== 'queued' || !Array.isArray(response.accepted_sample_ids) ||
            !samples.every(sample => response.accepted_sample_ids!.includes(sample.id))) { throw new Error('Feedback not acknowledged'); }
        return samples.map(sample => sample.id);
    }

    cachedDirectory(): string | undefined {
        const hash = this.context.globalState.get<string>('dotenvy.model.activeHash');
        if (!hash || !/^[a-f0-9]{64}$/.test(hash) || !this.context.globalStorageUri) { return; }
        return path.join(this.context.globalStorageUri.fsPath, 'models', hash);
    }

    async fetchModel(): Promise<{directory: string; hash: string} | undefined> {
        if (!updatesEnabled() || !this.context.globalStorageUri) { return; }
        const revision = this.context.globalState.get<string>('dotenvy.model.revision');
        const cached = this.cachedDirectory();
        const headers: Record<string, string> = {};
        // An ETag is valid only for the actual cached release, including after a
        // partially failed preference write or externally corrupted/deleted files.
        if (revision && /^[a-f0-9]{64}$/.test(revision) && cached) {
            try {
                const saved = JSON.parse(fs.readFileSync(path.join(cached, 'aegis-v2.manifest.json'), 'utf8'));
                const weights = fs.readFileSync(path.join(cached, 'aegis-v2.json.gz'));
                if (saved.revision === revision && saved.sha256 === path.basename(cached) &&
                    crypto.createHash('sha256').update(weights).digest('hex') === saved.sha256) {
                    headers['If-None-Match'] = `"${revision}"`;
                }
            } catch { /* Request a full release to repair missing or invalid cache state. */ }
        }
        const result = await this.request('/model/release', '', headers);
        if (result.status === 304 || !updatesEnabled() || this.closed) { return; }
        const release = result.data as {manifest: {sha256: string; revision: string; format: string; feature_schema: number}; weights_base64: string};
        const manifest = release?.manifest;
        if (!manifest || manifest.format !== 'dotenvy-local-transformer-v1' || manifest.feature_schema !== 2 ||
            !/^[a-f0-9]{64}$/.test(manifest.sha256) || !/^[a-f0-9]{64}$/.test(manifest.revision) ||
            typeof release.weights_base64 !== 'string' || release.weights_base64.length > 1500000) { throw new Error('Invalid model release'); }
        const data = Buffer.from(release.weights_base64, 'base64');
        if (crypto.createHash('sha256').update(data).digest('hex') !== manifest.sha256) { throw new Error('Model checksum mismatch'); }
        const directory = path.join(this.context.globalStorageUri.fsPath, 'models', manifest.sha256);
        fs.mkdirSync(directory, {recursive: true});
        fs.writeFileSync(path.join(directory, 'aegis-v2.json.gz'), data);
        fs.writeFileSync(path.join(directory, 'aegis-v2.manifest.json'), JSON.stringify(manifest));
        return {directory, hash: manifest.sha256};
    }

    async acceptModel(directory: string, hash: string): Promise<void> {
        const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'aegis-v2.manifest.json'), 'utf8'));
        await this.context.globalState.update('dotenvy.model.revision', manifest.revision);
        await this.context.globalState.update('dotenvy.model.activeHash', hash);
        // Only the active download is retained; bundled weights are the permanent offline fallback.
        for (const name of fs.readdirSync(path.dirname(directory))) {
            if (/^[a-f0-9]{64}$/.test(name) && name !== hash) {
                try { fs.rmSync(path.join(path.dirname(directory), name), {recursive: true, force: true}); }
                catch { /* Cache cleanup must not prevent a ready model from being activated. */ }
            }
        }
    }
    async clearCachedRevision(): Promise<void> { await this.context.globalState.update('dotenvy.model.revision', undefined); }
    dispose(): void {
        this.closed = true;
        for (const request of this.activeRequests) { request.destroy(new Error('Aegis client stopped')); }
        this.activeRequests.clear();
    }
}

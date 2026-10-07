/**
 * HMAC-signed HTTP calls from the extension to the analysis service.
 */

import * as https from 'https';
import * as http from 'http';
import * as crypto from 'crypto';

/**
 * Signs a request body with the shared secret and the current unix timestamp.
 */
export function signRequest(secret: string | undefined, body: string): { timestamp: string; signature: string } {
    if (!secret) {
        throw new Error('[DotEnvy] Cannot sign — secret not loaded.');
    }
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = crypto
        .createHmac('sha256', secret)
        .update(`${timestamp}.${body}`)
        .digest('hex');
    return { timestamp, signature };
}

/**
 * Sends a signed request that carries no body.
 */
export function makeSignedGetRequest(
    serviceUrl: string,
    secret: string | undefined,
    method: string,
    endpoint: string,
    machineId: string,
): Promise<unknown> {
    if (!secret) {
        throw new Error('[DotEnvy] Cannot sign — secret not loaded.');
    }
    const body = '';
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = crypto
        .createHmac('sha256', secret)
        .update(`${timestamp}.${body}`)
        .digest('hex');

    return new Promise((resolve, reject) => {
        const url = new URL(endpoint, serviceUrl);
        const client = url.protocol === 'https:' ? https : http;
        const req = client.request({
            hostname: url.hostname,
            port: url.port || (url.protocol === 'https:' ? 443 : 80),
            path: url.pathname,
            method,
            headers: {
                'User-Agent': 'DotEnvy-Extension/2.0',
                'X-Extension-Timestamp': timestamp,
                'X-Extension-Signature': signature,
                'X-Machine-ID': machineId,
            },
        }, (res) => {
            let responseBody = '';
            res.on('data', (chunk) => { responseBody += chunk.toString(); });
            res.on('end', () => { try { resolve(JSON.parse(responseBody)); } catch { resolve(responseBody); } });
        });
        req.on('error', reject);
        req.setTimeout(5000, () => { req.destroy(); reject(new Error('Timeout')); });
        req.end();
    });
}

/**
 * Sends a signed JSON request.
 */
export function makeSignedRequest(
    serviceUrl: string,
    secret: string | undefined,
    method: string,
    endpoint: string,
    data: unknown,
    machineId: string,
): Promise<unknown> {
    const body = JSON.stringify(data);
    const { timestamp, signature } = signRequest(secret, body);

    return new Promise((resolve, reject) => {
        const url = new URL(endpoint, serviceUrl);
        const client = url.protocol === 'https:' ? https : http;
        const req = client.request({
            hostname: url.hostname,
            port: url.port || (url.protocol === 'https:' ? 443 : 80),
            path: url.pathname,
            method,
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(body),
                'User-Agent': 'DotEnvy-Extension/2.0',
                'X-Extension-Timestamp': timestamp,
                'X-Extension-Signature': signature,
                'X-Machine-ID': machineId,
            },
        }, (res) => {
            let responseBody = '';
            res.on('data', (chunk) => { responseBody += chunk.toString(); });
            res.on('end', () => {
                if (res.statusCode && res.statusCode >= 400) {
                    reject(new Error(`HTTP ${res.statusCode}: ${responseBody}`)); return;
                }
                try { resolve(JSON.parse(responseBody)); } catch { resolve(responseBody); }
            });
        });
        req.on('error', reject);
        req.setTimeout(5000, () => { req.destroy(); reject(new Error('Timeout')); });
        req.write(body);
        req.end();
    });
}

/**
 * Sends an unsigned request to the analysis service.
 */
export function makeRequest(serviceUrl: string, endpoint: string, method = 'GET'): Promise<unknown> {
    return new Promise((resolve, reject) => {
        const url = new URL(endpoint, serviceUrl);
        const client = url.protocol === 'https:' ? https : http;
        const req = client.request({
            hostname: url.hostname,
            port: url.port || (url.protocol === 'https:' ? 443 : 80),
            path: url.pathname,
            method,
            headers: { 'User-Agent': 'DotEnvy-Extension/2.0' },
        }, (res) => {
            let responseBody = '';
            res.on('data', (chunk) => { responseBody += chunk.toString(); });
            res.on('end', () => { try { resolve(JSON.parse(responseBody)); } catch { resolve(responseBody); } });
        });
        req.on('error', reject);
        req.setTimeout(5000, () => { req.destroy(); reject(new Error('Timeout')); });
        req.end();
    });
}

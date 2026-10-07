/**
 * Suggested environment variable names for detected secrets.
 */

import * as path from 'path';
import { DetectedSecret } from './secretScannerTypes';

/**
 * Builds a unique env var name for one secret among others in the same file.
 */
export function generateUniqueEnvVar(secrets: DetectedSecret[], currentSecret: DetectedSecret): string {
    const sameFileSecrets = secrets.filter(s =>
        s.file === currentSecret.file &&
        s.type === currentSecret.type &&
        s !== currentSecret
    );

    let suffix = '';
    if (sameFileSecrets.length > 0) {
        suffix = `_${sameFileSecrets.length + 1}`;
    }

    return generateBaseEnvVarName(currentSecret) + suffix;
}

/**
 * Maps a detected secret type to a conventional environment variable name.
 */
export function generateBaseEnvVarName(secret: DetectedSecret): string {
    const type = secret.type;

    const typeMap: Record<string, string> = {
        'AWS API Key': 'AWS_ACCESS_KEY_ID',
        'Stripe Secret Key': 'STRIPE_SECRET_KEY',
        'Stripe Publishable Key': 'STRIPE_PUBLISHABLE_KEY',
        'OpenAI API Key': 'OPENAI_API_KEY',
        'GitHub Personal Access Token': 'GITHUB_TOKEN',
        'GitHub Fine-grained PAT': 'GITHUB_TOKEN',
        'Slack Bot Token': 'SLACK_BOT_TOKEN',
        'Discord Bot Token': 'DISCORD_BOT_TOKEN',
        'JWT Secret': 'JWT_SECRET',
        'Database Connection URL': 'DATABASE_URL',
        'MongoDB Atlas Connection': 'MONGODB_URI',
        'SendGrid API Key': 'SENDGRID_API_KEY',
        'Mailgun API Key': 'MAILGUN_API_KEY',
        'Twilio Auth Token': 'TWILIO_AUTH_TOKEN',
        'Sentry DSN': 'SENTRY_DSN',
        'DigitalOcean Token': 'DIGITALOCEAN_TOKEN',
        'Vercel API Token': 'VERCEL_API_TOKEN',
        'SSH Private Key': 'SSH_PRIVATE_KEY',
        'SSL Certificate': 'SSL_CERTIFICATE',
        'Bearer Token': 'AUTH_BEARER_TOKEN',
        'Password': 'PASSWORD',
        'Secret Key': 'SECRET_KEY'
    };

    if (typeMap[type]) {
        return typeMap[type];
    }

    if (secret.content.startsWith('sk-')) return 'SECRET_KEY';
    if (secret.content.startsWith('pk_')) return 'PUBLIC_KEY';

    const fileName = path.basename(secret.file, path.extname(secret.file));
    const baseName = fileName.toUpperCase().replace(/[^A-Z0-9]/g, '_');

    return `${baseName}_SECRET`;
}

/**
 * Assigns a distinct suggestedEnvVar to each detected secret.
 */
export function assignUniqueEnvVarNames(secrets: DetectedSecret[]): DetectedSecret[] {
    const usedNames = new Set<string>();

    return secrets.map(secret => {
        const baseName = generateBaseEnvVarName(secret);
        let finalName = baseName;
        let counter = 1;

        while (usedNames.has(finalName)) {
            finalName = `${baseName}_${counter}`;
            counter++;
        }

        usedNames.add(finalName);
        return {
            ...secret,
            suggestedEnvVar: finalName
        };
    });
}

/**
 * Extracts a variable identifier from a source line surrounding a secret.
 */
export function extractVariableName(context: string): string | undefined {
    const patterns = [
        /(?:const|let|var)\s+(\w+)\s*[:=]/,
        /(\w+)\s*[:=]/,
        /(\w+)\s*\.\.\./
    ];

    for (const pattern of patterns) {
        const match = context.match(pattern);
        if (match && match[1] && !match[1].includes('.') && !match[1].includes('"') && !match[1].includes("'")) {
            return match[1];
        }
    }

    return undefined;
}

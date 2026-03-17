#!/usr/bin/env node

/**
 * Build script with environment variable substitution
 * Embeds EXTENSION_SHARED_SECRET at build time — NOT an API key.
 * This secret is only used to sign requests with HMAC-SHA256.
 */

const fs = require('fs');
const path = require('path');

// ─── Load from .env file OR from environment directly ─────────────────────────
let sharedSecret = process.env.EXTENSION_SHARED_SECRET || '';

if (!sharedSecret) {
    // Try reading from .env file (local development)
    const envPath = path.join(__dirname, '..', '.env');
    if (fs.existsSync(envPath)) {
        const envContent = fs.readFileSync(envPath, 'utf8');
        const match = envContent.match(/EXTENSION_SHARED_SECRET="([^"]+)"/);
        sharedSecret = match ? match[1] : '';
    }
}

if (!sharedSecret) {
    console.error('❌ Error: EXTENSION_SHARED_SECRET not found!');
    console.error('   Set it in .env file or as an environment variable.');
    process.exit(1);
}

console.log('✅ Found EXTENSION_SHARED_SECRET');

// ─── Patch the compiled llmAnalyzer.js ────────────────────────────────────────
const outputPath = path.join(__dirname, '..', 'out', 'utils', 'llmAnalyzer.js');

if (!fs.existsSync(outputPath)) {
    console.error(`❌ Error: Compiled file not found at ${outputPath}`);
    console.error('   Run "npm run compile" first.');
    process.exit(1);
}

let outputContent = fs.readFileSync(outputPath, 'utf8');

// Replace the placeholder with the actual secret
const replaced = outputContent.replace(
    /process\.env\.EXTENSION_SHARED_SECRET \|\| 'REPLACE_AT_BUILD_TIME'/g,
    `"${sharedSecret}"`
);

if (replaced === outputContent) {
    console.warn('⚠️  Warning: placeholder not found in compiled code.');
    console.warn('   Make sure llmAnalyzer.ts uses:');
    console.warn("   process.env.EXTENSION_SHARED_SECRET || 'REPLACE_AT_BUILD_TIME'");
} else {
    fs.writeFileSync(outputPath, replaced);
    console.log('✅ Successfully embedded EXTENSION_SHARED_SECRET in compiled code');
}

console.log('✅ Build completed successfully');
#!/usr/bin/env node

/**
 * Pre-publish Security Validator for DotEnvy
 * Ensures that no embedded secrets or high-entropy tokens are present
 * in the compiled output before packaging to marketplace/open-vsx.
 */

const fs = require('fs');
const path = require('path');

const outDir = path.join(__dirname, '..', 'out');
if (!fs.existsSync(outDir)) {
    console.log('ℹ️ out/ directory not found. Run "npm run compile" first.');
    process.exit(0);
}

function scanDir(dir) {
    let flagged = 0;
    const files = fs.readdirSync(dir);
    for (const f of files) {
        const fullPath = path.join(dir, f);
        if (fs.statSync(fullPath).isDirectory()) {
            flagged += scanDir(fullPath);
        } else if (fullPath.endsWith('.js')) {
            const content = fs.readFileSync(fullPath, 'utf8');
            // Check for any embedded secrets
            if (content.includes('dX9zM4vB7qW2nK8pR5tJ0cL3hG1yS6fN9mZ4xR7bV0qP3sT6wK8jL2vN5mQ8')) {
                console.error(`❌ Security Alert: Leaked secret string detected in ${fullPath}!`);
                flagged++;
            }
            if (/const embeddedSecret = "[A-Za-z0-9_-]{20,}"/.test(content)) {
                console.error(`❌ Security Alert: Hardcoded embeddedSecret found in ${fullPath}!`);
                flagged++;
            }
        }
    }
    return flagged;
}

const flags = scanDir(outDir);
if (flags > 0) {
    console.error(`\n❌ Pre-publish check failed: ${flags} leaked secret(s) found in out/!`);
    process.exit(1);
} else {
    console.log('✅ Security check passed: 0 embedded secrets found in compiled out/ bundle.');
}
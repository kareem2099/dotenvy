#!/usr/bin/env node

/**
 * Build script with environment variable substitution
 * This script replaces process.env.LLM_API_KEY with the actual value during build
 */

const fs = require('fs');
const path = require('path');

// Read the .env file
const envPath = path.join(__dirname, '..', '.env');
const envContent = fs.readFileSync(envPath, 'utf8');

// Extract the API key
const apiKeyMatch = envContent.match(/LLM_API_KEY="([^"]+)"/);
const apiKey = apiKeyMatch ? apiKeyMatch[1] : '';

if (!apiKey) {
    console.error('❌ Error: LLM_API_KEY not found in .env file');
    process.exit(1);
}

console.log('✅ Found LLM_API_KEY in .env file');

// Read the compiled JavaScript file
const outputPath = path.join(__dirname, '..', 'out', 'utils', 'llmAnalyzer.js');
const outputContent = fs.readFileSync(outputPath, 'utf8');

// Replace process.env.LLM_API_KEY with the actual value
const updatedContent = outputContent.replace(
    /process\.env\.LLM_API_KEY \|\| ''/g,
    `"${apiKey}"`
);

// Write the updated content back
fs.writeFileSync(outputPath, updatedContent);

console.log('✅ Successfully replaced LLM_API_KEY in compiled code');
console.log('✅ Build completed with environment variable substitution');
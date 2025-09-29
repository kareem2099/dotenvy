// Test script to demonstrate the enhanced secret scanner
const { SecretScanner } = require('./out/utils/secretScanner');

async function testSecretScanner() {
    console.log('🧠 Testing Enhanced Secret Scanner with Advanced Algorithms\n');
    console.log('=' .repeat(60));

    try {
        // Test scanning the test file
        const results = await SecretScanner.scanFile('./test-secrets.js');

        console.log(`\n📊 SCAN RESULTS: Found ${results.length} potential secrets\n`);
        console.log('=' .repeat(60));

        if (results.length === 0) {
            console.log('❌ No secrets detected - scanner may need adjustment');
            return;
        }

        // Group results by detection method
        const byMethod = {
            pattern: results.filter(r => r.detectionMethod === 'pattern'),
            statistical: results.filter(r => r.detectionMethod === 'statistical'),
            contextual: results.filter(r => r.detectionMethod === 'contextual'),
            hybrid: results.filter(r => r.detectionMethod === 'hybrid')
        };

        // Show summary
        console.log('📈 DETECTION SUMMARY:');
        console.log(`   Pattern-based: ${byMethod.pattern.length}`);
        console.log(`   Statistical: ${byMethod.statistical.length}`);
        console.log(`   Contextual: ${byMethod.contextual.length}`);
        console.log(`   Hybrid: ${byMethod.hybrid.length}`);
        console.log('');

        // Show detailed results
        results.forEach((secret, index) => {
            console.log(`${index + 1}. 🎯 ${secret.type}`);
            console.log(`   📄 File: ${secret.file}:${secret.line}`);
            console.log(`   🔍 Content: "${secret.content}"`);
            console.log(`   🧠 Detection: ${secret.detectionMethod} (${(secret.riskScore * 100).toFixed(1)}% confidence)`);
            console.log(`   ⚠️  Risk: ${secret.reasoning.join(', ')}`);
            console.log(`   💡 Suggested Env Var: ${secret.suggestedEnvVar}`);
            console.log('');
        });

        // Analyze false positive rate
        const falsePositives = results.filter(r =>
            r.content === 'HELLO_WORLD' ||
            r.content === '12345' ||
            r.content === 'ABCDEFGHIJKLMNOPQRSTUVWXYZ' ||
            r.content === 'v2.1.3' ||
            r.content.includes('https://api.example.com') ||
            r.content.includes('jsonExample')
        );

        console.log('=' .repeat(60));
        console.log('📋 ANALYSIS:');
        console.log(`✅ Total Detections: ${results.length}`);
        console.log(`❌ False Positives: ${falsePositives.length}`);
        console.log(`🎯 True Positives: ${results.length - falsePositives.length}`);
        console.log(`📊 Accuracy: ${((results.length - falsePositives.length) / results.length * 100).toFixed(1)}%`);

        if (falsePositives.length > 0) {
            console.log('\n⚠️  FALSE POSITIVES DETECTED:');
            falsePositives.forEach(fp => {
                console.log(`   - "${fp.content}" (${fp.type})`);
            });
        }

    } catch (error) {
        console.error('❌ Test failed:', error.message);
    }
}

// Run the test
testSecretScanner().catch(console.error);

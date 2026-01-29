/**
 * LLM Service Connection Test
 * Tests the connection to the Railway-deployed LLM service
 */

// Load environment variables FIRST, before importing llmAnalyzer
import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../.env') });

// Now import the LLM analyzer AFTER environment is configured
import { llmAnalyzer } from '../src/utils/llmAnalyzer';

async function runTests() {
    console.log('Testing LLM Service Connection to Railway');
    console.log('='.repeat(50));
    console.log(`Service URL: ${process.env.DOTENVY_LLM_SERVICE_URL}`);
    console.log(`API Key: ${process.env.LLM_API_KEY ? ' Configured' : ' Missing'}`);
    console.log('='.repeat(50));

    // Configure service URL manually (in case singleton was created before env loaded)
    if (process.env.DOTENVY_LLM_SERVICE_URL) {
        llmAnalyzer.setServiceUrl(process.env.DOTENVY_LLM_SERVICE_URL);
        console.log('Service URL configured manually');
    }

    // Test 1: Service Status (Before Connection)
    console.log('\n Test 1: Service Status (Before Connection)');
    const initialStatus = llmAnalyzer.getServiceStatus();
    console.log(JSON.stringify(initialStatus, null, 2));

    // Test 2: Health Check
    console.log('\n Test 2: Health Check');
    try {
        const isConnected = await llmAnalyzer.testConnection();
        if (isConnected) {
            console.log('Connection successful!');
            console.log('Railway LLM service is ONLINE and responding!');
        } else {
            console.log('Connection failed!');
            console.log('Using fallback analysis only');
        }
    } catch (error) {
        console.error('Error during health check:', error);
    }

    // Test 3: Analyze a Stripe API Key
    console.log('\n Test 3: Analyze Stripe API Key');
    try {
        const startTime = Date.now();
        const result = await llmAnalyzer.analyzeSecret(
            'sk-test_1234567890abcdefghijklm',
            'const stripeKey = "sk-test_1234567890abcdefghijklm";',
            'stripeKey'
        );
        const duration = Date.now() - startTime;
        console.log(`Confidence Level: ${result} (${duration}ms)`);
    } catch (error) {
        console.error('Error during analysis:', error);
    }

    // Test 4: Analyze a GitHub Token
    console.log('\n Test 4: Analyze GitHub Token');
    try {
        const startTime = Date.now();
        const result = await llmAnalyzer.analyzeSecret(
            'ghp_abcd1234efgh5678ijkl9012mnop',
            'GITHUB_TOKEN=ghp_abcd1234efgh5678ijkl9012mnop',
            'GITHUB_TOKEN'
        );
        const duration = Date.now() - startTime;
        console.log(`Confidence Level: ${result} (${duration}ms)`);
    } catch (error) {
        console.error('Error during analysis:', error);
    }

    // Test 5: Analyze an AWS Access Key
    console.log('\n Test 5: Analyze AWS Access Key');
    try {
        const startTime = Date.now();
        const result = await llmAnalyzer.analyzeSecret(
            'AKIAIOSFODNN7EXAMPLE',
            'AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE',
            'AWS_ACCESS_KEY_ID'
        );
        const duration = Date.now() - startTime;
        console.log(`Confidence Level: ${result} (${duration}ms)`);
    } catch (error) {
        console.error('Error during analysis:', error);
    }

    // Test 6: Analyze a non-secret value
    console.log('\n Test 6: Analyze Non-Secret Value');
    try {
        const startTime = Date.now();
        const result = await llmAnalyzer.analyzeSecret(
            'localhost',
            'const host = "localhost";',
            'host'
        );
        const duration = Date.now() - startTime;
        console.log(`Confidence Level: ${result} (${duration}ms)`);
    } catch (error) {
        console.error('Error during analysis:', error);
    }

    // Test 7: Feature Extraction
    console.log('\n Test 7: Feature Extraction');
    const features = llmAnalyzer.extractFeatures(
        'sk-test_1234567890abcdefghijklm',
        'const stripeKey = "sk-test_1234567890abcdefghijklm";',
        'stripeKey'
    );
    console.log(`Extracted ${features.length} features:`, features.slice(0, 5).map(f => f.toFixed(2)));

    // Test 8: Circuit Breaker (Service Availability)
    console.log('\n Test 8: Service Availability Check');
    const isAvailable = llmAnalyzer.isServiceAvailable();
    console.log(` Service Available: ${isAvailable ? ' Yes' : ' No'}`);

    // Final Status
    console.log('\n' + '='.repeat(50));
    console.log('Final Service Status');
    const finalStatus = llmAnalyzer.getServiceStatus();
    console.log(JSON.stringify(finalStatus, null, 2));

    if (finalStatus.connected && finalStatus.configured) {
        console.log('\nSUCCESS: All systems operational!');
        console.log('My LLM service on Railway is working perfectly!');
    } else if (finalStatus.configured && !finalStatus.connected) {
        console.log('\n WARNING: Service configured but not connected');
        console.log('Fallback analysis is being used');
    } else {
        console.log('\n ERROR: Service not properly configured');
    }

    console.log('\n All tests completed!');
}

// Run tests
runTests().catch(error => {
    console.error(' Test suite failed:', error);
    process.exit(1);
});

const assert = require('assert/strict');
const Module = require('module');
const http = require('http'), https = require('https');
let networkCalls = 0;
http.request = https.request = () => {networkCalls++; throw new Error('Secret guard must not contact a service');};
global.fetch = () => {networkCalls++; throw new Error('Secret guard must not fetch');};
const state = new Map([['dotenvy.llm.installationId','old-device-id']]);
const credentials = new Map([['dotenvy.llm.sharedSecret','old-device-credential']]);
const mock = {
  workspace: {getConfiguration: () => ({get: key => key === 'secrets.enableCloudAnalysis'})},
  window: {createOutputChannel: () => ({appendLine() {}, show() {}, clear() {}})}
};
const original = Module.prototype.require;
Module.prototype.require = function(name) {return name === 'vscode' ? mock : original.apply(this, arguments);};
const {LLMAnalyzer} = require('../out/utils/llmAnalyzer');
const {FeedbackManager} = require('../out/utils/feedbackManager');
const {FeatureExtractor} = require('../out/utils/featureExtractor');
const {LocalTransformer} = require('../out/utils/localModel');
const path = require('path');
const context = {subscriptions: [],
  secrets: {delete: async key => credentials.delete(key)},
  globalState: {get: (key, fallback) => state.get(key) || fallback,
    update: async (key, value) => value === undefined ? state.delete(key) : state.set(key, value)}
};
async function main() {
  const analyzer = await LLMAnalyzer.initialize(context);
  try {
    await FeedbackManager.init(context);
    assert.equal(credentials.size, 1);
    assert.equal(state.has('dotenvy.llm.installationId'), true);
    assert.ok(analyzer.isModelAvailable());
    assert.equal(analyzer.getServiceStatus().mode, 'local');
    const model = LocalTransformer.load(path.resolve(__dirname, '../resources/models'));
    for (const test of require('./feature-parity.json')) {
      const result = model.predict(FeatureExtractor.extract(test.value, test.context, test.name || undefined));
      assert.equal(await analyzer.analyzeSecret(test.value, test.context, test.name || undefined),
        result.prediction === 'false_positive' ? 'low' : result.prediction);
    }
    const secret = {sourceFile:'/synthetic-workspace/example.ts',variableName:'API_KEY',valueDigest:'a'.repeat(64)};
    await FeedbackManager.recordFalsePositive(secret);
    await FeedbackManager.recordConfirmed(secret);
    assert.equal(networkCalls, 0, 'legacy cloud=true must never re-enable network traffic');
    analyzer.dispose();
    assert.ok(['low','medium','high'].includes(await analyzer.analyzeSecret('SyntheticValue012345', '', 'KEY')));
    assert.equal(networkCalls, 0, 'unavailable local model must not fall back to cloud');
    console.log('✅ Offline initialization, actual transformer inference, preserved device identity, local feedback, and fallback: zero HTTP/fetch calls even with legacy cloud=true.');
  } finally { analyzer.dispose(); }
}
main().then(() => process.exit(0)).catch(error => {console.error(error); process.exit(1);});

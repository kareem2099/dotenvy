const assert = require('assert/strict');
const crypto = require('crypto');
const Module = require('module');
let cloud = false;
const state = new Map([['dotenvy.feedback.entries', [{context: 'old raw source context'}]]]);
const credentials = new Map();
const writes = [];
const raw = 'sk-SyntheticReviewValue0123456789AbCdEf';
let currentLine = 'const API_KEY = "' + raw + '";';
const workspace = {uri: {fsPath: '/synthetic-workspace'}};
const vscode = {
  ExtensionMode: {Development: 1},
  workspace: {
    getConfiguration: () => ({get: (_key, fallback) => cloud}),
    workspaceFolders: [workspace],
    getWorkspaceFolder: () => workspace,
    openTextDocument: async () => ({lineAt: () => ({text: currentLine})}),
    asRelativePath: () => 'sample.ts',
    fs: {readFile: async () => {throw new Error('missing');}, writeFile: async (_uri, data) => writes.push(data.toString())}
  },
  Uri: {file: value => ({fsPath: value}), joinPath: (uri, name) => ({fsPath: uri.fsPath + '/' + name})},
  window: {
    createOutputChannel: () => ({appendLine() {}, show() {}, clear() {}}),
    showInformationMessage() {}, showErrorMessage() {}
  },
  env: {machineId: 'synthetic-test-device'}
};
const original = Module.prototype.require;
Module.prototype.require = function(name) { return name === 'vscode' ? vscode : original.apply(this, arguments); };
const {LLMAnalyzer} = require('../out/utils/llmAnalyzer');
const {FeedbackManager} = require('../out/utils/feedbackManager');
const {SecretDetector} = require('../out/utils/secretDetector');
const {SecretsPanel} = require('../out/providers/SecretsPanel');
const {FeatureExtractor} = require('../out/utils/featureExtractor');
const {readDetectedValue, encodeEnvValue} = require('../out/utils/detectedSecretValue');
const context = {
  extensionMode: 1,
  secrets: {get: async key => credentials.get(key), store: async (key, value) => credentials.set(key, value)},
  globalState: {
    get: (key, fallback) => structuredClone(state.get(key) || fallback),
    update: async (key, value) => { if (value === undefined) state.delete(key); else state.set(key, structuredClone(value)); }
  }
};
async function main() {
  for (const test of require('./feature-parity.json')) {
    const actual = FeatureExtractor.extract(test.value, test.context, test.name || undefined);
    actual.forEach((value, i) => assert.ok(Math.abs(value - test.features[i]) < 1e-6,
      `Python/TypeScript feature ${i} mismatch for the synthetic parity fixture`));
  }
  const analyzer = await LLMAnalyzer.initialize(context);
  await analyzer.setSharedSecret('test-only-synthetic-credential');
  await FeedbackManager.init(context);
  assert.equal(state.has('dotenvy.feedback.entries'), false, 'legacy raw queue must be purged');

  const detections = await SecretDetector.scanLine(currentLine, 0, [currentLine], '/synthetic-workspace/sample.ts');
  assert.ok(detections.length);
  const secret = {...detections[0], confidence: 'low', suggestedEnvVar: 'API_KEY'};
  assert.equal(secret.content.includes(raw), false);
  assert.equal(secret.context.includes(raw), false);
  assert.deepEqual(secret.features, FeatureExtractor.extract(raw, secret.context, secret.variableName));
  const originalValue = await readDetectedValue(secret);
  assert.equal(originalValue.value, raw);
  const passwordLine = 'const password = "SyntheticPassword012345ABCD";';
  const passwordDetections = await SecretDetector.scanLine(passwordLine, 0, [passwordLine], '/synthetic-workspace/password.ts');
  const password = passwordDetections.find(s => s.type === 'Generic Password');
  assert.ok(password);
  assert.equal(password.valueLength, 'SyntheticPassword012345ABCD'.length);
  assert.equal(password.column - 1, passwordLine.indexOf('SyntheticPassword'));
  await Promise.all([FeedbackManager.recordConfirmed(secret), FeedbackManager.recordFalsePositive(secret)]);
  let entries = state.get('dotenvy.feedback.features.v2');
  assert.equal(entries.length, 2, 'concurrent saves must preserve both entries');
  assert.equal(entries[0].label, 'high', 'confirmation overrides a low prediction');
  assert.equal(entries[1].label, 'false_positive');
  assert.equal(JSON.stringify(entries).includes(raw), false);
  assert.ok(entries.every(e => !('context' in e) && !('secret_value' in e)));
  assert.notEqual(analyzer.hashEntry('API_KEY', 'sk_live_Alpha'), analyzer.hashEntry('API_KEY', 'sk_live_Beta'));
  assert.equal(analyzer.hashEntry('API_KEY', raw), crypto.createHash('sha256').update(JSON.stringify(['API_KEY', raw])).digest('hex'));

  cloud = true;
  let mode = 'partial';
  let requests = 0;
  let release;
  analyzer.makeSignedRequest = async (endpoint, data) => {
    assert.equal(endpoint, '/extension/feedback');
    assert.ok(data.samples.every(s => !('context' in s) && !('secret_value' in s)));
    requests++;
    if (mode === 'delay') await new Promise(resolve => {release = resolve;});
    return {status: 'queued', accepted_sample_ids: mode === 'partial' ? [] : data.samples.map(s => s.id)};
  };
  await FeedbackManager.flush();
  assert.equal(state.get('dotenvy.feedback.features.v2').filter(e => e.sent).length, 0);
  mode = 'delay';
  const flushing = FeedbackManager.flush();
  const duplicateFlush = FeedbackManager.flush();
  while (!release) await new Promise(resolve => setImmediate(resolve));
  cloud = false;
  await FeedbackManager.recordConfirmed(secret);
  release();
  await Promise.all([flushing, duplicateFlush]);
  entries = state.get('dotenvy.feedback.features.v2');
  assert.equal(entries.length, 3, 'an entry added during upload must survive');
  assert.equal(entries.filter(e => e.sent).length, 2);
  assert.equal(requests, 2, 'overlapping flushes must share the same upload');

  const panel = Object.create(SecretsPanel.prototype);
  panel._remove = () => {};
  await panel._moveToEnv(secret);
  assert.ok(writes[0].includes('API_KEY=' + raw));
  assert.equal(writes[0].includes(secret.content), false);
  currentLine = currentLine.replace(raw, 'different-key');
  await assert.rejects(readDetectedValue(secret), /changed/);
  await assert.rejects(readDetectedValue({...secret, sourceFile: undefined}), /stale/);
  assert.equal(encodeEnvValue('value # with spaces'), '"value # with spaces"');
  console.log('✅ Security regressions: original features, private queues, acknowledgment, concurrency, full hashes, safe .env writes, stale-source rejection.');
}
main().then(() => process.exit(0)).catch(error => {console.error(error); process.exit(1);});

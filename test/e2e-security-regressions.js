const assert = require('assert/strict');
const crypto = require('crypto');
const path = require('path');
const Module = require('module');
let cloud = false;
const state = new Map([['dotenvy.feedback.entries', [{context: 'old raw source context'}]]]);
const credentials = new Map();
const writes = [];
const raw = 'sk-SyntheticReviewValue0123456789AbCdEf';
let currentLine = 'const API_KEY = "' + raw + '";';
const workspace = {uri: {fsPath: '/synthetic-workspace'}};
const vscode = {
  EventEmitter: class { event = () => ({dispose(){}}); fire() {} dispose() {} },
  ExtensionMode: {Development: 1},
  workspace: {
    getConfiguration: () => ({get: key => key === 'secrets.enableCloudAnalysis' ? cloud : false, inspect: () => ({globalValue:false})}),
    workspaceFolders: [workspace],
    getWorkspaceFolder: () => workspace,
    openTextDocument: async () => ({lineAt: () => ({text: currentLine})}),
    asRelativePath: () => 'sample.ts',
    fs: {readFile: async () => {throw new Error('missing');}, writeFile: async (_uri, data) => writes.push(data.toString())}
  },
  Uri: {file: value => ({fsPath: value}), joinPath: (uri, ...parts) => ({fsPath: path.join(uri.fsPath, ...parts)})},
  window: {
    createOutputChannel: () => ({appendLine() {}, show() {}, clear() {}}),
    showInformationMessage() {}, showErrorMessage() {}
  },
  env: {machineId: 'synthetic-test-device'}
};
const original = Module.prototype.require;
Module.prototype.require = function(name) { return name === 'vscode' ? vscode : original.apply(this, arguments); };
const {FeedbackManager} = require('../out/utils/feedbackManager');
const {SecretDetector} = require('../out/utils/secretDetector');
const {SecretsPanel} = require('../out/providers/SecretsPanel');
const {readDetectedValue, encodeEnvValue} = require('../out/utils/detectedSecretValue');
const context = {
  extensionMode: 1,
  secrets: {delete: async key => credentials.delete(key)},
  globalState: {
    get: (key, fallback) => structuredClone(state.get(key) || fallback),
    update: async (key, value) => { if (value === undefined) state.delete(key); else state.set(key, structuredClone(value)); }
  }
};
async function main() {
  await FeedbackManager.init(context);
  assert.equal(state.has('dotenvy.feedback.entries'), false, 'legacy raw queue must be purged');

  const detections = await SecretDetector.scanLine(currentLine, 0, [currentLine], '/synthetic-workspace/sample.ts');
  assert.ok(detections.length);
  assert.equal(detections[0].analysisSource, 'heuristics');
  assert.equal(detections[0].confidence, 'high', 'a known key format with high entropy is high confidence');
  assert.equal('features' in detections[0], false, 'no feature vector is computed without a model');
  const render = Object.create(SecretsPanel.prototype);
  render._extensionUri = {fsPath: path.resolve(__dirname, '..')};
  render._panel = {webview: {cspSource: 'test-webview', asWebviewUri: uri => uri.fsPath}};
  render._secrets = await SecretDetector.scanText('/synthetic-workspace/provenance.ts', currentLine);
  assert.ok(render._secrets.length);
  assert.ok(render._secrets.every(s => s.analysisSource === 'heuristics'));
  const html = await render._getHtml();
  assert.ok(html.includes('🔎 Local rules'));
  assert.ok(html.includes(`Rules ${render._secrets.length}`));
  assert.ok(!html.includes('DotAegis'));
  assert.ok(!html.includes('📊 Statistical</span>'));
  assert.ok(!html.includes(raw));
  render._secrets = [];
  assert.ok((await render._getHtml()).includes('nothing leaves your machine'), 'Local status remains visible with no findings');
  const secret = {...detections[0], confidence: 'low', suggestedEnvVar: 'API_KEY'};
  assert.equal(secret.content.includes(raw), false);
  assert.equal(secret.context.includes(raw), false);
  const originalValue = await readDetectedValue(secret);
  assert.equal(originalValue.value, raw);
  const passwordLine = 'const password = "SyntheticPassword012345ABCD";';
  const passwordDetections = await SecretDetector.scanLine(passwordLine, 0, [passwordLine], '/synthetic-workspace/password.ts');
  const password = passwordDetections.find(s => s.type === 'Generic Password');
  assert.ok(password);
  assert.equal(password.valueLength, 'SyntheticPassword012345ABCD'.length);
  assert.equal(password.column - 1, passwordLine.indexOf('SyntheticPassword'));
  await Promise.all([FeedbackManager.recordConfirmed(secret), FeedbackManager.recordFalsePositive(secret)]);
  let entries = state.get('dotenvy.corrections.local.v1');
  assert.equal(entries.length, 1, 'latest correction replaces earlier decisions for the same value');
  assert.equal(entries[0].label, 'false_positive');
  assert.equal(JSON.stringify(entries).includes(raw), false);
  assert.ok(entries.every(e => !('context' in e) && !('secret_value' in e)));
  assert.equal(FeedbackManager.decision(secret.sourceFile, secret.variableName, secret.valueDigest), 'false_positive');
  await FeedbackManager.init(context);
  assert.equal(FeedbackManager.decision(secret.sourceFile, secret.variableName, secret.valueDigest), 'false_positive',
    'local corrections survive extension reinitialization');
  const remaining = await SecretDetector.scanLine(currentLine, 0, [currentLine], secret.sourceFile);
  assert.equal(remaining.length, 0);
  assert.ok((await SecretDetector.scanLine(currentLine, 0, [currentLine], '/another-workspace/sample.ts')).length,
    'false-positive correction must not affect another workspace/file');
  assert.equal(FeedbackManager.decision(secret.sourceFile, secret.variableName, 'b'.repeat(64)), undefined,
    'a changed value must not inherit an old ignore decision');
  cloud = true; // Obsolete settings must not enable any upload.
  await FeedbackManager.recordConfirmed(secret);
  entries = state.get('dotenvy.corrections.local.v1');
  assert.equal(entries[0].label, 'high', 'confirmation overrides a low rule-based score');
  assert.equal(FeedbackManager.decision(secret.sourceFile, secret.variableName, secret.valueDigest), 'high');
  render._secrets = await SecretDetector.scanText(secret.sourceFile, currentLine);
  assert.ok(render._secrets.every(s => s.analysisSource === 'user-confirmed'));
  assert.ok((await render._getHtml()).includes('✓ Confirmed by you'));
  assert.equal(state.has('dotenvy.feedback.features.v2'), false);

  const panel = Object.create(SecretsPanel.prototype);
  panel._remove = () => {};
  await panel._moveToEnv(secret);
  assert.ok(writes[0].includes('API_KEY=' + raw));
  assert.equal(writes[0].includes(secret.content), false);
  currentLine = currentLine.replace(raw, 'different-key');
  await assert.rejects(readDetectedValue(secret), /changed/);
  await assert.rejects(readDetectedValue({...secret, sourceFile: undefined}), /stale/);
  assert.equal(encodeEnvValue('value # with spaces'), '"value # with spaces"');
  for (let i = 0; i < 501; i++) {
    await FeedbackManager.recordConfirmed({...secret, sourceFile: `/synthetic-workspace/file-${i}.ts`});
  }
  assert.equal(state.get('dotenvy.corrections.local.v1').length, 500);
  await FeedbackManager.clear();
  assert.equal(FeedbackManager.decision(secret.sourceFile, secret.variableName, secret.valueDigest), undefined);
  assert.equal(state.has('dotenvy.corrections.local.v1'), false);
  console.log('✅ Security regressions: rule-based classification, local correction persistence/scope/reset, concurrent writes, private records, original .env values and stale-source rejection.');
}
main().then(() => process.exit(0)).catch(error => {console.error(error); process.exit(1);});

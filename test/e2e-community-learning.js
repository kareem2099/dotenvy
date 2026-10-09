/** Mocked transport + real workers: privacy boundary, consent, retries and downloaded weights. */
const assert = require('assert/strict');
const Module = require('module');
const fs = require('fs'), os = require('os'), path = require('path'), crypto = require('crypto');
const {EventEmitter} = require('events');
const https = require('https');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dotenvy-community-'));
let enabled = false, updates = false, fail = false, hold, held, failActiveHash = false;
const requests = [];
const state = new Map([['dotenvy.llm.installationId', 'existing-installation']]);
const credentials = new Map([['dotenvy.llm.sharedSecret', 'synthetic-device-secret'.repeat(2)]]);
const mock = {workspace: {getConfiguration: () => ({get: key => key === 'secrets.enableCommunityLearning' ? enabled : key === 'secrets.enableModelUpdates' ? updates : true})},
  env: {machineId: 'existing-installation'}, version: 'synthetic-vscode',
  window: {createOutputChannel: () => ({appendLine() {}, show() {}, clear() {}})}};
const original = Module.prototype.require;
Module.prototype.require = function(name) {return name === 'vscode' ? mock : original.apply(this, arguments);};
const bundled = path.resolve(__dirname, '../resources/models');
const weights = fs.readFileSync(path.join(bundled, 'aegis-v2.json.gz'));
const manifest = {...JSON.parse(fs.readFileSync(path.join(bundled, 'aegis-v2.manifest.json'))), revision: 'a'.repeat(64)};
let release = {manifest, weights_base64: weights.toString('base64')};
https.request = (url, options, callback) => {
  const req = new EventEmitter();
  req.setTimeout = () => req;
  req.destroy = error => {if(error) req.emit('error', error);};
  req.end = body => {
    const entry = {path: url.pathname, options, body: body || ''}; requests.push(entry);
    const send = () => {
      const res = new EventEmitter(); res.statusCode = fail && entry.path === '/extension/feedback' ? 503 : 200;
      let reply = entry.path === '/model/release' ? release : entry.path === '/extension/register' ? {client_secret: 'new-synthetic-credential'.repeat(2)} :
        {status:'queued', accepted_sample_ids:JSON.parse(body).samples.map(s => s.id)};
      callback(res); res.emit('data',Buffer.from(JSON.stringify(reply))); res.emit('end');
    };
    if (hold && entry.path === '/extension/feedback') {held = send; hold(); hold=undefined;}
    else queueMicrotask(send);
  };
  return req;
};
const {LLMAnalyzer} = require('../out/utils/llmAnalyzer');
const {FeedbackManager} = require('../out/utils/feedbackManager');
const {AegisClient} = require('../out/utils/aegisClient');
const {FeatureExtractor} = require('../out/utils/featureExtractor');
const context = {subscriptions: [], globalStorageUri:{fsPath:root},
  secrets: {get: async k => credentials.get(k), store: async (k,v) => credentials.set(k,v)},
  globalState: {get: (k,d) => structuredClone(state.get(k) ?? d), update: async (k,v) => {
    if (failActiveHash && k === 'dotenvy.model.activeHash') { throw new Error('Synthetic preference persistence failure'); }
    return v === undefined ? state.delete(k) : state.set(k,structuredClone(v));
  }}};
const raw = 'sk-SyntheticCompleteKey0123456789AbCdEf';
const secret = {sourceFile:'/private/path/example.ts', variableName:'SUPER_PRIVATE_API_KEY', valueDigest:'b'.repeat(64),
  content:raw, context:'private source code', features:FeatureExtractor.extract(raw,'API_KEY=','API_KEY')};
async function main() {
  const analyzer = await LLMAnalyzer.initialize(context);
  try {
    await FeedbackManager.init(context);
    await analyzer.refreshModel();
    await analyzer.analyzeSecret(raw,secret.context,secret.variableName);
    await FeedbackManager.recordFalsePositive(secret); await FeedbackManager.flush();
    assert.equal(requests.length,0,'both switches off: no network, even with legacy cloud=true');
    assert.equal(state.has('dotenvy.feedback.features.v3'),false);
    enabled = true; fail = true;
    await FeedbackManager.recordConfirmed(secret); await FeedbackManager.flush();
    const queued = state.get('dotenvy.feedback.features.v3');
    assert.equal(queued.length,1,'failed upload must remain retryable');
    const payload = JSON.parse(requests.at(-1).body);
    assert.deepEqual(Object.keys(payload),['samples']);
    assert.deepEqual(Object.keys(payload.samples[0]).sort(),['id','feature_schema','features','label','user_action'].sort());
    assert.equal(payload.samples[0].label,'high');
    assert.equal(payload.samples[0].features.length,35);
    for (const sensitive of [raw,secret.context,secret.sourceFile,secret.variableName,secret.valueDigest]) {
      assert.ok(!requests.at(-1).body.includes(sensitive));
    }
    const headers = requests.at(-1).options.headers;
    assert.equal(headers['X-Machine-ID'],'existing-installation');
    assert.equal(headers['X-Extension-Signature'],crypto.createHmac('sha256',credentials.get('dotenvy.llm.sharedSecret'))
      .update(headers['X-Extension-Timestamp']+'.'+requests.at(-1).body).digest('hex'));
    fail = false;
    let entered;
    const started = new Promise(resolve => {entered=resolve;}); hold=entered;
    const uploading = FeedbackManager.flush(); await started;
    await FeedbackManager.recordFalsePositive({...secret,sourceFile:'/private/path/other.ts'});
    assert.equal(state.get('dotenvy.feedback.features.v3').length,2);
    held(); await uploading;
    assert.equal(state.get('dotenvy.feedback.features.v3').length,1,'ack removes only the captured batch');
    assert.equal(JSON.parse(requests.at(-1).body).samples[0].id,queued[0].id,'retries preserve sample ID');
    await FeedbackManager.flush();
    assert.equal(state.get('dotenvy.feedback.features.v3').length,0);
    enabled = false; updates = true;
    await analyzer.refreshModel();
    assert.equal(state.get('dotenvy.model.activeHash'),manifest.sha256);
    assert.ok(analyzer.isModelAvailable());
    const modelRequest=requests.at(-1);
    assert.equal(modelRequest.path,'/model/release'); assert.equal(modelRequest.body,'');
    assert.equal(modelRequest.options.headers['X-Machine-ID'],undefined,'public weights need no device registration');
    const prior = await analyzer.analyzeSecret(raw,'API_KEY=','API_KEY');
    release = {manifest:{...manifest,sha256:'f'.repeat(64)},weights_base64:weights.toString('base64')};
    await analyzer.refreshModel();
    assert.equal(await analyzer.analyzeSecret(raw,'API_KEY=','API_KEY'),prior,'bad update retains working classifier');
    assert.equal(state.get('dotenvy.model.activeHash'),manifest.sha256);
    assert.ok(requests.at(-1).options.headers['If-None-Match']);
    const badWeights = JSON.parse(require('zlib').gunzipSync(weights));
    badWeights.config.hidden_dim = 8;
    const incompatible = require('zlib').gzipSync(Buffer.from(JSON.stringify(badWeights)));
    release = {manifest: {...manifest, sha256:crypto.createHash('sha256').update(incompatible).digest('hex')},
      weights_base64:incompatible.toString('base64')};
    await analyzer.refreshModel();
    assert.equal(await analyzer.analyzeSecret(raw,'API_KEY=','API_KEY'),prior,'incompatible model keeps old worker');
    assert.equal(fs.readdirSync(path.join(root,'models')).length,1,'failed release directory is removed');
    const changed = JSON.parse(require('zlib').gunzipSync(weights));
    changed.parameters.classifier_bias[0] += 0.05;
    const changedWeights = require('zlib').gzipSync(Buffer.from(JSON.stringify(changed)));
    const changedHash = crypto.createHash('sha256').update(changedWeights).digest('hex');
    release = {manifest: {...manifest, sha256:changedHash, revision:'c'.repeat(64)}, weights_base64:changedWeights.toString('base64')};
    failActiveHash = true;
    await analyzer.refreshModel();
    assert.equal(state.get('dotenvy.model.activeHash'),manifest.sha256);
    assert.equal(state.get('dotenvy.model.revision'),'c'.repeat(64),'simulate a partial preference write');
    assert.equal(await analyzer.analyzeSecret(raw,'API_KEY=','API_KEY'),prior,'failed persistence keeps old model');
    failActiveHash = false;
    await analyzer.refreshModel();
    assert.equal(requests.at(-1).options.headers['If-None-Match'],undefined,'partial state must not suppress download');
    assert.equal(state.get('dotenvy.model.activeHash'),changedHash,'retry activates complete new release');
    assert.equal(fs.readdirSync(path.join(root,'models')).length,1);

    enabled = true; credentials.clear();
    const client = new AegisClient(context);
    await client.sendFeedback([{...queued[0],id:'lost-credential-test'}]);
    assert.notEqual(state.get('dotenvy.llm.installationId'),'existing-installation','lost secret must not rotate another installation');
    assert.ok(requests.some(r => r.path === '/extension/register'));
    client.dispose();
    enabled = false; await FeedbackManager.clearQueue();
    const number=requests.length; await FeedbackManager.recordConfirmed(secret); await FeedbackManager.flush();
    assert.equal(requests.length,number,'disabling learning prevents new feedback');
    console.log('✅ Numeric-only opt-in feedback, HMAC ownership, durable retries/concurrent corrections, public model refresh, failed-update fallback and lost-credential registration.');
  } finally {analyzer.dispose(); fs.rmSync(root,{recursive:true,force:true});}
}
main().then(() => process.exit(0)).catch(error => {console.error(error);process.exit(1);});

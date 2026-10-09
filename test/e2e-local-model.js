const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const zlib = require('zlib');
const crypto = require('crypto');
const {LocalTransformer} = require('../out/utils/localModel');
const {LocalModelService} = require('../out/utils/localModelService');
const directory = path.resolve(__dirname, '../resources/models');
const cases = require('./model-parity.json');

async function main() {
  const model = LocalTransformer.load(directory);
  const begin = performance.now();
  for (const test of cases) {
    const result = model.predict(test.features);
    assert.equal(result.prediction, test.prediction);
    result.probabilities.forEach((p, i) => assert.ok(Math.abs(p - test.probabilities[i]) < 1e-8,
      `Transformer probability mismatch: ${i}`));
  }
  assert.throws(() => model.predict([0.5]), /35/);
  assert.throws(() => model.predict(Array(35).fill(NaN)), /35/);
  assert.throws(() => model.predict(Array(35).fill(1.5)), /35/);
  const payload = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(directory, 'aegis-v2.json.gz'))));
  assert.deepEqual(Object.keys(payload).sort(), ['config','format','is_trained','parameters']);
  assert.equal(require(path.join(directory, 'aegis-v2.manifest.json')).training_source, 'synthetic-only');
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'dotenvy-model-'));
  const service = new LocalModelService();
  try {
    await service.ready;
    let eventLoopYielded = false;
    const tick = new Promise(resolve => setImmediate(() => {eventLoopYielded = true; resolve();}));
    const predictions = await Promise.all(cases.map(c => service.predict(c.features)));
    await tick;
    assert.ok(eventLoopYielded);
    predictions.forEach((result, i) => assert.equal(result.prediction, cases[i].prediction));
    const manifest = require(path.join(directory, 'aegis-v2.manifest.json'));
    fs.writeFileSync(path.join(temp, 'aegis-v2.manifest.json'), JSON.stringify(manifest));
    fs.writeFileSync(path.join(temp, 'aegis-v2.json.gz'), Buffer.from('corrupted'));
    assert.throws(() => LocalTransformer.load(temp), /checksum/);
    const invalidWorker = new LocalModelService(temp);
    await assert.rejects(invalidWorker.ready, /validation/);
    invalidWorker.dispose();
    payload.is_trained = false;
    const invalid = zlib.gzipSync(Buffer.from(JSON.stringify(payload)));
    fs.writeFileSync(path.join(temp, 'aegis-v2.json.gz'), invalid);
    fs.writeFileSync(path.join(temp, 'aegis-v2.manifest.json'), JSON.stringify({...manifest,
      sha256: crypto.createHash('sha256').update(invalid).digest('hex')}));
    assert.throws(() => LocalTransformer.load(temp), /untrained/);
    const pending = service.predict(cases[0].features);
    service.dispose();
    await assert.rejects(pending, /unavailable|stopped/);
  } finally { service.dispose(); fs.rmSync(temp, {recursive:true, force:true}); }
  console.log(`✅ ${cases.length} Python/JS transformer parity cases, worker inference, integrity, input validation and shutdown (${Math.round(performance.now()-begin)}ms).`);
}
main().then(() => process.exit(0)).catch(error => {console.error(error); process.exit(1);});

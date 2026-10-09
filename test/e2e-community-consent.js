/** Actual panel actions + consent: local completion first, explicit sharing, no repeated prompts. */
const assert = require('assert/strict');
const Module = require('module');
const state = new Map(), writes = [], notices = [], uploads = [];
let enabled = false, explicitDisabled = false, answer, promptHandler, rejectSetting = false;
const raw = 'sk-SyntheticConsentKey0123456789AbCdEf';
const line = `const API_KEY = "${raw}";`;
const folder = {uri:{fsPath:'/synthetic-consent-workspace'}};
const config = {
  get: key => key === 'secrets.enableCommunityLearning' ? enabled : false,
  inspect: () => ({globalValue:explicitDisabled ? false : undefined}),
  update: async (_key,value) => {if(rejectSetting) throw new Error('Synthetic settings failure'); enabled=value;}
};
const mock = {
  ConfigurationTarget:{Global:1},
  EventEmitter:class {event=()=>({dispose(){}});fire(){}},
  workspace:{getConfiguration:() => config,asRelativePath:()=> 'example.ts',workspaceFolders:[folder],getWorkspaceFolder:()=>folder,
    openTextDocument:async () => ({lineAt:()=>({text:line})}),
    fs:{readFile:async ()=>{throw new Error('new file');},writeFile:async (_uri,data)=>writes.push(data.toString())}},
  Uri:{file:fsPath=>({fsPath}),joinPath:(uri,name)=>({fsPath:uri.fsPath+'/'+name})},
  window:{createOutputChannel:()=>({appendLine(){},show(){},clear(){}}),
    showInformationMessage:async (message,options,...buttons)=>{
      notices.push({message,options,buttons});
      if(!options?.modal) return;
      if(promptHandler) return promptHandler(message,options,buttons);
      return answer === 'enable' ? buttons[0] : answer === 'local' ? buttons[1] : undefined;
    },showErrorMessage:message=>{throw new Error(message);}}
};
const original=Module.prototype.require;
Module.prototype.require=function(name){return name==='vscode'?mock:original.apply(this,arguments);};
const {LLMAnalyzer}=require('../out/utils/llmAnalyzer');
const {FeedbackManager}=require('../out/utils/feedbackManager');
const {FeatureExtractor}=require('../out/utils/featureExtractor');
const {SecretDetector}=require('../out/utils/secretDetector');
const {SecretsPanel}=require('../out/providers/SecretsPanel');
const context={subscriptions:[],globalState:{get:(k,d)=>structuredClone(state.get(k) ?? d),
  update:async(k,v)=>v===undefined?state.delete(k):state.set(k,structuredClone(v))}};
const promptCount=()=>notices.filter(n=>n.options?.modal).length;
const panel=Object.create(SecretsPanel.prototype);
let removals=0; panel._remove=()=>{removals++;};
let secret;
async function reset(){
  await FeedbackManager.flush();
  state.clear();writes.length=0;notices.length=0;uploads.length=0;enabled=false;explicitDisabled=false;
  answer=undefined;promptHandler=undefined;rejectSetting=false;removals=0;
  await FeedbackManager.init(context);
}
async function main(){
  const analyzer=await LLMAnalyzer.initialize(context);
  // The separate transport suite verifies HMAC and wire objects. This suite keeps all sockets blocked.
  analyzer.sendFeedback=async samples=>{uploads.push(structuredClone(samples));throw new Error('Synthetic offline server');};
  try{
    secret={...(await SecretDetector.scanLine(line,0,[line],'/synthetic-consent-workspace/example.ts'))[0],suggestedEnvVar:'API_KEY'};
    assert.ok(secret);assert.deepEqual(secret.features,FeatureExtractor.extract(raw,secret.context,secret.variableName));
    await reset();answer='local';
    let snapshot;
    promptHandler=async (_message,options,buttons)=>{
      snapshot={writes:[...writes],removals,decision:FeedbackManager.decision(secret.sourceFile,secret.variableName,secret.valueDigest),
        uploads:uploads.length,detail:options.detail};
      return buttons[1];
    };
    await panel._moveToEnv(secret);
    assert.equal(promptCount(),1);assert.equal(enabled,false);assert.equal(uploads.length,0);
    assert.ok(snapshot.writes[0].includes('API_KEY='+raw),'write completes before prompt');
    assert.equal(snapshot.removals,1,'finding removed before prompt');
    assert.equal(snapshot.decision,'high');assert.equal(snapshot.uploads,0,'no training upload before consent');
    assert.equal(snapshot.detail.includes(raw),false);assert.ok(snapshot.detail.includes('35 numeric properties'));

    assert.equal(state.has('dotenvy.feedback.features.v3'),false);
    promptHandler=undefined;
    await panel._ignore({...secret,sourceFile:'/synthetic-consent-workspace/other.ts'});
    await FeedbackManager.init(context);
    await panel._ignore({...secret,sourceFile:'/synthetic-consent-workspace/third.ts'});
    assert.equal(promptCount(),1,'decline survives later actions and reinitialization');

    await reset();
    await panel._ignore(secret); // Dismiss without choosing a button.
    assert.equal(promptCount(),1);assert.equal(enabled,false);
    await panel._ignore(secret);
    assert.equal(promptCount(),1,'dismissal must not nag');assert.equal(uploads.length,0);

    await reset();explicitDisabled=true;
    await panel._ignore(secret);
    assert.equal(promptCount(),0,'respect a user who disabled learning in Settings');
    answer='enable';
    assert.equal(await FeedbackManager.requestCommunityConsent(),true,'command can explicitly reopen consent');
    assert.equal(enabled,true);assert.equal(promptCount(),1);
    assert.equal(state.has('dotenvy.feedback.features.v3'),false,'manual opt-in never backfills earlier decisions');

    await reset();answer='enable';
    await FeedbackManager.recordConfirmed({...secret,sourceFile:'/synthetic-consent-workspace/old.ts'});
    await panel._ignore(secret);await FeedbackManager.flush();
    assert.equal(enabled,true);assert.equal(promptCount(),1);
    let queue=state.get('dotenvy.feedback.features.v3');
    assert.equal(queue.length,1,'include current correction only, not earlier history');
    assert.equal(queue[0].label,'false_positive');
    assert.ok(uploads.length>0,'consented sample is submitted');
    for(const value of [raw,secret.sourceFile,secret.context,secret.variableName,secret.valueDigest]){
      assert.equal(JSON.stringify(queue).includes(value),false,'pending sample contains no raw text or fingerprint');
    }
    await panel._moveToEnv({...secret,sourceFile:'/synthetic-consent-workspace/next.ts'});await FeedbackManager.flush();
    queue=state.get('dotenvy.feedback.features.v3');
    assert.equal(queue.length,2);assert.equal(queue[1].label,'high');assert.equal(promptCount(),1);

    await reset();
    let release;
    promptHandler=()=>new Promise(resolve=>{release=resolve;});
    await FeedbackManager.recordFalsePositive(secret);
    const first=FeedbackManager.offerAfterCorrection(secret,'false_positive');
    await new Promise(resolve=>setImmediate(resolve));
    const secondSecret={...secret,sourceFile:'/synthetic-consent-workspace/concurrent.ts'};
    await FeedbackManager.recordFalsePositive(secondSecret);
    const second=FeedbackManager.offerAfterCorrection(secondSecret,'false_positive');
    assert.equal(promptCount(),1,'concurrent actions share one consent dialog');
    assert.equal(uploads.length,0);
    release(notices.find(n=>n.options?.modal).buttons[0]);
    await Promise.all([first,second]);await FeedbackManager.flush();
    assert.equal(state.get('dotenvy.feedback.features.v3').length,2);

    await reset();answer='enable';rejectSetting=true;
    await panel._ignore(secret);
    assert.equal(removals,1);assert.equal(FeedbackManager.decision(secret.sourceFile,secret.variableName,secret.valueDigest),'false_positive');
    assert.equal(enabled,false);assert.equal(uploads.length,0,'failed consent setting never enables sharing');
    console.log('✅ Actual Move to .env/Not a Secret actions, post-action consent, accept/decline/dismiss, restart persistence, concurrency, current-only numeric sharing and settings failure.');
  }finally{analyzer.dispose();}
}
main().then(()=>process.exit(0)).catch(error=>{console.error(error);process.exit(1);});

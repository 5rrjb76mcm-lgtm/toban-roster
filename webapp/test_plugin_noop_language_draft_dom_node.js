// post50: no-op plugin reload must not adopt another language preference and repaint drafts.
// Real DOM/application handlers; synthetic file handles and cross-tab StorageEvent adapter.
// No execution is claimed by this source. Local Claude must run baseline/fixed/group-revert.
const fs = require('fs'), path = require('path'), assert = require('assert');
// Targets existing jsdom 26.1.0. This new regression has not been executed. No downloads/installations.
let JSDOM;
for (const name of [process.env.TOBAN_DOM_MODULE, 'jsdom', path.join(process.env.HOME || '', '.toban-test/node_modules/jsdom')].filter(Boolean)) {
  try { ({ JSDOM } = require(name)); break; } catch (e) { if (e.code !== 'MODULE_NOT_FOUND') throw e; }
}
if (!JSDOM) throw new Error('Plug-in reload draft DOM-adapter regression requires jsdom 26.1.0. Set TOBAN_DOM_MODULE to its installed module path. This test was NOT run.');
const N = ['Synthetic Trainer', 'Synthetic Colleague'], clone = x => JSON.parse(JSON.stringify(x));
const root = process.env.TOBAN_SOURCE_ROOT || __dirname;
const source = f => fs.readFileSync(path.join(root, 'src', f), 'utf8');
const scripts = ['i18n.js','rules-core.js','model.js', ...fs.readdirSync(path.join(root,'src/calendars')).filter(f=>f.endsWith('.js')).sort().map(f=>'calendars/'+f),
  'messages.js','solver.js','check.js','report.js','docxgen.js','plugins.js','merge.js', ...fs.readdirSync(path.join(root,'src/rules')).filter(f=>f.endsWith('.js')).sort().map(f=>'rules/'+f),
  'app-core.js','app-folder.js','app-month.js','app-input.js','app-settings.js','app-solve.js','app-main.js'];
const key = 'toban_state_v2:/synthetic/plugin-reload-draft.html';
const rawRules = {profile:{id:'synthetic-plugin-reload-draft',roles:[{id:'S',label:'Staff',refs:[]}],shifts:[{id:'day',on:'all'},{id:'night',on:'all'}]},doctors:N.map(name=>({name,team:'S',quota:15})),rule_states:{oncall:'off'},weights:{}};
const rawMonth = {year:2026,month:11,notes:'before'};
async function makeApp(saved, fixture=rawRules, defaults=fixture, storedLanguage='en') {
  const dom = new JSDOM(source('index.html'), {url:'https://example.invalid/synthetic/plugin-reload-draft.html',runScripts:'outside-only'}), w=dom.window;
  await new Promise(resolve=>w.document.readyState==='complete'?resolve():w.addEventListener('load',resolve,{once:true}));
  const errors=[]; w.addEventListener('error',e=>{errors.push(e.error || e.message);e.preventDefault();});
  w.confirm=()=>true; w.alert=msg=>{throw new Error('Unexpected alert: '+msg);}; w.prompt=()=>null;
  w.T={DEFAULT_RULES:clone(defaults), SAMPLE_MONTH:clone(rawMonth), PROFILES:[], LANGS_DATA:['en','ja'].map(code=>JSON.parse(fs.readFileSync(path.join(root,'lang',code+'.json'),'utf8')))};
  for(const f of scripts) w.eval(source(f)+'\n//# sourceURL='+f);
  const A=w.T.app; A.restoreFolder=()=>{}; // Start-gate/OS-folder access is outside this DOM-adapter test.
  A.toast=()=>{};
  if (storedLanguage !== null) w.localStorage.setItem('toban.lang',storedLanguage);
  Object.defineProperty(w.navigator,'language',{value:'en-US',configurable:true});
  const initial=clone(fixture); w.T.fillDefaultRules(initial);
  for(const def of w.T.RULE_DEFS) if(def.states.includes('off') && fixture.rule_states?.[def.id] === undefined) initial.rule_states[def.id]='off';
  w.T.fillDefaultRules(initial);
  w.localStorage.setItem(key,saved || JSON.stringify({rules:initial,month:rawMonth,result:null,ui:{doctor:1}}));
  w.T.init();
  const q=s=>w.document.querySelector(s), click=s=>{assert(q(s),'Missing '+s);q(s).click();}, change=(s,v)=>{const el=typeof s==='string'?q(s):s;assert(el,'Missing '+s);if(el.type==='checkbox')el.checked=v;else el.value=v;el.dispatchEvent(new w.Event('change',{bubbles:true}));};
  const tick=()=>new Promise(r=>w.setTimeout(r,0));
  const enter=()=>{click('.tab[data-tab="settings"]');click('[data-setmode="build"]');};
  return {dom,w,A,q,click,change,tick,enter,errors};
}
const nf=()=>Object.assign(new Error('synthetic missing'),{name:'NotFoundError'});
function gate(){let enter,release;return {entered:new Promise(r=>enter=r),wait:new Promise(r=>release=r),enter,release};}
function folder(g,mode='file',code=''){
 return {name:'synthetic-reload',async getDirectoryHandle(name){
  assert.equal(name,'plugins');g.enter();await g.wait;
  if(mode==='missing')throw nf();if(mode==='error')throw new Error('synthetic permission failure');
  return {async getDirectoryHandle(kind){const lang=code&&typeof code==='object'&&code.lang;if(mode==='empty'||kind!==(lang?'lang':'rules'))throw nf();return {async *entries(){yield [lang?'same.json':'same.js',{kind:'file',getFile:async()=>({text:async()=>lang||code})}];}};}};
 }};
}
async function begin(a,mode='file',code=''){
 const g=gate();a.A.dirHandle=folder(g,mode,code);a.A.dirGen++;a.enter();
 const real=a.A.loadFolderPlugins;let pending;a.A.loadFolderPlugins=(...args)=>(pending=real(...args));
 a.click('#btnReloadPlugins');await g.entered;
 return {release:async()=>{g.release();await pending;await a.tick();a.A.loadFolderPlugins=real;}};
}
const monthPane=a=>{a.click('.tab[data-tab="input"]');a.click('.sub[data-sub="monthSettings"]');};
function draft(a,selector,value){const el=a.q(selector);assert(el,selector);el.focus();el.value=value;el.dispatchEvent(new a.w.Event('input',{bubbles:true}));assert.strictEqual(a.w.document.activeElement,el);return el;}
async function finish(a){await a.tick();a.w.clearTimeout(a.A.autosaveTimer);a.dom.window.close();}
const cases=[],test=(name,fn)=>cases.push({name,fn});
const snap=a=>({rules:clone(a.A.state.rules),month:clone(a.A.state.month),meta:clone(a.A.state.meta||null),result:clone(a.A.state.result),saved:a.w.localStorage.getItem(key),undo:a.q('#undoNote').textContent,undoDisabled:a.q('#btnUndo').disabled,lang:a.w.T.lang(),options:[...a.q('#langSel').options].map(x=>x.value),gen:a.w.T.plugins.generation()});
async function importedPreference(a){
 a.enter();const r=clone(a.A.state.rules);r.lang='ja';draft(a,'#rulesJson',JSON.stringify(r,null,1));a.click('#btnApplyRules');await a.tick();
 assert.equal(a.A.state.rules.lang,'ja');assert.equal(a.w.localStorage.getItem('toban.lang'),null);assert.equal(a.w.T.lang(),'en','JSON import does not itself change current UI language');
}
function otherTabPreference(a,language){
 const oldValue=a.w.localStorage.getItem('toban.lang');a.w.localStorage.setItem('toban.lang',language);
 // Adapter for the storage write/event delivered by another same-origin window.
 a.w.dispatchEvent(new a.w.StorageEvent('storage',{key:'toban.lang',oldValue,newValue:language,storageArea:a.w.localStorage,url:a.w.location.href}));
}
function editedField(a,kind){
 if(kind==='notes'){monthPane(a);return {el:draft(a,'[data-path="notes"]','post50 unconfirmed note'),value:'post50 unconfirmed note'};}
 if(kind==='number')return {el:draft(a,'#doctorTable tr[data-i="0"] [data-f="years"]','12'),value:'12'};
 const r=clone(a.A.state.rules);r.profile.label='Post50 unapplied profile label';const value=JSON.stringify(r,null,2);return {el:draft(a,'#rulesJson',value),value};
}
async function ordinaryCommit(a,kind,field,before){
 if(kind==='json'){a.click('#btnApplyRules');await a.tick();assert.equal(a.A.state.rules.profile.label,'Post50 unapplied profile label');}
 else {field.el.dispatchEvent(new a.w.Event('change',{bubbles:true}));await a.tick();if(kind==='notes')assert.equal(a.A.state.month.notes,field.value);else assert.equal(a.A.state.rules.doctors[0].years,12);}
 const saved=JSON.parse(a.w.localStorage.getItem(key));if(kind==='notes')assert.equal(saved.month.notes,field.value);else if(kind==='number')assert.equal(saved.rules.doctors[0].years,12);else assert.equal(saved.rules.profile.label,'Post50 unapplied profile label');
 assert.deepStrictEqual(a.A.state.month.doc_versions,before.month.doc_versions,'ordinary input commit does not rewrite document history');
 a.A.undo();if(kind==='notes')assert.equal(a.A.state.month.notes,before.month.notes);else if(kind==='number')assert.equal(a.A.state.rules.doctors[0].years,before.rules.doctors[0].years);else assert.deepStrictEqual(a.A.state.rules.profile.label,before.rules.profile.label);
}
for(const preference of ['other-tab','rules-import'])for(const mode of ['empty','missing'])for(const kind of ['notes','number','json'])test(`${preference}/${mode}/${kind}: no-op keeps draft without adopting pending language`,async()=>{
 const a=await makeApp(undefined,rawRules,rawRules,preference==='rules-import'?null:'en');
 try{
  if(preference==='rules-import')await importedPreference(a);
  const loading=await begin(a,mode),field=editedField(a,kind),before=snap(a);
  if(preference==='other-tab')otherTabPreference(a,'ja');
  await loading.release();const after=snap(a);
  assert.strictEqual(a.w.document.activeElement,field.el,'focus is not moved by hidden language repaint');assert.equal(field.el.isConnected,true);assert.equal(field.el.value,field.value);
  assert.deepStrictEqual(after.rules,before.rules);assert.deepStrictEqual(after.month,before.month);assert.deepStrictEqual(after.meta,before.meta);assert.deepStrictEqual(after.result,before.result);assert.equal(after.saved,before.saved);assert.equal(after.undo,before.undo);assert.equal(after.undoDisabled,before.undoDisabled);
  assert.equal(after.lang,before.lang,'a no-op reload is not a request to change language');assert.deepStrictEqual(after.options,before.options);assert.equal(after.gen,before.gen+1);assert.equal(a.A.pluginsPending,false);assert.equal(a.A.switching,0);assert.equal(a.w.T.plugins.errors().length,0);
  await ordinaryCommit(a,kind,field,before);assert.deepStrictEqual(a.errors,[]);
 }finally{await finish(a);}
});
for(const mode of ['empty','missing'])test(`${mode}: real removal still updates language choices and preserves the committed draft`,async()=>{
 const a=await makeApp();try{
  assert(a.w.T.plugins.load('lang','lang/zz.json',JSON.stringify({code:'zz',name:'Synthetic ZZ',ui:{}})).ok);a.A.renderAll();a.A.renderLangs();a.change('#langSel','zz');await a.tick();assert.equal(a.w.T.lang(),'zz');
  const loading=await begin(a,mode);monthPane(a);draft(a,'[data-path="notes"]','real removal note');await loading.release();
  assert.equal(a.A.state.month.notes,'real removal note');assert.equal(a.q('[data-path="notes"]').value,'real removal note');assert.equal(JSON.parse(a.w.localStorage.getItem(key)).month.notes,'real removal note');
  assert.ok(!a.w.T.LANGS().some(x=>x[0]==='zz'));assert.ok(![...a.q('#langSel').options].some(x=>x.value==='zz'));assert.equal(a.w.T.lang(),'en');assert.equal(a.q('#langSel').value,'en');assert.equal(a.w.T.plugins.errors().length,0);assert.deepStrictEqual(a.errors,[]);
 }finally{await finish(a);}
});
test('real load still adopts newly available preferred language and preserves draft',async()=>{
 const a=await makeApp();try{
  otherTabPreference(a,'zz');const text={lang:JSON.stringify({code:'zz',name:'Synthetic ZZ',ui:{}})};
  const loading=await begin(a,'file',text);monthPane(a);draft(a,'[data-path="notes"]','real load note');await loading.release();
  assert.equal(a.w.T.lang(),'zz');assert.equal(a.q('#langSel').value,'zz');assert.ok(a.w.T.LANGS().some(x=>x[0]==='zz'));assert.equal(a.A.state.month.notes,'real load note');assert.equal(a.q('[data-path="notes"]').value,'real load note');assert.deepStrictEqual(a.errors,[]);
 }finally{await finish(a);}
});
test('no language preference change remains an untouched no-op control',async()=>{
 const a=await makeApp();try{const loading=await begin(a,'empty');const before=snap(a);await loading.release();const after=snap(a);after.gen=before.gen;assert.deepStrictEqual(after,before);assert.deepStrictEqual(a.errors,[]);}finally{await finish(a);}
});
const EXPECTED=16;let started=0,completed=0,failed=0,finished=false;
process.on('exit',()=>{if(!finished||started!==EXPECTED||completed!==EXPECTED){console.error('FAIL incomplete no-op language draft ledger');process.exitCode=1;}});
(async()=>{
 assert.equal(cases.length,EXPECTED);for(const [i,c] of cases.entries())console.log(JSON.stringify({event:'REGISTER',case_id:i+1,name:c.name}));
 for(const [i,c] of cases.entries()){started++;console.log(JSON.stringify({event:'START',case_id:i+1,name:c.name}));let status='PASS';try{await c.fn();}catch(e){status='FAIL';failed++;console.error(c.name,e.stack||e);}finally{completed++;console.log(JSON.stringify({event:'END',case_id:i+1,status}));}}
 finished=true;console.log(JSON.stringify({event:'SUMMARY',registered:cases.length,started,completed,failed}));if(failed)process.exitCode=1;
})().catch(e=>{console.error(e);process.exitCode=1;});

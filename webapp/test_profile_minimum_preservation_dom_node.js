// Accepted empty/null staffing minima survive unrelated reads and sibling edits.
// Actual profile-file import, markup, delegated events, Problem/checker, export and storage.
// Fictional data only. jsdom 26.1.0; no native browser, layout, OS or network coverage.
// TOBAN_DOM_MODULE=/installed/node_modules/jsdom node test_profile_minimum_preservation_dom_node.js
const fs = require('fs'), path = require('path'), assert = require('assert');
// Verified with jsdom 26.1.0. Dependency lookup never downloads/install packages.
let JSDOM;
for (const name of [process.env.TOBAN_DOM_MODULE, 'jsdom', path.join(process.env.HOME || '', '.toban-test/node_modules/jsdom')].filter(Boolean)) {
  try { ({ JSDOM } = require(name)); break; } catch (e) { if (e.code !== 'MODULE_NOT_FOUND') throw e; }
}
if (!JSDOM) throw new Error('Profile minimum DOM-adapter regression requires jsdom 26.1.0. Set TOBAN_DOM_MODULE to its installed module path. This test was NOT run.');
const N = ['Synthetic Trainer', 'Synthetic Colleague'], clone = x => JSON.parse(JSON.stringify(x));
const root = process.env.TOBAN_SOURCE_ROOT || __dirname;
const source = f => fs.readFileSync(f === 'app-settings.js' && process.env.TOBAN_SETTINGS_SOURCE || path.join(root, 'src', f), 'utf8');
const scripts = ['i18n.js','rules-core.js','model.js', ...fs.readdirSync(path.join(root,'src/calendars')).filter(f=>f.endsWith('.js')).sort().map(f=>'calendars/'+f),
  'messages.js','solver.js','check.js','report.js','docxgen.js','plugins.js','merge.js', ...fs.readdirSync(path.join(root,'src/rules')).filter(f=>f.endsWith('.js')).sort().map(f=>'rules/'+f),
  'app-core.js','app-folder.js','app-month.js','app-input.js','app-settings.js','app-solve.js','app-main.js'];
const key = 'toban_state_v2:/synthetic/profile-minimum-preservation.html';
const rawRules = {profile:{id:'synthetic-profile-minimum-preservation',roles:[{id:'S',label:'Staff',refs:[]}],shifts:[{id:'day',label:'Day',on:'all'},{id:'night',label:'Night',on:'all'}]},doctors:N.map(name=>({name,team:'S',quota:15})),rule_states:{oncall:'off'},weights:{}};
const rawMonth = {year:2026,month:11,notes:'Synthetic settings builder roundtrip'};
async function makeApp(saved, fixture=rawRules, defaults=fixture) {
  const dom = new JSDOM(source('index.html'), {url:'https://example.invalid/synthetic/profile-minimum-preservation.html',runScripts:'outside-only'}), w=dom.window;
  await new Promise(resolve=>w.document.readyState==='complete'?resolve():w.addEventListener('load',resolve,{once:true}));
  const errors=[]; w.addEventListener('error',e=>{errors.push(e.error || e.message);e.preventDefault();});
  w.confirm=()=>true; w.alert=msg=>{throw new Error('Unexpected alert: '+msg);}; w.prompt=()=>null;
  w.T={DEFAULT_RULES:clone(defaults), SAMPLE_MONTH:clone(rawMonth), PROFILES:[], LANGS_DATA:['en','ja'].map(code=>JSON.parse(fs.readFileSync(path.join(root,'lang',code+'.json'),'utf8')))};
  for(const f of scripts) w.eval(source(f)+'\n//# sourceURL='+f);
  const A=w.T.app; A.restoreFolder=()=>{}; // Start-gate/OS-folder access is outside this DOM-adapter test.
  A.toast=()=>{};
  w.localStorage.setItem('toban.lang','en');
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



// Accepted empty/null minima have stable model semantics, although those forms are
// not separately documented. Preserve readback; do not redefine import/model defaults.
const EXPECTED_CASES=31; let passed=0,failed=0,completed=false;
process.on('exit',()=>{if(!completed || passed+failed!==EXPECTED_CASES || failed){console.error(`NOT PASSED: ${passed}/${EXPECTED_CASES}, ${failed} failed, finished=${completed}`);process.exitCode=1;}});
const watchdog=setTimeout(()=>{console.error('FAIL profile minimum regression timed out');process.exit(1);},180000);
const cases=[],test=(name,work,fn)=>cases.push({name,work,fn});
function problem(a){return new a.w.T.Problem(a.A.state.rules,a.A.state.month);}
const semantics=a=>{const p=problem(a);return clone(p.slots.map(s=>[s,p.countOf(s),p.countMinOf(s),p.countIdealOf(s)]));};
const fields=a=>{const r=clone(a.A.state.rules);delete r.profile.positions.work;delete r.profile.label;return {rules:r,month:clone(a.A.state.month)};};
async function until(a,fn,label){for(let i=0;i<100;i++){if(fn())return;await a.tick();}throw new Error('Timed out: '+label);}
async function importFile(a,r){const el=a.q('#fileLoadProfile');Object.defineProperty(el,'files',{configurable:true,value:[{name:'synthetic-minimum-profile.json',text:async()=>JSON.stringify(r)}]});el.dispatchEvent(new a.w.Event('change',{bubbles:true}));await until(a,()=>a.A.switching===0 && a.A.state.rules.profile.label===r.profile.label,'import');assert.deepStrictEqual(clone(a.A.state.rules.profile.positions.work),r.profile.positions.work);}
async function fixture(work){const a=await makeApp();a.enter();a.A.readSettings();const r=clone(a.A.state.rules);r.profile.label='Synthetic imported staffing';r.profile.positions={work:clone(work),local_position:{keep:'Synthetic position metadata'}};r.profile.local_profile={keep:'Synthetic profile metadata'};r.local_rules={keep:'Synthetic rule metadata'};await importFile(a,r);a.enter();return a;}
async function exported(a){let result;const pending=[];a.A.download=(name,blob)=>pending.push(new Promise((resolve,reject)=>{const reader=new a.w.FileReader();reader.onload=()=>{result=JSON.parse(reader.result);resolve();};reader.onerror=reject;reader.readAsText(blob);}));a.q('#setExportRoster').checked=true;a.click('#btnExportProfile');await until(a,()=>pending.length>0,'export download');await Promise.all(pending);assert(result);return result;}
async function persisted(a,expected){const out=await exported(a),p=new a.w.T.Problem(out,clone(a.A.state.month));assert.deepStrictEqual(clone(p.slots.map(s=>[s,p.countOf(s),p.countMinOf(s),p.countIdealOf(s)])),expected,'included-roster export retains staffing');const saved=a.w.localStorage.getItem(key);assert(saved);const b=await makeApp(saved,a.A.state.rules);try{b.enter();b.A.readSettings();assert.deepStrictEqual(semantics(b),expected,'reload retains staffing');assert.deepStrictEqual(b.errors,[]);}finally{b.dom.window.close();}return out;}

const minima=[['empty',{}],['null',null],['per-shift null',{day:null}]];
function bounds(a,day,night){const p=problem(a);for(const s of p.slots){const expected=s[1]==='day'?day:night;assert.deepStrictEqual([p.countOf(s),p.countMinOf(s)],expected,'bounds '+s.join(':'));}}
for(const [name,min] of minima){
 for(const edit of ['label','upper','ideal'])test(name+': '+edit+' edit, repeated readback, export and reload',{count:2,min},async a=>{
  const before=semantics(a),other=fields(a);
  if(edit==='label')a.change('#setProfLabel','Synthetic renamed minimum');
  if(edit==='upper')a.change('[data-count="night"]','3');
  if(edit==='ideal')a.change('[data-countideal="night"]','1');
  bounds(a,[2,1],[edit==='upper'?3:2,1]);
  assert.deepStrictEqual(clone(a.A.state.rules.profile.positions.work.min),min);
  if(edit==='label')assert.deepStrictEqual(semantics(a),before);
  // Ideal editing intentionally activates its rule; unrelated label/upper edits do not.
  if(edit!=='ideal')assert.deepStrictEqual(fields(a),other);
  const after=semantics(a);a.A.readSettings();a.A.readSettings();assert.deepStrictEqual(semantics(a),after);await persisted(a,after);
 });
 for(const [day,night] of [[0,2],[1,2],[2,0]])test(name+': asymmetric '+day+'/'+night,{count:{day,night},min},async a=>{
  const before=semantics(a);bounds(a,[day,Math.min(day,1)],[night,Math.min(night,1)]);
  a.change('#setProfLabel','Synthetic asymmetric minimum');a.A.readSettings();assert.deepStrictEqual(semantics(a),before);await persisted(a,before);
 });
 test(name+': explicit number then final clear',{count:2,min},async a=>{
  a.change('[data-countmin="night"]','0');bounds(a,[2,1],[2,0]);await persisted(a,semantics(a));
  a.change('[data-countmin="night"]','');bounds(a,[2,2],[2,2]);assert.strictEqual(a.A.state.rules.profile.positions.work.min,undefined);a.A.readSettings();await persisted(a,semantics(a));
 });
 test(name+': production checker and lint retain staffing range',{count:2,min},async a=>{
  const p=problem(a),asg=Object.fromEntries(p.slots.map(s=>[s.join(':'),{work:[N[0]],oc:[]}]));
  const check=()=>{const p=problem(a);assert.deepStrictEqual(clone(a.w.T.lint(p)),[]);return clone(a.w.T.check(p,asg).VC);};
  assert.deepStrictEqual(check(),[]);a.change('#setProfLabel','Synthetic checker minimum');assert.deepStrictEqual(check(),[]);await persisted(a,semantics(a));
 });
}
for(const edit of ['label','upper','ideal'])test('absent minimum: '+edit,{count:2},async a=>{
 if(edit==='label')a.change('#setProfLabel','Synthetic absent minimum');
 if(edit==='upper')a.change('[data-count="night"]','3');
 if(edit==='ideal')a.change('[data-countideal="night"]','1');
 bounds(a,[2,2],edit==='upper'?[3,3]:[2,2]);assert.strictEqual(a.A.state.rules.profile.positions.work.min,undefined);await persisted(a,semantics(a));
});
test('scalar zero partial clear keeps established fallback',{count:2,min:0},async a=>{
 a.change('[data-countmin="night"]','');bounds(a,[2,0],[2,1]);assert.deepStrictEqual(clone(a.A.state.rules.profile.positions.work.min),{day:0});await persisted(a,semantics(a));
});
for(const min of [{day:{}},{day:{weekday:0,off_days:1},night:null}])test('hidden minimum branches survive '+JSON.stringify(min),{count:2,min},async a=>{
 const before=semantics(a);a.change('#setProfLabel','Synthetic hidden minimum');a.A.readSettings();assert.deepStrictEqual(semantics(a),before);await persisted(a,before);
});
test('input-only upper edit before export preserves empty minimum',{count:2,min:{}},async a=>{
 const el=a.q('[data-count="night"]');el.value='3';el.dispatchEvent(new a.w.Event('input',{bubbles:true}));const out=await exported(a);assert.deepStrictEqual(out.profile.positions.work.min,{});bounds(a,[2,1],[3,1]);await persisted(a,semantics(a));
});
(async()=>{assert.equal(cases.length,EXPECTED_CASES);for(const {name,work,fn} of cases){let a;try{a=await fixture(work);await fn(a);assert.deepStrictEqual(a.errors,[]);passed++;console.log('PASS '+name);}catch(e){failed++;console.error('FAIL '+name+'\n'+e.stack);}finally{a?.dom.window.close();}}completed=true;clearTimeout(watchdog);console.log(`profile minimum preservation: ${passed}/${EXPECTED_CASES} passed, ${failed} failed`);})().catch(e=>{console.error(e);clearTimeout(watchdog);process.exitCode=1;});

// Accepted numeric staffing survives unrelated settings reads and sibling edits.
// Actual profile-file import, markup, delegated events, Problem/checker, export and storage.
// Fictional data only. jsdom 26.1.0; no native browser, layout, OS or network coverage.
// TOBAN_DOM_MODULE=/installed/node_modules/jsdom node test_profile_count_preservation_dom_node.js
const fs = require('fs'), path = require('path'), assert = require('assert');
// Verified with jsdom 26.1.0. Dependency lookup never downloads/install packages.
let JSDOM;
for (const name of [process.env.TOBAN_DOM_MODULE, 'jsdom', path.join(process.env.HOME || '', '.toban-test/node_modules/jsdom')].filter(Boolean)) {
  try { ({ JSDOM } = require(name)); break; } catch (e) { if (e.code !== 'MODULE_NOT_FOUND') throw e; }
}
if (!JSDOM) throw new Error('Profile count DOM-adapter regression requires jsdom 26.1.0. Set TOBAN_DOM_MODULE to its installed module path. This test was NOT run.');
const N = ['Synthetic Trainer', 'Synthetic Colleague'], clone = x => JSON.parse(JSON.stringify(x));
const root = process.env.TOBAN_SOURCE_ROOT || __dirname;
const source = f => fs.readFileSync(f === 'app-settings.js' && process.env.TOBAN_SETTINGS_SOURCE || path.join(root, 'src', f), 'utf8');
const scripts = ['i18n.js','rules-core.js','model.js', ...fs.readdirSync(path.join(root,'src/calendars')).filter(f=>f.endsWith('.js')).sort().map(f=>'calendars/'+f),
  'messages.js','solver.js','check.js','report.js','docxgen.js','plugins.js','merge.js', ...fs.readdirSync(path.join(root,'src/rules')).filter(f=>f.endsWith('.js')).sort().map(f=>'rules/'+f),
  'app-core.js','app-folder.js','app-month.js','app-input.js','app-settings.js','app-solve.js','app-main.js'];
const key = 'toban_state_v2:/synthetic/profile-count-preservation.html';
const rawRules = {profile:{id:'synthetic-profile-count-preservation',roles:[{id:'S',label:'Staff',refs:[]}],shifts:[{id:'day',label:'Day',on:'all'},{id:'night',label:'Night',on:'all'}]},doctors:N.map(name=>({name,team:'S',quota:15})),rule_states:{oncall:'off'},weights:{}};
const rawMonth = {year:2026,month:11,notes:'Synthetic settings builder roundtrip'};
async function makeApp(saved, fixture=rawRules, defaults=fixture) {
  const dom = new JSDOM(source('index.html'), {url:'https://example.invalid/synthetic/profile-count-preservation.html',runScripts:'outside-only'}), w=dom.window;
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



const EXPECTED_CASES=18;let passed=0,failed=0,completed=false;
process.on('exit',()=>{if(!completed || passed+failed!==EXPECTED_CASES || failed){console.error(`NOT PASSED: ${passed}/${EXPECTED_CASES}, ${failed} failed, finished=${completed}`);process.exitCode=1;}});
const watchdog=setTimeout(()=>{console.error('FAIL profile count regression timed out');process.exit(1);},120000);
const cases=[],test=(name,work,fn)=>cases.push({name,work,fn});
function problem(a){return new a.w.T.Problem(a.A.state.rules,a.A.state.month);}
const semantics=a=>{const p=problem(a);return clone(p.slots.map(s=>[s,p.countOf(s),p.countMinOf(s),p.countIdealOf(s)]));};
const fields=a=>{const r=clone(a.A.state.rules);delete r.profile.positions.work;delete r.profile.label;return {rules:r,month:clone(a.A.state.month)};};
async function until(a,fn,label){for(let i=0;i<100;i++){if(fn())return;await a.tick();}throw new Error('Timed out: '+label);}
async function importFile(a,r){const el=a.q('#fileLoadProfile');Object.defineProperty(el,'files',{configurable:true,value:[{name:'synthetic-count-profile.json',text:async()=>JSON.stringify(r)}]});el.dispatchEvent(new a.w.Event('change',{bubbles:true}));await until(a,()=>a.A.switching===0 && a.A.state.rules.profile.label===r.profile.label,'import');assert.deepStrictEqual(clone(a.A.state.rules.profile.positions.work),r.profile.positions.work);}
async function fixture(work){const a=await makeApp();a.enter();a.A.readSettings();const r=clone(a.A.state.rules);r.profile.label='Synthetic imported staffing';r.profile.positions={work:clone(work),local_position:{keep:'Synthetic position metadata'}};r.profile.local_profile={keep:'Synthetic profile metadata'};r.local_rules={keep:'Synthetic rule metadata'};await importFile(a,r);a.enter();return a;}
async function exported(a){let result;const pending=[];a.A.download=(name,blob)=>pending.push(new Promise((resolve,reject)=>{const reader=new a.w.FileReader();reader.onload=()=>{result=JSON.parse(reader.result);resolve();};reader.onerror=reject;reader.readAsText(blob);}));a.q('#setExportRoster').checked=true;a.click('#btnExportProfile');await until(a,()=>pending.length>0,'export download');await Promise.all(pending);assert(result);return result;}
async function persisted(a,expected){const out=await exported(a),p=new a.w.T.Problem(out,clone(a.A.state.month));assert.deepStrictEqual(clone(p.slots.map(s=>[s,p.countOf(s),p.countMinOf(s),p.countIdealOf(s)])),expected,'included-roster export retains staffing');const saved=a.w.localStorage.getItem(key);assert(saved);const b=await makeApp(saved,a.A.state.rules);try{b.enter();b.A.readSettings();assert.deepStrictEqual(semantics(b),expected,'reload retains staffing');assert.deepStrictEqual(b.errors,[]);}finally{b.dom.window.close();}return out;}
for(const [name,work] of [
 ['canonical scalar',{count:41}],['canonical per-shift',{count:{day:41,night:2}}],
 ['canonical day-type',{count:{weekday:41,off_days:42}}],['nested shift/day-type',{count:{day:{weekday:41,off_days:42},night:2}}],
 ['direct scalar',41],['direct shift shorthand',{day:41,night:2}],['boundary40',{count:40}],
])test(name+': unrelated edits, repeated reads, export and reload',work,async a=>{const before=semantics(a),unrelated=fields(a);assert.equal(a.q('#setProfLabel').closest('[hidden]'),null);a.change('#setProfLabel','Synthetic renamed staffing');a.A.readSettings();a.A.readSettings();assert.deepStrictEqual(semantics(a),before);assert.deepStrictEqual(fields(a),unrelated);await persisted(a,before);});
for(const [name,work] of [['canonical',{count:{day:41,night:2}}],['shorthand',{day:41,night:2}]])test(name+': edit night only preserves day41',work,async a=>{const unrelated=fields(a);a.change('[data-count="night"]','3');assert.equal(problem(a).countOf([1,'day']),41);assert.equal(problem(a).countOf([1,'night']),3);assert.deepStrictEqual(fields(a),unrelated);a.A.readSettings();await persisted(a,semantics(a));});
test('lower-bound edit retains unedited upper counts',{count:41},async a=>{a.change('[data-countmin="night"]','1');assert.equal(problem(a).countOf([1,'day']),41);assert.equal(problem(a).countOf([1,'night']),41);assert.equal(problem(a).countMinOf([1,'night']),1);await persisted(a,semantics(a));});
for(const [value,expected] of [['42',40],['35',35],['0',0],['',1]])test('explicit count '+JSON.stringify(value)+' keeps existing edit semantics',{count:{day:41,night:2}},async a=>{a.change('[data-count="night"]',value);assert.equal(problem(a).countOf([1,'night']),expected);assert.equal(problem(a).countOf([1,'day']),41,'untouched sibling is not clamped');await persisted(a,semantics(a));});
test('work metadata and unchanged high bounds survive',{count:41,min:41,ideal:41,local_work:{keep:'Synthetic work metadata'}},async a=>{const before=semantics(a),metadata=clone(a.A.state.rules.profile.positions.work.local_work),unrelated=fields(a);a.change('#setProfLabel','Synthetic renamed metadata');assert.deepStrictEqual(semantics(a),before);assert.deepStrictEqual(clone(a.A.state.rules.profile.positions.work.local_work),metadata);assert.deepStrictEqual(fields(a),unrelated);const out=await persisted(a,before);assert.deepStrictEqual(out.profile.positions.work.local_work,metadata);});
test('zero upper count still caps visible min and ideal',{count:0,min:1,ideal:1},a=>{a.change('#setProfLabel','Synthetic renamed zero');for(const shift of ['day','night']){assert.equal(a.A.state.rules.profile.positions.work.min[shift],0);assert.equal(a.A.state.rules.profile.positions.work.ideal[shift],0);}});
test('input-only sibling edit is read before export',{count:{day:41,night:2}},async a=>{const el=a.q('[data-count="night"]');el.value='3';el.dispatchEvent(new a.w.Event('input',{bubbles:true}));const out=await exported(a);assert.equal(out.profile.positions.work.count.day,41);assert.equal(out.profile.positions.work.count.night,3);});
test('production checker keeps accepted41 and rejects40 after unrelated edit',{count:41},async a=>{
 const r=clone(a.A.state.rules);r.profile.label='Synthetic41 checker';r.profile.shifts=[{id:'day',on:'none'},{id:'night',on:'all'}];r.doctors=Array.from({length:41},(_,i)=>({name:'Fictional Staff '+(i+1),team:'S',quota:30}));r.name_order=r.doctors.map(d=>d.name);await importFile(a,r);a.enter();
 const check=()=>{const p=problem(a);assert.deepStrictEqual(clone(a.w.T.lint(p)),[]);return [41,40].map(n=>{const asg=Object.fromEntries(p.slots.map(s=>[s.join(':'),{work:p.names.slice(0,n),oc:[]}]));return {assignments:p.slots.length*n,codes:clone(a.w.T.check(p,asg).VC.map(v=>v.code))};});};
 const before=check();assert.deepStrictEqual(before,[{assignments:1230,codes:[]},{assignments:1200,codes:Array(30).fill('SLOT_WORKER_COUNT')}]);a.change('#setProfLabel','Synthetic renamed checker');assert.deepStrictEqual(check(),before);await persisted(a,semantics(a));
});
(async()=>{assert.equal(cases.length,EXPECTED_CASES);for(const {name,work,fn} of cases){let a;try{a=await fixture(work);await fn(a);assert.deepStrictEqual(a.errors,[]);passed++;console.log('PASS '+name);}catch(e){failed++;console.error('FAIL '+name+'\n'+e.stack);}finally{a?.dom.window.close();}}completed=true;clearTimeout(watchdog);console.log(`profile count preservation: ${passed}/${EXPECTED_CASES} passed, ${failed} failed`);})().catch(e=>{console.error(e);clearTimeout(watchdog);process.exitCode=1;});

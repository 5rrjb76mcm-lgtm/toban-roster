// A blank shift minimum beside a written one is the fixed count, as the blank field ("fixed") says.
// Settings screen (real markup, delegated events, readback), model bounds, rules summary, signature, profile export,
// reload. Untouched blank shifts keep their stored meaning. Fictional data only. jsdom 26.1.0; no native browser.
// TOBAN_DOM_MODULE=/installed/node_modules/jsdom node test_partial_minimum_fixed_dom_node.js
const fs = require('fs'), path = require('path'), assert = require('assert');
let JSDOM;
for (const name of [process.env.TOBAN_DOM_MODULE, 'jsdom', path.join(process.env.HOME || '', '.toban-test/node_modules/jsdom')].filter(Boolean)) {
  try { ({ JSDOM } = require(name)); break; } catch (e) { if (e.code !== 'MODULE_NOT_FOUND') throw e; }
}
if (!JSDOM) throw new Error('Partial minimum DOM regression requires jsdom 26.1.0. Set TOBAN_DOM_MODULE to its installed module path. This test was NOT run.');
const N = ['Synthetic Trainer', 'Synthetic Colleague'], clone = x => JSON.parse(JSON.stringify(x));
const root = process.env.TOBAN_SOURCE_ROOT || __dirname;
const source = f => fs.readFileSync(f === 'app-settings.js' && process.env.TOBAN_SETTINGS_SOURCE || path.join(root, 'src', f), 'utf8');
const scripts = ['i18n.js','rules-core.js','model.js', ...fs.readdirSync(path.join(root,'src/calendars')).filter(f=>f.endsWith('.js')).sort().map(f=>'calendars/'+f),
  'messages.js','solver.js','check.js','report.js','docxgen.js','plugins.js','merge.js', ...fs.readdirSync(path.join(root,'src/rules')).filter(f=>f.endsWith('.js')).sort().map(f=>'rules/'+f),
  'app-core.js','app-folder.js','app-month.js','app-input.js','app-settings.js','app-solve.js','app-main.js'];
const key = 'toban_state_v2:/synthetic/partial-minimum-fixed.html';
const rawRules = {profile:{id:'synthetic-partial-minimum-fixed',roles:[{id:'S',label:'Staff',refs:[]}],shifts:[{id:'day',label:'Day',on:'all'},{id:'night',label:'Night',on:'all'}]},doctors:N.map(name=>({name,team:'S',quota:15})),rule_states:{oncall:'off'},weights:{}};
const rawMonth = {year:2026,month:11,notes:'Synthetic partial minimum'};
async function makeApp(saved, fixture=rawRules, defaults=fixture) {
  const dom = new JSDOM(source('index.html'), {url:'https://example.invalid/synthetic/partial-minimum-fixed.html',runScripts:'outside-only'}), w=dom.window;
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
const EXPECTED_CASES=12; let passed=0,failed=0,completed=false;
process.on('exit',()=>{if(!completed || passed+failed!==EXPECTED_CASES || failed){console.error(`NOT PASSED: ${passed}/${EXPECTED_CASES}, ${failed} failed, finished=${completed}`);process.exitCode=1;}});
const watchdog=setTimeout(()=>{console.error('FAIL partial minimum regression timed out');process.exit(1);},240000);
const cases=[],test=(name,work,fn)=>cases.push({name,work,fn});
function problem(a){return new a.w.T.Problem(a.A.state.rules,a.A.state.month);}
const semantics=a=>{const p=problem(a);return clone(p.slots.map(s=>[s,p.countOf(s),p.countMinOf(s),p.countIdealOf(s)]));};
const work=a=>clone(a.A.state.rules.profile.positions.work);
async function until(a,fn,label){for(let i=0;i<100;i++){if(fn())return;await a.tick();}throw new Error('Timed out: '+label);}
async function importFile(a,r){const el=a.q('#fileLoadProfile');Object.defineProperty(el,'files',{configurable:true,value:[{name:'synthetic-partial-minimum-profile.json',text:async()=>JSON.stringify(r)}]});el.dispatchEvent(new a.w.Event('change',{bubbles:true}));await until(a,()=>a.A.switching===0 && a.A.state.rules.profile.label===r.profile.label,'import');assert.deepStrictEqual(clone(a.A.state.rules.profile.positions.work),r.profile.positions.work);}
async function fixture(w){const a=await makeApp();a.enter();a.A.readSettings();const r=clone(a.A.state.rules);r.profile.label='Synthetic imported staffing';r.profile.positions={work:clone(w)};await importFile(a,r);a.enter();return a;}
async function exported(a){let result;const pending=[];a.A.download=(name,blob)=>pending.push(new Promise((resolve,reject)=>{const reader=new a.w.FileReader();reader.onload=()=>{result=JSON.parse(reader.result);resolve();};reader.onerror=reject;reader.readAsText(blob);}));a.q('#setExportRoster').checked=true;a.click('#btnExportProfile');await until(a,()=>pending.length>0,'export download');await Promise.all(pending);assert(result);return result;}
async function persisted(a,expected){const out=await exported(a),p=new a.w.T.Problem(out,clone(a.A.state.month));assert.deepStrictEqual(clone(p.slots.map(s=>[s,p.countOf(s),p.countMinOf(s),p.countIdealOf(s)])),expected,'included-roster export retains staffing');const saved=a.w.localStorage.getItem(key);assert(saved);const b=await makeApp(saved,a.A.state.rules);try{b.enter();b.A.readSettings();assert.deepStrictEqual(semantics(b),expected,'reload retains staffing');assert.deepStrictEqual(b.errors,[]);}finally{b.dom.window.close();}return out;}
// [upper, lower] per shift for the weekday and the weekend slot of that shift
function bounds(a,day,night){const p=problem(a);for(const s of p.slots){const expected=s[1]==='day'?day:night;assert.deepStrictEqual([p.countOf(s),p.countMinOf(s)],expected,'bounds '+s.join(':'));}}
const minField=(a,k)=>a.q(`#shiftTbl input[data-countmin="${k}"]`);
const summaryText=a=>(a.w.T.rulesSummary(problem(a))||[]).flatMap(g=>g.items).join('\n');
const FIXED_LABEL=a=>a.w.T.t('固定');

test('absent minimum: a day lower bound keeps the blank night fixed (model, field, summary, signature, export, reload)',{count:{day:3,night:2}},async a=>{
 const sigBefore=a.A.inputSig(); assert.ok(!summaryText(a).includes('〜'),'summary starts with fixed counts');
 a.change(minField(a,'day'),'1');
 assert.deepStrictEqual(work(a),{count:{day:3,night:2},min:{day:1}}); bounds(a,[3,1],[2,2]);
 const night=minField(a,'night'); assert.strictEqual(night.value,''); assert.strictEqual(night.placeholder,FIXED_LABEL(a),'the blank night field still reads "fixed"');
 const sum=summaryText(a); assert.ok(sum.includes('1〜3'),'summary shows the day range: '+sum); assert.ok(!sum.includes('1〜2') && !sum.includes('2〜2'),'summary shows the night as a fixed 2: '+sum);
 assert.notStrictEqual(a.A.inputSig(),sigBefore,'the edit changes the input signature');
 a.A.readSettings(); a.A.readSettings(); bounds(a,[3,1],[2,2]); await persisted(a,semantics(a));
});
test('two written minima: clearing one returns that shift to fixed',{count:{day:3,night:2},min:{day:1,night:2}},async a=>{
 bounds(a,[3,1],[2,2]); a.change(minField(a,'day'),'');
 assert.deepStrictEqual(work(a).min,{night:2}); bounds(a,[3,3],[2,2]); assert.strictEqual(minField(a,'day').value,''); await persisted(a,semantics(a));
});
test('a lower bound above the count is clamped to it; the other shift stays fixed',{count:{day:3,night:2}},async a=>{
 a.change(minField(a,'day'),'5'); assert.deepStrictEqual(work(a).min,{day:3}); bounds(a,[3,3],[2,2]); await persisted(a,semantics(a));
});
test('a zero lower bound on one shift only',{count:{day:2,night:2}},async a=>{
 a.change(minField(a,'night'),'0'); assert.deepStrictEqual(work(a).min,{night:0}); bounds(a,[2,2],[2,0]);
 const sum=summaryText(a); assert.ok(sum.includes('0〜2'),sum); assert.ok(!sum.includes('1〜2'),sum); await persisted(a,semantics(a));
});
test('written then cleared again: the minimum is removed and both shifts are fixed',{count:{day:3,night:2}},async a=>{
 a.change(minField(a,'day'),'1'); bounds(a,[3,1],[2,2]); a.change(minField(a,'day'),'');
 assert.strictEqual(work(a).min,undefined); bounds(a,[3,3],[2,2]); await persisted(a,semantics(a));
});
// Untouched blank shifts keep their stored meaning (the fallback of one) when a sibling is written.
test('empty minimum {}: writing one shift keeps the other at one',{count:2,min:{}},async a=>{
 a.change(minField(a,'night'),'0'); assert.deepStrictEqual(work(a).min,{night:0,day:null}); bounds(a,[2,1],[2,0]); await persisted(a,semantics(a));
});
test('root null minimum: writing one shift keeps the other at one',{count:2,min:null},async a=>{
 a.change(minField(a,'day'),'0'); assert.deepStrictEqual(work(a).min,{day:0,night:null}); bounds(a,[2,0],[2,1]); await persisted(a,semantics(a));
});
test('per-shift null: writing the other shift keeps the explicit empty',{count:2,min:{day:null}},async a=>{
 a.change(minField(a,'night'),'1'); assert.deepStrictEqual(work(a).min,{day:null,night:1}); bounds(a,[2,1],[2,1]); await persisted(a,semantics(a));
});
test('hidden day-type branch with an explicit null sibling survives a count edit',{count:2,min:{day:{weekday:0,off_days:1},night:null}},async a=>{
 const before=work(a).min; a.change('[data-count="night"]','3'); assert.deepStrictEqual(work(a).min,before);
 const p=problem(a); for(const s of p.slots){ if(s[1]==='night') assert.deepStrictEqual([p.countOf(s),p.countMinOf(s)],[3,1],'night '+s[0]); else assert.deepStrictEqual([p.countOf(s),p.countMinOf(s)],[2,p.isHoliday(s[0])?1:0],'day '+s[0]); }
 await persisted(a,semantics(a));
});
// Controls: unchanged behaviour.
test('control: absent minimum stays absent and fixed through unrelated edits',{count:{day:3,night:2}},async a=>{
 a.change('#setProfLabel','Synthetic renamed'); a.change('[data-count="night"]','3'); assert.strictEqual(work(a).min,undefined); bounds(a,[3,3],[3,3]); await persisted(a,semantics(a));
});
test('control: empty minimum {} stays one for both through a label edit',{count:2,min:{}},async a=>{
 a.change('#setProfLabel','Synthetic renamed'); assert.deepStrictEqual(work(a).min,{}); bounds(a,[2,1],[2,1]); await persisted(a,semantics(a));
});
test('control: both minima written and edited',{count:{day:3,night:2},min:{day:1,night:1}},async a=>{
 a.change(minField(a,'night'),'2'); assert.deepStrictEqual(work(a).min,{day:1,night:2}); bounds(a,[3,1],[2,2]); await persisted(a,semantics(a));
});
(async()=>{assert.equal(cases.length,EXPECTED_CASES);for(const {name,work:w,fn} of cases){let a;try{a=await fixture(w);await fn(a);assert.deepStrictEqual(a.errors,[]);passed++;console.log('PASS '+name);}catch(e){failed++;console.error('FAIL '+name+'\n'+e.stack.split('\n').slice(0,8).join('\n'));}finally{a?.dom.window.close();}}completed=true;clearTimeout(watchdog);console.log(`partial minimum fixed: ${passed}/${EXPECTED_CASES} passed, ${failed} failed`);})().catch(e=>{console.error(e);clearTimeout(watchdog);process.exitCode=1;});

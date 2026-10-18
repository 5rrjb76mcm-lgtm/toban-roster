// Accepted unknown shift-sequence references survive unrelated settings edits.
// Actual markup, init, delegated settings events,
// Problem and localStorage. Fictional data only; jsdom supplies the DOM.
// No browser, layout, OS permissions or network test is claimed; no sockets are opened.
// Run: TOBAN_DOM_MODULE=/path/to/node_modules/jsdom node test_sequence_selector_preservation_dom_node.js [/path/to/node_modules/highs]
const fs = require('fs'), path = require('path'), assert = require('assert');
// Verified with jsdom 26.1.0. Dependency lookup never downloads/install packages.
let JSDOM;
for (const name of [process.env.TOBAN_DOM_MODULE, 'jsdom', path.join(process.env.HOME || '', '.toban-test/node_modules/jsdom')].filter(Boolean)) {
  try { ({ JSDOM } = require(name)); break; } catch (e) { if (e.code !== 'MODULE_NOT_FOUND') throw e; }
}
if (!JSDOM) throw new Error('Sequence selector DOM-adapter regression requires jsdom 26.1.0. Set TOBAN_DOM_MODULE to its installed module path. This test was NOT run.');
const N = ['Synthetic Trainer', 'Synthetic Colleague'], clone = x => JSON.parse(JSON.stringify(x));
const root = process.env.TOBAN_SOURCE_ROOT || __dirname;
const source = f => fs.readFileSync(path.join(root, 'src', f), 'utf8');
const scripts = ['i18n.js','rules-core.js','model.js', ...fs.readdirSync(path.join(root,'src/calendars')).filter(f=>f.endsWith('.js')).sort().map(f=>'calendars/'+f),
  'messages.js','solver.js','check.js','report.js','docxgen.js','plugins.js','merge.js', ...fs.readdirSync(path.join(root,'src/rules')).filter(f=>f.endsWith('.js')).sort().map(f=>'rules/'+f),
  'app-core.js','app-folder.js','app-month.js','app-input.js','app-settings.js','app-solve.js','app-main.js'];
const key = 'toban_state_v2:/synthetic/sequence-selector-preservation.html';
const rawRules = {profile:{id:'synthetic-sequence-selector-preservation',roles:[{id:'S',label:'Staff',refs:[]}],shifts:[{id:'day',on:'all'},{id:'night',on:'all'}]},doctors:N.map(name=>({name,team:'S',quota:15})),rule_states:{oncall:'off'},weights:{}};
const rawMonth = {year:2026,month:11,notes:'Synthetic settings builder roundtrip'};
async function makeApp(saved, fixture=rawRules, defaults=fixture) {
  const dom = new JSDOM(source('index.html'), {url:'https://example.invalid/synthetic/sequence-selector-preservation.html',runScripts:'outside-only'}), w=dom.window;
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

const EXPECTED_CASES=16;
let finished=false,passed=0,failed=0;
process.on('exit',()=>{if(!finished){console.error('FAIL sequence selector test did not complete');process.exitCode=1;}});
const watchdog=setTimeout(()=>{console.error('FAIL sequence selector test timed out');process.exit(1);},120000);
const cases=[],test=(name,fn)=>cases.push({name,fn});
const savedRows=a=>clone(a.A.state.rules.forbid_sequence);
const editYears=a=>a.change('#doctorTable tr[data-i="0"] [data-f="years"]','12');
async function fixture(a,rows,st='hard',disabledDay=false){
 a.enter();const r=clone(a.A.state.rules);r.rule_states.shift_sequence=st;r.forbid_sequence=clone(rows);
 if(disabledDay)r.profile.shifts=[{id:'day',on:'none'},{id:'night',on:'all'}];
 a.q('#rulesJson').value=JSON.stringify(r);a.click('#btnApplyRules');await a.tick();
 assert.deepStrictEqual(savedRows(a),rows,'actual JSON apply accepts and retains the reference');
}
function semantics(a){
 const p=new a.w.T.Problem(a.A.state.rules,a.A.state.month);
 const asg=Object.fromEntries(p.slots.map(s=>[s.join(':'),{work:N[0],oc:[]}]));
 return {rules:clone(p.seqRules),violations:clone(a.w.T.check(p,asg).V),penalty:a.w.T.penalty(p,asg).total};
}
async function reload(a,fn){const saved=a.w.localStorage.getItem(key);assert(saved);const b=await makeApp(saved);try{await fn(b);assert.deepStrictEqual(b.errors,[]);}finally{b.w.close();}}
for(const st of ['hard','soft']){
 for(const [label,from,to] of [['unknown from','synthetic.unavailable','night'],['unknown to','night','synthetic.unavailable'],['both unknown','synthetic.first','synthetic.second']]){
  test(`${st}: ${label} import, same-value change, repeated read, unrelated edit and reload`,async a=>{
   const rows=[{from,to,local_extra:{tag:label}}];await fixture(a,rows,st);const before=semantics(a);assert.equal(before.violations.length,0);assert.equal(before.penalty,0);
   assert.equal(a.q('[data-sfrom]').value,from);assert.equal(a.q('[data-sto]').value,to);
   a.change('[data-sfrom]',from);a.change('[data-sto]',to);a.A.readSettings();a.A.readSettings();editYears(a);
   assert.deepStrictEqual(savedRows(a),rows);assert.deepStrictEqual(semantics(a),before);
   assert.deepStrictEqual(JSON.parse(a.w.localStorage.getItem(key)).rules.forbid_sequence,rows);
   await reload(a,b=>{assert.deepStrictEqual(savedRows(b),rows);assert.deepStrictEqual(semantics(b),before);});
  });
 }
 test(`${st}: known disabled day stays inactive`,async a=>{
  const rows=[{from:'day',to:'night'}];await fixture(a,rows,st,true);const before=semantics(a);assert.equal(before.violations.length,0);assert.equal(before.penalty,0);
  editYears(a);assert.deepStrictEqual(savedRows(a),rows);assert.deepStrictEqual(semantics(a),before);await reload(a,b=>assert.deepStrictEqual(semantics(b),before));
 });
 test(`${st}: explicit valid choices change applicability and Undo restores unknowns`,async a=>{
  const rows=[{from:'synthetic.first',to:'synthetic.second',local_extra:{tag:'same row'}}];await fixture(a,rows,st);const before=semantics(a);
  a.change('[data-sfrom]','night');assert.equal(a.A.state.rules.forbid_sequence[0].to,'synthetic.second');assert.equal(semantics(a).penalty,0);
  a.change('[data-sto]','any');const changed=semantics(a);assert.equal(changed.rules[0].from,'night');assert.equal(changed.rules[0].to,'any');
  if(st==='hard')assert.equal(changed.violations.length,58);else {assert.equal(changed.violations.length,0);assert.equal(changed.penalty,5800);}
  assert.deepStrictEqual(clone(a.A.state.rules.forbid_sequence[0].local_extra),rows[0].local_extra);
  await reload(a,b=>assert.deepStrictEqual(semantics(b),changed));
  a.A.undo();a.A.undo();assert.deepStrictEqual(savedRows(a),rows);assert.deepStrictEqual(semantics(a),before);
 });
 test(`${st}: add/delete keep metadata attached to the right row`,async a=>{
  const rows=[{from:'synthetic.first',to:'synthetic.second',local_extra:{id:'one'}},{from:'synthetic.first',to:'synthetic.second',local_extra:{id:'two'}}];
  await fixture(a,rows,st);a.click('[data-si="0"] [data-act="seqDel"]');assert.deepStrictEqual(savedRows(a),[rows[1]]);
  a.click('[data-act="seqAdd"]');assert.deepStrictEqual(savedRows(a),[rows[1],{from:'night',to:'any'}]);
  a.click('[data-si="1"] [data-act="seqDel"]');assert.deepStrictEqual(savedRows(a),[rows[1]]);
  await reload(a,b=>assert.deepStrictEqual(savedRows(b),[rows[1]]));a.A.undo();a.A.undo();a.A.undo();assert.deepStrictEqual(savedRows(a),rows);
 });
 test(`${st}: off/on retains unknown choices and row metadata`,async a=>{
  const rows=[{from:'synthetic.first',to:'synthetic.second',local_extra:{id:'keep'}}];await fixture(a,rows,st);
  a.change('[data-ron="shift_sequence"]',false);assert.equal(a.q('[data-sfrom]'),null);editYears(a);assert.deepStrictEqual(savedRows(a),rows);
  a.change('[data-ron="shift_sequence"]',true);assert.deepStrictEqual(savedRows(a),rows);assert.equal(a.q('[data-sfrom]').value,'synthetic.first');assert.equal(a.q('[data-sto]').value,'synthetic.second');
  await reload(a,b=>assert.deepStrictEqual(savedRows(b),rows));
 });
}
// Malformed non-string descriptors keep the pre-existing UI/readback behavior.
// This change preserves string identifiers only; it does not add object/array choices.
for(const [label,value] of [['object',{}],['array',[]]])test(`malformed ${label} selectors keep baseline behavior`,async a=>{
 const rows=[{from:clone(value),to:clone(value),local_extra:{id:'malformed'}}];await fixture(a,rows);
 assert.equal(a.q('[data-sfrom]').options.length,2);assert.equal(a.q('[data-sto]').options.length,3);
 assert.equal(a.q('[data-sfrom]').value,'day');assert.equal(a.q('[data-sto]').value,'any');
 editYears(a);assert.deepStrictEqual(savedRows(a),[{from:'day',to:'any',local_extra:{id:'malformed'}}]);
 await reload(a,b=>assert.deepStrictEqual(savedRows(b),savedRows(a)));a.A.undo();assert.deepStrictEqual(savedRows(a),rows);
});
(async()=>{assert.equal(cases.length,EXPECTED_CASES);for(const c of cases){const a=await makeApp();try{await c.fn(a);assert.deepStrictEqual(a.errors,[]);passed++;console.log('PASS '+c.name);}catch(e){failed++;console.error('FAIL '+c.name,e);}finally{a.w.close();}}console.log(`sequence selector preservation: ${passed} passed, ${failed} failed, ${cases.length} total`);assert.equal(passed+failed,EXPECTED_CASES);finished=true;clearTimeout(watchdog);if(failed)process.exitCode=1;})().catch(e=>{console.error(e);process.exitCode=1;});

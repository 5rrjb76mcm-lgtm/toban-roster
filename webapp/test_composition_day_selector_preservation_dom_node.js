// Accepted exact composition day-flag identifiers survive unrelated settings edits.
// Actual markup, init, delegated settings events,
// Problem and localStorage. Fictional data only; jsdom supplies the DOM.
// No browser, layout, OS permissions or network test is claimed; no sockets are opened.
// Run: TOBAN_DOM_MODULE=/path/to/node_modules/jsdom node test_composition_day_selector_preservation_dom_node.js
const fs = require('fs'), path = require('path'), assert = require('assert');
// Verified with jsdom 26.1.0. Dependency lookup never downloads/install packages.
let JSDOM;
for (const name of [process.env.TOBAN_DOM_MODULE, 'jsdom', path.join(process.env.HOME || '', '.toban-test/node_modules/jsdom')].filter(Boolean)) {
  try { ({ JSDOM } = require(name)); break; } catch (e) { if (e.code !== 'MODULE_NOT_FOUND') throw e; }
}
if (!JSDOM) throw new Error('Composition day selector DOM-adapter regression requires jsdom 26.1.0. Set TOBAN_DOM_MODULE to its installed module path. This test was NOT run.');
const N = ['Synthetic Trainer', 'Synthetic Colleague'], clone = x => JSON.parse(JSON.stringify(x));
const root = process.env.TOBAN_SOURCE_ROOT || __dirname;
const source = f => fs.readFileSync(path.join(root, 'src', f), 'utf8');
const scripts = ['i18n.js','rules-core.js','model.js', ...fs.readdirSync(path.join(root,'src/calendars')).filter(f=>f.endsWith('.js')).sort().map(f=>'calendars/'+f),
  'messages.js','solver.js','check.js','report.js','docxgen.js','plugins.js','merge.js', ...fs.readdirSync(path.join(root,'src/rules')).filter(f=>f.endsWith('.js')).sort().map(f=>'rules/'+f),
  'app-core.js','app-folder.js','app-month.js','app-input.js','app-settings.js','app-solve.js','app-main.js'];
const key = 'toban_state_v2:/synthetic/composition-day-selector-preservation.html';
const rawRules = {profile:{id:'synthetic-composition-day-selector-preservation',roles:[{id:'S',label:'Staff',refs:[]}],shifts:[{id:'day',on:'all'},{id:'night',on:'all'}]},doctors:N.map(name=>({name,team:'S',quota:15})),rule_states:{oncall:'off'},weights:{}};
const rawMonth = {year:2026,month:11,notes:'Synthetic settings builder roundtrip'};
async function makeApp(saved, fixture=rawRules, defaults=fixture) {
  const dom = new JSDOM(source('index.html'), {url:'https://example.invalid/synthetic/composition-day-selector-preservation.html',runScripts:'outside-only'}), w=dom.window;
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

// Calendar forms are never opened or changed: these fictional flags are model input.
const exactId = 'Synthetic training ', otherId = 'Synthetic training';
rawMonth.day_flags = {7:[exactId], 8:[otherId]};
const EXPECTED_CASES = 15;
let finished = false, passed = 0, failed = 0;
const watchdog = setTimeout(() => { console.error('FAIL composition day selector test timed out'); process.exit(1); }, 120000);
process.on('exit', () => {
  if (!finished || passed + failed !== EXPECTED_CASES) {
    console.error(`FAIL incomplete composition day selector test: ${passed + failed}/${EXPECTED_CASES}`);
    process.exitCode = 1;
  }
});
const cases = [], test = (name, fn) => cases.push({name, fn});
async function fixture(a, {state='hard', active=true, days='flag:'+exactId} = {}) {
  a.enter(); a.A.readSettings(); // Canonicalize unrelated defaults before importing the tested value.
  const r = clone(a.A.state.rules);
  r.rule_states.composition = state; r.weights.composition_miss = 100;
  r.doctors[0].quals = ['trainer'];
  r.composition = [{shift:'night', days, min:1, qual:'trainer', local_extra:{id:'original'}}];
  if (active) r.profile.day_flags = [{id:exactId,label:'Training A'}, {id:otherId,label:'Training B'}];
  a.q('#rulesJson').value = JSON.stringify(r); a.click('#btnApplyRules'); await a.tick();
  assert.deepStrictEqual(clone(a.A.state.rules.composition), r.composition, 'actual JSON apply must accept and retain the reference');
  return r;
}
function semantics(a) {
  const p = new a.w.T.Problem(a.A.state.rules,a.A.state.month);
  const asg = Object.fromEntries(p.slots.map(s => [s.join(':'), {work:s[0] === 7 ? N[1] : N[0], oc:[]}]));
  return {scope:clone(p.comp.flatMap(c => p.slots.filter(s => p.compOn(c,s)))),
    violations:a.w.T.check(p,asg).VC.filter(v => v.code === 'COMPOSITION_SHORT').length,
    penalty:a.w.T.penalty(p,asg).total};
}
const editYears = a => a.change('#doctorTable tr[data-i="0"] [data-f="years"]','12');
async function reload(a, fn) {
  const saved = a.w.localStorage.getItem(key); assert(saved);
  const b = await makeApp(saved);
  try { await fn(b); assert.deepStrictEqual(b.errors,[]); }
  finally { b.w.close(); }
}
for (const state of ['hard','soft']) for (const active of [true,false]) {
  test(`${state}: ${active?'declared':'inactive'} exact flag survives unrelated edits, repeated reads and reload`, async a => {
    const r = await fixture(a,{state,active}), month = clone(a.A.state.month), before = semantics(a);
    assert.equal(a.q('[data-cdays]').value,'flag:'+exactId);
    assert.deepStrictEqual(before,{scope:[[7,'night']],violations:state==='hard'?1:0,penalty:state==='soft'?100:0});
    editYears(a); a.A.readSettings(); a.A.readSettings(); r.doctors[0].years = 12;
    assert.equal(a.A.state.rules.composition[0].days,'flag:'+exactId,'unrelated settings read must not trim an identifier');
    assert.deepStrictEqual(clone(a.A.state.rules),r,'all other rules and descriptors remain unchanged');
    assert.deepStrictEqual(clone(a.A.state.month),month,'month flag IDs and all unrelated month input remain unchanged');
    assert.deepStrictEqual(semantics(a),before);
    assert.deepStrictEqual(JSON.parse(a.w.localStorage.getItem(key)).rules,r);
    await reload(a,b => { assert.deepStrictEqual(clone(b.A.state.rules),r); assert.deepStrictEqual(clone(b.A.state.month),month); assert.deepStrictEqual(semantics(b),before); });
  });
}
test('ordinary flag identifiers retain existing behavior',async a => {
  const r = await fixture(a,{days:'flag:'+otherId}), before = semantics(a);
  assert.deepStrictEqual(before,{scope:[[8,'night']],violations:0,penalty:0});
  editYears(a); r.doctors[0].years=12; assert.deepStrictEqual(clone(a.A.state.rules),r); assert.deepStrictEqual(semantics(a),before);
});
for (const choice of ['all','weekdays','off_days','flag:'+otherId]) {
  test('explicit choice '+choice+' changes only that scope',async a => {
    const r = await fixture(a), month = clone(a.A.state.month);
    a.change('[data-cdays]',choice);
    if(choice==='all')delete r.composition[0].days;else r.composition[0].days=choice;
    assert.deepStrictEqual(clone(a.A.state.rules),r);
    assert.deepStrictEqual(clone(a.A.state.month),month);
    const after = semantics(a); assert.equal(after.scope.length,{all:30,weekdays:21,off_days:9,['flag:'+otherId]:1}[choice]);
    a.A.readSettings(); assert.deepStrictEqual(clone(a.A.state.rules),r);
    await reload(a,b => { assert.deepStrictEqual(clone(b.A.state.rules),r); assert.deepStrictEqual(semantics(b),after); });
  });
}
test('adding a new row retains exact original scope without copying metadata',async a => {
  await fixture(a); const original = clone(a.A.state.rules.composition[0]);
  a.click('[data-act="compAdd"]');
  assert.deepStrictEqual(clone(a.A.state.rules.composition),[original,{shift:'night',min:1}]);
  editYears(a);
  assert.deepStrictEqual(clone(a.A.state.rules.composition),[original,{shift:'night',min:1}]);
  a.click('[data-ci="1"] [data-act="compDel"]');
  assert.deepStrictEqual(clone(a.A.state.rules.composition),[original]);
});
for(const state of ['hard','soft'])test(`${state}: off/on retains exact inactive flag`,async a => {
  const r = await fixture(a,{state,active:false}), before = semantics(a);
  a.change('[data-ron="composition"]',false); assert.equal(a.q('[data-cdays]'),null);
  editYears(a); assert.deepStrictEqual(clone(a.A.state.rules.composition),r.composition);
  a.change('[data-ron="composition"]',true); assert.equal(a.q('[data-cdays]').value,'flag:'+exactId);
  // Turning on a disabled built-in selects its documented first non-off state, hard.
  assert.deepStrictEqual(clone(a.A.state.rules.composition),r.composition);
  assert.deepStrictEqual(semantics(a).scope,before.scope);
  await reload(a,b => assert.deepStrictEqual(clone(b.A.state.rules.composition),r.composition));
});
test('non-flag unknown day retains the existing all-days normalization',async a => {
  await fixture(a,{days:'synthetic.unknown'}); const before = semantics(a);
  assert.equal(a.q('[data-cdays]').value,'all'); editYears(a);
  assert.equal(a.A.state.rules.composition[0].days,undefined); assert.deepStrictEqual(semantics(a),before);
});
test('a space-only nonempty flag ID remains exact and inactive',async a => {
  await fixture(a,{active:false,days:'flag: '}); const before = semantics(a);
  assert.deepStrictEqual(before.scope,[]); editYears(a);
  assert.equal(a.A.state.rules.composition[0].days,'flag: '); assert.deepStrictEqual(semantics(a),before);
  await reload(a,b => {assert.equal(b.A.state.rules.composition[0].days,'flag: ');assert.deepStrictEqual(semantics(b),before);});
});
test('malformed object day retains baseline all-days behavior',async a => {
  await fixture(a,{days:{}}); const before = semantics(a); editYears(a);
  assert.equal(a.A.state.rules.composition[0].days,undefined); assert.deepStrictEqual(semantics(a),before);
});
(async () => {
  assert.equal(cases.length,EXPECTED_CASES);
  for (const c of cases) {
    const a = await makeApp();
    try { await c.fn(a); assert.deepStrictEqual(a.errors,[]); passed++; console.log('PASS '+c.name); }
    catch(e) { failed++; console.error('FAIL '+c.name,e); }
    finally { a.w.close(); }
  }
  assert.equal(passed+failed,EXPECTED_CASES); finished=true; clearTimeout(watchdog);
  console.log(`composition day selector preservation: ${passed} passed, ${failed} failed, ${cases.length} total`);
  if(failed)process.exitCode=1;
})().catch(e => {console.error(e);process.exitCode=1;});

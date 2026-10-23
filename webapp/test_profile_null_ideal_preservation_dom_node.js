// Static-authored candidate. Runtime and syntax checks were NOT RUN during preparation.
// Actual profile-file import, markup, delegated events, Problem/checker, export and storage.
// Fictional data only. jsdom 26.1.0; no native browser, layout, OS or network coverage.
// TOBAN_DOM_MODULE=/installed/node_modules/jsdom node test_profile_null_ideal_preservation_dom_node.js
const fs = require('fs'), path = require('path'), assert = require('assert');
// Dependency lookup never downloads or installs packages.
let JSDOM;
for (const name of [process.env.TOBAN_DOM_MODULE, 'jsdom', path.join(process.env.HOME || '', '.toban-test/node_modules/jsdom')].filter(Boolean)) {
  try { ({ JSDOM } = require(name)); break; } catch (e) { if (e.code !== 'MODULE_NOT_FOUND') throw e; }
}
if (!JSDOM) throw new Error('Profile null-ideal DOM-adapter regression requires jsdom 26.1.0. Set TOBAN_DOM_MODULE to its installed module path. This test was NOT run.');
const N = ['Synthetic Trainer', 'Synthetic Colleague'], clone = x => JSON.parse(JSON.stringify(x));
const root = process.env.TOBAN_SOURCE_ROOT || __dirname;
const source = f => fs.readFileSync(f === 'app-settings.js' && process.env.TOBAN_SETTINGS_SOURCE || path.join(root, 'src', f), 'utf8');
const scripts = ['i18n.js','rules-core.js','model.js', ...fs.readdirSync(path.join(root,'src/calendars')).filter(f=>f.endsWith('.js')).sort().map(f=>'calendars/'+f),
  'messages.js','solver.js','check.js','report.js','docxgen.js','plugins.js','merge.js', ...fs.readdirSync(path.join(root,'src/rules')).filter(f=>f.endsWith('.js')).sort().map(f=>'rules/'+f),
  'app-core.js','app-folder.js','app-month.js','app-input.js','app-settings.js','app-solve.js','app-main.js'];
const key = 'toban_state_v2:/synthetic/profile-null-ideal-preservation.html';
const rawRules = {profile:{id:'synthetic-profile-null-ideal-preservation',roles:[{id:'S',label:'Staff',refs:[]}],shifts:[{id:'day',label:'Day',on:'all'},{id:'night',label:'Night',on:'all'}]},doctors:N.map(name=>({name,team:'S',quota:15})),rule_states:{oncall:'off'},weights:{}};
const rawMonth = {year:2026,month:11,notes:'Synthetic settings builder roundtrip'};
async function makeApp(saved, fixture=rawRules, defaults=fixture) {
  const dom = new JSDOM(source('index.html'), {url:'https://example.invalid/synthetic/profile-null-ideal-preservation.html',runScripts:'outside-only'}), w=dom.window;
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

const cases = [], test = (name, work, fn) => cases.push({ name, work, fn });
const problem = a => new a.w.T.Problem(a.A.state.rules, a.A.state.month);
const work = a => a.A.state.rules.profile.positions.work;
const semantics = a => { const p = problem(a); return clone(p.slots.map(s => [s, p.countOf(s), p.countMinOf(s), p.countIdealOf(s)])); };
const score = a => { const p = problem(a), asg = Object.fromEntries(p.slots.map(s => [s.join(':'), { work: N.slice(), oc: [] }])); return a.w.T.penalty(p, asg).total; };
async function until(a, fn, label) { for (let i = 0; i < 100; i++) { if (fn()) return; await a.tick(); } throw new Error('Timed out: ' + label); }
async function fixture(value) {
  const a = await makeApp(); a.enter(); a.A.readSettings(); const R = clone(a.A.state.rules);
  R.profile.label = 'Synthetic null-ideal import'; R.profile.positions = { work: { ...clone(value), local_work: { keep: 'Synthetic work metadata' } }, local_position: { keep: 'Synthetic position metadata' } };
  R.rule_states.count_target = 'soft'; R.weights.count_deviation = 7;
  const el = a.q('#fileLoadProfile'); Object.defineProperty(el, 'files', { configurable: true, value: [{ name: 'synthetic-null-ideal.json', text: async () => JSON.stringify(R) }] });
  el.dispatchEvent(new a.w.Event('change', { bubbles: true }));
  await until(a, () => a.A.switching === 0 && a.A.state.rules.profile.label === R.profile.label, 'profile import');
  assert.deepStrictEqual(clone(work(a)), R.profile.positions.work, 'import is accepted without normalizing away null'); a.enter(); return a;
}
async function exported(a) {
  const downloads = []; a.A.download = (name, blob) => downloads.push({ name, blob }); a.q('#setExportRoster').checked = true; a.click('#btnExportProfile');
  await until(a, () => downloads.length, 'included-roster export'); assert.equal(downloads.length, 1);
  return JSON.parse(await new Promise((resolve, reject) => { const r = new a.w.FileReader(); r.onload = () => resolve(r.result); r.onerror = reject; r.readAsText(downloads[0].blob); }));
}
async function persisted(a) {
  const expected = semantics(a), expectedScore = score(a), out = await exported(a), p = new a.w.T.Problem(out, clone(a.A.state.month));
  assert.deepStrictEqual(clone(p.slots.map(s => [s, p.countOf(s), p.countMinOf(s), p.countIdealOf(s)])), expected, 'export retains ideals');
  assert.deepStrictEqual(out.profile.positions.work.local_work, { keep: 'Synthetic work metadata' });
  assert.deepStrictEqual(out.profile.positions.local_position, { keep: 'Synthetic position metadata' });
  const saved = a.w.localStorage.getItem(key); assert(saved); const b = await makeApp(saved, a.A.state.rules);
  try { b.enter(); b.A.readSettings(); b.A.readSettings(); assert.deepStrictEqual(semantics(b), expected, 'reload retains ideals'); assert.equal(score(b), expectedScore); assert.deepStrictEqual(b.errors, []); }
  finally { b.w.close(); }
  return out;
}
function dayIdeal(a, expected) { const p = problem(a); for (const s of p.slots.filter(s => s[1] === 'day')) assert.strictEqual(p.countIdealOf(s), expected); }
for (const [name, ideal] of [['day only', { day: null }], ['both shifts', { day: null, night: null }], ['numeric sibling', { day: null, night: 2 }]]) {
  for (const edit of ['label', 'night count', 'night ideal']) test(name + ': unrelated or sibling ' + edit + ' preserves null day target', { count: 3, min: 0, ideal }, async a => {
    dayIdeal(a, 1); assert.equal(a.q('[data-countideal="day"]').value, ''); const before = semantics(a), beforeScore = score(a);
    if (edit === 'label') a.change('#setProfLabel', 'Synthetic renamed profile');
    if (edit === 'night count') a.change('[data-count="night"]', '2');
    if (edit === 'night ideal') a.change('[data-countideal="night"]', '0');
    assert.strictEqual(work(a).ideal.day, null); dayIdeal(a, 1); a.A.readSettings(); a.A.readSettings(); assert.strictEqual(work(a).ideal.day, null); dayIdeal(a, 1);
    if (edit === 'label') { assert.deepStrictEqual(semantics(a), before); assert.equal(score(a), beforeScore, 'unrelated edit must not remove count-target penalties'); }
    await persisted(a);
  });
}
for (const [name, value] of [['absent', { count: 3, min: 0 }], ['top-level null', { count: 3, min: 0, ideal: null }], ['empty object', { count: 3, min: 0, ideal: {} }]]) test(name + ' does not acquire an ideal', value, async a => {
  const before = semantics(a); dayIdeal(a, null); a.change('#setProfLabel', 'Synthetic no-ideal control'); a.A.readSettings(); assert.deepStrictEqual(semantics(a), before); dayIdeal(a, null); await persisted(a);
});
test('numeric zero stays a real target', { count: 3, min: 0, ideal: { day: 0 } }, async a => {
  dayIdeal(a, 0); const before = score(a); a.change('#setProfLabel', 'Synthetic zero target'); dayIdeal(a, 0); assert.equal(score(a), before); await persisted(a);
});
for (const [value, expected] of [['', null], ['0', 0], ['2e0', 2]]) test('explicit ideal edit ' + JSON.stringify(value) + ' replaces only its null branch', { count: 3, min: 0, ideal: { day: null, night: 2 } }, async a => {
  a.change('[data-countideal="day"]', value); dayIdeal(a, expected); assert.strictEqual(work(a).ideal.night, 2);
  if (expected === null) assert(!Object.hasOwn(work(a).ideal, 'day')); else assert.strictEqual(work(a).ideal.day, expected);
  a.A.readSettings(); dayIdeal(a, expected); await persisted(a);
});
test('type then erase back to blank commits on focusout', { count: 3, min: 0, ideal: { day: null } }, async a => {
  const input = a.q('[data-countideal="day"]'); input.value = '2'; input.dispatchEvent(new a.w.Event('input', { bubbles: true })); input.value = ''; input.dispatchEvent(new a.w.Event('input', { bubbles: true }));
  input.dispatchEvent(new a.w.Event('focusout', { bubbles: true })); dayIdeal(a, null); assert.strictEqual(work(a).ideal, undefined); assert.strictEqual(input.dataset.idealEdited, undefined);
  a.A.readSettings(); dayIdeal(a, null); await persisted(a);
});
test('input-only same-empty clear is committed before export', { count: 3, min: 0, ideal: { day: null, night: null } }, async a => {
  const input = a.q('[data-countideal="day"]'); input.value = '2'; input.dispatchEvent(new a.w.Event('input', { bubbles: true })); input.value = ''; input.dispatchEvent(new a.w.Event('input', { bubbles: true }));
  const out = await exported(a); assert.deepStrictEqual(out.profile.positions.work.ideal, { night: null }); dayIdeal(a, null); await persisted(a);
});
test('explicit clear can be undone to the accepted null target', { count: 3, min: 0, ideal: { day: null } }, async a => {
  const before = score(a); a.A.clearUndo(); a.change('[data-countideal="day"]', ''); dayIdeal(a, null); assert.strictEqual(work(a).ideal, undefined);
  a.A.undo(); assert.strictEqual(work(a).ideal.day, null); dayIdeal(a, 1); assert.equal(score(a), before); assert(a.q('#btnUndo').disabled); await persisted(a);
});
test('explicit clear beside a numeric sibling can be undone after the undo record settles', { count: 3, min: 0, ideal: { day: null, night: 2 } }, async a => {
  // A real click reaches undo() only after pushUndo's queued microtask has recorded the "after" state. With a numeric
  // sibling the cleared and uncleared objects must still differ in the rules signature, or the record is skipped as unchanged.
  a.A.readSettings(); a.A.renderSettings(); a.A.readSettings(); // settled: later readbacks add nothing, so only the cleared branch distinguishes the two states
  const before = score(a); a.A.clearUndo(); a.change('[data-countideal="day"]', ''); dayIdeal(a, null); assert.equal(JSON.stringify(work(a).ideal), JSON.stringify({ night: 2 }));
  await new Promise(resolve => setTimeout(resolve, 0)); assert(!a.q('#btnUndo').disabled, 'the clearing stays recorded as a change');
  a.A.undo(); assert.strictEqual(work(a).ideal.day, null); assert.strictEqual(work(a).ideal.night, 2); assert.equal(a.q('[data-countideal="day"]').value, ''); dayIdeal(a, 1); assert.equal(score(a), before); assert(a.q('#btnUndo').disabled); await persisted(a);
});
test('null day keeps precedence over day-type defaults', { count: 3, min: 0, ideal: { day: null, weekday: 2, off_days: 3 } }, async a => {
  const before = semantics(a), beforeScore = score(a); dayIdeal(a, 1); assert(a.q('[data-countkeep="countideal:night"]'));
  a.change('#setProfLabel', 'Synthetic mixed fallback'); assert.strictEqual(work(a).ideal.day, null); assert.deepStrictEqual(semantics(a), before); assert.equal(score(a), beforeScore); await persisted(a);
});
test('nested day-type null remains read-only and structurally preserved', { count: 3, min: 0, ideal: { day: { weekday: null, off_days: 2 }, night: 0 } }, async a => {
  const before = semantics(a), raw = clone(work(a).ideal.day); assert(a.q('[data-countkeep="countideal:day"]')); a.change('[data-countideal="night"]', '1');
  assert.deepStrictEqual(clone(work(a).ideal.day), raw); assert.deepStrictEqual(semantics(a).filter(row => row[0][1] === 'day'), before.filter(row => row[0][1] === 'day')); await persisted(a);
});
test('unknown shift null does not create a day or night objective', { count: 3, min: 0, ideal: { future_shift: null } }, async a => {
  const before = semantics(a); a.change('#setProfLabel', 'Synthetic unknown shift control'); a.A.readSettings(); assert.deepStrictEqual(semantics(a), before); dayIdeal(a, null); await persisted(a);
});
const EXPECTED_CASES = 23; let started = 0, completed = 0, passed = 0, failed = 0, finished = false;
const watchdog = setTimeout(() => { console.error('Null ideal regression timed out'); process.exit(1); }, 180000);
process.on('exit', () => { if (!finished || cases.length !== EXPECTED_CASES || started !== EXPECTED_CASES || completed !== EXPECTED_CASES || passed !== EXPECTED_CASES || failed) { console.error(`Incomplete null-ideal regression: registered=${cases.length}, started=${started}, completed=${completed}, passed=${passed}, failed=${failed}, expected=${EXPECTED_CASES}`); process.exitCode = 1; } });
(async () => { assert.equal(cases.length, EXPECTED_CASES); for (const c of cases) { started++; let a; try { a = await fixture(c.work); await c.fn(a); assert.deepStrictEqual(a.errors, []); passed++; console.log('PASS ' + c.name); } catch (e) { failed++; console.error('FAIL ' + c.name, e); } finally { if (a) a.w.close(); completed++; } }
  finished = true; clearTimeout(watchdog); console.log(`null ideal: registered=${cases.length}, started=${started}, completed=${completed}, passed=${passed}, failed=${failed}`); if (failed) process.exitCode = 1;
})().catch(e => { clearTimeout(watchdog); console.error(e); process.exitCode = 1; });

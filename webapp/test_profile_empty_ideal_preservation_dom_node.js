// Imported empty ideals retain their raw value until that shift is explicitly edited.
// Real app markup, delegated events, Problem, export and browser storage in jsdom.
// Synthetic data only; no OS folder picker, real browser, network or package installation.
const fs = require('fs'), path = require('path'), assert = require('assert');
// Dependency lookup never downloads or installs packages.
let JSDOM;
for (const name of [process.env.TOBAN_DOM_MODULE, 'jsdom', path.join(process.env.HOME || '', '.toban-test/node_modules/jsdom')].filter(Boolean)) {
  try { ({ JSDOM } = require(name)); break; } catch (e) { if (e.code !== 'MODULE_NOT_FOUND') throw e; }
}
if (!JSDOM) throw new Error('Profile empty-ideal DOM-adapter regression requires jsdom 26.1.0. Set TOBAN_DOM_MODULE to its installed module path. This test was NOT run.');
const N = ['Synthetic Trainer', 'Synthetic Colleague'], clone = x => JSON.parse(JSON.stringify(x));
const root = process.env.TOBAN_SOURCE_ROOT || __dirname;
const source = f => fs.readFileSync(f === 'app-settings.js' && process.env.TOBAN_SETTINGS_SOURCE || path.join(root, 'src', f), 'utf8');
const scripts = ['i18n.js','rules-core.js','model.js', ...fs.readdirSync(path.join(root,'src/calendars')).filter(f=>f.endsWith('.js')).sort().map(f=>'calendars/'+f),
  'messages.js','solver.js','check.js','report.js','docxgen.js','plugins.js','merge.js', ...fs.readdirSync(path.join(root,'src/rules')).filter(f=>f.endsWith('.js')).sort().map(f=>'rules/'+f),
  'app-core.js','app-folder.js','app-month.js','app-input.js','app-settings.js','app-solve.js','app-main.js'];
const key = 'toban_state_v2:/synthetic/profile-empty-ideal-preservation.html';
const rawRules = {profile:{id:'synthetic-profile-empty-ideal-preservation',roles:[{id:'S',label:'Staff',refs:[]}],shifts:[{id:'day',label:'Day',on:'all'},{id:'night',label:'Night',on:'all'}]},doctors:N.map(name=>({name,team:'S',quota:15})),rule_states:{oncall:'off'},weights:{}};
const rawMonth = {year:2026,month:11,notes:'Synthetic settings builder roundtrip'};
async function makeApp(saved, fixture=rawRules, defaults=fixture) {
  const dom = new JSDOM(source('index.html'), {url:'https://example.invalid/synthetic/profile-empty-ideal-preservation.html',runScripts:'outside-only'}), w=dom.window;
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
async function until(a, fn, label) { for (let i = 0; i < 100; i++) { if (fn()) return; await a.tick(); } throw new Error('Timed out: ' + label); }
async function fixture(value) {
  const a = await makeApp(); a.enter(); a.A.readSettings(); const R = clone(a.A.state.rules);
  R.profile.label = 'Synthetic empty-ideal import'; R.profile.positions = { work: { ...clone(value), local_work: { keep: 'Synthetic work metadata' } }, local_position: { keep: 'Synthetic position metadata' } };
  R.rule_states.count_target = 'soft'; R.weights.count_deviation = 7;
  const el = a.q('#fileLoadProfile'); Object.defineProperty(el, 'files', { configurable: true, value: [{ name: 'synthetic-empty-ideal.json', text: async () => JSON.stringify(R) }] });
  el.dispatchEvent(new a.w.Event('change', { bubbles: true }));
  await until(a, () => a.A.switching === 0 && a.A.state.rules.profile.label === R.profile.label, 'profile import');
  assert.deepStrictEqual(clone(work(a)), R.profile.positions.work, 'import retains the accepted raw staffing values'); a.enter(); return a;
}
async function exported(a) {
  const downloads = []; a.A.download = (name, blob) => downloads.push({ name, blob }); a.q('#setExportRoster').checked = true; a.click('#btnExportProfile');
  await until(a, () => downloads.length, 'included-roster export'); assert.equal(downloads.length, 1);
  return JSON.parse(await new Promise((resolve, reject) => { const r = new a.w.FileReader(); r.onload = () => resolve(r.result); r.onerror = reject; r.readAsText(downloads[0].blob); }));
}
const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const shape = a => ({ present: own(work(a), 'ideal'), ...(own(work(a), 'ideal') ? { value: clone(work(a).ideal) } : {}) });
const rawShape = value => value === undefined ? { present: false } : { present: true, value };
function idealAt(a, shift) { return problem(a).countIdealOf([1, shift]); }
function assertIdeals(a, expected, semantic) {
  assert.deepStrictEqual(shape(a), rawShape(expected), 'preserve the owned raw ideal');
  for (const k of ['day', 'night']) assert.strictEqual(idealAt(a, k), semantic[k], k + ' target in the real model');
}
function assertReset(a) {
  for (const x of a.w.document.querySelectorAll('#shiftTbl input[data-countideal]')) {
    assert.strictEqual(x.dataset.idealEdited, undefined, 'committed/recreated input has no stale edit flag');
    assert.strictEqual(x.getAttribute('value'), x.value, 'display baseline is reset');
  }
}
async function preserved(a, expected, semantic) {
  assertIdeals(a, expected, semantic); a.A.readSettings(); a.A.readSettings(); assertIdeals(a, expected, semantic); assertReset(a);
  const out = await exported(a); assert.deepStrictEqual({ present: own(out.profile.positions.work, 'ideal'), ...(own(out.profile.positions.work, 'ideal') ? { value: out.profile.positions.work.ideal } : {}) }, rawShape(expected), 'export retains raw ideal');
  const before = semantics(a), saved = a.w.localStorage.getItem(key), b = await makeApp(saved, a.A.state.rules);
  try { b.enter(); b.A.readSettings(); b.A.readSettings(); assertIdeals(b, expected, semantic); assert.deepStrictEqual(semantics(b), before); assertReset(b); assert.deepStrictEqual(b.errors, []); }
  finally { b.w.close(); }
  assert.deepStrictEqual(out.profile.positions.work.local_work, { keep: 'Synthetic work metadata' });
  assert.deepStrictEqual(out.profile.positions.local_position, { keep: 'Synthetic position metadata' });
}
function inputClear(a, shift, finish) {
  const x = a.q(`[data-countideal="${shift}"]`); assert(x);
  x.value = '2'; x.dispatchEvent(new a.w.Event('input', { bubbles: true }));
  x.value = ''; x.dispatchEvent(new a.w.Event('input', { bubbles: true }));
  if (finish) x.dispatchEvent(new a.w.Event('focusout', { bubbles: true }));
  return x;
}
const rootEmpty = { count: 3, min: 0, ideal: '' };
for (const edit of ['readback', 'label', 'day count', 'night count', 'day min', 'night min']) test('root empty string survives unrelated ' + edit, rootEmpty, async a => {
  assertIdeals(a, '', { day: 1, night: 1 });
  if (edit === 'readback') a.A.readSettings();
  else if (edit === 'label') a.change('#setProfLabel', 'Synthetic unrelated label');
  else { const [k, field] = edit.split(' '); a.change(`[data-${field === 'min' ? 'countmin' : 'count'}="${k}"]`, field === 'min' ? '1' : '4'); }
  await preserved(a, '', { day: 1, night: 1 });
});
for (const k of ['day', 'night']) for (const mode of ['zero', 'number', 'change-clear', 'input-focusout-clear']) test('root empty string: ' + k + ' ' + mode + ' owns only that shift', rootEmpty, async a => {
  const other = k === 'day' ? 'night' : 'day', clear = mode.includes('clear'), value = mode === 'zero' ? 0 : 2;
  if (mode === 'input-focusout-clear') inputClear(a, k, true); else a.change(`[data-countideal="${k}"]`, clear ? '' : String(value));
  const expected = { [other]: '' }; if (!clear) expected[k] = value;
  await preserved(a, expected, { [k]: clear ? null : value, [other]: 1 });
});
for (const first of ['day', 'night']) test('clear both shifts in order starting ' + first, rootEmpty, async a => {
  const second = first === 'day' ? 'night' : 'day'; a.change(`[data-countideal="${first}"]`, '');
  assertIdeals(a, { [second]: '' }, { [first]: null, [second]: 1 });
  a.change(`[data-countideal="${second}"]`, ''); await preserved(a, undefined, { day: null, night: null });
});
for (const k of ['day', 'night']) test('settled Undo restores root raw empty string after ' + k + ' clear', rootEmpty, async a => {
  a.A.readSettings(); a.A.renderSettings(); a.A.readSettings(); a.A.clearUndo();
  const before = semantics(a), beforeSig = a.A.rulesSig(a.A.state.rules);
  a.change(`[data-countideal="${k}"]`, ''); await a.tick(); assert(!a.q('#btnUndo').disabled);
  a.A.undo(); assertIdeals(a, '', { day: 1, night: 1 }); assert.deepStrictEqual(semantics(a), before); assert.strictEqual(a.A.rulesSig(a.A.state.rules), beforeSig);
  assertReset(a); await preserved(a, '', { day: 1, night: 1 });
});
for (const k of ['day', 'night']) test('input-only ' + k + ' clear commits before export', rootEmpty, async a => {
  const other = k === 'day' ? 'night' : 'day'; inputClear(a, k, false); const out = await exported(a);
  assert.deepStrictEqual(out.profile.positions.work.ideal, { [other]: '' });
  await preserved(a, { [other]: '' }, { [k]: null, [other]: 1 });
});
for (const [label, value] of [['absent', undefined], ['null', null], ['empty object', {}], ['empty array', []]]) for (const action of ['unrelated', 'day edit', 'day clear']) test('root ' + label + ': ' + action + ' retains no-ideal semantics', { count: 3, min: 0, ...(value === undefined ? {} : { ideal: value }) }, async a => {
  assertIdeals(a, value, { day: null, night: null });
  if (action === 'unrelated') { a.change('#setProfLabel', 'Synthetic no-ideal label'); await preserved(a, value, { day: null, night: null }); }
  else if (action === 'day edit') { a.change('[data-countideal="day"]', '2'); await preserved(a, { day: 2 }, { day: 2, night: null }); }
  else { a.change('[data-countideal="day"]', ''); await preserved(a, undefined, { day: null, night: null }); }
});
for (const [label, value, night] of [['empty sibling', { day: '', night: '' }, 1], ['null sibling', { day: '', night: null }, 1], ['numeric sibling', { day: '', night: 2 }, 2]]) for (const action of ['label', 'night edit']) test('direct empty branch with ' + label + ': ' + action, { count: 3, min: 0, ideal: value }, async a => {
  if (action === 'label') { a.change('#setProfLabel', 'Synthetic direct branch'); await preserved(a, value, { day: 1, night }); }
  else { a.change('[data-countideal="night"]', '0'); await preserved(a, { day: '', night: 0 }, { day: 1, night: 0 }); }
});
test('numeric scalar sibling survives a single shift clear', { count: 3, min: 0, ideal: 2 }, async a => {
  a.change('[data-countideal="day"]', ''); await preserved(a, { night: 2 }, { day: null, night: 2 });
});
test('read-only day-type sibling survives a direct empty branch clear', { count: 3, min: 0, ideal: { day: '', night: { weekday: 2, off_days: 3 } } }, async a => {
  assert(a.q('[data-countkeep="countideal:night"]')); a.change('[data-countideal="day"]', '');
  await preserved(a, { night: { weekday: 2, off_days: 3 } }, { day: null, night: 3 });
});
test('new JSON import resets prior same-empty edit flags', rootEmpty, async a => {
  inputClear(a, 'day', false);
  const imported = clone(a.A.state.rules); imported.profile.positions.work.ideal = '';
  a.q('#rulesJson').value = JSON.stringify(imported); a.click('#btnApplyRules');
  await until(a, () => a.A.switching === 0, 'JSON apply'); assertReset(a); await preserved(a, '', { day: 1, night: 1 });
});
test('partial edit reload can clear the remaining inherited ideal', rootEmpty, async a => {
  a.change('[data-countideal="day"]', '2'); a.A.save(); const b = await makeApp(a.w.localStorage.getItem(key), a.A.state.rules);
  try { b.enter(); assertReset(b); b.change('[data-countideal="night"]', ''); await preserved(b, { day: 2 }, { day: 2, night: null }); assert.deepStrictEqual(b.errors, []); }
  finally { b.w.close(); }
});
for (const k of ['day', 'night']) for (const raw of [[], {}]) test('untouched ' + k + ' container ' + JSON.stringify(raw) + ' survives sibling edit', { count: 3, min: 0, ideal: { [k]: raw, [k === 'day' ? 'night' : 'day']: 2 } }, async a => {
  const other = k === 'day' ? 'night' : 'day'; assert(a.q(`[data-countkeep="countideal:${k}"]`));
  a.change(`[data-countideal="${other}"]`, '0'); await preserved(a, { [k]: raw, [other]: 0 }, { [k]: 1, [other]: 0 });
});
for (const k of ['day', 'night']) for (const form of ['root', 'branch']) test('untouched ' + k + ' ' + form + ' numeric ideal exceeds count without raw loss', { count: 2, min: 0, ideal: form === 'root' ? 5 : { [k]: 5, [k === 'day' ? 'night' : 'day']: 1 } }, async a => {
  const other = k === 'day' ? 'night' : 'day'; assert.strictEqual(idealAt(a, k), 2, 'model clamps without changing raw');
  a.change(`[data-countideal="${other}"]`, '0'); assertIdeals(a, { [k]: 5, [other]: 0 }, { [k]: 2, [other]: 0 });
  a.change(`[data-count="${k}"]`, '6'); await preserved(a, { [k]: 5, [other]: 0 }, { [k]: 5, [other]: 0 });
});
const EXPECTED_CASES = 50; let started = 0, completed = 0, passed = 0, failed = 0, finished = false;
const unhandled = []; process.on('unhandledRejection', e => unhandled.push(String(e && e.stack || e)));
const watchdog = setTimeout(() => { console.error('Empty ideal regression timed out'); process.exit(1); }, 180000);
process.on('exit', () => { if (!finished || cases.length !== EXPECTED_CASES || started !== EXPECTED_CASES || completed !== EXPECTED_CASES || passed !== EXPECTED_CASES || failed) { console.error(`Incomplete empty-ideal regression: registered=${cases.length}, started=${started}, completed=${completed}, passed=${passed}, failed=${failed}, expected=${EXPECTED_CASES}`); process.exitCode = 1; } });
(async () => {
  assert.equal(cases.length, EXPECTED_CASES); assert.equal(new Set(cases.map(c => c.name)).size, EXPECTED_CASES);
  for (const c of cases) console.log('REGISTER ' + c.name);
  for (const c of cases) { started++; console.log('START ' + c.name); let a; unhandled.length = 0;
    try { a = await fixture(c.work); await c.fn(a); await a.tick(); assert.deepStrictEqual(a.errors, []); assert.deepStrictEqual(unhandled, []); passed++; console.log('PASS ' + c.name); }
    catch (e) { failed++; console.error('FAIL ' + c.name, e); }
    finally { if (a) a.w.close(); completed++; console.log('COMPLETE ' + c.name); }
  }
  finished = true; clearTimeout(watchdog); console.log(`empty ideal: registered=${cases.length}, started=${started}, completed=${completed}, passed=${passed}, failed=${failed}`); if (failed) process.exitCode = 1;
})().catch(e => { clearTimeout(watchdog); console.error(e); process.exitCode = 1; });

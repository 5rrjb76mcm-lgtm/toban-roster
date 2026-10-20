// Static-authored regression candidate. Run locally; no execution was performed
// while preparing this patch. Fictional data only; jsdom is a DOM adapter, not browser QA.
// TOBAN_DOM_MODULE=/installed/node_modules/jsdom node test_weight_readback_preservation_dom_node.js
const fs = require('fs'), path = require('path'), assert = require('assert/strict');
let JSDOM;
for (const name of [process.env.TOBAN_DOM_MODULE, 'jsdom', path.join(process.env.HOME || '', '.toban-test/node_modules/jsdom')].filter(Boolean)) {
  try { ({ JSDOM } = require(name)); break; } catch (e) { if (e.code !== 'MODULE_NOT_FOUND') throw e; }
}
if (!JSDOM) throw new Error('Weight readback regression requires installed jsdom. This test was NOT run.');
const root = process.env.TOBAN_SOURCE_ROOT || __dirname, source = f => fs.readFileSync(path.join(root, 'src', f), 'utf8');
const clone = x => JSON.parse(JSON.stringify(x));
const scripts = ['i18n.js', 'rules-core.js', 'model.js', ...fs.readdirSync(path.join(root, 'src/calendars')).filter(f => f.endsWith('.js')).sort().map(f => 'calendars/' + f),
  'messages.js', 'solver.js', 'check.js', 'report.js', 'docxgen.js', 'plugins.js', 'merge.js', ...fs.readdirSync(path.join(root, 'src/rules')).filter(f => f.endsWith('.js')).sort().map(f => 'rules/' + f),
  'app-core.js', 'app-folder.js', 'app-month.js', 'app-input.js', 'app-settings.js', 'app-solve.js', 'app-main.js'];
const key = 'toban_state_v2:/synthetic/weight-readback.html';
const rawRules = { profile: { id: 'synthetic-weight-readback', roles: [{ id: 'S', label: 'Staff', refs: [] }], shifts: [{ id: 'day', on: 'all' }, { id: 'night', on: 'all' }] },
  doctors: ['Synthetic One', 'Synthetic Two'].map(name => ({ name, team: 'S', quota: 30 })), rule_states: { oncall: 'off' }, weights: {} };
const rawMonth = { year: 2026, month: 11 };
const tick = () => new Promise(resolve => setImmediate(resolve));
async function until(fn, label) { const end = Date.now() + 7000; while (!fn()) { if (Date.now() > end) throw new Error('Timed out: ' + label); await tick(); } }
async function makeApp(saved) {
  const dom = new JSDOM(source('index.html'), { url: 'https://example.invalid/synthetic/weight-readback.html', runScripts: 'outside-only' }), w = dom.window;
  await new Promise(resolve => w.document.readyState === 'complete' ? resolve() : w.addEventListener('load', resolve, { once: true }));
  const errors = [], alerts = [];
  w.addEventListener('error', e => { errors.push(String(e.error || e.message)); e.preventDefault(); });
  w.confirm = () => true; w.alert = text => alerts.push(String(text)); w.prompt = () => null;
  w.T = { DEFAULT_RULES: clone(rawRules), SAMPLE_MONTH: clone(rawMonth), PROFILES: [], LANGS_DATA: ['en', 'ja'].map(code => JSON.parse(fs.readFileSync(path.join(root, 'lang', code + '.json'), 'utf8'))) };
  for (const f of scripts) w.eval(source(f) + '\n//# sourceURL=' + f);
  const A = w.T.app; A.restoreFolder = () => {}; A.toast = () => {};
  const initial = clone(rawRules); w.T.fillDefaultRules(initial);
  for (const def of w.T.RULE_DEFS) if (def.states.includes('off')) initial.rule_states[def.id] = 'off';
  w.T.fillDefaultRules(initial); w.localStorage.setItem('toban.lang', 'en');
  w.localStorage.setItem(key, saved || JSON.stringify({ rules: initial, month: rawMonth, result: null, ui: { doctor: 1 } }));
  w.T.init();
  const q = s => w.document.querySelector(s), click = s => { assert(q(s), 'Missing ' + s); q(s).click(); };
  const change = (s, value) => { const el = q(s); assert(el, 'Missing ' + s); if (el.type === 'checkbox') el.checked = value; else el.value = value; el.dispatchEvent(new w.Event('change', { bubbles: true })); };
  const mode = value => { click('.tab[data-tab="settings"]'); click(`[data-setmode="${value}"]`); };
  return { dom, w, A, q, click, change, mode, errors, alerts };
}
const specs = [
  { key: 'target_deviation', rule: 'quota_target', selector: '[data-rsw="target_deviation"]' },
  { key: 'dayoff_work_no_reduction', rule: 'dayoff_work_cap', selector: '[data-rsw="dayoff_work_no_reduction"]' },
  { key: 'fixed_conflict', selector: '[data-w="fixed_conflict"]' },
];
async function imported(a, spec, value, viaJson = false) {
  a.mode('build'); const R = clone(a.A.state.rules);
  R.profile.label = 'Synthetic imported weight'; if (spec.rule) R.rule_states[spec.rule] = 'soft'; R.weights[spec.key] = clone(value);
  if (viaJson) { a.q('#rulesJson').value = JSON.stringify(R); a.click('#btnApplyRules'); }
  else { const el = a.q('#fileLoadProfile'); Object.defineProperty(el, 'files', { configurable: true, value: [{ name: 'synthetic.json', text: async () => JSON.stringify(R) }] }); el.dispatchEvent(new a.w.Event('change', { bubbles: true })); }
  await until(() => a.alerts.length || a.A.switching === 0 && a.A.state.rules.profile.label === R.profile.label, 'weight import');
  assert.deepEqual(a.alerts, []); assert.deepEqual(clone(a.A.state.rules.weights[spec.key]), value); a.mode('daily'); assert(a.q(spec.selector));
}
const problem = a => new a.w.T.Problem(a.A.state.rules, a.A.state.month);
async function reload(a, fn) { const b = await makeApp(a.w.localStorage.getItem(key)); try { await fn(b); assert.deepEqual(b.errors, []); assert.deepEqual(b.alerts, []); } finally { b.w.close(); } }
async function exported(a) {
  const downloads = []; a.A.download = (name, blob) => downloads.push({ name, blob }); a.mode('build'); a.q('#setExportRoster').checked = true; a.click('#btnExportProfile');
  await until(() => downloads.length || a.alerts.length, 'included-roster export'); assert.deepEqual(a.alerts, []); assert.equal(downloads.length, 1);
  return JSON.parse(await new Promise((resolve, reject) => { const r = new a.w.FileReader(); r.onload = () => resolve(r.result); r.onerror = reject; r.readAsText(downloads[0].blob); }));
}
const cases = [], test = (name, fn) => cases.push({ name, fn });
for (const spec of specs) {
  for (const value of [[2], ['2'], [[2]], [], {}, false, 'bad', ' 2 ', '+2', '2e0', 0, 0.5]) test(spec.key + ' preserves ' + JSON.stringify(value) + ' across unrelated readback/reload', async a => {
    await imported(a, spec, value); const valid = typeof value === 'number' || typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value));
    const assertMeaning = b => valid ? assert.equal(problem(b).weights[spec.key], Number(value)) : assert.throws(() => problem(b), new RegExp('weights\\.' + spec.key));
    assertMeaning(a); a.change('#doctorTable tr[data-i="0"] [data-f="years"]', '12'); a.A.readSettings(); a.A.readSettings();
    assert.deepEqual(clone(a.A.state.rules.weights[spec.key]), value); assertMeaning(a);
    assert.deepEqual(JSON.parse(a.w.localStorage.getItem(key)).rules.weights[spec.key], value);
    await reload(a, b => { assert.deepEqual(clone(b.A.state.rules.weights[spec.key]), value); assertMeaning(b); });
  });
  for (const flow of ['change', 'input-focusout-change']) test(spec.key + ' explicit same-visible correction and Undo: ' + flow, async a => {
    await imported(a, spec, [2], true); assert.throws(() => problem(a), new RegExp('weights\\.' + spec.key)); a.A.clearUndo();
    const input = a.q(spec.selector); assert.equal(input.value, '2');
    for (const type of flow.split('-')) input.dispatchEvent(new a.w.Event(type, { bubbles: true }));
    assert.equal(a.A.state.rules.weights[spec.key], 2); assert.equal(problem(a).weights[spec.key], 2); a.A.readSettings();
    if (flow.includes('focusout')) { assert.equal(a.q(spec.selector), input); assert.equal(input.dataset.numericEdited, undefined); }
    await reload(a, b => assert.equal(problem(b).weights[spec.key], 2));
    a.A.undo(); assert.deepEqual(clone(a.A.state.rules.weights[spec.key]), [2]); assert.throws(() => problem(a), new RegExp('weights\\.' + spec.key)); assert(a.q('#btnUndo').disabled);
  });
  test(spec.key + ' genuine numeric edit, existing blank behavior, and export', async a => {
    await imported(a, spec, [2]); const before = clone(a.A.state.rules.weights);
    const out = await exported(a); assert.deepEqual(out.weights, before); assert.deepEqual(clone(a.A.state.rules.weights), before);
    a.mode('daily'); a.change(spec.selector, '3.5'); assert.equal(a.A.state.rules.weights[spec.key], 3.5); assert.equal(problem(a).weights[spec.key], 3.5);
    a.change(spec.selector, ''); assert.equal(a.A.state.rules.weights[spec.key], 3.5, 'blank continues to leave the stored weight unchanged');
    a.A.readSettings(); await reload(a, b => assert.equal(problem(b).weights[spec.key], 3.5));
  });
}
test('disabled main weight remains raw until re-enabled and explicitly corrected', async a => {
  const spec = specs[0]; await imported(a, spec, [2]); a.mode('build'); a.change('[data-ron="quota_target"]', false);
  assert.equal(a.q(spec.selector), null); a.change('#setProfLabel', 'Synthetic disabled weight'); assert.deepEqual(clone(a.A.state.rules.weights[spec.key]), [2]);
  a.change('[data-ron="quota_target"]', true); assert.deepEqual(clone(a.A.state.rules.weights[spec.key]), [2]); assert.throws(() => problem(a), /weights\.target_deviation/);
  a.mode('daily'); a.change(spec.selector, '2'); assert.equal(problem(a).weights[spec.key], 2);
});
const EXPECTED_CASES = 46; let started = 0, completed = 0, passed = 0, failed = 0, finished = false;
const watchdog = setTimeout(() => { console.error('Weight readback regression timed out'); process.exit(1); }, 180000);
process.on('exit', () => { if (!finished || cases.length !== EXPECTED_CASES || started !== EXPECTED_CASES || completed !== EXPECTED_CASES || passed !== EXPECTED_CASES || failed) { console.error(`Incomplete weight regression: registered=${cases.length}, started=${started}, completed=${completed}, passed=${passed}, failed=${failed}, expected=${EXPECTED_CASES}`); process.exitCode = 1; } });
(async () => { assert.equal(cases.length, EXPECTED_CASES); for (const c of cases) { started++; let a; try { a = await makeApp(); await c.fn(a); assert.deepEqual(a.errors, []); assert.deepEqual(a.alerts, []); passed++; console.log('PASS ' + c.name); } catch (e) { failed++; console.error('FAIL ' + c.name, e); } finally { if (a) a.w.close(); completed++; } }
  finished = true; clearTimeout(watchdog); console.log(`weight readback: registered=${cases.length}, started=${started}, completed=${completed}, passed=${passed}, failed=${failed}`); if (failed) process.exitCode = 1;
})().catch(e => { console.error(e); process.exitCode = 1; });

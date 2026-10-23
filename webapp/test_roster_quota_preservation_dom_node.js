// Static-authored candidate: all runtime checks were NOT RUN during preparation.
// Actual imports, markup, delegated events, model validation, export and storage.
// Fictional data only; jsdom is a DOM adapter, not native browser/layout coverage.
// TOBAN_DOM_MODULE=/installed/node_modules/jsdom node test_roster_quota_preservation_dom_node.js
const fs = require('fs'), path = require('path'), assert = require('assert/strict');
let JSDOM;
for (const name of [process.env.TOBAN_DOM_MODULE, 'jsdom', path.join(process.env.HOME || '', '.toban-test/node_modules/jsdom')].filter(Boolean)) {
  try { ({ JSDOM } = require(name)); break; } catch (e) { if (e.code !== 'MODULE_NOT_FOUND') throw e; }
}
if (!JSDOM) throw new Error('Roster quota regression requires installed jsdom. This test was NOT run.');
const root = process.env.TOBAN_SOURCE_ROOT || __dirname;
const source = f => fs.readFileSync(f === 'app-settings.js' && process.env.TOBAN_SETTINGS_SOURCE || path.join(root, 'src', f), 'utf8');
const clone = x => JSON.parse(JSON.stringify(x));
const scripts = ['i18n.js', 'rules-core.js', 'model.js', ...fs.readdirSync(path.join(root, 'src/calendars')).filter(f => f.endsWith('.js')).sort().map(f => 'calendars/' + f),
  'messages.js', 'solver.js', 'check.js', 'report.js', 'docxgen.js', 'plugins.js', 'merge.js', ...fs.readdirSync(path.join(root, 'src/rules')).filter(f => f.endsWith('.js')).sort().map(f => 'rules/' + f),
  'app-core.js', 'app-folder.js', 'app-month.js', 'app-input.js', 'app-settings.js', 'app-solve.js', 'app-main.js'];
const key = 'toban_state_v2:/synthetic/roster-quota.html', N = ['Synthetic One', 'Synthetic Two'];
const rawRules = { profile: { id: 'synthetic-roster-quota', roles: [{ id: 'S', label: 'Staff', refs: [] }], shifts: [{ id: 'day', on: 'all' }, { id: 'night', on: 'all' }] },
  doctors: N.map(name => ({ name, team: 'S', quota: 30, local_person: { keep: 'Synthetic metadata' } })), rule_states: { oncall: 'off' }, weights: {} };
const rawMonth = { year: 2026, month: 11, notes: 'Synthetic retained month' };
const tick = () => new Promise(resolve => setImmediate(resolve));
async function until(fn, label) { const end = Date.now() + 7000; while (!fn()) { if (Date.now() > end) throw new Error('Timed out: ' + label); await tick(); } }
async function makeApp(saved) {
  const dom = new JSDOM(source('index.html'), { url: 'https://example.invalid/synthetic/roster-quota.html', runScripts: 'outside-only' }), w = dom.window;
  await new Promise(resolve => w.document.readyState === 'complete' ? resolve() : w.addEventListener('load', resolve, { once: true }));
  const errors = [], alerts = [];
  w.addEventListener('error', e => { errors.push(String(e.error || e.message)); e.preventDefault(); });
  w.confirm = () => true; w.alert = text => alerts.push(String(text)); w.prompt = () => null;
  w.T = { DEFAULT_RULES: clone(rawRules), SAMPLE_MONTH: clone(rawMonth), PROFILES: [], LANGS_DATA: ['en', 'ja'].map(code => JSON.parse(fs.readFileSync(path.join(root, 'lang', code + '.json'), 'utf8'))) };
  for (const f of scripts) w.eval(source(f) + '\n//# sourceURL=' + f);
  const A = w.T.app; A.restoreFolder = () => {}; A.toast = () => {}; // Only OS folder restoration and toast presentation are stubbed.
  const initial = clone(rawRules); w.T.fillDefaultRules(initial);
  for (const def of w.T.RULE_DEFS) if (def.states.includes('off')) initial.rule_states[def.id] = 'off';
  initial.rule_states.quota_target = 'soft'; w.T.fillDefaultRules(initial); w.localStorage.setItem('toban.lang', 'en');
  w.localStorage.setItem(key, saved || JSON.stringify({ rules: initial, month: rawMonth, result: null, ui: { doctor: 1 } }));
  w.T.init();
  const q = s => w.document.querySelector(s), click = s => { assert(q(s), 'Missing ' + s); q(s).click(); };
  const change = (s, value) => { const el = q(s); assert(el, 'Missing ' + s); if (el.type === 'checkbox') el.checked = value; else el.value = value; el.dispatchEvent(new w.Event('change', { bubbles: true })); };
  const mode = value => { click('.tab[data-tab="settings"]'); click(`[data-setmode="${value}"]`); };
  return { dom, w, A, q, click, change, mode, errors, alerts };
}
const selector = '#doctorTable tr[data-i="0"] [data-f="quota"]';
const stored = a => clone(a.A.state.rules.doctors[0].quota);
const problem = a => new a.w.T.Problem(a.A.state.rules, a.A.state.month);
async function imported(a, value, viaJson = false) {
  a.mode('build'); const R = clone(a.A.state.rules); R.profile.label = 'Synthetic imported quota'; R.doctors[0].quota = clone(value);
  if (viaJson) { a.q('#rulesJson').value = JSON.stringify(R); a.click('#btnApplyRules'); }
  else { const el = a.q('#fileLoadProfile'); Object.defineProperty(el, 'files', { configurable: true, value: [{ name: 'synthetic-quota.json', text: async () => JSON.stringify(R) }] }); el.dispatchEvent(new a.w.Event('change', { bubbles: true })); }
  await until(() => a.alerts.length || a.A.switching === 0 && a.A.state.rules.profile.label === R.profile.label, 'quota import');
  assert.deepEqual(a.alerts, []); assert.deepEqual(stored(a), value, 'import preserves raw quota'); a.mode('daily'); assert(a.q(selector));
}
async function reload(a, fn) { const b = await makeApp(a.w.localStorage.getItem(key)); try { await fn(b); assert.deepEqual(b.errors, []); assert.deepEqual(b.alerts, []); } finally { b.w.close(); } }
async function exported(a) {
  const downloads = []; a.A.download = (name, blob) => downloads.push({ name, blob }); a.mode('build'); a.q('#setExportRoster').checked = true; a.click('#btnExportProfile');
  await until(() => downloads.length || a.alerts.length, 'included-roster export'); assert.deepEqual(a.alerts, []); assert.equal(downloads.length, 1);
  return JSON.parse(await new Promise((resolve, reject) => { const r = new a.w.FileReader(); r.onload = () => resolve(r.result); r.onerror = reject; r.readAsText(downloads[0].blob); }));
}
const cases = [], test = (name, fn) => cases.push({ name, fn });
for (const value of [[2], ['2'], [[2]], [0], [], {}, false, true, 'bad', ' 2 ', '+2', '2e0', '0xF', 0, 0.5]) test('raw quota ' + JSON.stringify(value) + ' survives unrelated readback and reload', async a => {
  await imported(a, value); const valid = typeof value === 'number' || typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value));
  const assertMeaning = b => valid ? assert.equal(problem(b).quota(N[0]), Number(value)) : assert.throws(() => problem(b), /quota/);
  assertMeaning(a); const month = clone(a.A.state.month), sibling = clone(a.A.state.rules.doctors[1]);
  a.change('#doctorTable tr[data-i="0"] [data-f="years"]', '12'); a.A.readSettings(); a.A.readSettings();
  assert.deepEqual(stored(a), value); assertMeaning(a); assert.deepEqual(clone(a.A.state.month), month); assert.deepEqual(clone(a.A.state.rules.doctors[1]), sibling);
  assert.deepEqual(JSON.parse(a.w.localStorage.getItem(key)).rules.doctors[0].quota, value);
  await reload(a, b => { assert.deepEqual(stored(b), value); assertMeaning(b); });
});
for (const flow of ['change', 'input-focusout']) test('explicit same-visible quota correction and Undo: ' + flow, async a => {
  await imported(a, [2], true); assert.throws(() => problem(a), /quota/); a.A.clearUndo();
  const input = a.q(selector); assert.equal(input.value, '2');
  for (const type of flow.split('-')) input.dispatchEvent(new a.w.Event(type, { bubbles: true }));
  assert.equal(stored(a), 2); assert.equal(problem(a).quota(N[0]), 2); a.A.readSettings();
  if (flow.includes('focusout')) { assert.equal(a.q(selector), input); assert.equal(input.dataset.numericEdited, undefined); }
  await reload(a, b => assert.equal(problem(b).quota(N[0]), 2));
  a.A.undo(); assert.deepEqual(stored(a), [2]); assert.throws(() => problem(a), /quota/); assert(a.q('#btnUndo').disabled);
});
for (const [value, expected] of [['3.5', 3.5], ['0', 0], ['', 0]]) test('explicit quota edit ' + JSON.stringify(value) + ' keeps existing semantics', async a => {
  await imported(a, [2]); a.change(selector, value); assert.equal(stored(a), expected); assert.equal(problem(a).quota(N[0]), expected); a.A.readSettings();
  await reload(a, b => assert.equal(problem(b).quota(N[0]), expected));
});
test('included-roster export retains raw quota and validation failure', async a => {
  await imported(a, [2]); const before = clone(a.A.state.rules.doctors), out = await exported(a);
  assert.deepEqual(out.doctors, before); assert.deepEqual(clone(a.A.state.rules.doctors), before); assert.throws(() => new a.w.T.Problem(out, a.A.state.month), /quota/);
});
test('hidden quota remains raw while rule is disabled and restored', async a => {
  await imported(a, [2]); a.mode('build'); a.change('[data-ron="quota_target"]', false); assert.equal(a.q(selector), null);
  a.change('#setProfLabel', 'Synthetic disabled quota'); assert.deepEqual(stored(a), [2]); a.change('[data-ron="quota_target"]', true);
  assert.deepEqual(stored(a), [2]); assert.throws(() => problem(a), /quota/); a.mode('daily'); a.change(selector, '2'); assert.equal(problem(a).quota(N[0]), 2);
});
test('input-only correction is committed before export', async a => {
  await imported(a, [2]); const input = a.q(selector); input.value = '4.5'; input.dispatchEvent(new a.w.Event('input', { bubbles: true }));
  // Clicking the settings tab re-renders the roster (showTab -> renderSettings). In a real browser the click first
  // moves focus off the input (focusout); jsdom's click() does not, so emulate that focus loss before exporting.
  input.dispatchEvent(new a.w.Event('focusout', { bubbles: true }));
  const out = await exported(a); assert.equal(out.doctors[0].quota, 4.5); assert.equal(stored(a), 4.5); await reload(a, b => assert.equal(problem(b).quota(N[0]), 4.5));
});
const EXPECTED_CASES = 23; let started = 0, completed = 0, passed = 0, failed = 0, finished = false;
const watchdog = setTimeout(() => { console.error('Roster quota regression timed out'); process.exit(1); }, 180000);
process.on('exit', () => { if (!finished || cases.length !== EXPECTED_CASES || started !== EXPECTED_CASES || completed !== EXPECTED_CASES || passed !== EXPECTED_CASES || failed) { console.error(`Incomplete quota regression: registered=${cases.length}, started=${started}, completed=${completed}, passed=${passed}, failed=${failed}, expected=${EXPECTED_CASES}`); process.exitCode = 1; } });
(async () => { assert.equal(cases.length, EXPECTED_CASES); for (const c of cases) { started++; let a; try { a = await makeApp(); await c.fn(a); assert.deepEqual(a.errors, []); assert.deepEqual(a.alerts, []); passed++; console.log('PASS ' + c.name); } catch (e) { failed++; console.error('FAIL ' + c.name, e); } finally { if (a) a.w.close(); completed++; } }
  finished = true; clearTimeout(watchdog); console.log(`roster quota: registered=${cases.length}, started=${started}, completed=${completed}, passed=${passed}, failed=${failed}`); if (failed) process.exitCode = 1;
})().catch(e => { clearTimeout(watchdog); console.error(e); process.exitCode = 1; });

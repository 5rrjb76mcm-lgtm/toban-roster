// Malformed shift imports must reject before replacing or persisting live state.
// Real DOM export/import and local persistence; synthetic data only. jsdom is not a layout test.
// TOBAN_DOM_MODULE=/installed/node_modules/jsdom node test_profile_shift_import_atomic_dom_node.js
const fs = require('fs'), path = require('path'), assert = require('assert/strict');
let JSDOM;
for (const name of [process.env.TOBAN_DOM_MODULE, 'jsdom', path.join(process.env.HOME || '', '.toban-test/node_modules/jsdom')].filter(Boolean)) {
  try { ({ JSDOM } = require(name)); break; } catch (e) { if (e.code !== 'MODULE_NOT_FOUND') throw e; }
}
if (!JSDOM) throw new Error('Shift import atomicity DOM regression requires jsdom 26.1.0. Set TOBAN_DOM_MODULE. This test was NOT run.');
const root = process.env.TOBAN_SOURCE_ROOT || __dirname;
const source = f => fs.readFileSync(path.join(root, 'src', f), 'utf8');
const scripts = ['i18n.js', 'rules-core.js', 'model.js', ...fs.readdirSync(path.join(root, 'src/calendars')).filter(f => f.endsWith('.js')).sort().map(f => 'calendars/' + f),
  'messages.js', 'solver.js', 'check.js', 'report.js', 'docxgen.js', 'plugins.js', 'merge.js', ...fs.readdirSync(path.join(root, 'src/rules')).filter(f => f.endsWith('.js')).sort().map(f => 'rules/' + f),
  'app-core.js', 'app-folder.js', 'app-month.js', 'app-input.js', 'app-settings.js', 'app-solve.js', 'app-main.js'];
const clone = x => x === undefined ? undefined : JSON.parse(JSON.stringify(x));
const names = ['Synthetic One', 'Synthetic Two', 'Synthetic Three', 'Synthetic Four'];
const rawRules = { profile: { id: 'synthetic-shift-import-atomic', label: 'Synthetic base', roles: [{ id: 'S', label: 'Staff', refs: [] }], shifts: [{ id: 'day', on: 'all' }, { id: 'night', on: 'all' }] },
  doctors: names.map(name => ({ name, team: 'S', quota: 15 })), rule_states: { oncall: 'off' }, weights: {} };
const rawMonth = { year: 2026, month: 11, notes: 'Synthetic profile import preservation' };
const key = 'toban_state_v2:/synthetic/profile-shift-import-atomic.html';
const tick = () => new Promise(resolve => setImmediate(resolve));
async function until(fn, label) { const end = Date.now() + 7000; while (!fn()) { if (Date.now() > end) throw new Error('Timed out: ' + label); await tick(); } }
async function makeApp(saved) {
  const dom = new JSDOM(source('index.html'), { url: 'https://example.invalid/synthetic/profile-shift-import-atomic.html', runScripts: 'outside-only' }), w = dom.window;
  await new Promise(resolve => w.document.readyState === 'complete' ? resolve() : w.addEventListener('load', resolve, { once: true }));
  const errors = [], alerts = [];
  w.addEventListener('error', e => { errors.push(String(e.error || e.message)); e.preventDefault(); });
  w.confirm = () => true; w.alert = msg => alerts.push(String(msg)); w.prompt = () => null;
  w.T = { DEFAULT_RULES: clone(rawRules), SAMPLE_MONTH: clone(rawMonth), PROFILES: [], LANGS_DATA: ['en', 'ja'].map(code => JSON.parse(fs.readFileSync(path.join(root, 'lang', code + '.json'), 'utf8'))) };
  for (const f of scripts) w.eval(source(f) + '\n//# sourceURL=' + f);
  const A = w.T.app; A.restoreFolder = () => {}; A.toast = () => {}; // OS folder restoration only; input/import/save are production.
  w.localStorage.setItem('toban.lang', 'en');
  const initial = clone(rawRules); w.T.fillDefaultRules(initial);
  for (const d of w.T.RULE_DEFS) if (d.states.includes('off')) initial.rule_states[d.id] = 'off';
  w.T.fillDefaultRules(initial);
  w.localStorage.setItem(key, saved || JSON.stringify({ rules: initial, month: rawMonth, result: null, ui: { doctor: 1 } }));
  w.T.init();
  const q = s => w.document.querySelector(s), click = s => { assert(q(s), 'Missing ' + s); q(s).click(); };
  const change = (s, value) => { const el = q(s); assert(el, 'Missing ' + s); assert.equal(el.closest('[hidden]'), null, 'edit target must be visible: ' + s); el.value = value; el.dispatchEvent(new w.Event('change', { bubbles: true })); };
  const mode = which => { click('.tab[data-tab="settings"]'); click(`[data-setmode="${which}"]`); };
  return { dom, w, A, q, click, change, mode, errors, alerts };
}



const cases = [], test = (label, fn) => cases.push({ label, fn });
const unhandled = [];
process.on('unhandledRejection', e => unhandled.push(String(e && e.stack || e)));
async function apply(a, r, route) {
  if (route === 'file') {
    const el = a.q('#fileLoadProfile');
    Object.defineProperty(el, 'files', { configurable: true, value: [{ name: 'synthetic-shifts.json', text: async () => JSON.stringify(r) }] });
    el.dispatchEvent(new a.w.Event('change', { bubbles: true }));
  } else if (route === 'json') {
    a.q('#rulesJson').value = JSON.stringify(r); a.click('#btnApplyRules');
  } else {
    a.w.T.PROFILES = [clone(r)]; a.A.renderSettings();
    a.q('#setProfile').value = r.profile.id; a.click('#btnLoadProfile');
  }
  await tick(); await until(() => a.A.switching === 0, route + ' import'); await tick();
}
const incoming = a => {
  const r = clone(a.A.state.rules); r.profile.id = 'synthetic-incoming-shifts';
  r.profile.label = 'Synthetic incoming shifts'; return r;
};
const bad = [
  ['unknown ID', [{ id: 'swing' }]], ['missing ID', [{}]], ['null entry', [null]],
  ['duplicate ID', [{ id: 'day' }, { id: 'day' }]], ['disabled night', [{ id: 'night', on: 'none' }]],
];
for (const route of ['file', 'json', 'bundled']) {
  for (const [label, shifts] of bad) test(route + ': ' + label + ' rejects atomically', async a => {
    a.A.clearUndo(); const oldNotes = a.A.state.rules.notes;
    a.A.pushUndo('Synthetic prior edit'); a.A.state.rules.notes = 'Synthetic prior edit'; a.A.save(); await tick();
    const r = incoming(a); r.profile.shifts = clone(shifts);
    // Install the bundled option before the rejection snapshot; rendering it is not an import mutation.
    if (route === 'bundled') { a.w.T.PROFILES = [clone(r)]; a.A.renderSettings(); }
    const before = JSON.stringify(a.A.state), refs = { ...a.A.state }, saved = a.w.localStorage.getItem(key), note = a.q('#undoNote').textContent;
    const originalSave = a.A.save; let saves = 0; a.A.save = (...args) => { saves++; return originalSave(...args); };
    try { await apply(a, r, route); } finally { a.A.save = originalSave; }
    assert.equal(a.alerts.length, 1); a.alerts.length = 0;
    assert.equal(JSON.stringify(a.A.state), before);
    for (const k of Object.keys(refs)) assert.equal(a.A.state[k], refs[k], k + ' reference');
    assert.equal(a.w.localStorage.getItem(key), saved); assert.equal(saves, 0);
    assert.equal(a.q('#undoNote').textContent, note); assert.equal(a.q('#btnUndo').disabled, false);
    a.A.undo(); assert.equal(a.A.state.rules.notes, oldNotes);
  });
  for (const shape of ['omitted', 'empty', 'partial']) test(route + ': valid ' + shape + ' shifts preserve raw input', async a => {
    const before = clone(a.A.state.rules), r = incoming(a);
    if (shape === 'omitted') delete r.profile.shifts;
    else r.profile.shifts = shape === 'empty' ? [] : [{ id: 'day', on: 'all', label: { en: 'Synthetic day', ja: 'Synthetic day' }, local_shift: { keep: 7 } }];
    await apply(a, r, route);
    assert.deepEqual(clone(a.A.state.rules.profile.shifts), r.profile.shifts);
    assert.equal(a.A.state.rules.profile.id, r.profile.id);
    a.A.undo(); assert.deepEqual(clone(a.A.state.rules), before);
  });
  test(route + ': numeric-invalid settings remain accepted for repair', async a => {
    const r = incoming(a); r.rule_states.quota_target = 'soft'; r.weights.target_deviation = -1;
    await apply(a, r, route);
    assert.equal(a.A.state.rules.weights.target_deviation, -1);
    assert.throws(() => new a.w.T.Problem(a.A.state.rules, a.A.state.month), /weights\.target_deviation/);
  });
}
const EXPECTED_CASES = 27; let passed = 0, failed = 0, finished = false;
process.on('exit', () => { if (!finished || passed !== EXPECTED_CASES || failed) process.exitCode = 1; });
const watchdog = setTimeout(() => { console.error('Shift import atomicity regression timed out'); process.exit(1); }, 120000);
(async () => {
  assert.equal(cases.length, EXPECTED_CASES);
  for (const { label, fn } of cases) {
    let a; unhandled.length = 0;
    try { a = await makeApp(); a.mode('build'); await fn(a); assert.deepEqual(a.errors, []); assert.deepEqual(a.alerts, []); assert.deepEqual(unhandled, []); passed++; console.log('PASS ' + label); }
    catch (e) { failed++; console.error('FAIL ' + label + '\n' + e.stack); }
    finally { a?.w.close(); }
  }
  finished = true; clearTimeout(watchdog); console.log(`Shift import atomicity: ${passed}/${EXPECTED_CASES} passed, ${failed} failed`); if (failed) process.exitCode = 1;
})().catch(e => { clearTimeout(watchdog); console.error(e); process.exitCode = 1; });

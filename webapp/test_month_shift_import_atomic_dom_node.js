// Static-authored candidate: this regression, syntax checks and the app were NOT RUN.
// Whole-month adoption must reject unsupported shifts before state/storage/Undo changes.
// Real DOM rendering and persistence; synthetic data only. File/OS pickers and solving are not exercised.
// TOBAN_DOM_MODULE=/installed/node_modules/jsdom node test_month_shift_import_atomic_dom_node.js
const fs = require('fs'), path = require('path'), assert = require('assert/strict');
let JSDOM;
for (const name of [process.env.TOBAN_DOM_MODULE, 'jsdom', path.join(process.env.HOME || '', '.toban-test/node_modules/jsdom')].filter(Boolean)) {
  try { ({ JSDOM } = require(name)); break; } catch (e) { if (e.code !== 'MODULE_NOT_FOUND') throw e; }
}
if (!JSDOM) throw new Error('Month shift-import regression requires installed jsdom 26.1.0. No dependency is downloaded. This test was NOT run.');
const root = process.env.TOBAN_SOURCE_ROOT || __dirname;
const source = f => fs.readFileSync(f === 'app-folder.js' && process.env.TOBAN_FOLDER_SOURCE || path.join(root, 'src', f), 'utf8');
const scripts = ['i18n.js', 'rules-core.js', 'model.js', ...fs.readdirSync(path.join(root, 'src/calendars')).filter(f => f.endsWith('.js')).sort().map(f => 'calendars/' + f),
  'messages.js', 'solver.js', 'check.js', 'report.js', 'docxgen.js', 'plugins.js', 'merge.js', ...fs.readdirSync(path.join(root, 'src/rules')).filter(f => f.endsWith('.js')).sort().map(f => 'rules/' + f),
  'app-core.js', 'app-folder.js', 'app-month.js', 'app-input.js', 'app-settings.js', 'app-solve.js', 'app-main.js'];
const clone = x => x === undefined ? undefined : JSON.parse(JSON.stringify(x));
const names = ['Synthetic One', 'Synthetic Two', 'Synthetic Three', 'Synthetic Four'];
const rawRules = { profile: { id: 'synthetic-month-shift-import', label: 'Synthetic base', roles: [{ id: 'S', label: 'Staff', refs: [] }], shifts: [{ id: 'day', on: 'all' }, { id: 'night', on: 'all' }] },
  doctors: names.map(name => ({ name, team: 'S', quota: 15 })), rule_states: { oncall: 'off' }, weights: {} };
// Saved/edited months have expanded duty_days. If it is absent, normalizeMonth's
// expandDuties -> Problem already rejects unsupported shifts before adoption.
const rawMonth = { year: 2026, month: 11, notes: 'Synthetic monthly input', next_first_day_in_calendar: true, duty_days: Object.fromEntries(names.map(name => [name, {}])) };
const key = 'toban_state_v2:/synthetic/month-shift-import.html';
const tick = () => new Promise(resolve => setImmediate(resolve));
async function makeApp() {
  const dom = new JSDOM(source('index.html'), { url: 'https://example.invalid/synthetic/month-shift-import.html', runScripts: 'outside-only' }), w = dom.window;
  await new Promise(resolve => w.document.readyState === 'complete' ? resolve() : w.addEventListener('load', resolve, { once: true }));
  const errors = [], alerts = [];
  w.addEventListener('error', e => { errors.push(String(e.error || e.message)); e.preventDefault(); });
  w.confirm = () => true; w.alert = msg => alerts.push(String(msg)); w.prompt = () => null;
  w.T = { DEFAULT_RULES: clone(rawRules), SAMPLE_MONTH: clone(rawMonth), PROFILES: [], LANGS_DATA: ['en', 'ja'].map(code => JSON.parse(fs.readFileSync(path.join(root, 'lang', code + '.json'), 'utf8'))) };
  for (const f of scripts) w.eval(source(f) + '\n//# sourceURL=' + f);
  const A = w.T.app; A.restoreFolder = () => {}; A.toast = () => {}; // Only OS folder restoration and messages are replaced.
  w.localStorage.setItem('toban.lang', 'en');
  const initial = clone(rawRules); w.T.fillDefaultRules(initial);
  for (const d of w.T.RULE_DEFS) if (d.states.includes('off')) initial.rule_states[d.id] = 'off';
  w.T.fillDefaultRules(initial);
  w.localStorage.setItem(key, JSON.stringify({ rules: initial, month: rawMonth, result: null, ui: { doctor: 1 } }));
  w.T.init();
  return { dom, w, A, errors, alerts, q: s => w.document.querySelector(s) };
}
const incoming = a => ({ rules: clone(a.A.state.rules), month: { ...clone(rawMonth), notes: 'Synthetic incoming monthly input' }, result: null, saved_at: '2026-10-01T00:00:00.000Z' });
// Production whole-month adoption after the file read/save-before-switch.
function adopt(a, value, route) {
  a.A.applyLoaded(value, 'Synthetic import', { fromFolder: route === 'folder' });
}
const cases = [], test = (label, fn) => cases.push({ label, fn });
const bad = [
  ['unknown ID', [{ id: 'swing' }]], ['missing ID', [{}]], ['null entry', [null]],
  ['duplicate ID', [{ id: 'day' }, { id: 'day' }]], ['disabled night', [{ id: 'night', on: 'none' }]],
];
for (const route of ['external', 'folder']) {
  for (const [label, shifts] of bad) test(route + ': ' + label + ' rejects atomically', async a => {
    const A = a.A;
    // Populate every state family whose loss matters, then keep a real prior Undo entry.
    A.state.result = { status: 'synthetic-uncomputed-result', local_result: { keep: 9 } };
    A.state.base = clone(A.state.month); A.state.baseRules = clone(A.state.rules);
    A.state.renames = [['Synthetic Old Name', names[0]]];
    A.state.meta = { savedSig: 'synthetic-before', savedTag: A.tag(), savedAt: '2026-09-30T00:00:00.000Z' };
    A.clearUndo(); const oldNote = A.state.rules.notes;
    A.pushUndo('Synthetic prior settings edit'); A.state.rules.notes = 'Synthetic prior settings edit'; A.save(); await tick();
    const value = incoming(a); value.rules.profile.shifts = clone(shifts);
    // Exercise both skipped next-day estimation and its caught Problem error.
    value.month.next_first_day_in_calendar = label === 'unknown ID';
    if (route === 'folder') A.dirHandle = { name: 'Synthetic read-only folder' }; // No filesystem I/O.
    const before = JSON.stringify(A.state), refs = { ...A.state }, stored = a.w.localStorage.getItem(key), raw = JSON.stringify(value);
    const undoLabel = a.q('#undoNote').textContent, generation = A.saveGen;
    const save = A.save; let saves = 0; A.save = (...args) => { saves++; return save(...args); };
    try { assert.doesNotThrow(() => adopt(a, value, route)); } finally { A.save = save; }
    assert.equal(a.alerts.length, 1, 'one readable rejection'); a.alerts.length = 0;
    assert.equal(JSON.stringify(A.state), before, 'do not replace state');
    for (const k of Object.keys(refs)) assert.equal(A.state[k], refs[k], k + ' identity');
    assert.equal(a.w.localStorage.getItem(key), stored, 'do not overwrite browser recovery state');
    assert.equal(JSON.stringify(value), raw, 'do not mutate the file object');
    assert.equal(A.saveGen, generation); assert.equal(saves, 0);
    assert.equal(a.q('#undoNote').textContent, undoLabel); assert.equal(a.q('#btnUndo').disabled, false);
    A.dirHandle = null; A.undo(); assert.equal(A.state.rules.notes, oldNote, 'the prior valid edit remains undoable');
  });
  for (const shape of ['omitted', 'empty', 'partial']) test(route + ': valid ' + shape + ' shifts retain raw definitions', async a => {
    const value = incoming(a);
    if (shape === 'omitted') delete value.rules.profile.shifts;
    else value.rules.profile.shifts = shape === 'empty' ? [] : [{ id: 'day', on: 'all', label: { en: 'Synthetic day', ja: 'Synthetic day' }, local_shift: { keep: 7 } }];
    const raw = JSON.stringify(value), expected = clone(value.rules.profile.shifts);
    if (route === 'folder') a.A.dirHandle = { name: 'Synthetic read-only folder' };
    assert.doesNotThrow(() => adopt(a, value, route));
    assert.deepEqual(clone(a.A.state.rules.profile.shifts), expected);
    assert.equal(JSON.stringify(value), raw); assert.equal(a.A.state.month.month, 11);
    assert.deepEqual(JSON.parse(a.w.localStorage.getItem(key)).rules.profile.shifts, expected);
    assert.equal(a.q('#btnUndo').disabled, true, 'successful whole-month adoption still clears Undo');
    assert.doesNotThrow(() => a.A.renderAll(), 'accepted configuration remains renderable');
    if (route === 'folder') assert.equal(a.A.isDirty(), false, 'folder import keeps its saved baseline');
    else assert.equal(a.A.state.meta, null, 'external import is not marked saved to a folder');
  });
  for (const [label, edit, pattern] of [
    ['negative weight', r => { r.rule_states.quota_target = 'soft'; r.weights.target_deviation = -1; }, /weights\.target_deviation/],
    ['array quota', r => { r.rule_states.quota_target = 'soft'; r.doctors[0].quota = [2]; }, /quota/],
  ]) test(route + ': ' + label + ' remains accepted for explicit repair', async a => {
    const value = incoming(a); edit(value.rules); const raw = clone(value.rules);
    if (route === 'folder') a.A.dirHandle = { name: 'Synthetic read-only folder' };
    assert.doesNotThrow(() => adopt(a, value, route));
    assert.deepEqual(clone(a.A.state.rules.doctors[0].quota), raw.doctors[0].quota);
    assert.deepEqual(clone(a.A.state.rules.weights), raw.weights);
    assert.throws(() => new a.w.T.Problem(a.A.state.rules, a.A.state.month), pattern);
    assert.doesNotThrow(() => a.A.renderAll(), 'settings remain reachable for repair');
  });
}
for (const route of ['external', 'folder']) test(route + ': legacy bare month keeps current shift definitions', async a => {
  const shifts = clone(a.A.state.rules.profile.shifts), rules = a.A.state.rules;
  const value = clone(rawMonth); value.notes = 'Synthetic legacy bare month';
  assert.doesNotThrow(() => adopt(a, value, route));
  assert.equal(a.A.state.rules, rules); assert.deepEqual(clone(a.A.state.rules.profile.shifts), shifts);
  assert.equal(a.A.state.month.notes, value.notes);
});
for (const route of ['external', 'folder']) test(route + ': missing duty_days still rejects before adoption', async a => {
  const value = incoming(a); delete value.month.duty_days; value.rules.profile.shifts = [{ id: 'swing' }];
  const before = JSON.stringify(a.A.state), stored = a.w.localStorage.getItem(key);
  assert.doesNotThrow(() => adopt(a, value, route));
  assert.equal(a.alerts.length, 1); a.alerts.length = 0;
  assert.equal(JSON.stringify(a.A.state), before); assert.equal(a.w.localStorage.getItem(key), stored);
});
const EXPECTED_CASES = 24; let started = 0, completed = 0, passed = 0, failed = 0, finished = false;
const unhandled = []; process.on('unhandledRejection', e => unhandled.push(String(e && e.stack || e)));
const watchdog = setTimeout(() => { console.error('Month shift-import regression timed out'); process.exit(1); }, 120000);
process.on('exit', () => { if (!finished || cases.length !== EXPECTED_CASES || started !== EXPECTED_CASES || completed !== EXPECTED_CASES || passed !== EXPECTED_CASES || failed) process.exitCode = 1; });
(async () => {
  assert.equal(cases.length, EXPECTED_CASES);
  for (const { label, fn } of cases) {
    started++; let a; unhandled.length = 0;
    try { a = await makeApp(); await fn(a); await tick(); assert.deepEqual(a.errors, []); assert.deepEqual(a.alerts, []); assert.deepEqual(unhandled, []); passed++; console.log('PASS ' + label); }
    catch (e) { failed++; console.error('FAIL ' + label + '\n' + e.stack); }
    finally { a?.w.close(); completed++; }
  }
  finished = true; clearTimeout(watchdog);
  console.log(`Month shift-import: registered=${cases.length}, started=${started}, completed=${completed}, passed=${passed}, failed=${failed}`);
  if (failed) process.exitCode = 1;
})().catch(e => { clearTimeout(watchdog); console.error(e); process.exitCode = 1; });

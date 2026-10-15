// Supported staffing shorthand must survive ordinary settings edits.
// Real profile-file import, markup, delegated events, Problem, export, save/reload,
// and optional real HiGHS. Fictional data only; jsdom is not a browser/layout test.
// TOBAN_DOM_MODULE=/installed/node_modules/jsdom node test_profile_staffing_shorthand_dom_node.js [/installed/node_modules/highs]
const fs = require('fs'), path = require('path'), assert = require('assert/strict');
let JSDOM;
for (const name of [process.env.TOBAN_DOM_MODULE, 'jsdom', path.join(process.env.HOME || '', '.toban-test/node_modules/jsdom')].filter(Boolean)) {
  try { ({ JSDOM } = require(name)); break; } catch (e) { if (e.code !== 'MODULE_NOT_FOUND') throw e; }
}
if (!JSDOM) throw new Error('Staffing shorthand DOM regression requires jsdom 26.1.0. Set TOBAN_DOM_MODULE. This test was NOT run.');
const root = process.env.TOBAN_SOURCE_ROOT || __dirname;
const source = f => fs.readFileSync(path.join(root, 'src', f), 'utf8');
const scripts = ['i18n.js', 'rules-core.js', 'model.js', ...fs.readdirSync(path.join(root, 'src/calendars')).filter(f => f.endsWith('.js')).sort().map(f => 'calendars/' + f),
  'messages.js', 'solver.js', 'check.js', 'report.js', 'docxgen.js', 'plugins.js', 'merge.js', ...fs.readdirSync(path.join(root, 'src/rules')).filter(f => f.endsWith('.js')).sort().map(f => 'rules/' + f),
  'app-core.js', 'app-folder.js', 'app-month.js', 'app-input.js', 'app-settings.js', 'app-solve.js', 'app-main.js'];
const clone = x => x === undefined ? undefined : JSON.parse(JSON.stringify(x));
const names = ['Synthetic One', 'Synthetic Two', 'Synthetic Three', 'Synthetic Four'];
const rawRules = { profile: { id: 'synthetic-staffing-shorthand', label: 'Synthetic base', roles: [{ id: 'S', label: 'Staff', refs: [] }], shifts: [{ id: 'day', on: 'all' }, { id: 'night', on: 'all' }] },
  doctors: names.map(name => ({ name, team: 'S', quota: 15 })), rule_states: { oncall: 'off' }, weights: {} };
const rawMonth = { year: 2026, month: 11, notes: 'Synthetic staffing preservation' };
const key = 'toban_state_v2:/synthetic/staffing-shorthand.html';
const tick = () => new Promise(resolve => setImmediate(resolve));
async function until(fn, label) { const end = Date.now() + 7000; while (!fn()) { if (Date.now() > end) throw new Error('Timed out: ' + label); await tick(); } }
async function makeApp(saved) {
  const dom = new JSDOM(source('index.html'), { url: 'https://example.invalid/synthetic/staffing-shorthand.html', runScripts: 'outside-only' }), w = dom.window;
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
const work = a => clone(a.A.state.rules.profile.positions?.work);
const P = a => new a.w.T.Problem(a.A.state.rules, a.A.state.month);
const semantics = a => { const p = P(a); return clone(p.slots.map(s => [s, p.countOf(s), p.countMinOf(s), p.countIdealOf(s)])); };
async function importWork(a, value, label) {
  a.mode('build'); const incoming = clone(a.A.state.rules); incoming.profile.label = 'Synthetic import ' + label;
  if (value === undefined) delete incoming.profile.positions; else incoming.profile.positions = { work: clone(value) };
  incoming.rule_states.count_target = 'off';
  const el = a.q('#fileLoadProfile'); Object.defineProperty(el, 'files', { configurable: true, value: [{ name: 'synthetic-profile.json', text: async () => JSON.stringify(incoming) }] });
  el.dispatchEvent(new a.w.Event('change', { bubbles: true }));
  await until(() => a.alerts.length || a.A.switching === 0 && a.A.state.rules.profile.label === incoming.profile.label, 'profile import');
  assert.deepEqual(a.alerts, []); assert.equal(a.A.state.rules.profile.label, incoming.profile.label);
}
async function savedReload(a, expected, expectedWork) {
  const saved = a.w.localStorage.getItem(key); assert(saved, 'state saved'); const b = await makeApp(saved);
  try { assert.deepEqual(semantics(b), expected, 'save/reload preserves staffing'); if (expectedWork !== undefined) assert.deepEqual(work(b), expectedWork, 'save/reload preserves stored shorthand'); assert.deepEqual(b.errors, []); assert.deepEqual(b.alerts, []); }
  finally { b.dom.window.close(); }
}
const cases = [], test = (label, fn) => cases.push({ label, fn });
const fixtures = [
  ['scalar two', 2, true, { day: '2', night: '2' }],
  ['scalar zero', 0, true, { day: '0', night: '0' }],
  ['direct shift map', { day: 2, night: 3 }, true, { day: '2', night: '3' }],
  ['direct day-type map', { weekday: 2, off_days: 3 }, true, { day: null, night: null }],
  ['nested shift/day-type map', { day: { weekday: 1, off_days: 2 }, night: { weekday: 2, off_days: 3 } }, true, { day: null, night: null }],
  ['partial day type with zero', { weekday: 0 }, true, { day: null, night: null }],
  ['partial shift with zero', { day: 0 }, true, { day: '0', night: '1' }],
  ['shorthand bounds and metadata', { day: 2, night: 3, min: 1, ideal: { day: 2, night: 2 }, extension: { note: 'Synthetic retained value' } }, true, { day: '2', night: '3' }],
  ['day-type bounds and metadata', { weekday: 2, off_days: 3, min: 1, ideal: 2, extension: { note: 'Synthetic retained value' } }, true, { day: null, night: null }],
  ['empty shorthand', {}, true, { day: '1', night: '1' }],
  ['canonical scalar', { count: 2 }, false, { day: '2', night: '2' }],
  ['canonical zero', { count: 0 }, false, { day: '0', night: '0' }],
  ['canonical shift map', { count: { day: 2, night: 3 } }, false, { day: '2', night: '3' }],
  ['canonical day-type map', { count: { weekday: 2, off_days: 3 } }, false, { day: null, night: null }],
  ['canonical null overrides siblings', { count: null, day: 3, night: 2, extension: 'Synthetic metadata' }, false, { day: '1', night: '1' }],
  ['canonical count overrides siblings', { count: { day: 2, night: 1 }, day: 3, night: 3, extension: 'Synthetic metadata' }, false, { day: '2', night: '1' }],
  ['null work', null, false, { day: '1', night: '1' }],
  ['missing work', undefined, false, { day: '1', night: '1' }],
];
for (const [label, value, exact, shown] of fixtures) test(label + ': import, unrelated edits, readback, export and reload', async a => {
  await importWork(a, value, label); const before = semantics(a), raw = work(a);
  for (const [shift, expected] of Object.entries(shown)) {
    const field = a.q(`[data-count="${shift}"]`), summary = a.q(`[data-countkeep="count:${shift}"]`);
    if (expected === null) { assert.equal(field, null, 'structured staffing is not a misleading numeric input'); assert(summary, 'structured staffing is shown and retained'); }
    else { assert(field); assert.equal(field.value, expected, 'builder renders the effective count'); }
  }
  a.mode('daily'); const monthBefore = clone(a.A.state.month); a.change('#doctorTable tr[data-i="0"] [data-f="years"]', '12');
  assert.deepEqual(semantics(a), before, 'unrelated visible roster edit preserves every slot');
  a.mode('build'); a.change('#setProfLabel', 'Synthetic renamed profile'); a.A.readSettings(); a.A.readSettings();
  assert.deepEqual(semantics(a), before); if (exact) assert.deepEqual(work(a), raw, 'unchanged shorthand representation is retained exactly');
  if (value?.extension !== undefined) assert.deepEqual(work(a).extension, value.extension, 'nonvisible work metadata survives');
  assert.deepEqual(clone(a.A.state.month), monthBefore); assert.equal(a.A.state.rules.rule_states.count_target, 'off');
  const exported = a.A.profileForExport(true).rules; const exportedP = new a.w.T.Problem(exported, clone(a.A.state.month));
  assert.deepEqual(clone(exportedP.slots.map(s => [s, exportedP.countOf(s), exportedP.countMinOf(s), exportedP.countIdealOf(s)])), before, 'profile export preserves semantics');
  await savedReload(a, before, exact ? raw : undefined);
});
for (const value of [2, 0, { day: 2, night: 3, extension: { note: 'Keep' } }]) test('explicit numeric edits from ' + JSON.stringify(value), async a => {
  await importWork(a, value, 'numeric edit'); const night = P(a).countOf([1, 'night']);
  a.change('[data-count="day"]', '0'); assert.equal(P(a).countOf([1, 'day']), 0); assert.equal(P(a).countOf([1, 'night']), night);
  a.change('[data-count="day"]', '3'); assert.equal(P(a).countOf([1, 'day']), 3);
  a.change('[data-count="day"]', ''); assert.equal(P(a).countOf([1, 'day']), 1, 'explicit blank keeps existing default semantics');
  if (value?.extension) assert.deepEqual(work(a).extension, value.extension);
  await savedReload(a, semantics(a));
});
test('editing one numeric shift retains the other read-only day-type branch', async a => {
  const value = { day: { weekday: 2, off_days: 3 }, night: 2, extension: { note: 'Keep' } };
  await importWork(a, value, 'mixed edit'); a.change('[data-count="night"]', '0');
  assert.equal(P(a).countOf([1, 'day']), 3); assert.equal(P(a).countOf([2, 'day']), 2); assert.equal(P(a).countOf([1, 'night']), 0);
  assert.deepEqual(work(a).count.day, value.day); assert.deepEqual(work(a).extension, value.extension); await savedReload(a, semantics(a));
});
for (const value of [
  { day: 2, night: 3, min: 1, ideal: 2, extension: { note: 'Keep' } },
  { weekday: 2, off_days: 3, min: 1, ideal: 2, extension: { note: 'Keep' } },
]) test('bound edits and clearing keep shorthand counts and metadata: ' + JSON.stringify(value), async a => {
  await importWork(a, value, 'bounds'); const expectedCounts = semantics(a).map(row => row.slice(0, 2));
  a.change('[data-countmin="day"]', '0'); assert.equal(P(a).countMinOf([1, 'day']), 0);
  a.change('[data-countideal="day"]', '1'); assert.equal(P(a).countIdealOf([1, 'day']), 1);
  for (const shift of ['day', 'night']) { a.change(`[data-countmin="${shift}"]`, ''); a.change(`[data-countideal="${shift}"]`, ''); }
  assert.equal(work(a).min, undefined); assert.equal(work(a).ideal, undefined);
  for (const count of Object.values(work(a).count)) if (count && typeof count === 'object') { assert.equal(count.min, undefined, 'cleared bound is not copied under count'); assert.equal(count.ideal, undefined); }
  assert.deepEqual(work(a).extension, value.extension); assert.deepEqual(semantics(a).map(row => row.slice(0, 2)), expectedCounts);
  a.A.readSettings(); assert.equal(work(a).min, undefined); assert.equal(work(a).ideal, undefined); assert.equal(a.A.state.rules.rule_states.count_target, 'off'); await savedReload(a, semantics(a));
});
test('explicit first ideal activates its rule without changing shorthand staffing', async a => {
  await importWork(a, { day: 2, night: 3 }, 'new ideal'); a.change('[data-countideal="day"]', '2');
  assert.equal(a.A.state.rules.rule_states.count_target, 'soft'); assert.equal(P(a).countOf([1, 'night']), 3); assert.equal(P(a).countIdealOf([1, 'day']), 2);
});
let highs = null;
test('real solver remains at 120 assignments after unrelated years edit', async a => {
  if (!highs) { console.log('SKIP real HiGHS (pass an installed package path)'); return; }
  await importWork(a, 2, 'solver'); const original = new a.w.T.Problem(clone(a.A.state.rules), clone(a.A.state.month));
  const before = a.w.T.solve(original, highs, { timeLimit: 3 }); assert.equal(before.status, 'Optimal');
  a.mode('daily'); a.change('#doctorTable tr[data-i="0"] [data-f="years"]', '12');
  const current = P(a), after = a.w.T.solve(current, highs, { timeLimit: 3 }); assert.equal(after.status, 'Optimal');
  for (const [p, result] of [[original, before], [current, after]]) { const checked = a.w.T.check(p, result.asg); assert.deepEqual(clone(checked.VC), []); assert.equal(p.slots.reduce((sum, s) => sum + checked.A.workers(s).length, 0), 120); }
  assert.deepEqual(clone(a.w.T.check(original, after.asg).VC), [], 'new solution satisfies immutable original staffing');
});
let passed = 0, failed = 0, finished = false;
const expectedCases = 26, watchdog = setTimeout(() => { console.error('Staffing shorthand regression timed out'); process.exit(1); }, 180000);
process.on('exit', () => { if (!finished || passed + failed !== expectedCases || failed) { console.error(`NOT PASSED: ${passed}/${expectedCases}; failed=${failed}; finished=${finished}`); process.exitCode = 1; } });
(async () => {
  assert.equal(cases.length, expectedCases, 'full planned matrix registered'); if (process.argv[2]) highs = await require(process.argv[2])();
  for (const { label, fn } of cases) { let a; try { a = await makeApp(); await fn(a); assert.deepEqual(a.errors, []); assert.deepEqual(a.alerts, []); passed++; console.log('PASS ' + label); } catch (e) { failed++; console.error('FAIL ' + label + '\n' + e.stack); } finally { a?.dom.window.close(); } }
  finished = true; clearTimeout(watchdog); console.log(`Staffing shorthand: ${passed}/${expectedCases} passed, ${failed} failed`); if (failed) process.exitCode = 1;
})().catch(e => { clearTimeout(watchdog); console.error(e.stack); process.exitCode = 1; });

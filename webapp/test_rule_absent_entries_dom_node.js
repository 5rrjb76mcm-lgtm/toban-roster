// Ordinary rule readback preserves absent people; explicit cleanup still removes their entries.
// Accepted profile-file imports, real delegated edits, registered read(P, rules),
// Problem, local save/reload. Fictional fixtures; jsdom is not a browser/layout test.
// TOBAN_DOM_MODULE=/installed/node_modules/jsdom node test_rule_absent_entries_dom_node.js
const fs = require('fs'), path = require('path'), assert = require('assert/strict');
const EXPECTED_CASES = 19;
let passed = 0, failed = 0, finished = false;
const watchdog = setTimeout(() => { console.error("Absent rule entry regression timed out"); process.exit(1); }, 120000);
process.on('exit', () => {
  if (!finished || passed !== EXPECTED_CASES || failed !== 0) {
    console.error(`Incomplete or failed absent rule entry regression: finished=${finished}, passed=${passed}, failed=${failed}, expected=${EXPECTED_CASES}`);
    process.exitCode = 1;
  }
});
let JSDOM;
for (const name of [process.env.TOBAN_DOM_MODULE, 'jsdom', path.join(process.env.HOME || '', '.toban-test/node_modules/jsdom')].filter(Boolean)) {
  try { ({ JSDOM } = require(name)); break; } catch (e) { if (e.code !== 'MODULE_NOT_FOUND') throw e; }
}
if (!JSDOM) throw new Error('Rule field ownership DOM regression requires jsdom 26.1.0. Set TOBAN_DOM_MODULE. This test was NOT run.');
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
const key = 'toban_state_v2:/synthetic/absent-rule-entry.html';
const tick = () => new Promise(resolve => setImmediate(resolve));
async function until(fn, label) { const end = Date.now() + 7000; while (!fn()) { if (Date.now() > end) throw new Error('Timed out: ' + label); await tick(); } }
async function makeApp(saved) {
  const dom = new JSDOM(source('index.html'), { url: 'https://example.invalid/synthetic/absent-rule-entry.html', runScripts: 'outside-only' }), w = dom.window;
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


const absent = 'Synthetic Absent';
const specs = [
 { field: 'weekend_dayshift_wish', rule: 'wish_weekend_dayshift', col: 'wkw', value: [names[0], absent], state: 'soft' },
 { field: 'friday_night_min', rule: 'friday_night_min', col: 'fri', value: { [names[0]]: 1, [absent]: 2 }, state: 'hard' },
 { field: 'dayoff_work_max', rule: 'dayoff_work_cap', col: 'dwm', value: { [names[0]]: 3, [absent]: 1 }, state: 'soft' },
];
async function fixture(a, extra = {}) {
 a.mode('build'); const R = clone(a.A.state.rules);
 for (const s of specs) { R[s.field] = clone(s.value); R.rule_states[s.rule] = s.state; }
 Object.assign(R, extra); R.profile.label = 'Synthetic imported';
 const el = a.q('#fileLoadProfile'); Object.defineProperty(el, 'files', { configurable: true, value: [{ name: 'synthetic.json', text: async () => JSON.stringify(R) }] });
 el.dispatchEvent(new a.w.Event('change', { bubbles: true }));
 await until(() => a.alerts.length || a.A.switching === 0 && a.A.state.rules.profile.label === R.profile.label, 'accepted profile import');
 assert.deepEqual(a.alerts, []);
 for (const s of specs) assert.deepEqual(clone(a.A.state.rules[s.field]), clone(R[s.field]), 'import retains ' + s.field);
}
const assertSaved = async (a, s, expected) => {
 const saved = a.w.localStorage.getItem(key); assert(saved); const b = await makeApp(saved);
 try { assert.deepEqual(clone(b.A.state.rules[s.field]), expected); assert.deepEqual(b.errors, []); } finally { b.w.close(); }
};
function toggle(a, rule, checked) { const el = a.q(`[data-ron="${rule}"]`); assert(el); el.checked = checked; el.dispatchEvent(new a.w.Event('change', { bubbles: true })); }
async function exportAction(a, roster) {
 const downloads = []; a.A.download = (name, blob) => downloads.push({ name, blob });
 a.q('#setExportRoster').checked = roster; a.click('#btnExportProfile');
 await until(() => downloads.length || a.alerts.length, 'profile export'); assert.deepEqual(a.alerts, []); assert.equal(downloads.length, 1);
 const txt = await new Promise((resolve, reject) => { const r = new a.w.FileReader(); r.onload = () => resolve(r.result); r.onerror = reject; r.readAsText(downloads[0].blob); });
 return JSON.parse(txt);
}
const cases = [], test = (name, fn) => cases.push({ name, fn });
for (const s of specs) {
 test(s.field + ': unrelated edit, repeated readback, model and save/reload', async a => {
  await fixture(a); const before = clone(new a.w.T.Problem(a.A.state.rules, a.A.state.month).prm[s.rule]);
  a.change('#setProfLabel', 'Synthetic renamed'); a.A.readSettings(); a.A.readSettings();
  assert.deepEqual(clone(a.A.state.rules[s.field]), s.value);
  assert.deepEqual(clone(new a.w.T.Problem(a.A.state.rules, a.A.state.month).prm[s.rule]), before);
  await assertSaved(a, s, s.value);
 });
 test(s.field + ': represented clear and replacement retain absent entry', async a => {
  await fixture(a); a.mode('daily'); const selector = `#doctorTable tr[data-i="0"] [data-f="${s.col}"]`, el = a.q(selector); assert(el); assert.equal(el.closest('[hidden]'), null);
  if (s.col === 'wkw') { el.checked = false; el.dispatchEvent(new a.w.Event('change', { bubbles: true })); }
  else a.change(selector, '');
  const cleared = s.col === 'wkw' ? [absent] : { [absent]: s.value[absent] };
  assert.deepEqual(clone(a.A.state.rules[s.field]), cleared); await assertSaved(a, s, cleared);
  if (s.col === 'wkw') { const x = a.q(selector); x.checked = true; x.dispatchEvent(new a.w.Event('change', { bubbles: true })); }
  else a.change(selector, '4');
  const updated = s.col === 'wkw' ? [absent, names[0]] : { [absent]: s.value[absent], [names[0]]: 4 };
  assert.deepEqual(clone(a.A.state.rules[s.field]), updated); await assertSaved(a, s, updated);
 });
 test(s.field + ': off/on does not prune', async a => {
  await fixture(a); toggle(a, s.rule, false); a.change('#setProfLabel', 'Synthetic off edit');
  assert.deepEqual(clone(a.A.state.rules[s.field]), s.value); toggle(a, s.rule, true);
  a.change('#setProfLabel', 'Synthetic on edit'); a.A.readSettings();
  assert.deepEqual(clone(a.A.state.rules[s.field]), s.value); await assertSaved(a, s, s.value);
 });
 test(s.field + ': actual roster-inclusive export preserves untouched import', async a => {
  await fixture(a); const directBefore = JSON.stringify(a.A.state.rules);
  assert.deepEqual(clone(a.A.profileForExport(true).rules[s.field]), s.value);
  assert.equal(JSON.stringify(a.A.state.rules), directBefore, 'export function does not mutate live rules');
  const exported = await exportAction(a, true);
  assert.deepEqual(exported[s.field], s.value); assert.deepEqual(clone(a.A.state.rules[s.field]), s.value);
  await assertSaved(a, s, s.value);
 });
 test(s.field + ': anonymous export clears untouched imported personal references without mutating live entries', async a => {
  await fixture(a); const before = JSON.stringify(a.A.state.rules), ex = a.A.profileForExport(false).rules;
  assert.equal(JSON.stringify(a.A.state.rules), before, 'direct anonymous export must not mutate live rules');
  assert(!JSON.stringify(ex).includes(absent)); assert(!JSON.stringify(ex).includes(names[0]));
  assert.deepEqual(clone(ex[s.field]), s.col === 'wkw' ? [ex.doctors[0].name] : {});
  const exported = await exportAction(a, false);
  assert(!JSON.stringify(exported).includes(absent)); assert(!JSON.stringify(exported).includes(names[0]));
  assert.deepEqual(exported[s.field], s.col === 'wkw' ? [exported.doctors[0].name] : {});
  assert.deepEqual(clone(a.A.state.rules[s.field]), s.value); await assertSaved(a, s, s.value);
 });
 test(s.field + ': explicit prune/purge and empty begin/end retain cleanup contract', async a => {
  await fixture(a); const before = JSON.stringify(a.A.state.rules), pruned = clone(a.A.state.rules);
  a.w.T.pruneRosterRefs(pruned);
  assert.deepEqual(clone(pruned[s.field]), s.col === 'wkw' ? [names[0]] : { [names[0]]: s.value[names[0]] });
  const purged = clone(a.A.state.rules); a.w.T.purgeRulesNames(purged, [names[0]]);
  assert.deepEqual(clone(purged[s.field]), s.col === 'wkw' ? [absent] : { [absent]: s.value[absent] });
  const col = a.w.T.rules.columnsAll().find(c => c.key === s.col), empty = clone(a.A.state.rules);
  col.end(empty, col.begin(empty)); assert.deepEqual(clone(empty[s.field]), s.col === 'wkw' ? [] : {});
  assert.equal(JSON.stringify(a.A.state.rules), before, 'cleanup of clones must not mutate live rules');
 });
}
test('legacy non-array wish value retains existing readback normalization', async a => {
 await fixture(a, { weekend_dayshift_wish: names[0] });
 a.change('#setProfLabel', 'Synthetic legacy wish');
 assert.deepEqual(clone(a.A.state.rules.weekend_dayshift_wish), [names[0]]);
 await assertSaved(a, specs[0], [names[0]]);
});
(async () => {
 assert.equal(cases.length, EXPECTED_CASES);
 for (const c of cases) { const a = await makeApp(); try { await c.fn(a); assert.deepEqual(a.errors, []); assert.deepEqual(a.alerts, []); passed++; console.log('PASS ' + c.name); }
 catch (e) { failed++; console.error('FAIL ' + c.name, e); } finally { a.w.close(); } }
 console.log(`absent rule entries: ${passed} passed, ${failed} failed, ${cases.length} total`);
 assert.equal(passed + failed, EXPECTED_CASES); finished = true; clearTimeout(watchdog); if (failed) process.exitCode = 1;
})().catch(e => { console.error(e); process.exitCode = 1; });

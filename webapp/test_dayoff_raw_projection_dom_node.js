// Untouched text projections preserve invalid cap evidence; only explicit edits correct it.
// Authored for local validation; NOT EXECUTED during the cloud static audit.
// Accepted profile-file imports, real delegated edits, registered read(P, rules),
// Problem, local save/reload. Fictional fixtures; jsdom is not a browser/layout test.
// TOBAN_DOM_MODULE=/installed/node_modules/jsdom node test_dayoff_raw_projection_dom_node.js
const fs = require('fs'), path = require('path'), assert = require('assert/strict');
const EXPECTED_CASES = 21;
let passed = 0, failed = 0, started = 0, ended = 0, finished = false;
const watchdog = setTimeout(() => { console.error("Dayoff raw projection regression timed out"); process.exit(1); }, 120000);
process.on('exit', () => {
  if (!finished || started !== EXPECTED_CASES || ended !== EXPECTED_CASES || passed !== EXPECTED_CASES || failed !== 0) {
    console.error(`Incomplete or failed dayoff raw projection regression: finished=${finished}, started=${started}, ended=${ended}, passed=${passed}, failed=${failed}, expected=${EXPECTED_CASES}`);
    process.exitCode = 1;
  }
});
let JSDOM;
for (const name of [process.env.TOBAN_DOM_MODULE, 'jsdom', path.join(process.env.HOME || '', '.toban-test/node_modules/jsdom')].filter(Boolean)) {
  try { ({ JSDOM } = require(name)); break; } catch (e) { if (e.code !== 'MODULE_NOT_FOUND') throw e; }
}
if (!JSDOM) throw new Error('Dayoff raw projection DOM regression requires jsdom 26.1.0. Set TOBAN_DOM_MODULE. This test was NOT run.');
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
const key = 'toban_state_v2:/synthetic/dayoff-raw-projection.html';
const tick = () => new Promise(resolve => setImmediate(resolve));
async function until(fn, label) { const end = Date.now() + 7000; while (!fn()) { if (Date.now() > end) throw new Error('Timed out: ' + label); await tick(); } }
async function makeApp(saved) {
  const dom = new JSDOM(source('index.html'), { url: 'https://example.invalid/synthetic/dayoff-raw-projection.html', runScripts: 'outside-only' }), w = dom.window;
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


const absent = 'Synthetic Absent', renamed = 'Synthetic Renamed';
const selector = '#doctorTable tr[data-i="0"] [data-f="dwm"]';
const cases = [], test = (name, fn) => cases.push({ name, fn });
const malformed = [
 { label: 'array singleton', raw: [2], shown: '2' },
 { label: 'empty array', raw: [], shown: '' },
 { label: 'null', raw: null, shown: '' },
 { label: 'embedded newline', raw: '1\n2', shown: '12' },
];
async function fixture(a, raw, present = true) {
 a.mode('build'); const R = clone(a.A.state.rules);
 R.rule_states.dayoff_work_cap = 'soft';
 R.dayoff_work_max = { [absent]: { note: 'Synthetic unknown entry' } };
 if (present) R.dayoff_work_max[names[0]] = clone(raw);
 R.profile.label = 'Synthetic imported';
 const el = a.q('#fileLoadProfile'); Object.defineProperty(el, 'files', { configurable: true, value: [{ name: 'synthetic.json', text: async () => JSON.stringify(R) }] });
 el.dispatchEvent(new a.w.Event('change', { bubbles: true }));
 await until(() => a.alerts.length || a.A.switching === 0 && a.A.state.rules.profile.label === R.profile.label, 'accepted profile import');
 assert.deepEqual(a.alerts, []); assert.deepEqual(clone(a.A.state.rules.dayoff_work_max), R.dayoff_work_max);
}
const problem = a => new a.w.T.Problem(a.A.state.rules, a.A.state.month);
function assertInvalid(a, raw, name = names[0]) {
 const map = a.A.state.rules.dayoff_work_max, P = problem(a);
 assert(Object.hasOwn(map, name)); assert.deepEqual(clone(map[name]), raw);
 assert(P.prm.dayoff_work_cap.bad.includes(name)); assert(!Object.hasOwn(P.prm.dayoff_work_cap.max, name));
 assert(a.w.T.lint(P).some(x => x.code === 'LINT_DAYOFF_WORK_BAD_VALUE' && x.args.who === name));
 assert.deepEqual(clone(map[absent]), { note: 'Synthetic unknown entry' });
}
async function reload(a, check) {
 const saved = a.w.localStorage.getItem(key); assert(saved); const b = await makeApp(saved);
 try { check(b); assert.deepEqual(b.errors, []); assert.deepEqual(b.alerts, []); } finally { b.w.close(); }
}
function toggle(a, checked) {
 const el = a.q('[data-ron="dayoff_work_cap"]'); assert(el); el.checked = checked; el.dispatchEvent(new a.w.Event('change', { bubbles: true }));
}
function inputThenBlur(a, value) {
 const el = a.q(selector); assert(el); el.focus(); el.value = value;
 el.dispatchEvent(new a.w.Event('input', { bubbles: true })); el.blur();
}
for (const spec of malformed) {
 test(spec.label + ': unrelated edit, repeated read, focus-only blur, save/reload retain evidence', async a => {
  await fixture(a, spec.raw); assertInvalid(a, spec.raw); a.mode('daily');
  assert.equal(a.q(selector).value, spec.shown, 'actual DOM projection');
  a.q(selector).focus(); a.q(selector).blur(); assertInvalid(a, spec.raw);
  a.change('#doctorTable tr[data-i="1"] [data-f="years"]', '7');
  a.mode('build'); a.change('#setProfLabel', 'Synthetic unrelated label'); a.A.readSettings(); a.A.readSettings();
  assertInvalid(a, spec.raw); await reload(a, b => assertInvalid(b, spec.raw));
 });
 test(spec.label + ': rename retains raw entry under new identity', async a => {
  await fixture(a, spec.raw); a.mode('daily'); a.change('#doctorTable tr[data-i="0"] [data-f="name"]', renamed);
  assert(!Object.hasOwn(a.A.state.rules.dayoff_work_max, names[0])); assertInvalid(a, spec.raw, renamed);
  await reload(a, b => assertInvalid(b, spec.raw, renamed));
 });
 test(spec.label + ': off/on retains source and evidence', async a => {
  await fixture(a, spec.raw); toggle(a, false);
  assert.equal(a.A.state.rules.rule_states.dayoff_work_cap, 'off'); assert.equal(a.q(selector), null);
  a.change('#setProfLabel', 'Synthetic off edit'); assert.deepEqual(clone(a.A.state.rules.dayoff_work_max[names[0]]), spec.raw);
  toggle(a, true); assert.equal(a.A.state.rules.rule_states.dayoff_work_cap, 'soft');
  a.change('#setProfLabel', 'Synthetic restored'); assertInvalid(a, spec.raw);
  await reload(a, b => assertInvalid(b, spec.raw));
 });
 test(spec.label + ': explicit fullwidth correction applies and survives read/save', async a => {
  await fixture(a, spec.raw); a.mode('daily'); inputThenBlur(a, '１２');
  assert.equal(a.A.state.rules.dayoff_work_max[names[0]], 12); a.A.readSettings();
  const P = problem(a); assert.equal(P.prm.dayoff_work_cap.max[names[0]], 12); assert(!P.prm.dayoff_work_cap.bad.includes(names[0]));
  assert.deepEqual(clone(a.A.state.rules.dayoff_work_max[absent]), { note: 'Synthetic unknown entry' });
  await reload(a, b => assert.equal(b.A.state.rules.dayoff_work_max[names[0]], 12));
 });
}
for (const spec of malformed.filter(x => x.shown === '')) test(spec.label + ': explicit input to already-blank projection clears on blur', async a => {
 await fixture(a, spec.raw); a.mode('daily'); assert.equal(a.q(selector).value, '');
 inputThenBlur(a, ''); assert(!Object.hasOwn(a.A.state.rules.dayoff_work_max, names[0]));
 assert(!problem(a).prm.dayoff_work_cap.bad.includes(names[0])); a.A.readSettings();
 assert(!Object.hasOwn(a.A.state.rules.dayoff_work_max, names[0]));
 await reload(a, b => assert(!Object.hasOwn(b.A.state.rules.dayoff_work_max, names[0])));
});
test('valid numeric string keeps semantics; explicit replacement and clear still work', async a => {
 await fixture(a, ' +2 '); const before = problem(a).prm.dayoff_work_cap.max[names[0]];
 a.change('#setProfLabel', 'Synthetic valid string'); assert.equal(problem(a).prm.dayoff_work_cap.max[names[0]], before); assert.equal(before, 2);
 a.mode('daily'); a.change(selector, '3'); assert.equal(a.A.state.rules.dayoff_work_max[names[0]], 3);
 a.change(selector, ''); assert(!Object.hasOwn(a.A.state.rules.dayoff_work_max, names[0]));
 await reload(a, b => assert(!Object.hasOwn(b.A.state.rules.dayoff_work_max, names[0])));
});
test('absent represented entry stays absent while unknown absent-person entry survives', async a => {
 await fixture(a, undefined, false); a.change('#setProfLabel', 'Synthetic absent value'); a.A.readSettings();
 assert.deepEqual(clone(a.A.state.rules.dayoff_work_max), { [absent]: { note: 'Synthetic unknown entry' } });
 await reload(a, b => assert.deepEqual(clone(b.A.state.rules.dayoff_work_max), { [absent]: { note: 'Synthetic unknown entry' } }));
});
test('empty begin/end cleanup and anonymous export still clear personal cap values', async a => {
 await fixture(a, [2]); const R = clone(a.A.state.rules), col = a.w.T.rules.columnsAll().find(c => c.key === 'dwm');
 col.end(R, col.begin(R)); assert.deepEqual(clone(R.dayoff_work_max), {});
 const before = JSON.stringify(a.A.state.rules), exported = a.A.profileForExport(false).rules;
 assert.deepEqual(clone(exported.dayoff_work_max), {}); assert.equal(JSON.stringify(a.A.state.rules), before);
});
(async () => {
 assert.equal(cases.length, EXPECTED_CASES);
 console.log(`REGISTERED ${cases.length}`);
 for (const c of cases) { started++; console.log('START ' + c.name); let a; try { a = await makeApp(); await c.fn(a); assert.deepEqual(a.errors, []); assert.deepEqual(a.alerts, []); passed++; console.log('PASS ' + c.name); }
 catch (e) { failed++; console.error('FAIL ' + c.name, e); } finally { if (a) a.w.close(); ended++; console.log('END ' + c.name); } }
 console.log(`dayoff raw projection: ${passed} passed, ${failed} failed, ${cases.length} registered, ${started} started, ${ended} ended`);
 assert.equal(started, EXPECTED_CASES); assert.equal(ended, EXPECTED_CASES); assert.equal(passed + failed, EXPECTED_CASES); finished = true; clearTimeout(watchdog); if (failed) process.exitCode = 1;
})().catch(e => { console.error(e); process.exitCode = 1; });

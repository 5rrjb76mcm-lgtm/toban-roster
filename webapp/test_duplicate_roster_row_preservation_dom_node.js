// Accepted duplicate names remain repairable, but each rendered row owns its attributes.
// Production imports, delegated controls, private export and local persistence; fictional data.
// Authored during a static-only audit. NOT RUN. Requires installed jsdom, no dependency install.
// Local: TOBAN_DOM_MODULE=/installed/node_modules/jsdom node test_duplicate_roster_row_preservation_dom_node.js
// Baseline: TOBAN_SOURCE_ROOT=/absolute/baseline/webapp node /absolute/patched/webapp/test_duplicate_roster_row_preservation_dom_node.js
const fs = require('fs'), path = require('path'), assert = require('assert/strict');
let JSDOM;
for (const name of [process.env.TOBAN_DOM_MODULE, 'jsdom', path.join(process.env.HOME || '', '.toban-test/node_modules/jsdom')].filter(Boolean)) {
  try { ({ JSDOM } = require(name)); break; } catch (e) { if (e.code !== 'MODULE_NOT_FOUND') throw e; }
}
if (!JSDOM) throw new Error('Duplicate roster row regression requires installed jsdom. This test was NOT run.');
const root = process.env.TOBAN_SOURCE_ROOT || __dirname;
const source = f => fs.readFileSync(path.join(root, 'src', f), 'utf8');
const scripts = ['i18n.js', 'rules-core.js', 'model.js', ...fs.readdirSync(path.join(root, 'src/calendars')).filter(f => f.endsWith('.js')).sort().map(f => 'calendars/' + f),
  'messages.js', 'solver.js', 'check.js', 'report.js', 'docxgen.js', 'plugins.js', 'merge.js', ...fs.readdirSync(path.join(root, 'src/rules')).filter(f => f.endsWith('.js')).sort().map(f => 'rules/' + f),
  'app-core.js', 'app-folder.js', 'app-month.js', 'app-input.js', 'app-settings.js', 'app-solve.js', 'app-main.js'];
const clone = x => x === undefined ? undefined : JSON.parse(JSON.stringify(x));
const names = ['Synthetic One', 'Synthetic Two', 'Synthetic Three', 'Synthetic Four'];
const rawRules = { profile: { id: 'synthetic-duplicate-row', label: 'Synthetic base', roles: [{ id: 'S', label: 'Staff', refs: [] }], shifts: [{ id: 'day', on: 'all' }, { id: 'night', on: 'all' }] },
  doctors: names.map((name, i) => ({ name, team: 'S', years: i + 1, quota: 10 + i })), rule_states: { oncall: 'off' }, weights: {} };
const rawMonth = { year: 2026, month: 11, notes: 'Synthetic duplicate row preservation' };
const key = 'toban_state_v2:/synthetic/duplicate-row.html';
const tick = () => new Promise(resolve => setImmediate(resolve));
async function until(fn, label) { const end = Date.now() + 7000; while (!fn()) { if (Date.now() > end) throw new Error('Timed out: ' + label); await tick(); } }
async function makeApp(saved) {
  const dom = new JSDOM(source('index.html'), { url: 'https://example.invalid/synthetic/duplicate-row.html', runScripts: 'outside-only' }), w = dom.window;
  await new Promise(resolve => w.document.readyState === 'complete' ? resolve() : w.addEventListener('load', resolve, { once: true }));
  const errors = [], alerts = [];
  w.addEventListener('error', e => { errors.push(String(e.error || e.message)); e.preventDefault(); });
  w.confirm = () => true; w.alert = msg => alerts.push(String(msg)); w.prompt = () => null;
  w.T = { DEFAULT_RULES: clone(rawRules), SAMPLE_MONTH: clone(rawMonth), PROFILES: [], LANGS_DATA: ['en', 'ja'].map(code => JSON.parse(fs.readFileSync(path.join(root, 'lang', code + '.json'), 'utf8'))) };
  for (const f of scripts) w.eval(source(f) + '\n//# sourceURL=' + f);
  const A = w.T.app; A.restoreFolder = () => {}; A.toast = () => {};
  w.localStorage.setItem('toban.lang', 'en');
  const initial = clone(rawRules); w.T.fillDefaultRules(initial);
  for (const d of w.T.RULE_DEFS) if (d.states.includes('off')) initial.rule_states[d.id] = 'off';
  w.T.fillDefaultRules(initial);
  w.localStorage.setItem(key, saved || JSON.stringify({ rules: initial, month: rawMonth, result: null, ui: { doctor: 0 } }));
  w.T.init();
  const q = s => w.document.querySelector(s), click = s => { assert(q(s), 'Missing ' + s); q(s).click(); };
  const change = (s, value) => { const el = q(s); assert(el, 'Missing ' + s); assert.equal(el.closest('[hidden]'), null, 'edit target is visible: ' + s); el.value = value; el.dispatchEvent(new w.Event('change', { bubbles: true })); };
  const mode = which => { click('.tab[data-tab="settings"]'); click(`[data-setmode="${which}"]`); };
  return { dom, w, A, q, click, change, mode, errors, alerts };
}
const field = (i, f) => `#doctorTable tr[data-i="${i}"] [data-f="${f}"]`;
const doctors = a => clone(a.A.state.rules.doctors);
async function apply(a, r, route) {
  if (route === 'file') {
    const el = a.q('#fileLoadProfile');
    Object.defineProperty(el, 'files', { configurable: true, value: [{ name: 'synthetic-duplicates.json', text: async () => JSON.stringify(r) }] });
    el.dispatchEvent(new a.w.Event('change', { bubbles: true }));
  } else if (route === 'json') {
    a.q('#rulesJson').value = JSON.stringify(r); a.click('#btnApplyRules');
  } else {
    a.w.T.PROFILES = [clone(r)]; a.A.renderSettings();
    a.q('#setProfile').value = r.profile.id; a.click('#btnLoadProfile');
  }
  await tick(); await until(() => a.A.switching === 0, route + ' import'); await tick();
  assert.deepEqual(a.alerts, []); assert.equal(a.A.state.rules.profile.id, r.profile.id);
  assert.deepEqual(doctors(a), r.doctors, 'duplicate imports remain accepted and raw row attributes are intact initially');
}
async function fixture(a, route, duplicate = true) {
  const r = clone(a.A.state.rules); r.profile.id = 'synthetic-incoming-duplicate-row'; r.profile.label = 'Synthetic imported rows';
  r.doctors = r.doctors.map((d, i) => ({ ...d, name: duplicate && i < 2 ? 'Synthetic Twin' : d.name,
    quals: ['Synthetic Qualification ' + i], local_person: { identity: 'row-' + i, nested: [i, { keep: i }] },
    local_column: { count: i + 1, token: 'original-row-' + i } }));
  r.name_order = r.doctors.map(d => d.name);
  await apply(a, r, route);
  return doctors(a);
}
async function exported(a) {
  const downloads = []; a.A.download = (name, blob) => downloads.push({ name, blob });
  a.mode('build'); a.q('#setExportRoster').checked = true; a.click('#btnExportProfile');
  await until(() => downloads.length || a.alerts.length, 'private export');
  assert.deepEqual(a.alerts, []); assert.equal(downloads.length, 1);
  return new Promise((resolve, reject) => { const reader = new a.w.FileReader(); reader.onload = () => resolve(JSON.parse(reader.result)); reader.onerror = reject; reader.readAsText(downloads[0].blob); });
}
async function reloadAssert(a, expected) {
  const b = await makeApp(a.w.localStorage.getItem(key));
  try { assert.deepEqual(doctors(b), expected); assert.deepEqual(b.errors, []); assert.deepEqual(b.alerts, []); }
  finally { b.w.close(); }
}
const cases = [], test = (label, fn) => cases.push({ label, fn });
for (const route of ['file', 'json', 'bundled']) {
  test(route + ': unrelated label edits retain every hidden row attribute', async a => {
    const expected = await fixture(a, route); a.mode('build');
    a.change('#setProfLabel', 'Synthetic edited label'); assert.deepEqual(doctors(a), expected);
    a.change('#setProfLabel', 'Synthetic edited twice'); assert.deepEqual(doctors(a), expected);
    await reloadAssert(a, expected);
  });
  test(route + ': changing one duplicate years field keeps both source objects', async a => {
    const expected = await fixture(a, route); a.mode('daily');
    a.change(field(0, 'years'), '17'); expected[0].years = 17;
    assert.deepEqual(doctors(a), expected); await reloadAssert(a, expected);
  });
  test(route + ': included export is lossless with duplicate names', async a => {
    const expected = await fixture(a, route), out = await exported(a);
    assert.deepEqual(out.doctors, expected); assert.deepEqual(doctors(a), expected);
    assert.equal(out.toban_profile.roster, 'included');
  });
  test(route + ': row move keeps both source objects through a second readback', async a => {
    const expected = await fixture(a, route); a.mode('daily');
    a.click('#doctorTable tr[data-i="0"] [data-act="down"]');
    [expected[0], expected[1]] = [expected[1], expected[0]]; assert.deepEqual(doctors(a), expected);
    a.mode('build'); a.change('#setProfLabel', 'Synthetic after move'); assert.deepEqual(doctors(a), expected);
  });
  test(route + ': repairing one duplicate retains only that row attributes', async a => {
    const expected = await fixture(a, route); a.mode('daily');
    a.change(field(0, 'name'), 'Synthetic Repaired Twin'); expected[0].name = 'Synthetic Repaired Twin';
    assert.deepEqual(doctors(a), expected);
    // Name-keyed month records cannot identify which original duplicate owned them.
    // Their existing rename policy is deliberately outside this attribute-only fix.
    assert(!a.w.T.lintPlugins(new a.w.T.Problem(a.A.state.rules, a.A.state.month)).some(x => x.code === 'LINT_NAME_DUP'));
  });
  test(route + ': visible plug-in reader receives its own row as prev', async a => {
    a.w.T.rules.register({ id: 'local.synthetic.row_identity', api: 1, states: ['hard', 'off'], def: 'off',
      columns: [{ key: 'local_column', field: 'local_column', label: 'Synthetic count',
        render(d, R, h) { return `<input data-local-count value="${h.esc(d.local_column?.count ?? 0)}">`; },
        read(td, d, R, acc, name, prev) { d.local_column = { ...prev.local_column, count: +td.querySelector('[data-local-count]').value }; } }] });
    const expected = await fixture(a, route); a.A.state.rules.rule_states['local.synthetic.row_identity'] = 'hard'; a.A.renderSettings(); a.mode('daily');
    a.change('#doctorTable tr[data-i="0"] [data-local-count]', '9'); expected[0].local_column.count = 9;
    assert.deepEqual(doctors(a), expected);
  });
  test(route + ': new roster row does not borrow duplicate metadata', async a => {
    const expected = await fixture(a, route); a.mode('daily'); a.w.prompt = () => 'Synthetic Added Person';
    a.click('#doctorTable [data-act="add"]'); assert.deepEqual(doctors(a).slice(0, expected.length), expected);
    const added = doctors(a).at(-1); assert.equal(added.name, 'Synthetic Added Person');
    assert.equal(added.local_person, undefined); assert.equal(added.local_column, undefined);
  });
}
test('unique-name rename retains attributes and follows month references', async a => {
  const expected = await fixture(a, 'file', false); a.mode('daily');
  a.A.state.month.unavailable_night[expected[0].name] = [7];
  a.change(field(0, 'name'), 'Synthetic Renamed Unique'); expected[0].name = 'Synthetic Renamed Unique';
  assert.deepEqual(doctors(a), expected); assert.deepEqual(clone(a.A.state.month.unavailable_night['Synthetic Renamed Unique']), [7]);
  assert.equal(a.A.state.month.unavailable_night[names[0]], undefined);
});
test('historical-name guard still rejects before attribute changes', async a => {
  await fixture(a, 'file', false); a.mode('daily');
  a.A.state.month.history.work_balance['Synthetic Former Person'] = 0;
  const before = JSON.stringify(a.A.state);
  a.change(field(0, 'name'), 'Synthetic Former Person');
  assert.equal(JSON.stringify(a.A.state), before); assert.equal(a.q(field(0, 'name')).value, names[0]);
});
const EXPECTED_CASES = 23, unhandled = [];
let passed = 0, failed = 0, started = 0, completed = 0, finished = false;
process.on('unhandledRejection', e => unhandled.push(String(e && e.stack || e)));
process.on('exit', () => { if (!finished || cases.length !== EXPECTED_CASES || started !== EXPECTED_CASES || completed !== EXPECTED_CASES || passed !== EXPECTED_CASES || failed) process.exitCode = 1; });
const watchdog = setTimeout(() => { console.error('Duplicate roster row regression timed out'); process.exit(1); }, 120000);
(async () => {
  assert.equal(cases.length, EXPECTED_CASES);
  for (const { label, fn } of cases) {
    let a; unhandled.length = 0; started++;
    try { a = await makeApp(); a.mode('build'); await fn(a); assert.deepEqual(a.errors, []); assert.deepEqual(a.alerts, []); assert.deepEqual(unhandled, []); passed++; console.log('PASS ' + label); }
    catch (e) { failed++; console.error('FAIL ' + label + '\n' + e.stack); }
    finally { completed++; a?.w.close(); }
  }
  finished = true; clearTimeout(watchdog);
  console.log(`Duplicate roster rows: ${passed}/${EXPECTED_CASES} passed, ${failed} failed`); if (failed) process.exitCode = 1;
})().catch(e => { clearTimeout(watchdog); console.error(e); process.exitCode = 1; });

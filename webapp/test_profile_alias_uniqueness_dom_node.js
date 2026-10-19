// Shared exports allocate globally unique staff aliases across role labels.
// Real DOM export/import and local persistence; synthetic data only. jsdom is not a layout test.
// TOBAN_DOM_MODULE=/installed/node_modules/jsdom node test_profile_alias_uniqueness_dom_node.js
const fs = require('fs'), path = require('path'), assert = require('assert/strict');
let JSDOM;
for (const name of [process.env.TOBAN_DOM_MODULE, 'jsdom', path.join(process.env.HOME || '', '.toban-test/node_modules/jsdom')].filter(Boolean)) {
  try { ({ JSDOM } = require(name)); break; } catch (e) { if (e.code !== 'MODULE_NOT_FOUND') throw e; }
}
if (!JSDOM) throw new Error('Profile alias uniqueness DOM regression requires jsdom 26.1.0. Set TOBAN_DOM_MODULE. This test was NOT run.');
const root = process.env.TOBAN_SOURCE_ROOT || __dirname;
const source = f => fs.readFileSync(path.join(root, 'src', f), 'utf8');
const scripts = ['i18n.js', 'rules-core.js', 'model.js', ...fs.readdirSync(path.join(root, 'src/calendars')).filter(f => f.endsWith('.js')).sort().map(f => 'calendars/' + f),
  'messages.js', 'solver.js', 'check.js', 'report.js', 'docxgen.js', 'plugins.js', 'merge.js', ...fs.readdirSync(path.join(root, 'src/rules')).filter(f => f.endsWith('.js')).sort().map(f => 'rules/' + f),
  'app-core.js', 'app-folder.js', 'app-month.js', 'app-input.js', 'app-settings.js', 'app-solve.js', 'app-main.js'];
const clone = x => x === undefined ? undefined : JSON.parse(JSON.stringify(x));
const names = ['Synthetic One', 'Synthetic Two', 'Synthetic Three', 'Synthetic Four'];
const rawRules = { profile: { id: 'synthetic-alias-uniqueness', label: 'Synthetic base', roles: [{ id: 'S', label: 'Staff', refs: [] }], shifts: [{ id: 'day', on: 'all' }, { id: 'night', on: 'all' }] },
  doctors: names.map(name => ({ name, team: 'S', quota: 15 })), rule_states: { oncall: 'off' }, weights: {} };
const rawMonth = { year: 2026, month: 11, notes: 'Synthetic profile import preservation' };
const key = 'toban_state_v2:/synthetic/profile-alias-uniqueness.html';
const tick = () => new Promise(resolve => setImmediate(resolve));
async function until(fn, label) { const end = Date.now() + 7000; while (!fn()) { if (Date.now() > end) throw new Error('Timed out: ' + label); await tick(); } }
async function makeApp(saved) {
  const dom = new JSDOM(source('index.html'), { url: 'https://example.invalid/synthetic/profile-alias-uniqueness.html', runScripts: 'outside-only' }), w = dom.window;
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
async function exportFile(a, withRoster = false) {
  let exported;
  a.A.download = (name, blob) => { const reader = new a.w.FileReader(); reader.onload = () => { exported = JSON.parse(reader.result); }; reader.onerror = () => a.errors.push('FileReader failed'); reader.readAsText(blob); };
  a.q('#setExportRoster').checked = withRoster; a.click('#btnExportProfile');
  await until(() => exported || a.alerts.length, 'alias export');
  assert.deepEqual(a.alerts, []); assert(exported); return exported;
}
async function importFile(a, rules) {
  const el = a.q('#fileLoadProfile');
  Object.defineProperty(el, 'files', { configurable: true, value: [{ name: 'synthetic-aliases.json', text: async () => JSON.stringify(rules) }] });
  el.dispatchEvent(new a.w.Event('change', { bubbles: true }));
  await tick(); await until(() => a.A.switching === 0, 'alias import');
}
function fixture(a, labels, teams) {
  const r = clone(a.A.state.rules);
  r.profile.roles = labels.map((label, i) => ({ id: 'R' + i, label, refs: [] }));
  r.doctors = teams.map((team, i) => ({ name: 'Synthetic Alias Person ' + (i + 1), team: 'R' + team, quota: i + 2, share: i + 1, years: 20 + i }));
  r.name_order = r.doctors.map(d => d.name).reverse();
  r.local_alias_refs = { first: r.doctors[0].name, pair: [r.doctors[0].name, r.doctors[r.doctors.length - 1].name] };
  a.A.state.rules = r; a.A.state.month = a.w.T.normalizeMonth({ year: 2026, month: 11 }, r);
  a.A.renderAll(); a.mode('build'); assert.notEqual(a.A.readSettings(), false);
  return clone(a.A.state.rules);
}
const configurations = [
  ['forward digit collision', ['Staff', 'Staff1'], [...Array(11).fill(0), 1]],
  ['reverse digit collision', ['Staff', 'Staff1'], [1, ...Array(11).fill(0)]],
  ['interleaved digit collision', ['Staff', 'Staff1'], [...Array(5).fill(0), 1, ...Array(6).fill(0)]],
  ['multiple numeric prefixes', ['Staff', 'Staff1', 'Staff11'], [...Array(11).fill(0), ...Array(11).fill(1), 2]],
  ['ordinary labels', ['Staff', 'Other'], [0, 1, 0, 1]],
  ['same label on different roles', ['Staff', 'Staff'], [0, 1, 0, 1]],
];
for (const [label, labels, teams] of configurations) test(label + ' stays unique through export and import', async a => {
  const original = fixture(a, labels, teams), before = JSON.stringify(a.A.state);
  const r = await exportFile(a), aliases = r.doctors.map(d => d.name);
  assert.equal(new Set(aliases).size, original.doctors.length);
  assert.equal(r.doctors.length, original.doctors.length);
  assert.deepEqual(r.doctors.map(d => [d.team, d.quota, d.share]), original.doctors.map(d => [d.team, d.quota, d.share]));
  const mapping = new Map(original.doctors.map((d, i) => [d.name, aliases[i]]));
  assert.deepEqual(r.name_order, original.name_order.map(n => mapping.get(n)));
  assert.deepEqual(r.local_alias_refs, { first: aliases[0], pair: [aliases[0], aliases[aliases.length - 1]] });
  assert.deepEqual(r.toban_profile, { version: 1, roster: 'placeholder' });
  for (const d of original.doctors) assert(!JSON.stringify(r).includes(d.name));
  assert(r.doctors.every(d => !Object.hasOwn(d, 'years')));
  assert.equal(JSON.stringify(a.A.state), before, 'shared export does not mutate live state');
  assert.deepEqual(await exportFile(a), r, 'same input gives deterministic aliases');
  if (label === 'ordinary labels') assert.deepEqual(aliases, ['Staff1', 'Other1', 'Staff2', 'Other2']);
  if (label === 'same label on different roles') assert.deepEqual(aliases, ['Staff1', 'Staff2', 'Staff3', 'Staff4']);
  await importFile(a, r);
  assert.deepEqual(clone(a.A.state.rules.doctors), r.doctors);
  assert.deepEqual(clone(a.A.state.rules.name_order), r.name_order);
  const P = new a.w.T.Problem(a.A.state.rules, a.A.state.month);
  assert.equal(Object.keys(P.doctors).length, original.doctors.length);
  for (const d of r.doctors) { assert.equal(P.doctors[d.name].team, d.team); assert.equal(P.doctors[d.name].quota, d.quota); }
  assert(!a.w.T.lintPlugins(P).some(x => x.code === 'LINT_NAME_DUP'));
});
test('included export retains original names and metadata with colliding role labels', async a => {
  const original = fixture(a, ['Staff', 'Staff1'], [...Array(11).fill(0), 1]), before = JSON.stringify(a.A.state);
  const r = await exportFile(a, true); delete r.toban_profile;
  assert.deepEqual(r, original); assert.equal(JSON.stringify(a.A.state), before);
});
const EXPECTED_CASES = 7; let passed = 0, failed = 0, started = 0, ended = 0, finished = false;
process.on('exit', () => {
  console.log(`ACCOUNTING registered=${cases.length} started=${started} ended=${ended} passed=${passed} failed=${failed} finished=${finished}`);
  if (!finished || cases.length !== EXPECTED_CASES || started !== EXPECTED_CASES || ended !== EXPECTED_CASES || passed !== EXPECTED_CASES || failed) process.exitCode = 1;
});
const watchdog = setTimeout(() => { console.error('Profile alias uniqueness regression timed out'); process.exit(1); }, 120000);
(async () => {
  assert.equal(cases.length, EXPECTED_CASES);
  for (const { label, fn } of cases) {
    started++; console.log('START ' + label);
    let a;
    try { a = await makeApp(); a.mode('build'); await fn(a); assert.deepEqual(a.errors, []); assert.deepEqual(a.alerts, []); passed++; console.log('PASS ' + label); }
    catch (e) { failed++; console.error('FAIL ' + label + '\n' + e.stack); }
    finally { a?.w.close(); ended++; console.log('END ' + label); }
  }
  finished = true; clearTimeout(watchdog); console.log(`Profile alias uniqueness: ${passed}/${EXPECTED_CASES} passed, ${failed} failed`); if (failed) process.exitCode = 1;
})().catch(e => { clearTimeout(watchdog); console.error(e); process.exitCode = 1; });

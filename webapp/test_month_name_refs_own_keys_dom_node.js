// Static-authored post55 candidate. NOT executed during preparation.
// Real import, render, delegated purge, Undo and persistence. Synthetic names only.
// Negative control: TOBAN_WEBAPP_ROOT=/absolute/unchanged/webapp node this-file.js
// jsdom supplies DOM only. No browser/layout, network or OS-folder claim.
const fs = require('fs'), path = require('path'), assert = require('assert/strict');
const ROOT = path.resolve(process.env.TOBAN_WEBAPP_ROOT || __dirname);
console.log('SOURCE_ROOT ' + ROOT);
let JSDOM;
for (const name of [process.env.TOBAN_DOM_MODULE, 'jsdom', path.join(process.env.HOME || '', '.toban-test/node_modules/jsdom')].filter(Boolean)) {
  try { ({ JSDOM } = require(name)); break; } catch (e) { if (e.code !== 'MODULE_NOT_FOUND') throw e; }
}
if (!JSDOM) throw new Error('Requires installed jsdom 26.1.0. No installation or skip.');
const source = f => fs.readFileSync(path.join(ROOT, 'src', f), 'utf8');
const scripts = ['i18n.js', 'rules-core.js', 'model.js',
  ...fs.readdirSync(path.join(ROOT, 'src/calendars')).filter(f => f.endsWith('.js')).sort().map(f => 'calendars/' + f),
  'messages.js', 'solver.js', 'check.js', 'report.js', 'docxgen.js', 'plugins.js', 'merge.js',
  ...fs.readdirSync(path.join(ROOT, 'src/rules')).filter(f => f.endsWith('.js')).sort().map(f => 'rules/' + f),
  'app-core.js', 'app-folder.js', 'app-month.js', 'app-input.js', 'app-settings.js', 'app-solve.js', 'app-main.js'];
const clone = x => JSON.parse(JSON.stringify(x));
const N = ['Synthetic Trainer', 'Synthetic Colleague'];
const FORMER = ['Synthetic Former Staff', '__proto__', 'constructor', 'toString'];
const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const keyed = (name, value) => Object.fromEntries([[name, value]]);
const key = 'toban_state_v2:/synthetic/name-refs.html';
const rawRules = { profile: { id: 'synthetic-name-refs', roles: [{ id: 'S', label: 'Staff', refs: [] }],
  shifts: [{ id: 'day', on: 'all' }, { id: 'night', on: 'all' }] },
  doctors: N.map(name => ({ name, team: 'S', quota: 15 })), rule_states: { oncall: 'off' }, weights: {} };
const rawMonth = { year: 2026, month: 11, next_first_day_in_calendar: true, notes: 'Synthetic own-name references' };
const prototypeCode = '[Object.prototype, Object, Object.prototype.toString].map(x => Object.getOwnPropertyDescriptors(x))';
async function app(saved) {
  const dom = new JSDOM(source('index.html'), { url: 'https://example.invalid/synthetic/name-refs.html', runScripts: 'outside-only' }), w = dom.window;
  await new Promise(resolve => w.document.readyState === 'complete' ? resolve() : w.addEventListener('load', resolve, { once: true }));
  const errors = [], alerts = [];
  w.addEventListener('error', e => { errors.push(String(e.error || e.message)); e.preventDefault(); });
  w.confirm = () => true; w.alert = message => alerts.push(String(message)); w.prompt = () => null;
  w.T = { DEFAULT_RULES: clone(rawRules), SAMPLE_MONTH: clone(rawMonth), PROFILES: [],
    LANGS_DATA: ['en', 'ja'].map(code => JSON.parse(fs.readFileSync(path.join(ROOT, 'lang', code + '.json'), 'utf8'))) };
  for (const f of scripts) w.eval(source(f) + '\n//# sourceURL=' + f);
  const A = w.T.app; A.restoreFolder = () => {}; A.toast = () => {};
  w.localStorage.setItem('toban.lang', 'en');
  const initial = clone(rawRules); w.T.fillDefaultRules(initial);
  for (const def of w.T.RULE_DEFS) if (def.states.includes('off')) initial.rule_states[def.id] = 'off';
  w.T.fillDefaultRules(initial);
  w.localStorage.setItem(key, saved || JSON.stringify({ rules: initial, month: rawMonth, result: null, ui: { doctor: 1 } }));
  const before = w.eval(prototypeCode); w.T.init();
  const q = s => w.document.querySelector(s);
  const click = s => { assert(q(s), 'Missing ' + s); q(s).click(); };
  const change = (s, value) => { const el = q(s); assert(el, 'Missing ' + s); el.value = value; el.dispatchEvent(new w.Event('change', { bubbles: true })); };
  return { w, A, q, click, change, alerts, errors, async done() {
    try { await Promise.resolve(); assert.deepEqual(errors, []); assert.deepEqual(alerts, []);
      assert.deepEqual(w.eval(prototypeCode), before, 'No prototype or inherited-function mutation');
    } finally { dom.window.close(); }
  } };
}
async function imported(a, name) {
  a.A.choose = async () => 'go';
  await a.A.loadJsonFile({ name: 'synthetic-name-refs.json', text: async () => JSON.stringify({
    rules: clone(a.A.state.rules), month: { ...rawMonth, wishes: { weekend_dayshift: [N[0], name, N[1], name] },
      history: { work_balance: keyed(name, 7) }, day_notes: { 9: 'Synthetic retained note' } }, result: null }) });
  assert.deepEqual(a.alerts, [], 'Import completes without a caught render error');
  assert(a.q('#btnPurgeUnknown'), 'Unknown-name cleanup stays reachable');
  assert(a.q('#monthSettings').textContent.includes(name), 'Unknown name is displayed as text');
}
// Exercise every name-bearing route, without making these former staff roster members.
const branches = [
  ['duty_days', n => ({ duty_days: keyed(n, { 5: { am: 'ward' } }) })],
  ['regular_duties', n => ({ regular_duties: keyed(n, [{ dow: 'Mon', part: 'am', kind: 'ward' }]) })],
  ['unavailable', n => ({ unavailable_night: keyed(n, [5]) })],
  ['wishes', n => ({ wishes: { night_on: keyed(n, [5]) } })],
  ['count_limits', n => ({ count_min: keyed(n, 0) })],
  ['count_limits', n => ({ count_max: keyed(n, 0) })],
  ['targets', n => ({ targets: keyed(n, 0) })],
  ['wishes', n => ({ wishes: { day_on: keyed(n, [5]) } })],
  ['unavailable', n => ({ unavailable_other: [{ name: n, day: 5, part: 'day' }] })],
  ['wishes', n => ({ wishes: { weekend_dayshift: [n, n] } })],
  ['avoid', n => ({ avoid: [{ name: n, day: 5, part: 'night' }] })],
  ['confirmed_pm_external_night', n => ({ confirmed_pm_external_night: [{ name: n, day: 5 }] })],
  ...['night', 'day', 'weekend_charge', 'day_oc', 'night_oc'].map(k => ['fixed', n => ({ fixed: { [k]: { 5: k.endsWith('_oc') ? [n] : n } } })]),
  ['fixed', n => ({ fixed_tags: { ['5:night|' + n]: 'Synthetic training' } })],
  ['person_days', n => ({ person_days: { 'local.synthetic': keyed(n, { 5: 'yes' }) } })],
];
const cases = [], test = (name, fn) => cases.push({ name, fn });
for (const name of FORMER) {
  test('all reference routes use own keys: ' + name, async () => {
    const a = await app(); try {
      for (const [kind, make] of branches) {
        const m = make(name), before = JSON.stringify(m), refs = a.w.T.monthNameRefs(m);
        assert(own(refs, name), 'Own key for ' + kind); assert.equal(Object.getPrototypeOf(refs), a.w.Object.prototype);
        assert.deepEqual(clone(refs), keyed(name, [kind])); assert.equal(JSON.stringify(m), before);
      }
      const refs = a.w.T.monthNameRefs({ wishes: { weekend_dayshift: [name, name] }, fixed: { night: { 5: name, 6: name } } });
      assert.deepEqual(clone(refs), keyed(name, ['wishes', 'fixed']), 'Kinds are de-duplicated in original order');
    } finally { await a.done(); }
  });
  test('import/read/export/reload preserves unknown input: ' + name, async () => {
    const a = await app(); try {
      await imported(a, name); const expected = [N[0], name, N[1], name];
      a.click('.tab[data-tab="input"]'); a.click('.sub[data-sub="monthSettings"]');
      a.change('[data-path="notes"]', 'Synthetic unrelated edit');
      for (let i = 0; i < 3; i++) { a.A.readAll(); a.A.renderSettingsMonth(); }
      assert.deepEqual(clone(a.A.state.month.wishes.weekend_dayshift), expected);
      assert.deepEqual(JSON.parse(a.A.payloadJson()).month.wishes.weekend_dayshift, expected);
      const b = await app(a.w.localStorage.getItem(key)); try {
        assert(b.q('#btnPurgeUnknown')); assert.deepEqual(clone(b.A.state.month.wishes.weekend_dayshift), expected);
        assert.equal(b.A.state.month.history.work_balance[name], 7);
      } finally { await b.done(); }
    } finally { await a.done(); }
  });
  for (const consent of [false, true]) test('explicit purge consent=' + consent + ': ' + name, async () => {
    const a = await app(); try {
      await imported(a, name); a.click('.tab[data-tab="input"]'); a.click('.sub[data-sub="monthSettings"]'); a.A.clearUndo();
      const original = clone(a.A.state.month.wishes.weekend_dayshift); let asked = 0;
      a.w.confirm = () => { asked++; return consent; }; a.click('#btnPurgeUnknown');
      await Promise.resolve(); // Settle pushUndo's after/afterRules checkpoint before ordinary user Undo.
      assert.equal(asked, 1); assert.deepEqual(clone(a.A.state.month.wishes.weekend_dayshift), consent ? N : original);
      assert.equal(a.A.state.month.history.work_balance[name], 7, 'Historical record is not current input');
      assert.equal(a.A.state.month.day_notes[9], 'Synthetic retained note');
      a.A.readAll(); assert.deepEqual(clone(a.A.state.month.wishes.weekend_dayshift), consent ? N : original);
      if (consent) { assert.equal(a.q('#btnPurgeUnknown'), null); a.A.undo();
        assert.deepEqual(clone(a.A.state.month.wishes.weekend_dayshift), original); assert(a.q('#btnPurgeUnknown')); }
    } finally { await a.done(); }
  });
}
test('empty and historical-only names do not become current references', async () => {
  const a = await app(); try {
    const m = { history: { work_balance: keyed('__proto__', 3) }, prev_month: { last_days: [{ date: 31, night: 'constructor' }] },
      wishes: { weekend_dayshift: ['', null] }, targets: keyed('toString', null), unavailable_night: keyed('constructor', []) };
    const before = JSON.stringify(m); assert.deepEqual(clone(a.w.T.monthNameRefs(m)), {}); assert.equal(JSON.stringify(m), before);
  } finally { await a.done(); }
});
const EXPECTED = 17; assert.equal(cases.length, EXPECTED);
for (const c of cases) console.log('REGISTER ' + c.name);
let completed = 0, passed = 0, finished = false;
const timer = setTimeout(() => { console.error('TIMEOUT own-name references'); process.exit(1); }, 120000);
process.on('exit', () => { if (!finished || completed !== EXPECTED || passed !== EXPECTED) process.exitCode = 1; });
(async () => {
  for (const c of cases) { console.log('CASE_START ' + c.name); try { await c.fn(); passed++; console.log('PASS ' + c.name); }
    catch (e) { console.error('FAIL ' + c.name + '\n' + (e.stack || e)); }
    finally { completed++; console.log('CASE_END ' + c.name); } }
  finished = true; clearTimeout(timer); console.log(`${passed}/${EXPECTED} passed; ${completed} completed`); process.exitCode = passed === EXPECTED ? 0 : 1;
})().catch(e => { console.error(e); clearTimeout(timer); process.exitCode = 1; });

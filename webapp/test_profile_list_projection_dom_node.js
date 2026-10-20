// Profile-builder list readback preserves the raw records behind a sanitized text input.
// Fictional saved JSON; real markup, delegated events, model readers and localStorage.
// No calendar-form edits, browser/layout checks, imports or solver runs are involved.
// Authored for local verification; do not infer a pass from the presence of this file.
// TOBAN_DOM_MODULE=/installed/node_modules/jsdom node test_profile_list_projection_dom_node.js
const fs = require('fs'), path = require('path'), assert = require('assert/strict');
const EXPECTED_CASES = 20;
let passed = 0, failed = 0, finished = false;
const watchdog = setTimeout(() => { console.error('Profile-list regression timed out'); process.exit(1); }, 120000);
process.on('exit', () => {
  if (!finished || passed !== EXPECTED_CASES || failed) {
    console.error(`Incomplete profile-list regression: finished=${finished}, passed=${passed}, failed=${failed}, expected=${EXPECTED_CASES}`);
    process.exitCode = 1;
  }
});
let JSDOM;
for (const name of [process.env.TOBAN_DOM_MODULE, 'jsdom', path.join(process.env.HOME || '', '.toban-test/node_modules/jsdom')].filter(Boolean)) {
  try { ({ JSDOM } = require(name)); break; } catch (e) { if (e.code !== 'MODULE_NOT_FOUND') throw e; }
}
if (!JSDOM) throw new Error('Profile-list regression requires an installed jsdom 26.1.0. Set TOBAN_DOM_MODULE. This test was NOT run.');
const root = process.env.TOBAN_SOURCE_ROOT || __dirname;
const source = f => fs.readFileSync(path.join(root, 'src', f), 'utf8');
const scripts = ['i18n.js', 'rules-core.js', 'model.js',
  ...fs.readdirSync(path.join(root, 'src/calendars')).filter(f => f.endsWith('.js')).sort().map(f => 'calendars/' + f),
  'messages.js', 'solver.js', 'check.js', 'report.js', 'docxgen.js', 'plugins.js', 'merge.js',
  ...fs.readdirSync(path.join(root, 'src/rules')).filter(f => f.endsWith('.js')).sort().map(f => 'rules/' + f),
  'app-core.js', 'app-folder.js', 'app-month.js', 'app-input.js', 'app-settings.js', 'app-solve.js', 'app-main.js'];
const clone = x => x === undefined ? undefined : JSON.parse(JSON.stringify(x));
const key = 'toban_state_v2:/synthetic/profile-list-projection.html';
const families = [
  { name: 'fixed tags', key: 'fixed_tags', selector: '#setFixedTags' },
  { name: 'day flags', key: 'day_flags', selector: '#setDayFlags' },
];
function fixture(nul = true) {
  const gap = nul ? '\u0000\r\n' : '';
  return {
    profile: { id: 'synthetic-list-projection', label: 'Synthetic lists',
      roles: [{ id: 'S', label: 'Staff', refs: [] }],
      shifts: [{ id: 'day', label: 'Day', on: 'all' }, { id: 'night', label: 'Night', on: 'all' }],
      fixed_tags: [{ label: 'Training' + gap + 'Day', shifts: ['day'], local_tag: { keep: 'Synthetic tag metadata' } }, { label: 'Review', shifts: ['night'] }],
      day_flags: [{ id: 'training', label: { en: 'Training' + gap + 'Day', ja: '研修' + gap + '日' },
        short: { en: 'Tr', ja: '研' }, local_flag: { keep: 'Synthetic flag metadata' } }, { id: 'review', label: 'Review', short: 'Rv' }],
    },
    doctors: ['Synthetic One', 'Synthetic Two'].map(name => ({ name, team: 'S', quota: 15 })),
    weights: {}, rule_states: { oncall: 'off' },
  };
}
async function makeApp(lang, initial, saved) {
  const dom = new JSDOM(source('index.html'), { url: 'https://example.invalid/synthetic/profile-list-projection.html', runScripts: 'outside-only' });
  const w = dom.window;
  await new Promise(resolve => w.document.readyState === 'complete' ? resolve() : w.addEventListener('load', resolve, { once: true }));
  const errors = [];
  w.addEventListener('error', ev => { errors.push(String(ev.error || ev.message)); ev.preventDefault(); });
  w.confirm = () => true; w.prompt = () => null; w.alert = msg => errors.push(String(msg));
  const month = { year: 2026, month: 11, day_flags: { 7: ['training'] }, notes: 'Synthetic monthly record' };
  w.T = { DEFAULT_RULES: clone(initial), SAMPLE_MONTH: clone(month), PROFILES: [],
    LANGS_DATA: ['en', 'ja'].map(code => JSON.parse(fs.readFileSync(path.join(root, 'lang', code + '.json'), 'utf8'))) };
  for (const file of scripts) w.eval(source(file) + '\n//# sourceURL=' + file);
  const A = w.T.app; A.restoreFolder = () => {}; A.toast = () => {}; // Only OS folder restoration and transient text are suppressed.
  const rules = clone(initial); w.T.fillDefaultRules(rules);
  for (const def of w.T.RULE_DEFS) if (def.states.includes('off')) rules.rule_states[def.id] = 'off';
  w.T.fillDefaultRules(rules);
  w.localStorage.setItem('toban.lang', lang);
  w.localStorage.setItem(key, saved || JSON.stringify({ rules, month, result: null, ui: {} }));
  w.T.init();
  const q = selector => w.document.querySelector(selector);
  q('.tab[data-tab="settings"]').click(); q('[data-setmode="build"]').click();
  const change = (selector, value) => {
    const input = q(selector); assert(input, 'Missing ' + selector);
    assert.equal(input.closest('[hidden]'), null, 'The edited input is visible');
    input.value = value; input.dispatchEvent(new w.Event('change', { bubbles: true }));
  };
  return { dom, w, A, q, change, errors };
}
const lists = a => clone(Object.fromEntries(families.map(f => [f.key, a.A.state.rules.profile[f.key]])));
const effective = a => clone({
  tags: a.w.T.calendarExt.merged(a.A.state.rules).fixedTags,
  flags: a.w.T.dayFlags.activeFor(a.A.state.rules).map(x => ({ id: x.id, label: x.label, short: x.short })),
});
function assertOriginal(a, expected, semantics, month) {
  assert.deepEqual(lists(a), expected, 'Raw labels, IDs, translations, restrictions and metadata survive');
  assert.deepEqual(effective(a), semantics, 'Effective tag restrictions and active flag definitions survive');
  assert.deepEqual(clone(a.A.state.month), month, 'Profile-list readback never edits the monthly records');
}
async function assertReload(a, lang, initial, expected, month) {
  const saved = a.w.localStorage.getItem(key); assert(saved);
  const b = await makeApp(lang, initial, saved);
  try {
    b.A.readSettings(); b.A.readSettings();
    assert.deepEqual(lists(b), expected, 'Repeated read and reload retain the intended list');
    assert.deepEqual(clone(b.A.state.month), month); assert.deepEqual(b.errors, []);
  } finally { b.w.close(); }
}
const cases = [], test = (name, lang, nul, fn) => cases.push({ name, lang, nul, fn });
for (const lang of ['en', 'ja']) for (const family of families) {
  test(`${lang}: ${family.name} unchanged sanitized projection survives sibling edit and reload`, lang, true, async (a, initial) => {
    const before = lists(a), semantics = effective(a), month = clone(a.A.state.month);
    assert(a.q(family.selector).value.includes('\uFFFD'), 'HTML NUL projection is visible');
    assert(!a.q(family.selector).value.includes('\u0000'));
    a.change('#setProfLabel', 'Synthetic renamed facility'); a.A.readSettings(); a.A.readSettings();
    assertOriginal(a, before, semantics, month); await assertReload(a, lang, initial, before, month);
  });
  test(`${lang}: ${family.name} append and remove retain the existing raw object`, lang, true, async (a, initial) => {
    const before = lists(a), month = clone(a.A.state.month), shown = a.q(family.selector).value;
    a.change(family.selector, shown + '・New item');
    const expected = { ...before, [family.key]: [...before[family.key], 'New item'] };
    assert.deepEqual(lists(a), expected);
    if (family.key === 'fixed_tags') assert.deepEqual(effective(a).tags[0].shifts, ['day']);
    else assert.equal(effective(a).flags[0].id, 'training');
    await assertReload(a, lang, initial, expected, month);
    a.change(family.selector, shown);
    assert.deepEqual(lists(a), before, 'Removing only the new entry retains every existing raw object');
    await assertReload(a, lang, initial, before, month);
  });
  test(`${lang}: ${family.name} deliberate replacement is not undone`, lang, true, async (a, initial) => {
    const before = lists(a), month = clone(a.A.state.month);
    a.change(family.selector, 'Replacement');
    const expected = { ...before, [family.key]: ['Replacement'] };
    assert.deepEqual(lists(a), expected); await assertReload(a, lang, initial, expected, month);
  });
  test(`${lang}: ${family.name} deliberate clearing removes only that list`, lang, true, async (a, initial) => {
    const before = lists(a), month = clone(a.A.state.month);
    a.change(family.selector, '');
    const expected = { ...before }; delete expected[family.key];
    assert.equal(Object.hasOwn(a.A.state.rules.profile, family.key), false);
    assert.deepEqual(lists(a), expected); await assertReload(a, lang, initial, expected, month);
  });
  test(`${lang}: ordinary ${family.name} add, remove and clear keep existing behavior`, lang, false, async (a, initial) => {
    const before = lists(a), semantics = effective(a), month = clone(a.A.state.month), shown = a.q(family.selector).value;
    a.change('#setProfLabel', 'Synthetic ordinary facility');
    assertOriginal(a, before, semantics, month);
    a.change(family.selector, shown + '・New item');
    assert.deepEqual(lists(a), { ...before, [family.key]: [...before[family.key], 'New item'] });
    a.change(family.selector, shown); assertOriginal(a, before, semantics, month);
    a.change(family.selector, ''); const expected = { ...before }; delete expected[family.key];
    assert.deepEqual(lists(a), expected); await assertReload(a, lang, initial, expected, month);
  });
}
(async () => {
  assert.equal(cases.length, EXPECTED_CASES);
  for (const c of cases) {
    const initial = fixture(c.nul), a = await makeApp(c.lang, initial);
    try { await c.fn(a, initial); assert.deepEqual(a.errors, []); passed++; console.log('PASS ' + c.name); }
    catch (e) { failed++; console.error('FAIL ' + c.name, e); }
    finally { a.w.close(); }
  }
  finished = true;
  clearTimeout(watchdog);
  console.log(`profile-list projection: ${passed}/${EXPECTED_CASES} passed, ${failed} failed`);
})().catch(e => { clearTimeout(watchdog); console.error(e); process.exitCode = 1; });

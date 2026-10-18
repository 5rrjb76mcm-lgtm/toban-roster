// Month and doctor-calendar flag controls preserve exact imported IDs and untouched data.
// Real markup, delegated events, JSON download/import, localStorage reload, Undo and Problem/check.
// Fictional data only. jsdom 26.1.0 supplies the DOM; no browser, OS, layout or network claim.
// TOBAN_INPUT_SOURCE may select an unmodified app-input.js for a negative control.
const fs = require('fs'), path = require('path'), assert = require('assert');
let JSDOM;
for (const name of [process.env.TOBAN_DOM_MODULE, 'jsdom', path.join(process.env.HOME || '', '.toban-test/node_modules/jsdom')].filter(Boolean)) {
  try { ({ JSDOM } = require(name)); break; } catch (e) { if (e.code !== 'MODULE_NOT_FOUND') throw e; }
}
if (!JSDOM) throw new Error('Month day-flag DOM regression requires jsdom 26.1.0. Set TOBAN_DOM_MODULE to its installed path. This test was NOT run.');
const root = process.env.TOBAN_SOURCE_ROOT || __dirname;
const source = f => fs.readFileSync(f === 'app-input.js' && process.env.TOBAN_INPUT_SOURCE || path.join(root, 'src', f), 'utf8');
const scripts = ['i18n.js', 'rules-core.js', 'model.js', ...fs.readdirSync(path.join(root, 'src/calendars')).filter(f => f.endsWith('.js')).sort().map(f => 'calendars/' + f),
  'messages.js', 'solver.js', 'check.js', 'report.js', 'docxgen.js', 'plugins.js', 'merge.js', ...fs.readdirSync(path.join(root, 'src/rules')).filter(f => f.endsWith('.js')).sort().map(f => 'rules/' + f),
  'app-core.js', 'app-folder.js', 'app-month.js', 'app-input.js', 'app-settings.js', 'app-solve.js', 'app-main.js'];
const clone = x => JSON.parse(JSON.stringify(x)), N = ['Synthetic Trainer', 'Synthetic Colleague'];
const ID = { cr: 'Synthetic\rtraining', crlf: 'Synthetic\r\ntraining', nul: 'Synthetic\u0000training', lf: 'Synthetic\ntraining', replacement: 'Synthetic\uFFFDtraining', tab: 'Synthetic\ttraining', normal: 'Synthetic ordinary' };
const URL = 'https://example.invalid/synthetic/month-day-flag-preservation.html', key = 'toban_state_v2:/synthetic/month-day-flag-preservation.html';
const projected = id => id.replace(/\r\n?/g, '\n').replace(/\0/g, '\uFFFD');
const rawRules = { profile: { id: 'synthetic-month-day-flags', roles: [{ id: 'S', label: 'Staff', refs: [] }], shifts: [{ id: 'day', on: 'all' }, { id: 'night', on: 'all' }] },
  doctors: N.map((name, i) => ({ name, team: 'S', quota: 15, quals: i ? [] : ['trainer'] })), rule_states: { oncall: 'off' }, weights: {} };

async function makeApp({ ids, days, scope = ids[0], state = 'soft', pane = 'month', saved } = {}) {
  const dom = new JSDOM(source('index.html'), { url: URL, runScripts: 'outside-only' }), w = dom.window;
  await new Promise(resolve => w.document.readyState === 'complete' ? resolve() : w.addEventListener('load', resolve, { once: true }));
  const errors = []; w.addEventListener('error', e => { errors.push(e.error || e.message); e.preventDefault(); });
  w.confirm = () => true; w.alert = msg => { throw new Error('Unexpected alert: ' + msg); }; w.prompt = () => null;
  w.T = { DEFAULT_RULES: clone(rawRules), SAMPLE_MONTH: { year: 2026, month: 11 }, PROFILES: [], LANGS_DATA: ['en', 'ja'].map(code => JSON.parse(fs.readFileSync(path.join(root, 'lang', code + '.json'), 'utf8'))) };
  for (const f of scripts) w.eval(source(f) + '\n//# sourceURL=' + f);
  const A = w.T.app; A.restoreFolder = () => {}; A.toast = () => {}; // OS folder/start-gate behavior is outside this DOM test.
  w.T.calendarExt.register({ id: 'synthetic-day-flag-calendar', dayHead: true });
  const r = clone(rawRules); w.T.fillDefaultRules(r);
  for (const def of w.T.RULE_DEFS) if (def.states.includes('off')) r.rule_states[def.id] = 'off';
  r.rule_states.composition = state; r.weights.composition_miss = 100;
  r.profile.day_flags = ids.map((id, i) => ({ id, label: 'Synthetic flag ' + i }));
  r.composition = [{ shift: 'night', days: 'flag:' + scope, min: 1, qual: 'trainer', local_extra: { keep: [false, 0, 'Synthetic'] } }];
  A.state.rules = r;
  const month = Object.assign(A.blankMonth(2026, 11), { day_flags: clone(days), day_notes: { 9: 'Synthetic unchanged note' }, notes: 'Synthetic unchanged month', local_extra: { keep: [null, false, 0, 'Synthetic\r\nmetadata'] } });
  w.localStorage.setItem('toban.lang', 'en');
  w.localStorage.setItem(key, saved || JSON.stringify({ rules: r, month, result: null, ui: {} }));
  // Start the calendar cases in that pane so baseline controls isolate its reader:
  // no month-settings read is needed before selecting the doctor.
  if (pane === 'doctor') { w.document.querySelector('#monthSettings').hidden = true; w.document.querySelector('#doctorPane').hidden = false; }
  w.T.init();
  const q = s => w.document.querySelector(s);
  const click = s => { const el = typeof s === 'string' ? q(s) : s; assert(el, 'Missing ' + s); el.click(); };
  const change = (s, v) => { const el = typeof s === 'string' ? q(s) : s; assert(el, 'Missing ' + s); if (el.type === 'checkbox') el.checked = v; else el.value = v; el.dispatchEvent(new w.Event('change', { bubbles: true })); };
  const tick = () => new Promise(resolve => w.setTimeout(resolve, 0));
  const a = { dom, w, A, q, click, change, tick, errors, pane, fixture: { ids, days, scope, state, pane } };
  if (pane === 'doctor') change('#docSel', N[0]);
  return a;
}
const retained = a => clone({ day_flags: a.A.state.month.day_flags, day_notes: a.A.state.month.day_notes, notes: a.A.state.month.notes, local_extra: a.A.state.month.local_extra,
  composition: a.A.state.rules.composition, flags: a.A.state.rules.profile.day_flags });
function semantics(a) {
  const p = new a.w.T.Problem(a.A.state.rules, a.A.state.month), asg = Object.fromEntries(p.slots.map(s => [s.join(':'), { work: s[0] === 7 ? N[1] : N[0], oc: [] }]));
  return { scope: clone(p.comp.flatMap(c => p.slots.filter(s => p.compOn(c, s)))), violations: a.w.T.check(p, asg).VC.filter(v => v.code === 'COMPOSITION_SHORT').length, penalty: a.w.T.penalty(p, asg).total };
}
const meaning = (days, state) => ({ scope: days.map(d => [d, 'night']), violations: state === 'hard' && days.includes(7) ? 1 : 0, penalty: state === 'soft' && days.includes(7) ? 100 : 0 });
function box(a, day, index) {
  const selector = a.pane === 'doctor' ? '[data-cal="dflag"]' : '[data-dflag]';
  const el = [...a.w.document.querySelectorAll(selector)].filter(e => +e.dataset.d === day)[index];
  assert(el, 'Missing flag control ' + a.pane + '/' + day + '/' + index); return el;
}
function checkpoint(a, expected, expectedMeaning, label) {
  assert.deepStrictEqual(retained(a), expected, label + ': exact month and rule IDs plus unrelated data');
  assert.deepStrictEqual(semantics(a), expectedMeaning, label + ': exact scope/check/penalty');
}
async function until(a, fn, label) { for (let i = 0; i < 100; i++) { if (fn()) return; await a.tick(); } throw new Error('Timed out: ' + label); }
async function roundtrip(a, expected, expectedMeaning) {
  let result; const pending = [];
  a.A.download = (name, blob) => pending.push(new Promise((resolve, reject) => { const reader = new a.w.FileReader(); reader.onload = () => { result = JSON.parse(reader.result); resolve(); }; reader.onerror = reject; reader.readAsText(blob); }));
  a.click('#btnSaveJson'); await until(a, () => pending.length > 0, 'JSON download'); await Promise.all(pending);
  assert.deepStrictEqual(clone(result.month.day_flags), expected.day_flags, 'download keeps exact month IDs');
  assert.deepStrictEqual(clone(result.rules.composition), expected.composition, 'download keeps exact rule scope');
  const oldMonth = a.A.state.month, input = a.q('#fileLoadJson');
  Object.defineProperty(input, 'files', { configurable: true, value: [{ name: 'synthetic-month.json', text: async () => JSON.stringify(result) }] });
  input.dispatchEvent(new a.w.Event('change', { bubbles: true }));
  await until(a, () => a.A.switching === 0 && a.A.state.month !== oldMonth, 'JSON import');
  checkpoint(a, expected, expectedMeaning, 'JSON import');
  a.A.save(); const saved = a.w.localStorage.getItem(key); assert(saved);
  const b = await makeApp({ ...a.fixture, saved });
  try {
    checkpoint(b, expected, expectedMeaning, 'localStorage reload');
    b.click('.tab[data-tab="settings"]'); b.click('[data-setmode="build"]'); b.A.readSettings(); b.A.readSettings();
    checkpoint(b, expected, expectedMeaning, 'settings tab after reload');
    b.click('.tab[data-tab="input"]'); b.A.readAll(); b.A.readAll();
    checkpoint(b, expected, expectedMeaning, 'input tab after reload');
    assert.deepStrictEqual(b.errors, []);
  } finally { b.w.close(); }
}

const EXPECTED_CASES = 30, cases = [];
let passed = 0, failed = 0, completed = false;
const watchdog = setTimeout(() => { console.error('FAIL month day flag regression timed out'); process.exit(1); }, 180000);
process.on('exit', () => { if (!completed || passed + failed !== EXPECTED_CASES || failed) { console.error(`NOT PASSED month day flags: ${passed}/${EXPECTED_CASES}, ${failed} failed, finished=${completed}`); process.exitCode = 1; } });
const test = (name, fixture, fn) => cases.push({ name, fixture, fn });

for (const pane of ['month', 'doctor']) for (const [kind, id] of Object.entries(ID)) {
  const group = ['cr', 'crlf', 'nul'].includes(kind) ? 'lossy-regression' : 'safe-control';
  test(`${group} ${pane}/${kind}: unchanged reads, tabs, JSON and reload`, { ids: [id], days: { 8: [id] }, pane }, async a => {
    const expected = retained(a), before = meaning([8], 'soft');
    assert.equal(a.pane === 'doctor' ? box(a, 8, 0).dataset.id : box(a, 8, 0).dataset.dflag, projected(id), 'real HTML attribute projection is exercised');
    checkpoint(a, expected, before, 'initial');
    a.A.readAll(); a.A.readAll(); checkpoint(a, expected, before, 'repeated unchanged reads');
    a.click('.tab[data-tab="settings"]'); a.click('[data-setmode="build"]'); a.A.readSettings();
    checkpoint(a, expected, before, 'settings tab');
    a.click('.tab[data-tab="input"]'); a.A.readAll(); checkpoint(a, expected, before, 'input tab');
    await roundtrip(a, expected, before);
  });
}
for (const pane of ['month', 'doctor']) for (const [kind, first, second] of [['CR/LF', ID.cr, ID.lf], ['NUL/replacement', ID.nul, ID.replacement]]) for (const state of ['hard', 'soft']) {
  test(`collision ${pane}/${kind}/${state}: add, clear, Undo and separate rule options`, { ids: [first, second], days: { 7: [first], 8: [second] }, scope: second, pane, state }, async a => {
    const initial = retained(a), expected = clone(initial);
    assert.equal(a.pane === 'doctor' ? box(a, 7, 0).dataset.id : box(a, 7, 0).dataset.dflag, a.pane === 'doctor' ? box(a, 7, 1).dataset.id : box(a, 7, 1).dataset.dflag, 'distinct raw IDs have colliding HTML attributes');
    a.A.readAll(); checkpoint(a, initial, meaning([8], state), 'unchanged collision');
    a.change(box(a, 7, 1), true); await a.tick(); expected.day_flags[7] = [first, second];
    checkpoint(a, expected, meaning([7, 8], state), 'add second exact ID');
    a.A.readAll(); a.A.readAll(); checkpoint(a, expected, meaning([7, 8], state), 'repeated added read');
    const sameBox = box(a, 7, 1);
    a.change(sameBox, false); await a.tick(); expected.day_flags[7] = [first];
    assert.strictEqual(box(a, 7, 1), sameBox, 'clear uses the same DOM checkbox');
    checkpoint(a, expected, meaning([8], state), 'same checkbox clears after a read');
    a.change(sameBox, true); await a.tick(); expected.day_flags[7] = [first, second];
    assert.strictEqual(box(a, 7, 1), sameBox, 'reselect uses the same DOM checkbox');
    checkpoint(a, expected, meaning([7, 8], state), 'same checkbox reselects after a clear');
    a.change(box(a, 7, 0), false); await a.tick(); expected.day_flags[7] = [second];
    checkpoint(a, expected, meaning([7, 8], state), 'clear first without clearing second');
    a.click('#btnUndo'); await a.tick(); expected.day_flags[7] = [first, second];
    checkpoint(a, expected, meaning([7, 8], state), 'Undo restores first exact ID');
    a.change(box(a, 7, 1), false); await a.tick(); expected.day_flags[7] = [first];
    checkpoint(a, expected, meaning([8], state), 'clear second without clearing first');
    a.click('#btnUndo'); await a.tick(); expected.day_flags[7] = [first, second];
    checkpoint(a, expected, meaning([7, 8], state), 'Undo restores second exact ID');
    a.click('.tab[data-tab="settings"]'); a.click('[data-setmode="build"]');
    const select = () => a.q('[data-cdays]'); assert.equal(select().options[3].value, select().options[4].value, 'rule option values also collide');
    select().selectedIndex = 3; select().dispatchEvent(new a.w.Event('change', { bubbles: true }));
    expected.composition[0].days = 'flag:' + first; checkpoint(a, expected, meaning([7], state), 'select first raw rule ID');
    select().selectedIndex = 4; select().dispatchEvent(new a.w.Event('change', { bubbles: true }));
    expected.composition[0].days = 'flag:' + second; checkpoint(a, expected, meaning([7, 8], state), 'select second raw rule ID');
    await roundtrip(a, expected, meaning([7, 8], state));
  });
}
for (const pane of ['month', 'doctor']) for (const kind of ['cr', 'crlf', 'nul']) {
  const id = ID[kind];
  test(`explicit-edit ${pane}/${kind}: add, clear and Undo preserve unseen IDs`, { ids: [id], days: { 7: [id], 9: ['Synthetic unseen'] }, pane }, async a => {
    const expected = retained(a); a.change(box(a, 8, 0), true); await a.tick(); expected.day_flags[8] = [id];
    checkpoint(a, expected, meaning([7, 8], 'soft'), 'explicit exact-ID addition');
    a.change(box(a, 7, 0), false); await a.tick(); delete expected.day_flags[7];
    checkpoint(a, expected, meaning([8], 'soft'), 'clear only the exact ID');
    a.click('#btnUndo'); await a.tick(); expected.day_flags[7] = [id];
    checkpoint(a, expected, meaning([7, 8], 'soft'), 'Undo exact-ID removal');
    a.A.readAll(); a.A.readAll(); checkpoint(a, expected, meaning([7, 8], 'soft'), 'repeated post-Undo read');
    await roundtrip(a, expected, meaning([7, 8], 'soft'));
  });
}
for (const pane of ['month', 'doctor']) test(`unchanged-storage ${pane}: order, duplicates, scalar and hidden IDs remain exact`, {
  ids: [ID.lf, ID.normal], days: { 7: [ID.normal, 'Synthetic unseen', ID.lf, ID.normal], 8: ID.lf, 9: ['Synthetic hidden\rflag', 'Synthetic hidden\u0000flag'], 31: [ID.normal, 'Synthetic next-month hidden'] }, scope: ID.lf, pane
}, async a => {
  const expected = retained(a); a.A.readAll(); a.A.readAll();
  checkpoint(a, expected, meaning([7, 8], 'soft'), 'unchanged stored representation');
  // An edit owns one checkbox only; untouched days and hidden IDs stay byte-for-byte.
  a.change(box(a, 10, 0), true); await a.tick(); expected.day_flags[10] = [ID.lf];
  checkpoint(a, expected, meaning([7, 8, 10], 'soft'), 'edit different day');
  await roundtrip(a, expected, meaning([7, 8, 10], 'soft'));
});

(async () => {
  assert.equal(cases.length, EXPECTED_CASES, 'registered case count');
  for (const c of cases) {
    let a;
    try { a = await makeApp(c.fixture); await c.fn(a); assert.deepStrictEqual(a.errors, []); passed++; console.log('PASS ' + c.name); }
    catch (e) { failed++; console.error('FAIL ' + c.name, e); }
    finally { if (a) a.w.close(); }
  }
  console.log(`month day flag preservation: ${passed} passed, ${failed} failed, ${cases.length} total`);
  assert.equal(passed + failed, EXPECTED_CASES); completed = true; clearTimeout(watchdog); if (failed) process.exitCode = 1;
})().catch(e => { console.error(e); process.exitCode = 1; });

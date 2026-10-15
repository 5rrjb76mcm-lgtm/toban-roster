// Preserve imported count bounds through the real month-settings DOM and delegated events.
// Synthetic data only. jsdom supplies DOM semantics; no browser, network or file APIs run.
// TOBAN_WEBAPP_ROOT selects an unmodified webapp tree for baseline reproduction.
const fs = require('fs'), path = require('path'), assert = require('assert/strict');
let JSDOM;
for (const p of [process.env.TOBAN_DOM_MODULE, 'jsdom', path.join(process.env.HOME || '', '.toban-test/node_modules/jsdom')].filter(Boolean)) {
  try { ({ JSDOM } = require(p)); break; } catch (e) { if (e.code !== 'MODULE_NOT_FOUND') throw e; }
}
if (!JSDOM) throw new Error('This test requires installed jsdom. Set TOBAN_DOM_MODULE; no tests were run.');
const root = process.env.TOBAN_WEBAPP_ROOT || __dirname, names = ['Synthetic Alpha', 'Synthetic Beta'];
const copy = x => JSON.parse(JSON.stringify(x)), stateKey = 'toban_state_v2:/synthetic/month-count-limits.html';
const files = ['i18n.js', 'rules-core.js', 'model.js', 'messages.js', 'check.js', 'app-core.js', 'app-input.js',
  ...fs.readdirSync(path.join(root, 'src/rules')).filter(f => f.endsWith('.js')).sort().map(f => 'rules/' + f)];
function app(month = {}, configure = () => {}) {
  const dom = new JSDOM('<div id="monthSettings"></div><div id="doctorPane" hidden></div><div id="fixedPane" hidden></div>', { url: 'https://example.invalid/synthetic/month-count-limits.html', runScripts: 'outside-only' }), w = dom.window, errors = [];
  w.addEventListener('error', e => { errors.push(String(e.error || e.message)); e.preventDefault(); });
  for (const f of files) w.eval(fs.readFileSync(path.join(root, 'src', f), 'utf8') + '\n//# sourceURL=' + f);
  const T = w.T, A = T.app, R = { profile: { id: 'synthetic-count-limits', calendar: { holidays: 'none', closure: [] }, roles: [{ id: 'S', refs: [] }], shifts: [{ id: 'day', on: 'none' }, { id: 'night', on: 'all' }] },
    doctors: names.map((name, i) => ({ name, team: 'S', quota: i ? 30 : 0 })), quota_tolerance: 1, rule_states: {}, weights: {} };
  T.fillDefaultRules(R); for (const def of T.RULE_DEFS) if (def.states.includes('off')) R.rule_states[def.id] = 'off'; R.rule_states.quota_range = 'hard'; configure(R);
  const M = T.normalizeMonth({ year: 2026, month: 11, next_first_day_in_calendar: true, duty_days: {}, ...copy(month) }, R);
  Object.assign(A.state, { rules: R, month: M, result: null }); A.renderHeader = () => {}; A.toast = () => {};
  A.bindSettingsMonth(); A.renderSettingsMonth();
  const q = s => w.document.querySelector(s), input = attr => q(`[data-${attr}="${names[0]}"]`);
  const change = (el, v, kind = 'change') => { el.value = v; el.dispatchEvent(new w.Event(kind, { bubbles: true })); assert.deepEqual(errors, []); };
  const saved = () => JSON.parse(w.localStorage.getItem(stateKey));
  return { dom, w, T, A, R, M, q, input, change, saved, errors, close: () => { assert.deepEqual(errors, []); w.close(); } };
}
let passed = 0, failed = 0;
const expected = 18;
process.on('exit', () => { if (passed + failed !== expected) { console.error(`Premature test exit: ${passed + failed}/${expected} cases`); process.exitCode = 1; } });
function test(label, fn) { try { fn(); passed++; console.log('ok ' + label); } catch (e) { failed++; console.error('FAIL ' + label + '\n' + (e.stack || e)); } }
for (const value of [0, '0', '0.0', '0e0', ' 0 ', '+0', '0x0', '\ufeff0']) test('accepted zero bound survives readback: ' + JSON.stringify(value), () => {
  const f = app({ count_min: { [names[0]]: value }, count_max: { [names[0]]: value } });
  try { const before = new f.T.Problem(f.R, f.M); assert.equal(before.countHi(names[0]), 0); assert.deepEqual(copy(f.T.lint(before)), []); assert.equal(f.input('cmin').value, '0'); assert.equal(f.input('cmax').value, '0');
    f.change(f.q('[data-path="notes"]'), 'Unrelated synthetic memo');
    for (let i = 0; i < 3; i++) { f.A.readAll(); f.A.renderSettingsMonth(); const p = new f.T.Problem(f.R, f.M); assert.equal(p.countLo(names[0]), 0); assert.equal(p.countHi(names[0]), 0); assert.equal(f.M.count_min[names[0]], value); assert.equal(f.M.count_max[names[0]], value); }
    const saved = f.saved(); assert.equal(new f.T.Problem(saved.rules, f.T.normalizeMonth(saved.month, saved.rules)).countHi(names[0]), 0);
  } finally { f.close(); }
});
test('positive alternative integer spellings render canonically and preserve originals', () => {
  for (const value of [' 2 ', '+2', '0x2', '2.0', '2e0']) { const f = app({ count_min: { [names[0]]: value }, count_max: { [names[0]]: value } }, R => { R.doctors[1].quota = 28; });
    try { assert.equal(f.input('cmin').value, '2'); assert.equal(f.input('cmax').value, '2'); f.A.readAll(); assert.equal(f.M.count_min[names[0]], value); assert.equal(f.M.count_max[names[0]], value); const p = new f.T.Problem(f.R, f.M); assert.equal(p.countLo(names[0]), 2); assert.equal(p.countHi(names[0]), 2); assert.deepEqual(copy(f.T.lint(p)), []); } finally { f.close(); }
  }
});
test('unchanged bounds retain their validation effect after payload save and reload', () => {
  const f = app({ count_min: { [names[0]]: ' 0 ' }, count_max: { [names[0]]: ' 0 ' } });
  try { const p = new f.T.Problem(f.R, f.M), pin = Object.fromEntries(p.slots.map(s => [f.T.Problem.key(s), { work: s[0] === 30 ? names[0] : names[1], oc: [] }]));
    assert.deepEqual(copy(f.T.check(p, pin).VC.map(v => v.code)), ['COUNT_OUT_OF_LIMIT']); f.A.readAll();
    const data = JSON.parse(f.A.payloadJson()), after = new f.T.Problem(data.rules, f.T.normalizeMonth(data.month, data.rules));
    assert.deepEqual(copy(f.T.check(after, pin).VC), copy(f.T.check(p, pin).VC));
  } finally { f.close(); }
});
test('explicit clearing deletes only the chosen bound and person', () => {
  const f = app({ count_min: { [names[0]]: 0, [names[1]]: 29 }, count_max: { [names[0]]: 0, [names[1]]: 31 } });
  try { f.change(f.input('cmax'), ''); assert.deepEqual(copy(f.M.count_max), { [names[1]]: 31 }); assert.deepEqual(copy(f.M.count_min), { [names[0]]: 0, [names[1]]: 29 });
    f.A.readAll(); f.A.renderSettingsMonth(); assert.equal(f.input('cmax').value, ''); assert.equal(new f.T.Problem(f.R, f.M).countHi(names[0]), 1);
  } finally { f.close(); }
});
test('input event records clearing a canonicalized imported value before the next read', () => {
  const f = app({ count_max: { [names[0]]: ' 0 ' } });
  try { assert.equal(f.input('cmax').value, '0'); f.change(f.input('cmax'), '', 'input'); f.A.readAll(); assert.equal(f.M.count_max[names[0]], undefined); } finally { f.close(); }
});
test('change event records explicit clearing of an imported value', () => {
  const f = app({ count_min: { [names[0]]: ' 0 ' } });
  try { assert.equal(f.input('cmin').value, '0'); f.change(f.input('cmin'), ''); assert.equal(f.M.count_min[names[0]], undefined); } finally { f.close(); }
});
test('typing zero is explicit and remains distinct from unset', () => {
  const f = app(); try { assert.equal(new f.T.Problem(f.R, f.M).countHi(names[0]), 1); f.change(f.input('cmax'), '0'); assert.equal(f.M.count_max[names[0]], 0); assert.equal(new f.T.Problem(f.R, f.M).countHi(names[0]), 0); } finally { f.close(); }
});
test('invalid typed negative or fractional bounds stay invalid instead of being repaired', () => {
  const f = app(); try { for (const attr of ['cmin', 'cmax']) { const key = attr === 'cmin' ? 'count_min' : 'count_max';
    for (const value of ['-1', '1.5']) { f.change(f.input(attr), value); assert.equal(f.M[key][names[0]], +value); assert.throws(() => new f.T.Problem(f.R, f.M), new RegExp(key)); }
    f.change(f.input(attr), ''); assert.doesNotThrow(() => new f.T.Problem(f.R, f.M)); }
  } finally { f.close(); }
});
test('sanitized invalid imported values survive unrelated reads until explicitly corrected', () => {
  for (const value of ['bad', [], [2], { value: 2 }, true]) { const f = app({ count_max: { [names[0]]: value } });
    try { f.change(f.q('[data-path="notes"]'), 'Keep invalid input for correction'); assert.deepEqual(copy(f.M.count_max[names[0]]), value); assert.throws(() => new f.T.Problem(f.R, f.M), /count_max/);
      f.change(f.input('cmax'), '0'); assert.equal(f.M.count_max[names[0]], 0); assert.doesNotThrow(() => new f.T.Problem(f.R, f.M));
    } finally { f.close(); }
  }
});
test('hidden rule-off and noncandidate bounds remain untouched', () => {
  const f = app({ count_min: { [names[0]]: ' 0 ' }, count_max: { [names[0]]: ' 0 ' } }, R => { R.rule_states.quota_range = 'off'; });
  try { assert.equal(f.input('cmax'), null); f.A.readAll(); assert.equal(f.M.count_max[names[0]], ' 0 '); f.R.rule_states.quota_range = 'hard'; f.R.doctors[0].duty = 'never'; f.A.renderSettingsMonth(); assert.equal(f.input('cmax'), null); f.A.readAll(); assert.equal(f.M.count_min[names[0]], ' 0 '); assert.equal(f.M.count_max[names[0]], ' 0 '); } finally { f.close(); }
});
test('targets and unrelated calendar records retain their existing behavior', () => {
  const data = { targets: { [names[0]]: ' 0 ' }, duty_days: { [names[0]]: { 31: { am: 'external' } } }, fixed: { night: { 9: names[1] } }, unavailable_night: { [names[1]]: [7] } }, f = app(data);
  try { f.change(f.input('cmin'), '0'); assert.equal(f.M.targets[names[0]], ' 0 '); assert.equal(f.M.duty_days[names[0]][31].am, 'external'); assert.equal(f.M.fixed.night[9], names[1]); assert.deepEqual(copy(f.M.unavailable_night[names[1]]), [7]); } finally { f.close(); }
});
console.log(`month count limits DOM: ${passed} passed, ${failed} failed, ${expected} expected`);
if (failed || passed + failed !== expected) process.exitCode = 1;

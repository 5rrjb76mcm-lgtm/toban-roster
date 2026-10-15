// Preserve accepted numeric histories through real month-settings DOM events and save/reload.
// Synthetic data only. jsdom supplies DOM semantics; no browser, network or file APIs run.
// TOBAN_WEBAPP_ROOT selects an unmodified webapp tree for baseline reproduction.
const fs = require('fs'), path = require('path'), assert = require('assert/strict');
let JSDOM;
for (const p of [process.env.TOBAN_DOM_MODULE, 'jsdom', path.join(process.env.HOME || '', '.toban-test/node_modules/jsdom')].filter(Boolean)) {
  try { ({ JSDOM } = require(p)); break; } catch (e) { if (e.code !== 'MODULE_NOT_FOUND') throw e; }
}
if (!JSDOM) throw new Error('This test requires installed jsdom. Set TOBAN_DOM_MODULE; no tests were run.');
const root = process.env.TOBAN_WEBAPP_ROOT || __dirname, names = ['Synthetic Alpha', 'Synthetic Beta'];
const copy = x => JSON.parse(JSON.stringify(x)), stateKey = 'toban_state_v2:/synthetic/month-history-readback.html';
const files = ['i18n.js', 'rules-core.js', 'model.js', 'messages.js', 'check.js', 'app-core.js', 'app-folder.js', 'app-input.js',
  ...fs.readdirSync(path.join(root, 'src/rules')).filter(f => f.endsWith('.js')).sort().map(f => 'rules/' + f)];
function app(month = {}, configure = () => {}) {
  const dom = new JSDOM('<div id="monthSettings"></div><div id="doctorPane" hidden></div><div id="fixedPane" hidden></div>', { url: 'https://example.invalid/synthetic/month-history-readback.html', runScripts: 'outside-only' }), w = dom.window, errors = [];
  w.addEventListener('error', e => { errors.push(String(e.error || e.message)); e.preventDefault(); });
  for (const f of files) w.eval(fs.readFileSync(path.join(root, 'src', f), 'utf8') + '\n//# sourceURL=' + f);
  const T = w.T, A = T.app, R = { profile: { id: 'synthetic-history-readback', calendar: { holidays: 'none', closure: [] }, roles: [{ id: 'S', refs: ['charge'] }], shifts: [{ id: 'day', on: 'none' }, { id: 'night', on: 'all' }] },
    doctors: names.map((name, i) => ({ name, team: 'S', quota: i ? 30 : 0 })), quota_tolerance: 1, rule_states: {}, weights: {} };
  T.fillDefaultRules(R); for (const def of T.RULE_DEFS) if (def.states.includes('off')) R.rule_states[def.id] = 'off'; R.rule_states.period_charge = 'hard'; configure(R);
  const M = T.normalizeMonth({ year: 2026, month: 11, next_first_day_in_calendar: true, duty_days: {}, ...copy(month) }, R);
  Object.assign(A.state, { rules: R, month: M, result: null }); A.renderHeader = () => {}; A.toast = () => {};
  A.bindSettingsMonth(); A.renderSettingsMonth();
  const q = s => w.document.querySelector(s), input = attr => q(`[data-${attr}="${names[0]}"]`);
  const change = (el, v, kind = 'change') => { el.value = v; el.dispatchEvent(new w.Event(kind, { bubbles: true })); assert.deepEqual(errors, []); };
  const saved = () => JSON.parse(w.localStorage.getItem(stateKey));
  return { dom, w, T, A, R, M, q, input, change, saved, errors, close: () => { assert.deepEqual(errors, []); w.close(); } };
}
let passed = 0, failed = 0, completed = false;
const expected = 40;
process.on('exit', () => { if (!completed || passed + failed !== expected) { console.error(`Incomplete history readback DOM run: ${passed + failed}/${expected} cases`); process.exitCode = 1; } });
function test(label, fn) { try { fn(); passed++; console.log('ok ' + label); } catch (e) { failed++; console.error('FAIL ' + label + '\n' + e.stack); } }
for (const [field, attr] of [['work_balance', 'bal'], ['weekend_charge', 'hist'], ['holiday_charge', 'hist']]) {
  const selector = `[data-${attr}="${attr === 'hist' ? field + ':' : ''}${names[0]}"]`;
  for (const value of [' 2.5 ', '+2', '0x2', '-1.25', 3]) test(field + ' preserves ' + JSON.stringify(value), () => {
    const original = { [field]: { [names[0]]: value, [names[1]]: 4 } }, f = app({history: original});
    try {
      f.change(f.q('[data-path="notes"]'), 'Unrelated memo');
      assert.equal(f.M.history[field][names[0]], value);
      assert.equal(f.q(selector).value, String(Number(value)));
      for (let i = 0; i < 2; i++) { f.A.readAll(); f.A.renderSettingsMonth(); }
      const payload = JSON.parse(f.A.payloadJson());
      assert.equal(Number(payload.month.history[field][names[0]]), Number(value));
      const reloaded = app(payload.month);
      try { reloaded.A.readAll(); assert.equal(Number(reloaded.saved().month.history[field][names[0]]), Number(value)); } finally { reloaded.close(); }
      assert.equal(f.M.history[field][names[1]], 4);
    } finally { f.close(); }
  });
  test(field + ' permits explicit edit and clear', () => {
    const f = app({history: {[field]: {[names[0]]:' 2.5 ', [names[1]]:4}}});
    try { f.change(f.q(selector), '1.5'); assert.equal(f.M.history[field][names[0]], 1.5);
      f.change(f.q(selector), ''); assert.equal(f.M.history[field][names[0]], undefined);
      f.A.readAll(); f.A.renderSettingsMonth(); assert.equal(f.M.history[field][names[0]], undefined);
      assert.equal(f.M.history[field][names[1]], 4);
    } finally { f.close(); }
  });
  test(field + ' preserves hidden person records', () => {
    const f = app({history: {[field]: {[names[0]]:' 2.5 '}}}, R => { if (field === 'work_balance') R.doctors[0].duty = 'never'; else R.rule_states.period_charge = 'off'; });
    try { assert.equal(f.q(selector), null); f.A.readAll(); assert.equal(f.M.history[field][names[0]], ' 2.5 '); } finally { f.close(); }
  });
}
for (const field of ['work_balance', 'weekend_charge', 'holiday_charge']) {
  test(field + ' does not invent zero records for absent history', () => {
    const f = app(); try { f.change(f.q('[data-path="notes"]'), 'memo'); f.A.readAll(); assert.deepEqual(copy(f.M.history[field]), {}); } finally { f.close(); }
  });
  for (const value of ['bad', [], [2], {value:2}, true]) test(field + ' retains unedited malformed input ' + JSON.stringify(value), () => {
    const f = app({history:{[field]:{[names[0]]:value}}});
    try { f.change(f.q('[data-path="notes"]'), 'memo'); assert.deepEqual(copy(f.M.history[field][names[0]]), value); } finally { f.close(); }
  });
}
test('imported JSON retains history-dependent quota allocation after memo/save/reload', () => {
  const f = app({month:10, history:{work_balance:{[names[0]]:' 2.5 '}}}, R => { R.profile.quota_mode = 'share'; R.doctors.forEach(d => d.share = 1); });
  try {
    const imported = JSON.parse(f.A.payloadJson());
    f.A.renderAll = () => f.A.renderSettingsMonth(); f.A.showTab = () => {};
    f.A.applyLoaded(imported, 'Synthetic import', {fromFolder:false});
    const quota = () => { const P = new f.T.Problem(f.A.state.rules, f.A.state.month); return names.map(n => P.quota(n)); };
    assert.deepEqual(quota(), [15,16]);
    f.change(f.q('[data-path="notes"]'), 'unrelated memo'); assert.deepEqual(quota(), [15,16]);
    const saved = JSON.parse(f.A.payloadJson()); assert.equal(saved.month.history.work_balance[names[0]], ' 2.5 ');
    f.A.applyLoaded(saved, 'Synthetic reload', {fromFolder:false}); f.A.readAll(); assert.deepEqual(quota(), [15,16]);
  } finally { f.close(); }
});
console.log(`history readback DOM: ${passed} passed, ${failed} failed`);
assert.equal(passed + failed, expected, 'all history readback cases must execute');
completed = true;
if (failed) process.exitCode = 1;

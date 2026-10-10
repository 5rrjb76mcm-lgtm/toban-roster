// Fictional supported Python CP-SAT versus JS HiGHS Friday minimum contract.
// node test_python_friday_night_off_node.js <path/to/highs> [path/to/python]
// TOBAN_WEBAPP_ROOT / TOBAN_PYTHON_ROOT can target unchanged sources for a red run.
const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert/strict'), { execFileSync } = require('child_process');
const root = process.env.TOBAN_WEBAPP_ROOT || __dirname;
globalThis.T = {};
const load = f => vm.runInThisContext(fs.readFileSync(path.join(root, 'src', f), 'utf8'), { filename: f });
for (const f of ['i18n.js', 'rules-core.js', 'model.js', 'messages.js', 'solver.js', 'check.js']) load(f);
for (const dir of ['rules', 'calendars']) for (const f of fs.readdirSync(path.join(root, 'src', dir)).filter(x => x.endsWith('.js')).sort()) load(`${dir}/${f}`);
function verifyUiRetention(rules, month) {
  const elements = new Map(), element = sel => {
    if (!elements.has(sel)) elements.set(sel, { value: '', textContent: '', innerHTML: '', disabled: false, handlers: {},
      addEventListener(type, fn) { (this.handlers[type] ||= []).push(fn); } });
    return elements.get(sel);
  };
  for (const id of ['settings', 'btnUndo', 'undoNote', 'btnReloadPlugins', 'btnApplyRules', 'btnResetRules', 'doctorTable', 'weightsTable', 'hardRules', 'profileBuilder', 'rulesJson', 'pluginsInfo']) element('#' + id);
  let rows = [];
  const toggle = { checked: true, disabled: false };
  globalThis.location = { pathname: '/synthetic/friday-toggle.html' };
  globalThis.localStorage = { getItem() { return null; }, setItem() {} };
  globalThis.document = {
    querySelector(sel) {
      if (sel === '#profileBuilder [data-ron="friday_night_min"]') return toggle;
      return elements.get(sel) || null;
    },
    querySelectorAll(sel) { return sel === '#doctorTable tr[data-i]' ? rows : []; }
  };
  for (const f of ['plugins.js', 'app-core.js', 'app-settings.js']) load(f);
  const A = T.app, clone = x => JSON.parse(JSON.stringify(x));
  const R = clone(rules), original = clone(R.friday_night_min);
  R.rule_states.friday_night_min = 'hard';
  Object.assign(A.state, { rules: R, month: clone(month), result: null, meta: {}, base: null, baseRules: null, renames: [], ui: {} });
  A.save = () => {}; A.toast = msg => { throw new Error('Unexpected UI warning: ' + msg); };
  A.renderSettingsMonth = A.renderDoctor = () => {};
  const inputs = () => {
    const visible = T.rules.columns(R).some(c => c.key === 'fri');
    rows = R.doctors.map((d, i) => {
      const fields = Object.fromEntries(Object.entries({ name: d.name, team: d.team, years: String(d.years), quota: String(d.quota), duty: d.duty || '' }).map(([k, value]) => [k, { value }]));
      const fri = { value: String(R.friday_night_min[d.name] || '') };
      return { dataset: { i: String(i) }, querySelector(sel) {
        if (sel === '[data-col="fri"]') return visible ? { querySelector() { return fri; } } : null;
        const m = sel.match(/^\[data-f="(.+)"\]$/); return m ? fields[m[1]] || null : null;
      } };
    });
  };
  A.bindSettings(); inputs(); A.renderSettings();
  assert.match(element('#doctorTable').innerHTML, /data-col="fri"/);
  const change = () => {
    const target = { closest(sel) { return sel.includes('#profileBuilder') ? element('#profileBuilder') : null; } };
    for (const fn of element('#settings').handlers.change) fn({ target });
    inputs();
  };
  toggle.checked = false; change();
  assert.equal(R.rule_states.friday_night_min, 'off');
  assert.deepEqual(R.friday_night_min, original);
  assert.doesNotMatch(element('#doctorTable').innerHTML, /data-col="fri"/);
  change(); // Another settings edit while the per-person Friday column is hidden.
  assert.deepEqual(R.friday_night_min, original);
  assert.deepEqual(new T.Problem(R, A.state.month).fridayMin, original);
  toggle.checked = true; change();
  assert.equal(R.rule_states.friday_night_min, 'hard');
  assert.deepEqual(R.friday_night_min, original);
  assert.match(element('#doctorTable').innerHTML, /data-col="fri"/);
  console.log('OK   real settings handlers retain and restore the hidden Friday minimum column (DOM substitute)');
}

(async () => {
  const highs = await require(process.argv[2] || 'highs')();
  const py = process.argv[3] || path.join(__dirname, '../tools/.venv/bin/python');
  const cases = JSON.parse(execFileSync(py, [path.join(__dirname, '../tools/test_friday_night_off.py'), '--cases'], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 }));
  let failed = 0;
  for (const x of cases) {
    try {
      const P = new T.Problem(x.rules, x.month), c = T.check(P, x.asg), r = T.solve(P, highs, { pin: x.asg, timeLimit: 10, mipGap: 0 }), pen = T.penalty(P, x.asg);
      const got = { hard: c.V.length, fixed: c.WC.length, objective: Number.isFinite(r.objective) ? r.objective : null };
      assert.deepEqual(got, x.expected, `JS checker/score differs: ${c.V.join('; ')}; ${c.WC.map(x => x.code).join('; ')}`);
      assert.equal(r.status, x.expected.hard ? 'Infeasible' : 'Optimal');
      if (!x.expected.hard) assert.equal(pen.total, x.expected.objective, 'JS independent penalty differs');
      assert.equal(x.python_status, x.expected.hard ? 'INFEASIBLE' : 'OPTIMAL', 'Python solver status differs');
      assert.deepEqual(x.python, x.expected, 'Python checker/score differs from independently stated expected result');
      console.log(`OK   ${x.label}`);
    } catch (e) { failed++; console.error(`FAIL ${x.label}: ${e.message}`); }
  }
  try { verifyUiRetention(cases[0].rules, cases[0].month); } catch (e) { failed++; console.error('FAIL UI retention: ' + e.stack); }
  console.log(`Python Friday minimum contract: ${cases.length - failed}/${cases.length} passed`);
  process.exitCode = failed ? 1 : 0;
})().catch(e => { console.error(e); process.exitCode = 1; });

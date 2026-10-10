// Fictional supported Python CP-SAT versus JS HiGHS global oncall-state checks.
// node test_python_oncall_off_node.js <path/to/highs> [path/to/python]
// TOBAN_WEBAPP_ROOT / TOBAN_PYTHON_ROOT can target unchanged source for a red run.
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
  let rows = [], ocRows = [], showOC = true;
  const toggle = { checked: true, disabled: false };
  globalThis.location = { pathname: '/synthetic/oncall-toggle.html' };
  globalThis.localStorage = { getItem() { return null; }, setItem() {} };
  globalThis.document = {
    querySelector(sel) {
      if (sel === '#profileBuilder [data-ron="oncall"]') return toggle;
      if (sel === '#ocReqTbl') return showOC ? {} : null;
      return elements.get(sel) || null;
    },
    querySelectorAll(sel) { return ({ '#doctorTable tr[data-i]': rows, '#ocReqTbl tr[data-t]': ocRows })[sel] || []; }
  };
  for (const f of ['plugins.js', 'app-core.js', 'app-settings.js']) load(f);
  const A = T.app, clone = x => JSON.parse(JSON.stringify(x));
  const R = clone(rules), original = clone(R.oncall_requirement);
  R.rule_states.oncall = 'hard';
  Object.assign(A.state, { rules: R, month: clone(month), result: null, meta: {}, base: null, baseRules: null, renames: [], ui: {} });
  A.save = () => {}; A.toast = msg => { throw new Error('Unexpected UI warning: ' + msg); };
  A.renderSettingsMonth = A.renderDoctor = () => {};
  const inputs = () => {
    rows = R.doctors.map((d, i) => {
      const fields = Object.fromEntries(Object.entries({ name: d.name, team: d.team, years: String(d.years), quota: String(d.quota), duty: d.duty || '' }).map(([k, value]) => [k, { value }]));
      return { dataset: { i: String(i) }, querySelector(sel) { const m = sel.match(/^\[data-f="(.+)"\]$/); return m ? fields[m[1]] || null : null; } };
    });
    ocRows = Object.entries(R.oncall_requirement).map(([id, row]) => ({ dataset: { t: id },
      cells: Object.entries(row).map(([col, value]) => ({ dataset: { oc: col }, value: String(value) })), querySelectorAll() { return this.cells; } }));
  };
  A.bindSettings(); inputs(); A.renderSettings();
  assert.match(element('#profileBuilder').innerHTML, /data-ron="oncall"/);
  assert.match(element('#profileBuilder').innerHTML, /id="ocReqTbl"/);
  const change = () => {
    const target = { closest(sel) { return sel.includes('#profileBuilder') ? element('#profileBuilder') : null; } };
    for (const fn of element('#settings').handlers.change) fn({ target });
    inputs();
  };
  toggle.checked = false; change(); showOC = false;
  assert.equal(R.rule_states.oncall, 'off');
  assert.deepEqual(R.oncall_requirement, original);
  assert.doesNotMatch(element('#profileBuilder').innerHTML, /id="ocReqTbl"/);
  change(); // A later edit while the OC matrix is hidden must still retain it.
  assert.deepEqual(R.oncall_requirement, original);
  const P = new T.Problem(R, A.state.month);
  assert.ok(Object.values(P.ocReq).every(row => Object.values(row).every(n => n === 0)));
  toggle.checked = true; change();
  assert.equal(R.rule_states.oncall, 'hard');
  assert.deepEqual(R.oncall_requirement, original);
  assert.equal(new T.Problem(R, A.state.month).ocReq.I.Y, original.I.Y);
  console.log('OK   real settings toggle retains and restores the hidden OC matrix');
}

(async () => {
  const highs = await require(process.argv[2] || 'highs')();
  const py = process.argv[3] || path.join(__dirname, '../tools/.venv/bin/python');
  const cases = JSON.parse(execFileSync(py, [path.join(__dirname, '../tools/test_oncall_off.py'), '--cases'], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 }));
  let failed = 0;
  for (const x of cases) {
    try {
      const P = new T.Problem(x.rules, x.month), c = T.check(P, x.asg), r = T.solve(P, highs, { pin: x.asg, timeLimit: 10, mipGap: 0 }), pen = T.penalty(P, x.asg);
      const got = { hard: c.V.length, fixed: c.WC.length, objective: Number.isFinite(r.objective) ? r.objective : null };
      assert.deepEqual(got, x.expected, `JS checker/score differs: ${c.V.join('; ')}; ${c.WC.map(x => x.code).join('; ')}`);
      assert.equal(r.status, x.expected.hard ? 'Infeasible' : 'Optimal');
      if (!x.expected.hard) assert.equal(pen.total, x.expected.objective, 'JS independent penalty differs');
      assert.deepEqual(x.python, x.expected, 'Python checker/score differs from independently stated expected result');
      console.log(`OK   ${x.label}`);
    } catch (e) { failed++; console.error(`FAIL ${x.label}: ${e.message}`); }
  }
  try { verifyUiRetention(cases[0].rules, cases[0].month); } catch (e) { failed++; console.error('FAIL UI toggle: ' + e.stack); }
  console.log(`Python oncall-state contract: ${cases.length - failed}/${cases.length} passed`);
  process.exitCode = failed ? 1 : 0;
})().catch(e => { console.error(e); process.exitCode = 1; });

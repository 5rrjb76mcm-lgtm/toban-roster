// Fictional default-profile quota candidate contract, including real settings readback.
// node test_python_quota_candidate_scope_node.js <highs> <python> [--saved-count-ui]
// --saved-count-ui also tests current UI count maps; it requires saved-count compatibility.
const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert/strict'), { execFileSync } = require('child_process');
const root = process.env.TOBAN_WEBAPP_ROOT || __dirname, clone = x => JSON.parse(JSON.stringify(x));
globalThis.T = {};
const load = f => vm.runInThisContext(fs.readFileSync(path.join(root, 'src', f), 'utf8'), { filename: f });
for (const f of ['i18n.js', 'rules-core.js', 'model.js', 'messages.js', 'solver.js', 'check.js']) load(f);
for (const dir of ['rules', 'calendars']) for (const f of fs.readdirSync(path.join(root, 'src', dir)).filter(x => x.endsWith('.js')).sort()) load(`${dir}/${f}`);
const pyScript = path.join(__dirname, '../tools/test_quota_candidate_scope.py');
let rows = [], countInputs = [];
const elements = new Map(), element = sel => {
  if (!elements.has(sel)) elements.set(sel, { value: '', textContent: '', innerHTML: '', disabled: false, handlers: {},
    addEventListener(type, fn) { (this.handlers[type] ||= []).push(fn); } });
  return elements.get(sel);
};
for (const id of ['settings', 'btnUndo', 'undoNote', 'btnReloadPlugins', 'btnApplyRules', 'btnResetRules', 'doctorTable', 'weightsTable', 'hardRules', 'profileBuilder', 'rulesJson', 'pluginsInfo']) element('#' + id);
globalThis.location = { pathname: '/synthetic/quota-candidate.html' };
globalThis.localStorage = { getItem() { return null; }, setItem() {} };
globalThis.document = {
  querySelector(sel) { return elements.get(sel) || null; },
  querySelectorAll(sel) {
    if (sel === '#doctorTable tr[data-i]') return rows;
    if (sel === '#shiftTbl input[data-count]') return countInputs;
    return [];
  }
};
for (const f of ['plugins.js', 'app-core.js', 'app-settings.js']) load(f);
const A = T.app;
A.toast = msg => { throw new Error('Unexpected UI warning: ' + msg); };
A.renderSettingsMonth = A.renderDoctor = () => {};
A.bindSettings();

function readDutyEvent(x, mapped) {
  const who = x.rules.doctors[0].name, wanted = x.rules.doctors[0].duty;
  Object.assign(A.state, { rules: clone(x.rules), month: clone(x.month), result: null, meta: {}, base: null, baseRules: null, renames: [], ui: {} });
  delete A.state.rules.doctors[0].duty; // Initial roster includes this person; change only their duty selector.
  rows = A.state.rules.doctors.map((d, i) => {
    const fields = Object.fromEntries(Object.entries({ name: d.name, team: d.team, years: String(d.years), quota: String(d.quota), duty: d.duty || '' })
      .map(([k, value]) => [k, { value, dataset: {} }]));
    return { dataset: { i: String(i) }, fields, querySelector(sel) {
      const m = sel.match(/^\[data-f="(.+)"\]$/); return m ? fields[m[1]] || null : null;
    } };
  });
  countInputs = mapped ? ['day', 'night'].map(id => ({ value: '1', dataset: { count: id } })) : [];
  A.renderSettings();
  assert.match(element('#doctorTable').innerHTML, /value="never"/);
  assert.match(element('#doctorTable').innerHTML, /value="no_unless_needed"/);
  let saved;
  A.save = () => { saved = JSON.parse(A.payloadJson('2026-10-10T00:00:00Z')); };
  const target = rows[0].fields.duty;
  target.value = wanted;
  target.closest = sel => sel.includes('#doctorTable') ? element('#doctorTable') : null;
  for (const fn of element('#settings').handlers.change) fn({ target });
  assert(saved, 'Actual settings event must request persistence');
  const doc = saved.rules.doctors.find(d => d.name === who);
  assert.equal(doc.duty, wanted);
  assert.equal(doc.quota, 2, 'Duty edit must retain the existing quota');
  assert.deepEqual(saved.month.count_min, x.month.count_min || {});
  assert.deepEqual(saved.month.count_max, x.month.count_max || {});
  if (mapped) assert.deepEqual(saved.rules.profile.positions.work.count, { day: 1, night: 1 });
  return saved;
}

(async () => {
  const highs = await require(process.argv[2] || 'highs')(), py = process.argv[3] || path.join(__dirname, '../tools/.venv/bin/python');
  const data = JSON.parse(execFileSync(py, [pyScript, '--cases'], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 }));
  let passed = 0, failed = 0;
  const test = (label, fn) => { try { fn(); passed++; console.log('OK   ' + label); } catch (e) { failed++; console.error('FAIL ' + label + ': ' + e.message); } };
  for (const x of data) test(x.label, () => {
    const P = new T.Problem(x.rules, x.month), c = T.check(P, x.asg);
    const r = T.solve(P, highs, { pin: x.asg, timeLimit: 10, mipGap: 0 });
    const got = { hard: c.V.length, fixed: c.WC.length, objective: Number.isFinite(r.objective) ? r.objective : null };
    assert.deepEqual(got, x.expected, 'JS checker/score: ' + c.V.join('; '));
    assert.equal(r.status, x.status === 'OPTIMAL' ? 'Optimal' : 'Infeasible');
    if (r.status === 'Optimal') assert.equal(T.penalty(P, x.asg).total, x.expected.objective);
    assert.equal(x.python_status, x.status);
    assert.deepEqual(x.python, x.expected, 'Python checker/score differs');
  });
  const uiCases = data.filter(x => /^excluded I /.test(x.label) && !x.month.allow_chief_duty);
  for (const mapped of process.argv.includes('--saved-count-ui') ? [false, true] : [false]) {
    for (const x of uiCases) test(`settings duty event + saved reader ${x.label}, countMap=${mapped}`, () => {
      const saved = readDutyEvent(x, mapped), P = new T.Problem(saved.rules, saved.month);
      const r = T.solve(P, highs, { timeLimit: 10, mipGap: 0 });
      assert.equal(r.status, 'Optimal'); assert.equal(T.check(P, r.asg).V.length, 0);
      const got = JSON.parse(execFileSync(py, [pyScript, '--payload'], { input: JSON.stringify(saved), encoding: 'utf8' }));
      assert.equal(got.status, 'OPTIMAL'); assert.equal(got.objective, 0);
      assert(!got.candidates.includes(saved.rules.doctors[0].name));
      assert.deepEqual(got.hard, [], 'Python solver must validate its own roster');
      assert.deepEqual(got.reported, []); assert.equal(got.report_clean, true);
      assert.equal(T.check(P, got.asg).V.length, 0, 'JS must accept Python output');
    });
  }
  console.log(`Quota candidate scope: ${passed} passed, ${failed} failed`);
  process.exitCode = failed ? 1 : 0;
})().catch(e => { console.error(e.stack); process.exitCode = 1; });

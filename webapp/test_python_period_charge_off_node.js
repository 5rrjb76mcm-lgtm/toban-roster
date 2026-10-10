// Synthetic supported Python CP-SAT versus JS HiGHS boundary checks.
// node test_python_period_charge_off_node.js <path/to/highs> [path/to/python]
// TOBAN_WEBAPP_ROOT/TOBAN_PYTHON_ROOT can target the unchanged source for a red run.
const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert/strict'), { execFileSync } = require('child_process');
const root = process.env.TOBAN_WEBAPP_ROOT || __dirname;
globalThis.T = {};
const load = f => vm.runInThisContext(fs.readFileSync(path.join(root, 'src', f), 'utf8'), { filename: f });
for (const f of ['i18n.js', 'rules-core.js', 'model.js', 'messages.js', 'solver.js', 'check.js']) load(f);
for (const dir of ['rules', 'calendars']) for (const f of fs.readdirSync(path.join(root, 'src', dir)).filter(x => x.endsWith('.js')).sort()) load(`${dir}/${f}`);
(async () => {
  const highs = await require(process.argv[2] || 'highs')();
  const py = process.argv[3] || path.join(__dirname, '../tools/.venv/bin/python');
  const cases = JSON.parse(execFileSync(py, [path.join(__dirname, '../tools/test_period_charge_off.py'), '--cases'], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 }));
  let failed = 0;
  for (const x of cases) {
    try {
      const P = new T.Problem(x.rules, x.month), c = T.check(P, x.asg), r = T.solve(P, highs, { pin: x.asg, timeLimit: 10, mipGap: 0 }), pen = T.penalty(P, x.asg);
      const got = { hard: c.V.length, fixed: c.WC.length, objective: Number.isFinite(r.objective) ? r.objective : null };
      assert.deepEqual(x.python, x.expected, 'Python checker/score differs from independently stated expected result');
      assert.deepEqual(got, x.expected, `JS checker/score differs: ${c.V.join('; ')}; ${c.WC.map(x => x.code).join('; ')}`);
      assert.equal(r.status, x.expected.hard ? 'Infeasible' : 'Optimal');
      if ('expected_penalty' in x) assert.equal(pen.total, x.expected_penalty, 'JS bounded independent penalty differs');
      if (!x.expected.hard) assert.equal(pen.total, x.expected.objective, 'JS independent penalty differs');
      if (x.rules.rule_states.period_charge === 'off') {
        assert.deepEqual(c.charge, Object.fromEntries(P.periods.map(p => [p.id, Object.fromEntries(p.days.map(d => [d, null]))])), 'disabled charge facts must remain null');
        assert.equal(T.rules.isOn(P, 'weekend_balance'), false, 'dependent balance must be inactive');
      }
      console.log(`OK   ${x.label}`);
    } catch (e) { failed++; console.error(`FAIL ${x.label}: ${e.message}`); }
  }
  console.log(`Python period-charge-off contract: ${cases.length - failed}/${cases.length} passed`);
  process.exitCode = failed ? 1 : 0;
})().catch(e => { console.error(e); process.exitCode = 1; });

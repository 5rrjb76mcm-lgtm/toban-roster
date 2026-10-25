// Shared fictional fixtures demonstrate the JS semantics Python must not ignore.
// Checkers only, no HiGHS/CP-SAT/browser. The Python companion tests its guard.
// node test_python_unsupported_rules_node.js [path/to/python]
const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert/strict');
const { execFileSync } = require('child_process');
const EXPECTED = ['shift_run_max', 'shift_count_range', 'rest_after_ake', 'dayoff_weekday_cap',
  'fixed_only:default', 'fixed_only:hard', 'fixed_only:off'];
let registered = 0, started = 0, completed = 0, finished = false;
process.on('exit', () => {
  if (!finished || registered !== 7 || started !== 7 || completed !== 7) {
    process.stderr.write(`FAIL: incomplete unsupported-rule checks (${registered} registered, ${started} started, ${completed} completed; expected 7)\n`);
    process.exitCode = 1;
  }
});
const root = process.env.TOBAN_WEBAPP_ROOT || __dirname;
const python = process.argv[2] || path.join(__dirname, '../tools/.venv/bin/python');
const c = vm.createContext({ console });
for (const f of ['i18n.js', 'rules-core.js', 'model.js', 'messages.js', 'check.js'])
  vm.runInContext(fs.readFileSync(path.join(root, 'src', f), 'utf8'), c, { filename: f });
for (const dir of ['rules', 'calendars'])
  for (const f of fs.readdirSync(path.join(root, 'src', dir)).filter(x => x.endsWith('.js')).sort())
    vm.runInContext(fs.readFileSync(path.join(root, 'src', dir, f), 'utf8'), c, { filename: `${dir}/${f}` });
const T = c.T;
T.DEFAULT_RULES = JSON.parse(fs.readFileSync(path.join(root, 'data/rules.json'), 'utf8'));
const fixtures = JSON.parse(execFileSync(python, [path.join(__dirname, '../tools/test_unsupported_rule_guards.py'), '--cases'], { encoding: 'utf8' }));
assert.deepEqual(fixtures.map(x => x.id === 'fixed_only' ? `${x.id}:${x.state ?? 'default'}` : x.id), EXPECTED);
registered = fixtures.length;
for (const x of fixtures) {
  started++;
  console.log('SCENARIO_START ' + JSON.stringify(x.id === 'fixed_only' ? `${x.id}:${x.state ?? 'default'}` : x.id));
  const R = JSON.parse(JSON.stringify(x.rules)); T.fillDefaultRules(R);
  const P = new T.Problem(R, T.normalizeMonth(x.month, R));
  const result = T.check(P, x.asg);
  if (x.code) assert.ok(result.VC.some(v => v.code === x.code && v.args.who === 'Synthetic Alpha'),
    `${x.id}: JS must detect the unsupported constraint for the intended Alpha witness`);
  else {
    assert.equal(P.state('fixed_only'), 'off');
    assert.equal(P.isExempt('Synthetic Alpha'), true, 'roster mode still exempts quota rules while placement rule is off');
    R.doctors[0].quota = 20; R.quota_tolerance = 0;
    const changed = new T.Problem(R, T.normalizeMonth(x.month, R));
    const checked = T.check(changed, x.asg);
    assert.ok(!checked.VC.some(v => v.code === 'QUOTA_OUT_OF_RANGE' && v.args.who === 'Synthetic Alpha'));
  }
  completed++;
  console.log('SCENARIO_COMPLETE ' + JSON.stringify(x.id === 'fixed_only' ? `${x.id}:${x.state ?? 'default'}` : x.id));
}
assert.equal(registered, 7); assert.equal(started, 7); assert.equal(completed, 7);
finished = true;
console.log('ACCOUNTING ' + JSON.stringify({registered, started, completed, expected: 7}));
console.log('ALL OK: unsupported JS constraints have checker witnesses; fixed-only mode retains quota exemptions');

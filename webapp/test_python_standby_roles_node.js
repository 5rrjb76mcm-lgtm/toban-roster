// JS semantic witnesses for frozen Python standby-role rejection. Fictional data only.
// node test_python_standby_roles_node.js /existing/venv/bin/python
// TOBAN_WEBAPP_ROOT selects baseline/fixed sources; test bytes remain unchanged.
const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert/strict');
const { execFileSync } = require('child_process');
let finished = false, started = 0, completed = 0;
process.on('exit', () => { if (!finished || started !== 25 || completed !== 25) process.exitCode = 1; });
const root = process.env.TOBAN_WEBAPP_ROOT || __dirname;
const python = process.argv[2];
if (!python) throw new Error('Pass an existing Python interpreter; do not skip this test');
globalThis.T = {};
for (const f of ['i18n.js', 'rules-core.js', 'model.js', 'messages.js', 'check.js'])
  vm.runInThisContext(fs.readFileSync(path.join(root, 'src', f), 'utf8'), { filename: f });
for (const dir of ['rules', 'calendars']) for (const f of fs.readdirSync(path.join(root, 'src', dir)).filter(x => x.endsWith('.js')).sort())
  vm.runInThisContext(fs.readFileSync(path.join(root, 'src', dir, f), 'utf8'), { filename: dir + '/' + f });
const cases = JSON.parse(execFileSync(python, [path.join(__dirname, '../tools/test_standby_role_guard.py'), '--cases'], { encoding: 'utf8' }));
assert.equal(cases.length, 24);
function test(label, fn) { started++; console.log('SCENARIO_START ' + label); fn(); completed++; console.log('SCENARIO_COMPLETE ' + label); }
for (const x of cases) test(x.id, () => {
  const R = structuredClone(x.rules); T.fillDefaultRules(R);
  const P = new T.Problem(R, T.normalizeMonth(x.month, R));
  const expected = x.accepted ? ['I', 'Y'] : null;
  if (expected) assert.deepEqual([...P.standbyRoleIds].sort(), expected);
  else assert.notDeepEqual([...P.standbyRoleIds].sort(), ['I', 'Y']);
});
test('Y omitted has an independent slot eligibility witness', () => {
  const x = cases.find(x => x.id === 'Y:omitted'), R = structuredClone(x.rules);
  T.fillDefaultRules(R);
  const P = new T.Problem(R, T.normalizeMonth(x.month, R));
  assert.equal(P.doctors['Dr H'].team, 'I');
  assert.equal(P.doctors['Dr Q'].team, 'Y');
  const VC = T.check(P, { '2:night': { work: 'Dr H', oc: ['Dr Q'] } }).VC;
  assert.ok(VC.some(v => v.code === 'SLOT_OC_NOT_STANDBY'), 'The witness is one slot, not a whole valid schedule');
});
finished = true;
console.log('ACCOUNTING ' + JSON.stringify({ expected: 25, started, completed }));

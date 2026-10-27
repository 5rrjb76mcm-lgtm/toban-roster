// Minimum days off is a work-day ceiling, not an individual work-day obligation.
// Fictional fixtures; execute locally with an existing pinned HiGHS package.
// TOBAN_WEBAPP_ROOT selects baseline/fixed product code, not test code.
const fs = require('fs'), vm = require('vm'), path = require('path'), assert = require('assert/strict');
const root = process.env.TOBAN_WEBAPP_ROOT || __dirname;
const highsPath = process.argv[2];
let finished = false, started = [], completed = [], failed = [], solves = 0;
process.on('exit', () => {
  if (!finished || started.length !== 12 || completed.length !== 12 || new Set(completed).size !== 12 || solves !== 2 || failed.length) process.exitCode = 1;
});
if (!highsPath) throw new Error('Pass an existing HiGHS package; solver assertions cannot be skipped');
const watchdog = setTimeout(() => { console.error('FAIL days-off regression timeout'); process.exit(1); }, 180000);
globalThis.T = {};
for (const f of ['i18n.js', 'rules-core.js', 'model.js', 'messages.js', 'solver.js', 'check.js'])
  vm.runInThisContext(fs.readFileSync(path.join(root, 'src', f), 'utf8'), { filename: f });
for (const dir of ['rules', 'calendars']) for (const f of fs.readdirSync(path.join(root, 'src', dir)).filter(x => x.endsWith('.js')).sort())
  vm.runInThisContext(fs.readFileSync(path.join(root, 'src', dir, f), 'utf8'), { filename: dir + '/' + f });
const names = ['Synthetic Alpha', 'Synthetic Bravo', 'Synthetic Charlie', 'Synthetic Delta', 'Synthetic Echo'];
const [A, B, C, D, E] = names;
const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
const FEW = 'LINT_PERSON_TOO_FEW_DAYS', RUN = 'LINT_PERSON_FORCED_RUN';
function fixture(o = {}) {
  const R = {
    profile: { id: 'synthetic-days-off-min-lint', roles: [{ id: 'Staff', refs: [], standby: false }],
      shifts: [{ id: 'day', on: 'all' }, { id: 'night', on: 'all' }], positions: { work: { count: 1 } } },
    doctors: names.map(name => ({ name, team: 'Staff', quota: 0 })),
    quota_tolerance: 0, rule_states: {}, weights: { chief_duty: 0, fixed_conflict: 1000 },
    days_off: { min: o.min ?? 8, mode: o.mode || 'min', ake_is_off: true },
    run_length: { max: 5 }
  };
  T.fillDefaultRules(R);
  for (const d of T.RULE_DEFS) if (d.states.includes('off')) R.rule_states[d.id] = 'off';
  Object.assign(R.rule_states, { days_off_min: o.state || 'hard', same_day_double: 'hard', run_length_max: o.forced ? 'hard' : 'off' });
  const M = T.normalizeMonth({ year: 2026, month: 11, holidays: [], fixed: {},
    unavailable_night: { [A]: range(1, 30) },
    unavailable_other: (o.forced ? range(23, 30) : range(1, 29)).map(day => ({ name: A, day, part: 'allday' })) }, R);
  return new T.Problem(R, M);
}
function witness(P) {
  return Object.fromEntries(P.slots.map(([d, shift]) => [`${d}:${shift}`, { work: shift === 'day' ? (d % 2 ? B : C) : (d % 2 ? D : E), oc: [] }]));
}
const personal = P => T.lint(P).filter(v => v.code === FEW || v.code === RUN);
function test(label, fn) {
  started.push(label); console.log('SCENARIO_START ' + label);
  try { fn(); } catch (e) { failed.push(label); console.error('FAIL ' + label, e.stack || e); }
  completed.push(label); console.log('SCENARIO_COMPLETE ' + label);
}
for (const forced of [false, true]) {
  const tag = forced ? 'forced-run' : 'one-available-day';
  test('min:' + tag + ':constructive-witness', () => {
    const P = fixture({ forced }), asg = witness(P), before = JSON.stringify({ rules: P.rules, month: P.m, asg });
    assert.equal(P.N, 30); assert.equal(P.slots.length, 60); assert.equal(P.offExact, false);
    assert.equal(P.isExempt(A), false);
    assert.deepEqual(T.check(P, asg).VC, [], 'This complete 60-slot assignment is independently feasible');
    assert.deepEqual(personal(P), [], 'Minimum days off does not require Alpha to work 22 days');
    assert.equal(JSON.stringify({ rules: P.rules, month: P.m, asg }), before);
  });
  test('exact:' + tag + ':retain-diagnostic', () => {
    const P = fixture({ forced, mode: 'exact' }), list = personal(P);
    assert.equal(list.length, 1);
    assert.equal(list[0].code, forced ? RUN : FEW);
    assert.equal(list[0].args.who, A);
    if (forced) { assert.equal(list[0].args.len, 22); assert.equal(list[0].args.max, 5); }
    else { assert.equal(list[0].args.avail, 1); assert.equal(list[0].args.need, 22); }
    assert.ok(T.check(P, witness(P)).VC.some(v => v.code === 'DAYS_OFF_OVER'), 'Same witness violates exact rest, unlike minimum rest');
  });
  for (const state of ['soft', 'off']) test(state + ':' + tag + ':no-hard-personal-obligation', () => {
    assert.deepEqual(personal(fixture({ forced, mode: 'exact', state })), []);
  });
}
for (const mode of ['min', 'exact']) test(mode + ':retain-genuine-aggregate-shortage', () => {
  const P = fixture({ min: 25, mode }), lint = T.lint(P);
  assert.ok(lint.some(v => v.code === 'LINT_BUSY_DAYS_TOO_FEW' && v.args.supply === 25 && v.args.diff === 35));
  assert.ok(lint.some(v => v.code === 'LINT_SHIFT_CAPACITY'), 'Shift upper-capacity diagnostics remain active');
});
(async () => {
  const highs = await require(highsPath)();
  for (const forced of [false, true]) test('solver:min:' + (forced ? 'forced-run' : 'one-available-day'), () => {
    const P = fixture({ forced });
    solves++;
    const result = T.solve(P, highs, { timeLimit: 30, mipGap: 0 });
    assert.equal(result.status, 'Optimal'); assert.ok(result.asg);
    assert.deepEqual(T.check(P, result.asg).VC, [], 'Solver result is independently checked');
  });
  assert.equal(started.length, 12); assert.equal(completed.length, 12); assert.equal(solves, 2);
  clearTimeout(watchdog); finished = true;
  console.log('ACCOUNTING ' + JSON.stringify({ expected: 12, started: started.length, completed: completed.length, solves, failed: failed.length }));
  if (failed.length) process.exitCode = 1;
})().catch(e => { clearTimeout(watchdog); console.error(e); process.exitCode = 1; });

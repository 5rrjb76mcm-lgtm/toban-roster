// Exact days-off personal capacity must include the previous night's busy day.
// Synthetic only; source authored in cloud, execution reserved for local validation.
// node test_days_off_carry_person_lint_node.js /absolute/path/to/existing/highs
// TOBAN_WEBAPP_ROOT selects baseline/fixed/reverted product sources. Installs nothing.
const fs = require('fs'), vm = require('vm'), path = require('path'), assert = require('assert/strict');
const root = path.resolve(process.env.TOBAN_WEBAPP_ROOT || __dirname), highsPath = process.argv[2];
console.log('SOURCE_ROOT ' + root);
if (!highsPath || !path.isAbsolute(highsPath)) throw new Error('Supply an absolute existing HiGHS package path');
globalThis.T = {};
for (const f of ['i18n.js', 'rules-core.js', 'model.js', 'messages.js', 'solver.js', 'check.js'])
  vm.runInThisContext(fs.readFileSync(path.join(root, 'src', f), 'utf8'), { filename: f });
for (const dir of ['rules', 'calendars']) for (const f of fs.readdirSync(path.join(root, 'src', dir)).filter(f => f.endsWith('.js')).sort())
  vm.runInThisContext(fs.readFileSync(path.join(root, 'src', dir, f), 'utf8'), { filename: dir + '/' + f });
const A = 'Synthetic Carry Alpha', FEW = 'LINT_PERSON_TOO_FEW_DAYS', RUN = 'LINT_PERSON_FORCED_RUN';
const cases = [
  { label: 'previous-night-supplies-only-busy-day' },
  { label: 'previous-night-paid-target', paid: true },
  { label: 'february-carry-boundary', feb: true },
  { label: 'true-deficit-after-carry', need: 2, diagnostic: FEW, infeasible: true },
  { label: 'no-carry-is-deficit', previous: 'none', diagnostic: FEW, infeasible: true },
  { label: 'unknown-last-day-is-not-carry', previous: 'earlier', diagnostic: FEW, infeasible: true },
  { label: 'previous-day-is-not-night', previous: 'day', diagnostic: FEW, infeasible: true },
  { label: 'ake-counts-as-rest', ake: true, diagnostic: FEW, infeasible: true },
  { label: 'soft-rest-no-hard-warning', state: 'soft', previous: 'none' },
  { label: 'off-rest-no-hard-warning', state: 'off', previous: 'none' },
  { label: 'minimum-rest-no-personal-obligation', mode: 'min', previous: 'none' },
  { label: 'fixed-only-remains-exempt', exempt: true, previous: 'none' },
  { label: 'carry-does-not-force-day-one-run', available: [1, 2], need: 2, run: true, witness: [2] },
  { label: 'carry-keeps-genuine-forced-run', available: [2, 3], need: 3, run: true, witness: [2, 3], diagnostic: RUN, infeasible: true },
  { label: 'carry-day-is-not-double-counted', available: [1], need: 2, diagnostic: FEW, infeasible: true }
];
const EXPECTED = 15;
console.log('REGISTER ' + JSON.stringify(cases.map(c => c.label)));
let started = 0, completed = 0, failed = 0, solves = 0, finished = false;
const watchdog = setTimeout(() => { console.error('FAIL carry regression timeout'); process.exit(1); }, 180000);
watchdog.unref();
process.on('exit', () => { if (!finished || started !== EXPECTED || completed !== EXPECTED || solves !== EXPECTED || failed) process.exitCode = 1; });
function fixture(o) {
  const N = o.feb ? 28 : 30, days = Array.from({ length: N }, (_, i) => i + 1), available = o.available || [], need = o.need || 1;
  const R = {
    profile: { id: 'synthetic-carry-person-lint', roles: [{ id: 'Staff', refs: [], standby: false }],
      shifts: [{ id: 'day', on: 'all' }, { id: 'night', on: 'all' }], positions: { work: { count: 1, min: 0 } } },
    doctors: [{ name: A, team: 'Staff', quota: 0, ...(o.exempt ? { duty: 'fixed_only' } : {}) }],
    quota_tolerance: 0, rule_states: {}, weights: { fixed_conflict: 1000, chief_duty: 0 },
    days_off: { min: N - need - (o.paid ? 1 : 0), mode: o.mode || 'exact', ake_is_off: !!o.ake },
    run_length: { max: 1 }
  };
  T.fillDefaultRules(R);
  for (const d of T.RULE_DEFS) if (d.states.includes('off')) R.rule_states[d.id] = 'off';
  Object.assign(R.rule_states, { days_off_min: o.state || 'hard', run_length_max: o.run ? 'hard' : 'off' });
  const previous = o.previous || 'night';
  const M = T.normalizeMonth({ year: o.feb ? 2027 : 2026, month: o.feb ? 2 : 11, holidays: [], fixed: {},
    unavailable_other: days.filter(d => !available.includes(d)).map(day => ({ name: A, day, part: 'allday', ...(o.paid && day === 2 ? { paid: true } : {}) })),
    unavailable_night: { [A]: available },
    prev_month: { last_days: previous === 'none' ? [] : [{ date: previous === 'earlier' ? 30 : 31, [previous === 'day' ? 'day' : 'night']: A }] }
  }, R);
  const P = new T.Problem(R, M);
  // Explicit admission contract: no fractional bounds, no unknown people or shifts.
  assert.equal(P.N, N); assert.equal(P.slots.length, 2 * N);
  assert.equal(P.offTarget(A), N - need); assert.equal(P.isExempt(A), !!o.exempt);
  assert(P.slots.every(s => P.countMinOf(s) === 0 && P.countOf(s) === 1));
  assert.equal(P.prevWorked([0, 'night'], A), previous === 'night');
  const witness = Object.fromEntries(P.slots.map(([d, k]) => [`${d}:${k}`, { work: k === 'day' && (o.witness || []).includes(d) ? A : [], oc: [] }]));
  return { P, witness };
}
(async () => {
  const highs = await require(highsPath)();
  assert.equal(cases.length, EXPECTED);
  for (const c of cases) {
    started++; console.log('SCENARIO_START ' + c.label);
    try {
      const { P, witness } = fixture(c), before = JSON.stringify({ rules: P.rules, month: P.m, witness });
      solves++;
      const result = T.solve(P, highs, { timeLimit: 10, mipGap: 0 });
      assert.equal(result.status, c.infeasible ? 'Infeasible' : 'Optimal');
      if (!c.infeasible) {
        assert.deepEqual(T.check(P, witness).VC, [], 'constructive witness');
        assert.deepEqual(T.check(P, result.asg).VC, [], 'solver independent check');
        assert(Math.abs(T.penalty(P, result.asg).total - result.objective) < 1e-6, 'objective/penalty parity');
      } else assert(T.check(P, witness).VC.length > 0, 'negative witness is independently rejected');
      assert.equal(JSON.stringify({ rules: P.rules, month: P.m, witness }), before, 'inputs preserved');
      const warnings = T.lint(P).filter(v => v.code === FEW || v.code === RUN);
      assert.deepEqual(warnings.map(v => v.code), c.diagnostic ? [c.diagnostic] : []);
      if (c.diagnostic === FEW) {
        const carry = !c.ake && (!c.previous || c.previous === 'night');
        const avail = new Set(c.available || []); if (carry) avail.add(1);
        assert.equal(warnings[0].args.avail, avail.size); assert.equal(warnings[0].args.need, c.need || 1);
      }
    } catch (e) { failed++; console.error('FAIL ' + c.label, e.stack || e); }
    finally { completed++; console.log('SCENARIO_COMPLETE ' + c.label); }
  }
  clearTimeout(watchdog); finished = true;
  console.log('ACCOUNTING ' + JSON.stringify({ expected: EXPECTED, started, completed, solves, failed }));
  if (failed) process.exitCode = 1;
})().catch(e => { clearTimeout(watchdog); console.error(e); process.exitCode = 1; });

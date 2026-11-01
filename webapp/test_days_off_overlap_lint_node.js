// C04: distinct busy days are not shift counts. Synthetic, source-only fixtures.
// node test_days_off_overlap_lint_node.js /absolute/path/to/existing/highs
// TOBAN_WEBAPP_ROOT can select baseline product sources without changing tests.
const fs = require('fs'), vm = require('vm'), path = require('path'), assert = require('assert/strict');
const root = process.env.TOBAN_WEBAPP_ROOT || __dirname, highsPath = process.argv[2];
if (!highsPath) throw new Error('An existing HiGHS package is required; do not skip solver assertions');
globalThis.T = {};
for (const f of ['i18n.js', 'rules-core.js', 'model.js', 'messages.js', 'solver.js', 'check.js'])
  vm.runInThisContext(fs.readFileSync(path.join(root, 'src', f), 'utf8'), { filename: f });
for (const dir of ['rules', 'calendars']) for (const f of fs.readdirSync(path.join(root, 'src', dir)).filter(f => f.endsWith('.js')).sort())
  vm.runInThisContext(fs.readFileSync(path.join(root, 'src', dir, f), 'utf8'), { filename: dir + '/' + f });
const A = 'Synthetic Overlap Alpha', B = 'Synthetic Overlap Bravo';
const QUOTA = 'LINT_QUOTA_VS_DAYS_OFF', SHORT = 'LINT_BUSY_DAYS_TOO_FEW';
const capacity = new Set([SHORT, 'LINT_BUSY_DAYS_TOO_MANY', 'LINT_SHIFT_CAPACITY', 'LINT_COMPOSITION_CAPACITY']);
function fixture(o = {}) {
  const R = {
    profile: { id: 'synthetic-overlap-lint', roles: [{ id: 'Staff', refs: [], standby: false }],
      shifts: [{ id: 'day', on: o.nightOnly ? 'none' : 'all' }, { id: 'night', on: 'all' }], positions: { work: { count: 1 } } },
    doctors: [A, B].map(name => ({ name, team: 'Staff', quota: o.quota ?? 30, ...(o.exempt ? { duty: 'fixed_only' } : {}) })),
    quota_tolerance: 0, rule_states: {}, weights: { fixed_conflict: 1000, chief_duty: 0 },
    days_off: { min: o.min ?? 15, mode: o.exact ? 'exact' : 'min', ake_is_off: !o.ake },
    composition: o.composition ? [{ shift: 'all', ...(o.composition === 'max0' ? { max: 0 } : { min: 1 }) }] : []
  };
  T.fillDefaultRules(R);
  for (const d of T.RULE_DEFS) if (d.states.includes('off')) R.rule_states[d.id] = 'off';
  Object.assign(R.rule_states, { days_off_min: o.rest || 'hard', quota_range: o.quotaState || 'hard',
    same_day_double: o.double || 'off', shift_sequence: o.sequence || 'off', composition: o.composition ? 'hard' : 'off' });
  const who = d => o.alternate ? (d % 2 ? A : B) : d <= 15 ? A : B;
  const M = { year: 2026, month: 11, holidays: [], fixed: {},
    ...(o.previous ? { prev_month: { last_days: [{ date: 31, night: B }] } } : {}),
    ...(o.lower != null ? { count_min: { [A]: o.lower, [B]: o.lower } } : {}),
    unavailable_other: o.paid ? [{ name: A, day: 16, part: 'allday', paid: true }, { name: B, day: 1, part: 'allday', paid: true }] : [] };
  if (o.fixed) for (const sh of o.nightOnly ? ['night'] : ['day', 'night'])
    M.fixed[sh] = Object.fromEntries(Array.from({ length: 30 }, (_, i) => [i + 1, who(i + 1)]));
  const P = new T.Problem(R, T.normalizeMonth(M, R));
  const asg = Object.fromEntries(P.slots.map(s => [s.join(':'), { work: who(s[0]), oc: [] }]));
  return { P, asg };
}
const cases = [];
function feasible(label, o) { cases.push({ label, o, feasible: true }); }
for (const double of ['off', 'soft']) for (const exact of [false, true])
  feasible(`double-${double}/${exact ? 'exact' : 'min'}`, { double, exact });
for (const exact of [false, true]) {
  feasible(`fixed-double/${exact ? 'exact' : 'min'}`, { double: 'hard', fixed: true, exact, composition: true });
  feasible(`fixed-double-paid/${exact ? 'exact' : 'min'}`, { double: 'hard', fixed: true, exact, min: 14, paid: true });
}
feasible('fixed-triple-overlap-with-previous', { double: 'hard', fixed: true, ake: true, sequence: 'hard', min: 14, exact: true, previous: true, composition: true });
feasible('fixed-night-next-overlap', { nightOnly: true, fixed: true, ake: true, sequence: 'hard', min: 14, exact: true, previous: true, quotaState: 'off', composition: true });
feasible('exact-ake-without-hard-sequence', { nightOnly: true, alternate: true, ake: true, previous: true, min: 0, exact: true, double: 'hard', quotaState: 'off' });
feasible('month-lower-overrides-high-quota', { quota: 100, lower: 30 });
feasible('soft-rest-does-not-claim-hard-conflict', { min: 20, rest: 'soft' });
feasible('off-quota-does-not-claim-hard-conflict', { quota: 100, quotaState: 'off' });
feasible('exempt-fixed-workers-remain-exempt', { double: 'hard', fixed: true, exempt: true, min: 29 });
feasible('ordinary-fixed-composition-max-zero', { double: 'hard', fixed: true, composition: 'max0' });
cases.push({ label: 'hard-double-genuine-shortage', o: { double: 'hard' }, shortage: true, quotaWarning: true });
cases.push({ label: 'fixed-overlap-does-not-hide-real-shortage', o: { double: 'hard', fixed: true, min: 16 }, shortage: true, quotaWarning: true });
cases.push({ label: 'paid-days-reduce-real-capacity', o: { double: 'hard', fixed: true, min: 15, paid: true }, shortage: true, quotaWarning: true });
cases.push({ label: 'monthly-lower-above-double-capacity', o: { lower: 31 }, quotaWarning: true });
// count_min is integer-only by the model's admission contract; a fractional lower bound reaches the lint via the quota (tolerance 0).
cases.push({ label: 'fractional-quota-rounds-up', o: { quota: 30.1 }, quotaWarning: true, rounded: { countLo: 30.1, quota: 31, maxShifts: 30 } });
const EXPECTED = 21;
let started = 0, completed = 0, failed = 0, solves = 0, finished = false;
const watchdog = setTimeout(() => { console.error('FAIL overlap regression timeout'); process.exit(1); }, 180000);
process.on('exit', () => { if (!finished || started !== EXPECTED || completed !== EXPECTED || solves !== EXPECTED || failed) process.exitCode = 1; });
(async () => {
  assert.equal(cases.length, EXPECTED);
  const highs = await require(highsPath)();
  for (const c of cases) {
    started++; console.log('SCENARIO_START ' + c.label);
    try {
      const { P, asg } = fixture(c.o), before = JSON.stringify({ rules: P.rules, month: P.m, asg });
      const lint = T.lint(P), check = T.check(P, asg), pen = T.penalty(P, asg);
      // Run the solver even if the baseline diagnostic assertions below will fail.
      solves++; const result = T.solve(P, highs, { pin: c.feasible ? asg : undefined, timeLimit: 30, mipGap: 0 });
      if (c.feasible) {
        assert.deepEqual(check.VC, [], 'independent constructive witness');
        assert.ok(Number.isFinite(pen.total));
        if (c.o.fixed && (c.o.double === 'hard' || c.o.sequence === 'hard')) {
          assert.ok(check.WC.length > 0, 'fixed-conflict warnings remain visible');
          assert.ok(pen.items.fixed_conflict > 0, 'fixed-conflict penalties are not suppressed by a lint fix');
        }
        assert.equal(result.status, 'Optimal'); assert.ok(result.asg);
        assert.deepEqual(T.check(P, result.asg).VC, []);
        assert.ok(Math.abs(result.objective - pen.total) < 1e-6, 'pinned objective agrees with independent penalty');
        assert.ok(!lint.some(x => x.code === QUOTA));
        assert.ok(!lint.some(x => capacity.has(x.code)), 'feasible schedules must not receive capacity impossibility warnings');
      } else {
        assert.equal(result.status, 'Infeasible');
        if (c.shortage) assert.ok(lint.some(x => x.code === SHORT), 'retain genuine aggregate shortage');
        if (c.quotaWarning) assert.ok(lint.some(x => x.code === QUOTA), 'retain genuine hard lower-bound contradiction');
        if (c.rounded) { // a fractional lower bound is kept as entered but compared and shown after rounding up
          assert.equal(P.countLo(A), c.rounded.countLo, 'fractional lower bound is kept as entered');
          const w = lint.find(x => x.code === QUOTA && x.args.who === A);
          assert.ok(w, 'warning names the target person');
          assert.equal(w.args.quota, c.rounded.quota, 'required lower bound is shown rounded up');
          assert.equal(w.args.maxShifts, c.rounded.maxShifts, 'shift capacity under hard days off is reported');
        }
      }
      assert.equal(JSON.stringify({ rules: P.rules, month: P.m, asg }), before, 'no input mutation');
    } catch (e) { failed++; console.error('FAIL ' + c.label, e.stack || e); }
    completed++; console.log('SCENARIO_COMPLETE ' + c.label);
  }
  finished = true; clearTimeout(watchdog);
  console.log('ACCOUNTING ' + JSON.stringify({ expected: EXPECTED, started, completed, failed, solves }));
  if (failed) process.exitCode = 1;
})().catch(e => { clearTimeout(watchdog); console.error(e); process.exitCode = 1; });

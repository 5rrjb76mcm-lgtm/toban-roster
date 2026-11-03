// Exact fixed work remains available under hard composition max 0.
// Synthetic fixtures. Source-authored only; run locally with an existing HiGHS.
// node test_days_off_fixed_composition_person_lint_node.js /absolute/existing/highs
// TOBAN_WEBAPP_ROOT selects baseline/fixed/reverted sources; installs nothing.
const fs = require('fs'), vm = require('vm'), path = require('path'), assert = require('assert/strict');
const root = path.resolve(process.env.TOBAN_WEBAPP_ROOT || __dirname), highsPath = process.argv[2];
console.log('SOURCE_ROOT ' + root);
if (!highsPath || !path.isAbsolute(highsPath)) throw new Error('Supply an absolute existing HiGHS package path');
globalThis.T = {};
for (const f of ['i18n.js', 'rules-core.js', 'model.js', 'messages.js', 'solver.js', 'check.js'])
  vm.runInThisContext(fs.readFileSync(path.join(root, 'src', f), 'utf8'), { filename: f });
for (const dir of ['rules', 'calendars']) for (const f of fs.readdirSync(path.join(root, 'src', dir)).filter(f => f.endsWith('.js')).sort())
  vm.runInThisContext(fs.readFileSync(path.join(root, 'src', dir, f), 'utf8'), { filename: dir + '/' + f });
const A = 'Synthetic Composition Alpha', B = 'Synthetic Composition Bravo';
const FEW = 'LINT_PERSON_TOO_FEW_DAYS', RUN = 'LINT_PERSON_FORCED_RUN';
const cases = [
  { label: 'fixed-day-supplies-busy-day', over: true },
  { label: 'no-fixed-work-is-deficit', fixed: 'none', deficit: 0 },
  { label: 'oc-only-fixed-is-not-work', fixed: 'oc', deficit: 0 },
  { label: 'other-person-fixed-is-not-alpha-work', fixed: 'other', deficit: 0, over: true },
  { label: 'matching-qualification-fixed-exception', qual: true, over: true },
  { label: 'scoped-off-day-fixed-exception', scoped: true, over: true },
  { label: 'fixed-night-retains-night-branch', fixed: 'night', over: true },
  { label: 'soft-composition-does-not-restrict', composition: 'soft' },
  { label: 'off-composition-does-not-restrict', composition: 'off' },
  { label: 'minimum-rest-keeps-no-personal-obligation', mode: 'min', fixed: 'none' },
  { label: 'fixed-only-person-remains-exempt', exempt: true, fixed: 'none' },
  { label: 'one-fixed-day-does-not-hide-real-deficit', need: 2, deficit: 1, over: true },
  { label: 'nonexistent-fixed-slot-does-not-count', absentDay: true, deficit: 0 },
  { label: 'same-date-other-shift-does-not-add-day', need: 2, twoFixed: true, deficit: 1, over: true },
  { label: 'fixed-exception-does-not-open-other-dates', blocked: true, over: true }
];
const EXPECTED = 15;
console.log('REGISTER ' + JSON.stringify(cases.map(c => c.label)));
let started = 0, completed = 0, failed = 0, solves = 0, finished = false;
const watchdog = setTimeout(() => { console.error('FAIL fixed composition lint timeout'); process.exit(1); }, 180000);
watchdog.unref();
process.on('exit', () => { if (!finished || started !== EXPECTED || completed !== EXPECTED || solves !== EXPECTED || failed) process.exitCode = 1; });
function fixture(o) {
  const need = o.need || 1, fixedKind = o.fixed || 'day';
  const R = {
    profile: { id: 'synthetic-fixed-composition-lint', roles: [{ id: 'Staff', refs: [], standby: fixedKind === 'oc' }],
      shifts: [{ id: 'day', on: o.absentDay ? 'none' : 'all' }, { id: 'night', on: 'all' }], positions: { work: { count: 1, min: 0 } } },
    doctors: [{ name: A, team: 'Staff', quota: 0, ...(o.qual ? { quals: ['Q'] } : {}), ...(o.exempt ? { duty: 'fixed_only' } : {}) },
      ...(fixedKind === 'other' ? [{ name: B, team: 'Staff', quota: 0, duty: 'fixed_only' }] : [])],
    quota_tolerance: 0, rule_states: {}, weights: { fixed_conflict: 1000, chief_duty: 0 },
    days_off: { min: 30 - need, mode: o.mode || 'exact', ake_is_off: true },
    composition: [{ shift: 'all', max: 0, ...(o.qual ? { qual: 'Q' } : {}), ...(o.scoped ? { days: 'off_days' } : {}) }]
  };
  T.fillDefaultRules(R);
  for (const d of T.RULE_DEFS) if (d.states.includes('off')) R.rule_states[d.id] = 'off';
  Object.assign(R.rule_states, { days_off_min: 'hard', composition: o.composition || 'hard' });
  const fixed = fixedKind === 'none' ? {} : fixedKind === 'other' ? { day: { 1: B } } :
    fixedKind === 'oc' ? { day_oc: { 1: [A] } } : { [fixedKind]: { 1: A } };
  if (o.twoFixed) fixed.night = { 1: A };
  const M = T.normalizeMonth({ year: 2026, month: 11, holidays: [], fixed,
    unavailable_other: o.scoped || o.blocked ? Array.from({ length: 29 }, (_, i) => ({ name: A, day: i + 2, part: 'allday' })) : [] }, R);
  const P = new T.Problem(R, M);
  assert.equal(P.N, 30); assert.equal(P.slots.length, o.absentDay ? 30 : 60);
  assert.equal(P.offTarget(A), 30 - need); assert.equal(P.isExempt(A), !!o.exempt);
  assert(P.slots.every(s => P.countMinOf(s) === 0 && P.countOf(s) === 1));
  if (fixedKind === 'oc') { assert.deepEqual(P.fixedDayOc[1], [A]); assert.equal(P.isFixedEng([1, 'day'], A), true); assert.equal(P.isFixedWork([1, 'day'], A), false); }
  if (fixedKind === 'day' && !o.absentDay) assert.equal(P.isFixedWork([1, 'day'], A), true);
  if (fixedKind === 'night' || o.twoFixed) assert.equal(P.isFixedWork([1, 'night'], A), true);
  assert.equal(P.comp[0].max, 0); assert.equal(P.compMatch(P.comp[0], A), true);
  if (o.scoped) assert.equal(P.compOn(P.comp[0], [1, 'day']), true);
  const witness = Object.fromEntries(P.slots.map(([d, k]) => [`${d}:${k}`, {
    work: d === 1 && (fixed[k] || {})[1] ? fixed[k][1] : [],
    oc: d === 1 && k === 'day' && fixedKind === 'oc' ? [A] : []
  }]));
  return { P, witness };
}
(async () => {
  const highs = await require(highsPath)();
  assert.equal(cases.length, EXPECTED);
  for (const c of cases) {
    started++; console.log('SCENARIO_START ' + c.label);
    try {
      const { P, witness } = fixture(c), before = JSON.stringify({ rules: P.rules, month: P.m, witness });
      const negative = c.deficit !== undefined;
      // Always solve before baseline-sensitive diagnostic assertions.
      solves++; const result = T.solve(P, highs, { timeLimit: 10, mipGap: 0 });
      const check = T.check(P, witness), pen = T.penalty(P, witness);
      assert(Number.isFinite(pen.total), 'independent witness penalty is finite');
      assert.equal(result.status, negative ? 'Infeasible' : 'Optimal');
      if (!negative) {
        assert.deepEqual(check.VC, [], 'constructive witness');
        assert(Math.abs(pen.total - result.objective) < 1e-6, 'constructive witness objective/penalty parity');
        assert(result.asg); assert.deepEqual(T.check(P, result.asg).VC, [], 'independent solver check');
        assert(Math.abs(T.penalty(P, result.asg).total - result.objective) < 1e-6, 'objective/penalty parity');
      } else assert(check.VC.some(v => v.code === 'DAYS_OFF_OVER' && v.args.who === A), 'negative witness independently violates Alpha exact rest');
      if (c.over) assert(check.WC.some(v => v.code === 'COMPOSITION_OVER'), 'fixed composition excess remains permitted warning');
      if (!c.composition || c.composition === 'hard') {
        assert.equal(pen.items.composition_miss || 0, 0, 'hard composition exception has no penalty');
        if (!negative) assert.equal(pen.total, 0, 'feasible hard-composition witness has no penalty');
        // Hard-rest negative witnesses are outside penalty's feasible-input contract;
        // its rest-distance arithmetic may still contribute days_off_short.
      }
      const lint = T.lint(P), personal = lint.filter(v => v.code === FEW || v.code === RUN);
      // A fixed night deliberately takes the existing night-candidate escape branch.
      const expectFew = negative && !c.twoFixed;
      assert.deepEqual(personal.map(v => v.code), expectFew ? [FEW] : []);
      if (expectFew) { assert.equal(personal[0].args.who, A); assert.equal(personal[0].args.avail, c.deficit); assert.equal(personal[0].args.need, c.need || 1); }
      if (c.absentDay) assert(lint.some(v => v.code === 'LINT_FIXED_NO_SLOT'));
      if (!negative) assert.deepEqual(lint, [], 'no overlapping input warning in admitted positive fixture');
      assert.equal(JSON.stringify({ rules: P.rules, month: P.m, witness }), before, 'inputs preserved');
    } catch (e) { failed++; console.error('FAIL ' + c.label, e.stack || e); }
    finally { completed++; console.log('SCENARIO_COMPLETE ' + c.label); }
  }
  clearTimeout(watchdog); finished = true;
  console.log('ACCOUNTING ' + JSON.stringify({ expected: EXPECTED, started, completed, solves, failed }));
  if (failed) process.exitCode = 1;
})().catch(e => { clearTimeout(watchdog); console.error(e); process.exitCode = 1; });

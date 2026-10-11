// Rule-level diagnosis and individually sufficient alternatives, with real HiGHS.
// All names and work commitments below are fictional; no saved user data is read.
// node test_rule_diagnose_node.js /path/to/highs [historical-solver.js]
// An optional unmodified historical solver proves the original omission/reduction.
const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert');
const copy = value => JSON.parse(JSON.stringify(value));
function runtime(solverPath) {
  const context = vm.createContext({ console, Date });
  for (const file of ['i18n.js', 'rules-core.js', 'model.js', 'messages.js', 'solver.js', 'check.js']) {
    const source = file === 'solver.js' && solverPath ? solverPath : path.join(__dirname, 'src', file);
    vm.runInContext(fs.readFileSync(source, 'utf8'), context, { filename: source });
  }
  for (const dir of ['rules', 'calendars']) for (const file of fs.readdirSync(path.join(__dirname, 'src', dir)).filter(f => f.endsWith('.js')).sort()) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, 'src', dir, file), 'utf8'), context, { filename: dir + '/' + file });
  }
  context.T.DEFAULT_RULES = JSON.parse(fs.readFileSync(path.join(__dirname, 'data/rules.json'), 'utf8'));
  return context.T;
}
const T = runtime(), A = 'Synthetic A', B = 'Synthetic B', C = 'Synthetic C', D = 'Synthetic D';
const OUTPATIENT = 'local.synthetic.outpatient', JOINT = 'local.synthetic:joint rule', MANAGER = 'local.synthetic:manager';
function rules(api, names, work = { count: 2, min: 0 }) {
  const R = {
    profile: { id: 'fictional-rule-diagnosis', quota_mode: 'absolute',
      roles: [{ id: 'S', refs: [], standby: false }],
      shifts: [{ id: 'day', on: 'all' }, { id: 'night', on: 'all' }],
      positions: { work: Object.fromEntries(Object.entries(work).map(([key, value]) => [key, { day: value, night: 0 }])) } },
    doctors: names.map(name => ({ name, team: 'S', quals: ['Manager'], quota: 10 })),
    weights: { fixed_conflict: 1000 }, rule_states: {}
  };
  api.fillDefaultRules(R);
  for (const def of api.RULE_DEFS) if (def.states.includes('off')) R.rule_states[def.id] = 'off';
  return R;
}
function registerOutpatient(api) {
  api.rules.register({ id: OUTPATIENT, api: 1, states: ['hard', 'off'], def: 'off',
    label: 'Synthetic outpatient commitment',
    solve(ctx) { ctx.limit(OUTPATIENT, ctx.work([24, 'day'], D), '<=', 0, { slot: [24, 'day'], names: [D] }); },
    check(ctx) { if (ctx.worked(D, [24, 'day'])) ctx.viol('SYNTHETIC_OUTPATIENT', { who: D }, 24, D); },
    explainSlot(ctx) { return ctx.name === D && ctx.slot[0] === 24 && ctx.slot[1] === 'day' ? [{
      code: 'SYNTHETIC_OUTPATIENT', slot: [24, 'day'], names: [D],
      evidence: { source: 'fictional test fixture', commitment: 'Synthetic outpatient session on Nov 24' }
    }] : []; },
    messages: { SYNTHETIC_OUTPATIENT: { en: '{who}: fictional outpatient session prevents this assignment' } }
  });
}
function reproduction(api = T) {
  registerOutpatient(api);
  const R = rules(api, [A, B, C, D]);
  R.shift_run_max = { day: 3 };
  R.composition = [{ shift: 'day', qual: 'Manager', min: 1 }];
  Object.assign(R.rule_states, { shift_run_max: 'hard', composition: 'hard', [OUTPATIENT]: 'hard' });
  const M = api.normalizeMonth({ year: 2026, month: 11, holidays: [],
    fixed: { day: { 25: [A, B], 26: [A, B], 27: [A, B] } },
    unavailable_other: [{ name: C, day: 24, part: 'day' }]
  }, R);
  return new api.Problem(R, M);
}
function jointProblem() {
  T.rules.register({ id: JOINT, api: 1, states: ['hard', 'off'], def: 'off', label: 'Two independent fictional restrictions',
    solve(ctx) { for (const day of [1, 2]) ctx.limit(JOINT, ctx.work([day, 'day'], A), '<=', 0, { slot: [day, 'day'], names: [A] }); },
    check(ctx) { for (const day of [1, 2]) if (ctx.worked(A, [day, 'day'])) ctx.viol('SYNTHETIC_JOINT', {}, day, A); },
    messages: { SYNTHETIC_JOINT: { en: 'Fictional restriction violated' } }
  });
  const R = rules(T, [A], { count: 1 }); R.rule_states[JOINT] = 'hard';
  return new T.Problem(R, T.normalizeMonth({ year: 2026, month: 11 }, R));
}
function pluginManagerProblem() {
  T.rules.register({ id: MANAGER, api: 1, states: ['hard', 'off'], def: 'off', label: 'Fictional manager headcount',
    solve(ctx) {
      // Structural builder rows survive automatic relaxation of this plugin's limits.
      const structural = ctx.lp.bin('synthetic_manager_structure'); ctx.lp.add(structural, '=', 0);
      for (const slot of ctx.slots.filter(s => s[1] === 'day')) {
        const managers = ctx.names.filter(name => (ctx.P.doctors[name].quals || []).includes('Manager'));
        const count = ctx.LP.sum(managers.map(name => ctx.work(slot, name)));
        // Two declared rows deliberately share one slot selector. The selector is
        // a group of rows, never a promise to remove exactly one LP constraint.
        ctx.limit(MANAGER, count, '>=', 1, { slot, names: managers });
        ctx.limit(MANAGER, count, '>=', 1, { slots: [slot], names: managers });
      }
    },
    check(ctx) { for (const slot of ctx.P.slots.filter(s => s[1] === 'day')) {
      if (!ctx.A.workers(slot).some(name => (ctx.P.doctors[name].quals || []).includes('Manager'))) ctx.viol('SYNTHETIC_MANAGER', {}, slot[0]);
    } }, messages: { SYNTHETIC_MANAGER: { en: 'At least one fictional manager is needed' } }
  });
  const original = reproduction(), R = copy(original.rules);
  R.rule_states.composition = 'off'; R.rule_states[MANAGER] = 'hard';
  return new T.Problem(R, T.normalizeMonth(copy(original.m), R));
}
let passed = 0;
async function test(label, fn) { await fn(); passed++; console.log('ok ' + label); }
(async () => {
  if (!process.argv[2]) throw new Error('Pass an installed HiGHS package path');
  const highs = await require(process.argv[2])(), P = reproduction();
  const feasible = (problem, relax = [], api = T) => api.solveFeasibility(problem, highs, { timeLimit: 3, relax });
  const initialInput = JSON.stringify({ rules: P.rules, month: P.m });
  await test('Nov 24 reproduction is infeasible with the real solver', () => {
    assert.strictEqual(T.solve(P, highs, { timeLimit: 3 }).status, 'Infeasible');
    assert.strictEqual(feasible(P).outcome, 'infeasible');
    assert.deepStrictEqual(copy(P.dutyNames), [A, B, C, D]);
    assert(P.comp.every(c => c.min === 1 && c.qual === 'Manager'));
    assert.deepStrictEqual(copy(P.unavailOther[C]), [[24, 'day']]);
    for (const day of [25, 26, 27]) assert.deepStrictEqual(copy(P.fixedDay[day]), [A, B]);
    assert.strictEqual(P.countOf([25, 'day']), 2, 'Multiple fixed workers fit in the slot');
  });
  await test('whole-rule and Nov 24 shift-run relaxation each have verified feasible witnesses', () => {
    for (const relax of [[T.rules.relaxKey('shift_run_max')], [T.rules.relaxKey('shift_run_max', { slot: [24, 'day'] })]]) {
      const result = feasible(P, relax); assert.strictEqual(result.outcome, 'feasible');
      const assigned = new T.Asg(P, result.asg); assert([A, B].some(n => assigned.worked(n, [24, 'day'])));
      assert(T.check(P, result.asg).VC.some(v => v.code === 'SHIFT_RUN_TOO_LONG'), 'The original checker still enforces the relaxed rule');
    }
  });
  await test('removing each Nov 25, 26 or 27 fixed slot alone restores feasibility', () => {
    for (const day of [25, 26, 27]) assert.strictEqual(feasible(P, ['fixed:day:' + day]).outcome, 'feasible', String(day));
  });
  if (process.argv[3]) await test('historical real-solver diagnosis omits shift-run and keeps only one arbitrary fixed member', async () => {
    const previous = runtime(path.resolve(process.argv[3])), oldP = reproduction(previous);
    assert.strictEqual(previous.buildLP(oldP).lp.toLP(), T.buildLP(P).lp.toLP(), 'The historical and new solver model is identical without relaxation');
    assert.strictEqual(feasible(oldP, [], previous).outcome, 'infeasible');
    const result = await previous.diagnose(oldP, highs, 3, null, { totalTimeLimit: 30 });
    assert(!result.some(line => (line.ruleId || line.key).includes('shift_run_max')));
    const fixed = result.find(line => line.key === 'fixed'); assert(fixed && fixed.combined);
    assert.strictEqual(fixed.items.length, 1, 'Deletion filtering exposes one member rather than all alternatives');
    assert.strictEqual(fixed.items[0].key, 'fixed:day:27', 'The last visited feasible alternative survives');
    for (const day of [25, 26, 27]) assert.strictEqual(feasible(oldP, ['fixed:day:' + day], previous).outcome, 'feasible');
  });
  let diagnosis;
  await test('new diagnosis discovers the rule and enumerates all three fixed alternatives chronologically', async () => {
    diagnosis = await T.diagnose(P, highs, 3, null, { totalTimeLimit: 30 });
    const shift = diagnosis.find(line => line.ruleId === 'shift_run_max'); assert(shift && !shift.undecided);
    assert(shift.alternatives.some(item => item.key === T.rules.relaxKey('shift_run_max', { slot: [24, 'day'] })));
    const fixed = diagnosis.find(line => line.key === 'fixed'); assert(fixed);
    assert.deepStrictEqual(copy(fixed.alternatives.map(item => item.key)), [25, 26, 27].map(day => 'fixed:day:' + day));
    assert.strictEqual(fixed.individualsCount, 3); assert.strictEqual(fixed.individualsTested, 3); assert.strictEqual(fixed.individualsComplete, true);
    assert.strictEqual(fixed.combined, undefined); assert.deepStrictEqual(copy(fixed.items), []); assert.deepStrictEqual(copy(fixed.individualUnknown), []);
    for (const alternative of fixed.alternatives) assert.strictEqual(feasible(P, [alternative.key]).outcome, 'feasible');
  });
  await test('fixed-window and outpatient evidence explain every qualified Nov 24 exclusion', () => {
    for (const name of [A, B]) {
      const evidence = T.rules.explainSlot(P, [24, 'day'], name).find(item => item.code === 'SHIFT_RUN_FORCED_WINDOW');
      assert(evidence); assert.deepStrictEqual(copy(evidence.evidence.fixedSlots), [[25, 'day'], [26, 'day'], [27, 'day']]);
      assert.strictEqual(T.rules.explainSlot(P, [24, 'day'], name, { relax: ['fixed:day:26'] }).filter(item => item.id === 'shift_run_max').length, 0);
      assert.strictEqual(T.rules.explainSlot(P, [24, 'day'], name, { relax: [T.rules.relaxKey('shift_run_max', { slot: [24, 'day'] })] }).filter(item => item.id === 'shift_run_max').length, 0);
    }
    const outpatient = T.rules.explainSlot(P, [24, 'day'], D).find(item => item.id === OUTPATIENT);
    assert(outpatient && outpatient.evidence.commitment.includes('Nov 24'));
    assert.strictEqual(feasible(P, [T.rules.relaxKey(OUTPATIENT, { slot: [24, 'day'] })]).outcome, 'feasible');
    assert.strictEqual(feasible(P, ['unavail:' + C]).outcome, 'feasible');
    assert.strictEqual(T.rules.explainSlot(P, [23, 'day'], D).filter(item => item.id === OUTPATIENT).length, 0);
  });
  await test('Nov 24 composition explanation records zero candidates and all four concrete exclusions', () => {
    assert.strictEqual(diagnosis.explanationsComplete, true);
    const evidence = diagnosis.slotExplanations.find(item => item.ruleId === 'composition' && item.slot[0] === 24 && item.slot[1] === 'day');
    assert(evidence); assert.strictEqual(evidence.required, 1); assert.strictEqual(evidence.eligibleCount, 4); assert.strictEqual(evidence.possibleCount, 0);
    assert.deepStrictEqual(copy(evidence.candidates.map(item => item.name)), [A, B, C, D]);
    for (const name of [A, B]) {
      const excluded = evidence.candidates.find(item => item.name === name).exclusions.find(item => item.code === 'SHIFT_RUN_FORCED_WINDOW');
      assert(excluded); assert.deepStrictEqual(copy(excluded.evidence.fixedSlots), [[25, 'day'], [26, 'day'], [27, 'day']]);
    }
    const unavailable = evidence.candidates.find(item => item.name === C).exclusions.find(item => item.code === 'DIAG_SLOT_UNAVAILABLE');
    assert(unavailable); assert.strictEqual(unavailable.evidence.input, 'unavailable_other');
    const outpatient = evidence.candidates.find(item => item.name === D).exclusions.find(item => item.id === OUTPATIENT);
    assert(outpatient); assert.strictEqual(outpatient.evidence.source, 'fictional test fixture');
    assert.strictEqual(outpatient.evidence.commitment, 'Synthetic outpatient session on Nov 24');
  });
  await test('a colon-ID manager plugin is diagnosed at Nov 24 without any built-in composition rule', async () => {
    const p = pluginManagerProblem(), key = T.rules.relaxKey(MANAGER), slotKey = T.rules.relaxKey(MANAGER, { slot: [24, 'day'] });
    assert.strictEqual(p.state('composition'), 'off'); assert.strictEqual(key, 'rule:local.synthetic%3Amanager');
    assert.strictEqual(slotKey, 'rule:local.synthetic%3Amanager:slot:24:day');
    assert.strictEqual(feasible(p).outcome, 'infeasible');
    assert.strictEqual(feasible(p, [key]).outcome, 'feasible');
    assert.strictEqual(feasible(p, [slotKey]).outcome, 'feasible');
    assert.strictEqual(feasible(p, [T.rules.relaxKey(MANAGER, { slot: [23, 'day'] })]).outcome, 'infeasible');
    const result = await T.diagnose(p, highs, 3), line = result.find(item => item.ruleId === MANAGER);
    assert(line && !line.undecided); assert.strictEqual(line.key, key); assert.strictEqual(line.individualsCount, 30);
    assert.strictEqual(line.individualsComplete, true); assert.deepStrictEqual(copy(line.alternatives.map(item => item.key)), [slotKey]);
    const fixed = result.find(item => item.key === 'fixed');
    assert.deepStrictEqual(copy(fixed.alternatives.map(item => item.key)), [25, 26, 27].map(day => 'fixed:day:' + day));
  });
  await test('one slot selector removes multiple declared manager rows while retaining raw structural rows', () => {
    const p = pluginManagerProblem(), rows = [], original = T.buildLP(p, { diagnosticRows: rows });
    const scope = T.rules.relaxKey(MANAGER, { slot: [24, 'day'] }), targetRows = rows.filter(row => row.id === MANAGER && row.slots.some(slot => slot[0] === 24));
    assert.strictEqual(targetRows.length, 2, 'Two declared rows share the Nov 24 slot selector');
    const scoped = T.buildLP(p, { relax: [scope] }), whole = T.buildLP(p, { relax: [T.rules.relaxKey(MANAGER)] });
    assert.strictEqual(original.lp.cons.length - scoped.lp.cons.length, 2);
    assert.strictEqual(original.lp.cons.length - whole.lp.cons.length, 60);
    const structure = built => built.lp.cons.filter(row => row.terms.some(([name]) => name === 'synthetic_manager_structure'));
    for (const built of [scoped, whole]) {
      assert(built.lp.vars.has('synthetic_manager_structure'));
      assert.deepStrictEqual(copy(structure(built)), copy(structure(original)));
      assert.strictEqual(structure(built).length, 1);
    }
    // The two rows are identical hard headcounts. Removing only one still leaves
    // its independent twin, so a successful slot relaxation cannot mean one row.
    const missing = original.lp.cons.filter(row => !scoped.lp.cons.some(other => JSON.stringify(other) === JSON.stringify(row)));
    assert.strictEqual(missing.length, 2); assert.deepStrictEqual(copy(missing[0]), copy(missing[1]));
    original.lp.cons.splice(original.lp.cons.indexOf(missing[0]), 1);
    assert.strictEqual(highs.solve(original.lp.toLP(), { time_limit: 3, output_flag: false }).Status, 'Infeasible');
    assert.strictEqual(feasible(p, [scope]).outcome, 'feasible');
  });
  await test('inventory and diagnosis leave inputs and the ordinary optimization model unchanged', () => {
    const before = T.buildLP(P).lp.toLP(), rows = [];
    assert.strictEqual(T.buildLP(P, { diagnosticRows: rows }).lp.toLP(), before);
    assert(rows.some(row => row.id === 'shift_run_max' && row.slots.some(slot => slot[0] === 24)));
    assert.strictEqual(JSON.stringify({ rules: P.rules, month: P.m }), initialInput);
  });
  const joint = jointProblem();
  await test('two necessary rule-row removals remain a joint set, not two sufficient alternatives', async () => {
    const id = T.rules.relaxKey(JOINT), keys = [1, 2].map(day => T.rules.relaxKey(JOINT, { slot: [day, 'day'] }));
    assert(id.includes('%3A') && id.includes('%20'), 'Rule ids must be encoded rather than split');
    assert.strictEqual(feasible(joint).outcome, 'infeasible');
    for (const key of keys) assert.strictEqual(feasible(joint, [key]).outcome, 'infeasible');
    assert.strictEqual(feasible(joint, keys).outcome, 'feasible');
    const result = await T.diagnose(joint, highs, 3), line = result.find(item => item.key === id);
    assert(line); assert.deepStrictEqual(copy(line.alternatives), []); assert.strictEqual(line.combined, true);
    assert.deepStrictEqual(copy(line.items.map(item => item.key)), keys); assert.strictEqual(line.inclusionMinimal, true);
    assert.strictEqual(line.incomplete, false); assert.strictEqual(line.individualsComplete, true);
    assert.strictEqual(line.individualsCount, 2); assert.strictEqual(line.individualsTested, 2);
  });
  await test('legacy unavailable joint removals do not claim row-monotone inclusion minimality', async () => {
    const R = rules(T, [A, B], { count: 2 });
    const p = new T.Problem(R, T.normalizeMonth({ year: 2026, month: 11,
      unavailable_other: [A, B].map(name => ({ name, day: 1, part: 'day' })) }, R));
    const result = await T.diagnose(p, highs, 3), line = result.find(item => item.key === 'unavailable');
    assert(line && line.combined); assert.strictEqual(line.items.length, 2); assert.strictEqual(line.inclusionMinimal, false);
    assert.deepStrictEqual(copy(line.alternatives), []); assert.strictEqual(feasible(p, line.items.map(item => item.key)).outcome, 'feasible');
    for (const item of line.items) assert.strictEqual(feasible(p, [item.key]).outcome, 'infeasible');
  });
  await test('unknown individual trials stay separate from verified alternatives', async () => {
    let current;
    const adapter = { solve: (text, opts) => current && current.phase === 'individual' && current.currentKey === 'fixed:day:26' ? { Status: 'Unknown' } : highs.solve(text, opts) };
    const result = await T.diagnose(P, adapter, 3, progress => { current = progress; }, { totalTimeLimit: 30 });
    const line = result.find(item => item.key === 'fixed');
    assert.deepStrictEqual(copy(line.alternatives.map(item => item.key)), ['fixed:day:25', 'fixed:day:27']);
    assert.strictEqual(line.individualsTested, 3); assert.strictEqual(line.individualsComplete, false);
    assert.deepStrictEqual(copy(line.individualUnknown.map(item => [item.key, item.status])), [['fixed:day:26', 'Unknown']]);
    assert.strictEqual(line.combined, undefined); assert.deepStrictEqual(copy(line.items), []);
  });
  await test('zero total budget makes no solver calls and returns explicit untested rules', async () => {
    let calls = 0; const progress = [];
    const result = await T.diagnose(P, { solve() { calls++; throw new Error('Must not run'); } }, 3, p => progress.push(p), { totalTimeLimit: 0 });
    assert.strictEqual(calls, 0); assert(result.some(line => line.ruleId === 'shift_run_max' && line.undecided && line.reason === 'budget'));
    assert(result.every(line => (line.undecided && line.reason === 'budget') || (line.groupOutcome === 'undecided' && line.groupEvidence.reason === 'budget' && !line.alternatives.length && line.individualUnknown.every(c => c.reason === 'budget')))); assert(progress.every(p => p.remainingSeconds === 0));
  });
  await test('budget exhaustion preserves known alternatives and labels remaining candidates untested', async () => {
    const realNow = Date.now; let clock = 1000, current; Date.now = () => clock;
    try {
      const limits = [], adapter = { solve(text, opts) {
        limits.push(opts.time_limit); const result = highs.solve(text, opts);
        if (current && current.phase === 'individual' && current.currentKey === 'fixed:day:25') clock += 1001;
        return result;
      } };
      const result = await T.diagnose(P, adapter, 3, progress => { current = progress; }, { totalTimeLimit: 1 });
      const line = result.find(item => item.key === 'fixed');
      assert.deepStrictEqual(copy(line.alternatives.map(item => item.key)), ['fixed:day:25']);
      assert.strictEqual(line.individualsCount, 3); assert.strictEqual(line.individualsTested, 1); assert.strictEqual(line.individualsComplete, false);
      assert.deepStrictEqual(copy(line.individualUnknown.map(item => [item.key, item.reason])), [['fixed:day:26', 'budget'], ['fixed:day:27', 'budget']]);
      assert(limits.every(limit => limit > 0 && limit <= 1));
    } finally { Date.now = realNow; }
  });
  await test('cancellation propagates instead of becoming unknown evidence', async () => {
    let current;
    await assert.rejects(() => T.diagnose(P, { solve(text, opts) {
      if (current && current.phase === 'individual') return Promise.reject(new Error('中止しました'));
      return highs.solve(text, opts);
    } }, 3, progress => { current = progress; }), /中止/);
  });
  await test('direct structural plugin rows are retained and their diagnostic coverage is explicit', async () => {
    const id = 'local.synthetic.raw-only';
    T.rules.register({ id, api: 1, states: ['hard', 'off'], def: 'off', solve(ctx) { ctx.lp.add(0, '=', 1); }, check() {} });
    const R = rules(T, [A], { count: 1 }); R.rule_states[id] = 'hard';
    const p = new T.Problem(R, T.normalizeMonth({ year: 2026, month: 11 }, R));
    assert.strictEqual(feasible(p, [T.rules.relaxKey(id)]).outcome, 'infeasible');
    const result = await T.diagnose(p, highs, 3);
    assert(!result.some(line => line.ruleId === id && !line.undecided));
    const coverage = result.coverage.find(item => item.ruleId === id); assert(coverage && coverage.status === 'direct-only-or-no-rows');
    T.rules.unregister(id);
  });
  console.log(`ALL OK (${passed}; all feasibility claims checked with real HiGHS)`);
})().catch(error => { console.error(error); process.exitCode = 1; });

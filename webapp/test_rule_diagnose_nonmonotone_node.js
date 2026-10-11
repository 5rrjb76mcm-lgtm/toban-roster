// Fixed inputs also grant narrow exceptions, so removing more fixed inputs need
// not preserve feasibility. All names, dates, and commitments are synthetic.
// node test_rule_diagnose_nonmonotone_node.js /path/to/highs
const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert');
const context = vm.createContext({ console, Date });
for (const file of ['i18n.js', 'rules-core.js', 'model.js', 'messages.js', 'solver.js', 'check.js']) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, 'src', file), 'utf8'), context, { filename: file });
}
for (const dir of ['rules', 'calendars']) for (const file of fs.readdirSync(path.join(__dirname, 'src', dir)).filter(f => f.endsWith('.js')).sort()) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, 'src', dir, file), 'utf8'), context, { filename: dir + '/' + file });
}
const T = context.T, A = 'Synthetic A', B = 'Synthetic B';
T.DEFAULT_RULES = JSON.parse(fs.readFileSync(path.join(__dirname, 'data/rules.json'), 'utf8'));
const copy = value => JSON.parse(JSON.stringify(value));
function fixture() {
  const R = {
    profile: { id: 'synthetic-fixed-nonmonotone', quota_mode: 'absolute',
      roles: [{ id: 'S', refs: [], standby: false }],
      shifts: [{ id: 'day', on: 'all' }, { id: 'night', on: 'all' }],
      positions: { work: { count: { day: 1, night: 0 } } } },
    doctors: [A, B].map(name => ({ name, team: 'S', quota: 10 })),
    weights: { fixed_conflict: 1000 }, rule_states: {}
  };
  T.fillDefaultRules(R);
  for (const d of T.RULE_DEFS) if (d.states.includes('off')) R.rule_states[d.id] = 'off';
  R.rule_states.shift_run_max = 'hard'; R.shift_run_max = { day: 3 };
  const M = T.normalizeMonth({ year: 2026, month: 11, holidays: [],
    fixed: { day: { 1: [B], 25: [A], 26: [A], 27: [A] } },
    unavailable_other: [
      { name: A, day: 1, part: 'day' }, { name: B, day: 1, part: 'day' },
      { name: B, day: 24, part: 'day' }
    ]
  }, R);
  return new T.Problem(R, M);
}
function staticFixture(fixedNames, { states = {}, capacity = 2 } = {}) {
  const R = {
    profile: { id: 'synthetic-fixed-capacity', quota_mode: 'absolute',
      roles: [{ id: 'S', refs: [], standby: false }],
      shifts: [{ id: 'day', on: 'all' }, { id: 'night', on: 'all' }],
      positions: { work: { count: { day: capacity, night: 0 }, min: { day: 0, night: 0 } } } },
    doctors: [A, B, 'Synthetic C', 'Synthetic excluded'].map(name => ({ name, team: 'S', quota: 10,
      quals: name === B ? ['Manager'] : [], duty: name === 'Synthetic excluded' ? 'never' : 'normal' })),
    weights: { fixed_conflict: 1000 }, rule_states: {}
  };
  T.fillDefaultRules(R);
  for (const d of T.RULE_DEFS) if (d.states.includes('off')) R.rule_states[d.id] = 'off';
  R.rule_states.composition = 'hard'; R.composition = [{ shift: 'day', qual: 'Manager', min: 1 }];
  Object.assign(R.rule_states, states);
  return new T.Problem(R, T.normalizeMonth({ year: 2026, month: 11, holidays: [],
    fixed: { day: { 24: fixedNames } }
  }, R));
}
let passed = 0;
async function test(label, fn) { await fn(); passed++; console.log('ok ' + label); }
(async () => {
  if (!process.argv[2]) throw new Error('Pass an installed HiGHS package path');
  const highs = await require(process.argv[2])(), P = fixture();
  const before = JSON.stringify({ rules: P.rules, month: P.m }), ordinary = T.buildLP(P).lp.toLP();
  const solve = relax => T.solveFeasibility(P, highs, { relax, timeLimit: 3 });
  const expected = [25, 26, 27].map(day => 'fixed:day:' + day);
  const assertAlternatives = line => {
    assert(line, 'Fixed alternatives must be searched even without feasible whole-group removal');
    assert.deepStrictEqual(copy(line.alternatives.map(item => item.key)), expected);
    assert.strictEqual(line.individualsCount, 4);
    assert.strictEqual(line.individualsTested, 4);
    assert.strictEqual(line.individualsComplete, true);
    assert.deepStrictEqual(copy(line.individualUnknown), []);
    assert.strictEqual(line.combined, undefined);
    for (const item of line.alternatives) assert.strictEqual(solve([item.key]).outcome, 'feasible');
  };
  await test('all-fixed removal is infeasible while three singleton removals each solve', () => {
    assert.strictEqual(solve([]).outcome, 'infeasible');
    assert.strictEqual(solve(['fixed']).outcome, 'infeasible', 'Removing Nov 1 fixed work restores its unavailability restriction');
    assert.strictEqual(solve(['fixed:day:1']).outcome, 'infeasible');
    for (const key of expected) assert.strictEqual(solve([key]).outcome, 'feasible');
  });
  await test('diagnosis retains all singleton alternatives after infeasible whole-group trial', async () => {
    const result = await T.diagnose(P, highs, 3, null, { totalTimeLimit: 30 });
    const line = result.find(item => item.key === 'fixed');
    assertAlternatives(line);
    assert.strictEqual(line.groupOutcome, 'infeasible');
    assert.strictEqual(line.groupEvidence.status, 'Infeasible');
    assert(!line.undecided, 'Known singleton evidence must remain renderable');
  });
  await test('unknown whole-group trial does not suppress independently verified singletons', async () => {
    let current;
    const adapter = { solve(text, opts) {
      if (current && current.phase === 'group' && current.currentKey === 'fixed') return { Status: 'Unknown' };
      return highs.solve(text, opts);
    } };
    const result = await T.diagnose(P, adapter, 3, progress => { current = progress; }, { totalTimeLimit: 30 });
    const line = result.find(item => item.key === 'fixed');
    assertAlternatives(line);
    assert.strictEqual(line.groupOutcome, 'undecided');
    assert.strictEqual(line.groupEvidence.status, 'Unknown');
    assert.strictEqual(line.groupEvidence.reason, 'no-witness');
  });
  await test('nonmonotone diagnosis leaves input and ordinary LP unchanged', () => {
    assert.strictEqual(JSON.stringify({ rules: P.rules, month: P.m }), before);
    assert.strictEqual(T.buildLP(P).lp.toLP(), ordinary);
  });
  for (const [label, fixedNames] of [
    ['duplicate', [A, A]], ['unknown', [A, 'Synthetic unknown']], ['non-candidate', [A, 'Synthetic excluded']]
  ]) await test(`${label} fixed names cannot prove a slot is at capacity`, async () => {
    const problem = staticFixture(fixedNames);
    const feasible = T.solveFeasibility(problem, highs, { timeLimit: 3 });
    assert.strictEqual(feasible.outcome, 'feasible');
    assert([].concat(feasible.asg['24:day'].work).includes(B));
    const result = await T.diagnose(problem, highs, 3, null, { totalTimeLimit: 30 });
    assert.strictEqual(result.explanationsComplete, true);
    assert(!result.slotExplanations.some(item => item.slot[0] === 24 && item.slot[1] === 'day'),
      'A feasible Manager candidate must not be excluded by ineffective fixed names');
  });
  await test('two distinct effective fixed workers still prove the slot is full', async () => {
    const problem = staticFixture([A, 'Synthetic C']);
    assert.strictEqual(T.solveFeasibility(problem, highs, { timeLimit: 3 }).outcome, 'infeasible');
    const result = await T.diagnose(problem, highs, 3, null, { totalTimeLimit: 30 });
    const slot = result.slotExplanations.find(item => item.slot[0] === 24 && item.slot[1] === 'day');
    assert(slot); assert.strictEqual(slot.possibleCount, 0);
    const excluded = slot.candidates.find(item => item.name === B).exclusions.find(item => item.code === 'DIAG_SLOT_FIXED_FULL');
    assert(excluded); assert.deepStrictEqual(copy(excluded.evidence.fixedNames), [A, 'Synthetic C']);
    assert.strictEqual(excluded.evidence.capacity, 2);
  });
  await test('zero structural capacity is not attributed to nonexistent fixed workers', async () => {
    const problem = staticFixture([], { capacity: 0 });
    assert.strictEqual(T.solveFeasibility(problem, highs, { timeLimit: 3 }).outcome, 'infeasible');
    const result = await T.diagnose(problem, highs, 3, null, { totalTimeLimit: 30 });
    assert.strictEqual(result.explanationsComplete, true);
    assert(!result.slotExplanations.some(item => item.candidates.some(candidate =>
      candidate.exclusions.some(exclusion => exclusion.code === 'DIAG_SLOT_FIXED_FULL'))));
  });
  for (const mode of ['throws', 'missing evidence', 'invalid return', 'mixed invalid batch']) await test(`optional hook ${mode} preserves solver evidence and other valid hooks`, async () => {
    const broken = 'local.synthetic.explanation.broken', valid = 'local.synthetic.explanation.valid';
    const atTarget = ctx => ctx.name === B && ctx.slot[0] === 24 && ctx.slot[1] === 'day';
    const proof = code => ({ code, slot: [24, 'day'], names: [B],
      evidence: { fixedNames: [A, 'Synthetic C'], capacity: 2 } });
    T.rules.register({ id: broken, api: 1, states: ['hard', 'off'], def: 'off', explainSlot(ctx) {
      if (!atTarget(ctx)) return [];
      if (mode === 'throws') throw new Error('Synthetic explanation failure');
      if (mode === 'invalid return') return proof('SYNTHETIC_BROKEN_PROOF');
      if (mode === 'mixed invalid batch') return [proof('SYNTHETIC_BROKEN_PROOF'), { code: 'SYNTHETIC_EMPTY_PROOF', evidence: {} }];
      return [{ code: 'SYNTHETIC_MISSING_PROOF', slot: [24, 'day'], names: [B] }];
    } });
    T.rules.register({ id: valid, api: 1, states: ['hard', 'off'], def: 'off',
      explainSlot(ctx) { return atTarget(ctx) ? [proof('SYNTHETIC_VALID_PROOF')] : []; } });
    try {
      const problem = staticFixture([A, 'Synthetic C'], { states: { [broken]: 'hard', [valid]: 'hard' } });
      assert.throws(() => T.rules.explainSlot(problem, [24, 'day'], B));
      const errors = [], direct = T.rules.explainSlot(problem, [24, 'day'], B, { errors });
      assert.strictEqual(errors.length, 1); assert.strictEqual(errors[0].ruleId, broken);
      assert(direct.some(item => item.id === valid)); assert(!direct.some(item => item.id === broken));
      const result = await T.diagnose(problem, highs, 3, null, { totalTimeLimit: 30 });
      const fixed = result.find(item => item.key === 'fixed');
      assert(fixed && fixed.alternatives.some(item => item.key === 'fixed:day:24'), 'Verified alternatives must survive optional evidence failures');
      assert.strictEqual(result.explanationsComplete, false);
      assert.strictEqual(result.explanationsBudgetExhausted, false);
      assert.strictEqual(result.explanationErrors.length, 1);
      const error = result.explanationErrors[0];
      assert.strictEqual(error.ruleId, broken); assert.strictEqual(error.name, B);
      assert.deepStrictEqual(copy(error.slot), [24, 'day']); assert(error.error);
      const slot = result.slotExplanations.find(item => item.slot[0] === 24 && item.slot[1] === 'day');
      const exclusions = slot.candidates.find(item => item.name === B).exclusions;
      assert(exclusions.some(item => item.id === valid)); assert(!exclusions.some(item => item.id === broken));
    } finally { T.rules.unregister(broken); T.rules.unregister(valid); }
  });
  console.log(`ALL OK (${passed}; real HiGHS nonmonotone fixed and static-proof diagnostics)`);
})().catch(error => { console.error(error); process.exitCode = 1; });

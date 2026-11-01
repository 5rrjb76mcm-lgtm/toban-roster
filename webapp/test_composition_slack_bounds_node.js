// Synthetic regression: a soft composition miss must not become a hard cap of 50.
// Authored for later execution; node test_composition_slack_bounds_node.js /absolute/path/to/highs
// TOBAN_TEST_ROOT=/absolute/path/to/baseline/webapp selects pristine source for before/after checks.
const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert');
const root = process.env.TOBAN_TEST_ROOT || __dirname, highsPath = process.argv[2];
if (!highsPath) throw new Error('Pass an existing HiGHS package path; no solver assertions may be skipped');
globalThis.T = {};
for (const f of ['i18n.js', 'rules-core.js', 'model.js', 'messages.js', 'solver.js', 'check.js'])
  vm.runInThisContext(fs.readFileSync(path.join(root, 'src', f), 'utf8'), { filename: f });
for (const f of fs.readdirSync(path.join(root, 'src/rules')).filter(f => f.endsWith('.js')).sort())
  vm.runInThisContext(fs.readFileSync(path.join(root, 'src/rules', f), 'utf8'), { filename: 'rules/' + f });
const scenarios = [
  { label: 'shortfall 50', people: 1, min: 51, miss: 50 },
  { label: 'shortfall 51', people: 1, min: 52, miss: 51 },
  { label: 'zero qualified, shortfall 51', people: 1, min: 51, qualified: false, miss: 51 },
  { label: 'excess 50', people: 50, max: 0, miss: 50 },
  { label: 'excess 51', people: 51, max: 0, miss: 51 },
];
function fixture(o, state, weight) {
  const names = Array.from({ length: o.people }, (_, i) => 'Synthetic Composition ' + (i + 1));
  const R = { profile: { id: 'synthetic-composition-bounds', quota_mode: 'absolute',
    roles: [{ id: 'Staff', label: 'Staff', refs: [], standby: false }],
    shifts: [{ id: 'day', on: 'none' }, { id: 'night', on: 'all' }],
    positions: { work: { count: o.people } } },
    doctors: names.map(name => ({ name, team: 'Staff', quota: 0, quals: o.qualified === false ? [] : ['Q'] })),
    composition: [{ shift: 'night', qual: 'Q', ...(o.min == null ? {} : { min: o.min }), ...(o.max == null ? {} : { max: o.max }) }],
    weights: { composition_miss: weight }, rule_states: {} };
  T.fillDefaultRules(R);
  for (const def of T.RULE_DEFS) if (def.states.includes('off')) R.rule_states[def.id] = 'off';
  R.rule_states.composition = state;
  const P = new T.Problem(R, T.normalizeMonth({ year: 2026, month: 11, holidays: [] }, R));
  const asg = Object.fromEntries(P.slots.map(s => [`${s[0]}:${s[1]}`, { work: names.slice(), oc: [] }]));
  return { P, asg };
}
const EXPECTED_CASES = 34, EXPECTED_SOLVES = 50;
let registered = 0, started = 0, completed = 0, passed = 0, solves = 0, finished = false;
const counters = () => ({ registered, started, completed, passed, solves, finished });
process.on('exit', () => {
  if (!finished || [registered, started, completed, passed].some(n => n !== EXPECTED_CASES) || solves !== EXPECTED_SOLVES) {
    console.error('FAIL incomplete composition slack regression', counters()); process.exitCode = 1;
  }
});
const watchdog = setTimeout(() => { console.error('FAIL composition slack watchdog', counters()); process.exit(1); }, 180000);
watchdog.unref();
const cases = [];
for (const o of scenarios) for (const state of ['soft', 'hard', 'off']) for (const weight of [0, 3])
  cases.push({ label: `${o.label}/${state}/weight ${weight}`, o, state, weight });
// Guard legacy fractional/malformed bound handling without asserting those inputs are valid.
// This isolates the module hook and never asks HiGHS to solve a malformed LP.
for (const [field, value] of [['min', 52.5], ['max', 0.5], ['min', Infinity], ['max', NaN]])
  cases.push({ label: `legacy ${field} ${String(value)} bound`, field, value });
registered = cases.length;
(async () => {
  assert.strictEqual(registered, EXPECTED_CASES);
  const highs = await require(highsPath)();
  for (const c of cases) {
    started++;
    try {
      if (c.field) {
        const bounds = [], P = { state: () => 'soft', compMatch: () => true, compOn: () => true, softW: () => 1 };
        const lp = { auxInt: (prefix, lo, hi) => { bounds.push({ prefix, lo, hi }); return 'slack'; }, add() {}, objAdd() {} };
        T.rules.byId.composition.solve({ P, LP: T.LP, lp,
          names: Array.from({ length: 60 }, (_, i) => 'Synthetic ' + i), slots: [[1, 'night']], work: () => 1 },
        { list: [{ [c.field]: c.value }] });
        assert.deepStrictEqual(bounds, [{ prefix: c.field === 'min' ? 'cmpl' : 'cmpu', lo: 0, hi: 50 }]);
      } else {
        const { P, asg } = fixture(c.o, c.state, c.weight), before = JSON.stringify({ rules: P.rules, month: P.m, asg });
        const checked = T.check(P, asg), pen = T.penalty(P, asg), expected = c.state === 'soft' ? 30 * c.o.miss * c.weight : 0;
        assert.strictEqual(pen.total, expected, c.label + ': independent score');
        assert.strictEqual(pen.items.composition_miss || 0, expected);
        assert.deepStrictEqual(checked.WC, [], c.label + ': no fixed override');
        if (c.state === 'hard') {
          const code = c.o.min == null ? 'COMPOSITION_OVER' : 'COMPOSITION_SHORT';
          assert.strictEqual(checked.VC.length, 30); assert(checked.VC.every(v => v.code === code));
        } else assert.deepStrictEqual(checked.VC, [], c.label + ': witness is feasible');
        solves++; const result = T.solve(P, highs, { timeLimit: 5, mipGap: 0 });
        assert.strictEqual(result.status, c.state === 'hard' ? 'Infeasible' : 'Optimal', c.label);
        if (c.state !== 'hard') {
          assert(result.asg, c.label + ': assignment required');
          assert.deepStrictEqual(T.check(P, result.asg).VC, []);
          assert.strictEqual(result.objective, expected);
          assert.strictEqual(T.penalty(P, result.asg).total, expected);
          solves++; const pinned = T.solve(P, highs, { timeLimit: 5, mipGap: 0, pin: asg });
          assert.strictEqual(pinned.status, 'Optimal'); assert(pinned.asg);
          assert.strictEqual(pinned.objective, expected, c.label + ': fully pinned optimum');
          assert.strictEqual(T.penalty(P, pinned.asg).total, expected);
        }
        assert.strictEqual(JSON.stringify({ rules: P.rules, month: P.m, asg }), before, c.label + ': no mutation');
      }
      passed++; console.log('ok ' + c.label);
    } finally { completed++; }
  }
  assert.strictEqual(solves, EXPECTED_SOLVES);
  assert.strictEqual(passed, EXPECTED_CASES);
  finished = true; clearTimeout(watchdog);
  console.log(`PASS ${passed} cases, ${solves} HiGHS solves`);
})().catch(e => { console.error(e.stack || e); process.exitCode = 1; });

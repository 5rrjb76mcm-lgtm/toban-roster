// Synthetic inputs only. Run with bundled HiGHS; optional arguments select HiGHS and source root.
const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert');
const root = process.argv[3] || __dirname;
globalThis.T = {};
for (const f of ['i18n.js', 'rules-core.js', 'model.js', 'messages.js', 'solver.js', 'check.js'])
  vm.runInThisContext(fs.readFileSync(path.join(root, 'src', f), 'utf8'), { filename: f });
for (const f of fs.readdirSync(path.join(root, 'src/rules')).filter(f => f.endsWith('.js')))
  vm.runInThisContext(fs.readFileSync(path.join(root, 'src/rules', f), 'utf8'), { filename: 'rules/' + f });
function rules(kind, value, state = 'hard') {
  const R = { profile: { id: 'synthetic-shift-run-validation', quota_mode: 'absolute',
    roles: [{ id: 'S', label: 'Staff', refs: [] }],
    shifts: [{ id: 'day', on: kind === 'day' ? 'all' : 'none' }, { id: 'night', on: 'all' }] },
    doctors: ['Synthetic A', 'Synthetic B', 'Synthetic C'].map(name => ({ name, team: 'S', quota: 0 })),
    shift_run_max: { [kind]: value }, weights: {}, rule_states: {} };
  T.fillDefaultRules(R);
  for (const d of T.RULE_DEFS) if (d.states.includes('off')) R.rule_states[d.id] = 'off';
  R.rule_states.shift_run_max = state; R.weights.shift_run_max = 7; R.weights.fixed_conflict = 13;
  return R;
}
const month = R => T.normalizeMonth({ year: 2026, month: 11 }, R);
const cases = [], test = (name, fn) => cases.push({ name, fn });
test('new validation message obeys the English-catalog and bilingual runtime contract', () => {
  const code = 'SHIFT_RUN_BAD_MAX', en = JSON.parse(fs.readFileSync(path.join(root, 'lang/en.json'), 'utf8'));
  assert(Object.prototype.hasOwnProperty.call(en.msg, code), 'lang/en.json.msg must include ' + code);
  assert.strictEqual(en.msg[code], T.MSG[code].en);
  assert(T.MSG[code].en && T.MSG[code].ja, 'module message must have both English and Japanese');
  for (const lang of ['en', 'ja']) {
    T.registerLang(JSON.parse(fs.readFileSync(path.join(root, 'lang', lang + '.json'), 'utf8')));
    T.setLang(lang);
    const R = rules('night', 'bad');
    assert.throws(() => new T.Problem(R, month(R)), error =>
      error.message === T.MSG[code][lang].replace('{field}', 'shift_run_max.night'));
  }
});
const invalid = [1.5, '1.5', 0, -1, 'bad', Infinity, 'Infinity', NaN, 32, 1e20, true, false, [], [2], {}, ' '];
for (const kind of ['day', 'night']) for (const state of ['hard', 'soft']) for (const value of invalid)
  test(`${kind}/${state}/invalid ${JSON.stringify(value)}`, () => {
    const R = rules(kind, value, state), before = structuredClone(R);
    assert.throws(() => new T.Problem(R, month(R)), new RegExp(`shift_run_max\\.${kind}`));
    assert.deepStrictEqual(R, before, 'do not rewrite invalid source settings');
    assert(Number.isSafeInteger(T.prevLookback(R)) && T.prevLookback(R) <= 32, 'history row count stays bounded');
    R.rule_states.shift_run_max = 'off';
    assert.doesNotThrow(() => new T.Problem(R, month(R)), 'disabled invalid values do not block unrelated work');
    before.rule_states.shift_run_max = 'off'; assert.deepStrictEqual(R, before);
  });
for (const kind of ['day', 'night']) for (const value of [1, 2, 31, ' 2 ', '+2', null, '', undefined])
  test(`${kind}/accepted ${String(value)}`, () => {
    const R = rules(kind, value), before = structuredClone(R), P = new T.Problem(R, month(R));
    assert.deepStrictEqual(P.prm.shift_run_max.max, value == null || value === '' ? {} : { [kind]: Number(value) });
    assert.deepStrictEqual(R, before);
    assert.strictEqual(T.prevLookback(R), value == null || value === '' ? 2 : Math.max(2, Number(value) + 1));
  });
for (const value of ['Infinity', 1e20]) test(`history stays finite for ${value}`, () => {
  const R = rules('night', value);
  assert(Number.isSafeInteger(T.prevLookback(R)) && T.prevLookback(R) <= 32);
});
test('unknown extension key cannot inflate history; absent and empty defaults remain distinct', () => {
  const R = rules('day', 3); R.shift_run_max.extension = 'Infinity';
  assert.strictEqual(T.prevLookback(R), 4);
  assert.deepStrictEqual(new T.Problem(R, month(R)).prm.shift_run_max.max, { day: 3 });
  assert.strictEqual(R.shift_run_max.extension, 'Infinity');
  delete R.shift_run_max; assert.deepStrictEqual(new T.Problem(R, month(R)).prm.shift_run_max.max, { day: 3 });
  R.shift_run_max = {}; assert.deepStrictEqual(new T.Problem(R, month(R)).prm.shift_run_max.max, {});
});
for (const kind of ['day', 'night']) for (const state of ['hard', 'soft', 'off'])
  for (const boundary of ['current', 'previous', 'next']) for (const fixed of [false, true])
    test(`${kind}/${state}/${boundary}/${fixed ? 'fixed' : 'free'} parity`, highs => {
      const R = rules(kind, '2', state), M = month(R), n = 'Synthetic A';
      const ds = boundary === 'current' ? [10, 11, 12] : boundary === 'previous' ? [1, 2] : [29, 30];
      if (boundary === 'previous') M.prev_month.last_days = [{ date: 31, [kind]: n }];
      if (boundary === 'next') M.fixed[kind][31] = n;
      if (fixed) for (const d of ds) M.fixed[kind][d] = n;
      const P = new T.Problem(R, M), pin = Object.fromEntries(P.slots.map(([d, k]) => [`${d}:${k}`,
        { work: k === kind && ds.includes(d) ? n : `Synthetic ${d % 2 ? 'B' : 'C'}`, oc: [] }]));
      const before = structuredClone({ R, M, pin }), c = T.check(P, pin), p = T.penalty(P, pin);
      const res = T.solve(P, highs, { pin, timeLimit: 5, mipGap: 0 });
      assert.strictEqual(res.status, state === 'hard' && !fixed ? 'Infeasible' : 'Optimal');
      assert.strictEqual(c.VC.filter(v => v.code === 'SHIFT_RUN_TOO_LONG').length, state === 'hard' && !fixed ? 1 : 0);
      assert.strictEqual(c.WC.filter(v => v.code === 'SHIFT_RUN_TOO_LONG').length, state === 'hard' && fixed ? 1 : 0);
      const expected = state === 'soft' ? 7 : state === 'hard' && fixed ? 13 : 0;
      assert.strictEqual(p.total, expected);
      if (res.status === 'Optimal') { assert.strictEqual(res.objective, expected); assert.strictEqual(T.check(P, res.asg).VC.length, 0); }
      assert.deepStrictEqual({ R, M, pin }, before);
    });
let finished = false, passed = 0, failed = 0;
process.on('exit', () => { if (!finished || passed + failed !== cases.length) { console.error('Incomplete shift-run regression'); process.exitCode = 1; } });
(async () => {
  const highs = await require(process.argv[2] || path.join(__dirname, 'libs/highs.js'))();
  for (const c of cases) { try { await c.fn(highs); passed++; } catch (e) { failed++; console.error('FAIL ' + c.name + ': ' + e.message); } }
  finished = true; console.log(`shift-run validation: ${passed} passed, ${failed} failed, ${cases.length} completed`);
  if (failed) process.exitCode = 1;
})().catch(e => { console.error(e); process.exitCode = 1; });

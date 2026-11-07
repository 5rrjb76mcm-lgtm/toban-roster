// Previous-month OC history can survive removal of a former worker's name.
// Synthetic inputs only. Pass HiGHS path, then optional webapp source directory for baseline comparison.
const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert/strict');
const source = path.resolve(process.argv[3] || __dirname);
const highsPath = path.resolve(process.argv[2] || path.join(source, 'libs/highs.js'));
globalThis.T = {};
for (const f of ['i18n.js', 'rules-core.js', 'model.js', 'messages.js', 'solver.js', 'check.js'])
  vm.runInThisContext(fs.readFileSync(path.join(source, 'src', f), 'utf8'), { filename: f });
for (const f of fs.readdirSync(path.join(source, 'src/rules')).filter(f => f.endsWith('.js')).sort())
  vm.runInThisContext(fs.readFileSync(path.join(source, 'src/rules', f), 'utf8'), { filename: f });
for (const f of fs.readdirSync(path.join(source, 'lang')).filter(f => f.endsWith('.json')))
  T.registerLang(JSON.parse(fs.readFileSync(path.join(source, 'lang', f), 'utf8')));
T.DEFAULT_RULES = JSON.parse(fs.readFileSync(path.join(source, 'data/rules.json'), 'utf8'));
const A = 'Synthetic Target', B = 'Synthetic Worker', C = 'Synthetic OC';
const cases = [];
for (const shift of ['day', 'night']) for (const current of ['work', 'oc'])
  for (const previous of ['oc-only', 'worker-and-oc', 'worker-only', 'empty']) cases.push({ shift, current, previous });
function fixture(c) {
  const R = { profile: { id: 'synthetic-partial-previous', roles: [{ id: 'S', label: 'Staff', standby: true }],
    shifts: [{ id: 'night', on: 'all' }, { id: 'day', on: 'none' }] },
    doctors: [A, B, C].map(name => ({ name, team: 'S', quota: 0 })), oncall_requirement: { S: { S: 1 } }, rule_states: {}, weights: {} };
  T.fillDefaultRules(R);
  for (const def of T.RULE_DEFS) if (def.states.includes('off')) R.rule_states[def.id] = 'off';
  R.rule_states.oncall = 'hard'; R.rule_states.oc_consecutive = 'soft';
  for (const key of Object.keys(R.weights)) R.weights[key] = 0;
  R.weights.oc_consecutive = 6;
  const entry = { date: 31 };
  if (c.previous === 'oc-only' || c.previous === 'worker-and-oc') entry[c.shift + '_oc'] = [A];
  if (c.previous === 'worker-and-oc') entry[c.shift] = B;
  if (c.previous === 'worker-only') entry[c.shift] = A;
  const M = T.normalizeMonth({ year: 2026, month: 11, holidays: [], prev_month: { last_days: [entry] } }, R);
  const P = new T.Problem(R, M);
  const pin = Object.fromEntries(P.slots.map(s => [T.Problem.key(s), { work: B, oc: [C] }]));
  pin['1:night'] = c.current === 'work' ? { work: A, oc: [C] } : { work: B, oc: [A] };
  return { R, M, P, pin };
}
(async () => {
  const highs = await require(highsPath)(); let passed = 0, failed = 0;
  for (const c of cases) { const label = JSON.stringify(c); try {
    const { R, M, P, pin } = fixture(c), before = JSON.stringify({ R, M, pin });
    const prevPresent = c.previous !== 'empty', prevOc = c.previous === 'oc-only' || c.previous === 'worker-and-oc';
    assert.equal(P.allSlotSet.has(`0:${c.shift}`), prevPresent, 'previous slot presence must reflect either work or OC');
    const A1 = new T.Asg(P, pin);
    assert.equal(A1.oc([0, c.shift]).includes(A), prevOc, 'previous OC survives in assignment');
    // At current day 1, C's usual chain is interrupted only when A is the OC.
    // B's chain is always work-to-work and excluded. A contributes exactly one
    // boundary penalty except for work-to-work and missing history.
    const base = c.current === 'work' ? 29 : 28;
    const boundary = prevOc || (c.previous === 'worker-only' && c.current === 'oc');
    const expected = (base + Number(boundary)) * 6;
    const score = T.penalty(P, pin);
    assert.equal(score.items.oc_consecutive || 0, expected, 'independent chronological pair count');
    assert.deepEqual(T.check(P, pin).VC, [], 'current schedule remains structurally valid');
    const result = await T.solve(P, highs, { pin, timeLimit: 10, mipGap: 0 });
    assert.equal(result.status, 'Optimal'); assert.ok(result.asg);
    assert.equal(result.objective, expected, 'pinned solver agrees with independent count');
    const lines = []; T.rules.runReport(T.rules.checkCtx(P, A1, 'report', x => lines.push(x)), ['oc_consecutive']);
    const target = lines.find(x => x.includes(A + ':'));
    assert.equal(Boolean(target), Boolean(boundary), 'report identifies precisely the scored target boundary');
    if (target) assert.ok(target.includes(P.label(0)) && target.includes(P.label(1)));
    assert.equal(JSON.stringify({ R, M, pin }), before, 'source inputs are not mutated');
    passed++; console.log('PASS', label);
  } catch (e) { failed++; console.error('FAIL', label, e.message); } }
  // A known OC in the other previous slot exposes phantom-slot adjacency.
  // Historical names may be absent from the current roster; their presence
  // still establishes that the earlier slot existed.
  let blankPassed = 0, blankFailed = 0;
  for (const shift of ['day', 'night']) for (const worker of [false, true]) for (const values of [[], [''], [null, ''], ['Synthetic Former']]) {
    const label = JSON.stringify({ shift, worker, values });
    try {
      const other = shift === 'day' ? 'night' : 'day';
      const { R, M, pin } = fixture({ shift: other, current: 'work', previous: 'oc-only' });
      const entry = M.prev_month.last_days[0]; entry[shift + '_oc'] = values;
      if (worker) entry[shift] = B;
      const before = JSON.stringify({ R, M, pin }), P = new T.Problem(R, M);
      const present = worker || values.includes('Synthetic Former');
      assert.equal(P.allSlotSet.has(`0:${shift}`), present, 'blank-only OC cannot create a slot');
      const boundary = shift === 'day' || !present, expected = (29 + Number(boundary)) * 6;
      assert.equal(T.penalty(P, pin).items.oc_consecutive || 0, expected, 'independent boundary count');
      const result = await T.solve(P, highs, { pin, timeLimit: 10, mipGap: 0 });
      assert.equal(result.status, 'Optimal'); assert.equal(result.objective, expected);
      const lines = [], A1 = new T.Asg(P, pin);
      T.rules.runReport(T.rules.checkCtx(P, A1, 'report', x => lines.push(x)), ['oc_consecutive']);
      assert.equal(lines.some(x => x.includes(A + ':')), boundary, 'report agrees with boundary');
      assert.equal(JSON.stringify({ R, M, pin }), before);
      blankPassed++; console.log('PASS BLANK', label);
    } catch (e) { blankFailed++; console.error('FAIL BLANK', label, e.message); }
  }
  console.log(`blank OC matrix: ${blankPassed} passed, ${blankFailed} failed, 16 total`);
  if (blankFailed || blankPassed !== 16) process.exitCode = 1;
  console.log(`previous OC regression: ${passed} passed, ${failed} failed, ${cases.length} total`);
  if (failed || passed !== 16) process.exitCode = 1;
})().catch(e => { console.error(e.stack); process.exitCode = 1; });

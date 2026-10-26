// Static-authored regression; this file, syntax checks and product code were NOT RUN.
// node webapp/test_asg_boundary_authority_node.js
// TOBAN_WEBAPP_ROOT=/path/to/unchanged/webapp can target the pre-fix source.
// Synthetic data only. No solver, browser, filesystem picker or dependency download.
const fs = require('fs'), vm = require('vm'), path = require('path'), assert = require('assert/strict');
const root = process.env.TOBAN_WEBAPP_ROOT || __dirname;
const run = f => vm.runInThisContext(fs.readFileSync(path.join(root, 'src', f), 'utf8'), { filename: f });
globalThis.T = {};
for (const f of ['i18n.js', 'rules-core.js', 'model.js', 'messages.js', 'check.js']) run(f);
for (const f of fs.readdirSync(path.join(root, 'src/rules')).filter(f => f.endsWith('.js')).sort()) run('rules/' + f);
const clone = x => JSON.parse(JSON.stringify(x));
const names = ['Synthetic Alpha', 'Synthetic Beta', 'Synthetic Gamma'], [a, b, c] = names;
function fixture(id = null, mode = 'hard', opts = {}) {
  const R = { profile: { id: 'synthetic-asg-boundary', roles: [{ id: 'S', label: 'Staff', refs: [], standby: false }],
    shifts: [{ id: 'day', on: 'none' }, { id: 'night', on: 'all' }] },
    doctors: names.map(name => ({ name, team: 'S', quota: 0 })), rule_states: {}, weights: {}, run_length: { max: 2 } };
  T.fillDefaultRules(R);
  for (const def of T.RULE_DEFS) R.rule_states[def.id] = 'off';
  if (id) R.rule_states[id] = mode;
  for (const key of Object.keys(R.weights)) R.weights[key] = 0;
  R.weights.consecutive_days = R.weights.run_length_over = R.weights.oc_consecutive = 13; R.weights.fixed_conflict = 29;
  const M = T.normalizeMonth({ year: 2026, month: 11, holidays: [], fixed: clone(opts.fixed || {}),
    prev_month: { last_days: clone(opts.previous || []) } }, R);
  const P = new T.Problem(R, M), asg = Object.fromEntries(P.slots.map(([d, kind]) => [`${d}:${kind}`, { work: d % 2 ? b : c, oc: [] }]));
  for (const d of opts.assigned || []) asg[`${d}:night`] = { work: a, oc: [] };
  return { R, M, P, asg };
}
const empty = [{}, { work: '', oc: [] }, { work: null, oc: [] }, { work: [], oc: [] }];
const codes = (P, asg, kind = 'VC') => T.check(P, asg)[kind].map(x => x.code);
const cases = [], test = (name, fn) => cases.push({ name, fn });

test('canonical current assignments and authoritative work/OC are unchanged', () => {
  const { P, asg } = fixture(null, 'hard', { previous: [{ date: 30, night: [a, b], night_oc: [c] }, { date: 31, night: b, night_oc: [a] }] });
  const before = JSON.stringify({ asg, prev: P.prevFixed }), A = new T.Asg(P, asg);
  for (const s of P.slots) assert.deepEqual(A.a[T.Problem.key(s)], asg[T.Problem.key(s)]);
  assert.deepEqual(A.workers([-1, 'night']), [a, b]); assert.deepEqual(A.oc([-1, 'night']), [c]);
  assert.equal(A.work([0, 'night']), b); assert.deepEqual(A.oc([0, 'night']), [a]);
  assert.deepEqual(T.check(P, asg).V, []); assert.equal(JSON.stringify({ asg, prev: P.prevFixed }), before);
});
for (const value of empty) test(`empty day-zero placeholder ${JSON.stringify(value)} cannot erase a hard boundary`, () => {
  const { P, asg } = fixture('consecutive_days', 'hard', { previous: [{ date: 31, night: a }], assigned: [1] });
  const raw = { ...asg, '0:night': clone(value) }, before = JSON.stringify(raw);
  assert.deepEqual(codes(P, raw), ['CONSECUTIVE_DAYS']);
  assert.equal(T.check(P, raw).A.work([0, 'night']), a);
  assert.equal(JSON.stringify(raw), before, 'preserve raw imported data');
});
for (const mode of ['soft', 'hard']) test(`${mode}: previous boundary retains independent penalty and fixed classification`, () => {
  const { P, asg } = fixture('consecutive_days', mode, { previous: [{ date: 31, night: a }], assigned: [1], fixed: { night: { 1: a } } });
  asg['0:night'] = { work: '', oc: [] };
  assert.deepEqual(codes(P, asg), []);
  assert.deepEqual(codes(P, asg, 'WC'), mode === 'hard' ? ['CONSECUTIVE_DAYS'] : []);
  assert.equal(T.penalty(P, asg).total, mode === 'hard' ? 29 : 13);
});
for (const mode of ['hard', 'soft']) test(`${mode}: negative and zero historical placeholders cannot shorten a run`, () => {
  const { P, asg } = fixture('run_length_max', mode, { previous: [{ date: 30, night: a }, { date: 31, night: a }], assigned: [1] });
  asg['-1:night'] = { work: '', oc: [] }; asg['0:night'] = {};
  assert.deepEqual(codes(P, asg), mode === 'hard' ? ['RUN_TOO_LONG'] : []);
  assert.equal(T.penalty(P, asg).total, mode === 'soft' ? 13 : 0);
});
test('empty history key cannot erase previous OC from the boundary penalty', () => {
  const { P, asg } = fixture('oc_consecutive', 'soft', { previous: [{ date: 31, night: b, night_oc: [a] }], assigned: [1] });
  const expected = T.penalty(P, asg).total; assert.equal(expected, 13);
  asg['0:night'] = { work: null, oc: [] };
  assert.deepEqual(T.check(P, asg).V, []); assert.equal(T.penalty(P, asg).total, expected);
  assert.deepEqual(new T.Asg(P, asg).oc([0, 'night']), [a]);
});
for (const k of ['0:night', '-1:night', '-8:night', '31:night', '1:day', '1:unknown', '01:night', 'not-a-slot']) {
  test(`nonempty raw extra ${k} remains a hard structural violation`, () => {
    const { P, asg } = fixture(null, 'hard', { previous: [{ date: 30, night: b, night_oc: [c] }, { date: 31, night: b, night_oc: [c] }] });
    for (const v of [{ work: a, oc: [] }, { work: [a, c], oc: [] }, { work: '', oc: [a] }]) {
      const raw = { ...asg, [k]: clone(v) }, before = JSON.stringify(raw), chk = T.check(P, raw);
      assert.deepEqual(chk.VC.map(x => x.code), ['SLOT_NOT_EXISTS']); assert.deepEqual(chk.WC, []);
      assert.equal(chk.VC[0].args.slot, k);
      assert.equal(chk.A.work([0, 'night']), b); assert.deepEqual(chk.A.oc([0, 'night']), [c]);
      assert.equal(chk.A.work([-1, 'night']), b); assert.deepEqual(chk.A.oc([-1, 'night']), [c]);
      if (!Object.hasOwn(P.prevFixed, k)) assert.equal(Object.hasOwn(chk.A.a, k), false, 'extra is not an effective assignment');
      assert.equal(JSON.stringify(raw), before);
    }
  });
}
test('empty extras without history do not fabricate previous or future assignments', () => {
  const { P, asg } = fixture();
  for (const k of ['0:night', '-1:night', '31:night', '1:day', '1:unknown', 'not-a-slot']) asg[k] = { work: '', oc: [] };
  const chk = T.check(P, asg); assert.deepEqual(chk.V, []);
  assert.deepEqual(Object.keys(chk.A.a).sort(), [...P.slotSet].sort());
  assert.equal(chk.A.work([0, 'night']), null); assert.deepEqual(chk.A.oc([0, 'night']), []);
});
test('different previous worker does not create a current boundary violation', () => {
  const { P, asg } = fixture('consecutive_days', 'hard', { previous: [{ date: 31, night: a }] });
  asg['0:night'] = { work: '', oc: [] };
  assert.deepEqual(T.check(P, asg).V, []); assert.equal(T.penalty(P, asg).total, 0);
});
test('falsey occupant lists are empty placeholders, not structural assignments', () => {
  for (const value of [{ work: '', oc: [null, ''] }, { work: [null, ''], oc: [null, ''] }]) {
    const { P, asg } = fixture(null, 'hard', { previous: [{ date: 31, night: a, night_oc: [c] }] });
    asg['0:night'] = clone(value); asg['31:night'] = clone(value);
    const chk = T.check(P, asg); assert.deepEqual(chk.V, []);
    assert.equal(chk.A.work([0, 'night']), a); assert.deepEqual(chk.A.oc([0, 'night']), [c]);
    assert.equal(chk.A.work([31, 'night']), null);
  }
});
test('next-month constants remain separate and authoritative', () => {
  const { P, asg } = fixture('consecutive_days', 'hard', { assigned: [30], fixed: { night: { 31: a } } });
  asg['31:night'] = { work: '', oc: [] };
  assert.deepEqual(codes(P, asg), ['CONSECUTIVE_NEXT_MONTH']);
  assert.equal(new T.Asg(P, asg).work([31, 'night']), null);
});
test('real applyLoaded keeps the saved result; outputCheck rejects the concealed boundary', () => {
  const { R, M, asg } = fixture('consecutive_days', 'hard', { previous: [{ date: 31, night: a }], assigned: [1] });
  asg['0:night'] = { work: '', oc: [] };
  const state = { rules: clone(R), month: clone(M), result: null, ui: { doctor: 0 } }, alerts = [];
  globalThis.alert = s => alerts.push(s);
  // UI/persistence endpoints only are stubs; production import/preflight, model,
  // checker and output gate run unchanged. This is not a browser/DOM test.
  T.app = { state, isMonthObj: T.isValidMonth, ensureMonth(m) { T.fillDefaultRules(state.rules); T.normalizeMonth(m, state.rules); },
    persist() {}, save() {}, clearUndo() {}, renderAll() {}, showTab() {}, toast() {} };
  run('app-folder.js');
  const value = { rules: clone(R), month: clone(M), result: { status: 'Optimal', asg: clone(asg) } }, before = JSON.stringify(value);
  T.app.applyLoaded(value, 'Synthetic import', { fromFolder: false });
  assert.deepEqual(alerts, []); assert.deepEqual(state.result.asg, asg); assert.equal(JSON.stringify(value), before);
  assert(T.app.outputCheck(state).stop, 'the accepted stale result must not permit export');
  delete state.result.asg['0:night']; assert(T.app.outputCheck(state).stop, 'same violation without the stale placeholder');
  state.result.asg['1:night'].work = b; assert.equal(T.app.outputCheck(state).stop, null, 'valid current assignments still pass');
});
const EXPECTED_CASES = 23;
let started = 0, ended = 0, passed = 0, failed = 0, finished = false;
process.on('exit', () => {
  console.log(`ACCOUNTING registered=${cases.length} started=${started} ended=${ended} passed=${passed} failed=${failed} finished=${finished}`);
  if (!finished || cases.length !== EXPECTED_CASES || started !== EXPECTED_CASES || ended !== EXPECTED_CASES || passed !== EXPECTED_CASES || failed) process.exitCode = 1;
});
assert.equal(cases.length, EXPECTED_CASES);
for (const [i, { name }] of cases.entries()) console.log(`REGISTER ${i + 1}/${EXPECTED_CASES} ${name}`);
for (const [i, { name, fn }] of cases.entries()) {
  started++; console.log(`START ${i + 1}/${EXPECTED_CASES} ${name}`);
  try { fn(); passed++; console.log('PASS ' + name); }
  catch (e) { failed++; console.error('FAIL ' + name + '\n' + e.stack); }
  finally { ended++; console.log(`END ${i + 1}/${EXPECTED_CASES} ${name}`); }
}
finished = true;
console.log(`Asg boundary authority: registered=${cases.length}, passed=${passed}, failed=${failed}`);
if (passed !== EXPECTED_CASES || failed) process.exitCode = 1;

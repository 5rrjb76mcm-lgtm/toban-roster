// Static-authored regression proposal; product/tests/build/syntax were NOT run in cloud.
// Use only an already installed pinned HiGHS package. Fictional data only.
// TOBAN_WEBAPP_ROOT selects all production code; these final test bytes stay unchanged.
const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert/strict');
const root = process.env.TOBAN_WEBAPP_ROOT || __dirname;
const highsPath = process.argv[2];
if (!highsPath) throw new Error('Pass the existing pinned HiGHS path; do not install or skip');
globalThis.T = {};
for (const f of ['i18n.js', 'rules-core.js', 'model.js', 'messages.js', 'solver.js', 'check.js'])
  vm.runInThisContext(fs.readFileSync(path.join(root, 'src', f), 'utf8'), { filename: f });
for (const dir of ['rules', 'calendars']) for (const f of fs.readdirSync(path.join(root, 'src', dir)).filter(f => f.endsWith('.js')).sort())
  vm.runInThisContext(fs.readFileSync(path.join(root, 'src', dir, f), 'utf8'), { filename: dir + '/' + f });
const names = ['Synthetic Alpha', 'Synthetic Bravo'];
const ids = ['shift_count_range', 'friday_night_min', 'days_off_pair'];
const weights = { shift_count_range: 'shift_count_range', friday_night_min: 'friday_night_missing', days_off_pair: 'days_off_pair_short' };
function fixture(id, min, o = {}) {
  const R = { profile: { id: 'synthetic-soft-shortfall', roles: [{ id: 'S', label: 'Synthetic staff', refs: [] }],
    shifts: [{ id: 'day', on: 'none' }, { id: 'night', on: 'all' }] },
    doctors: names.map(name => ({ name, team: 'S', quota: 15 })), rule_states: {}, weights: { fixed_conflict: 1000 },
    shift_counts: { night: { min } }, friday_night_min: { [names[0]]: min },
    days_off: { pair_min: min, pair_count: o.runs ? 'runs' : 'pairs', ake_is_off: true } };
  T.fillDefaultRules(R);
  for (const d of T.RULE_DEFS) if (d.states.includes('off')) R.rule_states[d.id] = 'off';
  R.rule_states[id] = o.state || 'soft'; R.weights[weights[id]] = o.weight ?? 1;
  if (o.max != null) R.shift_counts.night.max = o.max;
  if (o.own != null) R.doctors[1].shift_max_night = o.own;
  const M = T.normalizeMonth({ year: o.year || 2026, month: o.month || 11 }, R);
  const P = new T.Problem(R, M);
  const pin = Object.fromEntries(P.slots.map(s => [T.Problem.key(s), { work: names[1], oc: [] }]));
  return { R, M, P, pin };
}
function pinnedShortfall(id, min, P, runs = false) {
  if (id === 'shift_count_range') return min + Math.max(0, min - P.N);
  if (id === 'friday_night_min') return min; // The nominated Alpha is never assigned in the pinned schedule.
  return Math.max(0, min - (runs ? 1 : P.N - 1)) + min;
}
let highs;
function solveWitness(id, min, o = {}) {
  const f = fixture(id, min, o), before = JSON.stringify({ R: f.R, M: f.M, pin: f.pin });
  assert.equal(f.P.slots.length, f.P.N); assert(f.P.slots.every(s => s[1] === 'night'));
  const state = o.state || 'soft', expected = state === 'off' ? 0 : pinnedShortfall(id, min, f.P, !!o.runs) * (o.weight ?? 1);
  if (state !== 'hard') { assert.deepEqual(T.check(f.P, f.pin).VC, []); assert.equal(T.penalty(f.P, f.pin).total, expected); }
  const result = T.solve(f.P, highs, { pin: f.pin, timeLimit: 15, mipGap: 0 });
  if (state === 'hard') {
    assert.equal(result.status, 'Infeasible', 'An impossible hard target must stay infeasible');
    assert(T.check(f.P, f.pin).VC.length > 0);
  } else {
    assert.equal(result.status, 'Optimal', 'A soft shortfall must not silently become a hard constraint');
    assert(result.asg); assert.equal(result.objective, expected);
    assert.equal(T.penalty(f.P, result.asg).total, expected); assert.deepEqual(T.check(f.P, result.asg).VC, []);
  }
  assert.equal(JSON.stringify({ R: f.R, M: f.M, pin: f.pin }), before, 'Source inputs and pinned witness are immutable');
}
const cases = [], add = (id, run) => cases.push({ id, run });
for (const id of ids) for (const min of [0, 31, 32, 62, 100])
  add(id + ':soft:pinned:min=' + min, () => solveWitness(id, min));
for (const id of ids) for (const weight of [0, 0.5])
  add(id + ':soft:min100:weight=' + weight, () => solveWitness(id, 100, { weight }));
for (const id of ids) for (const state of ['hard', 'off'])
  add(id + ':min100:state=' + state, () => solveWitness(id, 100, { state }));
for (const id of ids) add(id + ':soft:min100:unpinned', () => {
  const { P } = fixture(id, 100), result = T.solve(P, highs, { timeLimit: 15, mipGap: 0 });
  const fridayCount = P.slots.filter(s => P.dow(s[0]) === 4).length;
  const expected = id === 'shift_count_range' ? 200 - P.N : id === 'friday_night_min' ? 100 - fridayCount : 200 - (P.N - 1);
  assert.equal(result.status, 'Optimal'); assert(result.asg); assert.equal(result.objective, expected);
  assert.equal(T.penalty(P, result.asg).total, expected); assert.deepEqual(T.check(P, result.asg).VC, []);
});
for (const [year, month, N] of [[2026, 2, 28], [2028, 2, 29], [2026, 12, 31]])
  add('days_off_pair:month-length=' + N, () => { assert.equal(fixture('days_off_pair', 100, { year, month }).P.N, N); solveWitness('days_off_pair', 100, { year, month }); });
add('days_off_pair:runs:min100', () => solveWitness('days_off_pair', 100, { runs: true }));
for (const id of ids) add(id + ':UI-read-preserves-100', () => {
  const { R, M } = fixture(id, 100), def = T.RULE_BY_ID[id];
  const input = { value: '100', dataset: {} };
  if (id === 'shift_count_range') {
    def.ui.read(R, s => s === '[data-scr="night:min"]' ? input : null);
    assert.equal(new T.Problem(R, M).prm[id].range.night.min, 100);
  } else if (id === 'days_off_pair') {
    def.ui.read(R, s => s === '#setPairMin' ? input : null);
    assert.equal(new T.Problem(R, M).prm[id].min, 100);
  } else {
    const col = def.columns[0], acc = col.begin(), d = R.doctors[0];
    col.read({ querySelector: () => input }, d, R, acc, d.name, d);
    col.end(R, acc, { names: new Set([d.name]) });
    assert.equal(new T.Problem(R, M).prm[id].min[d.name], 100);
  }
});
for (const own of [null, 5]) add('shift_count_range:upper-cap-control:own=' + own, () => {
  const { P, pin } = fixture('shift_count_range', 0, { max: 10, own });
  const expected = P.N - (own ?? 10), result = T.solve(P, highs, { pin, timeLimit: 15, mipGap: 0 });
  assert.equal(result.status, 'Optimal'); assert.equal(result.objective, expected);
  assert.equal(T.penalty(P, result.asg).total, expected); assert.deepEqual(T.check(P, result.asg).VC, []);
});
const EXPECTED = 39;
let started = 0, ended = 0, failed = 0, finished = false;
process.on('exit', () => { if (!finished || started !== EXPECTED || ended !== EXPECTED || failed) process.exitCode = 1; });
(async () => {
  assert.equal(cases.length, EXPECTED); assert.equal(new Set(cases.map(c => c.id)).size, EXPECTED);
  console.log(JSON.stringify({ event: 'REGISTER', case_ids: cases.map(c => c.id) }));
  highs = await require(highsPath)();
  for (const c of cases) {
    started++; console.log(JSON.stringify({ event: 'START', case_id: c.id }));
    let status = 'PASS';
    try { await c.run(); } catch (e) { status = 'FAIL'; failed++; console.error(c.id, e.stack || e); }
    ended++; console.log(JSON.stringify({ event: 'END', case_id: c.id, status }));
  }
  finished = true; console.log(JSON.stringify({ event: 'SUMMARY', registered: cases.length, started, ended, failed }));
  if (failed) process.exitCode = 1;
})().catch(e => { console.error(e.stack || e); process.exitCode = 1; });

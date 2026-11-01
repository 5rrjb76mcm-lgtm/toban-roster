// Static-authored; not executed in the authoring cloud. Same test bytes support all three source roots.
const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert/strict');
const root = process.env.TOBAN_WEBAPP_ROOT || __dirname;
globalThis.T = {};
for (const f of ['i18n.js', 'rules-core.js', 'model.js', 'messages.js', 'solver.js', 'check.js']) vm.runInThisContext(fs.readFileSync(path.join(root, 'src', f), 'utf8'), { filename: f });
for (const dir of ['rules', 'calendars']) for (const f of fs.readdirSync(path.join(root, 'src', dir)).filter(f => f.endsWith('.js')).sort()) vm.runInThisContext(fs.readFileSync(path.join(root, 'src', dir, f), 'utf8'), { filename: dir + '/' + f });
const name = 'Synthetic Alpha';
function fixture(o = {}) {
  const R = { profile: { id: 'pair-lint-synthetic', roles: [{ id: 'S', label: 'Staff', refs: [] }], shifts: [{ id: 'day', on: 'none' }, { id: 'night', on: 'all' }], positions: { work: { count: 1, min: 0 } } }, doctors: [{ name, team: 'S', quota: 27 }], rule_states: {}, days_off: { min: o.min ?? 3, mode: o.mode || 'exact', pair_min: o.pair ?? 2, pair_count: o.runs ? 'runs' : 'pairs', ake_is_off: true } };
  T.fillDefaultRules(R); for (const d of T.RULE_DEFS) if (d.states.includes('off')) R.rule_states[d.id] = 'off';
  R.rule_states.days_off_min = o.minState || 'hard'; R.rule_states.days_off_pair = o.pairState || 'hard';
  if (o.exempt) R.doctors[0].duty = 'fixed_only';
  const M = T.normalizeMonth({ year: 2026, month: 11, unavailable_other: o.paid ? [{ name, day: 1, part: 'allday', paid: true }] : [] }, R);
  const P = new T.Problem(R, M);
  return { P, warnings: () => T.lint(P).filter(x => x.code === 'LINT_PAIR_VS_DAYS_OFF') };
}
const cases = [], add = (name, fn) => cases.push([name, fn]);
function witness(f, off) {
  const a = Object.fromEntries(f.P.slots.map(s => [T.Problem.key(s), { work: off.includes(s[0]) ? [] : name, oc: [] }]));
  assert.deepEqual(T.check(f.P, a).VC, []); assert.equal(T.penalty(f.P, a).total, 0);
  assert.deepEqual(f.warnings(), []);
}
add('pairs: exact three off days allow two overlapping pairs', () => witness(fixture(), [1, 2, 3]));
add('runs: minimum is not a cap', () => witness(fixture({ runs: true, mode: 'min' }), [1, 2, 4, 5]));
add('pairs: genuine exact contradiction retained', () => { const w = fixture({ min: 2 }).warnings(); assert.equal(w.length, 1); assert.deepEqual(w[0].args, { who: name, pair: 2, days: 3, min: 2 }); });
add('runs: genuine exact contradiction retained', () => { const w = fixture({ runs: true }).warnings(); assert.equal(w.length, 1); assert.equal(w[0].args.days, 4); });
add('paid leave raises exact target', () => witness(fixture({ runs: true, paid: true }), [1, 2, 4, 5]));
add('exempt staff do not create a contradiction', () => assert.deepEqual(fixture({ runs: true, exempt: true }).warnings(), []));
add('zero pair target', () => assert.deepEqual(fixture({ pair: 0, min: 0 }).warnings(), []));
for (const minState of ['soft', 'off']) add('days-off state ' + minState, () => assert.deepEqual(fixture({ runs: true, minState }).warnings(), []));
for (const pairState of ['soft', 'off']) add('pair state ' + pairState, () => assert.deepEqual(fixture({ runs: true, pairState }).warnings(), []));
let failed = 0; for (const [label, fn] of cases) { try { fn(); console.log('PASS', label); } catch (e) { failed++; console.error('FAIL', label, e.stack); } }
console.log(`${cases.length - failed}/${cases.length} cases passed`); if (failed) process.exitCode = 1;

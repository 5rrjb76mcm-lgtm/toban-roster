// Static-authored; not executed in the authoring cloud. Same test bytes support all three source roots.
const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert/strict');
const root = process.env.TOBAN_WEBAPP_ROOT || __dirname;
globalThis.T = {};
for (const f of ['i18n.js', 'rules-core.js', 'model.js', 'messages.js', 'solver.js', 'check.js']) vm.runInThisContext(fs.readFileSync(path.join(root, 'src', f), 'utf8'), { filename: f });
for (const dir of ['rules', 'calendars']) for (const f of fs.readdirSync(path.join(root, 'src', dir)).filter(f => f.endsWith('.js')).sort()) vm.runInThisContext(fs.readFileSync(path.join(root, 'src', dir, f), 'utf8'), { filename: dir + '/' + f });
const names = ['Synthetic Alpha', 'Synthetic Bravo'];
function fixture(o = {}) {
  const R = { profile: { id: 'run-lint-synthetic', roles: [{ id: 'S', label: 'Staff', refs: [] }], shifts: [{ id: 'day', on: 'none' }, { id: 'night', on: 'all' }] }, doctors: names.map(name => ({ name, team: 'S', quota: 15 })), rule_states: {}, run_length: { min: 3 }, forbid_sequence: [{ from: 'night', to: 'any' }] };
  T.fillDefaultRules(R); for (const d of T.RULE_DEFS) if (d.states.includes('off')) R.rule_states[d.id] = 'off';
  Object.assign(R.rule_states, { run_length_min: 'soft', shift_sequence: o.sequence || 'hard', quota_range: o.quota || 'off', consecutive_days: o.consecutive || 'off' });
  if (o.exempt) { R.run_length.exempt_qual = 'Exempt'; R.doctors[1].quals = ['Exempt']; }
  const unavailable_other = [];
  if (o.unavailable) for (let d = 1; d <= 30; d++) unavailable_other.push({ name: names[d % 2], day: d, part: 'allday' });
  const M = T.normalizeMonth({ year: 2026, month: 11, unavailable_other }, R), P = new T.Problem(R, M);
  const a = Object.fromEntries(P.slots.map(s => [T.Problem.key(s), { work: names[(s[0] - 1) % 2], oc: [] }]));
  return { P, a, warnings: () => T.lint(P) };
}
const cases = [], add = (name, fn) => cases.push([name, fn]);
const noBound = f => assert(!f.warnings().some(x => x.code === 'LINT_RUN_MIN_VS_NIGHTS'));
add('unavailable starts and month end have zero short-run penalty', () => { const f = fixture({ unavailable: true }); assert.deepEqual(T.check(f.P, f.a).VC, []); assert.equal(T.penalty(f.P, f.a).total, 0); noBound(f); });
for (const quota of ['off', 'soft', 'hard']) add('quota ' + quota + ' does not justify inevitability', () => noBound(fixture({ quota })));
add('exempt worker supply is not a guaranteed shortfall', () => noBound(fixture({ exempt: true })));
add('sequence off control', () => noBound(fixture({ sequence: 'off' })));
add('retains consecutive-days conflict warning', () => { const f = fixture({ consecutive: 'hard' }); assert(f.warnings().some(x => x.code === 'LINT_RUN_VS_CONSECUTIVE_MIN')); noBound(f); });
add('actual short-run penalty remains unchanged', () => { const f = fixture(); const p = T.penalty(f.P, f.a); assert.equal(p.items.run_short, 28 * f.P.softW('run_length_min')); noBound(f); });
let failed = 0; for (const [label, fn] of cases) { try { fn(); console.log('PASS', label); } catch (e) { failed++; console.error('FAIL', label, e.stack); } }
console.log(`${cases.length - failed}/${cases.length} cases passed`); if (failed) process.exitCode = 1;

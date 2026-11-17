// Synthetic data only. Reject malformed active caps before producing a NaN LP.
const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert/strict');
const root = process.env.TOBAN_WEBAPP_ROOT || __dirname;
globalThis.T = {};
for (const f of ['i18n', 'rules-core', 'model', 'messages', 'solver', 'check']) vm.runInThisContext(fs.readFileSync(path.join(root, 'src', f + '.js'), 'utf8'));
for (const f of fs.readdirSync(path.join(root, 'src/rules')).filter(f => f.endsWith('.js')).sort()) vm.runInThisContext(fs.readFileSync(path.join(root, 'src/rules', f), 'utf8'));
for (const f of fs.readdirSync(path.join(root, 'lang'))) T.registerLang(JSON.parse(fs.readFileSync(path.join(root, 'lang', f), 'utf8')));
function fixture(id, value, state = 'soft') {
  const R = { profile: { id: 'synthetic-finite-caps', roles: [{ id: 'S', label: 'Staff', refs: [] }], shifts: [{ id: 'day', on: 'none' }, { id: 'night', on: 'all' }] },
    doctors: ['Synthetic A', 'Synthetic B'].map(name => ({ name, team: 'S', quota: 15 })), rule_states: {}, pair_cap: { max: value }, days_off: { max_extra: value } };
  T.fillDefaultRules(R); for (const def of T.RULE_DEFS) if (def.states.includes('off')) R.rule_states[def.id] = 'off';
  const M = T.normalizeMonth({ year: 2026, month: 11 }, R);
  R.rule_states[id] = state;
  return { R, M };
}
let pass = 0, fail = 0, complete = false;
process.on('exit', () => { if (!complete) { console.error('FAIL incomplete soft-cap tests'); process.exitCode = 1; } });
function test(label, fn) { try { fn(); pass++; console.log('PASS', label); } catch (e) { fail++; console.error('FAIL', label, e.message); } }
(async () => {
  const highs = await require(path.join(root, 'libs/highs.js'))({ wasmBinary: fs.readFileSync(path.join(root, 'libs/highs.wasm')) });
  for (const [id, field, param, fallback] of [['pair_cap', 'pair_cap.max', 'max', 2], ['days_off_max', 'days_off.max_extra', 'extra', 1]]) {
    for (const value of ['bad', 'Infinity', '-Infinity', '1e999', '   ', true, false, [], [2], {}, NaN, Infinity, -Infinity]) {
      for (const lang of ['ja', 'en']) test(`${id} rejects ${JSON.stringify(value)} in ${lang}`, () => {
        T.setLang(lang); const { R, M } = fixture(id, value), before = JSON.stringify(R);
        assert.throws(() => new T.Problem(R, M), e => e.message.includes(field) && (lang === 'ja' ? e.message.includes('有限') : e.message.includes('finite')));
        assert.equal(JSON.stringify(R), before);
      });
      test(`${id} off preserves ${JSON.stringify(value)}`, () => { const { R, M } = fixture(id, value, 'off'), before = JSON.stringify(R); new T.Problem(R, M); assert.equal(JSON.stringify(R), before); });
    }
    for (const [value, expected] of [[undefined, fallback], [null, fallback], ['', fallback], [0, 0], [-2, 0], [2.4, 2], [2.5, 3], [' 2 ', 2], ['+3', 3], [32, 32]]) test(`${id} keeps existing numeric semantics ${JSON.stringify(value)}`, () => {
      const { R, M } = fixture(id, value), P = new T.Problem(R, M); assert.equal(P.prm[id][param], expected);
      const pin = Object.fromEntries(P.slots.map(s => [T.Problem.key(s), { work: s[0] % 2 ? 'Synthetic A' : 'Synthetic B', oc: [] }]));
      const result = T.solve(P, highs, { pin, timeLimit: 10, mipGap: 0 }); assert.equal(result.status, 'Optimal'); assert.equal(result.objective, T.penalty(P, pin).total);
    });
  }
  complete = true; console.log(`${pass} passed, ${fail} failed`); process.exitCode = fail ? 1 : 0;
})().catch(e => { console.error(e); process.exitCode = 1; });

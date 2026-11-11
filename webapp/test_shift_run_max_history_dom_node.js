// Actual month-settings renderer under jsdom. No browser/OS/network test is claimed.
const fs = require('fs'), path = require('path'), assert = require('assert');
let JSDOM;
for (const p of [process.env.TOBAN_DOM_MODULE, 'jsdom', path.join(process.env.HOME || '', '.toban-test/node_modules/jsdom')].filter(Boolean)) {
  try { ({ JSDOM } = require(p)); break; } catch (e) { if (e.code !== 'MODULE_NOT_FOUND') throw e; }
}
if (!JSDOM) throw new Error('This test requires installed jsdom. Set TOBAN_DOM_MODULE; no tests were run.');
const root = process.env.TOBAN_SOURCE_ROOT || __dirname;
const dom = new JSDOM(fs.readFileSync(path.join(root, 'src/index.html'), 'utf8'), { url: 'https://example.invalid/shift-run.html', runScripts: 'outside-only' });
const w = dom.window, source = f => fs.readFileSync(path.join(root, 'src', f), 'utf8');
w.T = {};
for (const f of ['i18n.js', 'rules-core.js', 'model.js', 'messages.js', 'solver.js', 'check.js',
  ...fs.readdirSync(path.join(root, 'src/rules')).filter(f => f.endsWith('.js')).map(f => 'rules/' + f),
  'app-core.js', 'app-folder.js', 'app-month.js', 'app-input.js', 'app-settings.js', 'app-solve.js']) w.eval(source(f));
const T = w.T, A = T.app;
const R = { profile: { id: 'synthetic-history-limit', roles: [{ id: 'S', refs: [] }], shifts: [{ id: 'day', on: 'none' }, { id: 'night', on: 'all' }] },
  doctors: [{ name: 'Synthetic A', team: 'S', quota: 0 }], weights: {}, rule_states: {} };
T.fillDefaultRules(R); for (const d of T.RULE_DEFS) if (d.states.includes('off')) R.rule_states[d.id] = 'off';
R.rule_states.shift_run_max = 'hard'; T.fillDefaultRules(R);
Object.assign(A.state, { rules: R, month: T.normalizeMonth({ year: 2026, month: 11 }, R), result: null });
let passed = 0, failed = 0;
try {
  for (const value of ['Infinity', 1e20, 'bad']) {
    R.shift_run_max = { night: value }; const before = JSON.stringify(A.state);
    try {
      assert.doesNotThrow(() => A.renderSettingsMonth());
      const rows = w.document.querySelectorAll('#monthSettings tr[data-ld]');
      assert(rows.length >= 2 && rows.length <= 32, 'bounded previous-history rows');
      assert.strictEqual(JSON.stringify(A.state), before, 'rendering does not repair invalid input silently');
      assert.throws(() => new T.Problem(R, A.state.month), /shift_run_max.night/);
      passed++;
    } catch (e) { failed++; console.error(`FAIL history ${value}: ${e.message}`); }
  }
} finally { dom.window.close(); }
console.log(`shift-run history DOM: ${passed} passed, ${failed} failed`); if (failed) process.exitCode = 1;

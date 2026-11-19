// Actual month-settings renderer under jsdom. No browser/OS/network test is claimed.
const fs = require('fs'), path = require('path'), assert = require('assert');
let JSDOM;
for (const p of [process.env.TOBAN_DOM_MODULE, 'jsdom', path.join(process.env.HOME || '', '.toban-test/node_modules/jsdom')].filter(Boolean)) {
  try { ({ JSDOM } = require(p)); break; } catch (e) { if (e.code !== 'MODULE_NOT_FOUND') throw e; }
}
if (!JSDOM) throw new Error('This test requires installed jsdom. Set TOBAN_DOM_MODULE; no tests were run.');
const root = process.env.TOBAN_SOURCE_ROOT || __dirname;
const dom = new JSDOM(fs.readFileSync(path.join(root, 'src/index.html'), 'utf8'), { url: 'https://example.invalid/shift-run.html', runScripts: 'outside-only' });
const w = dom.window, source = f => fs.readFileSync(f === 'app-core.js' && process.env.TOBAN_CORE_SOURCE || path.join(root, 'src', f), 'utf8');
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

try {
 delete R.shift_run_max; A.renderHeader=A.toast=A.renderDoctor=()=>{};
 A.renderSettings(); A.bindSettings(); A.readSettings(); delete R.shift_run_max; A.renderSettings(); A.markSaved('Synthetic saved');
 const input=w.document.querySelector('[data-srm="day"]'); assert(input);assert.strictEqual(input.value,'3');
 input.value='';input.dispatchEvent(new w.Event('input',{bubbles:true}));input.dispatchEvent(new w.Event('change',{bubbles:true}));
 A.readSettings(); console.log('UI clear',JSON.stringify(A.state.rules.shift_run_max),'dirty',A.isDirty());
 assert.deepStrictEqual(JSON.parse(JSON.stringify(A.state.rules.shift_run_max)),{});
 assert.strictEqual(A.isDirty(),true);
 console.log('PASS actual settings day input clear');
} finally {clearTimeout(A.autosaveTimer);dom.window.close()}

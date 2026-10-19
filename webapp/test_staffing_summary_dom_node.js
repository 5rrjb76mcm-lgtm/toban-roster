// Authored for local Mac execution; not executed during cloud patch preparation.
// Synthetic data only. jsdom checks settings markup and exported report text;
// no solver, native browser, layout, OS or network execution is part of this test.
// TOBAN_DOM_MODULE=/installed/node_modules/jsdom node test_staffing_summary_dom_node.js
const fs = require('fs'), path = require('path'), assert = require('assert');
const EXPECTED_CASES = 24;
let started = 0, ended = 0, completed = 0, failed = 0, registered = 0, finished = false;
process.on('exit', () => {
  console.log(`COUNTS registered=${registered} started=${started} ended=${ended} completed=${completed} failed=${failed} expected=${EXPECTED_CASES} finished=${finished}`);
  if (!finished || registered !== EXPECTED_CASES || started !== EXPECTED_CASES || ended !== EXPECTED_CASES || completed !== EXPECTED_CASES || failed !== 0) {
    console.error(`NOT PASSED: staffing summary completed ${completed}/${EXPECTED_CASES}; finished=${finished}`);
    process.exitCode = 1;
  }
});
let JSDOM;
for (const name of [process.env.TOBAN_DOM_MODULE, 'jsdom', path.join(process.env.HOME || '', '.toban-test/node_modules/jsdom')].filter(Boolean)) {
  try { ({ JSDOM } = require(name)); break; } catch (e) { if (e.code !== 'MODULE_NOT_FOUND') throw e; }
}
if (!JSDOM) throw new Error('Staffing summary DOM regression requires installed jsdom 26.1.0. Set TOBAN_DOM_MODULE. This test was NOT run.');
const root = process.env.TOBAN_SOURCE_ROOT || __dirname, clone = x => JSON.parse(JSON.stringify(x));
const source = f => fs.readFileSync(path.join(root, 'src', f), 'utf8');
const scripts = ['i18n.js', 'rules-core.js', 'model.js', 'messages.js', 'check.js', 'report.js',
  ...fs.readdirSync(path.join(root, 'src/rules')).filter(f => f.endsWith('.js')).sort().map(f => 'rules/' + f),
  'app-core.js', 'app-folder.js', 'app-month.js', 'app-input.js', 'app-settings.js'];
const mixed = { count: { weekday: 2, off_days: 3 }, min: { weekday: 1, off_days: 2 }, ideal: { weekday: 1, off_days: 3 } };
const cases = [
  { name: 'Sunday start mixed range and ideal', month: 11, work: mixed, expected: [['weekdays', '1〜2', 1], ['off_days', '2〜3', 3]] },
  { name: 'Monday start mixed range and ideal', month: 6, work: mixed, expected: [['weekdays', '1〜2', 1], ['off_days', '2〜3', 3]] },
  { name: 'weekday-only shift', on: 'weekdays', work: mixed, expected: [['weekdays', '1〜2', 1]] },
  { name: 'off-day-only shift', on: 'off_days', work: mixed, expected: [['off_days', '2〜3', 3]] },
  { name: 'equal tuple retains every-day statement', work: { count: { weekday: 3, off_days: 3 }, min: 1, ideal: 2 }, expected: [['all', '1〜3', 2]] },
  { name: 'ideal alone differs', work: { count: 3, min: 1, ideal: { weekday: 1, off_days: 2 } }, expected: [['weekdays', '1〜3', 1], ['off_days', '1〜3', 2]] },
  { name: 'inactive ideal does not split statement', target: false, work: { count: 3, min: 1, ideal: { weekday: 1, off_days: 2 } }, expected: [['all', '1〜3']] },
  { name: 'fixed counts differ', work: { count: { weekday: 1, off_days: 2 } }, expected: [['weekdays', '1'], ['off_days', '2']] },
  { name: 'fixed equal scalar remains concise', work: { count: 2 }, expected: [['all', '2']] },
  { name: 'zero lower bound retained', work: { count: { weekday: 2, off_days: 3 }, min: 0 }, expected: [['weekdays', '0〜2'], ['off_days', '0〜3']] },
  { name: 'no weekday slots this month', allHolidays: true, work: mixed, expected: [['all', '2〜3', 3]] },
  { name: 'disabled day shift omitted', on: 'none', work: mixed, expected: [] }
];
registered = cases.length * 2;
assert.strictEqual(registered, EXPECTED_CASES, 'registered staffing-summary cases');
console.log(`REGISTERED ${registered} staffing-summary cases`);
for (const lang of ['en', 'ja']) for (const c of cases) {
  started++;
  console.log(`START ${started}/${registered} ${lang}: ${c.name}`);
  let dom;
  try {
    dom = new JSDOM(source('index.html'), { url: 'https://example.invalid/synthetic/staffing-summary.html', runScripts: 'outside-only' });
    const w = dom.window;
    w.T = {}; w.confirm = () => true; w.alert = msg => { throw new Error(String(msg)); };
    for (const f of scripts) w.eval(source(f) + '\n//# sourceURL=' + f);
    const T = w.T, A = T.app;
    for (const code of ['en', 'ja']) T.registerLang(JSON.parse(fs.readFileSync(path.join(root, 'lang', code + '.json'), 'utf8')));
    T.setLang(lang);
    const R = { profile: { id: 'synthetic-summary', calendar: { holidays: 'none' },
      roles: [{ id: 'S', label: 'Staff', refs: [] }],
      shifts: [{ id: 'day', label: 'Day', on: c.on || 'all' }, { id: 'night', label: 'Night', on: 'all' }],
      positions: { work: { count: { day: clone(c.work.count), night: 1 } } } },
      doctors: ['Synthetic A', 'Synthetic B', 'Synthetic C'].map(name => ({ name, team: 'S', quota: 10 })),
      rule_states: {}, weights: {} };
    for (const k of ['min', 'ideal']) if (c.work[k] !== undefined) R.profile.positions.work[k] = { day: clone(c.work[k]), night: 1 };
    T.DEFAULT_RULES = clone(R); T.fillDefaultRules(R);
    for (const def of T.RULE_DEFS) if (def.states.includes('off')) R.rule_states[def.id] = 'off';
    R.rule_states.count_target = c.target === false ? 'off' : 'soft';
    const M = T.normalizeMonth({ year: 2026, month: c.month || 11, holidays: c.allHolidays ? Array.from({ length: 30 }, (_, i) => i + 1) : [] }, R);
    Object.assign(A.state, { rules: R, month: M, result: null });
    const before = JSON.stringify({ R, M }), P = new T.Problem(R, M);
    const entry = (label, on, n, ideal) => T.t('{label}（{on}・1枠 {n} 人）', { label, on: T.t({ all: '毎日', weekdays: '平日だけ', off_days: '土日祝だけ' }[on]), n: n + (ideal == null ? '' : T.t('（理想 {n}）', { n: ideal })) });
    const expected = T.t('勤務帯: {shifts}', { shifts: [...c.expected.map(([on, n, ideal]) => entry('Day', on, n, ideal)), entry('Night', 'all', '1')].join(T.listSep()) });
    assert.strictEqual(T.rulesSummary(P)[0].items[2], expected, c.name + ': complete staffing statement');
    A.renderSettings();
    const settingsItems = [...w.document.querySelectorAll('.rulesum li')].map(el => el.textContent);
    assert(settingsItems.includes(expected), c.name + ': actual settings summary');
    // Synthetic hand-authored assignments, not a solved or certified-valid roster.
    const asg = Object.fromEntries(P.slots.map(s => [s.join(':'), { work: R.doctors.slice(0, P.countMinOf(s)).map(d => d.name), oc: [] }]));
    const report = w.document.createElement('div'); report.innerHTML = T.reportHtml(P, asg);
    assert([...report.querySelectorAll('li')].some(el => el.textContent === expected), c.name + ': exported HTML shares the complete summary');
    assert.strictEqual(JSON.stringify({ R, M }), before, c.name + ': rendering leaves source unchanged');
    completed++;
    console.log(`PASS ${lang}: ${c.name}`);
  } catch (error) {
    failed++;
    console.error(`FAIL ${lang}: ${c.name}`, error);
  } finally {
    if (dom) dom.window.close();
    ended++;
    console.log(`END ${ended}/${registered} ${lang}: ${c.name}`);
  }
}
assert.strictEqual(started, EXPECTED_CASES);
assert.strictEqual(ended, EXPECTED_CASES);
assert.strictEqual(completed + failed, EXPECTED_CASES);
finished = true;
console.log(`staffing-summary: ${completed} passed, ${failed} failed, ${registered} registered, ${started} started, ${ended} ended`);
assert.strictEqual(completed, EXPECTED_CASES);
assert.strictEqual(failed, 0);
console.log('24 staffing-summary DOM cases passed (synthetic data; Japanese and English; no solver).');

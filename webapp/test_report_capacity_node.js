// Static-authored regression for local execution. No solver/browser required.
// Set TOBAN_WEBAPP_ROOT to an entire baseline/candidate webapp for differential verification.
const assert = require('assert/strict'), fs = require('fs'), path = require('path'), vm = require('vm');
const root = path.resolve(process.env.TOBAN_WEBAPP_ROOT || __dirname);
console.log('SOURCE_ROOT ' + root);
globalThis.T = {};
for (const file of ['i18n.js', 'rules-core.js', 'model.js', 'messages.js', 'check.js', 'report.js'])
  vm.runInThisContext(fs.readFileSync(path.join(root, 'src', file), 'utf8'), { filename: file });
for (const dir of ['rules', 'calendars']) for (const file of fs.readdirSync(path.join(root, 'src', dir)).filter(f => f.endsWith('.js')).sort())
  vm.runInThisContext(fs.readFileSync(path.join(root, 'src', dir, file), 'utf8'), { filename: dir + '/' + file });
for (const lang of ['ja', 'en']) T.registerLang(JSON.parse(fs.readFileSync(path.join(root, 'lang', lang + '.json'), 'utf8')));
const clone = value => JSON.parse(JSON.stringify(value));
// November 2026 without extra holidays: 21 weekdays + 9 weekend days.
// Expected counts are literal arithmetic, not computed with product helpers.
const cases = [
  { id: 'single-worker-control', work: { count: 1 }, expected: [30, 30, 60] },
  { id: 'two-day-one-night', work: { count: { day: 2, night: 1 } }, expected: [60, 30, 90] },
  { id: 'optional-one-to-two', work: { count: 2, min: 1 }, expected: ['30〜60', '30〜60', '60〜120'] },
  { id: 'optional-zero-to-two', work: { count: 2, min: 0 }, expected: ['0〜60', '0〜60', '0〜120'] },
  { id: 'soft-ideal-one', work: { count: 2, min: 1, ideal: 1 }, target: true, expected: ['30〜60', '30〜60', '60〜120'] },
  { id: 'soft-ideal-two', work: { count: 2, min: 1, ideal: 2 }, target: true, expected: ['30〜60', '30〜60', '60〜120'] },
  { id: 'mixed-day-types', work: { count: { day: { weekday: 2, off_days: 3 }, night: 1 }, min: { day: { weekday: 1, off_days: 2 }, night: 1 } }, expected: ['39〜69', 30, '69〜99'] },
  { id: 'weekday-day-only', on: 'weekdays', work: { count: { day: 2, night: 1 } }, expected: [42, 30, 72] },
  { id: 'holiday-day-only', on: 'off_days', work: { count: { day: 2, night: 1 } }, expected: [18, 30, 48] },
  { id: 'disabled-day', on: 'none', work: { count: { day: 3, night: 1 } }, expected: [0, 30, 30] },
  { id: 'fixed-only-not-subtracted', fixedOnly: true, work: { count: { day: 2, night: 1 } }, expected: [60, 30, 90] },
  { id: 'default-sample-control', sample: true, expected: [11, 30, 41] }
];
function fixture(c) {
  if (c.sample) {
    const R = JSON.parse(fs.readFileSync(path.join(root, 'data/rules.json'), 'utf8'));
    const M = JSON.parse(fs.readFileSync(path.join(root, 'data/202611.json'), 'utf8'));
    return { P: new T.Problem(R, M), asg: JSON.parse(fs.readFileSync(path.join(root, 'data/js_assignment.json'), 'utf8')) };
  }
  const R = { profile: { id: 'synthetic-report-capacity', quota_mode: 'absolute', calendar: { holidays: 'none', closure: [] },
    roles: [{ id: 'S', label: 'Staff', refs: [] }],
    shifts: [{ id: 'day', label: 'Synthetic Day <&>', on: c.on || 'all' }, { id: 'night', label: 'Synthetic Night', on: 'all' }],
    positions: { work: clone(c.work) } },
    doctors: ['Synthetic A', 'Synthetic B', 'Synthetic C'].map(name => ({ name, team: 'S', quota: 10 })),
    rule_states: Object.fromEntries(T.RULE_DEFS.map(def => [def.id, 'off'])) };
  if (c.fixedOnly) R.doctors.push({ name: 'Synthetic Fixed', team: 'S', duty: 'fixed_only', quota: 0 });
  T.fillDefaultRules(R);
  if (c.target) R.rule_states.count_target = 'soft';
  const M = T.normalizeMonth({ year: 2026, month: 11, holidays: [] }, R);
  if (c.fixedOnly) M.fixed.day[1] = 'Synthetic Fixed';
  const P = new T.Problem(R, M);
  const asg = Object.fromEntries(P.slots.map(s => [s.join(':'), { work: R.doctors.slice(0, P.countMinOf(s)).map(d => d.name), oc: [] }]));
  if (c.fixedOnly) asg['1:day'].work[0] = 'Synthetic Fixed';
  return { P, asg };
}
const EXPECTED = 24, registered = cases.length * 2;
let started = 0, completed = 0, passed = 0, failed = 0, finished = false;
process.on('exit', () => {
  if (!finished || registered !== EXPECTED || started !== EXPECTED || completed !== EXPECTED || passed + failed !== EXPECTED) {
    console.error('INCOMPLETE report-capacity inventory'); process.exitCode = 1;
  }
});
console.log('REGISTER ' + JSON.stringify(['ja', 'en'].flatMap(lang => cases.map(c => lang + '/' + c.id))));
for (const lang of ['ja', 'en']) for (const c of cases) {
  const id = lang + '/' + c.id; started++; console.log('CASE_START ' + id);
  try {
    T.setLang(lang);
    const { P, asg } = fixture(c), before = JSON.stringify([P.rules, P.m, asg]);
    const checked = T.check(P, asg);
    assert.deepEqual(checked.VC, [], 'fixture accepted by real Problem and checker');
    if (!c.sample) assert.deepEqual(checked.WC, [], 'no tolerated fixed conflicts needed');
    const detail = P.shifts.map((sh, i) => T.t('{shift} {n}', { shift: sh.label, n: c.expected[i] })).join(T.listSep());
    const expected = T.esc(T.t('必要枠: {detail}、計{total}枠。目安合計 {quota}', {
      detail, total: c.expected[2], quota: P.dutyNames.reduce((n, name) => n + P.quota(name), 0)
    }));
    const section = T.buildReport(P, asg).sections.find(s => s.id === 's0');
    const item = section.html.split('<details>')[0].match(/<li>[\s\S]*?<\/li><li>([\s\S]*?)<\/li>/);
    assert(item, 'top summary line exists outside collapsed rules summary');
    assert.equal(item[1], expected, 'person-capacity totals, not cell count/ideal/actual assignments');
    const exported = T.reportHtml(P, asg);
    assert(exported.includes('<li>' + expected + '</li>'), 'standalone HTML uses same summary');
    if (c.id === 'optional-zero-to-two') assert.equal(Object.values(asg).flatMap(x => x.work).length, 0, 'zero lower-bound fixture is genuinely empty');
    assert.equal(JSON.stringify([P.rules, P.m, asg]), before, 'report does not mutate settings/month/result');
    passed++; console.log('PASS ' + id);
  } catch (error) {
    failed++; console.error('FAIL ' + id + ': ' + error.message);
    console.error('CASE_ERROR ' + JSON.stringify({ id, actual: error.actual, expected: error.expected }));
  } finally { completed++; console.log('CASE_COMPLETE ' + id); }
}
finished = true;
console.log('ACCOUNTING ' + JSON.stringify({ registered, started, completed, passed, failed, skipped: 0 }));
if (failed) process.exitCode = 1;

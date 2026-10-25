// The report must not describe afternoon/all-day work after a night shift as
// "morning only". Such work is allowed when duty_conflicts is off, and can be
// retained as a fixed warning when it is hard. All fixtures are synthetic.
// No solver or browser dependency. Keep a complete case ledger even when an
// assertion fails so baseline and individual source-revert runs are comparable.
// TOBAN_WEBAPP_ROOT can select an unmodified baseline for failure reproduction.
const assert = require('assert/strict'), fs = require('fs'), path = require('path'), vm = require('vm');
const root = process.env.TOBAN_WEBAPP_ROOT || __dirname;
const expectedCases = 64;
const registeredIds = [];
for (const lang of ['ja', 'en']) for (const state of ['off', 'hard'])
  for (const fixed of [false, true]) for (const boundary of [false, true])
    for (const scope of ['none', 'am', 'pm', 'both'])
      registeredIds.push([lang, state, fixed, boundary, scope].join(':'));
assert.equal(registeredIds.length, expectedCases);
assert.equal(new Set(registeredIds).size, expectedCases);
const startedIds = [], completedIds = [];
let cases = 0, passed = 0, failed = 0, finished = false;
function runCase(id, fn) {
  assert(registeredIds.includes(id), 'case is registered');
  assert(!startedIds.includes(id), 'case starts only once');
  startedIds.push(id);
  console.log('CASE_START ' + id);
  let status = 'PASS';
  try { fn(); passed++; }
  catch (error) {
    failed++; status = 'FAIL';
    console.error('CASE_ERROR ' + JSON.stringify({ id, name: error.name, message: error.message,
      actual: error.actual, expected: error.expected }));
  }
  completedIds.push(id); cases++;
  console.log('CASE_COMPLETE ' + JSON.stringify({ id, status }));
}
process.on('exit', () => {
  if (!finished || registeredIds.length !== expectedCases || startedIds.length !== expectedCases
      || completedIds.length !== expectedCases || cases !== expectedCases || passed + failed !== expectedCases) {
    console.error(`Premature next-duty report test exit: ${cases}/${expectedCases} cases`);
    process.exitCode = 1;
  }
});
globalThis.T = {};
for (const file of ['i18n.js', 'rules-core.js', 'model.js', 'messages.js', 'check.js', 'report.js'])
  vm.runInThisContext(fs.readFileSync(path.join(root, 'src', file), 'utf8'), { filename: file });
for (const dir of ['rules', 'calendars']) for (const file of fs.readdirSync(path.join(root, 'src', dir)).filter(f => f.endsWith('.js')).sort())
  vm.runInThisContext(fs.readFileSync(path.join(root, 'src', dir, file), 'utf8'), { filename: dir + '/' + file });
for (const lang of ['ja', 'en']) T.registerLang(JSON.parse(fs.readFileSync(path.join(root, 'lang', lang + '.json'), 'utf8')));

const person = 'Synthetic Night Worker <&>', other = 'Synthetic Other Worker';
function fixture(state, fixed, boundary, scope) {
  const rules = {
    profile: {
      id: 'synthetic-report-next-duty-scope', calendar: { holidays: 'none', closure: [] },
      roles: [{ id: 'S', label: 'Staff', refs: [] }],
      shifts: [{ id: 'day', on: 'none' }, { id: 'night', on: 'all' }]
    },
    doctors: [person, other].map(name => ({ name, team: 'S', quota: 0 })),
    name_order: [person, other],
    rule_states: Object.fromEntries(T.RULE_DEFS.map(def => [def.id, 'off'])), weights: {}
  };
  rules.rule_states.duty_conflicts = state;
  T.fillDefaultRules(rules);
  for (const key of Object.keys(rules.weights)) rules.weights[key] = 0;
  const day = boundary ? 30 : 1, next = day + 1;
  const duties = scope === 'none' ? {} : scope === 'am' ? { am: 'outpatient' }
    : scope === 'pm' ? { pm: 'ward' } : { am: 'outpatient', pm: 'ward' };
  const month = T.normalizeMonth({
    year: 2026, month: 11, next_first_day_in_calendar: true,
    duty_days: { [person]: { [next]: duties } },
    fixed: { night: fixed ? { [day]: person } : {} }
  }, rules);
  const P = new T.Problem(rules, month);
  const asg = Object.fromEntries(P.slots.map(([d, shift]) => [`${d}:${shift}`, { work: d === day ? person : other, oc: [] }]));
  return { P, asg, day, next };
}
const rowsOf = html => [...html.matchAll(/<tbody>([\s\S]*?)<\/tbody>/g)].flatMap(table =>
  [...table[1].matchAll(/<tr>([\s\S]*?)<\/tr>/g)].map(row =>
    [...row[1].matchAll(/<td>([\s\S]*?)<\/td>/g)].map(cell => cell[1])));
for (const lang of ['ja', 'en']) {
  T.setLang(lang);
  for (const state of ['off', 'hard']) for (const fixed of [false, true])
    for (const boundary of [false, true]) for (const scope of ['none', 'am', 'pm', 'both']) {
      runCase([lang, state, fixed, boundary, scope].join(':'), () => {
      const { P, asg, day, next } = fixture(state, fixed, boundary, scope);
      const before = JSON.stringify([P.rules, P.m, asg]), conflict = state === 'hard' && ['pm', 'both'].includes(scope);
      const checked = T.check(P, asg);
      assert.deepEqual(checked.VC.map(v => v.code), conflict && !fixed ? ['NIGHT_THEN_DUTY'] : []);
      assert.deepEqual(checked.WC.map(v => v.code), conflict && fixed ? ['NIGHT_THEN_DUTY'] : []);
      assert.equal(T.penalty(P, asg).total, 0, 'disabled adjustment rules do not introduce penalties');
      const section = T.buildReport(P, asg).sections.find(s => s.id === 's7');
      const standalone = T.reportHtml(P, asg), opening = '<section><h3>' + T.esc(section.title) + '</h3>';
      const start = standalone.indexOf(opening);
      assert(start >= 0, 'standalone export contains the duty section');
      const exportedSection = standalone.slice(start + opening.length, standalone.indexOf('</section>', start));
      for (const html of [section.html, exportedSection]) {
        const rows = rowsOf(html);
        if (scope === 'none') assert.equal(rows.length, 0, 'no duty does not create a row');
        else {
          assert.equal(rows.length, 1, 'one night shift contributes one duty row');
          assert.equal(rows[0][0], T.esc(P.label(day)) + ' ' + T.esc(P.shiftLabel('night')));
          assert.equal(rows[0][1], T.esc(person), 'staff identity remains escaped');
          const halves = scope === 'am' ? [['am', 'outpatient']] : scope === 'pm' ? [['pm', 'ward']] : [['am', 'outpatient'], ['pm', 'ward']];
          const items = halves.map(([half, kind]) => T.t('{half}{kind}', { half: T.t(half === 'am' ? '午前' : '午後'), kind: T.kindLabel(kind) })).join(T.nameSep());
          const expected = T.t(scope === 'am' ? '翌{day} {items}（午前のみ）' : '翌{day} {items}', { day: P.label(next), items });
          assert.equal(rows[0][2], T.esc(expected), 'morning-only label follows the actual duty halves');
          assert.equal(rows[0][2].includes(lang === 'ja' ? '（午前のみ）' : '(morning only)'), scope === 'am');
        }
      }
      assert.equal(JSON.stringify([P.rules, P.m, asg]), before, 'reports never change rules, month or assignments');
      });
    }
}
assert.equal(cases, expectedCases);
assert.deepEqual(startedIds, registeredIds, 'all registered cases started in order');
assert.deepEqual(completedIds, registeredIds, 'all registered cases completed in order');
finished = true;
console.log('ACCOUNTING ' + JSON.stringify({ registered: registeredIds.length, started: startedIds.length,
  completed: completedIds.length, passed, failed, skipped: 0, finished }));
if (failed) process.exitCode = 1;
console.log(`${passed}/${cases} next-duty report cases: Japanese/English, afternoon/all-day/morning/no duty, hard/off, fixed warnings, month boundary, standalone export, no mutation`);

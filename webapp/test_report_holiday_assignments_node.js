// Section 5 reports actual holiday allocations, not an obsolete facility rule.
// Synthetic fixtures only. No solver/browser dependency; not executed in cloud.
// TOBAN_WEBAPP_ROOT may select baseline sources for regression reproduction.
const assert = require('assert/strict'), fs = require('fs'), path = require('path'), vm = require('vm');
const root = process.env.TOBAN_WEBAPP_ROOT || __dirname;
globalThis.T = {};
for (const file of ['i18n.js', 'rules-core.js', 'model.js', 'messages.js', 'check.js', 'report.js'])
  vm.runInThisContext(fs.readFileSync(path.join(root, 'src', file), 'utf8'), { filename: file });
for (const dir of ['rules', 'calendars']) for (const file of fs.readdirSync(path.join(root, 'src', dir)).filter(f => f.endsWith('.js')).sort())
  vm.runInThisContext(fs.readFileSync(path.join(root, 'src', dir, file), 'utf8'), { filename: dir + '/' + file });
for (const lang of ['ja', 'en']) T.registerLang(JSON.parse(fs.readFileSync(path.join(root, 'lang', lang + '.json'), 'utf8')));

const N = {
  q: 'Synthetic Charge <&>', q2: 'Synthetic Second Charge',
  j: 'Synthetic Junior A', j2: 'Synthetic Junior B', j3: 'Synthetic Junior C <&>', j4: 'Synthetic Junior D',
  o: 'Synthetic Other A', o2: 'Synthetic Other B'
};
const roles = [
  { id: 'Q', label: 'Lead <&>', refs: ['charge'], standby: true },
  { id: 'J', label: 'Support', refs: ['junior'], standby: true },
  { id: 'O', label: 'Other', refs: ['other'] }
];
const roleOf = Object.fromEntries(Object.entries(N).map(([key, name]) => [name, key.startsWith('q') ? 'Q' : key.startsWith('j') ? 'J' : 'O']));
const labelOf = Object.fromEntries(roles.map(role => [role.id, role.label]));
const tag = 'Synthetic training <&>';
const variants = [
  'junior-requires-junior', 'other-requires-two', 'other-allowed-shortage',
  'mixed-roles', 'oncall-off', 'day-oncall-off', 'night-oncall-off',
  'night-only', 'day-only-holidays', 'multiple-workers', 'default-charge-oncall',
  'fixed-worker-tags', 'slotless-holidays', 'optional-empty-workers'
];

function fixture(variant) {
  const multi = variant === 'multiple-workers';
  const on = !['oncall-off', 'multiple-workers', 'optional-empty-workers'].includes(variant);
  const dayOn = ['night-only', 'slotless-holidays'].includes(variant) ? 'none'
    : variant === 'day-only-holidays' ? 'off_days' : 'all';
  const nightOn = ['day-only-holidays', 'slotless-holidays'].includes(variant) ? 'weekdays' : 'all';
  const R = {
    profile: { id: 'synthetic-report-holiday', calendar: { holidays: 'none', closure: [] }, roles,
      shifts: [{ id: 'day', label: 'Day', on: dayOn, oncall: variant !== 'day-oncall-off' },
        { id: 'night', label: 'Night', on: nightOn, oncall: variant !== 'night-oncall-off' }],
      positions: { work: { count: multi ? 2 : 1 } } },
    doctors: Object.values(N).map(name => ({ name, team: roleOf[name], quota: 0 })),
    name_order: Object.values(N),
    oncall_requirement: { Q: { Q: 0, J: 0 }, J: { Q: 0, J: 1 }, O: { Q: 0, J: 2 } },
    rule_states: Object.fromEntries(T.RULE_DEFS.map(def => [def.id, 'off'])), weights: {}
  };
  if (on) R.rule_states.oncall = 'hard';
  if (variant === 'optional-empty-workers') R.profile.positions.work.min = 0;
  if (variant === 'default-charge-oncall') R.oncall_requirement.J = { Q: 1, J: 0 };
  if (variant === 'mixed-roles') R.oncall_requirement.O = { Q: 0, J: 1 };
  T.fillDefaultRules(R);
  for (const key of Object.keys(R.weights)) R.weights[key] = 0;
  R.weights.missing_young_oc = 17;
  const M = T.normalizeMonth({ year: 2026, month: 11, holidays: [23], next_first_day_in_calendar: true }, R);
  if (variant === 'fixed-worker-tags') {
    M.fixed.day[7] = N.j; M.fixed.night[7] = N.j2;
    M.fixed_tags = { ['7:day|' + N.j]: tag, ['7:night|' + N.j2]: tag };
  }
  const P = new T.Problem(R, M);
  const asg = Object.fromEntries(P.slots.map(([d, shift]) => {
    const day = shift === 'day';
    let work = day ? N.j : N.j2, oc = on ? [N.j3] : [];
    if (variant.startsWith('other-')) {
      work = day ? N.o : N.o2;
      oc = variant === 'other-allowed-shortage' ? [N.j3] : [N.j3, N.j4];
    }
    if (variant === 'mixed-roles' && day) work = N.o;
    if (multi) work = day ? [N.o, N.j] : [N.j2, N.q];
    if (variant === 'optional-empty-workers' && d === 7) work = [];
    if (variant === 'default-charge-oncall') oc = [N.q];
    if ((day && variant === 'day-oncall-off') || (!day && variant === 'night-oncall-off')) oc = [];
    return [`${d}:${shift}`, { work, oc }];
  }));
  return { P, asg };
}

const rowsOf = html => [...html.matchAll(/<tbody>([\s\S]*?)<\/tbody>/g)].flatMap(table =>
  [...table[1].matchAll(/<tr>([\s\S]*?)<\/tr>/g)].map(row =>
    [...row[1].matchAll(/<td>([\s\S]*?)<\/td>/g)].map(cell => cell[1])));
const caseNames = ['ja', 'en'].flatMap(lang => variants.map(variant => `${lang}/${variant}`));
const expectedCases = 28;
assert.equal(caseNames.length, expectedCases);
assert.equal(new Set(caseNames).size, expectedCases);
let completed = 0, passed = 0, failed = 0, finished = false;
process.on('exit', () => {
  if (!finished || completed !== expectedCases || passed + failed !== expectedCases) {
    console.error(`Incomplete holiday-report inventory: ${completed}/${expectedCases}`);
    process.exitCode = 1;
  }
});
console.log('REGISTER ' + JSON.stringify(caseNames));
for (const lang of ['ja', 'en']) {
  T.setLang(lang);
  for (const variant of variants) {
    const id = `${lang}/${variant}`;
    console.log('CASE_START ' + id);
    try {
      const { P, asg } = fixture(variant), before = JSON.stringify([P.rules, P.m, asg]);
      const checked = T.check(P, asg);
      assert.deepEqual(checked.VC, [], 'supported assignments satisfy the independent checker');
      assert.deepEqual(checked.WC, [], 'the fixture needs no fixed-conflict exception');
      const penalty = T.penalty(P, asg);
      assert.equal(penalty.total, variant === 'other-allowed-shortage' ? P.slots.length * 17 : 0,
        'optional junior OC shortage is valid and retains its real penalty');
      const section = T.buildReport(P, asg).sections.find(s => s.id === 's5');
      assert(section, 'the holiday overview keeps its stable section ID');
      assert.equal(section.title, lang === 'ja' ? '5 休日の勤務・オンコール一覧' : '5 Work and on-call assignments on days off');
      const standalone = T.reportHtml(P, asg, {}, { label: 'Synthetic draft' });
      const opening = '<section><h3>' + T.esc(section.title) + '</h3>', start = standalone.indexOf(opening);
      assert(start >= 0, 'standalone export contains the same overview');
      const exportedSection = standalone.slice(start + opening.length, standalone.indexOf('</section>', start));
      const days = Array.from({ length: P.N }, (_, i) => i + 1).filter(d => P.isHoliday(d));
      assert(days.includes(7) && days.includes(23) && !days.includes(2), 'weekends and explicit weekday holidays only');
      const expected = days.map(d => {
        const work = shift => {
          const entry = asg[`${d}:${shift}`]; if (!entry) return '―';
          return [].concat(entry.work).map(name => {
            const tagged = variant === 'fixed-worker-tags' && d === 7 ? `${name}(${tag})` : name;
            return `${tagged}（${labelOf[roleOf[name]]}）`;
          }).join(T.nameSep()) || '―';
        };
        const oc = shift => ((asg[`${d}:${shift}`] || {}).oc || []).join(T.nameSep()) || '―';
        return [P.label(d), work('day'), work('night'), oc('day'), oc('night')].map(T.esc);
      });
      for (const html of [section.html, exportedSection]) {
        const headers = [...html.matchAll(/<th>([\s\S]*?)<\/th>/g)].map(match => match[1]);
        assert.deepEqual(headers, ['日付', '日勤者', '夜勤者', '日勤OC', '夜間OC'].map(text => T.esc(T.t(text))),
          'the overview describes facts, not an inferred facility rule');
        assert.deepEqual(rowsOf(html), expected, 'all workers, roles, tags and actual OC are retained in the correct holiday slots');
        assert(!html.includes(T.esc(P.term(T.t('{junior}OC不要（{charge}OCのみ）')))),
          'a junior/junior pair does not invent a charge-only/no-junior requirement');
      }
      assert.equal(JSON.stringify([P.rules, P.m, asg]), before, 'rendering never changes rules, month or assignments');
      passed++; console.log('PASS ' + id);
    } catch (error) {
      failed++; console.error('FAIL ' + id + ': ' + error.message);
      console.error('CASE_ERROR ' + JSON.stringify({ id, name: error.name, actual: error.actual, expected: error.expected }));
    }
    completed++; console.log('CASE_COMPLETE ' + id);
  }
}
assert.equal(completed, expectedCases);
finished = true;
console.log('ACCOUNTING ' + JSON.stringify({ registered: expectedCases, completed, passed, failed, skipped: 0 }));
if (failed) process.exitCode = 1;

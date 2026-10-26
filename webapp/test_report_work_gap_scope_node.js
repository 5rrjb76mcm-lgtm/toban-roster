// Post-PR48: work_gap report rows must enumerate exactly the scored day pairs.
// Synthetic data only. Checker/report/recount tests; no solver or browser needed.
// Authored in the cloud without execution. TOBAN_WEBAPP_ROOT selects baseline sources.
const assert = require('assert/strict'), fs = require('fs'), path = require('path'), vm = require('vm');
const root = process.env.TOBAN_WEBAPP_ROOT || __dirname;
let finished = false, started = 0, completed = 0, passed = 0, failed = 0;
process.on('exit', () => { if (!finished) { console.error('FAIL: work-gap regression did not finish'); process.exitCode = 1; } });
globalThis.T = {};
for (const f of ['i18n.js', 'rules-core.js', 'model.js', 'messages.js', 'check.js', 'report.js'])
  vm.runInThisContext(fs.readFileSync(path.join(root, 'src', f), 'utf8'), { filename: f });
for (const dir of ['rules', 'calendars']) for (const f of fs.readdirSync(path.join(root, 'src', dir)).filter(f => f.endsWith('.js')).sort())
  vm.runInThisContext(fs.readFileSync(path.join(root, 'src', dir, f), 'utf8'), { filename: dir + '/' + f });
for (const lang of ['ja', 'en']) T.registerLang(JSON.parse(fs.readFileSync(path.join(root, 'lang', lang + '.json'), 'utf8')));
const regular = 'Synthetic Gap <&>', reserve = 'Synthetic Reserve <&>';
// Offsets are relative to the current month: 0 = last day of previous month.
// Each pair is independently stated, not calculated by the implementation under test.
const cases = [
  { id: 'previous-only gap 2', prev: [-2, 0], pairs: [] },
  { id: 'previous-only gap 3', prev: [-3, 0], pairs: [] },
  { id: 'reserve previous boundary', reserve: true, prev: [0], work: [2], pairs: [] },
  { id: 'reserve next boundary', reserve: true, work: [28], next: ['night'], pairs: [] },
  { id: 'current gap 2', work: [5, 7], pairs: [[5, 7]] },
  { id: 'current gap 3', work: [5, 8], pairs: [[5, 8]] },
  { id: 'previous boundary gap 2', prev: [-1], work: [1], pairs: [[-1, 1]] },
  { id: 'previous boundary gap 3', prev: [0], work: [3], pairs: [[0, 3]] },
  { id: 'next boundary gap 2', work: [29], next: ['night'], pairs: [[29, 31]] },
  { id: 'next boundary gap 3', work: [28], next: ['night'], pairs: [[28, 31]] },
  { id: 'two shifts still one day pair', work: [5, 7], double: true, pairs: [[5, 7]] },
  { id: 'previous and current double shifts', prev: [0], work: [2], double: true, pairs: [[0, 2]] },
  { id: 'two next shifts still one day pair', work: [29], next: ['day', 'night'], pairs: [[29, 31]] },
  { id: 'both gap lengths without duplicates', work: [5, 7, 8], pairs: [[5, 7], [5, 8]] },
  { id: 'gap 4 is not charged', work: [5, 9], pairs: [] },
  { id: 'next OC is not work', work: [29], next: ['night_oc'], pairs: [] },
  { id: 'disabled next day slot', day: 'none', work: [29], next: ['day'], pairs: [] },
  { id: 'absent next night slot', month: 7, night: 'weekdays', work: [30], next: ['night'], pairs: [] },
  { id: 'off rule', state: 'off', work: [5, 7], pairs: [] },
  { id: 'no work pair', work: [5], pairs: [] },
  { id: 'history-only excluded but crossing kept', prev: [-2, 0], work: [1], pairs: [[-2, 1]] },
];
assert.equal(cases.length, 21, 'fixed authored scenario inventory');
assert.equal(new Set(cases.map(x => x.id)).size, cases.length);
function fixture(c) {
  const month = c.month || 11, N = new Date(2026, month, 0).getDate(), prevN = new Date(2026, month - 1, 0).getDate();
  const names = [regular, reserve, ...Array.from({ length: N }, (_, i) => 'Synthetic Background ' + (i + 1))];
  const R = {
    profile: { id: 'synthetic-work-gap-report', calendar: { holidays: 'none', closure: [] },
      roles: [{ id: 'S', label: 'Staff', refs: [] }, { id: 'R', label: 'Reserve', refs: ['reserve'] }],
      shifts: [{ id: 'day', on: c.day || 'all' }, { id: 'night', on: c.night || 'all' }], positions: { work: { count: 1 } } },
    doctors: names.map(name => ({ name, team: name === reserve ? 'R' : 'S', quota: 0 })), name_order: names,
    rule_states: Object.fromEntries(T.RULE_DEFS.map(d => [d.id, 'off'])), weights: {},
  };
  R.rule_states.work_gap = c.state || 'soft'; T.fillDefaultRules(R);
  for (const k of Object.keys(R.weights)) R.weights[k] = 0;
  R.weights.work_gap_1 = 7; R.weights.work_gap_2 = 11;
  const M = T.normalizeMonth({ year: 2026, month, holidays: [], allow_chief_duty: true }, R);
  const who = c.reserve ? reserve : regular;
  M.prev_month.last_days = (c.prev || []).map(d => ({ date: prevN + d, night: who, ...(c.double ? { day: who } : {}) }));
  for (const k of c.next || []) M.fixed[k][N + 1] = k.endsWith('_oc') ? [who] : who;
  const P = new T.Problem(R, M);
  const asg = Object.fromEntries(P.slots.map(([d, k]) => [`${d}:${k}`, { work: 'Synthetic Background ' + d, oc: [] }]));
  for (const d of c.work || []) for (const k of c.double ? ['day', 'night'] : ['night']) {
    assert(P.slotExists(d, k), 'fixture requires a real current work slot');
    asg[`${d}:${k}`].work = who;
  }
  return { P, asg, who };
}
const labels = ['ja', 'en'].flatMap(lang => cases.map(c => `${lang}/${c.id}`));
console.log('WORK_GAP_REGISTER ' + JSON.stringify(labels));
for (const lang of ['ja', 'en']) { T.setLang(lang); for (const c of cases) {
  const label = `${lang}/${c.id}`; started++; console.log('WORK_GAP_START ' + JSON.stringify(label));
  try {
    const { P, asg, who } = fixture(c), before = JSON.stringify([P.rules, P.m, asg]);
    assert.equal(T.check(P, asg).V.length, 0, 'fixture is structurally and hard-rule valid');
    const score = T.penalty(P, asg), count = gap => c.pairs.filter(([a, b]) => b - a === gap).length;
    assert.equal(score.items.work_gap_1 || 0, 7 * count(2), 'gap-2 independent recount');
    assert.equal(score.items.work_gap_2 || 0, 11 * count(3), 'gap-3 independent recount');
    const section = T.buildReport(P, asg).sections.find(s => s.id === 's9'), html = T.reportHtml(P, asg);
    const heading = '<section><h3>' + T.esc(section.title) + '</h3>', from = html.indexOf(heading);
    assert(from >= 0, 'standalone report has Section 9');
    for (const source of [section.html, html.slice(from + heading.length, html.indexOf('</section>', from))]) {
      const rows = [...source.matchAll(/<li>([\s\S]*?)<\/li>/g)].map(m => m[1]).filter(s => s.includes(T.esc(who)));
      assert.equal(rows.length, c.pairs.length ? 1 : 0, 'one scoped staff row, none for unscored work');
      const text = rows.join('');
      assert.equal((text.match(/→/g) || []).length, c.pairs.length, 'exactly one arrow per charged day pair');
      for (const [a, b] of c.pairs) assert(text.includes(T.esc(`${P.label(a)}→${P.label(b)}`)), 'correct boundary labels');
      assert(!source.includes('<&>'), 'staff identity must be HTML escaped');
    }
    assert.equal(JSON.stringify([P.rules, P.m, asg]), before, 'recount/report do not mutate input');
    passed++; console.log('PASS ' + label);
  } catch (e) { failed++; console.error('FAIL ' + label + ': ' + (e.stack || e)); }
  completed++; console.log('WORK_GAP_COMPLETE ' + JSON.stringify(label));
} }
assert.equal(started, 42); assert.equal(completed, 42); assert.equal(passed + failed, 42);
finished = true;
console.log('WORK_GAP_ACCOUNTING ' + JSON.stringify({ registered: 42, started, completed, passed, failed, skipped: 0 }));
if (failed) process.exitCode = 1;

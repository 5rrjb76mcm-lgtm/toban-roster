// Next-month fixed workers are normalized arrays, including an empty array.
// Static-authored proposal: no product, syntax, test, build or solver execution in cloud.
// TOBAN_WEBAPP_ROOT selects the whole baseline/fixed product tree for identical tests.
const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert/strict');
const root = process.env.TOBAN_WEBAPP_ROOT || __dirname;
globalThis.T = {};
for (const f of ['i18n.js', 'rules-core.js', 'model.js', 'messages.js', 'check.js', 'report.js'])
  vm.runInThisContext(fs.readFileSync(path.join(root, 'src', f), 'utf8'), { filename: f });
for (const dir of ['rules', 'calendars']) for (const f of fs.readdirSync(path.join(root, 'src', dir)).filter(x => x.endsWith('.js')).sort())
  vm.runInThisContext(fs.readFileSync(path.join(root, 'src', dir, f), 'utf8'), { filename: dir + '/' + f });
for (const lang of ['ja', 'en']) T.registerLang(JSON.parse(fs.readFileSync(path.join(root, 'lang', lang + '.json'), 'utf8')));
const clone = x => JSON.parse(JSON.stringify(x));
const names = ['Synthetic Alpha <&>', 'Synthetic Beta, Branch', 'Synthetic Gamma', 'Synthetic Delta'];
const [alpha, beta, gamma, delta] = names;
const variants = [
  { id: 'nothing', fixed: {}, work: {} },
  { id: 'empty-arrays', fixed: { day: [], night: [] }, work: {} },
  { id: 'day-scalar', fixed: { day: alpha }, work: { day: [alpha] } },
  { id: 'night-scalar', fixed: { night: beta }, work: { night: [beta] } },
  { id: 'day-singleton', fixed: { day: [alpha] }, work: { day: [alpha] } },
  { id: 'night-singleton', fixed: { night: [beta] }, work: { night: [beta] } },
  { id: 'day-oc-only', fixed: { day_oc: [gamma] }, work: {} },
  { id: 'night-oc-only', fixed: { night_oc: [delta] }, work: {} },
  { id: 'charge-only', fixed: { weekend_charge: alpha }, work: {} },
  { id: 'both-workers', fixed: { day: alpha, night: beta }, work: { day: [alpha], night: [beta] } },
  { id: 'multiple-day', multi: true, fixed: { day: [alpha, beta] }, work: { day: [alpha, beta] } },
  { id: 'multiple-night', multi: true, fixed: { night: [gamma, delta] }, work: { night: [gamma, delta] } },
  { id: 'multiple-both', multi: true, fixed: { day: [alpha, beta], night: [gamma, delta] }, work: { day: [alpha, beta], night: [gamma, delta] } },
  { id: 'explicit-empty-with-oc', fixed: { day: [], night: [], day_oc: [gamma], night_oc: [delta] }, work: {} }
];
const template = '翌月1日 {day} の固定指定: {items}（{last} との連続禁止と月またぎの接続に適用。翌月作成時に1日の固定として引き継ぐ）';
function fixture(c) {
  const R = {
    profile: { id: 'synthetic-next-fixed-report', calendar: { holidays: 'none' },
      roles: [{ id: 'Staff', label: 'Synthetic lead', refs: ['charge'], standby: true }],
      shifts: [{ id: 'day', label: 'Synthetic day <&>', on: 'all' }, { id: 'night', label: 'Synthetic night', on: 'all' }],
      positions: { work: { count: c.multi ? 2 : 1 } } },
    doctors: names.map(name => ({ name, team: 'Staff', quota: 0 })), name_order: names.slice(),
    rule_states: Object.fromEntries(T.RULE_DEFS.map(d => [d.id, 'off'])), weights: {}
  };
  T.fillDefaultRules(R);
  const fixed = Object.fromEntries(Object.entries(c.fixed).map(([k, value]) => [k, { 31: clone(value) }]));
  const M = T.normalizeMonth({ year: 2026, month: 11, holidays: [], fixed, next_first_day_in_calendar: true }, R);
  const P = new T.Problem(R, M);
  const asg = Object.fromEntries(P.slots.map(([d, sh]) => [`${d}:${sh}`, { work: c.multi ? [alpha, beta] : alpha, oc: [] }]));
  return { P, asg };
}
const ids = ['ja', 'en'].flatMap(lang => variants.map(c => lang + '/' + c.id));
const EXPECTED = 28;
let started = 0, completed = 0, passed = 0, failed = 0, finished = false;
process.on('exit', () => { if (!finished || started !== EXPECTED || completed !== EXPECTED || passed + failed !== EXPECTED || failed) process.exitCode = 1; });
assert.equal(ids.length, EXPECTED); assert.equal(new Set(ids).size, EXPECTED);
console.log('REGISTER ' + JSON.stringify(ids));
for (const lang of ['ja', 'en']) for (const c of variants) {
  const id = lang + '/' + c.id;
  started++; console.log('CASE_START ' + id);
  try {
    T.setLang(lang);
    const { P, asg } = fixture(c), before = JSON.stringify([P.rules, P.m, asg]);
    assert.equal(P.N, 30); assert.equal(P.slots.length, 60);
    assert.deepEqual(P.nextFixed.day, c.work.day || []);
    assert.deepEqual(P.nextFixed.night, c.work.night || []);
    // The complete current-month roster is valid; next-fixed OC remains factual
    // input even while global OC is off (existing documented boundary behavior).
    assert.deepEqual(T.check(P, asg).VC, []);
    const items = [];
    if (c.work.day) items.push(P.shiftLabel('day') + ' ' + c.work.day.join(T.nameSep()));
    if (c.fixed.day_oc) items.push(T.t('日勤OC') + ' ' + c.fixed.day_oc.join(T.nameSep()));
    if (c.work.night) items.push(P.shiftLabel('night') + ' ' + c.work.night.join(T.nameSep()));
    if (c.fixed.night_oc) items.push(T.t('夜間OC') + ' ' + c.fixed.night_oc.join(T.nameSep()));
    if (c.fixed.weekend_charge) items.push(P.term(T.t('{charge}担当 ' + c.fixed.weekend_charge)));
    const html = T.buildReport(P, asg).sections.find(s => s.id === 's10').html;
    const text = T.t(template, { day: P.nextLabel(), items: items.join(T.listSep()), last: '11/30' });
    const prefix = T.t(template, { day: P.nextLabel(), items: '__ITEMS__', last: '11/30' }).split('__ITEMS__')[0];
    if (items.length) assert.ok(html.includes('<li>' + T.esc(text) + '</li>'), id + ': complete fixed-input sentence, no empty work entries or raw array commas');
    else assert.ok(!html.includes(T.esc(prefix)), id + ': no fixed sentence when all arrays are empty');
    const standalone = T.reportHtml(P, asg, {}, { label: 'Synthetic', notes: 'Synthetic only' });
    assert.ok(standalone.includes(html), 'Standalone HTML includes the same complete section');
    assert.equal(JSON.stringify([P.rules, P.m, asg]), before, 'Report does not modify rules, month or assignments');
    passed++; console.log('PASS ' + id);
  } catch (error) { failed++; console.error('FAIL ' + id, error.stack || error); }
  finally { completed++; console.log('CASE_END ' + id); }
}
finished = true;
console.log('ACCOUNTING ' + JSON.stringify({ expected: EXPECTED, registered: ids.length, started, completed, passed, failed }));

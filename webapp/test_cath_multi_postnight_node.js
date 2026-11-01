// C05: specialist availability must consider every worker in the previous night.
// Static-authored proposal. Product/tests/build/syntax/solver were not executed in cloud.
// TOBAN_WEBAPP_ROOT selects the complete baseline/fixed source tree for identical tests.
const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert/strict');
const root = process.env.TOBAN_WEBAPP_ROOT || __dirname;
globalThis.T = {};
for (const f of ['i18n.js', 'rules-core.js', 'model.js', 'messages.js', 'check.js', 'report.js'])
  vm.runInThisContext(fs.readFileSync(path.join(root, 'src', f), 'utf8'), { filename: f });
for (const dir of ['rules', 'calendars']) for (const f of fs.readdirSync(path.join(root, 'src', dir)).filter(x => x.endsWith('.js')).sort())
  vm.runInThisContext(fs.readFileSync(path.join(root, 'src', dir, f), 'utf8'), { filename: dir + '/' + f });
for (const lang of ['ja', 'en']) T.registerLang(JSON.parse(fs.readFileSync(path.join(root, 'lang', lang + '.json'), 'utf8')));
const N = 'Synthetic Neutral', A = 'Synthetic Assistant <&>', I = 'Synthetic Lead', Y = 'Synthetic Junior', S = 'Synthetic Spare';
const doctors = [{ name: N, team: 'S' }, { name: A, team: 'A', cath: 'A' }, { name: I, team: 'I', cath: 'I' }, { name: Y, team: 'Y' }, { name: S, team: 'S' }].map(x => ({ ...x, quota: 0 }));
const variants = [
  { id: 'second-assistant', workers: [N, A] },
  { id: 'second-lead', workers: [N, I] },
  { id: 'second-junior-clinic', workers: [N, Y] },
  { id: 'first-assistant-control', workers: [A, N] },
  { id: 'scalar-assistant-control', workers: A, single: true },
  { id: 'scalar-lead-control', workers: I, single: true },
  { id: 'exclusion-off-assistant-control', workers: [N, A], exclude: false },
  { id: 'exclusion-off-lead-control', workers: [N, I], exclude: false },
  { id: 'previous-month-second-assistant', workers: [N, A], previous: true },
  { id: 'previous-month-second-lead', workers: [N, I], previous: true },
  { id: 'no-specialist-post-control', workers: [N, S] },
  { id: 'both-specialists-post', workers: [A, I] },
  { id: 'duty-before-post-control', workers: [N, A], blocked: 'duty' },
  { id: 'leave-before-post-control', workers: [N, A], blocked: 'leave' }
];
function fixture(c) {
  const R = { profile: { id: 'synthetic-cath-postnight', calendar: { holidays: 'none' },
    roles: [{ id: 'S', refs: [] }, { id: 'A', refs: ['other'] }, { id: 'I', refs: ['charge'] }, { id: 'Y', refs: ['junior'] }],
    shifts: [{ id: 'day', on: 'all' }, { id: 'night', on: 'all' }], positions: { work: { count: c.single ? 1 : 2 } } },
    doctors: structuredClone(doctors), rule_states: Object.fromEntries(T.RULE_DEFS.map(d => [d.id, 'off'])), weights: {},
    exclude_post_night_from_cath: c.exclude !== false, pm_clinic_arrhythmia_candidates: [I],
    cath_requirement: Object.fromEntries(['Mon', 'Tue', 'Wed', 'Thu', 'Fri'].map(d => [d, { A_am: 1, A_pm: 1, I: 1, pm_clinic: true }])) };
  T.fillDefaultRules(R);
  const M = T.normalizeMonth({ year: 2026, month: c.previous ? 6 : 11, holidays: [],
    duty_days: c.blocked === 'duty' ? { [A]: { 2: { am: 'external', pm: 'external' } } } : {},
    unavailable_other: c.blocked === 'leave' ? [{ name: A, day: 2, part: 'day' }] : [],
    prev_month: { last_days: c.previous ? [{ date: 31, night: structuredClone(c.workers), night_oc: [] }] : [] } }, R);
  const P = new T.Problem(R, M), d = c.previous ? 1 : 2;
  const asg = Object.fromEntries(P.slots.map(([day, sh]) => [`${day}:${sh}`, { work: c.single ? N : [N, S], oc: [] }]));
  if (c.previous) asg['0:night'] = { work: [], oc: [] }; // Empty stale result must not replace authoritative history.
  else asg['1:night'].work = structuredClone(c.workers);
  return { P, asg, d };
}
function expected(c, half) {
  const post = c.exclude === false ? [] : [].concat(c.workers);
  const mark = n => n + '(' + T.t('夜勤明け') + ')';
  const blocked = n => !!c.blocked && n === A;
  const blockMark = n => n + '(' + (c.blocked === 'duty' ? T.kindLabel('external') : T.t('不可')) + ')';
  const ok = list => list.filter(n => !blocked(n) && (half === 'am' || !post.includes(n))).map(n => post.includes(n) ? mark(n) : n);
  const ex = list => list.filter(n => blocked(n) || (half === 'pm' && post.includes(n))).map(n => blocked(n) ? blockMark(n) : mark(n));
  const okA = ok([A]), okI = ok([I]), ng = [];
  if (okA.length < 1) ng.push('CATH_OTHER_SHORT');
  if (okI.length < 1) ng.push('CATH_CHARGE_SHORT');
  if (half === 'pm' && ok([A, I]).length < 2) ng.push('CATH_CLINIC_OTHER_SHORT');
  if (half === 'pm' && ok([Y]).length < 1) ng.push('CATH_CLINIC_JUNIOR_NONE');
  return { okA, exA: ex([A]), okI, exI: ex([I]), ng,
    postUsed: half === 'am' && !ng.length && (post.includes(A) || post.includes(I)),
    clinic: half === 'pm' ? { okC: ok([A, I]), exC: ex([A, I]), okY: ok([Y]), exY: ex([Y]) } : null };
}
const ids = ['ja', 'en'].flatMap(lang => variants.map(c => lang + '/' + c.id)), EXPECTED = 28;
let started = 0, completed = 0, passed = 0, failed = 0, finished = false;
process.on('exit', () => { if (!finished || started !== EXPECTED || completed !== EXPECTED || passed + failed !== EXPECTED || failed) process.exitCode = 1; });
assert.equal(ids.length, EXPECTED); assert.equal(new Set(ids).size, EXPECTED); console.log('REGISTER ' + JSON.stringify(ids));
for (const lang of ['ja', 'en']) for (const c of variants) {
  const id = lang + '/' + c.id; started++; console.log('CASE_START ' + id);
  try {
    T.setLang(lang); const { P, asg, d } = fixture(c), before = JSON.stringify([P.rules, P.m, asg]);
    assert.equal(P.N, 30); assert.equal(P.slots.length, 60); assert.equal(P.isHoliday(d), false);
    assert.deepEqual(T.check(P, asg).VC, [], 'Complete supported current-month assignment; cath availability is informational');
    const accessor = new T.Asg(P, asg); assert.deepEqual(accessor.workers([d - 1, 'night']), [].concat(c.workers));
    const rows = T.cathTable(P, accessor), html = T.buildReport(P, asg).sections.find(s => s.id === 's8').html;
    for (const half of ['am', 'pm']) {
      const row = rows.find(r => r.d === d && r.half === half), e = expected(c, half); assert.ok(row);
      for (const key of ['okA', 'exA', 'okI', 'exI', 'postUsed', 'clinic']) assert.deepEqual(row[key], e[key], key);
      assert.deepEqual(row.ng.map(x => x.code), e.ng); assert.equal(row.needA, 1);
      const prefix = '<td>' + T.esc(P.label(d)) + '</td><td>' + T.esc(T.t(half === 'am' ? '午前' : '午後')) + '</td>';
      const tr = [...html.matchAll(/<tr>(.*?)<\/tr>/g)].map(x => x[1]).find(x => x.startsWith(prefix)); assert.ok(tr, 'Actual report row');
      const cells = [...tr.matchAll(/<td>(.*?)<\/td>/g)].map(x => x[1]);
      assert.equal(cells[3], T.esc(e.okA.join(T.nameSep()))); assert.equal(cells[4], T.esc(e.exA.join(T.listSep())));
      assert.equal(cells[5], T.esc(e.okI.join(T.nameSep()))); assert.equal(cells[6], T.esc(e.exI.join(T.listSep())));
      assert.equal(cells[7], e.clinic ? T.esc(e.clinic.okC.join(T.nameSep())) + ' / ' + T.esc(e.clinic.okY.join(T.nameSep())) : '');
      if (e.ng.length) assert.ok(cells[8].includes('<b class="ng">'));
      else assert.equal(cells[8], T.esc(T.t(e.postUsed ? '充足（夜勤明けを含む・減点）' : '充足')));
    }
    assert.ok(T.reportHtml(P, asg, {}, { label: 'Synthetic', notes: 'Synthetic only' }).includes(html));
    assert.equal(JSON.stringify([P.rules, P.m, asg]), before, 'Report and table do not mutate inputs');
    passed++; console.log('PASS ' + id);
  } catch (error) { failed++; console.error('FAIL ' + id, error.stack || error); }
  finally { completed++; console.log('CASE_END ' + id); }
}
finished = true; console.log('ACCOUNTING ' + JSON.stringify({ expected: EXPECTED, registered: ids.length, started, completed, passed, failed }));

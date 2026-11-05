// Post55: disabled period_charge must not invent responsibility or penalties.
// Static-authored candidate. Product, tests, build and syntax checks were NOT RUN.
// TOBAN_WEBAPP_ROOT selects the complete baseline or candidate source tree.
// Synthetic inputs only. No solver, browser or external service is used.
const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert/strict');
const root = path.resolve(process.env.TOBAN_WEBAPP_ROOT || __dirname);
console.log('SOURCE_ROOT ' + root);
globalThis.T = {};
for (const file of ['i18n.js', 'rules-core.js', 'model.js', 'messages.js', 'check.js', 'report.js'])
  vm.runInThisContext(fs.readFileSync(path.join(root, 'src', file), 'utf8'), { filename: file });
for (const dir of ['rules', 'calendars']) for (const file of fs.readdirSync(path.join(root, 'src', dir)).filter(f => f.endsWith('.js')).sort())
  vm.runInThisContext(fs.readFileSync(path.join(root, 'src', dir, file), 'utf8'), { filename: dir + '/' + file });
for (const lang of ['ja', 'en']) T.registerLang(JSON.parse(fs.readFileSync(path.join(root, 'lang', lang + '.json'), 'utf8')));
const alpha = 'Synthetic Lead Alpha <&>', beta = 'Synthetic Lead Beta', spare = 'Synthetic Staff';
const names = [alpha, beta, spare], handoverWeight = 13, splitWeight = 17;
const variants = ['steady', 'handover', 'split', 'next-boundary', 'previous-history', 'no-weekend-slots'];
const cases = ['ja', 'en'].flatMap(lang => ['hard', 'off'].flatMap(state => variants.map(kind => ({ lang, state, kind }))));
for (const lang of ['ja', 'en']) for (const kind of ['multi', 'optional-multi']) cases.push({ lang, state: 'off', kind });
for (const c of cases) c.label = [c.lang, c.state, c.kind].join('/');
const EXPECTED = 28;
function fixture(c) {
  const multi = c.kind === 'multi' || c.kind === 'optional-multi', optional = c.kind === 'optional-multi';
  const R = { profile: { id: 'synthetic-period-report', calendar: { holidays: 'none', closure: [] },
    roles: [{ id: 'Q', label: 'Synthetic lead', refs: ['charge'], standby: true }, { id: 'S', label: 'Synthetic staff', refs: [] }],
    shifts: ['day', 'night'].map(id => ({ id, on: c.kind === 'no-weekend-slots' ? 'weekdays' : 'all' })),
    positions: { work: { count: multi ? 2 : 1, min: optional ? 0 : multi ? 2 : 1 } } },
    doctors: names.map((name, i) => ({ name, team: i < 2 ? 'Q' : 'S', quota: 0 })), name_order: names,
    rule_states: Object.fromEntries(T.RULE_DEFS.map(d => [d.id, 'off'])), weights: {} };
  R.rule_states.period_charge = c.state;
  T.fillDefaultRules(R);
  for (const key of Object.keys(R.weights)) R.weights[key] = 0;
  R.weights.charge_handover = handoverWeight; R.weights.split_weekend = splitWeight;
  const M = T.normalizeMonth({ year: 2026, month: c.kind === 'next-boundary' ? 10 : 11, holidays: [],
    history: { weekend_charge: { [alpha]: 2, [beta]: 1 }, holiday_charge: { [beta]: 1 } },
    prev_month: c.kind === 'previous-history' ? { last_days: [{ date: 31, day: alpha, day_oc: [], night: beta, night_oc: [] }],
      last_weekend_charge: alpha, prev_weekend_charge: beta } : {} }, R);
  if (c.kind === 'next-boundary') { M.fixed.day[32] = alpha; M.fixed.night[32] = alpha; }
  const P = new T.Problem(R, M);
  const asg = Object.fromEntries(P.slots.map(([d, k]) => [`${d}:${k}`, {
    work: optional && k === 'day' ? [] : multi ? [alpha, beta] : alpha, oc: []
  }]));
  if (c.kind === 'handover') asg['8:night'].work = beta;
  if (c.kind === 'split') { asg['8:day'].work = beta; asg['8:night'].work = beta; }
  return { P, asg };
}
const section = (rep, id) => rep.sections.find(s => s.id === id);
const itemTexts = html => [...html.matchAll(/<li>([\s\S]*?)<\/li>/g)].map(x => x[1]);
let started = 0, completed = 0, passed = 0, failed = 0, finished = false;
process.on('exit', () => {
  if (!finished || started !== EXPECTED || completed !== EXPECTED || passed + failed !== EXPECTED || failed) process.exitCode = 1;
});
assert.equal(cases.length, EXPECTED); assert.equal(new Set(cases.map(c => c.label)).size, EXPECTED);
console.log('REGISTER ' + JSON.stringify(cases.map(c => c.label)));
for (const c of cases) {
  started++; console.log('CASE_START ' + c.label);
  try {
    T.setLang(c.lang);
    const { P, asg } = fixture(c), before = JSON.stringify([P.rules, P.m, asg]);
    const chk = T.check(P, asg), pen = T.penalty(P, asg), rep = T.buildReport(P, asg);
    const html = T.reportHtml(P, asg, {}, { label: 'Synthetic review' });
    const s4 = section(rep, 's4'), s10 = section(rep, 's10'), on = c.state === 'hard';
    assert.deepEqual(chk.VC, [], 'supported fixture is structurally valid in the chosen rule state');
    assert.deepEqual(chk.WC, [], 'no fixed exception masks a fixture problem');
    const expectedPenalty = on && c.kind === 'handover' ? handoverWeight : on && c.kind === 'split' ? splitWeight : 0;
    assert.equal(pen.total, expectedPenalty, 'independent penalty oracle includes only enabled terms');
    assert.equal(pen.items.charge_handover || 0, on && c.kind === 'handover' ? handoverWeight : 0);
    assert.equal(pen.items.split_weekend || 0, on && c.kind === 'split' ? splitWeight : 0);
    assert.equal(rep.sections.length, 11, 'stable section numbering');
    assert.ok(html.includes('<section><h3>' + T.esc(s4.title) + '</h3>' + s4.html + '</section>'), 'standalone report uses the same Section 4');
    assert.ok(html.includes('<section><h3>' + T.esc(s10.title) + '</h3>' + s10.html + '</section>'), 'standalone report uses the same Section 10');
    // Check this independent boundary regression before the Section 4 oracle.
    if (c.kind === 'next-boundary') {
      const last = P.periods[P.periods.length - 1]; assert.ok(last.crossing && !last.prevDays.length);
      const link = P.term(T.t(`月またぎの土日 ${last.name}: {charge}担当 ${T.chargeLabel(P, last, rep.charge[last.id])}（翌月1日へ接続）`));
      assert.equal(itemTexts(s10.html).includes(T.esc(link)), on, 'month-end responsibility assertion follows the rule state');
      assert.deepEqual(P.nextFixed.day, [alpha]); assert.deepEqual(P.nextFixed.night, [alpha]);
      assert.ok(s10.html.includes(T.esc(alpha)), 'ordinary next-month fixed work is still reported when responsibility is off');
    }
    if (!on) {
      assert.equal(s4.html, '<p>' + (c.lang === 'ja' ? '対象外' : 'not applicable') + '</p>', 'disabled period responsibility has no computed narrative');
      assert.ok(!s4.html.includes('<table') && !s4.html.includes('<li>'), 'no fabricated duty totals, handovers or penalty assertions');
    } else {
      assert.ok(s4.html.startsWith('<table'), 'active responsibility table remains present');
      assert.equal(itemTexts(s4.html).length, 7, 'active summary retains all seven existing rows');
      const changes = c.kind === 'handover' ? `${P.label(8)} ${alpha}→${beta}` : T.t('なし');
      const expected = T.t('日の途中で担当が交代した日: {v}（交代は 1 日あたり減点 {w}。固定したとき・ほかに手が無いときだけ使われる。その日の担当は最初の枠の人として数える）', { v: changes, w: handoverWeight });
      assert.ok(s4.html.includes('<li>' + T.esc(expected) + '</li>'), 'active handover detail and escaped names are preserved');
      if (c.kind === 'split') {
        const p = P.periods.find(p => p.full && p.days.includes(8)); assert.ok(p);
        const expectedSplit = T.t('分割した土日: {v}（分割は減点 {w}。均等配分に必要なときだけ使われる）', { v: p.name, w: splitWeight });
        assert.ok(s4.html.includes('<li>' + T.esc(expectedSplit) + '</li>'), 'enabled split burden remains visible');
      }
    }
    assert.deepEqual(rep.met, T.metrics(P, chk.A), 'ordinary assignment metrics are unchanged');
    assert.ok(section(rep, 's2').html.includes(T.esc(alpha)), 'current-month work is not hidden');
    if (c.kind !== 'no-weekend-slots') assert.ok(section(rep, 's5').html.includes(T.esc(alpha)), 'holiday work remains visible independently');
    assert.equal(JSON.stringify([P.rules, P.m, asg]), before, 'rendering and recount do not change source inputs');
    passed++; console.log('PASS ' + c.label);
  } catch (error) { failed++; console.error('FAIL ' + c.label, error.stack || error); }
  finally { completed++; console.log('CASE_END ' + c.label); }
}
finished = true;
console.log('ACCOUNTING ' + JSON.stringify({ expected: EXPECTED, registered: cases.length, started, completed, passed, failed }));

// A disabled duty_conflicts rule must not make a valid day OC look forbidden.
// Synthetic data only. This regression does not load a solver or use a browser.
// TOBAN_WEBAPP_ROOT can select the unmodified webapp for baseline reproduction.
const assert = require('assert/strict'), fs = require('fs'), path = require('path'), vm = require('vm');
const root = process.env.TOBAN_WEBAPP_ROOT || __dirname;
const expectedCases = 48;
let cases = 0, finished = false;
process.on('exit', () => {
  if (!finished || cases !== expectedCases) {
    console.error(`Premature report duty-state test exit: ${cases}/${expectedCases} cases`);
    process.exitCode = 1;
  }
});
globalThis.T = {};
for (const file of ['i18n.js', 'rules-core.js', 'model.js', 'messages.js', 'check.js', 'report.js'])
  vm.runInThisContext(fs.readFileSync(path.join(root, 'src', file), 'utf8'), { filename: file });
for (const dir of ['rules', 'calendars']) for (const file of fs.readdirSync(path.join(root, 'src', dir)).filter(f => f.endsWith('.js')).sort())
  vm.runInThisContext(fs.readFileSync(path.join(root, 'src', dir, file), 'utf8'), { filename: dir + '/' + file });
for (const lang of ['ja', 'en'])
  T.registerLang(JSON.parse(fs.readFileSync(path.join(root, 'lang', lang + '.json'), 'utf8')));

const worker = 'Synthetic Worker', person = 'Synthetic Day OC <&>', other = 'Synthetic Other OC';
function fixture(state, fixed, pmMode, assigned = true) {
  const rules = {
    profile: {
      id: 'synthetic-report-duty-state',
      calendar: { holidays: 'none', closure: [] },
      roles: [{ id: 'S', label: 'Staff', refs: [] }, { id: 'O', label: 'Standby', refs: [], standby: true }],
      shifts: [{ id: 'day', on: 'all' }, { id: 'night', on: 'all' }]
    },
    doctors: [
      { name: worker, team: 'S', quota: 0 },
      { name: person, team: 'O', quota: 0 },
      { name: other, team: 'O', quota: 0 }
    ],
    name_order: [worker, person, other],
    oncall_requirement: { S: { O: 1 }, O: { O: 0 } },
    pm_external_night: pmMode,
    rule_states: Object.fromEntries(T.RULE_DEFS.map(def => [def.id, 'off'])),
    weights: {}
  };
  rules.rule_states.oncall = 'hard';
  rules.rule_states.duty_conflicts = state;
  T.fillDefaultRules(rules);
  for (const key of Object.keys(rules.weights)) rules.weights[key] = 0;
  const month = T.normalizeMonth({
    year: 2026, month: 11,
    duty_days: { [person]: { 2: { pm: 'external' } } },
    fixed: { day_oc: fixed && assigned ? { 2: [person] } : {} }
  }, rules);
  const P = new T.Problem(rules, month);
  const asg = Object.fromEntries(P.slots.map(([d, shift]) => [`${d}:${shift}`, {
    work: worker, oc: [assigned && d === 2 && shift === 'day' ? person : other]
  }]));
  return { P, asg };
}

for (const lang of ['ja', 'en']) {
  T.setLang(lang);
  const plain = lang === 'ja' ? '同日日勤OC' : 'day on-call the same day';
  const forbidden = lang === 'ja' ? '同日日勤OC（禁止）' : 'day on-call the same day (forbidden)';
  const noOc = lang === 'ja' ? '同日の夜勤・OCなし' : 'no night shift or on-call that day';
  for (const state of ['off', 'hard']) for (const fixed of [false, true]) for (const pmMode of ['confirm', 'forbid', 'allow']) for (const assigned of [false, true]) {
    const { P, asg } = fixture(state, fixed, pmMode, assigned), before = JSON.stringify([P.rules, P.m, asg]);
    const result = T.check(P, asg), prohibited = state === 'hard' && assigned;
    assert.deepEqual(result.VC.map(v => v.code), prohibited && !fixed ? ['PM_EXT_DAY_OC'] : [], 'only the active, nonfixed conflict is a violation');
    assert.deepEqual(result.WC.map(v => v.code), prohibited && fixed ? ['PM_EXT_DAY_OC'] : [], 'a fixed assignment retains the existing permitted-conflict warning');
    assert.equal(T.penalty(P, asg).total, 0, 'disabled adjustment rules do not add unrelated penalties');
    const report = T.buildReport(P, asg), section = report.sections.find(s => s.id === 's7');
    const standalone = T.reportHtml(P, asg, {}, { label: 'Synthetic draft' });
    const sectionStart = '<section><h3>' + T.esc(section.title) + '</h3>';
    const sectionAt = standalone.indexOf(sectionStart);
    assert(sectionAt >= 0, 'standalone HTML retains the duty section');
    const exportedSection = standalone.slice(sectionAt + sectionStart.length, standalone.indexOf('</section>', sectionAt));
    const expected = assigned ? (state === 'hard' ? forbidden : plain) : noOc;
    for (const html of [section.html, exportedSection]) {
      const rows = [...html.matchAll(/<tbody>([\s\S]*?)<\/tbody>/g)].flatMap(table =>
        [...table[1].matchAll(/<tr>([\s\S]*?)<\/tr>/g)].map(row =>
          [...row[1].matchAll(/<td>([\s\S]*?)<\/td>/g)].map(cell => cell[1])));
      assert.equal(rows.length, 1, 'the external-duty row stays visible even when duty_conflicts is off');
      assert.equal(rows[0][0], T.esc(P.label(2)) + ' ' + T.esc(T.t('午後外勤')));
      assert.equal(rows[0][1], T.esc(person), 'the same escaped staff identity is shown');
      assert.equal(rows[0][2], T.esc(expected), 'the prohibition label follows the active rule');
    }
    assert.equal(JSON.stringify([P.rules, P.m, asg]), before, 'rendering leaves input and assignment unchanged');
    cases++;
  }
}
assert.equal(cases, expectedCases, 'all planned cases complete before the success marker');
finished = true;
console.log(`${cases} report duty-state cases: Japanese/English, off/hard, fixed warnings, all afternoon-external modes, no-OC controls and standalone HTML`);

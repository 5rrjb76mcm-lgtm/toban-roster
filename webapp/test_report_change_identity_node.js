// Report change markers compare staff identities, never their joined display text.
// Synthetic assignments only; this regression does not load or execute a solver.
const assert = require('assert'), fs = require('fs'), path = require('path'), vm = require('vm');
globalThis.T = {};
for (const file of ['i18n.js', 'rules-core.js', 'model.js', 'messages.js', 'check.js', 'report.js', 'docxgen.js'])
  vm.runInThisContext(fs.readFileSync(file === 'report.js' && process.env.TOBAN_REPORT_SOURCE || path.join(__dirname, 'src', file), 'utf8'), { filename: file });
for (const dir of ['rules', 'calendars']) for (const file of fs.readdirSync(path.join(__dirname, 'src', dir)).filter(f => f.endsWith('.js')).sort())
  vm.runInThisContext(fs.readFileSync(path.join(__dirname, 'src', dir, file), 'utf8'), { filename: dir + '/' + file });
for (const file of fs.readdirSync(path.join(__dirname, 'lang')).filter(f => f.endsWith('.json')))
  T.registerLang(JSON.parse(fs.readFileSync(path.join(__dirname, 'lang', file), 'utf8')));

const clone = value => JSON.parse(JSON.stringify(value));
const currentNames = ['Synthetic Alex', 'Synthetic Blair・Synthetic Casey'];
const previousNames = ['Synthetic Alex・Synthetic Blair', 'Synthetic Casey'];
const names = [...currentNames, ...previousNames];
const worker = 'Synthetic Worker <&>';
assert.notDeepStrictEqual(currentNames, previousNames);
assert.strictEqual(currentNames.slice().sort().join('・'), previousNames.slice().sort().join('・'), 'fixture must expose the old lossy comparison');

function fixture(kind, count = 2) {
  const isOc = kind === 'oc';
  const rules = {
    profile: {
      id: 'synthetic-report-change-identity',
      roles: [{ id: 'S', label: 'Staff', refs: [] }, { id: 'O', label: 'Standby', refs: [], standby: true }],
      shifts: [{ id: 'day', on: 'all' }, { id: 'night', on: 'all' }],
      positions: { work: { count: isOc ? 1 : count } }
    },
    doctors: [worker, ...names].map(name => ({ name, team: isOc && name !== worker ? 'O' : 'S', quota: 0 })),
    name_order: [worker, ...names],
    oncall_requirement: { S: { O: isOc ? count : 0 }, O: { O: 0 } },
    rule_states: Object.fromEntries(T.RULE_DEFS.map(def => [def.id, 'off']))
  };
  if (isOc) rules.rule_states.oncall = 'hard';
  T.fillDefaultRules(rules);
  const month = T.normalizeMonth({ year: 2026, month: 11 }, rules), P = new T.Problem(rules, month);
  const asg = Object.fromEntries(P.slots.map(s => [s.join(':'), {
    work: isOc ? worker : count === 1 ? currentNames[0] : currentNames.slice(),
    oc: isOc ? currentNames.slice(0, count) : []
  }]));
  assert.deepStrictEqual(T.check(P, asg).V, [], 'current fixture must pass the real independent checker');
  return { P, asg };
}

function rosterRows(html) {
  const table = html.match(/<table class="rep roster">[\s\S]*?<tbody>([\s\S]*?)<\/tbody><\/table>/);
  assert(table, 'real report roster table');
  return [...table[1].matchAll(/<tr>([\s\S]*?)<\/tr>/g)].map(row => [...row[1].matchAll(/<td>([\s\S]*?)<\/td>/g)].map(cell => cell[1]));
}

let cases = 0;
function verify(P, asg, baseAsg, expected, target = null) {
  const before = JSON.stringify([P.rules, P.m, asg, baseAsg]);
  const info = baseAsg == null ? {} : { baseAsg };
  const section = T.buildReport(P, asg, info).sections.find(s => s.id === 's2');
  const standalone = T.reportHtml(P, asg, info, { label: 'Synthetic draft', notes: 'Synthetic note <&>' });
  for (const html of [section.html, standalone]) {
    const rows = rosterRows(html), changed = rows.flat().filter(cell => cell.includes('class="chg"'));
    assert.strictEqual(changed.length, expected, 'only genuinely changed roster cells are marked');
    if (target) {
      const cell = rows[target.day - 1][target.column];
      assert.strictEqual(cell, `<span class="chg">${T.esc(target.text)}</span>`, 'marker retains the exact escaped staff display in the correct slot');
    }
  }
  for (const template of ['week_block', 'month_table']) {
    const xml = T.docxXml(P, asg, 'Synthetic draft', { template, today: '2026-10-01T00:00:00Z', baseAsg });
    assert.strictEqual((xml.match(/<w:color w:val="C00000"\/>/g) || []).length, expected, 'HTML and DOCX agree about the changed slot');
  }
  assert.strictEqual(JSON.stringify([P.rules, P.m, asg, baseAsg]), before, 'rendering does not mutate source settings, month or either assignment');
  cases++;
}

for (const lang of ['ja', 'en']) {
  T.setLang(lang);
  for (const kind of ['work', 'oc']) {
    const { P, asg } = fixture(kind);
    verify(P, asg, null, 0);
    verify(P, asg, clone(asg), 0);
    const reordered = clone(asg);
    for (const entry of Object.values(reordered)) entry[kind].reverse();
    verify(P, asg, reordered, 0);
    for (const shift of ['day', 'night']) {
      const base = clone(asg), day = 2;
      base[`${day}:${shift}`][kind] = previousNames.slice();
      assert.deepStrictEqual(T.check(P, base).V, [], 'previous fixture is also a valid assignment');
      const column = (shift === 'day' ? 1 : 3) + (kind === 'oc' ? 1 : 0);
      verify(P, asg, base, 1, { day, column, text: currentNames.join(kind === 'work' ? '・' : T.nameSep()) });
    }
  }
  // A single worker still compares equal across the two supported save formats.
  const { P, asg } = fixture('work', 1), arrays = clone(asg);
  for (const entry of Object.values(arrays)) entry.work = [entry.work];
  verify(P, asg, arrays, 0);
  // The empty baseline means a new populated slot, not an identity collision.
  const missing = clone(asg); delete missing['2:night'];
  verify(P, asg, missing, 1, { day: 2, column: 3, text: currentNames[0] });
  const escaped = clone(asg); escaped['2:night'].work = worker;
  verify(P, escaped, asg, 1, { day: 2, column: 3, text: worker });
  const optionalRules = clone(P.rules); optionalRules.profile.positions.work.min = 0;
  const optionalP = new T.Problem(optionalRules, clone(P.m)), empty = clone(asg), emptyBase = clone(asg);
  empty['2:night'] = { work: [], oc: [] }; delete emptyBase['2:night'];
  assert.deepStrictEqual(T.check(optionalP, empty).V, [], 'optional empty slot is a supported assignment');
  verify(optionalP, empty, emptyBase, 0);
  // Fixed tags belong to display text; comparison still uses the underlying names.
  const taggedFixture = fixture('work'), taggedMonth = clone(taggedFixture.P.m);
  taggedMonth.fixed.night[2] = currentNames.slice();
  for (const name of currentNames) taggedMonth.fixed_tags['2:night|' + name] = 'Synthetic training <&>';
  const taggedP = new T.Problem(clone(taggedFixture.P.rules), taggedMonth), taggedAsg = taggedFixture.asg;
  assert.deepStrictEqual(T.check(taggedP, taggedAsg).V, [], 'tagged current assignment passes the real checker');
  verify(taggedP, taggedAsg, clone(taggedAsg), 0);
  const taggedBase = clone(taggedAsg); taggedBase['2:night'].work = previousNames.slice();
  verify(taggedP, taggedAsg, taggedBase, 1, { day: 2, column: 3, text: currentNames.map(name => name + '(Synthetic training <&>)').join('・') });
}
assert.strictEqual(cases, 32, 'all planned report cases must complete; an assertion failure exits before the success marker');
console.log(`${cases} report identity cases: day/night work and OC, joined-name collisions, Japanese/English, DOCX parity for these names, unchanged/reordered/single-worker controls, no mutation`);

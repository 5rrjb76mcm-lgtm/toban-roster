// C02: Section 9 must enumerate the boundary terms counted by penalty().
// Synthetic inputs only; no solver/browser dependency. Not executed in the cloud.
// TOBAN_WEBAPP_ROOT may select baseline sources for regression reproduction.
const assert = require('assert/strict'), fs = require('fs'), path = require('path'), vm = require('vm');
const root = process.env.TOBAN_WEBAPP_ROOT || __dirname;
globalThis.T = {};
for (const f of ['i18n.js', 'rules-core.js', 'model.js', 'messages.js', 'check.js', 'report.js'])
  vm.runInThisContext(fs.readFileSync(path.join(root, 'src', f), 'utf8'), { filename: f });
for (const dir of ['rules', 'calendars']) for (const f of fs.readdirSync(path.join(root, 'src', dir)).filter(f => f.endsWith('.js')).sort())
  vm.runInThisContext(fs.readFileSync(path.join(root, 'src', dir, f), 'utf8'), { filename: dir + '/' + f });
for (const lang of ['ja', 'en']) T.registerLang(JSON.parse(fs.readFileSync(path.join(root, 'lang', lang + '.json'), 'utf8')));
const who = 'Synthetic Boundary <&>', others = ['Synthetic Background A', 'Synthetic Background B'];
const ids = ['consecutive_days', 'shift_sequence', 'oc_consecutive'];
const weight = 13;
function fixture(id, opt) {
  const R = {
    profile: { id: 'synthetic-report-boundary', calendar: { holidays: 'none', closure: [] },
      roles: [{ id: 'Q', label: 'Boundary staff', refs: opt.charge ? ['charge'] : [], standby: true },
        { id: 'S', label: 'Staff', refs: [], standby: false }],
      shifts: [{ id: 'day', on: opt.day || 'none' }, { id: 'night', on: opt.night || 'all' }],
      positions: { work: { count: 1 } } },
    doctors: [{ name: who, team: 'Q', quota: 0 }, ...others.map(name => ({ name, team: 'S', quota: 0 }))],
    name_order: [who, ...others], oncall_requirement: { S: { Q: 1 }, Q: { Q: 0 } },
    rule_states: Object.fromEntries(T.RULE_DEFS.map(def => [def.id, 'off'])), weights: {},
    forbid_sequence: [{ from: 'night', to: opt.to || 'night' }]
  };
  R.rule_states[id] = opt.state || 'soft';
  if (id === 'oc_consecutive') R.rule_states.oncall = 'hard';
  T.fillDefaultRules(R);
  for (const key of Object.keys(R.weights)) R.weights[key] = 0;
  R.weights[id] = weight;
  const M = T.normalizeMonth({ year: 2026, month: opt.month || 11, holidays: [] }, R);
  const initial = new T.Problem(R, M), N = initial.N;
  const asg = Object.fromEntries(initial.slots.map(([d, k]) => [`${d}:${k}`, { work: others[d % 2], oc: [] }]));
  const entry = mode => mode === 'W' ? { work: who, oc: [] }
    : mode === 'O' ? { work: others[0], oc: [who] } : { work: others[0], oc: [] };
  const put = (d, k, mode) => { asg[`${d}:${k}`] = entry(mode); };
  const fixed = (k, mode) => {
    // Do not fix background work: it could create unrelated consecutive terms.
    if (mode === 'W') M.fixed[k][N + 1] = who;
    if (mode === 'O') M.fixed[k + '_oc'][N + 1] = [who];
  };
  const a = opt.a || 'W', b = opt.b || 'W', boundary = opt.boundary || 'next';
  if (boundary === 'prev' || boundary === 'prevOnly') {
    const e = entry(a), date = new Date(2026, (opt.month || 11) - 1, 0).getDate();
    M.prev_month.last_days = [{ date, night: e.work, night_oc: e.oc }];
    if (boundary === 'prev') put(1, 'night', b);
    else {
      const earlier = entry(b);
      M.prev_month.last_days.unshift({ date: date - 1, night: earlier.work, night_oc: earlier.oc });
      if (opt.day === 'all') M.prev_month.last_days[1].day = others[0];
    }
  } else if (boundary === 'month') {
    put(10, 'night', a); put(11, 'night', b);
  } else {
    put(N, 'night', a);
    for (const k of opt.nextKinds || ['night']) fixed(k, b);
    if (opt.explicitCharge) M.fixed.weekend_charge[N + 1] = who;
  }
  return { P: new T.Problem(R, M), asg, boundary };
}
const cases = [];
const add = (id, label, opt, count) => cases.push({ id, label, opt, count });
for (const id of ['consecutive_days', 'shift_sequence']) {
  for (const boundary of ['prev', 'next', 'month']) add(id, boundary + ' work pair', { boundary }, 1);
  add(id, 'previous-only history is not charged', { boundary: 'prevOnly' }, 0);
  add(id, 'no last-day work', { a: 'O' }, 0);
  add(id, 'next on-call is not work', { b: 'O' }, 0);
  add(id, 'stale disabled next-day work', { nextKinds: ['day'], to: 'day' }, 0);
  add(id, 'stale absent next-night work', { month: 7, night: 'weekdays' }, 0);
  add(id, 'off rule has no row', { state: 'off' }, 0);
  add(id, 'hard rule has no soft row', { state: 'hard' }, 0);
  add(id, 'two next shifts still one day / any term', { day: 'all', nextKinds: ['day', 'night'], to: 'any' }, 1);
}
for (const boundary of ['prev', 'next', 'month']) for (const a of ['W', 'O']) for (const b of ['W', 'O'])
  add('oc_consecutive', `${boundary} ${a}->${b}`, { boundary, a, b }, a === 'W' && b === 'W' ? 0 : 1);
add('oc_consecutive', 'previous-only OC history', { boundary: 'prevOnly', a: 'O', b: 'O', day: 'all' }, 0);
add('oc_consecutive', 'day first plus additional night term', { day: 'all', a: 'O', b: 'W', nextKinds: ['day', 'night'] }, 2);
add('oc_consecutive', 'day first only', { day: 'all', a: 'W', b: 'O', nextKinds: ['day'] }, 1);
add('oc_consecutive', 'additional night without next-day engagement', { day: 'all', a: 'W', b: 'O' }, 1);
add('oc_consecutive', 'stale next-night beside real day', { month: 7, day: 'all', night: 'weekdays', a: 'O', b: 'O' }, 0);
add('oc_consecutive', 'no next slots', { month: 7, night: 'weekdays', a: 'O', b: 'O' }, 0);
add('oc_consecutive', 'same weekend next charge exemption', { month: 10, charge: true, a: 'O', b: 'O' }, 0);
add('oc_consecutive', 'same weekend previous charge exemption', { boundary: 'prev', charge: true, a: 'O', b: 'O' }, 0);
add('oc_consecutive', 'same weekend day-first charge exemption', { month: 10, charge: true, day: 'all', nextKinds: ['day', 'night'], a: 'O', b: 'O' }, 0);
add('oc_consecutive', 'explicit next charge exemption', { month: 10, charge: true, a: 'O', b: 'X', explicitCharge: true }, 0);
add('oc_consecutive', 'non-crossing charge still counted', { month: 8, charge: true, a: 'O', b: 'O' }, 1);
add('oc_consecutive', 'off rule has no row', { state: 'off', a: 'O', b: 'O' }, 0);
const expectedCases = 92;
const registeredLabels = ['ja', 'en'].flatMap(lang => cases.map(c => `${lang}/${c.id}/${c.label}`));
console.log('C02_REGISTER ' + JSON.stringify(registeredLabels));
assert.equal(registeredLabels.length, expectedCases, 'authored inventory has exactly 92 cases');
assert.equal(new Set(registeredLabels).size, expectedCases, 'case labels are unique');
let passed = 0, failed = 0, completed = 0;
for (const lang of ['ja', 'en']) {
  T.setLang(lang);
  for (const c of cases) {
    const label = `${lang}/${c.id}/${c.label}`;
    console.log('C02_START ' + JSON.stringify(label));
    try {
      const { P, asg, boundary } = fixture(c.id, c.opt);
      const before = JSON.stringify([P.rules, P.m, asg]);
      const pen = T.penalty(P, asg), active = !c.opt.state || c.opt.state === 'soft';
      assert.equal(pen.items[c.id] || 0, c.count * weight, 'independent recount equals the explicitly expected terms');
      const section = T.buildReport(P, asg).sections.find(s => s.id === 's9');
      const exported = T.reportHtml(P, asg), heading = '<section><h3>' + T.esc(section.title) + '</h3>';
      const start = exported.indexOf(heading);
      assert(start >= 0, 'standalone report has Section 9');
      const exportedSection = exported.slice(start + heading.length, exported.indexOf('</section>', start));
      for (const html of [section.html, exportedSection]) {
        const lines = [...html.matchAll(/<li>([\s\S]*?)<\/li>/g)].map(m => m[1]).filter(line => line.includes(c.id));
        assert.equal(lines.length, active ? 1 : 0, 'rule-state gating');
        if (!active) continue;
        const line = lines[0];
        const items = line.slice(line.indexOf(': ') + 2); // The translated OC heading itself contains day→night.
        assert.equal((items.match(/→/g) || []).length, c.count, 'one rendered arrow per charged term, no duplicates or unrelated terms');
        assert.equal(line.includes(T.esc(who)), c.count > 0, 'escaped staff identity is present exactly when burden exists');
        if (!c.count) assert(line.endsWith(T.esc(T.t('なし'))), 'zero burden explicitly says none');
        else {
          assert(!line.endsWith(T.esc(T.t('なし'))), 'positive burden never says none');
          const d = boundary === 'prev' ? 0 : boundary === 'month' ? 10 : P.N;
          if (c.id !== 'oc_consecutive') assert(line.includes(T.esc(`${P.label(d)}→${P.label(d + 1)}`)), 'correct named day boundary');
          else {
            const kinds = c.opt.nextKinds || ['night'];
            for (const k of kinds) assert(line.includes(T.esc(`${P.label(d)}${P.shiftLabel('night')}→${P.label(d + 1)}${P.shiftLabel(k)}`)), 'correct named slot boundary');
          }
        }
      }
      for (const id of ids.filter(id => id !== c.id)) assert(!section.html.includes(id), 'disabled unrelated rules remain absent');
      assert.equal(JSON.stringify([P.rules, P.m, asg]), before, 'rendering/recount do not mutate input');
      passed++; console.log('PASS ' + label);
    } catch (e) { failed++; console.error('FAIL ' + label + ': ' + e.message);
      console.error('C02_ERROR ' + JSON.stringify({ label, name: e.name, code: e.code, actual: e.actual, expected: e.expected, message: e.message })); }
    completed++;
    console.log('C02_COMPLETE ' + JSON.stringify(label));
  }
}
assert.equal(completed, expectedCases, 'all registered cases completed');
console.log(JSON.stringify({ registered: expectedCases, completed, passed, failed, skipped: 0 }));
if (failed) process.exitCode = 1;

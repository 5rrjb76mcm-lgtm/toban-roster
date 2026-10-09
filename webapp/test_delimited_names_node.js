// Accepted staff names may contain ':' and '|'. Keep every name intact in merge,
// history input, fixed-tag maintenance, and the next-month connection. Synthetic data only.
// DOM controls are substituted; this does not replace the browser end-to-end suite.
const fs = require("fs"), path = require("path"), vm = require("vm"), assert = require("assert"), { execFileSync } = require("child_process");
const elements = new Map();
globalThis.document = { querySelector: s => elements.get(s) || null, querySelectorAll: () => [] };
globalThis.location = { pathname: "/synthetic/delimited-names.html" };
globalThis.localStorage = { getItem: () => null, setItem() {} };
globalThis.T = {};
for (const f of ["i18n.js", "rules-core.js", "model.js", "messages.js", "merge.js", "solver.js", "check.js", "app-core.js", "app-month.js", "app-input.js"])
  vm.runInThisContext(fs.readFileSync(path.join(__dirname, "src", f), "utf8"), { filename: f });
for (const f of fs.readdirSync(path.join(__dirname, "src/rules")).filter(f => f.endsWith(".js")))
  vm.runInThisContext(fs.readFileSync(path.join(__dirname, "src/rules", f), "utf8"), { filename: "rules/" + f });
const A = T.app, clone = o => JSON.parse(JSON.stringify(o));
const N = ["Synthetic: A|one", "Synthetic: A|two", "Synthetic:: B:|three", "Synthetic plain"];
A.save = () => {}; A.toast = () => {};
let passed = 0, failed = 0;
const test = (name, fn) => { try { fn(); passed++; console.log("ok " + name); } catch (e) { failed++; console.error("FAIL " + name + ": " + e.message); } };
function fixture() {
  const m = { year: 2026, month: 11, targets: {}, count_min: {}, count_max: {}, duty_days: {}, unavailable_night: {}, unavailable_other: [], avoid: [], wishes: { weekend_dayshift: [], night_on: {}, day_on: {} }, fixed: { day: {}, night: {}, weekend_charge: {}, day_oc: {}, night_oc: {} }, fixed_tags: {}, confirmed_pm_external_night: [], history: { weekend_charge: {}, holiday_charge: {}, work_balance: {} }, regular_duties: {}, person_days: { "local.synthetic": {} } };
  N.forEach((n, i) => {
    const d = i + 5;
    m.targets[n] = i + 1; m.count_min[n] = i; m.count_max[n] = i + 2;
    m.duty_days[n] = { [d]: { am: "ward", pm: "external" } };
    m.unavailable_night[n] = [d]; m.unavailable_other.push({ name: n, day: d, part: "day", paid: true }); m.avoid.push({ name: n, day: d, part: "night" });
    m.wishes.weekend_dayshift.push(n); m.wishes.night_on[n] = [d]; m.wishes.day_on[n] = [d];
    m.fixed.day[d] = n; m.fixed.night[d] = n; m.fixed.weekend_charge[d] = n; m.fixed.day_oc[d] = [n]; m.fixed.night_oc[d] = [n];
    m.fixed_tags[`${d}:day|${n}`] = `Synthetic tag ${i}`;
    m.confirmed_pm_external_night.push({ name: n, day: d });
    for (const k of Object.keys(m.history)) m.history[k][n] = i + 1;
    m.regular_duties[n] = [{ kind: "ward", dow: "mon", part: "am", carry: true }];
    m.person_days["local.synthetic"][n] = { [d]: `Synthetic value ${i}` };
  });
  return m;
}
function sameInputs(actual, expected) {
  assert.deepStrictEqual(actual.fixed_tags, expected.fixed_tags, "fixed-tag names retain every pipe and colon");
  assert.deepStrictEqual(T.flattenMonth(actual), T.flattenMonth(expected), "every staff-specific field keeps the original name/day/value");
}
function setup(month = {}) {
  const rules = { profile: { id: "synthetic-delimited", roles: [{ id: "S", label: "Staff", refs: [] }], shifts: [{ id: "day", on: "none" }, { id: "night", on: "all" }] }, doctors: N.map(name => ({ name, team: "S", quota: 8 })), name_order: N.slice(), rule_states: {} };
  T.fillDefaultRules(rules); for (const def of T.RULE_DEFS) if (def.states.includes("off")) rules.rule_states[def.id] = "off";
  Object.assign(A.state, { rules, month: T.normalizeMonth({ year: 2026, month: 11, ...clone(month) }, rules), ui: { doctor: 0 } });
  elements.clear(); return A.state.month;
}
function pane(id, controls = {}, dataset = {}) {
  const el = { children: [{}], dataset, querySelectorAll: s => controls[s] || [], querySelector(s) { return this.querySelectorAll(s)[0] || null; } };
  elements.set("#" + id, el); return el;
}

test("round trip preserves every delimited staff field, including fixed tags", () => {
  const b = fixture(); sameInputs(T.unflattenMonth(T.flattenMonth(b), b), b);
});
test("unrelated three-way changes never rewrite staff data", () => {
  const b = fixture(), mine = clone(b), theirs = clone(b); mine.notes = "Synthetic local note"; theirs.holidays = [3];
  const r = T.mergeMonth(b, mine, theirs); assert.strictEqual(r.conflicts.length, 0);
  sameInputs(r.merged, { ...b, notes: mine.notes, holidays: [3] });
  assert.strictEqual(r.mineChanges, 1); assert.strictEqual(r.theirChanges, 1);
});
test("different people sharing a prefix retain independent fixed tags and changes", () => {
  const b = fixture(); b.fixed.day[5] = N.slice(0, 2); b.fixed_tags[`5:day|${N[1]}`] = "Second person's tag";
  const mine = clone(b), theirs = clone(b); delete mine.fixed_tags[`5:day|${N[0]}`]; theirs.fixed_tags[`5:day|${N[1]}`] = "Changed second tag";
  const r = T.mergeMonth(b, mine, theirs); assert.strictEqual(r.conflicts.length, 0);
  assert.strictEqual(r.merged.fixed_tags[`5:day|${N[0]}`], undefined); assert.strictEqual(r.merged.fixed_tags[`5:day|${N[1]}`], "Changed second tag");
  assert.deepStrictEqual(r.merged.fixed.day[5], N.slice(0, 2));
});
test("conflict choices and labels keep the full staff name and day", () => {
  const n = N[0], changes = [
    ["duty", (m, v) => { m.duty_days[n][5].am = v; }, `5日 午前の業務`],
    ["calendar", (m, v) => { m.avoid[0].part = v === "mine" ? "day" : "allday"; }, `5日 の不可・避`],
    ["tag", (m, v) => { m.fixed_tags[`5:day|${n}`] = v; }, "5日 固定の印"],
    ["history", (m, v) => { m.history.weekend_charge[n] = v === "mine" ? 4 : 8; }, "履歴 weekend_charge"],
    ["pattern", (m, v) => { m.regular_duties[n][0].kind = v; }, "曜日パターン"],
    ["person-day", (m, v) => { m.person_days["local.synthetic"][n][5] = v; }, "5日 local.synthetic"]
  ];
  for (const [kind, change, label] of changes) for (const prefer of ["mine", "theirs"]) {
    const b = fixture(), mine = clone(b), theirs = clone(b); change(mine, "mine"); change(theirs, "theirs");
    const r = T.mergeMonth(b, mine, theirs, prefer); assert.strictEqual(r.conflicts.length, 1, kind);
    assert.ok(r.conflicts[0].label.includes(n), `${kind}: full staff name in conflict label`); assert.ok(r.conflicts[0].label.includes(label), kind + ": full day/field label");
    sameInputs(r.merged, prefer === "mine" ? mine : theirs);
  }
});
test("fixed-tag name references do not invent a truncated staff member", () => {
  assert.deepStrictEqual(Object.keys(T.monthNameRefs({ fixed_tags: { [`5:night|${N[0]}`]: "Synthetic" } })), [N[0]]);
});
test("rename changes only the exact full fixed-tag name", () => {
  const m = { fixed_tags: { [`5:night|${N[0]}`]: "First", [`5:night|${N[1]}`]: "Second" } };
  T.renameMonthName(m, N[0], N[2]);
  assert.deepStrictEqual(m.fixed_tags, { [`5:night|${N[2]}`]: "First", [`5:night|${N[1]}`]: "Second" });
});
test("purge removes the exact full fixed-tag name only", () => {
  const m = { fixed_tags: { [`5:night|${N[0]}`]: "First", [`5:night|${N[1]}`]: "Second" } };
  assert.strictEqual(T.purgeMonthNames(m, [N[0]]), 1); assert.deepStrictEqual(m.fixed_tags, { [`5:night|${N[1]}`]: "Second" });
});
test("next-month fixed tags follow both pipe-containing staff names", () => {
  setup(); const prev = { month: { year: 2026, month: 10, fixed: { night: { 32: N.slice(0, 2) } }, fixed_tags: { [`32:night|${N[0]}`]: "First", [`32:night|${N[1]}`]: "Second", [`31:night|${N[0]}`]: "Not next month" } } };
  const next = A.fromPrevious(prev, 2026, 11);
  assert.deepStrictEqual(next.fixed.night[1], N.slice(0, 2));
  assert.deepStrictEqual(next.fixed_tags, { [`1:night|${N[0]}`]: "First", [`1:night|${N[1]}`]: "Second" });
});
test("history input changes/deletions use the full colon name", () => {
  const m = setup({ history: { weekend_charge: { [N[0]]: 1, [N[1]]: 2, [N[2]]: 9 }, holiday_charge: { [N[0]]: 3, [N[1]]: 4 } } });
  const controls = [
    { dataset: { hist: `weekend_charge:${N[0]}` }, value: "5" }, { dataset: { hist: `weekend_charge:${N[1]}` }, value: "" },
    { dataset: { hist: `holiday_charge:${N[0]}` }, value: "6" }, { dataset: { hist: `holiday_charge:${N[1]}` }, value: "7" }
  ];
  pane("monthSettings", { "[data-hist]": controls }, { names: A.names().join("|") });
  for (let i = 0; i < 2; i++) { A.readSettingsMonth(); assert.deepStrictEqual(m.history.weekend_charge, { [N[0]]: 5, [N[2]]: 9 }); assert.deepStrictEqual(m.history.holiday_charge, { [N[0]]: 6, [N[1]]: 7 }); }
});
test("unrelated fixed-table reads retain pipe-name tags; explicit removal deletes only its tag", () => {
  const m = setup({ fixed: { night: { 5: N[0], 6: N[1] } }, fixed_tags: { [`5:night|${N[0]}`]: "First", [`6:night|${N[1]}`]: "Second" } });
  pane("fixedPane"); A.readAll(); assert.strictEqual(Object.keys(m.fixed_tags).length, 2);
  const el = { dataset: { fx: "night", d: "5" }, value: "", hasAttribute: () => false };
  pane("fixedPane", { "select[data-fx],input[data-fx]": [el], "select[data-fx]": [el] });
  A.readAll(); assert.deepStrictEqual(m.fixed_tags, { [`6:night|${N[1]}`]: "Second" }); A.readAll(); assert.strictEqual(Object.keys(m.fixed_tags).length, 1);
});
test("calendar fixed removal deletes its pipe-name tag without touching another person", () => {
  const m = setup({ fixed: { night: { 5: N.slice(0, 2) } }, fixed_tags: { [`5:night|${N[0]}`]: "First", [`5:night|${N[1]}`]: "Second" } });
  const el = { dataset: { cal: "fixed", d: "5", k: "night", shown: "night" }, value: "" };
  pane("doctorPane", { '[data-cal="fixed"]': [el] }, { doctor: N[0] });
  A.readAll(); assert.strictEqual(m.fixed.night[5], N[1]); assert.deepStrictEqual(m.fixed_tags, { [`5:night|${N[1]}`]: "Second" });
});
test("explicit fixed-only proof keeps a pipe-containing staff name; day/name contact alone stays strict", () => {
  const id = "local.synthetic_delimited_check", code = "SYNTHETIC_DELIMITED_CHECK";
  let proof;
  T.rules.register({ id, api: 1, states: ["hard", "off"], defaultState: "off", label: "Synthetic name test", messages: { [code]: { en: "Synthetic {who}", ja: "Synthetic {who}" } }, check(ctx) { ctx.viol(code, { who: N[0] }, 5, N[0], proof ? proof(ctx) : undefined); } });
  const m = setup({ fixed: { night: { 5: N[0] } } }); A.state.rules.rule_states[id] = "hard";
  const P = new T.Problem(A.state.rules, m), asg = Object.fromEntries(P.slots.map(([d, k]) => [`${d}:${k}`, { work: N[0], oc: [] }]));
  let r = T.check(P, asg);
  assert.ok(r.VC.some(x => x.code === code), "a fixed name/date is not proof for an unspecified row"); assert.ok(!r.WC.some(x => x.code === code));
  // A unary ban of this exact work slot is forced by its own fixed input.
  proof = ctx => ctx.fixedWorkAt([5, "night"], N[0]); r = T.check(P, asg);
  assert.ok(r.WC.some(x => x.code === code), "explicit proof preserves the complete pipe-containing name"); assert.ok(!r.VC.some(x => x.code === code));
  proof = ctx => ctx.fixedWorkAt([5, "night"], N[1]); r = T.check(P, asg);
  assert.ok(r.VC.some(x => x.code === code), "another full name cannot borrow the fixed proof"); assert.ok(!r.WC.some(x => x.code === code));
});
// Render actual previous-connection markup and decode it using a real HTML parser.
// Only the minimal DOM selection API is substituted for readSettingsMonth.
function connectionScreen(lastDays, ocOn = true) {
  const m = setup({ prev_month: { last_days: lastDays } }); A.state.rules.profile.positions = { work: { count: 2 } }; A.state.rules.rule_states.oncall = ocOn ? "hard" : "off";
  const root = pane("monthSettings"); A.renderSettingsMonth();
  const raw = JSON.parse(execFileSync("python3", ["-c", `import json,sys
from html.parser import HTMLParser
class Rows(HTMLParser):
 def __init__(self): super().__init__(); self.rows=[]; self.row=None
 def handle_starttag(self,tag,attrs):
  a=dict(attrs)
  assert 'data-synthetic-injected' not in a, 'metadata created an HTML element or attribute'
  if tag=='tr' and 'data-ld' in a: self.row={'attrs':a,'fields':{}}; self.rows.append(self.row)
  if self.row is not None and tag=='input' and 'data-f' in a: self.row['fields'][a['data-f']]=a
 def handle_endtag(self,tag):
  if tag=='tr': self.row=None
p=Rows(); p.feed(sys.stdin.read()); print(json.dumps(p.rows))`], { input: root.innerHTML, encoding: "utf8" }));
  const dataset = attrs => Object.fromEntries(Object.entries(attrs).filter(([k]) => k.startsWith("data-")).map(([k, v]) => [k.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase()), v]));
  const rows = raw.map(row => {
    const fields = Object.fromEntries(Object.entries(row.fields).map(([k, a]) => [k, { value: a.value || "", dataset: dataset(a), hasAttribute: attr => Object.hasOwn(a, attr) }]));
    return { fields, dataset: dataset(row.attrs), querySelector: s => fields[(s.match(/^\[data-f="(.*)"\]$/) || [])[1]] || null };
  });
  root.querySelectorAll = s => s === "tr[data-ld]" ? rows : [];
  return { m, rows, html: root.innerHTML };
}
const priorDays = () => [
  { date: 29, day: N.slice(0, 2), day_oc: [N[2]], night: N.slice(1, 3), night_oc: [N[0]] }, {},
  { date: 30, day: N.slice(1, 3), day_oc: [N[0]], night: N.slice(0, 2), night_oc: [N[2]] }, {}
];
test("unchanged previous-connection reads preserve all delimited worker/OC lists", () => {
  const before = priorDays(), { m } = connectionScreen(before);
  for (let i = 0; i < 3; i++) { A.readSettingsMonth(); assert.deepStrictEqual(m.prev_month.last_days, before.filter(e => e.date)); }
});
test("previous-connection date changes preserve row-specific names, including hidden OC", () => {
  for (const ocOn of [true, false]) {
    const before = priorDays(), { m, rows } = connectionScreen(before, ocOn);
    rows[0].fields.date.value = "28"; rows[2].fields.date.value = "29";
    const expected = [{ ...before[0], date: 28 }, { ...before[2], date: 29 }];
    for (let i = 0; i < 3; i++) { A.readSettingsMonth(); assert.deepStrictEqual(m.prev_month.last_days, expected); }
  }
});
test("blank dates and repeated reads cannot remap another previous-connection row", () => {
  for (const ocOn of [true, false]) {
    const before = priorDays(), { m, rows } = connectionScreen(before, ocOn);
    rows[0].fields.date.value = "";
    for (let i = 0; i < 2; i++) { A.readSettingsMonth(); assert.deepStrictEqual(m.prev_month.last_days, [before[2]]); }
    rows[0].fields.date.value = "27";
    A.readSettingsMonth(); assert.deepStrictEqual(m.prev_month.last_days, [{ ...before[0], date: 27 }, before[2]]);
  }
});
test("explicit previous-connection list edits and clears retain the existing text grammar", () => {
  const { m, rows } = connectionScreen(priorDays());
  rows[0].fields.day.value = "Synthetic plain,Another Synthetic"; rows[0].fields.day_oc.value = "Synthetic OC";
  rows[0].fields.night.value = ""; rows[0].fields.night_oc.value = "";
  for (let i = 0; i < 2; i++) { A.readSettingsMonth(); assert.deepStrictEqual(m.prev_month.last_days[0], { date: 29, day: ["Synthetic plain", "Another Synthetic"], day_oc: ["Synthetic OC"] }); }
  rows[0].fields.day.value = ""; A.readSettingsMonth(); assert.deepStrictEqual(m.prev_month.last_days[0], { date: 29 });
});
test("clearing and replacing a worker cannot resurrect its hidden previous OC", () => {
  const { m, rows } = connectionScreen([{ date: 29, night: N.slice(0, 2), night_oc: [N[2]] }], false);
  rows[0].fields.night.value = ""; A.readSettingsMonth(); assert.deepStrictEqual(m.prev_month.last_days, [{ date: 29 }]);
  rows[0].fields.night.value = "New Synthetic";
  for (let i = 0; i < 2; i++) { A.readSettingsMonth(); assert.deepStrictEqual(m.prev_month.last_days, [{ date: 29, night: ["New Synthetic"], night_oc: [] }]); }
});
test("original previous-connection metadata remains escaped and preserves literal labels", () => {
  const label = 'Synthetic|A"><img data-synthetic-injected="yes" onerror="alert(1)">&', before = [{ date: 30, night: [label, N[0]], night_oc: [label] }];
  const { m, rows, html } = connectionScreen(before);
  assert.ok(!html.includes(label), "no raw HTML in the generated attributes");
  assert.deepStrictEqual(JSON.parse(rows[0].fields.night.dataset.prevNames), [label, N[0]]);
  A.readSettingsMonth(); assert.deepStrictEqual(m.prev_month.last_days, before);
});

// A name that is the suffix of another pipe-containing name is still a different person.
function suffixFixture(fixed = { night: { 5: "Synthetic|A" } }) {
  const names = ["Synthetic|A", "A"], rules = { profile: { id: "synthetic-suffix", roles: [{ id: "S", label: "Staff", refs: [] }], shifts: [{ id: "day", on: "none" }, { id: "night", on: "all" }] }, doctors: names.map(name => ({ name, team: "S", quota: name === "A" ? 0 : 30 })), rule_states: {}, quota_tolerance: 0 };
  T.fillDefaultRules(rules); for (const def of T.RULE_DEFS) if (def.states.includes("off")) rules.rule_states[def.id] = "off";
  rules.rule_states.quota_range = "hard";
  const month = T.normalizeMonth({ year: 2026, month: 11, fixed: clone(fixed), count_min: { "Synthetic|A": 0, A: 0 }, count_max: { "Synthetic|A": 30, A: 0 } }, rules);
  return new T.Problem(rules, month);
}
test("fixed counts and engagement do not belong to another person's name suffix", () => {
  const P = suffixFixture();
  assert.strictEqual(P.hasFixedEng("A"), false); assert.strictEqual(P.fixedWorkCount("A"), 0);
  assert.strictEqual(P.hasFixedEng("Synthetic|A"), true); assert.strictEqual(P.fixedWorkCount("Synthetic|A"), 1);
  const Q = suffixFixture({ night: { 5: "Synthetic|A", 6: "A" }, night_oc: { 7: ["Synthetic|A"] } });
  assert.strictEqual(Q.fixedWorkCount("A"), 1); assert.strictEqual(Q.fixedWorkCount("Synthetic|A"), 1);
  assert.strictEqual(Q.hasFixedEng("A"), true); assert.strictEqual(Q.hasFixedEng("Synthetic|A"), true);
});
test("quota exception evidence lists only the exact person's fixed dates and count", () => {
  const P = suffixFixture({ night: { 5: "Synthetic|A", 6: "A" } }), seen = [];
  T.RULE_BY_ID.quota_range.check({ P, names: ["A"], worked: (n, s) => s[0] === 6, viol: (...args) => seen.push(args) }, { tol: 0 });
  assert.strictEqual(seen.length, 1); assert.strictEqual(seen[0][0], "COUNT_LIMIT_OVER_BY_FIXED");
  assert.deepStrictEqual(seen[0][2], [6], "do not cite the other person's fixed day"); assert.strictEqual(seen[0][1].fixed, 1);
});
(async () => {
  if (process.argv[2]) {
    const highs = await require(process.argv[2])();
    test("pinned solve/check cannot borrow another person's fixed-work quota exception", () => {
      const P = suffixFixture(), pin = Object.fromEntries(P.slots.map(([d, k]) => [`${d}:${k}`, { work: d === 6 ? "A" : "Synthetic|A", oc: [] }]));
      assert.strictEqual(T.solve(P, highs, { pin, timeLimit: 5, mipGap: 0 }).status, "Infeasible", "A has a zero maximum and no actual fixed work");
      const violations = T.check(P, pin).VC.filter(x => x.code === "COUNT_OUT_OF_LIMIT" && x.args.who === "A");
      assert.strictEqual(violations.length, 1); assert.strictEqual(violations[0].args.total, 1); assert.strictEqual(violations[0].args.hi, 0);
      pin["6:night"].work = "Synthetic|A";
      const valid = T.solve(P, highs, { pin, timeLimit: 5, mipGap: 0 });
      assert.strictEqual(valid.status, "Optimal"); assert.strictEqual(valid.objective, 0); assert.strictEqual(T.penalty(P, valid.asg).total, 0); assert.strictEqual(T.check(P, valid.asg).V.length, 0);
    });
  } else console.log("SKIP pinned suffix-name solve/check (pass path/to/highs)");
  console.log(`delimited staff names: ${passed} passed, ${failed} failed`); if (failed) process.exitCode = 1;
})().catch(e => { console.error(e); process.exitCode = 1; });

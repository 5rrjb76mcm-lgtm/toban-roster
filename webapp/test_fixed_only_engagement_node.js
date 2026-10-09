// Fixed-input exceptions must prove the affected work/OC/engagement literal.
// All names, duties and assignments in these regressions are synthetic.
// node test_fixed_only_engagement_node.js <highs package path>
const fs = require("fs"), vm = require("vm"), path = require("path"), assert = require("assert");
globalThis.T = {};
for (const f of ["i18n.js", "rules-core.js", "model.js", "messages.js", "solver.js", "check.js"])
  vm.runInThisContext(fs.readFileSync(path.join(__dirname, "src", f), "utf8"), { filename: f });
for (const dir of ["rules", "calendars"]) for (const f of fs.readdirSync(path.join(__dirname, "src", dir)).filter(f => f.endsWith(".js")).sort())
  vm.runInThisContext(fs.readFileSync(path.join(__dirname, "src", dir, f), "utf8"), { filename: dir + "/" + f });
T.DEFAULT_RULES = JSON.parse(fs.readFileSync(path.join(__dirname, "data/rules.json"), "utf8"));
const A = "Synthetic Charge A", B = "Synthetic Charge B", C = "Synthetic Worker C";
const clone = value => JSON.parse(JSON.stringify(value));
function fixture(o = {}) {
  const R = clone(T.DEFAULT_RULES);
  R.profile = { id: "synthetic-fixed-engagement", calendar: { holidays: "none", closure: [] },
    roles: [{ id: "Q", label: "Charge", refs: ["charge"], standby: true }, { id: "W", label: "Worker", refs: [] }],
    shifts: [{ id: "day", on: o.day || "all" }, { id: "night", on: "all" }] };
  R.doctors = [{ name: A, team: "Q", quota: 0 }, { name: B, team: "Q", quota: 0 }, { name: C, team: "W", quota: 0 }];
  R.name_order = [A, B, C]; R.friday_night_min = {}; R.weekend_dayshift_wish = [];
  R.oncall_requirement = { Q: { Q: 0 }, W: { Q: 1 } };
  R.rule_states = Object.fromEntries(T.RULE_DEFS.map(d => [d.id, "off"]));
  Object.assign(R.rule_states, { oncall: "hard", period_charge: o.charge === false ? "off" : "hard", duty_conflicts: o.duty === false ? "off" : "hard" });
  R.weights = Object.fromEntries(Object.keys(R.weights).map(k => [k, 0])); R.weights.fixed_conflict = 50;
  T.fillDefaultRules(R);
  const m = T.normalizeMonth({ year: 2026, month: 11, holidays: [], next_first_day_in_calendar: true,
    fixed: clone(o.fixed || {}), duty_days: { [A]: clone(o.duties || {}) },
    unavailable_other: clone(o.unavailable || []), unavailable_night: clone(o.unavailableNight || {}) }, R);
  const before = JSON.stringify({ R, m }), P = new T.Problem(R, m);
  const asg = Object.fromEntries(P.slots.map(([d, k]) => [`${d}:${k}`, { work: B, oc: [] }]));
  return { P, R, m, before, asg };
}
const put = (f, d, k, work = false) => { f.asg[`${d}:${k}`] = work ? { work: A, oc: [] } : { work: C, oc: [A] }; return f; };
const codeCount = (xs, code) => xs.filter(x => x.code === code).length;
let passed = 0;
(async () => {
  assert(process.argv[2], "An existing highs package path is required");
  const highs = await require(process.argv[2])();
  function solve(f, opts = {}) { return T.solve(f.P, highs, { pin: f.asg, timeLimit: 5, mipGap: 0, ...opts }); }
  function immutable(f) { assert.strictEqual(JSON.stringify({ R: f.R, m: f.m }), f.before, "Do not modify saved input"); }
  function test(label, fn) { fn(); passed++; console.log("ok   " + label); }
  function tolerated(f, code) {
    const c = T.check(f.P, f.asg), r = solve(f), p = T.penalty(f.P, f.asg);
    assert.deepStrictEqual(c.V, [], c.V.join(" / ")); assert.strictEqual(codeCount(c.WC, code), 1);
    assert.strictEqual(r.status, "Optimal"); assert.strictEqual(r.objective, p.total); immutable(f);
  }
  function rejected(f, code) {
    const c = T.check(f.P, f.asg); assert.strictEqual(codeCount(c.VC, code), 1); assert.strictEqual(codeCount(c.WC, code), 0);
    assert.strictEqual(solve(f).status, "Infeasible"); immutable(f);
  }
  test("fixed charge engagement does not permit discretionary day OC when work avoids the conflict", () => {
    const f = put(fixture({ fixed: { weekend_charge: { 7: A } }, duties: { 7: { pm: "external" } } }), 7, "day");
    rejected(f, "PM_EXT_DAY_OC");
    put(f, 7, "day", true); assert.strictEqual(solve(f).status, "Optimal"); assert.deepStrictEqual(T.check(f.P, f.asg).V, []);
    const free = solve(f, { pin: undefined }); assert.strictEqual(free.status, "Optimal");
    assert.strictEqual(free.asg["7:day"].work, A); assert.ok(!free.asg["7:day"].oc.includes(A)); immutable(f);
  });
  test("an explicit fixed day OC retains the unavoidable duty conflict", () => {
    tolerated(put(fixture({ fixed: { day_oc: { 7: [A] } }, duties: { 7: { pm: "external" } } }), 7, "day"), "PM_EXT_DAY_OC");
  });
  test("fixed OC on another day does not excuse optional day OC", () => {
    const f = fixture({ fixed: { day_oc: { 8: [A] } }, duties: { 7: { pm: "external" } } }); put(f, 8, "day"); put(f, 7, "day"); rejected(f, "PM_EXT_DAY_OC");
  });
  test("same-slot explicit fixed work does not falsely classify a substituted OC assignment", () => {
    const f = put(fixture({ fixed: { day: { 7: A } }, duties: { 7: { pm: "external" } } }), 7, "day");
    rejected(f, "PM_EXT_DAY_OC"); assert.ok(T.check(f.P, f.asg).VC.some(v => v.code === "FIXED_MISMATCH"));
  });
  test("fixed night OC and fixed night work retain their own next-morning conflicts", () => {
    tolerated(put(fixture({ fixed: { night_oc: { 7: [A] } }, duties: { 8: { am: "external" } } }), 7, "night"), "NIGHT_OC_THEN_EXTERNAL");
    tolerated(put(fixture({ fixed: { night: { 7: A } }, duties: { 8: { am: "external" } } }), 7, "night", true), "NIGHT_THEN_DUTY");
  });
  test("unavailability forbids engagement, so a fixed charge legitimately tolerates work or OC", () => {
    for (const work of [false, true]) tolerated(put(fixture({ fixed: { weekend_charge: { 7: A } }, duty: false,
      unavailable: [{ name: A, day: 7, part: "day" }] }), 7, "day", work), "UNAVAIL_DAY");
  });
  test("fixed charge on the first slot cannot waive unavailability on a later slot", () => {
    const f = fixture({ fixed: { weekend_charge: { 7: A } }, duty: false, unavailableNight: { [A]: [7] } });
    put(f, 7, "day", true); put(f, 7, "night"); rejected(f, "UNAVAIL_NIGHT");
  });
  test("disabled period-charge input cannot waive day unavailability", () => {
    rejected(put(fixture({ fixed: { weekend_charge: { 7: A } }, charge: false, duty: false,
      unavailable: [{ name: A, day: 7, part: "day" }] }), 7, "day"), "UNAVAIL_DAY");
  });
  test("diagnostically relaxed fixed charge is no longer proof for unavailability", () => {
    const f = put(fixture({ fixed: { weekend_charge: { 7: A } }, duty: false,
      unavailable: [{ name: A, day: 7, part: "day" }] }), 7, "day");
    for (const relax of [["fixed"], ["fixed:charge:7"], ["charge"]]) assert.strictEqual(solve(f, { relax }).status, "Infeasible", relax.join());
    immutable(f);
  });
  test("diagnostically relaxed explicit OC is no longer proof for a duty conflict", () => {
    const f = put(fixture({ fixed: { day_oc: { 7: [A] } }, duties: { 7: { pm: "external" } } }), 7, "day");
    for (const relax of [["fixed"], ["fixed:dayoc:7"]]) assert.strictEqual(solve(f, { relax }).status, "Infeasible", relax.join());
    immutable(f);
  });
  test("inactive fixed OC input is preserved and cannot excuse an active forbidden OC", () => {
    const f = put(fixture({ day: "none", fixed: { day_oc: { 7: [A] } }, duties: { 8: { am: "external" } } }), 7, "night");
    rejected(f, "NIGHT_OC_THEN_EXTERNAL"); assert.deepStrictEqual(f.m.fixed.day_oc[7], [A]);
  });
  console.log(`${passed} fixed-engagement tests passed`);
})().catch(e => { console.error("FAIL", e.stack); process.exitCode = 1; });

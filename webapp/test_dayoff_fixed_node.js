// Disabled period-charge assignments must not waive a hard holiday-weekday cap.
// Synthetic data only. node test_dayoff_fixed_node.js <highs package>
const fs = require("fs"), vm = require("vm"), path = require("path"), assert = require("assert");
globalThis.T = {};
for (const f of ["i18n.js", "rules-core.js", "model.js", "messages.js", "solver.js", "check.js"])
  vm.runInThisContext(fs.readFileSync(path.join(__dirname, "src", f), "utf8"), { filename: f });
for (const dir of ["rules", "calendars"]) for (const f of fs.readdirSync(path.join(__dirname, "src", dir)).filter(x => x.endsWith(".js")).sort())
  vm.runInThisContext(fs.readFileSync(path.join(__dirname, "src", dir, f), "utf8"), { filename: dir + "/" + f });
T.DEFAULT_RULES = JSON.parse(fs.readFileSync(path.join(__dirname, "data/rules.json"), "utf8"));
const clone = x => JSON.parse(JSON.stringify(x)), NAME = "Fictional Charge A", WORKER = "Fictional Worker B", WORKER2 = "Fictional Worker C", CODE = "DAYOFF_WEEKDAY_OVER", sundays = [1, 8, 15, 22, 29];
function fixture({ state = "hard", workFixed = [], ocFixed = [], stale = true, oncall = false } = {}) {
  const R = clone(T.DEFAULT_RULES);
  R.profile = { id: "dayoff-fixed-test", shifts: [{ id: "day", on: "none" }, { id: "night", on: "all" }],
    roles: [{ id: "Q", label: "Charge", refs: ["charge"], standby: true }, { id: "W", label: "Worker", refs: [] }] };
  R.doctors = [{ name: NAME, team: "Q", quota: 30 }];
  if (oncall) R.doctors.push({ name: WORKER, team: "W", quota: 30 }, { name: WORKER2, team: "W", quota: 30 });
  R.name_order = R.doctors.map(d => d.name); R.friday_night_min = {}; R.weekend_dayshift_wish = [];
  R.rule_states = Object.fromEntries(T.RULE_DEFS.map(d => [d.id, "off"]));
  R.rule_states.dayoff_weekday_cap = state; R.rule_states.oncall = oncall ? "hard" : "off";
  R.dayoff_weekday_max = 4;
  R.oncall_requirement = { Q: { Q: 0 }, W: { Q: 1 } };
  R.weights = Object.fromEntries(Object.keys(R.weights).map(k => [k, 0])); R.weights.fixed_conflict = 50; R.weights.dayoff_weekday_excess = 20;
  T.fillDefaultRules(R);
  const M = T.normalizeMonth({ year: 2026, month: 11, holidays: [], fixed: {
    weekend_charge: stale ? Object.fromEntries(sundays.map(d => [d, NAME])) : {},
    night: Object.fromEntries(workFixed.map(d => [d, NAME])), night_oc: Object.fromEntries(ocFixed.map(d => [d, [NAME]])) } }, R);
  const P = new T.Problem(R, M), asg = Object.fromEntries(P.slots.map(([d, k]) => [`${d}:${k}`, { work: oncall ? (d % 2 ? WORKER : WORKER2) : NAME, oc: oncall ? [NAME] : [] }]));
  return { P, asg };
}
let passed = 0;
async function test(label, fn) { await fn(); passed++; console.log("ok   " + label); }
(async () => {
  assert(process.argv[2], "highs package path is required"); const highs = await require(process.argv[2])();
  await test("disabled charge assignments cannot make an infeasible hard cap feasible", async () => {
    for (const stale of [false, true]) { const { P } = fixture({ stale }); assert.strictEqual((await T.solve(P, highs, { timeLimit: 5 })).status, "Infeasible"); }
  });
  await test("disabled charge assignments remain violations, with no fixed-conflict penalty", async () => {
    const { P, asg } = fixture(), c = T.check(P, asg), p = T.penalty(P, asg);
    assert.strictEqual(c.VC.filter(v => v.code === CODE).length, 1); assert.strictEqual(c.WC.length, 0); assert.strictEqual(p.items.fixed_conflict || 0, 0);
  });
  await test("four genuine fixed days plus a stale fifth charge do not waive the cap", async () => {
    const { P, asg } = fixture({ workFixed: sundays.slice(0, 4) });
    assert.strictEqual((await T.solve(P, highs, { timeLimit: 5 })).status, "Infeasible"); assert(T.check(P, asg).VC.some(v => v.code === CODE));
  });
  await test("five genuine fixed work days retain the fixed-conflict exception", async () => {
    const { P } = fixture({ workFixed: sundays }), r = await T.solve(P, highs, { timeLimit: 5 }); assert.strictEqual(r.status, "Optimal");
    const c = T.check(P, r.asg), p = T.penalty(P, r.asg); assert.strictEqual(c.VC.length, 0); assert.strictEqual(c.WC.filter(v => v.code === CODE).length, 1); assert.strictEqual(p.items.fixed_conflict, 50); assert.strictEqual(r.objective, p.total);
  });
  await test("genuine fixed on-call days also retain the exception", async () => {
    const { P, asg } = fixture({ oncall: true, ocFixed: sundays }), c = T.check(P, asg), p = T.penalty(P, asg);
    const r = await T.solve(P, highs, { pin: asg, timeLimit: 5 }); assert.strictEqual(r.status, "Optimal");
    assert.strictEqual(c.VC.length, 0); assert(c.WC.some(v => v.code === CODE && v.args.who === NAME)); assert.strictEqual(p.items.fixed_conflict, 50); assert.strictEqual(r.objective, p.total);
  });
  await test("soft state counts the same excess whether stale charge assignments remain or not", async () => {
    for (const stale of [false, true]) { const { P, asg } = fixture({ state: "soft", stale }), r = await T.solve(P, highs, { timeLimit: 5 });
      assert.strictEqual(r.status, "Optimal"); assert.strictEqual(T.penalty(P, asg).items.dayoff_weekday_excess, 20); assert.strictEqual(r.objective, 20); }
  });
  console.log(`${passed} tests passed`);
})().catch(e => { console.error("FAIL", e.stack); process.exitCode = 1; });

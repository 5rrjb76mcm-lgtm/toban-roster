// Charge-role OC adjacency is exempt throughout the same weekend, including a night-first next month.
// Synthetic data only. node test_oc_period_boundary_node.js <path/to/highs>
// Set TOBAN_WEBAPP_ROOT to an unchanged checkout's webapp directory to reproduce the regression.
const fs = require("fs"), vm = require("vm"), path = require("path"), assert = require("assert/strict");
const root = process.env.TOBAN_WEBAPP_ROOT || __dirname;
globalThis.T = {};
const run = f => vm.runInThisContext(fs.readFileSync(path.join(root, "src", f), "utf8"), { filename: f });
for (const f of ["i18n.js", "rules-core.js", "model.js", "messages.js", "solver.js", "check.js"]) run(f);
for (const f of fs.readdirSync(path.join(root, "src/rules")).filter(f => f.endsWith(".js")).sort()) run("rules/" + f);
T.DEFAULT_RULES = JSON.parse(fs.readFileSync(path.join(root, "data/rules.json"), "utf8"));
const [alpha, beta, staff] = ["Synthetic Alpha", "Synthetic Beta", "Synthetic Staff"];

function fixture({ day = "none", night = "all", month = 10, boundary = "next", a = "O", b = "O", charge = true, explicit = false, nextKind }) {
  const R = {
    profile: { id: "synthetic-oc-period-boundary", roles: [
      { id: "I", label: "Charge", refs: charge ? ["charge"] : [], standby: true },
      { id: "S", label: "Staff", refs: [], standby: false },
      { id: "Y", label: "Junior", refs: ["junior"], standby: false },
    ], shifts: [{ id: "day", on: day }, { id: "night", on: night }], positions: { work: { count: 1 } } },
    doctors: [{ name: alpha, team: "I" }, { name: beta, team: "I" }, { name: staff, team: "S" }].map(d => ({ ...d, quota: 0 })),
    oncall_requirement: { I: { I: 0 }, S: { I: 1 }, Y: { I: 0 } },
    rule_states: Object.assign(Object.fromEntries(T.RULE_DEFS.map(d => [d.id, "off"])), { oncall: "hard", period_charge: charge ? "hard" : "off", oc_consecutive: "soft" }),
    weights: {},
  };
  T.fillDefaultRules(R); for (const k in R.weights) R.weights[k] = 0; R.weights.oc_consecutive = 6;
  const M = T.normalizeMonth({ year: 2026, month, holidays: [] }, R), initial = new T.Problem(R, M);
  const asg = Object.fromEntries(initial.slots.map(s => [T.Problem.key(s), { work: beta, oc: [] }]));
  const entry = mode => mode === "W" ? { work: alpha, oc: [] } : { work: staff, oc: [alpha] };
  const put = (d, k, mode) => { assert.ok(initial.slotExists(d, k)); asg[`${d}:${k}`] = entry(mode); };
  if (boundary === "month") { // 2026-10-24/25 is a complete weekend inside the month.
    put(24, "night", a); put(25, "night", b);
  } else if (boundary === "prev") { // 2026-10-31/11-1 is the same weekend viewed from November.
    const e = entry(a); M.prev_month.last_days = [{ date: 31, night: e.work, night_oc: e.oc }]; put(1, "night", b);
  } else {
    // Keep the current day's first-slot charge consistent when a day slot exists.
    if (charge && initial.slotExists(initial.N, "day")) put(initial.N, "day", a);
    put(initial.N, "night", a);
    const kind = nextKind || initial.nextFirstSlotKind(), e = entry(b);
    if (explicit) M.fixed.weekend_charge[initial.N + 1] = alpha;
    else { M.fixed[kind][initial.N + 1] = e.work; M.fixed[kind + "_oc"][initial.N + 1] = e.oc; }
  }
  return { P: new T.Problem(R, M), asg };
}

let passed = 0, failed = 0;
(async () => {
  const highs = await require(process.argv[2] || "highs")();
  const test = (label, opts, want, inspect) => {
    try {
      const { P, asg } = fixture(opts); if (inspect) inspect(P);
      assert.deepEqual(T.lint(P), [], "input lint"); assert.deepEqual(T.check(P, asg).VC, [], "independent checker");
      const solved = T.solve(P, highs, { pin: asg, timeLimit: 10, mipGap: 0 }), penalty = T.penalty(P, asg);
      assert.equal(solved.status, "Optimal"); assert.ok(solved.asg);
      assert.equal(solved.objective, penalty.total, "solver/penalty agreement");
      assert.equal(penalty.total, want, `rule expectation: got ${penalty.total}, expected ${want}`);
      passed++; console.log("PASS", label);
    } catch (e) { failed++; console.error("FAIL", label, e.message); }
  };
  const modes = ["W", "O"];
  for (const day of ["none", "weekdays"]) for (const a of modes) for (const b of modes)
    test(`${day} day slots: crossing weekend ${a}->${b} is exempt`, { day, a, b }, 0, P => {
      assert.equal(P.nextFirstSlotKind(), "night"); assert.ok(P.nextSlotExists("night")); assert.ok(P.lastCrossingPeriod());
    });
  for (const boundary of ["month", "prev"]) for (const a of modes) for (const b of modes)
    test(`${boundary} weekend ${a}->${b} stays exempt`, { boundary, month: boundary === "prev" ? 11 : 10, a, b }, 0);
  for (const day of ["all", "off_days"]) for (const a of modes) for (const b of modes)
    test(`${day} day slots: day-first crossing ${a}->${b} stays exempt`, { day, a, b }, 0, P => assert.equal(P.nextFirstSlotKind(), "day"));
  for (const a of modes) test(`explicit next charge after ${a} is exempt without a day slot`, { a, explicit: true }, 0);
  for (const a of modes) for (const b of modes) {
    const want = a === "W" && b === "W" ? 0 : 6;
    test(`non-crossing ${a}->${b} still counts OC adjacency`, { month: 8, a, b }, want, P => assert.equal(P.lastCrossingPeriod(), null));
    test(`non-charge crossing ${a}->${b} still counts OC adjacency`, { charge: false, a, b }, want);
  }
  // 2026-07-31 is Friday and 8/1 is Saturday. Stale fixed values for absent next slots do not create adjacency.
  for (const a of modes) for (const b of modes)
    test(`no next slots: stale night ${a}->${b} adds no penalty`, { month: 7, day: "weekdays", night: "weekdays", charge: false, a, b }, 0, P => {
      assert.equal(P.nextSlotExists("day"), false); assert.equal(P.nextSlotExists("night"), false);
    });
  test("next day exists but absent next night adds no second adjacency", { month: 7, day: "all", night: "weekdays", charge: false, nextKind: "night" }, 0, P => {
    assert.equal(P.nextSlotExists("day"), true); assert.equal(P.nextSlotExists("night"), false);
  });
  console.log(`OC period boundary: ${passed} passed, ${failed} failed`); process.exitCode = failed ? 1 : 0;
})().catch(e => { console.error(e); process.exitCode = 1; });

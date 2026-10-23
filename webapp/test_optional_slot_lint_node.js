// Optional staffing must not be labelled a missing compulsory worker.
// Synthetic fixtures only. Authored for later local validation; not run during the audit.
// node test_optional_slot_lint_node.js /path/to/highs [pristine-webapp-directory]
const fs = require("fs"), vm = require("vm"), path = require("path"), assert = require("assert");
const EXPECTED = 18;
let registered = 0, started = 0, completed = 0, passed = 0, finished = false;
const counts = () => ({ registered, started, completed, passed });
process.on("exit", code => {
  if (code === 0 && (!finished || Object.values(counts()).some(n => n !== EXPECTED))) {
    console.error("FAIL incomplete optional-slot regression:", counts());
    process.exitCode = 1;
  }
});
const watchdog = setTimeout(() => {
  console.error("FAIL optional-slot regression exceeded 180 seconds:", counts());
  process.exit(1);
}, 180000);
watchdog.unref(); // An unresolved promise with no live handles must fail via the exit guard.
const source = process.argv[3] || __dirname;
globalThis.T = {};
for (const file of ["i18n.js", "rules-core.js", "model.js", "messages.js", "solver.js", "check.js"])
  vm.runInThisContext(fs.readFileSync(path.join(source, "src", file), "utf8"), { filename: file });
for (const file of fs.readdirSync(path.join(source, "src/rules")).filter(f => f.endsWith(".js")).sort())
  vm.runInThisContext(fs.readFileSync(path.join(source, "src/rules", file), "utf8"), { filename: "rules/" + file });
T.DEFAULT_RULES = JSON.parse(fs.readFileSync(path.join(source, "data/rules.json"), "utf8"));
const A = "Synthetic Optional A", B = "Synthetic Optional B", NO = "LINT_SLOT_NO_CANDIDATE";
function problem({ kind = "night", work = { count: 1, min: 0 }, states = {}, fixed = {},
  allUnavailable = false, quota = 0, composition = [] } = {}) {
  const R = {
    profile: { id: "synthetic-optional-slot", roles: [{ id: "Staff", label: "Staff", refs: [], standby: false }],
      shifts: [{ id: "day", on: kind === "day" ? "all" : "none" }, { id: "night", on: "all" }],
      positions: { work } },
    doctors: [A, B].map(name => ({ name, team: "Staff", quota })), quota_tolerance: 0,
    composition, weights: { fixed_conflict: 1000, count_deviation: 1 }, rule_states: {}
  };
  T.fillDefaultRules(R);
  for (const def of T.RULE_DEFS) if (def.states.includes("off")) R.rule_states[def.id] = "off";
  Object.assign(R.rule_states, states);
  const days = allUnavailable ? Array.from({ length: 30 }, (_, i) => i + 1) : [1];
  const month = T.normalizeMonth({ year: 2026, month: 11, holidays: [], fixed,
    unavailable_night: kind === "night" ? { [A]: days, [B]: days } : {},
    unavailable_other: kind === "day" ? [A, B].flatMap(name => days.map(day => ({ name, day, part: "day" }))) : []
  }, R);
  return new T.Problem(R, month);
}
const codes = P => T.lint(P).map(x => x.code);
const cases = [];
for (const kind of ["day", "night"]) {
  for (const work of [{ count: 0 }, { count: 1, min: 0 }, { count: 2, min: 0 }])
    cases.push([`${kind}: zero lower bound ${JSON.stringify(work)}`, { kind, work }, "Optimal", [], 0]);
  for (const work of [{ count: 1 }, { count: 2, min: 1 }])
    cases.push([`${kind}: positive lower bound keeps warning`, { kind, work }, "Infeasible", [NO]]);
  cases.push([`${kind}: ideal staffing is soft`, { kind, work: { count: 1, min: 0, ideal: 1 },
    states: { count_target: "soft" } }, "Optimal", [], 1]);
  cases.push([`${kind}: zero-capacity fixed input still warned`, { kind, work: { count: 0 },
    fixed: { [kind]: { 1: A } } }, "Infeasible", ["LINT_FIXED_OVER_COUNT", "LINT_FIXED_VS_UNAVAIL"]]);
  cases.push([`${kind}: optional-slot unknown fixed input still warned`, { kind,
    fixed: { [kind]: { 1: "Synthetic Missing" } } }, null, ["LINT_MONTH_UNKNOWN_NAMES", "LINT_FIXED_NOT_CANDIDATE"]]);
}
cases.push(["hard per-person lower bound still detects a shortage", {
  allUnavailable: true, quota: 1, states: { quota_range: "hard" }
}, "Infeasible", ["LINT_PERSON_TOO_FEW_SLOTS", "LINT_PERSON_TOO_FEW_SLOTS"]]);
cases.push(["separate hard composition can still make an optional slot infeasible", {
  states: { composition: "hard" }, composition: [{ shift: "night", min: 1 }]
}, "Infeasible", []]);
registered = cases.length;
(async () => {
  assert.strictEqual(registered, EXPECTED, "registered optional-slot cases");
  assert(process.argv[2], "Pass an existing HiGHS package path; this script installs nothing");
  const highs = await require(process.argv[2])();
  for (const [label, opts, status, expectedCodes, objective] of cases) {
    started++;
    try {
      const P = problem(opts), before = JSON.stringify({ rules: P.rules, month: P.m });
      const lint = codes(P);
      assert.deepStrictEqual(lint, expectedCodes, label + ": precise diagnostics");
      // An unknown fixed name is a lint-preservation control only. This patch does
      // not change how the model handles input whose person is absent from its variables.
      const result = status == null ? null : T.solve(P, highs, { timeLimit: 5, mipGap: 0 });
      if (status != null) {
        assert(result, label + ": solver result is required");
        assert.strictEqual(result.status, status, label);
        if (status === "Optimal") assert(result.asg, label + ": optimal result must include an assignment");
      }
      if (result && result.asg) {
        const checked = T.check(P, result.asg);
        assert.deepStrictEqual(checked.VC, [], label + ": required check");
        assert.deepStrictEqual(checked.WC, [], label + ": no tolerated conflict");
        assert.strictEqual(checked.A.workers([1, opts.kind || "night"]).length, 0, label + ": optional slot stays empty");
        if (objective != null) {
          assert.strictEqual(result.objective, objective, label + ": solver score");
          assert.strictEqual(T.penalty(P, result.asg).total, objective, label + ": independent score");
        }
      }
      assert.strictEqual(JSON.stringify({ rules: P.rules, month: P.m }), before, label + ": inputs preserved");
      passed++; console.log("ok " + label);
    } finally { completed++; }
  }
  assert.deepStrictEqual(counts(), { registered: EXPECTED, started: EXPECTED, completed: EXPECTED, passed: EXPECTED });
  finished = true; clearTimeout(watchdog);
  console.log(`${passed} optional-slot diagnostic cases passed`, counts());
})().catch(error => { clearTimeout(watchdog); console.error(error, counts()); process.exitCode = 1; });

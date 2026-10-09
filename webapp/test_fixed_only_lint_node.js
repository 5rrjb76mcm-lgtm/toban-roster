// fixed_only の容量・目安診断を実HiGHSと比較。架空データのみ。
// node test_fixed_only_lint_node.js <highs パッケージのパス>
const fs = require("fs"), vm = require("vm"), path = require("path"), assert = require("assert");
globalThis.T = {};
for (const f of ["i18n.js", "rules-core.js", "model.js", "messages.js", "solver.js", "check.js"])
  vm.runInThisContext(fs.readFileSync(path.join(__dirname, "src", f), "utf8"), { filename: f });
for (const f of fs.readdirSync(path.join(__dirname, "src/rules")).filter(f => f.endsWith(".js")))
  vm.runInThisContext(fs.readFileSync(path.join(__dirname, "src/rules", f), "utf8"), { filename: "rules/" + f });
const highsPath = process.argv[2];
if (!highsPath) { console.log("（highs のパス指定が無いので、固定限定者の入力チェックの試験は省略）"); process.exit(0); }
const A = "Synthetic Fixed", B = "Synthetic Staff", allDays = Array.from({ length: 28 }, (_, i) => i + 1);
function problem({ quotaA = 0, quotaB = 28, fixed = [], oc = [], next = false, absentDay = false,
  state = "hard", reserve = false, allow = false, oncall = false, unavailable = [],
  dayAll = false, duty = "fixed_only" } = {}) {
  const R = {
    profile: { id: "synthetic-fixed-lint", roles: [
      { id: "Fixed", label: "Fixed", refs: reserve ? ["reserve"] : [], standby: oncall },
      { id: "Staff", label: "Staff", refs: [], standby: false },
      { id: "Junior", label: "Junior", refs: ["junior"], standby: false }
    ], shifts: [{ id: "day", on: dayAll ? "all" : "none" }, { id: "night", on: "all" }] },
    doctors: [{ name: A, team: "Fixed", duty, quota: quotaA }, { name: B, team: "Staff", quota: quotaB }],
    quota_tolerance: 0, oncall_requirement: { Fixed: { Fixed: 0 }, Staff: { Fixed: 1 } },
    weights: { chief_duty: 100, missing_young_oc: 0, fixed_conflict: 1000 }, rule_states: {}
  };
  T.fillDefaultRules(R);
  for (const d of T.RULE_DEFS) if (d.states.includes("off")) R.rule_states[d.id] = "off";
  Object.assign(R.rule_states, { quota_range: "hard", fixed_only: state, oncall: oncall ? "hard" : "off" });
  const night = Object.fromEntries(fixed.map(d => [d, A])); if (next) night[29] = A;
  return new T.Problem(R, T.normalizeMonth({ year: 2026, month: 2, holidays: [], allow_chief_duty: allow,
    unavailable_night: { [B]: unavailable }, fixed: { night, day: absentDay ? { 1: A } : {},
      night_oc: Object.fromEntries(oc.map(d => [d, [A]])) } }, R));
}
const EMPTY = "LINT_FIXED_ONLY_EMPTY", HIGH = "LINT_CAPACITY_HIGH", LOW = "LINT_CAPACITY_LOW";
// label / options / solve / lint / 2日の夜勤候補 / 有効な当月固定枠数
const scenarios = [
  ["hard/no-fixed/quota99", { quotaA: 99 }, "Optimal", [EMPTY], false, 0],
  ["hard/no-fixed/insufficient-capacity", { quotaA: 1, quotaB: 27 }, "Infeasible", [HIGH, EMPTY], false, 0],
  ["hard/one-fixed/quota0", { quotaA: 0, quotaB: 27, fixed: [1] }, "Optimal", [], false, 1],
  ["hard/one-fixed/quota99", { quotaA: 99, quotaB: 27, fixed: [1] }, "Optimal", [], false, 1],
  ["hard/unfixed-day-has-no-worker", { quotaA: 1, quotaB: 27, fixed: [1], unavailable: [2] }, "Infeasible", ["LINT_SLOT_NO_CANDIDATE"], false, 1],
  ["off/no-fixed/quota0", { state: "off", quotaA: 0, quotaB: 27 }, "Optimal", [], true, 0],
  ["off/no-fixed/quota99", { state: "off", quotaA: 99, quotaB: 0 }, "Optimal", [], true, 0],
  ["hard/reserve/no-fixed", { reserve: true, allow: true, quotaA: 99, quotaB: 27 }, "Infeasible", [HIGH, EMPTY], false, 0],
  ["hard/reserve/one-fixed", { reserve: true, allow: true, quotaA: 99, quotaB: 27, fixed: [1] }, "Optimal", [], false, 1],
  ["off/reserve/no-fixed", { reserve: true, allow: true, state: "off", quotaA: 99, quotaB: 27 }, "Optimal", [], true, 0],
  ["off/reserve/no-permission", { reserve: true, state: "off", quotaA: 99 }, "Optimal", [], false, 0],
  ["hard/OC-only/no-work-capacity", { quotaA: 1, quotaB: 27, oncall: true, oc: allDays }, "Infeasible", [HIGH, EMPTY], false, 0],
  ["hard/OC-only/normal-staff-fills-work", { quotaA: 0, oncall: true, oc: allDays }, "Optimal", [EMPTY], false, 0],
  ["hard/next-month-only/no-work-capacity", { quotaA: 1, quotaB: 27, next: true }, "Infeasible", [HIGH, EMPTY], false, 0],
  ["hard/current-and-next-month", { quotaA: 0, quotaB: 27, fixed: [1], next: true }, "Optimal", [], false, 1],
  ["hard/nonexistent-day-fixed/no-work-capacity", { quotaA: 0, quotaB: 27, absentDay: true }, "Infeasible", ["LINT_FIXED_NO_SLOT", HIGH, EMPTY], false, 0],
  ["hard/day-and-night-count-as-two-slots", { quotaA: 0, quotaB: 54, fixed: [1], absentDay: true, dayAll: true }, "Optimal", [], false, 2],
  ["hard/two-fixed-shifts", { quotaA: 0, quotaB: 26, fixed: [1, 2] }, "Optimal", [], true, 2],
  ["hard/reserve-still-limited-to-one", { reserve: true, allow: true, quotaA: 0, quotaB: 26, fixed: [1, 2] }, "Infeasible", [HIGH], true, 2],
  ["off/two-fixed-shifts-still-force-a-lower-bound", { state: "off", quotaA: 0, quotaB: 27, fixed: [1, 2] }, "Infeasible", [LOW], true, 2],
  ["ordinary-worker-retains-quota-over-warning", { duty: "yes", quotaA: 0, quotaB: 27, fixed: [1] }, "Optimal", ["LINT_FIXED_OVER_QUOTA"], true, 1],
  ["ordinary-worker-retains-quota-lower-bound", { duty: "yes", quotaA: 29, quotaB: 0 }, "Infeasible", [LOW, "LINT_PERSON_TOO_FEW_SLOTS"], true, 0]
];
let passed = 0, failed = 0;
(async () => {
  const highs = await require(highsPath)();
  for (const [label, opts, expectedStatus, expectedLint, expectedCandidate, expectedFixed] of scenarios) {
    try {
      const P = problem(opts), C = T.rules.checkCtx(P, new T.Asg(P, {}), "lint", () => {});
      const r = T.solve(P, highs, { timeLimit: 5, mipGap: 0 });
      assert.strictEqual(r.status, expectedStatus);
      if (r.asg) assert.deepStrictEqual(T.check(P, r.asg).VC, []);
      assert.strictEqual(P.slots.filter(s => P.isFixedWork(s, A)).length, expectedFixed);
      assert.deepStrictEqual(T.lint(P).map(x => x.code), expectedLint);
      assert.strictEqual(C.canWork(A, [2, "night"]), expectedCandidate);
      assert.ok(P.workAllowed(A) || opts.reserve && !opts.allow, "固定限定だけでは全体候補から外さない");
      if (opts.oncall && r.asg) assert.ok(Object.values(r.asg).every(a => a.work === B && a.oc.includes(A)), "OC固定は実勤務0のまま保持する");
      passed++; console.log("ok  ", label);
    } catch (e) { failed++; console.log("FAIL", label, "\n    ", e.message); }
  }
  console.log(`固定限定者の入力チェック: ${passed} 件通過、${failed} 件失敗`);
  if (failed) process.exitCode = 1;
})().catch(e => { console.error(e); process.exitCode = 1; });

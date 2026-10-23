// Exact fixed work supplies diagnostic capacity despite its tolerated conflicts.
// Synthetic fixtures only. Authored for later local validation; not run during the audit.
// node test_fixed_work_candidate_lint_node.js /path/to/highs [pristine-webapp-directory]
const fs = require("fs"), vm = require("vm"), path = require("path"), assert = require("assert");
const EXPECTED = 24;
let registered = 0, started = 0, completed = 0, passed = 0, finished = false;
const counts = () => ({ registered, started, completed, passed });
process.on("exit", code => {
  if (code === 0 && (!finished || Object.values(counts()).some(n => n !== EXPECTED))) {
    console.error("FAIL incomplete fixed-work candidate regression:", counts());
    process.exitCode = 1;
  }
});
const watchdog = setTimeout(() => {
  console.error("FAIL fixed-work candidate regression exceeded 180 seconds:", counts());
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
const A = "Synthetic Fixed Candidate", SHORT = [
  "LINT_SLOT_NO_CANDIDATE", "LINT_PERSON_TOO_FEW_SLOTS", "LINT_PERSON_TOO_FEW_SLOTS_LIMIT"
];
function problem({ kind = "night", fixed = true, duty = "", reserve = false, allow = false,
  constraint = "unavailable", quotaState = "hard", limits = false, duplicates = false,
  fixedTable, dayOn, dutyState = "hard" } = {}) {
  const dayAll = dayOn === undefined ? kind === "day" : dayOn;
  const quota = dayAll ? 60 : 30;
  const R = {
    profile: { id: "synthetic-fixed-work-candidate",
      roles: [{ id: "Staff", label: "Staff", refs: reserve ? ["reserve"] : [], standby: false }],
      shifts: [{ id: "day", on: dayAll ? "all" : "none" }, { id: "night", on: "all" }] },
    doctors: [{ name: A, team: "Staff", duty, quota: limits ? 0 : quota }],
    quota_tolerance: 0, weights: { fixed_conflict: 1000, chief_duty: 100 }, rule_states: {},
    pm_external_night: "forbid"
  };
  T.fillDefaultRules(R);
  for (const def of T.RULE_DEFS) if (def.states.includes("off")) R.rule_states[def.id] = "off";
  Object.assign(R.rule_states, { quota_range: quotaState, fixed_only: "hard", duty_conflicts: dutyState });
  const M = { year: 2026, month: 11, holidays: [], allow_chief_duty: allow,
    fixed: fixedTable || (fixed ? { [kind]: { 1: duplicates ? [A, A] : A } } : {}),
    count_min: limits ? { [A]: quota } : {}, count_max: limits ? { [A]: quota } : {} };
  if (constraint === "unavailable") {
    if (kind === "night") M.unavailable_night = { [A]: [1] };
    else M.unavailable_other = [{ name: A, day: 1, part: "day" }];
  } else {
    const next = constraint !== "same_pm";
    M.duty_days = { [A]: { [next ? 2 : 1]: {
      [constraint === "next_external" ? "am" : "pm"]: constraint === "next_pm" ? "ward" : "external"
    } } };
  }
  return new T.Problem(R, T.normalizeMonth(M, R));
}
const candidate = (P, slot) => T.rules.checkCtx(P, new T.Asg(P, {}), "lint", () => {}).canWork(A, slot);
const warnings = P => T.lint(P);
const cases = [];
function test(label, fn) { cases.push({ label, fn }); registered++; }
(async () => {
  assert(process.argv[2], "Pass an existing HiGHS package path; this script installs nothing");
  const highs = await require(process.argv[2])();
  const solve = P => T.solve(P, highs, { timeLimit: 5, mipGap: 0 });
  for (const kind of ["day", "night"]) for (const limits of [false, true]) test(`${kind}: exact fixed unavailable work supplies ${limits ? "explicit limits" : "quota"}`, () => {
    const P = problem({ kind, limits }), before = JSON.stringify({ rules: P.rules, month: P.m });
    assert.strictEqual(candidate(P, [1, kind]), true);
    assert.deepStrictEqual(warnings(P).map(x => x.code), ["LINT_FIXED_VS_UNAVAIL"], "keep the real fixed/input conflict only");
    const result = solve(P); assert.strictEqual(result.status, "Optimal");
    const checked = T.check(P, result.asg);
    assert.deepStrictEqual(checked.VC, []);
    assert.deepStrictEqual(checked.WC.map(x => x.code), [kind === "night" ? "UNAVAIL_NIGHT" : "UNAVAIL_DAY"]);
    assert.strictEqual(P.slots.filter(s => checked.A.worked(A, s)).length, kind === "day" ? 60 : 30);
    assert.strictEqual(JSON.stringify({ rules: P.rules, month: P.m }), before, "inputs preserved");
  });
  for (const [constraint, code] of [
    ["next_external", "LINT_FIXED_NIGHT_NEXT_EXTERNAL"],
    ["next_pm", "LINT_FIXED_NIGHT_NEXT_PM"],
    ["same_pm", "LINT_FIXED_NIGHT_PM_EXTERNAL"]
  ]) test(`night: exact fixed work supplies capacity despite ${constraint}`, () => {
    const P = problem({ constraint });
    assert.strictEqual(candidate(P, [1, "night"]), true);
    assert.deepStrictEqual(warnings(P).map(x => x.code), [code]);
    const result = solve(P); assert.strictEqual(result.status, "Optimal");
    const checked = T.check(P, result.asg);
    assert.deepStrictEqual(checked.VC, []);
    assert.strictEqual(checked.WC.length, 1);
  });
  for (const kind of ["day", "night"]) test(`${kind}: removing exact fixed work restores shortage`, () => {
    const P = problem({ kind, fixed: false }), lint = warnings(P);
    assert.strictEqual(candidate(P, [1, kind]), false);
    assert.deepStrictEqual(lint.map(x => x.code), ["LINT_SLOT_NO_CANDIDATE", "LINT_PERSON_TOO_FEW_SLOTS"]);
    assert.strictEqual(lint[1].args.count, P.slots.length - 1);
    assert.strictEqual(solve(P).status, "Infeasible");
  });
  test("quota disabled keeps the fixed conflict but adds no quota warning", () => {
    const P = problem({ quotaState: "off" });
    assert.deepStrictEqual(warnings(P).map(x => x.code), ["LINT_FIXED_VS_UNAVAIL"]);
    assert.strictEqual(solve(P).status, "Optimal");
  });
  test("duty rule disabled does not restrict an unfixed night", () => {
    const P = problem({ constraint: "same_pm", fixed: false, dutyState: "off" });
    assert.strictEqual(candidate(P, [1, "night"]), true);
    assert.deepStrictEqual(warnings(P), []);
    assert.strictEqual(solve(P).status, "Optimal");
  });
  for (const [label, fixedTable, dayOn] of [
    ["OC only", { night_oc: { 1: [A] } }, false],
    ["inactive charge only", { weekend_charge: { 1: A } }, false],
    ["other real work shift", { day: { 1: A } }, true],
    ["next month only", { night: { 31: A } }, false]
  ]) test(`${label} is not an exact-work exception`, () => {
    const P = problem({ fixedTable, dayOn });
    assert.strictEqual(candidate(P, [1, "night"]), false);
    assert(warnings(P).some(x => x.code === "LINT_PERSON_TOO_FEW_SLOTS"));
  });
  test("nonexistent day work is not a fixed exception", () => {
    const P = problem({ kind: "day", dayOn: false });
    assert.strictEqual(P.slotExists(1, "day"), false);
    assert.strictEqual(candidate(P, [1, "day"]), false);
    assert(warnings(P).some(x => x.code === "LINT_FIXED_NO_SLOT"));
  });
  for (const [label, opts] of [
    ["never", { duty: "never" }],
    ["reserve without monthly permission", { reserve: true }],
    ["no_unless_needed without permission", { duty: "no_unless_needed" }]
  ]) test(`${label} remains outside work candidates`, () => {
    const P = problem(opts);
    assert.strictEqual(candidate(P, [1, "night"]), false);
    assert(warnings(P).some(x => x.code === "LINT_FIXED_NOT_CANDIDATE"));
  });
  test("a permitted reserve candidate does not waive the solver's monthly one-shift cap", () => {
    const P = problem({ reserve: true, allow: true });
    assert.strictEqual(candidate(P, [1, "night"]), true);
    assert.strictEqual(solve(P).status, "Infeasible", "candidate estimate is not global feasibility");
  });
  test("duplicate fixed names keep their warnings and count as one candidate slot", () => {
    const P = problem({ duplicates: true }), lint = warnings(P);
    assert.strictEqual(candidate(P, [1, "night"]), true);
    assert.strictEqual(P.fixedWorkCount(A), 1);
    assert(lint.some(x => x.code === "LINT_FIXED_DUP"));
    assert(lint.some(x => x.code === "LINT_FIXED_OVER_COUNT"));
    assert.strictEqual(lint.filter(x => x.code === "LINT_FIXED_VS_UNAVAIL").length, 2);
    assert(!lint.some(x => SHORT.includes(x.code)));
  });
  test("fixed-only rule still excludes every unfixed slot", () => {
    const P = problem({ duty: "fixed_only" });
    assert.strictEqual(candidate(P, [1, "night"]), true);
    assert.strictEqual(candidate(P, [2, "night"]), false);
    assert.strictEqual(solve(P).status, "Infeasible");
  });
  for (const removeOne of [false, true]) test(`Friday lower bound counts exact fixed unavailable nights: remove=${removeOne}`, () => {
    const seed = problem(), R = seed.rules, M = seed.m, fridays = [6, 13, 20, 27];
    R.friday_night_min = { [A]: 4 }; R.rule_states.friday_night_min = "hard";
    M.unavailable_night[A] = fridays;
    M.fixed.night = Object.fromEntries(fridays.filter(day => !removeOne || day !== 6).map(day => [day, A]));
    const P = new T.Problem(R, M), lint = warnings(P);
    assert.strictEqual(lint.some(x => x.code === "LINT_FRIDAY_TOO_FEW"), removeOne);
    assert.strictEqual(lint.filter(x => x.code === "LINT_FIXED_VS_UNAVAIL").length, removeOne ? 3 : 4);
    assert.strictEqual(solve(P).status, removeOne ? "Infeasible" : "Optimal");
  });
  assert.strictEqual(registered, EXPECTED, "registered fixed-work candidate cases");
  for (const { label, fn } of cases) {
    started++;
    try { await fn(); passed++; console.log("ok " + label); }
    finally { completed++; }
  }
  assert.deepStrictEqual(counts(), { registered: EXPECTED, started: EXPECTED, completed: EXPECTED, passed: EXPECTED });
  finished = true; clearTimeout(watchdog);
  console.log(`${passed} fixed-work candidate diagnostic cases passed`, counts());
})().catch(error => { clearTimeout(watchdog); console.error(error, counts()); process.exitCode = 1; });

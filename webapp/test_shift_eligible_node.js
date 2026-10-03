// 構成の「最大 0 人」が減点のときも配置候補を公平性・勤務日容量から外さない。
// node test_shift_eligible_node.js <highs パッケージのパス>
// 名簿・月・割当はすべてこのファイルで作る架空データ。保存データは読まない。
const fs = require("fs"), vm = require("vm"), path = require("path"), assert = require("assert");
globalThis.T = {};
for (const f of ["i18n.js", "rules-core.js", "model.js", "messages.js", "solver.js", "check.js"]) {
  vm.runInThisContext(fs.readFileSync(path.join(__dirname, "src", f), "utf8"), { filename: f });
}
for (const f of fs.readdirSync(path.join(__dirname, "src/rules")).filter(f => f.endsWith(".js")).sort()) {
  vm.runInThisContext(fs.readFileSync(path.join(__dirname, "src/rules", f), "utf8"), { filename: "rules/" + f });
}

const NAMES = ["Synthetic A", "Synthetic B"];
function problem(state, { daysOff = false, compositionDays = "all" } = {}) {
  const R = {
    profile: {
      id: "synthetic-shift-eligibility",
      roles: [{ id: "S", label: "Staff", refs: [], standby: false }],
      shifts: [{ id: "day", on: "none" }, { id: "night", on: "all" }],
    },
    doctors: [
      { name: NAMES[0], team: "S", quals: ["Q"], quota: 15 },
      { name: NAMES[1], team: "S", quota: 15 },
    ],
    composition: [{ shift: "night", days: compositionDays, qual: "Q", max: 0 }],
    days_off: { min: 15 },
    weights: { fixed_conflict: 1000 }, rule_states: {},
  };
  T.fillDefaultRules(R);
  for (const d of T.RULE_DEFS) if ((d.states || []).includes("off")) R.rule_states[d.id] = "off";
  Object.assign(R.rule_states, { composition: state, shift_balance: "soft", days_off_min: daysOff ? "hard" : "off" });
  Object.assign(R.weights, { composition_miss: 1, shift_balance: 10 });
  return new T.Problem(R, T.normalizeMonth({ year: 2026, month: 11, holidays: [] }, R));
}
const assignment = firstCount => Object.fromEntries(Array.from({ length: 30 }, (_, i) => [
  `${i + 1}:night`, { work: NAMES[i < firstCount ? 0 : 1], oc: [] },
]));
const counts = (P, asg) => { const A = new T.Asg(P, asg); return NAMES.map(n => P.slots.filter(s => A.worked(n, s)).length); };
let passed = 0, failed = 0;
function test(label, fn) {
  try { fn(); passed++; console.log("ok  " + label); }
  catch (e) { failed++; console.error("FAIL " + label + "\n     " + e.message); }
}

(async () => {
  if (!process.argv[2]) throw new Error("既存の highs パッケージのパスを指定してください");
  const highs = await require(process.argv[2])();
  const solve = (P, opts = {}) => T.solve(P, highs, Object.assign({ timeLimit: 5, mipGap: 0 }, opts));
  for (const state of ["hard", "soft", "off"]) test(`構成 ${state}: 勤務帯の候補は必須の禁止だけで絞る`, () => {
    const P = problem(state);
    assert.deepStrictEqual(NAMES.map(n => P.shiftEligible(n, "night")), [state !== "hard", true]);
    assert.strictEqual(P.shiftEligible(NAMES[0], "day"), true, "夜勤の条件は日勤の候補を減らさない");
  });
  test("一部の日だけの必須の禁止は、月全体の候補から外さない", () => {
    assert.strictEqual(problem("hard", { compositionDays: "weekdays" }).shiftEligible(NAMES[0], "night"), true);
  });
  test("減点の構成でも勤務 0 回・30 回の偏りは 30 × 10 点", () => {
    const P = problem("soft"), a = assignment(0);
    assert.strictEqual(T.check(P, a).V.length, 0);
    assert.strictEqual(T.penalty(P, a).items.shift_balance, 300);
  });
  test("構成が減点なら、偏りと比較して勤務 15 回ずつが最適（構成の減点 15）", () => {
    const P = problem("soft"), r = solve(P);
    assert.strictEqual(r.status, "Optimal");
    assert.deepStrictEqual(counts(P, r.asg), [15, 15]);
    assert.strictEqual(r.objective, 15);
    assert.strictEqual(T.check(P, r.asg).V.length, 0);
    assert.strictEqual(T.penalty(P, r.asg).total, r.objective);
  });
  test("構成がなしなら勤務 15 回ずつで減点 0", () => {
    const P = problem("off"), r = solve(P);
    assert.strictEqual(r.status, "Optimal");
    assert.deepStrictEqual(counts(P, r.asg), [15, 15]);
    assert.strictEqual(r.objective, 0);
  });
  test("構成が必須なら禁止された人を公平性から除外し、もう一人に 30 回配置", () => {
    const P = problem("hard"), r = solve(P);
    assert.strictEqual(r.status, "Optimal");
    assert.deepStrictEqual(counts(P, r.asg), [0, 30]);
    assert.strictEqual(r.objective, 0);
    assert.strictEqual(T.check(P, r.asg).V.length, 0);
  });
  test("休み 15 日必須・構成が減点なら、容量警告なしで各 15 回の割当が解ける", () => {
    const P = problem("soft", { daysOff: true }), a = assignment(15);
    assert.strictEqual(T.check(P, a).V.length, 0);
    assert.ok(!T.lint(P).some(v => v.code === "LINT_SHIFT_CAPACITY"), "配置可能な人の勤務日も容量に含める");
    const r = solve(P, { pin: a });
    assert.strictEqual(r.status, "Optimal");
    assert.strictEqual(r.objective, 15);
    assert.strictEqual(T.penalty(P, a).total, r.objective);
  });
  test("休み 15 日必須・構成が必須なら、容量 15 日不足の警告と解なしを保つ", () => {
    const P = problem("hard", { daysOff: true });
    const warning = T.lint(P).find(v => v.code === "LINT_SHIFT_CAPACITY");
    assert.ok(warning);
    assert.strictEqual(warning.args.need, 30);
    assert.strictEqual(warning.args.cap, 15);
    assert.strictEqual(solve(P).status, "Infeasible");
  });
  console.log(`${passed} passed, ${failed} failed`);
  if (failed) process.exitCode = 1;
})().catch(e => { console.error(e); process.exitCode = 1; });

// 人数に幅がある枠の容量診断を実HiGHSと比較する。名簿・月はすべて架空。
// node test_variable_capacity_node.js <highs パッケージのパス>
const fs = require("fs"), vm = require("vm"), path = require("path"), assert = require("assert");
globalThis.T = {};
for (const f of ["i18n.js", "rules-core.js", "model.js", "messages.js", "solver.js", "check.js"])
  vm.runInThisContext(fs.readFileSync(path.join(__dirname, "src", f), "utf8"), { filename: f });
for (const f of fs.readdirSync(path.join(__dirname, "src/rules")).filter(f => f.endsWith(".js")))
  vm.runInThisContext(fs.readFileSync(path.join(__dirname, "src/rules", f), "utf8"), { filename: "rules/" + f });
const highsPath = process.argv[2];
if (!highsPath) { console.log("（highs のパス指定が無いので、可変人数の容量診断の試験は省略）"); process.exit(0); }

const A = "Synthetic A", B = "Synthetic B", C = "Synthetic C", F = "Synthetic Fixed", G = "Synthetic Fixed Two";
const HIGH = "LINT_CAPACITY_HIGH", LOW = "LINT_CAPACITY_LOW";
function problem({ quotas = [15, 15], fixedNames = [], fixed = {}, work = { count: 2, min: 1, ideal: 1 },
  dayAll = false, target = false } = {}) {
  const rules = {
    profile: { id: "synthetic-variable-capacity", quota_mode: "absolute",
      roles: [{ id: "Staff", label: "Staff", refs: [], standby: false }],
      shifts: [{ id: "day", on: dayAll ? "all" : "none" }, { id: "night", on: "all" }], positions: { work } },
    doctors: [...quotas.map((quota, i) => ({ name: [A, B, C][i], team: "Staff", quota })),
      ...fixedNames.map(name => ({ name, team: "Staff", duty: "fixed_only", quota: 30 }))],
    quota_tolerance: 0, weights: { count_deviation: 1, fixed_conflict: 1000 }, rule_states: {}
  };
  T.fillDefaultRules(rules);
  for (const def of T.RULE_DEFS) if (def.states.includes("off")) rules.rule_states[def.id] = "off";
  Object.assign(rules.rule_states, { quota_range: "hard", fixed_only: "hard", count_target: target ? "soft" : "off" });
  const month = T.normalizeMonth({ year: 2026, month: 11, holidays: [], fixed }, rules);
  return new T.Problem(rules, month);
}
const capacity = P => T.lint(P).filter(x => [HIGH, LOW].includes(x.code)).map(({ code, args }) => ({ code, args }));
const warning = (code, need, total) => [{ code, args: { need, total, tol: 0 } }];
// 2026/11 は平日21日、土日9日。日勤も含めると下限48・上限108人回。
const mixedWork = {
  count: { day: { weekday: 1, off_days: 2 }, night: { weekday: 2, off_days: 3 } },
  min: { day: { weekday: 0, off_days: 1 }, night: { weekday: 1, off_days: 2 } }
};
// label / inputs / solver status / capacity warnings / total assigned / other lint codes
const cases = [
  ["再現: 一般15回ずつと固定限定1回は31人回で成立", { fixedNames: [F], fixed: { night: { 1: F } } }, "Optimal", [], 31],
  ["下限30人回は最大60人回を埋めなくても成立", {}, "Optimal", [], 30],
  ["範囲内40人回も成立", { quotas: [20, 20] }, "Optimal", [], 40],
  ["上限60人回ちょうども成立", { quotas: [20, 20, 20] }, "Optimal", [], 60],
  ["29人回では下限30人回への不足を警告", { quotas: [15, 14] }, "Infeasible", warning(HIGH, 30, 29)],
  ["各人は配置可能でも63人回は上限60人回を超える", { quotas: [21, 21, 21] }, "Infeasible", warning(LOW, 60, 63)],
  ["同枠の固定2人は必要下限を31人回に上げる", { quotas: [14, 14], fixedNames: [F, G], fixed: { night: { 1: [F, G] } } }, "Infeasible", warning(HIGH, 31, 30)],
  ["人数固定の従来設定はmin省略でも60人回", { quotas: [30, 30], work: { count: 2 } }, "Optimal", [], 60],
  ["理想2人の減点があっても必須下限は30人回", { work: { count: 2, min: 1, ideal: 2 }, target: true }, "Optimal", [], 30],
  ["同一名の重複固定は容量を1人分だけ数える", { quotas: [15, 14], fixedNames: [F], fixed: { night: { 1: [F, F] } } }, "Optimal", [], 30, ["LINT_FIXED_DUP"]],
  ["勤務帯と平日・休日で異なる下限48人回は成立", { quotas: [16, 16, 16], work: mixedWork, dayAll: true }, "Optimal", [], 48],
  ["勤務帯と平日・休日の下限合計48人回への不足", { quotas: [16, 16, 15], work: mixedWork, dayAll: true }, "Infeasible", warning(HIGH, 48, 47)],
  ["勤務帯と平日・休日の上限合計108人回への超過", { quotas: [37, 36, 36], work: mixedWork, dayAll: true }, "Infeasible", warning(LOW, 108, 109)]
];
let passed = 0, failed = 0, solverCases = 0;
function test(label, fn) {
  try { fn(); passed++; console.log("ok  ", label); }
  catch (e) { failed++; console.log("FAIL", label, "\n    ", e.message); }
}
(async () => {
  const highs = await require(highsPath)();
  for (const [label, opts, status, expectedWarnings, total, otherCodes = []] of cases) test(label, () => {
    const P = problem(opts), before = JSON.stringify({ rules: P.rules, month: P.m });
    const result = T.solve(P, highs, { timeLimit: 5, mipGap: 0 });
    assert.strictEqual(result.status, status, "容量以外の条件を無効にした実HiGHSの成立性");
    if (result.asg) {
      const checked = T.check(P, result.asg);
      assert.deepStrictEqual(checked.VC, [], "検算の必須違反0件");
      assert.deepStrictEqual(checked.WC, [], "固定による違反の許容も0件");
      assert.strictEqual(P.slots.reduce((sum, s) => sum + checked.A.workers(s).length, 0), total, "実際の延べ勤務人数");
      for (const n of opts.fixedNames || []) assert.strictEqual(P.slots.filter(s => checked.A.worked(n, s)).length, 1, "固定限定者は1回だけ勤務");
      if (opts.target) {
        assert.strictEqual(result.objective, 30, "理想2人への不足は必須条件ではなく30点の減点");
        assert.strictEqual(T.penalty(P, result.asg).total, 30);
      }
    }
    solverCases++;
    assert.deepStrictEqual(capacity(P), expectedWarnings, "容量警告の種類・必要人数・目安合計");
    assert.deepStrictEqual(T.lint(P).filter(x => ![HIGH, LOW].includes(x.code)).map(x => x.code), otherCodes);
    assert.strictEqual(JSON.stringify({ rules: P.rules, month: P.m }), before, "入力を変更しない");
  });
  // 形の不正な固定は別の診断対象なので、ここでは容量警告だけを検証する。
  // 各入力を分け、OC・翌月・存在しない勤務帯を実勤務に混ぜる誤りを個別に捕まえる。
  test("OC・翌月・存在しない勤務帯の固定は必要下限にも勤務容量にも加えない", () => {
    for (const fixed of [
      { night_oc: { 1: [F, G] } },
      { night: { 31: [F, G] } },
      { day: { 1: [F, G] } }
    ]) {
      const P = problem({ quotas: [15, 14], fixedNames: [F, G], fixed });
      assert.strictEqual(P.slots.filter(s => P.isFixedWork(s, F) || P.isFixedWork(s, G)).length, 0);
      assert.deepStrictEqual(capacity(P), warning(HIGH, 30, 29), JSON.stringify(fixed));
    }
  });
  console.log(`可変人数の容量診断: ${passed} 件通過、${failed} 件失敗（実HiGHS ${solverCases} 件照合）`);
  if (failed) process.exitCode = 1;
})().catch(e => { console.error(e); process.exitCode = 1; });

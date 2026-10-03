// 予備の役割: 月未許可の実勤務は入力チェックでも候補外、OC候補には残す。
// node test_reserve_lint_node.js <highs パッケージのパス>
// 名簿・月はすべて架空。外部の保存データは使わない。
const fs = require("fs"), vm = require("vm"), path = require("path"), assert = require("assert");
globalThis.T = {};
for (const f of ["i18n.js", "rules-core.js", "model.js", "messages.js", "solver.js", "check.js"])
  vm.runInThisContext(fs.readFileSync(path.join(__dirname, "src", f), "utf8"), { filename: f });
for (const f of fs.readdirSync(path.join(__dirname, "src/rules")).filter(f => f.endsWith(".js")))
  vm.runInThisContext(fs.readFileSync(path.join(__dirname, "src/rules", f), "utf8"), { filename: "rules/" + f });
const highsPath = process.argv[2];
if (!highsPath) { console.log("（highs のパス指定が無いので、予備の入力チェックの試験は省略）"); process.exit(0); }

function problem({ role = "Reserve", duty = "", kind = "night", allowed = false, reserve = true,
  unavailable = [], fixed = false, oncall = false, quota = null } = {}) {
  const R = {
    profile: { id: "synthetic-reserve-lint", roles: [
      { id: role, label: "Synthetic reserve", refs: reserve ? ["reserve"] : [], standby: oncall },
      { id: "Staff", label: "Synthetic staff", refs: [], standby: false },
      { id: "Junior", label: "Synthetic junior", refs: ["junior"], standby: false }
    ], shifts: [{ id: "day", on: kind === "day" ? "all" : "none" }, { id: "night", on: "all" }] },
    doctors: [{ name: "Synthetic A", team: role, duty, quota: quota ? quota.reserve : 0 },
      { name: "Synthetic B", team: "Staff", quota: quota ? quota.staff : 0 }],
    quota_tolerance: 0,
    oncall_requirement: { [role]: { [role]: 0 }, Staff: { [role]: 1 } },
    weights: { chief_duty: 100, missing_young_oc: 0, fixed_conflict: 1000 }, rule_states: {}
  };
  T.fillDefaultRules(R);
  for (const def of T.RULE_DEFS) if (def.states.includes("off")) R.rule_states[def.id] = "off";
  if (oncall) R.rule_states.oncall = "hard";
  if (quota) R.rule_states.quota_range = "hard";
  const m = { year: 2026, month: 11, holidays: [], allow_chief_duty: allowed,
    unavailable_night: { "Synthetic B": kind === "night" ? unavailable : [] },
    unavailable_other: kind === "day" ? unavailable.map(day => ({ name: "Synthetic B", day, part: "day" })) : [],
    fixed: { [kind]: fixed ? { 1: "Synthetic A" } : {}, [kind + "_oc"]: oncall ? { 1: ["Synthetic A"] } : {} } };
  return new T.Problem(R, T.normalizeMonth(m, R));
}
let passed = 0, failed = 0;
function test(label, fn) {
  try { fn(); passed++; console.log("ok  ", label); }
  catch (e) { failed++; console.log("FAIL", label, "\n    ", e.message); }
}
const warnings = P => T.lint(P).map(x => x.code);
const ctx = P => T.rules.checkCtx(P, new T.Asg(P, {}), "lint", () => {});
(async () => {
  const highs = await require(highsPath)();
  const solve = P => T.solve(P, highs, { timeLimit: 5, mipGap: 0 });
  for (const role of ["C", "Reserve"]) for (const duty of ["", "yes"]) for (const kind of ["day", "night"]) {
    const opts = { role, duty, kind }, label = `${role} / ${duty || "空欄"} / ${kind}`;
    test(`${label}: 月未許可で予備しか空いていない枠は候補なし`, () => {
      const P = problem({ ...opts, unavailable: [1] });
      assert.strictEqual(solve(P).status, "Infeasible");
      assert.deepStrictEqual(warnings(P), ["LINT_SLOT_NO_CANDIDATE"]);
      assert.strictEqual(ctx(P).canWork("Synthetic A", [1, kind]), false);
      assert.ok(P.dutyNames.includes("Synthetic A"), "OCを含む候補一覧は維持する");
    });
    test(`${label}: 月未許可の実勤務固定は候補外と警告`, () => {
      const P = problem({ ...opts, fixed: true });
      assert.strictEqual(solve(P).status, "Infeasible");
      assert.deepStrictEqual(warnings(P), ["LINT_FIXED_NOT_CANDIDATE"]);
    });
    test(`${label}: 許可した1勤務は固定も候補も通る`, () => {
      const P = problem({ ...opts, allowed: true, unavailable: [1], fixed: true }), r = solve(P);
      assert.strictEqual(r.status, "Optimal");
      assert.strictEqual(r.asg[`1:${kind}`].work, "Synthetic A");
      assert.deepStrictEqual(T.check(P, r.asg).VC, []);
      assert.deepStrictEqual(warnings(P), []);
      assert.strictEqual(ctx(P).canWork("Synthetic A", [1, kind]), true);
    });
    test(`${label}: 月未許可でも予備OCの固定・候補は維持`, () => {
      const P = problem({ ...opts, oncall: true }), r = solve(P);
      assert.strictEqual(r.status, "Optimal");
      assert.ok(Object.values(r.asg).every(a => a.work === "Synthetic B" && a.oc.includes("Synthetic A")));
      assert.deepStrictEqual(T.check(P, r.asg).VC, []);
      assert.deepStrictEqual(warnings(P), []);
      assert.ok(P.standbyNames.includes("Synthetic A"));
    });
  }
  for (const kind of ["day", "night"]) test(`通常役割C / ${kind}: 予備でなければ月許可は不要`, () => {
    const P = problem({ role: "C", kind, reserve: false, unavailable: [1, 2], fixed: true }), r = solve(P);
    assert.strictEqual(r.status, "Optimal");
    assert.strictEqual(r.asg[`1:${kind}`].work, "Synthetic A");
    assert.strictEqual(r.asg[`2:${kind}`].work, "Synthetic A");
    assert.deepStrictEqual(T.check(P, r.asg).VC, []);
    assert.deepStrictEqual(warnings(P), []);
  });
  for (const [label, opts, status, expected] of [
    ["予備の目安0でも月許可があれば1勤務分を容量に加える", { allowed: true, unavailable: [1], quota: { reserve: 0, staff: 29 } }, "Optimal", []],
    ["月未許可の予備の目安は容量に加えず通常職員の不足を報告", { quota: { reserve: 1, staff: 29 } }, "Infeasible", ["LINT_CAPACITY_HIGH"]],
    ["月未許可の予備の大きな目安は合計下限にも個人不足にも加えない", { quota: { reserve: 99, staff: 30 } }, "Optimal", []],
    ["月許可がある予備でも目安は免除され1勤務だけでよい", { allowed: true, unavailable: [1], quota: { reserve: 99, staff: 29 } }, "Optimal", []],
    ["予備の目安0の1勤務固定は目安超過を警告しない", { allowed: true, fixed: true, quota: { reserve: 0, staff: 29 } }, "Optimal", []],
    ["月未許可の予備固定は候補外だけを警告し目安超過を重ねない", { fixed: true, quota: { reserve: 0, staff: 30 } }, "Infeasible", ["LINT_FIXED_NOT_CANDIDATE"]]
  ]) test(label, () => {
    const P = problem(opts), r = solve(P);
    assert.strictEqual(r.status, status);
    if (r.asg) assert.deepStrictEqual(T.check(P, r.asg).VC, []);
    assert.deepStrictEqual(warnings(P), expected);
  });
  console.log(`予備の入力チェック: ${passed} 件通過、${failed} 件失敗`);
  if (failed) process.exitCode = 1;
})().catch(e => { console.error(e); process.exitCode = 1; });

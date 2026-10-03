// 予備の役割の実勤務には月の許可が必要。名簿の「配置する」では上書きしない。
// node test_reserve_permission_node.js <highs パッケージのパス>
// 名簿・月・割当はすべて架空。このファイルの外の保存データは読まない。
const fs = require("fs"), vm = require("vm"), path = require("path"), assert = require("assert");
globalThis.T = {};
for (const f of ["i18n.js", "rules-core.js", "model.js", "messages.js", "solver.js", "check.js"])
  vm.runInThisContext(fs.readFileSync(path.join(__dirname, "src", f), "utf8"), { filename: f });
for (const f of fs.readdirSync(path.join(__dirname, "src/rules")).filter(f => f.endsWith(".js")))
  vm.runInThisContext(fs.readFileSync(path.join(__dirname, "src/rules", f), "utf8"), { filename: "rules/" + f });
const highsPath = process.argv[2];
if (!highsPath) { console.log("（highs のパス指定が無いので、予備の月許可の試験は省略）"); process.exit(0); }

function problem({ role = "Reserve", duty = "", allowed = false, unavailable = [], reserve = true, oncall = false } = {}) {
  const R = {
    profile: {
      id: "synthetic-reserve-permission",
      roles: [{ id: role, label: "Test role", refs: reserve ? ["reserve"] : [], standby: oncall },
        { id: "Staff", label: "Staff", refs: [] }],
      shifts: [{ id: "day", on: "none" }, { id: "night", on: "all" }]
    },
    doctors: [{ name: "Synthetic A", team: role, duty, quota: 0 }, { name: "Synthetic B", team: "Staff", quota: 0 }],
    oncall_requirement: { [role]: { [role]: 0 }, Staff: { [role]: 1 } },
    weights: { chief_duty: 100, missing_young_oc: 0, fixed_conflict: 1000 }, rule_states: {}
  };
  T.fillDefaultRules(R);
  for (const def of T.RULE_DEFS) if (def.states.includes("off")) R.rule_states[def.id] = "off";
  if (oncall) R.rule_states.oncall = "hard";
  return new T.Problem(R, T.normalizeMonth({ year: 2026, month: 11, holidays: [], allow_chief_duty: allowed,
    unavailable_night: { "Synthetic B": unavailable } }, R));
}
const assignment = n => Object.fromEntries(Array.from({ length: 30 }, (_, i) => [
  `${i + 1}:night`, { work: i < n ? "Synthetic A" : "Synthetic B", oc: [] }
]));
const countA = asg => Object.values(asg).filter(a => a.work === "Synthetic A").length;
const codes = (P, a) => T.check(P, a).VC.map(v => v.code);
let passed = 0, failed = 0;
function test(label, fn) {
  try { fn(); passed++; console.log("ok  ", label); }
  catch (e) { failed++; console.log("FAIL", label, "\n    ", e.message); }
}

(async () => {
  const highs = await require(highsPath)();
  const solve = (P, opts = {}) => T.solve(P, highs, Object.assign({ timeLimit: 5, mipGap: 0 }, opts));
  for (const role of ["C", "Reserve"]) for (const duty of ["", "yes"]) {
    const label = `${role} / duty:${duty || "空欄"}`;
    test(`${label}: 未許可なら通常職員だけで充足、予備の1勤務は検算・ソルバーとも不可`, () => {
      const P = problem({ role, duty }), r = solve(P);
      assert.strictEqual(r.status, "Optimal");
      assert.strictEqual(countA(r.asg), 0);
      assert.deepStrictEqual(codes(P, r.asg), []);
      assert.strictEqual(r.objective, 0);
      assert.deepStrictEqual(codes(P, assignment(1)), ["RESERVE_ASSIGNED"]);
      assert.strictEqual(solve(P, { pin: assignment(1) }).status, "Infeasible", "未許可の予備の実勤務を受け付けない");
    });
    test(`${label}: 未許可で予備しか入れない日があれば解なし`, () => {
      const P = problem({ role, duty, unavailable: [1] });
      assert.strictEqual(solve(P).status, "Infeasible", "名簿の配置設定は月の許可を上書きしない");
    });
    test(`${label}: 許可があれば月1回は配置でき、検算・減点と一致`, () => {
      const P = problem({ role, duty, allowed: true, unavailable: [1] }), r = solve(P);
      assert.strictEqual(r.status, "Optimal");
      assert.strictEqual(countA(r.asg), 1);
      assert.deepStrictEqual(codes(P, r.asg), []);
      assert.strictEqual(r.objective, 100);
      assert.strictEqual(T.penalty(P, r.asg).total, r.objective);
    });
    test(`${label}: 許可があっても月2回は検算・ソルバーとも不可`, () => {
      const P = problem({ role, duty, allowed: true, unavailable: [1, 2] });
      assert.deepStrictEqual(codes(P, assignment(2)), ["RESERVE_OVER"]);
      assert.strictEqual(solve(P).status, "Infeasible");
    });
  }
  test("予備ではない通常役割 C には月許可も月1回制限も適用しない", () => {
    const P = problem({ role: "C", reserve: false, unavailable: [1, 2] }), a = assignment(2), r = solve(P, { pin: a });
    assert.strictEqual(r.status, "Optimal");
    assert.strictEqual(countA(r.asg), 2);
    assert.deepStrictEqual(codes(P, r.asg), []);
    assert.strictEqual(r.objective, 0);
  });
  test("月未許可でも予備のOCは従来どおり（今回の制限は実勤務だけ）", () => {
    const P = problem({ oncall: true }), a = assignment(0);
    for (const s of Object.values(a)) s.oc = ["Synthetic A"];
    const r = solve(P, { pin: a });
    assert.strictEqual(r.status, "Optimal");
    assert.strictEqual(countA(r.asg), 0);
    assert.ok(Object.values(r.asg).every(s => s.oc.includes("Synthetic A")));
    assert.deepStrictEqual(codes(P, r.asg), []);
    assert.strictEqual(r.objective, 0);
  });
  console.log(`予備の月許可: ${passed} 件通過、${failed} 件失敗`);
  if (failed) process.exitCode = 1;
})().catch(e => { console.error(e); process.exitCode = 1; });

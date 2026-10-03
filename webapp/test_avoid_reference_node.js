// 避けたい日の基準回数は役割の識別子に依存しない。予備の役割だけを参照計算の対象から外す。
// node test_avoid_reference_node.js <highs パッケージのパス>
// 名簿・月データはすべてこのテストで作った架空の例。実際の保存データは読まない。
const fs = require("fs"), vm = require("vm"), path = require("path"), assert = require("assert");
globalThis.T = {};
for (const f of ["i18n.js", "rules-core.js", "model.js", "messages.js", "solver.js", "check.js"])
  vm.runInThisContext(fs.readFileSync(path.join(__dirname, "src", f), "utf8"), { filename: f });
for (const f of fs.readdirSync(path.join(__dirname, "src/rules")).filter(x => x.endsWith(".js")))
  vm.runInThisContext(fs.readFileSync(path.join(__dirname, "src/rules", f), "utf8"), { filename: "rules/" + f });
const highsPath = process.argv[2];
if (!highsPath) { console.log("（highs のパス指定が無いので、避けたい日の参照計算の試験は省略）"); process.exit(0); }

function problem(role, reserve) {
  const R = {
    profile: {
      id: "synthetic-avoid-reference", quota_mode: "absolute",
      roles: [{ id: role, label: "Test role", refs: reserve ? ["reserve"] : [] }]
        .concat(reserve ? [{ id: "Staff", label: "Staff", refs: [] }] : []),
      shifts: [{ id: "day", on: "none" }, { id: "night", on: "all" }]
    },
    doctors: [
      { name: "Synthetic A", team: role, quota: 20, duty: reserve ? "no_unless_needed" : "yes" },
      { name: "Synthetic B", team: reserve ? "Staff" : role, quota: 20 }
    ],
    weights: { chief_duty: 0, missing_young_oc: 0, fixed_conflict: 1000, avoid_day: 30, avoid_no_reduction: 1000 },
    rule_states: {}
  };
  T.fillDefaultRules(R);
  for (const def of T.RULE_DEFS) if (def.states.includes("off")) R.rule_states[def.id] = "off";
  R.rule_states.avoid_days = "soft";
  // A は2日の1勤務だけに固定。1日の「避」は満たしているので減点は0。
  // 目標20回と参照解1回を違えて、参照解を省略して目標で代用する誤りを検出する。
  const night = {}; for (let d = 1; d <= 30; d++) night[d] = d === 2 ? "Synthetic A" : "Synthetic B";
  return new T.Problem(R, T.normalizeMonth({ year: 2026, month: 11, holidays: [], allow_chief_duty: reserve,
    fixed: { night }, avoid: [{ name: "Synthetic A", day: 1, part: "night" }] }, R));
}

(async () => {
  const highs = await require(highsPath)(); let passed = 0, failed = 0;
  for (const [role, reserve] of [["S", false], ["C", false], ["C", true], ["Reserve", true]]) {
    const label = `${reserve ? "予備" : "通常"}の役割 ${role}`;
    try {
      const P = problem(role, reserve); let calls = 0;
      const result = await T.solveWithAvoidRef(P, { solve: (...args) => { calls++; return highs.solve(...args); } }, { timeLimit: 5, mipGap: 0 });
      assert.strictEqual(P.isRole("Synthetic A", "reserve"), reserve);
      assert.strictEqual(result.status, "Optimal");
      assert.strictEqual(Object.values(result.asg).filter(a => a.work === "Synthetic A").length, 1);
      assert.strictEqual(T.check(P, result.asg).V.length, 0);
      assert.strictEqual(result.objective, 0, "避けたい日を回避し参照回数を満たせば減点なし");
      assert.strictEqual(T.penalty(P, result.asg, { avoidRef: result.avoidRef }).total, 0, "検算の減点も一致");
      if (reserve) {
        assert.strictEqual(result.avoidRef, undefined, "予備の役割は識別子によらず基準回数の対象外");
        assert.strictEqual(calls, 1, "予備の人だけの申告では参照計算をしない");
      } else {
        assert.deepStrictEqual(result.avoidRef, { "Synthetic A": 1 }, "通常の役割は識別子によらず参照解の1回を使う");
        assert.strictEqual(calls, 2, "参照解と本計算を行う");
      }
      passed++; console.log("ok  ", label);
    } catch (e) { failed++; console.log("FAIL", label, "\n    ", e.message); }
  }
  console.log(`避けたい日の参照計算: ${passed} 件通過、${failed} 件失敗`);
  if (failed) process.exitCode = 1;
})().catch(e => { console.error(e); process.exitCode = 1; });

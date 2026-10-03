// 予備の目安で一般職員の当月目標を変えない。名簿・月・履歴はすべて架空。
const fs = require("fs"), path = require("path"), vm = require("vm"), assert = require("assert");
globalThis.T = {};
for (const f of ["i18n.js", "rules-core.js", "model.js", "messages.js"])
  vm.runInThisContext(fs.readFileSync(path.join(__dirname, "src", f), "utf8"), { filename: f });
for (const f of fs.readdirSync(path.join(__dirname, "src/rules")).filter(f => f.endsWith(".js")))
  vm.runInThisContext(fs.readFileSync(path.join(__dirname, "src/rules", f), "utf8"), { filename: "rules/" + f });

function inputs(role, duty, allowed, reserve = true) {
  const rules = {
    profile: { id: "synthetic-targets", roles: [{ id: role, label: "Test role", refs: reserve ? ["reserve"] : [] },
      { id: "Staff", label: "Staff", refs: [] }],
      shifts: [{ id: "day", on: "none" }, { id: "night", on: "all" }] },
    doctors: [{ name: "Synthetic A", team: "Staff", quota: 15 }, { name: "Synthetic B", team: "Staff", quota: 15 },
      { name: "Synthetic R", team: role, duty, quota: 10 }], quota_tolerance: 1, rule_states: {}
  };
  T.fillDefaultRules(rules);
  for (const def of T.RULE_DEFS) if (def.states.includes("off")) rules.rule_states[def.id] = "off";
  const month = T.normalizeMonth({ year: 2026, month: 11, allow_chief_duty: allowed,
    targets: { "Synthetic R": 0 }, history: { work_balance: { "Synthetic R": 40 } } }, rules);
  return { rules, month };
}

let passed = 0, failed = 0;
function test(label, fn) {
  try { fn(); passed++; console.log("ok  ", label); }
  catch (e) { failed++; console.log("FAIL", label, e.message); }
}
for (const role of ["C", "Reserve"]) for (const duty of ["", "yes", "no_unless_needed", "never"]) for (const allowed of [false, true]) {
  test(`${role}/${duty || "空欄"}/月許可${allowed}: 一般2名の15回ずつを維持`, () => {
    const { rules, month } = inputs(role, duty, allowed), before = JSON.stringify({ rules, month });
    const result = T.autoTargets(rules, month);
    assert.strictEqual(result.slots, 30);
    assert.strictEqual(result.quotaSum, 30, "予備の目安は通常勤務の合計に加えない");
    assert.deepStrictEqual(result.targets, {}, "一般職員の目安を不要に減らさず、予備の自動目標も作らない");
    assert.strictEqual(JSON.stringify({ rules, month }), before, "保存済みの目標と履歴は直接変更しない");
  });
}
test("役割ID C でも予備でなければ通常の目標計算に含む", () => {
  const { rules, month } = inputs("C", "yes", false, false);
  rules.doctors[1].quota = 12; rules.doctors[2].quota = 3;
  const result = T.autoTargets(rules, month);
  assert.strictEqual(result.quotaSum, 30);
  assert.deepStrictEqual(result.targets, {});
});
test("通常職員の目安が計32なら30枠に向け各1回減らす", () => {
  const { rules, month } = inputs("Reserve", "yes", false);
  rules.doctors[0].quota = rules.doctors[1].quota = 16;
  const result = T.autoTargets(rules, month);
  assert.strictEqual(result.quotaSum, 32);
  assert.deepStrictEqual(result.targets, { "Synthetic A": 15, "Synthetic B": 15 });
});
console.log(`予備の当月目標: ${passed} 件通過、${failed} 件失敗`);
if (failed) process.exitCode = 1;

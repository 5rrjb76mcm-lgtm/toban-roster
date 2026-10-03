// 固定したときだけの職員は目標の対象外。固定勤務が埋めた人数を一般職員の目標から差し引く。
// 名簿・月・履歴はすべてこの試験専用の架空データ。node test_fixed_only_targets_node.js [highs のパス]
const fs = require("fs"), path = require("path"), vm = require("vm"), assert = require("assert");
globalThis.T = {};
for (const f of ["i18n.js", "rules-core.js", "model.js", "messages.js", "solver.js", "check.js"])
  vm.runInThisContext(fs.readFileSync(path.join(__dirname, "src", f), "utf8"), { filename: f });
for (const f of fs.readdirSync(path.join(__dirname, "src/rules")).filter(f => f.endsWith(".js")))
  vm.runInThisContext(fs.readFileSync(path.join(__dirname, "src/rules", f), "utf8"), { filename: "rules/" + f });

const A = "Synthetic A", B = "Synthetic B", F = "Synthetic Fixed", G = "Synthetic Fixed Two";
function inputs(o = {}) {
  const rules = {
    profile: { id: "synthetic-fixed-only-targets", quota_mode: o.mode || "absolute",
      roles: [{ id: "Staff", label: "Staff", refs: [] }, { id: "C", label: "Test role", refs: o.reserve ? ["reserve"] : [] }],
      shifts: [{ id: "day", on: "none" }, { id: "night", on: "all" }],
      ...(o.work ? { positions: { work: o.work } } : {}) },
    doctors: [{ name: A, team: "Staff", quota: o.qa ?? 14, share: o.sa ?? 1 },
      { name: B, team: "Staff", quota: o.qb ?? 14, share: o.sb ?? 1 },
      { name: F, team: "C", duty: "fixed_only", quota: o.qf ?? 10, share: o.sf ?? 1 },
      ...(o.twoFixed ? [{ name: G, team: "Staff", duty: "fixed_only", quota: 10, share: 50 }] : [])],
    quota_tolerance: o.tol ?? 1,
    weights: { target_deviation: 1, chief_duty: 0 }, rule_states: {}
  };
  if (o.noFixedOnly) rules.doctors = rules.doctors.filter(d => d.duty !== "fixed_only");
  T.fillDefaultRules(rules);
  for (const def of T.RULE_DEFS) if (def.states.includes("off")) rules.rule_states[def.id] = "off";
  rules.rule_states.fixed_only = o.state || "hard";
  const month = T.normalizeMonth({ year: 2026, month: 11, allow_chief_duty: !!o.allowed,
    fixed: o.fixed || { night: { 1: F, 2: F } },
    targets: { [F]: 99 }, history: { work_balance: { [F]: 40 } } }, rules);
  return { rules, month };
}
function inspect(o, fn) {
  const { rules, month } = inputs(o), before = JSON.stringify({ rules, month });
  const P = new T.Problem(rules, month), at = T.autoTargets(rules, month);
  fn(P, at, rules, month);
  assert.strictEqual(JSON.stringify({ rules, month }), before, "保存済みの目安・固定・目標・履歴を変更しない");
}
function auto(at, slots, quotaSum, targets = {}) {
  assert.strictEqual(at.slots, slots, "一般職員が受け持つ残りの必要人数");
  assert.strictEqual(at.quotaSum, quotaSum, "目標の対象になる職員だけの目安合計");
  assert.deepStrictEqual(at.targets, targets);
  assert.ok(!Object.hasOwn(at.targets, F) && !Object.hasOwn(at.targets, G), "固定専用の自動目標を作らない");
}
function shares(P, need, qa, qb) {
  assert.strictEqual(P.shareInfo.need, need);
  assert.strictEqual(P.quota(A), qa);
  assert.strictEqual(P.quota(B), qb);
  assert.strictEqual(P.quota(F), 0);
  if (P.doctors[G]) assert.strictEqual(P.quota(G), 0);
}
let passed = 0, failed = 0, solverCases = 0;
function test(label, fn) {
  try { fn(); passed++; console.log("ok  ", label); }
  catch (e) { failed++; console.log("FAIL", label, "\n    ", e.message); }
}

for (const state of ["hard", "off"]) {
  for (const qf of [0, 10]) test(`${state}: 固定専用の目安${qf}によらず一般14回ずつを維持`, () =>
    inspect({ state, qf }, (P, at) => { assert.strictEqual(P.isExempt(F), true); auto(at, 28, 28); }));
  test(`${state}: 固定なしの固定専用目安は一般15回ずつに影響しない`, () =>
    inspect({ state, qa: 15, qb: 15, fixed: {} }, (_, at) => auto(at, 30, 30)));
  test(`${state}: 固定2回分を一般15回ずつから14回ずつへ減らす`, () =>
    inspect({ state, qa: 15, qb: 15 }, (_, at) => auto(at, 28, 30, { [A]: 14, [B]: 14 })));
  for (const sf of [0, 1, 100]) test(`${state}: 固定専用の比重${sf}を除き残り28回を按分`, () =>
    inspect({ state, mode: "share", sf }, (P, at) => { shares(P, 28, 14, 14); assert.strictEqual(P.shareInfo.W, 2); auto(at, 28, 28); }));
  test(`${state}: 固定がなければ30回すべて一般職員へ按分`, () =>
    inspect({ state, mode: "share", fixed: {} }, (P, at) => { shares(P, 30, 15, 15); auto(at, 30, 30); }));
}

test("勤務帯なし・翌月・範囲外・OC・主担当の固定は実勤務から差し引かない", () =>
  inspect({ mode: "share", fixed: { night: { 0: F, 1: F, 2: F, 31: F, 32: F }, day: { 3: F }, night_oc: { 4: [F] }, weekend_charge: { 7: F } } },
    (P, at) => { shares(P, 28, 14, 14); auto(at, 28, 28); }));
test("同じ勤務枠の同一人物を重複して固定しても1人分だけ差し引く", () =>
  inspect({ mode: "share", fixed: { night: { 1: [F, F] } } }, (P, at) => { shares(P, 29, 15, 14); auto(at, 29, 29); }));
test("一般職員の固定は本人の目標に含まれるため二重に差し引かない", () =>
  inspect({ mode: "share", fixed: { night: { 1: F, 2: A } } }, (P, at) => { shares(P, 29, 15, 14); auto(at, 29, 29); }));
test("名簿にない固定名を一般職員の目標から差し引かない", () =>
  inspect({ mode: "share", fixed: { night: { 1: F, 2: "Synthetic Unknown" } } }, (P, at) => { shares(P, 29, 15, 14); auto(at, 29, 29); }));
test("1枠2人の固定は人数で数え、2枠に計3人なら残り57回", () =>
  inspect({ mode: "share", twoFixed: true, work: { count: 2 }, fixed: { night: { 1: [F, G], 2: F } } },
    (P, at) => { shares(P, 57, 29, 28); auto(at, 57, 57); }));
test("理想1人の枠へ固定専用2人を置いても他の29枠の必要人数を減らさない", () =>
  inspect({ mode: "share", twoFixed: true, work: { count: 2, min: 1, ideal: 1 }, fixed: { night: { 1: [F, G] } } },
    (P, at) => { shares(P, 29, 15, 14); auto(at, 29, 29); }));
test("理想1人の枠で一般と固定専用を同時固定したら一般固定1人も目標に含める", () =>
  inspect({ mode: "share", sf: 0, work: { count: 2, min: 1, ideal: 1 }, fixed: { night: { 1: [A, F] } } },
    (P, at) => { shares(P, 30, 15, 15); auto(at, 30, 30); }));
test("一般と固定専用の同枠固定が重複していても各1人として数える", () =>
  inspect({ mode: "share", sf: 0, work: { count: 2, min: 1, ideal: 1 }, fixed: { night: { 1: [A, A, F, F] } } },
    (P, at) => { shares(P, 30, 15, 15); auto(at, 30, 30); }));
test("固定専用がいなくても一般2人の固定が理想1人を超えれば目標は31回", () =>
  inspect({ mode: "share", noFixedOnly: true, work: { count: 2, min: 1, ideal: 1 }, fixed: { night: { 1: [A, B] } } },
    (P, at) => { shares(P, 31, 16, 15); auto(at, 31, 31); }));
test("比重1対2の一般職員へ固定3回を除いた27回を9対18で按分", () =>
  inspect({ mode: "share", sb: 2, sf: 100, fixed: { night: { 1: F, 2: F, 3: F } } },
    (P, at) => { shares(P, 27, 9, 18); auto(at, 27, 27); }));
test("全勤務枠を固定専用が埋めた場合は一般職員への按分が0回", () =>
  inspect({ mode: "share", fixed: { night: Object.fromEntries(Array.from({ length: 30 }, (_, i) => [i + 1, F])) } },
    (P, at) => { shares(P, 0, 0, 0); auto(at, 0, 0); }));
for (const state of ["hard", "off"]) for (const allowed of [false, true]) test(`${state}: 予備兼固定専用は当月勤務許可${allowed}の固定だけ数える`, () =>
  inspect({ state, mode: "share", reserve: true, allowed, fixed: { night: { 1: F } } },
    (P, at) => { assert.strictEqual(P.workAllowed(F), allowed); shares(P, allowed ? 29 : 30, 15, allowed ? 14 : 15); auto(at, allowed ? 29 : 30, allowed ? 29 : 30); }));
test("役割Cでも予備でなければ当月の予備許可なしで固定分を数える", () =>
  inspect({ mode: "share", allowed: false }, (P, at) => { assert.strictEqual(P.isRole(F, "reserve"), false); shares(P, 28, 14, 14); auto(at, 28, 28); }));
test("固定専用がいない既存の一般職員の按分と目標を保つ", () => {
  const { rules, month } = inputs({ mode: "share", fixed: {}, qa: 15, qb: 15 });
  rules.doctors = rules.doctors.filter(d => d.name !== F);
  const before = JSON.stringify({ rules, month }), P = new T.Problem(rules, month), at = T.autoTargets(rules, month);
  assert.strictEqual(P.quota(A), 15); assert.strictEqual(P.quota(B), 15); auto(at, 30, 30);
  assert.strictEqual(JSON.stringify({ rules, month }), before);
});

(async () => {
  if (process.argv[2]) {
    const highs = await require(process.argv[2])();
    function solveCase(label, o, expected) {
      test(label, () => {
        const { rules, month } = inputs({ ...o, tol: 0 });
        rules.rule_states.quota_range = "hard"; rules.rule_states.quota_target = "soft";
        const before = JSON.stringify({ rules, month });
        const at = T.autoTargets(rules, month), P = new T.Problem(rules, { ...month, targets: at.targets });
        const result = T.solve(P, highs, { timeLimit: 10, mipGap: 0 });
        assert.strictEqual(result.status, "Optimal");
        const count = n => P.slots.filter(s => [].concat(result.asg[`${s[0]}:${s[1]}`].work || []).includes(n)).length;
        for (const [n, want] of Object.entries(expected)) assert.strictEqual(count(n), want, `${n} の実勤務回数`);
        assert.strictEqual(result.objective, 0, "目標とのずれがない");
        assert.strictEqual(T.penalty(P, result.asg).total, 0, "検算の減点も一致");
        assert.deepStrictEqual(T.check(P, result.asg).V, [], "必須条件違反なし");
        assert.strictEqual(JSON.stringify({ rules, month }), before, "解く前の保存データを変更しない");
        solverCases++;
      });
    }
    for (const state of ["hard", "off"]) {
      solveCase(`${state}: 絶対目安14回ずつと固定2回で解ける`, { state }, { [A]: 14, [B]: 14, [F]: 2 });
      solveCase(`${state}: 固定なしの相対按分は一般15回ずつで解ける`, { state, mode: "share", fixed: {} }, { [A]: 15, [B]: 15, [F]: 0 });
      for (const sf of [0, 1]) solveCase(`${state}: 固定専用比重${sf}の相対按分は一般14回ずつと固定2回で解ける`,
        { state, mode: "share", sf }, { [A]: 14, [B]: 14, [F]: 2 });
    }
    solveCase("理想人数を超える固定2人と残り29枠を同時に満たせる", { mode: "share", twoFixed: true,
      work: { count: 2, min: 1, ideal: 1 }, fixed: { night: { 1: [F, G] } } }, { [A]: 15, [B]: 14, [F]: 1, [G]: 1 });
    solveCase("一般と固定専用の同枠固定を含めた一般30回と固定専用1回で解ける", { mode: "share", sf: 0,
      work: { count: 2, min: 1, ideal: 1 }, fixed: { night: { 1: [A, F] } } }, { [A]: 15, [B]: 15, [F]: 1 });
    solveCase("固定専用がいない一般2人の同枠固定を含めた31回で解ける", { mode: "share", noFixedOnly: true,
      work: { count: 2, min: 1, ideal: 1 }, fixed: { night: { 1: [A, B] } } }, { [A]: 16, [B]: 15 });
    solveCase("許可した予備兼固定専用の固定1回と一般29回で解ける", { mode: "share", reserve: true, allowed: true,
      fixed: { night: { 1: F } } }, { [A]: 15, [B]: 14, [F]: 1 });
  } else console.log("（highs のパス指定が無いので、ソルバーによる12例の検証は未実行）");
  console.log(`固定専用の当月目標: ${passed} 件通過、${failed} 件失敗（ソルバー ${solverCases} 件通過）`);
  if (failed) process.exitCode = 1;
})().catch(e => { console.error(e.message); process.exitCode = 1; });

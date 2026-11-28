// 1 枠の人数の下限を片方の勤務帯（日の種別）にだけ書いたとき、書いていない勤務帯は固定（上限と同じ）になる。
// モデルの下限・入力チェック・設定の要約・実 HiGHS の結果・検算が同じ下限を使うことを確かめる。名簿・月はすべて架空。
// 変えていない挙動の対照: 下限なし＝固定、空の min＝1、明示的に空の枝＝1、入れ子の中、1 枠 1 名の既定。
// node test_partial_minimum_solver_node.js <highs パッケージのパス>
const fs = require("fs"), vm = require("vm"), path = require("path"), assert = require("assert");
globalThis.T = {};
for (const f of ["i18n.js", "rules-core.js", "model.js", "messages.js", "solver.js", "check.js"])
  vm.runInThisContext(fs.readFileSync(path.join(__dirname, "src", f), "utf8"), { filename: f });
for (const f of fs.readdirSync(path.join(__dirname, "src/rules")).filter(f => f.endsWith(".js")).sort())
  vm.runInThisContext(fs.readFileSync(path.join(__dirname, "src/rules", f), "utf8"), { filename: "rules/" + f });
for (const f of fs.readdirSync(path.join(__dirname, "lang")).filter(f => f.endsWith(".json")).sort()) T.registerLang(JSON.parse(fs.readFileSync(path.join(__dirname, "lang", f), "utf8")));
const highsPath = process.argv[2];
if (!highsPath) { console.log("（highs のパス指定が無いので、部分的な下限の試験は省略）"); process.exit(0); }

const NAMES = ["Synthetic Alpha", "Synthetic Beta", "Synthetic Gamma", "Synthetic Delta"];
const HIGH = "LINT_CAPACITY_HIGH";
// 2026/11: 平日 21 日、土日 9 日（祝日なし）。日勤・夜勤とも毎日なので枠は 30 + 30
function problem(work, quota) {
  const rules = { profile: { id: "synthetic-partial-minimum", quota_mode: "absolute", roles: [{ id: "Staff", label: "Staff", refs: [], standby: false }],
      shifts: [{ id: "day", on: "all" }, { id: "night", on: "all" }], positions: work === undefined ? undefined : { work } },
    doctors: NAMES.map(name => ({ name, team: "Staff", quota })), quota_tolerance: 0, weights: {}, rule_states: {} };
  T.fillDefaultRules(rules);
  for (const def of T.RULE_DEFS) if (def.states.includes("off")) rules.rule_states[def.id] = "off";
  rules.rule_states.quota_range = "hard";
  return new T.Problem(rules, T.normalizeMonth({ year: 2026, month: 11, holidays: [] }, rules));
}
// 代表の枠: 平日の日勤・夜勤、土日の日勤・夜勤
const slotOf = (P, kind, holiday) => P.slots.find(s => s[1] === kind && P.isHoliday(s[0]) === holiday);
const ranges = P => Object.fromEntries([["day", false], ["night", false], ["day", true], ["night", true]].map(([k, h]) => { const s = slotOf(P, k, h); return [`${h ? "off" : "wd"}:${k}`, `${P.countMinOf(s)}..${P.countOf(s)}`]; }));
const summaryLine = P => { const g = (T.rulesSummary(P) || []).flatMap(x => x.items).find(i => /1枠|per slot/.test(i)); assert.ok(g, "summary has the staffing line"); return g; };
const staffing = (P, kind, range) => `${P.shiftLabel(kind)}（毎日・1枠 ${range} 人）`;

// [label, work, quota per person, expected ranges, expected solver status, expected lint codes, per-kind size assertion]
const cases = [
  // 不具合の場面（基準の版では、書いていない勤務帯の下限が 1 になる）
  ["片方だけの下限: 空欄の夜勤は固定（人手が足りなければ解なしと警告）", { count: { day: 2, night: 2 }, min: { day: 1 } }, 15,
    { "wd:day": "1..2", "wd:night": "2..2", "off:day": "1..2", "off:night": "2..2" }, "Infeasible", [HIGH]],
  ["片方だけの下限: 人手が足りれば全部の夜勤が 2 名", { count: { day: 2, night: 2 }, min: { day: 1 } }, 25,
    { "wd:day": "1..2", "wd:night": "2..2", "off:day": "1..2", "off:night": "2..2" }, "Optimal", [], { night: n => n === 2, day: n => n >= 1 && n <= 2 }],
  ["夜勤だけの下限: 空欄の日勤は 3 名で固定", { count: { day: 3, night: 2 }, min: { night: 1 } }, 15,
    { "wd:day": "3..3", "wd:night": "1..2", "off:day": "3..3", "off:night": "1..2" }, "Infeasible", [HIGH]],
  ["日の種別ごと: 平日だけの下限なら土日は固定", { count: { weekday: 2, off_days: 2 }, min: { weekday: 1 } }, 15,
    { "wd:day": "1..2", "wd:night": "1..2", "off:day": "2..2", "off:night": "2..2" }, "Infeasible", [HIGH]],
  ["片方だけの下限 0: 他方は固定", { count: { day: 2, night: 2 }, min: { day: 0 } }, 15,
    { "wd:day": "0..2", "wd:night": "2..2", "off:day": "0..2", "off:night": "2..2" }, "Optimal", [], { night: n => n === 2, day: n => n >= 0 && n <= 2 }],
  ["上限より大きい下限は上限で固定、他方も固定", { count: { day: 2, night: 2 }, min: { day: 5 } }, 30,
    { "wd:day": "2..2", "wd:night": "2..2", "off:day": "2..2", "off:night": "2..2" }, "Optimal", [], { night: n => n === 2, day: n => n === 2 }],
  ["日勤の下限が入れ子でも、書いていない夜勤は固定（入れ子の中は見ない: 土日の日勤は 1 から）", { count: { day: 2, night: 2 }, min: { day: { weekday: 0 } } }, 20,
    { "wd:day": "0..2", "wd:night": "2..2", "off:day": "1..2", "off:night": "2..2" }, "Optimal", []],
  // 変えていない挙動の対照
  ["対照: 下限なしは固定", { count: { day: 2, night: 2 } }, 30,
    { "wd:day": "2..2", "wd:night": "2..2", "off:day": "2..2", "off:night": "2..2" }, "Optimal", [], { night: n => n === 2, day: n => n === 2 }],
  ["対照: 空の min {} は両方 1 から", { count: 2, min: {} }, 15,
    { "wd:day": "1..2", "wd:night": "1..2", "off:day": "1..2", "off:night": "1..2" }, "Optimal", []],
  ["対照: min null は両方 1 から", { count: 2, min: null }, 15,
    { "wd:day": "1..2", "wd:night": "1..2", "off:day": "1..2", "off:night": "1..2" }, "Optimal", []],
  ["対照: 明示的に空の枝だけ {day: null} は両方 1 から", { count: 2, min: { day: null } }, 15,
    { "wd:day": "1..2", "wd:night": "1..2", "off:day": "1..2", "off:night": "1..2" }, "Optimal", []],
  ["対照: 明示的に空の枝は日の種別の指定より優先して 1", { count: 3, min: { day: "", weekday: 0, off_days: 2 } }, 20,
    { "wd:day": "1..3", "wd:night": "0..3", "off:day": "1..3", "off:night": "2..3" }, "Optimal", []],
  ["対照: 1 枠 1 名の既定で片方に下限 0", { count: 1, min: { day: 0 } }, 10,
    { "wd:day": "0..1", "wd:night": "1..1", "off:day": "0..1", "off:night": "1..1" }, "Optimal", [], { night: n => n === 1 }],
  ["対照: positions が無い医師の既定は 1 名で固定", undefined, 15,
    { "wd:day": "1..1", "wd:night": "1..1", "off:day": "1..1", "off:night": "1..1" }, "Optimal", []],
];
const EXPECTED_CASES = cases.length + 1;
let passed = 0, failed = 0, finished = false;
process.on("exit", () => { if (!finished || passed + failed !== EXPECTED_CASES || failed) { console.error(`NOT PASSED: ${passed}/${EXPECTED_CASES}, ${failed} failed, finished=${finished}`); process.exitCode = 1; } });
function test(label, fn) { try { fn(); passed++; console.log("ok  ", label); } catch (e) { failed++; console.log("FAIL", label, "\n    ", e.message.split("\n").slice(0, 6).join("\n    ")); } }
(async () => {
  assert.strictEqual(cases.length, 14);
  const highs = await require(highsPath)();
  for (const [label, work, quota, want, status, lintCodes, size] of cases) test(label, () => {
    const P = problem(work, quota), before = JSON.stringify({ rules: P.rules, month: P.m });
    assert.deepStrictEqual(ranges(P), want, "model lower..upper per representative slot");
    // 設定の要約は同じ下限を使う（勤務帯の行に 1枠 n 人、幅があれば lo〜hi）
    const line = summaryLine(P), r = ranges(P), txt = (lo, hi) => lo === hi ? String(hi) : `${lo}〜${hi}`;
    for (const kind of ["day", "night"]) if (r[`wd:${kind}`] === r[`off:${kind}`]) { const [lo, hi] = r[`wd:${kind}`].split(".."); assert.ok(line.includes(staffing(P, kind, txt(lo, hi))), `summary says ${staffing(P, kind, txt(lo, hi))}: ${line}`); }
    assert.deepStrictEqual(T.lint(P).map(x => x.code), lintCodes, "input check codes");
    const result = T.solve(P, highs, { timeLimit: 20, mipGap: 0 });
    assert.strictEqual(result.status, status, "real HiGHS status");
    if (result.asg) {
      const checked = T.check(P, result.asg);
      assert.deepStrictEqual(checked.VC, [], "independent check: no mandatory violation");
      for (const kind of ["day", "night"]) for (const s of P.slots.filter(s => s[1] === kind)) { const n = checked.A.workers(s).length; assert.ok(n >= P.countMinOf(s) && n <= P.countOf(s), `${s.join(":")} has ${n} workers within ${P.countMinOf(s)}..${P.countOf(s)}`); if (size && size[kind]) assert.ok(size[kind](n), `${s.join(":")} has ${n} workers`); }
    }
    assert.strictEqual(JSON.stringify({ rules: P.rules, month: P.m }), before, "inputs unchanged");
  });
  test("下限の決まりの補助関数（モデルと設定画面が共有）", () => {
    assert.strictEqual(typeof T.workerMinUnwritten, "function"); assert.strictEqual(typeof T.staffingWritten, "function");
    // 平日の夜勤から見て: 日勤に値がある → 書いていない（固定）。夜勤か平日に値や空の枝がある、ほかが空、min が object でない → false
    assert.deepStrictEqual([{ day: 1 }, { night: 0 }, { day: {} }, { day: null }, {}, null, 0, { weekday: 1 }].map(m => T.workerMinUnwritten(m, "night", false)), [true, false, false, false, false, false, false, false]);
    assert.strictEqual(T.workerMinUnwritten({ weekday: 1 }, "night", true), true, "weekend slot: only the weekday minimum is written");
    assert.deepStrictEqual([1, 0, {}, { weekday: 0 }, null, "", [], [1]].map(T.staffingWritten), [true, true, false, true, false, false, false, false]);
  });
  finished = true;
  console.log(`partial minimum (model, summary, lint, real HiGHS, check): ${passed}/${EXPECTED_CASES} passed, ${failed} failed`);
  if (failed) process.exitCode = 1;
})().catch(e => { console.error(e); process.exitCode = 1; });

// 前月の履歴の取り込みは、変換を終えてから当月へ反映する。データはすべて架空。
const fs = require("fs"), vm = require("vm"), path = require("path"), assert = require("assert");
globalThis.location = { pathname: "/test/toban.html" };
globalThis.localStorage = { setItem() { } };
globalThis.document = { querySelector: () => null };
globalThis.T = {};
for (const f of ["i18n.js", "rules-core.js", "model.js", "messages.js", "check.js", "app-core.js", "app-folder.js", "app-month.js"])
  vm.runInThisContext(fs.readFileSync(path.join(__dirname, "src", f), "utf8"), { filename: f });
for (const f of fs.readdirSync(path.join(__dirname, "src/rules")).filter(f => f.endsWith(".js")))
  vm.runInThisContext(fs.readFileSync(path.join(__dirname, "src/rules", f), "utf8"), { filename: f });
const A = T.app, clone = x => JSON.parse(JSON.stringify(x));
let source, sourceTag, saved, rendered, alerts, toasts;
// ファイルを読む実際の入口（findMonthData/readJson）を通す。書き込みは認めない。
const dir = {
  getDirectoryHandle: async () => dir,
  getFileHandle: async name => {
    assert.strictEqual(name, sourceTag + "_data.json");
    return { getFile: async () => ({ text: async () => JSON.stringify(source) }) };
  }
};
A.refreshMonths = async () => { };
A.readAll = () => { };
A.save = () => { saved++; };
for (const k of ["renderSettingsMonth", "renderDoctor", "renderFixed"]) A[k] = () => { rendered++; };
A.toast = x => toasts.push(String(x));
globalThis.alert = x => alerts.push(String(x));
function setup(y = 2026, m = 10, last = 31) {
  saved = rendered = 0; alerts = []; toasts = [];
  const rules = { profile: { id: "test" }, doctors: [{ name: "Test A", team: "I" }, { name: "Test B", team: "I" }] };
  T.fillDefaultRules(rules);
  const ny = m === 12 ? y + 1 : y, nm = m === 12 ? 1 : m + 1;
  Object.assign(A.state, {
    rules,
    month: { year: ny, month: nm, history: { work_balance: { "Test A": 9 } }, prev_month: { last_days: [{ date: last, night: "Test A" }] }, fixed: { night: { 1: "Test A" } }, notes: "keep me" },
    result: { asg: {} }, meta: { savedSig: "before" }, base: { year: ny, month: nm }, baseRules: clone(rules), renames: [["Old A", "Test A"]], ui: { doctor: 0 }
  });
  sourceTag = `${y}${String(m).padStart(2, "0")}`;
  A.dirHandle = dir; A.monthDirs = [sourceTag]; A.solving = false; A.switching = 0;
  source = { rules: clone(rules), month: { year: y, month: m, history: { work_balance: { "Test A": 2 }, weekend_charge: { "Test A": 3 }, holiday_charge: { "Test B": 4 } }, fixed: { night: { [last + 1]: "Test B" } } }, result: { asg: {} } };
}
async function failsSafely(edit) {
  setup(); edit();
  const before = JSON.stringify(A.state), refs = { ...A.state };
  await assert.doesNotReject(A.importPrevious(), "不正な前月データの例外を利用者に通知する");
  assert.strictEqual(JSON.stringify(A.state), before, "当月の累計・接続・固定・計算結果・同期基準をすべて保持する");
  for (const k of Object.keys(refs)) assert.strictEqual(A.state[k], refs[k], k + " の参照を保持する");
  assert.strictEqual(saved, 0, "失敗した取り込みを保存しない");
  assert.strictEqual(rendered, 0);
  assert.strictEqual(alerts.length, 1, "失敗を1回通知する");
  assert.strictEqual(A.switching, 0, "失敗後も操作できる");
}
(async () => {
  await failsSafely(() => { source.rules.doctors = [null]; });
  const check = T.check;
  try {
    await failsSafely(() => { T.check = () => { throw new Error("fixture check failure"); }; });
  } finally { T.check = check; }
  // 保存データの包み付き形式と、findMonthData が受け付ける旧形式（月そのもの）を同じように取り込む。
  // 12→1 と閏年2→3では、前月のファイル名と翌月1日欄の日付も確かめる。
  for (const [y, m, last] of [[2026, 10, 31], [2026, 12, 31], [2028, 2, 29]]) for (const bare of [false, true]) {
    setup(y, m, last); source.result = null; if (bare) source = source.month;
    const before = A.state.month, other = { rules: A.state.rules, result: A.state.result, meta: A.state.meta, base: A.state.base, baseRules: A.state.baseRules, renames: A.state.renames };
    await A.importPrevious();
    assert.notStrictEqual(A.state.month, before, "成功した変換をまとめて採用する");
    assert.strictEqual(A.state.month.history.work_balance["Test A"], 2, `${sourceTag} ${bare ? "旧形式" : "包み付き"}: 累計を取り込む`);
    assert.strictEqual(A.state.month.history.weekend_charge["Test A"], 3);
    assert.strictEqual(A.state.month.history.holiday_charge["Test B"], 4);
    assert.deepStrictEqual(A.state.month.prev_month.last_days, []);
    assert.strictEqual(A.state.month.fixed.night[1], "Test B");
    assert.strictEqual(A.state.month.notes, "keep me", "取り込みと無関係な当月の入力を保持する");
    assert.strictEqual(before.fixed.night[1], "Test A", "元の月の写しは変更しない");
    for (const k of Object.keys(other)) assert.strictEqual(A.state[k], other[k]);
    assert.strictEqual(saved, 1); assert.strictEqual(rendered, 3); assert.strictEqual(alerts.length, 0);
    assert.ok(toasts.some(x => /取り込みました/.test(x)));
    assert.ok(!toasts.some(x => /NaN/.test(x)), "前月の年月を正しく読む");
  }
  // 旧形式でも、別施設の月は既存の確認を経て取り込む。キャンセルは何も変えない。
  setup(); source = source.month; source.profile_id = "other-test";
  const beforeCancel = JSON.stringify(A.state), choose = A.choose; let asked = 0;
  try { A.choose = async msg => { asked++; assert.ok(msg.includes("other-test")); return null; }; await A.importPrevious(); }
  finally { A.choose = choose; }
  assert.strictEqual(asked, 1); assert.strictEqual(JSON.stringify(A.state), beforeCancel);
  assert.strictEqual(saved, 0); assert.strictEqual(rendered, 0); assert.strictEqual(alerts.length, 0);
  console.log("前月履歴の取り込み: 包み付き・旧形式、年越し・閏年、失敗・別施設キャンセル時の状態保持 OK");
})().catch(e => { console.error(e); process.exitCode = 1; });

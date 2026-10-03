// 設定の読み込みに失敗しても、編集中の月・設定・取り消し履歴を壊さない。架空データのみ。
const fs = require("fs"), vm = require("vm"), path = require("path"), assert = require("assert");
const elements = new Map();
function element(sel) {
  if (!elements.has(sel)) elements.set(sel, { handlers: {}, value: "", textContent: "", disabled: false,
    addEventListener(type, fn) { (this.handlers[type] ||= []).push(fn); }, querySelectorAll() { return []; } });
  return elements.get(sel);
}
globalThis.location = { pathname: "/test/settings-import.html" };
globalThis.localStorage = { getItem() { return null; }, setItem() { } };
globalThis.document = { querySelector: element, querySelectorAll() { return []; } };
globalThis.confirm = () => true;
globalThis.T = {};
for (const f of ["i18n.js", "rules-core.js", "model.js", "messages.js", "app-core.js", "app-settings.js"])
  vm.runInThisContext(fs.readFileSync(path.join(__dirname, "src", f), "utf8"), { filename: f });
for (const f of fs.readdirSync(path.join(__dirname, "src/rules")).filter(f => f.endsWith(".js")))
  vm.runInThisContext(fs.readFileSync(path.join(__dirname, "src/rules", f), "utf8"), { filename: f });
const A = T.app, clone = x => JSON.parse(JSON.stringify(x));
T.DEFAULT_RULES = JSON.parse(fs.readFileSync(path.join(__dirname, "data/rules.json"), "utf8"));
let alerts, saves, toasts, unhandled = [];
globalThis.alert = x => alerts.push(String(x));
process.on("unhandledRejection", e => unhandled.push(e));
A.save = () => saves++;
for (const name of ["renderHeader", "renderSettingsMonth", "renderDoctor", "renderFixed", "renderAll"]) A[name] = () => { };
A.toast = x => toasts.push(String(x));
A.bindSettings();
function setup() {
  alerts = []; saves = 0; toasts = []; unhandled = [];
  const rules = { profile: { id: "fictional-import" }, doctors: [{ name: "Test A", team: "I" }, { name: "Test B", team: "Y" }] };
  T.fillDefaultRules(rules);
  Object.assign(A.state, { rules, month: T.normalizeMonth({ year: 2026, month: 11, notes: "keep this input", unavailable_night: { "Test A": [4] } }, rules),
    result: { asg: {} }, meta: { savedSig: "before" }, base: { year: 2026, month: 11 }, baseRules: clone(rules), renames: [], ui: { doctor: 0 } });
  A.dirHandle = null; A.solving = false; A.switching = 0; A.clearUndo();
}
async function jsonInput(rules) {
  element("#rulesJson").value = JSON.stringify(rules);
  await element("#btnApplyRules").handlers.click[0]();
}
async function profileInput(rules) {
  const target = { id: "fileLoadProfile", files: [{ name: "fictional-profile.json", text: async () => JSON.stringify(rules) }], value: "", closest() { return null; } };
  for (const fn of element("#settings").handlers.change) fn({ target });
  await new Promise(resolve => setImmediate(resolve));
}
async function bundledInput(rules) {
  const profile = clone(rules); profile.profile.id = "fictional-bundle";
  T.PROFILES = [profile]; await A.loadProfileById(profile.profile.id);
}
async function rejected(importer, edit) {
  setup();
  A.pushUndo("prior valid edit");
  const undoLabel = element("#undoNote").textContent;
  const bad = clone(A.state.rules); edit(bad);
  const before = JSON.stringify(A.state), refs = { ...A.state };
  await importer(bad);
  assert.strictEqual(unhandled.length, 0, "読み込み失敗を未処理例外にしない");
  assert.strictEqual(alerts.length, 1, "失敗を1回通知する");
  assert.strictEqual(JSON.stringify(A.state), before, "失敗時は状態を一切置き換えない");
  for (const k of Object.keys(refs)) assert.strictEqual(A.state[k], refs[k], k + " の参照を保持する");
  assert.strictEqual(element("#undoNote").textContent, undoLabel, "失敗した読み込みを取り消し履歴に積まない");
  assert.strictEqual(saves, 0);
  assert.strictEqual(A.switching, 0);
  assert.doesNotThrow(() => A.undo(), "失敗前の取り消し履歴を引き続き使える");
}
(async () => {
  for (const importer of [jsonInput, profileInput, bundledInput]) {
    await rejected(importer, r => { r.doctors = [null]; });
    await rejected(importer, r => { r.doctors = [{ team: "I" }]; });
    await rejected(importer, r => { r.name_order = 1; }); // 名簿の浅い型検査だけではなく正規化の失敗も保全
  }
  for (const importer of [jsonInput, profileInput, bundledInput]) {
    setup(); const before = JSON.stringify(A.state), normalize = T.normalizeMonth;
    try {
      T.normalizeMonth = m => { m.notes = "partial conversion"; throw new Error("synthetic normalization failure"); };
      await importer(clone(A.state.rules));
    } finally { T.normalizeMonth = normalize; }
    assert.strictEqual(JSON.stringify(A.state), before, "月の正規化が途中で失敗しても入力を保つ");
    assert.strictEqual(alerts.length, 1); assert.strictEqual(unhandled.length, 0); assert.strictEqual(saves, 0);
    assert(element("#btnUndo").disabled, "失敗した変換は取り消し履歴を作らない");
  }
  for (const importer of [jsonInput, profileInput, bundledInput]) {
    setup(); const oldRules = A.state.rules, oldMonth = A.state.month, oldMonthText = JSON.stringify(oldMonth);
    const incoming = clone(oldRules); incoming.quota_tolerance = 2;
    await importer(incoming);
    assert.strictEqual(alerts.length, 0); assert.strictEqual(unhandled.length, 0);
    assert.strictEqual(A.state.rules.quota_tolerance, 2);
    assert.strictEqual(A.state.month.notes, "keep this input");
    assert.strictEqual(JSON.stringify(oldMonth), oldMonthText, "採用前の月の参照は変更しない");
    assert.strictEqual(saves, 1, "成功時だけ保存する");
    assert.strictEqual(oldRules.quota_tolerance, 1);
    await new Promise(resolve => setImmediate(resolve));
    A.undo(); assert.strictEqual(A.state.rules.quota_tolerance, 1, "正常な読み込みは取り消せる");
  }
  // 数値の誤りは設定画面で修正できる形で保持する。計算では拒否し、取込や取消で月・結果を壊さない。
  for (const importer of [jsonInput, profileInput, bundledInput]) for (const [change, err] of [
    [r => { r.rule_states.quota_target = "soft"; r.weights.target_deviation = -1; }, /weights\.target_deviation/],
    [r => { r.rule_states.shift_count_range = "soft"; r.shift_counts = { night: { max: 14.5 } }; }, /shift_counts\.night\.max/],
  ]) {
    setup(); const rulesBefore = JSON.stringify(A.state.rules), monthBefore = JSON.stringify(A.state.month), result = A.state.result;
    const incoming = clone(A.state.rules); change(incoming); await importer(incoming);
    assert.strictEqual(alerts.length, 0); assert.strictEqual(unhandled.length, 0);
    assert.strictEqual(JSON.stringify(A.state.month), monthBefore); assert.strictEqual(A.state.result, result);
    assert.throws(() => new T.Problem(A.state.rules, A.state.month), err, "不正な数値で計算しない");
    await new Promise(resolve => setImmediate(resolve)); A.undo();
    assert.strictEqual(JSON.stringify(A.state.rules), rulesBefore); assert.strictEqual(JSON.stringify(A.state.month), monthBefore);
    assert.doesNotThrow(() => new T.Problem(A.state.rules, A.state.month), "取り消すと計算可能な設定に戻る");
  }
  setup(); const names = A.state.rules.doctors.map(d => d.name);
  await profileInput({ profile: { id: "fictional-without-roster" }, quota_tolerance: 2 });
  assert.strictEqual(unhandled.length, 0); assert.strictEqual(alerts.length, 0);
  assert.deepStrictEqual(A.state.rules.doctors.map(d => d.name), names, "名簿を含めない共有用プロファイルは既存の名簿を保つ");
  assert.strictEqual(A.state.rules.profile.id, "fictional-without-roster");
  console.log("設定読み込み: 不正名簿・正規化失敗時の状態/履歴保全、成功時反映/取り消し、名簿省略プロファイル OK");
})().catch(e => { console.error(e); process.exitCode = 1; });

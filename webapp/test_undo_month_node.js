// ヘッダーの「元に戻す」: 月別条件の入力（職員別カレンダーの不可日など）も戻せる。入力の画面は変更の直前に A.pushUndo(label, { auto: true }) を呼ぶ。
// 架空の名簿だけを使う。画面・保存フォルダは代替
const fs = require("fs"), path = require("path"), vm = require("vm"), assert = require("assert");
const elements = new Map();
globalThis.document = { querySelector(s) { if (!elements.has(s)) elements.set(s, { value: "", textContent: "", addEventListener() { } }); return elements.get(s); }, querySelectorAll: () => [], addEventListener() { } };
globalThis.window = globalThis; globalThis.location = { pathname: "/synthetic/undo-month.html", protocol: "file:" }; globalThis.localStorage = { getItem: () => null, setItem() { } };
globalThis.T = {};
for (const f of ["i18n.js", "rules-core.js", "model.js", "messages.js", "merge.js", "plugins.js", "app-core.js", "app-folder.js", "app-settings.js"]) vm.runInThisContext(fs.readFileSync(path.join(__dirname, "src", f), "utf8"), { filename: f });
for (const f of fs.readdirSync(path.join(__dirname, "src/rules")).filter(f => f.endsWith(".js"))) vm.runInThisContext(fs.readFileSync(path.join(__dirname, "src/rules", f), "utf8"), { filename: f });
const A = T.app, clone = o => JSON.parse(JSON.stringify(o)), N = ["Synthetic A", "Synthetic B", "Synthetic C"], tick = () => new Promise(r => setTimeout(r, 0));
for (const k of ["save", "renderAll", "renderHeader", "readAll"]) A[k] = () => { };
let toasts; A.toast = s => toasts.push(String(s));
const btn = () => document.querySelector("#btnUndo"), note = () => document.querySelector("#undoNote").textContent;
function setup() {
  const rules = { profile: { id: "synthetic-undo", roles: [{ id: "S", label: "Staff", refs: [] }] }, doctors: N.map(name => ({ name, team: "S" })), name_order: N.slice(), weights: { wish_night: 30 } }; T.fillDefaultRules(rules);
  const month = T.normalizeMonth({ year: 2026, month: 11, unavailable_night: { [N[0]]: [5] }, doc_versions: [{ ver: 1, sig: "s1" }] }, rules);
  Object.assign(A.state, { rules, month, result: { asg: { "1:night": { work: N[1], oc: [] } }, status: "Optimal", at: "t0" }, meta: null, base: null, baseRules: null, renames: [], ui: { doctor: 0 } });
  A.dirHandle = null; A.solving = false; A.clearUndo(); toasts = [];
}
const edit = async (label, fn) => { A.pushUndo(label, { auto: true }); fn(A.state.month); await tick(); }; // 入力の画面がすること: 直前に記録 → 読み戻しで月を書き換える
(async () => {
  // 1) 不可日の入力を戻す。結果も入力の前のものに戻り、版の記録（保存の履歴）は巻き戻さない
  setup(); assert.strictEqual(btn().disabled, true);
  await edit("{person}別カレンダーの変更", m => { m.unavailable_night[N[0]] = [5, 12]; }); assert.strictEqual(btn().disabled, false); assert.ok(/カレンダーの変更/.test(note()) && !/\{person\}/.test(note()), note());
  A.state.result = { asg: { "1:night": { work: N[2], oc: [] } }, status: "Optimal", at: "t1" }; A.state.month.doc_versions.push({ ver: 2, sig: "s2" }); // その後に計算し、保存で版が増えた
  A.undo(); assert.deepStrictEqual(A.state.month.unavailable_night[N[0]], [5], "不可日が戻る"); assert.strictEqual(A.state.result.at, "t0", "結果も入力の前のものに戻る"); assert.deepStrictEqual(A.state.month.doc_versions.map(v => v.ver), [1, 2], "版の記録は巻き戻さない"); assert.ok(toasts.some(t => /元に戻しました/.test(t))); assert.strictEqual(btn().disabled, true);
  // 2) 何も変わらなかった記録は残らない（職員の切替・欄の読み戻しが空値を補っただけ）
  setup(); await edit("{person}別カレンダーの変更", () => { }); assert.strictEqual(btn().disabled, true, "変化なしは記録しない");
  await edit("月別条件の変更", m => { m.allow_chief_duty = false; m.notes = null; m.unavailable_night[N[1]] = []; }); assert.strictEqual(btn().disabled, true, "空値を補っただけも記録しない");
  // 3) 続けた入力は新しい順に 1 つずつ戻る。設定の変更をはさんでも順に戻り、最後は月も設定も最初の状態
  setup(); const m0 = JSON.stringify(A.canon(A.state.month)), r0 = A.rulesSig(A.state.rules);
  await edit("{person}別カレンダーの変更", m => { m.unavailable_night[N[0]] = [5, 12]; });
  A.pushUndo("規則・重みの変更"); A.state.rules.weights.wish_night = 999; await tick();
  await edit("固定配置の変更", m => { m.fixed.night[7] = N[2]; });
  assert.ok(/あと 3 回/.test(note()), note());
  A.undo(); assert.strictEqual(A.state.month.fixed.night[7], undefined); assert.strictEqual(A.state.rules.weights.wish_night, 999); assert.deepStrictEqual(A.state.month.unavailable_night[N[0]], [5, 12]);
  A.undo(); assert.strictEqual(A.state.rules.weights.wish_night, 30, "設定の変更も同じボタンで戻る"); assert.deepStrictEqual(A.state.month.unavailable_night[N[0]], [5, 12], "その前の入力は残る");
  A.undo(); assert.strictEqual(JSON.stringify(A.canon(A.state.month)), m0); assert.strictEqual(A.rulesSig(A.state.rules), r0); assert.strictEqual(btn().disabled, true);
  // 4) 画面の読み戻しが空値を補っただけなら、その後でも戻せる
  setup(); await edit("{person}別カレンダーの変更", m => { m.unavailable_night[N[0]] = [5, 12]; }); A.state.month.allow_chief_duty = false; A.state.month.notes = null;
  A.undo(); assert.deepStrictEqual(A.state.month.unavailable_night[N[0]], [5], "空値の補いは「その後の変更」ではない");
  // 5) 記録の後に、記録の無い経路で内容が変わっていたら戻さない（別の PC の変更の統合など。戻すと相手の変更を落とす）
  setup(); await edit("{person}別カレンダーの変更", m => { m.unavailable_night[N[0]] = [5, 12]; }); A.state.month.unavailable_night[N[1]] = [20]; const snap = JSON.stringify(A.state.month); toasts = [];
  A.undo(); assert.strictEqual(JSON.stringify(A.state.month), snap, "何も変えない"); assert.ok(toasts.some(t => /取り消せません/.test(t)), toasts.join("|")); assert.strictEqual(btn().disabled, true, "その記録は捨てる");
  // 6) 自動の統合は履歴を捨てる（tryAutoMerge が clearUndo を呼ぶ）。計算中は戻さない
  setup(); await edit("{person}別カレンダーの変更", m => { m.unavailable_night[N[0]] = [5, 12]; }); A.solving = true; toasts = []; A.undo(); assert.deepStrictEqual(A.state.month.unavailable_night[N[0]], [5, 12], "計算中は戻さない"); assert.ok(toasts.some(t => /計算中/.test(t))); A.solving = false; assert.strictEqual(btn().disabled, false, "記録は残る");
  A.undo(); assert.deepStrictEqual(A.state.month.unavailable_night[N[0]], [5]);
  // 7) 何も変えなかった設定の操作の記録（並べ替えの端など）が上に載っていても、1 回押せばその下の変更が戻る
  setup(); A.pushUndo("規則・重みの変更"); A.state.rules.weights.wish_night = 999; await tick(); A.pushUndo("名簿の並べ替え"); await tick(); A.undo(); assert.strictEqual(A.state.rules.weights.wish_night, 30, "変化の無い記録は飛ばして、その下を戻す"); assert.strictEqual(btn().disabled, true);
  assert.ok(/A\.clearUndo\(\)/.test(fs.readFileSync(path.join(__dirname, "src/app-folder.js"), "utf8").split("別のPCの変更と自動で統合しました")[0].slice(-600)), "統合の直前に履歴を捨てる");
  console.log("ヘッダーの「元に戻す」（月別条件の入力・設定の変更を新しい順に戻す、変化なしは記録しない、版の記録は巻き戻さない、記録の無い変更の後は戻さない、計算中は戻さない）OK");
})().catch(e => { console.log("FAIL", e && e.stack || e); process.exit(1); });

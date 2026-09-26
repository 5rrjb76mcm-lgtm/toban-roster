// 計算の入口（app-solve.js の runSolve）の守りの検査。solver は代替（呼ばれたかどうかを数える）。名前はすべて架空
//  1) 必須の規則が登録に無い（LINT_PLUGIN_MISSING）状態で、別のプラグインの lint が例外を出しても計算しない
//  2) 入力チェックが例外を出したら計算しない（以前の結果はそのまま）
//  3) 計算中にプラグインを読み直したら結果を採用しない（ブラウザ内保存もしない）
//  4) 何も変わらなければ結果を採用し、読んだプラグインの印を結果に残す
const fs = require("fs"), vm = require("vm"), path = require("path"), assert = require("assert");
const rulesJson = fs.readFileSync(path.join(__dirname, "data/rules.json"), "utf8"), monthJson = fs.readFileSync(path.join(__dirname, "data/202611.json"), "utf8");
const langs = fs.readdirSync(path.join(__dirname, "lang")).map(q => JSON.parse(fs.readFileSync(path.join(__dirname, "lang", q), "utf8")));
function context() {
  const elems = new Map(); const el = s => { if (!elems.has(s)) elems.set(s, { checked: false, value: "1", textContent: "", innerHTML: "", disabled: false, hidden: false, className: "", addEventListener() { } }); return elems.get(s); };
  const c = { console, setTimeout, clearTimeout, setInterval, clearInterval, Blob: class { constructor(parts) { this.parts = parts; } async text() { return this.parts.join(""); } }, document: { querySelector: el, querySelectorAll: () => [], getElementById: () => null, addEventListener: () => { } }, localStorage: { getItem: () => null, setItem: () => { }, removeItem: () => { } }, location: { pathname: "/x/toban.html", protocol: "file:", href: "file:///x/toban.html" }, T: {} };
  c.window = c; vm.createContext(c);
  const run = f => vm.runInContext(fs.readFileSync(path.join(__dirname, "src", f), "utf8"), c, { filename: f });
  for (const f of ["i18n.js", "rules-core.js", "model.js", "messages.js", "solver.js", "check.js", "plugins.js", "app-core.js"]) run(f);
  for (const f of fs.readdirSync(path.join(__dirname, "src/rules")).filter(x => x.endsWith(".js")).sort()) run("rules/" + f);
  for (const f of fs.readdirSync(path.join(__dirname, "src/calendars")).filter(x => x.endsWith(".js")).sort()) run("calendars/" + f);
  const T = c.T; for (const L of langs) T.registerLang(L); T.setLang("ja");
  T.DEFAULT_RULES = JSON.parse(rulesJson); const rules = JSON.parse(rulesJson); T.fillDefaultRules(rules); const month = T.normalizeMonth(JSON.parse(monthJson), rules);
  run("app-folder.js"); // フォルダの接続・プラグインの読み込み・保存（実物。描画と帳票は代替）
  const A = T.app, realSave = A.saveToFolder; Object.assign(A.state, { rules, month, result: null }); A.readAll = () => { }; const toasts = []; A.toast = m => toasts.push(String(m)); A.showTab = () => { }; A.saveToFolder = async () => { }; A.renderResult = () => { }; A.renderAll = () => { }; A.highs = {};
  T.makeDocx = async () => new c.Blob(["roster"]); T.reportHtml = () => "report";
  let saves = 0; A.save = () => { saves++; }; const stat = { solverCalls: 0, saves: () => saves, toasts };
  run("app-solve.js");
  T.buildReport = () => ({ V: [], W: [], sections: [] });
  T.solveWithAvoidRef = async () => { stat.solverCalls++; return { asg: { "1:night": { work: rules.name_order[0], oc: [] } }, status: "Optimal", seconds: 0.1, objective: 0, vars: 1, cons: 1 }; };
  return { T, A, el, rules, month, stat, realSave, log: () => el("#calcLog").textContent };
}
const PLUG = (id, extra = "") => `T.rules.register({ id: "${id}", api: 1, states: ["hard", "off"], def: "hard", label: "試験", messages: { X: { en: "x" } }, solve() {}, check() {}, penalty() {}, ${extra} })`;
(async () => {
  { // 1) 必須の規則が無い＋別のプラグインの lint が例外
    const x = context(); x.rules.rule_states["local.required.missing"] = "hard";
    const rec = x.T.plugins.load("rules", "rules/bug.js", PLUG("local.bug.lint", "lint() { throw new Error('fixture lint crashed'); }")); assert.ok(rec.ok);
    x.T.fillDefaultRules(x.rules); x.A.state.result = { asg: { keep: 1 } };
    await x.A.runSolve();
    assert.strictEqual(x.stat.solverCalls, 0, "solver を呼ばない"); assert.ok(/local\.required\.missing/.test(x.log()), "欠けている規則を知らせる"); assert.deepStrictEqual(x.A.state.result, { asg: { keep: 1 } }, "以前の結果を保つ");
    assert.strictEqual(x.stat.saves(), 0);
  }
  { // 2) 入力チェックの例外だけ
    const x = context(); x.T.plugins.load("rules", "rules/bug.js", PLUG("local.bug.lint", "lint() { throw new Error('fixture lint crashed'); }")); x.T.fillDefaultRules(x.rules);
    await x.A.runSolve();
    assert.strictEqual(x.stat.solverCalls, 0, "入力チェックが例外なら計算しない"); assert.ok(/計算しません/.test(x.log()) && /fixture lint crashed/.test(x.log()));
  }
  { // 3) 計算中にプラグインを読み直す（同じ id・同じ既定。実装だけ違う）
    const x = context(); x.T.plugins.load("rules", "rules/ver.js", PLUG("local.versioned.rule", "marker: 1")); x.T.fillDefaultRules(x.rules);
    x.T.solveWithAvoidRef = async () => { x.stat.solverCalls++; x.T.plugins.beginFolder(); x.T.plugins.load("rules", "rules/ver.js", PLUG("local.versioned.rule", "marker: 2")); x.T.fillDefaultRules(x.rules); return { asg: { "1:night": { work: x.rules.name_order[0], oc: [] } }, status: "Optimal", seconds: 0.1, objective: 0, vars: 1, cons: 1 }; };
    await x.A.runSolve();
    assert.strictEqual(x.stat.solverCalls, 1); assert.strictEqual(x.T.RULE_BY_ID["local.versioned.rule"].marker, 2);
    assert.strictEqual(x.A.state.result, null, "読み直し後の結果は採用しない"); assert.strictEqual(x.stat.saves(), 0, "ブラウザ内にも保存しない"); assert.ok(/プラグインが読み直された/.test(x.log()));
    assert.strictEqual(x.el("#btnSolve").disabled, false);
  }
  { // 4) 何も変わらない
    const x = context(); x.T.plugins.load("rules", "rules/ver.js", PLUG("local.versioned.rule", "marker: 1")); x.T.fillDefaultRules(x.rules);
    await x.A.runSolve();
    assert.strictEqual(x.stat.solverCalls, 1); assert.ok(x.A.state.result && x.A.state.result.asg, "結果を採用"); assert.strictEqual(x.stat.saves(), 1);
    assert.strictEqual(JSON.stringify(x.A.state.result.plugins.map(s => s.split("#")[0])), JSON.stringify(["rules/ver.js"]), "読んだプラグインの印を結果に残す"); // vm の配列は別の realm なので JSON で比べる
    assert.ok(x.A.state.month.plugins_used.includes("local.versioned.rule"));
    assert.strictEqual(x.A.solving, false);
  }
  { // 計算中の月の切替・プラグインの読み直しの受付（A.solving）
    const x = context(); let during = null; x.T.solveWithAvoidRef = async () => { during = x.A.solving; return { asg: {}, status: "Optimal", seconds: 0, objective: 0, vars: 0, cons: 0 }; };
    await x.A.runSolve(); assert.strictEqual(during, true, "計算中は A.solving"); assert.strictEqual(x.A.solving, false);
  }
  // 疑似のフォルダ（plugins/rules/new.js に既定 hard の規則）
  const folderWith = (text, reads, files = {}) => { const rulesDir = { async *entries() { yield ["new.js", { kind: "file", getFile: async () => ({ text: async () => text }) }]; } };
    const plugDir = { getDirectoryHandle: async k => { if (k === "rules") return rulesDir; throw new Error("nf"); } };
    const monthDir = { getFileHandle: async (n, o) => { if (!(o && o.create) && !(n in files)) throw new Error("nf"); return { getFile: async () => ({ text: async () => files[n] }), createWritable: async () => ({ write: async b => { files[n] = typeof b === "string" ? b : await b.text(); }, close: async () => { } }) }; } };
    return { name: "new-folder", async *entries() { }, getDirectoryHandle: async (k, o) => { if (k === "plugins") { reads.n++; return plugDir; } if (o && o.create) return monthDir; throw new Error("nf"); }, getFileHandle: async () => { throw new Error("nf"); } }; };
  { // 6) 計算中にフォルダへ接続: 読み込みは成功後の保存より前に済ませ（1 回だけ）、その結果の勤務表は出さず、次の計算はその規則で行う（保存は実物）
    const x = context(), reads = { n: 0 }, files = {}, dir = folderWith(PLUG("local.new.rule"), reads, files); x.A.saveToFolder = x.realSave; x.T.check = () => ({ V: [] }); // 検算は代替（solver も代替で割当が 1 枠だけのため）
    const solve0 = x.T.solveWithAvoidRef; x.T.solveWithAvoidRef = async (...a) => { x.A.dirHandle = dir; await x.A.refreshMonths(); return solve0(...a); };
    await x.A.runSolve();
    assert.strictEqual(reads.n, 1, "plugins/ は計算後・保存前に 1 回だけ読む"); assert.ok(x.T.RULE_BY_ID["local.new.rule"], "規則が登録される"); assert.strictEqual(x.A.pluginsPending, false);
    assert.strictEqual(JSON.stringify(x.A.state.result.plugins), "[]", "計算中の結果にはその規則は入っていない"); assert.ok(x.stat.toasts.some(t => /もう一度「計算する」/.test(t)), "再計算が必要と知らせる");
    assert.ok(files["202611_data.json"], "月データは保存する"); assert.ok(!Object.keys(files).some(n => /_roster_|_report_/.test(n)), "旧規則の結果の勤務表・説明資料は出さない"); assert.ok(x.stat.toasts.some(t => /プラグインが変わったため/.test(t)));
    x.T.solveWithAvoidRef = solve0; await x.A.runSolve();
    assert.strictEqual(x.stat.solverCalls, 2); assert.ok(x.A.state.month.plugins_used.includes("local.new.rule"), "次の計算はその規則で"); assert.strictEqual(x.A.state.result.plugins.length, 1); assert.strictEqual(reads.n, 1);
    assert.ok(files["202611_roster_v1_draft.docx"] && files["202611_report_v1_draft.html"], "その規則で計算した結果は勤務表を出す");
  }
  { // 7) 計算成功後の保存で初めてフォルダへ接続: その場で読み込み、既存の結果には再計算が必要と知らせる
    const x = context(), reads = { n: 0 }, dir = folderWith(PLUG("local.new.rule"), reads);
    x.A.saveToFolder = async () => { x.A.dirHandle = dir; await x.A.refreshMonths(); };
    await x.A.runSolve();
    assert.strictEqual(reads.n, 1, "保護区間の後の接続は直ちに読む"); assert.ok(x.T.RULE_BY_ID["local.new.rule"]); assert.ok(x.stat.toasts.some(t => /もう一度「計算する」/.test(t)));
    x.A.saveToFolder = async () => { }; await x.A.runSolve(); assert.ok(x.A.state.month.plugins_used.includes("local.new.rule"));
  }
  { // 8) 計算中に接続したフォルダのプラグインが読めない: 次の計算は LINT_PLUGIN_ERROR で止まる
    const x = context(), reads = { n: 0 }, dir = folderWith("this is not js {", reads);
    const solve0 = x.T.solveWithAvoidRef; x.T.solveWithAvoidRef = async (...a) => { x.A.dirHandle = dir; await x.A.refreshMonths(); return solve0(...a); };
    await x.A.runSolve(); x.T.solveWithAvoidRef = solve0; await x.A.runSolve();
    assert.strictEqual(x.stat.solverCalls, 1, "読めないプラグインがある間は計算しない"); assert.ok(/読めません/.test(x.log()));
  }
  console.log("計算の入口の守り（規則欠落＋lint 例外・lint 例外・計算中のプラグイン読み直し・通常の採用・計算中／計算後の接続で読むプラグイン）OK");
})().catch(e => { console.log("FAIL", e && e.stack || e); process.exitCode = 1; });

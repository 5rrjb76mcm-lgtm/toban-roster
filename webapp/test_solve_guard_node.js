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
  return { c, T, A, el, rules, month, stat, realSave, log: () => el("#calcLog").textContent };
}
const PLUG = (id, extra = "") => `T.rules.register({ id: "${id}", api: 1, states: ["hard", "off"], def: "hard", label: "試験", messages: { X: { en: "x" } }, solve() {}, check() {}, penalty() {}, ${extra} })`;
(async () => {
  // 疑似のフォルダ（plugins/rules/new.js に既定 hard の規則）
  const folderWith = (text, reads, files = {}) => { const rulesDir = { async *entries() { yield ["new.js", { kind: "file", getFile: async () => ({ text: async () => await text }) }]; } }; // text は Promise でもよい（読取りを待たせる試験用）
    const plugDir = { getDirectoryHandle: async k => { if (k === "rules") return rulesDir; throw new Error("nf"); } };
    const monthDir = { getFileHandle: async (n, o) => { if (!(o && o.create) && !(n in files)) throw new Error("nf"); return { getFile: async () => ({ text: async () => files[n] }), createWritable: async () => ({ write: async b => { files[n] = typeof b === "string" ? b : await b.text(); }, close: async () => { } }) }; } };
    return { name: "new-folder", async *entries() { }, getDirectoryHandle: async (k, o) => { if (k === "plugins") { if (text === null) throw new Error("nf"); reads.n++; return plugDir; } if (o && o.create) return monthDir; throw new Error("nf"); }, getFileHandle: async () => { throw new Error("nf"); } }; }; // text が null ならプラグインの無いフォルダ
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
    assert.strictEqual(x.A.solving, false); assert.strictEqual(x.A.state.result.build, x.T.BUILD_ID, "本体の印も結果に残す");
    // 結果画面の状態の行: 保存／いまの入力で計算したか／検算／最適性
    x.A.renderResult(); let html = x.el("#result").innerHTML; assert.ok(/status-strip/.test(html) && /いまの入力で計算した結果/.test(html) && /検算: 違反なし/.test(html) && /ソルバー判定: Optimal/.test(html), "状態の行: " + html.slice(0, 300));
    x.A.state.month.notes = "変更"; x.A.renderResult(); html = x.el("#result").innerHTML; assert.ok(/計算後に入力が変わっています/.test(html), "入力が変わると知らせる");
    x.A.state.month.notes = ""; x.A.state.result.status = "TimeLimit"; x.A.renderResult(); assert.ok(/ソルバー判定: TimeLimit/.test(x.el("#result").innerHTML), "時間切れは判定をそのまま出す");
    x.A.state.result.status = "Optimal"; x.A.state.result.gap = 0.05; x.A.renderResult(); assert.ok(/許容差 5%。厳密な最適とは限らない/.test(x.el("#result").innerHTML), "許容差を緩めた Optimal は断定しない");
    delete x.A.state.result.gap; x.A.renderResult(); assert.ok(/許容差の記録なし/.test(x.el("#result").innerHTML), "記録の無い旧形式"); x.A.state.result.gap = 0; x.A.renderResult(); assert.ok(/許容差 0。計算時の入力での最適/.test(x.el("#result").innerHTML));
    // 実物の保存で版の記録が増えても「いまの入力で計算した結果」のまま。その後に入力を変えると警告
    { const reads = { n: 0 }, files = {}, dir = folderWith(null, reads, files); x.A.dirHandle = dir; x.A.saveToFolder = x.realSave; x.T.check = () => ({ V: [] }); // プラグインの無いフォルダ（読み込んだ規則はそのまま。印は計算時と同じ）
      await x.A.saveToFolder(); assert.strictEqual((x.A.state.month.doc_versions || []).length, 1, "版が 1 つ増える"); x.A.renderResult(); assert.ok(/いまの入力で計算した結果/.test(x.el("#result").innerHTML), "版の記録は入力ではない");
      x.A.state.month.unavailable_night[x.rules.name_order[0]] = [5]; x.A.renderResult(); assert.ok(/計算後に入力が変わっています/.test(x.el("#result").innerHTML));
      x.T.plugins.load("rules", "rules/ver.js", PLUG("local.versioned.rule", "marker: 1")); x.A.saveToFolder = async () => { }; x.A.dirHandle = null; } // フォルダの接続で実行時のプラグインが戻されるので読み直す（以降の場合は保存を代替に戻す）
    // プラグインが欠けていると「検算未完了」（緑にしない）
    { x.A.state.rules.rule_states["local.review.missing"] = "hard"; x.A.renderResult(); const h = x.el("#result").innerHTML; assert.ok(/検算未完了/.test(h) && !/検算: 違反なし/.test(h), "欠落時は未完了: " + h.slice(0, 400)); delete x.A.state.rules.rule_states["local.review.missing"]; }
    // 切替の処理中は計算を始めない
    { x.A.switching = 1; const n0 = x.stat.solverCalls; await x.A.runSolve(); assert.strictEqual(x.stat.solverCalls, n0, "切替中は計算しない"); assert.ok(x.stat.toasts.some(t => /切り替えの処理中/.test(t))); x.A.switching = 0; }
    x.T.PLUGINS = [{ dir: "site", files: {}, hash: "h1" }]; await x.A.runSolve(); assert.ok(x.A.state.result.plugins.includes("build:site#h1"), "組み立て時のプラグインの印も結果に残す: " + JSON.stringify(x.A.state.result.plugins) + " log=" + x.log().slice(-300)); x.T.PLUGINS = [];
  }
  { // 計算中の月の切替・プラグインの読み直しの受付（A.solving）
    const x = context(); let during = null; x.T.solveWithAvoidRef = async () => { during = x.A.solving; return { asg: {}, status: "Optimal", seconds: 0, objective: 0, vars: 0, cons: 0 }; };
    await x.A.runSolve(); assert.strictEqual(during, true, "計算中は A.solving"); assert.strictEqual(x.A.solving, false);
  }
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
  { // 8b) 直接ダウンロードも保存と同じ確認を通る: プラグインが欠けていれば勤務表・説明資料を作らず知らせる。揃っていれば作る
    const x = context(); const alerts = []; x.c.alert = m => alerts.push(String(m)); let made = 0, dl = 0; x.T.makeDocx = async () => { made++; return new x.c.Blob(["r"]); }; x.A.download = () => { dl++; }; x.T.check = () => ({ V: [] });
    x.A.state.result = { asg: { "1:night": { work: x.rules.name_order[0], oc: [] } }, status: "Optimal", plugins: [] }; x.A.state.rules.rule_states["local.review.missing"] = "hard";
    await x.A.downloadDocx(); x.A.downloadReportHtml(); assert.strictEqual(made + dl, 0, "欠落時は作らない"); assert.ok(alerts.length === 2 && alerts.every(a => /プラグインが足りない/.test(a)), "理由を知らせる: " + alerts.join("|"));
    delete x.A.state.rules.rule_states["local.review.missing"]; await x.A.downloadDocx(); x.A.downloadReportHtml(); assert.strictEqual(made, 1); assert.strictEqual(dl, 2, "揃っていれば両方出る");
    x.T.check = () => ({ V: [1] }); await x.A.downloadDocx(); assert.strictEqual(dl, 2, "検算に違反があれば出さない"); assert.ok(/違反/.test(alerts.pop())); }
  { // 8c) 名簿の氏名が重なっていれば計算せず、既存の結果の帳票も出さない
    const x = context(); x.A.state.rules.doctors.push(Object.assign({}, x.A.state.rules.doctors[0])); x.T.fillDefaultRules(x.A.state.rules); x.A.state.result = { asg: { keep: 1 } };
    await x.A.runSolve(); assert.strictEqual(x.stat.solverCalls, 0, "重複名簿では計算しない"); assert.ok(/氏名が重な/.test(x.log()), x.log().slice(-200)); assert.deepStrictEqual(x.A.state.result, { asg: { keep: 1 } });
    const alerts = []; x.c.alert = m => alerts.push(String(m)); let dl = 0; x.A.download = () => { dl++; }; x.T.check = () => ({ V: [] }); x.A.state.result = { asg: { "1:night": { work: x.rules.name_order[0], oc: [] } }, status: "Optimal", plugins: [] };
    await x.A.downloadDocx(); assert.strictEqual(dl, 0, "帳票も出さない"); assert.ok(/氏名が重な/.test(alerts.pop())); }
  { // 9) 許容差: solver は 0 も含めて mip_rel_gap を HiGHS へ渡し、渡した値を結果に返す（結果画面の「許容差 0」が計算条件と一致する）
    const x = context(); const P = new x.T.Problem(x.rules, x.month); let captured = null; const fake = { solve: (text, opts) => { captured = opts; return { Status: "Infeasible" }; } };
    let r = await x.T.solve(P, fake, {}); assert.strictEqual(captured.mip_rel_gap, 0, "既定は 0 を明示"); assert.strictEqual(r.gap, 0);
    x.rules.solver = { mip_rel_gap: 0.05 }; r = await x.T.solve(new x.T.Problem(x.rules, x.month), fake, {}); assert.strictEqual(captured.mip_rel_gap, 0.05); assert.strictEqual(r.gap, 0.05, "使った値を返す");
    r = await x.T.solve(new x.T.Problem(x.rules, x.month), fake, { mipGap: 0 }); assert.strictEqual(captured.mip_rel_gap, 0, "opts の指定が優先"); assert.strictEqual(r.gap, 0); delete x.rules.solver;
    x.T.solveWithAvoidRef = async () => ({ asg: { "1:night": { work: x.rules.name_order[0], oc: [] } }, status: "Optimal", seconds: 0, objective: 0, vars: 0, cons: 0, gap: 0.05 }); await x.A.runSolve(); assert.strictEqual(x.A.state.result.gap, 0.05, "結果には solver が返した値を記録"); }
  { // 10) 再接続を断られて別のフォルダを選ぶ経路: その読込（プラグインの読取り）が終わるまで切替の保護が続き、計算は始まらない
    const x = context(), reads = { n: 0 }; let release; const gate = new Promise(r => { release = r; }); const dir = folderWith(gate.then(() => PLUG("local.late.rule")), reads);
    x.A.storedHandle = { name: "old", requestPermission: async () => "denied" }; x.T.app.__ctx = null; globalThis.__pick = dir;
    const ctx = x.c || null; (ctx || globalThis).showDirectoryPicker = async () => dir;
    const p = x.A.reconnectFolderUI(); await new Promise(r => setTimeout(r, 50)); assert.strictEqual(x.A.switching, 1, "読取り中は切替の処理中");
    const n0 = x.stat.solverCalls; await x.A.runSolve(); assert.strictEqual(x.stat.solverCalls, n0, "切替中は計算しない");
    release(); await p; assert.strictEqual(x.A.switching, 0); assert.ok(x.T.RULE_BY_ID["local.late.rule"], "別のフォルダのプラグインが読まれた"); await x.A.runSolve(); assert.strictEqual(x.stat.solverCalls, n0 + 1, "終われば計算できる"); }
  console.log("計算の入口の守り（規則欠落＋lint 例外・lint 例外・計算中のプラグイン読み直し・通常の採用・計算中／計算後の接続で読むプラグイン）OK");
})().catch(e => { console.log("FAIL", e && e.stack || e); process.exitCode = 1; });

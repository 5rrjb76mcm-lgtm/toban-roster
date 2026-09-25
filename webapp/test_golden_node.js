// 回帰の基準（golden）。汎用化で内部構造を変えても、現行プロファイルの結果が変わっていないことを確かめる。
//   node test_golden_node.js <highs パッケージのパス>          … data/golden.json と比べる
//   node test_golden_node.js <highs パッケージのパス> --update  … 基準を作り直す（変えてよいと判断したときだけ）
//
// 比べるもの: 目的関数値（1e-6 で丸め）、必須条件の違反の種類（code。文面を直しても基準は変わらない）、固定した枠の割当、
//             避けたい日の参照解の回数、集計（metrics）、検算の違反文言の一覧、固定割当から作った docx の中身。
// 比べないもの: 割当そのものと、割当から作る集計（metrics）。同じ目的関数値の解が複数あり、制約を並べる順序で
//               入れ替わるため（モジュール分割で必ず変わる）。metrics は違いを参考として表示するだけにする。
const fs = require("fs"), vm = require("vm"), path = require("path"), assert = require("assert"), crypto = require("crypto");
vm.runInThisContext(fs.readFileSync(path.join(__dirname, "libs/jszip.min.js"), "utf8"), { filename: "jszip.min.js" });
globalThis.T = {};
for (const f of ["i18n.js", "rules-core.js", "model.js", "messages.js", "solver.js", "check.js", "report.js", "docxgen.js", "merge.js"]) vm.runInThisContext(fs.readFileSync(path.join(__dirname, "src", f), "utf8"), { filename: f });
for (const f of fs.readdirSync(path.join(__dirname, "src/rules")).filter(x => x.endsWith(".js"))) vm.runInThisContext(fs.readFileSync(path.join(__dirname, "src/rules", f), "utf8"), { filename: "rules/" + f }); // 規則のプラグイン
for (const f of fs.readdirSync(path.join(__dirname, "src/calendars")).filter(x => x.endsWith(".js"))) vm.runInThisContext(fs.readFileSync(path.join(__dirname, "src/calendars", f), "utf8"), { filename: "calendars/" + f }); // 暦のプラグイン
for (const q of fs.readdirSync(path.join(__dirname,"lang"))) T.registerLang(JSON.parse(fs.readFileSync(path.join(__dirname,"lang",q),"utf8")));
T.DEFAULT_RULES = JSON.parse(fs.readFileSync(path.join(__dirname, "data/rules.json"), "utf8"));
const read = p => JSON.parse(fs.readFileSync(path.join(__dirname, p), "utf8"));
const GOLDEN = path.join(__dirname, "data/golden.json");
const update = process.argv.includes("--update"), highsPath = process.argv.find(a => a !== process.argv[0] && a !== process.argv[1] && a !== "--update");
const round6 = x => Math.round(x * 1e6) / 1e6;

// 基準に使う月（テスト用の写し。運用中の 202611/ は参照しない）
const CASES = [
  { id: "202611", rules: "data/rules.json", month: "data/202611_data_test.json", pick: o => o.month },
  { id: "202611-pattern", rules: "data/rules.json", month: "data/202611.json", pick: o => o },
];

async function solveCase(c, highs) {
  const rules = read(c.rules), month = T.normalizeMonth(c.pick(read(c.month)), rules);
  const P = new T.Problem(rules, month);
  const r = await T.solveWithAvoidRef(P, highs, { timeLimit: 120 });
  assert(r.asg, `${c.id}: 解あり（status ${r.status}）`);
  const chk = T.check(P, r.asg), A = new T.Asg(P, r.asg);
  // 固定した枠は解が入れ替わらないので値そのものを基準にする
  const fixedSlots = {};
  for (const [tbl, kind] of [["day", "day"], ["night", "night"]])
    for (const [d, n] of Object.entries(month.fixed?.[tbl] || {})) fixedSlots[`${d}:${kind}`] = n;
  return {
    status: r.status, objective: round6(r.objective), vars: r.vars, cons: r.cons,
    violations: chk.V.length, violation_codes: (chk.VC || []).map(x => x.code).sort(),
    allowed_by_fixed: chk.W.length, allowed_codes: (chk.WC || []).map(x => x.code).sort(),
    avoid_ref: r.avoidRef || null, fixed_slots: fixedSlots,
    metrics: T.metrics(P, A), lint: T.lint(P).map(x => x.code).sort(),
    report_sections: T.buildReport(P, r.asg, { status: r.status, seconds: 0 }).sections.map(s => s.id),
  };
}

// 固定した割当からの docx（割当が動かないので中身をそのまま比べられる）。
// 試験用の保存データ（202611_data_test.json）の割当を使う。data/js_assignment.json は Python 版との突き合わせ（test_node.js）が毎回書き換えるので使わない
function docxDigest() {
  const saved = read("data/202611_data_test.json"), rules = saved.rules; T.fillDefaultRules(rules);
  const month = T.normalizeMonth(saved.month, rules), P = new T.Problem(rules, month), asg = saved.result.asg;
  const xml = T.docxXml(P, asg, "確認版", { today: "2026-01-01T00:00:00Z" });
  return { sha256: crypto.createHash("sha256").update(xml).digest("hex").slice(0, 16), length: xml.length };
}

(async () => {
  if (!highsPath) { console.log("highs のパスを渡してください: node test_golden_node.js <path/to/node_modules/highs> [--update]"); process.exit(1); }
  const highs = await require(highsPath)();
  const now = { docx: docxDigest(), cases: {} };
  for (const c of CASES) now.cases[c.id] = await solveCase(c, highs);
  if (update || !fs.existsSync(GOLDEN)) {
    fs.writeFileSync(GOLDEN, JSON.stringify(now, null, 1) + "\n");
    console.log(`基準を書き出しました: data/golden.json（${Object.keys(now.cases).join(", ")}）`);
    return;
  }
  const want = JSON.parse(fs.readFileSync(GOLDEN, "utf8"));
  let bad = 0;
  const cmp = (label, a, b) => { try { assert.deepStrictEqual(a, b); console.log("ok   " + label); } catch (e) { bad++; console.log("FAIL " + label + "\n     基準: " + JSON.stringify(b) + "\n     いま: " + JSON.stringify(a)); } };
  cmp("docx（固定割当・日付固定）", now.docx, want.docx);
  for (const id of Object.keys(want.cases)) {
    const a = now.cases[id], b = want.cases[id];
    if (!a) { console.log("FAIL " + id + ": 今回の実行に無い"); bad++; continue; }
    for (const k of ["status", "objective", "violations", "allowed_by_fixed", "avoid_ref", "fixed_slots", "violation_codes", "allowed_codes", "lint", "report_sections"]) cmp(`${id}.${k}`, a[k], b[k]);
    // 集計は同点解の取り方で変わるので、違いは参考として出すだけ（失敗にしない）
    const diff = Object.keys(b.metrics || {}).filter(n => JSON.stringify((a.metrics || {})[n]) !== JSON.stringify(b.metrics[n]));
    if (diff.length) console.log(`     （参考）${id}: 集計が変わった医師 ${diff.length} 名: ${diff.slice(0, 5).join("、")}${diff.length > 5 ? " ほか" : ""}`);
    if (a.vars !== b.vars || a.cons !== b.cons) console.log(`     （参考）${id}: 変数 ${b.vars}→${a.vars}、制約 ${b.cons}→${a.cons}`);
  }
  if (bad) { console.log(`${bad} 件が基準と違います。意図した変更なら --update で基準を作り直してください`); process.exitCode = 1; }
  else console.log("golden OK（結果は基準と同じ）");
})();

// 保存するファイルの名前（app-core.js の A.FILES）と、月データの探し方（app-folder.js の findMonthData）の検査。
// 画面のファイルを読み込むので、DOM と保存領域は空の代わりを置く。フォルダは疑似の handle で再現する
const fs = require("fs"), vm = require("vm"), path = require("path"), assert = require("assert");
globalThis.location = { pathname: "/x/toban.html", protocol: "file:", href: "file:///x/toban.html" };
globalThis.document = { querySelector: () => null, addEventListener: () => { } }; globalThis.window = globalThis;
globalThis.localStorage = { getItem: () => null, setItem: () => { } };
globalThis.T = {};
for (const f of ["i18n.js", "rules-core.js", "model.js", "app-core.js", "app-folder.js"]) vm.runInThisContext(fs.readFileSync(path.join(__dirname, "src", f), "utf8"), { filename: f });
for (const f of fs.readdirSync(path.join(__dirname, "src/rules")).filter(x => x.endsWith(".js"))) vm.runInThisContext(fs.readFileSync(path.join(__dirname, "src/rules", f), "utf8"), { filename: "rules/" + f }); // 規則のプラグイン
for (const f of fs.readdirSync(path.join(__dirname, "src/calendars")).filter(x => x.endsWith(".js"))) vm.runInThisContext(fs.readFileSync(path.join(__dirname, "src/calendars", f), "utf8"), { filename: "calendars/" + f }); // 暦のプラグイン
for (const q of fs.readdirSync(path.join(__dirname,"lang"))) T.registerLang(JSON.parse(fs.readFileSync(path.join(__dirname,"lang",q),"utf8")));
const A = T.app;
// 名前は英語 1 通り（表示言語で変えない）
for (const lang of ["ja", "en"]) {
  T.setLang(lang);
  assert.strictEqual(A.FILES.data("202611"), "202611_data.json");
  assert.strictEqual(A.FILES.dataPrev("202611"), "202611_data_prev.json");
  assert.strictEqual(A.FILES.roster("202611", 2, "確定版"), "202611_roster_v2_final.docx");
  assert.strictEqual(A.FILES.roster("202611", 0, "確認版"), "202611_roster_unsaved_draft.docx");
  assert.strictEqual(A.FILES.report("202611", 1, "確認版"), "202611_report_v1_draft.html");
  assert.strictEqual(A.FILES.report("202611"), "202611_report.html");
}
T.setLang("ja");
// 疑似のフォルダ
const NF = () => Object.assign(new Error("not found"), { name: "NotFoundError" }); // 実物の File System Access API は、無いときに NotFoundError を投げる（アプリはそれだけを「無い」とみなす）
const dirOf = files => ({ getFileHandle: async n => { if (!(n in files)) throw NF(); return { getFile: async () => ({ text: async () => JSON.stringify(files[n]) }) }; }, getDirectoryHandle: async () => { throw NF(); } });
const root = (sub, top = {}) => Object.assign(dirOf(top), { getDirectoryHandle: async n => { if (n in sub) return dirOf(sub[n]); throw NF(); } });
(async () => {
  A.monthDirs = ["202611"];
  const D = (y = 2026, m = 11) => ({ month: { year: y, month: m }, saved_at: "2026-10-05" });
  A.dirHandle = root({ "202611": { "202611_data.json": D() } });
  let f = await A.findMonthData("202611"); assert.strictEqual(f.where, "202611/202611_data.json", "月のフォルダの中を読む");
  A.dirHandle = root({}, { "202611_data.json": D() });
  f = await A.findMonthData("202611"); assert.strictEqual(f.where, "202611_data.json", "フォルダ直下も探す");
  A.dirHandle = root({ "202611": { "202611 当直表データ.json": D() } });
  f = await A.findMonthData("202611"); assert.strictEqual(f.data, null, "以前の日本語の名前は読まない（公開前のため互換は持たない）");
  // 無い（NotFoundError）のではなく確かめられない（権限・読取り障害）ときは、無いものとして扱わない
  { const bad = name => Object.assign(new Error("unreadable"), { name });
    A.dirHandle = Object.assign(root({}, { "202611_data.json": D() }), { getDirectoryHandle: async () => { throw bad("NotAllowedError"); } });
    f = await A.findMonthData("202611"); assert.strictEqual(f.data, null); assert.strictEqual(f.corrupt, "202611/", "月のフォルダを開けない"); assert.strictEqual(f.unreadable, true);
    A.dirHandle = root({ "202611": Object.assign({}, { x: 1 }) }); const sub = await A.dirHandle.getDirectoryHandle("202611"); A.dirHandle.getDirectoryHandle = async () => Object.assign(sub, { getFileHandle: async () => { throw bad("NotReadableError"); } });
    f = await A.findMonthData("202611"); assert.strictEqual(f.data, null); assert.strictEqual(f.corrupt, "202611/202611_data.json", "ファイルを確かめられない"); assert.strictEqual(f.unreadable, true); }
  // 中身の検査: 別の月の中身（コピーや改名の誤り）・勤務表データでない中身・JSON として有効な null / false / 0 / "" / 配列は「無い」でも「その月のデータ」でもない（壊れている扱い: 新規扱いで上書きしない・自動で統合しない）
  A.dirHandle = root({ "202611": { "202611_data.json": D(2026, 12) } }); f = await A.findMonthData("202611"); assert.strictEqual(f.data, null); assert.strictEqual(f.corrupt, "202611/202611_data.json", "中身が別の月"); assert.strictEqual(f.mismatch, true); assert.ok(/12月/.test(f.error), f.error); assert.ok(!f.unreadable);
  A.dirHandle = root({ "202611": { "202611_data.json": { year: 2026, month: 11 } } }); f = await A.findMonthData("202611"); assert.ok(f.data, "月そのもの（rules を持たない古い形）は読む");
  for (const v of [null, false, 0, "", [], { saved_at: "2026-10-05" }, { month: { year: 2026 } }]) { A.dirHandle = root({ "202611": { "202611_data.json": v } }); f = await A.findMonthData("202611"); assert.strictEqual(f.data, null, JSON.stringify(v)); assert.strictEqual(f.corrupt, "202611/202611_data.json", "勤務表データでない中身は「無い」ではない: " + JSON.stringify(v)); assert.ok(!f.unreadable); }
  console.log("保存するファイルの名前と月データの探し方 OK");
})().catch(e => { console.log("FAIL", e.message); process.exitCode = 1; });

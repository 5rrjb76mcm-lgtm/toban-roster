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
const dirOf = files => ({ getFileHandle: async n => { if (!(n in files)) throw new Error("nf"); return { getFile: async () => ({ text: async () => JSON.stringify(files[n]) }) }; }, getDirectoryHandle: async () => { throw new Error("nd"); } });
const root = (sub, top = {}) => Object.assign(dirOf(top), { getDirectoryHandle: async n => { if (n in sub) return dirOf(sub[n]); throw new Error("nd"); } });
(async () => {
  A.monthDirs = ["202611"];
  A.dirHandle = root({ "202611": { "202611_data.json": { saved_at: "2026-10-05" } } });
  let f = await A.findMonthData("202611"); assert.strictEqual(f.where, "202611/202611_data.json", "月のフォルダの中を読む");
  A.dirHandle = root({}, { "202611_data.json": { saved_at: "2026-10-05" } });
  f = await A.findMonthData("202611"); assert.strictEqual(f.where, "202611_data.json", "フォルダ直下も探す");
  A.dirHandle = root({ "202611": { "202611 当直表データ.json": { saved_at: "2026-10-05" } } });
  f = await A.findMonthData("202611"); assert.strictEqual(f.data, null, "以前の日本語の名前は読まない（公開前のため互換は持たない）");
  console.log("保存するファイルの名前と月データの探し方 OK");
})().catch(e => { console.log("FAIL", e.message); process.exitCode = 1; });

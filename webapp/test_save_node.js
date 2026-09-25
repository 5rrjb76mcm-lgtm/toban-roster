// フォルダへの保存（app-folder.js の saveToFolder）の版の付け方と、保存状態の署名（app-core.js の sig / isDirty）の検査。
// フォルダ・DOM・帳票の生成は代替。名前はすべて架空
//  版: 出力に関わる変更（メモ・表題・重み・表示言語）のたびに版が増え、変更が無ければ増えない。説明資料は保存した内容で作られる
//  署名: 名簿・表示順の並べ替えは「未保存」になり、集合（祝日・不可の日）の並べ替えはならない
const fs = require("fs"), vm = require("vm"), path = require("path"), assert = require("assert");
const elems = new Map(); const el = s => { if (!elems.has(s)) elems.set(s, { value: "確認版", innerHTML: "", textContent: "", className: "", hidden: false, addEventListener() { } }); return elems.get(s); };
globalThis.document = { querySelector: el, querySelectorAll: () => [], addEventListener: () => { } }; globalThis.window = globalThis;
globalThis.location = { pathname: "/x/toban.html", protocol: "file:", href: "file:///x/toban.html" }; globalThis.localStorage = { getItem: () => null, setItem() { }, removeItem() { } };
globalThis.T = {};
for (const f of ["i18n.js", "rules-core.js", "model.js", "messages.js", "merge.js", "plugins.js", "app-core.js", "app-folder.js"]) vm.runInThisContext(fs.readFileSync(path.join(__dirname, "src", f), "utf8"), { filename: f });
for (const f of fs.readdirSync(path.join(__dirname, "src/rules")).filter(x => x.endsWith(".js"))) vm.runInThisContext(fs.readFileSync(path.join(__dirname, "src/rules", f), "utf8"), { filename: "rules/" + f });
for (const f of fs.readdirSync(path.join(__dirname, "src/calendars")).filter(x => x.endsWith(".js"))) vm.runInThisContext(fs.readFileSync(path.join(__dirname, "src/calendars", f), "utf8"), { filename: "calendars/" + f });
for (const q of fs.readdirSync(path.join(__dirname, "lang"))) T.registerLang(JSON.parse(fs.readFileSync(path.join(__dirname, "lang", q), "utf8")));
T.setLang("ja");
const A = T.app; A.renderHeader = () => { }; A.readAll = () => { }; A.toast = () => { }; A.renderAll = () => { }; A.choose = async () => null;
// 疑似のフォルダ（書いたファイルは files に残る）
const files = {}, writes = [];
const dir = { name: "test", async *entries() { yield ["202611", { kind: "directory" }]; }, async getDirectoryHandle(n) { if (n === "plugins") throw new Error("nf"); return dir; },
  async getFileHandle(n, opt) { if (!(opt && opt.create) && !(n in files)) throw new Error("nf"); return { getFile: async () => ({ text: async () => files[n] }), createWritable: async () => ({ write: async x => { files[n] = typeof x === "string" ? x : await x.text(); writes.push(n); }, close: async () => { } }) }; } };
globalThis.Blob = class { constructor(parts) { this.parts = parts; } async text() { return this.parts.join(""); } };
Object.assign(A.state, { rules: { profile: { id: "test", label: "test" }, doctors: [{ name: "Dr A", team: "I" }, { name: "Dr B", team: "I" }], name_order: ["Dr A", "Dr B"], weights: { w1: 1 } }, month: { year: 2026, month: 11, notes: "before", holidays: [3, 23], unavailable_night: { "Dr A": [4, 11] } }, result: { asg: { "1:night": { work: "Dr A", oc: [] } }, status: "Optimal", at: "2026-10-01T00:00:00Z", seconds: 1.5 }, ui: {} });
A.dirHandle = dir; T.Problem = function (r, m) { this.rules = r; this.m = m; }; T.check = () => ({ V: [] }); T.makeDocx = async () => new Blob(["roster"]); A.reportHtml = () => `report:${A.state.month.notes}:${T.lang()}`;
(async () => {
  const vers = () => A.state.month.doc_versions.map(v => `v${v.ver}:${v.label}`);
  await A.saveToFolder(); assert.deepStrictEqual(vers(), ["v1:確認版"]); assert.strictEqual(files["202611_report_v1_draft.html"], "report:before:ja");
  A.state.month.notes = "after"; await A.saveToFolder(); assert.deepStrictEqual(vers(), ["v1:確認版", "v2:確認版"], "メモだけの変更でも版が増える");
  assert.strictEqual(files["202611_report_v2_draft.html"], "report:after:ja", "説明資料は保存した内容"); assert.strictEqual(JSON.parse(files["202611_data.json"]).month.notes, "after");
  const n2 = writes.length; await A.saveToFolder(); assert.deepStrictEqual(vers(), ["v1:確認版", "v2:確認版"], "変更が無ければ版は増えない"); assert.ok(!writes.slice(n2).some(n => /_roster_|_report_/.test(n)), "変更が無ければ配布物は書かない（月データと退避だけ）");
  A.state.month.notes = "after"; A.state.result.at = "2026-10-02T00:00:00Z"; A.state.result.seconds = 9; await A.saveToFolder(); assert.deepStrictEqual(vers(), ["v1:確認版", "v2:確認版"], "計算日時・計算時間だけの違いでは増えない");
  A.state.rules.weights.w1 = 5; await A.saveToFolder(); assert.deepStrictEqual(vers(), ["v1:確認版", "v2:確認版", "v3:確認版"], "重みの変更で増える");
  A.state.month.doc_label = "確定版"; await A.saveToFolder(); // 表題は月データ（ヘッダーの描画が入力欄に写す） assert.deepStrictEqual(vers(), ["v1:確認版", "v2:確認版", "v3:確認版", "v4:確定版"], "表題の変更で増える"); assert.ok(files["202611_roster_v4_final.docx"]);
  T.setLang("en"); await A.saveToFolder(); assert.strictEqual(vers().length, 5, "表示言語の変更で増える"); assert.strictEqual(files["202611_report_v5_final.html"], "report:after:en"); T.setLang("ja");
  assert.strictEqual(A.versionSig("確認版"), A.versionSig("確認版")); assert.notStrictEqual(A.versionSig("確認版"), A.versionSig("確定版"));
  { const s1 = A.versionSig("x"); A.state.month.doc_versions.push({ ver: 99 }); assert.strictEqual(A.versionSig("x"), s1, "版の履歴は署名に入らない"); A.state.month.doc_versions.pop(); }
  // 保存状態の署名
  A.markSaved(); assert.strictEqual(A.isDirty(), false);
  A.state.rules.doctors.reverse(); A.state.rules.name_order.reverse(); assert.strictEqual(A.isDirty(), true, "名簿の並べ替えは未保存"); const rs = A.rulesSig(A.state.rules);
  A.state.rules.doctors.reverse(); A.state.rules.name_order.reverse(); assert.strictEqual(A.isDirty(), false); assert.notStrictEqual(rs, A.rulesSig(A.state.rules), "統合の判定にも並びが効く");
  A.state.rules.name_order.reverse(); assert.strictEqual(A.isDirty(), true, "表示順だけの並べ替えも未保存"); A.state.rules.name_order.reverse();
  A.state.month.holidays.reverse(); A.state.month.unavailable_night["Dr A"].reverse(); assert.strictEqual(A.isDirty(), false, "集合の並べ替えは未保存にならない");
  A.state.month.holidays.push(24); assert.strictEqual(A.isDirty(), true);
  console.log("フォルダ保存の版の付け方（メモ・重み・表題・言語で版が増え、変更なし・時刻だけでは増えない）と保存状態の署名（名簿の並べ替えは未保存、集合の並べ替えは保存済みのまま）OK");
})().catch(e => { console.log("FAIL", e && e.stack || e); process.exitCode = 1; });

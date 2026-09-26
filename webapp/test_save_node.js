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
const RealProblem = T.Problem; A.dirHandle = dir; T.Problem = function (r, m) { this.rules = r; this.m = m; }; T.check = () => ({ V: [] }); T.makeDocx = async () => new Blob(["roster"]); A.reportHtml = () => `report:${A.state.month.notes}:${T.lang()}`;
(async () => {
  const vers = () => A.state.month.doc_versions.map(v => `v${v.ver}:${v.label}`);
  await A.saveToFolder(); assert.deepStrictEqual(vers(), ["v1:確認版"]); assert.strictEqual(files["202611_report_v1_draft.html"], "report:before:ja");
  A.state.month.notes = "after"; await A.saveToFolder(); assert.deepStrictEqual(vers(), ["v1:確認版", "v2:確認版"], "メモだけの変更でも版が増える");
  assert.strictEqual(files["202611_report_v2_draft.html"], "report:after:ja", "説明資料は保存した内容"); assert.strictEqual(JSON.parse(files["202611_data.json"]).month.notes, "after");
  const n2 = writes.length; await A.saveToFolder(); assert.deepStrictEqual(vers(), ["v1:確認版", "v2:確認版"], "変更が無ければ版は増えない"); assert.ok(!writes.slice(n2).some(n => /_roster_|_report_/.test(n)), "変更が無ければ配布物は書かない（月データと退避だけ）");
  A.state.month.notes = "after"; A.state.result.at = "2026-10-02T00:00:00Z"; A.state.result.seconds = 9; await A.saveToFolder(); assert.deepStrictEqual(vers(), ["v1:確認版", "v2:確認版"], "計算日時・計算時間だけの違いでは増えない");
  A.state.rules.weights.w1 = 5; await A.saveToFolder(); assert.deepStrictEqual(vers(), ["v1:確認版", "v2:確認版", "v3:確認版"], "重みの変更で増える");
  A.state.month.doc_label = "確定版"; /* 表題は月データ（ヘッダーの描画が入力欄に写す） */ await A.saveToFolder(); assert.deepStrictEqual(vers(), ["v1:確認版", "v2:確認版", "v3:確認版", "v4:確定版"], "表題の変更で増える"); assert.ok(files["202611_roster_v4_final.docx"]);
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
  // 並びに意味がある配列: 曜日パターン（同じ曜日・時間帯なら先頭が優先）とプラグインの独自の配列の反転は未保存・入力署名の変更になる。集合（祝日・不可の日・待機の名簿）の並べ替えはならない
  { T.Problem = RealProblem; const R = JSON.parse(fs.readFileSync(path.join(__dirname, "data/rules.json"), "utf8")); const n = R.doctors[0].name;
    const m = { year: 2026, month: 11, regular_duties: { [n]: [{ kind: "outpatient", dow: "Mon", part: "am" }, { kind: "external", dow: "Mon", part: "am" }] }, local_prio: ["a", "b"] };
    Object.assign(A.state, { rules: R, month: m, result: { asg: { "1:night": { work: n, oc: ["x", "y"] } } }, meta: null });
    const before = T.expandDuties(R, m, [n])[n][2].am; A.markSaved(); const isig = A.inputSig(); assert.strictEqual(A.isDirty(), false);
    m.regular_duties[n].reverse(); const after = T.expandDuties(R, m, [n])[n][2].am; assert.notStrictEqual(before, after, "反転で展開される業務が変わる");
    assert.strictEqual(A.isDirty(), true, "曜日パターンの反転は未保存"); assert.notStrictEqual(A.inputSig(), isig, "入力署名も変わる"); m.regular_duties[n].reverse(); assert.strictEqual(A.isDirty(), false);
    m.local_prio.reverse(); assert.strictEqual(A.isDirty(), true, "プラグインの独自の配列の反転も未保存"); m.local_prio.reverse();
    A.state.result.asg["1:night"].oc.reverse(); assert.strictEqual(A.isDirty(), false, "待機の名簿（集合）の並べ替えは保存済みのまま");
    T.Problem = function (r, m2) { this.rules = r; this.m = m2; }; }
  // 帳票生成中の編集: 検算・版の署名・勤務表・説明資料・月データは保存を始めた時点の写しから作り、その後の編集は未保存として残る
  { for (const k of Object.keys(files)) delete files[k];
    Object.assign(A.state, { rules: { profile: { id: "test", label: "test" }, doctors: [{ name: "Dr A", team: "I" }], name_order: ["Dr A"], docx: { font: "FontBefore" } }, month: { year: 2026, month: 11, notes: "before" }, result: { asg: { "1:night": { work: "Dr A", oc: [] } }, status: "Optimal" }, meta: null });
    A.reportHtml = (P, label, S) => `report:${S.month.notes}:${S.rules.docx.font}`;
    let entered, release; const started = new Promise(r => { entered = r; }), gate = new Promise(r => { release = r; });
    T.makeDocx = async P => { const font = P.rules.docx.font; entered(); await gate; return new Blob([`roster:${font}`]); };
    const saving = A.saveToFolder(); await started; A.state.month.notes = "after"; A.state.rules.docx.font = "FontAfter"; release(); await saving;
    assert.strictEqual(files["202611_roster_v1_draft.docx"], "roster:FontBefore"); assert.strictEqual(files["202611_report_v1_draft.html"], "report:before:FontBefore", "説明資料も写しから");
    const j = JSON.parse(files["202611_data.json"]); assert.strictEqual(j.month.notes, "before"); assert.strictEqual(j.rules.docx.font, "FontBefore", "月データも写しから"); assert.strictEqual(j.month.doc_versions.length, 1, "版の記録は保存した中身にも入る");
    assert.strictEqual(A.isDirty(), true, "生成中の編集は未保存として残る"); assert.strictEqual(A.state.month.doc_versions.length, 1);
    assert.notStrictEqual(A.state.month.doc_versions[0].sig, A.versionSig("確認版"), "いまの内容は保存した版と違う");
    A.state.month.notes = "before"; A.state.rules.docx.font = "FontBefore"; assert.strictEqual(A.isDirty(), false, "戻せば保存済みと一致");
    T.makeDocx = async () => new Blob(["roster"]); }
  // 本体の印（T.BUILD_ID）が変わると版の署名も変わる（帳票の実装だけが更新された保存でも版が進む）
  { const s1 = A.versionSig("確認版"); const keep = T.BUILD_ID; T.BUILD_ID = "other"; assert.notStrictEqual(A.versionSig("確認版"), s1); T.BUILD_ID = keep; }
  // 未知の項目（プラグインの local_…）は空値も値: 未指定 ↔ null / [] / {} は未保存・入力署名・設定署名の変更になる。既知の欄の空欄整形（notes "" など）は変更にならない
  { Object.assign(A.state, { rules: { profile: { id: "t" }, doctors: [{ name: "Dr A", team: "I" }], name_order: ["Dr A"] }, month: { year: 2026, month: 11 }, result: null, meta: null }); A.markSaved(); const isig = A.inputSig(), rsig = A.rulesSig(A.state.rules);
    for (const v of [null, [], {}]) { A.state.month.local_extension = v; assert.strictEqual(A.isDirty(), true, `独自項目を ${JSON.stringify(v)} にすると未保存`); assert.notStrictEqual(A.inputSig(), isig); delete A.state.month.local_extension; assert.strictEqual(A.isDirty(), false); }
    A.state.rules.local_x = []; assert.notStrictEqual(A.rulesSig(A.state.rules), rsig, "設定の独自項目でも同じ"); delete A.state.rules.local_x;
    A.state.month.notes = ""; A.state.month.holidays = []; A.state.month.exceptions = {}; assert.strictEqual(A.isDirty(), false, "既知の欄の空欄整形は未保存にならない"); }
  // 保存中に月を切り替えない: 進行中の保存は awaitSaves / saveBeforeSwitch で待つ。写しの年月でフォルダ・ファイルを決め、写しと現在の月が違えば保存基準に触れない
  { for (const k of Object.keys(files)) delete files[k];
    Object.assign(A.state, { rules: { profile: { id: "test", label: "test" }, doctors: [{ name: "Dr A", team: "I" }], name_order: ["Dr A"] }, month: { year: 2026, month: 11, notes: "before" }, result: null, meta: null }); A.markSaved();
    A.state.month.notes = "changed"; const gate = () => { let release; const g = new Promise(r => { release = r; }); return { g, release }; };
    let g1 = gate(); const w0 = dir.getFileHandle; dir.getFileHandle = async (n, o) => { if (n === "202611_data.json" && o && o.create) await g1.g; return w0(n, o); }; // 月データの書込み前で止める
    const saving = A.saveToFolder(); await new Promise(r => setTimeout(r, 20)); A.state.month.notes = "before"; // 編集を元へ戻す（isDirty は false）
    let switched = false; const sw = A.saveBeforeSwitch().then(v => { switched = true; return v; }); await new Promise(r => setTimeout(r, 20)); assert.strictEqual(switched, false, "切替は進行中の保存を待つ");
    g1.release(); const ok = await sw; assert.strictEqual(ok, true); await saving;
    assert.ok(files["202611_data.json"] && !files["202612_data.json"]); assert.strictEqual(A.state.meta.savedTag, "202611");
    // 待たずに月が替わってしまった場合でも、写しの月のファイルにだけ書き、現在の月の保存基準は更新しない
    g1 = gate(); A.state.month.notes = "changed2"; const saving2 = A.saveToFolder(); await new Promise(r => setTimeout(r, 20));
    A.state.month = { year: 2026, month: 12, notes: "dec" }; A.state.meta = null; A.state.base = "SENTINEL";
    g1.release(); await saving2;
    assert.strictEqual(JSON.parse(files["202611_data.json"]).month.notes, "changed2", "写しの月（11 月）のファイルに書く"); assert.ok(!files["202612_data.json"], "新しい月の名前では書かない");
    assert.strictEqual(A.state.meta, null, "現在の月（12 月）の保存基準には触れない"); assert.strictEqual(A.state.base, "SENTINEL");
    dir.getFileHandle = w0; }
  // 保存中の言語切替: 切替側は awaitSaves で待つので、同じ版の勤務表・説明資料・署名は写しの言語（切替前）で作られる
  { for (const k of Object.keys(files)) delete files[k]; T.setLang("ja");
    Object.assign(A.state, { rules: { profile: { id: "test", label: "test" }, doctors: [{ name: "Dr A", team: "I" }], name_order: ["Dr A"] }, month: { year: 2026, month: 11, notes: "n", doc_label: "確認版" }, result: { asg: { "1:night": { work: "Dr A", oc: [] } }, status: "Optimal" }, meta: null });
    let entered, release; const started = new Promise(r => { entered = r; }), gate2 = new Promise(r => { release = r; });
    const langs = {}; T.makeDocx = async () => { langs.docx = T.lang(); entered(); await gate2; return new Blob(["r"]); }; A.reportHtml = () => { langs.report = T.lang(); return "h"; };
    const saving = A.saveToFolder(); await started;
    const change = async v => { await A.awaitSaves(); T.setLang(v); }; // app-main.js の言語切替と同じ順序
    let changed = false; const ch = change("en").then(() => { changed = true; }); await new Promise(r => setTimeout(r, 20)); assert.strictEqual(changed, false, "言語の切替は保存を待つ"); assert.strictEqual(T.lang(), "ja");
    release(); await saving; await ch; assert.strictEqual(T.lang(), "en");
    assert.deepStrictEqual(langs, { docx: "ja", report: "ja" }, "同じ版の両方が切替前の言語"); assert.strictEqual(A.state.month.doc_versions[0].sig, A.versionSig("確認版", Object.assign({}, A.state, { lang: "ja" })), "版の署名も写しの言語");
    T.setLang("ja"); T.makeDocx = async () => new Blob(["roster"]); }
  console.log("フォルダ保存の版の付け方（メモ・重み・表題・言語で版が増え、変更なし・時刻だけでは増えない）と保存状態の署名（名簿・曜日パターン・独自配列の並べ替えは未保存、集合の並べ替えは保存済みのまま）・生成中の編集は未保存・独自項目の空値・保存中の月切替と言語切替 OK");
})().catch(e => { console.log("FAIL", e && e.stack || e); process.exitCode = 1; });

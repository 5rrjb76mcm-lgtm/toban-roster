// フォルダへの保存（app-folder.js の saveToFolder）の版の付け方と、保存状態の署名（app-core.js の sig / isDirty）の検査。
// フォルダ・DOM・帳票の生成は代替。名前はすべて架空
//  版: 出力に関わる変更（メモ・表題・重み・表示言語）のたびに版が増え、変更が無ければ増えない。説明資料は保存した内容で作られる
//  署名: 名簿・表示順の並べ替えは「未保存」になり、集合（祝日・不可の日）の並べ替えはならない
const fs = require("fs"), vm = require("vm"), path = require("path"), assert = require("assert");
const elems = new Map(); const el = s => { if (!elems.has(s)) elems.set(s, { value: "確認版", innerHTML: "", textContent: "", className: "", hidden: false, addEventListener() { } }); return elems.get(s); };
globalThis.document = { querySelector: el, querySelectorAll: () => [], addEventListener: () => { } }; globalThis.window = globalThis;
globalThis.location = { pathname: "/x/toban.html", protocol: "file:", href: "file:///x/toban.html" }; globalThis.localStorage = { getItem: () => null, setItem() { }, removeItem() { } };
globalThis.T = {};
for (const f of ["i18n.js", "rules-core.js", "model.js", "messages.js", "merge.js", "plugins.js", "app-core.js", "app-folder.js", "app-input.js"]) vm.runInThisContext(fs.readFileSync(path.join(__dirname, "src", f), "utf8"), { filename: f });
for (const f of fs.readdirSync(path.join(__dirname, "src/rules")).filter(x => x.endsWith(".js"))) vm.runInThisContext(fs.readFileSync(path.join(__dirname, "src/rules", f), "utf8"), { filename: "rules/" + f });
for (const f of fs.readdirSync(path.join(__dirname, "src/calendars")).filter(x => x.endsWith(".js"))) vm.runInThisContext(fs.readFileSync(path.join(__dirname, "src/calendars", f), "utf8"), { filename: "calendars/" + f });
for (const q of fs.readdirSync(path.join(__dirname, "lang"))) T.registerLang(JSON.parse(fs.readFileSync(path.join(__dirname, "lang", q), "utf8")));
T.setLang("ja");
const A = T.app; A.renderHeader = () => { }; A.readAll = () => { }; A.toast = () => { }; A.renderAll = () => { }; A.choose = async () => null;
// 疑似のフォルダ（書いたファイルは files に残る）
const files = {}, writes = [];
const dir = { name: "test", async *entries() { yield ["202611", { kind: "directory" }]; }, async getDirectoryHandle(n) { if (n === "plugins") throw Object.assign(new Error("nf"), { name: "NotFoundError" }); return dir; },
  async getFileHandle(n, opt) { if (!(opt && opt.create) && !(n in files)) throw Object.assign(new Error("nf"), { name: "NotFoundError" }); return { getFile: async () => ({ text: async () => files[n] }), createWritable: async () => ({ write: async x => { files[n] = typeof x === "string" ? x : await x.text(); writes.push(n); }, close: async () => { } }) }; } };
globalThis.Blob = class { constructor(parts) { this.parts = parts; } async text() { return this.parts.join(""); } };
Object.assign(A.state, { rules: { profile: { id: "test", label: "test" }, doctors: [{ name: "Dr A", team: "I" }, { name: "Dr B", team: "I" }], name_order: ["Dr A", "Dr B"], weights: { w1: 1 } }, month: { year: 2026, month: 11, notes: "before", holidays: [3, 23], unavailable_night: { "Dr A": [4, 11] } }, result: { asg: { "1:night": { work: "Dr A", oc: [] } }, status: "Optimal", at: "2026-10-01T00:00:00Z", seconds: 1.5 }, ui: {} });
const RealProblem = T.Problem; A.dirHandle = dir; T.Problem = function (r, m) { this.rules = r; this.m = m; }; T.check = () => ({ V: [] }); T.makeDocx = async () => new Blob(["roster"]); A.reportHtml = () => `report:${A.state.month.notes}:${T.lang()}`; T.lintPlugins = () => []; // check.js は読まないので代替（F3 の場合だけ欠落を返す）
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
  // 帳票を出す前の確認: 印の無い旧形式の結果でも検算は必ず行い、違反・検算の例外・プラグインの欠落・組み立て時プラグインの違いなら月データだけ保存する
  { const fresh = (extra = {}) => { for (const k of Object.keys(files)) delete files[k]; Object.assign(A.state, { rules: { profile: { id: "test", label: "test" }, doctors: [{ name: "Dr A", team: "I" }], name_order: ["Dr A"] }, month: { year: 2026, month: 11, notes: "n" }, result: Object.assign({ asg: { "1:night": { work: "Dr A", oc: [] } }, status: "Optimal" }, extra), meta: null }); };
    const docs = () => Object.keys(files).filter(n => /_roster_|_report_/.test(n)).length;
    let calls = 0; T.check = () => { calls++; return { V: [1] }; }; fresh(); await A.saveToFolder(); assert.ok(calls >= 1, "旧形式（印なし）でも検算する"); assert.strictEqual(docs(), 0, "違反ありなら帳票を出さない"); assert.ok(files["202611_data.json"], "月データは保存する"); assert.strictEqual(A.isDirty(), false);
    T.check = () => { throw new Error("check broken"); }; fresh(); await A.saveToFolder(); assert.strictEqual(docs(), 0, "検算が完了しなければ出さない");
    T.check = () => ({ V: [] }); fresh(); await A.saveToFolder(); assert.strictEqual(docs(), 2, "違反なしなら旧形式でも出す（互換）");
    T.lintPlugins = () => [{ code: "LINT_PLUGIN_MISSING", msg: "", hint: "" }]; fresh({ plugins: [] }); await A.saveToFolder(); assert.strictEqual(docs(), 0, "規則が欠けていれば出さない（計算ボタンと同じ判定）");
    T.lintPlugins = () => { throw new Error("lint broken"); }; fresh({ plugins: [] }); await A.saveToFolder(); assert.strictEqual(docs(), 0, "欠落の確認が完了しなければ出さない"); T.lintPlugins = () => [];
    T.PLUGINS = [{ dir: "site", files: {}, hash: "h1" }]; assert.deepStrictEqual(T.plugins.stamp(), ["build:site#h1"], "組み立て時のプラグインも印に入る");
    fresh({ plugins: [] }); await A.saveToFolder(); assert.strictEqual(docs(), 0, "プラグインなしで計算した結果は、組み立て時プラグインのある本体では出さない");
    fresh({ plugins: ["build:site#h0"] }); await A.saveToFolder(); assert.strictEqual(docs(), 0, "同じ名前でも中身が違えば出さない");
    fresh({ plugins: ["build:site#h1"] }); await A.saveToFolder(); assert.strictEqual(docs(), 2, "同じ組み立てなら出す"); T.PLUGINS = []; }
  // 保存中のフォルダ変更: 画面からの変更は保存を待つ。待たずに接続先が替わっても、保存先は元のフォルダのままで、保存基準は更新しない（接続先に無い月は未保存）
  { for (const k of Object.keys(files)) delete files[k]; const filesB = {}; const dirB = { name: "test", /* A と同じ名前の別のフォルダ（/A/勤務表 と /B/勤務表） */ async *entries() { }, async getDirectoryHandle(n, o) { if (n === "plugins") throw Object.assign(new Error("nf"), { name: "NotFoundError" }); return dirB; },
      async getFileHandle(n, opt) { if (!(opt && opt.create) && !(n in filesB)) throw Object.assign(new Error("nf"), { name: "NotFoundError" }); return { getFile: async () => ({ text: async () => filesB[n] }), createWritable: async () => ({ write: async x => { filesB[n] = typeof x === "string" ? x : await x.text(); }, close: async () => { } }) }; }, queryPermission: async () => "granted" };
    Object.assign(A.state, { rules: { profile: { id: "test", label: "test" }, doctors: [{ name: "Dr A", team: "I" }], name_order: ["Dr A"] }, month: { year: 2026, month: 11, notes: "n" }, result: null, meta: null }); A.dirHandle = dir; A.markSaved();
    const gate = () => { let release; const g = new Promise(r => { release = r; }); return { g, release }; }; const w0 = dir.getFileHandle; let g1 = gate(); dir.getFileHandle = async (n, o) => { if (n === "202611_data.json" && o && o.create) await g1.g; return w0(n, o); };
    A.state.month.notes = "edited"; let saving = A.saveToFolder(); await new Promise(r => setTimeout(r, 20));
    A.dirHandle = dirB; A.dirGen++; // 待たずに接続先が替わった場合
    g1.release(); await saving; assert.strictEqual(JSON.parse(files["202611_data.json"]).month.notes, "edited", "元のフォルダ A に書く"); assert.strictEqual(Object.keys(filesB).length, 0, "B には書かない");
    assert.strictEqual(A.isDirty(), true, "B には未保存"); assert.ok(!(A.state.meta && A.state.meta.savedSig === A.sig()), "B に保存済みとは言わない");
    A.dirHandle = dir; A.markSaved(); // 画面からの変更は保存を待ち、接続先に無い月は未保存になる
    globalThis.window.showDirectoryPicker = async () => dirB; globalThis.confirm = () => false;
    g1 = gate(); A.state.month.notes = "edited2"; saving = A.saveToFolder(); await new Promise(r => setTimeout(r, 20));
    let opened = false; const op = A.openFolderUI().then(() => { opened = true; }); await new Promise(r => setTimeout(r, 20)); assert.strictEqual(opened, false, "フォルダの変更は保存を待つ"); assert.strictEqual(A.dirHandle, dir);
    g1.release(); await saving; await op; assert.strictEqual(A.dirHandle, dirB, "保存後に B へ"); assert.strictEqual(JSON.parse(files["202611_data.json"]).month.notes, "edited2", "A への保存は完了");
    assert.strictEqual(A.isDirty(), true, "B にこの月が無ければ未保存（フォルダ名が同じでも）"); await A.saveToFolder(); assert.ok(filesB["202611_data.json"], "自動保存に相当する保存で B に月データが作られる"); assert.strictEqual(A.isDirty(), false);
    dir.getFileHandle = w0; A.dirHandle = dir; delete globalThis.window.showDirectoryPicker; }
  // 共通の窓口 A.transition: 計算中は断って false（知らせる）、進行中の保存を待ってから実行し、戻り値を返す
  { const toasts = []; const t0 = A.toast; A.toast = m => toasts.push(String(m));
    A.solving = true; let ran = false; assert.strictEqual(await A.transition("month", async () => { ran = true; return 1; }), false, "計算中は断る"); assert.strictEqual(ran, false); assert.ok(/計算中は月を切り替えられません/.test(toasts.pop()));
    assert.strictEqual(await A.transition("lang", async () => 1), false); assert.ok(/表示言語/.test(toasts.pop())); assert.strictEqual(await A.transition("folder", async () => 1), false); assert.ok(/保存フォルダ/.test(toasts.pop())); assert.strictEqual(await A.transition("plugins", async () => 1), false); assert.strictEqual(await A.transition("data", async () => 1), false); assert.strictEqual(await A.transition("unknown", async () => 1), false);
    A.solving = false; A.toast = t0;
    for (const k of Object.keys(files)) delete files[k]; A.dirHandle = dir; Object.assign(A.state, { rules: { profile: { id: "test", label: "test" }, doctors: [{ name: "Dr A", team: "I" }], name_order: ["Dr A"] }, month: { year: 2026, month: 11, notes: "n" }, result: null, meta: null }); A.markSaved();
    const gate = () => { let release; const g = new Promise(r => { release = r; }); return { g, release }; }; const w0 = dir.getFileHandle; const g1 = gate(); dir.getFileHandle = async (n, o) => { if (n === "202611_data.json" && o && o.create) await g1.g; return w0(n, o); };
    A.state.month.notes = "t"; const saving = A.saveToFolder(); await new Promise(r => setTimeout(r, 20));
    let ran2 = false; const tr = A.transition("data", async () => { ran2 = true; return "done"; }); await new Promise(r => setTimeout(r, 20)); assert.strictEqual(ran2, false, "進行中の保存を待つ");
    g1.release(); await saving; assert.strictEqual(await tr, "done", "保存後に実行して戻り値を返す"); assert.strictEqual(ran2, true); dir.getFileHandle = w0; }
  // 保存の 3 段階: prepareSave は state を変えず（版の記録も現在の月には足さない）、writeSave が写しの月のフォルダに書き、commitSave が版の記録を足して保存済みにする
  { for (const k of Object.keys(files)) delete files[k]; T.check = () => ({ V: [] }); T.makeDocx = async () => new Blob(["roster"]); A.reportHtml = () => "report";
    Object.assign(A.state, { rules: { profile: { id: "test", label: "test" }, doctors: [{ name: "Dr A", team: "I" }], name_order: ["Dr A"] }, month: { year: 2026, month: 11, notes: "p" }, result: { asg: { "1:night": { work: "Dr A", oc: [] } }, status: "Optimal", plugins: [] }, meta: null });
    const before = JSON.stringify(A.state.month) + JSON.stringify(A.state.rules), sig0 = A.sig();
    const prep = await A.prepareSave("2026-10-01T00:00:00.000Z");
    assert.strictEqual(JSON.stringify(A.state.month) + JSON.stringify(A.state.rules), before, "prepareSave は state を変えない"); assert.strictEqual(A.sig(), sig0); assert.ok(!A.state.month.doc_versions, "版の記録はまだ現在の月に無い");
    assert.deepStrictEqual(prep.docs.map(f => f.name), ["202611_roster_v1_draft.docx", "202611_report_v1_draft.html"], "帳票は写しから 2 つ"); assert.strictEqual(prep.version.ver, 1); assert.strictEqual((prep.S.month.doc_versions || []).length, 0, "版の記録は書けてから写しに足す"); assert.strictEqual(Object.keys(files).length, 0, "まだ書かない");
    await A.writeSave(dir, prep); assert.deepStrictEqual(Object.keys(files).sort(), ["202611_data.json", "202611_report_v1_draft.html", "202611_roster_v1_draft.docx"], "writeSave が書く"); assert.strictEqual(JSON.parse(files["202611_data.json"]).month.doc_versions.length, 1); assert.strictEqual(A.isDirty(), true, "まだ保存済みではない");
    A.commitSave(prep); assert.strictEqual(A.state.month.doc_versions.length, 1, "commitSave が版の記録を現在の月に足す"); assert.strictEqual(A.isDirty(), false, "保存済みになる"); assert.strictEqual(A.state.meta.savedTag, "202611");
    // 月が替わっていたら commitSave は現在の月に触れない
    const prep2 = await A.prepareSave("2026-10-01T00:01:00.000Z"); A.state.month = { year: 2026, month: 12, notes: "dec" }; A.state.meta = null; A.commitSave(prep2); assert.strictEqual(A.state.meta, null); assert.ok(!A.state.month.doc_versions); }
  // 帳票だけ書けないときは月データを保存し、版の記録は確定しない（保存済みになる）。月データが書けなければ保存失敗（未保存のまま）
  { const fresh = () => { for (const k of Object.keys(files)) delete files[k]; Object.assign(A.state, { rules: { profile: { id: "test", label: "test" }, doctors: [{ name: "Dr A", team: "I" }], name_order: ["Dr A"] }, month: { year: 2026, month: 11, notes: "n" }, result: { asg: { "1:night": { work: "Dr A", oc: [] } }, status: "Optimal", plugins: [] }, meta: null }); };
    const w0 = dir.getFileHandle; const failOn = re => { dir.getFileHandle = async (n, o) => { if (re.test(n) && o && o.create) return { createWritable: async () => ({ write: async () => { throw new Error("disk"); }, close: async () => { } }) }; return w0(n, o); }; };
    failOn(/_roster_/); fresh(); let r = await A.saveToFolder(); assert.strictEqual(r, "saved", "docx だけ失敗しても保存は成功"); assert.ok(files["202611_data.json"] && !files["202611_report_v1_draft.html"], "月データは書き、説明資料は書かない（勤務表と対）"); assert.ok(!JSON.parse(files["202611_data.json"]).month.doc_versions, "版の記録は確定しない"); assert.ok(!A.state.month.doc_versions); assert.strictEqual(A.isDirty(), false);
    failOn(/_report_/); fresh(); r = await A.saveToFolder(); assert.strictEqual(r, "saved"); assert.ok(files["202611_data.json"] && !JSON.parse(files["202611_data.json"]).month.doc_versions, "説明資料だけ失敗でも版は確定しない"); assert.strictEqual(A.isDirty(), false);
    failOn(/_data\.json$/); fresh(); r = await A.saveToFolder(); assert.strictEqual(r, "failed", "月データが書けなければ保存失敗"); assert.strictEqual(A.isDirty(), true, "未保存のまま");
    dir.getFileHandle = w0; fresh(); r = await A.saveToFolder(); assert.strictEqual(r, "saved"); assert.strictEqual(A.state.month.doc_versions.length, 1, "全部書ければ版が確定"); }
  // 窓口: 保存を待つ間に計算が始まっていたら断る
  { for (const k of Object.keys(files)) delete files[k]; Object.assign(A.state, { rules: { profile: { id: "test", label: "test" }, doctors: [{ name: "Dr A", team: "I" }], name_order: ["Dr A"] }, month: { year: 2026, month: 11, notes: "n" }, result: null, meta: null }); A.markSaved();
    const gate = () => { let release; const g = new Promise(r => { release = r; }); return { g, release }; }; const w0 = dir.getFileHandle; const g1 = gate(); dir.getFileHandle = async (n, o) => { if (n === "202611_data.json" && o && o.create) await g1.g; return w0(n, o); };
    A.state.month.notes = "t"; const saving = A.saveToFolder(); await new Promise(r => setTimeout(r, 20));
    const toasts = []; const t0 = A.toast; A.toast = m => toasts.push(String(m)); let ran = false; const tr = A.transition("lang", async () => { ran = true; }); await new Promise(r => setTimeout(r, 20)); assert.strictEqual(A.switching, 1, "切替の処理中");
    A.solving = true; g1.release(); await saving; assert.strictEqual(await tr, false, "待っている間に計算が始まっていたら断る"); assert.strictEqual(ran, false); assert.ok(/表示言語/.test(toasts.pop())); A.solving = false; A.toast = t0; assert.strictEqual(A.switching, 0); dir.getFileHandle = w0; }
  // 月データを当てる: 接続中のフォルダから読んだ内容だけ「保存済み」。外部の JSON は未保存（自動保存でフォルダに書かれる）
  { A.showTab = () => { }; A.renderAll = () => { }; A.dirHandle = dir; const o = { rules: { profile: { id: "test" }, doctors: [{ name: "Dr A", team: "I" }], name_order: ["Dr A"] }, month: { year: 2026, month: 11, notes: "imported-new" }, result: null, saved_at: "2026-10-01T00:00:00Z" };
    A.applyLoaded(JSON.parse(JSON.stringify(o)), "x", { fromFolder: false }); assert.strictEqual(A.isDirty(), true, "外部の JSON は未保存"); assert.strictEqual(A.state.month.notes, "imported-new");
    A.applyLoaded(JSON.parse(JSON.stringify(o)), "x"); assert.strictEqual(A.isDirty(), false, "フォルダから読んだ内容は保存済み"); assert.ok(/フォルダ test/.test(A.state.meta.savedWhere)); }
  // 別の施設のフォルダへ切り替えたとき、手元の未保存の入力を無確認で統合・保存しない（利用者に選ばせる）
  { for (const k of Object.keys(files)) delete files[k]; const filesB = { "202611_data.json": JSON.stringify({ rules: { profile: { id: "B" }, doctors: [{ name: "Dr A", team: "I" }], name_order: ["Dr A"] }, month: { year: 2026, month: 11, profile_id: "B", notes: "B のメモ" }, result: null, saved_at: "2026-10-02T00:00:00Z" }) };
    const dirB = { name: "B", async *entries() { yield ["202611", { kind: "directory" }]; }, async getDirectoryHandle(n) { if (n === "plugins") throw Object.assign(new Error("nf"), { name: "NotFoundError" }); return dirB; }, async getFileHandle(n, opt) { if (!(opt && opt.create) && !(n in filesB)) throw Object.assign(new Error("nf"), { name: "NotFoundError" }); return { getFile: async () => ({ text: async () => filesB[n] }), createWritable: async () => ({ write: async x => { filesB[n] = typeof x === "string" ? x : await x.text(); }, close: async () => { } }) }; }, queryPermission: async () => "granted" };
    Object.assign(A.state, { rules: { profile: { id: "A" }, doctors: [{ name: "Dr A", team: "I" }], name_order: ["Dr A"], wishes: {} }, month: { year: 2026, month: 11, profile_id: "A", notes: "A のメモ" }, result: null, meta: null }); A.dirHandle = dir; A.markSaved(); A.state.month.wishes = { night_on: { "Dr A": [7] } }; assert.strictEqual(A.isDirty(), true);
    globalThis.window.showDirectoryPicker = async () => dirB; globalThis.confirm = () => false; let asked = 0; A.choose = async () => { asked++; return null; }; // 利用者は「やめる」
    await A.openFolderUI(); assert.strictEqual(asked, 1, "別施設のデータとは自動統合せず、確認を出す"); assert.strictEqual((A.state.rules.profile || {}).id, "A", "手元の施設は変わらない"); assert.strictEqual(Object.keys(filesB).length, 1); assert.strictEqual(JSON.parse(filesB["202611_data.json"]).month.notes, "B のメモ", "B のファイルは書き換えられない");
    A.dirHandle = dir; delete globalThis.window.showDirectoryPicker; A.choose = async () => null;
    // (a) 保存時刻が同じでも別の施設なら確認する（ファイルを複製して施設 id だけ変えた場合など）
    const mkB = (notes, extra) => { filesB["202611_data.json"] = JSON.stringify(Object.assign({ rules: { profile: { id: "B" }, doctors: [{ name: "Dr A", team: "I" }], name_order: ["Dr A"] }, month: { year: 2026, month: 11, profile_id: "B", notes }, result: null, saved_at: "2026-10-02T00:00:00Z" }, extra || {})); };
    const setup = (rulesId, monthId, savedAt) => { Object.assign(A.state, { rules: { profile: { id: rulesId }, doctors: [{ name: "Dr A", team: "I" }], name_order: ["Dr A"], wishes: {} }, month: { year: 2026, month: 11, profile_id: monthId, notes: "A のメモ" }, result: null, meta: null }); A.dirHandle = dir; A.markSaved(undefined, savedAt); A.state.month.wishes = { night_on: { "Dr A": [7] } }; };
    globalThis.window.showDirectoryPicker = async () => dirB;
    mkB("B のメモ"); setup("A", "A", "2026-10-02T00:00:00Z"); asked = 0; A.choose = async () => { asked++; return null; }; await A.openFolderUI(); assert.strictEqual(asked, 1, "保存時刻が同じでも別施設なら確認"); assert.strictEqual(JSON.parse(filesB["202611_data.json"]).month.notes, "B のメモ"); assert.strictEqual(JSON.parse(filesB["202611_data.json"]).month.profile_id, "B", "B の施設 id は書き換えられない");
    // (b) 手元の設定と月の施設 id が食い違っていても、確認なしに統合しない
    mkB("B のメモ"); setup("B", "A", "2026-09-01T00:00:00Z"); A.state.base = JSON.parse(JSON.stringify(A.state.month)); A.state.base.wishes = {}; asked = 0; await A.openFolderUI(); assert.strictEqual(asked, 1, "設定と月の施設 id が違えば確認"); assert.strictEqual(JSON.parse(filesB["202611_data.json"]).month.notes, "B のメモ");
    // (c) 共通の元が別の施設なら自動統合しない
    mkB("B のメモ"); setup("B", "B", "2026-09-01T00:00:00Z"); A.state.base = Object.assign(JSON.parse(JSON.stringify(A.state.month)), { profile_id: "A", wishes: {} }); A.state.baseRules = { profile: { id: "A" } }; asked = 0; await A.openFolderUI(); assert.strictEqual(asked, 1, "共通の元が別施設なら確認"); assert.strictEqual(JSON.parse(filesB["202611_data.json"]).month.notes, "B のメモ");
    // 対照: 同じ施設・共通の元ありなら自動統合して確認なし
    mkB("B のメモ"); setup("B", "B", "2026-09-01T00:00:00Z"); A.state.base = JSON.parse(JSON.stringify(A.state.month)); A.state.base.wishes = {}; A.state.baseRules = { profile: { id: "B" }, doctors: [{ name: "Dr A", team: "I" }], name_order: ["Dr A"], wishes: {} }; asked = 0; await A.openFolderUI(); assert.strictEqual(asked, 0, "同じ施設は自動統合");
    A.dirHandle = dir; delete globalThis.window.showDirectoryPicker; A.choose = async () => null; }
  // JSON のダウンロードは、フォルダ接続中はフォルダへの保存の状態を進めない（未保存のまま自動保存で書かれる）。未接続なら保存済み扱い
  { Object.assign(A.state, { rules: { profile: { id: "t" }, doctors: [{ name: "Dr A", team: "I" }], name_order: ["Dr A"] }, month: { year: 2026, month: 11, notes: "old" }, result: null, meta: null }); A.dirHandle = dir; A.markSaved(); A.state.month.notes = "new"; let dl = 0; A.download = () => { dl++; }; A.readAll = () => { };
    A.downloadMonthJson(); assert.strictEqual(dl, 1); assert.strictEqual(A.isDirty(), true, "接続中は未保存のまま"); assert.ok(!/ダウンロード/.test(A.state.meta.savedWhere));
    A.dirHandle = null; A.downloadMonthJson(); assert.strictEqual(A.isDirty(), false, "未接続なら保存済み扱い"); assert.strictEqual(A.state.meta.savedWhere, "ダウンロード"); A.dirHandle = dir; }
  // 月別条件の読み戻し: 隠している履歴・前月末の OC は残り、出ている欄を空にしたときだけ消える
  { const m = { year: 2026, month: 11, notes: "n", history: { weekend_charge: { "Dr A": 9 }, holiday_charge: { "Dr A": 3 }, work_balance: { "Dr A": 2 } }, prev_month: { last_days: [{ date: 31, night: "Dr A", night_oc: ["Dr B"] }] } };
    Object.assign(A.state, { rules: { profile: { id: "t" }, doctors: [{ name: "Dr A", team: "I" }, { name: "Dr B", team: "I" }], name_order: ["Dr A", "Dr B"] }, month: JSON.parse(JSON.stringify(m)), result: null, meta: null }); A.save = () => { }; A.names = () => ["Dr A", "Dr B"];
    const fakeRoot = (els) => ({ children: [1], dataset: { names: "Dr A|Dr B" }, querySelectorAll: sel => els.filter(e => e.match(sel)), querySelector: sel => els.find(e => e.match(sel)) || null });
    const q0 = document.querySelector; document.querySelector = sel => sel === "#monthSettings" ? root : (sel === "#toast" ? { textContent: "" } : null);
    let root = fakeRoot([]); A.readSettingsMonth(); assert.deepStrictEqual(A.state.month.history, m.history, "欄が無ければ履歴は残る"); assert.deepStrictEqual(A.state.month.prev_month.last_days, m.prev_month.last_days, "前月末の接続も残る");
    const tr = { match: s2 => /tr\[data-ld\]/.test(s2), querySelector: s2 => { const f = (s2.match(/data-f="([^"]+)"/) || [])[1]; return f === "date" ? { value: "31" } : f === "night" ? { value: "Dr A", hasAttribute: () => false } : f === "day" ? { value: "", hasAttribute: () => false } : null; } }; // OC の欄は出ていない
    root = fakeRoot([tr]); A.readSettingsMonth(); assert.deepStrictEqual(A.state.month.prev_month.last_days, [{ date: 31, night: "Dr A", night_oc: ["Dr B"] }], "OC の欄が無ければ前の OC を残す");
    const hist = { match: s2 => /\[data-hist\]/.test(s2), dataset: { hist: "weekend_charge:Dr A" }, value: "" }; root = fakeRoot([hist]); A.readSettingsMonth(); assert.deepStrictEqual(A.state.month.history.weekend_charge, {}, "出ている欄を空にしたら消える"); assert.deepStrictEqual(A.state.month.history.work_balance, { "Dr A": 2 }, "出ていない方は残る");
    // 人ごとの表（当月の目標・累計・担当の履歴）: 欄を出していない人（一時的に配置禁止にした人など）の値は残り、出ている欄だけが書き換わる。出ている欄を空にしたときだけ消える
    { const mk = (sel, ds, value) => ({ match: s2 => s2.split(",").some(x => x.trim() === sel), dataset: ds, value });
      Object.assign(A.state.month, { targets: { "Dr A": 3, "Dr B": 0 }, history: { work_balance: { "Dr A": 1, "Dr B": 7 }, weekend_charge: { "Dr A": 2, "Dr B": 4 }, holiday_charge: { "Dr B": 5 } } });
      root = fakeRoot([mk("[data-target]", { target: "Dr A" }, "4"), mk("[data-bal]", { bal: "Dr A" }, ""), mk("[data-hist]", { hist: "weekend_charge:Dr A" }, "6")]); A.readSettingsMonth(); // Dr B の欄は出ていない
      assert.deepStrictEqual(A.state.month.targets, { "Dr B": 0, "Dr A": 4 }, "出ていない人の目標（0 回も）は残る"); assert.deepStrictEqual(A.state.month.history.work_balance, { "Dr B": 7 }, "出ている欄を空にした人だけ消える"); assert.deepStrictEqual(A.state.month.history.weekend_charge, { "Dr B": 4, "Dr A": 6 }); assert.deepStrictEqual(A.state.month.history.holiday_charge, { "Dr B": 5 }, "欄の無い表は触らない");
      root = fakeRoot([mk("[data-target]", { target: "Dr A" }, ""), mk("[data-target]", { target: "Dr B" }, "")]); A.readSettingsMonth(); assert.deepStrictEqual(A.state.month.targets, {}, "出ている欄を空にすれば消える"); }
    document.querySelector = q0; }
  // JSON の読込: 読み取りを待つ間に加えた入力は、当てる直前の確認でフォルダに保存してから置き換える（無確認で失わない）
  { for (const k of Object.keys(files)) delete files[k]; T.check = () => ({ V: [] }); T.makeDocx = async () => new Blob(["roster"]); A.reportHtml = () => "report"; A.showTab = () => { }; A.renderAll = () => { }; A.clearUndo = () => { }; A.save = () => { }; A.readAll = () => { };
    Object.assign(A.state, { rules: { profile: { id: "test", label: "test" }, doctors: [{ name: "Dr A", team: "I" }], name_order: ["Dr A"] }, month: { year: 2026, month: 11, notes: "saved" }, result: null, meta: null }); A.dirHandle = dir; A.markSaved();
    let release; const gate = new Promise(r => { release = r; }); const f = { text: async () => { await gate; return JSON.stringify({ rules: JSON.parse(JSON.stringify(A.state.rules)), month: { year: 2026, month: 11, notes: "from-json" }, result: null }); } };
    const loading = A.loadJsonFile(f); await new Promise(r => setTimeout(r, 10)); A.state.month.notes = "typed-while-reading"; release(); await loading;
    assert.strictEqual(A.state.month.notes, "from-json", "読んだ内容が当たる"); assert.strictEqual(JSON.parse(files["202611_data.json"]).month.notes, "typed-while-reading", "読み取りの間の入力はフォルダに保存されてから置き換わる"); assert.strictEqual(A.isDirty(), true, "外部の JSON は未保存");
    // 利用者が「やめる」を選べば当てない
    for (const k of Object.keys(files)) delete files[k]; Object.assign(A.state, { month: { year: 2026, month: 11, notes: "keep" }, result: null, meta: null }); A.markSaved(); const w0 = dir.getFileHandle; dir.getFileHandle = async (n, o) => { if (n === "202611_data.json" && o && o.create) return { createWritable: async () => ({ write: async () => { throw new Error("disk"); }, close: async () => { } }) }; return w0(n, o); }; let asked = 0; A.choose = async () => { asked++; return false; };
    const f2 = { text: async () => { A.state.month.notes = "typed-again"; return JSON.stringify({ rules: JSON.parse(JSON.stringify(A.state.rules)), month: { year: 2026, month: 11, notes: "from-json-2" }, result: null }); } }; await A.loadJsonFile(f2);
    assert.strictEqual(asked, 1, "保存できなければ確認を出す"); assert.strictEqual(A.state.month.notes, "typed-again", "やめれば当てない"); dir.getFileHandle = w0; A.choose = async () => null; }
  // 同じ版のまま保存先に勤務表・説明資料が無いとき（別のフォルダへ移した・消した）は、同じ内容・同じ版で書き直す。版は増えない。片方だけ無くても書き直す。揃っていれば書かない
  { for (const k of Object.keys(files)) delete files[k]; T.check = () => ({ V: [] }); T.makeDocx = async () => new Blob(["roster"]); A.reportHtml = () => "report";
    Object.assign(A.state, { rules: { profile: { id: "test", label: "test" }, doctors: [{ name: "Dr A", team: "I" }], name_order: ["Dr A"] }, month: { year: 2026, month: 11, notes: "r" }, result: { asg: { "1:night": { work: "Dr A", oc: [] } }, status: "Optimal", plugins: [] }, meta: null }); A.dirHandle = dir;
    assert.strictEqual(await A.saveToFolder(), "saved"); assert.strictEqual(A.state.month.doc_versions.length, 1); assert.ok(files["202611_roster_v1_draft.docx"] && files["202611_report_v1_draft.html"]);
    delete files["202611_roster_v1_draft.docx"]; delete files["202611_report_v1_draft.html"];
    const prep = await A.prepareSave("2026-10-03T00:00:00.000Z"); assert.ok(prep.reuse && prep.reuse.ver === 1, "同じ版"); assert.strictEqual(prep.docs.length, 0, "版は足さない");
    await A.writeSave(dir, prep); assert.strictEqual(files["202611_roster_v1_draft.docx"], "roster"); assert.strictEqual(files["202611_report_v1_draft.html"], "report", "無ければ同じ版で書き直す"); assert.ok(/書き直しました/.test(prep.note), prep.note); A.commitSave(prep); assert.strictEqual(A.state.month.doc_versions.length, 1, "版は増えない");
    delete files["202611_report_v1_draft.html"]; assert.strictEqual(await A.saveToFolder(), "saved"); assert.ok(files["202611_report_v1_draft.html"], "説明資料だけ無くても書き直す"); assert.strictEqual(A.state.month.doc_versions.length, 1);
    const n0 = writes.length; await A.saveToFolder(); assert.ok(!writes.slice(n0).some(n => /_roster_|_report_/.test(n)), "揃っていれば書かない"); }
  // 切替どうしは並行させない: 進行中の切替があれば、次の切替は断って false（知らせる）。終われば受け付ける
  { const toasts = []; const t0 = A.toast; A.toast = m => toasts.push(String(m)); A.solving = false; let release; const gate = new Promise(r => { release = r; });
    const first = A.transition("month", async () => { await gate; return "done"; }); await new Promise(r => setTimeout(r, 10)); let ran = false;
    assert.strictEqual(await A.transition("folder", async () => { ran = true; }), false, "進行中は断る"); assert.strictEqual(ran, false); assert.ok(/別の切り替え/.test(toasts.pop()));
    release(); assert.strictEqual(await first, "done"); assert.strictEqual(await A.transition("folder", async () => "next"), "next", "終われば受け付ける"); A.toast = t0; }
  // 月の読取り中の保存フォルダの変更: 画面からの変更は窓口が断る。読取りの間に接続先が替わっていたら（窓口を通らない経路）、古い読取結果を捨てて、前のフォルダの月を今のフォルダの「保存済み」にしない
  { for (const k of Object.keys(files)) delete files[k]; const toasts = []; const t0 = A.toast; A.toast = m => toasts.push(String(m)); A.showTab = () => { }; A.renderAll = () => { }; A.clearUndo = () => { }; A.save = () => { }; A.readAll = () => { }; A.renderHeader = () => { }; A.onMonthChange = async () => { throw new Error("呼ばれない"); };
    const rules = { profile: { id: "test", label: "test" }, doctors: [{ name: "Dr A", team: "I" }], name_order: ["Dr A"] }, nov = () => ({ year: 2026, month: 11, notes: "november" });
    const fresh = () => { Object.assign(A.state, { rules: JSON.parse(JSON.stringify(rules)), month: nov(), result: null, meta: null, base: null }); A.dirHandle = dir; A.dirGen++; A.monthDirs = ["202611", "202612"]; A.markSaved(); files["202612_data.json"] = JSON.stringify({ rules, month: { year: 2026, month: 12, notes: "december-from-A" }, result: null, saved_at: "2026-10-05T00:00:00Z" }); };
    const filesB = {}, dirB = { name: "B", async *entries() { }, async getDirectoryHandle(n, o) { if (n === "plugins") throw Object.assign(new Error("nf"), { name: "NotFoundError" }); if (!(o && o.create) && !Object.keys(filesB).length) throw Object.assign(new Error("nf"), { name: "NotFoundError" }); return dirB; },
      async getFileHandle(n, opt) { if (!(opt && opt.create) && !(n in filesB)) throw Object.assign(new Error("nf"), { name: "NotFoundError" }); return { getFile: async () => ({ text: async () => filesB[n] }), createWritable: async () => ({ write: async x => { filesB[n] = typeof x === "string" ? x : await x.text(); }, close: async () => { } }) }; }, async queryPermission() { return "granted"; }, async requestPermission() { return "granted"; } };
    const w0 = dir.getFileHandle; const gated = () => { let release; const g = new Promise(r => { release = r; }); dir.getFileHandle = async (n, o) => { const h = await w0(n, o); if (n !== "202612_data.json" || (o && o.create)) return h; return { getFile: async () => { await g; return h.getFile(); } }; }; return release; };
    globalThis.window.showDirectoryPicker = async () => dirB; globalThis.confirm = () => false; A.choose = async () => null;
    // (1) 画面からの変更: 月の切替の処理中なので断られ、A の 12 月は A のデータとして開く
    fresh(); let release = gated(); const p1 = A.transition("month", () => A.openMonth("202612")); await new Promise(r => setTimeout(r, 20));
    assert.strictEqual(await A.openFolderUI(), false, "読取り中のフォルダ変更は断る"); assert.strictEqual(A.dirHandle, dir); release(); await p1;
    assert.strictEqual(+A.state.month.month, 12); assert.strictEqual(A.state.month.notes, "december-from-A"); assert.strictEqual(A.isDirty(), false); assert.ok(/フォルダ test/.test(A.state.meta.savedWhere), "A の保存済み"); assert.strictEqual(Object.keys(filesB).length, 0);
    // (2) 窓口を通らずに接続先が替わった場合: 古い読取結果を捨てる
    fresh(); release = gated(); toasts.length = 0; const p2 = A.openMonth("202612"); await new Promise(r => setTimeout(r, 20));
    await A.openFolderUI(); assert.strictEqual(A.dirHandle, dirB, "B へ接続"); release(); assert.strictEqual(await p2, false, "古い読取結果は捨てる");
    assert.strictEqual(+A.state.month.month, 11, "A の 12 月を B の月として開かない"); assert.ok(toasts.some(x => /月の切替を中止しました/.test(x)), toasts.join("|")); assert.ok(!(A.state.meta && /フォルダ B/.test(A.state.meta.savedWhere || "") && +A.state.month.month === 12), "B に 12 月を保存済みとしない"); assert.ok(!("202612_data.json" in filesB));
    // (3) 対照: 何も替わらなければ開く
    fresh(); dir.getFileHandle = w0; assert.strictEqual(await A.openMonth("202612"), true); assert.strictEqual(+A.state.month.month, 12);
    dir.getFileHandle = w0; A.dirHandle = dir; delete globalThis.window.showDirectoryPicker; A.toast = t0; }
  // 競合の確認で、ファイルや月のフォルダを「無い」のではなく「確かめられない」（権限・読取り障害）ときは、無いものとして上書きしない。書込み 0・相手の内容はそのまま・未保存のまま。無い（NotFoundError）ときは新規に保存する
  { const toasts = []; const t0 = A.toast; A.toast = m => toasts.push(String(m)); A.renderHeader = () => { }; A.choose = async () => { throw new Error("確認は出ない"); };
    const theirs = JSON.stringify({ rules: { profile: { id: "test" }, doctors: [{ name: "Dr A", team: "I" }], name_order: ["Dr A"] }, month: { year: 2026, month: 11, notes: "newer-from-other-pc" }, result: null, saved_at: "2026-10-09T00:00:00Z" });
    const fresh = () => { for (const k of Object.keys(files)) delete files[k]; files["202611_data.json"] = theirs; Object.assign(A.state, { rules: { profile: { id: "test" }, doctors: [{ name: "Dr A", team: "I" }], name_order: ["Dr A"] }, month: { year: 2026, month: 11, notes: "mine-old" }, result: null, meta: null, base: null }); A.dirHandle = dir; A.monthDirs = ["202611"]; A.markSaved(undefined, "2026-10-01T00:00:00Z"); A.state.month.notes = "mine-edited"; writes.length = 0; toasts.length = 0; };
    const f0 = dir.getFileHandle, d0 = dir.getDirectoryHandle, err = name => Object.assign(new Error("temporarily unreadable"), { name });
    fresh(); let once = true; dir.getFileHandle = async (n, o) => { if (n === "202611_data.json" && !(o && o.create) && once) { once = false; throw err("NotReadableError"); } return f0(n, o); };
    assert.strictEqual(await A.autosaveJson(), "skipped", "ファイルを確かめられなければ保存しない"); assert.strictEqual(writes.length, 0, "書込み 0"); assert.strictEqual(files["202611_data.json"], theirs, "相手の内容はそのまま"); assert.strictEqual(A.isDirty(), true, "未保存のまま"); assert.ok(toasts.some(x => /確かめられません/.test(x)), toasts.join("|"));
    dir.getFileHandle = f0; fresh(); once = true; dir.getDirectoryHandle = async (n, o) => { if (n === "202611" && !(o && o.create) && once) { once = false; throw err("NotAllowedError"); } return d0(n, o); };
    assert.strictEqual(await A.autosaveJson(), "skipped", "月のフォルダを確かめられなければ保存しない"); assert.strictEqual(writes.length, 0); assert.strictEqual(files["202611_data.json"], theirs); assert.strictEqual(A.isDirty(), true); assert.ok(toasts.some(x => /確かめられません/.test(x)));
    // 対照: 無い（NotFoundError）ときは新規に保存する
    dir.getDirectoryHandle = d0; fresh(); delete files["202611_data.json"]; assert.strictEqual(await A.autosaveJson(), "saved"); assert.strictEqual(JSON.parse(files["202611_data.json"]).month.notes, "mine-edited"); assert.strictEqual(A.isDirty(), false);
    dir.getFileHandle = f0; dir.getDirectoryHandle = d0; A.toast = t0; A.choose = async () => null; }
  // 起動時の自動の再接続（前回のフォルダに権限が残っている）も窓口の中で行う: 照合の読取りを待つ間の保存フォルダの変更は断り、前回のフォルダの応答を別のフォルダのデータとして当てない
  { const toasts = []; const t0 = A.toast; A.toast = m => toasts.push(String(m)); A.showTab = () => { }; A.renderAll = () => { }; A.renderHeader = () => { }; A.renderFolderBar = () => { }; A.clearUndo = () => { }; A.save = () => { }; A.readAll = () => { };
    const rules = { profile: { id: "test", label: "test" }, doctors: [{ name: "Dr A", team: "I" }], name_order: ["Dr A"] }, mkData = notes => JSON.stringify({ rules, month: { year: 2026, month: 11, notes }, result: null, saved_at: "2026-10-0" + (notes === "from A" ? 7 : 8) + "T00:00:00Z" });
    const mkDir = (name, store) => { const h = { name, async *entries() { yield ["202611", { kind: "directory" }]; }, async getDirectoryHandle(n) { if (n === "plugins") throw Object.assign(new Error("nf"), { name: "NotFoundError" }); return h; },
      async getFileHandle(n, opt) { if (!(opt && opt.create) && !(n in store)) throw Object.assign(new Error("nf"), { name: "NotFoundError" }); return { getFile: async () => { if (h.gate && n === "202611_data.json") await h.gate; return { text: async () => store[n] }; }, createWritable: async () => ({ write: async x => { store[n] = typeof x === "string" ? x : await x.text(); }, close: async () => { } }) }; }, async queryPermission() { return "granted"; }, async requestPermission() { return "granted"; } }; return h; };
    const sA = { "202611_data.json": mkData("from A") }, sB = { "202611_data.json": mkData("from B") }, hA = mkDir("A", sA), hB = mkDir("B", sB); let release; hA.gate = new Promise(r => { release = r; });
    const kv = { [A.DIR_KEY]: hA }, req = fill => { const r = {}; setTimeout(() => { fill(r); if (r.onsuccess) r.onsuccess(); }, 0); return r; };
    globalThis.indexedDB = { open: () => req(r => { r.result = { createObjectStore() { }, transaction: () => ({ objectStore: () => ({ get: k => req(t => { t.result = kv[k]; }), put: (v, k) => req(() => { kv[k] = v; }) }) }) }; }) };
    globalThis.window.showDirectoryPicker = async () => hB; globalThis.confirm = () => false; A.choose = async () => null;
    Object.assign(A.state, { rules: JSON.parse(JSON.stringify(rules)), month: { year: 2026, month: 11, notes: "browser" }, result: null, meta: null, base: null }); A.dirHandle = null; A.markSaved(undefined, "2026-10-01T00:00:00Z"); A.state.meta.savedWhere = "フォルダ A";
    const starting = A.restoreFolder(); await new Promise(r => setTimeout(r, 50)); assert.strictEqual(A.dirHandle, hA, "自動で A に再接続"); assert.strictEqual(A.switching, 1, "照合の間は切替の処理中");
    assert.strictEqual(await A.openFolderUI(), false, "照合を待つ間のフォルダ変更は断る"); assert.ok(toasts.some(x => /別の切り替え/.test(x))); assert.strictEqual(A.dirHandle, hA);
    release(); await starting; assert.strictEqual(A.dirHandle, hA); assert.strictEqual(A.state.month.notes, "from A", "A のデータを A のものとして読む"); assert.ok(/フォルダ A/.test(A.state.meta.savedWhere)); assert.strictEqual(JSON.parse(sB["202611_data.json"]).month.notes, "from B", "B は変わらない");
    // 窓口を通らずに接続先が替わった場合（照合そのものの見張り）: 古い応答を捨てる
    let release2; hA.gate = new Promise(r => { release2 = r; }); Object.assign(A.state, { month: { year: 2026, month: 11, notes: "browser" }, meta: null, base: null }); A.dirHandle = hA; A.dirGen++; A.monthDirs = ["202611"]; A.markSaved(undefined, "2026-10-01T00:00:00Z");
    const rec = A.reconcileWithFolder(); await new Promise(r => setTimeout(r, 20)); delete hA.gate; A.dirHandle = hB; A.dirGen++; release2(); await rec;
    assert.strictEqual(A.state.month.notes, "browser", "前のフォルダの応答は当てない"); assert.ok(!(A.state.meta && /フォルダ B/.test(A.state.meta.savedWhere || "") && A.state.month.notes === "from A"));
    delete globalThis.indexedDB; delete globalThis.window.showDirectoryPicker; A.dirHandle = dir; A.toast = t0; }
  // 再接続の照合を待つ間に自動保存が済んだら、先に読んでいた古い内容を当てない（同期の基準が進んだので照合し直す）。画面・ブラウザ内・フォルダが新しい内容で揃う
  { const t0 = A.toast; A.toast = () => { }; A.showTab = () => { }; A.renderAll = () => { }; A.renderHeader = () => { }; A.renderFolderBar = () => { }; A.clearUndo = () => { }; A.save = () => { }; A.readAll = () => { }; A.choose = async () => { throw new Error("確認は出ない"); }; globalThis.confirm = () => false;
    const rules = { profile: { id: "test", label: "test" }, doctors: [{ name: "Dr A", team: "I" }], name_order: ["Dr A"] }, at0 = "2026-10-07T00:00:00Z", store = { "202611_data.json": JSON.stringify({ rules, month: { year: 2026, month: 11, notes: "old memo" }, result: null, saved_at: at0 }) };
    let reads = 0, release; const gate = new Promise(r => { release = r; });
    const h = { name: "A", async *entries() { yield ["202611", { kind: "directory" }]; }, async getDirectoryHandle(n) { if (n === "plugins") throw Object.assign(new Error("nf"), { name: "NotFoundError" }); return h; },
      async getFileHandle(n, opt) { if (!(opt && opt.create) && !(n in store)) throw Object.assign(new Error("nf"), { name: "NotFoundError" }); return { getFile: async () => { const was = store[n]; if (n === "202611_data.json" && ++reads === 1) await gate; return { text: async () => was }; }, createWritable: async () => ({ write: async x => { store[n] = typeof x === "string" ? x : await x.text(); }, close: async () => { } }) }; }, async queryPermission() { return "granted"; }, async requestPermission() { return "granted"; } };
    Object.assign(A.state, { rules: JSON.parse(JSON.stringify(rules)), month: { year: 2026, month: 11, notes: "old memo" }, result: null, meta: null, base: null }); A.dirHandle = h; A.dirGen++; A.monthDirs = ["202611"]; A.markSaved("フォルダ A", at0);
    const rec = A.reconcileWithFolder(); await new Promise(r => setTimeout(r, 20)); assert.strictEqual(reads, 1, "照合の読取りが待っている");
    A.state.month.notes = "new memo saved during reconciliation"; assert.strictEqual(await A.autosaveJson(), "saved", "待つ間の自動保存は済む"); assert.strictEqual(JSON.parse(store["202611_data.json"]).month.notes, "new memo saved during reconciliation");
    release(); await rec; assert.strictEqual(A.state.month.notes, "new memo saved during reconciliation", "古い読取結果で画面を戻さない"); assert.strictEqual(A.isDirty(), false); assert.strictEqual(JSON.parse(store["202611_data.json"]).month.notes, "new memo saved during reconciliation"); assert.ok(reads >= 3, "照合し直している: " + reads);
    A.dirHandle = dir; A.toast = t0; A.choose = async () => null; }
  // ハンドルを取った後の読取りの失敗（getFile・text）も「壊れている」ではなく「確かめられない」: 保存を止め、案内は退避ではなく再保存
  { const toasts = []; const t0 = A.toast; A.toast = m => toasts.push(String(m)); A.renderHeader = () => { }; const f0 = dir.getFileHandle;
    const theirs = JSON.stringify({ rules: { profile: { id: "test" }, doctors: [{ name: "Dr A", team: "I" }], name_order: ["Dr A"] }, month: { year: 2026, month: 11, notes: "theirs" }, result: null, saved_at: "2026-10-09T00:00:00Z" });
    for (const [where, name] of [["getFile", "NotAllowedError"], ["text", "NotReadableError"]]) { for (const k of Object.keys(files)) delete files[k]; files["202611_data.json"] = theirs;
      Object.assign(A.state, { rules: { profile: { id: "test" }, doctors: [{ name: "Dr A", team: "I" }], name_order: ["Dr A"] }, month: { year: 2026, month: 11, notes: "mine" }, result: null, meta: null, base: null }); A.dirHandle = dir; A.monthDirs = ["202611"]; A.markSaved(undefined, "2026-10-01T00:00:00Z"); A.state.month.notes = "mine-edited"; writes.length = 0; toasts.length = 0;
      const bad = () => { throw Object.assign(new Error("io"), { name }); }; dir.getFileHandle = async (n, o) => { const hh = await f0(n, o); if (n !== "202611_data.json" || (o && o.create)) return hh; return where === "getFile" ? { getFile: async () => bad() } : { getFile: async () => ({ text: async () => bad() }) }; };
      assert.strictEqual(await A.autosaveJson(), "skipped", where); assert.strictEqual(writes.length, 0); assert.strictEqual(files["202611_data.json"], theirs); assert.ok(toasts.some(x => /確かめられません/.test(x)) && !toasts.some(x => /壊れていて/.test(x)), where + ": " + toasts.join("|")); }
    // 対照: 読めるが JSON でないときは「壊れている」
    for (const k of Object.keys(files)) delete files[k]; files["202611_data.json"] = "{ not json"; dir.getFileHandle = f0; toasts.length = 0; A.state.month.notes = "mine-2"; assert.strictEqual(await A.autosaveJson(), "skipped"); assert.ok(toasts.some(x => /壊れていて/.test(x)), toasts.join("|"));
    dir.getFileHandle = f0; A.toast = t0; }
  // 改名の後の統合: 手元で改名し、相手は旧名のままメモだけ変えた。自動保存の統合で、本人の不可が旧名へ戻らない（名簿・不可とも新しい氏名。旧名は残らない）。相手が同じ人に足した不可も新しい氏名に入る
  { vm.runInThisContext(fs.readFileSync(path.join(__dirname, "src", "app-settings.js"), "utf8"), { filename: "app-settings.js" });
    const t0 = A.toast; A.toast = () => { }; A.renderHeader = () => { }; A.renderAll = () => { }; A.showTab = () => { }; A.save = () => { }; A.readAll = () => { }; A.choose = async () => { throw new Error("確認は出ない"); }; const P0 = T.Problem; T.Problem = RealProblem;
    const R0 = JSON.parse(fs.readFileSync(path.join(__dirname, "data/profiles/two-shift.json"), "utf8")); R0.doctors = R0.doctors.slice(0, 3); R0.name_order = R0.doctors.map(d => d.name); T.fillDefaultRules(R0); const oldN = R0.doctors[0].name, newN = "Review Dr Z";
    const run = async (theirEdit, ruleEdit, beforeSave, want = "saved", seed, res0) => { for (const k of Object.keys(files)) delete files[k]; const rules = JSON.parse(JSON.stringify(R0)), month = T.normalizeMonth({ year: 2026, month: 11, notes: "base", unavailable_night: { [oldN]: [5] }, targets: { [oldN]: 9 }, duty_days: { [oldN]: { 3: { am: "outpatient" } } } }, rules); if (seed) seed(month);
      Object.assign(A.state, { rules, month, result: res0 ? JSON.parse(JSON.stringify(res0)) : null, meta: null, base: null, renames: [] }); A.dirHandle = dir; A.monthDirs = ["202611"]; assert.strictEqual(await A.autosaveJson() === "saved" || (A.markSaved(), true), true); A.state.month.notes = "base"; A.markSaved(undefined, "2026-10-01T00:00:00Z");
      files["202611_data.json"] = JSON.stringify({ rules: JSON.parse(JSON.stringify(rules)), month: JSON.parse(JSON.stringify(month)), result: res0 ? JSON.parse(JSON.stringify(res0)) : null, saved_at: "2026-10-01T00:00:00Z" });
      assert.strictEqual(A.renameDoctor(oldN, newN), true); A.state.rules.doctors[0].name = newN; A.state.rules.name_order = A.state.rules.name_order.map(x => x === oldN ? newN : x); assert.deepStrictEqual(A.state.month.unavailable_night[newN], [5], "手元は新しい氏名に揃う"); assert.deepStrictEqual(A.state.base.unavailable_night[oldN], [5], "共通の元は書き換えない");
      const th = JSON.parse(files["202611_data.json"]); theirEdit(th.month); if (ruleEdit) ruleEdit(th.rules, th.month, th); th.saved_at = "2026-10-02T00:00:00Z"; files["202611_data.json"] = JSON.stringify(th); A.state.month.day_notes = { 2: "mine" }; // 手元にも未保存の変更
      if (beforeSave) beforeSave(A.state); assert.strictEqual(await A.autosaveJson(), want); return JSON.parse(files["202611_data.json"]); };
    let j = await run(m => { m.notes = "their memo"; }); assert.strictEqual(j.month.notes, "their memo"); assert.strictEqual(j.rules.doctors[0].name, newN); assert.deepStrictEqual(j.month.unavailable_night[newN], [5], "不可は新しい氏名のまま"); assert.ok(!JSON.stringify(j.month).includes(oldN), "旧名は月データに残らない");
    assert.strictEqual(j.month.targets[newN], 9); assert.deepStrictEqual(j.month.duty_days[newN][3], { am: "outpatient" }); assert.ok(!j.month.duty_days[oldN]); assert.deepStrictEqual(A.state.renames, [], "保存したら改名の記録は消える"); assert.strictEqual(A.isDirty(), false);
    j = await run(m => { m.unavailable_night[oldN] = [5, 9]; }); assert.deepStrictEqual(j.month.unavailable_night[newN], [5, 9], "相手が同じ人（旧名）に足した不可も新しい氏名に入る"); assert.ok(!JSON.stringify(j.month).includes(oldN));
    // 設定の採用先と氏名: 手元は改名、相手は重みだけ変更（設定を両方が変えた）。「相手の設定を使う」なら名簿も月データも相手の氏名（改名の前）に揃い、「自分の設定を使う」なら新しい氏名に揃う
    { const answers = []; A.choose = async () => answers.shift();
      answers.push("theirs"); j = await run(m => { }, r => { r.weights.target_deviation = 77; }); assert.strictEqual(j.rules.doctors[0].name, oldN, "相手の名簿"); assert.strictEqual(j.rules.weights.target_deviation, 77); assert.deepStrictEqual(j.month.unavailable_night[oldN], [5], "不可は相手の名簿の本人に付く"); assert.strictEqual(j.month.targets[oldN], 9); assert.deepStrictEqual(j.month.duty_days[oldN][3], { am: "outpatient" });
      assert.ok(!JSON.stringify(j.month).includes(newN), "新しい氏名は月データに残らない"); assert.deepStrictEqual(A.state.renames, []); assert.strictEqual(A.state.rules.doctors[0].name, oldN); assert.strictEqual(answers.length, 0);
      answers.push("mine"); j = await run(m => { m.notes = "their memo"; }, r => { r.weights.target_deviation = 77; }); assert.strictEqual(j.rules.doctors[0].name, newN, "自分の名簿"); assert.deepStrictEqual(j.month.unavailable_night[newN], [5]); assert.ok(!JSON.stringify(j.month).includes(oldN)); assert.strictEqual(j.month.notes, "their memo"); assert.notStrictEqual(j.rules.weights.target_deviation, 77);
      // 両方が同じ人を別の氏名に変えた: 「自分の設定」では氏名の対応が付かないので自動では統合しない（読み込むか上書きするかの確認に戻る。何もしなければ手元もフォルダも変わらない）。「相手の設定」なら相手の氏名に揃う
      const theirN = "Review Dr Y", renTheirs = (m, r) => { T.renameEverywhere(r, m, oldN, theirN); };
      answers.push("mine", null); let before; const f0 = () => files["202611_data.json"]; const r1 = await run(m => { }, (r, m) => renTheirs(m, r), st => { before = st; }, "skipped"); assert.strictEqual(answers.length, 0, "設定の確認の後、月の扱いの確認に戻る"); assert.strictEqual(r1.rules.doctors[0].name, theirN, "フォルダは相手の保存のまま"); assert.deepStrictEqual(r1.month.unavailable_night[theirN], [5]); assert.strictEqual(A.state.rules.doctors[0].name, newN, "手元も変わらない"); assert.deepStrictEqual(A.state.month.unavailable_night[newN], [5]);
      answers.push("theirs"); j = await run(m => { }, (r, m) => renTheirs(m, r)); assert.strictEqual(j.rules.doctors[0].name, theirN); assert.deepStrictEqual(j.month.unavailable_night[theirN], [5], "相手の氏名に揃う"); assert.ok(!JSON.stringify(j.month).includes(newN) && !JSON.stringify(j.month).includes(oldN));
      A.choose = async () => { throw new Error("確認は出ない"); }; }
    // 両方が別の氏名に改名し、手元では新しい氏名に条件を足していた: 「相手の設定」を採ると、足した条件の本人が分からなくなる（改名の前の氏名は相手の名簿にいない）ので、自動では統合しない。確認でやめれば手元もフォルダも変わらない
    { const answers = ["theirs", null]; A.choose = async () => answers.shift(); const theirN = "Review Dr Y"; let snap;
      const jj = await run(m => { }, (r, m) => T.renameEverywhere(r, m, oldN, theirN), st => { st.month.unavailable_night[newN].push(6); (st.month.wishes.day_on ||= {})[newN] = [8]; st.month.targets[newN] = 11; snap = JSON.stringify([st.rules, st.month]); }, "skipped");
      assert.strictEqual(answers.length, 0, "設定の確認の後、読み込むか上書きするかの確認に戻る"); assert.strictEqual(JSON.stringify([A.state.rules, A.state.month]), snap, "手元は変わらない"); assert.deepStrictEqual(A.state.month.unavailable_night[newN], [5, 6]); assert.ok(A.state.renames.length, "改名の記録も残る");
      assert.strictEqual(jj.rules.doctors[0].name, theirN, "フォルダは相手の保存のまま"); assert.deepStrictEqual(jj.month.unavailable_night[theirN], [5]); assert.ok(!JSON.stringify(jj.month).includes(oldN) && !JSON.stringify(jj.month).includes(newN));
      A.choose = async () => { throw new Error("確認は出ない"); }; }
    // 当月の目標 0 回も氏名の参照: 両方が別の氏名に改名し、手元で足したのが目標 0 回だけでも、本人が分からなくなる入力として自動の統合を止める（確認でやめれば手元・フォルダ・改名の記録とも不変）
    { assert.deepStrictEqual(T.monthNameRefs({ targets: { Outside: 0 } }), { Outside: ["targets"] }, "0 回の目標も参照として数える"); assert.deepStrictEqual(T.monthNameRefs({ targets: { Outside: "" , Other: null } }), {}, "空は数えない");
      const answers = ["theirs", null]; A.choose = async () => answers.shift(); const theirN = "Review Dr Y"; let snap;
      const jj = await run(m => { }, (r, m) => T.renameEverywhere(r, m, oldN, theirN), st => { delete st.month.day_notes; st.month.targets[newN] = 0; snap = JSON.stringify([st.rules, st.month, st.renames]); }, "skipped", m => { delete m.targets[oldN]; });
      assert.strictEqual(answers.length, 0, "設定の確認の後、読み込むか上書きするかの確認に戻る"); assert.strictEqual(JSON.stringify([A.state.rules, A.state.month, A.state.renames]), snap, "手元も改名の記録も変わらない"); assert.strictEqual(A.state.month.targets[newN], 0);
      assert.strictEqual(jj.rules.doctors[0].name, theirN, "フォルダは相手の保存のまま"); assert.ok(!JSON.stringify(jj.month.targets).includes(oldN) && !JSON.stringify(jj.month.targets).includes(newN));
      A.choose = async () => { throw new Error("確認は出ない"); }; }
    // 計算結果の氏名: 新しい方の結果を採り、氏名は採用する名簿に揃える（名簿の採用先 × 結果の出どころの 4 通り。単独の勤務・複数名の勤務・OC・変更前の割当・避けたい日の基準回数）。揃えられない結果は採らない
    { const other = R0.doctors[1].name, mkRes = at => ({ asg: { "1:night": { work: oldN, oc: [other] }, "2:day": { work: [other, oldN], oc: [oldN] } }, base_asg: { "1:night": { work: oldN, oc: [] } }, avoid_ref: { [oldN]: 3, [other]: 2 }, status: "Optimal", at, plugins: [] });
      const namesOf = res => { const o = new Set(); for (const a of [res.asg, res.base_asg]) for (const v of Object.values(a || {})) { for (const n of [].concat(v.work || [])) o.add(n); for (const n of v.oc || []) o.add(n); } for (const n of Object.keys(res.avoid_ref || {})) o.add(n); return [...o].sort(); };
      const inRoster = jx => namesOf(jx.result).every(n => jx.rules.doctors.some(d => d.name === n)), answers = []; A.choose = async () => answers.shift();
      const older = "2026-09-30T00:00:00Z", newer = "2026-10-03T00:00:00Z", mineAt = "2026-10-01T12:00:00Z", setMine = st => { st.result.at = mineAt; };
      let x = await run(m => { m.notes = "t"; }, (r, m, th) => { th.result.at = newer; }, setMine, "saved", null, mkRes(mineAt)); assert.strictEqual(x.result.at, newer, "自分の名簿 × 相手の結果（新しい）"); assert.deepStrictEqual(namesOf(x.result), [other, newN].sort()); assert.ok(inRoster(x)); assert.deepStrictEqual(x.result.asg["2:day"].work, [other, newN]); assert.strictEqual(x.result.avoid_ref[newN], 3); assert.strictEqual(x.result.base_asg["1:night"].work, newN);
      x = await run(m => { m.notes = "t"; }, (r, m, th) => { th.result.at = older; }, setMine, "saved", null, mkRes(mineAt)); assert.strictEqual(x.result.at, mineAt, "自分の名簿 × 自分の結果"); assert.deepStrictEqual(namesOf(x.result), [other, newN].sort()); assert.ok(inRoster(x));
      answers.push("theirs"); x = await run(m => { }, (r, m, th) => { r.weights.target_deviation = 77; th.result.at = older; }, setMine, "saved", null, mkRes(mineAt)); assert.strictEqual(x.result.at, mineAt, "相手の名簿 × 自分の結果"); assert.deepStrictEqual(namesOf(x.result), [other, oldN].sort(), "改名の前の氏名に戻す"); assert.ok(inRoster(x)); assert.strictEqual(x.result.avoid_ref[oldN], 3);
      answers.push("theirs"); x = await run(m => { }, (r, m, th) => { r.weights.target_deviation = 77; th.result.at = newer; }, setMine, "saved", null, mkRes(mineAt)); assert.strictEqual(x.result.at, newer, "相手の名簿 × 相手の結果"); assert.deepStrictEqual(namesOf(x.result), [other, oldN].sort()); assert.ok(inRoster(x));
      // 両方が別の氏名に改名: 相手の名簿を採ると、手元の結果（新しい）は対応が付かないので採らず、相手の結果を使う。相手に結果が無ければ結果なしにして知らせる
      const theirN = "Review Dr Y", toasts = []; A.toast = m => toasts.push(String(m)); const renRes = (res, o, n) => JSON.parse(JSON.stringify(res).split(JSON.stringify(o)).join(JSON.stringify(n)));
      answers.push("theirs"); x = await run(m => { }, (r, m, th) => { T.renameEverywhere(r, m, oldN, theirN); th.result = renRes(th.result, oldN, theirN); th.result.at = older; }, setMine, "saved", null, mkRes(mineAt)); assert.strictEqual(x.rules.doctors[0].name, theirN); assert.strictEqual(x.result.at, older, "対応の付く相手の結果を使う"); assert.ok(inRoster(x)); assert.deepStrictEqual(namesOf(x.result), [other, theirN].sort());
      answers.push("theirs"); toasts.length = 0; x = await run(m => { }, (r, m, th) => { T.renameEverywhere(r, m, oldN, theirN); th.result = null; }, setMine, "saved", null, mkRes(mineAt)); assert.strictEqual(x.result, null, "どちらも採れなければ結果なし"); assert.ok(toasts.some(t => /計算結果は.*外しました/.test(t)), toasts.join("|"));
      A.toast = () => { }; A.choose = async () => { throw new Error("確認は出ない"); }; }
    // 改名で空いた氏名の再利用: 手元で E→Z、続けて F→E。相手は旧い名簿のまま、元の E と元の F に不可を足した。元の E への追加は Z に、元の F への追加は新しい E に入る（別の人の項目を上書きしない）
    { assert.deepStrictEqual(T.effectiveRenames([["E", "Z"], ["F", "E"]], ["Z", "E", "G"]), [["E", "Z"], ["F", "E"]], "空いた氏名を再利用しても、両方の対応が生きる"); assert.deepStrictEqual(T.effectiveRenames([["E", "F"], ["F", "E"]], ["E", "F"]), [], "戻した改名は消える");
      { const mm = { unavailable_night: { E: [5], F: [6] }, targets: { E: 1, F: 2 } }, rr = { doctors: [{ name: "E" }, { name: "F" }], name_order: ["E", "F"] }; T.renameAll(rr, mm, [["E", "Z"], ["F", "E"]]); assert.deepStrictEqual(mm.unavailable_night, { Z: [5], E: [6] }); assert.deepStrictEqual(mm.targets, { Z: 1, E: 2 }); assert.deepStrictEqual(rr.doctors.map(d => d.name), ["Z", "E"]);
        const sw = { unavailable_night: { E: [5], F: [6] } }; T.renameAll(null, sw, [["E", "F"], ["F", "E"]]); assert.deepStrictEqual(sw.unavailable_night, { F: [5], E: [6] }, "入れ替えも同時に当てる"); }
      for (const k of Object.keys(files)) delete files[k]; const E = R0.doctors[0].name, F = R0.doctors[1].name, Z = "Review Dr Z", rules = JSON.parse(JSON.stringify(R0)), month = T.normalizeMonth({ year: 2026, month: 11, notes: "base", unavailable_night: { [E]: [5], [F]: [6] } }, rules);
      Object.assign(A.state, { rules, month, result: null, meta: null, base: null, renames: [] }); A.dirHandle = dir; A.monthDirs = ["202611"]; A.markSaved(undefined, "2026-10-01T00:00:00Z"); files["202611_data.json"] = JSON.stringify({ rules: JSON.parse(JSON.stringify(rules)), month: JSON.parse(JSON.stringify(month)), result: null, saved_at: "2026-10-01T00:00:00Z" });
      assert.ok(A.renameDoctor(E, Z)); A.state.rules.doctors[0].name = Z; A.state.rules.name_order = A.state.rules.name_order.map(x => x === E ? Z : x); assert.ok(A.renameDoctor(F, E)); A.state.rules.doctors[1].name = E; A.state.rules.name_order = A.state.rules.name_order.map(x => x === F ? E : x);
      assert.deepStrictEqual([A.state.month.unavailable_night[Z], A.state.month.unavailable_night[E]], [[5], [6]], "手元は Z:[5]・E:[6]");
      const th = JSON.parse(files["202611_data.json"]); th.month.unavailable_night[E] = [5, 9]; th.month.unavailable_night[F] = [6, 12]; th.saved_at = "2026-10-02T00:00:00Z"; files["202611_data.json"] = JSON.stringify(th); A.state.month.day_notes = { 2: "mine" };
      assert.strictEqual(await A.autosaveJson(), "saved"); const jr = JSON.parse(files["202611_data.json"]); assert.deepStrictEqual(jr.rules.doctors.slice(0, 2).map(d => d.name), [Z, E]); assert.deepStrictEqual(jr.month.unavailable_night[Z], [5, 9], "元の E への追加は Z に入る"); assert.deepStrictEqual(jr.month.unavailable_night[E], [6, 12], "元の F への追加は新しい E に入る"); assert.ok(!jr.month.unavailable_night[F] || !jr.month.unavailable_night[F].length, "旧い F は残らない"); }
    // 同期の後に足した人が、改名で空いた氏名を使う: E→Z の後、新しく足した人（初期の氏名「新規」）を E に、もう 1 人を Q にする。相手が元の E に足した不可は Z に入り、新しい E には付かない。結果の中の元の E も Z になる
    { for (const k of Object.keys(files)) delete files[k]; const E = R0.doctors[0].name, other = R0.doctors[1].name, Z = "Review Dr Z", Q = "Review Dr Q", rules = JSON.parse(JSON.stringify(R0)), month = T.normalizeMonth({ year: 2026, month: 11, notes: "base", unavailable_night: { [E]: [5] } }, rules);
      const res0 = { asg: { "1:night": { work: E, oc: [other] } }, status: "Optimal", at: "2026-10-01T00:00:00Z", plugins: [] };
      Object.assign(A.state, { rules, month, result: JSON.parse(JSON.stringify(res0)), meta: null, base: null, renames: [] }); A.dirHandle = dir; A.monthDirs = ["202611"]; A.markSaved(undefined, "2026-10-01T00:00:00Z"); files["202611_data.json"] = JSON.stringify({ rules: JSON.parse(JSON.stringify(rules)), month: JSON.parse(JSON.stringify(month)), result: res0, saved_at: "2026-10-01T00:00:00Z" });
      const setName = (i, o, n) => { assert.ok(A.renameDoctor(o, n)); A.state.rules.doctors[i].name = n; A.state.rules.name_order = A.state.rules.doctors.map(d => d.name); }, add = () => { A.state.rules.doctors.push({ name: "新規", team: A.state.rules.doctors[0].team, quota: 0 }); return A.state.rules.doctors.length - 1; };
      setName(0, E, Z); setName(add(), "新規", E); setName(add(), "新規", Q); assert.deepStrictEqual(A.state.renames, [[E, Z]], "記録するのは、同期したときの名簿にいた人の改名だけ"); A.state.month.unavailable_night[E] = [20]; // 新しい E の入力
      const th = JSON.parse(files["202611_data.json"]); th.month.unavailable_night[E] = [5, 9]; th.result.at = "2026-10-03T00:00:00Z"; th.saved_at = "2026-10-02T00:00:00Z"; files["202611_data.json"] = JSON.stringify(th);
      assert.strictEqual(await A.autosaveJson(), "saved"); const jr = JSON.parse(files["202611_data.json"]); assert.deepStrictEqual(jr.month.unavailable_night[Z], [5, 9], "元の E への追加は Z に入る"); assert.deepStrictEqual(jr.month.unavailable_night[E], [20], "新しい E には相手の 9 日を付けない");
      assert.deepStrictEqual(jr.rules.doctors.map(d => d.name).filter(n => [Z, E, Q].includes(n)), [Z, E, Q]); assert.strictEqual(jr.result.asg["1:night"].work, Z, "結果の中の元の E も Z（新しい E に付けない）"); assert.deepStrictEqual(A.state.renames, []); }
    // 統合の後の書き込みが失敗し、相手がさらに変えてから再び保存する: 共通の元は相手の保存内容を相手の氏名のまま持つので、同じ改名をもう一度正しく当てられる（相手が解除した不可が復活しない）。失敗した回はフォルダを変えない
    for (const swap of [false, true]) { for (const k of Object.keys(files)) delete files[k]; const E = R0.doctors[0].name, F = R0.doctors[1].name, Z = "Review Dr Z", rules = JSON.parse(JSON.stringify(R0)), month = T.normalizeMonth({ year: 2026, month: 11, notes: "base", unavailable_night: { [E]: [5], [F]: [6] } }, rules);
      Object.assign(A.state, { rules, month, result: null, meta: null, base: null, renames: [] }); A.dirHandle = dir; A.monthDirs = ["202611"]; A.markSaved(undefined, "2026-10-01T00:00:00Z"); files["202611_data.json"] = JSON.stringify({ rules: JSON.parse(JSON.stringify(rules)), month: JSON.parse(JSON.stringify(month)), result: null, saved_at: "2026-10-01T00:00:00Z" });
      const setName = (i, o, n) => { assert.ok(A.renameDoctor(o, n)); A.state.rules.doctors[i].name = n; A.state.rules.name_order = A.state.rules.doctors.map(d => d.name); };
      setName(0, E, Z); setName(1, F, E); if (swap) setName(0, Z, F); const e2 = swap ? F : Z; // 入れ替えのときは 元の E → F、元の F → E
      let th = JSON.parse(files["202611_data.json"]); th.month.unavailable_night[E] = [5, 9]; th.month.unavailable_night[F] = [6, 12]; th.saved_at = "2026-10-02T00:00:00Z"; const v1 = JSON.stringify(th); files["202611_data.json"] = v1; A.state.month.day_notes = { 2: "mine" };
      const w0 = dir.getFileHandle; dir.getFileHandle = async (n, o) => { if (n === "202611_data.json" && o && o.create) return { createWritable: async () => ({ write: async () => { }, close: async () => { throw new Error("disk"); } }) }; return w0(n, o); };
      assert.strictEqual(await A.autosaveJson(), "failed", "書き込みは失敗"); dir.getFileHandle = w0; assert.strictEqual(files["202611_data.json"], v1, "フォルダは変わらない"); assert.deepStrictEqual([A.state.month.unavailable_night[e2], A.state.month.unavailable_night[E]], [[5, 9], [6, 12]], "手元は統合済み"); assert.ok(A.state.renames.length, "改名の記録は残る");
      th = JSON.parse(v1); th.month.unavailable_night[E] = [9]; th.month.unavailable_night[F] = [6]; th.saved_at = "2026-10-03T00:00:00Z"; files["202611_data.json"] = JSON.stringify(th); // 相手が元の E の 5 日と元の F の 12 日を解除
      assert.strictEqual(await A.autosaveJson(), "saved"); const jr = JSON.parse(files["202611_data.json"]); assert.deepStrictEqual(jr.month.unavailable_night[e2], [9], (swap ? "入れ替え: " : "") + "相手が解除した 5 日は復活しない"); assert.deepStrictEqual(jr.month.unavailable_night[E], [6], "相手が解除した 12 日は復活しない"); assert.deepStrictEqual(A.state.renames, []); }
    // プラグインの独自データ: 統合のときも rename フックで追随させる（相手が旧名のまま変えた独自の値が、新しい氏名に入る）。フックが失敗したら統合を止め、手元もフォルダも変えない
    { let boom = false; const def = { id: "local.review.byname", api: 1, states: ["hard", "off"], def: "off", solve() { }, check() { }, penalty() { }, rename(R, m, o, n) { if (boom) throw new Error("fixture rename failed"); const t = (m.local_review || {}).byName; if (t && t[o] !== undefined) { t[n] = t[o]; delete t[o]; } } }; T.rules.register(def);
      try { const seed = m => { m.local_review = { byName: { [oldN]: { limit: 1 } } }; };
        j = await run(m => { m.local_review.byName[oldN].limit = 2; }, null, null, "saved", seed); assert.deepStrictEqual(j.month.local_review, { byName: { [newN]: { limit: 2 } } }, "相手が変えた独自の値は新しい氏名に入る"); assert.deepStrictEqual(j.month.unavailable_night[newN], [5]);
        const toasts = []; A.toast = m => toasts.push(String(m)); let snap; j = await run(m => { m.local_review.byName[oldN].limit = 3; }, null, () => { boom = true; snap = JSON.stringify([A.state.rules, A.state.month]); }, "skipped", seed);
        assert.ok(toasts.some(x => /統合を止めました/.test(x)), toasts.join("|")); assert.strictEqual(JSON.stringify([A.state.rules, A.state.month]), snap, "手元は変わらない"); assert.deepStrictEqual(j.month.local_review, { byName: { [oldN]: { limit: 3 } } }, "フォルダも相手の保存のまま"); A.toast = () => { };
      } finally { T.rules.unregister(def.id); } }
    // 改名の記録: 続けて変えた分はつなぎ、元に戻した分は消える
    assert.deepStrictEqual(T.effectiveRenames([["A", "B"], ["B", "C"]], ["C"]), [["A", "C"]]); assert.deepStrictEqual(T.effectiveRenames([["A", "B"], ["B", "A"]], ["A"]), []); assert.deepStrictEqual(T.effectiveRenames([["A", "B"]]), [["A", "B"]], "旧い氏名がいまの名簿にあっても（空いた氏名を新しい人が使った）、対応は生きている");
    assert.strictEqual(T.renameOrigin([], ["A", "B"], "A"), "A", "同期したときの名簿にいた人"); assert.strictEqual(T.renameOrigin([["A", "Z"]], ["A", "B"], "Z"), "A", "改名した人の元の氏名"); assert.strictEqual(T.renameOrigin([["A", "Z"]], ["A", "B"], "A"), null, "空いた氏名を使う新しい人"); assert.strictEqual(T.renameOrigin([], ["A", "B"], "新規"), null, "同期の後に足した人");
    T.Problem = P0; A.toast = t0; A.choose = async () => null; }
  console.log("フォルダ保存の版の付け方（メモ・重み・表題・言語で版が増え、変更なし・時刻だけでは増えない）と保存状態の署名（名簿・曜日パターン・独自配列の並べ替えは未保存、集合の並べ替えは保存済みのまま）・生成中の編集は未保存・独自項目の空値・保存中の月切替と言語切替・出力前の検算と欠落の確認・保存中のフォルダ変更・共通の窓口（待機中の計算開始も断る）・保存の 3 段階（帳票だけの失敗でも月データは保存）OK");
})().catch(e => { console.log("FAIL", e && e.stack || e); process.exitCode = 1; });

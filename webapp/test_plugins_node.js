// 施設のプラグイン（plugin-example）の試験。使い方: node test_plugins_node.js [highs のパス]
//   1) 本体と同じ順でプラグインを読み込み、登録の検査を通ること（規則・暦・docx の様式・訳・プロファイル）
//   2) 規則のプラグインを「必須」にして解くと、その通りの割当になり検算も通ること（highs のパスがあるとき）
//   3) build.py --plugins で組み立てた toban.html にプラグインが入ること
const fs = require("fs"), vm = require("vm"), path = require("path"), os = require("os"), assert = require("assert"), { execFileSync } = require("child_process");
const PLUG = path.join(__dirname, "..", "plugin-example");
vm.runInThisContext(fs.readFileSync(path.join(__dirname, "libs/jszip.min.js"), "utf8"), { filename: "jszip.min.js" });
globalThis.T = {};
const runDir = (dir, tag) => { if (!fs.existsSync(dir)) return; for (const f of fs.readdirSync(dir).filter(x => x.endsWith(".js")).sort()) vm.runInThisContext(fs.readFileSync(path.join(dir, f), "utf8"), { filename: `${tag}/${f}` }); };
for (const f of ["i18n.js", "rules-core.js", "model.js"]) vm.runInThisContext(fs.readFileSync(path.join(__dirname, "src", f), "utf8"), { filename: f });
runDir(path.join(__dirname, "src/calendars"), "calendars"); runDir(path.join(PLUG, "calendars"), "plugin/calendars");
for (const f of ["messages.js", "solver.js", "check.js", "report.js", "docxgen.js", "plugins.js", "merge.js"]) vm.runInThisContext(fs.readFileSync(path.join(__dirname, "src", f), "utf8"), { filename: f });
runDir(path.join(PLUG, "docx"), "plugin/docx");
runDir(path.join(__dirname, "src/rules"), "rules");
runDir(path.join(PLUG, "rules"), "plugin/rules");
for (const q of fs.readdirSync(path.join(__dirname, "lang"))) T.registerLang(JSON.parse(fs.readFileSync(path.join(__dirname, "lang", q), "utf8")));
if (fs.existsSync(path.join(PLUG, "lang"))) for (const q of fs.readdirSync(path.join(PLUG, "lang"))) T.registerLang(JSON.parse(fs.readFileSync(path.join(PLUG, "lang", q), "utf8")));
T.DEFAULT_RULES = JSON.parse(fs.readFileSync(path.join(__dirname, "data/rules.json"), "utf8"));
let n = 0, bad = 0;
const test = (label, fn) => { try { fn(); n++; console.log("ok   " + label); } catch (e) { bad++; console.log("FAIL " + label + "\n      " + (e && e.message)); } };
const RID = "local.example.junior_no_friday_night";
test("規則のプラグインが登録の検査を通り、一覧に並ぶ", () => {
  const d = T.rules.byId[RID]; assert(d, "登録されている"); assert(T.RULE_DEFS.includes(d)); assert.strictEqual(d.def, "off");
  assert(T.MSG.LOCAL_EXAMPLE_JUNIOR_FRIDAY && T.MSG.LOCAL_EXAMPLE_JUNIOR_FRIDAY.en, "文面が本体の表に入る");
});
test("暦のプラグイン: アメリカの連邦祝日（振替を含む）", () => {
  assert.deepStrictEqual(T.holidaysOf({ profile: { calendar: { holidays: "us", closure: [] } } }, 2026, 7).holidays, [3], "2026/7/4 は土曜 → 3 日に振替");
  assert.deepStrictEqual(T.holidaysOf({ profile: { calendar: { holidays: "us", closure: [] } } }, 2026, 11).holidays, [11, 26], "退役軍人の日と感謝祭");
  assert.deepStrictEqual(T.holidaysOf({ profile: { calendar: { holidays: "us", closure: [] } } }, 2027, 12).holidays, [24, 31], "2027/12/25 は土曜 → 24 日、2028/1/1 は土曜 → 12/31");
});
test("docx の様式のプラグインが一覧に出て、本文を作れる", () => {
  assert(T.docx.list().some(t => t.id === "day_list"), "day_list がある");
  const rules = JSON.parse(JSON.stringify(T.DEFAULT_RULES)); T.fillDefaultRules(rules); rules.docx = Object.assign({}, rules.docx, { template: "day_list" });
  const month = T.normalizeMonth(JSON.parse(fs.readFileSync(path.join(__dirname, "data/202611.json"), "utf8")), rules);
  const P = new T.Problem(rules, month), asg = JSON.parse(fs.readFileSync(path.join(__dirname, "data/202611_data_test.json"), "utf8")).result.asg;
  const xml = T.docxXml(P, asg, "確認版", { today: "2026-11-01" }); assert(/11\/1\(/.test(xml) && /夜勤/.test(xml), "日付と勤務帯の見出しが入る");
});
test("訳のプラグイン: 同じ code（en）は本体の表に重なる", () => {
  T.setLang("en"); assert.strictEqual(T.t("補助の役割の人を金曜の夜勤に入れない（施設のプラグインの例）"), "Keep {junior} staff off Friday nights (example facility plug-in)", "プラグインの訳が引ける（役割の呼び方 {junior} は表示のときに施設の名前に置き換わる）");
  assert.strictEqual(T.t("中止"), "Cancel", "本体の訳は残る"); T.setLang("ja");
});
test("プロファイルのプラグイン: 読めて、暦にプラグインの暦を指定している", () => {
  const p = JSON.parse(fs.readFileSync(path.join(PLUG, "profiles/example-clinic.json"), "utf8")); assert.strictEqual(p.profile.id, "example-clinic"); assert.strictEqual(p.profile.calendar.holidays, "us");
  T.fillDefaultRules(p); assert.strictEqual(T.calendarOf(p).holidays, "us");
});
test("build.py --plugins で組み立てた HTML にプラグインが入る", () => {
  const out = path.join(os.tmpdir(), "toban_plugins_test.html"), py = path.join(__dirname, "../tools/.venv/bin/python");
  if (!fs.existsSync(py)) { console.log("      （tools/.venv が無いので組み立ては省略）"); return; }
  execFileSync(py, ["build.py", "--plugins", PLUG, "--out", out], { cwd: __dirname, encoding: "utf8" });
  const html = fs.readFileSync(out, "utf8");
  for (const s of [RID, 'id: "us"', '"day_list"', "example-clinic", '"dir": "plugin-example"']) assert(html.includes(s), "入っていない: " + s);
  assert(!fs.readFileSync(path.join(__dirname, "toban.html"), "utf8").includes(RID), "プラグインなしの toban.html には入らない");
});
test("実行時の読み込み口 T.plugins.load: 5 種類を文字列から登録し、失敗は記録に残って入力チェックに出る", () => {
  const rd2 = (kind, name) => fs.readFileSync(path.join(PLUG, kind, name), "utf8");
  T.calendars.register({ id: "none", label: "build-time override", holidays() { return [5]; } }); // 組み立て時のプラグインによる同梱 id の上書き（最初の load・beginFolder より前＝切替の戻し先に入る）
  assert.deepStrictEqual(T.calendars.defs.find(c => c.id === "none").holidays(2026, 11), [5], "defs 側も置き換わる");
  const r1 = T.plugins.load("rules", "rules/x.js", rd2("rules", "local.example.junior_no_friday_night.js")); assert(r1.ok, r1.error); // 同じ id の読み直しは上書き
  const r2 = T.plugins.load("calendars", "calendars/us.js", rd2("calendars", "us.js")); assert(r2.ok && T.calendars.byId.us, r2.error);
  const r3 = T.plugins.load("docx", "docx/day_list.js", rd2("docx", "day_list.js")); assert(r3.ok && T.docx.list().some(t => t.id === "day_list"));
  const r4 = T.plugins.load("lang", "lang/en.json", rd2("lang", "en.json")); assert(r4.ok && r4.ids[0] === "en");
  T.PROFILES = T.PROFILES || []; const before = T.PROFILES.length;
  const r5 = T.plugins.load("profiles", "profiles/example-clinic.json", rd2("profiles", "example-clinic.json")); assert(r5.ok && r5.ids[0] === "example-clinic");
  T.plugins.load("profiles", "profiles/example-clinic.json", rd2("profiles", "example-clinic.json")); assert.strictEqual(T.PROFILES.length, before + 1, "同じ id のプロファイルは置き換わる（増えない）");
  const bad = T.plugins.load("rules", "rules/broken.js", "T.rules.register({ id: 'local.x.broken', api: 1, solve() {} })"); assert(!bad.ok && /check|penalty/.test(bad.error), "登録の検査で拒否される: " + bad.error);
  const bad2 = T.plugins.load("lang", "lang/broken.json", "{ not json"); assert(!bad2.ok);
  assert.strictEqual(T.plugins.errors().length, 2);
  const rules = JSON.parse(JSON.stringify(T.DEFAULT_RULES)); T.fillDefaultRules(rules);
  const month = T.normalizeMonth({ year: 2026, month: 11, holidays: [3, 23], plugins_used: ["local.gone.rule", RID] }, rules);
  const lint = T.lint(new T.Problem(rules, month));
  assert.strictEqual(lint.filter(x => x.code === "LINT_PLUGIN_ERROR").length, 2, "読めなかったプラグインが入力チェックに出る");
  const miss = lint.find(x => x.code === "LINT_PLUGIN_MISSING"); assert(miss && miss.args.who === "local.gone.rule", "計算に使ったプラグインが無いことを知らせる（読み込まれているプラグインは除く）: " + JSON.stringify(miss && miss.args));
  const f = T.flattenMonth(month), m2 = T.unflattenMonth(f); assert.deepStrictEqual(m2.plugins_used.slice().sort(), ["local.gone.rule", RID].sort(), "統合でも残る");
  // フォルダを切り替えて読み直したとき、前のフォルダで読んだ規則は外れ、保存データが参照していれば LINT_PLUGIN_MISSING で知らせる
  T.plugins.beginFolder(); T.plugins.load("rules", "rules/x.js", rd2("rules", "local.example.junior_no_friday_night.js"));
  T.plugins.load("rules", "rules/old.js", 'T.rules.register({ id: "local.old.leftover", api: 1, states: ["off"], solve() { }, check() { }, penalty() { } })'); assert(T.rules.byId["local.old.leftover"]); // 前のフォルダで読んだ想定
  T.plugins.beginFolder(); T.plugins.load("rules", "rules/x.js", rd2("rules", "local.example.junior_no_friday_night.js"));
  assert(!T.rules.byId["local.old.leftover"] && !T.rules.defs.some(d => d.id === "local.old.leftover"), "読み直されなかった規則は外れる"); assert.deepStrictEqual(T.plugins.stale(), []);
  { const r2 = JSON.parse(JSON.stringify(rules)); r2.rule_states["local.old.leftover"] = "hard"; assert(T.lint(new T.Problem(r2, T.normalizeMonth({ year: 2026, month: 11, holidays: [3, 23] }, r2))).some(x => x.code === "LINT_PLUGIN_MISSING"), "参照している設定には LINT_PLUGIN_MISSING"); }
  // 同梱の規則を実行時のプラグインが上書きしても切替で元に戻り、実行時に足した区分・拡張は外れる（baseline は最初の切替時の写し）
  { const orig = T.rules.byId.same_day_double.check;
    const ov = T.plugins.load("rules", "rules/ov.js", 'T.rules.register({ id: "same_day_double", api: 1, states: ["hard", "soft", "off"], def: "hard", weight: "same_day_double", solve() { }, check() { }, penalty() { } }); T.dayFlags.register({ id: "test.rt.flag", label: "rt" }); T.calendarExt.register({ id: "test.rt.ext", paidLeave: true });'); assert(ov.ok, ov.error);
    assert(T.rules.byId.same_day_double.check !== orig && T.dayFlags.byId["test.rt.flag"] && T.calendarExt.defs.some(x => x.id === "test.rt.ext"), "上書き・追加されている");
    assert(T.plugins.overrides().some(o => o.id === "same_day_double"), "同梱の規則の上書きも記録に出る");
    T.plugins.beginFolder();
    assert.strictEqual(T.rules.byId.same_day_double.check, orig, "同梱の規則の check が戻る"); assert(!T.rules.byId.same_day_double.source, "同梱の規則に出どころが残らない");
    assert(!T.dayFlags.byId["test.rt.flag"] && !T.calendarExt.defs.some(x => x.id === "test.rt.ext"), "実行時に足した区分・拡張は外れる"); }
  // 途中で失敗した規則のファイルが触った登録（規則・区分・拡張）は、失敗した時点で読み込む前の状態に戻る
  { const bad3 = T.plugins.load("rules", "rules/half.js", 'T.rules.register({ id: "local.half.rule", api: 1, states: ["off"], solve() { }, check() { }, penalty() { } }); T.dayFlags.register({ id: "local.half.flag", label: "x" }); T.calendarExt.register({ id: "local.half.ext", hideDuties: true }); throw new Error("途中で失敗");');
    assert(!bad3.ok && /途中で失敗/.test(bad3.error)); assert(!T.rules.byId["local.half.rule"], "失敗したファイルの規則は残らない"); assert(!T.dayFlags.byId["local.half.flag"], "区分も残らない"); assert(!T.calendarExt.defs.some(x => x.id === "local.half.ext"), "拡張も残らない");
    assert.strictEqual(T.calendarExt.merged(rules).hideDuties, false, "画面の拡張が効いていない"); }
  // 文面（T.MSG）・訳・プロファイルも、失敗した読み込みとフォルダ切替で元に戻る
  { const ja0 = T.MSG.REST_AFTER_AKE.ja; T.setLang("en"); const en0 = T.t("中止"); T.setLang("ja"); const nProf = (T.PROFILES || []).length;
    const b4 = T.plugins.load("rules", "rules/msg.js", 'T.rules.register({ id: "local.msg.rule", api: 1, states: ["off"], solve() { }, check() { }, penalty() { }, messages: { REST_AFTER_AKE: { en: "x", ja: "上書き" } } }); throw new Error("失敗");');
    assert(!b4.ok); assert.strictEqual(T.MSG.REST_AFTER_AKE.ja, ja0, "失敗した読み込みの文面の上書きは戻る");
    const l5 = T.plugins.load("lang", "lang/en.json", JSON.stringify({ code: "en", ui: { "中止": "Abort!" } })); assert(l5.ok);
    const p5 = T.plugins.load("profiles", "profiles/x.json", JSON.stringify({ profile: { id: "local-x-prof", label: "x" }, doctors: [] })); assert(p5.ok);
    const r5 = T.plugins.load("rules", "rules/msg2.js", 'T.rules.register({ id: "local.msg2.rule", api: 1, states: ["off"], solve() { }, check() { }, penalty() { }, messages: { REST_AFTER_AKE: { en: "x", ja: "上書き2" } } })'); assert(r5.ok, r5.error);
    T.setLang("en"); assert.strictEqual(T.t("中止"), "Abort!"); T.setLang("ja"); assert.strictEqual(T.MSG.REST_AFTER_AKE.ja, "上書き2"); assert((T.PROFILES || []).some(p => p.profile.id === "local-x-prof"));
    T.plugins.beginFolder();
    T.setLang("en"); assert.strictEqual(T.t("中止"), en0, "切替で訳が戻る"); T.setLang("ja"); assert.strictEqual(T.MSG.REST_AFTER_AKE.ja, ja0, "切替で文面が戻る"); assert.strictEqual((T.PROFILES || []).length, nProf, "切替でプロファイルが戻る"); assert(!T.rules.byId["local.msg2.rule"]); }
  T.plugins.beginFolder(); T.plugins.load("rules", "rules/x.js", rd2("rules", "local.example.junior_no_friday_night.js"));
  // 引用符の書き方に関わらず、読み直した規則は stale にならない（登録口が受け取った id を記録する）
  T.plugins.beginFolder(); const src1 = "T.rules.register({ id: 'local.q.single', api: 1, states: ['off'], solve() {}, check() {}, penalty() {} });";
  T.plugins.load("rules", "rules/q.js", src1); T.plugins.beginFolder(); const rq = T.plugins.load("rules", "rules/q.js", src1);
  assert.deepStrictEqual(rq.ids, ["local.q.single"]); assert.deepStrictEqual(T.plugins.stale(), [], "読み直しで stale にならない");
  { const i = T.rules.defs.findIndex(d => d.id === "local.q.single"); T.rules.defs.splice(i, 1); delete T.rules.byId["local.q.single"]; }
  // 前のフォルダの暦・様式は、フォルダを切り替えると登録から外れる
  T.plugins.beginFolder(); T.plugins.load("calendars", "calendars/f.js", "T.calendars.register({ id: 'local.fac.cal', label: 'x', holidays() { return [5]; } });"); T.plugins.load("docx", "docx/f.js", "T.docx.register('local_fac_docx', () => '', { label: 'x' });");
  assert(T.calendars.byId["local.fac.cal"] && T.docx.list().some(t => t.id === "local_fac_docx"));
  T.plugins.beginFolder(); assert(!T.calendars.byId["local.fac.cal"], "前のフォルダの暦は外れる"); assert(!T.docx.list().some(t => t.id === "local_fac_docx"), "前のフォルダの様式は外れる");
  assert(T.calendars.byId.us, "同じ回で読んだ暦は残る（この試験の最初で us を読んでいる）");
  // 登録の途中で失敗したプラグイン: 登録した暦はその場で外れ、フォルダを替えても残らない（docx も同じ）
  T.plugins.beginFolder();
  const rf = T.plugins.load("calendars", "calendars/partial.js", "T.calendars.register({ id: 'local.partial', label: 'x', holidays() { return [5]; } }); throw new Error('途中で失敗');");
  assert(!rf.ok && !T.calendars.byId["local.partial"], "失敗したプラグインの暦は残らない");
  const rfd = T.plugins.load("docx", "docx/partial.js", "T.docx.register('local_partial_docx', () => '', { label: 'x' }); throw new Error('途中で失敗');");
  assert(!rfd.ok && !T.docx.list().some(t => t.id === "local_partial_docx"), "失敗したプラグインの様式は残らない");
  T.plugins.beginFolder(); assert(!T.calendars.byId["local.partial"] && !T.docx.list().some(t => t.id === "local_partial_docx"));
  // 同梱の id を上書きしたプラグイン: その回は上書きが効き、フォルダを替えると同梱の定義に戻る
  const jp0 = T.calendars.byId.jp.holidays(2026, 11).slice(), wb0 = T.docx.get("week_block").render;
  T.plugins.load("calendars", "calendars/jp.js", "T.calendars.register({ id: 'jp', label: 'x', holidays() { return [5]; } });");
  T.plugins.load("docx", "docx/wb.js", "T.docx.register('week_block', () => '', { label: 'x' });");
  assert.deepStrictEqual(T.calendars.byId.jp.holidays(2026, 11), [5], "上書きは効く"); assert.notStrictEqual(T.docx.get("week_block").render, wb0);
  T.plugins.beginFolder();
  assert.deepStrictEqual(T.calendars.byId.jp.holidays(2026, 11), jp0, "フォルダを替えると同梱の暦に戻る: " + jp0.join(","));
  assert.strictEqual(T.docx.get("week_block").render, wb0, "同梱の様式にも戻る");
  T.plugins.load("calendars", "calendars/none.js", "T.calendars.register({ id: 'none', label: 'x', holidays() { return [7]; } });"); assert.deepStrictEqual(T.calendars.byId.none.holidays(2026, 11), [7]);
  T.plugins.beginFolder(); assert.deepStrictEqual(T.calendars.byId.none.holidays(2026, 11), [5], "組み立て時の上書きへ戻る（標準の [] ではない）");
  assert.deepStrictEqual(T.plugins.stale(), []);
  // 規則のファイルの中で登録した日ごとの区分・カレンダーの拡張は、フォルダを替えると外れる
  T.plugins.beginFolder(); T.plugins.load("rules", "rules/ext.js", "T.dayFlags.register({ id: 'local.t.flag', label: 'x' }); T.calendarExt.register({ id: 'local.t.cal', fixedTags: [{ label: 'x' }] });");
  assert(T.dayFlags.byId["local.t.flag"] && T.calendarExt.defs.some(x => x.id === "local.t.cal"));
  T.plugins.beginFolder(); assert(!T.dayFlags.byId["local.t.flag"], "日ごとの区分は外れる"); assert(!T.calendarExt.defs.some(x => x.id === "local.t.cal"), "カレンダーの拡張も外れる");
  T.plugins.loaded.length = 0; // 以降の試験に持ち込まない
});
test("最初の beginFolder より前の load も、切替で外れる（baseline に混ざらない）", () => {
  const ctx = vm.createContext({ console }); const src = f => fs.readFileSync(path.join(__dirname, "src", f), "utf8");
  vm.runInContext("globalThis.T = {};", ctx); for (const f of ["i18n.js", "rules-core.js", "model.js", "messages.js", "plugins.js"]) vm.runInContext(src(f), ctx, { filename: f });
  const T2 = ctx.T; const r = T2.plugins.load("rules", "rules/early.js", 'T.rules.register({ id: "local.early.test", api: 1, states: ["off"], solve() { }, check() { }, penalty() { }, messages: { LINT_PLUGIN_ERROR: { en: "x", ja: "早い上書き" } } })'); assert(r.ok, r.error);
  assert(T2.rules.byId["local.early.test"] && T2.MSG.LINT_PLUGIN_ERROR.ja === "早い上書き");
  T2.plugins.beginFolder(); assert(!T2.rules.byId["local.early.test"], "切替で外れる"); assert.notStrictEqual(T2.MSG.LINT_PLUGIN_ERROR.ja, "早い上書き", "文面も戻る");
  assert(!T2.plugins.inventory().some(p => p.name === "rules/early.js"), "一覧にも残らない");
});
test("プラグインの規則の出どころ・登録し直し・重なり: 定義に source が付き、入力チェック（LINT_PLUGIN_OVERRIDE・LINT_RULE_OVERLAP）に出る", () => {
  const rd2 = (kind, name) => fs.readFileSync(path.join(PLUG, kind, name), "utf8"); T.setLang("ja");
  T.plugins.beginFolder();
  const r0 = T.plugins.load("rules", "rules/x.js", rd2("rules", "local.example.junior_no_friday_night.js")); assert(r0.ok, r0.error);
  assert.deepStrictEqual(r0.overrode, [{ id: RID, was: null }], "切替直後の読み込みは、組み立て時（本体）の同じ id への登録し直しとして記録される");
  const r1 = T.plugins.load("rules", "rules/x.js", rd2("rules", "local.example.junior_no_friday_night.js")); assert(r1.ok, r1.error);
  assert.strictEqual(T.RULE_BY_ID[RID].source, "rules/x.js", "読んだファイル名が出どころになる"); assert.deepStrictEqual(r1.overrode, [], "同じファイルの読み直しは登録し直しではない");
  const r2 = T.plugins.load("rules", "rules/y.js", rd2("rules", "local.example.junior_no_friday_night.js")); assert(r2.ok, r2.error);
  assert.deepStrictEqual(r2.overrode, [{ id: RID, was: "rules/x.js" }], "別のファイルが同じ id を登録すると記録される"); assert.strictEqual(T.RULE_BY_ID[RID].source, "rules/y.js");
  const r3 = T.plugins.load("rules", "rules/z.js", 'T.rules.register({ id: "local.t.overlap", api: 1, label: "重なりの試験", states: ["soft", "off"], def: "soft", weight: "local_t_overlap", w0: 1, overlaps: ["same_weekday_cap"], solve() { }, check() { }, penalty() { }, python: false })'); assert(r3.ok, r3.error);
  const rules = JSON.parse(JSON.stringify(T.DEFAULT_RULES)); T.fillDefaultRules(rules); rules.rule_states["local.t.overlap"] = "soft"; rules.rule_states.same_weekday_cap = "soft";
  const lintOf = R => T.lint(new T.Problem(R, T.normalizeMonth({ year: 2026, month: 11, holidays: [3, 23] }, R)));
  const l1 = lintOf(rules), ov = l1.find(x => x.code === "LINT_PLUGIN_OVERRIDE"), ol = l1.find(x => x.code === "LINT_RULE_OVERLAP");
  assert(ov && ov.args.name === "rules/y.js" && ov.args.who === RID && ov.args.was === "rules/x.js", "登録し直しが入力チェックに出る: " + JSON.stringify(ov && ov.args));
  assert(ol && ol.args.a === "local.t.overlap" && ol.args.b === "same_weekday_cap" && /同じことを扱い/.test(ol.msg), "重なりが入力チェックに出る: " + JSON.stringify(ol && ol.args));
  assert.strictEqual(l1.filter(x => x.code === "LINT_RULE_OVERLAP").length, 1, "同じ組は 1 回");
  rules.rule_states.same_weekday_cap = "off"; assert(!lintOf(rules).some(x => x.code === "LINT_RULE_OVERLAP"), "片方を「なし」にすれば出ない");
  // プラグインごとの付け外し（rules.plugins_off）と一覧（inventory）
  const r4 = T.plugins.load("rules", "rules/w.js", 'T.dayFlags.register({ id: "local.t.flag", label: { ja: "区分", en: "Flag" } }); T.calendarExt.register({ id: "local.t.ext", fields: [{ id: "local.t.f", label: "x", options: [["a", "A"]] }] });'); assert(r4.ok, r4.error);
  assert.strictEqual(T.dayFlags.byId["local.t.flag"].source, "rules/w.js"); assert.strictEqual(T.calendarExt.defs.find(x => x.id === "local.t.ext").source, "rules/w.js");
  const rulesOff = JSON.parse(JSON.stringify(rules)); rulesOff.rule_states.same_weekday_cap = "soft"; rulesOff.plugins_off = ["rules/z.js", "rules/w.js"];
  assert.strictEqual(T.ruleState(rules, "local.t.overlap"), "soft"); assert.strictEqual(T.ruleState(rulesOff, "local.t.overlap"), "off", "無効にしたプラグインの規則は「なし」");
  assert(!lintOf(rulesOff).some(x => x.code === "LINT_RULE_OVERLAP"), "無効なら重なりも出ない");
  assert(T.dayFlags.activeFor(rules).some(f => f.id === "local.t.flag") && !T.dayFlags.activeFor(rulesOff).some(f => f.id === "local.t.flag"), "日ごとの区分も無いものとして扱う");
  assert(T.calendarExt.merged(rules).fields.some(f => f.id === "local.t.f") && !T.calendarExt.merged(rulesOff).fields.some(f => f.id === "local.t.f"), "カレンダーの拡張も無いものとして扱う");
  const inv = T.plugins.inventory(), z = inv.find(p => p.name === "rules/z.js"), w = inv.find(p => p.name === "rules/w.js");
  assert(z && z.where === "folder" && z.ok && z.items.rules.includes("local.t.overlap"), JSON.stringify(z)); assert(w && w.items.dayflags.includes("local.t.flag") && w.items.calext.includes("local.t.ext"), JSON.stringify(w));
  T.dayFlags.unregister("local.t.flag"); T.calendarExt.unregister("local.t.ext");
  { const i2 = T.rules.defs.findIndex(d => d.id === "local.t.overlap"); T.rules.defs.splice(i2, 1); delete T.rules.byId["local.t.overlap"]; }
  // 様式と暦も、そのファイルを無効にすると無いものとして扱う（一覧から消え、入力チェックに出る）
  { const rd3 = T.plugins.load("docx", "docx/t.js", 'T.docx.register("local_t_sheet", () => "", { label: "t" })'); assert(rd3.ok, rd3.error); const rc3 = T.plugins.load("calendars", "calendars/t.js", 'T.calendars.register({ id: "local_t_cal", label: "t", holidays() { return [1]; } })'); assert(rc3.ok, rc3.error);
    const r6 = JSON.parse(JSON.stringify(rules)); r6.docx = { template: "local_t_sheet" }; r6.profile = Object.assign({}, r6.profile, { calendar: { holidays: "local_t_cal" } });
    const lintOf6 = R => T.lint(new T.Problem(R, T.normalizeMonth({ year: 2026, month: 11, holidays: [3, 23] }, R)));
    assert(T.docx.list(r6).some(t => t.id === "local_t_sheet") && !lintOf6(r6).some(x => x.code === "LINT_DOCX_TEMPLATE_MISSING" || x.code === "LINT_CALENDAR_MISSING"), "有効なら使える");
    r6.plugins_off = ["docx/t.js", "calendars/t.js"];
    assert(!T.docx.list(r6).some(t => t.id === "local_t_sheet"), "無効にした様式は一覧から消える"); assert.throws(() => T.docxXml(new T.Problem(r6, T.normalizeMonth({ year: 2026, month: 11, holidays: [3, 23] }, r6)), {}, "確認版"), /無効/, "無効にした様式では作れない");
    assert.strictEqual(T.calendarOf(r6).holidays, "jp", "無効にした暦は既定へ"); const l6 = lintOf6(r6); assert(l6.some(x => x.code === "LINT_DOCX_TEMPLATE_MISSING") && l6.some(x => x.code === "LINT_CALENDAR_MISSING"), "入力チェックに出る");
    T.docx.unregister("local_t_sheet"); T.calendars.unregister("local_t_cal"); }
  T.plugins.beginFolder(); T.plugins.load("rules", "rules/x.js", rd2("rules", "local.example.junior_no_friday_night.js")); // 後のために元の出どころへ戻す
});
(async () => {
  const highsPath = process.argv[2];
  if (highsPath) {
    const highs = await require(highsPath)();
    test("規則のプラグインを必須にして解くと、補助の役割は金曜夜勤に入らず、検算も通る", () => {
      const rules = JSON.parse(JSON.stringify(T.DEFAULT_RULES)); rules.rule_states = Object.assign({}, rules.rule_states, { [RID]: "hard" }); T.fillDefaultRules(rules);
      const month = T.normalizeMonth(JSON.parse(fs.readFileSync(path.join(__dirname, "data/202611.json"), "utf8")), rules);
      const P = new T.Problem(rules, month); const r = T.solve(P, highs, { timeLimit: 60 }); assert(r.asg, "解ける: " + r.status);
      const c = T.check(P, r.asg); assert.strictEqual(c.V.length, 0, "違反: " + c.V.join(" / "));
      for (const n2 of P.dutyNames) if (P.isRole(n2, "junior")) for (const s of P.slots) if (s[1] === "night" && P.dow(s[0]) === 4) assert(!c.A.worked(n2, s), `${n2} が金曜夜勤 ${s[0]}`);
      // 減点にしたときは、解く側の目的関数と減点の数え直しが一致する（全枠を固定して解く）
      const r2 = JSON.parse(JSON.stringify(T.DEFAULT_RULES)); r2.rule_states = Object.assign({}, r2.rule_states, { [RID]: "soft" }); T.fillDefaultRules(r2);
      const P2 = new T.Problem(r2, T.normalizeMonth(JSON.parse(fs.readFileSync(path.join(__dirname, "data/202611.json"), "utf8")), r2));
      const s2 = T.solve(P2, highs, { timeLimit: 60 }); const pin = T.solve(P2, highs, { timeLimit: 60, pin: s2.asg }); assert(Math.abs(pin.objective - T.penalty(P2, s2.asg).total) < 1e-6, "点数の一致");
    });
  } else console.log("（highs のパス指定が無いので、解く試験は省略）");
  console.log(`${n} tests passed${bad ? "（失敗あり）" : ""}`); process.exit(bad ? 1 : 0);
})();

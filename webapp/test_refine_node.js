// 当直表アプリ: 回帰テスト（assert 付き）。node test_refine_node.js <highs パッケージのパス>
// テストデータは data/202611_data_test.json（固定した写し。202611/ は運用中のデータなので参照しない）
// 対象: 名簿の正規化（部長の勤務・表示順の不整合）、規則の欠損補完、固定指定の検算分類、docx の XML 整形式、統合の往復、翌月1日欄
const fs = require("fs"), vm = require("vm"), path = require("path"), assert = require("assert"), { execFileSync } = require("child_process");
vm.runInThisContext(fs.readFileSync(path.join(__dirname, "libs/jszip.min.js"), "utf8"), { filename: "jszip.min.js" });
globalThis.T = {};
for (const f of ["i18n.js", "rules-core.js", "model.js", "messages.js", "solver.js", "check.js", "report.js", "docxgen.js", "merge.js"]) vm.runInThisContext(fs.readFileSync(path.join(__dirname, "src", f), "utf8"), { filename: f });
for (const f of fs.readdirSync(path.join(__dirname, "src/rules")).filter(x => x.endsWith(".js"))) vm.runInThisContext(fs.readFileSync(path.join(__dirname, "src/rules", f), "utf8"), { filename: "rules/" + f }); // 規則のプラグイン
for (const f of fs.readdirSync(path.join(__dirname, "src/calendars")).filter(x => x.endsWith(".js"))) vm.runInThisContext(fs.readFileSync(path.join(__dirname, "src/calendars", f), "utf8"), { filename: "calendars/" + f }); // 暦のプラグイン
for (const q of fs.readdirSync(path.join(__dirname, "lang"))) T.registerLang(JSON.parse(fs.readFileSync(path.join(__dirname, "lang", q), "utf8"))); // 表示言語（lang/*.json）
T.DEFAULT_RULES = JSON.parse(fs.readFileSync(path.join(__dirname, "data/rules.json"), "utf8"));
const real = JSON.parse(fs.readFileSync(path.join(__dirname, "data/202611_data_test.json"), "utf8"));
const clone = o => JSON.parse(JSON.stringify(o));
const highsPath = process.argv[2];
let passed = 0;
const test = (name, fn) => { try { fn(); passed++; console.log("ok  ", name); } catch (e) { console.log("FAIL", name, "\n     ", e && e.message || e); process.exitCode = 1; } };

test("前月から取り込む日数（T.prevLookback）は、勤務帯ごとの連続の上限（shift_run_max）が必要とする日数も採る", () => {
  const rules = clone(T.DEFAULT_RULES); T.fillDefaultRules(rules); rules.rule_states.run_length_max = "off"; rules.rule_states.run_length_min = "off";
  rules.rule_states.shift_run_max = "off"; assert.strictEqual(T.prevLookback(rules), 2, "連続の規則が無ければ 2 日");
  rules.rule_states.shift_run_max = "hard"; rules.shift_run_max = { day: 3 }; assert.strictEqual(T.prevLookback(rules), 4, "日勤は連続 3 日までなら 4 日");
  rules.shift_run_max = { day: 3, night: 6 }; assert.strictEqual(T.prevLookback(rules), 7); rules.rule_states.run_length_max = "hard"; rules.run_length = { max: 5 }; assert.strictEqual(T.prevLookback(rules), 7, "全体の連勤（5+2）より大きい方");
});
test("部長を勤務者にしても check が落ちず、違反として出る", () => {
  const rules = clone(real.rules), month = T.normalizeMonth(clone(real.month), rules);
  const P = new T.Problem(rules, month); const asg = clone(real.result.asg);
  const chief = rules.doctors.find(d => d.team === "C").name; asg["2:night"].work = chief;
  const r = T.check(P, asg); assert(r.V.some(v => v.includes(chief) && v.includes("部長")), "部長の勤務が違反に出る");
});
test("fillDefaultRules は OC構成の「部長」行が欠けた保存データを既定で補う（設定タブが 0 を表示しない）", () => {
  const rules = clone(real.rules); delete rules.oncall_requirement.C; T.fillDefaultRules(rules);
  assert.deepStrictEqual(rules.oncall_requirement.C, T.DEFAULT_RULES.oncall_requirement.C);
  assert.deepStrictEqual(rules.oncall_requirement.A, real.rules.oncall_requirement.A, "既にある行は変えない");
  rules.oncall_requirement.C = { I: 0, Y: 0 }; T.fillDefaultRules(rules);
  assert.deepStrictEqual(rules.oncall_requirement.C, { I: 0, Y: 0 }, "意図して 0 にした行はそのまま（設定タブで編集できるようになったため。2026-09-20）");
  for (const row of Object.keys(rules.oncall_requirement)) rules.oncall_requirement[row] = { I: 0, Y: 0 };
  T.fillDefaultRules(rules); assert.deepStrictEqual(rules.oncall_requirement, T.DEFAULT_RULES.oncall_requirement, "表が全部 0（旧画面の書き込み）のときだけ既定に戻す");
});
test("固定「若手OCなし」は統合の往復で残る", () => {
  const rules = clone(real.rules), m = T.normalizeMonth(clone(real.month), rules); m.fixed.night_oc_none = { 5: ["Y"] }; m.fixed.day_oc_none = { 7: ["Y"] };
  const back = T.unflattenMonth(T.flattenMonth(m), m); assert.deepStrictEqual(back.fixed.night_oc_none, { 5: ["Y"] }); assert.deepStrictEqual(back.fixed.day_oc_none, { 7: ["Y"] });
  assert(/若手OCなし/.test(T.label ? T.label("fnon:5:Y") : "若手OCなし"));
});
test("役割は識別子も表示名も施設で決められる（一覧が正。機能は charge/other/junior/reserve）", () => {
  const rules = clone(real.rules);
  rules.profile = Object.assign({}, rules.profile, { roles: [
    { id: "D", label: "日勤リーダー", refs: ["charge"], standby: true },
    { id: "N", label: "夜勤リーダー", refs: ["other"] },
    { id: "S", label: "スタッフ", refs: ["junior"], standby: true },
    { id: "R", label: "予備", refs: ["reserve"] }] });
  const map = { I: "D", A: "N", Y: "S", C: "R" };
  rules.doctors = rules.doctors.map(d => Object.assign({}, d, { team: map[d.team] }));
  rules.oncall_requirement = { D: { D: 0, S: 1 }, N: { D: 1, S: 1 }, S: { D: 1, S: 0 }, R: { D: 1, S: 0 } };
  rules.name_order = rules.name_order.slice();
  T.fillDefaultRules(rules);
  const P = new T.Problem(rules, T.normalizeMonth(clone(real.month), rules));
  assert.deepStrictEqual(P.roleIds, ["D", "N", "S", "R"]);
  assert.strictEqual(P.refId("charge"), "D"); assert.strictEqual(P.refId("junior"), "S");
  assert.strictEqual(P.roleLabel("D"), "日勤リーダー");
  assert(P.I.length && P.I.every(n => P.team[n] === "D"), "期間責任者の役割の名簿が引ける");
  assert(P.standbyRoleIds.includes("D") && P.standbyRoleIds.includes("S") && !P.standbyRoleIds.includes("N"));
  assert.deepStrictEqual(T.lint(P).filter(x => /役割/.test(x.msg)).map(x => x.msg), [], "整合していれば指摘なし");
  const bad = clone(rules); bad.doctors = bad.doctors.map((d, i) => i === 0 ? Object.assign({}, d, { team: "X" }) : d);
  assert(T.lint(new T.Problem(bad, T.normalizeMonth(clone(real.month), bad))).some(x => /役割一覧にありません/.test(x.msg)), "一覧に無い役割を指摘");
  const dup = clone(rules); dup.profile.roles = dup.profile.roles.map(r => Object.assign({}, r, { refs: ["charge"] }));
  assert.throws(() => new T.Problem(dup, T.normalizeMonth(clone(real.month), dup)), /1 つにしてください/);
});
test("配置人数の設定: 勤務帯ごと・日の種別ごと・整数のどれでも読める", () => {
  const mk = count => { const r = clone(real.rules); r.profile = Object.assign({}, r.profile, { positions: { work: { count } } });
    r.rule_states = Object.assign({}, r.rule_states, { oncall: "off", period_charge: "off", same_day_team: "off" }); // 複数名では併用できない規則
    T.fillDefaultRules(r); return new T.Problem(r, T.normalizeMonth(clone(real.month), r)); };
  const a = mk({ day: 3, night: 2 }); assert.strictEqual(a.countOf([1, "day"]), 3); assert.strictEqual(a.countOf([2, "night"]), 2);
  const b = mk(2); assert.strictEqual(b.countOf([2, "night"]), 2);
  const c = mk({ weekday: 1, off_days: 2 }); assert.strictEqual(c.countOf([1, "day"]), 2); assert.strictEqual(c.countOf([2, "night"]), 1); // 11/1 は日曜
  const d = mk(undefined); assert.strictEqual(d.countOf([2, "night"]), 1, "書かなければ 1 名");
});
test("name_order に名簿にない名前があっても報告・docx が作れる", () => {
  const rules = clone(real.rules); rules.name_order = ["存在しない", ...rules.name_order]; const month = T.normalizeMonth(clone(real.month), rules);
  const P = new T.Problem(rules, month); assert(!P.nameOrder.includes("存在しない"));
  const rep = T.buildReport(P, real.result.asg, {}); assert(rep.sections.length >= 10);
  const xml = T.docxXml(P, real.result.asg, "確認版"); assert(xml.includes("<w:tbl>"));
});
test("固定指定で目安+1を超えた回数は違反ではなく「固定指定により許容」に入る", () => {
  const rules = clone(real.rules), month = T.normalizeMonth(clone(real.month), rules);
  const doc = rules.doctors.find(d => d.name === "Dr N"); const q = +doc.quota;
  const asg = clone(real.result.asg);
  const own = Object.keys(asg).filter(k => asg[k].work === "Dr N").map(k => +k.split(":")[0]); // いま働いている日
  const extra = Object.keys(asg).filter(k => k.endsWith(":night") && asg[k].work !== "Dr N" && !asg[k].oc.includes("Dr N")).map(k => +k.split(":")[0]).filter(d => !own.some(o => Math.abs(o - d) <= 1)).slice(0, q + 2 - own.length);
  month.fixed = { night: {}, day: {}, weekend_charge: {}, day_oc: {}, night_oc: {} };
  for (const k of Object.keys(asg)) if (asg[k].work === "Dr N") month.fixed[k.endsWith(":day") ? "day" : "night"][+k.split(":")[0]] = "Dr N";
  for (const d of extra) { month.fixed.night[d] = "Dr N"; asg[`${d}:night`].work = "Dr N"; }
  const P = new T.Problem(rules, month);
  const r = T.check(P, asg); assert(!r.V.some(v => v.startsWith("Dr N: 勤務")), "回数超過は V に残らない: " + r.V.filter(v => v.startsWith("Dr N")).join(" / "));
  assert(r.W.some(v => v.includes("固定指定") && v.includes("Dr N")), "W に回数超過が出る");
});
test("不可日に固定した枠は違反ではなく W に入る（文言ではなく日と医師で判定）", () => {
  const rules = clone(real.rules), month = T.normalizeMonth(clone(real.month), rules);
  month.unavailable_night["Dr E"] = [...new Set([...(month.unavailable_night["Dr E"] || []), 4])]; month.fixed.night = { 4: "Dr E" };
  const P = new T.Problem(rules, month); const asg = clone(real.result.asg); asg["4:night"].work = "Dr E";
  const r = T.check(P, asg); assert(r.W.some(v => v.includes("Dr E") && v.includes("夜間不可")), "不可の違反が W に移る"); assert(!r.V.some(v => v.includes("Dr E") && v.includes("夜間不可")));
});
test("前月末の枠のラベルが前月の日付になる", () => {
  const rules = clone(real.rules), month = T.normalizeMonth(clone(real.month), rules); const P = new T.Problem(rules, month);
  assert.strictEqual(P.label(0), "10/31(土)"); assert.strictEqual(P.label(-1), "10/30(金)");
});
test("docx の document.xml が整形式（xmllint）で、制御文字は落ちる", () => {
  const rules = clone(real.rules), month = T.normalizeMonth(clone(real.month), rules); const P = new T.Problem(rules, month);
  const xml = T.docxXml(P, real.result.asg, "確認版（制御文字入り）");
  assert(!//.test(xml), "制御文字が残っていない");
  const tmp = path.join(require("os").tmpdir(), "toban_test_document.xml"); fs.writeFileSync(tmp, xml);
  try { execFileSync("xmllint", ["--noout", tmp]); } catch (e) { if (e.code === "ENOENT") return; throw new Error("xmllint が整形式でないと判定: " + String(e.stderr).slice(0, 200)); }
});
test("ダメ日の略称: 敬称を除いた先頭が重なる医師は文字数を伸ばす、サロゲートペアも1文字", () => {
  const rules = clone(real.rules); rules.doctors.push({ name: "Dr Es", team: "Y", years: 1, quota: 3 }); rules.doctors.push({ name: "𠮷田", team: "Y", years: 1, quota: 3 });
  const month = T.normalizeMonth(clone(real.month), rules);
  for (const n of Object.keys(month.unavailable_night)) month.unavailable_night[n] = month.unavailable_night[n].filter(d => d !== 2); month.unavailable_other = month.unavailable_other.filter(u => u.day !== 2); // 11/2 の不可はこの 3 人だけ（4 人以上だと区切り無しで並ぶ）
  month.unavailable_night["Dr E"] = [2]; month.unavailable_night["Dr Es"] = [2]; month.unavailable_night["𠮷田"] = [2];
  const P = new T.Problem(rules, month); const xml = T.docxXml(P, real.result.asg, "確認版");
  assert(/[>・]Es[<・]/.test(xml), "重なる先頭は伸ばす（Dr Es → Es）: " + (xml.match(/ダメ日[\s\S]{0,400}/) || [""])[0].slice(0, 200));
  assert(xml.includes("𠮷"), "サロゲートが壊れない"); assert(!/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(xml));
});
test("統合の往復: 実データの全項目が flatten→unflatten で残る（旧形式の項目は落ちる）", () => {
  const rules = clone(real.rules), m = T.normalizeMonth(clone(real.month), rules); m.cath_off_days = [5];
  const f = T.flattenMonth(m); const back = T.unflattenMonth(f, m);
  assert(!("cath_off_days" in back), "旧形式は持ち込まない");
  for (const k of Object.keys(m)) if (!["cath_off_days", "doc_versions"].includes(k)) assert(k in back, "項目が残る: " + k);
  assert.deepStrictEqual(T.flattenMonth(back), T.flattenMonth(m), "往復で同じ形");
});
test("不可と避が同じ日にあるときは不可が勝つ（統合の正規化）", () => {
  const rules = clone(real.rules), m = T.normalizeMonth(clone(real.month), rules); m.avoid = [{ name: "Dr E", day: 8, part: "night" }]; m.unavailable_night["Dr E"] = [8]; m.unavailable_other = (m.unavailable_other || []).filter(u => !(u.name === "Dr E" && +u.day === 8));
  const f = T.flattenMonth(m); assert.strictEqual(JSON.parse(f["cal:Dr E:8"]), "night");
});
test("曜日パターン運用（duty_days なし）では避パターンが自動で展開される", () => {
  const rules = clone(real.rules), m = clone(real.month); m.duty_days = null; delete m.avoid; m.regular_duties["Dr L"] = [{ kind: "avoid_night", dow: "Mon", part: "full" }];
  const P = new T.Problem(rules, m); assert.strictEqual((P.avoid["Dr L"] || []).length, 4); // 11月の月曜は5回だが 11/23 は祝日（避パターンは平日だけ）
  const ex = T.expandAvoid(rules, real.month, ["Dr L"]); assert(Array.isArray(ex["Dr L"]));
});
test("翌月1日が土日の月: 月末の夜勤の翌日は休日として扱う（週休日・副担当の平日夜勤判定）", () => {
  const rules = clone(real.rules);
  const P = new T.Problem(rules, T.normalizeMonth({ year: 2026, month: 7, holidays: [], next_month_first_day_is_holiday: false }, rules)); // 2026/8/1 は土曜
  assert.strictEqual(P.nextIsHoliday(31), true); assert(!P.preWorkdayNights().includes(31), "7/31(金)夜勤は翌日が休日なので対象外");
  const P2 = new T.Problem(rules, T.normalizeMonth({ year: 2026, month: 11, holidays: [3, 23], next_month_first_day_is_holiday: false }, rules)); // 12/1 は火曜
  assert.strictEqual(P2.nextIsHoliday(30), false);
});
(async () => {
  if (!highsPath) { console.log(`${passed} tests passed${process.exitCode ? "（失敗あり）" : ""}（ソルバーのテストは highs のパス指定時のみ）`); return; }
  const highs = await require(highsPath)();
  const solveOK = (rules, month, label) => { const P = new T.Problem(rules, month); const r = T.solve(P, highs, { timeLimit: 60 }); assert(r.asg, label + ": 解あり（status " + r.status + "）"); const c = T.check(P, r.asg); return { P, r, c }; };
  test("OC構成の表（oncall_requirement）を変えるとソルバーも検算も同じ表で動く", () => {
    const rules = clone(real.rules); rules.oncall_requirement.A = { I: 0, Y: 1 }; const month = T.normalizeMonth(clone(real.month), rules);
    const { P, r, c } = solveOK(rules, month, "A勤務=若手OCのみ"); assert.strictEqual(c.V.length, 0, "違反: " + c.V.slice(0, 3).join(" / "));
    for (const [k, v] of Object.entries(r.asg)) if (P.team[v.work] === "A") assert(!v.oc.some(n => P.team[n] === "I"), k + " に主担当OCが付いていない");
  });
  test("固定指定で同日（日勤＋夜勤）と翌日夜勤が重なっても解なしにならず減点で通る", () => {
    const rules = clone(real.rules), month = T.normalizeMonth(clone(real.month), rules);
    month.fixed.day = { 3: "Dr N" }; month.fixed.night = { 3: "Dr N", 4: "Dr N" }; // 11/3 は祝日
    const { c } = solveOK(rules, month, "同日＋翌日の固定"); assert(c.W.length >= 2, "固定指定により許容した条件が出る: " + c.W.join(" / "));
  });
  test("前月末の接続が前月内で連日でも当月の計算は解なしにならない", () => {
    const rules = clone(real.rules), month = T.normalizeMonth(clone(real.month), rules);
    for (const n of ["Dr N", "Dr P", "Dr H", "Dr G"]) { month.unavailable_night[n] = (month.unavailable_night[n] || []).filter(d => d > 2); month.unavailable_other = month.unavailable_other.filter(u => !(u.name === n && u.day <= 2)); } // 接続する人は 1〜2 日に不可が無い形で試す
    month.prev_month.last_days = [{ date: 30, night: "Dr N", night_oc: ["Dr H"] }, { date: 31, day: "Dr N", day_oc: ["Dr G"], night: "Dr P", night_oc: ["Dr G"] }];
    month.prev_month.last_weekend_charge = "Dr G"; month.fixed.weekend_charge = { 1: "Dr G" };
    solveOK(rules, month, "前月内の連日");
  });
  test("長い連休: 12/31 と翌月1日の主担当担当を同じ医師に固定しても解なしにならず「固定指定により許容」に入る", () => {
    const rules = clone(real.rules);
    const month = T.normalizeMonth({ year: 2026, month: 12, holidays: [29, 30, 31], closure_days: [29, 30, 31], next_month_first_day_is_holiday: true, next_first_day_in_calendar: true, fixed: { weekend_charge: { 31: "Dr E", 32: "Dr E" } } }, rules);
    const { c } = solveOK(rules, month, "12/31+1/1 の主担当担当固定");
    assert.strictEqual(c.V.length, 0, "違反: " + c.V.join(" / ")); // OC を含む連続は 2026-09-17 から減点扱いなので W にも出ない
  });
  test("長い連休: 12/31 は日勤だけ固定し翌月1日を主担当担当に固定しても解なしにならない（日勤の固定で夜間の主担当担当が決まる）", () => {
    const rules = clone(real.rules);
    const month = T.normalizeMonth({ year: 2026, month: 12, holidays: [29, 30, 31], closure_days: [29, 30, 31], next_month_first_day_is_holiday: true, next_first_day_in_calendar: true, fixed: { day: { 31: "Dr E" }, weekend_charge: { 32: "Dr E" } } }, rules);
    const { c } = solveOK(rules, month, "12/31 日勤＋1/1 主担当担当の固定");
    assert.strictEqual(c.V.length, 0, "違反: " + c.V.join(" / "));
  });
  test("同梱の施設プロファイル「一般当直（最小構成）」: OC・カテ室・期間責任者なしで解けて違反0", () => {
    const rules = JSON.parse(fs.readFileSync(path.join(__dirname, "data/profiles/oncall-min.json"), "utf8"));
    T.fillDefaultRules(rules);
    assert.strictEqual(rules.profile.id, "oncall-min");
    const month = T.normalizeMonth({ year: 2026, month: 11, holidays: [3, 23], next_month_first_day_is_holiday: false }, rules);
    assert.strictEqual(month.profile_id, "oncall-min", "月データに施設が記録される");
    const P = new T.Problem(rules, month);
    assert.strictEqual(P.state("period_charge"), "off");
    assert.deepStrictEqual(T.lint(P).map(x => x.msg), [], "入力チェックの指摘なし");
    const { r, c } = solveOK(rules, month, "最小構成");
    assert.strictEqual(c.V.length, 0, "違反: " + c.V.slice(0, 3).join(" / "));
    for (const [k, v] of Object.entries(r.asg)) assert.strictEqual(v.oc.length, 0, k + " にOCが付いている");
    assert(T.buildReport(P, r.asg, {}).sections.length >= 8, "説明資料が作れる");
    assert(T.docxXml(P, r.asg, "確認版", { today: "2026-01-01T00:00:00Z" }).includes("<w:tbl>"), "docx が作れる");
  });
  test("相対の回数目安: 比重でその月の延べ人数を按分し、端数は累計の過不足が少ない人から", () => {
    const rules = JSON.parse(fs.readFileSync(path.join(__dirname, "data/profiles/two-shift.json"), "utf8"));
    rules.profile.quota_mode = "share"; T.fillDefaultRules(rules);
    const names = rules.doctors.map(d => d.name);
    rules.doctors[0].share = 0; rules.doctors[1].share = 0.5; // 0 は当番に入らない、0.5 は半分
    const mk = m => new T.Problem(rules, T.normalizeMonth(Object.assign({ year: 2026, month: 11, holidays: [3, 23], next_month_first_day_is_holiday: false }, m), rules));
    const P = mk({});
    const need = P.slots.reduce((a, s) => a + (P.countIdealOf(s) ?? P.countOf(s)), 0);
    assert.strictEqual(P.quotaMode, "share");
    assert.strictEqual(P.dutyNames.reduce((a, n) => a + P.quota(n), 0), need, "目安の合計は必要な延べ人数と一致");
    assert.strictEqual(P.quota(names[0]), 0, "比重 0 は 0 回");
    const full = P.dutyNames.filter(n => n !== names[0] && n !== names[1]).map(n => P.quota(n));
    assert(Math.max(...full) - Math.min(...full) <= 1, "比重 1 の人どうしは 1 回差以内: " + full.join(","));
    assert(P.quota(names[1]) <= Math.ceil(Math.min(...full) / 2) + 1 && P.quota(names[1]) >= Math.floor(Math.min(...full) / 2) - 1, "比重 0.5 はおよそ半分");
    assert.deepStrictEqual(P.targets[names[2]], P.quota(names[2]), "当月の目標の既定は目安");
    assert.strictEqual(mk({ targets: { [names[2]]: 99 } }).targets[names[2]], 99, "月の設定の targets で上書きできる");
    // 端数の割り当て: 累計で不足している人（work_balance が小さい人）が先に 1 回多くもらう
    const nA = names[2], nB = names[3];
    const Pa = mk({ history: { work_balance: { [nA]: -3, [nB]: 3 } } }), Pb = mk({ history: { work_balance: { [nA]: 3, [nB]: -3 } } });
    if (Pa.quota(nA) !== Pa.quota(nB)) { assert(Pa.quota(nA) > Pa.quota(nB), "不足している人が多くもらう"); assert(Pb.quota(nB) > Pb.quota(nA), "累計を入れ替えると逆になる"); }
    const at = T.autoTargets(rules, Object.assign({ year: 2026, month: 11, holidays: [3, 23] }, {}));
    assert.deepStrictEqual(at.targets, {}, "相対では按分ですでに枠数と合うので自動調整は何もしない");
    { const r0 = JSON.parse(fs.readFileSync(path.join(__dirname, "data/profiles/two-shift.json"), "utf8")); delete r0.profile.quota_mode; T.fillDefaultRules(r0);
      const P0 = new T.Problem(r0, T.normalizeMonth({ year: 2026, month: 11, holidays: [3, 23] }, r0));
      assert.strictEqual(P0.quotaMode, "absolute", "指定が無ければ絶対値"); assert.strictEqual(P0.quota(names[2]), +r0.doctors[2].quota, "絶対値では名簿の quota がそのまま目安"); }
  });
  test("構成の上限（師長は休日に入らない）は、固定した日だけは入れて「固定指定により許容」に分類される", () => {
    const rules = JSON.parse(fs.readFileSync(path.join(__dirname, "data/profiles/nurse-2shift.json"), "utf8")); T.fillDefaultRules(rules);
    const month = T.normalizeMonth({ year: 2026, month: 11, holidays: [3, 23], next_month_first_day_is_holiday: false, fixed: { day: { 1: "師長A" } } }, rules); // 11/1 は日曜
    const P = new T.Problem(rules, month);
    assert(P.isFixedWork([1, "day"], "師長A"));
    const r = T.solve(P, highs, { timeLimit: 60 }); assert(r.asg, "固定があっても解ける: " + r.status);
    const c = T.check(P, r.asg);
    assert.strictEqual(c.V.length, 0, "違反なし: " + c.V.slice(0, 3).join(" / "));
    assert(c.W.some(w => /COMPOSITION_OVER|師長/.test(w)), "固定指定により許容に入る: " + c.W.join(" / "));
    assert(c.A.worked("師長A", [1, "day"]), "固定どおり 11/1 の日勤に入る");
    for (let d = 2; d <= P.N; d++) if (P.isHoliday(d)) assert(!c.A.worked("師長A", [d, "day"]) && !c.A.worked("師長A", [d, "night"]), `固定していない休日 ${d} には入らない`);
  });
  test("連勤の下限が夜勤の数に対して長すぎるときは、避けられない短い連の本数を入力チェックが知らせる", () => {
    const rules = JSON.parse(fs.readFileSync(path.join(__dirname, "data/fixtures/ward-2shift.json"), "utf8"));
    const mk = r => { T.fillDefaultRules(r); return new T.Problem(r, T.normalizeMonth({ year: 2026, month: 11, holidays: [3, 23] }, r)); };
    const P2 = mk(clone(rules)); assert.strictEqual(P2.runMin, 2); assert(!T.lint(P2).some(x => x.code === "LINT_RUN_MIN_VS_NIGHTS"), "下限 2 日なら指摘なし");
    const r3 = clone(rules); r3.run_length.min = 3; const P3 = mk(r3); const it = T.lint(P3).find(x => x.code === "LINT_RUN_MIN_VS_NIGHTS");
    assert(it, "下限 3 日では指摘が出る"); assert.strictEqual(it.args.nights, 60, "夜勤 2 名 × 30 日"); assert(it.args.short >= 1 && it.args.runs < 60, JSON.stringify(it.args)); assert(it.hint.length > 0);
    const r4 = clone(r3); r4.rule_states.shift_sequence = "off"; assert(!T.lint(mk(r4)).some(x => x.code === "LINT_RUN_MIN_VS_NIGHTS"), "明け休みが無い施設では夜勤で連が終わらないので指摘しない");
  });
  test("名簿にない人の入力: 一覧に出て、入力チェックが知らせ、まとめて消せる", () => {
    const rules = clone(real.rules), month = T.normalizeMonth(clone(real.month), rules);
    month.fixed.night[6] = "Dr F"; month.unavailable_night["Dr F"] = [3]; month.unavailable_other.push({ name: "Dr F", day: 9, part: "pm" }); month.targets["Dr F"] = 2; month.wishes.weekend_dayshift.push("Dr F");
    rules.doctors = rules.doctors.filter(d => d.name !== "Dr F"); rules.name_order = (rules.name_order || []).filter(n => n !== "Dr F"); // 名簿から外した
    for (const k of ["friday_night_min"]) if (rules[k]) delete rules[k]["Dr F"]; rules.weekend_dayshift_wish = (rules.weekend_dayshift_wish || []).filter(n => n !== "Dr F");
    const refs = T.monthNameRefs(month); assert.deepStrictEqual(refs["Dr F"].slice().sort(), ["fixed", "targets", "unavailable", "wishes"].concat(refs["Dr F"].includes("duty_days") ? ["duty_days"] : []).concat(refs["Dr F"].includes("regular_duties") ? ["regular_duties"] : []).sort());
    T.fillDefaultRules(rules); const P = new T.Problem(rules, month); const it = T.lint(P).find(x => x.code === "LINT_MONTH_UNKNOWN_NAMES");
    assert(it && it.args.who === "Dr F" && it.hint.length > 0, "入力チェックが名簿にない人を知らせる: " + JSON.stringify(it && it.args));
    const c = T.purgeMonthNames(month, ["Dr F"]); assert(c >= 5, "消した件数: " + c);
    assert(!T.monthNameRefs(month)["Dr F"], "消えている"); assert.strictEqual(month.fixed.night[6], undefined); assert(!month.wishes.weekend_dayshift.includes("Dr F"));
    assert(!T.lint(new T.Problem(rules, month)).some(x => x.code === "LINT_MONTH_UNKNOWN_NAMES" || x.code === "LINT_FIXED_NOT_CANDIDATE"), "消した後は指摘なし");
  });
  test("明け休みは月をまたいでも効く: 前月最終日の夜勤 → 1 日、月末の夜勤 → 翌月 1 日の固定", () => {
    const rules = JSON.parse(fs.readFileSync(path.join(__dirname, "data/profiles/two-shift.json"), "utf8")); T.fillDefaultRules(rules);
    const names = rules.doctors.map(d => d.name), a = names[0], b = names[1];
    const mk = extra => T.normalizeMonth(Object.assign({ year: 2026, month: 11, holidays: [3, 23], next_month_first_day_is_holiday: false,
      prev_month: { last_days: [{ date: 31, night: a }], last_weekend_charge: null, prev_weekend_charge: null }, fixed: { day: { 31: b } } }, extra), rules);
    const month = mk({}); const P = new T.Problem(rules, month);
    assert(P.prevWorked([0, "night"], a), "前月最終日の夜勤が読めている"); assert.deepStrictEqual(P.nextFixed.day, [b], "翌月 1 日の日勤の固定（配列）");
    // 検算: 1 日に a を、月末の夜勤に b を入れた割当は違反
    const asg = {}; for (const s of P.slots) asg[`${s[0]}:${s[1]}`] = { work: null, oc: [] };
    asg["1:day"].work = a; asg["30:night"].work = b;
    const V = T.check(P, asg).V.filter(x => /明け|入れない/.test(x) || /SHIFT_SEQUENCE/.test(x));
    const codes = T.check(P, asg).VC ? T.check(P, asg).VC.map(x => x.code) : [];
    const vAll = T.check(P, asg); assert(vAll.V.some(x => x.includes(a) && /10\/31|前月/.test(x)) || codes.includes("SHIFT_SEQUENCE"), "前月末→1 日の違反が出る: " + vAll.V.slice(0, 4).join(" / "));
    assert(vAll.V.some(x => x.includes(b) && /12\/1|翌月/.test(x)), "月末→翌月 1 日の違反が出る: " + vAll.V.filter(x => x.includes(b)).join(" / "));
    // 減点にすると点が付く（解く側とも一致する）
    const soft = clone(rules); soft.rule_states.shift_sequence = "soft"; T.fillDefaultRules(soft); const Ps = new T.Problem(soft, mk({}));
    const pen = T.penalty(Ps, asg), pv = pen.items.shift_sequence, ptot = typeof pv === "object" ? pv.total : pv; assert(ptot >= 2 * soft.weights.shift_sequence, "月またぎ 2 組の減点: " + JSON.stringify(pv));
    const r = T.solve(P, highs, { timeLimit: 60 }); assert(r.asg, "解ける");
    const A = new T.Asg(P, r.asg); assert(!A.worked(a, [1, "day"]) && !A.worked(a, [1, "night"]), "前月末に夜勤した人は 1 日に入らない"); assert(!A.worked(b, [30, "night"]), "翌月 1 日に固定された人は月末の夜勤に入らない");
    const rs = T.solve(Ps, highs, { timeLimit: 60 }); assert(rs.asg, "減点版も解ける"); const pin = T.solve(Ps, highs, { timeLimit: 60, pin: rs.asg }); assert(Math.abs(pin.objective - T.penalty(Ps, rs.asg).total) < 1e-6, "全枠固定の点数と減点の一致（月またぎの式を含む）");
  });
  test("固定指定による許容は同じ枠だけ: 日勤を固定した人の同日の夜勤不可は、夜勤に入れば違反のまま", () => {
    const rules = clone(real.rules), month = T.normalizeMonth(clone(real.month), rules);
    const who = "Dr N"; month.fixed.day = { 8: who }; month.unavailable_night[who] = [8]; // 11/8(日): 日勤を固定、夜勤は不可
    const P = new T.Problem(rules, month), base = clone(real.result.asg);
    base["8:day"].work = who; base["8:night"].work = who; base["8:night"].oc = [];
    const c = T.check(P, base);
    assert(c.V.some(x => x.includes(who) && /不可/.test(x)), "夜勤不可の違反が V に残る: " + c.V.filter(x => x.includes(who)).join(" / "));
    assert(!c.W.some(x => x.includes(who) && /不可/.test(x) && /夜/.test(x)), "許容には入らない: " + c.W.filter(x => x.includes(who)).join(" / "));
    const pin = T.solve(P, highs, { timeLimit: 30, pin: base }); assert(!pin.asg, "解く側でも全枠固定で解なし（検算と同じ判断）: " + pin.status);
  });
  test("避けたい日: 日勤の枠がある日なら平日でも対象（2 交代）", () => {
    const rules = JSON.parse(fs.readFileSync(path.join(__dirname, "data/profiles/two-shift.json"), "utf8")); T.fillDefaultRules(rules);
    const n = rules.doctors[0].name; const P = new T.Problem(rules, T.normalizeMonth({ year: 2026, month: 11, holidays: [3, 23], avoid: [{ name: n, day: 4, part: "day" }, { name: n, day: 5, part: "night" }] }, rules)); // 11/4(水)・11/5(木)
    assert.deepStrictEqual(P.avoidSlots(n), [[4, "day"], [5, "night"]]);
  });
  test("1 枠に複数名: 既存案からの変更量と参照解の回数は、勤務者が配列でも同じ人を数える", () => {
    const rules = JSON.parse(fs.readFileSync(path.join(__dirname, "data/fixtures/ward-2shift.json"), "utf8")); rules.doctors = rules.doctors.slice(0, 7).map(d => Object.assign({}, d, { quota: 13 })); rules.name_order = rules.doctors.map(d => d.name);
    rules.profile = Object.assign({}, rules.profile, { positions: { work: { count: { day: 2, night: 1 } } } }); T.fillDefaultRules(rules);
    const P = new T.Problem(rules, T.normalizeMonth({ year: 2026, month: 11, holidays: [3, 23] }, rules)); const r = T.solve(P, highs, { timeLimit: 60 }); assert(r.asg);
    const same = T.penalty(P, r.asg, { base: r.asg }), changed = clone(r.asg); const s0 = P.slots.find(s => s[1] === "day"), k0 = `${s0[0]}:${s0[1]}`;
    const other = P.dutyNames.find(x => !changed[k0].work.includes(x)); changed[k0].work = [changed[k0].work[0], other];
    const one = T.penalty(P, changed, { base: r.asg });
    const num = v => typeof v === "object" ? v.total : v;
    assert(num(one.items.base_change) > num(same.items.base_change), `1 人変えると変更量が増える: 同じ ${num(same.items.base_change)} / 1 人変更 ${num(one.items.base_change)}`);
  });
  test("統合の往復: 有給の印（unavailable_other[].paid）が残る", () => {
    const rules = clone(real.rules), month = T.normalizeMonth(clone(real.month), rules);
    month.unavailable_other.push({ name: "Dr N", day: 12, part: "allday", paid: true }, { name: "Dr P", day: 13, part: "day" });
    const m2 = T.unflattenMonth(T.flattenMonth(month));
    assert.deepStrictEqual(m2.unavailable_other.find(u => u.name === "Dr N" && u.day === 12), { name: "Dr N", day: 12, part: "allday", paid: true });
    assert.strictEqual(m2.unavailable_other.find(u => u.name === "Dr P" && u.day === 13).paid, undefined);
    const r = T.mergeMonth(clone(month), clone(month), clone(month)); assert(r.merged.unavailable_other.some(u => u.name === "Dr N" && u.paid === true), "3 者が同じでも有給が消えない");
  });
  test("プラグインの登録の検査: 必須になれるのに check が無い・減点になれるのに penalty が無い・needs の循環は拒否", () => {
    assert.throws(() => T.rules.register({ id: "local.t.nocheck", api: 1, states: ["hard", "off"], solve() { }, penalty() { } }), /check/);
    assert.throws(() => T.rules.register({ id: "local.t.nopen", api: 1, states: ["soft", "off"], solve() { }, check() { } }), /penalty/);
    T.rules.register({ id: "local.t.a", api: 1, states: ["off"], solve() { }, check() { }, penalty() { }, needs: [] });
    T.rules.register({ id: "local.t.b", api: 1, states: ["off"], solve() { }, check() { }, penalty() { }, needs: ["local.t.a"] });
    assert.throws(() => T.rules.register({ id: "local.t.a", api: 1, states: ["off"], solve() { }, check() { }, penalty() { }, needs: ["local.t.b"] }), /循環/);
    for (const id of ["local.t.a", "local.t.b"]) { const i = T.rules.defs.findIndex(d => d.id === id); if (i >= 0) T.rules.defs.splice(i, 1); delete T.rules.byId[id]; } // 後片付け
  });
  test("プラグインの欠落: 設定で有効なのに登録の無い規則も入力チェックで止まる（新しい月でも）", () => {
    const rules = clone(real.rules); T.fillDefaultRules(rules); rules.rule_states["local.absent.rule"] = "hard";
    const P = new T.Problem(rules, T.normalizeMonth({ year: 2026, month: 11, holidays: [3, 23] }, rules));
    const it = T.lint(P).find(x => x.code === "LINT_PLUGIN_MISSING"); assert(it && /local\.absent\.rule/.test(it.args.who), "plugins_used が無くても設定から欠落を知らせる");
    rules.rule_states["local.absent.rule"] = "off"; assert(!T.lint(new T.Problem(rules, T.normalizeMonth({ year: 2026, month: 11, holidays: [3, 23] }, rules))).some(x => x.code === "LINT_PLUGIN_MISSING"), "「なし」なら止めない");
  });
  test("明け休みと連勤の上限は、月内でも固定した枠が絡めば減点付きで許し、検算の許容と全枠固定の可否が一致する", () => {
    const rules = JSON.parse(fs.readFileSync(path.join(__dirname, "data/profiles/two-shift.json"), "utf8")); rules.rule_states.run_length_min = "off"; T.fillDefaultRules(rules); // 連勤の下限は外す（枠を 1 つ渡した人が 1 日だけの勤務になる）
    const a = rules.doctors[0].name;
    const month = T.normalizeMonth({ year: 2026, month: 11, holidays: [3, 23], fixed: { day: { 6: a } }, unavailable_other: [{ name: a, day: 4, part: "allday" }, { name: a, day: 5, part: "day" }] }, rules); // 6 日の日勤を a で固定。4 日は不可、5 日の日勤帯は不可（夜勤は可）
    const worksOn = (asg, n, d) => ["day", "night"].some(k => asg[`${d}:${k}`] && asg[`${d}:${k}`].work === n);
    // 5 日夜勤も a に（6 日の日勤と組で明け休み・連勤を破る）。元の 5 日夜勤の人には、隣接しない a の枠を 1 つ渡して回数を保つ
    const breakIt = (P, r) => { const asg = clone(r.asg), w5 = asg["5:night"].work; assert(w5 !== a && !worksOn(asg, a, 5), "a は 5 日に入っていない"); asg["5:night"].work = a;
      if (w5 && w5 !== a) { const k = Object.keys(asg).find(k => { const d = +k.split(":")[0]; return k !== "5:night" && k !== "6:day" && asg[k].work === a && d !== 5 && d !== 6 && !worksOn(asg, w5, d - 1) && !worksOn(asg, w5, d) && !worksOn(asg, w5, d + 1); }); assert(k, "渡せる枠がある"); asg[k].work = w5; }
      return asg; };
    const verify = (P, asg, what) => {
      const c = T.check(P, asg); assert.deepStrictEqual(c.V.filter(x => x.includes(a)), [], what + ": a の違反は V に残らない");
      assert(c.W.some(x => x.includes(a)), what + ": 固定指定により許容に入る: " + c.W.join(" / "));
      const pin = T.solve(P, highs, { timeLimit: 60, pin: asg }); assert(pin.asg, what + ": 解く側でも全枠固定で解あり（減点付き）: " + pin.status + " / V: " + c.V.join(" / "));
      assert(Math.abs(pin.objective - T.penalty(P, asg).total) < 1e-6, what + ": fixed_conflict の点数も一致: " + pin.objective + " / " + T.penalty(P, asg).total); };
    const P = new T.Problem(rules, month); const r = T.solve(P, highs, { timeLimit: 60 }); assert(r.asg, "解ける: " + r.status);
    verify(P, breakIt(P, r), "明け休み");
    const r3 = clone(rules); r3.run_length = { max: 1 }; r3.rule_states.run_length_max = "hard"; T.fillDefaultRules(r3); const P3 = new T.Problem(r3, month); // 連勤上限 1 日（2 連勤を禁止）
    const s3 = T.solve(P3, highs, { timeLimit: 60 }); assert(s3.asg, "連勤上限 1 日でも解ける: " + s3.status);
    const asg3 = breakIt(P3, s3); assert(T.check(P3, asg3).W.some(x => /連勤|run/.test(x) && x.includes(a)), "連勤上限の違反が許容へ");
    verify(P3, asg3, "連勤上限");
  });
  test("長い連勤の許容は窓ごと: 固定の無い窓は違反に残り、全窓に固定が絡めば許容して全枠固定でも解ける", () => {
    const rules = JSON.parse(fs.readFileSync(path.join(__dirname, "data/profiles/two-shift.json"), "utf8")); rules.rule_states.run_length_min = "off"; rules.run_length = { max: 1 }; rules.rule_states.run_length_max = "hard"; T.fillDefaultRules(rules);
    const a = rules.doctors[0].name;
    const un = [{ name: a, day: 4, part: "allday" }, { name: a, day: 5, part: "day" }, { name: a, day: 7, part: "day" }, { name: a, day: 8, part: "allday" }]; // a は 5 日夜勤・6 日日勤・7 日夜勤の 3 連勤にする
    const worksOn = (asg, n, d) => ["day", "night"].some(k => asg[`${d}:${k}`] && asg[`${d}:${k}`].work === n);
    const month6 = T.normalizeMonth({ year: 2026, month: 11, holidays: [3, 23], fixed: { day: { 6: a } }, unavailable_other: un }, rules); // 6 日（真ん中）だけ固定
    const P6 = new T.Problem(rules, month6); const r = T.solve(P6, highs, { timeLimit: 60 }); assert(r.asg, "解ける: " + r.status);
    const asg = clone(r.asg); assert(!worksOn(asg, a, 5) && !worksOn(asg, a, 7));
    for (const s of ["5:night", "7:night"]) { const w = asg[s].work; asg[s].work = a; // 元の人には隣接しない a の枠を 1 つ渡して回数を保つ
      const k = Object.keys(asg).find(k => { const d = +k.split(":")[0]; return asg[k].work === a && d < 4 || asg[k].work === a && d > 8 ? !worksOn(asg, w, d - 1) && !worksOn(asg, w, d) && !worksOn(asg, w, d + 1) : false; }); assert(k, "渡せる枠がある"); asg[k].work = w; }
    const runs = c => c.VC.filter(x => x.code === "RUN_TOO_LONG"), runsW = c => c.WC.filter(x => x.code === "RUN_TOO_LONG");
    const c6 = T.check(P6, asg); assert.deepStrictEqual(runs(c6), [], "両方の窓に固定が絡むので V には残らない"); assert.strictEqual(runsW(c6).length, 1); assert.strictEqual(runsW(c6)[0].args.len, 3, "3 連勤として 1 件");
    const pin6 = T.solve(P6, highs, { timeLimit: 60, pin: asg }); assert(pin6.asg, "全枠固定で解あり: " + pin6.status);
    assert(Math.abs(pin6.objective - T.penalty(P6, asg).total) < 1e-6, "点数一致: " + pin6.objective + " / " + T.penalty(P6, asg).total);
    // 5 日（端）だけ固定: 5〜6 日の窓は許容、6〜7 日の窓は固定が無いので違反。解く側も全枠固定では解なし
    const month5 = T.normalizeMonth({ year: 2026, month: 11, holidays: [3, 23], fixed: { night: { 5: a } }, unavailable_other: un }, rules); const P5 = new T.Problem(rules, month5);
    const c5 = T.check(P5, asg); assert.strictEqual(runs(c5).length, 1, "固定の無い窓が V に残る: " + JSON.stringify(runs(c5))); assert.strictEqual(runs(c5)[0].args.len, 2); assert(/11\/6/.test(runs(c5)[0].args.from), "6 日から");
    assert.strictEqual(runsW(c5).length, 1, "固定の絡む窓は許容"); assert.strictEqual(runsW(c5)[0].args.len, 2);
    const pin5 = T.solve(P5, highs, { timeLimit: 60, pin: asg }); assert(!pin5.asg, "解く側も解なし: " + pin5.status);
    // 勤務の固定なし・OC だけ固定・勤務を固定 の 3 通りを同じ割当で比べる（2 連勤 5〜6 日、6 日夜勤の OC だけを a に固定しても許容しない）
    const asg2 = clone(asg); { const w7 = r.asg["7:night"].work; asg2["7:night"].work = w7; // 7 日夜勤を元の人に戻し、渡していた枠も a に戻す（a は 5〜6 日の 2 連勤だけ）
      const gave = Object.keys(asg2).find(k => asg2[k].work === w7 && r.asg[k].work === a); if (gave) asg2[gave].work = a; }
    const un2 = un.filter(u => u.day !== 7 && u.day !== 8);
    const mk = fixed => { const m = T.normalizeMonth({ year: 2026, month: 11, holidays: [3, 23], fixed, unavailable_other: un2 }, rules); return new T.Problem(rules, m); };
    const P0 = mk({}), Poc = mk({ night_oc: { 6: [a] } }), Pw = mk({ day: { 6: a } });
    assert.strictEqual(runs(T.check(P0, asg2)).length, 1, "固定なし: 違反"); assert.strictEqual(runs(T.check(Poc, asg2)).length, 1, "OC だけ固定: 違反のまま（許容しない）"); assert.strictEqual(runsW(T.check(Poc, asg2)).length, 0);
    assert.strictEqual(runs(T.check(Pw, asg2)).length, 0, "勤務を固定: 許容"); assert.strictEqual(runsW(T.check(Pw, asg2)).length, 1);
    assert(!T.solve(Poc, highs, { timeLimit: 60, pin: asg2 }).asg, "OC だけ固定: 解く側も解なし");
    const pw = T.solve(Pw, highs, { timeLimit: 60, pin: asg2 }); assert(pw.asg && Math.abs(pw.objective - T.penalty(Pw, asg2).total) < 1e-6, "勤務を固定: 解あり・点数一致");
  });
  test("連日の実勤務の許容も解く側と同じ判定: OC だけの固定では許容せず、勤務を固定すれば許容して全枠固定でも解ける", () => {
    const rules = clone(real.rules); T.fillDefaultRules(rules);
    for (const k of Object.keys(rules.rule_states)) if ((((T.RULE_BY_ID[k] || {}).states) || []).includes("off")) rules.rule_states[k] = "off"; rules.rule_states.consecutive_days = "hard"; rules.rule_states.oncall = "hard"; // 切り分けのため他の規則は「なし」（OC の枠は要るので待機は残す）
    const a = rules.doctors.find(d => d.team === "I").name; // 2026/11/7（土）・8（日）の日勤に入り、8 日夜勤の OC にもなる
    const un = [{ name: a, day: 6, part: "allday" }, { name: a, day: 9, part: "allday" }];
    const mk = fixed => new T.Problem(rules, T.normalizeMonth({ year: 2026, month: 11, holidays: [3, 23], fixed, unavailable_other: un }, rules));
    const Pw = mk({ day: { 7: a, 8: a }, night_oc: { 8: [a] } }), Poc = mk({ night_oc: { 8: [a] } }), P0 = mk({});
    const r = T.solve(Pw, highs, { timeLimit: 60 }); assert(r.asg, "勤務を固定: 解ける（連日は固定なので減点付き）: " + r.status);
    const asg = clone(r.asg); assert(asg["7:day"].work === a && asg["8:day"].work === a && asg["8:night"].oc.includes(a));
    const cons = c => c.VC.filter(x => x.code === "CONSECUTIVE_DAYS"), consW = c => c.WC.filter(x => x.code === "CONSECUTIVE_DAYS");
    assert.strictEqual(cons(T.check(Pw, asg)).length, 0); assert.strictEqual(consW(T.check(Pw, asg)).length, 1, "勤務を固定: 許容");
    assert(Math.abs(r.objective - T.penalty(Pw, asg).total) < 1e-6, "点数一致: " + r.objective + " / " + T.penalty(Pw, asg).total);
    for (const [P, what] of [[Poc, "OC だけ固定"], [P0, "固定なし"]]) { const c = T.check(P, asg);
      assert.strictEqual(cons(c).length, 1, what + ": 違反のまま"); assert.strictEqual(consW(c).length, 0, what + ": 許容しない");
      assert(!T.solve(P, highs, { timeLimit: 60, pin: asg }).asg, what + ": 解く側も全枠固定で解なし"); }
  });
  test("1 枠に複数名の固定: 配列で複数名を固定でき、1 名は文字列のまま。人数を超える固定は入力チェックで止まる", () => {
    const rules = JSON.parse(fs.readFileSync(path.join(__dirname, "data/fixtures/ward-2shift.json"), "utf8")); T.fillDefaultRules(rules);
    const [a, b, c, d4] = rules.doctors.map(x => x.name);
    const month = T.normalizeMonth({ year: 2026, month: 11, holidays: [3, 23], fixed: { day: { 6: [a, b], 7: c }, night: { 6: [d4] } } }, rules); // 日勤 3 名の枠に 2 名、別の日は 1 名（文字列）
    const P = new T.Problem(rules, month);
    assert.deepStrictEqual(P.fixedWorkersOf([6, "day"]), [a, b]); assert.deepStrictEqual(P.fixedWorkersOf([7, "day"]), [c]); assert.deepStrictEqual(P.fixedWorkersOf([6, "night"]), [d4]);
    assert(P.isFixedWork([6, "day"], a) && P.isFixedWork([6, "day"], b) && !P.isFixedWork([6, "day"], c));
    assert(!T.lint(P).some(x => /^LINT_FIXED/.test(x.code)), "固定の入力チェックは通る: " + T.lint(P).filter(x => /^LINT_FIXED/.test(x.code)).map(x => x.code).join(","));
    const r = T.solve(P, highs, { timeLimit: 60 }); assert(r.asg, "解ける: " + r.status);
    assert(r.asg["6:day"].work.includes(a) && r.asg["6:day"].work.includes(b) && r.asg["7:day"].work.includes(c) && r.asg["6:night"].work.includes(d4), "固定した全員がその枠に入る");
    assert(!T.check(P, r.asg).V.some(v => /固定/.test(v)), "固定との不一致なし");
    const over = T.normalizeMonth({ year: 2026, month: 11, holidays: [3, 23], fixed: { day: { 6: [a, b, c, d4] } } }, rules); // 3 名の枠に 4 名
    const lo = T.lint(new T.Problem(rules, over)).find(x => x.code === "LINT_FIXED_OVER_COUNT"); assert(lo && lo.args.n === 4 && lo.args.count === 3, "枠の人数を超える固定を知らせる");
    const dup = T.normalizeMonth({ year: 2026, month: 11, holidays: [3, 23], fixed: { day: { 6: [a, a] } } }, rules);
    assert(T.lint(new T.Problem(rules, dup)).some(x => x.code === "LINT_FIXED_DUP"), "同じ人を 2 回は知らせる");
    // 統合: 固定の勤務者は人ごとの項目。自分が a を足し、相手が b を足しても衝突にならず両方残る
    const base = T.normalizeMonth({ year: 2026, month: 11, holidays: [3, 23], fixed: { day: { 10: c } } }, rules);
    const mine = clone(base); mine.fixed.day[10] = [c, a]; const theirs = clone(base); theirs.fixed.day[10] = [c, b];
    const mg = T.mergeMonth(base, mine, theirs); assert.strictEqual(mg.conflicts.length, 0, "衝突なし: " + JSON.stringify(mg.conflicts));
    assert.deepStrictEqual([].concat(mg.merged.fixed.day[10]).sort(), [a, b, c].sort(), "3 名とも残る");
    const rt = T.unflattenMonth(T.flattenMonth(month)); assert.deepStrictEqual([].concat(rt.fixed.day[6]).sort(), [a, b].sort()); assert.strictEqual(rt.fixed.day[7], c, "1 名は文字列のまま");
  });
  test("固定の印: 名前(印) が勤務表の表と docx の月の表に出て、統合の往復でも残る", () => {
    const rules = JSON.parse(fs.readFileSync(path.join(__dirname, "data/fixtures/ward-2shift.json"), "utf8")); T.fillDefaultRules(rules);
    const [a, b] = rules.doctors.map(x => x.name);
    const month = T.normalizeMonth({ year: 2026, month: 11, holidays: [3, 23], fixed: { day: { 6: [a, b] } }, fixed_tags: { [`6:day|${a}`]: "研修", [`6:day|Ns Zzz`]: "無関係" } }, rules);
    const P = new T.Problem(rules, month); assert.strictEqual(P.fixedTag([6, "day"], a), "研修"); assert.strictEqual(P.fixedTag([6, "day"], b), ""); assert.strictEqual(P.nameWithTag([6, "day"], a), a + "(研修)");
    const r = T.solve(P, highs, { timeLimit: 60 }); assert(r.asg, "解ける");
    const s2 = T.buildReport(P, r.asg, {}).sections.find(x => x.id === "s2").html; assert(s2.includes(a + "(研修)"), "説明資料の勤務表に印が出る"); assert(!s2.includes(b + "("), "印の無い人には付かない");
  });
  test("固定の印: docx の月の表にも名前(印)が出る", () => {
    const rules = JSON.parse(fs.readFileSync(path.join(__dirname, "data/fixtures/ward-2shift.json"), "utf8")); T.fillDefaultRules(rules); const a = rules.doctors[0].name;
    const month = T.normalizeMonth({ year: 2026, month: 11, holidays: [3, 23], fixed: { day: { 6: a } }, fixed_tags: { [`6:day|${a}`]: "研修" } }, rules); const P = new T.Problem(rules, month); const r = T.solve(P, highs, { timeLimit: 60 }); assert(r.asg);
    const xml = T.docxXml(P, r.asg, "test", { template: "month_table" }); assert(String(xml).includes(a + "(研修)"), "docx の月の表にも印");
  });
  test("固定の印は統合の項目になり、名簿から外した人の印は消える", () => {
    const rules = JSON.parse(fs.readFileSync(path.join(__dirname, "data/fixtures/ward-2shift.json"), "utf8")); T.fillDefaultRules(rules);
    const [a, b] = rules.doctors.map(x => x.name);
    const base = T.normalizeMonth({ year: 2026, month: 11, holidays: [3, 23], fixed: { day: { 6: [a, b] } }, fixed_tags: { [`6:day|${a}`]: "研修" } }, rules);
    const rt = T.unflattenMonth(T.flattenMonth(base)); assert.deepStrictEqual(rt.fixed_tags, { [`6:day|${a}`]: "研修" }, "往復で残る");
    const mine = clone(base); mine.fixed_tags[`6:day|${b}`] = "会議"; const theirs = clone(base); theirs.fixed_tags[`6:day|${a}`] = "研修A";
    const mg = T.mergeMonth(base, mine, theirs); assert.strictEqual(mg.conflicts.length, 0); assert.deepStrictEqual(mg.merged.fixed_tags, { [`6:day|${a}`]: "研修A", [`6:day|${b}`]: "会議" }, "別々の変更は両方残る");
    const m2 = clone(base); assert(T.purgeMonthNames(m2, [a]) >= 2, "固定と印が消える（正規化で作られた空の入れ物も数える）"); assert.deepStrictEqual(m2.fixed_tags, {}); assert(![].concat(m2.fixed.day[6] || []).includes(a));
    assert(Object.keys(T.monthNameRefs(base)).includes(a));
  });
  test("日勤の希望（wish_day）: 叶わなかった希望が減点になり、解く側と数え直しが一致し、統合の往復で残る", () => {
    const rules = JSON.parse(fs.readFileSync(path.join(__dirname, "data/fixtures/ward-2shift.json"), "utf8")); rules.rule_states.wish_day = "soft"; T.fillDefaultRules(rules);
    const [a, b] = rules.doctors.map(x => x.name);
    const month = T.normalizeMonth({ year: 2026, month: 11, holidays: [3, 23], wishes: { day_on: { [a]: [4, 5], [b]: [4] } } }, rules);
    const P = new T.Problem(rules, month); assert.deepStrictEqual(P.wishDay[a], [4, 5]);
    const r = T.solve(P, highs, { timeLimit: 60 }); assert(r.asg, "解ける");
    const pen = T.penalty(P, r.asg); assert(Math.abs(pen.total - r.objective) < 1e-6, "点数一致: " + pen.total + " / " + r.objective);
    const asg = clone(r.asg); for (const k of ["4:day", "5:day"]) asg[k].work = [].concat(asg[k].work).filter(n => n !== a); // a の希望を外す
    const miss = T.penalty(P, asg).items.wish_day || 0; assert(miss >= 2 * P.weights.wish_day - 1e-9, "外した希望の分が減点: " + miss);
    const rt = T.unflattenMonth(T.flattenMonth(month)); assert.deepStrictEqual(rt.wishes.day_on, { [a]: [4, 5], [b]: [4] });
    assert(Object.keys(T.monthNameRefs(month)).includes(a)); const m2 = clone(month); T.purgeMonthNames(m2, [a]); assert(!m2.wishes.day_on[a]);
  });
  test("日ごとの区分と予定: プラグインが区分を登録し、月に日ごとの印と予定の文を持て、統合の往復で残る", () => {
    T.dayFlags.register({ id: "test.student", label: { ja: "行事", en: "Event" } }); assert(T.dayFlags.byId["test.student"]);
    const rules = clone(real.rules); T.fillDefaultRules(rules);
    const month = T.normalizeMonth({ year: 2026, month: 11, holidays: [3, 23], day_flags: { 9: ["test.student"], 10: ["test.student", "other"], 40: ["x"] }, day_notes: { 5: "1年目研修", 40: "外" } }, rules);
    const P = new T.Problem(rules, month); assert(P.dayHas(9, "test.student") && P.dayHas(10, "other") && !P.dayHas(11, "test.student")); assert.deepStrictEqual(P.daysWith("test.student"), [9, 10]);
    assert.strictEqual(P.dayNote(5), "1年目研修"); assert.strictEqual(P.dayNote(40), ""); assert(!P.dayFlags[40], "月の外は落とす");
    const rt = T.unflattenMonth(T.flattenMonth(month)); assert.deepStrictEqual(rt.day_flags[10].sort(), ["other", "test.student"]); assert.strictEqual(rt.day_notes[5], "1年目研修");
    const mine = clone(month); mine.day_flags[11] = ["test.student"]; const theirs = clone(month); theirs.day_notes[6] = "会議";
    const mg = T.mergeMonth(month, mine, theirs); assert.strictEqual(mg.conflicts.length, 0); assert.deepStrictEqual(mg.merged.day_flags[11], ["test.student"]); assert.strictEqual(mg.merged.day_notes[6], "会議");
    T.dayFlags.unregister("test.student"); assert(!T.dayFlags.byId["test.student"]);
  });
  test("職員別カレンダーの拡張: 登録をまとめ、人・日ごとの値を月に持て、統合の往復と名簿外の掃除が効く", () => {
    T.calendarExt.register({ id: "test.a", fixedTags: [{ label: "研修", shifts: ["day"] }, { label: "当直", shifts: ["night"] }], hideDuties: true });
    T.calendarExt.register({ id: "test.b", fixedTags: [{ label: "研修", shifts: ["night"] }], fields: [{ id: "test.pref", label: "希望の種類", options: [["a", "A"], ["b", "B"]] }], paidLeave: true });
    const mg0 = T.calendarExt.merged(); assert.deepStrictEqual(mg0.fixedTags.map(t => t.label), ["研修", "当直"], "同じ印は最初の登録"); assert(mg0.hideDuties && mg0.paidLeave); assert.strictEqual(mg0.fields[0].id, "test.pref");
    const rules = clone(real.rules); T.fillDefaultRules(rules); const a = rules.doctors[0].name;
    const month = T.normalizeMonth({ year: 2026, month: 11, holidays: [3, 23], person_days: { "test.pref": { [a]: { 4: "a", 5: "b" } } } }, rules);
    const P = new T.Problem(rules, month); assert.strictEqual(P.personDay("test.pref", a, 4), "a"); assert.strictEqual(P.personDay("test.pref", a, 6), "");
    const rt = T.unflattenMonth(T.flattenMonth(month)); assert.deepStrictEqual(rt.person_days["test.pref"][a], { 4: "a", 5: "b" });
    assert(T.monthNameRefs(month)[a].includes("person_days")); const m2 = clone(month); T.purgeMonthNames(m2, [a]); assert(!m2.person_days["test.pref"][a]);
    // 施設の設定で付け外し（when）、記号の HTML
    T.calendarExt.register({ id: "test.c", when: R => R.test_on === true, hideDuties: true, dayHead: true, symbol: () => ({ t: "L", u: "double", sub: "H", pre: "会" }) });
    T.calendarExt.unregister("test.a"); T.calendarExt.unregister("test.b");
    assert(!T.calendarExt.merged({ test_on: false }).hideDuties && !T.calendarExt.merged({ test_on: false }).symbol, "when が偽なら無いものとして扱う");
    const on = T.calendarExt.merged({ test_on: true }); assert(on.hideDuties && on.dayHead && on.symbol);
    const h = T.calendarExt.symbolHtml(on.symbol()); assert(/<sup>会<\/sup>/.test(h) && /underline double/.test(h) && /<sub>H<\/sub>/.test(h), h);
    assert.strictEqual(T.calendarExt.symbolHtml({ t: "<b>" }).includes("&lt;b&gt;"), true, "記号はエスケープする");
    T.dayFlags.register({ id: "test.f", label: "x", when: R => R.test_on === true }); assert(!T.dayFlags.activeFor({ test_on: false }).some(f => f.id === "test.f")); assert(T.dayFlags.activeFor({ test_on: true }).some(f => f.id === "test.f"));
    T.dayFlags.unregister("test.f"); T.calendarExt.unregister("test.c"); assert.strictEqual(T.calendarExt.merged().fixedTags.length, 0);
  });
  test("統合: 有給への変更と不可日の削除は衝突として見え、選んだ側が残る", () => {
    const rules = clone(real.rules), base = T.normalizeMonth(clone(real.month), rules);
    base.unavailable_other = base.unavailable_other.filter(u => !(u.name === "Dr N" && u.day === 5)).concat([{ name: "Dr N", day: 5, part: "allday" }]);
    const mine = clone(base); mine.unavailable_other.find(u => u.name === "Dr N" && u.day === 5).paid = true;
    const theirs = clone(base); theirs.unavailable_other = theirs.unavailable_other.filter(u => !(u.name === "Dr N" && u.day === 5));
    const r = T.mergeMonth(base, mine, theirs); assert.strictEqual(r.conflicts.length, 1, "衝突 1 件: " + JSON.stringify(r.conflicts));
    const rm = T.mergeMonth(base, mine, theirs, "mine"); assert.deepStrictEqual(rm.merged.unavailable_other.find(u => u.name === "Dr N" && u.day === 5), { name: "Dr N", day: 5, part: "allday", paid: true });
    const rt = T.mergeMonth(base, mine, theirs, "theirs"); assert(!rt.merged.unavailable_other.some(u => u.name === "Dr N" && u.day === 5));
  });
  test("暦のプラグイン: 祝日の出どころと施設の休日はプロファイルで決まる", () => {
    const jp = { profile: { calendar: { holidays: "jp", closure: [{ month: 12, days: [29, 30, 31] }, { month: 1, days: [2, 3] }] } } };
    assert.deepStrictEqual(T.holidaysOf(jp, 2026, 11).holidays, [3, 23], "文化の日・勤労感謝の日");
    assert.deepStrictEqual(T.holidaysOf(jp, 2026, 12), { holidays: [29, 30, 31], closure: [29, 30, 31] });
    assert.deepStrictEqual(T.holidaysOf(jp, 2027, 1).holidays, [1, 2, 3, 11], "元日・施設の休日・成人の日");
    assert.deepStrictEqual(T.holidaysOf({ profile: { calendar: { holidays: "none", closure: [] } } }, 2026, 11).holidays, [], "祝日なし");
    assert.deepStrictEqual(T.holidaysOf({}, 2026, 12).holidays, [29, 30, 31], "暦の指定が無い保存データは日本の祝日＋年末年始（移す前と同じ）");
    assert.deepStrictEqual(T.holidaysOf({ profile: { calendar: { holidays: "xx", closure: [{ month: 2, days: [30, 31] }] } } }, 2026, 2), { holidays: [11, 23], closure: [] }, "知らない出どころは既定、月に無い日は落ちる");
    assert.strictEqual(T.isOffDay(jp, 2026, 12, 29), true); assert.strictEqual(T.isOffDay(jp, 2026, 12, 28), false);
    for (const f of fs.readdirSync(path.join(__dirname, "data/profiles"))) { const p = JSON.parse(fs.readFileSync(path.join(__dirname, "data/profiles", f), "utf8")); assert(p.profile.calendar && p.profile.calendar.holidays, f + ": 同梱のプロファイルは暦を明示する"); }
  });
  test("同梱の施設プロファイル「2交代」: 日勤と夜勤が毎日あり、連日は許し同日2枠は禁止", () => {
    const rules = JSON.parse(fs.readFileSync(path.join(__dirname, "data/profiles/two-shift.json"), "utf8"));
    T.fillDefaultRules(rules);
    const month = T.normalizeMonth({ year: 2026, month: 11, holidays: [3, 23], next_month_first_day_is_holiday: false }, rules);
    const P = new T.Problem(rules, month);
    assert.strictEqual(P.slots.length, 60, "30日 × 2帯");
    assert.strictEqual(P.quotaMode, "share"); assert.strictEqual(P.dutyNames.reduce((a, n) => a + P.targets[n], 0), 60, "相対の目安: 8 人で 60 枠を按分（7〜8 回）");
    assert.strictEqual(P.slotExists(2, "day"), true, "平日にも日勤枠がある");
    assert.strictEqual(P.state("consecutive_days"), "off"); assert.strictEqual(P.state("same_day_double"), "hard");
    assert.deepStrictEqual(T.lint(P).map(x => x.msg), []);
    const { r, c } = solveOK(rules, month, "2交代");
    assert.strictEqual(c.V.length, 0, "違反: " + c.V.slice(0, 3).join(" / "));
    const A = new T.Asg(P, r.asg);
    for (const n of P.dutyNames) for (let d = 1; d <= P.N; d++) assert(!(A.worked(n, [d, "day"]) && A.worked(n, [d, "night"])), `${n} が ${d}日 に2枠`);
    // 連日が許されていることは、2 連休の目標（days_off_pair）を入れたままで見る。
    // 2026-09-21 までは 2 連休の式が連日の勤務そのものを禁止していた（pr + y(d) + y(d+1) ≤ 1）。その再発を捕まえる
    assert.strictEqual(P.state("days_off_pair"), "soft");
    // 同じ人を 5 日・6 日の日勤に固定しても解ける（明け休みは夜勤の翌日だけなので、日勤どうしの連日は許される）
    const m2 = clone(month), n0 = P.dutyNames[0]; m2.fixed = Object.assign({}, m2.fixed, { day: { 5: n0, 6: n0 } });
    const s2 = solveOK(rules, m2, "2交代（日勤の連日を固定）"), A2 = new T.Asg(s2.P, s2.r.asg);
    assert(A2.worked(n0, [5, "day"]) && A2.worked(n0, [6, "day"]), "連日の勤務が許されている");
    assert.strictEqual(T.check(s2.P, s2.r.asg).W.length, 0, "固定指定による許容ではなく、そもそも規則に反しない");
    assert(T.docxXml(P, r.asg, "確認版", { today: "2026-01-01T00:00:00Z" }).includes("<w:tbl>"), "docx が作れる");
  });
  test("1枠に複数名: 人数どおりに入り、割当は配列になり、検算も通る", () => {
    const rules = JSON.parse(fs.readFileSync(path.join(__dirname, "data/fixtures/ward-2shift.json"), "utf8"));
    rules.doctors = rules.doctors.slice(0, 7).map(d => Object.assign({}, d, { quota: 13 })); // テストは小さめに（7名・日勤2名）
    rules.name_order = rules.doctors.map(d => d.name);
    rules.profile = Object.assign({}, rules.profile, { positions: { work: { count: { day: 2, night: 1 } } } });
    T.fillDefaultRules(rules);
    const month = T.normalizeMonth({ year: 2026, month: 11, holidays: [3, 23], next_month_first_day_is_holiday: false }, rules);
    const P = new T.Problem(rules, month);
    assert.strictEqual(P.countOf([1, "day"]), 2); assert.strictEqual(P.countOf([1, "night"]), 1);
    assert.deepStrictEqual(T.lint(P).map(x => x.msg), []);
    const r = T.solve(P, highs, { timeLimit: 60, mipGap: 0.05 });
    assert(r.asg, "解あり（status " + r.status + "）");
    assert(Array.isArray(r.asg["1:day"].work), "複数名の枠は配列: " + JSON.stringify(r.asg["1:day"]));
    assert.strictEqual(typeof r.asg["1:night"].work, "string", "1名の枠は文字列のまま");
    const A = new T.Asg(P, r.asg);
    for (const s of P.slots) assert.strictEqual(A.workers(s).length, P.countOf(s), `${s[0]}:${s[1]} の人数`);
    const c = T.check(P, r.asg); assert.strictEqual(c.V.length, 0, "違反: " + c.V.slice(0, 3).join(" / "));
    assert(T.docxXml(P, r.asg, "確認版", { today: "2026-01-01T00:00:00Z" }).includes("<w:tbl>"), "docx が作れる");
    assert(T.buildReport(P, r.asg, {}).sections.length >= 8, "説明資料が作れる");
  });
  test("回数の上限を固定だけで超えたとき: 検算は W、解く側も解あり（fixed_conflict の減点）、減点の数え直しも一致", () => {
    const rules = JSON.parse(fs.readFileSync(path.join(__dirname, "data/fixtures/ward-2shift.json"), "utf8"));
    rules.doctors = rules.doctors.slice(0, 7).map(d => Object.assign({}, d, { quota: 13 })); rules.name_order = rules.doctors.map(d => d.name);
    rules.profile = Object.assign({}, rules.profile, { positions: { work: { count: { day: 2, night: 1 } } } });
    rules.rule_states = Object.assign({}, rules.rule_states, { shift_count_range: "hard", days_off_min: "off", days_off_pair: "off", wish_off_cap: "off", quota_target: "off", run_length_min: "off" }); rules.shift_counts = { night: {} }; rules.doctors[0].shift_max_night = 1; T.fillDefaultRules(rules); // その人だけ夜勤は月 1 回まで
    const a = rules.doctors[0].name, month = T.normalizeMonth({ year: 2026, month: 11, holidays: [3, 23], next_month_first_day_is_holiday: false, fixed: { night: { 5: a, 12: a } } }, rules);
    const { P, r, c } = solveOK(rules, month, "固定だけで上限超過"); assert.strictEqual(c.V.length, 0, "違反なし: " + c.V.join(" / ")); assert(c.W.some(w => w.includes(a)), "固定指定により許容: " + c.W.join(" / "));
    const pen = T.penalty(P, r.asg); assert(Math.abs(pen.total - r.objective) < 1e-6, `減点 ${pen.total} = 目的関数 ${r.objective}`); assert((pen.items.fixed_conflict || 0) > 0, "固定衝突の減点が付く: " + JSON.stringify(pen.items));
  });
  test("明けの翌日も休み: 月末の夜勤と翌月 1 日の固定をつなぐ。同じ日の日勤＋夜勤は 2 と数えない", () => {
    const rules = JSON.parse(fs.readFileSync(path.join(__dirname, "data/fixtures/ward-2shift.json"), "utf8"));
    rules.doctors = rules.doctors.slice(0, 7).map(d => Object.assign({}, d, { quota: 13 })); rules.name_order = rules.doctors.map(d => d.name);
    rules.profile = Object.assign({}, rules.profile, { positions: { work: { count: { day: 2, night: 1 } } } });
    rules.rule_states = Object.assign({}, rules.rule_states, { rest_after_ake: "hard", same_day_double: "off", shift_sequence: "off", run_length_max: "off", run_length_min: "off", days_off_min: "off", days_off_pair: "off", wish_off_cap: "off", quota_target: "off", quota_range: "off" }); T.fillDefaultRules(rules);
    const a = rules.doctors[0].name, rak = v => /明けの翌日/.test(v) && v.includes(a);
    // 29 日夜勤 → 30 日明け → 12/1 は休みのはず。翌月 1 日の固定は month.fixed.day[N+1]
    const month = T.normalizeMonth({ year: 2026, month: 11, holidays: [3, 23], next_month_first_day_is_holiday: false, fixed: { day: { 31: a } } }, rules);
    const P2 = new T.Problem(rules, month); assert(P2.nextFixedWorks(a), "翌月 1 日の固定を読んでいる");
    { const A = {}; for (const s of P2.slots) A[`${s[0]}:${s[1]}`] = { work: s[1] === "day" ? [rules.doctors[1].name, rules.doctors[2].name] : (s[0] === 29 ? a : rules.doctors[3 + (s[0] % 4)].name), oc: [] };
      const c2 = T.check(P2, A); assert(c2.V.some(rak), "29 日夜勤 + 翌月 1 日の勤務が違反に出る: " + c2.V.join(" / ")); }
    { const { r, c } = solveOK(rules, month, "翌月 1 日の固定"); assert.strictEqual(c.V.length, 0, "違反なし: " + c.V.join(" / ")); const A2 = new T.Asg(P2, r.asg); assert(!A2.workers([29, "night"]).includes(a), "解く側も 29 日の夜勤を避ける"); }
    // 29 日の日勤だけを固定しても許容にはならない（許容は 29 日の夜勤の枠の固定だけ。shift_sequence と同じ範囲）
    { const m3 = clone(month); m3.fixed = { day: { 29: [a, rules.doctors[1].name], 31: a } }; const P3 = new T.Problem(rules, T.normalizeMonth(m3, rules));
      const A = {}; for (const s of P3.slots) A[`${s[0]}:${s[1]}`] = { work: s[1] === "day" ? (s[0] === 29 ? [a, rules.doctors[1].name] : [rules.doctors[1].name, rules.doctors[2].name]) : (s[0] === 29 ? a : rules.doctors[3 + (s[0] % 4)].name), oc: [] };
      const c3 = T.check(P3, A); assert(c3.V.some(rak) && !c3.W.some(rak), "日勤だけの固定では V のまま: V=" + c3.V.join(" / ") + " W=" + c3.W.join(" / "));
      const m4 = clone(month); m4.fixed = { night: { 29: a }, day: { 31: a } }; const P4 = new T.Problem(rules, T.normalizeMonth(m4, rules)); const c4 = T.check(P4, A); assert(!c4.V.some(rak) && c4.W.some(rak), "夜勤の枠を固定すれば W: V=" + c4.V.join(" / ")); }
    // 同じ日の日勤＋夜勤は 2 と数えない: a は毎日日勤、5 日だけ夜勤も → この規則の減点は「5 日夜勤 → 7 日日勤」の 1 件だけ（3 日の夜勤は無いので 5 日の 2 勤務は減点にならない）
    { const rules3 = clone(rules); rules3.rule_states.rest_after_ake = "soft"; T.fillDefaultRules(rules3); const P3 = new T.Problem(rules3, T.normalizeMonth({ year: 2026, month: 11, holidays: [3, 23], next_month_first_day_is_holiday: false }, rules3));
      const A = {}; for (const s of P3.slots) A[`${s[0]}:${s[1]}`] = { work: s[1] === "day" ? [a, rules.doctors[1].name] : (s[0] === 5 ? a : rules.doctors[3 + (s[0] % 4)].name), oc: [] }; // 夜勤は 4 人で回す（同じ人が 2 日おきに夜勤しない）
      const pen = T.penalty(P3, A); assert.strictEqual(pen.items.rest_after_ake || 0, P3.softW("rest_after_ake"), "減点は 1 件分: " + JSON.stringify(pen.items)); }
  });
  test("勤務帯ごとのオンコール: 日勤に付けないと日勤枠のOCは空になり、夜勤には付く。検算・減点も一致する", () => {
    const rules = clone(real.rules); rules.profile = Object.assign({}, rules.profile, { shifts: [{ id: "day", label: "日勤", on: "off_days", oncall: false }, { id: "night", label: "夜勤", on: "all" }] });
    // 期間責任者は期間中の全枠にオンコールが要るので、入力チェックが知らせる。試験は期間責任者と同日集約を外して行う
    assert(T.lint(new T.Problem(rules, T.normalizeMonth(clone(real.month), rules))).some(x => x.code === "LINT_PERIOD_CHARGE_NEEDS_ONCALL"), "期間責任者との矛盾を指摘する");
    rules.rule_states = Object.assign({}, rules.rule_states, { period_charge: "off", same_day_team: "off" }); T.fillDefaultRules(rules);
    const month = T.normalizeMonth(clone(real.month), rules);
    const { P, r, c } = solveOK(rules, month, "日勤にOCなし");
    assert.strictEqual(c.V.length, 0, "違反: " + c.V.slice(0, 3).join(" / "));
    const dayOc = P.slots.filter(s => s[1] === "day" && r.asg[`${s[0]}:day`].oc.length), nightOc = P.slots.filter(s => s[1] === "night" && r.asg[`${s[0]}:night`].oc.length);
    assert.strictEqual(dayOc.length, 0, "日勤枠にOCが付いた: " + dayOc.map(s => s[0]).join(","));
    assert(nightOc.length > 0, "夜勤枠にはOCが付く");
    const pin = T.solve(P, highs, { timeLimit: 60, pin: r.asg }); assert(Math.abs(T.penalty(P, r.asg).total - pin.objective) < 1e-6, "減点の合計が一致");
    // 日勤OCの固定指定は入力チェックが知らせる
    const m2 = clone(month); const d = P.slots.find(s => s[1] === "day")[0]; m2.fixed.day_oc = { [d]: [P.standbyNames[0]] };
    assert(T.lint(new T.Problem(rules, m2)).some(x => x.code === "LINT_FIXED_OC_NO_ONCALL_SHIFT"), "オンコールを付けない勤務帯への固定OCを指摘する");
  });
  // 看護師 2 交代（夜勤 4 名・日勤 12〜13 名のうち管理者 1 名）。規則を 1 つずつ実際の割当で確かめる
  const nurse = () => { const r = JSON.parse(fs.readFileSync(path.join(__dirname, "data/profiles/nurse-2shift.json"), "utf8")); T.fillDefaultRules(r); return r; };
  const nurseMonth = r => T.normalizeMonth({ year: 2026, month: 11, holidays: [3, 23], next_month_first_day_is_holiday: false }, r);
  const nurseSolve = (r, m) => { const P = new T.Problem(r, m), res = T.solve(P, highs, { timeLimit: 60, mipGap: 0.05 }); assert(res.asg, "解あり（status " + res.status + "）"); return { P, res, A: new T.Asg(P, res.asg), c: T.check(P, res.asg) }; };
  test("看護師 2 交代: 構成（夜勤に若手は1人まで・夜勤に師長なし・日勤に管理者1人以上と、管理者とは別のリーダー）、休みの日数ちょうど（明けは数えない）、2連休2回（3連休も1回）、4連勤なし、明け", () => {
    const r = nurse(), m = nurseMonth(r); const { P, res, A, c } = nurseSolve(r, m);
    assert.strictEqual(c.V.length, 0, "違反: " + c.V.slice(0, 3).join(" / "));
    assert.deepStrictEqual(T.lint(P).map(x => x.code), []);
    const has = (n, q) => [].concat(P.doctors[n].quals || []).includes(q);
    for (const s of P.slots) { const ws = A.workers(s);
      if (s[1] === "night") { assert.strictEqual(ws.length, 4, `${s[0]} 夜勤の人数`); assert(ws.filter(n => has(n, "若手")).length <= 1, `${s[0]} 夜勤に若手が2人以上`); assert(!ws.some(n => has(n, "師長")), `${s[0]} 夜勤に師長`); }
      else { assert(ws.length >= 12 && ws.length <= 13, `${s[0]} 日勤の人数 ${ws.length}`); assert(ws.some(n => has(n, "管理者")), `${s[0]} 日勤の管理者`);
        // 管理者 1 人とリーダー 1 人を別の人で立てられる（師長はリーダーにならない）
        const mg = ws.filter(n => has(n, "管理者")), ld = ws.filter(n => has(n, "リーダー"));
        assert(mg.some(m => ld.some(l => l !== m)), `${s[0]} 日勤に管理者とは別のリーダーがいない`); } }
    assert.strictEqual(P.minDaysOff, 11, "2026年11月の土日祝は 11 日");
    for (const n of P.dutyNames) {
      const w = d => ["day", "night"].some(k => A.worked(n, [d, k])), ake = d => d > 1 && A.worked(n, [d - 1, "night"]);
      const off = []; for (let d = 1; d <= P.N; d++) if (!w(d) && !ake(d)) off.push(d);
      assert.strictEqual(off.length, 11, `${n} の休み ${off.length} 日`);
      let pairs = 0; for (let d = 1; d < P.N; d++) if (off.includes(d) && off.includes(d + 1) && !off.includes(d - 1)) pairs++; assert(pairs >= 2, `${n} の2連休 ${pairs} 回（3連休も1回）`); // 続いた休みを 1 回
      if (has(n, "師長")) { for (let d = 1; d <= P.N; d++) if (P.isHoliday(d)) assert(!w(d), `師長が土日祝の ${d}日 に勤務`); } // 師長は平日の日勤だけ（連勤の上限の対象外）
      else { let run = 0; for (let d = 1; d <= P.N; d++) { run = w(d) ? run + 1 : 0; assert(run <= 3, `${n} が ${d}日 までに4連勤`); } }
      for (let d = 1; d < P.N; d++) if (A.worked(n, [d, "night"])) assert(!w(d + 1), `${n} の ${d}日 夜勤の翌日に勤務`);
    }
    const pin = T.solve(P, highs, { timeLimit: 60, pin: res.asg }); assert(Math.abs(T.penalty(P, res.asg).total - pin.objective) < 1e-6, "減点の合計が一致");
  });
  test("看護師 2 交代: 人数が合わず解が無い設定は、入力チェックが理由（何日分ずれているか）と直し方を出す", () => {
    const cap13 = r => { r.profile.positions.work.count.day = 13; r.profile.positions.work.ideal.day = 13; return r; }; // 日勤の上限を 13 名にした設定で見る
    const r1 = cap13(nurse()); r1.doctors.push({ name: "Ns99", team: "N", years: 3, quota: 0 }); r1.name_order.push("Ns99");
    const L1 = T.lint(new T.Problem(r1, nurseMonth(r1))), x1 = L1.find(x => x.code === "LINT_BUSY_DAYS_TOO_MANY");
    assert(x1, "33 人は勤務日が余る: " + L1.map(x => x.code).join(",")); assert.strictEqual(x1.args.diff, 1); assert(/有給を合計 1 日/.test(x1.hint), x1.hint);
    const r1b = cap13(nurse()); r1b.doctors.push({ name: "Ns99", team: "N", years: 3, quota: 0 }); r1b.name_order.push("Ns99");
    const m1b = nurseMonth(r1b); m1b.unavailable_other = [{ name: "Ns99", day: 5, part: "allday", paid: true }];
    assert(!T.lint(new T.Problem(r1b, m1b)).some(x => x.code.startsWith("LINT_BUSY_DAYS")), "有給を 1 日入れれば合う");
    const r3 = nurse(); delete r3.run_length.exempt_qual; // 師長を連勤の上限の対象外にしないと、平日に毎日勤務するしかなく 5 連勤になる
    const x3 = T.lint(new T.Problem(r3, nurseMonth(r3))).find(x => x.code === "LINT_PERSON_FORCED_RUN");
    assert(x3 && x3.args.who === "師長A" && x3.args.len === 5, "師長の連勤の理由を出す"); assert(/対象外の資格/.test(x3.hint), x3.hint);
    const r2 = nurse(); r2.doctors.forEach(d => { if (d.name.startsWith("係長")) d.quals = ["リーダー"]; });
    const x2 = T.lint(new T.Problem(r2, nurseMonth(r2))).find(x => x.code === "LINT_COMPOSITION_CAPACITY");
    assert(x2 && x2.args.need === 30 && x2.args.cap === 19, "管理者が師長 1 人だけなら毎日の日勤を埋められない");
  });
  test("1 枠の人数の理想値: 下限〜上限に収め、規則の要約に出る。理想からのずれは減点で、解く側と検算の数え方が一致する", () => {
    const r = nurse(), P = new T.Problem(r, nurseMonth(r));
    assert.strictEqual(P.countIdealOf([1, "day"]), 13); assert.strictEqual(P.countIdealOf([1, "night"]), null, "理想値を書いていない勤務帯は null");
    const r2 = nurse(); r2.profile.positions.work.ideal.day = 20; assert.strictEqual(new T.Problem(r2, nurseMonth(r2)).countIdealOf([1, "day"]), 14, "上限に収める");
    assert(T.rulesSummary(P).some(g => g.items.some(i => /12〜14（理想 13）/.test(i))), "要約に下限〜上限と理想が出る");
    const res = T.solve(P, highs, { timeLimit: 60, mipGap: 0.05 }); assert(res.asg);
    const pen = T.penalty(P, res.asg); const dev = P.slots.filter(s => s[1] === "day").reduce((a, s) => a + Math.abs(res.asg[`${s[0]}:day`].work.length - 13), 0);
    assert.strictEqual(pen.items.count_deviation || 0, dev * P.weights.count_deviation, "減点は理想からのずれ × 重み");
  });
  test("看護師 2 交代: 有給の日は勤務に入らず、休みの日数がその分増える", () => {
    const r = nurse(), m = nurseMonth(r); m.unavailable_other = [{ name: "Ns01", day: 10, part: "allday", paid: true }, { name: "Ns01", day: 11, part: "allday", paid: true }];
    const { P, A, c } = nurseSolve(r, m);
    assert.strictEqual(c.V.length, 0, "違反: " + c.V.slice(0, 3).join(" / ")); assert.strictEqual(P.offTarget("Ns01"), 13); assert.strictEqual(P.offTarget("Ns02"), 11);
    for (const d of [10, 11]) assert(!["day", "night"].some(k => A.worked("Ns01", [d, k])), `有給の ${d}日 に勤務`);
  });
  test("看護師 2 交代: 前月末は連勤の上限＋2 日（5 日）取り込み、前月末の 3 連勤に当月 1 日をつなげない。複数名の枠の勤務者は配列で持つ", () => {
    const r = nurse(); assert.strictEqual(T.prevLookback(r), 5); assert.strictEqual(T.prevLookback(T.DEFAULT_RULES), 2, "連勤の規則を使わない施設は 2 日");
    const m = nurseMonth(r), others = r.doctors.map(d => d.name).filter(n => n !== "Ns01");
    m.prev_month.last_days = [27, 28, 29, 30, 31].map((date, i) => ({ date, day: i >= 2 ? ["Ns01"].concat(others.slice(i, i + 11)) : others.slice(i, i + 12), night: others.slice(20 + i % 4, 24 + i % 4) }));
    // 前月 31 日は Ns01 が日勤（29〜31 日の 3 連勤）。31 日の夜勤は Ns01 以外
    const { P, A, c } = nurseSolve(r, m);
    assert.strictEqual(c.V.length, 0, "違反: " + c.V.slice(0, 3).join(" / "));
    assert(P.prevWorked([0, "day"], "Ns01") && P.prevWorked([-2, "day"], "Ns01"), "前月末の配列を読む");
    assert(!["day", "night"].some(k => A.worked("Ns01", [1, k])), "前月末の3連勤の翌日（当月1日）に勤務が入った");
  });
  test("名簿の人の呼び方はどの施設でも「職員」（英語 staff）", () => {
    try {
      assert.strictEqual(T.t("{person}別カレンダー"), "職員別カレンダー"); assert.strictEqual(T.t("{person}を追加"), "職員を追加");
      const P = new T.Problem(nurse(), nurseMonth(nurse())); assert(/職員/.test(P.msg("LINT_SLOT_NO_CANDIDATE", { day: "11/1", slot: "日勤" })), "入力チェックの文面も");
      T.setLang("en"); assert.strictEqual(T.t("{person}を追加"), "Add a staff member");
    } finally { T.setLang("ja"); }
  });
  test("1枠に複数名: オンコールや期間責任者を併用しようとすると理由を添えて止まる", () => {
    const rules = JSON.parse(fs.readFileSync(path.join(__dirname, "data/fixtures/ward-2shift.json"), "utf8"));
    rules.rule_states = Object.assign({}, rules.rule_states, { oncall: "hard" }); T.fillDefaultRules(rules);
    assert.throws(() => new T.Problem(rules, T.normalizeMonth({ year: 2026, month: 11, holidays: [] }, rules)), /複数名/);
  });
  test("明け休み（shift_sequence）: 夜勤の翌日に勤務が入らない。外すと入りうる", () => {
    const rules = JSON.parse(fs.readFileSync(path.join(__dirname, "data/profiles/two-shift.json"), "utf8"));
    rules.doctors = rules.doctors.slice(0, 5).map(d => Object.assign({}, d, { quota: 12 }));
    rules.name_order = rules.doctors.map(d => d.name); T.fillDefaultRules(rules);
    const month = T.normalizeMonth({ year: 2026, month: 11, holidays: [3, 23], next_month_first_day_is_holiday: false }, rules);
    const P = new T.Problem(rules, month);
    assert.strictEqual(P.state("shift_sequence"), "hard");
    const r = T.solve(P, highs, { timeLimit: 60, mipGap: 0.02 });
    assert(r.asg, "解あり（status " + r.status + "）");
    const A = new T.Asg(P, r.asg);
    let ake = 0; for (const n of P.dutyNames) for (let d = 1; d < P.N; d++) if (A.worked(n, [d, "night"]) && ["day", "night"].some(k => A.worked(n, [d + 1, k]))) ake++;
    assert.strictEqual(ake, 0, `夜勤の翌日に勤務が ${ake} 件`);
    assert.strictEqual(T.check(P, r.asg).V.length, 0);
    // 手で作った違反は検算が捕まえる
    const bad = JSON.parse(JSON.stringify(r.asg)); const who = A.work([5, "night"]);
    bad["6:day"] = { work: who, oc: [] };
    assert(T.check(P, bad).V.some(v => /明け休み/.test(v)), "検算が明け休みの違反を出す");
  });
  test("連勤の上限（run_length_max）: 上限を 2 日にすると 3 連勤が出ない。手で作った 3 連勤は検算が捕まえる", () => {
    const rules = JSON.parse(fs.readFileSync(path.join(__dirname, "data/profiles/two-shift.json"), "utf8"));
    rules.run_length = { max: 2 }; T.fillDefaultRules(rules);
    const month = T.normalizeMonth({ year: 2026, month: 11, holidays: [3, 23], next_month_first_day_is_holiday: false }, rules);
    const P = new T.Problem(rules, month); assert.strictEqual(P.runMax, 2);
    const r = T.solve(P, highs, { timeLimit: 60, mipGap: 0.02 });
    assert(r.asg, "解あり（status " + r.status + "）");
    const A = new T.Asg(P, r.asg);
    for (const n of P.dutyNames) { let run = 0; for (let d = 1; d <= P.N; d++) { const w = ["day", "night"].some(k => A.worked(n, [d, k])); run = w ? run + 1 : 0; assert(run <= 2, `${n} が ${d}日 で ${run} 連勤`); } }
    const bad = JSON.parse(JSON.stringify(r.asg)); const who = A.work([10, "night"]);
    for (const d of [11, 12]) bad[`${d}:night`] = { work: who, oc: [] };
    assert(T.check(P, bad).V.some(v => /連勤/.test(v)), "検算が連勤の超過を出す");
  });
  test("入力チェック: 連勤の上限と「連日の実勤務は禁止」を同時に使うと指摘する", () => {
    const rules = clone(real.rules); rules.run_length = { max: 4 };
    rules.rule_states = Object.assign({}, rules.rule_states, { run_length_max: "hard" }); T.fillDefaultRules(rules);
    const P = new T.Problem(rules, T.normalizeMonth(clone(real.month), rules));
    assert(T.lint(P).some(x => /連勤の上限と/.test(x.msg)), "指摘が出る");
  });
  test("入力チェック: 枠数と勤務回数の合計が合わないときに先に指摘する", () => {
    const rules = clone(real.rules); for (const d of rules.doctors) if (d.quota) d.quota = 1;
    const month = T.normalizeMonth(clone(real.month), rules);
    const msgs = T.lint(new T.Problem(rules, month)).map(x => x.msg);
    assert(msgs.some(m => /枠が \d+ なのに、勤務回数の上限の合計/.test(m)), "指摘が出る: " + msgs.slice(0, 3).join(" / "));
  });
  test("規則の状態: 実勤務の連続を「なし」にすると連日の勤務が出ても違反にならない", () => {
    const rules = clone(real.rules); rules.rule_states = Object.assign({}, rules.rule_states, { consecutive_days: "off", same_day_double: "off" });
    T.fillDefaultRules(rules); const month = T.normalizeMonth(clone(real.month), rules);
    month.fixed.night = Object.assign({}, month.fixed.night, { 10: "Dr N", 11: "Dr N" }); // 連日の夜勤を固定
    const P = new T.Problem(rules, month); assert.strictEqual(P.state("consecutive_days"), "off");
    const { r, c } = solveOK(rules, month, "連続なし");
    assert.strictEqual(r.asg["10:night"].work, "Dr N"); assert.strictEqual(r.asg["11:night"].work, "Dr N");
    assert.strictEqual(c.V.length, 0, "違反: " + c.V.join(" / "));
  });
  test("規則の状態: 実勤務の連続を「減点」にすると解は出て、第9節に組が並ぶ", () => {
    const rules = clone(real.rules); rules.rule_states = Object.assign({}, rules.rule_states, { consecutive_days: "soft" });
    rules.weights = Object.assign({}, rules.weights, { consecutive_days: 1 }); // 軽くして必ず起こす
    T.fillDefaultRules(rules); const month = T.normalizeMonth(clone(real.month), rules);
    month.fixed.night = Object.assign({}, month.fixed.night, { 10: "Dr N", 11: "Dr N" });
    const { P, r, c } = solveOK(rules, month, "連続は減点");
    assert.strictEqual(c.V.length, 0, "違反: " + c.V.join(" / "));
    const s9 = T.buildReport(P, r.asg, {}).sections.find(x => x.id === "s9").html;
    assert(/連日の実勤務（減点 consecutive_days）: Dr N/.test(s9), "第9節に出る: " + s9.slice(0, 200));
  });
  test("規則の状態: 週休日を「減点」にすると解なしにならず、検算の違反にもならない", () => {
    const rules = clone(real.rules); rules.rule_states = Object.assign({}, rules.rule_states, { rest_day: "soft" });
    T.fillDefaultRules(rules); assert.strictEqual(rules.rest_day_required, true, "旧キーは必須寄りに揃える");
    const month = T.normalizeMonth(clone(real.month), rules);
    const P = new T.Problem(rules, month); assert.strictEqual(P.restDayRequired, false, "必須ではない");
    assert(!T.lint(P).some(x => /週休日/.test(x.msg)), "入力チェックは出ない");
    const { c } = solveOK(rules, month, "週休日は減点"); assert.strictEqual(c.V.length, 0, "違反: " + c.V.join(" / "));
  });
  test("規則の状態: 同じ曜日の上限を「必須」にすると上限を超えない", () => {
    const rules = clone(real.rules); rules.rule_states = Object.assign({}, rules.rule_states, { same_weekday_cap: "hard" });
    rules.max_same_weekday_shifts = 2; T.fillDefaultRules(rules); const month = T.normalizeMonth(clone(real.month), rules);
    const { P, r, c } = solveOK(rules, month, "曜日上限は必須"); assert.strictEqual(c.V.length, 0, "違反: " + c.V.join(" / "));
    for (const n of P.dutyNames) { const cnt = {}; for (const s of P.slots) if (new T.Asg(P, r.asg).worked(n, s)) cnt[P.dow(s[0])] = (cnt[P.dow(s[0])] || 0) + 1;
      for (const [w, c2] of Object.entries(cnt)) assert(c2 <= 2, `${n} の ${w} 曜が ${c2} 回`); }
  });
  test("勤務の間隔: 中1日の重みを極端に大きくすると中1日の組が無くなる", () => {
    const rules = clone(real.rules); rules.weights.work_gap_1 = 100000; const month = T.normalizeMonth(clone(real.month), rules);
    const { P, r } = solveOK(rules, month, "勤務間隔");
    const wk = (n, d) => ["day", "night"].some(k => r.asg[`${d}:${k}`] && r.asg[`${d}:${k}`].work === n);
    const bad = []; for (const n of P.dutyNames) for (let d = 1; d + 2 <= P.N; d++) if (wk(n, d) && wk(n, d + 2)) bad.push(`${n} ${d}→${d + 2}`);
    assert.strictEqual(bad.length, 0, bad.join(", "));
  });
  test("設定で変えられる必須条件: 午後外勤日の夜勤を「制限なし」、週休日を不要にしても計算と検算が同じ規則で動く", () => {
    const rules = clone(real.rules); rules.pm_external_night = "allow"; rules.rest_day_required = false;
    const month = T.normalizeMonth(clone(real.month), rules); month.confirmed_pm_external_night = [];
    const P = new T.Problem(rules, month); assert.strictEqual(P.pmExtNight, "allow"); assert.strictEqual(P.restDayRequired, false); assert.strictEqual(P.sameDayChargeOtherBanned, false);
    const { c } = solveOK(rules, month, "緩めた規則"); assert.strictEqual(c.V.length, 0, "違反: " + c.V.join(" / "));
    assert(!T.lint(P).some(x => /週休日/.test(x.msg)), "週休日の入力チェックが出ない");
    const rules2 = clone(real.rules); rules2.pm_external_night = "forbid"; const P2 = new T.Problem(rules2, T.normalizeMonth(clone(real.month), rules2));
    assert.strictEqual(P2.pmExtNightBanned(1, "Dr E"), true, "forbid では確認記録があっても禁止");
  });
  test("OC を含む隣接枠の連続は違反ではなく減点: 固定で日をまたぐ OC→OC を作っても解あり・違反0", () => {
    const rules = clone(real.rules), month = T.normalizeMonth(clone(real.month), rules);
    month.fixed.night_oc = { 9: ["Dr N"], 10: ["Dr N"] }; // 11/9(月)夜間OC → 11/10(火)夜間OC
    const { P, r, c } = solveOK(rules, month, "OC→OC の固定"); assert.strictEqual(c.V.length, 0, "違反: " + c.V.join(" / "));
    const rep = T.buildReport(P, r.asg, {}); const s9 = rep.sections.find(s => s.id === "s9").html; assert(/OC を含む隣接枠の連続.*Dr N/.test(s9), "第9節に減点対象として出る");
  });
  test("固定「若手OCなし」: その枠に若手OCが付かず、検算の違反にもならず、第9節に出る", () => {
    const rules = clone(real.rules), month = T.normalizeMonth(clone(real.month), rules);
    month.fixed.night = { 4: "Dr J" }; month.fixed.night_oc_none = { 4: ["Y"] }; // 11/4(水) 副担当の夜勤、若手OCなし
    const { P, r, c } = solveOK(rules, month, "若手OCなし"); assert.strictEqual(c.V.length, 0, "違反: " + c.V.join(" / "));
    assert(!r.asg["4:night"].oc.some(n => P.team[n] === "Y"), "若手OCが付いていない: " + r.asg["4:night"].oc.join("・"));
    const s9 = T.buildReport(P, r.asg, {}).sections.find(s => s.id === "s9").html; assert(/固定で若手OCなし/.test(s9), "第9節に出る");
  });
  // ---- 規則を「なし」にできること（調整目標も含めてすべての規則が on/off を持つ） ----
  test("規則を「なし」にすると、その規則の重みと内側の重みが 0 になる（減点が消える）", () => {
    const rules = clone(real.rules);
    rules.rule_states = Object.assign({}, rules.rule_states, { spread_standby: "off", avoid_days: "off", work_gap: "off" });
    T.fillDefaultRules(rules);
    assert(rules.weights.spread_Y_oc > 0, "保存する規則側の重みは残す（戻したときのため）");
    const P = new T.Problem(rules, T.normalizeMonth(clone(real.month), rules));
    for (const k of ["spread_Y_oc", "spread_I_nightoc", "spread_Y_holiday_work", "avoid_day", "avoid_no_reduction", "work_gap_1", "work_gap_2"])
      assert.strictEqual(P.weights[k], 0, k + " は 0");
    assert(P.weights.target_deviation > 0, "「なし」にしていない規則の重みは残る");
  });
  test("規則の状態: 勤務回数の範囲（quota_range）を「なし」にすると、目安から外れても違反にならない", () => {
    const rules = clone(real.rules); const month = T.normalizeMonth(clone(real.month), rules);
    const asg = clone(real.result.asg);
    const n0 = rules.doctors.find(d => d.team === "Y").name; // 1 人に寄せて目安から外す
    for (const k of Object.keys(asg)) if (k.endsWith(":night")) { asg[k].work = n0; asg[k].oc = []; }
    assert(T.check(new T.Problem(rules, month), asg).V.some(v => /の範囲外/.test(v)), "必須のときは違反に出る");
    rules.rule_states = Object.assign({}, rules.rule_states, { quota_range: "off" }); T.fillDefaultRules(rules);
    assert(!T.check(new T.Problem(rules, month), asg).V.some(v => /の範囲外/.test(v)), "「なし」なら回数を見ない");
  });
  test("規則の名前と検算の文面には、施設で付けた役割の表示名が出る（焼き込みをしない）", () => {
    const rules = clone(real.rules);
    rules.profile = Object.assign({}, rules.profile, { roles: [
      { id: "I", label: "内科", refs: ["charge"], standby: true }, { id: "A", label: "外科", refs: ["other"] },
      { id: "Y", label: "研修", refs: ["junior"], standby: true }, { id: "C", label: "管理", refs: ["reserve"] }] });
    const def = T.RULE_BY_ID.oncall;
    assert(/内科OC/.test(T.ruleLabel(rules, def)) && /研修OC/.test(T.ruleLabel(rules, def)), "規則の名前: " + T.ruleLabel(rules, def));
    const P = new T.Problem(rules, T.normalizeMonth(clone(real.month), rules));
    assert.strictEqual(P.term("{charge}担当"), "内科担当");
    const asg = clone(real.result.asg); delete asg["1:day"].oc; asg["1:day"].oc = [];
    assert(T.check(P, asg).V.length > 0, "検算が何か言う");
  });
  // ---- 休みの日数・2 連休・希望休の上限 ----
  test("月の休みの最低日数は暦の日数から決まる（週40時間・1日8時間）", () => {
    const rules = clone(real.rules);
    for (const [N, want] of [[28, 8], [29, 9], [30, 9], [31, 9]]) assert.strictEqual(T.minDaysOff(rules, N), want, `${N}日→${want}日`);
    rules.days_off = { min: 11 }; assert.strictEqual(T.minDaysOff(rules, 30), 11, "直接指定はそのまま使う");
    rules.days_off = { hours_per_week: 32, hours_per_day: 8 }; assert.strictEqual(T.minDaysOff(rules, 28), 12, "週32時間なら 28日→12日");
  });
  test("規則の状態: 月の休みの最低日数と 2 連休を「必須」にすると、その通りの解が出る", () => {
    const rules = clone(real.rules);
    rules.rule_states = Object.assign({}, rules.rule_states, { days_off_min: "hard", days_off_pair: "hard" });
    rules.days_off = { pair_min: 2 }; T.fillDefaultRules(rules);
    const month = T.normalizeMonth(clone(real.month), rules);
    const { P, r, c } = solveOK(rules, month, "休みの日数＋2連休");
    assert.strictEqual(P.minDaysOff, 9, "2026年11月（30日）は 9 日");
    assert.strictEqual(c.V.length, 0, "違反: " + c.V.slice(0, 3).join(" / "));
    const A = new T.Asg(P, r.asg);
    for (const n of P.dutyNames) {
      if (P.isRole(n, "reserve")) continue;
      const off = []; for (let d = 1; d <= P.N; d++) if (!["day", "night"].some(k => A.worked(n, [d, k]))) off.push(d);
      const st = new Set(off); let pr = 0; for (let d = 1; d + 1 <= P.N; d++) if (st.has(d) && st.has(d + 1)) pr++;
      assert(off.length >= 9, `${n} の休みが ${off.length} 日`); assert(pr >= 2, `${n} の 2 連休が ${pr} 回`);
    }
  });
  test("検算: 休みの日数と 2 連休が足りない割当を捕まえる", () => {
    const rules = clone(real.rules);
    rules.rule_states = Object.assign({}, rules.rule_states, { days_off_min: "hard", days_off_pair: "hard" });
    rules.days_off = { pair_min: 2 }; T.fillDefaultRules(rules);
    const month = T.normalizeMonth(clone(real.month), rules);
    const P = new T.Problem(rules, month), asg = {}, n0 = P.dutyNames.find(n => !P.isRole(n, "reserve"));
    for (const s of P.slots) asg[`${s[0]}:${s[1]}`] = { work: n0, oc: [] }; // 全部 1 人に寄せる
    const V = T.check(P, asg).V;
    assert(V.some(v => /月の休みが/.test(v)), "休み不足: " + V.slice(0, 3).join(" / "));
    assert(V.some(v => /2 連休が/.test(v)), "2 連休の不足");
  });
  test("入力チェック: 希望休の上限を超えた申告と、休みの日数が成り立たない設定を指摘する", () => {
    const rules = clone(real.rules);
    rules.rule_states = Object.assign({}, rules.rule_states, { wish_off_cap: "hard" });
    rules.wish_off = { max: 2, counts: "unavailable" }; T.fillDefaultRules(rules);
    const month = clone(real.month);
    for (const n of Object.keys(month.unavailable_night)) month.unavailable_night[n] = []; // 申告を一度空にしてから 1 人だけ入れる
    month.unavailable_other = []; delete month.avoid;
    const n0 = new T.Problem(rules, T.normalizeMonth(clone(month), rules)).dutyNames[0];
    month.unavailable_night[n0] = [3, 4, 5];
    assert(T.lint(new T.Problem(rules, T.normalizeMonth(clone(month), rules))).some(x => new RegExp(`${n0} の希望休が 3 日で上限 2 日`).test(x.msg)), "上限超過を指摘");
    rules.wish_off.max = 5;
    assert(!T.lint(new T.Problem(rules, T.normalizeMonth(clone(month), rules))).some(x => /希望休が/.test(x.msg)), "上限内なら出ない");
    // 2 連休の回数が休みの日数と両立しない
    const r2 = clone(real.rules);
    r2.rule_states = Object.assign({}, r2.rule_states, { days_off_min: "hard", days_off_pair: "hard" });
    r2.days_off = { pair_min: 6 }; T.fillDefaultRules(r2);
    assert(T.lint(new T.Problem(r2, T.normalizeMonth(clone(real.month), r2))).some(x => /2 連休 6 回には休みが 12 日要ります/.test(x.msg)), "両立しない組合せを指摘");
  });
  // ---- 表示言語 ----
  test("表示言語: 訳があれば置き換え、無ければ日本語のまま。{名前} の差し込みも効く", () => {
    T.setLang("ja"); assert.strictEqual(T.t("計算する"), "計算する");
    T.setLang("en"); assert.strictEqual(T.t("計算する"), "Solve");
    assert.strictEqual(T.t("この文字列は訳の表にない"), "この文字列は訳の表にない", "未訳は日本語のまま");
    assert.strictEqual(T.t("必要な {role} のオンコール（人）", { role: "Nurse" }), "Nurse on-call needed (people)");
    T.setLang("ja");
  });
  test("表示言語: 規則の名前と区分はすべて英語の訳がある（規則を足したら訳も足す）", () => {
    T.setLang("en");
    const miss = [];
    for (const def of T.RULE_DEFS) { if (T.t(def.label) === def.label) miss.push(def.id);
      for (const p of def.params || []) for (const k of [p.label, p.blank]) if (k && T.t(k) === k) miss.push(`${def.id}.params: ${k}`); } // プラグインが宣言した設定欄の文言
    for (const [, label] of T.RULE_GROUPS) if (T.t(label) === label) miss.push(label);
    for (const st of Object.values(T.STATE_JA)) if (T.t(st) === st) miss.push(st);
    T.setLang("ja");
    assert.deepStrictEqual(miss, [], "訳の無い項目: " + miss.join("、"));
  });
  test("表示名は 1 本の文字列でも {ja, en} でもよい（同梱のプロファイルだけが両方を持つ）", () => {
    const rules = clone(real.rules);
    rules.profile = Object.assign({}, rules.profile, { roles: [
      { id: "I", label: { ja: "主担当", en: "Ischemia" }, refs: ["charge"], standby: true },
      { id: "Y", label: "若手", refs: ["junior"], standby: true }] });
    T.setLang("en");
    const en = T.normalizeRolesOf(rules);
    assert.strictEqual(en[0].label, "Ischemia"); assert.strictEqual(en[1].label, "若手", "1 本の文字列はどの言語でもその名前");
    assert(/Ischemia/.test(T.ruleLabel(rules, T.RULE_BY_ID.period_charge)), T.ruleLabel(rules, T.RULE_BY_ID.period_charge));
    T.setLang("ja");
    assert.strictEqual(T.normalizeRolesOf(rules)[0].label, "主担当", "日本語では日本語の名前");
  });
  test("説明資料の節題は言語で切り替わる（役割の名前はそのまま入る）", () => {
    const rules = clone(real.rules), month = T.normalizeMonth(clone(real.month), rules);
    const P = new T.Problem(rules, month), asg = clone(real.result.asg);
    T.setLang("ja"); const ja = T.buildReport(P, asg, {}).sections.map(s => s.title);
    T.setLang("en"); const en = T.buildReport(P, asg, {}).sections.map(s => s.title);
    T.setLang("ja");
    assert.strictEqual(ja[1], "1 必須条件の検算"); assert.strictEqual(en[1], "1 Verification of the required rules");
    assert(/主担当/.test(en[4]), "施設の役割名は訳さずそのまま: " + en[4]);
  });
  test("検算の違反は種類（code）で返り、文面は言語で切り替わる", () => {
    const rules = clone(real.rules), month = T.normalizeMonth(clone(real.month), rules);
    const P = new T.Problem(rules, month), asg = clone(real.result.asg);
    const n0 = P.dutyNames.find(n => !P.isRole(n, "reserve"));
    for (const d of [2, 3, 4]) asg[`${d}:night`].work = n0; // 連日・回数・OC構成をまとめて壊す
    T.setLang("ja"); const ja = T.check(new T.Problem(clone(rules), clone(month)), clone(asg));
    T.setLang("en"); const en = T.check(new T.Problem(clone(rules), clone(month)), clone(asg));
    T.setLang("ja");
    assert(ja.V.length > 0, "違反が出る");
    assert.deepStrictEqual(en.VC.map(x => x.code), ja.VC.map(x => x.code), "code は言語で変わらない");
    assert.notDeepStrictEqual(en.V, ja.V, "文面は言語で変わる");
    assert(ja.VC.some(x => x.code === "CONSECUTIVE_DAYS"), "連日の code: " + ja.VC.map(x => x.code).join("、"));
    const c = ja.VC.find(x => x.code === "CONSECUTIVE_DAYS");
    assert.strictEqual(c.args.who, n0, "誰の違反かが引数で分かる");
    assert(/Dr /.test(T.msg("CONSECUTIVE_DAYS", c.args, rules)), "code と引数から文面を作り直せる");
  });
  test("知らない code でも落ちず、code と引数がそのまま出る", () => {
    assert.strictEqual(T.msg("NO_SUCH_CODE", {}), "NO_SUCH_CODE");
    assert(/NO_SUCH_CODE/.test(T.msg("NO_SUCH_CODE", { a: 1 })));
  });
  test("違反の文面はすべて英語と日本語の両方がある（文面を足したら訳も足す）", () => {
    const miss = Object.entries(T.MSG).filter(([, m]) => !m.en || !m.ja).map(([k]) => k);
    assert.deepStrictEqual(miss, [], "英語か日本語が無い: " + miss.join("、"));
    const en = T.langData("en").msg;
    const notInFile = Object.keys(T.MSG).filter(k => !(k in en));
    assert.deepStrictEqual(notInFile, [], "lang/en.json の msg に無い: " + notInFile.join("、"));
  });
  test("言語を 1 ファイル足すだけで切り替わり、訳の無い項目は英語に落ちる", () => {
    T.registerLang({ code: "zz", name: "Test", dow: ["a", "b", "c", "d", "e", "f", "g"], date_locale: "en-GB", list_sep: ", ", name_sep: ", ",
      ui: { "計算する": "ZZ-solve" }, msg: { CONSECUTIVE_DAYS: "ZZ {who}" }, help: {} });
    assert(T.LANGS().some(([c]) => c === "zz"), "言語の一覧に出る");
    T.setLang("zz");
    assert.strictEqual(T.t("計算する"), "ZZ-solve");
    assert.strictEqual(T.t("中止"), "Cancel", "訳が無ければ英語");
    assert.strictEqual(T.msg("CONSECUTIVE_DAYS", { who: "Dr E" }), "ZZ Dr E");
    assert(/on both day and night/.test(T.msg("SAME_DAY_DOUBLE", { day: "1", who: "Dr E" })), "違反の文面も英語に落ちる");
    assert.strictEqual(T.dowLabel(0), "a");
    assert(T.help().length > 0, "ヘルプの訳が無ければ英語の節を出す");
    T.setLang("ja");
    assert.strictEqual(T.t("計算する"), "計算する", "日本語は鍵そのもの");
    assert(/連日の実勤務/.test(T.msg("CONSECUTIVE_DAYS", { who: "Dr E" })), "日本語は英語に落ちない");
  });
  test("入力チェックも種類（code）＋引数で返り、直し方（hint）が付く", () => {
    const rules = clone(real.rules), month = clone(real.month);
    month.unavailable_other = (month.unavailable_other || []).filter(u => u.name !== "Dr E").concat([{ name: "Dr E", day: 8, part: "allday" }]); // 11/8 は Dr E が日夜両方の不可
    month.fixed.night = { 8: "Dr E" };
    T.setLang("ja"); const ja = T.lint(new T.Problem(clone(rules), T.normalizeMonth(clone(month), rules)));
    T.setLang("en"); const en = T.lint(new T.Problem(clone(rules), T.normalizeMonth(clone(month), rules)));
    T.setLang("ja");
    assert(ja.length > 0, "指摘が出る");
    assert.deepStrictEqual(en.map(x => x.code), ja.map(x => x.code), "code は言語で変わらない");
    const it = ja.find(x => x.code === "LINT_FIXED_VS_UNAVAIL");
    assert(it, "code: " + ja.map(x => x.code).join("、"));
    assert.strictEqual(it.args.who, "Dr E"); assert(it.hint.length > 0, "直し方が付く");
    assert.notStrictEqual(en.find(x => x.code === "LINT_FIXED_VS_UNAVAIL").msg, it.msg, "文面は言語で変わる");
  });
  test("入力チェックの文面には直し方（_HINT）が揃っている", () => {
    const srcs = ["src/check.js"].concat(fs.readdirSync(path.join(__dirname, "src/rules")).filter(x => x.endsWith(".js")).map(x => "src/rules/" + x));
    const used = [...new Set(srcs.flatMap(f => [...fs.readFileSync(path.join(__dirname, f), "utf8").matchAll(/push\("(LINT_[A-Z0-9_]+)"/g)].map(m => m[1])))];
    const miss = used.filter(c => !T.MSG[c + "_HINT"]);
    assert.deepStrictEqual(miss, [], "直し方の無い指摘: " + miss.join("、"));
  });
  test("説明資料の本文は英語にすると日本語が残らない（施設が付けた名前を除く）", () => {
    const rules = clone(real.rules), month = T.normalizeMonth(clone(real.month), rules);
    const P = new T.Problem(rules, month), asg = clone(real.result.asg);
    const strip = x => x.html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
    T.setLang("en"); const en = T.buildReport(P, asg, { status: "Optimal", seconds: 1 }).sections;
    T.setLang("ja"); const ja = T.buildReport(P, asg, { status: "Optimal", seconds: 1 }).sections;
    // 施設が決めた名前（役割・勤務帯）は訳さないので、それだけは残る
    const own = new Set([...T.normalizeRolesOf(rules).map(r => r.label), ...P.shifts.map(sh => sh.label)]);
    const left = [...new Set(en.flatMap(x => strip(x).match(/[ぁ-んァ-ン一-龥]+/g) || []))].filter(w => !own.has(w));
    assert.deepStrictEqual(left, [], "訳の無い日本語: " + left.join(" "));
    assert.notStrictEqual(strip(en[0]), strip(ja[0]), "日本語とは別の文面になる");
    assert(/主担当/.test(strip(en.find(x => x.id === "s5"))), "役割の名前はそのまま入る");
    // 完成した HTML（表題・第 11・12 節を含む）にも日本語が残らない
    T.setLang("en"); const html = T.reportHtml(P, asg, { status: "Optimal", seconds: 1 }, { label: "Draft", notes: "memo" }); T.setLang("ja");
    const leftAll = [...new Set(html.replace(/<style>[\s\S]*?<\/style>/, "").replace(/<[^>]+>/g, " ").match(/[ぁ-んァ-ン一-龥]+/g) || [])].filter(w => !own.has(w));
    assert.deepStrictEqual(leftAll, [], "完成した HTML に残る日本語: " + leftAll.join(" "));
    assert(/<html lang="en">/.test(html) && /11 Rationale/.test(html) && /Draft/.test(html) && /memo/.test(html));
  });
  test("画面のソースで T.t に渡している日本語は、すべて英語の訳がある（文面を足したら訳も足す）", () => {
    const miss = [], en = T.langData("en").ui;
    const files = fs.readdirSync(path.join(__dirname, "src")).filter(x => x.endsWith(".js")).concat(fs.readdirSync(path.join(__dirname, "src/rules")).filter(x => x.endsWith(".js")).map(x => "rules/" + x));
    for (const f of files) {
      const src = fs.readFileSync(path.join(__dirname, "src", f), "utf8");
      for (const m of src.matchAll(/(?:T\.t|\bt|\btx|\btv)\(\s*"((?:[^"\\]|\\.)*)"/g)) {
        const k = JSON.parse(`"${m[1]}"`);
        if (/[ぁ-んァ-ン一-龥]/.test(k) && !(k in en)) miss.push(`${f}: ${k}`);
      }
    }
    assert.deepStrictEqual(miss, [], "訳の無い文面:\n" + miss.join("\n"));
  });
  test("ヘルプは節（id）ごとに引き、訳の無い節は英語に落ちる", () => {
    const ja = T.langData("ja").help, en = T.langData("en").help;
    assert.deepStrictEqual(Object.keys(ja).sort(), Object.keys(en).sort(), "日本語と英語で節がそろっている");
    for (const [c, h] of [["ja", ja], ["en", en]]) for (const [id, b] of Object.entries(h)) assert(b.title && b.html, `${c} の ${id} に表題と中身がある`);
    T.registerLang({ code: "zz2", name: "T2", help: { about: { kind: "box", title: "ZZ about", html: "<p>zz</p>" } } });
    T.setLang("zz2");
    const list = T.help();
    assert.strictEqual(list.length, Object.keys(en).length, "節の数は英語と同じ");
    assert.strictEqual(list[0].title, "ZZ about", "訳した節はその言語");
    assert.strictEqual(list[1].title, en.requirements.title, "訳の無い節は英語");
    T.setLang("ja");
    assert(T.help().every(b => /[ぁ-んァ-ン一-龥]/.test(b.title)), "日本語は英語に落ちない");
    assert(/id="startLang"/.test(fs.readFileSync(path.join(__dirname, "src/index.html"), "utf8")), "開始画面に言語の選択がある");
  });
  test("規則の要約は設定から作られ、状態を変えると文も変わる", () => {
    const rules = clone(real.rules), month = T.normalizeMonth(clone(real.month), rules);
    const sum = P2 => T.rulesSummary(P2).map(g => `${g.head}\n${g.items.join("\n")}`).join("\n");
    const a = sum(new T.Problem(rules, month));
    assert(/施設の構成/.test(a) && /必ず守る規則/.test(a), "見出しが出る");
    assert(/目安 ±1 回/.test(a), "規則の設定値が入る: " + a.slice(0, 120));
    const r2 = clone(rules); r2.rule_states = Object.assign({}, r2.rule_states, { run_length_max: "hard" }); r2.run_length = { max: 4 };
    T.fillDefaultRules(r2);
    const b = sum(new T.Problem(r2, T.normalizeMonth(clone(real.month), r2)));
    assert(/4 日まで/.test(b), "規則を足すと文にも出る");
    assert(!/4 日まで/.test(a), "使っていない規則は「必ず守る規則」に出ない");
    T.setLang("en");
    const e = sum(new T.Problem(rules, T.normalizeMonth(clone(real.month), rules)));
    T.setLang("ja");
    assert(/Rules that must be met/.test(e) && /target ±1/.test(e), "英語でも出る: " + e.slice(0, 120));
  });
  console.log(`${passed} tests passed${process.exitCode ? "（失敗あり）" : ""}`);
})();

// 施設プロファイルの書き出し（app-settings.js の profileForExport）の検査。
// 共有用（名簿を含めない）は、名簿を役割と目安だけにして氏名を仮の名前に置き換え、氏名をキーにした個人別の条件を落とし、文の中に残った氏名を知らせる。
// 名簿込み（施設内の引き継ぎ用）は何も落とさない。どちらも元の設定を変えない。名前はすべて架空
const fs = require("fs"), vm = require("vm"), path = require("path"), assert = require("assert");
globalThis.location = { pathname: "/x/toban.html", protocol: "file:", href: "file:///x/toban.html" };
globalThis.document = { querySelector: () => null, querySelectorAll: () => [], addEventListener: () => { } }; globalThis.window = globalThis;
globalThis.localStorage = { getItem: () => null, setItem: () => { }, removeItem: () => { } };
globalThis.T = {};
for (const f of ["i18n.js", "rules-core.js", "model.js", "messages.js", "solver.js", "check.js", "app-core.js", "app-settings.js", "app-month.js"]) vm.runInThisContext(fs.readFileSync(path.join(__dirname, "src", f), "utf8"), { filename: f });
for (const f of fs.readdirSync(path.join(__dirname, "src/rules")).filter(x => x.endsWith(".js"))) vm.runInThisContext(fs.readFileSync(path.join(__dirname, "src/rules", f), "utf8"), { filename: "rules/" + f });
for (const q of fs.readdirSync(path.join(__dirname, "lang"))) T.registerLang(JSON.parse(fs.readFileSync(path.join(__dirname, "lang", q), "utf8")));
T.setLang("ja");
const A = T.app;
const rules = JSON.parse(fs.readFileSync(path.join(__dirname, "data/rules.json"), "utf8"));
T.DEFAULT_RULES = JSON.parse(JSON.stringify(rules));
// 架空の職員に個人属性・独自の欄・個人別の条件・文中の氏名を足す
rules.profile = { id: "sample", label: "Fictional Staff A担当の設定", roles: [{ id: "I", label: "主担当", refs: ["charge"] }, { id: "A", label: "副担当", refs: ["other"] }, { id: "Y", label: "若手", refs: ["junior"] }, { id: "C", label: "部長", refs: ["reserve"] }] };
rules.doctors = [
  { name: "Fictional Staff A", team: "I", years: 23, quota: 4, quals: ["manager"], local_note: "個人のメモ", share: 1 },
  { name: "Fictional Staff B", team: "A", years: 5, quota: 6, duty: "never" },
  { name: "Fictional Staff C", team: "Y", years: 1, quota: 7 },
];
rules.name_order = ["Fictional Staff C", "Fictional Staff A", "Fictional Staff B"];
rules.friday_night_min = { "Fictional Staff A": 1 };
rules.weekend_dayshift_wish = ["Fictional Staff B"];
rules.local_example = { by_name: { "Fictional Staff C": { max: 2 } }, pairs: [["Fictional Staff A", "Fictional Staff B"]] };
T.fillDefaultRules(rules);
Object.assign(A.state, { rules, month: { year: 2026, month: 11 }, result: null });
const before = JSON.stringify(rules);
const names = rules.doctors.map(d => d.name);

// 共有用
const ex = A.profileForExport(false), R = ex.rules, txt = JSON.stringify(R);
assert.deepStrictEqual(R.doctors.map(d => d.name), ["主担当1", "副担当1", "若手1"], "氏名は役割名＋番号");
assert.deepStrictEqual(Object.keys(R.doctors[0]).sort(), ["name", "quota", "share", "team"], "名簿は役割と目安だけ（年数・資格・独自の欄は落とす）");
assert.deepStrictEqual(Object.keys(R.doctors[1]).sort(), ["name", "quota", "team"], "当直の可否も落とす");
assert.deepStrictEqual(R.name_order, ["若手1", "主担当1", "副担当1"], "表示順は仮の名前で並びを保つ");
assert.deepStrictEqual(R.friday_night_min, {}, "氏名をキーにした個人別の条件は落とす");
assert.deepStrictEqual(R.weekend_dayshift_wish, ["副担当1"], "氏名の値は仮の名前に");
assert.deepStrictEqual(R.local_example, { by_name: {}, pairs: [["主担当1", "副担当1"]] }, "プラグインの項目でも同じ扱い");
assert.strictEqual(R.toban_profile.roster, "placeholder");
assert.deepStrictEqual(ex.leftover, ["Fictional Staff A"], "文の中に残った氏名（プロファイルの名前）を知らせる");
for (const n of names) if (n !== "Fictional Staff A") assert.ok(!txt.includes(n), `${n} は残らない`);
assert.ok(!txt.includes("23") || !txt.includes("manager"), "年数・資格が残らない");
assert.ok(!txt.includes("個人のメモ"));
// 名簿の外に氏名が無ければ leftover は空
{ const r2 = JSON.parse(before); r2.profile.label = "見本の施設"; Object.assign(A.state, { rules: r2 }); const e2 = A.profileForExport(false); assert.deepStrictEqual(e2.leftover, []); assert.ok(!JSON.stringify(e2.rules).includes("Fictional")); Object.assign(A.state, { rules }); }
// 名簿込み: 何も落とさない
const ex2 = A.profileForExport(true), R2 = ex2.rules;
assert.deepStrictEqual(R2.doctors, rules.doctors); assert.deepStrictEqual(R2.friday_night_min, rules.friday_night_min); assert.deepStrictEqual(R2.local_example, rules.local_example);
assert.strictEqual(R2.toban_profile.roster, "included"); assert.deepStrictEqual(ex2.leftover, []);
// 元の設定は変わらない
assert.strictEqual(JSON.stringify(A.state.rules), before, "元の設定を変えない");
assert.ok(!("toban_profile" in A.state.rules));
// 残存の警告の例外を無くす: 1 文字の氏名、引用符を含む氏名、キーの文中の氏名。名簿の外の個人の記録（name が氏名の要素）は落とす。プラグインの share で独自の形も除ける
{ const r3 = JSON.parse(before); r3.profile.label = "Q の担当する施設"; r3.doctors.push({ name: "Q", team: "Y", years: 2, quota: 3 }, { name: 'Fictional "A"', team: "Y", years: 3, quota: 3 });
  r3.local_example = { members: [{ name: "Fictional Staff A", years: 23, note: "個人の事情", max: 2 }, { kind: "x" }], by_text: { "Fictional Staff B担当": 1 }, memo: 'Fictional "A" は木曜不可', secret: { "Fictional Staff C": "秘" } };
  Object.assign(A.state, { rules: r3 });
  const e3 = A.profileForExport(false), t3 = JSON.stringify(e3.rules);
  assert.deepStrictEqual(e3.rules.local_example.members, [{ kind: "x" }], "name が氏名の要素は落とす"); assert.ok(!t3.includes("個人の事情"));
  assert.deepStrictEqual([...e3.leftover].sort(), ["Fictional \"A\"", "Fictional Staff B", "Q"].sort(), "1 文字・引用符入り・キーの文中の氏名も知らせる");
  const def = { id: "local.test.share", share(R) { delete R.local_example.secret; } }; T.RULE_DEFS.push(def);
  try { const e4 = A.profileForExport(false); assert.ok(!("secret" in e4.rules.local_example), "プラグインの share が独自の項目を除く"); } finally { T.RULE_DEFS.pop(); }
  // share が失敗したら書き出し全体を中止する（除けなかった個人の記録を残さない）。元の設定は変わらない
  const bad = { id: "local.test.badshare", share() { throw new Error("secret detail"); } }; T.RULE_DEFS.push(bad);
  try { const b0 = JSON.stringify(A.state.rules); assert.throws(() => A.profileForExport(false), e => /local\.test\.badshare/.test(e.message) && !/secret detail/.test(e.message), "失敗した規則の id を知らせ、詳細は出さない"); assert.strictEqual(JSON.stringify(A.state.rules), b0); } finally { T.RULE_DEFS.pop(); }
  Object.assign(A.state, { rules }); }
// 独自データの約束のフック: normalize（設定の補完・移行）、normalizeMonth（月の値）、rename（名簿の欄以外の人ごとのデータの改名）
{ const calls = []; const def = { id: "local.test.hooks", normalize(R) { calls.push("normalize"); (R.local_hooks ||= {}).max ??= 3; if (R.local_hooks.old !== undefined) { R.local_hooks.limit = R.local_hooks.old; delete R.local_hooks.old; } },
    normalizeMonth(m, R) { calls.push("normalizeMonth"); (m.local_hooks ||= {}).days ??= []; }, rename(R, m, o, n) { calls.push("rename"); const b = (R.local_hooks || {}).by_name; if (b && b[o] !== undefined) { b[n] = b[o]; delete b[o]; } } };
  T.RULE_DEFS.push(def);
  try { const r = JSON.parse(before); r.local_hooks = { old: 5, by_name: { "Fictional Staff A": 1 } }; T.fillDefaultRules(r); assert.deepStrictEqual(r.local_hooks, { max: 3, limit: 5, by_name: { "Fictional Staff A": 1 } }, "normalize が既定値の補完と旧形式の移行をする"); const j = JSON.stringify(r); T.fillDefaultRules(r); assert.strictEqual(JSON.stringify(r), j, "冪等");
    const m = T.normalizeMonth({ year: 2026, month: 11 }, r); assert.deepStrictEqual(m.local_hooks, { days: [] }, "normalizeMonth が月の値を補う");
    Object.assign(A.state, { rules: r, month: m, result: null, base: null }); A.renameDoctor("Fictional Staff A", "Fictional Staff Z"); assert.deepStrictEqual(r.local_hooks.by_name, { "Fictional Staff Z": 1 }, "rename が名簿の欄以外のデータを追随させる");
    assert.ok(calls.includes("normalize") && calls.includes("normalizeMonth") && calls.includes("rename")); } finally { T.RULE_DEFS.pop(); Object.assign(A.state, { rules }); } }
// フックが途中で失敗しても元のデータは壊れない（複製で試して成功時だけ採用）。失敗は入力チェック（LINT_PLUGIN_HOOK）が「その設定・その月そのもの」で毎回確かめて知らせ、改名は取り消される
{ const bad = { id: "local.test.badhook", api: 1, states: ["hard", "off"], def: "off", solve() { }, check() { }, penalty() { }, normalize(R) { delete R.local_bad.old_max; throw new Error("boom"); }, normalizeMonth(m) { if (m.local_bad && m.local_bad.old !== undefined) { delete m.local_bad.old; throw new Error("boom"); } }, rename(R, m, o, n) { delete R.local_bad.by_name[o]; throw new Error("boom"); } };
  T.RULE_DEFS.push(bad); T.RULE_BY_ID[bad.id] = bad;
  try { const r = JSON.parse(before); r.local_bad = { old_max: 1, by_name: { "Fictional Staff A": 1 } }; T.fillDefaultRules(r); assert.deepStrictEqual(r.local_bad, { old_max: 1, by_name: { "Fictional Staff A": 1 } }, "normalize が途中で失敗しても元のまま");
    const m = T.normalizeMonth({ year: 2026, month: 11, local_bad: { old: 2 } }, r); assert.deepStrictEqual(m.local_bad, { old: 2 }, "normalizeMonth も元のまま");
    const hooks = (R, mm) => T.lintPlugins(new T.Problem(R, mm)).filter(x => x.code === "LINT_PLUGIN_HOOK").map(x => x.args.hook).sort();
    assert.deepStrictEqual(hooks(r, m), ["normalize", "normalizeMonth"], "入力チェックが両方知らせる");
    // 同じ年月の別のデータ（統合で読んだ相手の月）の整形が成功しても、手元の月の判定は変わらない（対象そのもので毎回確かめる）
    const theirs = T.normalizeMonth({ year: 2026, month: 11, local_bad: {} }, r); assert.deepStrictEqual(theirs.local_bad, {}); assert.deepStrictEqual(hooks(r, m), ["normalize", "normalizeMonth"], "相手の月が通っても手元の失敗は残る");
    Object.assign(A.state, { rules: r, month: m, result: null, base: null }); const j = JSON.stringify(r) + JSON.stringify(m); const toasts = []; const t0 = A.toast; A.toast = x => toasts.push(String(x));
    assert.strictEqual(A.renameDoctor("Fictional Staff A", "Fictional Staff Z"), false, "追随に失敗したら改名しない"); assert.strictEqual(JSON.stringify(r) + JSON.stringify(m), j, "何も変えない"); assert.ok(/改名を取り消しました/.test(toasts.pop())); A.toast = t0;
    bad.normalize = R => { R.local_bad.max = R.local_bad.old_max; delete R.local_bad.old_max; }; T.fillDefaultRules(r); assert.deepStrictEqual(r.local_bad, { max: 1, by_name: { "Fictional Staff A": 1 } }, "直れば採用"); assert.deepStrictEqual(hooks(r, m), ["normalizeMonth"], "直った方は出ない");
    // フックを取り除いた版を同じ id で登録し直すと止まらない
    T.rules.register({ id: "local.test.badhook", api: 1, order: 998, group: "basic", label: "x", states: ["hard", "off"], def: "off", messages: { X: { en: "x" } }, solve() { }, check() { }, penalty() { } });
    assert.deepStrictEqual(hooks(r, m), [], "フックの無い版では止まらない"); }
  finally { T.rules.unregister("local.test.badhook"); const i = T.RULE_DEFS.indexOf(bad); if (i >= 0) T.RULE_DEFS.splice(i, 1); delete T.RULE_BY_ID[bad.id]; Object.assign(A.state, { rules }); } }
// 改名の取り消しは、名簿の読み戻し全体（欄の集計 friday_night_min・weekend_dayshift_wish も）に効く: 画面相当の行から readSettings を通す
{ const r = JSON.parse(before); r.rule_states.friday_night_min = "hard"; r.friday_night_min = { "Fictional Staff A": 1 }; r.weekend_dayshift_wish = ["Fictional Staff A"]; T.fillDefaultRules(r);
  const m = T.normalizeMonth({ year: 2026, month: 11 }, r); Object.assign(A.state, { rules: r, month: m, result: null, base: null });
  const bad = { id: "local.test.badrename", states: ["hard", "off"], def: "off", rename() { throw new Error("boom"); } }; T.RULE_DEFS.push(bad); T.RULE_BY_ID[bad.id] = bad;
  const rows = r.doctors.map((d, i) => { const vals = { name: i === 0 ? "Review New" : d.name, team: d.team, years: String(d.years || 0), quota: String(d.quota || 0), duty: d.duty || "" };
    return { dataset: { i: String(i) }, querySelector: sel => { const f = (sel.match(/data-f="([^"]+)"/) || [])[1]; if (f) return f in vals ? { value: vals[f] } : null; const col = (sel.match(/data-col="([^"]+)"/) || [])[1]; if (col === "fri") return { querySelector: () => ({ value: i === 0 ? "1" : "" }) }; if (col === "wkwish") return { querySelector: () => ({ checked: i === 0 }) }; return null; } }; });
  const q0 = document.querySelectorAll; document.querySelectorAll = sel => /#doctorTable tr\[data-i\]/.test(sel) ? rows : []; const toasts = []; const t0 = A.toast; A.toast = x => toasts.push(String(x)); A.renderHeader = () => { };
  try { A.readSettings(); } finally { document.querySelectorAll = q0; A.toast = t0; T.RULE_DEFS.pop(); delete T.RULE_BY_ID[bad.id]; }
  assert.strictEqual(r.doctors[0].name, "Fictional Staff A", "名簿の名前は戻る"); assert.ok(toasts.some(x => /改名を取り消しました/.test(x)));
  assert.deepStrictEqual(r.friday_night_min, { "Fictional Staff A": 1 }, "欄の集計も旧名のまま"); assert.ok(!JSON.stringify(r).includes("Review New"), "新しい名前はどこにも残らない: " + JSON.stringify(r).slice(0, 200));
  Object.assign(A.state, { rules }); }
// 名簿の読み戻し（画面相当の行）: 既存の職員と同じ氏名への改名は取り消す（別人の不可日を上書きしない）。成功したプラグインの追随（他の職員の属性）は読み戻しで消えない。「元に戻す」の範囲
{ const mkRows = (r, names, extra = {}) => r.doctors.map((d, i) => { const vals = { name: names[i] ?? d.name, team: d.team, years: String(d.years || 0), quota: String(d.quota || 0), duty: d.duty || "" };
    return { dataset: { i: String(i) }, querySelector: sel => { const f = (sel.match(/data-f="([^"]+)"/) || [])[1]; if (f) return f in vals ? { value: vals[f] } : null; return null; } }; });
  const withRows = (rows, fn) => { const q0 = document.querySelectorAll; document.querySelectorAll = sel => /#doctorTable tr\[data-i\]/.test(sel) ? rows : []; const toasts = []; const t0 = A.toast; A.toast = x => toasts.push(String(x)); A.renderHeader = () => { }; try { fn(toasts); } finally { document.querySelectorAll = q0; A.toast = t0; } };
  const A_ = "Fictional Staff A", B_ = "Fictional Staff B";
  // 既存の職員と同じ氏名へ
  { const r = JSON.parse(before); T.fillDefaultRules(r); const m = T.normalizeMonth({ year: 2026, month: 11, unavailable_night: { [A_]: [1], [B_]: [2] } }, r); Object.assign(A.state, { rules: r, month: m, result: null, base: null });
    withRows(mkRows(r, [B_]), toasts => { A.readSettings(); assert.ok(toasts.some(x => /重なる/.test(x)), "知らせる: " + toasts.join("|")); });
    assert.deepStrictEqual(r.doctors.map(d => d.name).slice(0, 2), [A_, B_], "改名は取り消される（重複しない）"); assert.deepStrictEqual(m.unavailable_night[A_], [1]); assert.deepStrictEqual(m.unavailable_night[B_], [2], "別人の不可日は残る");
    const dup = JSON.parse(before); dup.doctors[1].name = A_; T.fillDefaultRules(dup); assert.ok(T.lint(new T.Problem(dup, T.normalizeMonth({ year: 2026, month: 11 }, dup))).some(x => x.code === "LINT_NAME_DUP"), "重複した名簿は入力チェックが指摘"); }
  // 成功した追随を読み戻しで上書きしない（隠れた属性でも、表示中の独自欄でも）
  for (const shown of [false, true]) { const r = JSON.parse(before); r.doctors[1].local_mentor = A_; T.fillDefaultRules(r); const m = T.normalizeMonth({ year: 2026, month: 11, unavailable_night: { [A_]: [1] } }, r); Object.assign(A.state, { rules: r, month: m, result: null, base: null });
    const def = { id: "local.test.mentor", api: 1, states: ["hard", "off"], def: "off", solve() { }, check() { }, penalty() { }, rename(R, mm, o, n) { for (const d of R.doctors) if (d.local_mentor === o) d.local_mentor = n; },
      columns: shown ? [{ key: "mentor", label: "指導者", field: "local_mentor", when: () => true, render() { return ""; }, read(td, d) { const v = td.querySelector("[data-f=mentor]").value; if (v) d.local_mentor = v; }, rename(R, o, n) { for (const d of R.doctors) if (d.local_mentor === o) d.local_mentor = n; } }] : [] };
    T.RULE_DEFS.push(def); T.RULE_BY_ID[def.id] = def; r.rule_states[def.id] = "hard";
    const rows = mkRows(r, ["Fictional Staff Z"]); if (shown) for (const [i, row] of rows.entries()) { const q0 = row.querySelector; row.querySelector = sel => { const col = (sel.match(/data-col="([^"]+)"/) || [])[1]; if (col === "mentor") return { querySelector: () => ({ value: i === 1 ? A_ : "" }) }; return q0(sel); }; } // 画面に残る古い値（A）
    try { withRows(rows, () => A.readSettings()); } finally { T.RULE_DEFS.pop(); delete T.RULE_BY_ID[def.id]; }
    assert.strictEqual(A.state.rules.doctors[0].name, "Fictional Staff Z"); assert.strictEqual(A.state.rules.doctors[1].local_mentor, "Fictional Staff Z", (shown ? "表示中の欄でも" : "隠れた属性でも") + "他の職員の属性の追随が残る"); assert.deepStrictEqual(A.state.month.unavailable_night["Fictional Staff Z"], [1]); }

}
(async () => {
  const A_ = "Fictional Staff A";
  const mkRows = (r, names) => r.doctors.map((d, i) => { const vals = { name: names[i] ?? d.name, team: d.team, years: String(d.years || 0), quota: String(d.quota || 0), duty: d.duty || "" }; return { dataset: { i: String(i) }, querySelector: sel => { const f = (sel.match(/data-f="([^"]+)"/) || [])[1]; if (f) return f in vals ? { value: vals[f] } : null; return null; } }; });
  const withRows = (rows, fn) => { const q0 = document.querySelectorAll; document.querySelectorAll = sel => /#doctorTable tr\[data-i\]/.test(sel) ? rows : []; const toasts = []; const t0 = A.toast; A.toast = x => toasts.push(String(x)); A.renderHeader = () => { }; A.renderSettings = () => { }; try { fn(toasts); } finally { document.querySelectorAll = q0; A.toast = t0; } };
  // 改名 → 月別条件の編集 → 元に戻す: 設定だけ戻すと氏名の対応が壊れるので取り消しを拒み、何も変えない
  { const r = JSON.parse(before); T.fillDefaultRules(r); const m = T.normalizeMonth({ year: 2026, month: 11, unavailable_night: { [A_]: [5] } }, r); Object.assign(A.state, { rules: r, month: m, result: { asg: { "1:night": { work: A_, oc: [] } } }, base: null }); A.renderAll = () => { }; A.renderHeader = () => { };
    A.clearUndo(); A.pushUndo("名簿の変更"); withRows(mkRows(r, ["Fictional Staff Z"]), () => A.readSettings());
    await new Promise(res => setTimeout(res, 0)); A.state.month.notes = "後から書いたメモ"; const j = JSON.stringify([A.state.rules.doctors.map(d => d.name), A.state.month.unavailable_night, A.state.month.notes, A.state.result]);
    const toasts = []; const t0 = A.toast; A.toast = x => toasts.push(String(x)); A.undo(); A.toast = t0;
    assert.strictEqual(JSON.stringify([A.state.rules.doctors.map(d => d.name), A.state.month.unavailable_night, A.state.month.notes, A.state.result]), j, "何も変えない"); assert.ok(toasts.some(x => /取り消せません/.test(x)), toasts.join("|")); assert.deepStrictEqual(A.state.month.unavailable_night["Fictional Staff Z"], [5]); }
  // 複数行の改名で 1 件目が成功し 2 件目の適用（読んだ後）が失敗したら、名簿・月・結果・統合の基準をまとめて操作前に戻す
  { const r = JSON.parse(before); T.fillDefaultRules(r); const B_ = r.doctors[1].name; const m = T.normalizeMonth({ year: 2026, month: 11, unavailable_night: { [A_]: [5], [B_]: [6] } }, r);
    Object.assign(A.state, { rules: r, month: m, result: { asg: { "1:night": { work: A_, oc: [] }, "2:night": { work: B_, oc: [] } } }, base: { duty_days: { [A_]: {}, [B_]: {} } }, baseRules: null });
    let trial = 0; const def = { id: "local.test.secondfail", api: 1, states: ["hard", "off"], def: "off", solve() { }, check() { }, penalty() { }, rename(R, mm, o, n) { if (o === B_ && ++trial > 1) throw new Error("second apply fails"); } }; // B の試行は通り、読んだ後の適用で失敗する
    T.RULE_DEFS.push(def); T.RULE_BY_ID[def.id] = def; const j = JSON.stringify([A.state.rules.doctors.map(d => d.name), A.state.month.unavailable_night, A.state.result, A.state.base]);
    try { withRows(mkRows(r, ["Fictional Staff Z", "Fictional Staff Y"]), toasts => { A.readSettings(); assert.ok(toasts.some(x => /読み戻しを取り消しました/.test(x)), toasts.join("|")); }); } finally { T.RULE_DEFS.pop(); delete T.RULE_BY_ID[def.id]; }
    assert.strictEqual(JSON.stringify([A.state.rules.doctors.map(d => d.name), A.state.month.unavailable_night, A.state.result, A.state.base]), j, "1 件目の改名も含めて全部戻る"); }
  // ヘッダーの月選択から翌月を作る（空の月／引き継ぎ）と、前の月の取り消し履歴は消える
  for (const how of ["empty", "prev"]) { const r = JSON.parse(before); T.fillDefaultRules(r); Object.assign(A.state, { rules: r, month: T.normalizeMonth({ year: 2026, month: 11 }, r), result: null, base: null, meta: null });
    A.saveBeforeSwitch = async () => true; A.fsOK = () => false; A.dirHandle = null; A.storedHandle = null; A.choose = async () => how; A.showTab = () => { }; A.renderSettingsMonth = () => { }; A.renderAll = () => { }; A.renderHeader = () => { }; A.toast = () => { };
    A.clearUndo(); A.pushUndo("重みの変更"); A.state.rules.weights.wish_night = 999; await new Promise(res => setTimeout(res, 0));
    await A.onMonthChange(2026, 12); assert.strictEqual(A.state.month.month, 12, how); A.undo(); assert.strictEqual(A.state.rules.weights.wish_night, 999, `${how}: 前の月の履歴は使えない`); }
  // 元に戻す: 後から月別条件を触っていなければ月・結果も戻す。触っていれば設定だけ戻す。切替で履歴は消える
  { const r = JSON.parse(before); T.fillDefaultRules(r); const m = T.normalizeMonth({ year: 2026, month: 11 }, r); Object.assign(A.state, { rules: r, month: m, result: { asg: { a: 1 } }, base: null }); A.renderAll = () => { }; A.renderHeader = () => { }; A.toast = () => { };
    A.clearUndo(); A.pushUndo("試験"); A.state.rules.weights.wish_night = 999; A.state.month.notes = "変更の一部"; await new Promise(res => setTimeout(res, 0)); // 変更の直後の月が記録される
    A.undo(); assert.notStrictEqual(A.state.rules.weights.wish_night, 999, "設定が戻る"); assert.ok(!A.state.month.notes, "月も戻る"); assert.deepStrictEqual(A.state.result, { asg: { a: 1 } });
    A.pushUndo("試験2"); A.state.rules.weights.wish_night = 999; await new Promise(res => setTimeout(res, 0)); A.state.month.wishes.night_on[A_] = [17]; // 後から入れた希望
    A.undo(); assert.notStrictEqual(A.state.rules.weights.wish_night, 999); assert.deepStrictEqual(A.state.month.wishes.night_on[A_], [17], "後から入れた希望は消えない");
    A.pushUndo("試験3"); A.clearUndo(); const before3 = JSON.stringify(A.state.rules); A.undo(); assert.strictEqual(JSON.stringify(A.state.rules), before3, "履歴を捨てたら戻らない"); Object.assign(A.state, { rules }); }
})().then(() => { console.log("施設プロファイルの書き出し（共有用の匿名化・残存の警告・名簿外の記録・share・名簿込み・元データ非変更）と独自データのフック（normalize・normalizeMonth・rename。失敗時は元のまま）OK"); }).catch(e => { console.log("FAIL", e && e.stack || e); process.exit(1); });

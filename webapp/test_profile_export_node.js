// 施設プロファイルの書き出し（app-settings.js の profileForExport）の検査。
// 共有用（名簿を含めない）は、名簿を役割と目安だけにして氏名を仮の名前に置き換え、氏名をキーにした個人別の条件を落とし、文の中に残った氏名を知らせる。
// 名簿込み（施設内の引き継ぎ用）は何も落とさない。どちらも元の設定を変えない。名前はすべて架空
const fs = require("fs"), vm = require("vm"), path = require("path"), assert = require("assert");
globalThis.location = { pathname: "/x/toban.html", protocol: "file:", href: "file:///x/toban.html" };
globalThis.document = { querySelector: () => null, querySelectorAll: () => [], addEventListener: () => { } }; globalThis.window = globalThis;
globalThis.localStorage = { getItem: () => null, setItem: () => { }, removeItem: () => { } };
globalThis.T = {};
for (const f of ["i18n.js", "rules-core.js", "model.js", "messages.js", "solver.js", "check.js", "app-core.js", "app-folder.js", "app-settings.js", "app-month.js"]) vm.runInThisContext(fs.readFileSync(path.join(__dirname, "src", f), "utf8"), { filename: f });
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
  // 氏名を空（空白だけ）にした行: 名簿から外す操作ではなく入力不備。元の氏名に戻して知らせ、名簿・不可日・隠れた個人の条件・改名の記録は不変（空欄で読み飛ばすと、確認なしで名簿から消えて個人の条件だけが残る）
  for (const blank of ["", "   "]) { const r = JSON.parse(before); r.rule_states.friday_night_min = "off"; r.friday_night_min = { [A_]: 2 }; T.fillDefaultRules(r); const m = T.normalizeMonth({ year: 2026, month: 11, unavailable_night: { [A_]: [1], [B_]: [2] } }, r); Object.assign(A.state, { rules: r, month: m, result: null, base: null, renames: [] });
    const n0 = r.doctors.length, snap = JSON.stringify([r.doctors.map(d => d.name), m.unavailable_night, r.friday_night_min]);
    withRows(mkRows(r, [blank]), toasts => { A.readSettings(); assert.ok(toasts.some(x => /空にできません/.test(x)), "知らせる: " + toasts.join("|")); });
    assert.strictEqual(A.state.rules.doctors.length, n0, "名簿から消えない"); assert.strictEqual(JSON.stringify([A.state.rules.doctors.map(d => d.name), A.state.month.unavailable_night, A.state.rules.friday_night_min]), snap, "名簿・不可日・隠れた条件は不変"); assert.deepStrictEqual(A.state.renames, [], "改名・削除の記録なし"); }
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
  // プラグインが欠けている間は改名を確定しない（欠けたプラグインの独自データを追随させられない）
  { const r = JSON.parse(before); T.fillDefaultRules(r); r.rule_states["local.review.missing"] = "hard"; const m = T.normalizeMonth({ year: 2026, month: 11, unavailable_night: { [A_]: [5] } }, r); Object.assign(A.state, { rules: r, month: m, result: null, base: null });
    withRows(mkRows(r, ["Fictional Staff Z"]), toasts => { A.readSettings(); assert.ok(toasts.some(x => /氏名を変えられません/.test(x)), toasts.join("|")); });
    assert.strictEqual(A.state.rules.doctors[0].name, A_, "改名されない"); assert.deepStrictEqual(A.state.month.unavailable_night[A_], [5], "月データも不変"); assert.ok(!JSON.stringify(A.state.month).includes("Fictional Staff Z")); }
  // 「なし」にしてある施設のプラグインの規則が登録に無いときも改名しない（plugins_used が無い未計算の月でも）。戻せば改名でき、独自条件も追随する。本体の古い id や登録済みの「なし」の規則は妨げない
  { const r = JSON.parse(before); T.fillDefaultRules(r); r.rule_states["local.review.no_night"] = "off"; r.local_review = { no_night: { [A_]: true } }; r.rule_states["same_day_IA"] = "off"; // 後者は本体から外れた古い id（妨げない）
    const m = T.normalizeMonth({ year: 2026, month: 11, fixed: { night: { 3: A_ } } }, r); delete m.plugins_used; Object.assign(A.state, { rules: r, month: m, result: null, base: null });
    withRows(mkRows(r, ["Fictional Staff Z"]), toasts => { A.readSettings(); assert.ok(toasts.some(x => /氏名を変えられません/.test(x)), "欠けていれば断る: " + toasts.join("|")); });
    assert.strictEqual(A.state.rules.doctors[0].name, A_); assert.deepStrictEqual(A.state.rules.local_review.no_night, { [A_]: true });
    const def = { id: "local.review.no_night", api: 1, states: ["hard", "off"], def: "off", solve() { }, check() { }, penalty() { }, rename(R, mm, o, n) { const t = (R.local_review || {}).no_night; if (t && t[o] !== undefined) { t[n] = t[o]; delete t[o]; } } }; T.rules.register(def);
    try { withRows(mkRows(r, ["Fictional Staff Z"]), toasts => { A.readSettings(); assert.ok(!toasts.some(x => /氏名を変えられません/.test(x)), "戻せば改名できる"); }); } finally { T.rules.unregister(def.id); }
    assert.strictEqual(A.state.rules.doctors[0].name, "Fictional Staff Z"); assert.deepStrictEqual(A.state.rules.local_review.no_night, { "Fictional Staff Z": true }, "独自条件も追随"); assert.strictEqual(A.state.month.fixed.night[3], "Fictional Staff Z");
    const r2 = JSON.parse(before); T.fillDefaultRules(r2); r2.rule_states["same_day_IA"] = "off"; r2.rule_states.friday_night_min = "off"; Object.assign(A.state, { rules: r2, month: T.normalizeMonth({ year: 2026, month: 11 }, r2), result: null, base: null });
    withRows(mkRows(r2, ["Fictional Staff Z"]), toasts => { A.readSettings(); assert.ok(!toasts.some(x => /氏名を変えられません/.test(x)), "本体の古い id や登録済みの「なし」は妨げない: " + toasts.join("|")); }); assert.strictEqual(A.state.rules.doctors[0].name, "Fictional Staff Z"); }
  // 前月の取り込み: 未接続から始めても 1 回で完了する（自分の接続は切替と見なさない）
  { const r = JSON.parse(before); T.fillDefaultRules(r); const nov = T.normalizeMonth({ year: 2026, month: 11 }, r); Object.assign(A.state, { rules: r, month: nov, result: null, base: null }); A.dirHandle = null;
    A.ensureFolder = async () => { A.dirHandle = { name: "x" }; A.dirGen++; return true; }; A.refreshMonths = async () => { }; A.findMonthData = async () => ({ data: { month: T.normalizeMonth({ year: 2026, month: 10, history: { work_balance: { [A_]: 1 } } }, r), rules: r, result: null }, where: "x" });
    A.readAll = () => { }; A.renderSettingsMonth = () => { }; A.renderDoctor = () => { }; A.renderFixed = () => { }; A.renderAll = () => { }; A.renderHeader = () => { }; A.save = () => { }; const toasts = []; A.toast = x => toasts.push(String(x));
    await A.importPrevious(); assert.ok(toasts.some(x => /取り込みました/.test(x)) && !toasts.some(x => /中止/.test(x)), "1 回で完了: " + toasts.join("|")); A.dirHandle = null; }
  // 前月の取り込み: 読み取りの間に月が切り替わったら適用しない
  { const r = JSON.parse(before); T.fillDefaultRules(r); const nov = T.normalizeMonth({ year: 2026, month: 11 }, r), dec = T.normalizeMonth({ year: 2026, month: 12, history: { work_balance: { [A_]: 9 } } }, r); Object.assign(A.state, { rules: r, month: nov, result: null, base: null });
    let release; const gate = new Promise(res => { release = res; }); A.dirHandle = { name: "x" }; A.ensureFolder = async () => true; A.refreshMonths = async () => { }; A.findMonthData = async () => { await gate; return { data: { month: T.normalizeMonth({ year: 2026, month: 10, history: { work_balance: { [A_]: 1 } } }, r), rules: r, result: null }, where: "x" }; };
    A.readAll = () => { }; A.renderSettingsMonth = () => { }; A.renderDoctor = () => { }; A.renderFixed = () => { }; A.renderAll = () => { }; A.renderHeader = () => { }; A.save = () => { }; const toasts = []; A.toast = x => toasts.push(String(x));
    const p = A.importPrevious(); await new Promise(res => setTimeout(res, 10)); A.state.month = dec; // 読み取り中に 12 月へ
    release(); await p; assert.deepStrictEqual(A.state.month.history.work_balance, { [A_]: 9 }, "切替先の履歴を上書きしない"); assert.ok(toasts.some(x => /取り込みを中止/.test(x)), toasts.join("|")); A.dirHandle = null; }
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
  // 共有用の書き出し: 施設のプラグインが欠けている間は断る（欠けた規則が共有から除くはずの個人の記録を除けない）。名簿込みは断らない。登録すれば書き出せて、share が除く
  { const r = JSON.parse(before); T.fillDefaultRules(r); r.rule_states["local.review.secret"] = "hard"; r.local_review = { secret: { [A_]: "個人の記録" } }; Object.assign(A.state, { rules: r, month: T.normalizeMonth({ year: 2026, month: 11 }, r), result: null, base: null });
    assert.throws(() => A.profileForExport(false), /共有用の書き出しができません/, "欠けている間は共有用を断る"); assert.ok(A.profileForExport(true).rules.local_review.secret[A_], "名簿込みは断らない");
    const def = { id: "local.review.secret", api: 1, states: ["hard", "off"], def: "hard", solve() { }, check() { }, penalty() { }, share(R) { delete R.local_review; } }; T.rules.register(def);
    try { const ex2 = A.profileForExport(false); assert.ok(!ex2.rules.local_review, "登録すれば書き出せ、share が除く"); assert.ok(!JSON.stringify(ex2).includes("個人の記録")); } finally { T.rules.unregister(def.id); }
    assert.ok(A.state.rules.local_review.secret[A_], "元の設定は変えない"); }
  // 名簿から外した人: 設定の側の人ごとの項目（氏名のキー・氏名の配列要素・name が氏名の要素。プラグインの項目も）を外す。文の中の氏名は触らない
  { const r = JSON.parse(before); T.fillDefaultRules(r); const gone = "Fictional Removed Person";
    r.friday_night_min = { [A_]: 1, [gone]: 2 }; r.weekend_dayshift_wish = ["Fictional Staff B", gone]; r.name_order = r.name_order.concat([gone]); r.local_example = { by_name: { [gone]: { max: 1 } }, members: [{ name: gone, note: "x" }, { name: A_ }], memo: gone + " の件" };
    const c = T.purgeRulesNames(r, [gone]); assert.strictEqual(c, 5, "5 件"); assert.deepStrictEqual(r.friday_night_min, { [A_]: 1 }); assert.deepStrictEqual(r.weekend_dayshift_wish, ["Fictional Staff B"]); assert.ok(!r.name_order.includes(gone)); assert.deepStrictEqual(r.local_example.by_name, {}); assert.deepStrictEqual(r.local_example.members, [{ name: A_ }]);
    assert.strictEqual(r.local_example.memo, gone + " の件", "文の中の氏名は触らない"); assert.strictEqual(r.doctors.length, 3, "名簿は触らない"); }
  // 共有用の書き出し: 以前に名簿から外した人の条件が、隠れた規則（「なし」）の名簿の欄の項目に残っている保存データでも、氏名と条件を出さない（いまの名簿の氏名との一致に頼らない）。元の設定は変えない
  { const r = JSON.parse(before); T.fillDefaultRules(r); const gone = "Fictional Removed Person"; r.rule_states.friday_night_min = "off"; r.rule_states.wish_weekend_dayshift = "off";
    r.friday_night_min = { [gone]: 2 }; r.weekend_dayshift_wish = ["Fictional Staff B", gone]; delete r.local_example; r.profile.label = "試験の設定";
    Object.assign(A.state, { rules: r, month: T.normalizeMonth({ year: 2026, month: 11 }, r), result: null, base: null }); const snap = JSON.stringify(r);
    const ex2 = A.profileForExport(false), txt2 = JSON.stringify(ex2.rules); assert.ok(!txt2.includes(gone), "外した人の氏名が残らない"); assert.deepStrictEqual(ex2.rules.friday_night_min, {}, "条件も残らない"); assert.deepStrictEqual(ex2.rules.weekend_dayshift_wish, ["副担当1"], "いまの名簿の人は仮の名前で残る");
    assert.strictEqual(JSON.stringify(A.state.rules), snap, "元の設定は変えない"); assert.deepStrictEqual(A.profileForExport(true).rules.friday_night_min, { [gone]: 2 }, "名簿込みは何も落とさない"); }
  // 月の変換フックに渡す設定は複製: フックが設定を書き換えても（途中で失敗しても、成功しても）実物の設定は変わらない。入力チェックだけでも変わらない
  { const r = JSON.parse(before); T.fillDefaultRules(r); r.local_review = { legacy_days: [2, 4] };
    const bad = { id: "local.review.legacy", api: 1, states: ["hard", "off"], def: "off", solve() { }, check() { }, penalty() { }, normalizeMonth(m, R) { const v = R.local_review.legacy_days; delete R.local_review.legacy_days; m.local_days = v; throw new Error("fixture hook failed"); } }; T.rules.register(bad);
    try { const m = T.normalizeMonth({ year: 2026, month: 11 }, r); assert.deepStrictEqual(r.local_review.legacy_days, [2, 4], "失敗しても設定は変わらない"); assert.strictEqual(m.local_days, undefined, "月の変更は採用されない");
      const hc = T.hookCheck(r, m); assert.ok(hc.some(x => x.id === bad.id && x.hook === "normalizeMonth")); assert.deepStrictEqual(r.local_review.legacy_days, [2, 4], "検査だけでも変わらない");
      T.lintPlugins(new T.Problem(r, m)); assert.deepStrictEqual(r.local_review.legacy_days, [2, 4], "入力チェックでも変わらない"); } finally { T.rules.unregister(bad.id); }
    const good = { id: "local.review.legacy", api: 1, states: ["hard", "off"], def: "off", solve() { }, check() { }, penalty() { }, normalizeMonth(m, R) { if (m.local_days === undefined) m.local_days = (R.local_review.legacy_days || []).slice(); delete R.local_review.legacy_days; } }; T.rules.register(good);
    try { const m = T.normalizeMonth({ year: 2026, month: 11 }, r); assert.deepStrictEqual(m.local_days, [2, 4], "月の変更は採用"); assert.deepStrictEqual(r.local_review.legacy_days, [2, 4], "設定は読むだけ（移行は normalize で）"); } finally { T.rules.unregister(good.id); } }
  // 月の切替: 状態を置き換える直前にもう一度、未保存の確認をする（読み取り・選択を待つ間の入力を無確認で失わない）。保存できずにやめたら元の月のまま
  { const r = JSON.parse(before); T.fillDefaultRules(r); const mk = () => Object.assign(A.state, { rules: r, month: T.normalizeMonth({ year: 2026, month: 11, notes: "nov" }, r), result: null, base: null, meta: null });
    A.showTab = () => { }; A.renderAll = () => { }; A.renderSettingsMonth = () => { }; A.save = () => { }; A.toast = () => { }; A.fsOK = () => false; A.storedHandle = null; A.dirHandle = null;
    let calls = 0, answers = [true, false]; A.saveBeforeSwitch = async () => answers[calls++]; A.choose = async () => { A.state.month.notes = "typed-while-choosing"; return "empty"; };
    mk(); await A.onMonthChange(2026, 12); assert.strictEqual(calls, 2, "置き換えの直前にもう一度確認"); assert.strictEqual(+A.state.month.month, 11, "保存できずにやめたら元の月のまま"); assert.strictEqual(A.state.month.notes, "typed-while-choosing", "待つ間の入力も残る");
    calls = 0; answers = [true, true]; mk(); await A.onMonthChange(2026, 12); assert.strictEqual(calls, 2); assert.strictEqual(+A.state.month.month, 12, "確認が通れば切り替わる");
    // フォルダに保存データがある月を開く分岐も同じ
    calls = 0; answers = [true, false]; mk(); A.dirHandle = { name: "x" }; A.refreshMonths = async () => { }; A.monthDirs = []; A.findMonthData = async () => ({ data: { month: { year: 2026, month: 12, notes: "dec" }, rules: r, result: null }, where: "x", tried: [] }); let applied = 0; A.applyLoaded = () => { applied++; }; A.choose = async () => "open";
    await A.onMonthChange(2026, 12); assert.strictEqual(calls, 2); assert.strictEqual(applied, 0, "確認が通らなければ開かない"); calls = 0; answers = [true, true]; await A.onMonthChange(2026, 12); assert.strictEqual(applied, 1); A.dirHandle = null; }
  // 月の切替: フォルダの読取りの間に接続先が替わっていたら、古い読取結果を捨てる（前のフォルダのデータを今のフォルダの月として開かない）
  { const r = JSON.parse(before); T.fillDefaultRules(r); Object.assign(A.state, { rules: r, month: T.normalizeMonth({ year: 2026, month: 11, notes: "nov" }, r), result: null, base: null, meta: null });
    A.showTab = () => { }; A.renderAll = () => { }; A.renderSettingsMonth = () => { }; A.renderHeader = () => { }; A.save = () => { }; const toasts = []; A.toast = x => toasts.push(String(x)); A.fsOK = () => true; A.storedHandle = null; A.dirHandle = { name: "A" }; A.monthDirs = [];
    A.saveBeforeSwitch = async () => true; A.refreshMonths = async () => { }; let applied = 0, asked = 0; A.applyLoaded = () => { applied++; }; A.choose = async () => { asked++; return "open"; };
    A.findMonthData = async () => { A.dirHandle = { name: "B" }; A.dirGen++; return { data: { month: { year: 2026, month: 12, notes: "december-from-A" }, rules: r, result: null }, where: "x", tried: [] }; };
    await A.onMonthChange(2026, 12); assert.strictEqual(applied, 0, "古い読取結果は当てない"); assert.strictEqual(asked, 0, "確認も出さない"); assert.ok(toasts.some(x => /月の切替を中止しました/.test(x)), toasts.join("|")); assert.strictEqual(+A.state.month.month, 11); A.dirHandle = null; }
  // 改名の記録は、同期したときの名簿にいた人の改名だけ: 設定の読み戻しを通して、A を Z に改名し、足した人（初期の氏名「新規」）を A に、もう 1 人を Q にしても、記録は A→Z だけ
  { const r = JSON.parse(before); T.fillDefaultRules(r); Object.assign(A.state, { rules: r, month: T.normalizeMonth({ year: 2026, month: 11, unavailable_night: { [A_]: [5] } }, r), result: null, base: null, meta: null, renames: [] }); A.renderHeader = () => { }; A.markSaved(undefined, "2026-10-01T00:00:00Z");
    const names = () => A.state.rules.doctors.map(d => d.name), setNames = list => withRows(mkRows(A.state.rules, list), toasts => { A.readSettings(); assert.ok(!toasts.some(x => /変えられません|重なる/.test(x)), toasts.join("|")); });
    const eff = () => T.effectiveRenames(A.state.renames, A.state.baseRules.doctors.map(d => d.name)); setNames(["Fictional Staff Z"]); assert.deepStrictEqual(eff(), [[A_, "Fictional Staff Z"]]);
    A.state.rules.doctors.push({ name: "新規", team: "I", quota: 0 }); setNames(names().map(n => n === "新規" ? A_ : n)); A.state.rules.doctors.push({ name: "新規", team: "I", quota: 0 }); setNames(names().map(n => n === "新規" ? "Fictional Staff Q" : n));
    assert.deepStrictEqual(names().slice(-2), [A_, "Fictional Staff Q"]); assert.deepStrictEqual(eff(), [[A_, "Fictional Staff Z"]], "統合で使う対応は、同期したときの名簿にいた人の改名だけ（足した人の氏名の変更は入らない）"); assert.deepStrictEqual(A.state.month.unavailable_night["Fictional Staff Z"], [5]); A.state.renames = []; }
  // 前月の取り込み: 別の施設のデータは無確認で混ぜない（やめれば履歴・固定は変わらない。分かったうえで取り込むこともできる）
  { const r = JSON.parse(before); T.fillDefaultRules(r); r.profile.id = "fictional-facility-A"; const rB = JSON.parse(JSON.stringify(r)); rB.profile.id = "fictional-facility-B";
    const mk = () => Object.assign(A.state, { rules: r, month: T.normalizeMonth({ year: 2026, month: 12, profile_id: "fictional-facility-A", history: { work_balance: { [A_]: 1 } } }, r), result: null, base: null });
    A.dirHandle = { name: "x" }; A.refreshMonths = async () => { }; A.findMonthData = async () => ({ data: { month: T.normalizeMonth({ year: 2026, month: 11, profile_id: "fictional-facility-B", history: { work_balance: { [A_]: 17 } }, fixed: { night: { 31: A_ } } }, rB), rules: rB, result: null }, where: "x", tried: [] });
    A.readAll = () => { }; A.renderSettingsMonth = () => { }; A.renderDoctor = () => { }; A.renderFixed = () => { }; A.save = () => { }; const toasts = []; A.toast = x => toasts.push(String(x)); let asked = 0, ans = null; A.choose = async q => { asked++; assert.ok(/別の施設/.test(String(q))); return ans; };
    mk(); await A.importPrevious(); assert.strictEqual(asked, 1, "確認を出す"); assert.deepStrictEqual(A.state.month.history.work_balance, { [A_]: 1 }, "やめれば履歴は変わらない"); assert.ok(!(A.state.month.fixed.night || {})[1], "固定も入らない"); assert.ok(toasts.some(x => /やめました/.test(x)));
    ans = "go"; asked = 0; mk(); await A.importPrevious(); assert.strictEqual(asked, 1); assert.strictEqual(A.state.month.history.work_balance[A_], 17, "分かったうえでなら取り込む"); assert.strictEqual(A.state.month.fixed.night[1], A_);
    // 同じ施設なら確認なし
    asked = 0; A.findMonthData = async () => ({ data: { month: T.normalizeMonth({ year: 2026, month: 11, profile_id: "fictional-facility-A", history: { work_balance: { [A_]: 5 } } }, r), rules: r, result: null }, where: "x", tried: [] }); mk(); await A.importPrevious(); assert.strictEqual(asked, 0, "同じ施設は確認なし"); assert.strictEqual(A.state.month.history.work_balance[A_], 5); A.dirHandle = null; }
  // 翌月 1 日欄の固定の引き継ぎ: 勤務者・OC に加えて、固定の印と「OC なし」も当月 1 日へ移る（配列は複製）
  { const r = JSON.parse(before); T.fillDefaultRules(r); Object.assign(A.state, { rules: r, month: T.normalizeMonth({ year: 2026, month: 11 }, r), result: null, base: null });
    const prevM = T.normalizeMonth({ year: 2026, month: 11, fixed: { night: { 31: A_, 7: A_ }, night_oc_none: { 31: ["Y"], 7: ["Y"] } }, fixed_tags: { ["31:night|" + A_]: "公開試験研修", ["7:night|" + A_]: "別の印", "31:day|Fictional Staff B": "固定の無い印" } }, r), prev = { rules: r, month: prevM, result: null };
    const dec = A.fromPrevious(prev, 2026, 12); assert.strictEqual(dec.fixed.night[1], A_); assert.deepStrictEqual(dec.fixed.night_oc_none[1], ["Y"], "「OC なし」も移る"); assert.deepStrictEqual(dec.fixed_tags, { ["1:night|" + A_]: "公開試験研修" }, "印は引き継いだ固定の分だけ、日付を 1 日へ");
    dec.fixed.night_oc_none[1].push("X"); assert.deepStrictEqual(prevM.fixed.night_oc_none[31], ["Y"], "配列は複製"); assert.ok(!dec.fixed.night[7], "ほかの日の固定は引き継がない"); }
  // 前月の取り込み日数: work_gap（中 2 日）を使う施設は前月末の 3 日を取り込む（31 日・30 日・2 月末とも末尾から 3 日）。29 日勤務 → 30・31 休み → 翌月 1 日勤務が「中 2 日」1 組として減点に入る（前は 2 日しか取り込まず、解く側と減点側が同時に 29 日の記録を失っていた）
  { const r = JSON.parse(before); T.fillDefaultRules(r); r.rule_states.work_gap = "soft"; r.rule_states.run_length_max = "off"; r.rule_states.run_length_min = "off"; r.rule_states.shift_run_max = "off"; const B_ = "Fictional Staff B", C_ = "Fictional Staff C";
    for (const [y, mo, N] of [[2026, 10, 31], [2026, 11, 30], [2028, 2, 29], [2027, 2, 28]]) { Object.assign(A.state, { rules: r, month: T.normalizeMonth({ year: y, month: mo }, r), result: null, base: null });
      const asg = {}; const pm = T.normalizeMonth({ year: y, month: mo }, r), P = new T.Problem(r, pm); for (const sl of P.slots) asg[`${sl[0]}:${sl[1]}`] = { work: sl[0] === N - 2 ? A_ : sl[0] % 2 ? B_ : C_, oc: [] }; // 29 日（末尾から 3 日目）だけ A が勤務
      const next = A.fromPrevious({ rules: r, month: pm, result: { asg, status: "Optimal" } }); assert.deepStrictEqual(next.prev_month.last_days.map(e => e.date), [N - 2, N - 1, N], `${y}/${mo}: 末尾から 3 日`); assert.strictEqual([].concat(next.prev_month.last_days[0].night).includes(A_) || [].concat(next.prev_month.last_days[0].day || []).includes(A_), true, "29 日の勤務者が入る");
      next.fixed.night[1] = A_; const P2 = new T.Problem(r, next), a2 = {}; for (const sl of P2.slots) a2[`${sl[0]}:${sl[1]}`] = { work: sl[0] === 1 && sl[1] === "night" ? A_ : sl[0] % 2 ? B_ : C_, oc: [] }; const it = T.penalty(P2, a2).items || T.penalty(P2, a2);
      assert.strictEqual(it.work_gap_2, (1 + N % 2) * r.weights.work_gap_2, `${y}/${mo}: A の末尾から 3 日目 → 翌月 1 日が中 2 日 1 組（月の日数が奇数なら B の前月末 → 3 日の 1 組も。末尾の 3 日目を取り込まなければ A の分が無い）: ` + JSON.stringify(it)); } }
  // 「前月のデータから作成」の型検査: {"month":{}}（年月なし）・有効な年月＋名簿の要素に氏名なし → 知らせて、設定・月・結果・同期の基準・改名の記録は不変（NaN 年 NaN 月や氏名なし 1 名の名簿に置き換えない）
  { const r = JSON.parse(before); T.fillDefaultRules(r); const m = T.normalizeMonth({ year: 2026, month: 11, notes: "keep" }, r); Object.assign(A.state, { rules: r, month: m, result: { asg: { "1:night": { work: A_, oc: [] } } }, base: null, baseRules: null, renames: [[A_, "Review Dr Z"]] }); A.dirHandle = null; A.markSaved("ダウンロード", "2026-10-01T00:00:00Z"); A.state.renames = [[A_, "Review Dr Z"]];
    const snap = () => JSON.stringify([A.state.rules, A.state.month, A.state.result, A.state.meta, A.state.base, A.state.renames]), before0 = snap(), alerts = [], a0 = globalThis.alert; globalThis.alert = x => alerts.push(String(x)); A.save = () => { }; A.showTab = () => { }; A.renderAll = () => { }; A.clearUndo = () => { };
    const bad = [{ month: {} }, { month: { year: 2026, month: 10 }, rules: { doctors: [{}] } }, { month: { year: 2026, month: 10 }, rules: { doctors: [null] } }, { month: { year: 2026, month: 10 }, rules: { doctors: "x" } }, "text", null, [1]];
    for (const o of bad) { await A.createFromPrevFile({ text: async () => JSON.stringify(o) }); assert.strictEqual(snap(), before0, "不変: " + JSON.stringify(o)); assert.strictEqual(A.tag(), "202611"); }
    assert.strictEqual(alerts.length, bad.length, "知らせる: " + alerts.join("|")); globalThis.alert = a0;
    await A.createFromPrevFile({ text: async () => JSON.stringify({ month: { year: 2026, month: 10 }, rules: r }) }); assert.strictEqual(A.tag(), "202611", "正常な前月からは作れる（10 月 → 11 月）"); assert.notStrictEqual(A.state.month.notes, "keep", "新しい月（前月の取り込みの注記が入る）"); assert.deepStrictEqual(A.state.renames, []); }
})().then(() => { console.log("施設プロファイルの書き出し（共有用の匿名化・残存の警告・名簿外の記録・share・名簿込み・元データ非変更）と独自データのフック（normalize・normalizeMonth・rename。失敗時は元のまま）OK"); }).catch(e => { console.log("FAIL", e && e.stack || e); process.exit(1); });

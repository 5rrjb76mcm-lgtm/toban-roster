// 施設プロファイルの書き出し（app-settings.js の profileForExport）の検査。
// 共有用（名簿を含めない）は、名簿を役割と目安だけにして氏名を仮の名前に置き換え、氏名をキーにした個人別の条件を落とし、文の中に残った氏名を知らせる。
// 名簿込み（施設内の引き継ぎ用）は何も落とさない。どちらも元の設定を変えない。名前はすべて架空
const fs = require("fs"), vm = require("vm"), path = require("path"), assert = require("assert");
globalThis.location = { pathname: "/x/toban.html", protocol: "file:", href: "file:///x/toban.html" };
globalThis.document = { querySelector: () => null, querySelectorAll: () => [], addEventListener: () => { } }; globalThis.window = globalThis;
globalThis.localStorage = { getItem: () => null, setItem: () => { }, removeItem: () => { } };
globalThis.T = {};
for (const f of ["i18n.js", "rules-core.js", "model.js", "messages.js", "solver.js", "check.js", "app-core.js", "app-settings.js"]) vm.runInThisContext(fs.readFileSync(path.join(__dirname, "src", f), "utf8"), { filename: f });
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
// フックが途中で失敗しても元のデータは壊れない（複製で試して成功時だけ採用）。失敗は入力チェック（LINT_PLUGIN_HOOK）が知らせ、改名は取り消される
{ const bad = { id: "local.test.badhook", states: ["hard", "off"], def: "off", normalize(R) { delete R.local_bad.old_max; throw new Error("boom"); }, normalizeMonth(m) { delete m.local_bad.old; throw new Error("boom"); }, rename(R, m, o, n) { delete R.local_bad.by_name[o]; throw new Error("boom"); } };
  T.RULE_DEFS.push(bad); T.RULE_BY_ID[bad.id] = bad;
  try { const r = JSON.parse(before); r.local_bad = { old_max: 1, by_name: { "Fictional Staff A": 1 } }; T.fillDefaultRules(r); assert.deepStrictEqual(r.local_bad, { old_max: 1, by_name: { "Fictional Staff A": 1 } }, "normalize が途中で失敗しても元のまま");
    const m = T.normalizeMonth({ year: 2026, month: 11, local_bad: { old: 2 } }, r); assert.deepStrictEqual(m.local_bad, { old: 2 }, "normalizeMonth も元のまま");
    assert.ok(T.hookErrors.get("local.test.badhook:normalize") && T.hookErrors.get("local.test.badhook:normalizeMonth"), "失敗を記録");
    const pl = T.lintPlugins(new T.Problem(r, m)); assert.ok(pl.filter(x => x.code === "LINT_PLUGIN_HOOK").length === 2, "入力チェックが知らせる: " + pl.map(x => x.code).join(","));
    Object.assign(A.state, { rules: r, month: m, result: null, base: null }); const j = JSON.stringify(r) + JSON.stringify(m); const toasts = []; const t0 = A.toast; A.toast = x => toasts.push(String(x));
    assert.strictEqual(A.renameDoctor("Fictional Staff A", "Fictional Staff Z"), false, "追随に失敗したら改名しない"); assert.strictEqual(JSON.stringify(r) + JSON.stringify(m), j, "何も変えない"); assert.ok(/改名を取り消しました/.test(toasts.pop())); A.toast = t0;
    bad.normalize = R => { R.local_bad.max = R.local_bad.old_max; delete R.local_bad.old_max; }; T.fillDefaultRules(r); assert.deepStrictEqual(r.local_bad, { max: 1, by_name: { "Fictional Staff A": 1 } }, "直れば採用"); assert.ok(!T.hookErrors.has("local.test.badhook:normalize"), "成功で消える"); }
  finally { T.RULE_DEFS.pop(); delete T.RULE_BY_ID[bad.id]; T.hookErrors.clear(); Object.assign(A.state, { rules }); } }
console.log("施設プロファイルの書き出し（共有用の匿名化・残存の警告・名簿外の記録・share・名簿込み・元データ非変更）と独自データのフック（normalize・normalizeMonth・rename。失敗時は元のまま）OK");

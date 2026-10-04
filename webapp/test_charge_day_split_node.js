// 休日の期間責任者（{charge} の役割の人）が日の途中で交代する割当・固定。
//   node test_charge_day_split_node.js [highs パッケージのパス]
// その日の担当は最初の枠（日勤帯）に関わる人。夜間が別の人になるのは必須の違反ではなく減点（charge_handover。1 日あたり）で、固定したとき・ほかに手が無いときだけ起きる。
// 各枠に関わる期間責任者は 1 名（必須）。入力チェックは、解けない固定（同じ枠に 2 名・期間責任者の固定と最初の枠の食い違い）を矛盾として、交代になる固定を知らせとして出す。
// 同梱の見本（架空の名簿）だけを使う
const fs = require("fs"), vm = require("vm"), path = require("path"), assert = require("assert");
globalThis.T = {};
for (const f of ["i18n.js", "rules-core.js", "model.js", "messages.js", "solver.js", "check.js", "report.js"]) vm.runInThisContext(fs.readFileSync(path.join(__dirname, "src", f), "utf8"), { filename: f });
for (const d of ["rules", "calendars"]) for (const f of fs.readdirSync(path.join(__dirname, "src", d)).filter(x => x.endsWith(".js"))) vm.runInThisContext(fs.readFileSync(path.join(__dirname, "src", d, f), "utf8"), { filename: d + "/" + f });
for (const q of fs.readdirSync(path.join(__dirname, "lang"))) T.registerLang(JSON.parse(fs.readFileSync(path.join(__dirname, "lang", q), "utf8")));
T.setLang("ja"); T.DEFAULT_RULES = JSON.parse(fs.readFileSync(path.join(__dirname, "data/rules.json"), "utf8"));
const clone = x => JSON.parse(JSON.stringify(x)), HAND = "LINT_FIXED_CHARGE_HANDOVER", TWO = "LINT_FIXED_CHARGE_TWO_IN_SLOT", FIRST = "LINT_FIXED_CHARGE_VS_FIRST_SLOT";
const R = clone(T.DEFAULT_RULES); T.fillDefaultRules(R);
const roleId = ref => T.normalizeRolesOf(R).find(r => r.refs.includes(ref)).id, I = R.doctors.filter(d => d.team === roleId("charge")).map(d => d.name), Y = R.doctors.filter(d => d.team === roleId("junior")).map(d => d.name);
const month = fx => { const m = T.normalizeMonth({ year: 2026, month: 11, holidays: [3, 23] }, R); Object.assign(m.fixed, fx); return m; }; // 2026-11-07 は土曜（日勤と夜勤の枠がある休日）
const codes = m => T.lint(new T.Problem(R, m)).map(x => x.code).filter(c => [HAND, TWO, FIRST].includes(c));
let n = 0; const ok = (label, fn) => { fn(); n++; console.log("ok   " + label); };
assert.strictEqual(R.weights.charge_handover, 200, "既定の重み"); assert.ok(T.RULE_BY_ID.period_charge.sub.includes("charge_handover"));
ok("日勤 OC と夜間 OC の期間責任者が別の人: 「日の途中で交代」の知らせ（矛盾ではない）。日と両名を出す", () => { const m = month({ day_oc: { 7: [I[0]] }, night_oc: { 7: [I[1]] } }); assert.deepStrictEqual(codes(m), [HAND]);
  const P = new T.Problem(R, m), x = T.lint(P).find(x => x.code === HAND), txt = P.msg(HAND, x.args); assert.ok(txt.includes(I[0]) && txt.includes(I[1]) && /11\/7/.test(txt) && /計算できます/.test(txt), txt); });
ok("日勤の勤務者と夜間 OC が別の期間責任者: 交代の知らせ", () => assert.deepStrictEqual(codes(month({ day: { 7: I[0] }, night_oc: { 7: [I[1]] } })), [HAND]));
ok("期間責任者の固定（最初の枠の人）と、夜間に固定した別の人: 交代の知らせ", () => assert.deepStrictEqual(codes(month({ weekend_charge: { 7: I[0] }, night_oc: { 7: [I[1]] } })), [HAND]));
ok("期間責任者の固定と、最初の枠（日勤帯）に固定した別の人: 解けないので矛盾として出す", () => assert.deepStrictEqual(codes(month({ weekend_charge: { 7: I[0] }, day_oc: { 7: [I[1]] } })), [FIRST]));
ok("同じ枠に期間責任者の役割の人を 2 名固定: 解けないので矛盾として出す", () => assert.deepStrictEqual(codes(month({ night: { 7: I[0] }, night_oc: { 7: [I[1]] } })), [TWO]));
ok("同じ人にそろっていれば何も出さない。期間責任者でない役割の人の固定・別の日どうしも数えない", () => { assert.deepStrictEqual(codes(month({ day_oc: { 7: [I[0]] }, night_oc: { 7: [I[0]] }, weekend_charge: { 7: I[0] } })), []); assert.deepStrictEqual(codes(month({ day_oc: { 7: [Y[0]] }, night_oc: { 7: [I[1]] } })), []); assert.deepStrictEqual(codes(month({ day_oc: { 7: [I[0]] }, night_oc: { 8: [I[1]] } })), []); });
ok("規則が「なし」なら何も出さない", () => { const R2 = clone(R); R2.rule_states.period_charge = "off"; T.fillDefaultRules(R2); const m = T.normalizeMonth({ year: 2026, month: 11, holidays: [3, 23] }, R2); Object.assign(m.fixed, { day_oc: { 7: [I[0]] }, night_oc: { 7: [I[1]] } }); assert.ok(!T.lint(new T.Problem(R2, m)).some(x => [HAND, TWO, FIRST].includes(x.code))); });
const highsPath = process.argv[2];
if (!highsPath) { console.log(`${n} tests passed（解く試験は highs のパス指定時のみ）`); process.exit(0); }
(async () => { const highs = await require(highsPath)();
  const sample = JSON.parse(fs.readFileSync(path.join(__dirname, "data/202611.json"), "utf8")), base = fx => { const m = T.normalizeMonth(clone(sample), R); for (const [k, v] of Object.entries(fx || {})) m.fixed[k] = Object.assign({}, m.fixed[k], v); return m; };
  const t = async (label, fn) => { await fn(); n++; console.log("ok   " + label); };
  let base0;
  await t("固定が無ければ交代は起きない（見本の月の最適解に交代の日は無い。重み 200 は、ほかの減点の調整のためには使われない大きさ）", async () => { const P = new T.Problem(R, base()), res = await T.solve(P, highs, { timeLimit: 60 }); assert.strictEqual(res.status, "Optimal"); const c = T.check(P, res.asg); assert.strictEqual(c.V.length, 0); assert.deepStrictEqual(T.chargeHandovers(P, c.A), []); base0 = res.objective; });
  await t("日勤 OC と夜間 OC に別の期間責任者を固定: 解ける。検算の違反なし、交代 1 日の減点 200 が入り、解く側の目的関数＝減点の合計。その日の担当は最初の枠の人。説明資料に交代の日が出る", async () => {
    const P = new T.Problem(R, base({ day_oc: { 7: [I[0]] }, night_oc: { 7: [I[1]] } })), res = await T.solve(P, highs, { timeLimit: 60 }); assert.strictEqual(res.status, "Optimal", res.status);
    const c = T.check(P, res.asg), pen = T.penalty(P, res.asg); assert.strictEqual(c.V.length, 0, c.V.join(" / ")); assert.deepStrictEqual(T.chargeHandovers(P, c.A).map(h => [h.d, ...h.who]), [[7, I[0], I[1]]]);
    assert.strictEqual(pen.items.charge_handover, 200); assert.ok(Math.abs(res.objective - pen.total) < 1e-6, `目的関数 ${res.objective} / 減点 ${pen.total}`); assert.ok(res.objective >= base0 + 200 - 1e-6, "交代の分だけ悪くなる");
    const per = P.periods.find(p => p.days.includes(7)); assert.strictEqual(c.charge[per.id][7], I[0], "その日の担当は最初の枠の人");
    const pinned = await T.solve(P, highs, { timeLimit: 30, pin: res.asg }); assert.ok(Math.abs(pinned.objective - pen.total) < 1e-6, "全枠を固定して解いても同じ点");
    const html = T.reportHtml ? T.reportHtml(P, res.asg, { status: res.status }) : ""; if (html) assert.ok(html.includes(`${I[0]}→${I[1]}`), "説明資料に交代の日"); });
  await t("同じ枠に期間責任者を 2 名固定・期間責任者の固定と最初の枠の食い違いは、実際に解なし（入力チェックの矛盾と一致）", async () => {
    for (const fx of [{ night: { 7: I[0] }, night_oc: { 7: [I[1]] } }, { weekend_charge: { 7: I[0] }, day_oc: { 7: [I[1]] } }]) { const P = new T.Problem(R, base(fx)); assert.ok(T.lint(P).some(x => [TWO, FIRST].includes(x.code))); const res = await T.solve(P, highs, { timeLimit: 60 }); assert.strictEqual(res.status, "Infeasible", JSON.stringify(fx) + " → " + res.status); } });
  await t("各枠に関わる期間責任者が 1 名でない割当は検算の違反のまま（交代の緩和は「別の人」だけ。0 名・2 名は許さない）", async () => { const P = new T.Problem(R, base()), res = await T.solve(P, highs, { timeLimit: 60 }), a = clone(res.asg);
    const s = a["7:night"], had = s.oc.filter(x => I.includes(x)); assert.ok(had.length === 1 || I.includes([].concat(s.work)[0])); s.oc = s.oc.filter(x => !I.includes(x)); if (I.includes([].concat(s.work)[0])) return; // 夜勤者自身が期間責任者なら対象外
    assert.ok(T.check(P, a).VC.some(v => v.code === "PERIOD_CHARGE_NOT_ONE_IN_SLOT")); });
  console.log(`${n} tests passed`);
})().catch(e => { console.log("FAIL", e && e.stack || e); process.exit(1); });

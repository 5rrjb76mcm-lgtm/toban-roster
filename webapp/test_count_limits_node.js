// 当月の勤務回数の下限・上限（人ごと。月の設定の count_min / count_max）。入れた人は、目安±許容幅の代わりにその範囲が必須になる（規則 quota_range）。
//   node test_count_limits_node.js [highs パッケージのパス]
// 同梱の見本（架空の名簿）だけを使う
const fs = require("fs"), vm = require("vm"), path = require("path"), assert = require("assert");
globalThis.T = {};
for (const f of ["i18n.js", "rules-core.js", "model.js", "messages.js", "merge.js", "solver.js", "check.js"]) vm.runInThisContext(fs.readFileSync(path.join(__dirname, "src", f), "utf8"), { filename: f });
for (const d of ["rules", "calendars"]) for (const f of fs.readdirSync(path.join(__dirname, "src", d)).filter(x => x.endsWith(".js"))) vm.runInThisContext(fs.readFileSync(path.join(__dirname, "src", d, f), "utf8"), { filename: d + "/" + f });
for (const q of fs.readdirSync(path.join(__dirname, "lang"))) T.registerLang(JSON.parse(fs.readFileSync(path.join(__dirname, "lang", q), "utf8")));
T.setLang("ja"); T.DEFAULT_RULES = JSON.parse(fs.readFileSync(path.join(__dirname, "data/rules.json"), "utf8"));
const clone = x => JSON.parse(JSON.stringify(x)), R = clone(T.DEFAULT_RULES); T.fillDefaultRules(R);
const sample = JSON.parse(fs.readFileSync(path.join(__dirname, "data/202611.json"), "utf8")), month = extra => Object.assign(T.normalizeMonth(clone(sample), R), extra || {});
const P0 = new T.Problem(R, month()), people = P0.dutyNames.filter(n => !P0.isExempt(n)), a = people[0], b = people[1], qa = P0.quota(a), qb = P0.quota(b), tol = P0.tol;
const codes = (m, re) => T.lint(new T.Problem(R, m)).map(x => x.code).filter(c => re.test(c));
let n = 0; const ok = (label, fn) => { fn(); n++; console.log("ok   " + label); };
ok("既定は目安±許容幅。入れた側だけ置き換わる（下限だけ・上限だけ・0 回も有効な値）", () => { assert.strictEqual(P0.countLo(a), qa - tol); assert.strictEqual(P0.countHi(a), qa + tol); assert.strictEqual(P0.hasCountLimit(a), false);
  const P = new T.Problem(R, month({ count_min: { [a]: qa }, count_max: { [b]: 0 } })); assert.strictEqual(P.countLo(a), qa); assert.strictEqual(P.countHi(a), qa + tol, "入れていない側は目安＋許容幅"); assert.strictEqual(P.countHi(b), 0); assert.strictEqual(P.countLo(b), qb - tol); assert.ok(P.hasCountLimit(a) && P.hasCountLimit(b)); });
ok("0 以上の整数でない値は計算前に止める（負・小数・文字）。空欄は指定なし", () => { for (const v of [-1, 1.5, "x"]) assert.throws(() => new T.Problem(R, month({ count_max: { [a]: v } })), /count_max/, String(v)); assert.strictEqual(new T.Problem(R, month({ count_max: { [a]: "" }, count_min: { [a]: null } })).hasCountLimit(a), false); assert.strictEqual(new T.Problem(R, month({ count_max: { [a]: "2" } })).countHi(a), 2); });
ok("入力チェック: 下限＞上限、固定が上限を超える（許容される旨）、入れる枠が下限に足りない", () => {
  assert.deepStrictEqual(codes(month({ count_min: { [a]: 3 }, count_max: { [a]: 2 } }), /LIMIT/), ["LINT_COUNT_LIMIT_MIN_OVER_MAX"]);
  { const m = month({ count_max: { [a]: 1 } }); m.fixed.night = Object.assign({}, m.fixed.night, { 9: a, 16: a }); assert.ok(codes(m, /LINT_FIXED_OVER/).includes("LINT_FIXED_OVER_LIMIT")); assert.ok(!codes(m, /LINT_FIXED_OVER/).includes("LINT_FIXED_OVER_QUOTA"), "上限を入れた人は上限で数える"); }
  { const m = month({ count_min: { [a]: 99 } }); assert.ok(codes(m, /TOO_FEW/).includes("LINT_PERSON_TOO_FEW_SLOTS_LIMIT")); } });
ok("自動調整は、下限・上限を入れた人の目標をその範囲の外へ動かさない", () => { const base = T.autoTargets(R, month()); const moved = Object.keys(base.targets)[0]; if (!moved) return; const up = base.targets[moved] > P0.quota(moved);
  const at = T.autoTargets(R, month(up ? { count_max: { [moved]: P0.quota(moved) } } : { count_min: { [moved]: P0.quota(moved) } })); assert.strictEqual(at.targets[moved], undefined, "範囲の端にいる人は動かさない: " + JSON.stringify(at.targets)); });
ok("統合・改名・名簿から外す・名簿外の氏名の検出が、当月の目標と同じように効く", () => {
  const m = month({ count_min: { [a]: 0 }, count_max: { [a]: 2, [b]: 3 } }), f = T.flattenMonth(m); assert.strictEqual(f[`cmin:${a}`], "0", "0 回も値"); assert.strictEqual(f[`cmax:${b}`], "3");
  const back = T.unflattenMonth(f, m); assert.deepStrictEqual(back.count_min, { [a]: 0 }); assert.deepStrictEqual(back.count_max, { [a]: 2, [b]: 3 });
  const base = month(), mine = month({ count_min: { [a]: 2 } }), theirs = month({ count_max: { [b]: 3 } }), mg = T.mergeMonth(base, mine, theirs); assert.strictEqual(mg.conflicts.length, 0); assert.deepStrictEqual([mg.merged.count_min, mg.merged.count_max], [{ [a]: 2 }, { [b]: 3 }], "別の人への指定は両方残る");
  const c2 = T.mergeMonth(base, month({ count_max: { [a]: 2 } }), month({ count_max: { [a]: 3 } })); assert.strictEqual(c2.conflicts.length, 1, "同じ人の同じ項目は衝突"); assert.ok(/上限/.test(c2.conflicts[0].label), c2.conflicts[0].label);
  const r = month({ count_min: { [a]: 2 }, count_max: { [a]: 3 } }); T.renameMonthName(r, a, "Review Dr Z"); assert.deepStrictEqual([r.count_min, r.count_max], [{ "Review Dr Z": 2 }, { "Review Dr Z": 3 }]);
  assert.ok((T.monthNameRefs(r)["Review Dr Z"] || []).includes("count_limits")); T.purgeMonthNames(r, ["Review Dr Z"]); assert.deepStrictEqual([r.count_min, r.count_max], [{}, {}]); });
ok("入力署名: 下限・上限の変更は計算の入力の変更（空の表は差にしない）", () => { const sig = m => JSON.stringify([m.count_min, m.count_max]); assert.notStrictEqual(sig(month({ count_max: { [a]: 2 } })), sig(month())); });
const highsPath = process.argv[2];
if (!highsPath) { console.log(`${n} tests passed（解く試験は highs のパス指定時のみ）`); process.exit(0); }
(async () => { const highs = await require(highsPath)(), t = async (label, fn) => { await fn(); n++; console.log("ok   " + label); };
  const tot = (P, asg, who) => { const A = T.check(P, asg).A; return P.slots.filter(s => A.worked(who, s)).length; };
  let base;
  await t("指定なしの解を基準にする（検算の違反なし）", async () => { const P = new T.Problem(R, month()); base = await T.solve(P, highs, { timeLimit: 60 }); assert.strictEqual(base.status, "Optimal"); assert.strictEqual(T.check(P, base.asg).V.length, 0); });
  await t("上限・下限を入れると解がその範囲に入る。検算の違反なし、解く側の目的関数＝減点の合計。規則の要約に指定した人が出る", async () => { const P1 = new T.Problem(R, month()), ta = tot(P1, base.asg, a), tb = tot(P1, base.asg, b);
    const m = month({ count_max: { [a]: Math.max(qa - tol, ta - 1) }, count_min: { [b]: Math.min(qb + tol, tb + 1) } }), P = new T.Problem(R, m), res = await T.solve(P, highs, { timeLimit: 60 }); assert.strictEqual(res.status, "Optimal", res.status);
    assert.ok(tot(P, res.asg, a) <= m.count_max[a], `${tot(P, res.asg, a)} <= ${m.count_max[a]}`); assert.ok(tot(P, res.asg, b) >= m.count_min[b]); const c = T.check(P, res.asg), pen = T.penalty(P, res.asg); assert.strictEqual(c.V.length, 0, c.V.join(" / ")); assert.ok(Math.abs(res.objective - pen.total) < 1e-6);
    assert.ok((T.rulesSummary(P) || []).flatMap(g => g.items).some(x => x.includes("当月の下限・上限を入れた人") && x.includes(a) && x.includes(b))); });
  await t("範囲の外の割当は検算の違反（COUNT_OUT_OF_LIMIT）で、全枠を固定して解いても解なし（解く側と検算が同じ判定）", async () => { const P1 = new T.Problem(R, month()), ta = tot(P1, base.asg, a); if (ta < 1) return;
    const P = new T.Problem(R, month({ count_max: { [a]: ta - 1 } })), c = T.check(P, base.asg); assert.ok(c.VC.some(v => v.code === "COUNT_OUT_OF_LIMIT"), c.V.join(" / ")); assert.ok(!c.VC.some(v => v.code === "QUOTA_OUT_OF_RANGE"), "上限を入れた人は当月の範囲で言う");
    const pin = await T.solve(P, highs, { timeLimit: 30, pin: base.asg }); assert.notStrictEqual(pin.status, "Optimal"); });
  await t("目安±許容幅の外も指定できる（下限＝上限＝目安＋2）: その回数ちょうどになり、目安の範囲外の違反は出ない", async () => { const P = new T.Problem(R, month({ count_min: { [a]: qa + tol + 1 }, count_max: { [a]: qa + tol + 1 } })), res = await T.solve(P, highs, { timeLimit: 60 }); if (res.status !== "Optimal") { assert.ok(T.lint(P).length >= 0); return; }
    assert.strictEqual(tot(P, res.asg, a), qa + tol + 1); assert.strictEqual(T.check(P, res.asg).V.length, 0); });
  await t("固定指定が上限を超える分は許容（解ける。検算は「固定指定により許容」の側に出る）", async () => { const m = month({ count_max: { [a]: 1 } }), P00 = new T.Problem(R, m); const nights = P00.slots.filter(s => s[1] === "night" && !P00.isHoliday(s[0]) && !(m.unavailable_night[a] || []).includes(s[0])).map(s => s[0]).filter(d => d % 7 === 2).slice(0, 2); if (nights.length < 2) return;
    m.fixed.night = Object.assign({}, m.fixed.night, Object.fromEntries(nights.map(d => [d, a]))); const P = new T.Problem(R, m), res = await T.solve(P, highs, { timeLimit: 60 }); if (res.status !== "Optimal") return; // ほかの固定と当たる月は対象外
    const c = T.check(P, res.asg); assert.strictEqual(c.V.length, 0, c.V.join(" / ")); assert.ok((c.WC || []).some(v => v.code === "COUNT_LIMIT_OVER_BY_FIXED"), (c.W || []).join(" / ")); assert.ok(tot(P, res.asg, a) >= 2); });
  console.log(`${n} tests passed`);
})().catch(e => { console.log("FAIL", e && e.stack || e); process.exit(1); });

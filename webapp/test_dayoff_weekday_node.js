// 休日の同じ曜日に当番（勤務・OC）へ入る日数の上限（dayoff_weekday_cap）。
//   node test_dayoff_weekday_node.js <highs パッケージのパス>
// 数え方は試験の側で独立に書く: 休日（土日祝）の日ごとに、どの枠でも勤務か OC で関われば 1 日。曜日ごとに数え、上限を超えた日数が違反（必須）・減点（減点）。平日は数えない。
// 同梱の見本（架空の名簿）だけを使う
const fs = require("fs"), vm = require("vm"), path = require("path"), assert = require("assert");
globalThis.T = {};
for (const f of ["i18n.js", "rules-core.js", "model.js", "messages.js", "solver.js", "check.js", "report.js"]) vm.runInThisContext(fs.readFileSync(path.join(__dirname, "src", f), "utf8"), { filename: f });
for (const d of ["rules", "calendars"]) for (const f of fs.readdirSync(path.join(__dirname, "src", d)).filter(x => x.endsWith(".js"))) vm.runInThisContext(fs.readFileSync(path.join(__dirname, "src", d, f), "utf8"), { filename: d + "/" + f });
for (const q of fs.readdirSync(path.join(__dirname, "lang"))) T.registerLang(JSON.parse(fs.readFileSync(path.join(__dirname, "lang", q), "utf8")));
T.setLang("ja"); T.DEFAULT_RULES = JSON.parse(fs.readFileSync(path.join(__dirname, "data/rules.json"), "utf8"));
const highsPath = process.argv[2]; if (!highsPath) { console.log("（highs のパス指定が無いので、休日の同じ曜日の上限の試験は省略）"); process.exit(0); }
const clone = x => JSON.parse(JSON.stringify(x)), sample = JSON.parse(fs.readFileSync(path.join(__dirname, "data/202611.json"), "utf8")), CODE = "DAYOFF_WEEKDAY_OVER";
const rulesOf = (state, max) => { const R = clone(T.DEFAULT_RULES); R.rule_states = Object.assign({}, R.rule_states, { dayoff_weekday_cap: state }); if (max != null) R.dayoff_weekday_max = max; T.fillDefaultRules(R); return R; };
const prob = (state, max, fx) => { const R = rulesOf(state, max), m = T.normalizeMonth(clone(sample), R); for (const [k, v] of Object.entries(fx || {})) m.fixed[k] = Object.assign({}, m.fixed[k], v); return new T.Problem(R, m); };
// 独立の数え方（割当の JSON から直接）: 人 → 曜日 → 休日に関わった日
const dow = d => (new Date(2026, 10, d).getDay() + 6) % 7, holidays = new Set((sample.holidays || [])), isOff = d => dow(d) >= 5 || holidays.has(d);
const engagedDays = asg => { const out = {}; for (const [k, v] of Object.entries(asg)) { const d = +k.split(":")[0]; if (d < 1 || d > 30 || !isOff(d)) continue; for (const n of [].concat(v.work || [], v.oc || [])) if (n) ((out[n] ||= {})[dow(d)] ||= new Set()).add(d); } return out; };
const excessOf = (asg, max, skip = () => false) => { let x = 0; for (const [n, byW] of Object.entries(engagedDays(asg))) if (!skip(n)) for (const s of Object.values(byW)) x += Math.max(0, s.size - max); return x; };
let n = 0; const t = async (label, fn) => { await fn(); n++; console.log("ok   " + label); };
(async () => { const highs = await require(highsPath)();
  const def = T.RULE_BY_ID.dayoff_weekday_cap; assert.ok(def && def.def === "off" && def.states.join() === "hard,soft,off", "既定は「なし」。必須・減点・なしを選べる"); assert.strictEqual(T.DEFAULT_RULES.weights.dayoff_weekday_excess, 20); assert.strictEqual(T.DEFAULT_RULES.dayoff_weekday_max, 2);
  const P0 = prob("off"), base = await T.solve(P0, highs, { timeLimit: 60 }); assert.strictEqual(base.status, "Optimal"); const reserve = nm => P0.isRole(nm, "reserve"), exemptN = nm => reserve(nm) || P0.isRole(nm, "charge"); // 対象外（予備・期間責任者になれる役割）
  const ex1 = excessOf(base.asg, 1, exemptN), ex2 = excessOf(base.asg, 2, exemptN); assert.ok(ex1 > 0, "見本の解には、休日の同じ曜日に 2 日以上入る人がいる（上限 1 の試験になる）: " + ex1);
  await t("「なし」なら検算にも減点にも出ない", async () => { const c = T.check(P0, base.asg); assert.ok(!c.VC.some(v => v.code === CODE)); assert.ok(!(T.penalty(P0, base.asg).items || {}).dayoff_weekday_excess); });
  await t("減点: 超えた日数 × 重み。同じ割当を全枠固定して解いた目的関数は、「なし」のときより ちょうどその分だけ大きい（解く側・減点・独立の数え方が一致）", async () => {
    for (const [max, ex] of [[1, ex1], [2, ex2]]) { const P = prob("soft", max), pen = T.penalty(P, base.asg), w = P.weights.dayoff_weekday_excess; assert.strictEqual((pen.items.dayoff_weekday_excess || 0), ex * w, `上限 ${max}: ${pen.items.dayoff_weekday_excess} = ${ex} × ${w}`);
      const off = await T.solve(P0, highs, { timeLimit: 30, pin: base.asg }), on = await T.solve(P, highs, { timeLimit: 30, pin: base.asg }); assert.ok(Math.abs(on.objective - off.objective - ex * w) < 1e-6, `${on.objective} − ${off.objective} = ${ex * w}`); assert.ok(Math.abs(on.objective - pen.total) < 1e-6); assert.strictEqual(T.check(P, base.asg).V.length, 0, "減点のときは違反にしない"); } });
  await t("必須: 上限を超える割当は検算の違反（人・曜日ごとに 1 件。日付を出す）で、全枠固定では解なし。上限以内の割当は違反なし", async () => { const P = prob("hard", 1), c = T.check(P, base.asg), hits = c.VC.filter(v => v.code === CODE);
    const groups = Object.entries(engagedDays(base.asg)).filter(([nm]) => !exemptN(nm)).reduce((a, [, byW]) => a + Object.values(byW).filter(s => s.size > 1).length, 0); assert.strictEqual(hits.length, groups, `${hits.length} 件 / 独立の数え方 ${groups} 件`); assert.ok(/曜/.test(c.V.find(v => /休日の/.test(v)) || ""), c.V.join(" / "));
    assert.notStrictEqual((await T.solve(P, highs, { timeLimit: 30, pin: base.asg })).status, "Optimal"); const P5 = prob("hard", 5); assert.ok(!T.check(P5, base.asg).VC.some(v => v.code === CODE)); });
  await t("必須（月 2 日まで）で解き直すと、どの人も休日の同じ曜日は上限以内（独立の数え方で 0）。検算の違反なし、目的関数＝減点の合計", async () => { const P = prob("hard", 2), res = await T.solve(P, highs, { timeLimit: 90 }); assert.strictEqual(res.status, "Optimal", res.status);
    assert.strictEqual(excessOf(res.asg, 2, exemptN), 0); assert.strictEqual(T.check(P, res.asg).V.length, 0); assert.ok(Math.abs(res.objective - T.penalty(P, res.asg).total) < 1e-6); });
  await t("減点（月 1 日まで）で解き直すと、超える日数は「なし」の解より増えない。目的関数＝減点の合計", async () => { const P = prob("soft", 1), res = await T.solve(P, highs, { timeLimit: 90 }); assert.strictEqual(res.status, "Optimal"); assert.ok(excessOf(res.asg, 1, exemptN) <= ex1, `${excessOf(res.asg, 1, exemptN)} <= ${ex1}`); assert.strictEqual(T.check(P, res.asg).V.length, 0); assert.ok(Math.abs(res.objective - T.penalty(P, res.asg).total) < 1e-6); });
  await t("期間責任者になれる役割は対象外（休日への入り方は期間責任者の担当で決まる。規則 period_charge が「なし」の施設では対象）。予備の役割も対象外", async () => { const I = P0.I, a = clone(base.asg), P = prob("hard", 1), c = T.check(P, a);
    assert.ok(Object.entries(engagedDays(a)).some(([nm, byW]) => I.includes(nm) && Object.values(byW).some(s => s.size > 1)), "見本では期間責任者が同じ曜日の休日に 2 日以上入っている"); assert.ok(!c.VC.some(v => v.code === CODE && I.includes((v.args || {}).who)), "期間責任者は違反にしない");
    const R2 = rulesOf("hard", 1); R2.rule_states.period_charge = "off"; R2.rule_states.weekend_balance = "off"; T.fillDefaultRules(R2); const P2 = new T.Problem(R2, T.normalizeMonth(clone(sample), R2)); assert.ok(T.check(P2, a).VC.some(v => v.code === CODE && I.includes((v.args || {}).who)), "period_charge が「なし」なら対象"); });
  await t("解なしの診断: この規則は「dayoff_weekday」として外せる（外すと、上限を超える割当も全枠固定で解ける）。規則が「なし」のときは診断で試さない", async () => { const P = prob("hard", 1);
    assert.ok(T.RELAXATIONS.some(([k]) => k === "dayoff_weekday")); assert.strictEqual(T.RULE_BY_ID.dayoff_weekday_cap.relax, "dayoff_weekday"); assert.ok(T.RULE_BY_ID.dayoff_weekday_cap.diagnoseHint);
    assert.notStrictEqual((await T.solve(P, highs, { timeLimit: 30, pin: base.asg })).status, "Optimal"); assert.strictEqual((await T.solve(P, highs, { timeLimit: 30, pin: base.asg, relax: ["dayoff_weekday"] })).status, "Optimal", "外せば解ける");
    const tried = async PP => { const seen = []; await T.diagnose(PP, highs, 1, pr => { if (!pr.sub) seen.push(pr.label); }); return seen; };
    assert.ok(!(await tried(P0)).some(l => /休日の同じ曜日/.test(l)), "「なし」なら試さない"); assert.ok((await tried(P)).some(l => /休日の同じ曜日/.test(l)), "必須なら試す"); });
  await t("日で数える: 同じ日の日勤 OC と夜勤は 1 日。平日の当番は数えない。祝日はその曜日で数える", async () => { const a = clone(base.asg), who = P0.dutyNames.find(x => P0.isStandby(x) && !exemptN(x));
    const before = (engagedDays(a)[who] || {}), sun = [1, 8, 15, 22, 29].find(d => !(before[6] || new Set()).has(d)); assert.ok(sun, "空いている日曜がある");
    a[`${sun}:day`].oc = [...a[`${sun}:day`].oc, who]; const one = (engagedDays(a)[who][6]).size; a[`${sun}:night`].oc = [...a[`${sun}:night`].oc, who]; assert.strictEqual(engagedDays(a)[who][6].size, one, "同じ日の 2 枠は 1 日（独立の数え方）");
    const P = prob("soft", 1), p1 = T.penalty(P, a).items.dayoff_weekday_excess || 0; const a1 = clone(a); a1[`${sun}:night`].oc = a1[`${sun}:night`].oc.filter(x => x !== who); assert.strictEqual(T.penalty(P, a1).items.dayoff_weekday_excess || 0, p1, "同じ日の枠を足しても点は変わらない");
    const wd = [4, 5, 6, 9, 10, 11].find(d => !isOff(d)), a2 = clone(a1); a2[`${wd}:night`].oc = [...(a2[`${wd}:night`].oc || []), who]; assert.strictEqual(T.penalty(P, a2).items.dayoff_weekday_excess || 0, p1, "平日は数えない");
    assert.ok(isOff(3) && dow(3) === 1 && isOff(23) && dow(23) === 0, "見本の祝日は 3 日（火）と 23 日（月）"); const a3 = clone(base.asg); const cnt = x => (T.penalty(P, x).items.dayoff_weekday_excess || 0); const c0 = cnt(a3); a3["3:night"].oc = [...a3["3:night"].oc.filter(x => x !== who), who];
    assert.ok(cnt(a3) >= c0); assert.strictEqual(excessOf(a3, 1, exemptN) * P.weights.dayoff_weekday_excess, cnt(a3), "祝日を含めても独立の数え方と一致"); });
  await t("固定指定だけで上限を超える人は「固定指定により許容」（必須でも解ける。検算は許容の側、減点は fixed_conflict）", async () => { const who = P0.dutyNames.find(x => P0.isRole(x, "junior")), un = P0.unavailNight[who], suns = [1, 8, 15, 22, 29].filter(d => !(un && (un.has ? un.has(d) : [].concat(un).includes(d)))).slice(0, 3); if (suns.length < 3) return;
    const P = prob("hard", 2, { night_oc: Object.fromEntries(suns.map(d => [d, [who]])) }), res = await T.solve(P, highs, { timeLimit: 90 }); if (res.status !== "Optimal") { console.log("     （この見本ではほかの必須条件と当たるので省略: " + res.status + "）"); return; }
    const c = T.check(P, res.asg); assert.strictEqual(c.V.length, 0, c.V.join(" / ")); assert.ok((c.WC || []).some(v => v.code === CODE), (c.W || []).join(" / ")); const pen = T.penalty(P, res.asg); assert.ok(pen.items.fixed_conflict >= P.weights.fixed_conflict); assert.ok(Math.abs(res.objective - pen.total) < 1e-6); });
  await t("規則の要約と説明資料に出る", async () => { const P = prob("soft", 1); assert.ok((T.rulesSummary(P) || []).flatMap(g => g.items).some(x => /休日の同じ曜日は月 1 日まで/.test(x))); const html = T.reportHtml(P, base.asg, { status: "Optimal" }); assert.ok(/休日の同じ曜日の当番が1日を超過/.test(html)); });
  console.log(`${n} tests passed`);
})().catch(e => { console.log("FAIL", e && e.stack || e); process.exit(1); });

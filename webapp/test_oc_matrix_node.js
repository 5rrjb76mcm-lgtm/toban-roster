// OC を実際に置いた割当で、解く側（HiGHS で全枠を固定）・減点の数え直し・検算・説明資料が一致することを、組み合わせで確かめる。
//   node test_oc_matrix_node.js <highs パッケージのパス>
// 規則 oc_consecutive は「少なくとも片方が OC の連続」だけを数える（勤務→勤務は consecutive_days）。解く側は両方が勤務のときだけ 1 にできる補助変数を引くので、
// 前月末（定数）・翌月 1 日の固定・連日を必須にして固定で許容する場合・日勤の枠を挟む夜勤どうしで、場合分けを間違えやすい。ここでは待機に入れる役割を持つ小さな構成を使い、
// 期待値は規則の文から決める: 勤務→勤務は 0（連日が必須で固定により許容なら固定の衝突 50）、OC→勤務・勤務→OC・OC→OC は 6。名前はすべて架空（A〜K）
const fs = require("fs"), vm = require("vm"), path = require("path"), assert = require("assert");
globalThis.T = {};
for (const f of ["i18n.js", "rules-core.js", "model.js", "messages.js", "solver.js", "check.js"]) vm.runInThisContext(fs.readFileSync(path.join(__dirname, "src", f), "utf8"), { filename: f });
for (const d of ["rules", "calendars"]) for (const f of fs.readdirSync(path.join(__dirname, "src", d)).filter(x => x.endsWith(".js"))) vm.runInThisContext(fs.readFileSync(path.join(__dirname, "src", d, f), "utf8"), { filename: d + "/" + f });
for (const q of fs.readdirSync(path.join(__dirname, "lang"))) T.registerLang(JSON.parse(fs.readFileSync(path.join(__dirname, "lang", q), "utf8")));
T.setLang("ja"); T.DEFAULT_RULES = JSON.parse(fs.readFileSync(path.join(__dirname, "data/rules.json"), "utf8"));
const highsPath = process.argv[2];
if (!highsPath) { console.log("（highs のパス指定が無いので、OC を置く割当の照合は省略）"); process.exit(0); }

// 構成: 役割は 1 つ（待機に入れる）。勤務者 1 名に OC 1 名。dayOn は日勤の枠を作る日（none / all / weekdays / off_days）
function rulesOf(dayOn, hard) {
  const r = { profile: { id: "matrix", roles: [{ id: "S", label: "Staff", standby: true }], shifts: [{ id: "day", on: dayOn }, { id: "night", on: "all" }], quota_mode: "absolute" },
    doctors: "ABCDEFGHIJK".split("").map(c => ({ name: c, team: "S", quota: 0, years: 10 })), oncall_requirement: { S: { S: 1 } }, weights: {}, rule_states: {} };
  T.fillDefaultRules(r); for (const d of T.RULE_DEFS) if (d.states.includes("off")) r.rule_states[d.id] = "off";
  r.rule_states.oncall = "hard"; r.rule_states.oc_consecutive = "soft"; for (const k in r.weights) r.weights[k] = 0; r.weights.oc_consecutive = 6;
  if (hard) { r.rule_states.consecutive_days = "hard"; r.weights.fixed_conflict = 50; } // 連日を必須にし、固定が絡む組は減点付きで許容
  return r;
}
const put = (asg, key, mode) => { if (mode === "W") asg[key].work = "A"; else asg[key].oc = ["A"]; }; // A を勤務（W）か OC（O）に置く
let runs = 0, fails = 0;

(async () => {
  const highs = await require(highsPath)();
  // year/month: 2026 年 2 月（28 日。翌 3/1 は日曜）と 8 月（31 日。翌 9/1 は火曜＝平日）。second: 月内・翌月で 2 つ目に置く勤務帯（日勤の枠があれば隣の日勤、無ければ夜勤。"night" は日勤の枠を挟む夜勤どうし）
  const one = ({ label, year, month, dayOn, boundary, hard, a, b, second }) => {
    const r = rulesOf(dayOn, hard), m = { year, month, holidays: [], fixed: { day: {}, night: {}, day_oc: {}, night_oc: {} } };
    const N = new Date(year, month, 0).getDate(), asg = {}; new T.Problem(r, T.normalizeMonth(JSON.parse(JSON.stringify(m)), r)).slots.forEach(([d, k], i) => { asg[`${d}:${k}`] = { work: "BDFH"[i % 4], oc: ["CEGI"[i % 4]] }; });
    let fixedDay = null;
    if (boundary === "month") { put(asg, "5:night", a); put(asg, `6:${second}`, b); fixedDay = 5; }
    else if (boundary === "prev") { m.prev_month = { last_days: [{ date: 31, night: a === "W" ? "A" : "J", night_oc: [a === "O" ? "A" : "K"] }] }; put(asg, `1:${second}`, b); fixedDay = 1; }
    else { put(asg, `${N}:night`, a); m.fixed[second + (b === "O" ? "_oc" : "")][N + 1] = b === "O" ? ["A"] : "A"; fixedDay = N; }
    if (hard && a === "W" && b === "W") m.fixed[boundary === "prev" ? second : "night"][fixedDay] = "A"; // 勤務→勤務を連日の必須の下で許容するため、月内の側の勤務を固定する
    const P = new T.Problem(r, T.normalizeMonth(m, r)), chk = T.check(P, asg), pen = T.penalty(P, asg), res = T.solve(P, highs, { pin: asg, timeLimit: 10, mipGap: 0 });
    const want = a === "W" && b === "W" ? (hard ? 50 : 0) : 6; runs++;
    try {
      assert.strictEqual(chk.V.length, 0, "検算の違反: " + chk.V.join(" / ")); assert.strictEqual(res.status, "Optimal", "解く側: " + res.status);
      assert.ok(Math.abs(res.objective - want) < 1e-6, `目的関数 ${res.objective}（期待 ${want}）`); assert.ok(Math.abs(pen.total - want) < 1e-6, `減点 ${pen.total}（期待 ${want}）`);
      if (boundary !== "next") { const lines = []; T.RULE_BY_ID.oc_consecutive.report(T.rules.checkCtx(P, chk.A, "report", x => lines.push(x))); assert.strictEqual(lines.join("").includes("A:"), !(a === "W" && b === "W"), "説明資料: " + lines.join("")); }
    } catch (e) { fails++; console.log("FAIL", label, "\n     ", String(e.message).split("\n")[0]); }
  };
  const AB = [["W", "W"], ["W", "O"], ["O", "W"], ["O", "O"]], NAME = { W: "勤務", O: "OC" };
  const group = (title, base, list) => { const n0 = runs, f0 = fails; for (const x of list) for (const hard of [false, true]) for (const [a, b] of AB) one(Object.assign({ label: `${title} ${x.boundary} ${hard ? "連日必須" : "連日なし"} ${NAME[a]}→${NAME[b]}`, hard, a, b }, base, x)); console.log(`${fails === f0 ? "ok  " : "FAIL"} ${title}: ${runs - n0} 件`); };
  const B3 = ["month", "prev", "next"].map(boundary => ({ boundary }));
  group("夜勤だけの施設（隣の枠は翌日の夜勤）", { year: 2026, month: 2, dayOn: "none", second: "night" }, B3);
  group("毎日 2 交代（隣の枠は翌日の日勤）", { year: 2026, month: 2, dayOn: "all", second: "day" }, B3);
  group("毎日 2 交代（日勤の枠を挟む夜勤どうし）", { year: 2026, month: 2, dayOn: "all", second: "night" }, B3);
  // 翌月 1 日が平日の月: 月末の夜勤に隣接する翌月の枠は、勤務帯の設定で決まる（日勤が毎日・平日だけなら日勤、休日だけ・なしなら夜勤）
  group("翌月 1 日が平日・日勤が毎日（隣は翌月 1 日の日勤）", { year: 2026, month: 8, dayOn: "all", second: "day" }, [{ boundary: "next" }]);
  group("翌月 1 日が平日・日勤が平日だけ（隣は翌月 1 日の日勤）", { year: 2026, month: 8, dayOn: "weekdays", second: "day" }, [{ boundary: "next" }]);
  group("翌月 1 日が平日・日勤が休日だけ（隣は翌月 1 日の夜勤）", { year: 2026, month: 8, dayOn: "off_days", second: "night" }, [{ boundary: "next" }]);
  group("翌月 1 日が平日・日勤なし（隣は翌月 1 日の夜勤）", { year: 2026, month: 8, dayOn: "none", second: "night" }, [{ boundary: "next" }]);
  // 補助（若手）の OC の必要人数が 2 以上: 不足は 0〜必要数の整数で、解く側（欠員の変数）・検算（減点で許容）・減点（不足 1 名ごと）が同じ数え方になる。
  // 「もう一方の専門（other）」の勤務のときだけ不足を許す（ほかの役割の勤務・「OC なし」の固定でない枠の超過は違反）。以前は欠員が二値（最大 1 名）で、検算は 0 名だけを許容していた（必要 2 で実 1 は解く側 Optimal・検算は不一致、実 0 は解く側 Infeasible）
  { const rules2 = () => { const r = { profile: { id: "matrix2", roles: [{ id: "I", label: "Charge", refs: ["charge"], standby: true }, { id: "A", label: "Other", refs: ["other"] }, { id: "Y", label: "Junior", refs: ["junior"], standby: true }], shifts: [{ id: "day", on: "none" }, { id: "night", on: "all" }], quota_mode: "absolute" },
      doctors: [{ name: "A1", team: "A" }, { name: "I1", team: "I" }, { name: "I2", team: "I" }, { name: "Y1", team: "Y" }, { name: "Y2", team: "Y" }, { name: "Y3", team: "Y" }].map(d => Object.assign({ quota: 0, years: 10 }, d)), oncall_requirement: { I: { I: 0, Y: 0 }, A: { I: 0, Y: 2 }, Y: { I: 0, Y: 0 } }, weights: {}, rule_states: {} };
      T.fillDefaultRules(r); for (const d of T.RULE_DEFS) if (d.states.includes("off")) r.rule_states[d.id] = "off"; r.rule_states.oncall = "hard"; for (const k in r.weights) r.weights[k] = 0; r.weights.missing_young_oc = 3; return r; };
    const month2 = extra => T.normalizeMonth(Object.assign({ year: 2026, month: 2, holidays: [], fixed: { day: {}, night: {}, day_oc: {}, night_oc: {}, night_oc_none: {} } }, extra), rules2());
    const full = (ocs1, worker1 = "A1") => { const asg = {}; for (let d = 1; d <= 28; d++) asg[`${d}:night`] = d === 1 ? { work: worker1, oc: ocs1 } : { work: "I" + (1 + d % 2), oc: [] }; return asg; }; // 1 日だけ A の勤務（若手 OC 2 名が必要）、ほかは I の勤務（OC 不要）
    const t = (label, fn) => { runs++; try { fn(); } catch (e) { fails++; console.log("FAIL", label, "\n     ", String(e.message).split("\n")[0]); } };
    for (const [ocs, want] of [[["Y1", "Y2"], 0], [["Y1"], 3], [[], 6]]) t(`必要 2・実 ${ocs.length}（全枠固定）`, () => { const r = rules2(), m = month2({}), P = new T.Problem(r, m), asg = full(ocs), chk = T.check(P, asg), pen = T.penalty(P, asg), res = T.solve(P, highs, { pin: asg, timeLimit: 10, mipGap: 0 });
      assert.strictEqual(chk.V.length, 0, "検算の違反: " + chk.V.join(" / ")); assert.strictEqual(res.status, "Optimal", "解く側: " + res.status); assert.strictEqual(pen.total, want, `減点 ${pen.total}`); assert.ok(Math.abs(res.objective - want) < 1e-6, `目的関数 ${res.objective}`); });
    t("必要 2・実 3 は超過（違反）", () => { const r = rules2(), m = month2({}), P = new T.Problem(r, m), chk = T.check(P, full(["Y1", "Y2", "Y3"])); assert.ok(chk.VC.some(v => v.code === "SLOT_OC_MISMATCH"), chk.V.join(",")); });
    t("ほかの役割（I）の勤務では不足を許さない", () => { const r = rules2(); r.oncall_requirement.I = { I: 0, Y: 2 }; const m = month2({}), P = new T.Problem(r, m), asg = full(["Y1"], "I1"), chk = T.check(P, asg), res = T.solve(P, highs, { pin: asg, timeLimit: 10, mipGap: 0 }); assert.ok(chk.VC.some(v => v.code === "SLOT_OC_MISMATCH"), chk.V.join(",")); assert.notStrictEqual(res.status, "Optimal", "解く側も不可"); });
    t("「OC なし」の固定: 必要 2 でも 0 名（減点 2 名分）、1 名でも入れば固定との不一致", () => { const r = rules2(); const m = month2({ fixed: { day: {}, night: {}, day_oc: {}, night_oc: {}, night_oc_none: { 1: ["Y"] } } }), P = new T.Problem(r, m);
      const c0 = T.check(P, full([])), p0 = T.penalty(P, full([])), r0 = T.solve(P, highs, { pin: full([]), timeLimit: 10, mipGap: 0 }); assert.strictEqual(c0.V.length, 0, c0.V.join("/")); assert.strictEqual(p0.total, 6); assert.strictEqual(r0.status, "Optimal"); assert.ok(Math.abs(r0.objective - 6) < 1e-6, `目的関数 ${r0.objective}`);
      const c1 = T.check(P, full(["Y1"])); assert.ok(c1.VC.some(v => v.code === "FIXED_OC_NONE"), c1.V.join(",")); });
    t("通常の計算: 勤務者を固定し、若手 3 名のうち 2 名が同じ夜に不可 → 1 名だけ置いて Optimal。検算は違反なし・減点 3", () => { const r = rules2(); const m = month2({ fixed: { day: {}, night: { 1: "A1" }, day_oc: {}, night_oc: {} }, unavailable_night: { Y2: [1], Y3: [1] } }), P = new T.Problem(r, m), res = T.solve(P, highs, { timeLimit: 20 });
      assert.strictEqual(res.status, "Optimal", "解く側: " + res.status); const s1 = res.asg["1:night"]; assert.strictEqual(s1.work, "A1"); assert.deepStrictEqual(s1.oc, ["Y1"], "置けるのは Y1 だけ: " + JSON.stringify(s1)); const chk = T.check(P, res.asg); assert.strictEqual(chk.V.length, 0, chk.V.join("/")); assert.strictEqual(T.penalty(P, res.asg).total, 3); assert.ok(Math.abs(res.objective - 3) < 1e-6); });
  }
  console.log(fails ? `OC を置く割当の照合: ${runs} 件中 ${fails} 件失敗` : `OC を置く割当の照合 ${runs} 件 OK（解く側・減点・検算・説明資料）`); process.exit(fails ? 1 : 0);
})().catch(e => { console.log("FAIL", e && e.stack || e); process.exit(1); });

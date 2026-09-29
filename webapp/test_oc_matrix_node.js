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
  console.log(fails ? `OC を置く割当の照合: ${runs} 件中 ${fails} 件失敗` : `OC を置く割当の照合 ${runs} 件 OK（解く側・減点・検算・説明資料）`); process.exit(fails ? 1 : 0);
})().catch(e => { console.log("FAIL", e && e.stack || e); process.exit(1); });

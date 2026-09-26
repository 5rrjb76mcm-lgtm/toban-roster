// 仕様の正解例: 人が期待結果を決めた小さな例で、検算（T.check）と減点（T.penalty）の結果を直接検査する。
// 解く側・検算・減点の突き合わせ（test_penalty / test_brute）は 3 つの実装が一致することを見るが、共通の Problem の読み取りや仕様の解釈を同じように
// 間違えると通ってしまう。ここでは規則の文（README・rule-modules・各規則の冒頭の説明）から人が決めた「人数はいくつ・違反か許容か・減点はいくつ」を書き、
// コードを読まずに立てた期待値と突き合わせる。期待値の根拠は各例のコメントに書く。名前はすべて架空（同梱の 2 交代プロファイル）
const fs = require("fs"), vm = require("vm"), path = require("path"), assert = require("assert");
globalThis.T = {};
for (const f of ["i18n.js", "rules-core.js", "model.js", "messages.js", "solver.js", "check.js"]) vm.runInThisContext(fs.readFileSync(path.join(__dirname, "src", f), "utf8"), { filename: f });
for (const f of fs.readdirSync(path.join(__dirname, "src/rules")).filter(x => x.endsWith(".js"))) vm.runInThisContext(fs.readFileSync(path.join(__dirname, "src/rules", f), "utf8"), { filename: "rules/" + f });
for (const f of fs.readdirSync(path.join(__dirname, "src/calendars")).filter(x => x.endsWith(".js"))) vm.runInThisContext(fs.readFileSync(path.join(__dirname, "src/calendars", f), "utf8"), { filename: "calendars/" + f });
for (const q of fs.readdirSync(path.join(__dirname, "lang"))) T.registerLang(JSON.parse(fs.readFileSync(path.join(__dirname, "lang", q), "utf8")));
T.setLang("ja"); T.DEFAULT_RULES = JSON.parse(fs.readFileSync(path.join(__dirname, "data/rules.json"), "utf8"));
const clone = o => JSON.parse(JSON.stringify(o));
// 土台: 2 交代（日勤・夜勤を毎日、各 1 名）の 5 名。規則はすべて「なし」にし、例ごとに見たい規則だけ入れる（本体が常に見る「枠の充足・不可・固定との一致」は残る）
const PROFILE = JSON.parse(fs.readFileSync(path.join(__dirname, "data/profiles/two-shift.json"), "utf8"));
function base(opts = {}) {
  const R = clone(PROFILE); R.doctors = R.doctors.slice(0, opts.n || 5).map(d => Object.assign({}, d)); R.name_order = R.doctors.map(d => d.name);
  if (opts.share) R.doctors.forEach((d, i) => { d.share = opts.share[i]; });
  if (opts.count) R.profile.positions = { work: { count: opts.count } };
  T.fillDefaultRules(R); for (const def of T.RULE_DEFS) if ((def.states || []).includes("off")) R.rule_states[def.id] = "off";
  Object.assign(R.rule_states, opts.states || {}); Object.assign(R, opts.rules || {}); Object.assign(R.weights, opts.weights || {});
  const m = T.normalizeMonth(Object.assign({ year: 2026, month: 11, holidays: [3, 23], next_month_first_day_is_holiday: false }, opts.month || {}), R); // 2026 年 11 月: 30 日、1 日は日曜
  return { R, m, D: R.doctors.map(d => d.name) };
}
// 基準の割当: 日勤は D[(d-1)%5]、夜勤は D[(d+2)%5]。同じ人が同じ日に 2 枠に入らず、夜勤の翌日・翌々日に勤務がなく、日勤の連続もない（例が見たい規則以外に触れない）
const rotation = (D, N = 30, dayCount = 1) => { const a = {}; for (let d = 1; d <= N; d++) { const ws = []; for (let i = 0; i < dayCount; i++) ws.push(D[(d - 1 + i) % D.length]); a[`${d}:day`] = { work: dayCount === 1 ? ws[0] : ws, oc: [] }; a[`${d}:night`] = { work: D[(d + 2) % D.length], oc: [] }; } return a; };
const codes = r => r.VC.map(x => x.code), wcodes = r => r.WC.map(x => x.code);
const pen = (P, a) => { const p = T.penalty(P, a); return p.items || p; };
let passed = 0, failed = 0; const test = (name, fn) => { try { fn(); passed++; console.log("ok  ", name); } catch (e) { failed++; console.log("FAIL", name, "\n     ", (e && e.message || e).toString().split("\n").slice(0, 3).join(" ")); } };

test("枠の充足: 空の割当は枠ごとに 1 件（30 日 × 日勤・夜勤 = 60 件）。基準の割当は 0 件。1 名の枠に 2 名は 1 件", () => {
  const { R, m, D } = base(); const P = new T.Problem(R, m);
  const r0 = T.check(P, {}); assert.strictEqual(r0.V.length, 60); assert.ok(codes(r0).every(c => c === "SLOT_WORKER_COUNT"));
  const a = rotation(D); assert.strictEqual(T.check(P, a).V.length, 0);
  a["5:day"].work = [D[4], D[3]]; const r2 = T.check(P, a); assert.deepStrictEqual(codes(r2), ["SLOT_WORKER_COUNT"]);
});
test("不可: 夜勤不可の日に夜勤 → 違反 1。その枠を固定していれば「固定指定により許容」1（違反 0）。終日不可の日の日勤も違反", () => {
  const { R, m, D } = base({ month: { unavailable_night: { "Dr B": [3] }, unavailable_other: [{ name: "Dr B", day: 1, part: "allday" }] } }); // 基準の割当では Dr B が 3 日の夜勤と 1 日の日勤
  const P = new T.Problem(R, m), a = rotation(D); const r = T.check(P, a); assert.deepStrictEqual(codes(r).sort(), ["UNAVAIL_DAY", "UNAVAIL_NIGHT"]); assert.strictEqual(r.W.length, 0);
  const m2 = clone(m); m2.fixed.night[3] = "Dr B"; const r2 = T.check(new T.Problem(R, m2), a); assert.deepStrictEqual(codes(r2), ["UNAVAIL_DAY"]); assert.deepStrictEqual(wcodes(r2), ["UNAVAIL_NIGHT"]);
});
test("複数名の枠: 日勤 2 名の施設で、日勤に 1 名なら枠ごとに違反（30 件）、2 名なら 0、3 名なら 1 件", () => {
  const { R, m, D } = base({ count: { day: 2, night: 1 } }); const P = new T.Problem(R, m);
  assert.strictEqual(T.check(P, rotation(D)).V.length, 30); const a = rotation(D, 30, 2); assert.strictEqual(T.check(P, a).V.length, 0);
  a["8:day"].work = [D[2], D[3], D[4]]; const r = T.check(P, a); assert.deepStrictEqual(codes(r), ["SLOT_WORKER_COUNT"]);
});
test("月またぎ（夜勤 → 明け → 休み）: 前月 31 日の夜勤の人が 2 日に勤務すると違反。当月の夜勤 7 日 → 9 日の勤務も違反、その夜勤を固定していれば許容", () => {
  const { R, m, D } = base({ states: { rest_after_ake: "hard" }, month: { prev_month: { last_days: [{ date: 31, night: "Dr B" }] } } }); // 前月＝2026 年 10 月は 31 日まで
  const a = rotation(D); a["2:day"].work = "Dr B"; // 基準では 2 日の日勤は Dr D
  let r = T.check(new T.Problem(R, m), a); assert.deepStrictEqual(codes(r), ["REST_AFTER_AKE"], "前月末の夜勤からも数える"); assert.strictEqual(r.W.length, 0);
  a["2:day"].work = D[1]; assert.strictEqual(T.check(new T.Problem(R, m), a).V.length, 0, "2 日に入らなければ 0");
  a["7:night"].work = "Dr B"; a["9:day"].work = "Dr B"; r = T.check(new T.Problem(R, m), a); assert.deepStrictEqual(codes(r), ["REST_AFTER_AKE"]); // 当月の中（基準では 7 日の夜勤は Dr G、9 日の日勤は Dr F。Dr B の基準の夜勤 3・8・13 日と日勤 1・6・11 日に 2 日後の組が新たにできない日を選ぶ）
  const m2 = clone(m); m2.fixed.night[7] = "Dr B"; r = T.check(new T.Problem(R, m2), a); assert.strictEqual(r.V.length, 0); assert.deepStrictEqual(wcodes(r), ["REST_AFTER_AKE"], "固定が絡めば許容");
});
test("勤務帯ごとの連続（日勤は 3 日まで）: 日勤 1〜4 日で違反 1。1〜3 日＋4 日の夜勤は 0。前月 30・31 日の日勤に続く 1・2 日の日勤も違反", () => {
  const { R, m, D } = base({ states: { shift_run_max: "hard" }, rules: { shift_run_max: { day: 3 } } });
  const a = rotation(D); for (const d of [2, 3, 4]) a[`${d}:day`].work = "Dr B"; // 基準では 1 日の日勤が Dr B
  let r = T.check(new T.Problem(R, m), a); assert.deepStrictEqual(codes(r), ["SHIFT_RUN_TOO_LONG"]);
  a["4:day"].work = D[3]; a["4:night"].work = "Dr B"; assert.strictEqual(T.check(new T.Problem(R, m), a).V.length, 0, "夜勤は日勤の連続に数えない");
  const { R: R2, m: m2 } = base({ states: { shift_run_max: "hard" }, rules: { shift_run_max: { day: 3 } }, month: { prev_month: { last_days: [{ date: 30, day: "Dr B" }, { date: 31, day: "Dr B" }] } } });
  const b = rotation(D); b["2:day"].work = "Dr B"; r = T.check(new T.Problem(R2, m2), b); assert.deepStrictEqual(codes(r), ["SHIFT_RUN_TOO_LONG"], "前月末からの並びも数える");
  b["2:day"].work = D[1]; assert.strictEqual(T.check(new T.Problem(R2, m2), b).V.length, 0);
});
test("連勤の上限 4 日: 5 日続けて勤務すると違反 1。6 日続けても指摘は 1 件（同じ連勤を 2 度数えない）", () => {
  const { R, m, D } = base({ states: { run_length_max: "hard" }, rules: { run_length: { max: 4 } } });
  const a = rotation(D); for (const d of [2, 3, 4, 5]) a[`${d}:day`].work = "Dr B"; let r = T.check(new T.Problem(R, m), a); assert.deepStrictEqual(codes(r), ["RUN_TOO_LONG"]);
  a["6:day"].work = "Dr B"; r = T.check(new T.Problem(R, m), a); assert.deepStrictEqual(codes(r), ["RUN_TOO_LONG"]); assert.ok(/6/.test(r.V[0]), "6 日と分かる: " + r.V[0]);
});
test("同じ日の 2 枠: 同じ人を同じ日の日勤と夜勤に入れると違反 1。その日勤を固定していれば許容", () => {
  const { R, m, D } = base({ states: { same_day_double: "hard" } }); const a = rotation(D); a["5:night"].work = a["5:day"].work;
  let r = T.check(new T.Problem(R, m), a); assert.deepStrictEqual(codes(r), ["SAME_DAY_DOUBLE"]);
  const m2 = clone(m); m2.fixed.day[5] = a["5:day"].work; r = T.check(new T.Problem(R, m2), a); assert.strictEqual(r.V.length, 0); assert.deepStrictEqual(wcodes(r), ["SAME_DAY_DOUBLE"]);
});
test("当月目標: 目標 4 回の人が 12 回働くと、ずれ 8 × 重み 15 = 120 の減点。ほかの人は按分の目安どおり（12 回）で 0", () => {
  const { R, m, D } = base({ states: { quota_target: "soft" }, weights: { target_deviation: 15 }, month: { targets: { "Dr B": 4 } } }); // 2 交代は比重で按分: 60 枠 ÷ 5 名 = 12 回
  const P = new T.Problem(R, m); assert.strictEqual(P.targets["Dr B"], 4); assert.strictEqual(P.targets[D[1]], 12);
  const it = pen(P, rotation(D)); assert.strictEqual(it.target_deviation, 120); assert.strictEqual(Object.keys(it).filter(k => it[k]).join(","), "target_deviation");
});
test("0.5 人換算（比重）: 比重 1・1・1・0.5 の 4 名で 60 枠 → 17.14・17.14・17.14・8.57 → 端数の大きい 0.5 の人に 1 を足して 17・17・17・9", () => {
  const { R, m, D } = base({ n: 4, share: [1, 1, 1, 0.5] }); const P = new T.Problem(R, m);
  assert.deepStrictEqual(D.map(n => P.targets[n]), [17, 17, 17, 9]); assert.strictEqual(D.reduce((s, n) => s + P.targets[n], 0), 60, "合計は枠の数");
  const { R: R3, m: m3, D: D3 } = base({ n: 3, share: [1, 1, 0.5] }); const P3 = new T.Problem(R3, m3); assert.deepStrictEqual(D3.map(n => P3.targets[n]), [24, 24, 12], "割り切れれば端数なし");
});
test("夜勤の希望: 7 日と 8 日を希望し 8 日だけ入った → 叶わなかった 1 件 × 重み 30 = 30", () => {
  const { R, m, D } = base({ states: { wish_night: "soft" }, weights: { wish_night: 30 }, month: { wishes: { night_on: { "Dr B": [7, 8] } } } }); // 基準では 8 日の夜勤が Dr B、7 日は Dr G
  const it = pen(new T.Problem(R, m), rotation(D)); assert.strictEqual(it.wish_night, 30); assert.strictEqual(Object.keys(it).filter(k => it[k]).join(","), "wish_night");
});
console.log(failed ? `仕様の正解例: ${passed} 件通過、${failed} 件失敗` : `仕様の正解例 ${passed} 件 OK`); if (failed) process.exit(1);

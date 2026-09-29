// 仕様の正解例: 人が期待結果を決めた小さな例で、検算（T.check）と減点（T.penalty）の結果を直接検査する。
// 解く側・検算・減点の突き合わせ（test_penalty / test_brute）は 3 つの実装が一致することを見るが、共通の Problem の読み取りや仕様の解釈を同じように
// 間違えると通ってしまう。ここでは規則の文（README・rule-modules・各規則の冒頭の説明）から人が決めた「人数はいくつ・違反か許容か・減点はいくつ」を書き、
// コードを読まずに立てた期待値と突き合わせる。期待値の根拠は各例のコメントに書く。名前はすべて架空（同梱の 2 交代プロファイル）
const fs = require("fs"), vm = require("vm"), path = require("path"), assert = require("assert");
globalThis.T = {};
for (const f of ["i18n.js", "rules-core.js", "model.js", "messages.js", "solver.js", "check.js", "report.js"]) vm.runInThisContext(fs.readFileSync(path.join(__dirname, "src", f), "utf8"), { filename: f });
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
test("連勤の指摘の数え方: 上限 4 で 1〜6 日勤務、1 日だけ固定 → 固定が絡む窓（1〜5 日）は許容 1、絡まない窓（2〜6 日）は違反 1。減点なら窓ごと: 重み 100 × 2 = 200", () => {
  // 「6 連勤でも 1 件」は各窓の固定の関与が同じときのまとめ表示。関与が違う窓は分けて出る。減点は max+1 日の窓ごと（5 日の窓が 2 つ）
  const { R, m, D } = base({ states: { run_length_max: "hard" }, rules: { run_length: { max: 4 } }, month: { fixed: { day: { 1: "Dr B" } } } });
  const a = rotation(D); for (const d of [2, 3, 4, 5, 6]) a[`${d}:day`].work = "Dr B";
  const r = T.check(new T.Problem(R, m), a); assert.deepStrictEqual(codes(r), ["RUN_TOO_LONG"]); assert.deepStrictEqual(wcodes(r), ["RUN_TOO_LONG"]);
  const { R: R2, m: m2 } = base({ states: { run_length_max: "soft" }, rules: { run_length: { max: 4 } }, weights: { run_length_over: 100 } });
  const it = pen(new T.Problem(R2, m2), a); assert.strictEqual(it.run_length_over, 200);
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
test("按分の同率: 比重が全員 1 の 5 名で 62 枠（12 月）→ 12.4 ずつ。余り 2 は「履歴の過不足が少ない → 年数が短い → 名簿の順」で決める", () => {
  const years = [30, 20, 10, 40, 50];
  const mk = (bal) => { const b = base({ n: 5, share: [1, 1, 1, 1, 1], month: Object.assign({ year: 2026, month: 12, holidays: [] }, bal ? { history: { work_balance: bal } } : {}) }); b.R.doctors.forEach((d, i) => { d.years = years[i]; }); return b; };
  let { R, m, D } = mk(null); let P = new T.Problem(R, m); assert.strictEqual(P.N, 31); assert.deepStrictEqual(D.map(n => P.targets[n]), [12, 13, 13, 12, 12], "年数の短い 2 人（10・20 年）に");
  ({ R, m, D } = mk({ [D[4]]: -2 })); P = new T.Problem(R, m); assert.deepStrictEqual(D.map(n => P.targets[n]), [12, 12, 13, 12, 13], "履歴で不足している人が先、次に年数の短い人");
  ({ R, m, D } = mk(null)); R.doctors.forEach(d => { d.years = 10; }); P = new T.Problem(R, m); assert.deepStrictEqual(D.map(n => P.targets[n]), [13, 13, 12, 12, 12], "全部同じなら名簿の順");
});
test("週休日（外勤のある人）: 休日の日勤か休日前日の夜勤が 1 回以上。平日の日勤だけでは違反 1（減点なら 100）、土曜の日勤 1 回で 0", () => {
  const { R, m, D } = base({ states: { rest_day: "hard" }, weights: { rest_day_missing: 100 }, month: { duty_days: { "Dr B": { 5: { am: "external" } } } } }); // Dr B は 5 日午前に外勤
  const others = D.filter(n => n !== "Dr B"); const a = rotation(others); a["4:day"].work = "Dr B"; // 4 日（水）の日勤だけ
  let r = T.check(new T.Problem(R, m), a); assert.deepStrictEqual(codes(r), ["REST_DAY_MISSING"]);
  const { R: R2, m: m2 } = base({ states: { rest_day: "soft" }, weights: { rest_day_missing: 100 }, month: { duty_days: { "Dr B": { 5: { am: "external" } } } } }); assert.strictEqual(pen(new T.Problem(R2, m2), a).rest_day_missing, 100);
  a["4:day"].work = others[3]; a["7:day"].work = "Dr B"; r = T.check(new T.Problem(R, m), a); assert.strictEqual(r.V.length, 0, "土曜（7 日）の日勤で成立"); assert.strictEqual(pen(new T.Problem(R2, m2), a).rest_day_missing || 0, 0);
});
test("夜勤の希望: 7 日と 8 日を希望し 8 日だけ入った → 叶わなかった 1 件 × 重み 30 = 30", () => {
  const { R, m, D } = base({ states: { wish_night: "soft" }, weights: { wish_night: 30 }, month: { wishes: { night_on: { "Dr B": [7, 8] } } } }); // 基準では 8 日の夜勤が Dr B、7 日は Dr G
  const it = pen(new T.Problem(R, m), rotation(D)); assert.strictEqual(it.wish_night, 30); assert.strictEqual(Object.keys(it).filter(k => it[k]).join(","), "wish_night");
});
test("当月目標の自動調整: 日勤 2 名・夜勤 1 名の月は必要枠 90（30 日 ×（2＋1））。目安の合計が 90 なら調整不要（枠の数 60 で数えない）", () => {
  const { R, m } = base({ count: { day: 2 } }); const P = new T.Problem(R, m); // 目安は比重で按分: 90 ÷ 5 = 18 ずつ
  assert.strictEqual(P.slots.length, 60); assert.deepStrictEqual(R.doctors.map(d => P.quota(d.name)), [18, 18, 18, 18, 18]);
  const at = T.autoTargets(R, m); assert.strictEqual(at.slots, 90); assert.strictEqual(at.quotaSum, 90); assert.deepStrictEqual(at.targets, {}, "調整なし"); assert.ok(at.lines.some(l => /調整不要/.test(l)), at.lines.join(" / "));
  const { R: R2, m: m2 } = base({ count: { day: 2 } }); R2.profile.quota_mode = "absolute"; R2.doctors.forEach(d => { d.quota = 17; }); // 目安を 17 ずつ（合計 85）にすると、足りない 5 枠分を ±1 の範囲で 1 ずつ増やす
  const at2 = T.autoTargets(R2, m2); assert.strictEqual(at2.slots, 90); assert.strictEqual(at2.quotaSum, 85); assert.deepStrictEqual(Object.values(at2.targets), [18, 18, 18, 18, 18]);
});
test("連日・勤務間隔は日で数える: 15 日の日勤＋夜勤だけの人に、連日（14→15・15→16）も中 1 日・中 2 日も付かない。ほかの 4 名は 1 日おきで、中 1 日の組は 12＋12＋14＋14＝52", () => {
  // 奇数日（15 日を除く）は D[1] が日勤・D[2] が夜勤、偶数日は D[3] が日勤・D[4] が夜勤、15 日は D[0] が両方。実際に連日で働く人はいない
  const mk = states => base({ states: Object.assign({ same_day_double: "off" }, states), weights: { consecutive_days: 200, work_gap_1: 20, work_gap_2: 7 } });
  const asgOf = D => { const a = {}; for (let d = 1; d <= 30; d++) { const odd = d % 2 === 1; a[`${d}:day`] = { work: d === 15 ? D[0] : odd ? D[1] : D[3], oc: [] }; a[`${d}:night`] = { work: d === 15 ? D[0] : odd ? D[2] : D[4], oc: [] }; } return a; };
  { const { R, m, D } = mk({ consecutive_days: "hard" }); const r = T.check(new T.Problem(R, m), asgOf(D)); assert.strictEqual(r.V.length, 0, "連日の違反なし: " + codes(r).join(",")); assert.strictEqual(r.W.length, 0); }
  { const { R, m, D } = mk({ consecutive_days: "soft" }); const it = pen(new T.Problem(R, m), asgOf(D)); assert.ok(!it.consecutive_days, "連日の減点 0（以前は 2 組 × 200）: " + it.consecutive_days); }
  { const { R, m, D } = mk({ work_gap: "soft" }); const it = pen(new T.Problem(R, m), asgOf(D)); assert.strictEqual(it.work_gap_1, 52 * 20, "中 1 日は 52 組"); assert.ok(!it.work_gap_2, "中 2 日は 0（1 日おきの人は 3 日離れた日に働かない）"); }
  // 対照: 実際の連日は数える（D[1] を 16 日の日勤にも入れると 15 日の人ではなく D[1] の 1 組… 17 日と連日）
  { const { R, m, D } = mk({ consecutive_days: "soft" }); const a = asgOf(D); a["16:day"].work = D[1]; const it = pen(new T.Problem(R, m), a); assert.strictEqual(it.consecutive_days, 200, "16→17 の 1 組"); }
});
test("OC の検算: 当番候補でない人（配置しない）の OC と、同じ人を重ねた OC は構造の違反（人数を満たした扱いにしない）", () => {
  const R = JSON.parse(fs.readFileSync(path.join(__dirname, "data/rules.json"), "utf8")); T.fillDefaultRules(R); const m = T.normalizeMonth(JSON.parse(fs.readFileSync(path.join(__dirname, "data/202611.json"), "utf8")), R), asg = JSON.parse(fs.readFileSync(path.join(__dirname, "data/js_assignment.json"), "utf8"));
  const P0 = new T.Problem(R, m); assert.strictEqual(T.check(P0, asg).V.length, 0, "同梱の割当は違反なし");
  const key = Object.keys(asg).find(k => (asg[k].oc || []).length >= 1), who = asg[key].oc[0];
  const R2 = clone(R); R2.doctors.find(d => d.name === who).duty = "never"; const r2 = T.check(new T.Problem(R2, m), asg); assert.ok(codes(r2).includes("SLOT_OC_UNKNOWN"), "候補から外した人の OC: " + codes(r2).join(","));
  const key2 = Object.keys(asg).find(k => (asg[k].oc || []).length >= 2); assert.ok(key2, "OC 2 名の枠がある"); const a3 = clone(asg); a3[key2].oc = [a3[key2].oc[0], a3[key2].oc[0]];
  const r3 = T.check(P0, a3); assert.ok(codes(r3).includes("SLOT_OC_DUP"), "同じ人の重複: " + codes(r3).join(","));
});
test("説明資料の延べ人数: 日勤 2 名・夜勤 1 名で毎日 3 人が別の人なら 30 日 × 3 ＝ 90（1 枠の先頭の人だけを数えない）", () => {
  const { R, m, D } = base({ count: { day: 2 }, states: { staff_per_day: "soft" }, weights: { staff_per_day: 1 } }); const P = new T.Problem(R, m), a = rotation(D, 30, 2);
  assert.strictEqual(T.check(P, a).V.length, 0); assert.strictEqual(pen(P, a).staff_per_day, 90, "減点の数え方は 90");
  const txt = JSON.stringify(T.buildReport(P, a)); assert.ok(/当番に入った延べ人数[^"]*: 90/.test(txt), "説明資料も 90: " + (txt.match(/当番に入った延べ人数[^"]*/) || [""])[0]);
});
test("「OC なし」の固定: その役割の OC が残っている割当は固定との不一致（違反）。OC を外せば違反なし（省略は減点）。固定が無ければ元の割当は違反なし", () => {
  const R = JSON.parse(fs.readFileSync(path.join(__dirname, "data/rules.json"), "utf8")); T.fillDefaultRules(R); const m = T.normalizeMonth(JSON.parse(fs.readFileSync(path.join(__dirname, "data/202611.json"), "utf8")), R), asg = JSON.parse(fs.readFileSync(path.join(__dirname, "data/js_assignment.json"), "utf8"));
  const P0 = new T.Problem(R, m), jr = P0.refId("junior"); assert.ok(jr, "補助の役割がある"); assert.strictEqual(T.check(P0, asg).V.length, 0);
  for (const kind of ["night", "day"]) { const key = Object.keys(asg).find(k => k.endsWith(":" + kind) && (asg[k].oc || []).some(n => P0.team[n] === jr)); assert.ok(key, kind + " に補助の OC がいる枠がある"); const d = +key.split(":")[0];
    const m2 = clone(m); (m2.fixed[kind + "_oc_none"] ||= {})[d] = [jr]; const P2 = new T.Problem(R, m2), r2 = T.check(P2, asg); assert.deepStrictEqual(codes(r2), ["FIXED_OC_NONE"], kind + ": OC が残っていれば違反 1 件: " + codes(r2).join(",")); assert.strictEqual(r2.W.length, 0, "固定による許容にしない");
    const a3 = clone(asg); a3[key].oc = a3[key].oc.filter(n => P0.team[n] !== jr); assert.ok(!codes(T.check(P2, a3)).includes("FIXED_OC_NONE"), kind + ": 外せば不一致なし"); }
});
test("予備の役割: 登用を許した月でも月 1 回まで。0 回・1 回は違反なし、2 回は違反（固定していても許容にしない）。許していない月は 1 回でも違反", () => {
  const { R, m, D } = base({ states: { same_day_double: "off" } }); R.profile.roles = [{ id: "S", label: "職員", refs: ["charge", "other", "junior"] }, { id: "C", label: "予備", refs: ["reserve"] }]; R.doctors[0].team = "C"; R.doctors[0].duty = "no_unless_needed";
  const others = D.slice(1), mk = k => { const a = {}; for (let d = 1; d <= 30; d++) { a[`${d}:day`] = { work: others[(d - 1) % 4], oc: [] }; a[`${d}:night`] = { work: others[(d + 1) % 4], oc: [] }; } if (k >= 1) a["4:night"].work = D[0]; if (k >= 2) a["10:night"].work = D[0]; return a; };
  const Pon = new T.Problem(R, Object.assign(clone(m), { allow_chief_duty: true })), Poff = new T.Problem(R, clone(m)); assert.ok(Pon.isRole(D[0], "reserve"), "予備の役割");
  assert.ok(!codes(T.check(Pon, mk(0))).some(c => /^RESERVE/.test(c))); assert.ok(!codes(T.check(Pon, mk(1))).some(c => /^RESERVE/.test(c)), "1 回は違反なし");
  const r2 = T.check(Pon, mk(2)); assert.deepStrictEqual(codes(r2).filter(c => /^RESERVE/.test(c)), ["RESERVE_OVER"], "2 回は違反");
  const mf = Object.assign(clone(m), { allow_chief_duty: true }); mf.fixed.night[4] = D[0]; mf.fixed.night[10] = D[0]; const rf = T.check(new T.Problem(R, mf), mk(2)); assert.ok(codes(rf).includes("RESERVE_OVER"), "固定していても違反"); assert.ok(!wcodes(rf).includes("RESERVE_OVER"));
  assert.deepStrictEqual(codes(T.check(Poff, mk(1))).filter(c => /^RESERVE/.test(c)), ["RESERVE_ASSIGNED"], "許していない月は 1 回でも違反"); assert.deepStrictEqual(codes(T.check(Poff, mk(2))).filter(c => /^RESERVE/.test(c)), ["RESERVE_ASSIGNED"], "許していない月は登用の違反 1 件にまとめる");
});
test("OC を含む隣接枠の連続: 勤務→勤務は 0（連日の規則が扱う）。OC→勤務・勤務→OC・OC→OC は各 1 件 × 重み 6。翌月 1 日の固定が実勤務なら、月末の夜は OC のときだけ数える", () => {
  const mk = month => base({ states: { oc_consecutive: "soft", same_day_double: "off" }, weights: { oc_consecutive: 6 }, month });
  const { R, m, D } = mk(), P = new T.Problem(R, m), a0 = rotation(D); assert.ok(!pen(P, a0).oc_consecutive, "基準の割当は連続なし"); // 基準: 5 日夜勤 D[2]、6 日日勤 D[0]・夜勤 D[3]
  const w5n = a0["5:night"].work, w6d = a0["6:day"].work, other = D.find(n => ![w5n, w6d, a0["6:night"].work, a0["4:night"].work].includes(n));
  { const a = clone(a0); a["6:day"].work = w5n; assert.ok(!pen(P, a).oc_consecutive, "勤務→勤務は数えない: " + pen(P, a).oc_consecutive); }
  { const a = clone(a0); a["5:night"].oc = [w6d]; assert.strictEqual(pen(P, a).oc_consecutive, 6, "OC→勤務"); }
  { const a = clone(a0); a["6:day"].oc = [w5n]; assert.strictEqual(pen(P, a).oc_consecutive, 6, "勤務→OC"); }
  { const a = clone(a0); a["5:night"].oc = [other]; a["6:day"].oc = [other]; assert.strictEqual(pen(P, a).oc_consecutive, 6, "OC→OC は 1 件"); }
  const w30 = a0["30:night"].work, oth = D.find(n => n !== w30 && n !== a0["30:day"].work && n !== a0["29:night"].work);
  { const x = mk({ fixed: { night: { 31: w30 } } }), Px = new T.Problem(x.R, x.m); assert.ok(!pen(Px, a0).oc_consecutive, "月末の夜勤→翌月 1 日の夜勤（固定）は勤務→勤務: " + pen(Px, a0).oc_consecutive); }
  { const x = mk({ fixed: { night: { 31: oth } } }), Px = new T.Problem(x.R, x.m), a = clone(a0); a["30:night"].oc = [oth]; assert.strictEqual(pen(Px, a).oc_consecutive, 6, "月末の夜の OC→翌月 1 日の夜勤（固定）"); }
  { const x = mk({ fixed: { night_oc: { 31: [w30] } } }), Px = new T.Problem(x.R, x.m); assert.strictEqual(pen(Px, a0).oc_consecutive, 6, "月末の夜勤→翌月 1 日の OC（固定）"); }
});
test("説明資料の休みと 2 連休: 検算と同じ数え方。明けを休みに数えず、続いた休みを 1 回と数える設定で、1 日の夜勤だけの人は休み 28 日・2 連休 1 回（最低 2 回に足りない印が付く）", () => {
  const { R, m, D } = base({ states: { days_off_min: "soft", days_off_pair: "soft", same_day_double: "off" }, rules: { days_off: { min: 8, ake_is_off: false, pair_count: "runs", pair_min: 2 } } });
  const P = new T.Problem(R, m), others = D.slice(1), a = {}; for (let d = 1; d <= 30; d++) { a[`${d}:day`] = { work: others[(d - 1) % 4], oc: [] }; a[`${d}:night`] = { work: d === 1 ? D[0] : others[(d + 1) % 4], oc: [] }; }
  const cc = T.rules.checkCtx(P, new T.Asg(P, a), "check", () => { }); assert.strictEqual(cc.offDays(D[0]).length, 28, "休みは 3〜30 日"); assert.strictEqual(cc.pairs(D[0]), 1, "続いた休みは 1 回");
  const s6 = T.buildReport(P, a).sections.find(s => /月の休みの日数と 2 連休/.test(s.html)).html, row = s6.slice(s6.indexOf("月の休みの日数と 2 連休")).match(new RegExp("<td>" + D[0] + "</td><td>(.*?)</td><td>(.*?)</td>"));
  assert.ok(row, "表に行がある"); assert.strictEqual(row[1].replace(/<[^>]+>/g, ""), "28", "説明資料の休み"); assert.strictEqual(row[2].replace(/<[^>]+>/g, ""), "1", "説明資料の 2 連休"); assert.ok(/class="ng"/.test(row[2]), "2 連休の不足の印"); assert.ok(!/class="ng"/.test(row[1]));
  const R2 = clone(R); R2.days_off = { min: 8, ake_is_off: true, pair_count: "pairs", pair_min: 2 }; const P2 = new T.Problem(R2, m), s62 = T.buildReport(P2, a).sections.find(s => /月の休みの日数と 2 連休/.test(s.html)).html, row2 = s62.slice(s62.indexOf("月の休みの日数と 2 連休")).match(new RegExp("<td>" + D[0] + "</td><td>(.*?)</td><td>(.*?)</td>"));
  assert.strictEqual(row2[1].replace(/<[^>]+>/g, ""), "29", "明けを休みに数える設定"); assert.strictEqual(row2[2].replace(/<[^>]+>/g, ""), "28", "続く 2 日の組の数");
});
console.log(failed ? `仕様の正解例: ${passed} 件通過、${failed} 件失敗` : `仕様の正解例 ${passed} 件 OK`); if (failed) process.exit(1);

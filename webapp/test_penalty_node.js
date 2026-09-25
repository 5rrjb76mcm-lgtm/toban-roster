// 減点の二重実装の突き合わせ。node test_penalty_node.js <highs パッケージのパス>
// 解いた割当について、検算の側で数え直した減点の合計（check.js の penalty）と、解く側の目的関数の値
// （同じ割当に全枠を固定して解いた値。補助変数まで最適にした値）が一致することを、施設の見本と規則の状態を変えた設定で確かめる。
// 必須条件は検算（check）が独立に見ているので、これで制約と減点の両方が二重に確かめられる
const fs = require("fs"), vm = require("vm"), path = require("path");
globalThis.T = {};
for (const f of ["i18n.js", "rules-core.js", "model.js", "messages.js", "solver.js", "check.js"]) vm.runInThisContext(fs.readFileSync(path.join(__dirname, "src", f), "utf8"), { filename: f });
for (const f of fs.readdirSync(path.join(__dirname, "src/rules")).filter(x => x.endsWith(".js"))) vm.runInThisContext(fs.readFileSync(path.join(__dirname, "src/rules", f), "utf8"), { filename: "rules/" + f }); // 規則のプラグイン
for (const f of fs.readdirSync(path.join(__dirname, "src/calendars")).filter(x => x.endsWith(".js"))) vm.runInThisContext(fs.readFileSync(path.join(__dirname, "src/calendars", f), "utf8"), { filename: "calendars/" + f }); // 暦のプラグイン
for (const q of fs.readdirSync(path.join(__dirname, "lang"))) T.registerLang(JSON.parse(fs.readFileSync(path.join(__dirname, "lang", q), "utf8")));
const rd = f => JSON.parse(fs.readFileSync(path.join(__dirname, f), "utf8"));
T.DEFAULT_RULES = rd("data/rules.json");
const clone = o => JSON.parse(JSON.stringify(o));
const fixW = r => { T.fillDefaultRules(r); if (r.unit_weights) for (const k of Object.keys(r.weights)) r.weights[k] = 1; return r; };
const withStates = (rules, st) => { const r = clone(rules); r.rule_states = Object.assign({}, r.rule_states, st); return fixW(r); };
const small = (rules, k, quota) => { const r = clone(rules); r.doctors = r.doctors.slice(0, k).map(d => Object.assign({}, d, { quota })); r.name_order = r.doctors.map(d => d.name); T.fillDefaultRules(r); return r; };
// 重みを全部 1 にする（乱数の重みで崩したとき、ふだんは大きな減点で避けられる項にも点が付くように。式の正しさは重みの値によらない）
const unitW = rules => { const r = clone(rules); r.unit_weights = true; return r; }; // withStates / fixW で規則の既定を埋めた後に 1 にそろえる
const ALL_SOFT = { same_day_double: "soft", consecutive_days: "soft", friday_night_min: "soft", weekend_balance: "soft", rest_day: "soft", 
  run_length_max: "soft", run_length_min: "soft", days_off_min: "soft", days_off_pair: "soft", shift_sequence: "soft" };
const plainMonth = rules => T.normalizeMonth({ year: 2026, month: 11, holidays: [3, 23], next_month_first_day_is_holiday: false }, rules);

const card = T.DEFAULT_RULES, m202611 = rd("data/202611.json"), saved = rd("data/202611_data_test.json");
const two = small(rd("data/profiles/two-shift.json"), 5, 12);
const ward = (() => { const r = small(rd("data/fixtures/ward-2shift.json"), 7, 13); r.profile = Object.assign({}, r.profile, { positions: { work: { count: { day: 2, night: 1 } } } }); T.fillDefaultRules(r); return r; })();
const onc = rd("data/profiles/oncall-min.json"); T.fillDefaultRules(onc);
const CASES = [
  ["循環器・保存データ（避けたい日あり）", saved.rules, saved.month],
  ["循環器・既存案からの変更と部長の登用", saved.rules, Object.assign(clone(saved.month), { allow_chief_duty: true }), { base: saved.result.asg }],
  ["循環器・固定指定が連続と重なる", saved.rules, (() => { const m = T.normalizeMonth(clone(saved.month), saved.rules); m.fixed.day = { 3: "Dr N" }; m.fixed.night = { 3: "Dr N", 4: "Dr N" }; return m; })()],
  ["循環器・減点にできる規則をすべて減点、重み 1", withStates(unitW(saved.rules), ALL_SOFT), Object.assign(clone(saved.month), { allow_chief_duty: true }), { seeds: [11, 12, 13, 14, 15, 16] }],
  ["循環器・曜日パターン", card, m202611],
  ["循環器・日勤にオンコールを付けない", (() => { const r = clone(card); r.profile = Object.assign({}, r.profile, { shifts: [{ id: "day", on: "off_days", oncall: false }, { id: "night", on: "all" }] }); r.rule_states = Object.assign({}, r.rule_states, { period_charge: "off", }); return fixW(r); })(), m202611],
  ...["202611_daymode", "202611_fixedoc", "202611_noconnfix", "202611_rebuilt_month"].map(f => [`循環器・${f}`, card, rd(`data/${f}.json`)]),
  ["循環器・連日と同日2枠を減点", withStates(card, { same_day_double: "soft", consecutive_days: "soft" }), m202611],
  ["循環器・金曜・土日の均等・週休日を減点", withStates(card, { friday_night_min: "soft", weekend_balance: "soft", rest_day: "soft", }), m202611],
  ["循環器・連勤と休みの規則を減点で追加", withStates(card, { run_length_max: "soft", run_length_min: "soft", days_off_min: "soft", days_off_pair: "soft", shift_sequence: "soft" }), m202611],
  ["循環器・同じ曜日を必須", withStates(card, { same_weekday_cap: "hard" }), m202611],
  ["2交代", two, plainMonth(two)],
  ["2交代・連勤と休みを減点", withStates(two, { run_length_max: "soft", shift_sequence: "soft", days_off_min: "soft", run_length_min: "soft" }), plainMonth(two)],
  ["2交代・減点にできる規則をすべて減点、重み 1", withStates(unitW(two), ALL_SOFT), plainMonth(two)],
  // 2 人で 60 枠を回す（同じ日に 2 枠は必須のまま。毎日勤務になり、連勤・明け・休みの日数・2 連休に必ず点が付く）
  ["2交代・2人で回す、減点、重み 1", withStates(unitW(small(rd("data/profiles/two-shift.json"), 2, 30)), Object.assign({}, ALL_SOFT, { same_day_double: "hard" })), plainMonth(two)],
  ["病棟（1枠複数名）", ward, plainMonth(ward)],
  ["看護師2交代", fixW(rd("data/profiles/nurse-2shift.json")), plainMonth(fixW(rd("data/profiles/nurse-2shift.json")))],
  ["看護師2交代・構成と休みを減点、重み 1", withStates(unitW(rd("data/profiles/nurse-2shift.json")), { composition: "soft", days_off_min: "soft", days_off_pair: "soft", run_length_max: "soft", shift_sequence: "soft" }), plainMonth(fixW(rd("data/profiles/nurse-2shift.json")))],
  ["オンコールなし最小", onc, plainMonth(onc)],
];

// プラグインが持つ試験用の設定（fixtures）を設定の一覧に足す。base は見本の名前（cardiology は保存データ、他は data/profiles）
const BASES = { cardiology: () => [saved.rules, saved.month], "two-shift": () => [two, plainMonth(two)], "ward-2shift": () => [ward, plainMonth(ward)],
  "oncall-min": () => [onc, plainMonth(onc)], "nurse-2shift": () => { const r = fixW(rd("data/profiles/nurse-2shift.json")); return [r, plainMonth(r)]; } };
for (const def of T.RULE_DEFS) for (const fx of def.fixtures || []) {
  const [r0, m0] = BASES[fx.base || "cardiology"](); const r = fx.unitWeights ? unitW(r0) : clone(r0);
  if (fx.rules) Object.assign(r, clone(fx.rules)); // プラグインの値の上書き（点が付きやすい値にする）
  CASES.push([`プラグイン ${def.id}: ${fx.label}`, withStates(r, fx.states || {}), m0, fx.extra]);
}

(async () => {
  const highs = await require(process.argv[2])();
  let bad = 0; const seen = new Set();
  // 各設定で 3 通り: 解いた割当（最適までは求めない）と、乱数の重みで崩した割当 2 つ（必須条件は満たすが最適でない。ふだん 0 点の項にも点が付く）
  const RUNS = [["解いた割当", null], ["崩し1", { seed: 1, scale: 60 }], ["崩し2", { seed: 7, scale: 400 }]];
  for (const [label, rules, month0, extra] of CASES) for (const [rl, jitter] of RUNS.concat(((extra && extra.seeds) || []).map(seed => [`崩し種${seed}`, { seed, scale: 60 }]))) {
    const t0 = Date.now();
    try {
      const month = T.normalizeMonth(clone(month0), rules), P = new T.Problem(rules, month);
      const base = extra && extra.base || null;
      const r = jitter ? T.solve(P, highs, { timeLimit: 8, mipGap: 0.2, jitter, base }) : await T.solveWithAvoidRef(P, highs, { timeLimit: 8, mipGap: 0.1, base });
      if (!r.asg) throw new Error("解なし（" + r.status + "）");
      const c = T.check(P, r.asg); if (c.V.length) throw new Error("検算の違反: " + c.V.slice(0, 2).join(" / "));
      const opts = { avoidRef: r.avoidRef || null, base };
      const pen = T.penalty(P, r.asg, opts), pin = T.solve(P, highs, Object.assign({ timeLimit: 60, pin: r.asg }, opts));
      if (pin.status !== "Optimal") throw new Error("固定して解けない（" + pin.status + "）");
      const ok = Math.abs(pen.total - pin.objective) < 1e-6;
      console.log(`${ok ? "ok  " : "FAIL"} ${label}（${rl}）: 検算 ${pen.total} / 解く側 ${pin.objective}（${((Date.now() - t0) / 1000).toFixed(1)} 秒）` + (ok ? "" : "\n      内訳（検算）: " + JSON.stringify(pen.items)));
      if (!ok) bad++;
      for (const k of Object.keys(pen.items)) seen.add(k);
    } catch (e) { bad++; console.log(`FAIL ${label}（${rl}）: ${e.message}`); }
  }
  // どの設定でも 0 点だった項は、この試験では確かめられていない（黙って網羅したことにしない）
  const all = new Set(Object.keys(T.DEFAULT_RULES.weights).concat(T.RULE_DEFS.map(d => d.weight).filter(Boolean)));
  console.log("点が付いて確かめられた項: " + [...seen].sort().join(", "));
  console.log("どの設定でも 0 点で確かめられていない項: " + ([...all].filter(k => !seen.has(k)).sort().join(", ") || "なし"));
  // プラグイン（fixtures を持つもの）の重みは、どこかで点が付いていなければ失敗（プラグインの減点が試されたことにならない）
  for (const def of T.RULE_DEFS) if ((def.fixtures || []).length && def.weight && !seen.has(def.weight)) { bad++; console.log(`FAIL プラグイン ${def.id} の重み ${def.weight} にどの設定でも点が付いていない`); }
  console.log(bad ? `${bad} 件で減点の合計が食い違う` : `減点の合計はすべて一致（${CASES.length} 設定 × ${RUNS.length} 通り）`);
  process.exitCode = bad ? 1 : 0;
})();

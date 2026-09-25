// 総当たりとの突き合わせ。node test_brute_node.js <highs パッケージのパス>
// 一度解いた割当のうち、数枠（窓）だけを空けて残りを固定する。窓に入りうる割当をすべて並べ、検算（check）で必須条件を満たすものを
// 減点（penalty）で採点した最小値と、同じ窓を HiGHS で解いた最適値が一致することを確かめる。
// 検算と減点の数え方は解く側と独立なので、解く側が必須条件をきつく書きすぎて良い割当を捨てている（最適値が総当たりより大きい）、
// あるいは検算が解く側の必須条件を見落としている（総当たりの方が小さい）ことが分かる。
// 加えて、検算が通した割当の一部を全枠固定で解き、解く側が最適でない割当まで不要に禁止していないかを見る
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
const withStates = (rules, st, unit) => { const r = clone(rules); r.rule_states = Object.assign({}, r.rule_states, st); if (unit) r.unit_weights = true; return fixW(r); };
const small = (rules, k, quota) => { const r = clone(rules); r.doctors = r.doctors.slice(0, k).map(d => Object.assign({}, d, { quota })); r.name_order = r.doctors.map(d => d.name); return fixW(r); };
const plainMonth = rules => T.normalizeMonth({ year: 2026, month: 11, holidays: [3, 23], next_month_first_day_is_holiday: false }, rules);
const ALL_SOFT = { consecutive_days: "soft", run_length_max: "soft", run_length_min: "soft", days_off_min: "soft", days_off_pair: "soft", shift_sequence: "soft" };
const days = (...ds) => ds.flatMap(d => [`${d}:day`, `${d}:night`]);
const nights = (...ds) => ds.map(d => `${d}:night`);

const saved = rd("data/202611_data_test.json");
const two = small(rd("data/profiles/two-shift.json"), 5, 12);
const ward = (() => { const r = small(rd("data/fixtures/ward-2shift.json"), 6, 15); r.profile = Object.assign({}, r.profile, { positions: { work: { count: { day: 2, night: 1 } } } }); return fixW(r); })();
const onc = fixW(rd("data/profiles/oncall-min.json"));
// 小さな看護師 2 交代: 8 名、日勤 1〜3 名（幅）、夜勤 2 名。構成（夜勤の1〜2年目は1人まで、日勤にリーダー1人以上）、休みちょうど（明けは数えない）
const nurseS = (() => { const r = JSON.parse(JSON.stringify(rd("data/profiles/nurse-2shift.json")));
  r.doctors = [1, 2, 3, 4, 6, 8, 10, 12].map((y, i) => ({ name: `Ns${i + 1}`, team: "N", years: y, quota: 0 })); r.name_order = r.doctors.map(d => d.name);
  r.profile.positions = { work: { count: { day: 3, night: 2 }, min: { day: 1, night: 2 }, ideal: { day: 2 } } }; r.rule_states.count_target = "soft"; // 日勤は 1〜3 名で理想 2 名
  r.composition = [{ shift: "night", years_max: 2, max: 1 }, { shift: "day", years_min: 5, min: 1 }, { shift: "day", days: "off_days", years_min: 8, min: 1 }]; // 最後は土日祝だけに効く条件
  r.rule_states.shift_balance = "off"; return fixW(r); })();
// [名前, 規則, 月, 窓の一覧, 基準の割当を作るときの崩し（jitter）]
const CASES = [
  ["循環器・土曜の日勤と夜勤", saved.rules, saved.month, [days(7), days(3), nights(5, 6)]],
  ["循環器・月末と翌月1日の接続", saved.rules, saved.month, [days(29), nights(27, 30)]],
  ["循環器・崩した割当から", saved.rules, saved.month, [days(14), nights(10, 11)], { seed: 3, scale: 60 }],
  ["2交代", two, plainMonth(two), [days(10, 11, 12), days(1, 2, 3)]],
  ["2交代・連勤と休みを減点、重み 1", withStates(two, ALL_SOFT, true), plainMonth(two), [days(10, 11, 12), days(28, 29, 30)], { seed: 5, scale: 60 }],
  ["2交代・連勤と休みを必須", withStates(two, { run_length_max: "hard", days_off_min: "hard", days_off_pair: "hard" }), plainMonth(two), [days(14, 15, 16)]],
  ["病棟（1枠複数名）", ward, plainMonth(ward), [days(7, 8)]],
  ["オンコールなし最小", onc, plainMonth(onc), [days(5, 6), days(1, 2)]],
  ["看護師2交代（小）", nurseS, plainMonth(nurseS), [["10:night", "11:day"], nights(12, 13), ["20:day", "20:night"]]],
  ["看護師2交代（小）・休みと連勤を減点、重み 1", withStates(nurseS, { days_off_min: "soft", days_off_pair: "soft", run_length_max: "soft", composition: "soft" }, true), plainMonth(nurseS), [["10:night", "11:day"], nights(12, 13), ["29:day", "29:night"]], { seed: 9, scale: 60 }],
];

// 窓の 1 枠に入りうる割当: 勤務者は当番候補から人数分、OC は待機の役割ごとに勤務者の役割が求める人数（補助の役割は 0 人も）。
// これ以外の OC の組は検算が SLOT_OC_MISMATCH で必ず退けるので、並べなくても網羅したことになる
function optionsOf(P, s) {
  const c = P.countOf(s), lo = P.countMinOf(s), names = P.dutyNames, out = [];
  const combos = (arr, k, st = 0, pre = []) => k === 0 ? [pre] : arr.slice(st).flatMap((x, i) => combos(arr, k - 1, st + i + 1, pre.concat([x])));
  const sets = []; for (let k = lo; k <= c; k++) sets.push(...combos(names, k)); // 人数に幅がある枠は下限〜上限のすべて
  for (const ws of sets) {
    const work = c === 1 ? ws[0] : ws;
    if (c !== 1 || !P.standbyRoleIds.length) { out.push({ work, oc: [] }); continue; }
    const need = P.ocReq[P.team[ws[0]]] || {}, jr = P.refId("junior");
    let ocs = [[]];
    for (const sid of P.standbyRoleIds) {
      const k = +(need[sid] || 0), sizes = sid === jr && k > 0 ? [0, k] : [k];
      const pick = sizes.flatMap(z => combos(P.byRole[sid] || [], z));
      ocs = ocs.flatMap(a => pick.map(b => a.concat(b)));
    }
    for (const oc of ocs) out.push({ work, oc });
  }
  return out;
}

(async () => {
  const highs = await require(process.argv[2])();
  let bad = 0, windows = 0, combos = 0;
  for (const [label, rules, month0, wins, jitter] of CASES) {
    const month = T.normalizeMonth(clone(month0), rules), P = new T.Problem(rules, month);
    const ref = T.solve(P, highs, Object.assign({ timeLimit: 10, mipGap: 0.2 }, jitter ? { jitter } : {}));
    if (!ref.asg) { bad++; console.log(`FAIL ${label}: 基準の割当が作れない（${ref.status}）`); continue; }
    for (const win of wins) {
      const t0 = Date.now(), pin = clone(ref.asg); for (const k of win) delete pin[k];
      const r = T.solve(P, highs, { timeLimit: 60, pin });
      const opts = win.map(k => optionsOf(P, k.split(":").map((x, i) => i ? x : +x)));
      const n = opts.reduce((a, o) => a * o.length, 1);
      let best = Infinity; const idx = win.map(() => 0), feasible = [];
      for (let t = 0; t < n; t++) {
        const a = Object.assign({}, pin); win.forEach((k, i) => { a[k] = opts[i][idx[i]]; });
        if (T.check(P, a).V.length === 0) { const p = T.penalty(P, a).total; feasible.push([a, p]); if (p < best) best = p; }
        for (let i = 0; i < idx.length && ++idx[i] === opts[i].length; i++) idx[i] = 0;
      }
      const hi = r.status === "Optimal" ? r.objective : r.status === "Infeasible" ? Infinity : NaN;
      const ok = hi === best || Math.abs(hi - best) < 1e-6;
      // 最適値の一致だけでは、最適でない割当を解く側が不要に禁止していても見えない。検算が通した割当を（50 通り以下なら全部、多ければ等間隔に 30 通り）選び、
      // 全枠を固定して解けること（解なしにならない）と、減点の合計が一致することも確かめる
      const SAMPLE = feasible.length <= 50 ? feasible.length : 30, step = Math.max(1, Math.floor(feasible.length / SAMPLE)), miss = [];
      for (let i = 0; i < feasible.length && i / step < SAMPLE; i += step) {
        const [a, p] = feasible[i], q = T.solve(P, highs, { timeLimit: 30, pin: a });
        if (q.status !== "Optimal" || Math.abs(q.objective - p) > 1e-6) miss.push(`${win.map(k => k + "=" + JSON.stringify(a[k])).join(" ")} → ${q.status} ${q.objective} / 検算 ${p}`);
      }
      windows++; combos += n; if (!ok || miss.length) bad++;
      console.log(`${ok && !miss.length ? "ok  " : "FAIL"} ${label} [${win.join(" ")}]: 総当たり ${n} 通り（規則を満たす ${feasible.length}）の最小 ${best} / HiGHS ${hi}` +
        `、規則を満たす割当 ${Math.min(SAMPLE, Math.ceil(feasible.length / step))} 通りを固定して解いた食い違い ${miss.length} 件（${((Date.now() - t0) / 1000).toFixed(1)} 秒）` + (miss.length ? "\n      " + miss.slice(0, 2).join("\n      ") : ""));
    }
  }
  console.log(bad ? `${bad} 件で総当たりと食い違う` : `総当たりの最小と HiGHS の最適値はすべて一致（${windows} 窓、${combos} 通り）`);
  process.exitCode = bad ? 1 : 0;
})();

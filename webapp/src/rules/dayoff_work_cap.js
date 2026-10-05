// 規則のプラグイン: 指定した人の土日の実勤務を月の上限日数までにする（dayoff_work_cap）。docs/rule-modules.md
// 名簿の「土日の実勤務の上限（月・日）」の欄で人ごとに日数を決める（rules.dayoff_work_max = {氏名: 日数}。0 も有効、空欄＝指定なし）。家庭の事情などで週末の勤務を減らしたい人に使う。
// 数え方: 土曜・日曜（P.isWeekend）で当月の枠がある日のうち、どれかの枠で実勤務に入った日を 1 日と数える（日勤＋夜勤も 1 日）。OC は数えない。
// 平日は祝日・施設の休日でも数えない（金曜の夜勤、平日の祝日の日勤、年末の平日など）。規則の id と設定のキーは dayoff_ のまま（最初の版は休日全体を数えていた。保存済みの設定をそのまま使えるように変えない）。
// 減点の規則: 上限を超えた日数 × 重み（dayoff_work_excess）。ほかに手が無いときは超えてよい（必須にはしない）。
// 申告で負担が減らないよう、本人の回数が「基準回数」を下回る分には大きな減点（dayoff_work_no_reduction）。基準回数＝この規則と避けたい日を無視した参照解での回数
//（opts.avoidRef。本体の solveWithAvoidRef が 2 段階で計算し、対象者は refDeclarers が本体へ知らせる）。参照解が無いときは当月目標。opts.ignoreAvoid のとき（参照解を作るとき）は何もしない。
// 同じ人が避けたい日も申告していて avoid_days が動いているときは、回数の下支えは avoid_days の側（avoid_no_reduction）に任せる（同じ不足を二重に数えない）。
// 対象外: 予備の役割と「固定したときだけ」の人（P.isExempt。入り方をこの規則では動かせない）。
// 解く側（solve）・減点の数え直し（penalty）は別々に書く（1 つの式から作らない）。
(function () {
// 土曜・日曜のうち当月の枠がある日（祝日・施設の休日でも平日は含めない）
const weekendDays = P => { const out = []; for (let d = 1; d <= P.N; d++) if (P.isWeekend(d) && ["day", "night"].some(k => P.slotExists(d, k))) out.push(d); return out; };
// 欄の値: 0 以上の整数だけを上限として使う（数値でも数字の文字列でも）。それ以外は bad に集めて入力チェックで知らせる
const parse = v => { if (typeof v === "string" && v.trim() === "") return null; const k = typeof v === "number" || typeof v === "string" ? Number(v) : NaN; return Number.isInteger(k) && k >= 0 ? k : NaN; };
const targets = (P, prm) => P.dutyNames.filter(n => prm.max[n] != null && !P.isExempt(n));
// 回数の下支えを avoid_days が受け持つ人（避けたい日を申告していて、avoid_days が動いている）
const guardedByAvoid = (P, n) => P.state("avoid_days") !== "off" && P.avoidSlots(n).length > 0;
const floorOf = (P, opts, n) => { const f = (opts.avoidRef && opts.avoidRef[n] != null) ? +opts.avoidRef[n] : +P.targets[n]; return Number.isFinite(f) ? f : null; };
T.rules.register({
  id: "dayoff_work_cap", api: 1, order: 415, group: "wish",
  label: "指定した人の土日の実勤務を月の上限日数までにする（参照解より回数が減らない範囲で）", states: ["soft", "off"], def: "soft",
  weight: "dayoff_work_excess", w0: 100, sub: ["dayoff_work_no_reduction"], w0sub: { dayoff_work_no_reduction: 1000 },
  read(P, rules) {
    const max = {}, bad = [];
    for (const [n, v] of Object.entries(rules.dayoff_work_max && typeof rules.dayoff_work_max === "object" && !Array.isArray(rules.dayoff_work_max) ? rules.dayoff_work_max : {})) { const k = parse(v); if (k === null) continue; if (Number.isNaN(k)) bad.push(n); else max[n] = k; }
    return { max, bad };
  },
  // 参照解方式の対象者（本体の solveWithAvoidRef が、この人たちの申告を無視した計算での回数を基準回数にする）
  refDeclarers(P, prm) { return targets(P, prm); },

  // 解く側: 人ごとに、土日に実勤務へ入る日数（日ごとの 0/1 の和）− 上限 ≤ 超過。超過 × 重みを目的関数へ。回数は基準回数を下回る分に大きな減点
  solve(ctx, prm) {
    const { P, lp, LP, W, opts } = ctx; if (opts.ignoreAvoid) return;
    const ds = weekendDays(P);
    for (const n of ctx.names) { const max = prm.max[n]; if (max == null || P.isExempt(n)) continue;
      if (ds.length > max) ctx.limit("dayoff_work_cap", LP.sum(ds.map(d => ctx.y(d, n))), "<=", max, { aux: "dwcx", ub: ds.length }); // 土日の日数が上限以下なら超えようがない
      if (guardedByAvoid(P, n)) continue;
      const floor = floorOf(P, opts, n); if (floor === null) continue;
      if (!Number.isInteger(floor)) { lp.objAdd(W.dayoff_work_no_reduction ?? 1000, ctx.fractionalCountDeviation(n, floor, "dwdn", true)); continue; }
      // 不足の上限は基準回数そのもの（勤務 0 回のとき）。上限で回数の下限を暗黙に作らない
      const down = lp.auxInt("dwdn", 0, Math.max(0, floor)); lp.add(down, ">=", LP.sub(floor, ctx.total(n))); lp.objAdd(W.dayoff_work_no_reduction ?? 1000, down); }
  },
  // 減点: 土日に実勤務へ入った日を数え、上限を超えた日数 × 重み。回数が基準回数に足りない分 × 重み
  penalty(ctx, prm) {
    const { P, pos, opts } = ctx, W = P.weights; if (opts.ignoreAvoid) return;
    const ds = weekendDays(P);
    for (const n of ctx.names) { const max = prm.max[n]; if (max == null || P.isExempt(n)) continue;
      const on = ds.filter(d => ctx.anyWork(n, d)).length;
      ctx.add("dayoff_work_excess", P.softW("dayoff_work_cap"), pos(on - max));
      if (guardedByAvoid(P, n)) continue;
      const floor = floorOf(P, opts, n); if (floor === null) continue;
      ctx.add("dayoff_work_no_reduction", W.dayoff_work_no_reduction ?? 1000, pos(floor - P.slots.filter(s => ctx.worked(n, s)).length)); }
  },
  columns: [{ key: "dwm", order: 15, label: "土日の実勤務の上限（月・日）",
    // 文字の欄にする（数の欄だと、読み込んだ値が数字でないとき空に見えて、無関係な編集の読み戻しで黙って消える）。全角の数字は半角に直して読む
    render(d, R, h) { const v = (R.dayoff_work_max || {})[d.name]; return `<input type="text" inputmode="numeric" data-f="dwm" value="${h.esc(v ?? "")}" placeholder="―" style="width:3.5em" title="${h.esc(h.tx("土曜・日曜の実勤務は月に何日までか。空欄＝指定なし、0＝土日の実勤務なし。OC と平日（祝日を含む）の勤務は数えません"))}">`; },
    begin() { return {}; },
    read(td, d, R, acc, name) { const raw = String(td.querySelector("[data-f=dwm]").value || "").replace(/[０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0)).trim(); if (raw === "") return; const k = parse(raw); acc[name] = Number.isNaN(k) ? raw : k; },
    end(R, acc) { R.dayoff_work_max = acc; },
    rename(R, o, n) { const m = R.dayoff_work_max || {}; if (m[o] !== undefined) { m[n] = m[o]; delete m[o]; } } }],
  ui: { render(R, h) { return `<span class="note">${h.esc(h.tx("日数は名簿の「土日の実勤務の上限」の欄で人ごとに指定します（空欄の人には何もしません）。上限を超えるのは、ほかに手が無いときだけです。"))}</span>`; } },
  summary(P, prm, tv) { return tv("対象: {who}", { who: targets(P, prm).map(n => tv("{who} 月{n}日まで", { who: n, n: prm.max[n] })).join(T.listSep()) || tv("なし") }); },
  messages: {
    LINT_DAYOFF_WORK_BAD_VALUE: { en: "The cap on weekend work for {who} is not a whole number of 0 or more (ignored)", ja: "{who} の「土日の実勤務の上限」が 0 以上の整数ではありません（この指定は使いません）" },
    LINT_DAYOFF_WORK_BAD_VALUE_HINT: { en: "Settings → roster: enter a whole number such as 1, or clear the cell", ja: "設定タブ → 名簿 の「土日の実勤務の上限」に 1 などの整数を入れるか、空欄にしてください" },
    LINT_DAYOFF_WORK_FIXED_OVER: { en: "{who}: work is hand-fixed on {count} weekend days ({days}), above this person's cap of {max}. This can be solved (the days above the cap cost a penalty)", ja: "{who}: 土日の実勤務を {count} 日（{days}）固定していて、本人の上限 {max} 日を超えています。このまま計算できます（超えた日数は減点）" },
    LINT_DAYOFF_WORK_FIXED_OVER_HINT: { en: "Leave it if intended. Otherwise remove a fixed assignment or raise the cap in the roster", ja: "意図どおりならそのままで構いません。そうでなければ固定を外すか、名簿の上限を見直してください" },
  },
  // 入力チェック: 欄の値が整数でない人、固定した土日の実勤務だけで上限を超える人（知らせるだけ。計算は止めない）
  lint(ctx, prm) {
    const { P } = ctx, ds = weekendDays(P);
    for (const n of prm.bad) if (P.doctors[n]) ctx.push("LINT_DAYOFF_WORK_BAD_VALUE", { who: n });
    for (const n of targets(P, prm)) { const fx = ds.filter(d => ["day", "night"].some(k => P.slotExists(d, k) && P.isFixedWork([d, k], n)));
      if (fx.length > prm.max[n]) ctx.push("LINT_DAYOFF_WORK_FIXED_OVER", { who: n, count: fx.length, max: prm.max[n], days: fx.map(d => P.label(d)).join(T.listSep()) }); }
  },
  fixtures: [
    { label: "土日の実勤務の上限（0 日と 1 日の人）", base: "cardiology", rules: { dayoff_work_max: { "Dr L": 0, "Dr M": 1, "Dr N": 0, "Dr P": 1 } } },
    { label: "土日の実勤務の上限、重み 1", base: "cardiology", rules: { dayoff_work_max: { "Dr L": 0, "Dr M": 0, "Dr N": 0, "Dr P": 0, "Dr Q": 1 } }, unitWeights: true },
  ],
  // 説明資料の第 9 節（調整目標の達成状況）の行
  report(ctx, prm) {
    const { P, t, opts } = ctx, ds = weekendDays(P);
    for (const n of ctx.names) { const max = prm.max[n]; if (max == null || P.isExempt(n)) continue;
      const on = ds.filter(d => ctx.anyWork(n, d)), tot = P.slots.filter(s => ctx.worked(n, s)).length, ref = opts.avoidRef ? opts.avoidRef[n] : null;
      const days = on.map(d => P.label(d)).join(ctx.sep());
      const result = !on.length ? t("土日の実勤務なし") : on.length > max ? t("{n}日（{days}）。上限を {over} 日超過＝ほかに手が無いため", { n: on.length, days, over: on.length - max }) : t("{n}日（{days}）", { n: on.length, days });
      const note = (ref != null && tot < ref) ? t("。参照解を下回る＝他の必須条件のため") : (ref == null && tot < P.targets[n]) ? t("。目標未満＝他の必須条件のため") : "";
      ctx.line(t("{who} の土日の実勤務（上限 月{max}日）: {result}。勤務{total}回（当月目標{target}回{refNote}{note}）", { who: n, max, result, total: tot, target: P.targets[n], refNote: ref != null ? t("、申告を無視した参照解では{ref}回", { ref }) : "", note })); }
  },
  python: false,
});
})();

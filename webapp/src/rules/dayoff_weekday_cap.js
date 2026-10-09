// 規則のプラグイン: 休日の同じ曜日に当番へ入る日数の上限（dayoff_weekday_cap）。docs/rule-modules.md
// 休日（土日・祝日・施設の休日）に限って、同じ曜日に当番（勤務か OC）へ入る日数を月 max 日までにする。例: 2 なら日曜は月 2 日まで、土曜も月 2 日まで。
// 日で数える: その日のどの枠でも、勤務か OC で関われば 1 日（日勤 OC＋夜勤も 1 日）。祝日はその曜日で数える。平日の当番の組み方には触れない。
// 「同じ曜日の勤務の上限」（same_weekday_cap）は実勤務だけを枠の数で数える別の規則（OC だけの日曜は数えない）。
// 対象外: 予備の役割。期間責任者になれる役割（規則 period_charge を使う施設）も対象外: 休日への入り方は期間責任者の担当で決まり、偏りは週末担当の均等（weekend_balance）が扱う
// （日曜が 5 回ある月に期間責任者 4 名へ「月 1 日まで」を当てると、それだけで解なしになる）。
// 固定指定だけで上限を超える人は、検算で「固定指定により許容」（解く側は減点 fixed_conflict 付きで許す）。
(function () {
// 曜日ごとの休日の日（当月の枠がある日だけ）
const dayoffByDow = P => { const out = {}; for (let d = 1; d <= P.N; d++) if (P.isHoliday(d) && ["day", "night"].some(k => P.slotExists(d, k))) (out[P.dow(d)] ||= []).push(d); return out; };
const slotsOf = (P, d) => ["day", "night"].filter(k => P.slotExists(d, k)).map(k => [d, k]);
const fixedCount = (ctx, ds, n) => ds.filter(d => slotsOf(ctx.P, d).some(s => ctx.fixedEngAt(s, n))).length;
const exempt = (P, n) => P.isRole(n, "reserve") || (P.isRole(n, "charge") && P.state("period_charge") !== "off");
T.rules.register({
  id: "dayoff_weekday_cap", api: 1, order: 545, group: "combo",
  label: "休日の同じ曜日に当番（勤務・OC）へ入る日数の上限", states: ["hard", "soft", "off"], def: "off",
  weight: "dayoff_weekday_excess", w0: 20, relax: "dayoff_weekday",
  diagnoseHint: "      → 設定 → 規則 で「休日の同じ曜日は月 N 日まで」の日数を増やすか、規則を「減点」にする（休日が 5 回ある曜日の月は、人数に対して上限が足りないことがある）",
  params: [{ key: "dayoff_weekday_max", type: "int", min: 1, label: "休日の同じ曜日は月 {v} 日まで", blank: "2 日まで" }],
  read(P, rules) { const v = +rules.dayoff_weekday_max; return { max: Number.isInteger(v) && v >= 1 ? v : 2 }; },

  // 解く側: 人 × 曜日ごとに、その曜日の休日に関わる日数（日ごとの 0/1 の和）≤ max。日ごとの 0/1 は、その日の各枠の「勤務か OC」以上にする（上限と減点の向きなので下からの押さえだけでよい）
  solve(ctx, prm) {
    const { P, lp, LP } = ctx, byDow = dayoffByDow(P);
    for (const n of ctx.names) { if (exempt(P, n)) continue;
      for (const ds of Object.values(byDow)) { if (ds.length <= prm.max) continue; // その曜日の休日が上限以下なら超えようがない
        const es = ds.map(d => { const ev = slotsOf(P, d).map(s => ctx.Ev(s, n)); if (ev.length === 1) return ev[0]; const e = lp.aux("dwe"); for (const x of ev) lp.add(e, ">=", x); return e; });
        ctx.limit("dayoff_weekday_cap", LP.sum(es), "<=", prm.max, { aux: "dwex", ub: 6, fixed: fixedCount(ctx, ds, n) > prm.max, fixedExcess: Math.max(0, fixedCount(ctx, ds, n) - prm.max) }); } }
  },
  // 検算: 人 × 曜日ごとに、休日に関わった日を数える
  check(ctx, prm) {
    const { P, A } = ctx, byDow = dayoffByDow(P);
    for (const n of ctx.names) { if (exempt(P, n)) continue;
      for (const [w, ds] of Object.entries(byDow)) { const on = ds.filter(d => slotsOf(P, d).some(s => A.eng(n, s)));
        ctx.limit("dayoff_weekday_cap", on.length, "<=", prm.max, { code: "DAYOFF_WEEKDAY_OVER", args: { who: n, dow: T.dowLabel(+w), count: on.length, max: prm.max, days: on.map(d => P.label(d)).join(T.listSep()) }, days: on, names: [n], fixed: fixedCount(ctx, ds, n) > prm.max, fixedExcess: Math.max(0, fixedCount(ctx, ds, n) - prm.max) }); } }
  },
  // 減点: 超えた日数 × 重み（必須で固定により許容した分は fixed_conflict）
  penalty(ctx, prm) {
    const { P, A } = ctx, byDow = dayoffByDow(P);
    for (const n of ctx.names) { if (exempt(P, n)) continue;
      for (const ds of Object.values(byDow)) ctx.limit("dayoff_weekday_cap", ds.filter(d => slotsOf(P, d).some(s => A.eng(n, s))).length, "<=", prm.max, { fixed: fixedCount(ctx, ds, n) > prm.max, fixedExcess: Math.max(0, fixedCount(ctx, ds, n) - prm.max) }); }
  },
  summary(P, prm, tv) { return tv("休日の同じ曜日は月 {n} 日まで", { n: prm.max }); },
  messages: { DAYOFF_WEEKDAY_OVER: { en: "{who}: on duty (work or on-call) on {count} days off falling on {dow} ({days}), above the cap of {max}", ja: "{who}: 休日の{dow}曜に当番へ入る日が {count} 日（{days}）で、上限 {max} 日を超える" } },
  fixtures: [
    { label: "休日の同じ曜日の上限を必須", base: "cardiology", states: { dayoff_weekday_cap: "hard" } },
    { label: "休日の同じ曜日の上限を減点（月 1 日まで）、重み 1", base: "cardiology", states: { dayoff_weekday_cap: "soft" }, rules: { dayoff_weekday_max: 1 }, unitWeights: true },
  ],
  // 説明資料の第 9 節（調整目標の達成状況）の行
  report(ctx, prm) {
    const { P, A, t } = ctx, byDow = dayoffByDow(P);
    for (const n of ctx.names) { if (exempt(P, n)) continue; const over = [];
      for (const [w, ds] of Object.entries(byDow)) { const on = ds.filter(d => slotsOf(P, d).some(s => A.eng(n, s))); if (on.length > prm.max) over.push(t("{dow}曜 {n}日（{days}）", { dow: T.dowLabel(+w), n: on.length, days: on.map(d => P.label(d)).join(ctx.sep()) })); }
      if (over.length) ctx.line(t("{who} の休日の同じ曜日の当番が{max}日を超過: {items}", { who: n, max: prm.max, items: over.join(ctx.sep()) })); }
  },
  python: false,
});
})();

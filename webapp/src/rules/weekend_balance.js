// 規則のプラグイン: 完全な土日の期間責任者の担当の許容差（weekend_balance）。担当日数（1 組＝2 日）の最多−最少が 2×許容差 以下。docs/rule-modules.md
// 期間責任者（period_charge）が出す事実 "charge" を使う。rules.weekend_balance_max_diff（P.weekendMaxDiff、組）。
T.rules.register({
  id: "weekend_balance", api: 1, order: 430, group: "team",
  label: "完全な土日の{charge}担当の許容差（最多−最少）", states: ["hard", "soft", "off"], def: "hard",
  weight: "weekend_balance_excess", w0: 30, relax: "weekend_balance", needs: ["period_charge"],
  params: [{ key: "weekend_balance_max_diff", type: "int", min: 0, label: "許容差 {v} 組" }],
  read(P) { return { max: P.weekendMaxDiff }; },
  solve(ctx, prm) {
    const { P, lp, LP } = ctx, st = P.state("weekend_balance"), { fullDays } = ctx.use("charge");
    if (!P.periods.some(p => p.kind === "weekend" && p.full)) return;
    for (const a of P.I) for (const b of P.I) if (a !== b) {
      if (st === "hard") lp.add(LP.sub(fullDays[a], fullDays[b]), "<=", 2 * prm.max);
      else { const v = lp.auxInt("wbx", 0, 20); lp.add(LP.sub(LP.sub(fullDays[a], fullDays[b]), 2 * prm.max), "<=", v); lp.objAdd(P.softW("weekend_balance"), v); } } // 減点: 許容差を超えた分（日）
  },
  check(ctx, prm) {
    const fw = T.fullWeekendUnits(ctx.P, ctx.use("charge").map), fv = Object.values(fw);
    if (fv.length && Math.max(...fv) - Math.min(...fv) > 2 * prm.max) ctx.viol("WEEKEND_BALANCE", { max: prm.max, detail: Object.entries(fw).map(([k, v]) => `${k}${v / 2}`).join("、") });
  },
  penalty(ctx, prm) {
    const { P, pos } = ctx, { fullDays } = ctx.use("charge");
    if (!P.periods.some(p => p.kind === "weekend" && p.full)) return;
    for (const a of P.I) for (const b of P.I) if (a !== b) ctx.add("weekend_balance_excess", P.softW("weekend_balance"), pos(fullDays[a] - fullDays[b] - 2 * prm.max));
  },
  summary(P, prm, tv) { return tv("許容差 {n} 組", { n: prm.max }); },
  diagnoseHint: "      → 月の設定 → 週末担当の許容差 を広げる（作成責任者の承認が必要）か、期間責任者になれる人の不可日を見直す",
  messages: {
    WEEKEND_BALANCE: { en: "full weekends on {charge} duty differ by more than {max}: {detail}", ja: "完全な土日の担当（組）の差が{max}を超える: {detail}" },
  },
  // 説明資料の第 9 節（調整目標の達成状況）の行
  report(ctx, prm) {
    const { P, t } = ctx; if (P.state("weekend_balance") !== "soft") return;
    const fw = T.fullWeekendUnits(P, T.check(P, ctx.A.a).charge), v = Object.values(fw);
    if (v.length) ctx.line(t("完全な土日の担当の差（減点 weekend_balance_excess。許容差 {max} 組）: {diff} 組", { max: prm.max, diff: ((Math.max(...v) - Math.min(...v)) / 2).toFixed(1) }));
  },
  python: true,
});

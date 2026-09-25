// 規則のプラグイン: 当直（夜勤）の希望を反映する（wish_night）。叶わなかった希望 1 件あたり減点（Python 版と同じ数え方）。docs/rule-modules.md
// 希望は月データ wishes.night_on = {氏名: [日]}（model.js が P.wishNight に読む）
T.rules.register({
  id: "wish_night", api: 1, order: 910, group: "wish",
  label: "当直（夜勤）の希望を反映する", states: ["soft", "off"], def: "soft",
  weight: "wish_night", w0: 30,
  read(P) { return { wishes: P.wishNight }; },
  solve(ctx, prm) {
    const { LP, lp, P } = ctx;
    for (const [n, days] of Object.entries(prm.wishes)) for (const d of days) if (ctx.names.includes(n) && ctx.has([d, "night"]) && d >= 1 && d <= P.N) lp.objAdd(P.weights.wish_night, LP.sub(1, ctx.work([d, "night"], n)));
  },
  penalty(ctx, prm) {
    for (const [n, days] of Object.entries(prm.wishes)) for (const d of days) if (ctx.names.includes(n) && ctx.has([d, "night"]) && d >= 1 && d <= ctx.N) ctx.add("wish_night", ctx.P.weights.wish_night, 1 - (ctx.worked(n, [d, "night"]) ? 1 : 0));
  },
  // 説明資料の第 9 節（調整目標の達成状況）の行
  report(ctx, prm) {
    const { P, t } = ctx; for (const [n, days] of Object.entries(prm.wishes)) for (const d of days) ctx.line(t("{who} の {day} の当直希望: {result}", { who: n, day: P.label(d), result: t(ctx.worked(n, [d, "night"]) ? "反映" : "未反映") }));
  },
  python: true,
});

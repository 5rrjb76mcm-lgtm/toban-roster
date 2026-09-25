// 規則のプラグイン: 当月目標の回数に近づける（quota_target）。目標からのずれ 1 回あたり減点。目標は月の設定の targets（P.targets）。docs/rule-modules.md
T.rules.register({
  id: "quota_target", api: 1, order: 210, group: "basic",
  label: "当月目標の回数に近づける", states: ["soft", "off"], def: "soft",
  weight: "target_deviation", w0: 15,
  solve(ctx) {
    const { lp, LP, P } = ctx;
    for (const n of ctx.names) { if (P.isExempt(n)) continue;
      const dev = lp.auxInt("dev", 0, P.N + 2);
      lp.add(dev, ">=", LP.sub(ctx.total(n), P.targets[n])); lp.add(dev, ">=", LP.sub(P.targets[n], ctx.total(n)));
      lp.objAdd(P.softW("quota_target"), dev); }
  },
  penalty(ctx) {
    for (const n of ctx.names) if (!ctx.P.isExempt(n)) ctx.add("target_deviation", ctx.P.softW("quota_target"), Math.abs(ctx.P.slots.filter(s => ctx.worked(n, s)).length - ctx.P.targets[n]));
  },
  // 説明資料の第 9 節（調整目標の達成状況）の行
  report(ctx, prm) {
    const { P, t } = ctx;
    for (const n of ctx.names) { const tot = P.slots.filter(s => ctx.worked(n, s)).length; if (tot !== P.targets[n]) ctx.line(t("{who} の勤務回数 {total}（当月目標 {target}）", { who: n, total: tot, target: P.targets[n] })); }
  },
  python: true,
});

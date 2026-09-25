// 規則のプラグイン: 夜勤・夜間オンコールの翌日に日中の業務がある（duty_after_night）。docs/rule-modules.md
//   夜間 OC の翌日に業務（午前か午後）… night_oc_then_duty、夜勤の翌日が午前だけの業務 … night_then_am_duty。月末は翌月 1 日を翌日とする
T.rules.register({
  id: "duty_after_night", api: 1, order: 950, group: "duty",
  label: "夜勤・夜間オンコールの翌日に日中の業務が来るのを避ける", states: ["soft", "off"], def: "soft",
  weight: "night_oc_then_duty", w0: 3, sub: ["night_then_am_duty"],
  solve(ctx) {
    const { lp, P, W } = ctx;
    for (const n of ctx.names) for (let d = 1; d <= P.N; d++) { const nd = d + 1;
      if (P.busy(n, nd, "am") || P.busy(n, nd, "pm")) lp.objAdd(W.night_oc_then_duty, ctx.oc([d, "night"], n));
      if (P.busy(n, nd, "am") && !P.busy(n, nd, "pm")) lp.objAdd(W.night_then_am_duty, ctx.work([d, "night"], n)); }
  },
  penalty(ctx) {
    const { P } = ctx, W = P.weights;
    for (const n of ctx.names) for (let d = 1; d <= ctx.N; d++) {
      if (P.busy(n, d + 1, "am") || P.busy(n, d + 1, "pm")) ctx.add("night_oc_then_duty", W.night_oc_then_duty, ctx.onCall(n, [d, "night"]) ? 1 : 0);
      if (P.busy(n, d + 1, "am") && !P.busy(n, d + 1, "pm")) ctx.add("night_then_am_duty", W.night_then_am_duty, ctx.worked(n, [d, "night"]) ? 1 : 0); }
  },
  python: true,
});

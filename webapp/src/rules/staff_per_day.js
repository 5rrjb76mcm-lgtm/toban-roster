// 規則のプラグイン: 1 日に当番（勤務・オンコール）へ入る人数を減らす（staff_per_day）。1 人・1 日あたり減点（同じ人が同日の複数役割を兼ねれば 1 人）。docs/rule-modules.md
T.rules.register({
  id: "staff_per_day", api: 1, order: 900, group: "basic",
  label: "1 日に当番（勤務・オンコール）へ入る人数を減らす", states: ["soft", "off"], def: "soft",
  weight: "staff_per_day", w0: 1,
  solve(ctx) {
    const { lp, P } = ctx;
    for (let d = 1; d <= P.N; d++) for (const n of ctx.names) {
      const ks = ["day", "night"].filter(k => ctx.has([d, k])); if (!ks.length) continue;
      const v = lp.aux("stf"); for (const k of ks) { lp.add(ctx.work([d, k], n), "<=", v); lp.add(ctx.oc([d, k], n), "<=", v); } lp.objAdd(P.weights.staff_per_day, v);
    }
  },
  penalty(ctx) {
    for (let d = 1; d <= ctx.N; d++) for (const n of ctx.names) if (["day", "night"].some(k => ctx.has([d, k]) && ctx.engaged(n, [d, k]))) ctx.add("staff_per_day", ctx.P.weights.staff_per_day, 1);
  },
  // 説明資料の第 9 節（調整目標の達成状況）の行
  report(ctx, prm) {
    const { P, A, t } = ctx; let staff = 0;
    for (let d = 1; d <= P.N; d++) { const ppl = new Set(); for (const k of ["day", "night"]) if (ctx.has([d, k])) { ppl.add(A.work([d, k])); for (const x of A.oc([d, k])) ppl.add(x); } staff += ppl.size; }
    ctx.line(t("当番に入った延べ人数（1人・1日を1と数える。減点 staff_per_day の対象）: {n}", { n: staff }));
  },
  python: true,
});

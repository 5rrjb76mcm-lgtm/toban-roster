// 規則のプラグイン: 同じ人が同じ日に 2 つの枠（日勤＋夜勤）（same_day_double）。docs/rule-modules.md
// 必須のときも、固定指定した枠・人が絡む組は減点付きで許す（fixed_conflict。検算では「固定指定により許容」）。
T.rules.register({
  id: "same_day_double", api: 1, order: 300, group: "combo",
  label: "同じ人を同じ日の 2 つの枠（日勤＋夜勤）に入れない", states: ["hard", "soft", "off"], def: "hard",
  weight: "same_day_double", w0: 200, relax: "consecutive",
  solve(ctx) {
    const { P, E } = ctx;
    for (const n of ctx.names) for (let d = 1; d <= P.N; d++) if (ctx.has([d, "day"]) && ctx.has([d, "night"]))
      ctx.limit("same_day_double", E(ctx.work([d, "day"], n), ctx.work([d, "night"], n)), "<=", 1, { fixed: ctx.fixedInvolved(d, n), aux: "cw", ub: 3 });
  },
  check(ctx) {
    for (const n of ctx.names) for (let d = 1; d <= ctx.N; d++)
      if (ctx.worked(n, [d, "day"]) && ctx.worked(n, [d, "night"])) ctx.viol("SAME_DAY_DOUBLE", { day: ctx.lab(d), who: n }, d, n, ctx.fixedInvolved(d, n)); // 許容の可否は解く側と同じ判定（勤務の固定だけ）
  },
  penalty(ctx) {
    for (const n of ctx.names) for (let d = 1; d <= ctx.N; d++) if (ctx.has([d, "day"]) && ctx.has([d, "night"]))
      ctx.limit("same_day_double", (ctx.worked(n, [d, "day"]) ? 1 : 0) + (ctx.worked(n, [d, "night"]) ? 1 : 0), "<=", 1, { fixed: ctx.fixedInvolved(d, n) });
  },
  diagnoseHint: "      → 固定指定や前月末の接続で連日・隣接の担当になっていないか確認",
  messages: { SAME_DAY_DOUBLE: { en: "{day}: {who} on both day and night", ja: "{day}: {who} 同日の日勤＋夜勤" } },
  // 説明資料の第 9 節（調整目標の達成状況）の行
  report(ctx, prm) {
    const { P, t } = ctx; if (P.state("same_day_double") !== "soft") return; // 減点にしたときだけ内訳を出す
    const lines = []; for (const n of ctx.names) { const cc = []; for (let d = 1; d <= P.N; d++) if (ctx.worked(n, [d, "day"]) && ctx.worked(n, [d, "night"])) cc.push(`${P.label(d)}${P.shiftLabel("day")}＋${P.shiftLabel("night")}`); if (cc.length) lines.push(`${n}: ${cc.join(ctx.sep())}`); }
    ctx.line(t("同じ日に 2 枠（減点 same_day_double）: {items}", { items: lines.join("／") || t("なし") }));
  },
  // 入力チェック: 同じ日の 2 枠に同じ人を固定している
  lint(ctx, prm) {
    if (!ctx.P.isHard("same_day_double")) return;
    for (const [n, ds] of Object.entries(ctx.fixedWork())) { const u = ds.slice().sort((a, b) => a - b); for (let i = 0; i + 1 < u.length; i++) if (u[i] === u[i + 1]) ctx.push("LINT_FIXED_SAME_DAY", { who: n, day: ctx.lab(u[i]) }); }
  },
  python: true,
});

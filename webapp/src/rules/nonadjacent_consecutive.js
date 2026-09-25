// 規則のプラグイン: 隣接しない連日の当番（nonadjacent_consecutive）。日勤 OC → 翌日の日勤 OC のように、隣り合わない枠で連日当番に入る組を減点。期間責任者になれる役割は除く。docs/rule-modules.md
T.rules.register({
  id: "nonadjacent_consecutive", api: 1, order: 960, group: "combo",
  label: "隣接しない連日の当番を避ける（当直向け。毎日勤務する 2 交代では使わない）", states: ["soft", "off"], def: "soft",
  weight: "nonadjacent_consecutive", w0: 2,
  solve(ctx) {
    const { P, lp, LP, E, W } = ctx;
    for (const n of ctx.names) { if (P.isRole(n, "charge")) continue; for (let d = 1; d < P.N; d++) {
      const b1 = lp.aux("b"), b2 = lp.aux("b"), v = lp.aux("cc");
      for (const k of ["day", "night"]) { if (ctx.has([d, k])) { lp.add(b1, ">=", ctx.work([d, k], n)); lp.add(b1, ">=", ctx.oc([d, k], n)); } if (ctx.has([d + 1, k])) { lp.add(b2, ">=", ctx.work([d + 1, k], n)); lp.add(b2, ">=", ctx.oc([d + 1, k], n)); } }
      lp.add(LP.sub(E(b1, b2), 1), "<=", v); lp.objAdd(W.nonadjacent_consecutive, v); } }
  },
  penalty(ctx) {
    const { P } = ctx;
    for (const n of ctx.names) if (!P.isRole(n, "charge")) for (let d = 1; d < ctx.N; d++) {
      const on = x => ["day", "night"].some(k => ctx.has([x, k]) && ctx.engaged(n, [x, k]));
      if (on(d) && on(d + 1)) ctx.add("nonadjacent_consecutive", P.weights.nonadjacent_consecutive, 1); }
  },
  // 説明資料の第 9 節（調整目標の達成状況）の行
  report(ctx, prm) {
    const { P, t } = ctx;
    for (const n of ctx.names) { if (P.isRole(n, "charge")) continue; const cc = []; for (let d = 1; d < P.N; d++) { const e = x => ["day", "night"].some(k => ctx.engaged(n, [x, k])); if (e(d) && e(d + 1)) cc.push(`${P.month}/${d}-${d + 1}`); } if (cc.length) ctx.line(t("{who} の隣接しない連日の当番: {items}", { who: n, items: cc.join(ctx.sep()) })); }
  },
  python: true,
});

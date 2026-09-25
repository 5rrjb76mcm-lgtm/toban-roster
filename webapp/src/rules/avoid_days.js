// 規則のプラグイン: できれば避けたい日を避ける（avoid_days）。その枠の勤務・OC に減点（avoid_day）。docs/rule-modules.md
// 申告で負担が減らないよう、本人の回数が「基準回数」を下回る分には大きな減点（avoid_no_reduction）。基準回数＝避けたい日を無視した参照解での回数
//（opts.avoidRef。本体の solveWithAvoidRef が 2 段階で計算）。参照解が無いときは当月目標。opts.ignoreAvoid のとき（参照解を作るとき）は何もしない。
T.rules.register({
  id: "avoid_days", api: 1, order: 410, group: "wish",
  label: "できれば避けたい日を避ける（参照解より回数が減らない範囲で）", states: ["soft", "off"], def: "soft",
  weight: "avoid_day", w0: 30, sub: ["avoid_no_reduction"],
  solve(ctx) {
    const { P, lp, LP, W, opts } = ctx; if (opts.ignoreAvoid) return;
    for (const n of ctx.names) { const av = P.avoidSlots(n); if (!av.length || P.isRole(n, "reserve")) continue;
      for (const s of av) if (ctx.has(s)) lp.objAdd(W.avoid_day ?? 30, ctx.Ev(s, n));
      const floor = (opts.avoidRef && opts.avoidRef[n] != null) ? +opts.avoidRef[n] : P.targets[n];
      const down = lp.auxInt("avdn", 0, 20); lp.add(down, ">=", LP.sub(floor, ctx.total(n))); lp.objAdd(W.avoid_no_reduction ?? 1000, down); }
  },
  penalty(ctx) {
    const { P, pos, opts } = ctx, W = P.weights; if (opts.ignoreAvoid) return;
    for (const n of ctx.names) { const av = P.avoidSlots(n); if (!av.length || P.isRole(n, "reserve")) continue;
      for (const s of av) if (ctx.has(s)) ctx.add("avoid_day", W.avoid_day ?? 30, ctx.engaged(n, s) ? 1 : 0);
      const floor = (opts.avoidRef && opts.avoidRef[n] != null) ? +opts.avoidRef[n] : P.targets[n];
      ctx.add("avoid_no_reduction", W.avoid_no_reduction ?? 1000, pos(floor - P.slots.filter(s => ctx.worked(n, s)).length)); }
  },
  // 説明資料の第 9 節（調整目標の達成状況）の行
  report(ctx, prm) {
    const { P, t, opts } = ctx;
    for (const n of ctx.names) { const av = P.avoidSlots(n); if (!av.length) continue;
      const hit = av.filter(s => ctx.engaged(n, s)).map(s => `${P.label(s[0])}${P.shiftLabel(s[1])}`), tot = P.slots.filter(s => ctx.worked(n, s)).length, ref = opts.avoidRef ? opts.avoidRef[n] : null;
      const note = (ref != null && tot < ref) ? t("。参照解を下回る＝他の必須条件のため") : (ref == null && tot < P.targets[n]) ? t("。目標未満＝他の必須条件のため") : "";
      ctx.line(t("{who} のできれば避けたい日（{slots}枠）: {result}。勤務{total}回（当月目標{target}回{refNote}{note}）", { who: n, slots: av.length, result: hit.length ? t("配置あり {days}", { days: hit.join(ctx.sep()) }) : t("すべて回避"), total: tot, target: P.targets[n], refNote: ref != null ? t("、避けたい日を無視した参照解では{ref}回", { ref }) : "", note })); }
  },
  python: true,
});

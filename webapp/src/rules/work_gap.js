// 規則のプラグイン: 実勤務の間隔が短い（work_gap）。中 1 日（夜勤→休み→夜勤。work_gap_1）・中 2 日（work_gap_2）で続く組を減点。中 3 日以上は減点なし。
// 前月末の勤務（定数）と翌月 1 日の固定も相手に含める。docs/rule-modules.md
T.rules.register({
  id: "work_gap", api: 1, order: 970, group: "combo",
  label: "実勤務の間隔が短い組を避ける（中1日・中2日。当直の間隔向け。毎日勤務する 2 交代では使わない）", states: ["soft", "off"], def: "soft",
  weight: "work_gap_1", w0: 20, sub: ["work_gap_2"],
  solve(ctx) {
    const { P, lp, LP, E, W } = ctx;
    for (const n of ctx.names) { if (P.isRole(n, "reserve")) continue;
      const prevWorked = d => ["day", "night"].some(k => ctx.has([d, k]) && ctx.Wv([d, k], n) === 1);
      const wd = d => d > P.N ? (P.nextFixedWorks(n) ? 1 : 0) : ctx.workday(d, n);
      for (const [gap, w] of [[2, W.work_gap_1], [3, W.work_gap_2]]) for (let d = ctx.firstPrev; d + gap <= P.N + 1; d++) {
        if (d < 1 && (d + gap < 1 || !prevWorked(d))) continue; // 前月どうしの組と、前月に勤務が無い組は式が不要
        if (d + gap > P.N && !P.nextFixedWorks(n)) continue;
        const v = lp.auxInt("gap", 0, 3); lp.add(LP.sub(E(wd(d), wd(d + gap)), 1), "<=", v); lp.objAdd(w, v); } } // 固定指定で同日に日勤＋夜勤があると式が3になるので整数
  },
  penalty(ctx) {
    const { P, pos } = ctx, W = P.weights;
    for (const n of ctx.names) { if (P.isRole(n, "reserve")) continue;
      const wd = d => d > ctx.N ? (P.nextFixedWorks(n) ? 1 : 0) : ctx.workday(n, d);
      for (const [gap, k, w] of [[2, "work_gap_1", W.work_gap_1], [3, "work_gap_2", W.work_gap_2]]) for (let d = ctx.firstPrev; d + gap <= ctx.N + 1; d++) {
        if (d < 1 && (d + gap < 1 || !ctx.workday(n, d))) continue;
        if (d + gap > ctx.N && !P.nextFixedWorks(n)) continue;
        ctx.add(k, w, pos(wd(d) + wd(d + gap) - 1)); } }
  },
  // 説明資料の第 9 節（調整目標の達成状況）の行
  report(ctx, prm) {
    const { P, t } = ctx;
    for (const n of ctx.names) { const wk = d => d > P.N ? P.nextFixedWorks(n) : ctx.anyWork(n, d), g1 = [], g2 = [];
      for (let d = ctx.firstPrev; d <= P.N; d++) { if (!wk(d)) continue; if (d + 2 <= P.N + 1 && wk(d + 2)) g1.push(`${P.label(d)}→${P.label(d + 2)}`); if (d + 3 <= P.N + 1 && wk(d + 3)) g2.push(`${P.label(d)}→${P.label(d + 3)}`); }
      if (g1.length || g2.length) ctx.line(t("{who} の勤務間隔が短い組（減点対象）: {items}", { who: n, items: [g1.length ? t("中1日 {v}", { v: g1.join(ctx.sep()) }) : "", g2.length ? t("中2日 {v}", { v: g2.join(ctx.sep()) }) : ""].filter(Boolean).join("／") })); }
  },
  python: true,
});

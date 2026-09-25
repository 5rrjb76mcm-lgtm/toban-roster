// 規則のプラグイン: 明けの翌日も休み（rest_after_ake）。夜勤 → 明け → 休み、つまり夜勤の 2 日後に勤務を入れない（2 交代の病棟など）。docs/rule-modules.md
// 前月末の夜勤（前月末の接続）からも数える。固定した日が絡む組は減点付きで許す（検算では「固定指定により許容」）。「固定したときだけ」の人には当てはめない。
T.rules.register({
  id: "rest_after_ake", api: 1, order: 722, group: "combo",
  label: "夜勤 → 明け → 休み（夜勤の 2 日後にも勤務を入れない）", states: ["hard", "soft", "off"], def: "off",
  weight: "rest_after_ake", w0: 100,
  // 並び: 夜勤 d → 明け d+1 → 休み d+2。d+2 が翌月 1 日なら固定（P.nextFixedWorks）があるときだけ見る（当月側の夜勤が固定なら「固定指定により許容」）。
  // 「その日に勤務があるか」は 0/1（同じ日の日勤＋夜勤を 2 と数えない。同日 2 勤務は same_day_double の担当）
  solve(ctx) {
    const { P, LP } = ctx;
    for (const n of ctx.names) { if (P.isFixedOnly(n)) continue;
      for (let d = ctx.firstPrev; d + 2 <= P.N + 1; d++) { const e = d + 2; if (e < 1) continue;
        const nite = d >= 1 ? ctx.work([d, "night"], n) : (P.prevWorked([d, "night"], n) ? 1 : 0); if (d < 1 && !nite) continue;
        const after = e > P.N ? (P.nextFixedWorks(n) ? 1 : 0) : ctx.y(e, n); if (e > P.N && !after) continue;
        const days = [d, e].filter(x => x >= 1 && x <= P.N), fixed = e > P.N ? P.isFixedWork([d, "night"], n) : ctx.fixedInvolved(days, n); // 翌月へつながる窓は夜勤の枠の固定だけ（shift_sequence と同じ）
        ctx.limit("rest_after_ake", LP.sum([nite, after]), "<=", 1, { fixed, aux: "rak", ub: 2 }); } }
  },
  check(ctx) {
    const { P } = ctx;
    for (const n of ctx.names) { if (P.isFixedOnly(n)) continue;
      for (let d = ctx.firstPrev; d + 2 <= P.N + 1; d++) { const e = d + 2; if (e < 1) continue; const nite = d >= 1 ? ctx.worked(n, [d, "night"]) : P.prevWorked([d, "night"], n);
        const after = e > P.N ? P.nextFixedWorks(n) : ctx.anyWork(n, e);
        if (nite && after) { const days = [d, e].filter(x => x >= 1 && x <= P.N); ctx.viol("REST_AFTER_AKE", { who: n, day: ctx.lab(d), next: ctx.lab(e) }, days, n, e > P.N ? P.isFixedWork([d, "night"], n) : ctx.fixedInvolved(days, n)); } } }
  },
  penalty(ctx) {
    const { P } = ctx;
    for (const n of ctx.names) { if (P.isFixedOnly(n)) continue;
      for (let d = ctx.firstPrev; d + 2 <= P.N + 1; d++) { const e = d + 2; if (e < 1) continue; const nite = d >= 1 ? (ctx.worked(n, [d, "night"]) ? 1 : 0) : (P.prevWorked([d, "night"], n) ? 1 : 0); if (d < 1 && !nite) continue;
        const after = e > P.N ? (P.nextFixedWorks(n) ? 1 : 0) : (ctx.anyWork(n, e) ? 1 : 0); if (e > P.N && !after) continue;
        const days = [d, e].filter(x => x >= 1 && x <= P.N);
        ctx.limit("rest_after_ake", nite + after, "<=", 1, { fixed: e > P.N ? P.isFixedWork([d, "night"], n) : ctx.fixedInvolved(days, n) }); } }
  },
  messages: { REST_AFTER_AKE: { en: "{who}: works on {next}, two days after the night shift of {day} (the day after the post-night day must be off)", ja: "{who}: {day} の夜勤の 2 日後 {next} に勤務している（明けの翌日は休み）" } },
  fixtures: [{ label: "明けの翌日の休みを減点、重み 1", base: "ward-2shift", states: { rest_after_ake: "soft" }, unitWeights: true }],
  python: false,
});

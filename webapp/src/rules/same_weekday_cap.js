// 規則のプラグイン: 同じ曜日の勤務の上限（same_weekday_cap）。docs/rule-modules.md
// 1 人の勤務が同じ曜日に月 max 回を超えないようにする（必須なら制約、減点なら超えた回数 × 重み）。
// 解く側（solve）・検算（check）・減点の数え直し（penalty）は別々に書く（1 つの式から作らない）。
T.rules.register({
  id: "same_weekday_cap", api: 1, order: 540, group: "combo",
  label: "同じ曜日の勤務の上限", states: ["hard", "soft", "off"], def: "soft",
  weight: "same_weekday_excess", w0: 15,
  params: [{ key: "max_same_weekday_shifts", type: "int", min: 1, label: "同じ曜日の勤務は月 {v} 回まで", blank: "上限なし" }],
  read(P, rules) { return { max: +rules.max_same_weekday_shifts || 0 }; }, // 0 = 上限なし

  // 解く側: 曜日ごとの勤務の枠数の式 ≤ max
  solve(ctx, prm) {
    if (!prm.max) return;
    for (const n of ctx.names) for (let w = 0; w < 7; w++) {
      const cnt = ctx.LP.sum(ctx.slots.filter(s => ctx.P.dow(s[0]) === w).map(s => ctx.work(s, n)));
      ctx.limit("same_weekday_cap", cnt, "<=", prm.max, { aux: "dowex", ub: 10 });
    }
  },
  // 検算: 曜日ごとに勤務した枠を数え、上限を超えた分を違反にする
  check(ctx, prm) {
    if (!prm.max) return;
    for (const n of ctx.names) {
      const cnt = {}; for (const s of ctx.P.slots) if (ctx.worked(n, s)) cnt[ctx.P.dow(s[0])] = (cnt[ctx.P.dow(s[0])] || 0) + 1;
      for (const [w, c] of Object.entries(cnt)) ctx.limit("same_weekday_cap", c, "<=", prm.max, { code: "SAME_WEEKDAY_OVER", args: { who: n, dow: T.dowLabel(+w), count: c, max: prm.max }, names: [n] });
    }
  },
  // 減点: 曜日ごとの超過分 × 重み（7 曜日すべてを見る。勤務が無い曜日は 0）
  penalty(ctx, prm) {
    if (!prm.max) return;
    for (const n of ctx.names) for (let w = 0; w < 7; w++)
      ctx.limit("same_weekday_cap", ctx.P.slots.filter(s => ctx.P.dow(s[0]) === w && ctx.worked(n, s)).length, "<=", prm.max);
  },

  summary(P, prm, tv) { return prm.max ? tv("月 {n} 回まで", { n: prm.max }) : tv("上限なし"); },
  messages: { SAME_WEEKDAY_OVER: { en: "{who}: {count} shifts on {dow}, above the cap of {max}", ja: "{who}: {dow}曜の勤務{count}回が上限{max}回を超える" } },
  fixtures: [
    { label: "同じ曜日の上限を必須", base: "cardiology", states: { same_weekday_cap: "hard" } },
    { label: "同じ曜日の上限を減点、重み 1", base: "cardiology", states: { same_weekday_cap: "soft" }, unitWeights: true },
  ],
  // 説明資料の第 9 節（調整目標の達成状況）の行
  report(ctx, prm) {
    const { P, t } = ctx, mx = prm.max || 99;
    for (const n of ctx.names) { const cnt = {}; for (const s of P.slots) if (ctx.worked(n, s)) cnt[P.dow(s[0])] = (cnt[P.dow(s[0])] || 0) + 1; const over = Object.entries(cnt).filter(([, c]) => c > mx).map(([w, c]) => t("{dow} {n}回", { dow: T.dowLabel(+w), n: c })); if (over.length) ctx.line(t("{who} の同じ曜日の勤務が{max}回を超過: {items}", { who: n, max: mx, items: over.join(ctx.sep()) })); }
  },
  reportAlways: true, // 規則を使っていなくても情報として出す
  python: true, // toban.py が実装している（SOFT_OK_PY）
});

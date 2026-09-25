// 規則のプラグイン: 同じ人の実勤務が連日（consecutive_days）。2 交代制のように連勤がある職場では「なし」にする。docs/rule-modules.md
// 前月末との組（前月は定数）と、翌月 1 日の固定指定との組も見る。固定指定が絡む組は減点付きで許す（fixed_conflict）。
// 移す前は、翌月 1 日との組が規則の状態を見ずに常に必須だった（連日を許す施設でも月末の勤務が禁止された）。プラグインでは規則の状態に従う。
T.rules.register({
  id: "consecutive_days", aliases: ["consecutive_work"], api: 1, order: 310, group: "combo", // consecutive_work は 2026-09-20 までの id（古い設定ファイルの互換）
  label: "同じ人の実勤務を連日にしない（2交代制のように連勤がある職場では「なし」）", states: ["hard", "soft", "off"], def: "hard",
  weight: "consecutive_days", w0: 200, relax: "consecutive",
  solve(ctx) {
    const { P, E } = ctx;
    for (const n of ctx.names) for (let d = ctx.firstPrev; d < P.N; d++) { if (d + 1 < 1) continue; // 前月どうしの組は対象外（定数の式で解なしにしない）
      ctx.limit("consecutive_days", E(ctx.workday(d, n), ctx.workday(d + 1, n)), "<=", 1, { fixed: ctx.fixedInvolved([d, d + 1], n), aux: "cw", ub: 3 }); }
    // 翌月 1 日の固定指定（カレンダーの翌月 1 日欄）との連日。月末の枠もその人で固定されているときは減点付きで許す
    if (!ctx.relaxed("fixed") && !ctx.relaxed("fixed:next") && P.nextFixedAny()) { const N = P.N;
      for (const n of ctx.names) if (P.nextFixedWorks(n)) ctx.limit("consecutive_days", ctx.workday(N, n), "<=", 0, { fixed: P.isFixedEng([N, "day"], n) || P.isFixedEng([N, "night"], n), aux: "fxc", ub: 3 }); }
  },
  check(ctx) {
    const { P } = ctx;
    for (const n of ctx.names) for (let d = ctx.firstPrev; d < P.N; d++) { if (d + 1 < 1) continue;
      if (ctx.anyWork(n, d) && ctx.anyWork(n, d + 1)) ctx.viol("CONSECUTIVE_DAYS", { day: ctx.lab(d), next: ctx.lab(d + 1), who: n }, [d, d + 1], n, ctx.fixedInvolved([d, d + 1], n)); } // 許容の可否は解く側と同じ判定（勤務の固定だけ。OC の固定では許容しない）
    if (P.nextFixedAny()) for (const n of ctx.names) if (P.nextFixedWorks(n) && ctx.anyWork(n, P.N)) ctx.viol("CONSECUTIVE_NEXT_MONTH", { day: ctx.lab(P.N), next: ctx.lab(P.N + 1), who: n }, P.N, n, P.isFixedEng([P.N, "day"], n) || P.isFixedEng([P.N, "night"], n));
  },
  penalty(ctx) {
    const { P } = ctx;
    for (const n of ctx.names) for (let d = ctx.firstPrev; d < P.N; d++) if (d + 1 >= 1)
      ctx.limit("consecutive_days", ctx.workday(n, d) + ctx.workday(n, d + 1), "<=", 1, { fixed: ctx.fixedInvolved([d, d + 1], n) });
    if (P.nextFixedAny()) for (const n of ctx.names) if (P.nextFixedWorks(n))
      ctx.limit("consecutive_days", ctx.workday(n, P.N), "<=", 0, { fixed: P.isFixedEng([P.N, "day"], n) || P.isFixedEng([P.N, "night"], n) });
  },
  messages: {
    CONSECUTIVE_DAYS: { en: "{day}→{next}: {who} works on consecutive days", ja: "{day}→{next}: {who} 連日の実勤務" },
    CONSECUTIVE_NEXT_MONTH: { en: "{day}→{next}: {who} works on consecutive days (fixed on the 1st of next month)", ja: "{day}→{next}: {who} 連日の実勤務（翌月1日の固定）" },
  },
  // 説明資料の第 9 節（調整目標の達成状況）の行
  report(ctx, prm) {
    const { P, t } = ctx; if (P.state("consecutive_days") !== "soft") return;
    const lines = []; for (const n of ctx.names) { const cc = []; for (let d = ctx.firstPrev; d < P.N; d++) if (d + 1 >= 1 && ctx.anyWork(n, d) && ctx.anyWork(n, d + 1)) cc.push(`${P.label(d)}→${P.label(d + 1)}`); if (cc.length) lines.push(`${n}: ${cc.join(ctx.sep())}`); }
    ctx.line(t("連日の実勤務（減点 consecutive_days）: {items}", { items: lines.join("／") || t("なし") }));
  },
  // 入力チェック: 連日の枠に同じ人を固定している
  lint(ctx, prm) {
    if (!ctx.P.isHard("consecutive_days")) return;
    for (const [n, ds] of Object.entries(ctx.fixedWork())) { const u = [...new Set(ds)].sort((a, b) => a - b); for (let i = 0; i + 1 < u.length; i++) if (u[i + 1] - u[i] <= 1) ctx.push("LINT_FIXED_CONSECUTIVE", { who: n, day: ctx.lab(u[i]), next: ctx.lab(u[i + 1]) }); }
  },
  python: true,
});

// 規則のプラグイン: 外勤のある人の週休日（休日の日勤か休日前日の夜勤）を月 1 日以上（rest_day）。docs/rule-modules.md
// 週休日の一覧（表示用）は本体の T.restDays。入力チェック（LINT_REST_DAY_IMPOSSIBLE）は本体の道具 canWork に頼るので本体に残す。
T.rules.register({
  id: "rest_day", api: 1, order: 820, group: "rest",
  label: "外勤のある人に週休日（休日の日勤か休日前日の夜勤）を月1日以上作る", states: ["hard", "soft", "off"], def: "hard",
  weight: "rest_day_missing", w0: 100, relax: "rest", legacy: "rest_day_required",
  fromLegacy: v => v === false ? "off" : "hard", toLegacy: st => st !== "off",
  solve(ctx) {
    const { P, lp, LP } = ctx, st = P.state("rest_day");
    for (const n of ctx.names) { if (!P.hasExternal(n)) continue; const t = [];
      for (let d = 1; d <= P.N; d++) { if (ctx.has([d, "day"])) t.push(ctx.work([d, "day"], n)); if (P.nextIsHoliday(d)) t.push(ctx.work([d, "night"], n)); }
      if (st === "hard") lp.add(LP.sum(t), ">=", 1);
      else { const v = lp.aux("rest"); lp.add(LP.sum([...t, v]), ">=", 1); lp.objAdd(P.softW("rest_day"), v); } } // 減点: 週休日が無い人 1 名あたり
  },
  check(ctx) { const rest = T.restDays(ctx.P, ctx.A); for (const n of ctx.names) if (ctx.P.hasExternal(n) && !rest[n].length) ctx.viol("REST_DAY_MISSING", { who: n }, null, n); },
  penalty(ctx) {
    const { P } = ctx;
    for (const n of ctx.names) if (P.hasExternal(n)) { let c = 0;
      for (let d = 1; d <= ctx.N; d++) { if (ctx.has([d, "day"]) && ctx.worked(n, [d, "day"])) c++; if (P.nextIsHoliday(d) && ctx.worked(n, [d, "night"])) c++; }
      if (!c) ctx.add("rest_day_missing", P.softW("rest_day"), 1); }
  },
  diagnoseHint: "      → 外勤のある{person}が休日の日勤・休日前日の夜勤に入れるよう不可日を見直す",
  messages: { REST_DAY_MISSING: { en: "{who}: has outside work but gets no weekly rest day", ja: "{who}: 外勤があるのに週休日が発生しない" } },
  // 説明資料の第 9 節（調整目標の達成状況）の行
  report(ctx, prm) {
    const { P, t } = ctx; if (P.state("rest_day") !== "soft") return;
    const rest = T.restDays(P, ctx.A), ng = ctx.names.filter(n => P.hasExternal(n) && !rest[n].length);
    ctx.line(t("外勤があるのに週休日が発生しない人（減点 rest_day_missing）: {who}", { who: ng.join(ctx.sep()) || t("なし") }));
  },
  // 入力チェック: 外勤があるのに休日の勤務枠が全部不可
  lint(ctx, prm) {
    const { P } = ctx; if (!P.restDayRequired) return;
    for (const n of P.dutyNames) if (P.hasExternal(n)) { const c = P.slots.filter(s => ctx.canWork(n, s) && (s[1] === "day" || P.nextIsHoliday(s[0]))).length; if (!c) ctx.push("LINT_REST_DAY_IMPOSSIBLE", { who: n }); }
  },
  python: true,
});

// 規則のプラグイン: 日勤の希望を反映する（wish_day）。叶わなかった希望 1 件あたり減点。2 交代など日勤の枠が毎日ある施設向け（既定は「なし」）。docs/rule-modules.md
// 希望は月データ wishes.day_on = {氏名: [日]}（model.js が P.wishDay に読む）。職員別カレンダーの「日勤希望」
T.rules.register({
  id: "wish_day", api: 1, order: 911, group: "wish",
  label: "日勤の希望を反映する（日勤の枠がある日に「日勤希望」を出せる）", states: ["soft", "off"], def: "off",
  weight: "wish_day", w0: 30,
  read(P) { return { wishes: P.wishDay }; },
  solve(ctx, prm) {
    const { LP, lp, P } = ctx;
    for (const [n, days] of Object.entries(prm.wishes)) for (const d of days) if (ctx.names.includes(n) && ctx.has([d, "day"]) && d >= 1 && d <= P.N) lp.objAdd(P.weights.wish_day, LP.sub(1, ctx.work([d, "day"], n)));
  },
  penalty(ctx, prm) {
    for (const [n, days] of Object.entries(prm.wishes)) for (const d of days) if (ctx.names.includes(n) && ctx.has([d, "day"]) && d >= 1 && d <= ctx.N) ctx.add("wish_day", ctx.P.weights.wish_day, 1 - (ctx.worked(n, [d, "day"]) ? 1 : 0));
  },
  report(ctx, prm) {
    const { P, t } = ctx; for (const [n, days] of Object.entries(prm.wishes)) for (const d of days) if (P.slotExists(d, "day")) ctx.line(t("{who} の {day} の日勤希望: {result}", { who: n, day: P.label(d), result: t(ctx.worked(n, [d, "day"]) ? "反映" : "未反映") }));
  },
  python: false,
});

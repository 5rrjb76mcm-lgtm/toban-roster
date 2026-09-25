// 規則のプラグイン: 休日の日勤の希望を反映する（wish_weekend_dayshift）。希望した人に休日の日勤が 1 つも無ければ減点。docs/rule-modules.md
// 希望は月データ wishes.weekend_dayshift（P.wishWeekendDay）と、名簿の欄 rules.weekend_dayshift_wish
T.rules.register({
  id: "wish_weekend_dayshift", api: 1, order: 920, group: "wish",
  label: "休日の日勤の希望を反映する", states: ["soft", "off"], def: "soft",
  weight: "wish_weekend_dayshift", w0: 20,
  columns: [{ key: "wkw", order: 20, label: "休日日勤の希望",
    render(d, R) { return `<input type="checkbox" data-f="wkw" ${(R.weekend_dayshift_wish || []).includes(d.name) ? "checked" : ""}>`; },
    begin() { return []; }, read(td, d, R, acc, name) { if (td.querySelector("[data-f=wkw]").checked) acc.push(name); }, end(R, acc) { R.weekend_dayshift_wish = acc; },
    rename(R, o, n) { R.weekend_dayshift_wish = (R.weekend_dayshift_wish || []).map(x => x === o ? n : x); } }],
  read(P, rules) { return { who: [...new Set([...P.wishWeekendDay, ...(rules.weekend_dayshift_wish || [])])] }; },
  solve(ctx, prm) {
    const { LP, lp, P } = ctx, wkDays = []; for (let d = 1; d <= P.N; d++) if (P.isWeekend(d)) wkDays.push(d);
    for (const n of prm.who) { if (!ctx.names.includes(n)) continue;
      const hasV = lp.aux("wkday"); lp.add(hasV, "<=", LP.sum(wkDays.map(d => ctx.work([d, "day"], n)))); lp.objAdd(P.weights.wish_weekend_dayshift, LP.sub(1, hasV)); }
  },
  penalty(ctx, prm) {
    for (const n of prm.who) { if (!ctx.names.includes(n)) continue;
      let got = false; for (let d = 1; d <= ctx.N; d++) if (ctx.P.isWeekend(d) && ctx.worked(n, [d, "day"])) got = true;
      if (!got) ctx.add("wish_weekend_dayshift", ctx.P.weights.wish_weekend_dayshift, 1); }
  },
  // 説明資料の第 9 節（調整目標の達成状況）の行
  report(ctx, prm) {
    const { P, t } = ctx;
    for (const n of prm.who) { const ds = []; for (let d = 1; d <= P.N; d++) if (P.isWeekend(d) && ctx.worked(n, [d, "day"])) ds.push(`${P.month}/${d}`);
      ctx.line(t("{who} の休日の日勤の希望: {result}", { who: n, result: ds.length ? t("反映（{days}）", { days: ds.join(ctx.sep()) }) : t("未反映") })); }
  },
  python: true,
});

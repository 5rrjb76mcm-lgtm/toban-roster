// 規則のプラグイン: オンコール・休日勤務の回数の偏り（spread_standby）。対象は役割の機能で決まる: 期間責任者になれる役割＝夜間 OC、補助の役割＝OC 全体と休日勤務。
// それぞれ最多−最少に重みを掛けて減点。1 人以下なら偏りは無い。docs/rule-modules.md
T.rules.register({
  id: "spread_standby", api: 1, order: 980, group: "wish",
  label: "オンコール・休日勤務の回数の偏りを減らす", states: ["soft", "off"], def: "soft",
  weight: "spread_Y_oc", w0: 2, sub: ["spread_I_nightoc", "spread_Y_holiday_work"],
  solve(ctx) {
    const { LP, lp, P, W } = ctx;
    const spread = (vals, w) => { if (vals.length < 2) return; const a = lp.auxInt("smax", 0, 100), b = lp.auxInt("smin", 0, 100); for (const v of vals) { lp.add(a, ">=", v); lp.add(b, "<=", v); } lp.objAdd(w, a); lp.objAdd(-w, b); };
    spread(P.I.map(n => LP.sum(ctx.slots.filter(s => s[1] === "night").map(s => ctx.oc(s, n)))), W.spread_I_nightoc);
    spread(P.Y.map(n => LP.sum(ctx.slots.map(s => ctx.oc(s, n)))), W.spread_Y_oc);
    spread(P.Y.map(n => LP.sum(ctx.slots.filter(s => P.isHoliday(s[0])).map(s => ctx.work(s, n)))), W.spread_Y_holiday_work);
  },
  penalty(ctx) {
    const { P } = ctx, W = P.weights;
    const spread = (k, vals) => { if (vals.length >= 2) ctx.add(k, W[k], Math.max(...vals) - Math.min(...vals)); };
    spread("spread_I_nightoc", P.I.map(n => P.slots.filter(s => s[1] === "night" && ctx.onCall(n, s)).length));
    spread("spread_Y_oc", P.Y.map(n => P.slots.filter(s => ctx.onCall(n, s)).length));
    spread("spread_Y_holiday_work", P.Y.map(n => P.slots.filter(s => P.isHoliday(s[0]) && ctx.worked(n, s)).length));
  },
  python: true,
});

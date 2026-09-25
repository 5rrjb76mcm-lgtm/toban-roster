// 規則のプラグイン: オンコールを含む隣接枠の連続（OC→OC、OC→勤務、勤務→OC）を減点（oc_consecutive）。docs/rule-modules.md
// 実勤務どうしの連続は consecutive_days。同じ日の中（日勤帯→夜間）と、期間責任者になれる役割の同じ土日・祝日は減点しない。
// 翌月 1 日の固定指定との隣接も見る（期間責任者の月またぎの接続は本体 period_charge が扱う）。
T.rules.register({
  id: "oc_consecutive", api: 1, order: 400, group: "combo",
  label: "オンコールを含む隣接枠の連続を避ける（OC→OC、OC→勤務、勤務→OC）", states: ["soft", "off"], def: "soft",
  weight: "oc_consecutive", w0: 6,
  solve(ctx) {
    const { P, lp, LP, E, W, key } = ctx;
    const samePeriod = (s1, s2) => { const a = P.periodOfSlot[key(s1)], b = P.periodOfSlot[key(s2)]; return a != null && a === b; };
    const pen = (s1, s2, n) => { const v = lp.aux("occ"); lp.add(LP.sub(E(ctx.Ev(s1, n), ctx.Ev(s2, n)), 1), "<=", v); lp.objAdd(W.oc_consecutive, v); };
    for (let i = 0; i + 1 < P.allSlots.length; i++) {
      const s1 = P.allSlots[i], s2 = P.allSlots[i + 1]; if (s2[0] < 1 || s1[0] === s2[0]) continue;
      for (const n of ctx.names) { if (P.isRole(n, "charge") && samePeriod(s1, s2)) continue; pen(s1, s2, n); }
    }
    // 期間責任者になれる役割以外の連続夜間（間に休日の日勤枠がある組。日勤枠が無い組は上の隣接枠で減点済み）
    for (const n of ctx.names) { if (P.isRole(n, "charge")) continue; for (let d = ctx.firstPrev; d < P.N; d++) if (d + 1 >= 1 && ctx.has([d, "night"]) && ctx.has([d + 1, "day"])) pen([d, "night"], [d + 1, "night"], n); }
    if (!ctx.relaxed("fixed") && !ctx.relaxed("fixed:next") && P.nextFixedAny()) { const N = P.N, firstK = P.nextFirstSlotKind(), cross = P.lastCrossingPeriod();
      for (const n of ctx.names) {
        if (P.nextFixedEngaged(n, firstK) && ctx.has([N, "night"]) && !(P.isRole(n, "charge") && cross && firstK === "day")) lp.objAdd(W.oc_consecutive, ctx.Ev([N, "night"], n));
        if (!P.isRole(n, "charge") && firstK === "day" && P.nextFixedEngaged(n, "night") && ctx.has([N, "night"])) lp.objAdd(W.oc_consecutive, ctx.Ev([N, "night"], n));
      } }
  },
  penalty(ctx) {
    const { P, pos } = ctx, W = P.weights, key = s => `${s[0]}:${s[1]}`, Ev = (n, s) => ctx.has(s) ? (ctx.engaged(n, s) ? 1 : 0) : 0;
    const samePeriod = (s1, s2) => { const a = P.periodOfSlot[key(s1)], b = P.periodOfSlot[key(s2)]; return a != null && a === b; };
    for (let i = 0; i + 1 < P.allSlots.length; i++) {
      const s1 = P.allSlots[i], s2 = P.allSlots[i + 1]; if (s2[0] < 1 || s1[0] === s2[0]) continue;
      for (const n of ctx.names) if (!(P.isRole(n, "charge") && samePeriod(s1, s2))) ctx.add("oc_consecutive", W.oc_consecutive, pos(Ev(n, s1) + Ev(n, s2) - 1));
    }
    for (const n of ctx.names) if (!P.isRole(n, "charge")) for (let d = ctx.firstPrev; d < P.N; d++) if (d + 1 >= 1 && ctx.has([d, "night"]) && ctx.has([d + 1, "day"])) ctx.add("oc_consecutive", W.oc_consecutive, pos(Ev(n, [d, "night"]) + Ev(n, [d + 1, "night"]) - 1));
    if (P.nextFixedAny()) { const N = P.N, firstK = P.nextFirstSlotKind(), cross = P.lastCrossingPeriod();
      for (const n of ctx.names) {
        if (P.nextFixedEngaged(n, firstK) && ctx.has([N, "night"]) && !(P.isRole(n, "charge") && cross && firstK === "day")) ctx.add("oc_consecutive", W.oc_consecutive, Ev(n, [N, "night"]));
        if (!P.isRole(n, "charge") && firstK === "day" && P.nextFixedEngaged(n, "night") && ctx.has([N, "night"])) ctx.add("oc_consecutive", W.oc_consecutive, Ev(n, [N, "night"]));
      } }
  },
  // 説明資料の第 9 節（調整目標の達成状況）の行
  report(ctx, prm) {
    const { P, t } = ctx, lines = [];
    for (const n of ctx.names) { const cc = [];
      for (let i = 0; i + 1 < P.allSlots.length; i++) { const s1 = P.allSlots[i], s2 = P.allSlots[i + 1]; if (s2[0] < 1 || s1[0] === s2[0]) continue; if (!(ctx.engaged(n, s1) && ctx.engaged(n, s2))) continue; const p1 = P.periodOfSlot[`${s1[0]}:${s1[1]}`], p2 = P.periodOfSlot[`${s2[0]}:${s2[1]}`]; if (P.isRole(n, "charge") && p1 != null && p1 === p2) continue; cc.push(`${P.label(s1[0])}${P.shiftLabel(s1[1])}→${P.label(s2[0])}${P.shiftLabel(s2[1])}`); }
      if (!P.isRole(n, "charge")) for (let d = ctx.firstPrev; d < P.N; d++) if (ctx.has([d + 1, "day"]) && ctx.engaged(n, [d, "night"]) && ctx.engaged(n, [d + 1, "night"])) cc.push(`${P.label(d)}${P.shiftLabel("night")}→${P.label(d + 1)}${P.shiftLabel("night")}`);
      if (cc.length) lines.push(`${n}: ${cc.join(ctx.sep())}`); }
    ctx.line(t("OC を含む隣接枠の連続（減点 oc_consecutive。同日の日勤帯→夜間は除く）: {items}", { items: lines.join("／") || t("なし") }));
  },
  python: true,
});

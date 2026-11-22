// 規則のプラグイン: オンコールを含む隣接枠の連続（OC→OC、OC→勤務、勤務→OC）を減点（oc_consecutive）。docs/rule-modules.md
// 実勤務どうしの連続は consecutive_days。同じ日の中（日勤帯→夜間）と、期間責任者になれる役割の同じ土日・祝日は減点しない。
// 翌月 1 日の固定指定との隣接も見る（期間責任者の月またぎの接続は本体 period_charge が扱う）。
(function () {
// At the forward boundary use the last real shift on the last day, which may
// be day when this profile has no night on that date. The additional pair
// over a next-day day shift is specifically a night-to-night pair.
const nextPairs = (P, n) => {
  if (!P.nextFixedAny()) return [];
  const d = P.N, from = P.slotExists(d, "night") ? "night" : P.slotExists(d, "day") ? "day" : null;
  if (from == null) return [];
  const first = P.nextFirstSlotKind(), charge = P.isRole(n, "charge"), out = [];
  const add = k => {
    if (!P.nextSlotExists(k) || !P.nextFixedEngaged(n, k)) return;
    const nextWork = P.nextFixed.charge !== n && P.nextFixedWorked(n, k) && !(P.nextFixed[k + "_oc"] || []).includes(n);
    out.push({ prev: [d, from], next: [d + 1, k], nextWork });
  };
  if (!(charge && P.lastCrossingPeriod())) add(first);
  if (!charge && from === "night" && first === "day") add("night");
  return out;
};
T.rules.register({
  id: "oc_consecutive", api: 1, order: 400, group: "combo",
  label: "オンコールを含む隣接枠の連続を避ける（OC→OC、OC→勤務、勤務→OC）", states: ["soft", "off"], def: "soft",
  weight: "oc_consecutive", w0: 6,
  solve(ctx) {
    const { P, lp, LP, E, W, key } = ctx;
    const samePeriod = (s1, s2) => { const a = P.periodOfSlot[key(s1)], b = P.periodOfSlot[key(s2)]; return a != null && a === b; };
    // 対象は「少なくとも片方が OC」の連続。両方が実勤務の組（勤務→勤務）は consecutive_days が扱うので、ここでは数えない:
    // 両方が勤務のときだけ 1 にできる ww を引く（前月末の枠は定数。連日を必須で禁じていて両日の勤務が固定だけで決まらない組は、両方が勤務にならないので ww は要らない）
    const noBoth = (s1, s2, n) => P.isHard("consecutive_days") && !ctx.relaxed("consecutive") && s2[0] - s1[0] === 1 && !(ctx.fixedWorkDay(s1[0], n) && ctx.fixedWorkDay(s2[0], n));
    const pen = (s1, s2, n) => { const v = lp.aux("occ"), e = LP.sub(E(ctx.Ev(s1, n), ctx.Ev(s2, n)), 1), w1 = ctx.Wv(s1, n), w2 = ctx.Wv(s2, n);
      if (w1 === 0 || w2 === 0 || noBoth(s1, s2, n)) { /* 両方が勤務になることはない */ }
      else if (typeof w1 === "number") LP.addTo(e, w2, -1); else if (typeof w2 === "number") LP.addTo(e, w1, -1);
      else { const ww = lp.aux("occw"); lp.add(ww, "<=", w1); lp.add(ww, "<=", w2); LP.addTo(e, ww, -1); }
      lp.add(e, "<=", v); lp.objAdd(W.oc_consecutive, v); };
    for (let i = 0; i + 1 < P.allSlots.length; i++) {
      const s1 = P.allSlots[i], s2 = P.allSlots[i + 1]; if (s2[0] < 1 || s1[0] === s2[0]) continue;
      for (const n of ctx.names) { if (P.isRole(n, "charge") && samePeriod(s1, s2)) continue; pen(s1, s2, n); }
    }
    // 期間責任者になれる役割以外の連続夜間（間に休日の日勤枠がある組。日勤枠が無い組は上の隣接枠で減点済み）
    for (const n of ctx.names) { if (P.isRole(n, "charge")) continue; for (let d = ctx.firstPrev; d < P.N; d++) if (d + 1 >= 1 && ctx.has([d, "night"]) && ctx.has([d + 1, "day"])) pen([d, "night"], [d + 1, "night"], n); }
    if (!ctx.relaxed("fixed") && !ctx.relaxed("fixed:next")) for (const n of ctx.names)
      for (const { prev, nextWork } of nextPairs(P, n))
        lp.objAdd(W.oc_consecutive, nextWork ? ctx.Ov(prev, n) : ctx.Ev(prev, n));
  },
  penalty(ctx) {
    const { P } = ctx, W = P.weights, key = s => `${s[0]}:${s[1]}`, Ev = (n, s) => ctx.has(s) ? (ctx.engaged(n, s) ? 1 : 0) : 0, Wk = (n, s) => ctx.has(s) && ctx.worked(n, s) ? 1 : 0;
    const pos = (x, n, s1, s2) => Math.max(0, x) && !(Wk(n, s1) && Wk(n, s2)) ? 1 : 0; // 両方に入っていて、両方が実勤務ではない（少なくとも片方が OC）
    const samePeriod = (s1, s2) => { const a = P.periodOfSlot[key(s1)], b = P.periodOfSlot[key(s2)]; return a != null && a === b; };
    for (let i = 0; i + 1 < P.allSlots.length; i++) {
      const s1 = P.allSlots[i], s2 = P.allSlots[i + 1]; if (s2[0] < 1 || s1[0] === s2[0]) continue;
      for (const n of ctx.names) if (!(P.isRole(n, "charge") && samePeriod(s1, s2))) ctx.add("oc_consecutive", W.oc_consecutive, pos(Ev(n, s1) + Ev(n, s2) - 1, n, s1, s2));
    }
    for (const n of ctx.names) if (!P.isRole(n, "charge")) for (let d = ctx.firstPrev; d < P.N; d++) if (d + 1 >= 1 && ctx.has([d, "night"]) && ctx.has([d + 1, "day"])) ctx.add("oc_consecutive", W.oc_consecutive, pos(Ev(n, [d, "night"]) + Ev(n, [d + 1, "night"]) - 1, n, [d, "night"], [d + 1, "night"]));
    for (const n of ctx.names) for (const { prev, nextWork } of nextPairs(P, n))
      if (!nextWork || !Wk(n, prev)) ctx.add("oc_consecutive", W.oc_consecutive, Ev(n, prev));
  },
  // 説明資料の第 9 節（調整目標の達成状況）の行
  report(ctx, prm) {
    const { P, t } = ctx, lines = [];
    for (const n of ctx.names) { const cc = [];
      for (let i = 0; i + 1 < P.allSlots.length; i++) { const s1 = P.allSlots[i], s2 = P.allSlots[i + 1]; if (s2[0] < 1 || s1[0] === s2[0]) continue; if (!(ctx.engaged(n, s1) && ctx.engaged(n, s2)) || (ctx.worked(n, s1) && ctx.worked(n, s2))) continue; const p1 = P.periodOfSlot[`${s1[0]}:${s1[1]}`], p2 = P.periodOfSlot[`${s2[0]}:${s2[1]}`]; if (P.isRole(n, "charge") && p1 != null && p1 === p2) continue; cc.push(`${P.label(s1[0])}${P.shiftLabel(s1[1])}→${P.label(s2[0])}${P.shiftLabel(s2[1])}`); }
      if (!P.isRole(n, "charge")) for (let d = ctx.firstPrev; d < P.N; d++) if (d + 1 >= 1 && ctx.has([d, "night"]) && ctx.has([d + 1, "day"]) && ctx.has([d + 1, "night"]) && ctx.engaged(n, [d, "night"]) && ctx.engaged(n, [d + 1, "night"]) && !(ctx.worked(n, [d, "night"]) && ctx.worked(n, [d + 1, "night"]))) cc.push(`${P.label(d)}${P.shiftLabel("night")}→${P.label(d + 1)}${P.shiftLabel("night")}`);
      for (const { prev, next, nextWork } of nextPairs(P, n))
        if (ctx.engaged(n, prev) && !(nextWork && ctx.worked(n, prev)))
          cc.push(`${P.label(prev[0])}${P.shiftLabel(prev[1])}→${P.label(next[0])}${P.shiftLabel(next[1])}`);
      if (cc.length) lines.push(`${n}: ${cc.join(ctx.sep())}`); }
    ctx.line(t("OC を含む隣接枠の連続（減点 oc_consecutive。同日の日勤帯→夜間は除く）: {items}", { items: lines.join("／") || t("なし") }));
  },
  python: true,
});
})();

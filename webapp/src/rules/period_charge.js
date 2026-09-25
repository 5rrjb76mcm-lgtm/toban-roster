// 規則のプラグイン: 休日・週末の期間責任者（period_charge）。期間（土日・祝日）の全枠に、期間責任者になれる役割の同じ 1 名が勤務かオンコールで関わる。docs/rule-modules.md
// 日ごとの担当 cday と、期間に担当したか chargedP を作り、他のプラグイン（週末の均等）に事実 "charge" として渡す。
// 減点: 土日の分割（split_weekend）、連続する週末（consecutive_weekend）、履歴込みの偏り（weekend_history_spread）、担当者の日勤なし（charge_without_dayshift）。
// 固定指定（fixed.weekend_charge）、前月末からの接続、翌月 1 日の固定との接続もここ。
T.rules.register({
  id: "period_charge", api: 1, order: 420, group: "team",
  label: "休日・週末に期間責任者を置く（{charge}担当。その期間の全枠に同じ1名が関与する）", states: ["hard", "off"], def: "hard",
  weight: null, w0: null, relax: "charge", sub: ["consecutive_weekend", "split_weekend", "weekend_history_spread", "charge_without_dayshift"],
  solve(ctx) {
    const { P, lp, LP, E, W, key } = ctx, cday = {}, chargedP = {};
    for (const p of P.periods) {
      for (const d of p.days) {
        for (const n of P.I) { cday[`${d}|${n}`] = lp.bin(`c${d}_${ctx.ni[n]}`); for (const s of p.slots) if (s[0] === d) lp.add(ctx.Ev(s, n), "=", cday[`${d}|${n}`]); }
        lp.add(LP.sum(P.I.map(n => cday[`${d}|${n}`])), "=", 1);
      }
      if (p.kind === "weekend" && p.full) { // 土日は原則同一人。均等配分のためだけ分割可（減点）
        const [d1, d2] = p.days, sp = lp.aux("split");
        for (const n of P.I) { lp.add(LP.sub(cday[`${d1}|${n}`], cday[`${d2}|${n}`]), "<=", sp); lp.add(LP.sub(cday[`${d2}|${n}`], cday[`${d1}|${n}`]), "<=", sp); }
        lp.objAdd(W.split_weekend ?? 60, sp);
      }
      for (const n of P.I) { const cp = lp.aux("cp"); chargedP[`${p.id}|${n}`] = cp; for (const d of p.days) lp.add(cp, ">=", cday[`${d}|${n}`]); lp.add(cp, "<=", LP.sum(p.days.map(d => cday[`${d}|${n}`]))); }
      for (const [d, n] of Object.entries(P.fixedCharge)) if (p.days.includes(+d) && cday[`${d}|${n}`] && !ctx.relaxed("fixed") && !ctx.relaxed(`fixed:charge:${d}`)) lp.add(cday[`${d}|${n}`], "=", 1);
    }
    // 月またぎの土日: 前月末（土曜）の担当者が翌月 1 日（日曜）も担当する
    if (!ctx.relaxed("prev_connection")) for (const p of P.periods) { if (!p.prevDays.length) continue;
      const prevI = P.I.filter(n => p.prevDays.some(pd => ["day", "night"].some(k => ctx.Wv([pd, k], n) === 1 || ctx.Ov([pd, k], n) === 1)));
      if (prevI.length === 1 && cday[`${p.days[0]}|${prevI[0]}`]) lp.add(cday[`${p.days[0]}|${prevI[0]}`], "=", 1); }
    // 翌月 1 日の固定指定: 月またぎの土日の担当者の接続（期間責任者の固定があればそれを優先）
    if (!ctx.relaxed("fixed") && !ctx.relaxed("fixed:next") && P.nextFixedAny()) { const N = P.N, firstK = P.nextFirstSlotKind(), cross = P.lastCrossingPeriod();
      for (const n of ctx.names) if (P.nextFixedEngaged(n, firstK) && ctx.has([N, "night"]) && P.isRole(n, "charge") && cross && firstK === "day" && !P.nextFixed.charge && cday[`${N}|${n}`]) lp.add(cday[`${N}|${n}`], "=", 1);
      if (cross && P.nextFixed.charge && cday[`${N}|${P.nextFixed.charge}`]) lp.add(cday[`${N}|${P.nextFixed.charge}`], "=", 1); }
    const fullDays = {}; for (const n of P.I) fullDays[n] = LP.sum(P.periods.filter(p => p.kind === "weekend" && p.full).flatMap(p => p.days.map(d => cday[`${d}|${n}`])));
    ctx.provide("charge", { cday, chargedP, fullDays });
    // 連続する週末
    const wps = P.periods.filter(p => p.kind === "weekend");
    const prevC = (wps.length && wps[0].crossing && wps[0].prevDays.length) ? P.prevPrevWeekendCharge : P.prevLastWeekendCharge;
    wps.forEach((p, i) => { for (const n of P.I) { const prev = i > 0 ? chargedP[`${wps[i - 1].id}|${n}`] : (prevC === n ? 1 : 0); const v = lp.aux("cw"); lp.add(LP.sub(E(prev, chargedP[`${p.id}|${n}`]), 1), "<=", v); lp.objAdd(W.consecutive_weekend, v); } });
    // 履歴込みの偏り。単位は「日」: 履歴は組数×2、完全な土日は担当日数（1組=2日）、月またぎの土日は1組=2単位。上限はデータから決める
    const wb = P.histWeekendBound(), mx = lp.auxInt("wmax", 0, wb), mn = lp.auxInt("wmin", 0, wb);
    for (const n of P.I) { const crossing = LP.sum(wps.filter(p => !p.full).map(p => chargedP[`${p.id}|${n}`])); const tot = E(2 * (P.histWeekend[n] || 0), fullDays[n]); LP.addTo(tot, crossing, 2); lp.add(mx, ">=", tot); lp.add(mn, "<=", tot); }
    lp.objAdd(W.weekend_history_spread, mx); lp.objAdd(-W.weekend_history_spread, mn);
    // 週末担当者の日勤
    for (const p of P.periods) for (const n of P.I) { const v = lp.aux("cd"); lp.add(LP.sub(chargedP[`${p.id}|${n}`], LP.sum(p.slots.filter(s => s[1] === "day").map(s => ctx.work(s, n)))), "<=", v); lp.objAdd(W.charge_without_dayshift, v); }
  },
  // 検算: 割当から日ごとの担当を決め（その日の枠すべてに関わる期間責任者になれる人）、事実 "charge" として渡す（本体は結果の表示にも使う）
  check(ctx) {
    const { P, A } = ctx, charge = {};
    for (const p of P.periods) {
      const cd = {};
      for (const d of p.days) { const cs = new Set();
        for (const s of p.slots) { if (s[0] !== d) continue; const e = [...A.engaged(s)].filter(n => P.isRole(n, "charge")); if (e.length !== 1) ctx.viol("PERIOD_CHARGE_NOT_ONE_IN_SLOT", { slot: ctx.slab(s) }); e.forEach(x => cs.add(x)); }
        if (cs.size !== 1) ctx.viol("PERIOD_CHARGE_NOT_ONE_IN_DAY", { day: ctx.lab(d), who: [...cs].sort().join("・") || "―" });
        cd[d] = cs.size === 1 ? [...cs][0] : null; }
      charge[p.id] = cd;
      const first = cd[p.days[0]];
      { const prevI = [...new Set(p.prevDays.flatMap(pd => ["day", "night"].flatMap(k => [...A.engaged([pd, k])].filter(n => P.isRole(n, "charge")))))];
        if (prevI.length === 1 && first && first !== prevI[0]) ctx.viol("PERIOD_CHARGE_PREV_LINK", { period: p.name, who: prevI[0] }); } // 前月末に期間責任者になれる人が2名いる入力はソルバーも接続しない（lint が知らせる）
      for (const [d, n] of Object.entries(P.fixedCharge)) if (p.days.includes(+d) && cd[+d] !== n) ctx.viol("PERIOD_CHARGE_FIXED_MISMATCH", { day: ctx.lab(+d), who: n });
    }
    { const cross = P.lastCrossingPeriod(); if (cross && P.nextFixedAny()) { const cd = charge[cross.id][P.N]; const want = P.nextFixed.charge || P.I.find(n => P.nextFixedEngaged(n, "day")); if (want && cd && cd !== want) ctx.viol("PERIOD_CHARGE_NEXT_LINK", { period: cross.name, want, got: cd }); } }
    ctx.provide("charge", { map: charge });
  },
  penalty(ctx) {
    const { P, A, pos } = ctx, W = P.weights, cday = {}, charged = {};
    for (const p of P.periods) {
      for (const d of p.days) { const s = p.slots.find(x => x[0] === d); cday[d] = s ? P.I.find(n => A.eng(n, s)) || null : null; }
      for (const n of P.I) charged[`${p.id}|${n}`] = p.days.some(d => cday[d] === n) ? 1 : 0;
      if (p.kind === "weekend" && p.full && cday[p.days[0]] !== cday[p.days[1]]) ctx.add("split_weekend", W.split_weekend ?? 60, 1);
    }
    const fullDays = {}; for (const n of P.I) fullDays[n] = P.periods.filter(p => p.kind === "weekend" && p.full).reduce((a, p) => a + p.days.filter(d => cday[d] === n).length, 0);
    ctx.provide("charge", { cday, charged, fullDays });
    const wps = P.periods.filter(p => p.kind === "weekend");
    const prevC = (wps.length && wps[0].crossing && wps[0].prevDays.length) ? P.prevPrevWeekendCharge : P.prevLastWeekendCharge;
    wps.forEach((p, i) => { for (const n of P.I) { const prev = i > 0 ? charged[`${wps[i - 1].id}|${n}`] : (prevC === n ? 1 : 0); ctx.add("consecutive_weekend", W.consecutive_weekend, pos(prev + charged[`${p.id}|${n}`] - 1)); } });
    const tots = P.I.map(n => 2 * (P.histWeekend[n] || 0) + fullDays[n] + 2 * wps.filter(p => !p.full).reduce((a, p) => a + charged[`${p.id}|${n}`], 0));
    if (tots.length) ctx.add("weekend_history_spread", W.weekend_history_spread, Math.max(...tots) - Math.min(...tots));
    for (const p of P.periods) for (const n of P.I) ctx.add("charge_without_dayshift", W.charge_without_dayshift, pos(charged[`${p.id}|${n}`] - p.slots.filter(s => s[1] === "day").reduce((a, s) => a + (ctx.worked(n, s) ? 1 : 0), 0)));
  },
  messages: {
    PERIOD_CHARGE_NOT_ONE_IN_SLOT: { en: "{slot}: not exactly one {charge} on this slot", ja: "{slot}: {charge}の担当が1名でない" },
    PERIOD_CHARGE_NOT_ONE_IN_DAY: { en: "{day}: {charge} duty is not held by exactly one person across the day's slots {who}", ja: "{day}: {charge}担当が全枠を通して1名でない {who}" },
    PERIOD_CHARGE_PREV_LINK: { en: "{period}: does not carry on from {who}, who held {charge} duty at the end of last month", ja: "{period}: 前月末の{charge}担当{who}と接続していない" },
    PERIOD_CHARGE_FIXED_MISMATCH: { en: "{day}: does not match the hand-fixed {charge} duty {who}", ja: "{day}: 固定指定の{charge}担当{who}と不一致" },
    PERIOD_CHARGE_NEXT_LINK: { en: "{period}: the 1st of next month is fixed to {want}, but {charge} duty at the end of the month is {got}", ja: "{period}: 翌月1日の固定 {want} と月末の{charge}担当 {got} が接続していない" },
  },
  // 入力チェック: 期間責任者の役割が無い、翌月 1 日・固定・前月末の接続の矛盾、期間責任者になれる人がいない休日
  lint(ctx, prm) {
    const { P } = ctx, lab = ctx.lab, unN = ctx.unN, unO = ctx.unO;
    if (P.state("period_charge") === "hard" && !P.refId("charge")) ctx.push("LINT_ROLE_REF_MISSING", { ref: T.t("期間の責任者になれる") });
    if (!P.isHard("period_charge")) return;
    { const pf = P.nextFixed; const iEng = P.I.filter(n => P.nextFixedEngaged(n, "day"));
      if (pf.charge && iEng.some(n => n !== pf.charge)) ctx.push("LINT_NEXT_FIRST_TWO_CHARGE", { who: pf.charge, others: ctx.join(iEng.filter(n => n !== pf.charge)) }); else if (!pf.charge && iEng.length > 1) ctx.push("LINT_NEXT_FIRST_TWO_CHARGE2", { others: ctx.join(iEng) }); }
    // 期間責任者は期間中の全枠に勤務かオンコールで関わる。オンコールを付けない勤務帯が期間の日にあると、同じ人が連日勤務するしかなく解なしになりやすい
    if (P.state("oncall") !== "off") for (const sh of P.shifts) if (sh.oncall === false && P.periods.some(p => p.slots.some(s => s[1] === sh.id))) ctx.push("LINT_PERIOD_CHARGE_NEEDS_ONCALL", { shift: sh.label });
    for (const [ds, n] of Object.entries(P.fixedCharge)) { const d = +ds;
      if (!P.I.includes(n)) { ctx.push("LINT_FIXED_CHARGE_NOT_ROLE", { day: lab(d), who: n }); continue; }
      const p = P.periods.find(p => p.days.includes(d));
      if (!p) { ctx.push("LINT_FIXED_CHARGE_NOT_OFF_DAY", { day: lab(d), who: n }); continue; }
      if (unN(n, d) || unO(n, d)) ctx.push("LINT_FIXED_CHARGE_VS_UNAVAIL", { day: lab(d), who: n }); }
    // 月またぎの接続: 前月末の期間責任者が翌月1日に不可
    for (const p of P.periods) { if (!p.prevDays.length) continue; const d = p.days[0];
      const prevI = P.I.filter(n => p.prevDays.some(pd => { const f = P.prevFixed[`${pd}:day`], g = P.prevFixed[`${pd}:night`]; return (f && (f.work === n || f.oc.includes(n))) || (g && (g.work === n || g.oc.includes(n))); }));
      if (prevI.length === 1) { const n = prevI[0]; if (unN(n, d) || unO(n, d)) ctx.push("LINT_PREV_CHARGE_UNAVAIL", { who: n, day: lab(d) }); }
      else if (prevI.length > 1) ctx.push("LINT_PREV_CHARGE_TWO", { who: ctx.join(prevI) }); }
    // 各休日に期間責任者になれる人がいるか
    for (const p of P.periods) for (const d of p.days) { const cands = P.I.filter(n => !unN(n, d) && !unO(n, d) && !P.busy(n, d + 1, "am", ["external"])); if (!cands.length) ctx.push("LINT_NO_CHARGE_CANDIDATE", { day: lab(d) }, { who: ctx.join(P.I) }); }
  },
  python: true,
});

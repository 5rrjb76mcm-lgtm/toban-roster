// 規則のプラグイン: 休日・週末の期間責任者（period_charge）。期間（土日・祝日）の各枠に、期間責任者になれる役割の 1 名が勤務かオンコールで関わる（必須）。docs/rule-modules.md
// その日の担当（cday）は、その日の最初の枠（日勤帯があれば日勤帯）に関わる人。同じ日の後の枠（夜間）が別の人になるのは「日の途中の交代」で、必須ではなく減点（charge_handover。固定したとき・ほかに手が無いときだけ起きる大きさ）。
// 日ごとの担当 cday と、期間に担当したか chargedP を作り、他のプラグイン（週末の均等）に事実 "charge" として渡す（週末の均等・連続・履歴は、その日の担当＝最初の枠の人で数える）。
// 減点: 日の途中の交代（charge_handover）、土日の分割（split_weekend）、連続する週末（consecutive_weekend）、履歴込みの偏り（weekend_history_spread）、担当者の日勤なし（charge_without_dayshift）。
// 固定指定（fixed.weekend_charge）、前月末からの接続、翌月 1 日の固定との接続もここ。
// その日の枠（日勤帯を先に）。解く側・検算・減点・入力チェック・説明資料が同じ並びを使う
T.chargeDaySlots = (p, d) => p.slots.filter(s => s[0] === d).sort((a, b) => (a[1] === "day" ? 0 : 1) - (b[1] === "day" ? 0 : 1));
// 前月末も日ごとの最初の実在枠から担当者を決める。夜間だけの前月データでは夜間が最初の枠。
T.prevChargeSlots = (P, p) => p.prevDays.map(d => T.chargeDaySlots({ slots: P.prevSlots }, d)[0]).filter(Boolean);
// 割当から、日の途中で期間責任者が交代した日を出す（[{ d, who: [最初の枠の人, 後の枠の人…] }]）。減点と説明資料が使う
T.chargeHandovers = (P, A) => { const out = [];
  for (const p of P.periods) for (const d of p.days) { const who = T.chargeDaySlots(p, d).map(s => P.I.find(n => A.eng(n, s)) || null); if (who.length > 1 && who.slice(1).some(x => x !== who[0])) out.push({ d, who }); }
  return out; };
T.rules.register({
  id: "period_charge", api: 1, order: 420, group: "team",
  label: "休日・週末に期間責任者を置く（{charge}担当。休日の各枠に1名が関与し、同じ日は同じ人が原則。日の途中の交代は減点）", states: ["hard", "off"], def: "hard",
  weight: null, w0: null, relax: "charge", sub: ["charge_handover", "consecutive_weekend", "split_weekend", "weekend_history_spread", "charge_without_dayshift"],
  solve(ctx) {
    const { P, lp, LP, E, W, key } = ctx, cday = {}, chargedP = {};
    // 暦上の期間は表示・履歴のために残すが、勤務枠のない期間に担当者を作らない。
    const periods = P.periods.filter(p => p.slots.length);
    for (const p of periods) {
      for (const d of p.days) { const ds = T.chargeDaySlots(p, d);
        // その日の担当＝最初の枠に関わる人（1 名）。後の枠にも 1 名が関わり、最初の枠と別の人なら日の途中の交代（hv=1。減点）
        for (const n of P.I) { cday[`${d}|${n}`] = lp.bin(`c${d}_${ctx.ni[n]}`); if (ds.length) lp.add(ctx.Ev(ds[0], n), "=", cday[`${d}|${n}`]); }
        lp.add(LP.sum(P.I.map(n => cday[`${d}|${n}`])), "=", 1);
        if (ds.length > 1) { const hv = lp.aux("handover");
          for (const s of ds.slice(1)) { lp.add(LP.sum(P.I.map(n => ctx.Ev(s, n))), "=", 1); for (const n of P.I) { lp.add(LP.sub(ctx.Ev(s, n), cday[`${d}|${n}`]), "<=", hv); lp.add(LP.sub(cday[`${d}|${n}`], ctx.Ev(s, n)), "<=", hv); } }
          lp.objAdd(W.charge_handover ?? 200, hv); }
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
    if (!ctx.relaxed("prev_connection")) for (const p of periods) { if (!p.prevDays.length) continue;
      const prevI = P.I.filter(n => T.prevChargeSlots(P, p).some(s => ctx.Wv(s, n) === 1 || ctx.Ov(s, n) === 1));
      if (prevI.length === 1 && cday[`${p.days[0]}|${prevI[0]}`]) lp.add(cday[`${p.days[0]}|${prevI[0]}`], "=", 1); }
    // 翌月 1 日の固定指定: 月またぎの土日の担当者の接続（期間責任者の固定があればそれを優先）。
    // 日勤帯がない日は夜間が最初の枠なので、その勤務・OC の固定から担当者を決める。
    if (!ctx.relaxed("fixed") && !ctx.relaxed("fixed:next") && P.nextFixedAny()) { const N = P.N, firstK = P.nextFirstSlotKind(), cross = P.lastCrossingPeriod();
      for (const n of ctx.names) if (P.nextSlotExists(firstK) && P.nextFixedEngaged(n, firstK) && P.isRole(n, "charge") && cross && !P.nextFixed.charge && cday[`${N}|${n}`]) lp.add(cday[`${N}|${n}`], "=", 1);
      if (cross && P.nextFixed.charge && cday[`${N}|${P.nextFixed.charge}`]) lp.add(cday[`${N}|${P.nextFixed.charge}`], "=", 1); }
    const fullDays = {}; for (const n of P.I) fullDays[n] = LP.sum(periods.filter(p => p.kind === "weekend" && p.full).flatMap(p => p.days.map(d => cday[`${d}|${n}`])));
    ctx.provide("charge", { cday, chargedP, fullDays });
    // 連続する週末
    const wps = periods.filter(p => p.kind === "weekend");
    const prevC = (wps.length && wps[0].crossing && wps[0].prevDays.length) ? P.prevPrevWeekendCharge : P.prevLastWeekendCharge;
    wps.forEach((p, i) => { for (const n of P.I) { const prev = i > 0 ? chargedP[`${wps[i - 1].id}|${n}`] : (prevC === n ? 1 : 0); const v = lp.aux("cw"); lp.add(LP.sub(E(prev, chargedP[`${p.id}|${n}`]), 1), "<=", v); lp.objAdd(W.consecutive_weekend, v); } });
    // 履歴込みの偏り。単位は「日」: 履歴は組数×2、完全な土日は担当日数（1組=2日）、月またぎの土日は1組=2単位。上限はデータから決める
    if (P.I.length) { // 対象者が0名なら最多・最少を作らない（制約のない最少が架空の減点を生む）。
      const wb = P.histWeekendBound(), mx = lp.auxInt("wmax", 0, wb), mn = lp.auxInt("wmin", 0, wb);
      for (const n of P.I) { const crossing = LP.sum(wps.filter(p => !p.full).map(p => chargedP[`${p.id}|${n}`])); const tot = E(2 * (P.histWeekend[n] || 0), fullDays[n]); LP.addTo(tot, crossing, 2); lp.add(mx, ">=", tot); lp.add(mn, "<=", tot); }
      lp.objAdd(W.weekend_history_spread, mx); lp.objAdd(-W.weekend_history_spread, mn);
    }
    // 週末担当者の日勤
    for (const p of periods) for (const n of P.I) { const v = lp.aux("cd"); lp.add(LP.sub(chargedP[`${p.id}|${n}`], LP.sum(p.slots.filter(s => s[1] === "day").map(s => ctx.work(s, n)))), "<=", v); lp.objAdd(W.charge_without_dayshift, v); }
  },
  // 検算: 割当から日ごとの担当を決め（その日の最初の枠に関わる期間責任者になれる人）、事実 "charge" として渡す（本体は結果の表示にも使う）
  check(ctx) {
    const { P, A } = ctx, charge = {};
    for (const p of P.periods) {
      const cd = {};
      for (const d of p.days) { const ds = T.chargeDaySlots(p, d);
        if (!ds.length) { cd[d] = null; continue; }
        const per = ds.map(s => { const e = [...A.engaged(s)].filter(n => P.isRole(n, "charge")); if (e.length !== 1) ctx.viol("PERIOD_CHARGE_NOT_ONE_IN_SLOT", { slot: ctx.slab(s) }); return e; });
        cd[d] = per[0].length === 1 ? per[0][0] : null; } // その日の担当は最初の枠の人。後の枠が別の人（日の途中の交代）は違反ではなく減点（penalty の charge_handover）
      charge[p.id] = cd;
      const first = cd[p.days[0]];
      { const prevI = [...new Set(T.prevChargeSlots(P, p).flatMap(s => [...A.engaged(s)].filter(n => P.isRole(n, "charge"))))];
        if (prevI.length === 1 && first && first !== prevI[0]) ctx.viol("PERIOD_CHARGE_PREV_LINK", { period: p.name, who: prevI[0] }); } // 前月末の最初の枠に期間責任者になれる人が2名いる入力はソルバーも接続しない（lint が知らせる）
      for (const [d, n] of Object.entries(P.fixedCharge)) if (p.days.includes(+d) && cd[+d] !== n) ctx.viol("PERIOD_CHARGE_FIXED_MISMATCH", { day: ctx.lab(+d), who: n });
    }
    { const cross = P.lastCrossingPeriod(); if (cross && P.nextFixedAny()) { const cd = charge[cross.id][P.N], firstK = P.nextFirstSlotKind(); const want = P.nextFixed.charge || (P.nextSlotExists(firstK) && P.I.find(n => P.nextFixedEngaged(n, firstK))); if (want && cd && cd !== want) ctx.viol("PERIOD_CHARGE_NEXT_LINK", { period: cross.name, want, got: cd }); } }
    ctx.provide("charge", { map: charge });
  },
  penalty(ctx) {
    const { P, A, pos } = ctx, W = P.weights, cday = {}, charged = {};
    const periods = P.periods.filter(p => p.slots.length);
    for (const p of periods) {
      for (const d of p.days) { const s = T.chargeDaySlots(p, d)[0]; cday[d] = s ? P.I.find(n => A.eng(n, s)) || null : null; }
      for (const n of P.I) charged[`${p.id}|${n}`] = p.days.some(d => cday[d] === n) ? 1 : 0;
      if (p.kind === "weekend" && p.full && cday[p.days[0]] !== cday[p.days[1]]) ctx.add("split_weekend", W.split_weekend ?? 60, 1);
    }
    ctx.add("charge_handover", W.charge_handover ?? 200, T.chargeHandovers(P, A).length); // 日の途中の交代（1 日あたり）
    const fullDays = {}; for (const n of P.I) fullDays[n] = periods.filter(p => p.kind === "weekend" && p.full).reduce((a, p) => a + p.days.filter(d => cday[d] === n).length, 0);
    ctx.provide("charge", { cday, charged, fullDays });
    const wps = periods.filter(p => p.kind === "weekend");
    const prevC = (wps.length && wps[0].crossing && wps[0].prevDays.length) ? P.prevPrevWeekendCharge : P.prevLastWeekendCharge;
    wps.forEach((p, i) => { for (const n of P.I) { const prev = i > 0 ? charged[`${wps[i - 1].id}|${n}`] : (prevC === n ? 1 : 0); ctx.add("consecutive_weekend", W.consecutive_weekend, pos(prev + charged[`${p.id}|${n}`] - 1)); } });
    const tots = P.I.map(n => 2 * (P.histWeekend[n] || 0) + fullDays[n] + 2 * wps.filter(p => !p.full).reduce((a, p) => a + charged[`${p.id}|${n}`], 0));
    if (tots.length) ctx.add("weekend_history_spread", W.weekend_history_spread, Math.max(...tots) - Math.min(...tots));
    for (const p of periods) for (const n of P.I) ctx.add("charge_without_dayshift", W.charge_without_dayshift, pos(charged[`${p.id}|${n}`] - p.slots.filter(s => s[1] === "day").reduce((a, s) => a + (ctx.worked(n, s) ? 1 : 0), 0)));
  },
  messages: {
    PERIOD_CHARGE_NOT_ONE_IN_SLOT: { en: "{slot}: not exactly one {charge} on this slot", ja: "{slot}: {charge}の担当が1名でない" },
    PERIOD_CHARGE_PREV_LINK: { en: "{period}: does not carry on from {who}, who held {charge} duty at the end of last month", ja: "{period}: 前月末の{charge}担当{who}と接続していない" },
    PERIOD_CHARGE_FIXED_MISMATCH: { en: "{day}: does not match the hand-fixed {charge} duty {who}", ja: "{day}: 固定指定の{charge}担当{who}と不一致" },
    PERIOD_CHARGE_NEXT_LINK: { en: "{period}: the 1st of next month is fixed to {want}, but {charge} duty at the end of the month is {got}", ja: "{period}: 翌月1日の固定 {want} と月末の{charge}担当 {got} が接続していない" },
    LINT_FIXED_CHARGE_NO_SLOT: { en: "{day}: {charge} duty is fixed to {who}, but there are no shift slots", ja: "{day}: {charge}担当 {who} を固定していますが、勤務枠がありません" },
    LINT_FIXED_CHARGE_NO_SLOT_HINT: { en: "Clear the fixed {charge} duty or review the shift settings", ja: "期間責任者の固定を外すか、勤務帯の設定を見直す" },
    LINT_FIXED_CHARGE_TWO_IN_SLOT: { en: "Fixed assignments put more than one {charge} on {slot} ({who}). Only one {charge} can be involved in a slot, so this cannot be solved as it is", ja: "固定指定: {slot} に{charge}を 2 名以上固定しています（{who}）。1 つの枠に関与する{charge}は 1 名なので、このままでは解なしになります" },
    LINT_FIXED_CHARGE_TWO_IN_SLOT_HINT: { en: "Leave one {charge} (work or on-call) on that slot", ja: "その枠の{charge}（勤務・OC）を 1 名にしてください" },
    LINT_FIXED_CHARGE_VS_FIRST_SLOT: { en: "Fixed {charge} duty {who} on {day} conflicts with {other} fixed on {slot}. The day's {charge} is the person on the first slot of the day, so this cannot be solved as it is", ja: "固定指定: {day} の{charge}担当 {who} と、{slot}に固定した {other} が食い違います。その日の{charge}担当は最初の枠に関与する人なので、このままでは解なしになります" },
    LINT_FIXED_CHARGE_VS_FIRST_SLOT_HINT: { en: "Change either the fixed {charge} duty or the fixed {slot}. If the duty changes hands during the day, fix the {charge} duty to the person on the first slot", ja: "{charge}担当の固定か、{slot}の固定のどちらかを直してください。日の途中で交代するなら、{charge}担当の固定は最初の枠の人にします" },
    LINT_FIXED_CHARGE_HANDOVER: { en: "Fixed assignments make the {charge} change hands during {day} ({detail}). This can be solved (a change during the day costs a penalty per day). Check that it is intended", ja: "固定指定: {day} は{charge}が日の途中で交代します（{detail}）。このまま計算できます（交代は 1 日あたりの減点）。意図どおりか確かめてください" },
    LINT_FIXED_CHARGE_HANDOVER_HINT: { en: "Leave it if intended. To keep one person, make the {charge} (work or on-call) the same across the day's slots", ja: "意図どおりならそのままで構いません。同じ人にするなら、日勤帯と夜間の{charge}（勤務・OC）をそろえます" },
  },
  // 入力チェック: 期間責任者の役割が無い、翌月 1 日・固定・前月末の接続の矛盾、期間責任者になれる人がいない休日
  lint(ctx, prm) {
    const { P } = ctx, lab = ctx.lab, unN = ctx.unN, unO = ctx.unO;
    const unavailable = (n, [d, k]) => k === "night" ? unN(n, d) || unO(n, d) === "allday" : !!unO(n, d);
    if (P.state("period_charge") === "hard" && !P.refId("charge")) ctx.push("LINT_ROLE_REF_MISSING", { ref: T.t("期間の責任者になれる") });
    if (!P.isHard("period_charge")) return;
    if (P.nextFixed.charge && !P.nextSlotExists("day") && !P.nextSlotExists("night")) ctx.push("LINT_FIXED_CHARGE_NO_SLOT", { day: lab(P.N + 1), who: P.nextFixed.charge });
    { const pf = P.nextFixed, firstK = P.nextFirstSlotKind(); const iEng = P.nextSlotExists(firstK) ? P.I.filter(n => P.nextFixedEngaged(n, firstK)) : [];
      if (pf.charge && iEng.some(n => n !== pf.charge)) ctx.push("LINT_NEXT_FIRST_TWO_CHARGE", { who: pf.charge, others: ctx.join(iEng.filter(n => n !== pf.charge)), shift: P.shiftLabel(firstK) }); else if (!pf.charge && iEng.length > 1) ctx.push("LINT_NEXT_FIRST_TWO_CHARGE2", { others: ctx.join(iEng), shift: P.shiftLabel(firstK) }); }
    // 期間の各枠には期間責任者の役割の誰かが勤務かオンコールで関わる。オンコールを付けない勤務帯が期間の日にあると、同じ人が連日勤務するしかなく解なしになりやすい
    if (P.state("oncall") !== "off") for (const sh of P.shifts) if (sh.oncall === false && P.periods.some(p => p.slots.some(s => s[1] === sh.id))) ctx.push("LINT_PERIOD_CHARGE_NEEDS_ONCALL", { shift: sh.label });
    for (const [ds, n] of Object.entries(P.fixedCharge)) { const d = +ds;
      if (!P.I.includes(n)) { ctx.push("LINT_FIXED_CHARGE_NOT_ROLE", { day: lab(d), who: n }); continue; }
      const p = P.periods.find(p => p.days.includes(d));
      if (!p) { ctx.push("LINT_FIXED_CHARGE_NOT_OFF_DAY", { day: lab(d), who: n }); continue; }
      if (!p.slots.some(s => s[0] === d)) { ctx.push("LINT_FIXED_CHARGE_NO_SLOT", { day: lab(d), who: n }); continue; }
      if (unavailable(n, T.chargeDaySlots(p, d)[0])) ctx.push("LINT_FIXED_CHARGE_VS_UNAVAIL", { day: lab(d), who: n }); }
    // 固定指定と期間責任者（同じ休日の枠ごとに固定した期間責任者の役割の人: 勤務・OC）:
    //  (1) 同じ枠に 2 名以上 → 1 枠に関わる期間責任者は 1 名なので解なし (2) 期間責任者の固定（その日の担当＝最初の枠の人）と、最初の枠に固定した別の人 → 解なし
    //  (3) 日勤帯と夜間で別の人 → 日の途中の交代。計算はできる（減点 charge_handover）。入力の誤りでないかを知らせる
    for (const p of P.periods) for (const d of p.days) { const ds = T.chargeDaySlots(p, d); if (!ds.length) continue;
      const per = ds.map(s => [s, [...new Set([...P.fixedWorkersOf(s), ...((s[1] === "night" ? P.fixedNightOc : P.fixedDayOc)[d] || [])].filter(n => P.I.includes(n)))]]);
      const fc = P.I.includes(P.fixedCharge[d]) ? P.fixedCharge[d] : null; let bad = false;
      for (const [s, ns] of per) if (ns.length > 1) { bad = true; ctx.push("LINT_FIXED_CHARGE_TWO_IN_SLOT", { slot: `${lab(d)} ${P.shiftLabel(s[1])}`, who: ctx.join(ns) }); }
      if (fc && per[0][1].length === 1 && per[0][1][0] !== fc) { bad = true; ctx.push("LINT_FIXED_CHARGE_VS_FIRST_SLOT", { day: lab(d), who: fc, other: per[0][1][0], slot: P.shiftLabel(per[0][0][1]) }); }
      const all = new Set(per.flatMap(x => x[1])); if (fc) all.add(fc);
      if (!bad && all.size > 1) ctx.push("LINT_FIXED_CHARGE_HANDOVER", { day: lab(d), detail: (fc ? [`${T.term(T.t("{charge}担当"), P.rules)} ${fc}`] : []).concat(per.filter(x => x[1].length).map(([s, ns]) => `${P.shiftLabel(s[1])} ${ctx.join(ns)}`)).join(" → ") }); }
    // 月またぎの接続: 前月末の期間責任者が翌月1日に不可
    for (const p of P.periods) { if (!p.prevDays.length || !p.slots.length) continue; const d = p.days[0];
      const prevI = P.I.filter(n => T.prevChargeSlots(P, p).some(s => P.prevWorked(s, n) || (P.prevFixed[T.Problem.key(s)].oc || []).includes(n)));
      if (prevI.length === 1) { const n = prevI[0]; if (unavailable(n, T.chargeDaySlots(p, d)[0])) ctx.push("LINT_PREV_CHARGE_UNAVAIL", { who: n, day: lab(d) }); }
      else if (prevI.length > 1) ctx.push("LINT_PREV_CHARGE_TWO", { who: ctx.join(prevI) }); }
    // 日の途中の交代は可能なので、各実在枠に候補がいればよい（全枠に共通する候補を要求しない）。
    for (const p of P.periods) for (const d of p.days) { const slots = T.chargeDaySlots(p, d);
      if (slots.some(s => !P.I.some(n => !unavailable(n, s) && !(s[1] === "night" && P.isHard("duty_conflicts") && P.busy(n, d + 1, "am", ["external"]))))) ctx.push("LINT_NO_CHARGE_CANDIDATE", { day: lab(d) }, { who: ctx.join(P.I) }); }
  },
  python: true,
});

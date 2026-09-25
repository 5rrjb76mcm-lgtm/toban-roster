// 規則のプラグイン: 勤務帯ごとの連続の上限（shift_run_max）。例: 日勤は連続 3 日まで（そのあとの夜勤は、全体の連勤の上限 run_length_max で見る）。docs/rule-modules.md
// 設定は rules.shift_run_max = { day: 3 }（勤務帯ごと。書いていない勤務帯は制限なし）。前月末の勤務と翌月 1 日の固定も並びに含める。「固定したときだけ」の人には当てはめない。
T.rules.register({
  id: "shift_run_max", api: 1, order: 702, group: "combo",
  label: "勤務帯ごとの連続の上限（例: 日勤は連続 3 日まで）", states: ["hard", "soft", "off"], def: "off",
  weight: "shift_run_max", w0: 100,
  lookback(R) { const c = R.shift_run_max || { day: 3 }; return Math.max(0, ...Object.values(c).map(v => +v || 0)) + 1; }, // 前月から取り込む日数（上限 K なら K+1 日）
  read(P) { const c = P.rules.shift_run_max || { day: 3 }, out = {}; for (const [k, v] of Object.entries(c)) if (["day", "night"].includes(k) && +v >= 1) out[k] = Math.round(+v); return { max: out }; },
  solve(ctx, prm) {
    const { P, LP } = ctx;
    for (const [k, K] of Object.entries(prm.max)) for (const n of ctx.names) { if (P.isFixedOnly(n)) continue;
      for (let d = ctx.firstPrev; d + K <= P.N + 1; d++) { const xs = []; let konst = 0; const days = [];
        for (let j = 0; j <= K; j++) { const e = d + j; if (e < 1) konst += P.prevWorked([e, k], n) ? 1 : 0; else if (e > P.N) konst += P.nextFixed[k].includes(n) ? 1 : 0; else { if (ctx.has([e, k])) xs.push(ctx.work([e, k], n)); days.push(e); } }
        if (!xs.length) continue;
        ctx.limit("shift_run_max", LP.sum([LP.sum(xs), konst]), "<=", K, { fixed: ctx.fixedInvolved(days, n), aux: "srm", ub: K + 1 }); } }
  },
  check(ctx, prm) {
    const { P } = ctx;
    for (const [k, K] of Object.entries(prm.max)) for (const n of ctx.names) { if (P.isFixedOnly(n)) continue;
      const at = e => e < 1 ? P.prevWorked([e, k], n) : e > P.N ? P.nextFixed[k].includes(n) : ctx.worked(n, [e, k]);
      for (let d = ctx.firstPrev; d + K <= P.N + 1; d++) { let c = 0; const days = []; for (let j = 0; j <= K; j++) { if (at(d + j)) c++; if (d + j >= 1 && d + j <= P.N) days.push(d + j); }
        if (c > K && days.length) ctx.viol("SHIFT_RUN_TOO_LONG", { who: n, from: ctx.lab(Math.max(d, 1)), shift: P.shiftLabel(k), max: K }, days, n, ctx.fixedInvolved(days, n)); } }
  },
  penalty(ctx, prm) {
    const { P } = ctx;
    for (const [k, K] of Object.entries(prm.max)) for (const n of ctx.names) { if (P.isFixedOnly(n)) continue;
      const at = e => e < 1 ? P.prevWorked([e, k], n) : e > P.N ? P.nextFixed[k].includes(n) : ctx.worked(n, [e, k]);
      for (let d = ctx.firstPrev; d + K <= P.N + 1; d++) { let c = 0; const days = []; let any = false; for (let j = 0; j <= K; j++) { if (at(d + j)) c++; const e = d + j; if (e >= 1 && e <= P.N) { days.push(e); if (ctx.has([e, k])) any = true; } }
        if (any) ctx.limit("shift_run_max", c, "<=", K, { fixed: ctx.fixedInvolved(days, n) }); } }
  },
  ui: {
    render(R, h) { const c = R.shift_run_max || { day: 3 }; return h.shifts.map(([id, lb]) => `<label>${h.esc(h.tx("{shift}は連続", { shift: lb }))} <input type="number" min="1" max="31" data-srm="${id}" value="${c[id] ?? ""}" style="width:3.5em"> ${h.esc(h.tx("日まで（空欄＝制限なし）"))}</label>`).join("　"); },
    read(R, el) { const out = {}; for (const id of ["day", "night"]) { const x = el(`[data-srm="${id}"]`); if (x && x.value !== "") out[id] = Math.max(1, +x.value || 1); } R.shift_run_max = out; },
  },
  summary(P, prm, tv) { return Object.entries(prm.max).map(([k, K]) => tv("{shift}は連続 {n} 日まで", { shift: P.shiftLabel(k), n: K })).join(T.listSep()); },
  messages: { SHIFT_RUN_TOO_LONG: { en: "{who}: more than {max} {shift} shifts in a row from {from}", ja: "{who}: {from}から{shift}が {max} 日を超えて続く" } },
  fixtures: [{ label: "勤務帯ごとの連続を減点、重み 1", base: "ward-2shift", states: { shift_run_max: "soft" }, rules: { shift_run_max: { day: 1, night: 1 } }, unitWeights: true }],
  python: false,
});

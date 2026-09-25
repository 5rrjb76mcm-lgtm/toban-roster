// 規則のプラグイン: 勤務帯ごとの回数の範囲（shift_count_range）。例: 夜勤は月 3〜5 回。人ごとの上限は名簿の欄（夜勤の上限・日勤の上限）で下げられる。docs/rule-modules.md
// 設定は rules.shift_counts = { night: { min: 3, max: 5 } }（勤務帯ごと。書いていない勤務帯・空の値は制限なし）。予備の役割と「固定したときだけ」の人には当てはめない。
(function () {
const SCR_FIELD = { day: "shift_max_day", night: "shift_max_night" };
T.rules.register({
  id: "shift_count_range", api: 1, order: 215, group: "basic",
  label: "勤務帯ごとの回数の範囲（例: 夜勤は月 3〜5 回。人ごとの上限は名簿の欄で）", states: ["hard", "soft", "off"], def: "off",
  weight: "shift_count_range", w0: 150,
  columns: ["night", "day"].map((k, i) => ({ key: `scr_${k}`, at: "duty", order: 4 + i, label: k === "night" ? "夜勤の上限（空欄＝共通）" : "日勤の上限（空欄＝共通）", field: SCR_FIELD[k],
    when: R => { const c = (R.shift_counts || { night: { min: 3, max: 5 } })[k]; return !!c && (c.max != null || c.min != null); },
    render(d, R, h) { return `<input type="number" min="0" max="31" data-f="${SCR_FIELD[k]}" value="${d[SCR_FIELD[k]] ?? ""}" style="width:3.5em">`; },
    read(td, d) { const v = td.querySelector(`[data-f="${SCR_FIELD[k]}"]`).value; if (v !== "") d[SCR_FIELD[k]] = Math.max(0, +v); } })),
  read(P) { const c = P.rules.shift_counts || { night: { min: 3, max: 5 } }, out = {};
    for (const [k, v] of Object.entries(c)) if (["day", "night"].includes(k) && v) out[k] = { min: v.min === "" || v.min == null ? null : +v.min, max: v.max === "" || v.max == null ? null : +v.max };
    return { range: out }; },
  solve(ctx, prm) {
    const { P, LP } = ctx;
    for (const [k, r] of Object.entries(prm.range)) for (const n of ctx.names) { if (P.isRole(n, "reserve") || P.isFixedOnly(n)) continue;
      const tot = LP.sum(ctx.slots.filter(s => s[1] === k).map(s => ctx.work(s, n))), mx = maxOf(P, n, k, r), fx = P.slots.filter(s => s[1] === k && P.isFixedWork(s, n)).length;
      if (r.min != null) ctx.limit("shift_count_range", tot, ">=", r.min, { aux: "scrl", ub: 31 });
      if (mx != null) ctx.limit("shift_count_range", tot, "<=", mx, { aux: "scru", ub: 31, fixed: fx > mx }); } // 固定だけで上限を超えるなら、検算と同じく「固定指定により許容」（減点 fixed_conflict）
  },
  check(ctx, prm) {
    const { P } = ctx;
    for (const [k, r] of Object.entries(prm.range)) for (const n of ctx.names) { if (P.isRole(n, "reserve") || P.isFixedOnly(n)) continue;
      const tot = P.slots.filter(s => s[1] === k && ctx.worked(n, s)).length, mx = maxOf(P, n, k, r), fx = P.slots.filter(s => s[1] === k && P.isFixedWork(s, n)).length;
      if (r.min != null && tot < r.min) ctx.viol("SHIFT_COUNT_SHORT", { who: n, shift: P.shiftLabel(k), got: tot, min: r.min }, null, n);
      if (mx != null && tot > mx) ctx.viol("SHIFT_COUNT_OVER", { who: n, shift: P.shiftLabel(k), got: tot, max: mx }, null, n, fx > mx); } // 固定だけで上限を超えるなら「固定指定により許容」
  },
  penalty(ctx, prm) {
    const { P } = ctx;
    for (const [k, r] of Object.entries(prm.range)) for (const n of ctx.names) { if (P.isRole(n, "reserve") || P.isFixedOnly(n)) continue;
      const tot = P.slots.filter(s => s[1] === k && ctx.worked(n, s)).length, mx = maxOf(P, n, k, r), fx = P.slots.filter(s => s[1] === k && P.isFixedWork(s, n)).length;
      if (r.min != null) ctx.limit("shift_count_range", tot, ">=", r.min); if (mx != null) ctx.limit("shift_count_range", tot, "<=", mx, { fixed: fx > mx }); }
  },
  ui: {
    render(R, h) { const c = R.shift_counts || { night: { min: 3, max: 5 } };
      return h.shifts.map(([id, lb]) => `<label>${h.esc(lb)} <input type="number" min="0" max="31" data-scr="${id}:min" value="${(c[id] || {}).min ?? ""}" style="width:3.5em">〜<input type="number" min="0" max="31" data-scr="${id}:max" value="${(c[id] || {}).max ?? ""}" style="width:3.5em"> ${h.esc(h.tx("回（空欄＝制限なし）"))}</label>`).join("　"); },
    read(R, el) { const out = {}; for (const id of ["day", "night"]) { const a = el(`[data-scr="${id}:min"]`), b = el(`[data-scr="${id}:max"]`); if (!a && !b) continue; const v = {};
      if (a && a.value !== "") v.min = Math.max(0, +a.value); if (b && b.value !== "") v.max = Math.max(0, +b.value); if (Object.keys(v).length) out[id] = v; } R.shift_counts = out; },
  },
  summary(P, prm, tv) { return Object.entries(prm.range).map(([k, r]) => tv("{shift}は月 {a}〜{b} 回", { shift: P.shiftLabel(k), a: r.min ?? "", b: r.max ?? "" })).join(T.listSep()); },
  report(ctx, prm) { const { P, t } = ctx; for (const k of Object.keys(prm.range)) { const hist = {}; for (const n of ctx.names) { if (P.isRole(n, "reserve") || P.isFixedOnly(n)) continue; const c = P.slots.filter(s => s[1] === k && ctx.worked(n, s)).length; hist[c] = (hist[c] || 0) + 1; }
    ctx.line(t("{shift}の回数の分布: {items}", { shift: P.shiftLabel(k), items: Object.keys(hist).sort((a, b) => a - b).map(x => t("{c}回×{n}", { c: x, n: hist[x] })).join(ctx.sep()) })); } },
  messages: { SHIFT_COUNT_SHORT: { en: "{who}: {got} {shift} shifts, fewer than {min}", ja: "{who}: {shift}が {got} 回で {min} 回に足りない" }, SHIFT_COUNT_OVER: { en: "{who}: {got} {shift} shifts, more than {max}", ja: "{who}: {shift}が {got} 回で {max} 回を超えている" } },
  fixtures: [{ label: "勤務帯ごとの回数の範囲を減点、重み 1", base: "ward-2shift", states: { shift_count_range: "soft" }, unitWeights: true }],
  python: false,
});
function maxOf(P, n, k, r) { const own = (P.doctors[n] || {})[SCR_FIELD[k]]; const v = own === "" || own == null ? r.max : (r.max == null ? +own : Math.min(r.max, +own)); return v == null ? null : v; }
})();

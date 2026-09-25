// 規則のプラグイン: 月の休みの日数の上限（days_off_max）。休みが「決まった日数 ＋ 余裕」を超えた分を減点（例: 土日祝の数 ＋ 1（有給））。docs/rule-modules.md
// 決まった日数は休みの日数の規則（days_off_min）と同じ P.offTarget(n)。余裕は rules.days_off.max_extra（既定 1）。予備の役割と「固定したときだけ」の人には当てはめない。
T.rules.register({
  id: "days_off_max", api: 1, order: 731, group: "rest",
  label: "月の休みの日数の上限（決まった日数 ＋ 余裕。超えた分を減点）", states: ["soft", "off"], def: "off",
  weight: "days_off_over", w0: 40,
  read(P) { const x = (P.rules.days_off || {}).max_extra; return { extra: x === "" || x == null ? 1 : Math.max(0, Math.round(+x)) }; },
  solve(ctx, prm) {
    const { P, LP } = ctx;
    for (const n of ctx.names) { if (P.isRole(n, "reserve") || P.isFixedOnly(n)) continue; const busy = []; for (let d = 1; d <= P.N; d++) busy.push(ctx.busy(d, n));
      ctx.limit("days_off_max", LP.sum(busy), ">=", P.N - (P.offTarget(n) + prm.extra), { aux: "dox", ub: 31 }); }
  },
  check() { },
  penalty(ctx, prm) {
    const { P } = ctx;
    for (const n of ctx.names) { if (P.isRole(n, "reserve") || P.isFixedOnly(n)) continue; ctx.limit("days_off_max", P.N - ctx.offDays(n).length, ">=", P.N - (P.offTarget(n) + prm.extra)); }
  },
  ui: {
    render(R, h) { const x = (R.days_off || {}).max_extra; return `<label>${h.esc(h.tx("休みは決まった日数より"))} <input type="number" min="0" max="10" id="setDoMaxExtra" value="${x ?? 1}" style="width:3.5em"> ${h.esc(h.tx("日多いところまで"))}</label>`; },
    read(R, el) { const x = el("#setDoMaxExtra"); if (x) R.days_off = Object.assign({}, R.days_off, { max_extra: Math.max(0, +x.value || 0) }); },
  },
  summary(P, prm, tv) { return tv("休みは決まった日数 ＋ {n} 日まで", { n: prm.extra }); },
  report(ctx, prm) { const { P, t } = ctx; const over = ctx.names.filter(n => !P.isRole(n, "reserve") && !P.isFixedOnly(n) && ctx.offDays(n).length > P.offTarget(n) + prm.extra).map(n => `${n} ${ctx.offDays(n).length}`); ctx.line(t("休みが上限を超えた人: {items}", { items: over.join(ctx.sep()) || t("なし") })); },
  fixtures: [{ label: "休みの日数の上限を減点、重み 1", base: "ward-2shift", states: { days_off_max: "soft", days_off_min: "soft" }, unitWeights: true }],
  python: false,
});

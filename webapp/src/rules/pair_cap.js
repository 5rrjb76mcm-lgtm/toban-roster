// 規則のプラグイン: 同じ組み合わせの回数の上限（pair_cap）。同じ勤務帯（既定は夜勤）で同じ人と顔を合わせる回数を月 K 回までにする（超えた分を減点）。メンバーをばらけさせる。docs/rule-modules.md
// 設定は rules.pair_cap = { shift: "night", max: 2 }。予備の役割と「固定したときだけ」の人は数えない。組ごと・枠ごとに補助変数を作るので、人数が多いと計算が重くなる。
T.rules.register({
  id: "pair_cap", api: 1, order: 950, group: "team",
  label: "同じ勤務帯で同じ人と組む回数の上限（例: 夜勤で同じ人と顔を合わせるのは月 2 回まで）", states: ["soft", "off"], def: "off",
  weight: "pair_cap", w0: 15,
  read(P) { const c = P.rules.pair_cap || {}; return { shift: ["day", "night"].includes(c.shift) ? c.shift : "night", max: c.max === "" || c.max == null ? 2 : Math.max(0, Math.round(+c.max)) }; },
  solve(ctx, prm) {
    const { P, LP, lp } = ctx, S = ctx.names.filter(n => !P.isRole(n, "reserve") && !P.isFixedOnly(n)), ss = ctx.slots.filter(s => s[1] === prm.shift);
    for (let i = 0; i < S.length; i++) for (let j = i + 1; j < S.length; j++) { const zs = [];
      for (const s of ss) { const z = lp.aux("pcz"); lp.add(LP.sub(LP.sum([ctx.work(s, S[i]), ctx.work(s, S[j])]), z), "<=", 1); zs.push(z); } // z ≥ a + b − 1
      ctx.limit("pair_cap", LP.sum(zs), "<=", prm.max, { aux: "pco", ub: 31 }); }
  },
  check() { },
  penalty(ctx, prm) {
    const { P } = ctx, S = ctx.names.filter(n => !P.isRole(n, "reserve") && !P.isFixedOnly(n)), ss = P.slots.filter(s => s[1] === prm.shift);
    for (let i = 0; i < S.length; i++) for (let j = i + 1; j < S.length; j++) { let c = 0; for (const s of ss) if (ctx.worked(S[i], s) && ctx.worked(S[j], s)) c++; ctx.limit("pair_cap", c, "<=", prm.max); }
  },
  ui: {
    render(R, h) { const c = R.pair_cap || {}; return `<label>${h.sel(h.shifts, c.shift || "night", 'id="setPairShift"')} ${h.esc(h.tx("で同じ人と組むのは月"))} <input type="number" min="0" max="31" id="setPairMax" value="${c.max ?? 2}" style="width:3.5em"> ${h.esc(h.tx("回まで"))}</label>`; },
    read(R, el) { const a = el("#setPairShift"), b = el("#setPairMax"); if (a || b) R.pair_cap = { shift: a ? a.value : "night", max: b ? Math.max(0, +b.value || 0) : 2 }; },
  },
  summary(P, prm, tv) { return tv("{shift}で同じ人と組むのは月 {n} 回まで", { shift: P.shiftLabel(prm.shift), n: prm.max }); },
  report(ctx, prm) { const { P, t } = ctx, S = ctx.names.filter(n => !P.isRole(n, "reserve") && !P.isFixedOnly(n)), ss = P.slots.filter(s => s[1] === prm.shift), hit = [];
    for (let i = 0; i < S.length; i++) for (let j = i + 1; j < S.length; j++) { let c = 0; for (const s of ss) if (ctx.worked(S[i], s) && ctx.worked(S[j], s)) c++; if (c > prm.max) hit.push(`${S[i]}・${S[j]} ${c}`); }
    ctx.line(t("{shift}で {k} 回を超えて組んだ組: {items}", { shift: P.shiftLabel(prm.shift), k: prm.max, items: hit.join(ctx.sep()) || t("なし") })); },
  fixtures: [{ label: "同じ組み合わせを減点、重み 1", base: "ward-2shift", states: { pair_cap: "soft" }, rules: { pair_cap: { shift: "day", max: 0 } }, unitWeights: true }],
  python: false,
});

// 規則のプラグイン: 1 枠の人数を理想値に近づける（count_target）。人数に幅（下限〜上限）がある枠で、理想値からのずれ 1 人あたり減点。docs/rule-modules.md
// 理想値は施設の構成（positions.work.ideal）。P.countIdealOf(s) が下限〜上限に収めて返す
T.rules.register({
  id: "count_target", api: 1, order: 150, group: "basic",
  label: "1枠の人数を理想値に近づける（人数に幅があるとき。ずれ 1 人あたり減点）", states: ["soft", "off"], def: "off",
  weight: "count_deviation", w0: 5,
  solve(ctx) {
    const { LP, lp, P, E } = ctx;
    for (const s of ctx.slots) { const hi = P.countOf(s), lo = P.countMinOf(s), id = P.countIdealOf(s); if (lo === hi || id == null) continue;
      const sum = LP.sum(ctx.names.map(n => ctx.work(s, n)));
      const u = lp.auxInt("cnu", 0, hi), v = lp.auxInt("cnd", 0, hi); lp.add(LP.sub(sum, id), "<=", u); lp.add(LP.sub(id, sum), "<=", v); lp.objAdd(P.softW("count_target"), E(u, v)); }
  },
  penalty(ctx) {
    const { P } = ctx;
    for (const s of P.slots) { const id = P.countIdealOf(s); if (id == null || P.countMinOf(s) === P.countOf(s)) continue;
      ctx.add("count_deviation", P.softW("count_target"), Math.abs(ctx.A.workers(s).length - id)); }
  },
  fixtures: [{ label: "人数の理想値、重み 1", base: "nurse-2shift", states: { count_target: "soft" }, unitWeights: true }],
  python: false,
});

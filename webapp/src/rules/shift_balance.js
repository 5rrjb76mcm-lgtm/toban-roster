// 規則のプラグイン: 勤務帯ごとの回数の偏り（shift_balance）。勤務帯ごとに、当番に入る人（予備の役割と、構成の規則でその勤務帯に入れない人を除く）の
// 回数の最多−最少に重みを掛けて減点する。docs/rule-modules.md
T.rules.register({
  id: "shift_balance", api: 1, order: 800, group: "basic",
  label: "勤務帯ごとの回数の偏りを減らす（最多−最少。例: 夜勤の回数をそろえる）", states: ["soft", "off"], def: "off",
  weight: "shift_balance", w0: 10,
  solve(ctx) {
    const { LP, lp, P } = ctx;
    for (const sh of P.shifts) {
      const ss = ctx.slots.filter(s => s[1] === sh.id); if (!ss.length) continue;
      const vals = ctx.names.filter(n => !P.isExempt(n) && P.shiftEligible(n, sh.id)).map(n => LP.sum(ss.map(s => ctx.work(s, n)))); if (vals.length < 2) continue;
      const a = lp.auxInt("sbmx", 0, ss.length), b = lp.auxInt("sbmn", 0, ss.length);
      for (const v of vals) { lp.add(a, ">=", v); lp.add(b, "<=", v); }
      lp.objAdd(P.softW("shift_balance"), a); lp.objAdd(-P.softW("shift_balance"), b);
    }
  },
  penalty(ctx) {
    const { P } = ctx;
    for (const sh of P.shifts) {
      const ss = P.slots.filter(s => s[1] === sh.id); if (!ss.length) continue;
      const vals = ctx.names.filter(n => !P.isExempt(n) && P.shiftEligible(n, sh.id)).map(n => ss.filter(s => ctx.worked(n, s)).length);
      if (vals.length >= 2) ctx.add("shift_balance", P.softW("shift_balance"), Math.max(...vals) - Math.min(...vals));
    }
  },
  fixtures: [{ label: "回数の偏りを減点、重み 1", base: "nurse-2shift", states: { shift_balance: "soft" }, unitWeights: true }],
  python: false,
});

// 規則のプラグイン: 2 連休の最低回数（days_off_pair）。続く 2 日の休みの組を数える（rules.days_off.pair_count=runs なら続いた休みで 1 回）。docs/rule-modules.md
T.rules.register({
  id: "days_off_pair", api: 1, order: 740, group: "rest",
  label: "2 連休を月に最低回数作る", states: ["hard", "soft", "off"], def: "off",
  weight: "days_off_pair_short", w0: 40, relax: "days_off",
  read(P) { return { min: P.pairMin, runs: P.pairRuns }; },
  solve(ctx, prm) {
    const { P, lp, LP } = ctx, st = P.state("days_off_pair"); if (prm.min <= 0) return;
    for (const n of ctx.names) { if (P.isExempt(n)) continue;
      // pr ≤ 1 − busy(d) かつ pr ≤ 1 − busy(d+1)。1 本の式（pr + y(d) + y(d+1) ≤ 1）にすると連日の勤務そのものが禁止になる（2026-09-21 に修正）
      const prs = [];
      for (let d = 1; d + 1 <= P.N; d++) { const pr = lp.aux("pair"); lp.add(LP.sum([pr, ctx.busy(d, n)]), "<=", 1); lp.add(LP.sum([pr, ctx.busy(d + 1, n)]), "<=", 1);
        // 続いた休みを 1 回と数える施設: 前日も休みなら、その日は連休の始まりではない（pr ≤ 前日の勤務）。前月の最終日が休みと分かるなら 1 日の始まりも数えない
        if (prm.runs) { if (d >= 2) lp.add(pr, "<=", ctx.busy(d - 1, n)); else if (P.prevOffDay0(n)) lp.add(pr, "<=", 0); }
        prs.push(pr); }
      if (!prs.length) continue;
      if (st === "hard") lp.add(LP.sum(prs), ">=", prm.min);
      else { const v = lp.auxInt("prs", 0, P.N); lp.add(LP.sum([...prs, v]), ">=", prm.min); lp.objAdd(P.softW("days_off_pair"), v); } } // 減点: 足りない回数
  },
  check(ctx, prm) {
    for (const n of ctx.names) { if (ctx.P.isExempt(n)) continue; const c = ctx.pairs(n); if (c < prm.min) ctx.viol("DAYS_OFF_PAIR_SHORT", { who: n, pairs: c, min: prm.min }, null, n); }
  },
  penalty(ctx, prm) {
    const { P, pos } = ctx; if (prm.min <= 0 || ctx.N < 2) return;
    for (const n of ctx.names) { if (P.isExempt(n)) continue;
      let pr = 0; for (let d = 1; d + 1 <= ctx.N; d++) if (!ctx.busy(n, d) && !ctx.busy(n, d + 1) && (!prm.runs || (d >= 2 ? ctx.busy(n, d - 1) : !P.prevOffDay0(n)))) pr++;
      ctx.add("days_off_pair_short", P.softW("days_off_pair"), pos(prm.min - pr)); }
  },
  ui: {
    render(R, h) { const { esc, tx, sel } = h; return `<label>${esc(tx("月に"))} <input type="number" min="0" max="15" id="setPairMin" value="${(R.days_off || {}).pair_min ?? 1}" style="width:4em"> ${esc(tx("回以上"))}</label>
　<label>${esc(tx("数え方: "))}${sel([["pairs", tx("続く 2 日の組の数（3 連休は 2 回）")], ["runs", tx("続いた休みで 1 回（3 連休も 1 回）")]], (R.days_off || {}).pair_count || "pairs", 'id="setPairCount"')}</label>`; },
    read(R, el) { const d = Object.assign({}, R.days_off);
      if (el("#setPairMin")) d.pair_min = Math.max(0, +el("#setPairMin").value || 0);
      if (el("#setPairCount")) { if (el("#setPairCount").value === "runs") d.pair_count = "runs"; else delete d.pair_count; }
      if (Object.keys(d).length) R.days_off = d; },
  },
  summary(P, prm, tv) { return tv("月 {n} 回以上", { n: prm.min }) + tv(prm.runs ? "（3 連休以上も 1 回）" : "（3 連休は 2 回）"); },
  messages: { DAYS_OFF_PAIR_SHORT: { en: "{who}: {pairs} two-day breaks (minimum {min})", ja: "{who}: 2 連休が {pairs} 回（最低 {min} 回）" } },
  // 入力チェック: 2 連休の回数が休みの日数に収まらない
  lint(ctx, prm) {
    const { P } = ctx;
    if (P.state("days_off_min") !== "off" && prm.min * 2 > P.minDaysOff) ctx.push("LINT_PAIR_VS_DAYS_OFF", { pair: prm.min, days: prm.min * 2, min: P.minDaysOff });
  },
  python: false,
});

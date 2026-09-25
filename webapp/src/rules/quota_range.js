// 規則のプラグイン: 勤務回数を目安±許容幅に収める（quota_range）。docs/rule-modules.md
// 目安は P.quota(n)（名簿の quota、または相対のときは比重で按分した値）、許容幅は rules.quota_tolerance（P.tol）。固定指定で目安＋幅を超える分は許す（検算では「固定指定により許容」）。
// 予備の役割（月 1 回まで・大幅減点 chief_duty）は本体が扱う。
T.rules.register({
  id: "quota_range", api: 1, order: 200, group: "basic",
  label: "勤務回数を目安±許容幅に収める", states: ["hard", "off"], def: "hard",
  weight: null, w0: null, relax: "quota",
  params: [{ key: "quota_tolerance", type: "int", min: 0, label: "目安 ±{v} 回" }],
  read(P) { return { tol: P.tol }; },
  solve(ctx, prm) {
    const { lp, P } = ctx;
    for (const n of ctx.names) { if (P.isExempt(n)) continue; const q = P.quota(n);
      lp.add(ctx.total(n), ">=", q - prm.tol); lp.add(ctx.total(n), "<=", Math.max(q + prm.tol, P.fixedWorkCount(n))); } // 固定指定で目安+1を超える場合はその数まで許す
  },
  check(ctx, prm) {
    const { P } = ctx;
    for (const n of P.names) { if (P.isExempt(n)) continue;
      const tot = P.slots.filter(s => ctx.worked(n, s)).length, q = P.quota(n);
      const fc = P.fixedWorkCount(n), ub = Math.max(q + prm.tol, fc); // 固定指定で目安+1を超える分は許容（固定指定により許容として表示）
      if (tot < q - prm.tol || tot > ub) ctx.viol("QUOTA_OUT_OF_RANGE", { who: n, total: tot, quota: q, tol: prm.tol }, null, n);
      else if (tot > q + prm.tol) ctx.viol("QUOTA_OVER_BY_FIXED", { who: n, total: tot, quota: q, tol: prm.tol, fixed: fc }, [...P.fixedWorkKeys].filter(k => k.endsWith("|" + n)).map(k => +k.split(":")[0]), n); }
  },
  summary(P, prm, tv) { return tv("目安 ±{n} 回", { n: prm.tol }); },
  diagnoseHint: "      → 月の設定 → 当月の勤務目標 か、設定の目安を見直す（不可日が多すぎる{person}がいないか確認）",
  messages: {
    QUOTA_OUT_OF_RANGE: { en: "{who}: {total} shifts, outside the target {quota} ± {tol}", ja: "{who}: 勤務{total}回が目安{quota}±{tol}の範囲外" },
    QUOTA_OVER_BY_FIXED: { en: "{who}: {total} shifts, above the target {quota} ± {tol} (because of {fixed} hand-fixed assignments)", ja: "{who}: 勤務{total}回が目安{quota}±{tol}を超える（固定指定 {fixed} 件のため）" },
  },
  // 入力チェック: 固定指定が目安を超える人、全体の枠数と目安の合計、入れる枠が目安に足りない人
  lint(ctx, prm) {
    const { P } = ctx;
    for (const [n, ds] of Object.entries(ctx.fixedWork())) { const q = P.quota(n); if (ds.length > q + prm.tol) ctx.push("LINT_FIXED_OVER_QUOTA", { who: n, count: ds.length, quota: q, tol: prm.tol }); }
    if (!P.isHard("quota_range")) return;
    { // 全体の枠数と勤務回数の合計（新しい施設で最初に合わないのがここ。個別の条件より先に指摘する）
      const need = P.slots.reduce((a, s) => a + P.countOf(s), 0); // 延べ人数（1枠1名なら枠の数）
      const lo = P.dutyNames.reduce((a, n) => a + Math.max(0, P.quota(n) - prm.tol), 0);
      const hi = P.dutyNames.reduce((a, n) => a + Math.max(P.quota(n) + prm.tol, P.fixedWorkCount(n)), 0);
      if (hi < need) ctx.push("LINT_CAPACITY_HIGH", { need, total: hi, tol: prm.tol });
      if (lo > need) ctx.push("LINT_CAPACITY_LOW", { need, total: lo, tol: prm.tol }); }
    for (const n of P.dutyNames) { const q = P.quota(n); const c = P.slots.filter(s => ctx.canWork(n, s)).length; if (c < q - prm.tol) ctx.push("LINT_PERSON_TOO_FEW_SLOTS", { who: n, count: c, quota: q, tol: prm.tol }); }
  },
  python: true,
});

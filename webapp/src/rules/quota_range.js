// 規則のプラグイン: 勤務回数を目安±許容幅に収める（quota_range）。docs/rule-modules.md
// 目安は P.quota(n)（名簿の quota、または相対のときは比重で按分した値）、許容幅は rules.quota_tolerance（P.tol）。固定指定で目安＋幅を超える分は許す（検算では「固定指定により許容」）。
// 月の設定で人ごとに当月の下限・上限（count_min / count_max）を入れた人は、目安±許容幅の代わりにその範囲が必須になる（P.countLo / P.countHi。入れていない側は目安±許容幅のまま）。
// 予備の役割（月 1 回まで・大幅減点 chief_duty）は本体が扱う。
T.rules.register({
  id: "quota_range", api: 1, order: 200, group: "basic",
  label: "勤務回数を目安±許容幅に収める", states: ["hard", "off"], def: "hard",
  weight: null, w0: null, relax: "quota",
  params: [{ key: "quota_tolerance", type: "int", min: 0, label: "目安 ±{v} 回" }],
  read(P) { return { tol: P.tol }; },
  solve(ctx, prm) {
    const { lp, P } = ctx;
    for (const n of ctx.names) { if (P.isExempt(n)) continue;
      lp.add(ctx.total(n), ">=", P.countLo(n)); lp.add(ctx.total(n), "<=", Math.max(P.countHi(n), P.fixedWorkCount(n))); } // 固定指定で上限を超える場合はその数まで許す
  },
  check(ctx, prm) {
    const { P } = ctx;
    for (const n of ctx.names) { if (P.isExempt(n)) continue; // 解く側と同じ対象（当番候補だけ。候補から外した人に目安を当てない）
      const tot = P.slots.filter(s => ctx.worked(n, s)).length, q = P.quota(n);
      const fc = P.fixedWorkCount(n), lo = P.countLo(n), hi = P.countHi(n), ub = Math.max(hi, fc), lim = P.hasCountLimit(n); // 固定指定で上限を超える分は許容（固定指定により許容として表示）
      const fixedDays = () => [...P.fixedWorkKeys].filter(k => k.slice(k.indexOf("|") + 1) === n).map(k => +k.split(":")[0]);
      if (tot < lo || tot > ub) { if (lim) ctx.viol("COUNT_OUT_OF_LIMIT", { who: n, total: tot, lo: Math.max(0, lo), hi }, null, n); else ctx.viol("QUOTA_OUT_OF_RANGE", { who: n, total: tot, quota: q, tol: prm.tol }, null, n); }
      else if (tot > hi) { if (lim) ctx.viol("COUNT_LIMIT_OVER_BY_FIXED", { who: n, total: tot, hi, fixed: fc }, fixedDays(), n); else ctx.viol("QUOTA_OVER_BY_FIXED", { who: n, total: tot, quota: q, tol: prm.tol, fixed: fc }, fixedDays(), n); } }
  },
  summary(P, prm, tv) { const lim = P.names.filter(n => !P.isExempt(n) && P.hasCountLimit(n)).map(n => `${n} ${P.countMin[n] ?? ""}〜${P.countMax[n] ?? ""}`);
    return tv("目安 ±{n} 回", { n: prm.tol }) + (lim.length ? tv("（当月の下限・上限を入れた人: {list}）", { list: lim.join(T.listSep()) }) : ""); },
  diagnoseHint: "      → 月の設定 → 当月の勤務目標 か、設定の目安を見直す（不可日が多すぎる{person}がいないか確認）",
  messages: {
    QUOTA_OUT_OF_RANGE: { en: "{who}: {total} shifts, outside the target {quota} ± {tol}", ja: "{who}: 勤務{total}回が目安{quota}±{tol}の範囲外" },
    COUNT_OUT_OF_LIMIT: { en: "{who}: {total} shifts, outside this month's limits {lo}–{hi}", ja: "{who}: 勤務{total}回が当月の範囲 {lo}〜{hi} 回の外" },
    COUNT_LIMIT_OVER_BY_FIXED: { en: "{who}: {total} shifts, above this month's upper limit {hi} (because of {fixed} hand-fixed assignments)", ja: "{who}: 勤務{total}回が当月の上限 {hi} 回を超える（固定指定 {fixed} 件のため）" },
    LINT_COUNT_LIMIT_MIN_OVER_MAX: { en: "{who}: this month's lower limit {min} is above the upper limit {max}", ja: "{who}: 当月の下限 {min} 回が上限 {max} 回より大きい" },
    LINT_COUNT_LIMIT_MIN_OVER_MAX_HINT: { en: "Month settings → this month's targets → fix the lower or the upper limit", ja: "月の設定 → 当月の勤務目標 の下限か上限を直してください" },
    LINT_FIXED_OVER_LIMIT: { en: "{who}: {count} hand-fixed work assignments, above this month's upper limit {max}", ja: "{who}: 固定した勤務が {count} 件で、当月の上限 {max} 回を超えています" },
    LINT_FIXED_OVER_LIMIT_HINT: { en: "The fixed assignments take priority (allowed, shown as tolerated). Raise the upper limit or reduce the fixed assignments if this is not intended", ja: "固定指定が優先されます（許容として表示）。意図どおりでなければ、上限を上げるか固定を減らしてください" },
    LINT_PERSON_TOO_FEW_SLOTS_LIMIT: { en: "{who} can work only {count} slots, fewer than this month's lower limit {min}", ja: "{who} が入れる枠は {count} 個で、当月の下限 {min} 回に足りません" },
    LINT_PERSON_TOO_FEW_SLOTS_LIMIT_HINT: { en: "Lower the limit, or review this person's unavailable days", ja: "下限を下げるか、その人の不可日を見直してください" },
    QUOTA_OVER_BY_FIXED: { en: "{who}: {total} shifts, above the target {quota} ± {tol} (because of {fixed} hand-fixed assignments)", ja: "{who}: 勤務{total}回が目安{quota}±{tol}を超える（固定指定 {fixed} 件のため）" },
  },
  // 入力チェック: 固定指定が目安を超える人、全体の枠数と目安の合計、入れる枠が目安に足りない人
  lint(ctx, prm) {
    const { P } = ctx;
    for (const [n, ds] of Object.entries(ctx.fixedWork())) { if (P.isExempt(n)) continue; const q = P.quota(n); if (ds.length > P.countHi(n)) { if (P.hasCountLimit(n)) ctx.push("LINT_FIXED_OVER_LIMIT", { who: n, count: ds.length, max: P.countHi(n) }); else ctx.push("LINT_FIXED_OVER_QUOTA", { who: n, count: ds.length, quota: q, tol: prm.tol }); } }
    for (const n of P.dutyNames) if (!P.isExempt(n) && P.countMin[n] != null && P.countMax[n] != null && P.countMin[n] > P.countMax[n]) ctx.push("LINT_COUNT_LIMIT_MIN_OVER_MAX", { who: n, min: P.countMin[n], max: P.countMax[n] });
    if (!P.isHard("quota_range")) return;
    { // 全体の枠数と勤務回数の合計（新しい施設で最初に合わないのがここ。個別の条件より先に指摘する）
      // 不足は最小人数、超過は最大人数と比較する。理想人数は必須条件ではない。
      // 最小人数を超えて実勤務を固定した枠は、その固定人数が必須（OC・翌月・不存在枠は含めない）。
      const needMin = P.slots.reduce((a, s) => a + Math.max(P.countMinOf(s), P.dutyNames.filter(n => P.isFixedWork(s, n)).length), 0);
      const needMax = P.slots.reduce((a, s) => a + P.countOf(s), 0);
      // 固定限定者は実在する当月の固定実勤務だけ。規則「なし」でも目安は免除なので、上限は全枠数まで見込む。
      // 予備の月0〜1回の上限は固定限定者にも適用する。OC・翌月・存在しない枠の固定は実勤務容量に加えない。
      const bounds = P.dutyNames.map(n => {
        if (P.isFixedOnly(n)) { const f = P.slots.filter(s => P.isFixedWork(s, n)).length;
          const hi = P.isHard("fixed_only") ? f : P.slots.length;
          return [f, P.isRole(n, "reserve") ? Math.min(hi, +P.workAllowed(n)) : hi]; }
        if (P.isRole(n, "reserve")) return [0, +P.workAllowed(n)];
        return [Math.max(0, P.countLo(n)), Math.max(P.countHi(n), P.fixedWorkCount(n))]; }); // 当月の下限・上限を入れた人はその範囲
      const lo = bounds.reduce((a, b) => a + b[0], 0), hi = bounds.reduce((a, b) => a + b[1], 0);
      if (hi < needMin) ctx.push("LINT_CAPACITY_HIGH", { need: needMin, total: hi, tol: prm.tol });
      if (lo > needMax) ctx.push("LINT_CAPACITY_LOW", { need: needMax, total: lo, tol: prm.tol }); }
    for (const n of P.dutyNames) { if (P.isExempt(n)) continue; const q = P.quota(n); const c = P.slots.filter(s => ctx.canWork(n, s)).length; if (c < P.countLo(n)) { if (P.countMin[n] != null) ctx.push("LINT_PERSON_TOO_FEW_SLOTS_LIMIT", { who: n, count: c, min: P.countMin[n] }); else ctx.push("LINT_PERSON_TOO_FEW_SLOTS", { who: n, count: c, quota: q, tol: prm.tol }); } }
  },
  python: true,
});

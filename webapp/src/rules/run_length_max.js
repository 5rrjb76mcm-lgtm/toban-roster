// 規則のプラグイン: 連勤の上限（run_length_max）。どの連続 max+1 日を取っても勤務は max 日以下。前月末の勤務と翌月 1 日の固定も並びに含める。docs/rule-modules.md
// rules.run_length.max（P.runMax）。対象外の資格（rules.run_length.exempt_qual）を持つ人には当てはめない（P.runApplies）。
T.rules.register({
  id: "run_length_max", api: 1, order: 700, group: "combo",
  label: "連勤の上限（何日まで続けてよいか）", states: ["hard", "soft", "off"], def: "off",
  weight: "run_length_over", w0: 100,
  read(P) { return { max: P.runMax }; },
  solve(ctx, prm) {
    const { P, LP } = ctx, K = prm.max;
    for (const n of ctx.names) { if (!P.runApplies(n)) continue;
      for (let d = ctx.firstPrev; d + K <= P.N + 1; d++) { if (d + K < 1) continue; // 前月の中だけの並びは対象外（前月の結果は変えられない）
        const win = [], days = []; for (let j = 0; j <= K; j++) { win.push(ctx.y(d + j, n)); if (d + j >= 1 && d + j <= P.N) days.push(d + j); }
        ctx.limit("run_length_max", LP.sum(win), "<=", K, { fixed: ctx.fixedInvolved(days, n), aux: "rlo", ub: K + 1 }); } } // 固定した日が絡む窓は減点付きで許す（検算では「固定指定により許容」）
  },
  check(ctx, prm) {
    // 解く側と同じく max+1 日の窓ごとに固定の関与を見る。関与の有無が同じ窓はまとめて 1 件にする（固定の無い窓が 1 つでもあれば、その部分は違反 V に残る）
    const K = prm.max, inM = d => d >= 1 && d <= ctx.N;
    for (const n of ctx.names.filter(x => ctx.P.runApplies(x))) for (const r of ctx.runs(n)) { if (r.length <= K || r[r.length - 1] < 1) continue;
      let seg = null; const flush = () => { if (seg) ctx.viol("RUN_TOO_LONG", { who: n, from: ctx.lab(Math.max(seg.days[0], 1)), len: seg.days.length, max: K }, seg.days.filter(inM), n, seg.fx); seg = null; }; // 許容の可否は窓の判定（勤務の固定だけ。OC の固定では許容しない）
      for (let i = 0; i + K < r.length; i++) { const win = r.slice(i, i + K + 1); if (win[win.length - 1] < 1) continue; // 前月の中だけの窓は対象外
        const fx = ctx.fixedInvolved(win.filter(inM), n);
        if (seg && seg.fx === fx) { for (const d of win) if (!seg.days.includes(d)) seg.days.push(d); } else { flush(); seg = { fx, days: win.slice() }; } }
      flush(); }
  },
  penalty(ctx, prm) {
    const { P } = ctx, K = prm.max;
    for (const n of ctx.names) if (P.runApplies(n)) for (let d = ctx.firstPrev; d + K <= ctx.N + 1; d++) { if (d + K < 1) continue; let c = 0; const days = []; for (let j = 0; j <= K; j++) { c += ctx.y(n, d + j); if (d + j >= 1 && d + j <= ctx.N) days.push(d + j); }
      ctx.limit("run_length_max", c, "<=", K, { fixed: ctx.fixedInvolved(days, n) }); }
  },
  ui: {
    render(R, h) { return `<label>${h.esc(h.tx("連勤は"))} <input type="number" min="1" max="31" id="setRunMax" value="${(R.run_length || {}).max ?? 5}" style="width:4em"> ${h.esc(h.tx("日まで"))}</label>
　<label>${h.esc(h.tx("対象外の資格（・区切り）"))} <input id="setRunExempt" value="${h.esc((R.run_length || {}).exempt_qual || "")}" style="width:8em"></label>
 <span class="note">${h.esc(h.tx("この資格を持つ人には連勤の上限・下限を当てはめません（平日に続けて勤務する師長など）。"))}</span>`; },
    read(R, el) { const mx = +((el("#setRunMax") || {}).value) || 0; if (mx) R.run_length = Object.assign({}, R.run_length, { max: mx });
      if (el("#setRunExempt")) { const v = el("#setRunExempt").value.trim(); R.run_length = Object.assign({}, R.run_length); if (v) R.run_length.exempt_qual = v; else delete R.run_length.exempt_qual; } },
  },
  summary(P, prm, tv) { return tv("{n} 日まで", { n: prm.max }); },
  messages: { RUN_TOO_LONG: { en: "{who}: {len} days in a row from {from} (limit {max})", ja: "{who}: {from}から {len} 連勤（上限 {max} 日）" } },
  // 説明資料の第 9 節（調整目標の達成状況）の行
  report(ctx, prm) {
    const { P, t } = ctx; if (P.state("run_length_max") === "off" && P.state("run_length_min") === "off") return; // 連勤の分布（上限か下限を使うとき）
    const hist = {}; for (const n of ctx.names) { let run = 0; for (let d = 1; d <= P.N + 1; d++) { const w = d > P.N ? false : ctx.anyWork(n, d); if (w) run++; else { if (run) hist[run] = (hist[run] || 0) + 1; run = 0; } } }
    const line = Object.keys(hist).sort((a, b) => +a - +b).map(k => t("{len}日×{n}", { len: k, n: hist[k] })).join(ctx.sep());
    ctx.line(t("連勤の長さの分布（上限 {max}{min}）: {dist}", { max: P.state("run_length_max") === "off" ? t("なし") : t("{n}日", { n: P.runMax }), min: P.state("run_length_min") === "off" ? "" : t("／原則 {n}日以上", { n: P.runMin }), dist: line || t("なし") }));
  },
  reportAlways: true, // 規則を使っていなくても情報として出す
  // 入力チェック: 連日禁止と両立しない、下限が上限を超える
  lint(ctx, prm) {
    const { P } = ctx;
    if (P.state("consecutive_days") === "hard") ctx.push("LINT_RUN_VS_CONSECUTIVE_MAX");
    if (P.state("run_length_min") !== "off" && P.runMin > prm.max) ctx.push("LINT_RUN_MIN_OVER_MAX", { min: P.runMin, max: prm.max });
  },
  python: false,
});

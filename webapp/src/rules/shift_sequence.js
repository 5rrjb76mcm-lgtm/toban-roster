// 規則のプラグイン: 勤務帯のつながりの禁止（shift_sequence）。「この勤務帯の翌日は、これに入れない」の組の一覧（rules.forbid_sequence → P.seqRules）。
// 2 交代の「夜勤の翌日は休み（明け休み）」がこれ。表の行の追加・削除（data-act="seqAdd" / "seqDel"）は ui.acts / ui.act で受ける。docs/rule-modules.md
T.rules.register({
  id: "shift_sequence", api: 1, order: 720, group: "combo",
  label: "勤務帯のつながりの禁止（明け休みなど）", states: ["hard", "soft", "off"], def: "off",
  weight: "shift_sequence", w0: 100,
  read(P) { return { rules: P.seqRules }; },
  solve(ctx, prm) {
    const { P, lp, LP, E } = ctx;
    for (const r of prm.rules) for (const n of ctx.names) for (let d = 1; d < P.N; d++) {
      if (!ctx.has([d, r.from])) continue;
      for (const k of (r.to === "any" ? ["day", "night"] : [r.to]).filter(k => ctx.has([d + 1, k]))) // 固定した枠が絡む組は減点付きで許す（他の必須条件と同じ。検算では「固定指定により許容」）
        ctx.limit("shift_sequence", E(ctx.work([d, r.from], n), ctx.work([d + 1, k], n)), "<=", 1, { fixed: P.isFixedEng([d, r.from], n) || P.isFixedEng([d + 1, k], n), aux: "seq", ub: 1 }); }
    // 月またぎ: 前月最終日の勤務（定数）→ 当月 1 日、当月末 → 翌月 1 日の固定指定。固定した枠は減点付きで許す（他の規則と同じ）
    for (const r of prm.rules) for (const n of ctx.names) {
      if (P.prevWorked([0, r.from], n)) for (const k of (r.to === "any" ? ["day", "night"] : [r.to]).filter(k => ctx.has([1, k])))
        ctx.limit("shift_sequence", ctx.work([1, k], n), "<=", 0, { fixed: P.isFixedEng([1, k], n), aux: "seq", ub: 1 });
      if (P.nextFixedAny() && ctx.has([P.N, r.from]) && nextFixedIn(P, n, r.to))
        ctx.limit("shift_sequence", ctx.work([P.N, r.from], n), "<=", 0, { fixed: P.isFixedEng([P.N, r.from], n), aux: "seq", ub: 1 }); }
  },
  check(ctx, prm) {
    const { P } = ctx;
    for (const r of prm.rules) for (const n of ctx.names) for (let d = 1; d < P.N; d++) {
      if (!ctx.worked(n, [d, r.from])) continue;
      for (const k of (r.to === "any" ? ["day", "night"] : [r.to])) if (ctx.worked(n, [d + 1, k])) // 許容は解く側の例外と同じ 2 枠のどちらかが固定のときだけ
        ctx.viol("SHIFT_SEQUENCE", { day: ctx.lab(d), next: ctx.lab(d + 1), who: n, from: P.shiftLabel(r.from), to: P.shiftLabel(k), kind: P.msg(r.to === "any" ? "SHIFT_SEQUENCE_REST" : "SHIFT_SEQUENCE_FORBIDDEN") }, [[d, r.from], [d + 1, k]], n); }
    for (const r of prm.rules) for (const n of ctx.names) { // 月またぎ
      if (P.prevWorked([0, r.from], n)) for (const k of (r.to === "any" ? ["day", "night"] : [r.to])) if (ctx.worked(n, [1, k]))
        ctx.viol("SHIFT_SEQUENCE", { day: ctx.lab(0), next: ctx.lab(1), who: n, from: P.shiftLabel(r.from), to: P.shiftLabel(k), kind: P.msg(r.to === "any" ? "SHIFT_SEQUENCE_REST" : "SHIFT_SEQUENCE_FORBIDDEN") }, [[1, k]], n);
      if (P.nextFixedAny() && ctx.worked(n, [P.N, r.from]) && nextFixedIn(P, n, r.to))
        ctx.viol("SHIFT_SEQUENCE", { day: ctx.lab(P.N), next: ctx.lab(P.N + 1), who: n, from: P.shiftLabel(r.from), to: P.shiftLabel(r.to === "any" ? (P.nextFixed.day.includes(n) ? "day" : "night") : r.to), kind: P.msg(r.to === "any" ? "SHIFT_SEQUENCE_REST" : "SHIFT_SEQUENCE_FORBIDDEN") }, [[P.N, r.from]], n); }
  },
  penalty(ctx, prm) {
    const { P } = ctx;
    for (const n of ctx.names) for (const r of prm.rules) for (let d = 1; d < ctx.N; d++) { if (!ctx.has([d, r.from])) continue;
      for (const k of (r.to === "any" ? ["day", "night"] : [r.to]).filter(k => ctx.has([d + 1, k])))
        ctx.limit("shift_sequence", (ctx.worked(n, [d, r.from]) ? 1 : 0) + (ctx.worked(n, [d + 1, k]) ? 1 : 0), "<=", 1, { fixed: P.isFixedEng([d, r.from], n) || P.isFixedEng([d + 1, k], n) }); }
    for (const r of prm.rules) for (const n of ctx.names) { // 月またぎ（解く側と同じく、固定した枠は fixed_conflict）
      if (P.prevWorked([0, r.from], n)) for (const k of (r.to === "any" ? ["day", "night"] : [r.to]).filter(k => ctx.has([1, k])))
        ctx.limit("shift_sequence", ctx.worked(n, [1, k]) ? 1 : 0, "<=", 0, { fixed: P.isFixedEng([1, k], n) });
      if (P.nextFixedAny() && ctx.has([P.N, r.from]) && nextFixedIn(P, n, r.to))
        ctx.limit("shift_sequence", ctx.worked(n, [P.N, r.from]) ? 1 : 0, "<=", 0, { fixed: P.isFixedEng([P.N, r.from], n) }); }
  },
  ui: {
    acts: { seqAdd: "つながりの禁止を追加", seqDel: "つながりの禁止を削除" }, // 表のボタン（data-act）と、戻るための操作名
    act(R, act, btn) { const seq = [].concat(R.forbid_sequence || []); if (!seq.length) seq.push({ from: "night", to: "any" }); if (act === "seqAdd") seq.push({ from: "night", to: "any" }); else seq.splice(+btn.closest("tr").dataset.si, 1); R.forbid_sequence = seq; },
    render(R, h) { const { esc, tx, sel, shifts } = h; const seq = [].concat(R.forbid_sequence || []); if (!seq.length) seq.push({ from: "night", to: "any" });
      return `<table class="grid" id="seqTbl"><tr><th>${esc(tx("この勤務帯の翌日は"))}</th><th>${esc(tx("これに入れない"))}</th><th></th></tr>` +
        seq.map((x, i) => `<tr data-si="${i}"><td>${sel(shifts, x.from || "night", "data-sfrom")}</td><td>${sel([["any", tx("すべての勤務帯（明け休み）")], ...shifts], x.to || "any", "data-sto")}</td><td><button data-act="seqDel">${esc(tx("削除"))}</button></td></tr>`).join("") + `</table>
<p><button data-act="seqAdd">${esc(tx("つながりの禁止を追加"))}</button> <span class="note">${esc(tx("2交代制の「夜勤の翌日は休み（明け休み）」がこれです。"))}</span></p>`; },
    read(R, el) { if (!el("#seqTbl")) return; const seq = []; el("#seqTbl").querySelectorAll("tr[data-si]").forEach(tr => seq.push({ from: tr.querySelector("[data-sfrom]").value, to: tr.querySelector("[data-sto]").value }));
      if (seq.length) R.forbid_sequence = seq; else delete R.forbid_sequence; },
  },
  summary(P, prm, tv) { return prm.rules.map(r => tv("{from}の翌日は{to}に入らない", { from: P.shiftLabel(r.from), to: r.to === "any" ? tv("どの勤務帯") : P.shiftLabel(r.to) })).join(T.listSep()); },
  messages: {
    SHIFT_SEQUENCE: { en: "{day}→{next}: {who} works {to} the day after {from} ({kind})", ja: "{day}→{next}: {who} {from}の翌日に{to}（{kind}）" },
    SHIFT_SEQUENCE_REST: { en: "rest after a night", ja: "明け休み" },
    SHIFT_SEQUENCE_FORBIDDEN: { en: "a forbidden transition", ja: "禁止のつながり" },
  },
  // 説明資料の第 9 節（調整目標の達成状況）の行
  report(ctx, prm) {
    const { P, t } = ctx; if (P.state("shift_sequence") !== "soft") return;
    const lines = []; for (const r of prm.rules) for (const n of ctx.names) { const ds = []; for (let d = 1; d < P.N; d++) if (ctx.worked(n, [d, r.from])) for (const k of (r.to === "any" ? ["day", "night"] : [r.to])) if (ctx.worked(n, [d + 1, k])) ds.push(`${P.label(d)}→${P.label(d + 1)}`); if (ds.length) lines.push(`${n}: ${ds.join(ctx.sep())}`); }
    ctx.line(t("勤務帯のつながりの禁止（減点 shift_sequence）: {items}", { items: lines.join("／") || t("なし") }));
  },
  python: false,
});
// 翌月 1 日の固定指定で、その人が「これに入れない」勤務帯に入っているか（to が any ならどの勤務帯でも）
function nextFixedIn(P, n, to) { const x = P.nextFixed || {}; const inK = k => [].concat(x[k] || []).includes(n); return to === "any" ? (inK("day") || inK("night")) : inK(to); }

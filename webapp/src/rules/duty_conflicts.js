// 規則のプラグイン: 日中の業務と当番の両立（duty_conflicts）。docs/rule-modules.md
//   翌朝に外勤・翌日に午後の業務がある日の夜勤は不可、翌朝外勤の前の夜間 OC は不可、午後外勤日の日勤 OC は不可、
//   午後外勤日の夜勤・夜間 OC は rules.pm_external_night（confirm=「間に合う」確認の記録があるときだけ可 / forbid / allow）。固定指定した枠には当てはめない。
// 月末は翌月 1 日（曜日パターンからの推定）を翌日として判定する。診断では人ごとに外せる（relax "duties:<氏名>"）。
// 固定指定と重なるかの入力チェック（LINT_FIXED_NIGHT_NEXT_*、LINT_FIXED_OC_*_EXTERNAL）は lint（この規則を使う施設だけ）。
T.rules.register({
  id: "duty_conflicts", api: 1, order: 600, group: "duty",
  label: "日中の業務と当番を両立させる（翌朝外勤の前の夜勤や、午後外勤日のオンコールを禁止）", states: ["hard", "off"], def: "hard",
  weight: null, w0: null, relax: "duties",
  read(P) { return { pmExt: P.pmExtNight }; },
  solve(ctx) {
    const { P, lp } = ctx;
    for (const n of ctx.names) for (let d = 1; d <= P.N; d++) {
      if (ctx.relaxed("duties:" + n)) continue; // この人の定期業務の制約を外す（診断用）
      const nd = d + 1;
      if (nd <= P.N + 1) {
        const extAm = P.busy(n, nd, "am", ["external"]), extPm = P.busy(n, nd, "pm", ["external"]), pmFull = P.busy(n, nd, "pm");
        if ((extAm || extPm || pmFull) && !P.isFixedWork([d, "night"], n)) lp.add(ctx.work([d, "night"], n), "=", 0);
        if (extAm && !P.isFixedEng([d, "night"], n)) lp.add(ctx.oc([d, "night"], n), "=", 0); }
      if (P.busy(n, d, "pm", ["external"])) {
        if (ctx.has([d, "day"]) && !P.isFixedEng([d, "day"], n)) lp.add(ctx.oc([d, "day"], n), "=", 0);
        if (P.pmExtNightBanned(d, n)) { if (!P.isFixedEng([d, "night"], n)) lp.add(ctx.oc([d, "night"], n), "=", 0); if (!P.isFixedWork([d, "night"], n)) lp.add(ctx.work([d, "night"], n), "=", 0); } } }
  },
  check(ctx) {
    const { P } = ctx, note = () => P.msg(P.pmExtNight === "forbid" ? "PM_EXT_FORBIDDEN" : "PM_EXT_UNCONFIRMED");
    for (const n of ctx.names) for (let d = 1; d <= P.N; d++) { const nd = d + 1;
      if (nd <= P.N + 1) {
        if (ctx.worked(n, [d, "night"]) && (P.busy(n, nd, "am", ["external"]) || P.busy(n, nd, "pm"))) ctx.viol("NIGHT_THEN_DUTY", { day: ctx.lab(d), who: n, note: nd > P.N ? P.msg("NIGHT_THEN_DUTY_NEXT_MONTH") : "" }, d, n);
        if (ctx.onCall(n, [d, "night"]) && P.busy(n, nd, "am", ["external"])) ctx.viol("NIGHT_OC_THEN_EXTERNAL", { day: ctx.lab(d), who: n }, d, n); }
      if (P.busy(n, d, "pm", ["external"])) {
        if (ctx.onCall(n, [d, "day"])) ctx.viol("PM_EXT_DAY_OC", { day: ctx.lab(d), who: n }, d, n);
        if (ctx.onCall(n, [d, "night"]) && P.pmExtNightBanned(d, n)) ctx.viol("PM_EXT_NIGHT_OC", { day: ctx.lab(d), who: n, note: note() }, d, n);
        if (ctx.worked(n, [d, "night"]) && P.pmExtNightBanned(d, n)) ctx.viol("PM_EXT_NIGHT", { day: ctx.lab(d), who: n, note: note() }, d, n); } }
  },
  ui: {
    render(R, h) { return `<label>${h.esc(h.tx("午後外勤日の夜勤・夜間OC: "))}${h.sel([["confirm", h.tx("「間に合う」と確認した記録があるときだけ可")], ["forbid", h.tx("常に不可")], ["allow", h.tx("制限なし")]], R.pm_external_night || "confirm", 'id="setPmExt"')}</label>
 <span class="note">${h.esc(h.tx("翌朝外勤・翌日午後業務の前の夜勤の禁止、午後外勤日の日勤OCの禁止は、この規則を「必須」にしている間は常に効きます。"))}</span>`; },
    read(R, el) { if (el("#setPmExt")) R.pm_external_night = el("#setPmExt").value; },
  },
  summary(P, prm, tv) { return tv("午後外勤日の夜勤・夜間OC: {mode}", { mode: tv({ confirm: "確認の記録があるときだけ可", forbid: "常に不可", allow: "制限なし" }[prm.pmExt] || prm.pmExt) }); },
  messages: {
    NIGHT_THEN_DUTY: { en: "{day} night: {who} has outside work, or afternoon or all-day duty, the next day{note}", ja: "{day}夜勤: {who} 翌日{note}に外勤または午後・終日の業務" },
    NIGHT_THEN_DUTY_NEXT_MONTH: { en: " (the 1st of next month)", ja: "（翌月1日）" },
    NIGHT_OC_THEN_EXTERNAL: { en: "{day} night on-call: {who} has outside work the next morning", ja: "{day}夜間OC: {who} 翌朝に外勤" },
    PM_EXT_DAY_OC: { en: "{day}: {who} is on day on-call on an afternoon-outside day", ja: "{day}: {who} 午後外勤日に日勤OC" },
    PM_EXT_NIGHT_OC: { en: "{day}: {who} is on night on-call after outside work in the afternoon{note}", ja: "{day}: {who} 午後外勤後の夜間OC{note}" },
    PM_EXT_NIGHT: { en: "{day}: {who} is on a night shift after outside work in the afternoon{note}", ja: "{day}: {who} 午後外勤後の夜勤{note}" },
    PM_EXT_FORBIDDEN: { en: " (forbidden here)", ja: "（禁止設定）" },
    PM_EXT_UNCONFIRMED: { en: " (not confirmed as in time)", ja: "（未確認）" },
  },
  // 入力チェック: 固定した夜勤・オンコールが日中の業務（翌朝の外勤・翌日の午後業務・午後外勤）と重なる（解く側は固定した枠に当てはめないので、ここで知らせる）
  lint(ctx, prm) {
    const { P } = ctx, lab = ctx.lab, sl = P.shiftLabel("night");
    for (const [ds, ns] of Object.entries(P.fixedNight)) for (const n of ns) { const d = +ds; if (!P.dutyNames.includes(n)) continue; // 1 枠に複数名の固定
      const nd = d + 1;
      if (nd <= P.N) {
        if (P.busy(n, nd, "am", ["external"]) || P.busy(n, nd, "pm", ["external"])) ctx.push("LINT_FIXED_NIGHT_NEXT_EXTERNAL", { day: lab(d), slot: sl, who: n, next: lab(nd) });
        else if (P.busy(n, nd, "pm")) ctx.push("LINT_FIXED_NIGHT_NEXT_PM", { day: lab(d), slot: sl, who: n, next: lab(nd) }, { who: n, next: lab(nd) });
      }
      if (P.busy(n, d, "pm", ["external"]) && P.pmExtNightBanned(d, n)) ctx.push("LINT_FIXED_NIGHT_PM_EXTERNAL", { day: lab(d), slot: sl, who: n }); }
    for (const [kind, table] of [["day", P.fixedDayOc], ["night", P.fixedNightOc]]) for (const [ds, ns] of Object.entries(table)) {
      const d = +ds, lbl = kind === "day" ? "日勤OC" : "夜間OC";
      if (kind === "day" && !P.slotExists(d, "day")) continue; if (ns.length && !P.shiftHasOncall(kind)) continue; // 枠が無い・オンコールを付けない勤務帯は本体が指摘する
      for (const n of ns) { if (!P.dutyNames.includes(n)) continue;
        if (kind === "night" && d + 1 <= P.N && P.busy(n, d + 1, "am", ["external"])) ctx.push("LINT_FIXED_OC_NEXT_EXTERNAL", { day: lab(d), slot: lbl, who: n, next: lab(d + 1) }, { who: n, next: lab(d + 1) });
        if (P.busy(n, d, "pm", ["external"]) && (kind === "day" || P.pmExtNightBanned(d, n))) ctx.push("LINT_FIXED_OC_PM_EXTERNAL", { day: lab(d), slot: lbl, who: n, why: P.msg(kind === "day" ? "LINT_FIXED_OC_PM_EXTERNAL_DAY" : "LINT_FIXED_OC_PM_EXTERNAL_NIGHT") }, { day: lab(d), who: n, extra: kind === "night" ? P.msg("LINT_FIXED_OC_PM_EXTERNAL_HINT_EXTRA") : "" }); } }
  },
  python: true,
});

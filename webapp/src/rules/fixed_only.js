// 規則のプラグイン: 「固定したときだけ」の人（名簿の当番の欄 duty: "fixed_only"）は、固定した枠にだけ入る（fixed_only）。docs/rule-modules.md
// 師長のように、勤務の並びを手で決める人に使う。休みの日数・連勤などの規則はこの人たちには当てはめず（並びは固定で決まる）、固定の並びから休みが足りるかを入力チェックで知らせる。
T.rules.register({
  id: "fixed_only", api: 1, order: 556, group: "basic",
  label: "名簿の当番の欄が「固定したときだけ」の人は、固定した枠にだけ入る", states: ["hard", "off"], def: "hard",
  solve(ctx) {
    const { P } = ctx;
    for (const n of ctx.names) if (P.isFixedOnly(n)) for (const s of ctx.slots) {
      if (!P.isFixedWork(s, n)) ctx.limit("fixed_only", ctx.work(s, n), "<=", 0);
      if (!P.isFixedEng(s, n)) ctx.limit("fixed_only", ctx.oc(s, n), "<=", 0); }
  },
  check(ctx) {
    const { P } = ctx;
    for (const n of ctx.names) if (P.isFixedOnly(n)) for (const s of P.slots) {
      if (ctx.worked(n, s) && !P.isFixedWork(s, n)) ctx.viol("FIXED_ONLY_ASSIGNED", { who: n, slot: ctx.slab(s) }, [s], n, false);
      else if (ctx.onCall(n, s) && !P.isFixedEng(s, n)) ctx.viol("FIXED_ONLY_ASSIGNED", { who: n, slot: ctx.slab(s) }, [s], n, false); }
  },
  // 入力チェック: 固定の並びから休みの日数を見積もり、休みの日数の規則を使っているなら足りるかを見る。夜勤の翌日（明け）に勤務を固定していないか
  lint(ctx) {
    const { P } = ctx, offOn = P.state("days_off_min") !== "off" || P.state("days_off_max") !== "off";
    for (const n of ctx.names) { if (!P.isFixedOnly(n)) continue; let work = 0, ake = 0, afterNight = 0;
      for (let d = 1; d <= P.N; d++) { const w = P.isFixedWork([d, "day"], n) || P.isFixedWork([d, "night"], n), pn = d > 1 ? P.isFixedWork([d - 1, "night"], n) : P.prevWorked([0, "night"], n);
        if (w) work++; if (pn && !w && !P.akeIsOff) ake++; if (pn && P.isFixedWork([d, "day"], n)) afterNight++; }
      if (!work) ctx.push("LINT_FIXED_ONLY_EMPTY", { who: n });
      if (offOn && P.N - work - ake < P.offTarget(n)) ctx.push("LINT_FIXED_ONLY_REST", { who: n, off: P.N - work - ake, need: P.offTarget(n) });
      if (afterNight && P.state("shift_sequence") !== "off") ctx.push("LINT_FIXED_ONLY_AKE", { who: n, n: afterNight }); }
  },
  messages: {
    FIXED_ONLY_ASSIGNED: { en: "{who} (fixed shifts only) is placed in {slot} without a fixed assignment", ja: "{who}（固定したときだけ）が固定していない {slot} に入っている" },
    LINT_FIXED_ONLY_EMPTY: { en: "{who} is set to \"fixed shifts only\" but has no fixed shift this month", ja: "{who} は「固定したときだけ」ですが、この月の固定がありません" },
    LINT_FIXED_ONLY_EMPTY_HINT: { en: "Enter the shifts in the fixed assignments (or change the duty column of the roster)", ja: "固定配置に勤務を入れる（または名簿の当番の欄を変える）" },
    LINT_FIXED_ONLY_REST: { en: "{who} (fixed shifts only): the fixed shifts leave {off} days off (needs {need})", ja: "{who}（固定したときだけ）の固定では休みが {off} 日で、決まった日数 {need} 日に足りません" },
    LINT_FIXED_ONLY_REST_HINT: { en: "Remove some fixed shifts", ja: "固定をいくつか外す" },
    LINT_FIXED_ONLY_AKE: { en: "{who} (fixed shifts only): {n} day shift(s) fixed on the day after a night shift", ja: "{who}（固定したときだけ）の夜勤の翌日に日勤が {n} 日固定されています（明けは休み）" },
    LINT_FIXED_ONLY_AKE_HINT: { en: "Remove the day shift after the night", ja: "夜勤の翌日の日勤の固定を外す" },
  },
  python: false,
});

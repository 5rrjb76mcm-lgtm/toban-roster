// 規則のプラグイン: 連勤の下限（run_length_min）。連を始めたら min 日は続ける（原則。減点だけ）。月末と本人の不可で切れる分は数えない。docs/rule-modules.md
// 夜勤の翌日が休みの施設では夜勤ごとに連が終わるので、夜勤の数に対して下限が長いと短い連が避けられない（入力チェックが知らせる。解く側には下界を上げる切除を足す）
T.rules.register({
  id: "run_length_min", api: 1, order: 710, group: "combo",
  label: "連勤の下限（続けるなら何日以上か。原則）", states: ["soft", "off"], def: "off",
  weight: "run_short", w0: 20,
  read(P) { return { min: P.runMin }; },
  solve(ctx, prm) {
    const { P, lp, LP } = ctx, L = prm.min;
    const ake = akeEndsRun(P); // 夜勤の翌日が休み（明け）の施設では、夜勤 1 回ごとに連が 1 本終わる
    for (const n of ctx.names) { if (!P.runApplies(n)) continue;
      const sts = [], shorts = []; let skipped = 0, last = 0;
      for (let d = 1; d + L - 1 <= P.N; d++) { last = d;
        if (P.unavailAllDayAny(n, d + 1, d + L - 1)) { skipped++; continue; } // 本人の不可で切れる連は減点しない
        const st = lp.aux("rst"); lp.add(st, ">=", LP.sub(ctx.y(d, n), ctx.y(d - 1, n))); // 連の開始
        const short = lp.aux("rsh");
        for (let j = 1; j < L; j++) lp.add(LP.sum([ctx.y(d + j, n), short]), ">=", st);
        lp.objAdd(P.softW("run_length_min"), short); sts.push(st); shorts.push(short); }
      if (!sts.length) continue;
      // 有効な切除（最適解を変えず、線形緩和の下界を上げる。docs §6.42）:
      //   (1) 連の開始の数 ≥ 夜勤の数 − 前月末からの連 − 不可で数えなかった開始（明けが休みの施設だけ。夜勤はそれぞれ別の連の終わり）
      //   (2) L ×（開始 − 短い連）≤ 勤務日数（短くない連は L 日以上を占め、互いに重ならない）
      // 固定指定のある人には (1) を足さない（固定した連続の夜勤は明け休みの例外になり「夜勤ごとに連が終わる」前提が崩れて、余分な短い連を数えてしまう）
      if (ake && !P.hasFixedEng(n)) { const e = { t: {}, c: 0 }; for (const st of sts) LP.addTo(e, st, 1);
        for (let d = 1; d <= last; d++) if (ctx.has([d, "night"])) LP.addTo(e, ctx.work([d, "night"], n), -1);
        LP.addTo(e, ctx.y(0, n), 1); lp.add(e, ">=", -skipped); }
      { const e = { t: {}, c: 0 }; for (const st of sts) LP.addTo(e, st, L); for (const sh of shorts) LP.addTo(e, sh, -L);
        for (let d = 1; d <= P.N; d++) LP.addTo(e, ctx.y(d, n), -1); lp.add(e, "<=", 0); } }
  },
  penalty(ctx, prm) {
    const { P } = ctx, L = prm.min;
    for (const n of ctx.names) if (P.runApplies(n)) for (let d = 1; d + L - 1 <= ctx.N; d++) {
      if (P.unavailAllDayAny(n, d + 1, d + L - 1)) continue;
      if (!(ctx.y(n, d) && !ctx.y(n, d - 1))) continue; // 連の開始
      let short = 0; for (let j = 1; j < L; j++) if (!ctx.y(n, d + j)) short = 1;
      ctx.add("run_short", P.softW("run_length_min"), short); }
  },
  ui: {
    render(R, h) { return `<label>${h.esc(h.tx("連勤を始めたら"))} <input type="number" min="2" max="31" id="setRunMin" value="${(R.run_length || {}).min ?? 3}" style="width:4em"> ${h.esc(h.tx("日は続ける"))}</label>`; },
    read(R, el) { const mn = +((el("#setRunMin") || {}).value) || 0; if (mn) R.run_length = Object.assign({}, R.run_length, { min: mn }); },
  },
  summary(P, prm, tv) { return tv("始めたら {n} 日は続ける", { n: prm.min }); },
  // 入力チェック: 連日禁止と両立しない。夜勤の数に対して下限が長すぎる（短い連が避けられず、計算も長引く）
  lint(ctx, prm) {
    const { P } = ctx, L = prm.min;
    if (P.state("consecutive_days") === "hard") ctx.push("LINT_RUN_VS_CONSECUTIVE_MIN");
    if (!akeEndsRun(P)) return;
    // 夜勤 1 回ごとに連が 1 本終わるので、L 日以上の連を夜勤の数だけ作るには 1 人 L × 夜勤回 の勤務が要る。
    // 全員の目安から作れる L 日以上の連の本数（Σ floor(目安 / L)）が夜勤の延べ数に足りなければ、その差の分だけ短い連が避けられない
    const people = P.dutyNames.filter(n => P.runApplies(n) && !P.isRole(n, "reserve"));
    const runs = people.reduce((a, n) => a + Math.floor(P.quota(n) / L), 0), qsum = people.reduce((a, n) => a + P.quota(n), 0);
    const nights = P.slots.filter(s => s[1] === "night").reduce((a, s) => a + P.countMinOf(s), 0);
    if (qsum > 0 && nights > runs) ctx.push("LINT_RUN_MIN_VS_NIGHTS", { min: L, nights, runs, short: nights - runs });
  },
  messages: {
    LINT_RUN_MIN_VS_NIGHTS: { en: "Shortest run {min} days: the month has {nights} night shifts, each ending a run, but the targets allow at most {runs} runs of {min}+ days — at least {short} short runs are unavoidable", ja: "連勤の下限 {min} 日: 夜勤は月 {nights} 回あり（夜勤ごとに連が 1 本終わる）、目安から作れる {min} 日以上の連は {runs} 本まで。短い連が最低 {short} 本は避けられません" },
    LINT_RUN_MIN_VS_NIGHTS_HINT: { en: "The solver then spends its time proving what it cannot avoid. Shorten the minimum (e.g. 2 days) or reduce the number of night shifts per person", ja: "避けられない減点の証明に計算時間が費やされます。下限を短くする（例: 2 日）か、1 人あたりの夜勤を減らしてください" },
  },
  python: false,
});
// 夜勤の翌日が休み（明け）の施設か: 勤務帯のつながりの禁止（必須）に「夜勤 → 翌日のすべての勤務帯」があるとき
function akeEndsRun(P) { return P.isHard("shift_sequence") && P.seqRules.some(r => r.from === "night" && r.to === "any"); }

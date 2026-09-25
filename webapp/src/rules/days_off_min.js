// 規則のプラグイン: 月の休みの日数（days_off_min）。休みでない日（勤務した日。明けを休みに数えない施設では明けも）が「暦 − 基準」日以下（ちょうどの設定なら等しい）。
// 基準は労働時間から（暦の日数 − 所定労働日数）か、その月の土日祝の数（rules.days_off.basis）。有給の日はその人の基準に足す（P.offTarget）。docs/rule-modules.md
// 人数が合わないときの入力チェック（LINT_BUSY_DAYS_*）は本体の人数の見積もりの中にある。
T.rules.register({
  id: "days_off_min", api: 1, order: 730, group: "rest",
  label: "月の休みの日数を確保する（暦の日数から決まる）", states: ["hard", "soft", "off"], def: "off",
  weight: "days_off_short", w0: 80, relax: "days_off",
  read(P) { return { exact: P.offExact, basis: P.offBasis, min: P.minDaysOff }; },
  solve(ctx, prm) {
    const { P, lp, LP } = ctx, st = P.state("days_off_min");
    for (const n of ctx.names) { if (P.isExempt(n)) continue; // 原則配置しない役割は数えない
      const maxWork = Math.max(0, P.N - P.offTarget(n)), days = [];
      for (let d = 1; d <= P.N; d++) days.push(ctx.busy(d, n));
      if (st === "hard") lp.add(LP.sum(days), prm.exact ? "=" : "<=", maxWork);
      else { const v = lp.auxInt("dofs", 0, P.N); lp.add(LP.sub(LP.sum(days), maxWork), "<=", v); lp.objAdd(P.softW("days_off_min"), v); // 減点: 足りない休みの日数
        if (prm.exact) { const u = lp.auxInt("dofx", 0, P.N); lp.add(LP.sub(maxWork, LP.sum(days)), "<=", u); lp.objAdd(P.softW("days_off_min"), u); } } } // ちょうど: 多すぎる休みも減点
  },
  check(ctx, prm) {
    const { P } = ctx;
    for (const n of ctx.names) { if (P.isExempt(n)) continue; const off = ctx.offDays(n).length;
      if (off < P.offTarget(n)) ctx.viol("DAYS_OFF_SHORT", { who: n, off, min: P.offTarget(n), N: P.N }, null, n);
      if (prm.exact && off > P.offTarget(n)) ctx.viol("DAYS_OFF_OVER", { who: n, off, target: P.offTarget(n) }, null, n); }
  },
  penalty(ctx, prm) {
    const { P, pos } = ctx;
    for (const n of ctx.names) { if (P.isExempt(n)) continue;
      let worked = 0; for (let d = 1; d <= ctx.N; d++) worked += ctx.busy(n, d);
      const maxWork = Math.max(0, ctx.N - P.offTarget(n));
      ctx.add("days_off_short", P.softW("days_off_min"), pos(worked - maxWork) + (prm.exact ? pos(maxWork - worked) : 0)); }
  },
  ui: {
    render(R, h) { const { esc, tx, sel } = h, d = R.days_off || {}, m = h.month || {};
      const N = m.year && m.month ? h.daysIn(+m.year, +m.month) : 31;
      let hol = null; try { hol = new T.Problem(R, m).minDaysOff; } catch (e) { }
      const head = `<p><label>${esc(tx("決め方: "))}${sel([["hours", tx("労働時間から（暦の日数 − 所定労働日数）")], ["holidays", tx("その月の土日祝の数")]], d.basis || "hours", 'id="setOffBasis"')}</label>
　<label>${sel([["min", tx("以上")], ["exact", tx("ちょうど")]], d.mode || "min", 'id="setOffMode"')}</label>
　<label><input type="checkbox" id="setAkeOff" ${d.ake_is_off !== false ? "checked" : ""}> ${esc(tx("夜勤の翌日（明け）も休みに数える"))}</label></p>
<p class="note">${esc(tx("その人がカレンダーで「有給」を付けた日は、その日数だけ休みに加わります。2 交代の病棟では、明けは休みに数えないのが普通です。"))}</p>`;
      if (d.basis === "holidays") return head + `<p class="note">${esc(T.t("いまの月では土日祝が {n} 日です。", { n: hol ?? "?" }))}</p>`;
      return head + `<label>${esc(tx("1 週の所定労働時間"))} <input type="number" min="1" max="80" step="0.5" id="setHrWeek" value="${d.hours_per_week ?? 40}" style="width:4.5em"> ${esc(tx("時間"))}</label>
　<label>${esc(tx("1 日"))} <input type="number" min="1" max="24" step="0.5" id="setHrDay" value="${d.hours_per_day ?? 8}" style="width:4em"> ${esc(tx("時間"))}</label>
　<label>${esc(tx("最低日数を直接指定"))} <input type="number" min="0" max="31" id="setOffMin" value="${d.min != null && d.min !== "auto" ? d.min : ""}" placeholder="${esc(tx("暦から自動"))}" style="width:5.5em"></label>
<p class="note">空欄なら暦の日数から決めます（暦日数 − 所定労働日数。所定労働日数は 暦日数 × 週の時間 ÷ 7 ÷ 1日の時間 の切り捨て）。
いまの月（${N} 日）では <b>${T.minDaysOff(R, N)} 日</b>。勤務の枠に入らない日を休みとして数えます（日中の業務は見ません）。</p>`; },
    read(R, el) { const d = Object.assign({}, R.days_off);
      if (el("#setHrWeek")) d.hours_per_week = +el("#setHrWeek").value || 40;
      if (el("#setHrDay")) d.hours_per_day = +el("#setHrDay").value || 8;
      if (el("#setOffMin")) { if (el("#setOffMin").value === "") delete d.min; else d.min = +el("#setOffMin").value; }
      if (el("#setOffBasis")) d.basis = el("#setOffBasis").value;
      if (el("#setOffMode")) d.mode = el("#setOffMode").value;
      if (el("#setAkeOff")) { if (el("#setAkeOff").checked) delete d.ake_is_off; else d.ake_is_off = false; }
      if (Object.keys(d).length) R.days_off = d; },
  },
  summary(P, prm, tv) { return tv(prm.exact ? "月 {min} 日ちょうど（{basis}。有給の日はその分を足す）" : "月 {min} 日以上（{basis}。有給の日はその分を足す）", { min: prm.min, basis: tv(prm.basis === "holidays" ? "その月の土日祝の数" : "労働時間から") }) + (P.akeIsOff ? "" : tv("。明けは休みに数えない")); },
  messages: {
    DAYS_OFF_SHORT: { en: "{who}: {off} days off this month (minimum {min}; {N} days in the month)", ja: "{who}: 月の休みが {off} 日（最低 {min} 日。暦 {N} 日）" },
    DAYS_OFF_OVER: { en: "{who}: {off} days off, more than the required {target}", ja: "{who}: 休みが {off} 日で、決まった {target} 日より多い" },
  },
  // 入力チェック: 休みの日数の設定が成り立つか、休みから決まる勤務日で枠を埋め切れるか（全体・勤務帯ごと・人ごと）
  lint(ctx, prm) {
    const { P } = ctx, lab = ctx.lab;
    // 休みの日数が設定として成り立つか（減点でも見る）
    if (prm.min >= P.N) ctx.push("LINT_DAYS_OFF_TOO_MANY", { min: prm.min, N: P.N });
    else for (const n of P.dutyNames) { const q = P.quota(n); if (P.isExempt(n)) continue;
      if (q - P.tol > P.N - prm.min) ctx.push("LINT_QUOTA_VS_DAYS_OFF", { who: n, quota: q, min: prm.min, maxWork: P.N - prm.min }); }
    if (!P.isHard("days_off_min")) return;
    // 休みの日数から決まる勤務日の合計と、枠が求める延べの勤務日（休みをちょうどにすると、人数と枠が整数で合わないと解が無い）。
    // 明けを休みに数えない施設で、夜勤の翌日は勤務に入れない（明け休みが必須）なら、月末以外の夜勤は明けの 1 日も使う。
    // 同じ日に 2 枠が禁止のときだけ数える（許されていると 1 人が 1 日で 2 枠を埋められ、見積もりが立たない）
    if (P.isHard("same_day_double") || P.shifts.filter(sh => P.slots.some(s => s[1] === sh.id)).length < 2) {
      const people = P.dutyNames.filter(n => !P.isExempt(n)), per = Math.max(0, P.N - prm.min);
      const busyOf = n => Math.max(0, P.N - P.offTarget(n)); // その人の勤務日（明けを休みに数えない施設では明けも含む）
      const akeUse = !P.akeIsOff && P.isHard("shift_sequence") && P.seqRules.some(r => r.from === "night" && r.to === "any");
      const use = s => akeUse && s[1] === "night" && s[0] < P.N ? 2 : 1; // 1 枠 1 人が使う勤務日
      let lo = 0, hi = 0; for (const s of P.slots) { lo += P.countMinOf(s) * use(s); hi += P.countOf(s) * use(s); }
      if (akeUse) { const c = people.filter(n => P.prevWorked([0, "night"], n)).length; lo += c; hi += c; } // 前月最終日の夜勤の人は 1 日が明け
      const supply = people.reduce((a, n) => a + busyOf(n), 0);
      const range = lo === hi ? String(lo) : `${lo}〜${hi}`;
      if (prm.exact && supply > hi) ctx.push("LINT_BUSY_DAYS_TOO_MANY", { supply, need: range, diff: supply - hi, people: people.length, per });
      if (supply < lo) ctx.push("LINT_BUSY_DAYS_TOO_FEW", { supply, need: range, diff: lo - supply, people: people.length, per });
      // 勤務帯ごと: その勤務帯に入れる人（構成の規則で最大 0 とされた人を除く）の勤務日で、最低人数を埋め切れるか
      for (const sh of P.shifts) { const ss = P.slots.filter(s => s[1] === sh.id); if (!ss.length) continue;
        const need = ss.reduce((a, s) => a + P.countMinOf(s) * use(s), 0), cap = people.filter(n => P.shiftEligible(n, sh.id)).reduce((a, n) => a + busyOf(n), 0);
        if (need > cap) ctx.push("LINT_SHIFT_CAPACITY", { shift: sh.label, need, cap }); }
      ctx.provide("busy_days", { people, use, busyOf }); // 構成の規則の入力チェックが使う（事実）
    }
    // 人ごと（夜勤に入れない人だけ。夜勤があると明けで勤務日が 2 日ずつ動き、見積もりが立たない）: 入れる日と、休みから決まる勤務日を比べる
    const forbid = (n, s) => P.state("composition") === "hard" && P.comp.some(c => c.max === 0 && P.compOn(c, s) && P.compMatch(c, n)); // 構成の規則で最大 0
    const ok = (n, s) => ctx.canWork(n, s) && !forbid(n, s);
    for (const n of P.dutyNames) { if (P.isExempt(n) || P.slots.some(s => s[1] === "night" && ok(n, s))) continue;
      const avail = []; for (let d = 1; d <= P.N; d++) if (P.slots.some(s => s[0] === d && ok(n, s))) avail.push(d);
      const need = Math.max(0, P.N - P.offTarget(n));
      if (avail.length < need) { ctx.push("LINT_PERSON_TOO_FEW_DAYS", { who: n, avail: avail.length, need }); continue; }
      if (avail.length === need && P.isHard("run_length_max") && P.runApplies(n)) { let run = 0, mx = 0, at = 0;
        for (let d = 1; d <= P.N; d++) { run = avail.includes(d) ? run + 1 : 0; if (run > mx) { mx = run; at = d - run + 1; } }
        if (mx > P.runMax) ctx.push("LINT_PERSON_FORCED_RUN", { who: n, len: mx, from: lab(at), max: P.runMax }); } }
  },
  python: false,
});

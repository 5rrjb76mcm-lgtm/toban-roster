// 規則のプラグイン: 指定した人の金曜夜勤の最低回数（friday_night_min）。docs/rule-modules.md
// 名簿の「金曜夜勤の最低回数」の欄で人ごとに回数を決める（rules.friday_night_min = {氏名: 回数}）。
T.rules.register({
  id: "friday_night_min", api: 1, order: 560, group: "basic",
  label: "指定した人の金曜夜勤を最低回数以上にする", states: ["hard", "soft", "off"], def: "hard",
  weight: "friday_night_missing", w0: 50, relax: "friday_night",
  read(P) { return { min: P.fridayMin }; }, // {氏名: 最低回数}（名簿の欄。model.js が読む）
  solve(ctx, prm) {
    const { LP, lp, P } = ctx, st = P.state("friday_night_min");
    for (const [n, k] of Object.entries(prm.min)) { if (!ctx.names.includes(n)) continue;
      const cnt = LP.sum(ctx.slots.filter(s => s[1] === "night" && P.dow(s[0]) === 4).map(s => ctx.work(s, n)));
      if (st === "hard") lp.add(cnt, ">=", +k);
      else { const v = lp.auxInt("frisc", 0, 31); lp.add(LP.sum([cnt, v]), ">=", +k); lp.objAdd(P.softW("friday_night_min"), v); } // 減点: 足りない回数
    }
  },
  check(ctx, prm) {
    for (const [n, k] of Object.entries(prm.min)) { if (!ctx.names.includes(n)) continue;
      let c = 0; for (let d = 1; d <= ctx.N; d++) if (ctx.P.dow(d) === 4 && ctx.worked(n, [d, "night"])) c++;
      ctx.limit("friday_night_min", c, ">=", +k, { code: "FRIDAY_NIGHT_SHORT", args: { who: n, count: c, min: k } });
    }
  },
  penalty(ctx, prm) {
    for (const [n, k] of Object.entries(prm.min)) if (ctx.names.includes(n))
      ctx.limit("friday_night_min", ctx.P.slots.filter(s => s[1] === "night" && ctx.P.dow(s[0]) === 4 && ctx.worked(n, s)).length, ">=", +k);
  },
  columns: [{ key: "fri", order: 10, label: "金曜夜勤の最低回数（月）",
    render(d, R) { const v = (R.friday_night_min || {})[d.name] || ""; return `<input type="number" min="0" data-f="fri" value="${v}" placeholder="0" style="width:3.5em" title="金曜夜勤の最低回数（月）。空欄＝指定なし">`; },
    begin() { return {}; }, read(td, d, R, acc, name) { const v = +td.querySelector("[data-f=fri]").value; if (v > 0) acc[name] = v; }, end(R, acc) { R.friday_night_min = acc; },
    rename(R, o, n) { const m = R.friday_night_min || {}; if (m[o] !== undefined) { m[n] = m[o]; delete m[o]; } } }],
  ui: { render(R, h) { return `<span class="note">${h.esc(h.tx("回数は名簿の「金曜夜勤の最低回数」の欄で人ごとに指定します。"))}</span>`; } },
  summary(P, prm, tv) { return tv("対象: {who}", { who: Object.entries(prm.min).filter(([n]) => P.doctors[n]).map(([n, k]) => `${n} ${k}`).join(T.listSep()) || tv("なし") }); },
  diagnoseHint: "      → 金曜夜勤（月1回以上）の{person}の金曜の不可日・土曜の外勤を見直す",
  messages: { FRIDAY_NIGHT_SHORT: { en: "{who}: {count} Friday nights (at least {min} a month was asked for)", ja: "{who}: 金曜夜勤{count}回（月{min}回以上の指定）" } },
  fixtures: [{ label: "金曜夜勤を減点、重み 1", base: "cardiology", states: { friday_night_min: "soft" }, unitWeights: true }],
  // 説明資料の第 9 節（調整目標の達成状況）の行
  report(ctx, prm) {
    const { P, t } = ctx; if (P.state("friday_night_min") !== "soft") return;
    const ng = []; for (const [n, k] of Object.entries(prm.min)) { if (!ctx.names.includes(n)) continue; let c = 0; for (let d = 1; d <= P.N; d++) if (P.dow(d) === 4 && ctx.worked(n, [d, "night"])) c++; if (c < +k) ng.push(`${n} ${c}/${k}`); }
    ctx.line(t("金曜夜勤の最低回数に足りない人（減点 friday_night_missing）: {who}", { who: ng.join(ctx.sep()) || t("なし") }));
  },
  // 入力チェック: 名簿にない人の指定、金曜夜勤に入れる枠が最低回数に足りない人
  lint(ctx, prm) {
    const { P } = ctx;
    for (const n of Object.keys(prm.min)) if (!P.dutyNames.includes(n)) ctx.push("LINT_FRIDAY_MIN_NOT_CANDIDATE", { who: n });
    if (P.isHard("friday_night_min")) for (const [n, k] of Object.entries(prm.min)) if (P.dutyNames.includes(n)) { const fr = P.slots.filter(s => s[1] === "night" && P.dow(s[0]) === 4 && ctx.canWork(n, s)); if (fr.length < +k) ctx.push("LINT_FRIDAY_TOO_FEW", { who: n, count: fr.length, min: k }); }
  },
  python: true,
});

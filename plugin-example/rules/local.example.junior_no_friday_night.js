// 施設のプラグインの例（規則）: 補助の役割（junior）の人を金曜の夜勤に入れない。
// 本体のプラグインと同じ形（docs/rule-modules.md）。id は local.<施設>.<名前>。解く側・検算・減点は別々に書く。
T.rules.register({
  id: "local.example.junior_no_friday_night", api: 1, order: 565, group: "basic",
  label: "補助の役割の人を金曜の夜勤に入れない（施設のプラグインの例）", states: ["hard", "soft", "off"], def: "off",
  weight: "local_example_junior_friday", w0: 10,
  // 解く側: 金曜夜勤の枠 × 補助の役割の人 について、勤務の変数 ≤ 0（必須なら制約、減点なら超過分に重み）
  solve(ctx) {
    const { P } = ctx;
    for (const n of ctx.names) { if (!P.isRole(n, "junior")) continue;
      for (const s of ctx.slots) if (s[1] === "night" && P.dow(s[0]) === 4) ctx.limit("local.example.junior_no_friday_night", ctx.work(s, n), "<=", 0, { aux: "exjf", ub: 1 }); }
  },
  // 検算: 必須のときに金曜夜勤へ入っていれば違反
  check(ctx) {
    const { P } = ctx;
    for (const n of ctx.names) if (P.isRole(n, "junior")) for (const s of P.slots)
      if (s[1] === "night" && P.dow(s[0]) === 4 && ctx.worked(n, s)) ctx.viol("LOCAL_EXAMPLE_JUNIOR_FRIDAY", { who: n, day: ctx.lab(s[0]) }, s[0], n, false); // 固定でも許容しない（解く側に fixed の例外が無いのと同じ）
  },
  // 減点の数え直し: 入った枠 1 つにつき重み
  penalty(ctx) {
    const { P } = ctx;
    for (const n of ctx.names) if (P.isRole(n, "junior")) for (const s of P.slots)
      if (s[1] === "night" && P.dow(s[0]) === 4) ctx.limit("local.example.junior_no_friday_night", ctx.worked(n, s) ? 1 : 0, "<=", 0);
  },
  summary(P, prm, tv) { return tv("対象: {who}", { who: P.dutyNames.filter(n => P.isRole(n, "junior")).join(T.listSep()) || tv("なし") }); },
  messages: {
    LOCAL_EXAMPLE_JUNIOR_FRIDAY: { en: "{who} ({junior}) is on the Friday night of {day}", ja: "{who}（{junior}）が {day} の金曜夜勤に入っている" },
  },
  // 説明資料の第 9 節: 減点にしたときの内訳
  report(ctx) {
    const { P, t } = ctx; if (P.state("local.example.junior_no_friday_night") !== "soft") return;
    const hit = []; for (const n of ctx.names) if (P.isRole(n, "junior")) for (const s of P.slots) if (s[1] === "night" && P.dow(s[0]) === 4 && ctx.worked(n, s)) hit.push(`${n} ${ctx.lab(s[0])}`);
    ctx.line(t("補助の役割の金曜夜勤（減点 local_example_junior_friday）: {items}", { items: hit.join(ctx.sep()) || t("なし") }));
  },
  // 減点の突き合わせ試験（test_penalty_node.js）に加える設定
  fixtures: [{ label: "施設のプラグインの例: 金曜夜勤を減点、重み 1", base: "cardiology", states: { "local.example.junior_no_friday_night": "soft" }, unitWeights: true }],
  python: false, // Python 版（凍結）はこの規則を知らない
});

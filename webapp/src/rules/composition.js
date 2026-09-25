// 規則のプラグイン: 勤務帯ごとの構成（composition）。枠ごとに、条件（何年目・資格）に合う人の人数の下限・上限。docs/rule-modules.md
// 条件の一覧は rules.composition（model.js が P.comp に整える。compMatch / compOn / compLabel も model.js）。
// 表の行の追加・削除（data-act="compAdd" / "compDel"）は ui.acts / ui.act で受ける（app-settings.js が呼ぶ）。
// 人数が合うかの入力チェック（LINT_COMPOSITION_*）は lint。勤務日の見積もり（事実 busy_days）は休みの日数のプラグインが出す。
T.rules.register({
  id: "composition", api: 1, order: 810, group: "team",
  label: "勤務帯ごとの構成（経験年数・資格ごとの人数。例: 夜勤に1〜2年目は1人まで、日勤にリーダー1人）", states: ["hard", "soft", "off"], def: "off",
  weight: "composition_miss", w0: 100, relax: "composition",
  columns: [{ key: "quals", at: "years", label: "資格", field: "quals",
    render(d, R, h) { const qn = T.qualNames(R), has = [].concat(d.quals || []);
      return qn.map(q => `<label style="margin-right:.5em;white-space:nowrap"><input type="checkbox" data-q="${h.esc(q)}" ${has.includes(q) ? "checked" : ""}>${h.esc(q)}</label>`).join("") + `<input data-f="quals" value="" placeholder="${h.esc(h.tx("ほかの資格"))}" style="width:6em">`; },
    read(td, d) { const qs = [...td.querySelectorAll("[data-q]")].filter(x => x.checked).map(x => x.dataset.q).concat(td.querySelector("[data-f=quals]").value.split(/[・,、\s]+/).filter(Boolean)); if (qs.length) d.quals = [...new Set(qs)]; else delete d.quals; } }],
  read(P) { return { list: P.comp }; },
  solve(ctx, prm) {
    const { LP, lp, P } = ctx, st = P.state("composition");
    for (const c of prm.list) {
      const who = ctx.names.filter(n => P.compMatch(c, n));
      for (const s of ctx.slots) { if (!P.compOn(c, s)) continue;
        const cnt = LP.sum(who.map(n => ctx.work(s, n)));
        if (st === "hard") { if (c.min != null) lp.add(cnt, ">=", c.min); if (c.max != null) lp.add(cnt, "<=", Math.max(c.max, who.filter(n => P.isFixedWork(s, n)).length)); continue; } // 上限は、固定した人の分だけは許す（固定しない限り入らない、の意味になる）
        if (c.min != null) { const v = lp.auxInt("cmpl", 0, 50); lp.add(LP.sum([cnt, v]), ">=", c.min); lp.objAdd(P.softW("composition"), v); } // 減点: 足りない人数
        if (c.max != null) { const v = lp.auxInt("cmpu", 0, 50); lp.add(LP.sub(cnt, v), "<=", c.max); lp.objAdd(P.softW("composition"), v); } // 減点: 多すぎる人数
      } }
  },
  check(ctx, prm) {
    const { P } = ctx;
    for (const c of prm.list) for (const s of P.slots) { if (!P.compOn(c, s)) continue;
      const got = ctx.A.workers(s).filter(n => P.compMatch(c, n)).length;
      if (c.min != null && got < c.min) ctx.viol("COMPOSITION_SHORT", { slot: ctx.slab(s), cond: P.compLabel(c), got, min: c.min });
      if (c.max != null && got > c.max) { const fx = ctx.A.workers(s).filter(n => P.compMatch(c, n) && P.isFixedWork(s, n)); // 固定した人の分で超えた分は「固定指定により許容」
        ctx.viol("COMPOSITION_OVER", { slot: ctx.slab(s), cond: P.compLabel(c), got, max: c.max }, got <= Math.max(c.max, fx.length) ? s[0] : null, got <= Math.max(c.max, fx.length) ? fx : []); } }
  },
  penalty(ctx, prm) {
    const { P, pos } = ctx;
    for (const c of prm.list) for (const s of P.slots) { if (!P.compOn(c, s)) continue;
      const got = ctx.A.workers(s).filter(n => P.compMatch(c, n)).length;
      ctx.add("composition_miss", P.softW("composition"), (c.min != null ? pos(c.min - got) : 0) + (c.max != null ? pos(got - c.max) : 0)); }
  },
  ui: {
    acts: { compAdd: "構成の条件を追加", compDel: "構成の条件を削除" }, // 表のボタン（data-act）と、戻るための操作名
    act(R, act, btn) { const rows = [].concat(R.composition || []); if (act === "compAdd") rows.push({ shift: "night", min: 1 }); else rows.splice(+btn.closest("tr").dataset.ci, 1); R.composition = rows; },
    render(R, h) {
      const { esc, tx, sel } = h, rows = [].concat(R.composition || []), sh = [["all", tx("すべての勤務帯")], ...h.shifts];
      const dy = [["all", tx("すべての日")], ["weekdays", tx("平日だけ")], ["off_days", tx("土日祝だけ")]].concat((T.dayFlags ? T.dayFlags.activeFor(R) : []).map(f => [`flag:${f.id}`, tx("「{f}」の日", { f: T.pickLabel ? T.pickLabel(f.short || f.label, f.id) : f.label })])); // 日ごとの区分が付いた日
      return `<table class="grid" id="compTbl"><tr><th>${esc(tx("勤務帯"))}</th><th>${esc(tx("日"))}</th><th>${esc(tx("名前"))}</th><th>${esc(tx("何年目以上"))}</th><th>${esc(tx("何年目以下"))}</th><th>${esc(tx("資格あり"))}</th><th>${esc(tx("資格なし"))}</th><th>${esc(tx("最低（人）"))}</th><th>${esc(tx("最大（人）"))}</th><th></th></tr>` +
        rows.map((c, i) => `<tr data-ci="${i}"><td>${sel(sh, c.shift || "all", "data-cshift")}</td><td>${sel(dy, c.days || "all", "data-cdays")}</td><td><input data-clabel value="${esc(c.label || "")}" style="width:9em"></td>` +
          ["years_min", "years_max"].map(k => `<td><input type="number" min="0" data-c${k === "years_min" ? "ymin" : "ymax"} value="${c[k] ?? ""}" style="width:4em"></td>`).join("") +
          `<td><input data-cqual value="${esc(c.qual || "")}" style="width:6em"></td><td><input data-cnot value="${esc(c.not_qual || "")}" style="width:6em"></td>` +
          `<td><input type="number" min="0" data-cmin value="${c.min ?? ""}" style="width:4em"></td><td><input type="number" min="0" data-cmax value="${c.max ?? ""}" style="width:4em"></td>` +
          `<td><button data-act="compDel">${esc(tx("削除"))}</button></td></tr>`).join("") + `</table>
<p><button data-act="compAdd">${esc(tx("構成の条件を追加"))}</button> <span class="note">${esc(tx("枠ごとに、条件に合う人が何人いるかの下限・上限です。空欄の条件は問いません。何年目は名簿の「何年目」、資格は名簿の「資格」と照らします。資格を「・」で区切ると「どれか 1 つを持つ人」です。例: 夜勤に若手は1人まで（資格あり 若手・最大 1）。管理者とは別にリーダーを 1 人置くなら「管理者 1 人以上」と「管理者・リーダー 2 人以上」。ここに書いた資格は名簿の資格の欄にチェックボックスで出ます。"))}</span></p>`;
    },
    read(R, el) {
      if (!el("#compTbl")) return;
      const rows = [];
      for (const tr of el("#compTbl").querySelectorAll("tr[data-ci]")) { const g = k => tr.querySelector(`[data-${k}]`).value.trim(), num = k => g(k) === "" ? undefined : Math.max(0, +g(k) || 0);
        const c = { shift: g("cshift") }; if (g("cdays") !== "all") c.days = g("cdays"); if (g("clabel")) c.label = g("clabel");
        for (const [k, f] of [["years_min", "cymin"], ["years_max", "cymax"], ["min", "cmin"], ["max", "cmax"]]) if (num(f) !== undefined) c[k] = num(f);
        if (g("cqual")) c.qual = g("cqual"); if (g("cnot")) c.not_qual = g("cnot");
        rows.push(c); }
      R.composition = rows;
    },
  },
  summary(P, prm, tv) {
    const sep = T.listSep();
    return prm.list.map(c => (c.days === "all" ? "" : /^flag:/.test(c.days) ? tv("「{f}」の日の", { f: ((T.dayFlags && T.dayFlags.labelOf(P.rules, c.days.slice(5))) || c.days.slice(5)) }) : tv(c.days === "weekdays" ? "平日の" : "土日祝の")) + tv("{shift}の{cond}", { shift: c.shift === "all" ? tv("各勤務帯") : P.shiftLabel(c.shift), cond: P.compLabel(c) }) +
      (c.min != null && c.max != null && c.min === c.max ? tv("はちょうど {n} 人", { n: c.min }) : (c.min != null ? tv(" {n} 人以上", { n: c.min }) : "") + (c.max != null ? tv(" {n} 人まで", { n: c.max }) : ""))).join(sep) || tv("（条件がありません）");
  },
  messages: {
    COMPOSITION_SHORT: { en: "{slot}: {got} of \"{cond}\" (at least {min} needed)", ja: "{slot}: 「{cond}」が {got} 人（{min} 人以上が必要）" },
    COMPOSITION_OVER: { en: "{slot}: {got} of \"{cond}\" (at most {max})", ja: "{slot}: 「{cond}」が {got} 人（{max} 人まで）" },
  },
  fixtures: [{ label: "構成を減点、重み 1", base: "nurse-2shift", states: { composition: "soft" }, unitWeights: true }],
  // 入力チェック: 構成の最低人数を、条件に合う人の数と勤務日で満たせるか
  lint(ctx, prm) {
    const { P } = ctx; if (P.state("composition") !== "hard" || !("busy_days" in ctx.facts)) return; // 勤務日の見積もりは休みの日数のプラグインが出す（事実 busy_days）
    const { people, use, busyOf } = ctx.use("busy_days");
    for (const c of prm.list) { if (!c.min) continue;
      const who = people.filter(n => P.compMatch(c, n)), ss = P.slots.filter(s => P.compOn(c, s)); if (!ss.length) continue;
      const shiftName = c.shift === "all" ? T.t("各勤務帯") : P.shiftLabel(c.shift);
      if (who.length < c.min) { ctx.push("LINT_COMPOSITION_TOO_FEW_PEOPLE", { cond: P.compLabel(c), shift: shiftName, min: c.min, have: who.length }); continue; }
      const need = ss.reduce((a, s) => a + c.min * use(s), 0), cap = who.reduce((a, n) => a + busyOf(n), 0);
      if (need > cap) ctx.push("LINT_COMPOSITION_CAPACITY", { cond: P.compLabel(c), shift: shiftName, need, cap, who: who.length }); }
  },
  python: false,
});

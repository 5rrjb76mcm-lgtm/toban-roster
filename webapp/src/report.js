// 当直表アプリ: 結果の表示（HTML）。toban.py の report に対応
(function (T) {
  const esc = T.esc; // HTML エスケープ（model.js で共通定義）
  const table = (hdr, rows, cls = "") => `<table class="rep ${cls}"><thead><tr>${hdr.map(h => `<th>${esc(h)}</th>`).join("")}</tr></thead><tbody>${rows.map(r => `<tr>${r.map(c => `<td>${c}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
  const join = (a, sep = null) => (a || []).join(sep == null ? T.nameSep() : sep);

  // sections: [{id, title, html}]
  function buildReport(P, asg, info = {}) {
    const { V, W = [], charge, A } = T.check(P, asg);
    const met = T.metrics(P, A);
    const Tm = P.team, S = [];
    const L = s2 => P.term(T.t(s2)); // 表示言語に訳してから、文面の {charge} などを施設の役割名に置き換える
    const tx = s2 => T.t(s2);
    const tv = (s2, vars) => T.t(s2, vars); // 差し込みのある文（{name} をその言語の文面に入れる）
    const nHol = [...Array(P.N)].filter((_, i) => P.isHoliday(i + 1)).length;
    const byShift = P.shifts.map(sh => tv("{shift} {n}", { shift: sh.label, n: P.slots.filter(x => x[1] === sh.id).length })).join(T.listSep());
    const head = [
      tv("対象月 {y}年{m}月　{status}", { y: P.year, m: P.month,
        status: info.status ? tv("ソルバー状態 {st}{sec}", { st: esc(info.status), sec: info.seconds != null ? tv("（{s}秒）", { s: info.seconds.toFixed(1) }) : "" }) : tx("検算") }),
      tv("必要枠: {detail}、計{total}枠。目安合計 {quota}", { detail: byShift, total: P.slots.length, quota: P.dutyNames.reduce((a, n) => a + P.quota(n), 0) }),
    ];
    const summary = (T.rulesSummary(P) || []).map(g => `<h4>${esc(g.head)}</h4><ul>${g.items.map(i => `<li>${esc(i)}</li>`).join("")}</ul>`).join("");
    S.push({ id: "s0", title: tx("概要"), html: `<ul>${head.map(h => `<li>${h}</li>`).join("")}</ul>`
      + `<details><summary>${esc(tx("この月に使った規則（設定から作った要約）"))}</summary>${summary}</details>` });
    // 1 検算
    S.push({ id: "s1", title: tx("1 必須条件の検算"), html: (V.length ? `<p class="ng"><b>${esc(tv("違反 {n} 件", { n: V.length }))}</b></p><ul>${V.map(v => `<li>${esc(v)}</li>`).join("")}</ul>` : `<p class="ok">${esc(tx("違反なし（必須にしたすべての規則を満たしています）"))}</p>`) + (W.length ? `<p><b>${esc(tv("固定指定により許容した条件 {n} 件（要確認。固定指定を優先し、次の条件は満たしていません）", { n: W.length }))}</b></p><ul>${W.map(v => `<li>${esc(v)}</li>`).join("")}</ul>` : "") });
    // 2 当直表
    const rows2 = [];
    for (let d = 1; d <= P.N; d++) {
      // 不可申告: 日勤帯＝「日勤帯」または「日夜両方」、夜勤＝「夜勤」または「日夜両方」（日夜両方は両方の列に出す）
      const partsOf = n => (P.unavailOther[n] || []).filter(([dd]) => dd === d).map(([, pp]) => pp);
      const unDay = P.dutyNames.filter(n => partsOf(n).some(pp => pp === "day" || pp === "allday")).join("・");
      const unNight = P.dutyNames.filter(n => (P.unavailNight[n] || new Set()).has(d) || partsOf(n).includes("allday")).join("・");
      const avoidTxt = P.dutyNames.filter(n => (P.avoid[n] || []).some(([dd]) => dd === d)).map(n => { const ps = [...new Set((P.avoid[n] || []).filter(([dd]) => dd === d).map(([, pp]) => P.msg(pp === "allday" ? "AVOID_MARK_ALL" : pp === "day" ? "AVOID_MARK_DAY" : "AVOID_MARK_NIGHT")))]; return `${n}(${ps.join("")})`; }).join("・");
      const cls = P.isHoliday(d) ? (P.dow(d) === 5 && !P.holidaysExtra.has(d) ? "sat" : "sun") : "";
      // 最小変更で直したときは、前回の版と違う枠を赤字にする（info.baseAsg）
      const B = info.baseAsg || null; const bw = s => (B && B[`${s[0]}:${s[1]}`] ? (B[`${s[0]}:${s[1]}`].work || "") : ""), bo = s => (B && B[`${s[0]}:${s[1]}`] ? [...(B[`${s[0]}:${s[1]}`].oc || [])].sort().join("・") : "");
      const cw = s => { const t = esc(A.workers(s).map(n => P.nameWithTag(s, n)).join("・")); return B && A.workText(s) !== [].concat(bw(s) || []).join("・") ? `<span class="chg">${t}</span>` : t; }; // 固定の印（研修など）は名前の後ろ
      const co = s => { const t = esc(join(A.oc(s))); return B && [...A.oc(s)].sort().join("・") !== bo(s) ? `<span class="chg">${t}</span>` : t; };
      const dayCell = P.slotExists(d, "day") ? [cw([d, "day"]), co([d, "day"])] : ["―", "―"]; // 日勤枠がある日だけ（勤務帯の設定による）
      rows2.push([P.isHoliday(d) ? `<span class="${cls}">${esc(P.label(d))}</span>` : esc(P.label(d)), ...dayCell, cw([d, "night"]), co([d, "night"]), esc(unDay), esc(unNight), esc(avoidTxt)]);
    }
    S.push({ id: "s2", title: tx("2 勤務表"), html: (info.baseAsg ? `<p class="note"><span class="chg">${esc(tx("赤字"))}</span>${esc(tx("＝最小変更で直す前の版から変わった枠"))}</p>` : "") + table(["日付", "日勤", "日勤OC", "夜勤", "夜間OC", "不可申告（日勤帯）", "不可申告（夜勤）", "できれば避けたい（両=日夜両方 日=日勤帯 夜=夜勤）"].map(tx), rows2, "roster") });
    // 3 個人別集計
    const order = P.nameOrder; // 名簿にない名前は除き、表示順に無い候補は末尾（model.js）
    const rows3 = order.map(n => { const m = met[n]; return [esc(n), m.quota, m.target, m.day, m.night, m.total, m.dayoc, m.nightoc, m.ndays, m.hdays, `${m.weekends}${m.weekendsCrossing ? tv("（うち月またぎ{n}）", { n: m.weekendsCrossing }) : ""}`, m.dual, m.rest.length]; });
    const rows3b = order.map(n => [esc(n), esc(met[n].days.map(d => `${P.month}/${d}`).join(T.listSep()))]);
    S.push({ id: "s3", title: tx("3 個人別集計（第9節）"), html: table(["{person}", "目安", "当月目標", "日勤", "夜勤", "計", "日勤OC", "夜間OC", "当番開始日数", "休日当番日数", "当番のある週末数", "同日兼務日数", "週休日発生数"].map(tx), rows3, "num") + `<h4>${esc(tx("当番開始日"))}</h4>` + table(["{person}", "当番開始日"].map(tx), rows3b) });
    // 4 週末・祝日の期間責任者
    const rows4 = P.periods.map(p => { const kind = tx(p.kind === "weekend" && p.full ? "完全な土日" : p.kind === "weekend" ? "月またぎ土日" : "祝日"); const cd = charge[p.id]; const ds = p.slots.filter(s => s[1] === "day" && A.work(s) === cd[s[0]]).map(s => `${P.month}/${s[0]}`).join(T.listSep()); return [esc(p.name), kind, esc(T.chargeLabel(P, p, cd)), esc(ds || tx("なし"))]; });
    const fw = T.fullWeekendUnits(P, charge), fv = Object.values(fw);
    const allw = {}; for (const n of P.I) allw[n] = fw[n] + 2 * P.periods.filter(p => p.kind === "weekend" && !p.full && Object.values(charge[p.id]).includes(n)).length;
    const hc = {}; for (const n of P.I) hc[n] = P.periods.filter(p => p.kind === "holiday" && Object.values(charge[p.id]).includes(n)).length;
    const splits = P.periods.filter(p => p.kind === "weekend" && p.full && new Set(Object.values(charge[p.id]).filter(Boolean)).size > 1).map(p => p.name);
    const wps = P.periods.filter(p => p.kind === "weekend");
    const prevC = (wps.length && wps[0].crossing && wps[0].prevDays.length) ? P.prevPrevWeekendCharge : P.prevLastWeekendCharge;
    const seq = [[prevC ? new Set([prevC]) : new Set(), tx("前月")]].concat(wps.map(p => [new Set(Object.values(charge[p.id]).filter(Boolean)), p.name]));
    const cons = []; for (let i = 0; i + 1 < seq.length; i++) { const both = [...seq[i][0]].filter(x => seq[i + 1][0].has(x)); if (both.length) cons.push(`${seq[i][1]}→${seq[i + 1][1]} ${both.join("・")}`); }
    const hist = {}; for (const n of P.I) hist[n] = 2 * (P.histWeekend[n] || 0) + allw[n];
    S.push({ id: "s4", title: L("4 週末・祝日の{charge}担当"), html: table(["期間", "区分"].map(tx).concat([L("{charge}担当"), tx("日勤")]), rows4) + `<ul>
<li>${esc(tv("完全な土日の担当（組。分割は0.5）: {v}（最多−最少 {diff}、許容差 {max}）", { v: T.fmtHalf(fw), diff: fv.length ? (Math.max(...fv) - Math.min(...fv)) / 2 : 0, max: P.weekendMaxDiff }))}</li>
<li>${esc(tv("分割した土日: {v}（分割は減点 {w}。均等配分に必要なときだけ使われる）", { v: splits.join(T.listSep()) || tx("なし"), w: P.weights?.split_weekend ?? 60 }))}</li>
<li>${esc(tv("月またぎを含む土日担当（土曜日の日付で1組）: {v}", { v: T.fmtHalf(allw) }))}</li>
<li>${esc(tv("前月までの履歴込み: {v}（履歴 {h}）", { v: T.fmtHalf(hist), h: T.fmt(P.histWeekend) }))}</li>
<li>${esc(tv("祝日の担当: {v}（履歴 {h}）", { v: T.fmt(hc), h: T.fmt(P.histHoliday) }))}</li>
<li>${esc(tv("連続する週末担当: {v}", { v: cons.join(T.listSep()) || tx("なし") }))}</li></ul>` });
    // 5 同日集約
    const rows5 = [];
    for (let d = 1; d <= P.N; d++) {
      if (!P.isHoliday(d)) continue;
      const wd = A.work([d, "day"]), wn = A.work([d, "night"]), td = Tm[wd], tn = Tm[wn];
      let res;
      const yoc = s => A.oc(s).filter(x => P.isRole(x, "junior")).join(T.nameSep());
      if (tn === P.refId("junior") && [P.refId("charge"), P.refId("other")].includes(td)) res = A.oc([d, "day"]).includes(wn) ? L(tv("夜勤の{who}が日勤帯の{junior}OC（適用）", { who: wn })) : L(tv("別担当（日勤帯の{junior}OC={oc}）", { oc: yoc([d, "day"]) || "―" }));
      else if (td === P.refId("junior") && [P.refId("charge"), P.refId("other")].includes(tn)) res = A.oc([d, "night"]).includes(wd) ? L(tv("日勤の{who}が夜間の{junior}OC（適用）", { who: wd })) : L(tv("別担当（夜間の{junior}OC={oc}）", { oc: yoc([d, "night"]) || "―" }));
      else if (td === P.refId("other") && tn === P.refId("other")) res = L(tv("{junior}OCを日勤・夜間に各1名（{a} / {b}）", { a: yoc([d, "day"]) || "―", b: yoc([d, "night"]) || "―" }));
      else if (td === P.refId("junior") && tn === P.refId("junior")) res = L("{junior}OC不要（{charge}OCのみ）");
      else res = tx("対象外");
      rows5.push([esc(P.label(d)), `${esc(wd)}（${esc(P.roleLabel(td))}）`, `${esc(wn)}（${esc(P.roleLabel(tn))}）`, `${esc(P.roleLabel(td))}+${esc(P.roleLabel(tn))}`, esc(res)]);
    }
    S.push({ id: "s5", title: tx("5 同日集約の対象一覧（全土日祝、昼夜両方向）"), html: table(["日付", "日勤者", "夜勤者", "組合せ", "適用結果"].map(tx), rows5) });
    // 6 週休日
    let s6 = table(["{person}", "週休日発生数", "対象勤務日", "外勤あり"].map(tx), order.map(n => [esc(n), met[n].rest.length, esc(met[n].rest.join(T.listSep()) || "―"), P.hasExternal(n) ? "○" : ""]));
    // 月の休みの日数と 2 連休（規則 days_off_min / days_off_pair を使う施設だけ）
    if (P.state("days_off_min") !== "off" || P.state("days_off_pair") !== "off") {
      const worked = (n, d) => ["day", "night"].some(k => A.worked(n, [d, k]));
      const rows = order.map(n => {
        const off = []; for (let d = 1; d <= P.N; d++) if (!worked(n, d)) off.push(d);
        const st = new Set(off); let pr = 0; for (let d = 1; d + 1 <= P.N; d++) if (st.has(d) && st.has(d + 1)) pr++;
        const ngO = P.state("days_off_min") !== "off" && off.length < P.minDaysOff, ngP = P.state("days_off_pair") !== "off" && pr < P.pairMin;
        return [esc(n), ngO ? `<b class="ng">${off.length}</b>` : off.length, ngP ? `<b class="ng">${pr}</b>` : pr];
      });
      const note = T.t("暦 {N} 日。最低の休み {min} 日", { N: P.N, min: P.minDaysOff })
        + (P.state("days_off_pair") !== "off" ? T.t("、2 連休は最低 {pair} 回", { pair: P.pairMin }) : "")
        + T.t("（勤務の枠に入らない日を休みとして数える。日中の業務は見ない）");
      s6 += `<h4>${esc(tx("月の休みの日数と 2 連休"))}</h4><p class="note">${esc(note)}</p>` +
        table(["{person}", "休みの日数", "2 連休の回数"].map(tx), rows, "num");
    }
    S.push({ id: "s6", title: tx("6 週休日（第8節: 休日の日勤＋休日前日の夜勤）"), html: s6 });
    // 7 定期業務との重なり
    const rows7 = [];
    for (const n of P.dutyNames) for (let d = 1; d <= P.N; d++) {
      const nd = d + 1;
      const its = [...new Set(["am", "pm"].flatMap(h => P.dutyItems(n, nd, h).map(i => tv("{half}{kind}", { half: tx(h === "am" ? "午前" : "午後"), kind: T.kindLabel(i.kind) }))))];
      if (!its.length) continue;
      if (A.oc([d, "night"]).includes(n)) rows7.push([`${esc(P.label(d))} ${esc(tx("夜間OC"))}`, esc(n), esc(tv("翌{day} {items}", { day: P.label(nd), items: its.join(T.nameSep()) }))]);
      if (A.worked(n, [d, "night"])) rows7.push([`${esc(P.label(d))} ${esc(P.shiftLabel("night"))}`, esc(n), esc(tv("翌{day} {items}（午前のみ）", { day: P.label(nd), items: its.join(T.nameSep()) }))]);
    }
    // 午後外勤日の全件（同日の夜勤・夜間OCの有無と「間に合う」確認の登録）
    for (const n of P.dutyNames) for (let d = 1; d <= P.N; d++) if (P.busy(n, d, "pm", ["external"])) {
      const ok = tx(P.confirmedPmExtNight.has(`${d}:${n}`) ? "（間に合う確認あり）" : "（未確認）");
      const st = A.worked(n, [d, "night"]) ? tx("同日夜勤") + ok : A.oc([d, "night"]).includes(n) ? tx("同日夜間OC") + ok : A.oc([d, "day"]).includes(n) ? tx("同日日勤OC（禁止）") : tx("同日の夜勤・OCなし");
      rows7.push([`${esc(P.label(d))} ${esc(tx("午後外勤"))}`, esc(n), esc(st)]);
    }
    S.push({ id: "s7", title: tx("7 定期業務との重なり（残る負担・午後外勤日の全件）"), html: rows7.length ? table(["担当", "{person}", "翌日の業務／当日の扱い"].map(tx), rows7) : `<p>${esc(tx("なし"))}</p>` });
    // 8 日中の専門業務
    const rows8 = T.cathTable(P, A).map(r => [esc(r.label.split(" ")[0]), esc(r.label.split(" ")[1]), r.needA, esc(join(r.okA)), esc(join(r.exA, T.listSep())), esc(join(r.okI)), esc(join(r.exI, T.listSep())), r.clinic ? `${esc(join(r.clinic.okC))} / ${esc(join(r.clinic.okY))}` : "", r.ng.length ? `<b class="ng">${esc(tx("不足"))}: ${esc(r.ng.map(x => P.msg(x.code, x.args)).join("; "))}</b>` : (r.offA && r.offI) ? tx("配置不要（設定）") : r.offA ? L("{other}は配置不要（設定）") : r.offI ? L("{charge}は配置不要（設定）") : r.postUsed ? tx("充足（夜勤明けを含む・減点）") : tx("充足")]);
    S.push({ id: "s8", title: tx("8 日中の専門業務の時間帯別配置（平日）"), html: `<p class="note">${esc(tx("候補＝資格者から外来・病棟番・外勤・不在・不可を除いた人。夜勤明けは午前だけ候補に含める（夜勤明けを数えて初めて足りる時間帯は減点）。午後は除外。* は前夜の夜間OC。実際の配置は当月条件で確定させる。"))}</p>` + table([tx("日付"), tx("時間帯"), L("{other} 必要"), L("{other} 候補"), L("{other} 除外"), L("{charge} 候補"), L("{charge} 除外"), L("専門外来 候補（{other} / {junior}）"), tx("判定")], rows8) });
    // 9 調整目標。行は規則のプラグイン（def.report）が出す。本体はオンコール（待機）の行だけ
    const soft = [];
    const rctx = T.rules.checkCtx(P, A, "report", x => soft.push(x), { avoidRef: info.avoidRef });
    T.rules.runReport(rctx);
    { const jr = P.refId("junior"); const my = !jr ? [] : P.slots.filter(s => !A.oc(s).some(n => P.isRole(n, "junior")) && +((P.ocReqAt(s)[Tm[A.work(s)]] || {})[jr] || 0) > 0).map(s => `${P.label(s[0])}${P.shiftLabel(s[1])}（${A.work(s)}${P.ocNone(s, jr) ? L("。固定で{junior}OCなし") : ""}）`); soft.push(L(tv("{junior}OCを置かなかった枠（減点 missing_young_oc）: {slots}", { slots: my.join(T.listSep()) || tx("なし") }))); }
    S.push({ id: "s9", title: tx("9 調整目標の達成状況"), html: `<ul>${(soft.length ? soft : [tx("特記なし")]).map(x => `<li>${esc(x)}</li>`).join("")}</ul>` });
    // 10 月末
    const l10 = [];
    for (let d = Math.max(1, P.N - 1); d <= P.N; d++) l10.push(`${P.label(d)}: ` + P.shifts.filter(sh => P.slotExists(d, sh.id)).map(sh => tv("{shift} {who}（OC {oc}）", { shift: sh.label, who: A.workText([d, sh.id]), oc: join(A.oc([d, sh.id])) || "―" })).join(T.listSep()));
    const last = P.periods[P.periods.length - 1];
    if (last && last.kind === "weekend" && last.crossing && !last.prevDays.length) l10.push(L(`月またぎの土日 ${last.name}: {charge}担当 ${T.chargeLabel(P, last, charge[last.id])}（翌月1日へ接続）`));
    { const nx = P.dutyNames.map(n => { const its = [...new Set(["am", "pm"].flatMap(h => P.dutyItems(n, P.N + 1, h).map(i => tv("{half}{kind}", { half: tx(h === "am" ? "午前" : "午後"), kind: T.kindLabel(i.kind) }))))]; return its.length ? `${n} ${its.join(T.nameSep())}` : null; }).filter(Boolean);
      l10.push(tv("翌月1日 {day} の定期業務（{person}別カレンダーの翌月1日欄。{last} の夜勤・夜間OCの翌日制約に適用）: {items}。翌月条件が確定したら再確認", { day: P.nextLabel(), last: `${P.month}/${P.N}`, items: nx.length ? nx.join(T.listSep()) : tx("なし") }));
      if (P.nextFixedAny()) { const x = P.nextFixed, fx = []; if (x.day) fx.push(`${P.shiftLabel("day")} ${x.day}`); if (x.day_oc.length) fx.push(`${tx("日勤OC")} ${x.day_oc.join(T.nameSep())}`); if (x.night) fx.push(`${P.shiftLabel("night")} ${x.night}`); if (x.night_oc.length) fx.push(`${tx("夜間OC")} ${x.night_oc.join(T.nameSep())}`); if (x.charge) fx.push(L(`{charge}担当 ${x.charge}`)); l10.push(tv("翌月1日 {day} の固定指定: {items}（{last} との連続禁止と月またぎの接続に適用。翌月作成時に1日の固定として引き継ぐ）", { day: P.nextLabel(), items: fx.join(T.listSep()), last: `${P.month}/${P.N}` })); } }
    S.push({ id: "s10", title: tx("10 月末の接続（翌月へ）"), html: `<ul>${l10.map(x => `<li>${esc(x)}</li>`).join("")}</ul>` });
    return { sections: S, V, W, charge, A, met };
  }

  // 説明資料の完成形（単独で開ける HTML）。第 11・12 節は作成責任者が記入する欄と、月の備考
  function reportHtml(P, asg, info = {}, opts = {}) {
    const rep = buildReport(P, asg, info), lab = opts.label || T.t("確認版");
    return `<!DOCTYPE html><html lang="${T.lang()}"><head><meta charset="utf-8"><title>${esc(T.t("{y}年{m}月 勤務表 説明資料", { y: P.year, m: P.month }))}</title><style>${T.CSS || ""}</style></head><body class="standalone"><h1>${esc(T.t("{y}年{m}月 勤務表 説明資料（{label}）", { y: P.year, m: P.month, label: lab }))}</h1>${rep.sections.map(s => `<section><h3>${esc(s.title)}</h3>${s.html}</section>`).join("")}<section><h3>${esc(T.t("11 割当根拠と変更説明"))}</h3><p>${esc(T.t("（作成責任者が記入）"))}</p></section><section><h3>${esc(T.t("12 作成責任者への確認事項"))}</h3><pre>${esc(opts.notes || "")}</pre></section></body></html>`;
  }
  T.buildReport = buildReport; T.reportHtml = reportHtml; T.esc = esc;
})(globalThis.T = globalThis.T || {});

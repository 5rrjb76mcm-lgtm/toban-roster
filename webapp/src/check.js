// 当直表アプリ: 割当の検算（必須条件）と集計。toban.py の check / cath_table / rest_days / metrics に対応
(function (T) {
  const { Problem, DOW, DOW_JA } = T;
  const key = Problem.key;

  class Asg {
    constructor(P, asg) {
      this.P = P; this.a = {};
      for (const [k, v] of Object.entries(P.prevFixed)) this.a[k] = { work: v.work, oc: [...v.oc] };
      for (const [k, v] of Object.entries(asg)) this.a[k] = { work: v.work, oc: [...(v.oc || [])] };
    }
    // 勤務者は 1 名なら文字列、複数名なら配列で入る（1 枠 1 名の施設では保存形が変わらない）
    workers(s) { const w = (this.a[key(s)] || {}).work; return w == null || w === "" ? [] : (Array.isArray(w) ? w.filter(Boolean) : [w]); }
    work(s) { const w = this.workers(s); return w.length ? w[0] : null; } // 1 名の枠での取り出し（表示・1名前提の判定）
    workText(s) { return this.workers(s).join("・"); } // 表示用（複数名は・でつなぐ）
    oc(s) { return (this.a[key(s)] || {}).oc || []; }
    engaged(s) { const v = this.a[key(s)]; if (!v) return new Set(); const e = new Set(v.oc); for (const w of this.workers(s)) e.add(w); return e; }
    worked(n, s) { return this.workers(s).includes(n); }
    eng(n, s) { return this.engaged(s).has(n); }
  }

  const fmt = d => Object.entries(d).map(([k, v]) => `${k}${v}`).join("、");
  const fmtHalf = d => Object.entries(d).map(([k, v]) => `${k}${v / 2}`).join("、");
  function fullWeekendUnits(P, charge) {
    const out = {}; for (const n of P.I) out[n] = 0;
    for (const p of P.periods) if (p.kind === "weekend" && p.full) for (const d of p.days) if (P.I.includes(charge[p.id][d])) out[charge[p.id][d]]++;
    return out;
  }
  function chargeLabel(P, p, cd) {
    const vals = p.days.map(d => cd[d]);
    if (new Set(vals).size === 1) return vals[0] || "―";
    return p.days.map(d => `${T.dowLabel(P.dow(d))} ${cd[d]}`).join("／") + T.t("（分割）");
  }

  function check(P, asg) {
    const A = new Asg(P, asg), V = [], VC = [], VD = [], Tm = P.team, names = P.dutyNames, lab = d => P.label(d);
    // 違反は「種類（code）＋差し込む値（args）」で積み、文面はその言語で組み立てる（messages.js）。
    // VD は関わる日・医師で、固定指定による許容の判定に使う
    const viol = (code, args = {}, days = null, ns = [], fixed) => { // fixed: プラグインが判定した「固定指定が絡む」（true/false）。省略時は本体が days・names と固定指定の集合で判定する
      V.push(P.msg(code, args)); VC.push({ code, args });
      VD.push({ days: days == null ? [] : [].concat(days), names: [].concat(ns), fixed: fixed === undefined ? undefined : !!fixed });
    };
    const slab = s => `${lab(s[0])}${P.shiftLabel(s[1])}`;
    // 1 充足とチーム構成
    for (const s of P.slots) {
      const ws = A.workers(s), cnt = P.countOf(s), lo = P.countMinOf(s);
      if (ws.length > cnt || ws.length < lo) { viol("SLOT_WORKER_COUNT", { slot: slab(s), got: ws.length, need: lo === cnt ? cnt : `${lo}〜${cnt}`, who: ws.length ? "＝" + ws.join("・") : "" }); continue; }
      if (new Set(ws).size !== ws.length) viol("SLOT_WORKER_DUP", { slot: slab(s), who: ws.join("・") });
      const bad = ws.filter(n => !names.includes(n));
      if (bad.length) { viol("SLOT_WORKER_UNKNOWN", { slot: slab(s), who: bad.join("・") }); continue; }
      if (cnt !== 1) { // 複数名の枠ではチーム構成（OC）と期間責任者は使わない（Problem が設定を拒否する）
        for (const n of A.oc(s)) if (n) viol("SLOT_OC_ON_MULTI", { slot: slab(s), who: n });
        continue;
      }
      const w = ws[0];
      const ocs = A.oc(s), need = P.ocReqAt(s)[Tm[w]] || {}, jr = P.refId("junior");
      const ocCnt = {}; for (const sid of P.standbyRoleIds) ocCnt[sid] = ocs.filter(n => Tm[n] === sid).length;
      const total = Object.values(ocCnt).reduce((a, b) => a + b, 0);
      // 「対になる役割」の勤務で補助の役割のOCが置けないのは必須違反ではなく減点（結果の第9節に出す）。固定「若手OCなし」の枠も同様
      const youngMissAllowed = jr && (P.isRole(w, "other") || P.ocNone(s, jr)) && ocCnt[jr] === 0 &&
        P.standbyRoleIds.every(sid => sid === jr || ocCnt[sid] === +(need[sid] || 0)) && ocs.length === total;
      if (!youngMissAllowed && (P.standbyRoleIds.some(sid => ocCnt[sid] !== +(need[sid] || 0)) || ocs.length !== total)) viol("SLOT_OC_MISMATCH", { slot: slab(s), worker: w, role: P.roleLabel(Tm[w]), oc: ocs.join("・") || "―" });
      if (ocs.includes(w)) viol("SLOT_OC_SELF", { slot: slab(s), worker: w });
      for (const n of ocs) if (!P.isStandby(n)) viol("SLOT_OC_NOT_STANDBY", { slot: slab(s), who: n });
    }
    // 2 不可
    for (const n of names) {
      for (const d of P.unavailNight[n] || []) if (d >= 1 && d <= P.N && A.eng(n, [d, "night"])) viol("UNAVAIL_NIGHT", { day: lab(d), who: n }, [[d, "night"]], n);
      for (const [d, part] of P.unavailOther[n] || []) {
        if (A.eng(n, [d, "day"])) viol("UNAVAIL_DAY", { day: lab(d), who: n, scope: T.t(part === "allday" ? "日夜両方の" : "日勤帯") }, [[d, "day"]], n);
        if (part === "allday" && A.eng(n, [d, "night"])) viol("UNAVAIL_ALLDAY_NIGHT", { day: lab(d), who: n }, [[d, "night"]], n);
      }
    }
    // 3 回数（予備の役割の登用。目安の範囲はプラグイン quota_range）
    for (const n of P.names) { if (!P.isRole(n, "reserve")) continue; const tot = P.slots.filter(s => A.worked(n, s)).length;
      if (tot && (P.doctors[n].duty === "never" || !P.allowChief)) viol("RESERVE_ASSIGNED", { who: n, count: tot }, null, n); }
    // プラグインにした規則の検算（docs/rule-modules.md）。id を並べているのは、違反の並びを移す前と同じに保つため
    const cctx = T.rules.checkCtx(P, A, "check", viol);
    T.rules.runCheck(cctx, ["quota_range", "same_day_double", "consecutive_days", "run_length_max", "shift_sequence", "days_off_min", "days_off_pair", "composition"]);
    // 6 期間責任者と週末の均等（プラグイン）。日ごとの担当はプラグインが事実 "charge" として出す（結果の表示にも使う）
    T.rules.runCheck(cctx, ["period_charge", "weekend_balance"]);
    const charge = (cctx.facts.charge || {}).map || Object.fromEntries(P.periods.map(p => [p.id, Object.fromEntries(p.days.map(d => [d, null]))]));
    // 7 固定・金曜
    for (const [d, ns] of Object.entries(P.fixedNight)) for (const n of ns) if (!A.worked(n, [+d, "night"])) viol("FIXED_MISMATCH", { day: lab(+d), slot: P.shiftLabel("night"), who: n });
    for (const [d, ns] of Object.entries(P.fixedDay)) for (const n of ns) if (!A.worked(n, [+d, "day"])) viol("FIXED_MISMATCH", { day: lab(+d), slot: P.shiftLabel("day"), who: n });
    for (const [d, ns] of Object.entries(P.fixedDayOc)) for (const n of ns) if (!A.oc([+d, "day"]).includes(n)) viol("FIXED_MISMATCH", { day: lab(+d), slot: T.t("日勤OC"), who: n });
    for (const [d, ns] of Object.entries(P.fixedNightOc)) for (const n of ns) if (!A.oc([+d, "night"]).includes(n)) viol("FIXED_MISMATCH", { day: lab(+d), slot: T.t("夜間OC"), who: n });
    T.rules.runCheck(cctx, ["friday_night_min", "same_weekday_cap"]); // プラグイン（移す前にここにあった順）
    T.rules.runCheck(cctx, ["duty_conflicts", "rest_day"]); // 8 定期業務・10 週休日（プラグイン）
    T.rules.runCheck(cctx); // 残りのプラグイン
    // 固定指定した枠・医師に関わる違反は「固定指定により許容（要確認）」として分ける（固定指定との不一致そのものは違反のまま）。
    // 判定は文言ではなく、違反に関わる日・医師（VD）と固定指定の集合の照合で行う
    const W = [], V2 = [], WC = [], VC2 = [], fixedByDay = {};
    for (const k of P.fixedEngKeys) { const [sl, n] = k.split("|"); const d = +sl.split(":")[0]; (fixedByDay[d] ||= new Set()).add(n); }
    const NEVER_BY_FIXED = new Set(["FIXED_MISMATCH", "PERIOD_CHARGE_FIXED_MISMATCH", "PERIOD_CHARGE_NEXT_LINK"]); // 固定指定そのものとの不一致は許容しない
    V.forEach((v, i) => {
      const d = VD[i] || { days: [], names: [] };
      // days の要素が [日, 勤務帯] の枠なら、その枠そのものが固定されているときだけ許容（不可の違反など。解く側の例外 isFixedEng と同じ範囲）。日だけなら同じ日の固定で許容
      // プラグインが固定の関与を明示していれば（ctx.limit の fixed。解く側と同じ範囲）それに従う。OC だけの固定で勤務の規則を許容へ広げない
      const byFixed = !NEVER_BY_FIXED.has(VC[i].code) && (d.fixed !== undefined ? d.fixed : d.days.some(day => Array.isArray(day) ? d.names.some(n => P.fixedEngKeys.has(`${day[0]}:${day[1]}|${n}`)) : d.names.some(n => (fixedByDay[day] || new Set()).has(n))));
      if (byFixed) { W.push(v); WC.push(VC[i]); } else { V2.push(v); VC2.push(VC[i]); }
    });
    return { V: V2, W, VC: VC2, WC, charge, A };
  }

  // 減点の合計を割当から数え直す（solver.js の目的関数と同じ値になるはず。二重実装で式の食い違いを捕まえる）。
  // 補助変数は使わず、割当から直接数える。期間責任者は割当から決まる（その日の枠すべてに関わる期間責任者になれる人）。
  // 必須条件を満たす割当が前提（違反があれば解く側では解なしになるので、比べる意味が無い）。
  // opts: avoidRef（避けたい日の基準回数）、ignoreAvoid、base（既存案。解く側と同じく変更しなかった分は負の値で数える）
  // 返り値: { total, items: {重みの名前: 点} }
  function penalty(P, asg, opts = {}) {
    const A = new Asg(P, asg), W = P.weights, names = P.dutyNames, N = P.N, items = {};
    const add = (k, w, x) => { const v = (+w || 0) * x; if (v) items[k] = (items[k] || 0) + v; };
    const pos = x => Math.max(0, x);
    const w1 = (n, s) => A.worked(n, s) ? 1 : 0, o1 = (n, s) => A.oc(s).includes(n) ? 1 : 0;
    const total = {}; for (const n of names) total[n] = P.slots.filter(s => A.worked(n, s)).length;
    // 若手OCを置けなかった枠（勤務者の役割から決まる必要数 − 実際の数）
    const jr = P.refId("junior");
    if (jr && P.standbyRoleIds.includes(jr)) for (const s of P.slots) {
      const need = A.workers(s).reduce((a, w) => a + +((P.ocReqAt(s)[P.team[w]] || {})[jr] || 0), 0);
      add("missing_young_oc", W.missing_young_oc, pos(need - A.oc(s).filter(n => P.team[n] === jr).length));
    }
    // 勤務回数
    for (const n of names) if (P.isRole(n, "reserve")) add("chief_duty", W.chief_duty, total[n]); // 当月目標からのずれはプラグイン quota_target
    // 既存案からの変更（解く側と同じ式。変えなかった分は負になる）
    if (opts.base) for (const s of P.slots) { const b = opts.base[key(s)]; if (!b) continue; const w = W.base_change || 1;
      for (const n of names) { add("base_change", w, [].concat(b.work || []).includes(n) ? -w1(n, s) : w1(n, s)); add("base_change", w, (b.oc || []).includes(n) ? -o1(n, s) : o1(n, s)); } }
    T.rules.runPenalty(T.rules.checkCtx(P, A, "penalty", add, opts)); // プラグインにした規則の減点（合計なので順は問わない）
    return { total: Object.values(items).reduce((a, b) => a + b, 0), items };
  }
  const RULE_W = id => (T.RULE_DEFS.find(d => d.id === id) || {}).weight || id; // 規則の減点を重みの名前で数える

  function cathTable(P, A) {
    const req = P.cathReq, exclPost = P.rules.exclude_post_night_from_cath !== false, clinicCand = P.rules.pm_clinic_arrhythmia_candidates || [];
    const rows = [];
    for (let d = 1; d <= P.N; d++) {
      if (P.isHoliday(d)) continue;
      const r = req[DOW[P.dow(d)]], post = A.work([d - 1, "night"]), nightoc = A.oc([d - 1, "night"]), offA = P.cathOffA.has(d), offI = P.cathOffI.has(d);
      for (const half of ["am", "pm"]) {
        // 夜勤明け: 午前は候補に数えてよい（数えて初めて足りる場合は減点対象として postUsed）。午後は除外
        const av = group => { const ok = [], ex = [], strict = []; for (const n of group) { const its = P.dutyItems(n, d, half, ["outpatient", "ward", "external", "absent"]); if (its.length) ex.push(`${n}(${its.map(i => T.kindLabel(i.kind)).join("/")})`); else if (P.leave(n, d, half)) ex.push(`${n}(${T.t("不可")})`); else if (exclPost && post === n) { if (half === "am") ok.push(`${n}(${T.t("夜勤明け")})`); else ex.push(`${n}(${T.t("夜勤明け")})`); } else { ok.push(n + (nightoc.includes(n) ? "*" : "")); strict.push(n); } } return [ok, ex, strict]; };
        const [okA, exA, stA] = av(P.cathA), [okI, exI, stI] = av(P.cathI), ng = [], needA = offA ? 0 : +r[`A_${half}`], needI = offI ? 0 : +(r.I ?? 1);
        if (okA.length < needA) ng.push({ code: "CATH_OTHER_SHORT", args: { got: okA.length, need: needA } });
        if (okI.length < needI) ng.push({ code: "CATH_CHARGE_SHORT", args: { got: okI.length, need: needI } });
        const postUsed = half === "am" && !ng.length && (stA.length < needA || stI.length < needI);
        const row = { label: `${P.label(d)} ${T.t(half === "am" ? "午前" : "午後")}`, d, half, needA, okA, exA, okI, exI, ng, postUsed, offA, offI, clinic: null };
        if (half === "pm" && r.pm_clinic) {
          const [okC, exC] = av([...new Set([...P.cathA, ...clinicCand])]), [okY, exY] = av(P.Y);
          if (okC.length < needA + 1) ng.push({ code: "CATH_CLINIC_OTHER_SHORT", args: { got: okC.length, need: needA } });
          if (okY.length < 1) ng.push({ code: "CATH_CLINIC_JUNIOR_NONE", args: {} });
          row.clinic = { okC, exC, okY, exY };
        }
        rows.push(row);
      }
    }
    return rows;
  }

  function restDays(P, A) {
    const out = {}; for (const n of P.names) out[n] = [];
    for (let d = 1; d <= P.N; d++) {
      if (P.isHoliday(d)) for (const w of A.workers([d, "day"])) if (out[w]) out[w].push(`${P.month}/${d} ${P.shiftLabel("day")}`);
      const nh = P.nextIsHoliday(d); // 月末は翌月1日（土日祝）
      if (nh) for (const w of A.workers([d, "night"])) if (out[w]) out[w].push(`${P.month}/${d} ${P.shiftLabel("night")}${T.t("(翌日休日)")}`);
    }
    return out;
  }

  function metrics(P, A) {
    const rows = {};
    for (const n of P.names) {
      const day = P.slots.filter(s => s[1] === "day" && A.worked(n, s)).length, night = P.slots.filter(s => s[1] === "night" && A.worked(n, s)).length;
      const doc = P.slots.filter(s => s[1] === "day" && A.oc(s).includes(n)).length, noc = P.slots.filter(s => s[1] === "night" && A.oc(s).includes(n)).length;
      const days = [...new Set(P.slots.filter(s => A.eng(n, s)).map(s => s[0]))].sort((a, b) => a - b);
      const hdays = days.filter(d => P.isHoliday(d));
      const wk = P.periods.filter(p => p.kind === "weekend" && p.slots.some(s => A.eng(n, s)));
      let dual = 0; for (let d = 1; d <= P.N; d++) if (A.a[`${d}:day`] && ((A.worked(n, [d, "day"]) && A.oc([d, "night"]).includes(n)) || (A.oc([d, "day"]).includes(n) && A.worked(n, [d, "night"])))) dual++;
      rows[n] = { quota: P.quota(n), target: P.targets[n], day, night, total: day + night, dayoc: doc, nightoc: noc, days, ndays: days.length, hdays: hdays.length, weekends: wk.length, weekendsCrossing: wk.filter(p => p.crossing).length, dual };
    }
    const rest = restDays(P, A); for (const n of P.names) rows[n].rest = rest[n];
    return rows;
  }

  // 計算前の入力チェック: 明らかな矛盾を具体名で示す（解なしになる前に気づけるように）
  // 入力チェックの項目を積む関数（種類＋差し込む値。文面と直し方（_HINT）は messages.js）
  const pusher = (P, out) => (code, args = {}, hintArgs = null) => out.push({ code, args, msg: P.msg(code, args), hint: T.MSG[code + "_HINT"] ? P.msg(code + "_HINT", hintArgs || args) : "" });
  // プラグインの有無の確認: 読めなかった・前のフォルダの残り・設定や月が参照する規則の登録が無い。lint の一部だが、規則ごとの lint（プラグインの関数）が例外を出しても
  // 単独で判定できるよう別口（T.lintPlugins）にも出す。計算の入口はこの結果で止める（規則が黙って落ちたまま計算しない）
  function pluginChecks(P, push) {
    if (T.plugins) for (const x of T.plugins.errors()) push("LINT_PLUGIN_ERROR", { name: x.name, err: x.error }); // 保存フォルダのプラグインが読めなかった
    if (T.plugins && T.plugins.stale) for (const id of T.plugins.stale()) push("LINT_PLUGIN_STALE", { who: id }); // 前のフォルダのプラグインが残っている
    const used = ((P.m || {}).plugins_used || []).filter(id => !T.RULE_BY_ID[id]); // プラグインの規則で計算した月を、プラグインなしで開いている
    const onButAbsent = Object.entries((P.rules || {}).rule_states || {}).filter(([id, st]) => st && st !== "off" && !T.RULE_BY_ID[id]).map(([id]) => id); // 設定で使うことになっているのに登録が無い
    const missing = [...new Set(used.concat(onButAbsent))]; if (missing.length) push("LINT_PLUGIN_MISSING", { who: missing.join("・") });
    { const tag = P.m && P.m.year ? `${P.m.year}${String(P.m.month).padStart(2, "0")}` : `${P.year}${String(P.month).padStart(2, "0")}`; // 独自データの変換（normalize / normalizeMonth）が、この設定・この月について失敗している（フックが今の実装に無ければ出さない）
      for (const e of (T.hookErrors || new Map()).values()) { const def = T.RULE_BY_ID[e.id]; if (!def || typeof def[e.hook] !== "function") continue; if (e.tag !== "rules" && e.tag !== tag) continue; push("LINT_PLUGIN_HOOK", { who: e.id, hook: e.hook, err: e.err }); } }
  }
  const lintPlugins = P => { const out = []; pluginChecks(P, pusher(P, out)); return out; };
  function lint(P) {
    const out = [], Tm = P.team, lab = d => P.label(d);
    // 入力チェックも「種類（code）＋差し込む値」で積む。文面と直し方（_HINT）は messages.js
    const push = pusher(P, out);
    // 本体が見るのは名簿・不可・固定指定の形（枠があるか、名簿の人か、不可と重なるか）と待機（オンコール）。
    // 規則ごとの入力チェック（固定指定と規則の矛盾、人数の見積もり、専門業務など）はプラグインの lint（docs/rule-modules.md §5.7）
    const cctx = T.rules.checkCtx(P, new Asg(P, {}), "lint", push), { unN, unO } = cctx;
    // 名簿・設定
    for (const n of (P.rules.name_order || [])) if (!P.doctors[n]) push("LINT_NAME_ORDER_UNKNOWN", { who: n });
    pluginChecks(P, push); // プラグインが読めない・欠けている（計算を止める種類。T.lintPlugins でも単独で見られる）
    if (T.plugins && T.plugins.overrides) for (const o of T.plugins.overrides()) push("LINT_PLUGIN_OVERRIDE", { name: o.name, who: o.id, was: o.was || T.t("本体") }); // 別の出どころの規則と同じ id
    { const on = id => P.state(id) !== "off", seen = new Set(); // 「同じことを扱う」と宣言した規則（overlaps）が両方とも使われている
      for (const d of T.RULE_DEFS || []) if (on(d.id)) for (const o of d.overlaps || []) { const e = T.RULE_BY_ID[o]; if (!e || !on(o)) continue; const k = [d.id, o].sort().join("|"); if (seen.has(k)) continue; seen.add(k);
        push("LINT_RULE_OVERLAP", { who: T.ruleLabel(P.rules, d), other: T.ruleLabel(P.rules, e), a: d.id, b: o }); } }
    { const cal = (((P.rules || {}).profile || {}).calendar || {}).holidays; if (cal && T.calendars && (!T.calendars.byId[cal] || T.pluginOff(P.rules, T.calendars.byId[cal].source))) push("LINT_CALENDAR_MISSING", { id: cal }); } // 暦のプラグインが無い（自動入力は既定の暦に落ちる）
    { const tpl = ((P.rules || {}).docx || {}).template; if (tpl && T.docx && !T.docx.list(P.rules).some(t => t.id === tpl)) push("LINT_DOCX_TEMPLATE_MISSING", { id: tpl }); } // 無効にしたプラグインの様式も「無い」扱い
    { const refs = T.monthNameRefs(P.m || {}), unknown = Object.keys(refs).filter(n => !P.doctors[n]); // 名簿から外した・施設プロファイルを読み込んだ後に残った入力
      if (unknown.length) push("LINT_MONTH_UNKNOWN_NAMES", { who: unknown.join("・"), n: unknown.length }); }
    for (const n of P.names) if (/[\x00-\x1F\x7F:|]/.test(n)) push("LINT_NAME_BAD_CHARS", { who: n });
    for (const n of P.names) { const un = P.unavailNight[n] || new Set(); for (const [d] of P.unavailOther[n] || []) if (un.has(d)) push("LINT_UNAVAIL_DOUBLE", { who: n, day: lab(d) }); for (const [d] of P.avoid[n] || []) if (un.has(d) || (P.unavailOther[n] || []).some(([dd]) => dd === d)) push("LINT_UNAVAIL_AND_AVOID", { who: n, day: lab(d) }); }
    // 固定指定
    const sl = { night: P.shiftLabel("night"), day: P.shiftLabel("day") };
    for (const [ds, ns] of Object.entries(P.fixedNight)) { const d = +ds;
      if (new Set(ns).size !== ns.length) push("LINT_FIXED_DUP", { day: lab(d), slot: sl.night, who: ns.join("・") });
      if (ns.length > P.countOf([d, "night"])) push("LINT_FIXED_OVER_COUNT", { day: lab(d), slot: sl.night, who: ns.join("・"), n: ns.length, count: P.countOf([d, "night"]) }); // 枠の人数より多く固定している
      for (const n of ns) {
        if (!P.dutyNames.includes(n)) { push("LINT_FIXED_NOT_CANDIDATE", { day: lab(d), slot: sl.night, who: n }); continue; }
        if (unN(n, d)) push("LINT_FIXED_VS_UNAVAIL", { day: lab(d), slot: sl.night, who: n, scope: P.msg("SCOPE_NIGHT") });
        if (unO(n, d) === "allday") push("LINT_FIXED_VS_UNAVAIL", { day: lab(d), slot: sl.night, who: n, scope: P.msg("SCOPE_ALLDAY") }); } }
    for (const [ds, ns] of Object.entries(P.fixedDay)) { const d = +ds;
      if (!P.slotExists(d, "day")) { push("LINT_FIXED_NO_SLOT", { day: lab(d), slot: sl.day, who: ns.join("・") }); continue; }
      if (new Set(ns).size !== ns.length) push("LINT_FIXED_DUP", { day: lab(d), slot: sl.day, who: ns.join("・") });
      if (ns.length > P.countOf([d, "day"])) push("LINT_FIXED_OVER_COUNT", { day: lab(d), slot: sl.day, who: ns.join("・"), n: ns.length, count: P.countOf([d, "day"]) });
      for (const n of ns) {
        if (!P.dutyNames.includes(n)) { push("LINT_FIXED_NOT_CANDIDATE", { day: lab(d), slot: sl.day, who: n }); continue; }
        if (unO(n, d)) push("LINT_FIXED_VS_UNAVAIL", { day: lab(d), slot: sl.day, who: n, scope: P.msg(unO(n, d) === "allday" ? "SCOPE_ALLDAY" : "SCOPE_DAY") }); } }
    // 待機（オンコール）の固定
    for (const [kind, table] of [["day", P.fixedDayOc], ["night", P.fixedNightOc]]) for (const [ds, ns] of Object.entries(table)) {
      const d = +ds, lbl = T.t(kind === "day" ? "日勤OC" : "夜間OC");
      if (kind === "day" && !P.slotExists(d, "day")) { push("LINT_FIXED_NO_SLOT", { day: lab(d), slot: lbl, who: ns.join("・") }); continue; }
      if (ns.length && !P.shiftHasOncall(kind)) { push("LINT_FIXED_OC_NO_ONCALL_SHIFT", { day: lab(d), slot: lbl, who: ns.join("・"), shift: P.shiftLabel(kind) }); continue; } // オンコールを付けない勤務帯
      for (const n of ns) {
        if (!P.dutyNames.includes(n)) { push("LINT_FIXED_NOT_CANDIDATE", { day: lab(d), slot: lbl, who: n }); continue; }
        if (!P.isStandby(n)) push("LINT_FIXED_OC_NOT_STANDBY", { day: lab(d), slot: lbl, who: n, roles: P.standbyRoleIds.map(x => P.roleLabel(x)).join("・") || T.t("なし"), role: P.roleLabel(Tm[n]) }, { day: lab(d), who: n });
        if (kind === "night" && (unN(n, d) || unO(n, d) === "allday")) push("LINT_FIXED_VS_UNAVAIL", { day: lab(d), slot: lbl, who: n, scope: "" });
        if (kind === "day" && unO(n, d)) push("LINT_FIXED_VS_UNAVAIL", { day: lab(d), slot: lbl, who: n, scope: "" });
        if (((kind === "night" ? P.fixedNight[d] : P.fixedDay[d]) || []).includes(n)) push("LINT_FIXED_WORKER_IS_OC", { day: lab(d), shift: P.shiftLabel(kind), slot: lbl, who: n });
      }
      const teams = ns.map(n => Tm[n]); if (P.standbyRoleIds.some(r => teams.filter(t => t === r).length > 1)) push("LINT_FIXED_OC_TWO_SAME_ROLE", { day: lab(d), slot: lbl, who: ns.join("・") });
    }
    { const ids = new Set(P.roleIds); // 名簿の役割が役割一覧にあるか（識別子を変えたときの取りこぼし）
      const bad = P.names.filter(n => !ids.has(P.team[n]));
      if (bad.length) push("LINT_ROLE_NOT_LISTED", { who: bad.map(n => `${n}（${P.team[n]}）`).join(T.listSep()) }, { role: P.team[bad[0]] });
      if (!P.refId("junior") && P.state("oncall") === "hard") push("LINT_ROLE_REF_MISSING", { ref: T.t("補助として入る役割") }); } // 期間責任者の役割はプラグイン period_charge が見る
    { const want = (P.rules.profile || {}).id, got = (P.m || {}).profile_id;
      if (want && got && want !== got) push("LINT_PROFILE_MISMATCH", { got, want }); }
    // 各枠に勤務できる人がいるか
    for (const s of P.slots) { const c = P.dutyNames.filter(n => cctx.canWork(n, s)); if (!c.length) push("LINT_SLOT_NO_CANDIDATE", { day: lab(s[0]), slot: P.shiftLabel(s[1]) }); }
    T.rules.runLint(cctx); // プラグインの入力チェック
    return out;
  }

  T.lint = lint; T.lintPlugins = lintPlugins;
  T.Asg = Asg; T.check = check; T.penalty = penalty; T.cathTable = cathTable; T.restDays = restDays; T.metrics = metrics;
  T.fmt = fmt; T.fmtHalf = fmtHalf; T.fullWeekendUnits = fullWeekendUnits; T.chargeLabel = chargeLabel;
})(globalThis.T = globalThis.T || {});

// 当直表アプリ（画面）: 月データの作成（空の月・前月からの引き継ぎ・前月末の接続と履歴の取り込み）・月の切替
// app-*.js は T.app（以下 A）を介して互いを参照する。他のファイルの関数・共有変数（A.state, A.dirHandle など）は必ず A. を付ける（build.py --check が検査）。
(function (T, A) {
  const state = A.state;

  function blankMonth(y, m) {
    const nm = A.names(); const obj = f => Object.fromEntries(nm.map(x => [x, f()]));
    const auto = autoCalendar(y, m);
    return { year: y, month: m, holidays: auto.holidays, closure_days: auto.closure, duties_on_holidays: false, next_month_first_day_is_holiday: auto.nextFirst, next_first_day_in_calendar: true, targets: {}, regular_duties: obj(() => []), duty_days: obj(() => ({})), confirmed_pm_external_night: [], unavailable_night: obj(() => []), unavailable_other: [], wishes: { weekend_dayshift: [], night_on: {} }, fixed: { night: {}, day: {}, weekend_charge: {} }, exceptions: {}, prev_month: { last_days: [], last_weekend_charge: null, prev_weekend_charge: null }, history: { weekend_charge: {}, holiday_charge: {}, work_balance: {} }, notes: "" };
  }
  function autoCalendar(y, m) { // 施設プロファイルの暦（祝日の出どころと施設の休日）から、その月の祝日と翌月 1 日が休日かを出す
    const { holidays, closure } = T.holidaysOf(state.rules, y, m);
    const ny = m === 12 ? y + 1 : y, nm = m === 12 ? 1 : m + 1;
    const w = new Date(ny, nm - 1, 1).getDay();
    return { holidays, closure, nextFirst: w !== 0 && w !== 6 && T.holidaysOf(state.rules, ny, nm).holidays.includes(1) };
  }

  // ---------- 前月からの接続・履歴の取り込み ----------
  // prev（前月の保存データ）から、対象月 nmn に前月末の接続・履歴・累計・月またぎの期間責任者を入れる
  function applyConnection(prev, nmn) {
    const y = +prev.month.year, mo = +prev.month.month;
    const consecutive = (+nmn.year * 12 + +nmn.month) === (y * 12 + mo + 1);
    const notes = [];
    const pb = prev.month.history?.work_balance || {};
    { const known = new Set(A.names()); const unknown = [...new Set([...Object.keys(pb), ...Object.keys(prev.month.history?.weekend_charge || {}), ...Object.keys(prev.month.duty_days || {})])].filter(n => !known.has(n)); if (unknown.length) notes.push(T.t("前月のデータに現在の名簿にない氏名があります（{who}）。改名した場合はその履歴・累計は引き継がれません", { who: unknown.join(T.nameSep()) })); }
    nmn.history ||= {}; nmn.history.work_balance = {}; for (const n of A.names()) if (pb[n]) nmn.history.work_balance[n] = +pb[n];
    nmn.history.weekend_charge = {}; nmn.history.holiday_charge = {};
    for (const n of A.iNames()) { nmn.history.weekend_charge[n] = +(prev.month.history?.weekend_charge?.[n] || 0); nmn.history.holiday_charge[n] = +(prev.month.history?.holiday_charge?.[n] || 0); }
    nmn.prev_month = { last_days: [], last_weekend_charge: null, prev_weekend_charge: null };
    if (consecutive) { // 前月の翌月1日欄の固定指定を、当月1日の固定として引き継ぐ
      const pf = prev.month.fixed || {}, nk = String(A.daysIn(y, mo) + 1), got = []; nmn.fixed ||= {};
      for (const [tbl, lbl] of [["day", T.t("日勤")], ["night", T.t("夜勤")], ["weekend_charge", T.t("期間責任者")]]) { const v = (pf[tbl] || {})[nk]; if (v) { (nmn.fixed[tbl] ||= {})[1] = v; got.push(`${lbl} ${v}`); } }
      for (const [tbl, lbl] of [["day_oc", T.t("日勤OC")], ["night_oc", T.t("夜間OC")]]) { const v = [].concat((pf[tbl] || {})[nk] || []); if (v.length) { (nmn.fixed[tbl] ||= {})[1] = v.slice(); got.push(`${lbl} ${v.join("・")}`); } }
      if (got.length) notes.push(T.t("前月の翌月1日欄の固定指定を {m}/1 の固定に引き継ぎ: {list}", { m: nmn.month, list: got.join(T.listSep()) }));
    }
    if (prev.result && prev.result.asg) {
      const PP = new T.Problem(prev.rules || state.rules, prev.month), AS = new T.Asg(PP, prev.result.asg);
      const { charge } = T.check(PP, prev.result.asg); const met = T.metrics(PP, AS);
      const N = PP.N, ld = [];
      // 前月の最後の数日（連勤の規則を使う施設は長めに。T.prevLookback）。1 枠に複数名の施設は勤務者を配列で持つ
      const LB = T.prevLookback(state.rules), multi = T.isMultiWork(prev.rules || state.rules), wk = s => multi ? AS.workers(s) : AS.work(s);
      for (let d = Math.max(1, N - LB + 1); d <= N; d++) { const e = { date: d }; if (PP.slotExists(d, "day")) { e.day = wk([d, "day"]); e.day_oc = AS.oc([d, "day"]); } if (PP.slotExists(d, "night")) { e.night = wk([d, "night"]); e.night_oc = AS.oc([d, "night"]); } ld.push(e); }
      const wps = PP.periods.filter(p => p.kind === "weekend");
      const chg = p => Object.values(charge[p.id]).filter(Boolean);
      if (consecutive) {
        nmn.prev_month.last_days = ld;
        if (wps.length) { const last = wps[wps.length - 1]; nmn.prev_month.last_weekend_charge = chg(last)[0] || null; if (wps.length > 1) nmn.prev_month.prev_weekend_charge = chg(wps[wps.length - 2])[0] || null;
          if (last.crossing && !last.prevDays.length && PP.dow(N) === 5) { (nmn.fixed.weekend_charge ||= {})[1] = chg(last)[0]; notes.push(T.t("月またぎの土日: {m}/1 の期間責任者を {who} に固定（前月 {pm}/{pd} から接続）", { m: nmn.month, who: chg(last)[0], pm: mo, pd: N })); } }
      } else notes.push(T.t("{y}年{m}月 のデータから取り込んだため、前月末の接続は未入力です（月が連続していません）", { y, m: mo }));
      const fw = T.fullWeekendUnits(PP, charge);
      for (const n of PP.I) { nmn.history.weekend_charge[n] = (prev.month.history?.weekend_charge?.[n] || 0) + fw[n] / 2 + (wps.some(p => p.crossing && p.prevDays.length && chg(p).includes(n)) ? 1 : 0); nmn.history.holiday_charge[n] = (prev.month.history?.holiday_charge?.[n] || 0) + PP.periods.filter(p => p.kind === "holiday" && chg(p).includes(n)).length; }
      for (const n of PP.dutyNames) { const q = PP.quota(n); if (!q) continue; const v = (pb[n] || 0) + (met[n].total - q); if (v) nmn.history.work_balance[n] = v; else delete nmn.history.work_balance[n]; }
    } else notes.push(T.t("{y}年{m}月 は未計算のため、前月末の接続と実績の累計は取り込めません（履歴は前月までの値）", { y, m: mo }));
    return notes;
  }
  async function importPrevious() {
    const y = +state.month.year, mo = +state.month.month; const py = mo === 1 ? y - 1 : y, pm = mo === 1 ? 12 : mo - 1;
    const t = `${py}${String(pm).padStart(2, "0")}`;
    if (!A.dirHandle) { if (!(await A.ensureFolder())) return A.toast(T.t("前月のデータを読むにはフォルダの接続が必要です")); }
    await A.refreshMonths();
    const f = await A.findMonthData(t);
    if (!f.data) return alert(T.t("{y}年{m}月 の保存データが見つかりません（探した場所: {tried}）", { y: py, m: pm, tried: f.tried.join(T.listSep()) }));
    A.readAll();
    const notes = applyConnection(f.data, state.month);
    try { state.month.targets = T.autoTargets(state.rules, state.month).targets; } catch (e) { }
    A.save(); A.renderSettingsMonth(); A.renderDoctor(); A.renderFixed();
    A.toast(T.t("{y}年{m}月 から取り込みました。", { y: py, m: pm }) + notes.join(" "));
  }

  // ---------- 前月から作成 ----------
  function fromPrevious(prev, targetY, targetM) {
    const y = +prev.month.year, mo = +prev.month.month;
    const ny = targetY || (mo === 12 ? y + 1 : y), nm = targetM || (mo === 12 ? 1 : mo + 1);
    const nmn = blankMonth(ny, nm);
    // 曜日パターン: 前月の表で「翌月へ引き継ぐ」を付けた行だけを引き継ぐ（業務も避けたい日も同じ扱い。前月のカレンダーからの推定はしない。引き継ぎは明示のチェックで決める）
    for (const n of A.names()) { const prevPats = (prev.month.regular_duties || {})[n] || []; nmn.regular_duties[n] = JSON.parse(JSON.stringify(prevPats.filter(it => it.carry))); }
    nmn.duties_on_holidays = !!prev.month.duties_on_holidays;
    nmn.wishes.weekend_dayshift = (prev.month.wishes?.weekend_dayshift || []).filter(n => A.names().includes(n)); // 土日いずれかの日勤の希望は翌月も引き継ぐ（日付の当直希望は引き継がない）
    if (prev.month.plugins_used && prev.month.plugins_used.length) nmn.plugins_used = prev.month.plugins_used.slice(); // 使ったプラグインの記録も引き継ぐ（無い環境で開いたときの入力チェック用）
    nmn.duty_days = T.expandDuties(state.rules, nmn);
    { const av = Object.values(T.expandAvoid(state.rules, nmn)).flat(); if (av.length) nmn.avoid = av; }
    const notes = applyConnection(prev, nmn);
    if (notes.length) nmn.notes = notes.join("\n");
    try { nmn.targets = T.autoTargets(state.rules, nmn).targets; } catch (e) { }
    return nmn;
  }

  // ---------- 月の切替: その月のデータがあれば開く、なければ直前の月から作成 ----------
  async function onMonthChange(ny, nm) {
    const t = `${ny}${String(nm).padStart(2, "0")}`;
    if (!(await A.saveBeforeSwitch())) { A.renderSettingsMonth(); return; }
    if (!A.dirHandle && A.fsOK() && A.storedHandle) await A.ensureFolder();
    if (A.dirHandle) {
      await A.refreshMonths();
      const f = await A.findMonthData(t);
      if (f.data) { const v = await A.choose(T.t("{y}年{m}月 の保存データがあります（{where}）。", { y: ny, m: nm, where: f.where }), [{ label: T.t("この保存データを開く"), value: "open", primary: true }, { label: T.t("やめる（今の月のまま）"), value: null, cancel: true }]); if (v === "open") A.applyLoaded(f.data, T.t("{where} を開きました", { where: f.where })); else A.renderSettingsMonth(); return; }
      // 直前の月（同じ年月がなければそれより前で最新）のデータを探す
      const cands = [...new Set(A.monthDirs.map(x => x.slice(0, 6)))].filter(x => x < t).sort().reverse();
      let triedMsg = T.t("{y}年{m}月 の保存データは見つかりません（探した場所: {tried}）。", { y: ny, m: nm, tried: f.tried.join(T.listSep()) });
      for (const c of cands) {
        const f2 = await A.findMonthData(c); const o2 = f2.data;
        if (!o2) continue;
        const v = await A.choose(T.t("{y}年{m}月 の保存データはありません。どのように作りますか。", { y: ny, m: nm }), [
          { label: T.t("{y}年{m}月 のデータから引き継いで作成", { y: c.slice(0, 4), m: +c.slice(4) }), sub: T.t("引き継ぐ: 曜日パターンのうち「翌月へ引き継ぐ」を付けた行（業務・避けたい日）、土日いずれかの日勤の希望、履歴、前月末の接続。引き継がない: 印のない行、不可日・日付の当直希望・固定指定"), value: "prev", primary: true },
          { label: T.t("空の月として作成"), sub: T.t("外来・病棟番・外勤・履歴もすべて空。名簿は現在の設定"), value: "empty" },
          { label: T.t("やめる（今の月のまま）"), value: null, cancel: true }]);
        if (v === "prev") { if (o2.rules) state.rules = o2.rules; state.meta = null; state.base = null; state.month = fromPrevious(o2, ny, nm); state.result = null; state.ui.doctor = 0; A.clearUndo(); A.save(); A.renderAll(); A.showTab("input"); A.toast(T.t("{y}年{m}月 を作成しました。祝日・不可日・希望を記入し、業務を確認してください", { y: ny, m: nm })); return; }
        if (v === "empty") { state.meta = null; state.base = null; state.month = blankMonth(ny, nm); state.result = null; state.ui.doctor = 0; A.clearUndo(); A.save(); A.renderAll(); A.showTab("input"); A.toast(T.t("{y}年{m}月 を空の月として作成しました", { y: ny, m: nm })); return; }
        A.renderSettingsMonth(); return;
      }
    }
    const v = await A.choose(T.t("{y}年{m}月 の保存データが見つかりません{where}。どのように作りますか。", { y: ny, m: nm, where: A.dirHandle ? T.t("（フォルダ「{name}」内）", { name: A.dirHandle.name }) : T.t("（フォルダ未接続）") }), [
      { label: T.t("現在の入力（{y}年{m}月）から引き継いで作成", { y: state.month.year, m: state.month.month }), sub: T.t("引き継ぐ: 曜日パターンのうち「翌月へ引き継ぐ」を付けた行（業務・避けたい日）、土日いずれかの日勤の希望、履歴、前月末の接続。引き継がない: 印のない行、不可日・日付の当直希望・固定指定"), value: "prev", primary: true },
      { label: T.t("空の月として作成"), sub: T.t("外来・病棟番・外勤・履歴もすべて空。名簿は現在の設定"), value: "empty" },
      { label: T.t("やめる（今の月のまま）"), value: null, cancel: true }]);
    if (v === "prev") { const base = { rules: state.rules, month: state.month, result: state.result }; state.meta = null; state.base = null; state.month = fromPrevious(base, ny, nm); state.result = null; state.ui.doctor = 0; A.clearUndo(); A.save(); A.renderAll(); A.showTab("input"); A.toast(T.t("{y}年{m}月 を作成しました。祝日・不可日・希望を記入し、業務を確認してください", { y: ny, m: nm })); }
    else if (v === "empty") { state.meta = null; state.base = null; state.month = blankMonth(ny, nm); state.result = null; state.ui.doctor = 0; A.clearUndo(); A.save(); A.renderAll(); A.showTab("input"); A.toast(T.t("{y}年{m}月 を空の月として作成しました", { y: ny, m: nm })); }
    else A.renderSettingsMonth();
  }

  Object.assign(A, { blankMonth, autoCalendar, importPrevious, fromPrevious, onMonthChange }); // 他のファイルから使う関数
})(globalThis.T = globalThis.T || {}, globalThis.T.app = globalThis.T.app || {});

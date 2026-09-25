// 当直表アプリ（画面）: 入力画面: 月の設定（暦・目標・固定の一覧・前月末の接続・履歴・メモ）と医師別カレンダー（業務・不可・避・希望・固定・曜日パターン）
// app-*.js は T.app（以下 A）を介して互いを参照する。他のファイルの関数・共有変数（A.state, A.dirHandle など）は必ず A. を付ける（build.py --check が検査）。
(function (T, A) {
  const $ = s => document.querySelector(s);
  const esc = T.esc;
  const state = A.state;

  const DOWS = T.DOW; // 曜日の識別子（model.js と共通）
  const KINDS = T.KINDS; // 勤務内容（model.js と共通）
  // 表示言語に訳すのは T.t(日本語, 差し込み)（i18n.js）
  const dowJa = i => T.dowLabel(i);
  const kindOpts = () => Object.keys(KINDS).map(k => [k, T.kindLabel(k)]);
  // 曜日パターンの種別（不在は置かない）と時間帯。表示は言語に合わせる
  const PAT_KINDS = () => Object.assign(Object.fromEntries(["outpatient", "ward", "external"].map(k => [k, T.kindLabel(k)])),
    { avoid_night: T.t("避：夜勤"), avoid_day: T.t("避：日勤帯"), avoid_allday: T.t("避：日夜両方") });
  const PARTS = () => ({ full: T.t("終日"), am: T.t("午前"), pm: T.t("午後") });
  // 役割の機能から引く（識別子は施設ごとに違う）
  const roleOf = (R, ref) => { try { return (T.normalizeRolesOf(R).find(x => x.refs.includes(ref)) || {}).id || null; } catch (e) { return null; } };
  const standbyIds = R => { try { return T.normalizeRolesOf(R).filter(x => x.standby).map(x => x.id); } catch (e) { return []; } };
  const shiftLabel = (R, id) => { try { return (T.normalizeShiftsOf(R).find(x => x.id === id) || {}).label || id; } catch (e) { return id; } };

  // ---------- 月の設定 ----------
  function renderSettingsMonth() {
    const m = state.month, R = state.rules; A.ensureMonth(m);
    // 規則を「なし」にした項目は月の設定にも出さない。役割の呼び方（{charge} など）は施設の表示名に置き換える
    const on = id => T.ruleState(R, id) !== "off", L = s2 => T.term(s2, R);
    const roles = T.normalizeRolesOf(R), refRole = r => (roles.find(x => x.refs.includes(r)) || {}).id || null;
    const jr = refRole("junior"), hasReserve = !!refRole("reserve");
    const h = [];
    { const want = (R.profile || {}).id, got = m.profile_id; // 施設の取り違え（入力チェック LINT_PROFILE_MISMATCH と同じ条件）。ここで直せる
      if (want && got && want !== got) h.push(`<div class="box warn"><h3>${esc(T.t("この月は別の施設のものです"))}</h3>
<p>${esc(T.t("この月データは施設「{got}」の月として作られました。いまの設定は「{want}」です。違う施設の規則で計算すると勤務表が成り立ちません。次のどちらかで直してください。", { got, want }))}</p>
<p><button id="btnMonthAdoptProfile">${esc(T.t("この月をいまの施設（{want}）の月にする", { want }))}</button> <span class="note">${esc(T.t("月データの施設の記録を書き換えます。名簿の人が違うときは、月の入力（不可・希望・固定）を見直してください"))}</span></p>
<p><button id="btnRulesRevertProfile">${esc(T.t("設定をこの月の施設（{got}）に戻す", { got }))}</button> <span class="note">${esc(T.t("同梱のプロファイルにある施設だけ戻せます。施設が自分で作ったプロファイルは、設定タブの「プロファイルのファイルを読み込む」で戻してください"))}</span></p>
<p class="note">${esc(T.t("月データはブラウザ内にも残るので、フォルダの月を消しても無くなりません。まっさらにするには、ページを読み直して開始画面の「ブラウザ内の保存を消して最初から始める」を押します"))}</p></div>`); }
    { const refs = T.monthNameRefs(m), unknown = Object.keys(refs).filter(n => !R.doctors.some(d => d.name === n)); // 名簿にない人の入力（名簿から外した・プロファイルを読み込んだ後の残り）
      const KIND = { fixed: "固定指定", unavailable: "不可", wishes: "希望", avoid: "避けたい日", duty_days: "業務のカレンダー", regular_duties: "定期業務", targets: "当月の目標", confirmed_pm_external_night: "午後外勤日の確認" };
      if (unknown.length) h.push(`<div class="box warn"><h3>${esc(T.t("名簿にない人の入力が残っています"))}</h3>
<p>${esc(T.t("名簿から外した後や、施設プロファイルを読み込んだ後に残った入力です。名簿にいない人の入力は計算に使われませんが、固定指定は入力チェックで指摘されます。同じ人の改名なら、名簿の氏名を書き換えると月の入力も追随します。"))}</p>
<ul>${unknown.map(n => `<li>${esc(n)}: ${esc(refs[n].map(k => T.t(KIND[k] || k)).join(T.listSep()))}</li>`).join("")}</ul>
<p><button id="btnPurgeUnknown">${esc(T.t("名簿にない人の入力をこの月から削除"))}</button></p></div>`); }
    h.push(`<div class="box"><h3>${esc(T.t("暦"))}</h3>
<b>${esc(T.t("{y}年{m}月", { y: m.year, m: m.month }))}</b> <span class="note">${esc(T.t("（月の切替はヘッダーの月の一覧で）"))}</span>　
<label>${esc(T.t("祝日・施設の休日（土日以外、日付をカンマ区切り）"))} <input data-path="holidays" data-type="days" value="${(m.holidays || []).join(", ")}" style="width:14em"></label> <button id="btnAutoHol">${esc(T.t("暦から自動入力"))}</button>${(m.closure_days || []).length ? ` <span class="note">${esc(T.t("施設の休日: {days}", { days: (m.closure_days || []).join(", ") }))}</span>` : ""}
<label><input type="checkbox" data-path="next_month_first_day_is_holiday" ${m.next_month_first_day_is_holiday ? "checked" : ""}> ${esc(T.t("翌月1日は休日"))}</label>
${on("cath_requirement") ? `<br><span class="note">${esc(T.t("専門業務の配置が不要な日（0件確定、学会など。日付をカンマ区切り。必要人数を0にする。専門外来の担当1名は確保）"))}</span>
<label>${esc(L("{other}"))} <input data-path="cath_off_days_A" data-type="days" value="${(m.cath_off_days_A || []).join(", ")}" style="width:10em"></label>
<label>${esc(L("{charge}"))} <input data-path="cath_off_days_I" data-type="days" value="${(m.cath_off_days_I || []).join(", ")}" style="width:10em"></label>` : ""}
${on("weekend_balance") ? `<label>${esc(T.t("週末担当の許容差（組。空欄＝共通ルール {v}）", { v: R.weekend_balance_max_diff }))} <input type="number" data-path="exceptions.weekend_balance_max_diff" value="${m.exceptions?.weekend_balance_max_diff ?? ""}" style="width:4em"></label>` : ""}
${hasReserve ? `<label><input type="checkbox" data-path="allow_chief_duty" ${m.allow_chief_duty ? "checked" : ""}> ${esc(L(T.t("{reserve}（原則配置しない）を当番候補に含める")))}</label>` : ""}</div>`);
    let at = null, P0 = null; try { at = T.autoTargets(R, m); P0 = new T.Problem(R, m); } catch (e) { }
    const bal = m.history.work_balance || {}, share = P0 && P0.quotaMode === "share";
    const quotaOf = n => P0 ? P0.quota(n) : (R.doctors.find(d => d.name === n) || {}).quota;
    h.push(`<div class="box"><h3>${esc(T.t("当月の勤務目標"))}</h3>
<p class="note">${at ? esc(at.lines[0]) : ""}　${share ? esc(T.t("目安は相対: 必要な延べ人数 {need} を名簿の比重（合計 {w}）で按分した値です（端数は累計の過不足が少ない人から）。", { need: P0.shareInfo.need, w: P0.shareInfo.W })) + " " : ""}${esc(T.t("目安±{tol} の範囲で当月の目標を決めます。「自動調整」は目安の大きい人から順に（同じ目安なら累計の過不足が少ない人、次に年数の長い人から）±1します。空欄＝目安どおり。", { tol: R.quota_tolerance ?? 1 }))}</p>
<table class="grid"><tr><th></th>${A.dutyNames().map(n => `<th>${esc(n)}</th>`).join("")}</tr>
<tr><th>${esc(T.t(share ? "目安（比重から）" : "目安"))}</th>${A.dutyNames().map(n => `<td>${esc(quotaOf(n))}</td>`).join("")}</tr>
<tr><th>${esc(T.t("累計の過不足（前月まで、実績−目安）"))}</th>${A.dutyNames().map(n => `<td><input type="number" data-bal="${esc(n)}" value="${bal[n] ?? 0}" style="width:3.5em"></td>`).join("")}</tr>
<tr><th>${esc(T.t("当月の目標"))}</th>${A.dutyNames().map(n => `<td><input type="number" data-target="${esc(n)}" value="${m.targets?.[n] ?? ""}" style="width:3.5em"></td>`).join("")}</tr></table>
<p><button id="btnAutoTargets">${esc(T.t("自動調整"))}</button> <button id="btnClearTargets">${esc(T.t("目安どおりに戻す"))}</button>　<span class="note">${esc(T.t("自動調整の案"))}: ${at ? esc(at.lines.slice(1).join(T.listSep())) : ""}</span></p></div>`);
    const fx = m.fixed || {};
    const fixedRows = [];
    for (let d = 1; d <= A.daysIn(+m.year, +m.month) + 1; d++) { const parts = []; const wt = (k, n) => (m.fixed_tags || {})[`${d}:${k}|${n}`] ? `${n}(${m.fixed_tags[`${d}:${k}|${n}`]})` : n; if ([].concat(fx.day?.[d] || []).length) parts.push(`${shiftLabel(R, "day")} ${[].concat(fx.day[d]).map(n => wt("day", n)).join(T.nameSep())}`); if ([].concat(fx.night?.[d] || []).length) parts.push(`${shiftLabel(R, "night")} ${[].concat(fx.night[d]).map(n => wt("night", n)).join(T.nameSep())}`); if (fx.day_oc?.[d]?.length) parts.push(`${T.t("日勤OC")} ${fx.day_oc[d].join(T.nameSep())}`); if (fx.night_oc?.[d]?.length) parts.push(`${T.t("夜間OC")} ${fx.night_oc[d].join(T.nameSep())}`); if (fx.weekend_charge?.[d]) parts.push(`${L(T.t("{charge}担当"))} ${fx.weekend_charge[d]}`); if (jr && (fx.day_oc_none?.[d] || []).includes(jr)) parts.push(L(T.t("{shift} {junior}OCなし", { shift: shiftLabel(R, "day") }))); if (jr && (fx.night_oc_none?.[d] || []).includes(jr)) parts.push(L(T.t("{shift} {junior}OCなし", { shift: shiftLabel(R, "night") }))); if (parts.length) fixedRows.push(`<span class="chip">${d > A.daysIn(+m.year, +m.month) ? esc(T.t("翌月1日")) : esc(T.t("{d}日", { d }))} ${esc(parts.join(T.listSep()))}</span>`); }
    h.push(`<div class="box"><h3>${esc(T.t("固定指定（{person}別カレンダーの「固定」欄で設定）"))}</h3>
<p>${fixedRows.join(" ") || esc(T.t("なし"))}</p>
<p>${esc(T.t("午後外勤後の夜勤・夜間OCを「間に合う」と確認した件"))}: ${(m.confirmed_pm_external_night || []).map((x, i) => `<span class="chip">${esc(T.t("{d}日", { d: x.day }))} ${esc(x.name)} <button data-del="pmext" data-i="${i}">×</button></span>`).join("") || esc(T.t("なし"))}　${esc(T.t("日"))} <input type="number" id="pmExtDay" style="width:4em"> ${A.nameSel("", 'id="pmExtName"')} <button id="pmExtAdd">${esc(T.t("追加"))}</button></p></div>`);
    const pm = m.prev_month || {}, ld = pm.last_days || [];
    // 取り込む日数は連勤の規則で決まる（T.prevLookback）。1 枠に複数名の施設は、勤務者を「・」区切りで書く
    const LB = Math.max(T.prevLookback(R), ld.length), multi = T.isMultiWork(R), ocOn = on("oncall");
    const who = (v, f) => multi ? `<input data-f="${f}" data-multi value="${esc([].concat(v || []).join("・"))}" style="width:14em">` : A.nameSel(v, `data-f="${f}"`);
    const ldRow = i => { const e = ld[i] || {}; return `<tr data-ld="${i}"><td><input type="number" data-f="date" value="${e.date ?? ""}" style="width:4em"></td><td>${who(e.day, "day")}</td>` +
      (ocOn ? `<td><input data-f="day_oc" value="${esc((e.day_oc || []).join("・"))}" style="width:8em"></td>` : "") + `<td>${who(e.night, "night")}</td>` +
      (ocOn ? `<td><input data-f="night_oc" value="${esc((e.night_oc || []).join("・"))}" style="width:8em"></td>` : "") + `</tr>`; };
    h.push(`<div class="box"><h3>${esc(T.t("前月末の接続（前月の最後の{n}日）", { n: LB }))}</h3><table class="grid"><tr><th>${esc(T.t("前月の日付"))}</th><th>${esc(shiftLabel(R, "day"))}${multi ? esc(T.t("（・区切り）")) : ""}</th>${ocOn ? `<th>${esc(T.t("日勤OC（・区切り）"))}</th>` : ""}<th>${esc(shiftLabel(R, "night"))}${multi ? esc(T.t("（・区切り）")) : ""}</th>${ocOn ? `<th>${esc(T.t("夜間OC（・区切り）"))}</th>` : ""}</tr>${Array.from({ length: LB }, (_, i) => ldRow(i)).join("")}</table>
<p class="note">${esc(T.t("連勤の上限・明け・隣接する勤務の規則が、月をまたいで効くように使います。前月の保存データから取り込むと自動で入ります。"))}</p>
${on("period_charge") ? `<p>${esc(L(T.t("前月最後の土日の{charge}担当")))} ${A.nameSel(pm.last_weekend_charge, 'data-path="prev_month.last_weekend_charge"', A.iNames())}　${esc(T.t("その1つ前の土日"))} ${A.nameSel(pm.prev_weekend_charge, 'data-path="prev_month.prev_weekend_charge"', A.iNames())}</p>` : ""}
<p><button id="btnImportPrev">${esc(T.t("前月の保存データから接続・履歴・累計を取り込む"))}</button> <span class="note">${esc(T.t("翌月作成時にも自動で入ります。前月を後から計算し直したときはこのボタンで更新してください（月またぎの担当も自動で固定します）。"))}</span></p></div>`);
    const hs = m.history || {};
    if (on("period_charge")) h.push(`<div class="box"><h3>${esc(L(T.t("前月までの履歴（{charge}）")))}</h3><table class="grid"><tr><th></th>${A.iNames().map(n => `<th>${esc(n)}</th>`).join("")}</tr>
<tr><th>${esc(T.t("土日担当の累計（組。分割は0.5、月またぎは当月側で数える）"))}</th>${A.iNames().map(n => `<td><input type="number" step="0.5" data-hist="weekend_charge:${esc(n)}" value="${hs.weekend_charge?.[n] ?? 0}" style="width:4em"></td>`).join("")}</tr>
<tr><th>${esc(T.t("祝日担当の累計"))}</th>${A.iNames().map(n => `<td><input type="number" data-hist="holiday_charge:${esc(n)}" value="${hs.holiday_charge?.[n] ?? 0}" style="width:4em"></td>`).join("")}</tr></table></div>`);
    { const flags = T.dayFlags ? T.dayFlags.activeFor(R) : [], N = A.daysIn(+m.year, +m.month), hol = new Set((m.holidays || []).map(Number)), hasData = Object.values(m.day_flags || {}).some(v => [].concat(v || []).length) || Object.values(m.day_notes || {}).some(v => v); // 日ごとの区分（プラグインが登録）と予定
      const hdr = `<tr><th>${esc(T.t("日付"))}</th>${flags.map(f => `<th>${f.source ? `<span class="plug">${esc(T.t("プラグイン"))}</span> ` : ""}${esc(T.pickLabel ? T.pickLabel(f.label, f.id) : String(f.label))}</th>`).join("")}<th>${esc(T.t("予定（行事など）"))}</th></tr>`;
      const rowsH = []; for (let d = 1; d <= N; d++) { const w = A.dowOf(+m.year, +m.month, d), holiday = w >= 5 || hol.has(d), fl = [].concat((m.day_flags || {})[d] || []);
        rowsH.push(`<tr class="${holiday && w !== 5 ? "sun" : w === 5 ? "sat" : ""}"><th>${esc(T.t("{d}日（{dow}）", { d, dow: dowJa(w) }))}</th>${flags.map(f => `<td><input type="checkbox" data-dflag="${esc(f.id)}" data-d="${d}" ${fl.includes(f.id) ? "checked" : ""}></td>`).join("")}<td><input data-dnote="${d}" value="${esc((m.day_notes || {})[d] || "")}" style="width:14em"></td></tr>`); }
      h.push(`<div class="box"><details ${hasData || flags.length ? "open" : ""}><summary><b>${esc(T.t("日ごとの区分・予定"))}</b> <span class="note">${esc(T.t("区分の列は施設のプラグインが登録したもの。予定は勤務表の様式が使えれば出ます"))}</span></summary><table class="grid">${hdr}${rowsH.join("")}</table></details></div>`); }
    for (const def of T.RULE_DEFS || []) { const mu = def.ui && def.ui.month; if (!mu || !mu.render || !on(def.id)) continue; // 規則（プラグイン）が月ごとに入れる値の欄（plugin-example/README.md 0c）。「なし」の規則は出さない
      let inner = ""; try { inner = mu.render(R, m); } catch (e) { inner = `<p class="note">${esc(String(e && e.message || e))}</p>`; }
      h.push(`<div class="box" data-rmonth="${esc(def.id)}"><h3>${def.source ? `<span class="plug">${esc(T.t("プラグイン"))}</span> ` : ""}${esc(T.ruleLabel(R, def))}</h3>${inner}</div>`); }
    h.push(`<div class="box"><h3>${esc(T.t("メモ（確認事項など。JSONに保存されます）"))}</h3><textarea data-path="notes" rows="4" style="width:100%">${esc(m.notes || "")}</textarea></div>`);
    $("#monthSettings").innerHTML = h.join(""); $("#monthSettings").dataset.names = A.names().join("|"); // 読み戻し時に名簿の一致を確認する
  }

  function readSettingsMonth() {
    const m = state.month, root = $("#monthSettings"); if (!root.children.length) return;
    if (root.dataset.names !== A.names().join("|")) { renderSettingsMonth(); return; } // 名簿が変わった後の古い画面は読み戻さない
    root.querySelectorAll("[data-path]").forEach(el => {
      const path = el.dataset.path.split("."); let o = m; for (let i = 0; i < path.length - 1; i++) o = (o[path[i]] ||= {});
      const k = path[path.length - 1];
      if (el.type === "checkbox") o[k] = el.checked;
      else if (el.dataset.type === "days") o[k] = A.parseDays(el.value);
      else if (el.type === "number") o[k] = el.value === "" ? undefined : +el.value;
      else o[k] = el.value === "" ? null : el.value;
    });
    if (m.exceptions && m.exceptions.weekend_balance_max_diff === undefined) delete m.exceptions.weekend_balance_max_diff;
    m.targets = {}; root.querySelectorAll("[data-target]").forEach(el => { if (el.value !== "") m.targets[el.dataset.target] = +el.value; });
    if (root.querySelector("[data-dflag],[data-dnote]")) { // 日ごとの区分・予定（画面に出ている分だけ読み戻す。列の無い区分＝プラグインを読んでいない区分は、そのまま残す）
      const shown = new Set([...root.querySelectorAll("[data-dflag]")].map(el => el.dataset.dflag)), old = m.day_flags || {}; m.day_flags = {}; m.day_notes = {};
      for (const [d, ids] of Object.entries(old)) { const keep = [].concat(ids || []).filter(id => !shown.has(id)); if (keep.length) m.day_flags[+d] = keep; }
      root.querySelectorAll("[data-dflag]").forEach(el => { if (el.checked) (m.day_flags[+el.dataset.d] ||= []).push(el.dataset.dflag); });
      root.querySelectorAll("[data-dnote]").forEach(el => { const v = el.value.trim(); if (v) m.day_notes[+el.dataset.dnote] = v; }); }
    m.history ||= {}; m.history.work_balance = {}; root.querySelectorAll("[data-bal]").forEach(el => { if (el.value !== "" && +el.value !== 0) m.history.work_balance[el.dataset.bal] = +el.value; });
    m.prev_month = m.prev_month || {}; m.prev_month.last_days = [];
    root.querySelectorAll("tr[data-ld]").forEach(tr => { const el = f => tr.querySelector(`[data-f="${f}"]`), g = f => (el(f) || {}).value || "", list = f => g(f).split(/[・,、|\n]+/).filter(Boolean);
      const w = f => el(f) && el(f).hasAttribute("data-multi") ? list(f) : g(f); // 複数名の施設は配列
      const date = g("date"); if (!date) return; const e = { date: +date };
      const dw = w("day"), nw = w("night");
      if (dw.length) { e.day = dw; e.day_oc = list("day_oc"); } if (nw.length) { e.night = nw; e.night_oc = list("night_oc"); }
      m.prev_month.last_days.push(e); });
    m.history.weekend_charge = {}; m.history.holiday_charge = {}; root.querySelectorAll("[data-hist]").forEach(el => { const [k, n] = el.dataset.hist.split(":"); if (el.value !== "") m.history[k][n] = +el.value; });
    root.querySelectorAll("[data-rmonth]").forEach(box => { const mu = ((T.RULE_BY_ID[box.dataset.rmonth] || {}).ui || {}).month; if (mu && mu.read) try { mu.read(m, box); } catch (e) { /* プラグインの欄の読み戻しの失敗は、その欄の分だけ前の値のまま */ } }); // 規則（プラグイン）の月ごとの欄
    A.save();
  }

  function bindSettingsMonth() {
    const root = $("#monthSettings");
    root.addEventListener("change", ev => { readSettingsMonth(); if (ev.target.dataset.path === "holidays" || ev.target.dataset.bal) renderSettingsMonth(); });
    root.addEventListener("click", ev => {
      const b = ev.target.closest("button"); if (!b) return;
      readSettingsMonth(); const m = state.month; const id = b.id, del = b.dataset.del;
      if (id === "btnPurgeUnknown") { const unknown = Object.keys(T.monthNameRefs(m)).filter(n => !state.rules.doctors.some(d => d.name === n)); if (!unknown.length) return;
        if (!confirm(T.t("{who} の入力（固定指定・不可・希望・業務・目標）をこの月から消します。よろしいですか", { who: unknown.join("・") }))) return;
        const c = T.purgeMonthNames(m, unknown); A.save(); A.renderAll(); A.toast(T.t("{n} 件の入力を消しました", { n: c })); return; }
      if (id === "btnMonthAdoptProfile") { m.profile_id = (state.rules.profile || {}).id || m.profile_id; A.save(); A.renderAll(); A.toast(T.t("この月を施設「{id}」の月にしました", { id: m.profile_id })); return; }
      if (id === "btnRulesRevertProfile") { A.loadProfileById(m.profile_id); return; }
      if (id === "btnAutoTargets") { const at = T.autoTargets(state.rules, m); m.targets = at.targets; A.toast(at.lines.join(" / ")); }
      else if (id === "btnClearTargets") m.targets = {};
      else if (id === "btnAutoHol") { const a = A.autoCalendar(+m.year, +m.month); m.holidays = a.holidays; m.closure_days = a.closure; m.next_month_first_day_is_holiday = a.nextFirst; A.toast(T.t("祝日・施設の休日: {days}{note}", { days: a.holidays.join(", ") || T.t("なし"), note: a.nextFirst ? T.t("（翌月1日は休日）") : "" })); }
      else if (id === "btnImportPrev") { A.importPrevious(); return; }
      else if (id === "pmExtAdd") { if ($("#pmExtDay").value && $("#pmExtName").value) (m.confirmed_pm_external_night ||= []).push({ day: +$("#pmExtDay").value, name: $("#pmExtName").value }); }
      else if (del === "pmext") m.confirmed_pm_external_night.splice(+b.dataset.i, 1);
      else return;
      A.save(); renderSettingsMonth();
    });
  }

  // ---------- 医師別カレンダー ----------
  function curDoctor() { const list = A.names(); state.ui = state.ui || { doctor: 0 }; if (state.ui.doctor >= list.length) state.ui.doctor = 0; return list[state.ui.doctor]; }
  function unavailPart(m, n, d) { const u = (m.unavailable_other || []).find(x => x.name === n && +x.day === d); if (u) return u.paid ? "paid" : u.part; if ((m.unavailable_night?.[n] || []).includes(d)) return "night"; const a = (m.avoid || []).find(x => x.name === n && +x.day === d); return a ? "avoid_" + (a.part || "allday") : ""; }
  function renderDoctor() {
    const m = state.month; A.ensureMonth(m);
    const n = curDoctor(), y = +m.year, mo = +m.month, N = A.daysIn(y, mo);
    const hol = new Set((m.holidays || []).map(Number));
    const doc = state.rules.doctors.find(d => d.name === n);
    const isDuty = true; // 部長も同じ欄を出す（当直候補でない間はソルバーが無視する）
    const isCand = A.dutyNames().includes(n);
    const dd = m.duty_days[n] || {};
    const kindSel = (d, part) => A.sel([["", "―"], ...kindOpts()], (dd[d] || {})[part] || "", `data-cal="duty" data-d="${d}" data-part="${part}"`);
    const R = state.rules, chargeId = roleOf(R, "charge"), juniorId = roleOf(R, "junior");
    const wishDayOn = T.ruleState(R, "wish_day") !== "off"; // 日勤の希望（規則 wish_day を使う施設だけ欄を出す）
    const ext = T.calendarExt ? T.calendarExt.merged(R) : { fixedTags: [], fields: [], hideDuties: false, paidLeave: false, dayHead: false, symbol: null }; // 施設のプラグインによるカレンダーの拡張（施設の設定で付け外し）
    // 計算結果の記号（勤務表の様式と同じ）。この月の結果があるときだけ
    let symAt = () => ""; if (ext.symbol && state.result && state.result.asg) { try { const PS = new T.Problem(R, m), AS = new T.Asg(PS, state.result.asg); symAt = d => T.calendarExt.symbolHtml(ext.symbol(PS, AS, n, d)); } catch (e) { symAt = () => ""; } }
    const dflags = ext.dayHead && T.dayFlags ? T.dayFlags.activeFor(R) : []; // 日付の見出しで付け外しする日ごとの区分（その日の全員に効く）
    const dayHead = d => !ext.dayHead ? "" : `<div class="calhead">${dflags.map(f => `<label class="calflag" title="${esc(T.t("その日の全員に効きます"))}"><input type="checkbox" data-cal="dflag" data-id="${esc(f.id)}" data-d="${d}" ${[].concat((m.day_flags || {})[d] || []).includes(f.id) ? "checked" : ""}>${esc(T.dayFlags.labelOf(R, f.id))}</label>`).join("")}${(m.day_notes || {})[d] ? `<span class="calnote">${esc(m.day_notes[d])}</span>` : ""}</div>`;
    const fx = m.fixed || {}, isOC = standbyIds(R).includes(doc.team), isI = !!chargeId && doc.team === chargeId;
    // 固定: 休日は日勤帯（日勤・日勤OC・期間責任者）と夜間（夜勤・夜間OC）を別々に選べる。平日は夜間だけ
    const inFx = (tbl, d) => [].concat(tbl?.[d] || []).includes(n); // 勤務者の固定は 1 枠に複数名（文字列か配列）
    const fixedDayVal = d => inFx(fx.day, d) ? "day" : (fx.day_oc?.[d] || []).includes(n) ? "dayoc" : fx.weekend_charge?.[d] === n ? "charge" : "";
    const fixedNightVal = d => inFx(fx.night, d) ? "night" : (fx.night_oc?.[d] || []).includes(n) ? "nightoc" : "";
    const tagSel = (d, k) => { const opts = ext.fixedTags.filter(t => t.shifts.includes(k)).map(t => t.label); if (!opts.length) return ""; // 固定の印の選択肢（施設のプラグインが登録）
      const cur = (m.fixed_tags || {})[`${d}:${k}|${n}`] || ""; return A.sel([["", T.t("印なし")], ...[...new Set(cur ? opts.concat([cur]) : opts)].map(x => [x, x])], cur, `data-cal="ftag" data-d="${d}" data-k="${k}" title="${esc(T.t("固定の印"))}"`); };
    const fixedSel = (d, holiday) => {
      const night = A.sel([["", "―"], ["night", shiftLabel(R, "night")], ...(isOC ? [["nightoc", T.t("夜間OC")]] : [])], fixedNightVal(d), `data-cal="fixed" data-d="${d}" title="${esc(T.t("夜間の固定"))}"`) + tagSel(d, "night");
      if (!holiday) return night;
      const day = A.sel([["", "―"], ["day", shiftLabel(R, "day")], ...(isOC ? [["dayoc", T.t("日勤OC")]] : []), ...(isI ? [["charge", T.term("{charge}担当", R)]] : [])], fixedDayVal(d), `data-cal="fixed" data-d="${d}" title="${esc(T.t("日勤帯の固定"))}"`);
      return `${esc(T.t("日"))}${day}${tagSel(d, "day")} ${esc(T.t("夜"))}${night}`;
    };
    const fieldRows = d => ext.fields.map(f => `<div>${esc(T.pickLabel ? T.pickLabel(f.label, f.id) : f.label)} ${A.sel([["", "―"], ...f.options.map(o => [String(o[0]), T.pickLabel ? T.pickLabel(o[1], String(o[0])) : String(o[1])])], String((((m.person_days || {})[f.id] || {})[n] || {})[d] ?? ""), `data-cal="pfield" data-id="${esc(f.id)}" data-d="${d}"`)}</div>`).join(""); // 施設のプラグインが足した日ごとの欄
    // 不可・避の選択肢: 土日祝は日勤帯を含む全種類、平日は夜勤だけ（平日の日中の不在は午前・午後の「不在」で申告し、カテ室配置の候補から外す）
    // 有給（休みの日数の規則を使う施設だけ）: その日は勤務に入らず、休みの日数にその分を足す
    const paidOpt = T.ruleState(R, "days_off_min") !== "off" || ext.paidLeave ? [["paid", T.t("有給")]] : [];
    const unOpts = dayOn => { const all = [["", "―"], ...paidOpt, ["allday", T.t("不可：日夜両方")], ["day", T.t("不可：日勤帯")], ["night", T.t("不可：夜勤")], ["avoid_allday", T.t("避：日夜両方")], ["avoid_day", T.t("避：日勤帯")], ["avoid_night", T.t("避：夜勤")]]; if (dayOn) return all; return [["", "―"], ...paidOpt, ["night", T.t("不可：夜勤")], ["avoid_night", T.t("避：夜勤")]]; };
    // その日に日勤の枠があるか（2 交代のように平日にも日勤がある施設では、平日も日勤の不可・固定を選べる）
    const shD = T.normalizeShiftsOf(R).find(x => x.id === "day") || { on: "off_days" };
    const dayOn = holi => shD.on === "all" || (shD.on === "weekdays" && !holi) || (shD.on === "off_days" && holi); // 平日の日中の不在は午前・午後の「不在」で申告する（「終日」の選択肢は廃止）
    const cells = [];
    const first = (A.dowOf(y, mo, 1) + 1) % 7;
    for (let i = 0; i < first; i++) cells.push(`<td class="empty"></td>`);
    for (let d = 1; d <= N; d++) {
      const w = A.dowOf(y, mo, d), isSun = w === 6 || hol.has(d), isSat = w === 5 && !hol.has(d);
      cells.push(`<td class="cal ${isSun ? "sun" : isSat ? "sat" : ""}"><div class="dnum">${d}<small>${esc(dowJa(w))}${hol.has(d) ? esc(T.t("祝")) : ""}</small>${symAt(d) ? ` <span class="calres" title="${esc(T.t("計算結果"))}">${symAt(d)}</span>` : ""}</div>${dayHead(d)}
${ext.hideDuties ? "" : `<div>${esc(T.t("午前"))} ${kindSel(d, "am")}</div><div>${esc(T.t("午後"))} ${kindSel(d, "pm")}</div>`}
${isDuty ? `<div>${A.sel(unOpts(dayOn(isSun || isSat)), unavailPart(m, n, d), `data-cal="unavail" data-d="${d}" class="un"`)} <label class="wish"><input type="checkbox" data-cal="wish" data-d="${d}" ${(m.wishes?.night_on?.[n] || []).includes(d) ? "checked" : ""}>${esc(T.t(wishDayOn ? "夜勤希望" : "希望"))}</label>${wishDayOn && dayOn(isSun || isSat) ? ` <label class="wish"><input type="checkbox" data-cal="wishday" data-d="${d}" ${(m.wishes?.day_on?.[n] || []).includes(d) ? "checked" : ""}>${esc(T.t("日勤希望"))}</label>` : ""}</div><div>${esc(T.t("固定"))} ${fixedSel(d, dayOn(isSun || isSat))}</div>` : ""}${isDuty ? fieldRows(d) : ""}</td>`);
      if ((first + d) % 7 === 0 && d < N) cells.push("</tr><tr>");
    }
    // 翌月1日の欄（業務のみ。月末の夜勤・夜間OCの翌日制約に使う。曜日パターンからの推定が入っているので、翌月の業務が分かれば直す）
    if ((first + N) % 7 === 0) cells.push("</tr><tr>");
    { const nd = N + 1, w = (A.dowOf(y, mo, N) + 1) % 7, nh = !!m.next_month_first_day_is_holiday; cells.push(`<td class="cal next"><div class="dnum">${esc(T.t("翌{m}/1", { m: mo === 12 ? 1 : mo + 1 }))}<small>${esc(dowJa(w))}${nh && w < 5 ? esc(T.t("祝")) : ""}</small></div><div>${esc(T.t("午前"))} ${kindSel(nd, "am")}</div><div>${esc(T.t("午後"))} ${kindSel(nd, "pm")}</div>${isDuty ? `<div>${esc(T.t("固定"))} ${fixedSel(nd, dayOn(w >= 5 || nh))}</div>` : ""}<div class="note">${esc(T.t("翌月1日（月末の判定用。固定は翌月へ引き継ぐ）"))}</div></td>`); }
    const rem = (first + N + 1) % 7; if (rem) for (let i = rem; i < 7; i++) cells.push(`<td class="empty"></td>`);
    const pats = (m.regular_duties?.[n] || []);
    const list = A.names();
    $("#doctorPane").dataset.doctor = n;
    $("#doctorPane").innerHTML = `<div class="box">
<div class="docnav"><button id="docPrev">◀ ${esc(T.t("前の{person}"))}</button> ${A.sel(list.map((x, i) => [i, x]), state.ui.doctor, 'id="docSel"')} <button id="docNext">${esc(T.t("次の{person}"))} ▶</button>
　<span class="note">${esc((T.roleLabels(R) || {})[doc.team] || doc.team)}${(R.profile || {}).quota_mode === "share" ? `　${esc(T.t("比重 {n}", { n: doc.share ?? 1 }))}` : doc.quota ? `　${esc(T.t("目安 {n} 回", { n: doc.quota }))}` : ""}${doc.cath ? `　${esc(T.term(T.t("専門業務（{role}）", { role: doc.cath === "I" ? "{charge}" : "{other}" }), R))}` : ""}${!isCand ? `　<b>${esc(T.t(doc.duty === "never" ? "当番は配置禁止" : "当番は原則配置しない"))}</b>${esc(T.t("（不可・希望・固定は記録のみ"))}${doc.duty === "no_unless_needed" ? esc(T.t("。月の設定で候補に含めると有効")) : ""}${esc(T.t("）"))}` : ""}</span>
　${isDuty && T.ruleState(R, "wish_weekend_dayshift") !== "off" ? `<label><input type="checkbox" id="wkwish" ${(m.wishes?.weekend_dayshift || []).includes(n) ? "checked" : ""}> ${esc(T.t("休日のいずれかの日勤（できれば）"))}</label>` : ""}</div>
<table class="calendar"><tr><th class="sun">${esc(dowJa(6))}</th>${[0, 1, 2, 3, 4].map(i => `<th>${esc(dowJa(i))}</th>`).join("")}<th class="sat">${esc(dowJa(5))}</th></tr><tr>${cells.join("")}</tr></table>
<p class="note">${esc(T.t("（1 枠に複数名の施設や平日にも日勤がある施設では、固定と不可の選択肢は勤務帯と枠の人数の設定に従います。）"))} ${esc(T.t("午前・午後: 外来・病棟番・外勤を置く。「不在」＝長期休暇・出張などでその時間帯に勤務しない申告（専門業務の候補から除外。夜勤・OCの翌日制約や不可には影響しないので、夜勤も無理なら不可を別に申告）。不可・避の欄: 「日夜両方」＝その日の日勤・夜勤とそのOCの不可（前夜からの担当は含めない。未明から不可なら前日も不可にする）、「日勤帯」＝日勤とそのOCのみ不可、「夜勤」＝その日から始まる夜勤・夜間OCの不可（日付だけの申告はこれ）。希望＝その日の夜勤の希望。固定＝その日の枠にこの人を必ず置く（作成責任者の指定。休日は日勤帯と夜間を別々に固定でき、日勤＋夜間OC のような組合せも指定できる。同じ枠に2人は置けない）。「避：…」＝できれば避けたい日（調整目標。その時間帯の勤務・OCを減点で避けるが、申告した人の勤務回数が参照解（避けたい日を無視した計算）の回数を下回る分には大きな減点が付き、申告で負担は減らない。曜日の希望、例えば「平日夜勤は水曜に」は、他の曜日の夜勤を「避：夜勤」にする。曜日パターンの「避：…」は平日だけに展開し、土日祝はここで個別に指定する。平日は夜勤だけ選べる。平日の日中の不在は午前・午後の「不在」で申告する）"))}</p>
<details><summary>${esc(T.t("曜日パターン（下書き。展開するとカレンダーを上書き）"))}</summary>
<table class="grid" id="patTbl"><tr><th>${esc(T.t("種別"))}</th><th>${esc(T.t("曜日"))}</th><th>${esc(T.t("時間帯（避：…では無視。避：…は平日だけに展開）"))}</th><th>${esc(T.t("第n曜日（例 2,4。空欄＝毎週）"))}</th><th>${esc(T.t("翌月へ引き継ぐ"))}</th><th></th></tr>
${pats.map((it, i) => `<tr data-i="${i}"><td>${A.sel(Object.entries(PAT_KINDS()), it.kind, 'data-f="kind"')}</td><td>${A.sel(DOWS.map((d, i) => [d, dowJa(i)]), it.dow, 'data-f="dow"')}</td><td>${A.sel(Object.entries(PARTS()), it.part || "full", 'data-f="part"')}</td><td><input data-f="nth" value="${(it.nth || []).join(",")}" style="width:6em"></td><td style="text-align:center"><input type="checkbox" data-f="carry" ${it.carry ? "checked" : ""} title="${esc(T.t("翌月を作るとき、このパターンを引き継いで展開する（避けたい日の曜日希望などに）"))}"></td><td><button data-act="patDel">${esc(T.t("削除"))}</button></td></tr>`).join("")}
</table>
<p><button data-act="patAdd">${esc(T.t("行を追加"))}</button> <button data-act="patExpand">${esc(T.t("パターンをカレンダーに展開（{who} の業務と避けたい日を上書き）", { who: n }))}</button> <label><input type="checkbox" id="patHol" ${m.duties_on_holidays ? "checked" : ""}> ${esc(T.t("土日祝にも展開する"))}</label> <button data-act="calClear">${esc(T.t("{who} の業務を全消去", { who: n }))}</button></p>
</details></div>`;
  }

  function readDoctor() {
    const m = state.month, R = state.rules, root = $("#doctorPane"); if (!root.children.length) return;
    const n = root.dataset.doctor; // 描画したときの医師（名簿の並べ替え・改名の後に別人へ書き戻さないため）
    if (!n || !A.names().includes(n)) { renderDoctor(); return; }
    const dd = Object.assign({}, m.duty_days[n] || {}), seen = new Set(); // 出している日だけ作り直す（業務欄を隠す施設では当月の分を残し、翌月 1 日の欄だけ読む）
    root.querySelectorAll('[data-cal="duty"]').forEach(el => { const d = +el.dataset.d; if (!seen.has(d)) { seen.add(d); delete dd[d]; } if (el.value) (dd[d] ||= {})[el.dataset.part] = el.value; });
    m.duty_days[n] = dd;
    {
      const nights = [], others = [], avoids = [];
      root.querySelectorAll('[data-cal="unavail"]').forEach(el => { const d = +el.dataset.d; if (el.value.startsWith("avoid_")) avoids.push({ name: n, day: d, part: el.value.slice(6) }); else if (el.value === "night") nights.push(d); else if (el.value === "paid") others.push({ name: n, day: d, part: "allday", paid: true }); else if (el.value) others.push({ name: n, day: d, part: el.value }); });
      m.unavailable_night[n] = nights;
      m.unavailable_other = (m.unavailable_other || []).filter(u => u.name !== n).concat(others);
      m.avoid = (m.avoid || []).filter(u => u.name !== n).concat(avoids); if (!m.avoid.length) delete m.avoid;
      const wishes = []; root.querySelectorAll('[data-cal="wish"]').forEach(el => { if (el.checked) wishes.push(+el.dataset.d); });
      m.wishes.night_on = m.wishes.night_on || {};
      if (wishes.length) m.wishes.night_on[n] = wishes; else delete m.wishes.night_on[n];
      if (root.querySelector('[data-cal="wishday"]')) { const wishesDay = []; root.querySelectorAll('[data-cal="wishday"]').forEach(el => { if (el.checked) wishesDay.push(+el.dataset.d); }); // 日勤の希望（規則 wish_day を使う施設。欄を出していないときは前の値のまま）
        m.wishes.day_on = m.wishes.day_on || {}; if (wishesDay.length) m.wishes.day_on[n] = wishesDay; else delete m.wishes.day_on[n]; }
      const wk = new Set(m.wishes.weekend_dayshift || []); const cb = $("#wkwish"); if (cb) { if (cb.checked) wk.add(n); else wk.delete(n); } m.wishes.weekend_dayshift = A.names().filter(x => wk.has(x));
      // 固定: この医師の分をいったん外してから、カレンダーの選択で入れ直す
      const fx = m.fixed; const dropIn = tbl => { for (const d of Object.keys(tbl || {})) if (tbl[d] === n) delete tbl[d]; }; const dropArr = tbl => { for (const d of Object.keys(tbl || {})) { tbl[d] = tbl[d].filter(x => x !== n); if (!tbl[d].length) delete tbl[d]; } };
      const dropWork = tbl => { for (const d of Object.keys(tbl || {})) { const rest = [].concat(tbl[d] || []).filter(x => x !== n); if (!rest.length) delete tbl[d]; else tbl[d] = rest.length === 1 ? rest[0] : rest; } }; // 勤務者の固定（文字列か配列）から自分を外す
      const keptTags = {}; for (const [key, tg] of Object.entries(m.fixed_tags || {})) if (key.split("|")[1] === n) keptTags[key] = tg; // 自分の印は、固定し直した枠の分だけ残す
      dropWork(fx.day); dropWork(fx.night); dropIn(fx.weekend_charge); dropArr(fx.day_oc ||= {}); dropArr(fx.night_oc ||= {});
      const conflicts = []; let P0 = null; try { P0 = new T.Problem(R, m); } catch (e) { }
      const addWork = (tbl, d, kind) => { const cur = [].concat(tbl[d] || []), cap = P0 ? P0.countOf([d, kind]) : 1; // 枠の人数まで固定できる（1 名の枠は従来どおり衝突）
        if (cur.length >= cap) { conflicts.push(T.t("{d}日 {slot}は {who} が固定済み", { d, slot: shiftLabel(R, kind), who: cur.join(T.nameSep()) })); return; }
        cur.push(n); tbl[d] = cur.length === 1 ? cur[0] : cur; };
      root.querySelectorAll('[data-cal="fixed"]').forEach(el => { const d = +el.dataset.d, v = el.value; if (!v) return;
        if (v === "day") addWork(fx.day, d, "day");
        else if (v === "night") addWork(fx.night, d, "night");
        else if (v === "charge") { if (fx.weekend_charge[d] && fx.weekend_charge[d] !== n) conflicts.push(T.term(T.t("{d}日 {charge}担当は {who} が固定済み", { d, who: fx.weekend_charge[d] }), R)); else fx.weekend_charge[d] = n; }
        else if (v === "dayoc") { (fx.day_oc[d] ||= []).push(n); } else if (v === "nightoc") { (fx.night_oc[d] ||= []).push(n); } });
      m.fixed_tags ||= {}; for (const key of Object.keys(keptTags)) { const [sl] = key.split("|"), [dd, kk] = sl.split(":"); if (![].concat((fx[kk] || {})[+dd] || []).includes(n)) delete m.fixed_tags[key]; }
      root.querySelectorAll('[data-cal="ftag"]').forEach(el => { const d = +el.dataset.d, k = el.dataset.k, key = `${d}:${k}|${n}`; // 固定の印（選択肢があるカレンダー）
        if (el.value && [].concat((fx[k] || {})[d] || []).includes(n)) m.fixed_tags[key] = el.value; else delete m.fixed_tags[key]; });
      root.querySelectorAll('[data-cal="dflag"]').forEach(el => { const d = +el.dataset.d, id = el.dataset.id; m.day_flags ||= {}; const cur = new Set([].concat(m.day_flags[d] || [])); // 日付の見出しの区分（その日の全員に効く）
        if (el.checked) cur.add(id); else cur.delete(id); if (cur.size) m.day_flags[d] = [...cur]; else delete m.day_flags[d]; });
      if (root.querySelector('[data-cal="pfield"]')) { m.person_days ||= {}; const got = {}; // 施設のプラグインが足した日ごとの欄（この人の分を作り直す）
        root.querySelectorAll('[data-cal="pfield"]').forEach(el => { const id = el.dataset.id; got[id] ||= {}; if (el.value !== "") got[id][+el.dataset.d] = el.value; });
        for (const [id, byDay] of Object.entries(got)) { m.person_days[id] ||= {}; if (Object.keys(byDay).length) m.person_days[id][n] = byDay; else delete m.person_days[id][n]; } }
      if (conflicts.length) { A.toast(T.t("固定できません: {list}", { list: conflicts.join(T.listSep()) })); setTimeout(renderDoctor, 0); }
    }
    const pats = []; root.querySelectorAll("#patTbl tr[data-i]").forEach(tr => { const g = f => tr.querySelector(`[data-f="${f}"]`).value; const it = { kind: g("kind"), dow: g("dow"), part: g("part") }; const nth = A.parseDays(g("nth")); if (nth.length) it.nth = nth; const cb = tr.querySelector('[data-f="carry"]'); if (cb && cb.checked) it.carry = true; pats.push(it); });
    m.regular_duties[n] = pats;
    A.save();
  }

  function bindDoctor() {
    const root = $("#doctorPane");
    root.addEventListener("change", ev => { if (ev.target.id === "docSel") { readDoctor(); state.ui.doctor = +ev.target.value; A.save(); renderDoctor(); } else readDoctor(); });
    root.addEventListener("click", ev => {
      const b = ev.target.closest("button"); if (!b) return;
      readDoctor(); const m = state.month, n = curDoctor(), list = A.names();
      if (b.id === "docPrev") state.ui.doctor = (state.ui.doctor + list.length - 1) % list.length;
      else if (b.id === "docNext") state.ui.doctor = (state.ui.doctor + 1) % list.length;
      else if (b.dataset.act === "patAdd") m.regular_duties[n].push({ kind: "outpatient", dow: "Mon", part: "full" });
      else if (b.dataset.act === "patDel") m.regular_duties[n].splice(+b.closest("tr").dataset.i, 1);
      else if (b.dataset.act === "patExpand") { const mm = Object.assign({}, m, { duties_on_holidays: $("#patHol").checked }); m.duty_days[n] = T.expandDuties(state.rules, mm, [n])[n]; m.avoid = (m.avoid || []).filter(u => u.name !== n).concat(T.expandAvoid(state.rules, mm, [n])[n] || []); if (!m.avoid.length) delete m.avoid; }
      else if (b.dataset.act === "calClear") { if (!confirm(T.t("{who} の当月の業務をすべて消します", { who: n }))) return; m.duty_days[n] = {}; }
      else return;
      A.save(); renderDoctor();
    });
  }

  // 表示中の画面だけ読み戻す（隠れている画面の DOM は古いことがあり、読み戻すと他の画面で入れた固定などを消してしまう。隠れた画面は表示時に描き直す）
  function readAll() { const vis = id => { const e = $("#" + id); return e && !e.hidden; }; if (vis("monthSettings")) readSettingsMonth(); if (vis("doctorPane")) readDoctor(); if (vis("fixedPane")) readFixed(); }

  // ---------- 固定配置（決定済みの配置をまとめて入力する画面。{person}別カレンダーの「固定」欄と同じデータを枠ごとに編集） ----------
  const NONE_Y = "__noneY__";
  function renderFixed() {
    const m = state.month; A.ensureMonth(m);
    const y = +m.year, mo = +m.month, N = A.daysIn(y, mo), hol = new Set((m.holidays || []).map(Number));
    const fx = m.fixed, R = state.rules;
    const chargeId = roleOf(R, "charge"), juniorId = roleOf(R, "junior");
    const cand = A.dutyNames(), iN = chargeId ? R.doctors.filter(d => d.team === chargeId).map(d => d.name) : [], yN = juniorId ? R.doctors.filter(d => d.team === juniorId).map(d => d.name) : [];
    let P0 = null; try { P0 = new T.Problem(R, m); } catch (e) { } // 日勤の欄は「休日か」ではなく「その日に日勤の枠があるか」（2 交代は平日にもある）
    const teamOf = n => (R.doctors.find(d => d.name === n) || {}).team;
    const pick = (arr, team) => (arr || []).find(n => teamOf(n) === team) || "";
    const nameOpts = [["", "―"], ...cand.map(n => [n, n])], iOpts = [["", "―"], ...iN.map(n => [n, n])], yOpts = [["", T.t("―（自動）")], ...yN.map(n => [n, n]), [NONE_Y, T.term(T.t("{junior}OCなし（追加しない）"), R)]];
    const rows = [];
    for (let d = 1; d <= N + 1; d++) {
      const next = d > N, w = next ? (A.dowOf(y, mo, N) + 1) % 7 : A.dowOf(y, mo, d);
      const holiday = next ? (w >= 5 || !!m.next_month_first_day_is_holiday) : (w >= 5 || hol.has(d));
      const label = next ? T.t("翌{m}/1（{dow}{hol}）", { m: mo === 12 ? 1 : mo + 1, dow: dowJa(w), hol: holiday && w < 5 ? T.t("祝") : "" }) : T.t("{d}日（{dow}{hol}）", { d, dow: dowJa(w), hol: hol.has(d) ? T.t("祝") : "" });
      const cls = holiday && w !== 5 ? "sun" : w === 5 ? "sat" : "";
      const S = (opts, val, k) => A.sel(opts, val, `data-fx="${k}" data-d="${d}"`);
      const multi = T.isMultiWork(R); // 1 枠に複数名の施設は、勤務者を「・」区切りで書く（前月末の接続と同じ）
      const tagOf = (k, n) => (m.fixed_tags || {})[`${d}:${k}|${n}`] || "";
      const SW = (val, k) => multi ? `<input data-fx="${k}" data-d="${d}" data-multi value="${esc([].concat(val || []).map(n => tagOf(k, n) ? `${n}(${tagOf(k, n)})` : n).join(T.nameSep()))}" style="width:14em" placeholder="${esc(T.t("名前・名前(印)"))}">` : S(nameOpts, [].concat(val || [])[0] || "", k);
      const yVal = tbl => (juniorId && (fx[tbl + "_none"]?.[d] || []).includes(juniorId)) ? NONE_Y : pick(fx[tbl]?.[d], juniorId);
      const daySlot = next ? holiday : (P0 ? P0.slotExists(d, "day") : holiday);
      const dayCells = daySlot ? `<td>${SW(fx.day?.[d], "day")}</td><td>${S(iOpts, pick(fx.day_oc?.[d], chargeId), "dayI")}</td><td>${S(yOpts, yVal("day_oc"), "dayY")}</td>` : `<td class="empty"></td><td class="empty"></td><td class="empty"></td>`;
      rows.push(`<tr class="${cls}"><th>${label}</th>${dayCells}<td>${SW(fx.night?.[d], "night")}</td><td>${S(iOpts, pick(fx.night_oc?.[d], chargeId), "nightI")}</td><td>${S(yOpts, yVal("night_oc"), "nightY")}</td><td>${holiday ? S(iOpts, fx.weekend_charge?.[d] || "", "charge") : ""}</td></tr>`);
    }
        const TM = s2 => T.term(T.t(s2), R), dayL = shiftLabel(R, "day"), nightL = shiftLabel(R, "night");
    $("#fixedPane").innerHTML = `<div class="box"><h3>${esc(T.t("固定配置（決定済みの配置をまとめて入力）"))}</h3>
<p class="note">${esc(TM("すでに決まっている配置を枠ごとに入れる画面です。{person}別カレンダーの「固定」欄と同じデータで、どちらで入れても同じです。空欄（―）は計算で決めます。「{junior}OCなし（追加しない）」は、その枠に{junior}OCを足さない指定です（本来必要な{junior}OCが無い扱いになり、減点 missing_young_oc の対象。結果の第9節に出ます）。{charge}OC・{charge}担当の欄は{charge}だけ、{junior}OCの欄は{junior}だけを選べます。平日は夜勤の欄だけです。最後の行は翌月1日（月末との接続用）。"))}</p>
<table class="grid fixedgrid"><tr><th>${esc(T.t("日付"))}</th><th>${esc(dayL)}</th><th>${esc(TM("{shift} {charge}OC").replace("{shift}", dayL))}</th><th>${esc(TM("{shift} {junior}OC").replace("{shift}", dayL))}</th><th>${esc(nightL)}</th><th>${esc(TM("{shift} {charge}OC").replace("{shift}", nightL))}</th><th>${esc(TM("{shift} {junior}OC").replace("{shift}", nightL))}</th><th>${esc(TM("{charge}担当（土日祝）"))}</th></tr>${rows.join("")}</table>
<p class="note">${esc(T.t("名前の後ろに（ ）で印を書くと、勤務表と説明資料に名前(印)で出ます（例: 研修・会議）。"))}</p>
<p><button data-act="fxClear">${esc(T.t("固定をすべて消去"))}</button> <span class="note">${esc(T.t("入力の矛盾（不可日との衝突、同じ人の勤務とOCの重複など）は「2 計算」の前に具体名で指摘されます。"))}</span></p></div>`;
  }
  function readFixed() {
    const m = state.month, root = $("#fixedPane"); if (!root.children.length) return;
    // 画面に出ている欄だけを読み戻し、出していない項目（この画面に無い枠の固定など）は残す
    const cur = m.fixed || {}, cp = o => Object.assign({}, o || {});
    const fx = { day: cp(cur.day), night: cp(cur.night), weekend_charge: cp(cur.weekend_charge), day_oc: cp(cur.day_oc), night_oc: cp(cur.night_oc), day_oc_none: cp(cur.day_oc_none), night_oc_none: cp(cur.night_oc_none) };
    const TBL = { day: ["day"], night: ["night"], charge: ["weekend_charge"], dayI: ["day_oc", "day_oc_none"], dayY: ["day_oc", "day_oc_none"], nightI: ["night_oc", "night_oc_none"], nightY: ["night_oc", "night_oc_none"] };
    root.querySelectorAll("select[data-fx],input[data-fx]").forEach(el => { for (const t of TBL[el.dataset.fx] || []) delete fx[t][+el.dataset.d]; }); // 出ている欄の分は空にしてから読み戻す
    const splitNames = v => [...new Set(String(v || "").split(/[・,、|\n]+/).map(x => x.trim()).filter(Boolean))]; // 「・」区切り → 名前の配列（1 名なら文字列で保存）。名前に空白があるので空白では切らない
    const tags = Object.assign({}, m.fixed_tags || {}); // 固定の印「名前(印)」。出ている欄の分は作り直す
    root.querySelectorAll("input[data-fx][data-multi]").forEach(el => { const pre = `${+el.dataset.d}:${el.dataset.fx}|`; for (const key of Object.keys(tags)) if (key.startsWith(pre)) delete tags[key]; });
    const nameTag = x => { const mt = x.match(/^(.*?)[\s]*[（(]([^（）()]*)[)）]\s*$/); return mt ? [mt[1].trim(), mt[2].trim()] : [x, ""]; };
    root.querySelectorAll("select[data-fx],input[data-fx]").forEach(el => {
      const d = +el.dataset.d, k = el.dataset.fx, v = el.value; if (!v) return;
      if (k === "day" || k === "night") { const parts = el.hasAttribute("data-multi") ? splitNames(v).map(nameTag) : [[v, ""]]; const ns = [...new Set(parts.map(p => p[0]).filter(Boolean))];
        for (const [n, tg] of parts) if (n && tg) tags[`${d}:${k}|${n}`] = tg;
        if (ns.length) fx[k][d] = ns.length === 1 ? ns[0] : ns; } else if (k === "charge") fx.weekend_charge[d] = v;
      else if (k === "dayI") (fx.day_oc[d] ||= []).push(v); else if (k === "nightI") (fx.night_oc[d] ||= []).push(v);
      else if (k === "dayY") { if (v === NONE_Y) { const j = roleOf(state.rules, "junior"); if (j) fx.day_oc_none[d] = [j]; } else (fx.day_oc[d] ||= []).push(v); }
      else if (k === "nightY") { if (v === NONE_Y) { const j = roleOf(state.rules, "junior"); if (j) fx.night_oc_none[d] = [j]; } else (fx.night_oc[d] ||= []).push(v); }
    });
    m.fixed = fx; m.fixed_tags = tags; A.save();
  }
  function bindFixed() {
    const root = $("#fixedPane");
    root.addEventListener("change", () => readFixed());
    root.addEventListener("click", ev => { const b = ev.target.closest("button"); if (!b || b.dataset.act !== "fxClear") return; if (!confirm(T.t("この月の固定指定をすべて消します。よろしいですか"))) return; state.month.fixed = { day: {}, night: {}, weekend_charge: {}, day_oc: {}, night_oc: {}, day_oc_none: {}, night_oc_none: {} }; A.save(); renderFixed(); });
  }

  Object.assign(A, { renderSettingsMonth, bindSettingsMonth, renderDoctor, bindDoctor, readAll, renderFixed, bindFixed }); // 他のファイルから使う関数
})(globalThis.T = globalThis.T || {}, globalThis.T.app = globalThis.T.app || {});

// 当直表アプリ（画面）: 起動: 画面の組み立て（タブ・イベント）と初期化。デバッグ用の T.* 公開
// app-*.js は T.app（以下 A）を介して互いを参照する。他のファイルの関数・共有変数（A.state, A.dirHandle など）は必ず A. を付ける（build.py --check が検査）。
(function (T, A) {
  const $ = s => document.querySelector(s);
  const state = A.state;

  // ---------- タブ ----------
  function renderAll() { A.renderSettingsMonth(); A.renderDoctor(); A.renderFixed(); A.renderResult(); A.renderSettings(); A.renderFolderBar(); A.renderHeader(); renderHelp(); T.applyI18n(); }
  // ヘルプはその言語の lang ファイル（help）から組み立てる。無い言語は英語（i18n.js の T.help）
  function renderHelp() {
    const box = $("#helpBody"); if (!box) return;
    box.innerHTML = (T.help() || []).map(b => b.kind === "details"
      ? `<details class="box"><summary>${T.esc(b.title)}</summary>${b.html}</details>`
      : `<div class="box"><h3>${T.esc(b.title)}</h3>${b.html}</div>`).join("");
  }
  // 表示言語: 施設の既定（rules.lang）→ このブラウザでの選択（localStorage）の順で決める
  const LANG_KEY = "toban.lang";
  // 選んでいなければ、施設の既定 → ブラウザの言語（日本語以外なら英語）
  function initLang() {
    for (const L of T.LANGS_DATA || []) T.registerLang(L); // 埋め込んだ lang/*.json（データの script は app より先に走る）
    let l = null; try { l = localStorage.getItem(LANG_KEY); } catch (e) { }
    const nav = (navigator.language || "").toLowerCase().startsWith("ja") ? "ja" : "en";
    T.setLang(l || (state.rules || {}).lang || nav);
    const opts = () => T.LANGS().map(([k, label]) => `<option value="${k}"${k === T.lang() ? " selected" : ""}>${label}</option>`).join("");
    // ヘッダーと開始画面の両方に言語の選択を置く（開始画面はヘッダーより前に出るので、そこで選べないと最初の画面が読めない）
    const change = async v => {
      await A.awaitSaves(); // 保存中（帳票の生成・書込み）は終わってから切り替える（同じ版の勤務表と説明資料が別の言語にならない）
      T.setLang(v); try { localStorage.setItem(LANG_KEY, v); } catch (e) { }
      for (const id of ["#langSel", "#startLang"]) { const x = $(id); if (x) x.value = v; }
      A.readAll(); renderAll(); // 役割・勤務帯の表示名もその言語で読み直す
      A.repaintStartGate();
    };
    for (const id of ["#langSel", "#startLang"]) { const x = $(id); if (!x) continue; x.innerHTML = opts(); x.addEventListener("change", () => change(x.value)); }
  }
  function showTab(id) { const r = showTab0(id); T.applyI18n(); return r; }
  function showTab0(id) { const pane = id === "resultCal" ? "result" : id; /* 3-1 結果 と 3-2 医師別カレンダー は同じ #result の中の2画面 */ document.querySelectorAll(".tab").forEach(t => t.classList.toggle("active", t.dataset.tab === id)); document.querySelectorAll(".pane").forEach(p => p.hidden = p.id !== pane); if (pane === "result") A.renderResult(id === "resultCal" ? "resCal" : "resMain"); if (id === "settings") A.renderSettings(); if (id === "input") { A.renderSettingsMonth(); A.renderDoctor(); A.renderFixed(); } }

  function init() {
    const saved = A.load();
    if (saved) Object.assign(state, saved); else { state.rules = JSON.parse(JSON.stringify(T.DEFAULT_RULES)); state.month = T.SAMPLE_MONTH ? JSON.parse(JSON.stringify(T.SAMPLE_MONTH)) : A.blankMonth(new Date().getFullYear(), new Date().getMonth() + 1); }
    if (!state.rules) state.rules = JSON.parse(JSON.stringify(T.DEFAULT_RULES));
    state.ui = state.ui || { doctor: 0 };
    A.ensureMonth(state.month); // 設定の欠損補完と月データの整形（保存データが古い版でも落ちない）
    window.addEventListener("unhandledrejection", ev => { const r = ev.reason; A.toast(T.t("処理に失敗しました: {err}", { err: (r && r.message || r) })); });
    initLang();
    A.bindSettingsMonth(); A.bindDoctor(); A.bindFixed(); A.bindSettings(); renderAll();
    A.restoreFolder();
    window.addEventListener("beforeunload", ev => { if (A.isDirty()) { ev.preventDefault(); ev.returnValue = T.t("未保存の変更があります"); } });
    document.querySelectorAll(".tab").forEach(t => t.addEventListener("click", () => { A.readAll(); showTab(t.dataset.tab); }));
    document.querySelectorAll(".subnav .sub").forEach(b => b.addEventListener("click", () => { A.readAll(); document.querySelectorAll(".subnav .sub").forEach(x => x.classList.toggle("active", x === b)); ["monthSettings", "doctorPane", "fixedPane"].forEach(id => $("#" + id).hidden = id !== b.dataset.sub); if (b.dataset.sub === "doctorPane") A.renderDoctor(); else if (b.dataset.sub === "fixedPane") A.renderFixed(); else A.renderSettingsMonth(); }));
    $("#btnSolve").addEventListener("click", A.runSolve);
    $("#btnCancel").addEventListener("click", () => { if (A.highs && A.highs.terminate) { A.highs.terminate(); A.highs = null; } });
    $("#btnDocx").addEventListener("click", A.downloadDocx);
    $("#docLabel").addEventListener("change", async ev => {
      state.month.doc_label = ev.target.value; A.save();
      if (state.result && state.result.asg) { if (A.dirHandle) { await A.saveToFolder(); A.toast(T.t("表題を「{label}」にして勤務表docxと説明資料を書き直しました", { label: ev.target.value })); } else A.toast(T.t("表題を「{label}」にしました。フォルダ接続中なら保存時にdocxと説明資料へ反映されます", { label: ev.target.value })); }
      else A.toast(T.t("表題を「{label}」にしました（計算後の保存で反映）", { label: ev.target.value }));
    });
    $("#btnReportHtml").addEventListener("click", A.downloadReportHtml);
    $("#btnSaveJson").addEventListener("click", () => { A.readAll(); const at = new Date().toISOString(); A.download(A.dataFileName(), new Blob([A.payloadJson(at)], { type: "application/json" })); A.markSaved("ダウンロード", at); }); // savedWhere は内部の値（表示は whereLabel が訳す）
    $("#fileLoadJson").addEventListener("change", async ev => { const f = ev.target.files[0]; if (!f) return; if (!(await A.saveBeforeSwitch())) { ev.target.value = ""; return; } const rd = new FileReader(); rd.onload = () => { try { A.applyLoaded(JSON.parse(rd.result), T.t("読み込みました")); } catch (e) { alert(T.t("読み込み失敗: {err}", { err: e })); } }; rd.readAsText(f); ev.target.value = ""; });
    $("#fileFromPrev").addEventListener("change", async ev => { const f = ev.target.files[0]; if (!f) return; if (!(await A.saveBeforeSwitch())) { ev.target.value = ""; return; } const rd = new FileReader(); rd.onload = () => { try { const o = JSON.parse(rd.result); if (!o.month) throw new Error(T.t("勤務表データJSONではありません")); if (o.rules) state.rules = o.rules; state.meta = null; state.base = null; state.month = A.fromPrevious(o); state.result = null; state.ui.doctor = 0; A.save(); renderAll(); showTab("input"); A.toast(T.t("{y}年{m}月 を作成しました。祝日・不可日・希望を記入し、業務を確認してください", { y: state.month.year, m: state.month.month })); } catch (e) { alert(T.t("読み込み失敗: {err}", { err: e })); } }; rd.readAsText(f); ev.target.value = ""; });
    $("#btnNewMonth").addEventListener("click", async () => { if (!(await A.saveBeforeSwitch())) return; if (!confirm(T.t("入力を空にして新しい月を作ります。よろしいですか"))) return; const y = +prompt(T.t("年"), state.month.year), mo = +prompt(T.t("月"), (state.month.month % 12) + 1); if (!y || !mo) return; state.meta = null; state.base = null; state.month = A.blankMonth(y, mo); state.result = null; state.ui.doctor = 0; A.save(); renderAll(); showTab("input"); });
    $("#btnSample").addEventListener("click", async () => { if (!T.SAMPLE_MONTH) return; if (!(await A.saveBeforeSwitch())) return; if (!confirm(T.t("サンプル（2026年11月）を読み込みます"))) return; state.rules = JSON.parse(JSON.stringify(T.DEFAULT_RULES)); state.meta = null; state.base = null; state.month = JSON.parse(JSON.stringify(T.SAMPLE_MONTH)); state.result = null; state.ui.doctor = 0; A.ensureMonth(state.month); A.save(); renderAll(); showTab("input"); });
    showTab("input");
    T.applyI18n();
  }

  // デバッグ用（ブラウザのコンソールから状態を確認する。アプリの動作には使わない）
  T.init = init; T.fromPrevious = A.fromPrevious; T.getState = () => state; T._cur = () => JSON.stringify({ rules: state.rules, month: state.month, result: state.result }); T._sig = A.sig; T._find = A.findMonthData; T._reconcile = A.reconcileWithFolder; T._dirty = A.isDirty;
  document.addEventListener("DOMContentLoaded", init);

  Object.assign(A, { renderAll, showTab }); // 他のファイルから使う関数
})(globalThis.T = globalThis.T || {}, globalThis.T.app = globalThis.T.app || {});

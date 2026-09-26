// 当直表アプリ（画面）: フォルダ接続（File System Access API）・開始画面・保存と版の書き出し・別PCとの自動統合・ヘッダー（月の一覧・保存状態）
// app-*.js は T.app（以下 A）を介して互いを参照する。他のファイルの関数・共有変数（A.state, A.dirHandle など）は必ず A. を付ける（build.py --check が検査）。
(function (T, A) {
  const $ = s => document.querySelector(s);
  const esc = T.esc;
  const state = A.state;

  // 保存先の記録（state.meta.savedWhere）は保存データの値なので日本語のまま持ち、表示のときだけ訳す
  const whereLabel = w => { const v = String(w || ""); if (v.startsWith("フォルダ ")) return T.t("フォルダ") + " " + v.slice(5); return T.t(v); };
  function renderHeader() {
    const m = state.month; if (!m) return;
    $("#monthTitle").innerHTML = `${monthSelectHtml()} <span>${esc(T.t("の勤務表を作成中"))}</span> <span class="note">${esc(T.t("施設: {name}", { name: T.pickLabel((state.rules.profile || {}).label, (state.rules.profile || {}).id || "") }))}</span>`;
    const dl = $("#docLabel"); if (dl && dl.value !== (m.doc_label || "確認版")) dl.value = m.doc_label || "確認版";
    bindMonthSelect();
    const el = $("#saveState");
    if (!A.isDirty()) { const at = new Date(state.meta.savedAt), loc = T.dateLocale(); el.className = "saved"; el.innerHTML = esc(T.t("保存済み {date} {time}（{where}）", { date: at.toLocaleDateString(loc, { month: "numeric", day: "numeric" }), time: at.toLocaleTimeString(loc, { hour: "2-digit", minute: "2-digit" }), where: whereLabel(state.meta.savedWhere) })); }
    else { el.className = "dirty"; el.innerHTML = `${esc(T.t("未保存の変更あり"))}${A.dirHandle ? esc(T.t("（数秒後に自動保存）")) : ""} <button id="btnHeaderSave">${esc(T.t(A.dirHandle ? "今すぐ保存" : "接続して保存"))}</button>`; $("#btnHeaderSave").addEventListener("click", () => saveToFolder()); }
  }
  // 別のPCが同じ月を先に保存していないか（保存前の競合検出）。true=保存してよい
  // 3者統合を自動で行う（最後に保存した版を共通の元として、自分の変更と相手の変更を両方残す）。
  // 衝突（同じ項目を両方が変えた）がなければ確認なしで統合し、衝突があるときだけどちらを採るかを聞く。
  // 戻り値: true=統合した（このブラウザの状態は相手の版より新しい扱いになる）, false=利用者がやめた, null=統合できない（共通の元がない）
  async function tryAutoMerge(f, ctx) {
    const base = state.base && state.meta && state.meta.savedTag === A.tag() ? state.base : null;
    if (!base) return null;
    // 相手の版は形を整えてから比べる（旧形式の項目を持ち込まない）
    let theirs; try { theirs = T.normalizeMonth(JSON.parse(JSON.stringify(f.data.month)), f.data.rules || state.rules); } catch (e) { return null; }
    let pre; try { pre = T.mergeMonth(base, state.month, theirs); } catch (e) { return null; }
    let prefer = "theirs";
    if (pre.conflicts.length) {
      const fmtV = v => { if (v === undefined || v === null) return T.t("（なし）"); const paid = /_paid$/.test(String(v)), b = String(v).replace(/_paid$/, "");
        const t = ({ night: T.t("不可：夜勤"), allday: T.t("不可：日夜両方"), day: T.t("不可：日勤帯"), avoid_night: T.t("避：夜勤"), avoid_day: T.t("避：日勤帯"), avoid_allday: T.t("避：日夜両方") })[b] || (typeof v === "object" ? JSON.stringify(v) : String(v)); return paid ? t + T.t("（有給）") : t; };
      const list = pre.conflicts.slice(0, 12).map(c => T.t("・{item}: 自分「{mine}」／相手「{theirs}」", { item: c.label, mine: fmtV(c.mine), theirs: fmtV(c.theirs) })).join("\n") + (pre.conflicts.length > 12 ? T.t("\n…ほか {n} 件", { n: pre.conflicts.length - 12 }) : "");
      const w = await A.choose(T.t("{ctx}別のPC（または別のウィンドウ）でも {tag} が変更されていました（保存 {at}）。自分の変更 {mine} 件と相手の変更 {theirs} 件を自動で統合しますが、同じ項目を両方が変えた衝突が {n} 件あります。衝突した項目はどちらを採りますか。\n{list}", { ctx: T.t(ctx), tag: A.tag(), at: new Date(f.data.saved_at).toLocaleString(T.dateLocale()), mine: pre.mineChanges, theirs: pre.theirChanges, n: pre.conflicts.length, list }), [{ label: T.t("衝突は相手の値を採る（推奨）"), sub: T.t("通常はフォルダのファイル側が最新です。衝突以外の項目は両方の変更がそのまま残ります"), value: "theirs", primary: true }, { label: T.t("衝突は自分の値を採る"), sub: T.t("例: いま本人から直接聞いた不可日を入れたばかりで、相手の値のほうが古いと分かっているとき"), value: "mine" }, { label: T.t("やめる（統合しない）"), sub: T.t("自動保存は止まります。ヘッダーの保存で再確認できます"), value: null, cancel: true }]);
      if (!w) return false; prefer = w;
    }
    // 設定（名簿・規則・重み）も共通の元と比べる: 相手だけ変えたなら相手の、自分だけ変えたなら自分の、両方なら聞く
    let rulesPick = "theirs";
    if (f.data.rules) { const noBase = !state.baseRules; // 旧版の保存状態には共通の元の設定が無い: 比較元不明なので、設定が違えば聞く
      const mineCh = noBase ? A.rulesSig(state.rules) !== A.rulesSig(f.data.rules) : A.rulesSig(state.rules) !== A.rulesSig(state.baseRules), theirsCh = noBase ? mineCh : A.rulesSig(f.data.rules) !== A.rulesSig(state.baseRules);
      if (!theirsCh) rulesPick = "mine";
      else if (mineCh) { const w = await A.choose(T.t("設定（名簿・規則・重み）が、このブラウザと別のPCの両方で変わっています。どちらの設定を使いますか。月の入力は自動で統合します。"),
        [{ label: T.t("相手の設定を使う"), sub: T.t("このブラウザで変えた設定は消えます"), value: "theirs", primary: true }, { label: T.t("自分の設定を使う"), sub: T.t("相手が変えた設定は消えます"), value: "mine" }, { label: T.t("何もしない（後で判断）"), value: null, cancel: true }]);
        if (!w) return false; rulesPick = w; } }
    const r = T.mergeMonth(base, state.month, theirs, prefer);
    const theirResult = f.data.result, mineResult = state.result;
    state.month = r.merged; state.ui.doctor = 0;
    state.result = (theirResult && (!mineResult || (theirResult.at || "") > (mineResult.at || ""))) ? theirResult : mineResult;
    if (f.data.rules && rulesPick === "theirs") state.rules = f.data.rules;
    // 相手の版を「見た」ことにし、次の保存で統合結果を書き戻す（共通の元は相手の版になる）
    state.meta = Object.assign({}, state.meta || {}, { savedAt: f.data.saved_at || "", savedTag: A.tag() }); state.base = JSON.parse(JSON.stringify(theirs)); if (f.data.rules) state.baseRules = JSON.parse(JSON.stringify(f.data.rules));
    A.ensureMonth(state.month); A.persist(); A.renderAll();
    A.toast(T.t("別のPCの変更と自動で統合しました（自分 {mine} 件、相手 {theirs} 件、衝突 {n} 件）。入力が変わったので必要なら再計算してください", { mine: r.mineChanges, theirs: r.theirChanges, n: r.conflicts.length }));
    return true;
  }
  async function checkConflict() {
    const f = await findMonthData(A.tag());
    if (!f.data && f.corrupt) { A.toast(T.t("フォルダの {file} が壊れていて読めません（{err}）。上書きしないよう保存を止めました。ファイルを退避してから保存してください", { file: f.corrupt, err: f.error })); return false; }
    if (!f.data) return true; // フォルダにまだ無い月
    const fileAt = f.data.saved_at || "", mineAt = (state.meta && state.meta.savedTag === A.tag() && state.meta.savedAt) || "";
    if (fileAt && fileAt === mineAt) return true; // 自分が最後に同期した版そのもの（時刻の大小は使わない: 別PCの時計がずれていても同じ版でなければ統合か確認に回す）
    const m = await tryAutoMerge(f, T.t("保存しようとしたところ、"));
    if (m === true) return true; if (m === false) return false;
    // 共通の元がなく統合できないときだけ、どちらを採るか聞く
    const opts = [];
    opts.push({ label: T.t("相手の保存データを読み込む（推奨）"), sub: T.t("通常はフォルダのファイル側が最新です。このブラウザの未保存の変更は捨てます（必要なら読み込んだあとで入れ直す）"), value: "load", primary: true });
    opts.push({ label: T.t("このブラウザの状態で上書きする"), sub: T.t("相手の変更は消えます。例: 相手の保存が誤操作や古い試作と分かっていて、こちらの入力が最新のとき"), value: "overwrite" });
    opts.push({ label: T.t("何もしない（後で判断）"), sub: T.t("自動保存は止まります。ヘッダーの保存で再確認できます"), value: null, cancel: true });
    const v = await A.choose(T.t("別のPC（または別のウィンドウ）で {tag} が保存されています（保存 {at}）。このブラウザの状態はそれより前のもので、自動統合の元になる版がありません。", { tag: A.tag(), at: new Date(fileAt).toLocaleString(T.dateLocale()) }), opts);
    if (v === "load") { applyLoaded(f.data, T.t("{where} を読み込みました", { where: f.where })); return false; }
    return v === "overwrite";
  }
  async function autosaveJson() { return A.serialized(autosaveCore); }
  async function autosaveCore() { // 返り値: "saved" / "skipped" / "failed"
    if (!A.dirHandle || !A.isDirty()) return "skipped";
    if (!(await checkConflict())) return "skipped";
    try { const at = new Date().toISOString(), snap = A.snapshot(at); const dir = await A.dirHandle.getDirectoryHandle(A.tag(), { create: true }); await writeFile(dir, A.dataFileName(), new Blob([snap.payload], { type: "application/json" })); A.markSaved(undefined, at, snap); return "saved"; }
    catch (e) { renderHeader(); A.toast(T.t("自動保存に失敗しました: {err}。入力はブラウザ内に残っています", { err: e && e.message || e })); return "failed"; }
  }

  // ---------- フォルダ（File System Access API） ----------
  const fsOK = () => typeof window.showDirectoryPicker === "function";

  // フォルダの参照を IndexedDB に保存し、次回はワンクリックで再接続（権限が残っていれば自動）
  function idb() { return new Promise((res, rej) => { const r = indexedDB.open("toban", 1); r.onupgradeneeded = () => r.result.createObjectStore("kv"); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); }
  async function idbGet(k) { try { const db = await idb(); return await new Promise((res, rej) => { const t = db.transaction("kv").objectStore("kv").get(k); t.onsuccess = () => res(t.result); t.onerror = () => rej(t.error); }); } catch (e) { return null; } }
  async function idbSet(k, v) { try { const db = await idb(); await new Promise((res, rej) => { const t = db.transaction("kv", "readwrite").objectStore("kv").put(v, k); t.onsuccess = () => res(); t.onerror = () => rej(t.error); }); } catch (e) { } }
  // file:// で開いているとき: このHTMLがあるフォルダの URL（月フォルダの一覧をブラウザで表示するのに使う）
  function htmlDirUrl() { if (location.protocol !== "file:") return null; return location.href.replace(/[^/]*$/, ""); }
  function htmlFolderName() { try { const parts = decodeURIComponent(location.pathname).split("/").filter(Boolean); return parts.length >= 2 ? parts[parts.length - 2] : ""; } catch (e) { return ""; } }
  // 開始画面: フォルダ接続に必要な「利用者の操作」を開始ボタンで確保する（ページ読込だけでは許可を求められない）
  // msg とボタンの label は文字列か、いまの言語で文面を返す関数。開始画面の言語を切り替えると描き直す
  let gatePaint = null;
  const repaintStartGate = () => { if (gatePaint && !$("#startGate").hidden) gatePaint(); };
  function showStartGate(msg, btns) {
    return new Promise(resolve => {
      const g = $("#startGate"), box = $("#startBtns"), val = v => (typeof v === "function" ? v() : v);
      const paint = () => { $("#startMsg").textContent = val(msg); box.querySelectorAll("button").forEach((el, i) => { el.textContent = val(btns[i].label); }); T.applyI18n(g); };
      gatePaint = paint;
      $("#startMsg").textContent = val(msg); box.innerHTML = "";
      for (const b of btns) {
        const el = document.createElement("button"); el.textContent = val(b.label); if (b.primary) el.className = "primary"; if (b.cancel) el.className = "cancel";
        el.addEventListener("click", async () => { el.disabled = true; let ok = false; try { ok = await b.run(); } catch (e) { ok = false; } el.disabled = false; if (ok) { g.hidden = true; renderFolderBar(); resolve(); } });
        box.appendChild(el);
      }
      g.hidden = false; T.applyI18n(g);
    });
  }
  async function restoreFolder() {
    if (!fsOK()) return renderFolderBar();
    A.storedHandle = (await idbGet(A.DIR_KEY)) || (await idbGet("dir")); // 旧キーも見る
    const noFolder = { label: T.t("フォルダなしで続ける（保存はダウンロードになります。通常は使いません）"), cancel: true, run: async () => true };
    // ブラウザ内に残っている状態（月・設定・結果）を捨てて、同梱のサンプルから始める。フォルダの接続先は残す
    const fresh = { label: () => T.t("ブラウザ内の保存を消して最初から始める"), cancel: true, run: async () => {
      if (!confirm(T.t("このブラウザに残っている入力・設定・計算結果を消して、同梱のサンプルから始めます。フォルダに保存済みのデータは消えません。よろしいですか"))) return false;
      A.resetBrowserState(); location.reload(); return false; } };
    const openOther = { label: T.t("別のフォルダを開く"), run: async () => { await openFolder(); return !!A.dirHandle; } };
    if (A.storedHandle) {
      try { if ((await A.storedHandle.queryPermission({ mode: "readwrite" })) === "granted") { A.dirHandle = A.storedHandle; await refreshMonths(); A.toast(T.t("フォルダ「{name}」に接続しました", { name: A.dirHandle.name })); await reconcileWithFolder(); renderFolderBar(); return; } } catch (e) { A.dirHandle = null; A.toast(T.t("前回のフォルダに接続できませんでした: {err}", { err: e && e.message || e })); }
      await showStartGate(() => T.t("前回の保存フォルダ「{name}」に再接続してから始めます。\n「開始」を押すと、ブラウザがフォルダへの保存の許可を求めることがあります。許可してください。", { name: A.storedHandle.name }), [
        { label: () => T.t("開始（フォルダ「{name}」に再接続）", { name: A.storedHandle.name }), primary: true, run: async () => { try { if ((await A.storedHandle.requestPermission({ mode: "readwrite" })) === "granted") { A.dirHandle = A.storedHandle; await refreshMonths(); $("#startGate").hidden = true; A.toast(T.t("フォルダ「{name}」に再接続しました", { name: A.dirHandle.name })); await reconcileWithFolder(); return true; } } catch (e) { A.dirHandle = null; } A.toast(T.t("再接続できませんでした。「別のフォルダを開く」で保存フォルダを選び直してください")); return false; } },
        Object.assign({}, openOther, { label: () => T.t("別のフォルダを開く") }), Object.assign({}, noFolder, { label: () => T.t("フォルダなしで続ける（保存はダウンロードになります。通常は使いません）") }), fresh,
      ]);
    } else {
      await showStartGate(() => T.t("保存フォルダを開いてから始めます。このHTMLと同じ場所にある月ごとのフォルダの親（例: 勤務表）を選んでください。"), [
        { label: () => T.t("フォルダを開いて開始"), primary: true, run: async () => { await openFolder(); return !!A.dirHandle; } },
        Object.assign({}, noFolder, { label: () => T.t("フォルダなしで続ける（保存はダウンロードになります。通常は使いません）") }), fresh,
      ]);
    }
    renderFolderBar();
  }
  async function reconnectFolder() {
    if (!A.storedHandle) return openFolder();
    try { if ((await A.storedHandle.requestPermission({ mode: "readwrite" })) === "granted") { A.dirHandle = A.storedHandle; await refreshMonths(); A.toast(T.t("フォルダ「{name}」に再接続しました", { name: A.dirHandle.name })); await reconcileWithFolder(); return; } } catch (e) { A.dirHandle = null; A.toast(T.t("再接続できませんでした: {err}", { err: e && e.message || e })); }
    openFolder();
  }
  async function openFolder() {
    if (!fsOK()) return alert(T.t("このブラウザではフォルダを直接開けません（Edge/Chrome で開いてください）。ダウンロードと「データを読込」で代用できます。"));
    try { A.dirHandle = await window.showDirectoryPicker({ id: "toban-root", mode: "readwrite", startIn: A.storedHandle || "documents" }); } catch (e) { return; }
    A.storedHandle = A.dirHandle; await idbSet(A.DIR_KEY, A.dirHandle);
    try { await refreshMonths(); await reconcileWithFolder(); } catch (e) { A.dirHandle = null; renderFolderBar(); return A.toast(T.t("フォルダを読めませんでした: {err}", { err: e && e.message || e })); }
    A.toast(T.t("フォルダ「{name}」を開きました", { name: A.dirHandle.name }));
  }
  let pluginsFor = null; // plugins/ を読んだフォルダ（接続したフォルダごとに 1 回）
  async function refreshMonths() {
    A.monthDirs = [];
    if (!A.dirHandle) return renderFolderBar();
    for await (const [name, h] of A.dirHandle.entries()) if (h.kind === "directory" && /^\d{6}/.test(name)) A.monthDirs.push(name);
    A.monthDirs.sort(); renderFolderBar(); renderHeader();
    if (A.solving) { if (pluginsFor !== A.dirHandle) { A.pluginsPending = true; A.toast(T.t("計算中のため、フォルダのプラグインは計算が終わってから読みます")); } } // 計算中は登録を変えない（計算した規則と検算する規則がずれる）。計算後に loadPendingPlugins が読む
    else if (pluginsFor !== A.dirHandle) { pluginsFor = A.dirHandle; A.pluginsPending = false; await loadFolderPlugins(); } // 接続したフォルダごとに 1 回（「プラグインを読み直す」で再読）。保留分もここで済む
  }
  // 接続直後: フォルダのファイルとブラウザ内の状態を照合し、フォルダの方が新しければそちらを読む
  async function reconcileWithFolder() { try { await reconcileCore(); } finally { if (A.dirHandle && A.isDirty()) A.save(); } } // 接続後に未保存の変更があれば自動保存を予約
  async function reconcileCore() {
    if (!A.dirHandle) return;
    const f = await findMonthData(A.tag());
    if (!f.data && f.corrupt) { A.toast(T.t("フォルダの {file} が壊れていて読めません（{err}）。ブラウザ内の状態で続けますが、このままでは保存しません", { file: f.corrupt, err: f.error })); return; }
    if (!f.data) {
      if (!A.monthDirs.length && state.meta && state.meta.savedAt && confirm(T.t("このフォルダには月データがありません。ブラウザ内に残っている {tag} の状態（保存 {at}）を捨てて、同梱のサンプルから始めますか？\n「キャンセル」＝ブラウザ内の状態をこのフォルダに保存して続けます", { tag: A.tag(), at: new Date(state.meta.savedAt).toLocaleString(T.dateLocale()) })))
        { A.resetBrowserState(); location.reload(); await new Promise(() => { }); } // 読み直すまで止める
      return; }
    const fileAt = f.data.saved_at || "", mineAt = (state.meta && state.meta.savedAt) || "";
    const sameSaved = state.meta && state.meta.savedWhere && state.meta.savedWhere.startsWith("フォルダ") && state.meta.savedTag === A.tag() && fileAt && fileAt === mineAt;
    if (sameSaved) return; // 自分が最後に保存したファイルそのもの
    if (!mineAt || fileAt !== mineAt) { // 自分が最後に同期した版と違う（時刻の大小は使わない）
      if (A.isDirty()) {
        // 未保存の変更がある: 共通の元があれば自動で統合し、統合結果をフォルダに書き戻す
        const m = await tryAutoMerge(f, T.t("開いたとき、"));
        if (m === true) { A.save(); return; } // 統合結果は自動保存の予約で書く（ここが保存の待ち行列の中から呼ばれることがあり、同じ行列を待つと止まる）
        if (m === false) return;
        const atTxt = fileAt ? new Date(fileAt).toLocaleString(T.dateLocale()) : T.t("時刻不明");
        const v = await A.choose(T.t("フォルダにある {tag} のデータ（保存 {at}）は、このブラウザ内の状態より新しいか別のものです。ブラウザ内には未保存の変更があります。", { tag: A.tag(), at: atTxt }), [{ label: T.t("フォルダのデータを読み込む（推奨）"), sub: T.t("通常はフォルダのファイル側が最新です。ブラウザ内の未保存の変更は捨てます（必要なら読み込んだあとで入れ直す）"), value: "file", primary: true }, { label: T.t("ブラウザ内の状態を保持する"), sub: T.t("次に保存するとフォルダ側を上書きします。例: フォルダの版が誤って保存された古い内容と分かっていて、このブラウザの入力が最新のとき"), value: null, cancel: true }]); if (v !== "file") return; }
      applyLoaded(f.data, T.t("フォルダの {tag} データ（保存 {at}）を読み込みました", { tag: A.tag(), at: fileAt ? new Date(fileAt).toLocaleString(T.dateLocale()) : T.t("時刻不明") }));
    }
  }
  // 計算中に接続したフォルダのプラグインを、計算が終わってから読む（app-solve.js の runSolve が計算の後始末で呼び、読み終わるまで次の計算を受け付けない）
  async function loadPendingPlugins() {
    if (!A.pluginsPending) return 0; A.pluginsPending = false;
    if (!A.dirHandle || A.solving) return 0;
    pluginsFor = A.dirHandle; return loadFolderPlugins();
  }
  // 保存フォルダの plugins/（rules/ calendars/ docx/ lang/ profiles/）を読んで登録する。無ければ何もしない。docs/rule-modules.md §8
  async function loadFolderPlugins(root = A.dirHandle) {
    if (!root) return 0;
    if (A.solving) { A.toast(T.t("計算中はプラグインを読み直せません。計算が終わってからもう一度押してください")); return 0; }
    T.plugins.beginFolder(); // 前のフォルダで読んだ分（規則・区分・拡張・暦・様式・文面・訳・プロファイル）を最初の写しへ戻す。保存データが参照する規則が無ければ入力チェック（LINT_PLUGIN_MISSING）が知らせる
    let pdir = null; try { pdir = await root.getDirectoryHandle("plugins"); } catch (e) { A.renderAll(); return 0; }
    let n = 0; const errs = [];
    for (const kind of T.plugins.KINDS) {
      let kd = null; try { kd = await pdir.getDirectoryHandle(kind); } catch (e) { continue; }
      const files = []; for await (const [name, h] of kd.entries()) if (h.kind === "file" && (kind === "lang" || kind === "profiles" ? /\.json$/i : /\.js$/i).test(name)) files.push([name, h]);
      files.sort((a, b) => a[0].localeCompare(b[0]));
      for (const [name, h] of files) { const rec = T.plugins.load(kind, `${kind}/${name}`, await (await h.getFile()).text(), "folder"); n++; if (!rec.ok) errs.push(`${kind}/${name}: ${rec.error}`); }
    }
    if (n) { // 新しい規則の状態・重みを補い、一覧を描き直す
      T.fillDefaultRules(state.rules); A.ensureMonth(state.month); A.renderAll();
      const ver = $("#ver"); if (ver && !/\+plugins/.test(ver.textContent)) ver.textContent += " +plugins";
      A.toast((errs.length ? T.t("フォルダのプラグインを {n} 件読み込みました（うち {e} 件は読めませんでした。設定タブの管理者向けを確認）", { n, e: errs.length }) : T.t("フォルダのプラグインを {n} 件読み込みました", { n }))
        + (state.result && state.result.asg ? T.t("。いまの結果はこの規則を使っていないので、もう一度「計算する」を押してください") : "")); // 読み込んだ規則は既存の結果に入っていない
    }
    return n;
  }
  function renderFolderBar() {
    const el = $("#folderBar");
    if (!A.dirHandle) {
      const hn = htmlFolderName();
      if (A.storedHandle) el.innerHTML = `<button id="btnReconnect">${esc(T.t("フォルダ「{name}」に再接続", { name: A.storedHandle.name }))}</button> <button id="btnOpenFolder" title="${esc(T.t("保存フォルダを変更します。通常は不要です"))}">${esc(T.t("保存フォルダを変更（管理者）"))}</button>`;
      else el.innerHTML = `<button id="btnOpenFolder">${esc(T.t("フォルダを開く"))}</button> <span class="note">${esc(fsOK() ? T.t("保存先＝このHTMLがあるフォルダ{name}", { name: hn ? "「" + hn + "」" : "" }) : T.t("この環境ではフォルダに直接保存できません（JSONダウンロードで運用）"))}</span>`;
    }
    else el.innerHTML = `<span>📁 <b>${esc(A.dirHandle.name)}</b></span> ${htmlDirUrl() ? `<button id="btnShowFolder" title="${esc(T.t("このHTMLと同じ場所にある当月フォルダのファイル一覧を別タブで表示します"))}">${esc(T.t("{tag} フォルダを表示", { tag: A.tag() }))}</button>` : ""} <button id="btnOpenFolder" title="${esc(T.t("保存フォルダを変更します。通常は不要です"))}">${esc(T.t("保存フォルダを変更（管理者）"))}</button>`;
    $("#btnOpenFolder").addEventListener("click", openFolder);
    const rc = $("#btnReconnect"); if (rc) rc.addEventListener("click", reconnectFolder);
    const sf = $("#btnShowFolder"); if (sf) sf.addEventListener("click", () => { const base = htmlDirUrl(); if (!base) return; window.open(base + encodeURIComponent(A.tag()) + "/", "_blank"); });
    renderHeader();
  }
  function monthSelectHtml() {
    const cur = A.tag(); const tags = [...new Set(A.monthDirs.map(x => x.slice(0, 6)))].sort();
    const base = tags.length ? tags[tags.length - 1] : cur; const lastTag = base > cur ? base : cur; const lastY = +lastTag.slice(0, 4), lastM = +lastTag.slice(4, 6);
    const ny = lastM === 12 ? lastY + 1 : lastY, nm = lastM === 12 ? 1 : lastM + 1, nextTag = `${ny}${String(nm).padStart(2, "0")}`;
    const ym = (y, m2) => T.t("{y}年{m}月", { y, m: m2 });
    const opts = tags.map(x => [x, ym(x.slice(0, 4), +x.slice(4, 6))]).concat(tags.includes(cur) ? [] : [[cur, ym(cur.slice(0, 4), +cur.slice(4)) + (A.dirHandle ? T.t("（未保存）") : "")]]);
    if (!tags.includes(nextTag) && nextTag !== cur) opts.push([nextTag, T.t("＋ 翌月（{ym}）を作成", { ym: ym(ny, nm) })]);
    opts.push(["__other__", T.t("別の年月を指定…")]);
    return A.sel(opts, cur, `id="monthSel" title="${esc(T.t("月の切替"))}"`);
  }
  function bindMonthSelect() {
    $("#monthSel").addEventListener("change", async ev => {
      let t = ev.target.value; if (t === A.tag()) return;
      if (A.solving) { ev.target.value = A.tag(); return A.toast(T.t("計算中は月を切り替えられません。計算が終わるか「中止」を押してから切り替えてください")); }
      if (t === "__other__") { ev.target.value = A.tag(); const y = +prompt(T.t("年"), state.month.year); if (!y) return; const mo = +prompt(T.t("月（1〜12）"), state.month.month); if (!mo || mo < 1 || mo > 12) return; t = `${y}${String(mo).padStart(2, "0")}`; if (t === A.tag()) return; }
      if (A.dirHandle) { const f = await findMonthData(t); if (f.data) { if (!(await saveBeforeSwitch())) { ev.target.value = A.tag(); return; } applyLoaded(f.data, T.t("{where} を開きました", { where: f.where })); return; } }
      ev.target.value = A.tag(); A.onMonthChange(+t.slice(0, 4), +t.slice(4)).catch(e => A.toast(T.t("月の切替に失敗しました: {err}", { err: e && e.message || e }))); // 保存の確認は onMonthChange 側で1回だけ行う
    });
  }
  // 月データを探す: YYYYMM フォルダ内 → フォルダ直下 → YYYYMM で始まる名前のフォルダ内
  async function findMonthData(t) {
    if (!A.dirHandle) return { data: null, tried: [] };
    const fname = A.FILES.data(t), tried = [];
    const pick = async (dir, prefix) => { const o = await readJson(dir, fname); tried.push(prefix + fname); if (o && o.__corrupt) return { data: null, corrupt: prefix + fname, error: o.error, tried }; return o ? { data: o, where: prefix + fname, tried } : null; };
    const dirsToTry = [t, ...A.monthDirs.filter(x => x !== t && x.startsWith(t))];
    for (const dn of dirsToTry) { const dir = await A.dirHandle.getDirectoryHandle(dn).catch(() => null); if (!dir) { tried.push(`${dn}/`); continue; } const r = await pick(dir, `${dn}/`); if (r) return r; }
    const r = await pick(A.dirHandle, ""); if (r) return r;
    return { data: null, tried };
  }
  // 無ければ null。あるのに読めない（壊れている）ときは { __corrupt: true, error } を返し、呼ぶ側は新規扱いで上書きしない
  async function readJson(dir, name) { let fh; try { fh = await dir.getFileHandle(name); } catch (e) { return null; } try { const f = await fh.getFile(); return JSON.parse(await f.text()); } catch (e) { return { __corrupt: true, error: e && e.message || String(e) }; } }
  async function writeFile(dir, name, blob) { const fh = await dir.getFileHandle(name, { create: true }); const w = await fh.createWritable(); await w.write(blob); await w.close(); }
  async function ensureFolder() {
    if (A.dirHandle) return true;
    if (!fsOK()) return false;
    if (A.storedHandle) await reconnectFolder(); else await openFolder();
    return !!A.dirHandle;
  }
  // 月を切り替える前に現在の月を保存する。未接続なら接続を求め、断られたら「保存せずに切替」を確認
  async function saveBeforeSwitch() {
    await A.awaitSaves(); // 進行中の保存（帳票の生成・書込み）が終わってから判定する。未保存でなくても、書込み中に月を替えると保存の基準が混ざる
    A.readAll();
    if (!A.isDirty()) return true;
    if (!A.dirHandle) {
      const ymT = T.t("{y}年{m}月", { y: state.month.year, m: state.month.month });
      if (!fsOK()) return (await A.choose(T.t("{ym} の入力（計算結果を含む）はフォルダに保存されていません。", { ym: ymT }), [{ label: T.t("保存せずに切り替える"), sub: T.t("この月の未保存の入力は失われます"), value: "go" }, { label: T.t("やめる（今の月のまま）"), sub: T.t("残す場合は設定タブの「JSONとしてダウンロード」"), value: null, cancel: true, primary: true }])) === "go";
      A.toast(T.t("切り替える前に現在の月を保存します。フォルダを接続してください"));
      if (!(await ensureFolder())) return (await A.choose(T.t("{ym} の入力（計算結果を含む）は保存されていません。", { ym: ymT }), [{ label: T.t("保存せずに切り替える"), sub: T.t("この月の未保存の入力は失われます"), value: "go" }, { label: T.t("やめる（今の月のまま）"), value: null, cancel: true, primary: true }])) === "go";
      A.readAll();
    }
    let r = "skipped";
    for (let i = 0; i < 3; i++) { r = await saveToFolder(); if (!(r === "saved" || r === "downloaded")) break; A.readAll(); if (!A.isDirty()) return true; } // 書込み中に増えた入力があれば、もう一度保存する
    if (r === "saved" && A.isDirty()) r = "dirty";
    const ymT2 = T.t("{y}年{m}月", { y: state.month.year, m: state.month.month });
    const v = await A.choose(T.t("{ym} を保存できませんでした（{why}）。切り替えると未保存の入力が失われます。", { ym: ymT2, why: r === "skipped" ? T.t("保存を見送ったか、統合の確認で中止") : r === "dirty" ? T.t("保存中にも入力が続き、未保存の入力が残っている") : T.t("書き込みに失敗") }),
      [{ label: T.t("切り替えを中止する（推奨）"), value: false, primary: true }, { label: T.t("保存せずに切り替える"), sub: T.t("この月の未保存の入力は失われます"), value: true }]);
    return v === true;
  }
  async function saveToFolder() { clearTimeout(A.autosaveTimer); return A.serialized(saveToFolderCore); }
  async function saveToFolderCore() {
    A.readAll();
    if (!A.dirHandle) {
      if (!(await ensureFolder())) { if (!fsOK()) { const at = new Date().toISOString(); A.download(A.dataFileName(), new Blob([A.payloadJson(at)], { type: "application/json" })); A.markSaved("ダウンロード", at); return "downloaded"; A.toast(T.t("この環境ではフォルダに直接保存できないため、JSONをダウンロードしました")); } else A.toast(T.t("保存先のフォルダを選ぶと保存できます")); return; }
      A.readAll();
    }
    if (!(await checkConflict())) { A.toast(T.t("保存を見送りました")); return "skipped"; } // ここで自動統合が入ることがある（統合後の内容を書く）
    try {
      const at = new Date().toISOString();
      // この時点の写し（月・設定・結果・年月・言語）を 1 つ取り、保存先のフォルダ名・ファイル名・検算・版の署名・勤務表・説明資料・月データをすべてその写しから作る。
      // 生成・書込みの間に入った編集は未保存として残り、月が切り替わっても写しの月のファイルにしか書かない（markSaved も写しの月が現在の月のときだけ基準を更新する）
      const S = A.snapshot(at), root = A.dirHandle;
      const dir = await root.getDirectoryHandle(S.tag, { create: true });
      // 上書き前に直前の保存データを1世代退避する（誤操作や統合の取り違えからの復元用）
      try { const prev = await readJson(dir, A.FILES.data(S.tag)); if (prev && !prev.__corrupt) await writeFile(dir, A.FILES.dataPrev(S.tag), new Blob([JSON.stringify(prev, null, 1)], { type: "application/json" })); } catch (e) { }
      let verNote = "";
      const hasAsg = !!(S.result && S.result.asg);
      // 計算した後にプラグインの登録が変わっていたら（result.plugins と今の印が違う）、その結果の勤務表は出さない（接続先の規則を満たすとは限らない。再計算を促す）
      const stampNow = JSON.stringify(T.plugins && T.plugins.stamp ? T.plugins.stamp() : []), stampRes = hasAsg && Array.isArray(S.result.plugins) ? JSON.stringify(S.result.plugins) : null;
      const viol = hasAsg && stampRes === stampNow ? (() => { try { return T.check(new T.Problem(S.rules, S.month), S.result.asg).V.length; } catch (e) { return -1; } })() : 0;
      if (hasAsg && stampRes !== null && stampRes !== stampNow) verNote = T.t("（計算した後にプラグインが変わったため勤務表と説明資料は書き出しません。もう一度「計算する」を押してください）");
      else if (hasAsg && viol !== 0) verNote = T.t("（検算に違反が{n}ため勤務表と説明資料は書き出しません。入力を直して再計算してください）", { n: viol < 0 ? T.t("確認できない") : T.t("{n} 件", { n: viol }) });
      else if (hasAsg) {
        // 配布物は上書きせず版を追加する。出力に関わるもの（versionSig）が前回と同じなら新しい版は作らない
        const P = new T.Problem(S.rules, S.month);
        const label = S.month.doc_label || "確認版";
        const vsig = versionSig(label, S);
        const versS = (S.month.doc_versions ||= []); const last = versS[versS.length - 1];
        if (!last || last.sig !== vsig) {
          const ver = (last ? last.ver : 0) + 1;
          const docxName = A.FILES.roster(S.tag, ver, label), htmlName = A.FILES.report(S.tag, ver, label);
          try { // 様式のプラグインが無いなどで書き出せなくても、月データの保存は続ける
            const docx = await T.makeDocx(P, S.result.asg, `${label} v${ver}`, { baseAsg: S.result.mark_changes ? S.result.base_asg : null });
            await writeFile(dir, docxName, docx);
            await writeFile(dir, htmlName, new Blob([A.reportHtml(P, `${label} v${ver}`, S)], { type: "text/html" }));
            const entry = { ver, at, label, sig: vsig, docx: docxName, html: htmlName };
            versS.push(entry); if (A.tag() === S.tag) (state.month.doc_versions ||= []).push(JSON.parse(JSON.stringify(entry))); // 写し（保存する中身）と、同じ月のままなら現在の状態にも足す（ほかに編集が無ければ署名が一致して「保存済み」になる）
            verNote = T.t("（勤務表 v{v} を追加）", { v: ver });
          } catch (e) { verNote = T.t("（勤務表と説明資料は書き出せませんでした: {err}。月データは保存しました）", { err: e && e.message || e }); }
        } else verNote = T.t("（勤務表は v{v} のまま。出力に関わる変更なし）", { v: last.ver });
      }
      S.refresh(); // 版の追加を反映した署名と中身。書いた中身だけを保存済みにする（生成・書込み中の入力は未保存のまま）
      await writeFile(dir, A.FILES.data(S.tag), new Blob([S.payload], { type: "application/json" }));
      A.markSaved(undefined, at, S);
      await refreshMonths();
      A.toast(T.t("{tag} フォルダに保存しました", { tag: S.tag }) + (hasAsg ? verNote : T.t("（データのみ。計算後に保存すると勤務表と説明資料も出ます）")));
      return "saved";
    } catch (e) { renderHeader(); A.toast(T.t("フォルダに保存できませんでした: {err}。入力はブラウザ内に残っています", { err: e && e.message || e })); return "failed"; }
  }
  // 当直表の版の識別。保存時の版付与とダウンロード時の版表示で共通。出力に使うものを全部含める:
  // 設定（規則・重み・様式・名簿）、月の条件（メモ・日ごとの予定など。版の履歴は除く）、割当と変更表示の基準、表題、表示言語、本体の印（T.BUILD_ID）、実行時に読んだプラグインの中身。
  // 保存時刻・計算時間・計算日時は含めない（保存のたびに版が増える循環を避ける）。S は月・設定・結果の組（省略時は現在の状態。保存では写しを渡す）
  const versionSig = (label, S = state) => { const m = Object.assign({}, S.month); delete m.doc_versions; const r = S.result || {};
    return A.sigOf(JSON.stringify([A.canon(S.rules), A.canon(m), A.canon({ asg: r.asg, base_asg: r.mark_changes ? r.base_asg : null, avoid_ref: r.avoid_ref, status: r.status }), label, S.lang || T.lang(), T.BUILD_ID || null, T.plugins && T.plugins.stamp ? T.plugins.stamp() : null])); };
  function applyLoaded(o, msg) {
    let month, rules = null, result = null;
    if (A.isMonthObj(o.month)) { month = o.month; rules = o.rules || null; result = o.result || null; } else if (A.isMonthObj(o)) { month = o; } else return alert(T.t("勤務表データではありません（year / month がありません）"));
    if (rules && !Array.isArray(rules.doctors)) return alert(T.t("勤務表データの設定（rules）に{person}一覧がありません"));
    state.month = month; if (rules) state.rules = rules; state.result = result;
    state.ui.doctor = 0; A.ensureMonth(state.month); A.persist(); A.markSaved(o.month && o.rules ? (A.dirHandle ? "フォルダ " + A.dirHandle.name : "読込ファイル") : undefined, o.saved_at || undefined); A.renderAll(); A.showTab("input"); A.toast(msg);
  }

  Object.assign(A, { repaintStartGate, renderHeader, autosaveJson, fsOK, restoreFolder, refreshMonths, loadFolderPlugins, loadPendingPlugins, reconcileWithFolder, renderFolderBar, findMonthData, writeFile, ensureFolder, saveBeforeSwitch, saveToFolder, versionSig, applyLoaded }); // 他のファイルから使う関数
})(globalThis.T = globalThis.T || {}, globalThis.T.app = globalThis.T.app || {});

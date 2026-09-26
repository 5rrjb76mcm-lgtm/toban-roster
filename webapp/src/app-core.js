// 当直表アプリ（画面）: 共有状態・保存署名・ブラウザ内保存・月データの入れ物・共通ヘルパー・確認ダイアログ
// app-*.js は T.app（以下 A）を介して互いを参照する。他のファイルの関数・共有変数（A.state, A.dirHandle など）は必ず A. を付ける（build.py --check が検査）。
// 各ファイルは T.app（以下 A）に関数を登録し、他のファイルの関数は必ず A. を付けて呼ぶ（build.py --check が検査する）。
// state は A.state の別名で、中身（rules / month / result / ui / meta / base）だけを差し替える。
(function (T, A) {
  const $ = s => document.querySelector(s);
  const esc = T.esc;
  // 共有する状態。state（{rules, month, result, ui, meta, base}）は中身を差し替える（A.state 自体は作り直さない）
  A.state = { rules: null, month: null, result: null, ui: { doctor: 0 } };
  A.highs = null; // 計算エンジン（Worker または画面内の HiGHS）
  A.dirHandle = null; A.monthDirs = []; A.storedHandle = null; // 接続中のフォルダ・月フォルダの一覧・前回のフォルダ参照
  A.autosaveTimer = null;
  A.solving = false; // 計算・診断中（app-solve.js が立てる。プラグインの読み直し・月の切替・フォルダの読み直しを受け付けない）
  A.pluginsPending = false; // 計算中にフォルダへ接続した（プラグインの読み込みを計算後に回す。app-folder.js の loadPendingPlugins）
  const state = A.state;

  // ブラウザ内の保存キー。file:// では同じPCの全ローカルHTMLが同じ領域を共有するので、HTML の場所と形式版で分ける
  const STORE = "toban_state_v2:" + location.pathname, STORE_LEGACY = "toban_state_v1";
  const DIR_KEY = "dir:" + location.pathname; // IndexedDB のフォルダ参照のキー

  // 保存状態: 保存した内容の署名（ハッシュ）を state.meta に持ち、現在の内容と比べて「未保存」を判定する（再読込後も正しく出る）
  function sigOf(str) { let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(16) + ":" + str.length; }
  // 保存状態の署名。正規形（キーを整列、集合の配列は要素の JSON で整列、空の項目は無視）で比べるので、画面の読み直しによる並び替えや空欄の整形では「未保存」にならない。
  // 配列は原則そのままの順で比べる（名簿・表示順・曜日パターン（先頭が優先）・プラグインの優先順位など、並びに意味があるものを取りこぼさない）。
  // 集合と分かっているパスだけ整列する。パスは根（月データ／設定／結果）からのキーの並びで、* は任意の 1 段
  const SET_PATHS = ["holidays", "closure_days", "cath_off_days_A", "cath_off_days_I", "plugins_used", "unavailable_other", "avoid", "confirmed_pm_external_night", "unavailable_night.*", "wishes.night_on.*", "wishes.day_on.*", "wishes.weekend_dayshift",
    "fixed.*.*", "day_flags.*", "doctors.*.quals", "weekend_dayshift_wish", "plugins_off", "asg.*.oc", "base_asg.*.oc"].map(x => x.split("."));
  const isSetPath = path => SET_PATHS.some(q => q.length === path.length && q.every((k, i) => k === "*" || k === path[i]));
  const cmpJson = (x, y) => { const p = JSON.stringify(x), q = JSON.stringify(y); return p < q ? -1 : p > q ? 1 : 0; };
  function canon(v, path = []) {
    if (Array.isArray(v)) { const a = v.map((x, i) => canon(x, path.concat(String(i)))); return isSetPath(path) ? a.sort(cmpJson) : a; }
    if (v && typeof v === "object") { const keepOf = k => LOCAL_KEY.test(path.length ? path[0] : k); const o = {}; // プラグインの項目（根の直下の local_… / local.…）では空値も JSON のまま区別する（統合と同じ。未指定と null・[]・{} は別）
      for (const k of Object.keys(v).sort()) { const x = v[k]; if (x === undefined) continue; if (!keepOf(k) && (x === null || x === "" || (Array.isArray(x) && !x.length) || (x && typeof x === "object" && !Array.isArray(x) && !Object.keys(x).length))) continue; o[k] = canon(x, path.concat(k)); } return o; }
    return v;
  }
  const LOCAL_KEY = /^local[_.]/; // 施設のプラグインが月データ・設定の根の直下に置く項目の名前（plugin-example/README.md）
  const sigOfState = S => sigOf(JSON.stringify([canon(S.month), canon(S.rules), S.result ? canon(S.result) : null])); // 月・設定・結果の組の署名（写しにも使う）
  function sig() { return sigOfState(state); }
  const isDirty = () => !state.meta || state.meta.savedSig !== sig() || state.meta.savedTag !== tag();
  function persist() { try { localStorage.setItem(STORE, JSON.stringify(state)); } catch (e) { } }
  // ブラウザ内の保存を消す（開始画面の「最初から始める」。フォルダの接続先は残す）。呼んだ側が読み直す
  function resetBrowserState() { try { localStorage.removeItem(STORE); localStorage.removeItem(STORE_LEGACY); } catch (e) { } }
  // 保存系の処理は一度に1つだけ動かす（自動保存・今すぐ保存・月切替・計算後の保存が重なっても確認画面が取り違えられない）
  let saveChain = Promise.resolve();
  const serialized = fn => { const p = saveChain.then(fn, fn); saveChain = p.catch(() => { }); return p; };
  const awaitSaves = () => serialized(async () => { }); // 進行中の保存が終わるのを待つ（月の切替・JSON の読込・言語の切替・プラグインの読み直しの前に。保存の待ち行列の中からは呼ばない）
  function save() {
    persist(); A.renderHeader();
    if (A.dirHandle && isDirty()) { clearTimeout(A.autosaveTimer); A.autosaveTimer = setTimeout(() => A.autosaveJson(), 3000); }
  }
  // 保存の写し: この時点の月・設定・結果の複製（month＝base・rules・result。以後の編集の影響を受けない）と、その署名・書き込む中身（payload）。
  // 保存はこの写し 1 つから検算・版の署名・勤務表・説明資料・月データを作り、写しの署名だけを「保存済み」にする（生成・書込み中の入力は未保存のまま残る）。
  // refresh() は写しの中身（版の履歴の追加）を反映して署名と payload を作り直す
  // tag（年月）と lang（表示言語）も写しに入れる: 保存先のファイル名と帳票の言語は写しのもので決め、保存中に月や言語が切り替わっても混ざらない
  function snapshot(at) { const S = { month: JSON.parse(JSON.stringify(state.month)), rules: JSON.parse(JSON.stringify(state.rules)), result: state.result ? JSON.parse(JSON.stringify(state.result)) : null };
    return { at, month: S.month, base: S.month, rules: S.rules, result: S.result, tag: tag(S.month), lang: T.lang(), sig: sigOfState(S), payload: payloadOf(S, at), refresh() { this.sig = sigOfState(this); this.payload = payloadOf(this, this.at); return this; } }; }
  function markSaved(where, at, snap) {
    const s = snap || snapshot(at || new Date().toISOString());
    if (s.tag && s.tag !== tag()) { persist(); return; } // 保存した写しと現在の月が違う（保存中に月が切り替わった）: 現在の月の保存基準には触れない
    state.meta = { savedSig: s.sig, savedTag: tag(), savedAt: at || s.at || new Date().toISOString(), savedWhere: where || (A.dirHandle ? "フォルダ " + A.dirHandle.name : "ダウンロード") };
    state.base = s.base; state.baseRules = s.rules; persist(); A.renderHeader();
  }
  const inputSig = () => sigOf(JSON.stringify([canon(state.month), canon(state.rules)])); // 計算の入力（月＋設定）の署名。計算中に変わったら結果を採用しない
  const rulesSig = r => sigOf(JSON.stringify(canon(r)));
  const payloadOf = (S, at) => JSON.stringify({ rules: S.rules, month: S.month, result: S.result, saved_at: at }, null, 1);
  function payloadJson(at) { return payloadOf(state, at); }

  const isMonthObj = x => x && typeof x === "object" && +x.year > 0 && +x.month >= 1 && +x.month <= 12;
  function load() {
    try {
      const s = localStorage.getItem(STORE) || localStorage.getItem(STORE_LEGACY); // 旧キーからの引き継ぎ（一度読めば新キーに保存される）
      if (s) { const o = JSON.parse(s); if (o && isMonthObj(o.month) && o.rules && Array.isArray(o.rules.doctors)) return o; }
    } catch (e) { }
    return null;
  }

  // 設定と月データの形を整える（欠損の補完・旧形式の移行）。中身は model.js の fillDefaultRules / normalizeMonth
  function ensureMonth(m) { T.fillDefaultRules(state.rules); T.normalizeMonth(m, state.rules); }

  function download(name, blob) { const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000); }
  const tag = (m = state.month) => `${m.year}${String(m.month).padStart(2, "0")}`;
  // 保存するファイルの名前。英語で、表示言語では変えない（同じフォルダを別の言語で開いても同じファイルを使う）。
  // 版の表題（確認版 / 確定版）は draft / final にする
  const labelSlug = l => ({ "確認版": "draft", "確定版": "final" })[l] || String(l || "draft").replace(/[\\/:*?"<>|\s]+/g, "_");
  const FILES = {
    data: t => `${t}_data.json`,
    dataPrev: t => `${t}_data_prev.json`,
    roster: (t, ver, label) => `${t}_roster${ver ? `_v${ver}` : "_unsaved"}_${labelSlug(label)}.docx`,
    report: (t, ver, label) => `${t}_report${ver ? `_v${ver}` : ""}${label ? `_${labelSlug(label)}` : ""}.html`,
  };
  const dataFileName = (m = state.month) => FILES.data(tag(m));

  // ---------- ヘルパー ----------
  const names = () => state.rules.doctors.map(d => d.name);
  const dutyNames = () => state.rules.doctors.filter(d => T.isDutyCandidate(d, !!(state.month && state.month.allow_chief_duty))).map(d => d.name);
  const refreshNameOrder = R => { R.name_order = R.doctors.filter(d => T.isDutyCandidate(d, false)).map(d => d.name); }; // 表示順（docx・結果）は通常の当直候補の並び
  // 期間責任者になれる役割の人（識別子が施設ごとに違うので、役割の機能 charge から引く）
  const iNames = () => { let id = null; try { id = (T.normalizeRolesOf(state.rules).find(r => r.refs.includes("charge")) || {}).id || null; } catch (e) { } return id ? state.rules.doctors.filter(d => d.team === id).map(d => d.name) : []; };
  const parseDays = s => String(s || "").split(/[,、\s]+/).map(x => x.trim()).filter(Boolean).map(x => parseInt(x.replace(/^\d+\//, ""), 10)).filter(n => !isNaN(n));
  const sel = (opts, val, attrs = "") => `<select ${attrs}>${opts.map(([v, l]) => `<option value="${esc(v)}" ${String(v) === String(val ?? "") ? "selected" : ""}>${esc(l)}</option>`).join("")}</select>`;
  const nameSel = (val, attrs = "", list = null, blank = true) => sel((blank ? [["", "―"]] : []).concat((list || names()).map(n => [n, n])), val, attrs);
  const daysIn = (y, m) => new Date(y, m, 0).getDate();
  const dowOf = (y, m, d) => (new Date(y, m - 1, d).getDay() + 6) % 7;
  // 画面内の選択ダイアログ: 選択肢がそのままボタンになる。options: [{label, sub, value, primary, cancel}]
  let chooseChain = Promise.resolve(); // 確認画面は同時に1つだけ（前の答えを待ってから次を出す）
  function choose(msg, options) {
    const run = () => new Promise(res => {
      const modal = $("#modal"); $("#modalMsg").textContent = msg;
      $("#modalBtns").innerHTML = options.map((o, i) => `<button data-i="${i}" class="${o.primary ? "primary" : o.cancel ? "cancel" : ""}">${esc(o.label)}${o.sub ? `<small>${esc(o.sub)}</small>` : ""}</button>`).join("");
      const done = v => { modal.hidden = true; $("#modalBtns").innerHTML = ""; document.removeEventListener("keydown", onKey); res(v); };
      const onKey = ev => { if (ev.key === "Escape") { const c = options.find(o => o.cancel); done(c ? c.value : null); } };
      $("#modalBtns").querySelectorAll("button").forEach(b => b.addEventListener("click", () => done(options[+b.dataset.i].value)));
      document.addEventListener("keydown", onKey);
      modal.hidden = false; const first = $("#modalBtns button"); if (first) first.focus();
    });
    const p = chooseChain.then(run, run); chooseChain = p.catch(() => { }); return p;
  }
  const toast = msg => { const el = $("#toast"); el.textContent = msg; el.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => el.hidden = true, 4000); };

  Object.assign(A, { DIR_KEY, sigOf, sigOfState, sig, isDirty, persist, resetBrowserState, serialized, awaitSaves, snapshot, inputSig, rulesSig, canon, save, markSaved, payloadJson, isMonthObj, load, ensureMonth, download, tag, dataFileName, FILES, names, dutyNames, refreshNameOrder, iNames, parseDays, sel, nameSel, daysIn, dowOf, choose, toast }); // 他のファイルから使う関数
})(globalThis.T = globalThis.T || {}, globalThis.T.app = globalThis.T.app || {});

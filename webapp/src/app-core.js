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
  const state = A.state;

  // ブラウザ内の保存キー。file:// では同じPCの全ローカルHTMLが同じ領域を共有するので、HTML の場所と形式版で分ける
  const STORE = "toban_state_v2:" + location.pathname, STORE_LEGACY = "toban_state_v1";
  const DIR_KEY = "dir:" + location.pathname; // IndexedDB のフォルダ参照のキー

  // 保存状態: 保存した内容の署名（ハッシュ）を state.meta に持ち、現在の内容と比べて「未保存」を判定する（再読込後も正しく出る）
  function sigOf(str) { let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(16) + ":" + str.length; }
  // 保存状態の署名。正規形（キーを整列、配列は要素の JSON で整列、空の項目は無視）で比べるので、画面の読み直しによる並び替えや空欄の整形では「未保存」にならない
  function canon(v) {
    if (Array.isArray(v)) return v.map(canon).sort((a, b) => { const x = JSON.stringify(a), y = JSON.stringify(b); return x < y ? -1 : x > y ? 1 : 0; });
    if (v && typeof v === "object") { const o = {}; for (const k of Object.keys(v).sort()) { const x = v[k]; if (x === undefined || x === null || x === "" || (Array.isArray(x) && !x.length) || (x && typeof x === "object" && !Array.isArray(x) && !Object.keys(x).length)) continue; o[k] = canon(x); } return o; }
    return v;
  }
  function sig() { return sigOf(JSON.stringify([canon(state.month), canon(state.rules), state.result ? canon(state.result) : null])); }
  const isDirty = () => !state.meta || state.meta.savedSig !== sig() || state.meta.savedTag !== tag();
  function persist() { try { localStorage.setItem(STORE, JSON.stringify(state)); } catch (e) { } }
  // ブラウザ内の保存を消す（開始画面の「最初から始める」。フォルダの接続先は残す）。呼んだ側が読み直す
  function resetBrowserState() { try { localStorage.removeItem(STORE); localStorage.removeItem(STORE_LEGACY); } catch (e) { } }
  // 保存系の処理は一度に1つだけ動かす（自動保存・今すぐ保存・月切替・計算後の保存が重なっても確認画面が取り違えられない）
  let saveChain = Promise.resolve();
  const serialized = fn => { const p = saveChain.then(fn, fn); saveChain = p.catch(() => { }); return p; };
  function save() {
    persist(); A.renderHeader();
    if (A.dirHandle && isDirty()) { clearTimeout(A.autosaveTimer); A.autosaveTimer = setTimeout(() => A.autosaveJson(), 3000); }
  }
  // 保存の写し: 書き込む中身（payload）と、そのときの署名・月・設定の複製。書き込みは非同期なので、書いた中身だけを「保存済み」にする（書込み中の入力は未保存のまま残る）
  function snapshot(at) { return { sig: sig(), at, payload: payloadJson(at), base: JSON.parse(JSON.stringify(state.month)), rules: JSON.parse(JSON.stringify(state.rules)) }; }
  function markSaved(where, at, snap) {
    const s = snap || snapshot(at || new Date().toISOString());
    state.meta = { savedSig: s.sig, savedTag: tag(), savedAt: at || s.at || new Date().toISOString(), savedWhere: where || (A.dirHandle ? "フォルダ " + A.dirHandle.name : "ダウンロード") };
    state.base = s.base; state.baseRules = s.rules; persist(); A.renderHeader();
  }
  const inputSig = () => sigOf(JSON.stringify([canon(state.month), canon(state.rules)])); // 計算の入力（月＋設定）の署名。計算中に変わったら結果を採用しない
  const rulesSig = r => sigOf(JSON.stringify(canon(r)));
  function payloadJson(at) { return JSON.stringify({ rules: state.rules, month: state.month, result: state.result, saved_at: at }, null, 1); }

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

  Object.assign(A, { DIR_KEY, sigOf, sig, isDirty, persist, resetBrowserState, serialized, snapshot, inputSig, rulesSig, canon, save, markSaved, payloadJson, isMonthObj, load, ensureMonth, download, tag, dataFileName, FILES, names, dutyNames, refreshNameOrder, iNames, parseDays, sel, nameSel, daysIn, dowOf, choose, toast }); // 他のファイルから使う関数
})(globalThis.T = globalThis.T || {}, globalThis.T.app = globalThis.T.app || {});

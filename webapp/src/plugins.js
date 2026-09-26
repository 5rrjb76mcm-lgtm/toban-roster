// 当直表アプリ: 施設のプラグインの読み込み口。docs/rule-modules.md §8、plugin-example/README.md
//
// プラグインはフォルダ（rules/ calendars/ docx/ lang/ profiles/）に置く。取り込む道は 2 つで、どちらも同じ形のフォルダを読む:
//   1) 実行時: 保存フォルダ（toban.html と同じ層）の plugins/ を、フォルダに接続したときに app-folder.js が読んでここに渡す（組み立て不要。施設はファイルを置くだけ）
//   2) 組み立て時: build.py --plugins <フォルダ>（1 ファイルで配りたいとき。取り込んだ一覧は T.PLUGINS）
// JS のプラグインは本体の登録口（T.rules.register / T.calendars.register / T.docx.register / T.dayFlags.register / T.calendarExt.register）を呼ぶコードなので、
// ここでは global の T を見せて実行するだけ。読み込み中は T.pluginSource にファイル名を置き、登録口が定義の出どころ（source）に写す。
// 元に戻す仕組み: 読み込む前に全登録口の写し（snapshot）を取り、途中で失敗したらそのファイルが触った登録だけを写しの状態へ戻す（revert）。
// フォルダを切り替えるとき（beginFolder）は、最初の切替時に取った写し（baseline = 同梱＋組み立て時の定義）へ、実行時に読んだ分をすべて戻す。
// 読み込みの失敗は loaded に残し、入力チェック（LINT_PLUGIN_ERROR）で知らせる。同じファイルを読み直しても登録は上書きになる（register は同じ id を更新する）。
(function (T) {
  const KINDS = ["rules", "calendars", "docx", "lang", "profiles"];
  const loaded = []; // { source: "folder", kind, name, ok, error, ids, overrode, recd, hash }
  let generation = 0; // 読み込みの世代（load / beginFolder のたびに進む）。計算の前後で比べ、計算中にプラグインが変わっていたら結果を採用しない（app-solve.js）
  const hashOf = str => { let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(16) + ":" + str.length; }; // 中身の印（app-core.js の sigOf と同じ式）
  const idsOf = () => ({ rules: T.rules.defs.map(d => d.id), calendars: T.calendars.defs.map(c => c.id), docx: T.docx ? T.docx.list().map(t => t.id) : [], lang: T.LANGS ? T.LANGS().map(x => x[0]) : [], profiles: (T.PROFILES || []).map(p => (p.profile || {}).id) });
  // 登録の写し。規則の登録は同じオブジェクトを書き換える（Object.assign）ので、浅い写しを取って戻す。ほかは定義オブジェクトそのものを覚えて登録し直す
  const snapRule = d => Object.assign({}, d);
  const restoreRule = (d, copy) => { for (const k of Object.keys(d)) if (!(k in copy)) delete d[k]; Object.assign(d, copy); if (d.messages && T.MSG) Object.assign(T.MSG, d.messages); };
  const snapshot = () => ({ rules: new Map(T.rules.defs.map(d => [d.id, snapRule(d)])), calendars: new Map(T.calendars.defs.map(c => [c.id, c])), docx: new Map(T.docx ? T.docx.list().map(t => [t.id, T.docx.get(t.id)]) : []),
    dayflags: new Map(T.dayFlags ? T.dayFlags.defs.map(x => [x.id, x]) : []), calext: new Map(T.calendarExt ? T.calendarExt.defs.map(x => [x.id, x]) : []),
    msg: Object.assign({}, T.MSG || {}), langs: T.langsSnapshot ? T.langsSnapshot() : null, profiles: (T.PROFILES || []).slice() }); // 文面・言語・プロファイルも（規則の messages は T.MSG に混ざる）
  // 写しに含めた文面・言語・プロファイルを丸ごと戻す（読み込み失敗とフォルダ切替。中身を差し替える＝参照は保つ）
  function restoreTables(snap) {
    if (T.MSG) { for (const k of Object.keys(T.MSG)) delete T.MSG[k]; Object.assign(T.MSG, snap.msg); }
    if (snap.langs && T.langsRestore) T.langsRestore(snap.langs);
    if (T.PROFILES) { T.PROFILES.length = 0; T.PROFILES.push(...snap.profiles); } else if (snap.profiles.length) T.PROFILES = snap.profiles.slice();
  }
  // recs（{kind, id}）を写し snap の状態に戻す: 写しにあれば元の定義へ、無ければ登録を外す
  function revert(snap, recs) {
    const seen = new Set();
    for (const x of recs) { const k = `${x.kind}:${x.id}`; if (seen.has(k)) continue; seen.add(k);
      if (x.kind === "rules") { const d = T.rules.byId[x.id]; if (!d) continue; if (snap.rules.has(x.id)) restoreRule(d, snap.rules.get(x.id)); else T.rules.unregister(x.id); }
      else if (x.kind === "calendars") { if (snap.calendars.has(x.id)) T.calendars.register(snap.calendars.get(x.id)); else T.calendars.unregister(x.id); }
      else if (x.kind === "docx" && T.docx) { if (snap.docx.has(x.id)) { const t = snap.docx.get(x.id); T.docx.register(t.id, t.render, t); } else T.docx.unregister(x.id); }
      else if (x.kind === "dayflags" && T.dayFlags) { if (snap.dayflags.has(x.id)) T.dayFlags.register(snap.dayflags.get(x.id)); else T.dayFlags.unregister(x.id); }
      else if (x.kind === "calext" && T.calendarExt) { if (snap.calext.has(x.id)) T.calendarExt.register(snap.calext.get(x.id)); else T.calendarExt.unregister(x.id); } }
  }
  // 1 ファイルを読み込む。text は JS（rules / calendars / docx）か JSON（lang / profiles）
  function load(kind, name, text, source = "folder") {
    const rec = { source, kind, name, ok: false, error: null, ids: [], overrode: [], recd: [], hash: hashOf(String(text)) }; // overrode: 先に別の出どころが定義していた規則を登録し直した分。recd: このファイルが触った登録。hash: 中身の印
    generation++;
    for (let i = loaded.length - 1; i >= 0; i--) if (loaded[i].kind === kind && loaded[i].name === name) loaded.splice(i, 1); // 同じ名前の古い記録は落とす（読み直し）
    loaded.push(rec);
    if (!KINDS.includes(kind)) { rec.error = `知らない種類: ${kind}`; return rec; }
    if (!baseline) baseline = snapshot(); // 最初の読み込みより前の状態（同梱＋組み立て時）を切替の戻し先に確定する（beginFolder が先でも同じ）
    const prevSrc = new Map(T.rules.defs.map(d => [d.id, d.source || null])), snap = snapshot(); // 規則の出どころ（null は本体）と、失敗したときに戻す先
    try {
      if (kind === "lang") { const d = JSON.parse(text); if (!d || !d.code) throw new Error("code がありません"); T.registerLang(d); rec.ids = [d.code]; }
      else if (kind === "profiles") { const p = JSON.parse(text); const id = (p.profile || {}).id; if (!id) throw new Error("profile.id がありません");
        T.PROFILES = T.PROFILES || []; const i = T.PROFILES.findIndex(x => (x.profile || {}).id === id); if (i >= 0) T.PROFILES[i] = p; else T.PROFILES.push(p); rec.ids = [id]; }
      else { T.plugins.recording = []; T.pluginSource = name;
        try { new Function("T", text)(T); }
        finally { T.pluginSource = null; rec.recd = T.plugins.recording || []; T.plugins.recording = null; rec.ids = [...new Set(rec.recd.filter(x => x.kind === kind).map(x => x.id))]; } // 登録口が受け取った id をそのまま記録（失敗しても、触った分は recd に残る）
        for (const x of rec.recd) (session[x.kind] ||= new Set()).add(x.id); // 切替時に戻す対象（規則のファイルの中で登録した日ごとの区分・カレンダーの拡張も）
        for (const x of rec.recd) if (x.kind === "rules") { const d = T.rules.byId[x.id]; if (d && prevSrc.has(x.id) && prevSrc.get(x.id) !== name) rec.overrode.push({ id: x.id, was: prevSrc.get(x.id) }); } } // 別の出どころの規則を登録し直した
      rec.ok = true;
    } catch (e) { rec.error = (e && e.message) || String(e);
      revert(snap, rec.recd); restoreTables(snap); rec.overrode = []; } // 途中で失敗したファイルが触った登録（規則・暦・様式・区分・拡張）は読み込む前の状態に戻す（半分だけ読めたプラグインを黙って使わない）
    return rec;
  }
  const errors = () => loaded.filter(x => !x.ok);
  // プラグインのファイルごとの一覧（保存フォルダから読んだ分と組み立て時の分）。設定タブ「施設の構成を作る」の施設のプラグインに出す
  function inventory() {
    const by = new Map(), get = (name, where) => { if (!by.has(name)) by.set(name, { name, kind: name.split("/")[0], where, ok: true, error: null, items: {} }); return by.get(name); };
    const add = (src, kind, id) => { const it = get(src, "build").items; (it[kind] ||= []).push(id); };
    for (const d of T.rules.defs) if (d.source) add(d.source, "rules", d.id);
    for (const d of (T.dayFlags ? T.dayFlags.defs : [])) if (d.source) add(d.source, "dayflags", d.id);
    for (const d of (T.calendarExt ? T.calendarExt.defs : [])) if (d.source) add(d.source, "calext", d.id);
    for (const d of T.calendars.defs) if (d.source) add(d.source, "calendars", d.id);
    for (const t of (T.docx ? T.docx.list() : [])) if (t.source) add(t.source, "docx", t.id);
    for (const p of (T.PLUGINS || [])) for (const [kind, files] of Object.entries(p.files || {})) for (const f of files) get(`${kind}/${f}`, "build"); // 組み立て時の分（訳・プロファイルは登録口を通らないので名前だけ）
    for (const x of loaded) { const r = get(x.name, "folder"); r.where = "folder"; r.ok = x.ok; r.error = x.error; if (x.kind === "lang" || x.kind === "profiles") r.items[x.kind] = x.ids.slice(); }
    return [...by.values()].sort((a, b) => a.name.localeCompare(b.name));
  }
  const overrides = () => loaded.flatMap(x => (x.overrode || []).map(o => ({ name: x.name, id: o.id, was: o.was }))); // 同じ id を別の出どころが定義していた規則（入力チェック LINT_PLUGIN_OVERRIDE）
  const ruleIds = () => T.rules.defs.filter(d => /^local\./.test(d.id)).map(d => d.id); // 施設のプラグインの規則（id が local. で始まるもの。組み立て時に取り込んだ分も含む）
  // フォルダ単位の読み直し: 最初の切替時の写し（同梱＋組み立て時）へ、実行時に読んだ分をすべて戻す。同梱の id を上書きしていた定義（規則の関数・区分・拡張・暦・様式）も元へ。
  // 実行時だけの規則は登録を外す（保存データがその id を参照していれば LINT_PLUGIN_MISSING が知らせる）
  let baseline = null, session = {};
  function beginFolder() {
    if (!baseline) baseline = snapshot();
    const recs = []; for (const [kind, ids] of Object.entries(session)) for (const id of ids) recs.push({ kind, id });
    revert(baseline, recs); restoreTables(baseline); // 実行時に読んだ文面・訳・プロファイルも最初の写しへ
    session = {}; loaded.length = 0; generation++;
  }
  // 実行時に読んだプラグインの一覧（名前と中身の印。読めたものだけ、名前順）。版の署名と計算結果の記録に使う
  const stamp = () => loaded.filter(x => x.ok).map(x => `${x.name}#${x.hash}`).concat((T.PLUGINS || []).map(p => `build:${p.dir}#${p.hash || ""}`)).sort(); // 組み立て時に取り込んだ分も（build.py が中身の印を埋める）
  const stale = () => []; // 以前は「前のフォルダの規則が残っている」を知らせていた。いまは beginFolder が外すので残らない（入力チェックの LINT_PLUGIN_STALE は互換のため残す）
  T.plugins = { KINDS, loaded, load, errors, overrides, inventory, ruleIds, beginFolder, stale, generation: () => generation, stamp, recording: null };
})(globalThis.T = globalThis.T || {});

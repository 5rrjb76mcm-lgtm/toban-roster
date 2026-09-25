// 当直表アプリ: 表示言語。
//
// 画面の文面は「日本語の文字列そのもの」を鍵にして引く（T.t("計算する")）。日本語が原文で、他の言語はその上書き。
// 違反・入力チェックの文面は messages.js（種類の code ＋差し込む値。英語が原文）。
//
// **言語を足すときに触るのは webapp/lang/<コード>.json の 1 ファイルだけ**（画面の文面 ui、違反の文面 msg、
// ヘルプ help、曜日・日付・区切りの決まり）。ひな形は `python3 i18n_new.py <コード>` で作る。
// build.py が lang/*.json を toban.html に埋め込み、T.registerLang() で登録する。
//
// 訳の落とし方は「いまの言語 → 英語 → 日本語（＝鍵そのもの）」。半分だけ訳した言語でも、残りは英語で出る。
//
// 施設が決める名前（役割・勤務帯・プロファイルの表示名）はここではなく設定側に持つ。
// 施設は自分が使う言語 1 つで名前を書けばよく、設定タブで付けた名前はそのまま 1 本で保存される。
// 同梱のプロファイルは出発点なので {ja: "看護師", en: "Nurse"} の形で配ってあり、T.pickLabel がいまの言語で読む。
(function (T) {
  const LANGS = {};                       // コード → lang/<コード>.json の中身
  const DEFAULT_DOW = ["月", "火", "水", "木", "金", "土", "日"];
  // 同じ code を 2 回登録したら重ねる（施設のプラグインが lang/en.json で本体の英訳に自分の文面を足せる）。表（ui / msg / help）は鍵ごと、それ以外は上書き
  function registerLang(data) {
    if (!data || !data.code) return null;
    const cur = LANGS[data.code];
    if (!cur) { LANGS[data.code] = data; return data.code; }
    for (const [k, v] of Object.entries(data)) {
      if (v && typeof v === "object" && !Array.isArray(v) && cur[k] && typeof cur[k] === "object" && !Array.isArray(cur[k])) Object.assign(cur[k], v);
      else cur[k] = v;
    }
    return data.code;
  }

  let lang = "ja";
  const langOf = () => lang;
  const cur = () => LANGS[lang] || {};
  const langData = c => LANGS[c] || null;
  const langList = () => Object.values(LANGS).map(x => [x.code, x.name || x.code]);
  function setLang(l) { lang = LANGS[l] ? l : (LANGS.ja ? "ja" : (Object.keys(LANGS)[0] || "ja")); return lang; }
  const fill = (s2, vars) => (vars ? String(s2).replace(/\{(\w+)\}/g, (m, k) => (vars[k] === undefined || vars[k] === null ? m : String(vars[k]))) : String(s2));
  // 名簿の人の呼び方。どの施設でも「職員」（英語 staff member / staff）に統一する。
  // 文面では {person} {Person}（単数）・{people} {People}（複数）と書き、ここで言語ごとの語に置き換える
  const PERSON = { ja: ["職員", "職員"], en: ["staff member", "staff"] };
  function personWords() { return PERSON[lang] || PERSON.en; }
  const cap = w => w ? w[0].toUpperCase() + w.slice(1) : w;
  function person(s2) {
    if (String(s2).indexOf("{") < 0 || !/\{([Pp]erson|[Pp]eople)\}/.test(s2)) return String(s2);
    const [one, many] = personWords();
    return String(s2).replace(/\{person\}/g, one).replace(/\{Person\}/g, cap(one)).replace(/\{people\}/g, many).replace(/\{People\}/g, cap(many));
  }
  // 日本語の文字列を鍵にして訳を引く。いまの言語 → 英語 → 日本語（鍵そのもの）の順
  function t(s2, vars) {
    const k = String(s2 ?? "");
    let out = (cur().ui || {})[k];
    if (out == null && lang !== "ja" && lang !== "en") out = ((LANGS.en || {}).ui || {})[k];
    if (out == null) out = k;
    return person(fill(out, vars));
  }
  // 設定側の表示名（文字列 1 本 or {ja, en}）を、いまの言語で読む
  function pickLabel(v, fallback) {
    if (v == null || v === "") return fallback ?? "";
    if (typeof v === "object") return v[lang] || v.en || v.ja || Object.values(v).find(x => x) || (fallback ?? "");
    return String(v);
  }

  // 画面に出ている日本語を訳に差し替える。文字の入っている節（テキストノード）を順に見て、
  // その文字列が訳の表にあるときだけ置き換える。表に無いもの（氏名・日付・数字・未訳の文）はそのまま残る。
  // 元の日本語は節ごとに覚えるので、日本語へ戻すときは描き直さなくても戻る。
  const ORIG = new WeakMap();
  const SKIP = { SCRIPT: 1, STYLE: 1, TEXTAREA: 1, PRE: 1, CODE: 1 };
  function applyI18n(root) {
    const el = root || (typeof document !== "undefined" && document.body);
    if (!el || typeof document === "undefined") return;
    // 言語ごとに書き分けた塊（data-lang="ja" / "en"。ヘルプなど）は、いまの言語の方だけを出す
    for (const x of el.querySelectorAll("[data-lang]")) x.hidden = x.dataset.lang !== lang; // setLang が lang を ja か訳のある言語に限る
    const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, {
      acceptNode: n => (n.parentNode && SKIP[n.parentNode.nodeName]) || (n.parentNode && n.parentNode.closest && n.parentNode.closest("[data-noi18n]"))
        ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
    });
    for (let n = w.nextNode(); n; n = w.nextNode()) {
      const src = ORIG.has(n) ? ORIG.get(n) : n.nodeValue;
      const body = src.trim();
      if (!body) continue;
      const hit = t(body);
      if (hit === body) { if (ORIG.has(n) && n.nodeValue !== src) n.nodeValue = src; continue; } // 訳が無ければ元の日本語のまま
      if (!ORIG.has(n)) ORIG.set(n, src);
      const i = src.indexOf(body);
      n.nodeValue = src.slice(0, i) + hit + src.slice(i + body.length);
    }
    // placeholder と title も同じ表で引く
    for (const x of el.querySelectorAll("[placeholder],[title]")) for (const a of ["placeholder", "title"]) {
      const v = x.getAttribute(a); if (!v) continue;
      const keep = x.dataset[`i18n${a}`];
      const src = keep !== undefined ? keep : v;
      const tr = t(src.trim()), hit = tr === src.trim() ? null : tr;
      if (hit) { if (keep === undefined) x.dataset[`i18n${a}`] = src; x.setAttribute(a, hit); }
      else if (keep !== undefined) x.setAttribute(a, keep);
    }
  }

  const dowLabel = i => (cur().dow || (LANGS.en || {}).dow || DEFAULT_DOW)[((i % 7) + 7) % 7]; // 曜日の呼び方（月曜が 0）

  const listSep = () => cur().list_sep || "、";          // 並べるときの区切り
  const nameSep = () => cur().name_sep || "・";          // 氏名を並べるときの区切り
  const dateLocale = () => cur().date_locale || "ja-JP"; // 日付・時刻の書き方
  // ヘルプは節ごと（id で引く）。節の訳が無ければ英語 → 日本語に落ちるので、半分だけ訳した言語でも読める。
  // 言語ファイルが help を配列で持っているときは、その言語だけ構成を変えたいという指定なのでそのまま使う
  function help() {
    const of = c => (LANGS[c] || {}).help;
    const mine = of(lang);
    if (Array.isArray(mine)) return mine;
    const order = [], seen = new Set();
    for (const src of [of("en"), of("ja"), mine]) for (const id of (src && !Array.isArray(src) ? Object.keys(src) : [])) if (!seen.has(id)) { seen.add(id); order.push(id); }
    const out = [];
    for (const id of order) {
      const b = (mine && !Array.isArray(mine) && mine[id]) || (of("en") || {})[id] || (of("ja") || {})[id];
      if (b && b.title) out.push(b);
    }
    return out;
  }

  T.listSep = listSep; T.nameSep = nameSep;
  T.dowLabel = dowLabel;
  T.langsSnapshot = () => JSON.parse(JSON.stringify(LANGS)); T.langsRestore = data => { for (const k of Object.keys(LANGS)) delete LANGS[k]; Object.assign(LANGS, JSON.parse(JSON.stringify(data || {}))); }; // プラグインの読み込みを元に戻すため
  T.registerLang = registerLang; T.LANGS = langList; T.langData = langData; T.lang = langOf; T.setLang = setLang; T.t = t; T.pickLabel = pickLabel;
  T.dateLocale = dateLocale; T.help = help;
  T.applyI18n = applyI18n;
  T.person = person;
})(globalThis.T = globalThis.T || {});

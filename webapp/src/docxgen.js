// 当直表アプリ: 当直表 docx をブラウザ内で生成する。JSZip を使う。
//
// 帳票の様式は施設ごとに違うので、**様式は差し替えられる**ようにしてある。
//   本体（このファイルの前半）… docx の箱（zip・スタイル・用紙）と、段落・セル・表・略称などのプラグイン
//   様式（テンプレート）      … 行や列の組み立て。T.docx.register(id, render) で登録し、規則 docx.template で選ぶ
// 同梱の様式は 2 つ:
//   week_block  … 週ごとに 9 行のブロックを積む A3 縦の表（当直表向け。既定）
//   month_table … 行＝日、列＝勤務帯の表（1 枠に複数名を置く施設・2交代制向け）
// これ以外の様式が要る施設は、mod-<施設>.js で T.docx.register を呼び、docx.template にその id を書く。
// render(P, A, ctx) は本文（<w:body> の中身。<w:sectPr> を含む）の文字列か、{ body, files } を返す。
(function (T) {
  // XML エスケープ: HTML と同じ置換に加えて、XML 1.0 で許されない制御文字を落とす（入ると Word が開けない）
  const x = s => T.esc(String(s ?? "").replace(/[\x00-\x08\x0B\x0C\x0E-\x1F￾￿]/g, ""));
  const FILL_SUN = "F7CAAC", FILL_SAT = "BDD6EE", FILL_WD = "FFFFFF";
  const DEFAULT_FONT = "ＭＳ ゴシック";
  // 用紙（twip）。向きは portrait / landscape
  const PAPER = { A3: [16838, 23811], A4: [11906, 16838], Letter: [12240, 15840] };

  const fontOf = P => ((P.rules || {}).docx || {}).font || DEFAULT_FONT;
  // 段落・セル・行のプラグイン。様式はこれを組み合わせて表を作る
  function parts(font) {
    const rpr = (sz, bold, color) => `<w:rPr><w:rFonts w:ascii="${font}" w:hAnsi="${font}" w:eastAsia="${font}"/>${bold ? "<w:b/>" : ""}${color ? `<w:color w:val="${color}"/>` : ""}<w:sz w:val="${sz}"/><w:szCs w:val="${sz}"/></w:rPr>`;
    const para = (text, sz = 24, bold = false, jc = "left", color = null) => `<w:p><w:pPr><w:spacing w:before="0" w:after="0"/><w:jc w:val="${jc}"/></w:pPr><w:r>${rpr(sz, bold, color)}<w:t xml:space="preserve">${x(text)}</w:t></w:r></w:p>`;
    const cell = (text, width, fill, opts = {}) => `<w:tc><w:tcPr><w:tcW w:w="${width}" w:type="dxa"/><w:shd w:val="clear" w:color="auto" w:fill="${fill}"/><w:vAlign w:val="center"/></w:tcPr>${para(text, opts.sz || 24, !!opts.bold, opts.jc || "left", opts.color || null)}</w:tc>`;
    const row = (cells, height = 266) => `<w:tr><w:trPr><w:trHeight w:val="${height}"/></w:trPr>${cells.join("")}</w:tr>`;
    const table = (widths, rows) => `<w:tbl><w:tblPr><w:tblW w:w="${widths.reduce((a, b) => a + b, 0)}" w:type="dxa"/><w:tblBorders><w:top w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:left w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:bottom w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:right w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:insideH w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:insideV w:val="single" w:sz="4" w:space="0" w:color="auto"/></w:tblBorders><w:tblLayout w:type="fixed"/><w:tblCellMar><w:left w:w="60" w:type="dxa"/><w:right w:w="60" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid>${widths.map(w => `<w:gridCol w:w="${w}"/>`).join("")}</w:tblGrid>${rows.join("")}</w:tbl>`;
    return { rpr, para, cell, row, table };
  }
  // 用紙の指定（規則 docx.paper）。既定は様式ごとの既定値
  function sect(P, def) {
    const d = ((P.rules || {}).docx || {}).paper || {};
    const size = PAPER[d.size] ? d.size : def.size, orient = d.orient === "landscape" || d.orient === "portrait" ? d.orient : def.orient;
    const [pw, ph] = PAPER[size], [w, h] = orient === "landscape" ? [ph, pw] : [pw, ph];
    const m = +(d.margin ?? def.margin ?? 720);
    return `<w:sectPr><w:pgSz w:w="${w}" w:h="${h}"${orient === "landscape" ? ' w:orient="landscape"' : ""}/><w:pgMar w:top="${m}" w:right="${m}" w:bottom="${m}" w:left="${m}" w:header="${m}" w:footer="${m}" w:gutter="0"/></w:sectPr>`;
  }
  // 氏名の略称: 先頭1文字（サロゲートペアも1文字）。他の人と重なるときは重ならなくなるまで伸ばす。
  // 先頭の敬称（Dr / Ns / Mr / Ms / RN / MD と区切り）は略称から外す（"Dr A" → "A"。ラテン文字の氏名で全員が同じ略称になるのを防ぐ）
  function abbrev(names) {
    const stem = n => Array.from(String(n).replace(/^(?:dr|ns|mr|ms|rn|md)[.\s]+/i, "").trim() || String(n));
    const cut = (n, k) => stem(n).slice(0, k).join("");
    const out = {};
    for (const n of names) {
      const max = stem(n).length; let k = 1;
      while (k < max && names.some(m => m !== n && cut(m, k) === cut(n, k))) k++;
      out[n] = cut(n, k);
    }
    return out;
  }

  // ---- 様式の登録 ----
  const REG = {};
  const register = (id, render, meta) => { REG[id] = Object.assign({ id, label: id, render }, meta || {}); if (T.pluginSource) REG[id].source = T.pluginSource; if (T.plugins && T.plugins.recording) T.plugins.recording.push({ kind: "docx", id }); };
  const unregister = id => { delete REG[id]; }; // プラグインのフォルダを切り替えたとき
  const listTemplates = R => Object.values(REG).filter(t => !(R && T.pluginOff && T.pluginOff(R, t.source))).map(t => ({ id: t.id, label: t.label, source: t.source })); // R を渡すと、無効にしたプラグインの様式を除く
  const templateOf = (P, opts) => { const id = (opts || {}).template || ((P.rules || {}).docx || {}).template || "week_block";
    if (!REG[id]) throw new Error(T.t ? T.t("勤務表の様式「{id}」が読み込まれていません（施設のプラグインなら保存フォルダの plugins/docx/ に置いてください）", { id }) : `docx template ${id} is not registered`);
    if (T.pluginOff && T.pluginOff(P.rules, REG[id].source)) throw new Error(T.t ? T.t("勤務表の様式「{id}」のプラグイン {name} は無効になっています（設定タブ → 施設の構成を作る → 施設のプラグイン）", { id, name: REG[id].source }) : `docx template ${id}: plug-in disabled`);
    return REG[id]; };

  // 様式に渡す道具立て
  function context(P, A, label, opts) {
    const font = fontOf(P), p = parts(font);
    const baseAsg = opts.baseAsg || null; // 最小変更で直したとき、前回の版と違う枠を赤字にする
    const changed = (s, kind) => {
      if (!baseAsg) return false;
      const a = (opts.asg || {})[`${s[0]}:${s[1]}`] || {}, b = baseAsg[`${s[0]}:${s[1]}`] || {};
      return kind === "work" ? (a.work || "") !== (b.work || "") : [...(a.oc || [])].sort().join("・") !== [...(b.oc || [])].sort().join("・");
    };
    const today = opts.today ? new Date(opts.today) : new Date(); // opts.today: 表題の日付を固定する（回帰テスト用）
    return Object.assign({}, p, {
      x, label, opts, today, changed, font, FILL_SUN, FILL_SAT, FILL_WD,
      abbr: abbrev(P.names), rest: T.restDays(P, A),
      sect: def => sect(P, def),
      fillOf: d => (d == null) ? FILL_WD : (P.dow(d) === 6 || P.holidaysExtra.has(d)) ? FILL_SUN : (P.dow(d) === 5 ? FILL_SAT : FILL_WD),
      zen: s => String(s).replace(/[0-9]/g, c => String.fromCharCode(c.charCodeAt(0) + 0xFEE0)),
      dateStamp: () => `${today.getFullYear()}.${today.getMonth() + 1}/${today.getDate()}`,
    });
  }

  // ---- 同梱の様式 1: 週ごとの 9 行ブロック（A3 縦。当直表向け。下 4 行は手書き用の空欄） ----
  register("week_block", (P, A, c) => {
    const widths = [1728, 1933, 1933, 1933, 1933, 1933, 1933, 1933];
    const firstCol = (P.dow(1) + 1) % 7; // 列0=日曜
    const weeks = Math.floor((firstCol + P.N + 6) / 7);
    const dayAt = (w, col) => { const d = w * 7 + col - firstCol + 1; return (d >= 1 && d <= P.N) ? d : null; };
    const rows = [];
    rows.push(c.row([c.cell("", widths[0], c.FILL_WD)].concat(["日曜日", "月曜日", "火曜日", "水曜日", "木曜日", "金曜日", "土曜日"].map(x => T.t(x)).map((t, i) => c.cell(t, widths[i + 1], i === 0 ? c.FILL_SUN : i === 6 ? c.FILL_SAT : c.FILL_WD, { jc: "center" }))), 245));
    const labels = ["", P.shiftLabel("day"), P.shiftLabel("night"), P.state("oncall") === "off" ? "" : T.t("オンコール"), T.t("不可の日"), T.t("振休 午前"), T.t("振休 午後"), T.t("明け休"), T.t("外勤・出張")]; // 勤務帯の名前は施設の設定から。下 4 行は手書き用
    for (let w = 0; w < weeks; w++) {
      for (let r = 0; r < 9; r++) {
        const cells = [c.cell(labels[r], widths[0], c.FILL_WD)];
        for (let col = 0; col < 7; col++) {
          const d = dayAt(w, col); let text = "";
          if (d != null) {
            if (r === 0) text = d === 1 ? `${P.month}/${d}` : String(d);
            else if (r === 1) text = P.slotExists(d, "day") ? A.workText([d, "day"]) : "";
            else if (r === 2) text = A.workText([d, "night"]);
            else if (r === 3) text = P.slotExists(d, "day") ? `${A.oc([d, "day"]).join("・")}/${A.oc([d, "night"]).join("・")}` : A.oc([d, "night"]).join("・");
            else if (r === 4) { const una = /* 不可の日＝夜勤不可（日夜両方を含む） */ P.dutyNames.filter(n => (P.unavailNight[n] || new Set()).has(d) || (P.unavailOther[n] || []).some(([dd, pp]) => dd === d && pp === "allday")).map(n => c.abbr[n]); text = una.length <= 3 ? una.join("・") : una.join(""); }
          }
          let color = null;
          if (d != null && c.opts.baseAsg) { if (r === 1 && P.slotExists(d, "day") && c.changed([d, "day"], "work")) color = "C00000"; else if (r === 2 && c.changed([d, "night"], "work")) color = "C00000"; else if (r === 3 && ((P.isHoliday(d) && c.changed([d, "day"], "oc")) || c.changed([d, "night"], "oc"))) color = "C00000"; }
          cells.push(c.cell(text, widths[col + 1], c.fillOf(d), { jc: r === 0 ? "center" : "left", color }));
        }
        rows.push(c.row(cells, r === 0 ? 258 : (r <= 4 ? 266 : 239)));
      }
    }
    const pr = (P.rules || {}).profile || {}, facility = T.pickLabel ? T.pickLabel(pr.label, pr.id || "") : (pr.label || "");
    const title = T.t("{y}年{m}月　勤務表{facility} {stamp}　{label}", { y: P.year, m: P.month, facility: facility ? `（${facility}）` : "", stamp: c.dateStamp(), label: T.t(c.label) });
    return c.table(widths, rows) + c.para("", 12) + c.para(title, 36, true, "center") // 下部の週休日数の一覧は出さない（週休日は説明資料の第 8 節）
      + c.sect({ size: "A3", orient: "portrait", margin: 720 });
  }, { label: "週ブロック（A3縦・9行）" });

  // ---- 同梱の様式 2: 行＝日、列＝勤務帯の表（1 枠に複数名・2交代制向け） ----
  register("month_table", (P, A, c) => {
    const t = s => T.t(s);
    const shifts = P.shifts.filter(sh => P.slots.some(s => s[1] === sh.id));
    const hasOc = P.state("oncall") !== "off" && P.standbyRoleIds.length > 0;
    const cols = [{ w: 1400, head: t("日付") }];
    for (const sh of shifts) {
      cols.push({ w: 3000, head: sh.label, shift: sh.id, kind: "work" });
      if (hasOc) cols.push({ w: 2200, head: `${sh.label} ${t("オンコール")}`, shift: sh.id, kind: "oc" });
    }
    const widths = cols.map(x2 => x2.w);
    const rows = [c.row(cols.map((x2, i) => c.cell(x2.head, widths[i], c.FILL_WD, { jc: "center", bold: true })), 258)];
    for (let d = 1; d <= P.N; d++) {
      const fill = c.fillOf(d);
      const cells = [c.cell(`${P.month}/${d}(${T.dowLabel(P.dow(d))})`, widths[0], fill, { jc: "center" })];
      cols.slice(1).forEach((x2, i) => {
        let text = "", color = null;
        if (P.slotExists(d, x2.shift)) {
          text = (x2.kind === "work" ? A.workers([d, x2.shift]).map(n => P.nameWithTag([d, x2.shift], n)) : A.oc([d, x2.shift])).join(T.nameSep()); // 固定の印（研修など）は名前の後ろ
          if (c.opts.baseAsg && c.changed([d, x2.shift], x2.kind)) color = "C00000";
        }
        cells.push(c.cell(text, widths[i + 1], fill, { color }));
      });
      rows.push(c.row(cells, 266));
    }
    // 人ごとの回数と休みの日数（枠外の一覧）
    const order = P.nameOrder;
    const sum = [[t("氏名"), 1800], [t("勤務回数"), 1200], [t("休みの日数"), 1200]];
    const sw = sum.map(s => s[1]);
    const sumRows = [c.row(sum.map((s, i) => c.cell(s[0], sw[i], c.FILL_WD, { jc: "center", bold: true })), 258)];
    for (const n of order) {
      let work = 0, off = 0;
      for (let d = 1; d <= P.N; d++) { const w = shifts.some(sh => A.worked(n, [d, sh.id])); if (w) work++; else off++; }
      sumRows.push(c.row([c.cell(n, sw[0], c.FILL_WD), c.cell(String(work), sw[1], c.FILL_WD, { jc: "center" }), c.cell(String(off), sw[2], c.FILL_WD, { jc: "center" })], 266));
    }
    const title = T.t("{y}年{m}月 {kind} {stamp}　{label}", { y: P.year, m: P.month, kind: t("勤務表"), stamp: c.dateStamp(), label: t(c.label) });
    return c.para(title, 32, true, "center") + c.para("", 12) + c.table(widths, rows)
      + c.para("", 12) + c.para(t("勤務回数と休みの日数"), 24, true, "left") + c.table(sw, sumRows)
      + c.sect({ size: "A4", orient: "portrait", margin: 720 });
  }, { label: "月の表（行＝日・列＝勤務帯）" });

  // ---- 組み立て ----
  function renderDocx(P, asg, label = "確認版", opts = {}) {
    const A = new T.Asg(P, asg);
    const c = context(P, A, label, Object.assign({}, opts, { asg }));
    const out = templateOf(P, opts).render(P, A, c);
    const body = typeof out === "string" ? out : out.body;
    const xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`;
    return { xml, files: (typeof out === "string" ? null : out.files) || {} };
  }
  const docxXml = (P, asg, label = "確認版", opts = {}) => renderDocx(P, asg, label, opts).xml;

  async function makeDocx(P, asg, label, opts = {}) {
    const zip = new JSZip(), font = fontOf(P);
    const r = renderDocx(P, asg, label, opts);
    zip.file("[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>`);
    zip.file("_rels/.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`);
    zip.file("word/_rels/document.xml.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`);
    zip.file("word/styles.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="${font}" w:hAnsi="${font}" w:eastAsia="${font}"/><w:sz w:val="24"/><w:szCs w:val="24"/><w:lang w:val="en-US" w:eastAsia="ja-JP"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style></w:styles>`);
    zip.file("word/document.xml", r.xml);
    for (const [name, content] of Object.entries(r.files)) zip.file(name, content);
    return zip.generateAsync({ type: "blob", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
  }

  T.docx = { register, unregister, get: id => REG[id], list: listTemplates, parts, sect, abbrev, PAPER };
  T.docxXml = docxXml; T.renderDocx = renderDocx; T.makeDocx = makeDocx;
})(globalThis.T = globalThis.T || {});

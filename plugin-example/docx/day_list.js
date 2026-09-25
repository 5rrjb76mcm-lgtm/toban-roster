// 施設のプラグインの例（docx の様式）: 日ごとの一覧（A4 縦）。行＝日、列＝勤務帯の勤務者。
// render(P, A, c) が本文の XML を返す。c は本体の道具（cell / row / table / para / sect / fillOf / dateStamp / label など。src/docxgen.js の context）。
(function (T) {
  T.docx.register("day_list", (P, A, c) => {
    const t = s => T.t(s), shifts = P.shifts.filter(sh => P.slots.some(s => s[1] === sh.id));
    const widths = [1800].concat(shifts.map(() => Math.floor(7600 / Math.max(1, shifts.length))));
    const rows = [c.row([c.cell(t("日付"), widths[0], c.FILL_WD, { jc: "center", bold: true })].concat(shifts.map((sh, i) => c.cell(sh.label, widths[i + 1], c.FILL_WD, { jc: "center", bold: true }))), 258)];
    for (let d = 1; d <= P.N; d++) {
      const fill = c.fillOf(d);
      rows.push(c.row([c.cell(`${P.month}/${d}(${T.dowLabel(P.dow(d))})`, widths[0], fill, { jc: "center" })]
        .concat(shifts.map((sh, i) => c.cell(P.slotExists(d, sh.id) ? A.workers([d, sh.id]).join(T.nameSep()) : "", widths[i + 1], fill))), 266));
    }
    const title = T.t("{y}年{m}月 {kind} {stamp}　{label}", { y: P.year, m: P.month, kind: t("勤務表"), stamp: c.dateStamp(), label: t(c.label) });
    return c.para(title, 32, true, "center") + c.para("", 12) + c.table(widths, rows) + c.sect({ size: "A4", orient: "portrait", margin: 720 });
  }, { label: "日ごとの一覧（A4縦。施設のプラグインの例）" });
})(globalThis.T = globalThis.T || {});

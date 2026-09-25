// 暦のプラグイン: 日本の祝日（振替休日・国民の休日を含む）。2000 年以降の規則。docs/rule-modules.md §10
// 年末年始（12/29〜1/3）は祝日ではなく施設の休日なので、施設プロファイルの calendar.closure に書く（ここには無い）。
(function (T) {
  function holidays(y, m) {
    const nthMon = (mm, n) => { const first = new Date(y, mm - 1, 1).getDay(); const d = 1 + ((8 - first) % 7) + (n - 1) * 7; return d; };
    const vernal = Math.floor(20.8431 + 0.242194 * (y - 1980) - Math.floor((y - 1980) / 4));
    const autumn = Math.floor(23.2488 + 0.242194 * (y - 1980) - Math.floor((y - 1980) / 4));
    const base = { 1: [1, nthMon(1, 2)], 2: [11, y >= 2020 ? 23 : null], 3: [vernal], 4: [29], 5: [3, 4, 5], 7: [nthMon(7, 3)], 8: [11], 9: [nthMon(9, 3), autumn], 10: [nthMon(10, 2)], 11: [3, 23] };
    const isBase = (mm, d) => (base[mm] || []).includes(d);
    const daysIn = mm => new Date(y, mm, 0).getDate();
    const set = new Set((base[m] || []).filter(Boolean));
    // 振替休日: 祝日が日曜なら、その後の最初の平日（祝日でない日）
    for (const mm of [m - 1, m]) { if (mm < 1) continue; for (const d of (base[mm] || []).filter(Boolean)) { if (new Date(y, mm - 1, d).getDay() !== 0) continue; let dd = d + 1, mmm = mm; while (true) { if (dd > daysIn(mmm)) { dd = 1; mmm++; } if (!isBase(mmm, dd)) break; dd++; } if (mmm === m) set.add(dd); } }
    // 国民の休日: 祝日に挟まれた平日
    for (let d = 2; d < daysIn(m); d++) if (!set.has(d) && isBase(m, d - 1) && isBase(m, d + 1) && new Date(y, m - 1, d).getDay() !== 0) set.add(d);
    return [...set].sort((a, b) => a - b);
  }
  T.calendars.register({ id: "jp", label: { ja: "日本の祝日", en: "Japanese public holidays" }, holidays });
})(globalThis.T = globalThis.T || {});

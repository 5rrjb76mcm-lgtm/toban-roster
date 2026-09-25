// 施設のプラグインの例（暦）: アメリカ合衆国の連邦祝日（振替: 土曜なら前の金曜、日曜なら次の月曜）。
// holidays(y, m) はその年月の祝日の日付の並びを返す。年をまたぐ振替（1/1 が土曜 → 12/31）のため前後の年も見る。
(function (T) {
  const nthDow = (y, m, dow, n) => { const first = new Date(y, m - 1, 1).getDay(); return 1 + ((dow - first + 7) % 7) + (n - 1) * 7; }; // dow: 0=日
  const lastDow = (y, m, dow) => { const last = new Date(y, m, 0).getDate(), w = new Date(y, m - 1, last).getDay(); return last - ((w - dow + 7) % 7); };
  function fixedAndFloating(y) {
    return [[1, 1], [1, nthDow(y, 1, 1, 3)], [2, nthDow(y, 2, 1, 3)], [5, lastDow(y, 5, 1)], [6, 19], [7, 4], [9, nthDow(y, 9, 1, 1)], [10, nthDow(y, 10, 1, 2)], [11, 11], [11, nthDow(y, 11, 4, 4)], [12, 25]];
  }
  function observed(y, m, d) { const w = new Date(y, m - 1, d).getDay(); const dt = new Date(y, m - 1, d + (w === 6 ? -1 : w === 0 ? 1 : 0)); return [dt.getFullYear(), dt.getMonth() + 1, dt.getDate()]; }
  function holidays(y, m) {
    const out = new Set();
    for (const yy of [y - 1, y, y + 1]) for (const [mm, dd] of fixedAndFloating(yy)) { const [oy, om, od] = observed(yy, mm, dd); if (oy === y && om === m) out.add(od); }
    return [...out].sort((a, b) => a - b);
  }
  T.calendars.register({ id: "us", label: { ja: "アメリカ合衆国の連邦祝日", en: "US federal holidays" }, holidays });
})(globalThis.T = globalThis.T || {});

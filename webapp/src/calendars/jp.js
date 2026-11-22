// 暦のプラグイン: 日本の祝日（振替休日・国民の休日を含む）。2000 年以降の規則。docs/rule-modules.md §10
// 年末年始（12/29〜1/3）は祝日ではなく施設の休日なので、施設プロファイルの calendar.closure に書く（ここには無い）。
(function (T) {
  function holidays(y, m) {
    const nthMon = (mm, n) => { const first = new Date(y, mm - 1, 1).getDay(); const d = 1 + ((8 - first) % 7) + (n - 1) * 7; return d; };
    const vernal = Math.floor(20.8431 + 0.242194 * (y - 1980) - Math.floor((y - 1980) / 4));
    const autumn = Math.floor(23.2488 + 0.242194 * (y - 1980) - Math.floor((y - 1980) / 4));
    // 祝日の移動・新設と臨時の祝日。出典: https://www8.cao.go.jp/chosei/shukujitsu/gaiyou.html
    const olympics = y === 2020 || y === 2021;
    const base = {
      1: [1, nthMon(1, 2)], 2: y >= 2020 ? [11, 23] : [11],
      3: [vernal], 4: [29], 5: y < 2007 ? [3, 5] : [3, 4, 5],
      7: y === 2020 ? [23, 24] : y === 2021 ? [22, 23] : [y < 2003 ? 20 : nthMon(7, 3)],
      8: y < 2016 ? [] : [y === 2020 ? 10 : y === 2021 ? 8 : 11],
      9: [y < 2003 ? 15 : nthMon(9, 3), autumn],
      10: olympics ? [] : [nthMon(10, 2)], 11: [3, 23], 12: y <= 2018 ? [23] : []
    };
    if (y === 2019) { base[5].push(1); base[10].push(22); }
    const daysIn = mm => new Date(y, mm, 0).getDate();
    const isBase = (mm, d) => (base[mm] || []).includes(d);
    const set = new Set(base[m] || []);
    // 2006 年までは翌日だけ。2007 年からは祝日でない次の日まで繰り越す。
    for (const mm of [m - 1, m]) {
      for (const d of base[mm] || []) {
        if (new Date(y, mm - 1, d).getDay() !== 0) continue;
        let dd = d, mmm = mm;
        do {
          if (++dd > daysIn(mmm)) { dd = 1; mmm++; }
        } while (y >= 2007 && isBase(mmm, dd));
        if (mmm === m && !isBase(mmm, dd)) set.add(dd);
      }
    }
    // 国民の休日: 月境界も含め、前日と翌日が祝日である日（日曜・振替休日を除く）。
    for (let d = 1; d <= daysIn(m); d++) {
      const prev = d === 1 ? isBase(m - 1, daysIn(m - 1)) : isBase(m, d - 1);
      const next = d === daysIn(m) ? isBase(m + 1, 1) : isBase(m, d + 1);
      if (!set.has(d) && prev && next && new Date(y, m - 1, d).getDay() !== 0) set.add(d);
    }
    return [...set].sort((a, b) => a - b);
  }
  T.calendars.register({ id: "jp", label: { ja: "日本の祝日", en: "Japanese public holidays" }, holidays });
})(globalThis.T = globalThis.T || {});

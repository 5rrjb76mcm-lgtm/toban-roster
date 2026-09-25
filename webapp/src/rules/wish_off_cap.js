// 規則のプラグイン: 1 人が申告できる希望休の上限（wish_off_cap）。計算では使わず、入力チェックで超えた人を指摘する（どの申告を削るかは本人と決めることなので、自動では外さない）。
// 上限は rules.wish_off.max（P.wishOffMax）、数えるものは rules.wish_off.counts（P.wishOffCounts、P.wishOffDays）。docs/rule-modules.md
T.rules.register({
  id: "wish_off_cap", api: 1, order: 745, group: "rest",
  label: "1 人が申告できる希望休の上限を守る（入力チェックで指摘する）", states: ["hard", "off"], def: "off",
  weight: null, w0: null,
  read(P) { return { max: P.wishOffMax, counts: P.wishOffCounts }; },
  lint(ctx, prm) { for (const n of ctx.P.dutyNames) { const ds = ctx.P.wishOffDays(n); if (ds.length > prm.max) ctx.push("LINT_WISH_OFF_OVER", { who: n, count: ds.length, max: prm.max, days: ds.join(T.listSep()) }); } },
  ui: {
    render(R, h) { const { esc, tx, sel } = h, w = R.wish_off || {};
      return `<label>${esc(tx("上限"))} <input type="number" min="0" max="31" id="setWishOffMax" value="${w.max ?? 3}" style="width:4em"> ${esc(tx("日"))}</label>
　<label>${esc(tx("希望休として数えるもの: "))}${sel([["both", tx("不可 と 避けたい日")], ["unavailable", tx("不可だけ")], ["avoid", tx("避けたい日だけ")]], w.counts || "both", 'id="setWishOffCounts"')}</label>
<p class="note">${esc(tx("超えた人は入力チェック（計算タブ）で指摘します。どの申告を削るかは本人と決めることなので、自動では外しません。"))}</p>`; },
    read(R, el) { if (el("#setWishOffMax") || el("#setWishOffCounts")) { const w = Object.assign({}, R.wish_off);
      if (el("#setWishOffMax")) w.max = Math.max(0, +el("#setWishOffMax").value || 0); if (el("#setWishOffCounts")) w.counts = el("#setWishOffCounts").value; R.wish_off = w; } },
  },
  summary(P, prm, tv) { return tv("1 人 {n} 日まで（数えるのは {what}）", { n: prm.max, what: tv({ both: "不可 と 避けたい日", unavailable: "不可だけ", avoid: "避けたい日だけ" }[prm.counts] || prm.counts) }); },
  messages: {
    LINT_WISH_OFF_OVER: { en: "{who} declared {count} days off, above the cap of {max} (days {days})", ja: "{who} の希望休が {count} 日で上限 {max} 日を超えています（{days} 日）" },
    LINT_WISH_OFF_OVER_HINT: { en: "Per-person calendar → {who}: bring it down to {max} days, or review the cap under settings → rules", ja: "{person}別カレンダー → {who} で申告を {max} 日までに減らすか、設定タブ → 規則 → 希望休の上限 を見直す" },
  },
  python: false,
});

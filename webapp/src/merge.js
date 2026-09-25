// 当直表アプリ: 月データの3者統合（base=最後に保存した版, mine=このブラウザ, theirs=相手が保存したファイル）
(function (T) {
  const J = v => JSON.stringify(v);
  // flatten が個別に扱う月データの項目（と、版の履歴・旧形式の項目）。ここに無いトップレベルの項目（プラグインの規則の ui.month が書く m.local_<施設> など）は、値全体を 1 項目（x:<名前>）として 3 者比較する
  const KNOWN = new Set(["year", "month", "duties_on_holidays", "next_month_first_day_is_holiday", "next_first_day_in_calendar", "allow_chief_duty", "doc_label", "notes", "profile_id", "exceptions", "holidays", "plugins_used", "closure_days",
    "cath_off_days_A", "cath_off_days_I", "cath_off_days", "targets", "duty_days", "unavailable_night", "unavailable_other", "avoid", "wishes", "fixed", "fixed_tags", "day_flags", "day_notes", "person_days", "confirmed_pm_external_night", "history", "prev_month", "regular_duties",
    "doc_versions", "next_month_first_day_duties", "allow_split_weekend"]);
  const isEmpty = v => v === undefined || v === null || v === "" || v === false || (Array.isArray(v) && !v.length) || (v && typeof v === "object" && !Array.isArray(v) && !Object.keys(v).length);
  // 月データを「項目キー → 値」に展開する。集合は要素ごと、表は1マスごとに分ける
  function flatten(m) {
    const f = {};
    const put = (k, v) => { if (v !== undefined && v !== null && v !== "" && v !== false) f[k] = J(v); }; // 空・false は「無い」と同じ扱い（往復と統合で差にしない）
    for (const k of Object.keys(m)) if (!KNOWN.has(k) && !isEmpty(m[k])) f[`x:${k}`] = J(m[k]); // 本体が知らない項目（プラグインの月の値）。空は「無い」と同じ
    for (const k of ["year", "month", "duties_on_holidays", "next_month_first_day_is_holiday", "next_first_day_in_calendar", "allow_chief_duty", "doc_label", "notes", "profile_id"]) put("s:" + k, (k === "year" || k === "month") && m[k] != null ? +m[k] : m[k]);
    put("s:exceptions.weekend_balance_max_diff", (m.exceptions || {}).weekend_balance_max_diff);
    for (const d of m.holidays || []) f[`hol:${d}`] = "1";
    for (const id of m.plugins_used || []) f[`plugin:${id}`] = "1";
    for (const d of m.closure_days || []) f[`closure:${d}`] = "1";
    for (const d of m.cath_off_days_A || []) f[`cathoffA:${d}`] = "1";
    for (const d of m.cath_off_days_I || []) f[`cathoffI:${d}`] = "1";
    for (const d of m.cath_off_days || []) { f[`cathoffA:${d}`] = "1"; f[`cathoffI:${d}`] = "1"; }
    for (const [n, v] of Object.entries(m.targets || {})) put(`target:${n}`, v);
    for (const [n, dd] of Object.entries(m.duty_days || {})) for (const [d, e] of Object.entries(dd || {})) for (const part of ["am", "pm"]) put(`duty:${n}:${+d}:${part}`, (e || {})[part]);
    // 不可・避は医師×日で1つの項目（カレンダーの1つの選択肢に対応）。値: night/allday/day/avoid_night/avoid_day/avoid_allday
    // 同じ日に複数あるときの優先: 日夜両方 > 日勤帯 > 夜勤 > 避（不可が避に勝つ。lint が重複を知らせる）
    const putCal = (n, d, v) => { const k = `cal:${n}:${+d}`; const rank = x => (({ allday: 4, day: 3, night: 2 })[String(x).replace(/_paid$/, "")] || 1) + (/_paid$/.test(String(x)) ? 0.5 : 0); /* 同じ区分なら有給の方を残す */ if (f[k] === undefined || rank(v) > rank(JSON.parse(f[k]))) put(k, v); };
    for (const [n, ds] of Object.entries(m.unavailable_night || {})) for (const d of ds || []) putCal(n, d, "night");
    for (const u of m.unavailable_other || []) putCal(u.name, u.day, u.part + (u.paid ? "_paid" : "")); // 有給は不可の区分と一体の値（相手が消し、自分が有給にしたら衝突になる）
    for (const u of m.avoid || []) putCal(u.name, u.day ?? u.date, "avoid_" + (u.part || "allday"));
    for (const n of (m.wishes || {}).weekend_dayshift || []) f[`wkwish:${n}`] = "1";
    for (const [n, ds] of Object.entries((m.wishes || {}).night_on || {})) for (const d of ds || []) f[`wish:${n}:${d}`] = "1";
    for (const [n, ds] of Object.entries((m.wishes || {}).day_on || {})) for (const d of ds || []) f[`wishd:${n}:${d}`] = "1";
    const fx = m.fixed || {};
    for (const [d, ns] of Object.entries(fx.day || {})) for (const n of [].concat(ns || []).filter(Boolean)) f[`fd:${d}:${n}`] = "1"; // 1 枠に複数名を固定できるので人ごとの項目
    for (const [d, ns] of Object.entries(fx.night || {})) for (const n of [].concat(ns || []).filter(Boolean)) f[`fn:${d}:${n}`] = "1";
    for (const [k, tg] of Object.entries(m.fixed_tags || {})) if (tg) { const [sl, n] = k.split("|"), [d, kind] = sl.split(":"); put(`ftag:${d}:${kind}:${n}`, tg); } // 固定の印
    for (const [d, ids] of Object.entries(m.day_flags || {})) for (const id of [].concat(ids || []).filter(Boolean)) f[`dflag:${+d}:${id}`] = "1"; // 日ごとの区分
    for (const [d, txt] of Object.entries(m.day_notes || {})) if (txt) put(`dnote:${+d}`, txt); // 日ごとの予定
    for (const [id, byName] of Object.entries(m.person_days || {})) for (const [n, byDay] of Object.entries(byName || {})) for (const [d, v] of Object.entries(byDay || {})) if (v !== "" && v != null) put(`pday:${id}:${n}:${+d}`, v); // 職員別カレンダーの拡張の欄
    for (const [d, n] of Object.entries(fx.weekend_charge || {})) put(`fc:${d}`, n);
    for (const [d, ns] of Object.entries(fx.day_oc || {})) for (const n of ns || []) f[`fdo:${d}:${n}`] = "1";
    for (const [d, ns] of Object.entries(fx.night_oc || {})) for (const n of ns || []) f[`fno:${d}:${n}`] = "1";
    for (const [d, ts] of Object.entries(fx.day_oc_none || {})) for (const t of ts || []) f[`fdon:${d}:${t}`] = "1";
    for (const [d, ts] of Object.entries(fx.night_oc_none || {})) for (const t of ts || []) f[`fnon:${d}:${t}`] = "1";
    for (const c of m.confirmed_pm_external_night || []) f[`cpm:${c.name}:${c.day}`] = "1";
    const h = m.history || {};
    for (const k of ["weekend_charge", "holiday_charge", "work_balance"]) for (const [n, v] of Object.entries(h[k] || {})) put(`hist:${k}:${n}`, v);
    const pm = m.prev_month || {};
    put("prev:last_days", pm.last_days || []); put("s:prev_month.last_weekend_charge", pm.last_weekend_charge); put("s:prev_month.prev_weekend_charge", pm.prev_weekend_charge);
    for (const [n, pats] of Object.entries(m.regular_duties || {})) put(`pat:${n}`, pats || []);
    return f;
  }
  // 展開した項目から月データを組み立てる（template は未知の項目の引き継ぎ元）
  function unflatten(f, template) {
    const m = JSON.parse(J(template || {}));
    for (const k of ["cath_off_days", "next_month_first_day_duties", "allow_split_weekend"]) delete m[k]; // 旧形式の項目は持ち込まない（相手の版に残っていても復活させない）
    for (const k of Object.keys(m)) if (!KNOWN.has(k)) delete m[k]; // 本体が知らない項目も展開した値から作り直す（片方が消した項目を template から復活させない）
    const P = k => (f[k] === undefined ? undefined : JSON.parse(f[k]));
    for (const k of ["year", "month", "duties_on_holidays", "next_month_first_day_is_holiday", "next_first_day_in_calendar", "allow_chief_duty", "doc_label", "notes", "profile_id"]) { const v = P("s:" + k); if (v !== undefined) m[k] = v; else if (k === "notes") m[k] = ""; else if (["duties_on_holidays", "next_month_first_day_is_holiday", "next_first_day_in_calendar", "allow_chief_duty"].includes(k)) m[k] = false; }
    m.exceptions = {}; { const v = P("s:exceptions.weekend_balance_max_diff"); if (v !== undefined) m.exceptions.weekend_balance_max_diff = v; }
    m.holidays = []; m.closure_days = []; m.cath_off_days_A = []; m.cath_off_days_I = []; m.targets = {}; m.duty_days = {}; m.unavailable_night = {}; m.unavailable_other = []; m.avoid = []; m.wishes = { weekend_dayshift: [], night_on: {}, day_on: {} };
    m.fixed = { day: {}, night: {}, weekend_charge: {}, day_oc: {}, night_oc: {}, day_oc_none: {}, night_oc_none: {} }; m.confirmed_pm_external_night = []; m.history = { weekend_charge: {}, holiday_charge: {}, work_balance: {} };
    m.prev_month = { last_days: [], last_weekend_charge: null, prev_weekend_charge: null }; m.regular_duties = {};
    m.fixed_tags = {}; m.day_flags = {}; m.day_notes = {}; m.person_days = {}; delete m.plugins_used; // 新しい項目も空から作り直す（template の値が残ると、削除が復活し往復で重複する）
    for (const k of Object.keys(f).sort()) {
      const p = k.split(":"), v = P(k);
      if (p[0] === "hol") m.holidays.push(+p[1]);
      else if (p[0] === "plugin") (m.plugins_used ||= []).push(p.slice(1).join(":"));
      else if (p[0] === "closure") m.closure_days.push(+p[1]);
      else if (p[0] === "cathoffA") m.cath_off_days_A.push(+p[1]);
      else if (p[0] === "cathoffI") m.cath_off_days_I.push(+p[1]);
      else if (p[0] === "target") m.targets[p[1]] = v;
      else if (p[0] === "duty") ((m.duty_days[p[1]] ||= {})[+p[2]] ||= {})[p[3]] = v;
      else if (p[0] === "cal") { const paid = /_paid$/.test(String(v)), pv = String(v).replace(/_paid$/, "");
        if (pv === "night") (m.unavailable_night[p[1]] ||= []).push(+p[2]); else if (pv.startsWith("avoid_")) m.avoid.push({ name: p[1], day: +p[2], part: pv.slice(6) }); else m.unavailable_other.push(Object.assign({ name: p[1], day: +p[2], part: pv }, paid ? { paid: true } : {})); }
      else if (p[0] === "wkwish") m.wishes.weekend_dayshift.push(p[1]);
      else if (p[0] === "wish") (m.wishes.night_on[p[1]] ||= []).push(+p[2]);
      else if (p[0] === "wishd") ((m.wishes.day_on ||= {})[p[1]] ||= []).push(+p[2]);
      else if (p[0] === "fd" || p[0] === "fn") { const tbl = p[0] === "fd" ? m.fixed.day : m.fixed.night, cur = [].concat(tbl[+p[1]] || []); cur.push(p[2]); tbl[+p[1]] = cur.length === 1 ? cur[0] : cur; } // 1 名なら文字列、複数なら配列（保存形）
      else if (p[0] === "fc") m.fixed.weekend_charge[+p[1]] = v;
      else if (p[0] === "ftag") (m.fixed_tags ||= {})[`${+p[1]}:${p[2]}|${p[3]}`] = v;
      else if (p[0] === "dflag") ((m.day_flags ||= {})[+p[1]] ||= []).push(p[2]); else if (p[0] === "dnote") (m.day_notes ||= {})[+p[1]] = v;
      else if (p[0] === "pday") (((m.person_days ||= {})[p[1]] ||= {})[p[2]] ||= {})[+p[3]] = v;
      else if (p[0] === "fdo") (m.fixed.day_oc[+p[1]] ||= []).push(p[2]); else if (p[0] === "fno") (m.fixed.night_oc[+p[1]] ||= []).push(p[2]);
      else if (p[0] === "fdon") (m.fixed.day_oc_none[+p[1]] ||= []).push(p[2]); else if (p[0] === "fnon") (m.fixed.night_oc_none[+p[1]] ||= []).push(p[2]);
      else if (p[0] === "cpm") m.confirmed_pm_external_night.push({ name: p[1], day: +p[2] });
      else if (p[0] === "hist") m.history[p[1]][p[2]] = v;
      else if (k === "prev:last_days") m.prev_month.last_days = v;
      else if (k === "s:prev_month.last_weekend_charge") m.prev_month.last_weekend_charge = v;
      else if (k === "s:prev_month.prev_weekend_charge") m.prev_month.prev_weekend_charge = v;
      else if (p[0] === "pat") m.regular_duties[p[1]] = v;
      else if (p[0] === "x") m[p.slice(1).join(":")] = v; // 本体が知らない項目は値全体
    }
    m.holidays.sort((a, b) => a - b); m.closure_days.sort((a, b) => a - b); m.cath_off_days_A.sort((a, b) => a - b); m.cath_off_days_I.sort((a, b) => a - b);
    for (const n of Object.keys(m.unavailable_night)) m.unavailable_night[n].sort((a, b) => a - b);
    for (const n of Object.keys(m.wishes.night_on)) m.wishes.night_on[n].sort((a, b) => a - b);
    for (const n of Object.keys(m.wishes.day_on || {})) m.wishes.day_on[n].sort((a, b) => a - b);
    return m;
  }
  // 項目キーを人が読める名前にする
  function label(k) {
    const p = k.split(":");
    const day = d => `${d}日`;
    switch (p[0]) {
      case "s": return ({ year: "年", month: "月", duties_on_holidays: "土日祝の定期業務", next_month_first_day_is_holiday: "翌月1日は休日", next_first_day_in_calendar: "カレンダーの翌月1日欄あり", allow_chief_duty: "予備の役割を候補に含める", doc_label: "表題", profile_id: "施設", notes: "メモ", "exceptions.weekend_balance_max_diff": "週末担当の許容差", "prev_month.last_weekend_charge": "前月最後の週末担当", "prev_month.prev_weekend_charge": "前月その前の週末担当" })[p.slice(1).join(":")] || k;
      case "hol": return `祝日 ${day(p[1])}`; case "plugin": return `使ったプラグインの規則 ${p.slice(1).join(":")}`; case "closure": return `施設休日 ${day(p[1])}`; case "cathoffA": return `専門業務の配置不要（対の役割） ${day(p[1])}`; case "cathoffI": return `専門業務の配置不要（期間責任者） ${day(p[1])}`;
      case "target": return `${p[1]} の当月目標`; case "duty": return `${p[1]} ${day(p[2])} ${p[3] === "am" ? "午前" : "午後"}の業務`;
      case "cal": return `${p[1]} ${day(p[2])} の不可・避`;
      case "wkwish": return `${p[1]} の土日日勤希望`; case "wish": return `${p[1]} ${day(p[2])} の当直希望`; case "wishd": return `${p[1]} ${day(p[2])} の日勤希望`;
      case "fd": return `${day(p[1])} 日勤の固定 ${p[2]}`; case "fn": return `${day(p[1])} 夜勤の固定 ${p[2]}`; case "ftag": return `${day(p[1])} 固定の印 ${p[3]}`; case "dflag": return `${day(p[1])} 日の区分 ${p[2]}`; case "dnote": return `${day(p[1])} 日の予定`; case "pday": return `${p[2]} ${day(p[3])} ${p[1]}`; case "fc": return `${day(p[1])} 期間責任者の固定`;
      case "fdo": return `${day(p[1])} 日勤OC固定 ${p[2]}`; case "fno": return `${day(p[1])} 夜間OC固定 ${p[2]}`;
      case "fdon": return `${day(p[1])} 日勤 ${p[2]} のOCなし（固定）`; case "fnon": return `${day(p[1])} 夜間 ${p[2]} のOCなし（固定）`;
      case "cpm": return `${p[1]} ${day(p[2])} 午後外勤後の夜勤の確認`; case "hist": return `履歴 ${p[1]} ${p[2]}`;
      case "prev": return "前月末の接続"; case "pat": return `${p[1]} の曜日パターン`; case "x": return `プラグインの月の値 ${p.slice(1).join(":")}`;
      default: return k;
    }
  }
  // 3者統合。戻り値 {merged, mineChanges, theirChanges, conflicts:[{key,label,mine,theirs}]}
  function merge3(base, mine, theirs, prefer) {
    const B = flatten(base || {}), A = flatten(mine), C = flatten(theirs);
    const keys = new Set([...Object.keys(B), ...Object.keys(A), ...Object.keys(C)]);
    const out = {}, conflicts = []; let mineChanges = 0, theirChanges = 0;
    for (const k of keys) {
      const b = B[k], a = A[k], c = C[k];
      let v;
      if (a === b && c === b) v = b;
      else if (a === b) { v = c; theirChanges++; }
      else if (c === b) { v = a; mineChanges++; }
      else if (a === c) v = a;
      else { conflicts.push({ key: k, label: label(k), mine: a === undefined ? "（なし）" : JSON.parse(a), theirs: c === undefined ? "（なし）" : JSON.parse(c) }); v = prefer === "mine" ? a : c; }
      if (v !== undefined) out[k] = v;
    }
    const merged = unflatten(out, theirs);
    // 版の履歴は和集合
    const vers = {}; for (const v of [...(theirs.doc_versions || []), ...(mine.doc_versions || [])]) vers[v.ver] = v;
    merged.doc_versions = Object.values(vers).sort((x, y) => x.ver - y.ver);
    return { merged, mineChanges, theirChanges, conflicts };
  }
  T.mergeMonth = merge3; T.flattenMonth = flatten; T.unflattenMonth = unflatten;
})(globalThis.T = globalThis.T || {});

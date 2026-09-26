// 当直表アプリ（画面）: 設定タブ（名簿・重み・その他の規則・JSON 直接編集）。改名時の月データの追随
// app-*.js は T.app（以下 A）を介して互いを参照する。他のファイルの関数・共有変数（A.state, A.dirHandle など）は必ず A. を付ける（build.py --check が検査）。
(function (T, A) {
  const $ = s => document.querySelector(s);
  const esc = T.esc;
  const tx = (s2, a) => T.t(s2, a); // 日本語の文字列を鍵にして表示言語に訳す（訳が無ければ日本語のまま）。差し込む値があれば第 2 引数（{shift} など）
  const state = A.state;

  // 調整目標の重みの表示名（設定タブ）。キーは rules.yaml の weights と一致させる
  const WEIGHT_LABELS = {
    target_deviation: "当月目標からの乖離（1回あたり）",
    wish_night: "当直希望の未反映",
    chief_duty: "{reserve}を勤務に登用する（1回あたり。月1回まで。例外的な登用のときだけ）",
    fixed_conflict: "固定指定が連続禁止などと競合したまま配置（1件あたり）",
    missing_young_oc: "{other}の勤務で{junior}OCを置けない（1枠あたり）",
    avoid_day: "できれば避けたい日への配置（1枠あたり）",
    avoid_no_reduction: "避けたい日を申告した人の勤務回数が参照解（避けたい日を無視した計算）を下回る分（1回あたり。実質禁止）",
    wish_weekend_dayshift: "土日日勤の希望の未反映",
    same_weekday_excess: "同じ曜日の勤務が上限を超えた分",
    same_day_double: "同じ日に2つの枠（規則を「減点」にしたとき。1組あたり）",
    consecutive_days: "連日の実勤務（規則を「減点」にしたとき。1組あたり）",
    rest_day_missing: "外勤があるのに週休日が無い（規則を「減点」にしたとき。1名あたり）",
    days_off_short: "月の休みが最低日数に足りない分（規則を「減点」にしたとき。1日あたり）",
    days_off_pair_short: "2 連休の回数が足りない分（規則を「減点」にしたとき。1回あたり）",
    weekend_balance_excess: "週末担当の許容差を超えた分（規則を「減点」にしたとき。1日あたり）",
    friday_night_missing: "金曜夜勤の最低回数に足りない分（規則を「減点」にしたとき。1回あたり）",
    consecutive_weekend: "{charge}の連続する週末担当",
    split_weekend: "土日1組を土曜・日曜の2名に分割",
    weekend_history_spread: "履歴込みの週末担当の偏り（最多−最少）",
    charge_without_dayshift: "週末担当の{charge}にその週末の日勤がない",
    night_oc_then_duty: "夜間OC翌日の通常業務",
    night_then_am_duty: "夜勤翌日の午前のみの業務",
    oc_consecutive: "OC を含む隣接枠の連続（OC→OC、OC→勤務、勤務→OC。1組あたり。同日の日勤帯→夜間と{charge}の同じ土日は除く）",
    nonadjacent_consecutive: "隣接しない連日の当番",
    work_gap_1: "実勤務の間が中1日（夜勤→休み→夜勤など。1組あたり）",
    work_gap_2: "実勤務の間が中2日（1組あたり。中3日以上は減点なし）",
    spread_I_nightoc: "{charge}の夜間OC回数の偏り",
    spread_Y_oc: "{junior}のOC回数の偏り",
    spread_Y_holiday_work: "{junior}の休日勤務回数の偏り",
    base_change: "既存案からの変更（1箇所あたり）",
    staff_per_day: "当番（勤務・OC）に入る人数（1人・1日あたり。同日兼務は1人。無駄な人員配置を避ける）",
  };

  // ---------- 設定（名簿・重み） ----------
  function renderSettings() {
    const R = state.rules;
    // 名簿の欄は、その欄を使う規則を「なし」にすると隠す（施設ごとに要る欄だけを並べる）。
    // 本体の欄は 氏名・役割・年数・目安・当番。それ以外の欄は規則のプラグインが宣言する（def.columns。docs/rule-modules.md §5.4）
    const on = id => T.ruleState(R, id) !== "off";
    const L = s => T.term(s, R);
    const compOn = on("composition"), quotaOn = on("quota_range") || on("quota_target"); // 目安の欄は回数の規則を使うときだけ
    const share = (R.profile || {}).quota_mode === "share"; // 相対のときは目安の代わりに比重を書く
    const h = { esc, tx, sel: A.sel, term: s => T.term(s, R) };
    const cols = T.rules.columns(R); // プラグインの欄（見出しと、どの本体の欄の後に置くか）
    const at = k => cols.filter(c => (c.at || "duty") === k);
    const head = [["氏名", "役割", compOn ? "何年目" : "経験年数"].map(tx), at("years").map(c => tx(c.label)), quotaOn ? [tx(share ? "比重" : "目安（月）")] : [], at("quota").map(c => tx(c.label)), [tx("当番")], at("duty").map(c => tx(c.label)), [""]].flat();
    const cell = (c, d) => `<td data-col="${esc(c.key)}">${c.render(d, R, h)}</td>`;
    const rows = R.doctors.map((d, i) => `<tr data-i="${i}"><td><input data-f="name" value="${esc(d.name)}" style="width:5em"></td><td>${A.sel(T.normalizeRolesOf(R).map(x => [x.id, x.label]), d.team, 'data-f="team"')}</td><td><input type="number" data-f="years" value="${d.years ?? ""}" style="width:3.5em"></td>` +
      at("years").map(c => cell(c, d)).join("") +
      (quotaOn ? (share ? `<td><input type="number" min="0" step="0.1" data-f="share" value="${d.share ?? 1}" style="width:3.5em" title="${esc(tx("比重。1 が標準、0.5 なら半分、0 なら当番に入らない"))}"></td>` : `<td><input type="number" data-f="quota" value="${d.quota ?? 0}" style="width:3.5em"></td>`) : "") +
      at("quota").map(c => cell(c, d)).join("") +
      `<td>${A.sel([["", tx("配置する")], ["fixed_only", tx("固定したときだけ")], ["no_unless_needed", tx("原則配置しない")], ["never", tx("配置禁止")]], d.duty || "", 'data-f="duty"')}</td>` +
      at("duty").map(c => cell(c, d)).join("") +
      `<td><button data-act="up">↑</button><button data-act="down">↓</button><button data-act="del">削除</button></td></tr>`).join("");
    $("#doctorTable").innerHTML = `<table class="grid"><tr>${head.map(c => `<th>${esc(c)}</th>`).join("")}</tr>${rows}</table><p><button data-act="add">${esc(tx("{person}を追加"))}</button>　<span class="note">${esc(tx("表の順序が勤務表の枠外「週休日数」の氏名順になります。氏名を変えると、その月のカレンダー・不可日は新しい氏名に引き継がれます。名簿は月ごとの保存データに同梱されるので、過去の月は当時の名簿で開けます。欄が少ないと感じたら、対応する規則が「なし」になっていないか下の規則の表を確認してください。"))}</span></p>`;
    const W = R.weights || {};
    // 規則の表に出る重み（規則そのものの重みと、その中で使う重み）は、ここには重ねて出さない
    const owned = new Set((T.RULE_DEFS || []).flatMap(d => [d.weight].concat(d.sub || [])).filter(Boolean));
    const rest = Object.keys(WEIGHT_LABELS).filter(k => !owned.has(k));
    $("#weightsTable").innerHTML = `<table class="grid"><tr><th>${esc(tx("調整目標"))}</th><th>${esc(tx("重み"))}</th></tr>${rest.map(k => `<tr><td>${esc(L(tx(WEIGHT_LABELS[k])))}<br><small class="note">${esc(k)}</small></td><td><input type="number" data-w="${esc(k)}" value="${W[k] ?? ""}" style="width:5em"></td></tr>`).join("")}</table>
<p class="note">${esc(tx("ここに無い重みは、上の規則の表で規則ごとに並んでいます。"))}</p>`;
    renderBuilder(R); renderHardRules(R); renderUndo();
    { const el = $("#pluginsInfo"), pl = T.PLUGINS || [], fl = (T.plugins && T.plugins.loaded) || []; if (el) { const lines = [];
        if (pl.length) lines.push(T.t("組み立て時に取り込んだ施設のプラグイン: {list}", { list: pl.map(p => `${p.dir}（${Object.entries(p.files).map(([k, v]) => `${k} ${v.length}`).join(", ")}）`).join(T.listSep()) }));
        if (fl.length) lines.push(T.t("保存フォルダから読み込んだプラグイン: {list}", { list: fl.map(x => x.ok ? `${x.name}（${x.ids.join("・") || "—"}）` : T.t("{name}（読めません: {err}）", { name: x.name, err: x.error })).join(T.listSep()) }));
        el.hidden = !lines.length; el.textContent = lines.join("\n"); } }
    $("#rulesJson").value = JSON.stringify(R, null, 1);
  }

  // ---------- 施設の構成（役割・勤務帯・人数）と規則 ----------
  // 規則ごとの設定（その規則を「なし」以外にしたときだけ出す）。ここに出るものは、その規則が使う値そのもの
  // プラグインが宣言した値（def.params）の設定欄。label の {v} の位置に入力欄を置く。blank は空欄の意味（欄の横に添える）
  function paramField(R, p) {
    const cur = R[p.key], val = cur === undefined || cur === null ? "" : cur;
    const input = `<input type="number" data-prm="${esc(p.key)}" value="${esc(val)}"${p.min != null ? ` min="${p.min}"` : ""}${p.max != null ? ` max="${p.max}"` : ""} style="width:4em">`;
    const [a, b] = tx(p.label).split("{v}");
    return `<label>${esc(a)} ${input} ${esc(b || "")}</label>` + (p.blank ? ` <span class="note">${esc(T.t("空欄なら{what}", { what: tx(p.blank) }))}</span>` : "");
  }
  function ruleParams(R, def) {
    const L = s => T.term(s, R);
    const shifts = T.DEFAULT_SHIFTS.map(x => [x.id, T.pickLabel((((R.profile || {}).shifts || []).find(y => y.id === x.id) || x).label, x.id)]); // 表示名は {ja, en} のこともある
    if (def.params || def.ui) return (def.params || []).map(p => paramField(R, p)).join("　") + (def.ui && def.ui.render ? def.ui.render(R, { esc, tx, sel: A.sel, shifts, month: state.month, daysIn: A.daysIn }) : "");
    switch (def.id) {
      case "oncall": {
        const oc = R.oncall_requirement || {}, roles = T.normalizeRolesOf(R), sb = roles.filter(x => x.standby);
        return `<table class="grid" id="ocReqTbl"><tr><th>${esc(tx("勤務者の役割"))}</th>${sb.map(x => `<th>${esc(T.t("必要な {role} のオンコール（人）", { role: x.label }))}</th>`).join("") || `<th>${esc(tx("（オンコールに入れる役割がありません）"))}</th>`}</tr>` +
          roles.map(t => `<tr data-t="${esc(t.id)}"><td>${esc(t.label)}</td>${sb.map(x => `<td><input type="number" min="0" data-oc="${esc(x.id)}" value="${(oc[t.id] || {})[x.id] ?? 0}" style="width:3.5em"></td>`).join("")}</tr>`).join("") + `</table>
<p class="note">${esc(L(tx("勤務者の役割ごとに必要なオンコール。{other}の勤務のときだけ、{junior}のオンコールは置けなくてもよく、置けない枠は減点（missing_young_oc）します。")))}</p>`;
      }
      default: return "";
    }
  }
  // 読み込める施設プロファイル: 同梱の data/profiles と、既定の設定（循環器内科の架空の例。data/rules.json は profile を持たない）
  function profiles() {
    const list = (T.PROFILES || []).slice();
    if (!list.some(x => (x.profile || {}).id === "cardiology") && T.DEFAULT_RULES)
      list.unshift(Object.assign(JSON.parse(JSON.stringify(T.DEFAULT_RULES)), { profile: Object.assign({ id: "cardiology", label: { ja: "循環器内科（架空の例）", en: "Cardiology (fictional example)" } }, T.DEFAULT_RULES.profile || {}) }));
    return list;
  }
  // 施設の構成を作る（作成モード）: 出発点 → 1日の区分 → 役割 → 出力。施設を使い始めるときに一度決めるもの
  function renderBuilder(R) {
    const h = [], step = (n, title, body) => h.push(`<div class="builder-step"><h4>${n}. ${esc(tx(title))}</h4>${body}</div>`);
    { const cur = R.profile || {}; const pl = x => T.pickLabel((x || {}).label, (x || {}).id);
      const list = [[cur.id || "cardiology", `${pl(cur) || tx("現在の設定")}${tx("（いま使用中）")}`]]
        .concat(profiles().filter(x => (x.profile || {}).id !== (cur.id || "cardiology")).map(x => [(x.profile || {}).id, pl(x.profile)]));
      step(1, "出発点と、プロファイルの保存・読み込み", `<p><label>${esc(tx("施設プロファイル"))}: ${A.sel(list, cur.id || "cardiology", 'id="setProfile"')}</label>
 <button id="btnLoadProfile">${esc(tx("このプロファイルを読み込む"))}</button>
 <label class="filebtn">${esc(tx("プロファイルのファイルを読み込む"))}<input type="file" id="fileLoadProfile" accept=".json"></label></p>
<p><label>${esc(tx("このプロファイルの名前"))}: <input id="setProfLabel" value="${esc(pl(cur) || "")}" style="width:16em"></label>
　<label>${esc(tx("識別子"))}: <input id="setProfId" value="${esc(cur.id || "cardiology")}" style="width:9em"></label></p>
<p><button id="btnExportProfile">${esc(tx("プロファイルを書き出す"))}</button>
 <label><input type="checkbox" id="setExportRoster"> ${esc(tx("名簿をそのまま含める（施設内の引き継ぎ用。公開しない）"))}</label></p>
<p class="note">${esc(tx("書き出すのは施設の構成・使う規則・扱い・重み・規則ごとの値です。月データは含めません。名簿は、印を付けない限り役割と目安（回数・比重）だけを残し、氏名を「役割名＋番号」の仮の名前に置き換えます。経験年数・資格・個人別の条件・プラグインが足した欄は含めません。それでも氏名が残るとき（プロファイルの名前や規則の文に入れた場合）は書き出す前に知らせます（公開・共有用）。"))}</p>
<p class="note">${esc(tx("共有用は個人別の条件を除いた雛形です。共有先では名簿と個人別の条件（資格・回数など）を設定するまで解けないことがあります。プラグインが名簿の外に個人の記録を持つ場合、氏名をキーにした項目と name が氏名の要素は落としますが、ほかの形は残ります（プラグイン側の share で除けます）。"))}</p>
<p class="note">${esc(tx("近い施設のプロファイルを読み込み、下の 2〜7 で手直しします。読み込むと名簿・規則・規則の状態が置き換わります（「元に戻す」で取り消せます）。月データは施設の記録（profile_id）と照合され、違う施設のものを開くと入力チェックで指摘されます。"))}</p>`); }
    { const cal = T.calendarOf(R), srcs = T.calendars.defs.filter(c => !(T.pluginOff && T.pluginOff(R, c.source))).map(c => [c.id, T.pickLabel(c.label, c.id)]);
      const hid = (((R.profile || {}).calendar || {}).holidays) || cal.holidays; if (!srcs.some(([id]) => id === hid)) srcs.push([hid, `${hid} ${tx("（無効なプラグインの暦・未読み込み）")}`]); cal.holidays = hid; // 設定の値（無効なプラグインの暦でも）を保つ。計算・自動入力の代替は calendarOf が別に決める
      const closureText = cal.closure.flatMap(x => x.days.map(d => `${x.month}/${d}`)).join(", ");
      step(2, "暦（祝日と施設の休日）", `<p><label>${esc(tx("祝日の出どころ"))}: ${A.sel(srcs, cal.holidays, 'id="setCalHol"')}</label>
　<label>${esc(tx("施設の休日（毎年同じ月日。月/日をカンマ区切り）"))} <input id="setCalClosure" value="${esc(closureText)}" placeholder="12/29, 12/30, 12/31, 1/2, 1/3" style="width:22em"></label></p>
<p class="note">${esc(tx("月を作るときに、ここで決めた祝日と施設の休日が月の設定の「祝日・施設の休日」に入ります（月ごとに手で直せます）。祝日のない地域や、土日だけを休日にする施設は「祝日なし」を選びます。国の祝日を足すには src/calendars/ にファイルを 1 つ足します。"))}</p>`); }
    { const pos = ((R.profile || {}).positions || {}).work || {};
      const cnt = k => { const c = pos.count; if (c == null) return 1; if (typeof c === "number") return c; if (typeof c === "object" && c[k] !== undefined) return c[k]; return 1; };
      const cntMin = k => { const c = pos.min; if (c == null) return null; if (typeof c === "number") return c; if (typeof c === "object" && c[k] !== undefined) return c[k]; return null; };
      const cntIdeal = k => { const c = pos.ideal; if (c == null) return null; if (typeof c === "number") return c; if (typeof c === "object" && c[k] !== undefined) return c[k]; return null; };
      const shifts = T.normalizeShiftsOf(R);
      const ON = { day: [["none", tx("計算しない")], ["off_days", tx("土日祝だけ")], ["weekdays", tx("平日だけ")], ["all", tx("毎日")]],
        night: [["off_days", tx("土日祝だけ")], ["weekdays", tx("平日だけ")], ["all", tx("毎日")]] };
      const PART = { day: tx("日中"), night: tx("夜") };
      { const pf = R.profile || {}, tags = [].concat(pf.fixed_tags || []).map(x => typeof x === "string" ? x : x.label).filter(Boolean), flags = [].concat(pf.day_flags || []).map(x => typeof x === "string" ? x : (x.label || x.id)).filter(Boolean);
        h.push(`<div class="builder-step"><h4>2b. ${esc(tx("固定の印と日ごとの区分"))}</h4><p><label>${esc(tx("固定の印の選択肢（・区切り。例: 研修・会議・出張）"))} <input id="setFixedTags" value="${esc(tags.join("・"))}" style="width:22em"></label></p>
<p><label>${esc(tx("日ごとの区分（・区切り。例: 行事）"))} <input id="setDayFlags" value="${esc(flags.join("・"))}" style="width:22em"></label></p>
<p class="note">${esc(tx("固定の印は、職員別カレンダーの固定欄の横に選択肢として出て、勤務表に名前(印)で出ます。日ごとの区分は、月別条件の「日ごとの区分・予定」と職員別カレンダーの日付の見出しでチェックでき、構成の規則の「日」の選択肢（「○○」の日）に使えます。"))}</p></div>`); }
      step(3, "1日の区分と、計算で決める勤務帯", `<table class="grid" id="shiftTbl"><tr><th>${esc(tx("1日の区分"))}</th><th>${esc(tx("勤務帯の名前"))}</th><th>${esc(tx("計算で決める日"))}</th><th>${esc(tx("1枠の人数: 下限"))}</th><th>${esc(tx("理想"))}</th><th>${esc(tx("上限（固定の人数はここだけ）"))}</th></tr>` +
        shifts.map(x => `<tr data-shift="${esc(x.id)}"><td>${esc(PART[x.id] || x.id)}</td>` +
          `<td><input data-slabel value="${esc(x.label)}" style="width:8em"></td>` +
          `<td>${A.sel(ON[x.id] || ON.night, x.on, "data-son")}</td>` +
          `<td><input type="number" min="0" max="40" data-countmin="${esc(x.id)}" value="${cntMin(x.id) ?? ""}" placeholder="${esc(tx("固定"))}" style="width:4.5em"${x.on === "none" ? " disabled" : ""}></td>` +
          `<td><input type="number" min="0" max="40" data-countideal="${esc(x.id)}" value="${cntIdeal(x.id) ?? ""}" placeholder="―" style="width:4.5em"${x.on === "none" ? " disabled" : ""}></td>` +
          `<td><input type="number" min="1" max="40" data-count="${esc(x.id)}" value="${cnt(x.id)}" style="width:4em"${x.on === "none" ? " disabled" : ""}></td></tr>`).join("") + `</table>
<p class="note">${esc(tx("人数を決まった数にするなら上限だけを書きます。幅を持たせるなら下限も書き、なるべく近づけたい人数があれば理想に書きます（理想からずれた人数は減点。重みは日々の設定の「1枠の人数を理想値に近づける」）。下限と上限は必ず守ります。"))}</p>
<p class="note">${esc(tx("1 日を日中と夜の 2 つに分け、それぞれに名前を付けて、計算で当番を決める日を選びます。日中を「計算しない」にすると夜だけの当直になります。夜は必ず計算で決めます。日中の予定（午前・午後の外来・外勤など）は計算の対象ではなく、人ごとの予定の入力に使います。3 つ以上の区分（3 交代など）はこの版では使えません。"))}</p>
<p><label>${esc(tx("勤務回数の目安の決め方"))}: ${A.sel([["absolute", tx("絶対値（名簿に月◯回を書く）")], ["share", tx("相対（名簿に比重を書き、その月の枠数を按分する）")]], (R.profile || {}).quota_mode === "share" ? "share" : "absolute", 'id="setQuotaMode"')}</label></p>
<p class="note">${esc(tx("相対にすると、その月に必要な延べ人数（枠ごとの人数。幅があるときは理想値）を名簿の比重で按分した値が目安になります（1 が標準、0.5 なら半分、0 なら当番に入らない。端数は累計の過不足が少ない人から）。1 枠に複数名を置く施設や、月ごとに枠数が変わる施設向けです。月の設定の「当月の目標」で人ごとに上書きできます。休みの日数を「ちょうど」にしている施設では勤務日数が休みから決まるので、比重を下げても回数は夜勤（2 日ぶん）が増える形でしか減りません。その場合は比重は全員 1 のままにします。"))}</p>
<p class="note">${esc(tx("2 人以上にすると、オンコール・期間責任者・同日の役割集約は使えません（勤務者が 1 名である前提の規則のため、自動で「なし」にします）。人数を増やすほど同じ点数の解が増えるので、計算の上限時間は長めにしてください。"))}</p>`); }
    { const roles = T.normalizeRolesOf(R);
      // 「規則での役目」＝規則が役割を指すときの呼び名。施設ごとに違う役割名と規則を結び付ける
      const REFS = [["", tx("なし")], ["charge", tx("期間の責任者になれる")], ["other", tx("対になる役割")], ["junior", tx("補助として入る役割")], ["reserve", tx("原則配置しない予備")]];
      step(4, "役割", `<table class="grid" id="roleTbl"><tr><th>${esc(tx("識別子"))}</th><th>${esc(tx("表示名"))}</th><th>${esc(tx("規則での役目"))}</th><th>${esc(tx("オンコールに入れる"))}</th><th></th></tr>` +
        roles.map((x, i) => `<tr data-ri="${i}"><td><input data-rid value="${esc(x.id)}" style="width:5em"></td>` +
          `<td><input data-rlabel value="${esc(x.label)}" style="width:9em"></td>` +
          `<td>${A.sel(REFS, x.refs[0] || "", "data-rref")}</td>` +
          `<td style="text-align:center"><input type="checkbox" data-rstandby ${x.standby ? "checked" : ""}></td>` +
          `<td><button data-act="roleDel">${esc(tx("削除"))}</button></td></tr>`).join("") + `</table>
<p><button data-act="roleAdd">${esc(tx("役割を追加"))}</button></p>
<p class="note">${esc(tx("役割の名前は施設で決めます。識別子は名簿・保存データ・オンコール構成の表が参照するので、変えるとその月のデータと合わなくなります（入力チェックが指摘します）。「規則での役目」は、施設ごとに違う名前の役割と規則を結び付けるためのものです。規則の文面にはここで付けた表示名が出ます。期間の責任者・対になる役割・補助の役割はそれぞれ1つまでです。"))}</p>`); }
    // オンコール（待機）: 勤務者の役割ごとに、どの役割の待機を何人付けるか。計算で決める勤務帯のすべての枠に付く
    { const on = T.ruleState(R, "oncall") !== "off", def = T.RULE_BY_ID.oncall;
      const sts = T.normalizeShiftsOf(R).filter(x => x.on !== "none");
      step(5, "オンコール（待機）", `<p><label><input type="checkbox" data-ron="oncall" ${on ? "checked" : ""}> ${esc(tx("勤務者とは別に、オンコール（待機）の担当者も計算で決める"))}</label></p>` +
        (on ? `<p>${esc(tx("オンコールを付ける勤務帯: "))}${sts.map(x => `<label style="margin-right:1em"><input type="checkbox" data-soc="${esc(x.id)}" ${x.oncall !== false ? "checked" : ""}> ${esc(x.label)}</label>`).join("")}</p>` + ruleParams(R, def) : "") +
        `<p class="note">${esc(tx("オンコールに入れる役割は、上の役割の表の「オンコールに入れる」で選びます。付けない勤務帯の枠にはオンコールを置きません。1 枠に 2 人以上を置く勤務帯があると使えません。"))}</p>`); }
    // 施設のプラグインの一覧と、ファイルごとの付け外し（確認用。rules.plugins_off）
    { const inv = T.plugins && T.plugins.inventory ? T.plugins.inventory() : [], off = new Set(R.plugins_off || []);
      const KIND = { rules: "規則", dayflags: "日ごとの区分", calext: "カレンダーの拡張", docx: "様式", calendars: "暦", lang: "訳", profiles: "プロファイル" };
      const nameOf = (kind, id) => kind === "rules" && T.RULE_BY_ID[id] ? T.ruleLabel(R, T.RULE_BY_ID[id]) : kind === "docx" && T.docx.get(id) ? tx(T.docx.get(id).label) : kind === "dayflags" && T.dayFlags.byId[id] ? T.pickLabel(T.dayFlags.byId[id].label, id) : id;
      const KIND1 = { rules: "規則", calendars: "暦", docx: "様式", lang: "訳", profiles: "プロファイル" }, toggl = p => p.kind !== "lang" && p.kind !== "profiles"; // 訳とプロファイルは付け外しの対象外
      const rows = inv.map(p => `<tr class="plugrow"><td style="text-align:center;width:3em">${toggl(p) ? `<input type="checkbox" data-pon="${esc(p.name)}" ${off.has(p.name) ? "" : "checked"}>` : "—"}</td><td>${esc(tx(KIND1[p.kind] || p.kind))}</td><td><b>${esc(p.name)}</b>${p.ok ? "" : `<br><small class="note" style="color:#a33">${esc(T.t("読めません: {err}", { err: p.error }))}</small>`}</td>` +
        `<td>${esc(p.where === "folder" ? tx("保存フォルダの plugins/ から実行時に") : tx("組み立て時に焼き込み"))}</td>` +
        `<td>${Object.entries(p.items).map(([k, ids]) => `<div><small class="note">${esc(tx(KIND[k] || k))}:</small> ${ids.map(id => esc(nameOf(k, id))).join("、")}</div>`).join("") || `<small class="note">${esc(tx("（登録なし）"))}</small>`}</td></tr>`);
      step("5b", "施設のプラグイン", inv.length ? `<table class="grid" id="pluginTbl"><tr><th>${esc(tx("有効"))}</th><th>${esc(tx("種類"))}</th><th>${esc(tx("ファイル"))}</th><th>${esc(tx("読み込み元"))}</th><th>${esc(tx("中身"))}</th></tr>${rows.join("")}</table>
<p class="note">${esc(tx("印を外すと、そのファイルの規則は「なし」、日ごとの区分・カレンダーの拡張・様式・暦は無いものとして扱います（確認用。訳とプロファイルは付け外しの対象外）。規則の状態は覚えているので、戻せば元どおり。プラグイン由来のものには「プラグイン」の印が付きます。"))}</p>`
        : `<p class="note">${esc(tx("プラグインはありません（保存フォルダの plugins/ に置いてフォルダに接続するか、組み立て時に取り込みます）。"))}</p>`); }
    // 使う規則: 規則ごとに使う・使わないを決める。使う規則の「必須か減点か」と重みは日々の設定で決める
    { const rows = [];
      for (const [gid, glabel] of (T.RULE_GROUPS || [])) {
        const defs = (T.RULE_DEFS || []).filter(d => (d.group || "basic") === gid && d.id !== "oncall");
        if (!defs.length) continue;
        rows.push(`<tr><th colspan="2">${esc(tx(glabel))}</th></tr>` + defs.map(def => { const poff = T.pluginOff && T.pluginOff(R, def.source); // プラグインごと無効なら印を付けられない
          return `<tr${plugRow(def)}><td style="text-align:center;width:3em"><input type="checkbox" data-ron="${esc(def.id)}" ${T.ruleState(R, def.id) !== "off" ? "checked" : ""}${poff ? " disabled" : ""}></td>` +
          `<td>${plugTag(def)}${esc(T.ruleLabel(R, def))}<br>${idNote(R, def)}${poff ? `<br><small class="note">${esc(tx("このプラグインは無効です（上の「施設のプラグイン」で有効にする）"))}</small>` : ""}</td></tr>`; }).join(""));
      }
      step(6, "使う規則", `<table class="grid rulestbl" id="ruleOnTbl">${rows.join("")}</table>
<p class="note">${esc(tx("この施設で使う規則に印を付けます。印を外した規則は計算にも検算にも使わず、日々の設定にも出ません。使う規則を「必須」にするか「減点」にするか、減点の重みと規則ごとの値は、日々の設定で決めます。2交代制のように連勤がある職場では「実勤務が連日」を外し、「連勤の上限」を使います。"))}</p>`); }
    // 出力（当直表 docx の様式と用紙）。様式は T.docx.register で足せる
    { const d = R.docx || {}, pp = d.paper || {};
      const tmpl = (T.docx ? T.docx.list(R) : []).map(t => [t.id, tx(t.label)]); // 無効にしたプラグインの様式は選べない
      if (d.template && !tmpl.some(([id]) => id === d.template)) tmpl.push([d.template, `${d.template} ${tx("（無効なプラグインの様式・未読み込み）")}`]); // いまの値は壊さない（有効に戻せば元どおり）
      step(7, "出力（勤務表 docx）", `<p><label>${esc(tx("様式"))}: ${A.sel(tmpl.length ? tmpl : [["week_block", "week_block"]], d.template || "week_block", 'id="setDocxTmpl"')}</label>
　<label>${esc(tx("用紙"))}: ${A.sel([["", tx("様式の既定")], ["A3", "A3"], ["A4", "A4"], ["Letter", "Letter"]], pp.size || "", 'id="setDocxSize"')}</label>
　<label>${esc(tx("向き"))}: ${A.sel([["", tx("様式の既定")], ["portrait", tx("縦")], ["landscape", tx("横")]], pp.orient || "", 'id="setDocxOrient"')}</label></p>
<p class="note">${esc(tx("様式は帳票の形（行と列の組み立て）です。ここに無い様式が要る施設は、追加のスクリプトで T.docx.register(id, 組み立て) を登録すると、この一覧に出ます。"))}</p>`); }
    h.push(`<p class="note">${esc(tx("名簿と、使う規則の扱い（必須か減点か）・重みは「日々の設定」で決めます。"))}</p>`);
    $("#profileBuilder").innerHTML = h.join("");
  }
  // 規則の出どころ（保存フォルダのプラグインなら読んだファイル名）と、同じことを扱う規則が両方とも使われているときの注意（規則の一覧と「使う規則」に添える）
  const fromFolder = name => (T.plugins && T.plugins.loaded || []).some(x => x.name === name);
  const srcNote = def => def.source ? T.t("プラグイン: {name}", { name: def.source }) + (fromFolder(def.source) ? "" : tx("（組み立て時）")) : /^local\./.test(def.id) ? tx("組み立て時に取り込んだプラグイン") : "";
  const plugTag = def => (def.source || /^local\./.test(def.id)) ? `<span class="plug" title="${esc(srcNote(def))}">${esc(tx("プラグイン"))}</span> ` : ""; // プラグイン由来の印
  const plugRow = def => (def.source || /^local\./.test(def.id)) ? ' class="plugrow"' : "";
  const overlapNote = (R, def) => { const both = (def.overlaps || []).filter(o => T.RULE_BY_ID[o] && T.ruleState(R, o) !== "off").map(o => T.ruleLabel(R, T.RULE_BY_ID[o])), parts = [];
    if (both.length) parts.push(T.t("「{list}」と同じことを扱います。片方を外すか、両方でよいか確かめてください", { list: both.join("」「") })); if (def.overlapsNote) parts.push(T.term(tx(def.overlapsNote), R));
    return parts.length ? `<br><small class="note" style="color:#a33">⚠ ${esc(parts.join(" "))}</small>` : ""; };
  const idNote = (R, def) => `<small class="note">${esc(def.id)}${srcNote(def) ? "　" + esc(srcNote(def)) : ""}</small>${overlapNote(R, def)}`;
  function renderHardRules(R) {
    const h = [];
    // 規則: 区分ごとに「必須 / 減点 / なし」を選び、その規則の設定は「なし」以外のときだけ下に出す
    { // いまの設定から作る規則の要約（説明資料の第 0 節と同じもの）
      let sum = "";
      try { const P = new T.Problem(R, state.month); sum = (T.rulesSummary(P) || []).map(g => `<h4>${esc(g.head)}</h4><ul>${g.items.map(i => `<li>${esc(i)}</li>`).join("")}</ul>`).join(""); }
      catch (e) { sum = `<p class="note">${esc(String(e && e.message || e))}</p>`; }
      h.push(`<details class="box rulesum"><summary>${esc(tx("いまの設定でできる規則の文（説明資料にも出ます）"))}</summary>${sum}</details>`);
    }
    h.push(`<h4>${esc(tx("規則"))}</h4>
<p class="note">${esc(tx("この施設で使う規則だけが並びます（使う規則は「施設の構成を作る」で選びます）。「必須」は守れないときに解なし、「減点」は重みで避ける調整目標です。重みが大きいほど優先して守ります。"))}</p>`);
    let shown = 0;
    for (const [gid, glabel] of (T.RULE_GROUPS || [])) {
      const defs = (T.RULE_DEFS || []).filter(d => (d.group || "basic") === gid && T.ruleState(R, d.id) !== "off");
      if (!defs.length) continue;
      const rows = [];
      for (const def of defs) {
        const st = T.ruleState(R, def.id), onStates = def.states.filter(x => x !== "off");
        rows.push(`<tr data-rs="${esc(def.id)}"${plugRow(def)}><td>${plugTag(def)}${esc(T.ruleLabel(R, def))}<br>${idNote(R, def)}</td>` +
          `<td>${onStates.length > 1 ? A.sel(onStates.map(x => [x, tx(T.STATE_JA[x])]), st, `data-rsv="${esc(def.id)}"`) : esc(tx(T.STATE_JA[st]))}</td>` +
          `<td>${def.weight && onStates.includes("soft") ? `<input type="number" data-rsw="${esc(def.weight)}" value="${R.weights?.[def.weight] ?? def.w0}" style="width:5em"${st === "soft" ? "" : " disabled"}>` : "―"}</td></tr>`);
        const parts = [];
        const p = def.id === "oncall" ? "" : ruleParams(R, def); if (p) parts.push(p); // オンコールの構成は施設の構成を作るで決める
        const subs = (def.sub || []).filter(k => WEIGHT_LABELS[k]);
        if (subs.length) parts.push(`<div class="note">${esc(tx("この規則の中で使う重み: "))}` +
          subs.map(k => `<label style="margin-right:1em">${esc(T.term(tx(WEIGHT_LABELS[k]), R))} <input type="number" data-rsw="${esc(k)}" value="${R.weights?.[k] ?? ""}" style="width:5em"></label>`).join("") + `</div>`);
        if (parts.length) rows.push(`<tr class="rparam"><td colspan="3">${parts.join("")}</td></tr>`);
        shown++;
      }
      h.push(`<table class="grid rulestbl"><tr><th style="width:52%">${esc(tx(glabel))}</th><th style="width:8em">${esc(tx("扱い"))}</th><th style="width:7em">${esc(tx("「減点」の重み"))}</th></tr>${rows.join("")}</table>`);
    }
    if (!shown) h.push(`<p class="note">${esc(tx("使う規則がありません。「施設の構成を作る」の「使う規則」で選んでください。"))}</p>`);
    $("#hardRules").innerHTML = h.join("");
  }
  function readHardRules(R) {
    const el = s => document.querySelector(s); // 「なし」の規則は設定欄を出さないので、無い欄は前の値のまま残す
    for (const def of (T.RULE_DEFS || [])) { // プラグインが宣言した値と、プラグインの設定欄
      for (const p of def.params || []) { const x = el(`#hardRules [data-prm="${p.key}"]`); if (!x) continue; R[p.key] = x.value === "" ? null : Math.max(p.min ?? -Infinity, +x.value || 0); }
      if (def.ui && def.ui.read && el("#hardRules")) def.ui.read(R, s => el("#hardRules " + s));
    }
    R.profile ||= {};
    { const lab = document.querySelector("#setProfLabel"), pid = document.querySelector("#setProfId");
      const shown = T.pickLabel((R.profile || {}).label, (R.profile || {}).id);
      if (lab && lab.value.trim() && lab.value.trim() !== shown) R.profile.label = lab.value.trim(); // 名前を変えていなければ元の表記（{ja, en} など）のまま
      if (pid && pid.value.trim()) R.profile.id = pid.value.trim().replace(/[^\w.-]+/g, "-"); }
    { const hol = document.querySelector("#setCalHol"), clo = document.querySelector("#setCalClosure"); // 暦（祝日の出どころと施設の休日）
      if (hol) { const closure = {};
        for (const tok of String(clo ? clo.value : "").split(/[,、\s]+/).filter(Boolean)) { const m = tok.match(/^(\d{1,2})\/(\d{1,2})$/); if (m && +m[1] >= 1 && +m[1] <= 12 && +m[2] >= 1 && +m[2] <= 31) (closure[+m[1]] ||= []).push(+m[2]); }
        R.profile.calendar = { holidays: hol.value, closure: Object.keys(closure).map(Number).sort((a, b) => a - b).map(mo => ({ month: mo, days: [...new Set(closure[mo])].sort((a, b) => a - b) })) }; } }
    { const ft = document.querySelector("#setFixedTags"), df = document.querySelector("#setDayFlags"); // 固定の印と日ごとの区分（施設の構成）
      const split = v => [...new Set(String(v || "").split(/[・,、\n]+/).map(x => x.trim()).filter(Boolean))];
      if (ft) { const v = split(ft.value); const old = [].concat(R.profile.fixed_tags || []); R.profile.fixed_tags = v.map(l => old.find(o => typeof o === "object" && o.label === l) || l); if (!v.length) delete R.profile.fixed_tags; }
      if (df) { const v = split(df.value); const old = [].concat(R.profile.day_flags || []); R.profile.day_flags = v.map(l => old.find(o => typeof o === "object" && (o.label === l || o.id === l)) || l); if (!v.length) delete R.profile.day_flags; } }
    { const roles = [], oldRoles = T.normalizeRolesOf(R);
      document.querySelectorAll("#roleTbl tr[data-ri]").forEach(tr => {
        const g = k => tr.querySelector(`[data-${k}]`);
        const id = g("rid").value.trim(); if (!id) return;
        // 表示名は施設が使う言語 1 つで持つ（同梱のプロファイルは出発点なので {ja, en} で配っているが、
        // 施設が名前を付け直したらその 1 本になる）
        const r = { id, label: g("rlabel").value.trim() || id, refs: g("rref").value ? [g("rref").value] : [] };
        if (g("rstandby").checked) r.standby = true;
        const prev = oldRoles[+tr.dataset.ri];
        if (prev && prev.id !== id) renameRole(prev.id, id); // 識別子を変えたら名簿・オンコール構成・固定「OCなし」も追随させる
        roles.push(r);
      });
      if (roles.length) R.profile.roles = roles;
      { const old = T.normalizeShiftsOf(R), shifts = [];
        document.querySelectorAll("#shiftTbl tr[data-shift]").forEach(tr => {
          const id = tr.dataset.shift, o = old.find(x => x.id === id) || {}, lab = tr.querySelector("[data-slabel]").value.trim();
          // 名前を変えていなければ元の表記（{ja, en} など）のまま残す
          const soc = document.querySelector(`#profileBuilder [data-soc="${id}"]`); // オンコールを使わない間は欄が無いので、前の値のまま
          const sh = { id, label: !lab || lab === o.label ? (o.labelRaw ?? o.label) : lab, on: tr.querySelector("[data-son]").value };
          if ((soc ? soc.checked : o.oncall !== false) === false) sh.oncall = false;
          shifts.push(sh);
        });
        if (shifts.length) R.profile.shifts = shifts; }
      const count = {}; let multi = false;
      document.querySelectorAll("#shiftTbl [data-count]").forEach(x => { const v = Math.max(1, Math.min(40, +x.value || 1)); count[x.dataset.count] = v; if (v > 1) multi = true; });
      const mins = {}; document.querySelectorAll("#shiftTbl [data-countmin]").forEach(x => { if (x.value !== "") mins[x.dataset.countmin] = Math.max(0, Math.min(count[x.dataset.countmin] || 1, +x.value || 0)); });
      const ideals = {}; document.querySelectorAll("#shiftTbl [data-countideal]").forEach(x => { if (x.value !== "") ideals[x.dataset.countideal] = Math.max(0, Math.min(count[x.dataset.countideal] || 1, +x.value || 0)); });
      const hadIdeal = !!((((R.profile || {}).positions || {}).work || {}).ideal);
      if (Object.keys(count).length) (R.profile.positions ||= {}).work = Object.assign({ count }, Object.keys(mins).length ? { min: mins } : {}, Object.keys(ideals).length ? { ideal: ideals } : {});
      { const qm = document.querySelector("#setQuotaMode"); if (qm) { if (qm.value === "share") R.profile.quota_mode = "share"; else delete R.profile.quota_mode; } } // 目安の決め方
      R._idealAdded = !hadIdeal && Object.keys(ideals).length > 0; // 理想値を新しく書いたら、それに近づける規則を使う（規則の状態を読んだ後で入れる）
      R._multiWork = multi; // 複数名かどうか（規則の状態を読んだあとで併用できない規則を外す）
    }
    { const pon = [...document.querySelectorAll("#profileBuilder [data-pon]")]; if (pon.length) { const off = pon.filter(x => !x.checked).map(x => x.dataset.pon); if (off.length) R.plugins_off = off; else delete R.plugins_off; } } // プラグインごとの付け外し（規則の状態より先に読む）
    R.rule_states ||= {};
    for (const def of (T.RULE_DEFS || [])) {
      const on = document.querySelector(`#profileBuilder [data-ron="${def.id}"]`), sv = document.querySelector(`#hardRules [data-rsv="${def.id}"]`);
      if ((T.pluginOff && T.pluginOff(R, def.source)) || (on && on.disabled)) continue; // 無効にしたプラグインの規則は状態を書き換えない（無効の間に描いた印の無い欄も読まない。戻したときに元どおり）
      const cur = T.ruleState(R, def.id);
      if (on && !on.checked) R.rule_states[def.id] = "off";
      else if (on && cur === "off") R.rule_states[def.id] = def.def !== "off" ? def.def : def.states.find(x => x !== "off"); // 使うにした規則は既定の扱いから始める
      else if (sv) R.rule_states[def.id] = sv.value;
    }
    document.querySelectorAll("#hardRules [data-rsw]").forEach(x => { if (!x.disabled && x.value !== "") (R.weights ||= {})[x.dataset.rsw] = +x.value; });
    if (R._multiWork) { // 1 枠に複数名のときは、勤務者が 1 名である前提の規則を外す（そのままだと計算できない）
      const off = ["oncall", "period_charge", "same_day_team"].filter(id => T.RULE_BY_ID[id] && T.ruleState(R, id) !== "off"); // 登録の無い規則（プラグイン）は無視
      for (const id of off) R.rule_states[id] = "off";
      if (off.length) setTimeout(() => A.toast(T.t("1 枠に複数名を置くため、{list} を「なし」にしました", { list: off.map(id => T.t((T.RULE_BY_ID[id] || {}).label || id)).join(T.listSep()) })), 0);
    }
    delete R._multiWork;
    if (R._idealAdded && T.ruleState(R, "count_target") === "off") R.rule_states.count_target = "soft";
    delete R._idealAdded;
    T.fillDefaultRules(R); // 旧キー（rest_day_required など）と重みを状態に合わせて揃える
    { // 出力の様式と用紙
      const d = Object.assign({}, R.docx);
      if (el("#setDocxTmpl")) d.template = el("#setDocxTmpl").value;
      if (el("#setDocxSize") || el("#setDocxOrient")) {
        const pp = Object.assign({}, d.paper);
        if (el("#setDocxSize")) { if (el("#setDocxSize").value) pp.size = el("#setDocxSize").value; else delete pp.size; }
        if (el("#setDocxOrient")) { if (el("#setDocxOrient").value) pp.orient = el("#setDocxOrient").value; else delete pp.orient; }
        if (Object.keys(pp).length) d.paper = pp; else delete d.paper;
      }
      if (Object.keys(d).length) R.docx = d; else delete R.docx;
    }
    if (el("#ocReqTbl")) { const oc = {}; document.querySelectorAll("#ocReqTbl tr[data-t]").forEach(tr => { const row = {}; tr.querySelectorAll("[data-oc]").forEach(x => { row[x.dataset.oc] = +x.value || 0; }); oc[tr.dataset.t] = row; }); R.oncall_requirement = oc; }
  }
  function readSettings() {
    const R = state.rules; const oldNames = R.doctors.map(d => d.name);
    const prevDocs = Object.fromEntries(R.doctors.map(d => [d.name, d])), cols = T.rules.columns(R), acc = {};
    for (const c of cols) if (c.begin) acc[c.key] = c.begin(R);
    const docs = [];
    document.querySelectorAll("#doctorTable tr[data-i]").forEach(tr => {
      const g = f => tr.querySelector(`[data-f="${f}"]`); let name = g("name").value.trim(); if (!name) return;
      const old = oldNames[+tr.dataset.i], prev = prevDocs[old] || {}; // 規則が「なし」で欄を出していない項目は、元の値をそのまま残す
      if (old && old !== name && !renameDoctor(old, name)) name = old; // 改名の成否を先に確定してから欄を読む（本体とプラグインの追随をまとめて行い、失敗したら旧名のまま。知らせは renameDoctor）
      const d = Object.assign({}, prev, { name, team: g("team").value, years: +g("years").value || 0, quota: g("quota") ? (+g("quota").value || 0) : (+prev.quota || 0) }); // 前の値を土台に、画面で扱った項目だけ書き換える（いま登録の無いプラグインの属性も未知の値として残す）
      if (g("share")) d.share = Math.max(0, +g("share").value || 0); // 比重（相対のときの欄。隠れていても値は残す）
      // プラグインの欄。出ている欄はその値を読む（空にした欄は消す）。出ていない欄の値はそのまま
      for (const c of T.rules.columnsAll(R)) { const td = tr.querySelector(`[data-col="${c.key}"]`); if (!td) continue; if (c.field) delete d[c.field]; c.read(td, d, R, acc[c.key], name); }
      if (g("duty").value) d.duty = g("duty").value; else delete d.duty;
      docs.push(d);
    });
    R.doctors = docs; A.refreshNameOrder(R);
    for (const c of cols) if (c.end) c.end(R, acc[c.key]);
    R.weights = R.weights || {}; document.querySelectorAll("#weightsTable [data-w]").forEach(el => { if (el.value !== "") R.weights[el.dataset.w] = +el.value; });
    readHardRules(R);
    A.ensureMonth(state.month); A.save();
  }
  // 役割の識別子を変える: 名簿・オンコール構成の表・固定「OCなし」の記録をまとめて置き換える
  function renameRole(oldId, newId) {
    const R = state.rules, m = state.month;
    for (const d of R.doctors) if (d.team === oldId) d.team = newId;
    const oc = R.oncall_requirement || {}, out = {};
    for (const [row, v] of Object.entries(oc)) { const r2 = {}; for (const [col, x] of Object.entries(v || {})) r2[col === oldId ? newId : col] = x; out[row === oldId ? newId : row] = r2; }
    R.oncall_requirement = out;
    for (const k of ["day_oc_none", "night_oc_none"]) { const tbl = (m.fixed || {})[k]; if (!tbl) continue; for (const d of Object.keys(tbl)) tbl[d] = [].concat(tbl[d] || []).map(x => x === oldId ? newId : x); }
  }
  // 改名は月データ・設定の複製に対して行い（本体の追随とプラグインの追随の両方）、全部成功したときだけ採用する。プラグインの追随（columns の rename / 規則の rename）が失敗したら何も変えずに false を返す
  const replaceInto = (target, src) => { for (const k of Object.keys(target)) delete target[k]; Object.assign(target, src); };
  function renameDoctor(oldN, newN) {
    const R2 = JSON.parse(JSON.stringify(state.rules)), m2 = JSON.parse(JSON.stringify(state.month));
    try { for (const c of T.rules.columnsAll(R2)) if (c.rename) c.rename(R2, oldN, newN); for (const d of T.RULE_DEFS || []) if (typeof d.rename === "function") d.rename(R2, m2, oldN, newN); }
    catch (e) { A.toast(T.t("{who} の改名を取り消しました: プラグインの人ごとのデータの追随に失敗しました（{err}）。プラグインの作成者に知らせてください", { who: oldN, err: e && e.message || e })); return false; }
    const m = m2; const mv = o => { if (o && o[oldN] !== undefined) { o[newN] = o[oldN]; delete o[oldN]; } };
    const ren1 = w => Array.isArray(w) ? w.map(x => x === oldN ? newN : x) : (w === oldN ? newN : w); // 勤務者は 1 名（文字列）か複数名（配列）
    mv(m.duty_days); mv(m.regular_duties); mv(m.unavailable_night); mv(m.targets); mv(m.wishes?.night_on); mv(m.wishes?.day_on); mv(m.history?.weekend_charge); mv(m.history?.holiday_charge); mv(m.history?.work_balance);
    for (const byName of Object.values(m.person_days || {})) mv(byName); // プラグインが足した日ごとの欄
    if (m.fixed_tags) for (const key of Object.keys(m.fixed_tags)) { const [sl, who] = key.split("|"); if (who === oldN) { m.fixed_tags[`${sl}|${newN}`] = m.fixed_tags[key]; delete m.fixed_tags[key]; } } // 固定の印
    (m.unavailable_other || []).forEach(u => { if (u.name === oldN) u.name = newN; }); (m.confirmed_pm_external_night || []).forEach(u => { if (u.name === oldN) u.name = newN; });
    if (m.wishes) m.wishes.weekend_dayshift = (m.wishes.weekend_dayshift || []).map(x => x === oldN ? newN : x);
    for (const k of ["night", "day"]) for (const d of Object.keys(m.fixed?.[k] || {})) m.fixed[k][d] = ren1(m.fixed[k][d]); // 1 名でも複数名でも
    for (const d of Object.keys(m.fixed?.weekend_charge || {})) if (m.fixed.weekend_charge[d] === oldN) m.fixed.weekend_charge[d] = newN;
    for (const k of ["day_oc", "night_oc"]) for (const d of Object.keys(m.fixed?.[k] || {})) m.fixed[k][d] = [].concat(m.fixed[k][d] || []).map(x => x === oldN ? newN : x);
    (m.avoid || []).forEach(u => { if (u.name === oldN) u.name = newN; });
    const pm = m.prev_month || {}; for (const e of pm.last_days || []) { for (const k of ["day", "night"]) if (e[k] !== undefined) e[k] = ren1(e[k]); for (const k of ["day_oc", "night_oc"]) if (e[k]) e[k] = e[k].map(x => x === oldN ? newN : x); }
    for (const k of ["last_weekend_charge", "prev_weekend_charge"]) if (pm[k] === oldN) pm[k] = newN;
    const renAsg = a => { for (const v of Object.values(a || {})) { if (v && v.work !== undefined) v.work = ren1(v.work); if (v && v.oc) v.oc = v.oc.map(x => x === oldN ? newN : x); } };
    if (state.result) { renAsg(state.result.asg); renAsg(state.result.base_asg); if (state.result.avoid_ref && state.result.avoid_ref[oldN] !== undefined) { state.result.avoid_ref[newN] = state.result.avoid_ref[oldN]; delete state.result.avoid_ref[oldN]; } }
    if (state.base) { const mvb = o => { if (o && o[oldN] !== undefined) { o[newN] = o[oldN]; delete o[oldN]; } }; mvb(state.base.duty_days); mvb(state.base.regular_duties); mvb(state.base.unavailable_night); mvb(state.base.targets); }
    replaceInto(state.month, m2); replaceInto(state.rules, R2); return true; // 採用（参照は保つ。呼ぶ側が R.doctors を読み直しの結果で置き換える）
  }
  // ---------- 施設プロファイルの書き出し・読み込み ----------
  // 書き出し: 規則そのもの（施設の構成・規則の状態・重み・値）。月データは含めない。
  // withRoster でなければ共有用: 名簿は役割と目安（回数・比重）だけを残して氏名を「役割名＋番号」に置き換え、経験年数・資格・個人別の条件・プラグインが足した欄は落とす。
  // 名簿の外にある氏名は、氏名をキーにした項目（個人別の条件）を落とし、氏名そのものの値（表示順など）は仮の名前に置き換える。
  // それでも残る氏名（プロファイルの名前や規則の文に書いた氏名は文の一部なので置き換えない）は leftover で返し、呼ぶ側が書き出す前に知らせる
  const EXPORT_DOCTOR_KEYS = ["team", "quota", "share"]; // 共有用の名簿に残す欄（役割と目安）
  function profileForExport(withRoster) {
    let R = JSON.parse(JSON.stringify(state.rules));
    delete R.toban_profile;
    const leftover = [];
    if (!withRoster) {
      const roles = T.normalizeRolesOf(R), cnt = {}, map = new Map(), origNames = (R.doctors || []).map(d => d.name).filter(n => typeof n === "string" && n);
      const doctors = (R.doctors || []).map(d => { const r = roles.find(x => x.id === d.team); const base = r ? r.label : (d.team || "S"); cnt[base] = (cnt[base] || 0) + 1; const nn = `${base}${cnt[base]}`; if (d.name) map.set(d.name, nn);
        const o = { name: nn }; for (const k of EXPORT_DOCTOR_KEYS) if (d[k] !== undefined) o[k] = d[k]; return o; });
      // 氏名をキーにした項目と、name が氏名の要素（配列の中の個人の記録）は落とす。氏名そのものの値は仮の名前へ
      const isRecord = x => x && typeof x === "object" && !Array.isArray(x) && map.has(x.name);
      const walk = v => Array.isArray(v) ? v.filter(x => !isRecord(x)).map(walk) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).filter(([k]) => !map.has(k)).map(([k, x]) => [k, walk(x)])) : typeof v === "string" && map.has(v) ? map.get(v) : v;
      delete R.doctors; R = walk(R); R.doctors = doctors;
      R.name_order = (R.name_order || []).filter(n => doctors.some(d => d.name === n));
      const failed = []; for (const d of T.RULE_DEFS || []) if (typeof d.share === "function") { try { d.share(R); } catch (e) { failed.push(d.id); } } // プラグインが名簿の外に持つ個人の記録を、プラグイン自身が除く（docs/rule-modules.md §4）
      if (failed.length) throw new Error(T.t("プラグインの規則 {ids} の共有用の変換に失敗したため、書き出しを中止しました（除けなかった個人の記録を含めないため）", { ids: failed.join(T.listSep()) })); // 失敗の詳細は個人の記録を含みうるので出さない
      // 文の一部として残った氏名（キーと文字列の値を部分一致で探す。1 文字の氏名も、引用符を含む氏名も見る。置き換えはしない）
      const seen = new Set(), hit = str => { for (const n of origNames) if (!seen.has(n) && str.includes(n)) { seen.add(n); leftover.push(n); } };
      const scan = v => { if (Array.isArray(v)) v.forEach(scan); else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) { hit(k); scan(x); } else if (typeof v === "string") hit(v); };
      scan(R);
    }
    R.toban_profile = { version: 1, roster: withRoster ? "included" : "placeholder" };
    return { rules: R, leftover };
  }
  async function exportProfile() {
    readSettings();
    const withRoster = !!($("#setExportRoster") || {}).checked;
    let ex; try { ex = profileForExport(withRoster); } catch (e) { return alert(e && e.message || e); } // share の失敗など: 書き出さない
    const R = ex.rules, id = ((R.profile || {}).id || "custom").replace(/[^\w.-]+/g, "-");
    if (ex.leftover.length && !confirm(T.t("書き出す内容に名簿の氏名が残っています（{n} 名: {who}）。プロファイルの名前や規則の文に氏名を入れていないか確かめてください。このまま書き出しますか", { n: ex.leftover.length, who: ex.leftover.join(T.nameSep()) }))) return;
    const name = `profile_${id}${withRoster ? "_with_roster" : ""}.json`, blob = new Blob([JSON.stringify(R, null, 1)], { type: "application/json" });
    if (A.dirHandle) { await A.writeFile(A.dirHandle, name, blob); A.toast(T.t("フォルダに {name} を保存しました", { name })); } else A.download(name, blob);
  }
  const importProfile = file => A.transition("data", () => importProfileCore(file));
  async function importProfileCore(file) {
    let R; try { R = JSON.parse(await file.text()); } catch (e) { return alert(tx("プロファイルのファイルを読めませんでした（JSON の形式ではありません）")); }
    if (!R || typeof R !== "object" || (!R.profile && !Array.isArray(R.doctors))) return alert(tx("施設プロファイルのファイルではありません（profile も doctors もありません）"));
    const label = T.pickLabel((R.profile || {}).label, (R.profile || {}).id || file.name);
    if (!confirm(T.t("施設プロファイル「{name}」を読み込みます。施設の構成・規則・規則の状態が置き換わります（「元に戻す」で取り消せます）。", { name: label }))) return;
    pushUndo("施設プロファイルの読み込み");
    if (!Array.isArray(R.doctors) || !R.doctors.length) { R.doctors = state.rules.doctors; R.name_order = state.rules.name_order; } // 名簿の無いファイルはいまの名簿を残す
    delete R.toban_profile;
    state.rules = R; T.fillDefaultRules(state.rules);
    A.ensureMonth(state.month); A.save(); A.renderAll();
    A.toast(T.t("施設プロファイル「{name}」を読み込みました。名簿と規則を確かめてください", { name: label }));
  }

  // ---------- 元に戻す ----------
  // 設定タブでの変更（表の編集・追加・削除・プロファイルの読み込み・JSON の反映・重みの初期化）の直前の状態を積み、1 つずつ取り消す。
  // 積むのはこの画面を開いている間だけ（再読み込みで消える）。月データも一緒に戻す（名簿の変更は月データの氏名にも及ぶため）
  const undoStack = [], UNDO_MAX = 30;
  function pushUndo(label) {
    const snap = JSON.stringify({ rules: state.rules, month: state.month });
    if (undoStack.length && undoStack[undoStack.length - 1].snap === snap) return;
    undoStack.push({ snap, label }); if (undoStack.length > UNDO_MAX) undoStack.shift();
    renderUndo();
  }
  function renderUndo() {
    const b = $("#btnUndo"); if (!b) return;
    const last = undoStack[undoStack.length - 1];
    b.disabled = !last;
    $("#undoNote").textContent = last ? T.t("直前の変更: {what}（あと {n} 回戻せます）", { what: tx(last.label), n: undoStack.length }) : tx("取り消せる変更はありません");
  }
  function undo() {
    const last = undoStack.pop(); if (!last) return;
    const o = JSON.parse(last.snap); state.rules = o.rules; state.month = o.month;
    A.ensureMonth(state.month); A.save(); A.renderAll();
    A.toast(T.t("元に戻しました（{what}）", { what: tx(last.label) }));
  }
  // 設定タブの表示モード: 日々の設定 / 施設の構成を作る。見る側の都合なので、この端末のブラウザにだけ覚える
  const MODE_KEY = "toban_setmode";
  function setMode(mode) {
    document.querySelectorAll("#settings [data-setmode]").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.setmode === mode)));
    document.querySelectorAll("#settings [data-modepane]").forEach(el => { el.hidden = el.dataset.modepane !== mode; });
    try { localStorage.setItem(MODE_KEY, mode); } catch (e) { }
  }
  function bindSettings() {
    { let m = "daily"; try { m = localStorage.getItem(MODE_KEY) || "daily"; } catch (e) { } setMode(m === "build" ? "build" : "daily"); }
    $("#settings").addEventListener("click", ev => { const b = ev.target.closest("[data-setmode]"); if (b) setMode(b.dataset.setmode); });
    $("#btnUndo").addEventListener("click", undo);
    $("#btnReloadPlugins").addEventListener("click", () => A.transition("plugins", async () => { if (!A.dirHandle) return A.toast(T.t("保存フォルダに接続していません")); const n = await A.loadFolderPlugins(); if (!n) A.toast(T.t("保存フォルダに plugins/ のプラグインはありません")); renderSettings(); }));
    $("#settings").addEventListener("click", ev => {
      const b = ev.target.closest("button"); if (!b || !b.dataset.act) return;
      const act = b.dataset.act, mod = (T.RULE_DEFS || []).find(d => d.ui && d.ui.acts && d.ui.acts[act]); // プラグインの設定欄のボタン（表の行の追加・削除など）
      pushUndo(mod ? mod.ui.acts[act] : { add: "名簿に追加", del: "名簿から削除", up: "名簿の並べ替え", down: "名簿の並べ替え", roleAdd: "役割を追加", roleDel: "役割を削除" }[act] || "設定の変更");
      readSettings(); const R = state.rules, tr = b.closest("tr"), i = tr ? +tr.dataset.i : -1;
      if (mod) { mod.ui.act(R, act, b); A.save(); renderSettings(); return; }
      if (b.dataset.act === "roleAdd" || b.dataset.act === "roleDel") { // 役割の追加・削除
        const roles = T.normalizeRolesOf(R).map(x => ({ id: x.id, label: x.labelRaw ?? x.label, refs: [...x.refs], standby: x.standby }));
        if (b.dataset.act === "roleAdd") { let i = roles.length + 1, id = `R${i}`; while (roles.some(r => r.id === id)) id = `R${++i}`; roles.push({ id, label: id, refs: [], standby: false }); }
        else { const i = +b.closest("tr").dataset.ri; const gone = roles[i]; if (!gone) return;
          const used = R.doctors.filter(d => d.team === gone.id).map(d => d.name);
          if (used.length && !confirm(T.t("役割「{role}」は {n} 名（{who}）が使っています。削除すると名簿の役割が空欄になります。よろしいですか", { role: gone.label, n: used.length, who: used.slice(0, 3).join(T.nameSep()) + (used.length > 3 ? T.t(" ほか") : "") }))) return;
          roles.splice(i, 1); }
        (R.profile ||= {}).roles = roles;
        T.fillDefaultRules(R); A.ensureMonth(state.month); A.save(); renderSettings(); A.renderSettingsMonth(); A.renderDoctor(); return;
      }
      if (b.dataset.act === "add") R.doctors.push({ name: T.t("新規"), team: (T.normalizeRolesOf(R).find(x => x.refs.includes("junior")) || T.normalizeRolesOf(R)[0] || {}).id || "Y", years: 0, quota: 5, cath: null });
      else if (b.dataset.act === "del") { const nm = R.doctors[i].name, refs = T.monthNameRefs(state.month)[nm];
        if (!confirm(refs ? T.t("{who} を名簿から外します。この月の {who} の入力（{kinds}）も消します", { who: nm, kinds: refs.join(T.listSep()) }) : T.t("{who} を名簿から外します", { who: nm }))) return;
        R.doctors.splice(i, 1); if (refs) T.purgeMonthNames(state.month, [nm]); }
      else if (b.dataset.act === "up" && i > 0) { [R.doctors[i - 1], R.doctors[i]] = [R.doctors[i], R.doctors[i - 1]]; }
      else if (b.dataset.act === "down" && i < R.doctors.length - 1) { [R.doctors[i + 1], R.doctors[i]] = [R.doctors[i], R.doctors[i + 1]]; }
      A.refreshNameOrder(R);
      A.ensureMonth(state.month); A.save(); renderSettings(); A.renderSettingsMonth(); A.renderDoctor(); A.renderFixed(); // 名簿が変わったので他の画面も描き直す
    });
    $("#settings").addEventListener("click", ev => { if (ev.target.id === "btnExportProfile") exportProfile(); });
    $("#settings").addEventListener("change", ev => {
      if (ev.target.id === "fileLoadProfile") { const f = ev.target.files && ev.target.files[0]; ev.target.value = ""; if (f) importProfile(f); return; }
      if (ev.target.id === "setProfile" || ev.target.id === "setExportRoster") return; // 読み込む・書き出すボタンを押すまで設定は変えない
      if (ev.target.closest("#doctorTable, #weightsTable, #hardRules, #profileBuilder")) { pushUndo(ev.target.closest("#profileBuilder") ? "施設の構成の変更" : ev.target.closest("#doctorTable") ? "名簿の変更" : "規則・重みの変更"); readSettings(); renderSettings(); A.renderSettingsMonth(); A.renderDoctor(); } });
    $("#btnApplyRules").addEventListener("click", () => A.transition("data", () => { try { const R = JSON.parse($("#rulesJson").value); if (!R || !Array.isArray(R.doctors)) throw new Error(T.t("doctors（{person}一覧）がありません")); pushUndo("JSON の反映"); state.rules = R; A.ensureMonth(state.month); A.save(); renderSettings(); A.renderSettingsMonth(); A.renderDoctor(); A.toast(T.t("JSONを反映しました")); } catch (e) { alert(T.t("JSONの形式が不正です: {err}", { err: e })); } }));
    // 既定に戻すのは重みだけ（医師の表・版の表記・その他の設定はそのまま）
    $("#settings").addEventListener("click", ev => { if (ev.target.id === "btnLoadProfile") loadProfileById($("#setProfile").value); });    $("#btnResetRules").addEventListener("click", () => { if (confirm(T.t("調整目標の重みを既定（配布時の値）に戻します。{person}の表や他の設定は変わりません"))) { pushUndo("重みを既定に戻す"); state.rules.weights = JSON.parse(JSON.stringify(T.DEFAULT_RULES.weights || {})); A.save(); renderSettings(); A.toast(T.t("重みを既定に戻しました")); } });
  }

  // 同梱の施設プロファイルを読み込む（設定タブの第 1 段と、月の設定の「設定をこの月の施設に戻す」から）
  const loadProfileById = id => A.transition("data", () => loadProfileCore(id)); // 設定を丸ごと読む入口も共通の窓口を通す（計算中は断る・保存を待つ）
  function loadProfileCore(id) {
    const cur = (state.rules.profile || {}).id || "cardiology";
    if (id === cur) return A.toast(T.t("いま使用中のプロファイルです"));
    const src = profiles().find(x => (x.profile || {}).id === id);
    if (!src) return A.toast(T.t("同梱されていないプロファイルです: {id}", { id }));
    const name = T.pickLabel((src.profile || {}).label, id);
    if (!confirm(T.t("施設プロファイルを「{name}」に切り替えます。名簿・規則・規則の状態が置き換わります。\n開いている月データは別の施設のものとして残るので、この施設の月を新しく作るか、月の設定で「この月をいまの施設の月にする」を押してください", { name }))) return;
    pushUndo("施設プロファイルの読み込み");
    state.rules = JSON.parse(JSON.stringify(src)); T.fillDefaultRules(state.rules);
    A.ensureMonth(state.month); A.save(); A.renderAll();
    A.toast(T.t("施設プロファイルを「{name}」にしました。名簿と規則を確認し、この施設の月を新しく作ってください", { name }));
  }
  Object.assign(A, { renderSettings, bindSettings, loadProfileById, profileForExport, renameDoctor, readSettings }); // 他のファイルから使う関数
})(globalThis.T = globalThis.T || {}, globalThis.T.app = globalThis.T.app || {});

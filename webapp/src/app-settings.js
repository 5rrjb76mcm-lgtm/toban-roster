// 当直表アプリ（画面）: 設定タブ（名簿・重み・その他の規則・JSON 直接編集）。改名時の月データの追随
// app-*.js は T.app（以下 A）を介して互いを参照する。他のファイルの関数・共有変数（A.state, A.dirHandle など）は必ず A. を付ける（build.py --check が検査）。
(function (T, A) {
  const $ = s => document.querySelector(s);
  const esc = T.esc;
  const tx = (s2, a) => T.t(s2, a); // 日本語の文字列を鍵にして表示言語に訳す（訳が無ければ日本語のまま）。差し込む値があれば第 2 引数（{shift} など）
  const state = A.state;
  const ruleTextSelector = "#setRunExempt, #compTbl [data-clabel], #compTbl [data-cqual], #compTbl [data-cnot]";
  const snapshotRuleText = committed => document.querySelectorAll(ruleTextSelector).forEach(input => {
    input.dataset.textShown = input.value; delete input.dataset.textEdited;
    if (committed) input.dataset.textCommitted = "1";
  });

  // 調整目標の重みの表示名（設定タブ）。キーは rules.yaml の weights と一致させる
  const WEIGHT_LABELS = {
    target_deviation: "当月目標からの乖離（1回あたり）",
    wish_night: "当直希望の未反映",
    chief_duty: "{reserve}を勤務に登用する（1回あたり。月1回まで。例外的な登用のときだけ）",
    fixed_conflict: "固定入力だけで避けられない連続禁止などの違反（1件あたり）",
    missing_young_oc: "{other}の勤務で{junior}OCを置けない（不足 1 名あたり）",
    avoid_day: "できれば避けたい日への配置（1枠あたり）",
    avoid_no_reduction: "避けたい日を申告した人の勤務回数が参照解（避けたい日を無視した計算）を下回る分（1回あたり。実質禁止）",
    dayoff_work_excess: "土日の実勤務が本人の上限（名簿の欄）を超えた分（1日あたり）",
    dayoff_work_no_reduction: "土日の実勤務の上限を指定した人の勤務回数が参照解（その指定を無視した計算）を下回る分（1回あたり。実質禁止）",
    wish_weekend_dayshift: "土日日勤の希望の未反映",
    same_weekday_excess: "同じ曜日の勤務が上限を超えた分",
    dayoff_weekday_excess: "休日の同じ曜日に当番（勤務・OC）へ入る日数が上限を超えた分（1日あたり）",
    same_day_double: "同じ日に2つの枠（規則を「減点」にしたとき。1組あたり）",
    consecutive_days: "連日の実勤務（規則を「減点」にしたとき。1組あたり）",
    rest_day_missing: "外勤があるのに週休日が無い（規則を「減点」にしたとき。1名あたり）",
    days_off_short: "月の休みが最低日数に足りない分（規則を「減点」にしたとき。1日あたり）",
    days_off_pair_short: "2 連休の回数が足りない分（規則を「減点」にしたとき。1回あたり）",
    weekend_balance_excess: "週末担当の許容差を超えた分（規則を「減点」にしたとき。1日あたり）",
    friday_night_missing: "金曜夜勤の最低回数に足りない分（規則を「減点」にしたとき。1回あたり）",
    consecutive_weekend: "{charge}の連続する週末担当",
    charge_handover: "休日の{charge}担当が日の途中で交代（日勤帯と夜間で別の人。1日あたり）",
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
  function renderSettingsRoster() {
    const R = state.rules;
    // 名簿の欄は、その欄を使う規則を「なし」にすると隠す（施設ごとに要る欄だけを並べる）。
    // 本体の欄は 氏名・役割・年数・目安・当番。それ以外の欄は規則のプラグインが宣言する（def.columns。docs/rule-modules.md §5.4）
    const on = id => T.ruleState(R, id) !== "off";
    const compOn = on("composition"), quotaOn = on("quota_range") || on("quota_target"); // 目安の欄は回数の規則を使うときだけ
    const share = (R.profile || {}).quota_mode === "share"; // 相対のときは目安の代わりに比重を書く
    const h = { esc, tx, sel: A.sel, term: s => T.term(s, R) };
    const cols = T.rules.columns(R); // プラグインの欄（見出しと、どの本体の欄の後に置くか）
    const at = k => cols.filter(c => (c.at || "duty") === k);
    const head = [["氏名", "役割", compOn ? "何年目" : "経験年数"].map(tx), at("years").map(c => tx(c.label)), quotaOn ? [tx(share ? "比重" : "目安（月）")] : [], at("quota").map(c => tx(c.label)), [tx("当番")], at("duty").map(c => tx(c.label)), [""]].flat();
    const cell = (c, d) => `<td data-col="${esc(c.key)}">${c.render(d, R, h)}</td>`;
    const roles = T.normalizeRolesOf(R).map(x => [x.id, x.label]);
    // 未指定・読み込んだ不明な役割も選択肢として残す。該当する option が無いと先頭の役割が選ばれ、無関係な編集の読み戻しで別の役割へ移ってしまう。
    const roleOpts = d => [["", "―"], ...roles, ...(d.team && !roles.some(([id]) => id === d.team) ? [[d.team, d.team + tx("（現在は使わない値）")]] : [])];
    const rows = R.doctors.map((d, i) => `<tr data-i="${i}"><td><input data-f="name" value="${esc(d.name)}" style="width:5em"></td><td>${A.sel(roleOpts(d), d.team, 'data-f="team"')}</td><td><input type="number" data-f="years" value="${esc(T.numberInputText(d.years ?? ""))}" style="width:3.5em"></td>` +
      at("years").map(c => cell(c, d)).join("") +
      (quotaOn ? (share ? `<td><input type="number" min="0" step="0.1" data-f="share" value="${esc(T.numberInputText(d.share ?? 1))}" style="width:3.5em" title="${esc(tx("比重。1 が標準、0.5 なら半分、0 なら目安 0 回（当番に入れないなら、当番の欄を「配置禁止」にする）"))}"></td>` : `<td><input type="number" min="0" step="any" data-f="quota" value="${esc(d.quota ?? 0)}" style="width:3.5em"></td>`) : "") +
      at("quota").map(c => cell(c, d)).join("") +
      `<td>${A.sel([["", tx("配置する")], ["fixed_only", tx("固定したときだけ")], ["no_unless_needed", tx("原則配置しない")], ["never", tx("配置禁止")]], d.duty || "", 'data-f="duty"')}</td>` +
      at("duty").map(c => cell(c, d)).join("") +
      `<td><button data-act="up">↑</button><button data-act="down">↓</button><button data-act="del">削除</button></td></tr>`).join("");
    $("#doctorTable").innerHTML = `<table class="grid"><tr>${head.map(c => `<th>${esc(c)}</th>`).join("")}</tr>${rows}</table><p><button data-act="add">${esc(tx("{person}を追加"))}</button>　<span class="note">${esc(tx("表の順序が勤務表の枠外「週休日数」の氏名順になります。氏名を変えると、その月のカレンダー・不可日は新しい氏名に引き継がれます。名簿は月ごとの保存データに同梱されるので、過去の月は当時の名簿で開けます。欄が少ないと感じたら、対応する規則が「なし」になっていないか下の規則の表を確認してください。"))}</span></p>`;
  }
  function renderSettings() {
    const R = state.rules, L = s => T.term(s, R);
    renderSettingsRoster();
    const W = R.weights || {};
    // 規則の表に出る重み（規則そのものの重みと、その中で使う重み）は、ここには重ねて出さない
    const owned = new Set((T.RULE_DEFS || []).flatMap(d => [d.weight].concat(d.sub || [])).filter(Boolean));
    const rest = Object.keys(WEIGHT_LABELS).filter(k => !owned.has(k));
    $("#weightsTable").innerHTML = `<table class="grid"><tr><th>${esc(tx("調整目標"))}</th><th>${esc(tx("重み"))}</th></tr>${rest.map(k => `<tr><td>${esc(L(tx(WEIGHT_LABELS[k])))}<br><small class="note">${esc(k)}</small></td><td><input type="number" data-w="${esc(k)}" value="${esc(W[k] ?? "")}" style="width:5em"></td></tr>`).join("")}</table>
<p class="note">${esc(tx("ここに無い重みは、上の規則の表で規則ごとに並んでいます。"))}</p>`;
    renderBuilder(R); renderHardRules(R); renderUndo(); renderHistoryCleanup();
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
    const input = `<input type="number" data-prm="${esc(p.key)}" value="${esc(T.numberInputText(val))}"${p.min != null ? ` min="${p.min}"` : ""}${p.max != null ? ` max="${p.max}"` : ""} style="width:4em">`;
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
          roles.map(t => `<tr data-t="${esc(t.id)}"><td>${esc(t.label)}</td>${sb.map(x => `<td><input type="number" min="0" data-oc="${esc(x.id)}" value="${esc(T.numberInputText((oc[t.id] || {})[x.id] ?? 0))}" style="width:3.5em"></td>`).join("")}</tr>`).join("") + `</table>
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
  // Match workerCount: explicit count (including null) wins; otherwise work itself is the count.
  const profileWorkCount = work => work != null && work.count !== undefined ? work.count : work;
  const profileCountOf = (c, k) => c == null ? null : typeof c === "number" ? c : typeof c === "object" ? (c[k] !== undefined ? c[k] : (c.weekday !== undefined || c.off_days !== undefined ? c : null)) : null;
  // Text inputs remove line breaks; compare the displayed projection before normalizing edits.
  const profileInputText = value => String(value ?? "").replace(/[\r\n]/g, "").replace(/\0/g, "\uFFFD");
  const profileTagLabel = x => String(typeof x === "string" ? x : x.label || "").replace(/[\r\n]/g, "");
  const profileFlagLabel = x => String(typeof x === "string" ? x : T.pickLabel(x.label, x.id)).replace(/[\r\n]/g, "");
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
    { const pos = ((R.profile || {}).positions || {}).work ?? {};
      const cnt = k => profileCountOf(profileWorkCount(pos), k) ?? 1, cntMin = k => profileCountOf(pos.min, k), cntIdeal = k => profileCountOf(pos.ideal, k);
      // 人数の欄: 数なら入力欄。日の種別ごとの人数（平日と休日で違う）はこの画面では編集できないので、値をそのまま見せて保持する（読み戻しで 1 名に書き換えない）
      const byDayTxt = v => T.t("平日 {w}・休日 {h}", { w: v.weekday ?? "―", h: v.off_days ?? "―" });
      const cntCell = (attr, k, v, extra, off) => v && typeof v === "object" ? `<span data-countkeep="${attr}:${esc(k)}" title="${esc(tx("日の種別ごとの人数です。変えるときは管理者向けの設定（JSON）で編集します"))}">${esc(byDayTxt(v))}</span>` : `<input type="number" ${extra} data-${attr}="${esc(k)}" value="${esc(v ?? "")}"${off ? " disabled" : ""}>`;
      const shifts = T.normalizeShiftsOf(R);
      const ON = { day: [["none", tx("計算しない")], ["off_days", tx("土日祝だけ")], ["weekdays", tx("平日だけ")], ["all", tx("毎日")]],
        night: [["off_days", tx("土日祝だけ")], ["weekdays", tx("平日だけ")], ["all", tx("毎日")]] };
      const PART = { day: tx("日中"), night: tx("夜") };
      { const pf = R.profile || {}, tags = [].concat(pf.fixed_tags || []).map(profileTagLabel).filter(Boolean), flags = [].concat(pf.day_flags || []).map(profileFlagLabel).filter(Boolean);
        h.push(`<div class="builder-step"><h4>2b. ${esc(tx("固定の印と日ごとの区分"))}</h4><p><label>${esc(tx("固定の印の選択肢（・区切り。例: 研修・会議・出張）"))} <input id="setFixedTags" value="${esc(tags.join("・"))}" style="width:22em"></label></p>
<p><label>${esc(tx("日ごとの区分（・区切り。例: 行事）"))} <input id="setDayFlags" value="${esc(flags.join("・"))}" style="width:22em"></label></p>
<p class="note">${esc(tx("固定の印は、職員別カレンダーの固定欄の横に選択肢として出て、勤務表に名前(印)で出ます。日ごとの区分は、月別条件の「日ごとの区分・予定」と職員別カレンダーの日付の見出しでチェックでき、構成の規則の「日」の選択肢（「○○」の日）に使えます。"))}</p></div>`); }
      step(3, "1日の区分と、計算で決める勤務帯", `<table class="grid" id="shiftTbl"><tr><th>${esc(tx("1日の区分"))}</th><th>${esc(tx("勤務帯の名前"))}</th><th>${esc(tx("計算で決める日"))}</th><th>${esc(tx("1枠の人数: 下限"))}</th><th>${esc(tx("理想"))}</th><th>${esc(tx("上限（固定の人数はここだけ）"))}</th></tr>` +
        shifts.map(x => `<tr data-shift="${esc(x.id)}"><td>${esc(PART[x.id] || x.id)}</td>` +
          `<td><input data-slabel value="${esc(x.label)}" style="width:8em"></td>` +
          `<td>${A.sel(ON[x.id] || ON.night, x.on, "data-son")}</td>` +
          `<td>${cntCell("countmin", x.id, cntMin(x.id), `min="0" max="40" placeholder="${esc(tx("固定"))}" style="width:4.5em"`, x.on === "none")}</td>` +
          `<td>${cntCell("countideal", x.id, cntIdeal(x.id), `min="0" max="40" placeholder="―" style="width:4.5em"`, x.on === "none")}</td>` +
          `<td>${cntCell("count", x.id, cnt(x.id), `min="0" max="40" style="width:4em"`, x.on === "none")}</td></tr>`).join("") + `</table>
<p class="note">${esc(tx("人数を決まった数にするなら上限だけを書きます。幅を持たせるなら下限も書き、なるべく近づけたい人数があれば理想に書きます（理想からずれた人数は減点。重みは日々の設定の「1枠の人数を理想値に近づける」）。下限と上限は必ず守ります。"))}</p>
<p class="note">${esc(tx("1 日を日中と夜の 2 つに分け、それぞれに名前を付けて、計算で当番を決める日を選びます。日中を「計算しない」にすると夜だけの当直になります。夜は必ず計算で決めます。日中の予定（午前・午後の外来・外勤など）は計算の対象ではなく、人ごとの予定の入力に使います。3 つ以上の区分（3 交代など）はこの版では使えません。"))}</p>
<p><label>${esc(tx("勤務回数の目安の決め方"))}: ${A.sel([["absolute", tx("絶対値（名簿に月◯回を書く）")], ["share", tx("相対（名簿に比重を書き、その月の枠数を按分する）")]], (R.profile || {}).quota_mode === "share" ? "share" : "absolute", 'id="setQuotaMode"')}</label></p>
<p class="note">${esc(tx("相対にすると、その月に必要な延べ人数（枠ごとの人数。幅があるときは理想値）を名簿の比重で按分した値が目安になります（1 が標準、0.5 なら半分、0 なら目安 0 回。当番に入れないなら、名簿の当番の欄を「配置禁止」にする。端数は累計の過不足が少ない人から）。1 枠に複数名を置く施設や、月ごとに枠数が変わる施設向けです。月の設定の「当月の目標」で人ごとに上書きできます。休みの日数を「ちょうど」にしている施設では勤務日数が休みから決まるので、比重を下げても回数は夜勤（2 日ぶん）が増える形でしか減りません。その場合は比重は全員 1 のままにします。"))}</p>
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
          `<td>${def.weight && onStates.includes("soft") ? `<input type="number" data-rsw="${esc(def.weight)}" value="${esc(R.weights?.[def.weight] ?? def.w0)}" style="width:5em"${st === "soft" ? "" : " disabled"}>` : "―"}</td></tr>`);
        const parts = [];
        const p = def.id === "oncall" ? "" : ruleParams(R, def); if (p) parts.push(p); // オンコールの構成は施設の構成を作るで決める
        const subs = (def.sub || []).filter(k => WEIGHT_LABELS[k]);
        if (subs.length) parts.push(`<div class="note">${esc(tx("この規則の中で使う重み: "))}` +
          subs.map(k => `<label style="margin-right:1em">${esc(T.term(tx(WEIGHT_LABELS[k]), R))} <input type="number" data-rsw="${esc(k)}" value="${esc(R.weights?.[k] ?? "")}" style="width:5em"></label>`).join("") + `</div>`);
        if (parts.length) rows.push(`<tr class="rparam"><td colspan="3">${parts.join("")}</td></tr>`);
        shown++;
      }
      h.push(`<table class="grid rulestbl"><tr><th style="width:52%">${esc(tx(glabel))}</th><th style="width:8em">${esc(tx("扱い"))}</th><th style="width:7em">${esc(tx("「減点」の重み"))}</th></tr>${rows.join("")}</table>`);
    }
    if (!shown) h.push(`<p class="note">${esc(tx("使う規則がありません。「施設の構成を作る」の「使う規則」で選んでください。"))}</p>`);
    $("#hardRules").innerHTML = h.join("");
    snapshotRuleText(false); // Compare the actual DOM projection; never rewrite untouched source text.
  }
  // 役割の表は読み戻しの最初に一括検査する。不正な識別子・役目で、名簿や月の入力を一部だけ書き換えない。
  const rawRoleOf = (R, id) => (Array.isArray(R.profile?.roles) ? R.profile.roles : []).find(raw => String((raw || {}).id || "").trim() === id);
  function stageRoles(R) {
    const rows = [...document.querySelectorAll("#roleTbl tr[data-ri]")], renames = new Map();
    if (!rows.length) return { roles: null, renames };
    const oldRoles = T.normalizeRolesOf(R);
    const roles = rows.map(tr => {
      const g = k => tr.querySelector(`[data-${k}]`), id = g("rid").value.trim(), label = g("rlabel").value, ref = g("rref").value;
      const prev = oldRoles[+tr.dataset.ri];
      // 空欄も検査に渡す。行を読み飛ばして役割を削除してしまわない。
      // 表示名・役目を変えていなければ、多言語の表記と欄に出せない2つ目以降の役目も残す。
      const raw = rawRoleOf(R, prev?.id);
      const r = Object.assign({}, raw, { id, label: prev && label === profileInputText(prev.label) ? (prev.labelRaw ?? prev.label) : label.trim() || id,
        refs: prev && ref === (prev.refs[0] || "") ? [...prev.refs] : ref ? [ref] : [] });
      if (g("rstandby").checked) r.standby = true; else delete r.standby;
      if (prev && prev.id !== id) renames.set(prev.id, id);
      return r;
    });
    T.normalizeRolesOf({ profile: { roles } }); // 本体と同じ識別子・役目の検査を、実際の設定に触れずに行う
    return { roles, renames };
  }
  function readHardRules(R, roleEdit) {
    const el = s => document.querySelector(s); // 「なし」の規則は設定欄を出さないので、無い欄は前の値のまま残す
    for (const def of (T.RULE_DEFS || [])) { // プラグインが宣言した値と、プラグインの設定欄
      // A rendered number is a projection: unrelated edits must not erase or clamp imported values.
      for (const p of def.params || []) { const x = el(`#hardRules [data-prm="${p.key}"]`); if (!x || !T.numberInputChanged(x, R[p.key] ?? "")) continue; R[p.key] = x.value === "" ? null : Math.max(p.min ?? -Infinity, +x.value || 0); }
      if (def.ui && def.ui.read && el("#hardRules")) def.ui.read(R, s => el("#hardRules " + s));
    }
    R.profile ||= {};
    { const lab = document.querySelector("#setProfLabel"), pid = document.querySelector("#setProfId");
      const shown = T.pickLabel((R.profile || {}).label, (R.profile || {}).id);
      if (lab && lab.value.trim() && lab.value !== profileInputText(shown)) R.profile.label = lab.value.trim(); // 名前を変えていなければ元の表記（{ja, en} など）のまま
      if (pid && pid.value.trim() && pid.value !== profileInputText(R.profile.id)) R.profile.id = pid.value.trim().replace(/[^\w.-]+/g, "-"); }
    { const hol = document.querySelector("#setCalHol"), clo = document.querySelector("#setCalClosure"); // 暦（祝日の出どころと施設の休日）
      if (hol) { const closure = {};
        for (const tok of String(clo ? clo.value : "").split(/[,、\s]+/).filter(Boolean)) { const m = tok.match(/^(\d{1,2})\/(\d{1,2})$/); if (m && +m[1] >= 1 && +m[1] <= 12 && +m[2] >= 1 && +m[2] <= 31) (closure[+m[1]] ||= []).push(+m[2]); }
        // The calendar editor owns its two visible fields, not plug-in siblings.
        const old = R.profile.calendar || {}, next = Object.assign({}, old, { holidays: hol.value });
        // Keep the original rows (including plug-in fields) when the display projection was not edited.
        if (old.closure === undefined || clo && (clo.dataset.closureEdited === "1" || clo.value !== clo.getAttribute("value"))) next.closure = Object.keys(closure).map(Number).sort((a, b) => a - b).map(mo => {
          const rows = Array.isArray(old.closure) ? old.closure.filter(row => +row.month === mo) : [];
          // A unique month identifies its existing row. Removed months are not copied back.
          return Object.assign({}, rows.length === 1 ? rows[0] : {}, { month: mo, days: [...new Set(closure[mo])].sort((a, b) => a - b) });
        });
        R.profile.calendar = next; } }
    { const ft = document.querySelector("#setFixedTags"), df = document.querySelector("#setDayFlags"); // 固定の印と日ごとの区分（施設の構成）
      const split = v => [...new Set(String(v || "").split(/[・,、\n]+/).map(x => x.trim()).filter(Boolean))];
      if (ft) { const old = [].concat(R.profile.fixed_tags || []);
        // The input is a display projection, not the stored list. Unchanged tags retain
        // separator/newline labels and their shift restrictions, including duplicate labels.
        if (ft.value !== old.map(profileTagLabel).filter(Boolean).join("・")) {
          const v = split(ft.value); R.profile.fixed_tags = v.map(l => old.find(o => typeof o === "object" && profileTagLabel(o) === l) || l);
          if (!v.length) delete R.profile.fixed_tags;
        } }
      if (df) { const old = [].concat(R.profile.day_flags || []);
        // The list is a display projection: unchanged localized labels must retain IDs, translations,
        // short labels, and even labels containing the list separator or sharing the same text.
        if (df.value !== old.map(profileFlagLabel).filter(Boolean).join("・")) {
          const v = split(df.value); R.profile.day_flags = [...new Set(v.flatMap(l => { const shown = old.filter(o => profileFlagLabel(o) === l), keep = shown.length ? shown : old.filter(o => typeof o === "object" && o.id === l); return keep.length ? keep : [l]; }))];
          if (!v.length) delete R.profile.day_flags;
        } } }
    const roleRen = roleEdit.renames; // 検査済みの旧 → 新。画面の表はまだ旧い識別子なので、読むときに同じ変換を当てる
    { if (roleEdit.roles) { renameRoles(roleRen); R.profile.roles = roleEdit.roles; }
      { const old = T.normalizeShiftsOf(R), shifts = [];
        document.querySelectorAll("#shiftTbl tr[data-shift]").forEach(tr => {
          const id = tr.dataset.shift, o = old.find(x => x.id === id) || {}, lab = tr.querySelector("[data-slabel]").value;
          // 名前を変えていなければ元の表記（{ja, en} など）のまま残す
          const soc = document.querySelector(`#profileBuilder [data-soc="${id}"]`); // オンコールを使わない間は欄が無いので、前の値のまま
          const raw = (R.profile.shifts || []).find(x => x.id === id);
          const sh = Object.assign({}, raw, { id, label: !lab.trim() || lab === profileInputText(o.label) ? (o.labelRaw ?? o.label) : lab.trim(), on: tr.querySelector("[data-son]").value });
          if ((soc ? soc.checked : o.oncall !== false) === false) sh.oncall = false; else if (sh.oncall === false) delete sh.oncall;
          shifts.push(sh);
        });
        if (shifts.length) R.profile.shifts = shifts; }
      // 1 枠の人数: 入力欄に出した数だけを読む。日の種別ごとの人数（欄に出せず、値だけ見せているもの）は前の値をそのまま残す
      const workOld = ((R.profile || {}).positions || {}).work, posOld = workOld ?? {}, isObj = v => !!v && typeof v === "object";
      const kept = {}; document.querySelectorAll("#shiftTbl [data-countkeep]").forEach(x => {
        const [attr, k] = x.dataset.countkeep.split(":"), field = { count: "count", countmin: "min", countideal: "ideal" }[attr];
        let v = profileCountOf(field === "count" ? profileWorkCount(posOld) : posOld[field], k);
        // Direct day-type work may also contain min/ideal or metadata. Only count keys
        // belong inside a new canonical count; other fields remain work siblings.
        if (field === "count" && posOld.count === undefined && v === posOld) v = Object.fromEntries(["weekday", "off_days"].filter(key => posOld[key] !== undefined).map(key => [key, posOld[key]]));
        if (isObj(v)) (kept[field] ||= {})[k] = JSON.parse(JSON.stringify(v));
      });
      const maxOf = v => isObj(v) ? Math.max(v.weekday == null ? 1 : +v.weekday || 0, v.off_days == null ? 1 : +v.off_days || 0) : (v ?? 1);
      const count = Object.assign({}, kept.count); let multi = Object.values(count).some(v => maxOf(v) > 1), staffingEdited = false;
      const noteStaffingEdit = x => { if (x.value !== x.getAttribute?.("value")) staffingEdited = true; };
      document.querySelectorAll("#shiftTbl input[data-count]").forEach(x => { noteStaffingEdit(x); const v = Math.max(0, Math.min(40, x.value === "" ? 1 : +x.value || 0)); count[x.dataset.count] = v; if (v > 1) multi = true; });
      const mins = Object.assign({}, kept.min); document.querySelectorAll("#shiftTbl input[data-countmin]").forEach(x => { noteStaffingEdit(x); if (x.value !== "") mins[x.dataset.countmin] = Math.max(0, Math.min(maxOf(count[x.dataset.countmin]), +x.value || 0)); });
      const ideals = Object.assign({}, kept.ideal); document.querySelectorAll("#shiftTbl input[data-countideal]").forEach(x => { noteStaffingEdit(x); if (x.value !== "") ideals[x.dataset.countideal] = Math.max(0, Math.min(maxOf(count[x.dataset.countideal]), +x.value || 0)); });
      const hadIdeal = posOld.ideal !== undefined && posOld.ideal !== null;
      // An unchanged shorthand is accepted storage, not an implicit request to flatten it.
      // Explicit staffing edits use the existing count/min/ideal form, keeping hidden day-type
      // branches and other metadata. Clearing a bound must remove that owned field.
      if (Object.keys(count).length && !(workOld != null && posOld.count === undefined && !staffingEdited)) {
        const next = Object.assign({}, isObj(posOld) ? posOld : {}, { count }); delete next.min; delete next.ideal;
        if (Object.keys(mins).length) next.min = mins; if (Object.keys(ideals).length) next.ideal = ideals;
        (R.profile.positions ||= {}).work = next;
      }
      { const qm = document.querySelector("#setQuotaMode"); if (qm) { if (qm.value === "share") R.profile.quota_mode = "share"; else delete R.profile.quota_mode; } } // 目安の決め方
      R._idealAdded = !hadIdeal && Object.keys(ideals).length > 0; // 理想値を新しく書いたら、それに近づける規則を使う（規則の状態を読んだ後で入れる）
      R._multiWork = multi; // 複数名かどうか（規則の状態を読んだあとで併用できない規則を外す）
    }
    { const pon = [...document.querySelectorAll("#profileBuilder [data-pon]")]; if (pon.length) {
      // A missing plug-in has no checkbox. Preserve its disabled state until it returns;
      // this form owns only the names represented by the current inventory.
      const old = Array.isArray(R.plugins_off) ? R.plugins_off : [], shown = new Map(pon.map(x => [x.dataset.pon, x]));
      const off = old.filter(name => !shown.has(name) || !shown.get(name).checked);
      for (const x of pon) if (!x.checked && !off.includes(x.dataset.pon)) off.push(x.dataset.pon);
      // Non-array imports retain the prior visible-checkbox readback behavior.
      if (!Array.isArray(R.plugins_off) || off.length !== old.length || off.some((name, i) => name !== old[i])) {
        if (off.length) R.plugins_off = off; else delete R.plugins_off;
      }
    } } // プラグインごとの付け外し（規則の状態より先に読む）
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
    { const rn = k => roleRen.get(k) || k; // 役割の識別子を変えた回は、画面の行・列の旧い識別子を新しい識別子に読み替える（直した表を旧い識別子で上書きしない）
      if (el("#ocReqTbl")) {
        const roles = new Set(T.normalizeRolesOf(R).map(r => r.id));
        // 待機の資格を外した役割は列が隠れるだけ。既存の人数を残し、画面にある欄だけ上書きする。
        // 役割自体を削除した列は残さない。改名は上の renameRoles で既に反映済み。
        R.oncall_requirement = Object.fromEntries([...document.querySelectorAll("#ocReqTbl tr[data-t]")].map(tr => {
          tr.dataset.t = rn(tr.dataset.t);
          const table = R.oncall_requirement || {}, old = Object.prototype.hasOwnProperty.call(table, tr.dataset.t) ? table[tr.dataset.t] : {};
          const cells = [...tr.querySelectorAll("[data-oc]")].flatMap(x => { x.dataset.oc = rn(x.dataset.oc); return T.numberInputChanged(x, (old || {})[x.dataset.oc] ?? 0) ? [[x.dataset.oc, +x.value || 0]] : []; });
          return [tr.dataset.t, Object.fromEntries([...Object.entries(old || {}).filter(([id]) => roles.has(id)), ...cells])];
        }));
      } } // 画面の表の識別子も新しくしておく（描き直す前にもう一度読まれても、旧い識別子で上書きしない）
  }
  // Only retained records in the open month reserve a historical identity. Zero is a record too.
  function hasHistoricalName(name) {
    const m = state.month || {}, pm = m.prev_month || {}, own = (o, k) => Object.prototype.hasOwnProperty.call(o || {}, k);
    if (["weekend_charge", "holiday_charge", "work_balance"].some(k => own((m.history || {})[k], name))) return true;
    const contains = value => Array.isArray(value) ? value.includes(name) : value === name;
    return (pm.last_days || []).some(day => ["day", "night", "day_oc", "night_oc"].some(k => contains(day[k]))) ||
      ["last_weekend_charge", "prev_weekend_charge"].some(k => pm[k] === name);
  }
  // 履歴の整理はこの既知のスキーマだけを扱う。氏名と構造キーが同じでも、再帰的なキー削除はしない。
  const HISTORY_MAP_LABELS = { weekend_charge: "週末担当の累計", holiday_charge: "休日担当の累計", work_balance: "勤務回数の累積過不足" };
  const PREVIOUS_SLOT_LABELS = { day: "日勤", night: "夜勤", day_oc: "日勤OC", night_oc: "夜間OC" };
  const PREVIOUS_CHARGE_LABELS = { last_weekend_charge: "前月最後の週末担当", prev_weekend_charge: "その1つ前の週末担当" };
  const cleanupOwn = (o, k) => Object.prototype.hasOwnProperty.call(o || {}, k);
  const cleanupContains = (v, name) => Array.isArray(v) ? v.includes(name) : v === name;
  function historicalReferences(m, name) {
    const refs = [], pm = m.prev_month || {};
    for (const [key, label] of Object.entries(HISTORY_MAP_LABELS)) if (cleanupOwn(m.history?.[key], name)) refs.push({ path: `history.${key}[${JSON.stringify(name)}]`, label: tx(label), value: m.history[key][name] });
    for (const [i, day] of (pm.last_days || []).entries()) for (const [key, label] of Object.entries(PREVIOUS_SLOT_LABELS)) {
      if (cleanupOwn(day, key) && cleanupContains(day[key], name)) refs.push({ path: `prev_month.last_days[${i}].${key}`, label: tx("前月末 {d}日・{slot}", { d: day.date, slot: tx(label) }), value: day[key] });
    }
    for (const [key, label] of Object.entries(PREVIOUS_CHARGE_LABELS)) if (cleanupOwn(pm, key) && pm[key] === name) refs.push({ path: `prev_month.${key}`, label: tx(label), value: pm[key] });
    return refs;
  }
  function hasCurrentCleanupReference(m, name) {
    // 空・0・不正値でも、氏名キーが残る入力は削除候補にしない。非表示の欄と翌月1日も同じ扱い。
    if (["duty_days", "regular_duties", "unavailable_night", "targets", "count_min", "count_max"].some(k => cleanupOwn(m[k], name))) return true;
    if (["night_on", "day_on"].some(k => cleanupOwn(m.wishes?.[k], name)) || cleanupContains(m.wishes?.weekend_dayshift, name)) return true;
    if (["unavailable_other", "avoid", "confirmed_pm_external_night"].some(k => (m[k] || []).some(x => x?.name === name))) return true;
    if (Object.values(m.person_days || {}).some(byName => cleanupOwn(byName, name))) return true;
    if (Object.keys(m.fixed_tags || {}).some(k => k.split("|").slice(1).join("|") === name)) return true;
    if (["day", "night", "weekend_charge", "day_oc", "night_oc"].some(k => Object.values(m.fixed?.[k] || {}).some(v => cleanupContains(v, name)))) return true;
    // 独自入力の意味を推測して消さない。正確に同じ氏名のキー・値があるときは安全側で候補から外す。
    const mentions = v => v === name || Array.isArray(v) && v.some(mentions) || v && typeof v === "object" && Object.entries(v).some(([k, x]) => k === name || mentions(x));
    return Object.entries(m).some(([k, v]) => /^local[_.]/.test(k) && mentions(v));
  }
  function historyCleanupCandidates() {
    const m = state.month, foundNames = new Set(), roster = new Set(state.rules.doctors.map(d => d.name));
    for (const key of Object.keys(HISTORY_MAP_LABELS)) for (const name of Object.keys(m.history?.[key] || {})) foundNames.add(name);
    const pm = m.prev_month || {};
    for (const day of pm.last_days || []) for (const key of Object.keys(PREVIOUS_SLOT_LABELS)) for (const name of [].concat(day[key] || [])) foundNames.add(name);
    for (const key of Object.keys(PREVIOUS_CHARGE_LABELS)) if (pm[key]) foundNames.add(pm[key]);
    return [...foundNames].filter(name => typeof name === "string" && name && !roster.has(name) && !hasCurrentCleanupReference(m, name)).map(name => ({ name, refs: historicalReferences(m, name) })).filter(x => x.refs.length);
  }
  function monthWithoutHistoricalName(source, name) {
    // 複写するのは編集する枝だけ。JSON の往復で無関係な値や未知の項目を整形し直さない。
    const m = { ...source };
    if (source.history) { m.history = { ...source.history }; for (const key of Object.keys(HISTORY_MAP_LABELS)) if (cleanupOwn(source.history[key], name)) m.history[key] = { ...source.history[key] }; }
    if (source.prev_month) { m.prev_month = { ...source.prev_month }; if (Array.isArray(source.prev_month.last_days)) m.prev_month.last_days = source.prev_month.last_days.map(day => ({ ...day })); }
    for (const key of Object.keys(HISTORY_MAP_LABELS)) if (cleanupOwn(m.history?.[key], name)) delete m.history[key][name];
    const pm = m.prev_month || {};
    for (const day of pm.last_days || []) for (const key of Object.keys(PREVIOUS_SLOT_LABELS)) if (cleanupOwn(day, key) && cleanupContains(day[key], name)) {
      day[key] = Array.isArray(day[key]) ? day[key].filter(n => n !== name) : null;
    }
    for (const key of Object.keys(PREVIOUS_CHARGE_LABELS)) if (cleanupOwn(pm, key) && pm[key] === name) pm[key] = null;
    return m;
  }
  let historyCleanupView = null;
  const historyCleanupSignature = () => JSON.stringify([state.rules, state.month, state.result]);
  function renderHistoryCleanup() {
    const panel = $("#historyCleanup"), body = $("#historyCleanupBody"); if (!panel || !body) return;
    historyCleanupView = null; body.innerHTML = ""; if (!panel.open) return;
    const m = state.month, candidates = historyCleanupCandidates();
    historyCleanupView = { month: m, rules: state.rules, dir: A.dirHandle, dirGen: A.dirGen, signature: historyCleanupSignature(), candidates };
    const refText = ref => `${ref.label} (${ref.path}): ${JSON.stringify(ref.value)}`;
    body.innerHTML = `<p><strong>${esc(tx("対象: {y}年{m}月", { y: m.year, m: m.month }))}</strong></p>
<p>${esc(tx("この画面で開いている月の履歴・前月末の接続だけが対象です。保存済みの過去月ファイルは変更しません。"))}</p>
<p class="note">${esc(tx("名簿全体と当月の入力・固定指定に氏名がない職員だけを表示します。1名ずつ選び、残っている記録を確認してください。"))}</p>
<p class="note">${esc(tx("各欄から選んだ氏名の記録だけを取り除きます。同じ欄にある他の氏名・日付・独自項目は残します。"))}</p>
<p class="warn">${esc(tx("この削除は取り消せません。この操作より前の編集にも『元に戻す』で戻れなくなります。"))}</p>
${candidates.length ? `<ul>${candidates.map((c, i) => `<li><label><input type="radio" name="historyCleanupPerson" value="${i}"> ${esc(c.name)}</label><ul>${c.refs.map(ref => `<li>${esc(refText(ref))}</li>`).join("")}</ul></li>`).join("")}</ul><button id="btnHistoryCleanup" type="button" disabled>${esc(tx("選んだ1名の当月の履歴を削除"))}</button>` : `<p>${esc(tx("整理できる職員はいません。"))}</p>`}
<p class="note">${esc(tx("削除すると月境界の条件・累計の計算に影響します。前月を再取り込みすると記録が復活することがあります。"))}</p>`;
  }
  function historyCleanupIsCurrent(view, name) {
    const pendingName = [...document.querySelectorAll('#doctorTable tr[data-i]')].some(tr => tr.querySelector('[data-f="name"]').value.trim() !== state.rules.doctors[+tr.dataset.i]?.name);
    const selected = $('#historyCleanup input[name="historyCleanupPerson"]:checked');
    return !pendingName && view && view === historyCleanupView && selected && view.candidates[+selected.value]?.name === name && $("#historyCleanup").open && view.month === state.month && view.rules === state.rules && view.dir === A.dirHandle && view.dirGen === A.dirGen && view.signature === historyCleanupSignature() && historyCleanupCandidates().some(c => c.name === name);
  }
  async function cleanSelectedHistory() {
    const view = historyCleanupView, selected = $('#historyCleanup input[name="historyCleanupPerson"]:checked');
    const candidate = selected && view?.candidates[+selected.value]; if (!candidate) return;
    return A.transition("data", () => {
      const stale = () => { if (historyCleanupIsCurrent(view, candidate.name)) return false; A.toast(tx("履歴の整理を中止しました。月・名簿・入力が変わったか、未確定の氏名があります。入力を確定し、この欄を開き直して確認してください。")); return true; };
      if (stale()) return;
      const fields = candidate.refs.map(ref => `${ref.label} (${ref.path}): ${JSON.stringify(ref.value)}`).join("\n");
      if (!confirm(tx("{y}年{m}月の「{name}」について、次の欄から本人の記録だけを削除します。同じ欄の他の氏名・日付・独自項目は残します。\n{fields}\n\nこの削除は取り消せません。この操作より前の編集にも『元に戻す』で戻れなくなります。\n月境界の条件・累計の計算に影響します。前月の再取り込みで復活することがあります。保存済みの過去月ファイルは変更しません。\n削除しますか。", { y: view.month.year, m: view.month.month, name: candidate.name, fields }))) return;
      if (stale()) return;
      let nextMonth;
      try { nextMonth = monthWithoutHistoricalName(state.month, candidate.name); }
      catch (e) { A.toast(tx("履歴の整理に失敗しました。記録と取り消し履歴は変更していません。")); return; }
      if (stale()) return;
      // 既存の Undo は完全な月の写しを持つ。採用した後だけ履歴を破棄し、過去の写しからの復活を防ぐ。
      state.month = nextMonth; clearUndo(); A.save(); renderHistoryCleanup();
      A.toast(tx("{y}年{m}月の「{name}」の履歴を削除しました。必要に応じて再計算してください。", { y: nextMonth.year, m: nextMonth.month, name: candidate.name }));
    });
  }
  const historicalRenameMessage = name => T.t("氏名「{name}」は履歴・前月の記録で使われているため、改名できません。別の氏名にしてください", { name });
  function historicalImportNames(rules) {
    const current = new Set(state.rules.doctors.map(d => d.name));
    return [...new Set(rules.doctors.map(d => d.name).filter(name => !current.has(name) && hasHistoricalName(name)))];
  }
  function resolveRosterName(old, name, taken) {
    if (!taken.has(name)) return name;
    if (old && !taken.has(old)) return old;
    let k = 2; while (taken.has(`${name} ${k}`)) k++;
    return `${name} ${k}`;
  }
  function readSettings(undoLabel) {
    const R = state.rules; let roleEdit;
    // Reject before any readback, plug-in hook, save or Undo entry. Keep unrelated pending inputs.
    const planned = [...document.querySelectorAll("#doctorTable tr[data-i]")].map(tr => ({ tr,
      old: R.doctors[+tr.dataset.i]?.name, name: tr.querySelector('[data-f="name"]').value.trim() || R.doctors[+tr.dataset.i]?.name }));
    const plannedTaken = new Set(planned.filter(r => r.old && r.old === r.name).map(r => r.name));
    const blocked = [];
    for (const r of planned) {
      if (r.old === r.name) continue;
      const resolved = resolveRosterName(r.old, r.name, plannedTaken); plannedTaken.add(resolved);
      if (r.old && (hasHistoricalName(r.name) || resolved !== r.old && hasHistoricalName(resolved))) blocked.push({ ...r, resolved });
    }
    if (blocked.length) {
      A.toast(blocked.map(r => historicalRenameMessage(hasHistoricalName(r.name) ? r.name : r.resolved)).join("\n"));
      for (const r of blocked) r.tr.querySelector('[data-f="name"]').value = r.old;
      return false;
    }
    try { roleEdit = stageRoles(R); }
    catch (e) { A.toast(T.t("役割の変更を取り消しました: {err}", { err: e && e.message || e })); A.renderSettings(); return false; }
    if (undoLabel) pushUndo(undoLabel); // 不正な役割の編集は、既存の取り消し履歴にも触れない
    const oldNames = R.doctors.map(d => d.name), oldDuty = R.doctors.map(d => T.isDutyCandidate(d, false));
    const prevDocs = Object.fromEntries(R.doctors.map(d => [d.name, d])), cols = T.rules.columns(R), acc = {};
    for (const c of cols) if (c.begin) acc[c.key] = c.begin(R);
    // 名簿の読み戻しの順: (1) 行の氏名を確定する（氏名は個人の識別子なので一意にする。変えていない行の氏名を先に押さえ、改名・追加で重なるものは改名を取り消す／連番を付ける）
    // (2) 改名の追随（名簿の欄の rename と規則の rename）を複製で試し、失敗する改名は取り消す (3) 行を読む（土台は現在の職員。名前は確定した新しい名前）
    // (4) 読んだ後の設定・月に改名を適用する（プラグインの追随が、画面に残っていた古い値を読んだ後に効くように。失敗したら読み戻し全体を取り消す）
    const backup = JSON.parse(JSON.stringify({ rules: R, month: state.month, result: state.result, base: state.base, baseRules: state.baseRules, renames: state.renames || [] })); // 改名は結果・統合の基準にも及ぶので、取り消すときは全部戻す
    // 氏名を空にした行は入力不備として元の氏名に戻す（名簿から外す操作ではない: 外すのは「削除」ボタンで、確認・条件の掃除・記録を通す。空欄で読み飛ばすと、確認なしで名簿から消えて個人の条件だけが残る）
    const blank = []; const rows = []; document.querySelectorAll("#doctorTable tr[data-i]").forEach(tr => { const g = f => tr.querySelector(`[data-f="${f}"]`), old = oldNames[+tr.dataset.i]; let raw = g("name").value.trim(); if (!raw) { if (old === undefined) return; blank.push(old); raw = old; g("name").value = old; } rows.push({ tr, g, old, name: raw }); });
    if (blank.length) A.toast(T.t("氏名は空にできません（{who} の氏名を元に戻しました）。名簿から外すには行の「削除」ボタンを使ってください", { who: blank.join(T.nameSep()) }));
    const taken = new Set(rows.filter(r => r.old && r.old === r.name).map(r => r.name));
    // プラグインが欠けている・読めない・変換に失敗している間は改名を確定しない（欠けたプラグインの独自データを追随させられず、復帰後にその人の条件が旧名に残る）。
    // 計算用の欠落判定（「なし」の規則は除く）とは別に、設定が参照する施設のプラグインの規則（id が local. で始まる）は「なし」でも登録が無ければ欠けているとみなす（独自データはその規則が持つ）
    const broken = pluginsIncomplete(R, state.month);
    if (broken && rows.some(r => r.old && r.old !== r.name)) { A.toast(T.t("施設のプラグインが欠けている・読めない間は氏名を変えられません（独自データの追随ができないため）。プラグインを揃えてから変えてください")); for (const r of rows) if (r.old && r.old !== r.name) r.name = r.old; }
    for (const r of rows) { if (r.old === r.name) continue;
      if (taken.has(r.name)) { const resolved = resolveRosterName(r.old, r.name, taken); if (resolved === r.old) A.toast(T.t("氏名「{name}」は別の{person}と重なるため、{who} の改名を取り消しました", { name: r.name, who: r.old })); else A.toast(T.t("氏名「{name}」は別の{person}と重なるため「{name} {k}」にしました", { name: r.name, k: resolved.slice(r.name.length + 1) })); r.name = resolved; }
      taken.add(r.name); }
    for (const r of rows) if (r.old && r.old !== r.name && !renameTrial(r.old, r.name)) { taken.delete(r.name); r.name = r.old; } // 追随に失敗する改名は取り消す（知らせは renameTrial）
    const cur = Object.fromEntries(R.doctors.map(d => [d.name, d])); const docs = [];
    for (const { tr, g, old, name } of rows) {
      const prev = cur[old] || {}; // 規則が「なし」で欄を出していない項目は、元の値をそのまま残す
      const q = g("quota"), quota = q ? T.numberInputValue(q.value, prev.quota, { initial: q.getAttribute?.("value"), edited: q.dataset?.numericEdited === "1", empty: 0 }) : (prev.quota ?? 0);
      const d = Object.assign({}, prev, { name, team: g("team").value, quota }); // 前の値を土台に、画面で扱った項目だけ書き換える（いま登録の無いプラグインの属性も未登録のまま残す）
      if (T.numberInputChanged(g("years"), prev.years ?? "")) d.years = +g("years").value || 0;
      if (g("share") && T.numberInputChanged(g("share"), prev.share ?? 1)) d.share = Math.max(0, +g("share").value || 0); // 比重（相対のときの欄。隠れていても値は残す）
      // プラグインの欄。出ている欄はその値を読む（空にした欄は消す）。出ていない欄の値はそのまま。氏名は確定した名前で読む（改名の適用はこの後）
      for (const c of T.rules.columnsAll(R)) { const td = tr.querySelector(`[data-col="${c.key}"]`); if (!td) continue; if (c.field) delete d[c.field]; c.read(td, d, R, acc[c.key], name, prev); }
      if (g("duty").value) d.duty = g("duty").value; else delete d.duty;
      docs.push(d);
    }
    // Imported display order is independent of unrelated fields such as years or weights.
    // Rebuild only for a changed roster identity or duty membership; roster buttons still
    // rebuild explicitly after add/delete/move, preserving their existing behavior.
    const orderChanged = docs.length !== oldNames.length || docs.some((d, i) => d.name !== oldNames[i] || T.isDutyCandidate(d, false) !== oldDuty[i]);
    R.doctors = docs; if (orderChanged) A.refreshNameOrder(R);
    for (const c of cols) if (c.end) c.end(R, acc[c.key]);
    for (const r of rows) if (r.old && r.old !== r.name && !renameDoctor(r.old, r.name, { readBack: true })) { // 読んだ後に改名を適用（月・結果・独自データの追随）。ここで失敗したら読み戻し全体を取り消す
      replaceInto(state.rules, backup.rules); replaceInto(state.month, backup.month); state.result = backup.result; state.base = backup.base; state.baseRules = backup.baseRules; state.renames = backup.renames; // 1 件目の改名が済んでいても、結果・統合の基準ごと元に戻す
      A.toast(T.t("名簿の読み戻しを取り消しました（{who} の改名の追随に失敗）", { who: r.old })); A.renderSettings(); return false; }
    R.weights = R.weights || {}; document.querySelectorAll("#weightsTable [data-w]").forEach(el => { if (el.value !== "") R.weights[el.dataset.w] = +el.value; });
    readHardRules(R, roleEdit);
    A.ensureMonth(state.month); A.save();
    snapshotRuleText(true);
    const closureInput = $("#setCalClosure");
    if (closureInput) { closureInput.setAttribute("value", closureInput.value); delete closureInput.dataset.closureEdited; }
  }
  // 役割の識別子を変える: 名簿・オンコール構成の表・固定「OCなし」の記録をまとめて置き換える
  function renameRoles(renames) {
    if (!renames.size) return;
    noteUndoRoleRenames(renames);
    const R = state.rules, m = state.month, rn = id => renames.get(id) || id;
    for (const d of R.doctors) d.team = rn(d.team);
    // 複数行の入れ替え・連続した改名も、元の識別子に一度だけ適用する（途中で別の役割と混ざらない）。
    R.oncall_requirement = Object.fromEntries(Object.entries(R.oncall_requirement || {}).map(([row, v]) =>
      [rn(row), Object.fromEntries(Object.entries(v || {}).map(([col, x]) => [rn(col), x]))]));
    for (const k of ["day_oc_none", "night_oc_none"]) { const tbl = (m.fixed || {})[k]; if (!tbl) continue; for (const d of Object.keys(tbl)) tbl[d] = [].concat(tbl[d] || []).map(rn); }
  }
  // 改名は月データ・設定の複製に対して行い（本体の追随とプラグインの追随の両方）、全部成功したときだけ採用する。プラグインの追随（columns の rename / 規則の rename）が失敗したら何も変えずに false を返す
  const replaceInto = (target, src) => { for (const k of Object.keys(target)) delete target[k]; Object.assign(target, src); };
  // 改名の追随（名簿の欄の rename と規則の rename）を複製で試す。成功なら複製 {R2, m2} を返し、失敗なら知らせて null
  function renameTrialOn(R, m, oldN, newN) {
    const R2 = JSON.parse(JSON.stringify(R)), m2 = JSON.parse(JSON.stringify(m));
    try { for (const c of T.rules.columnsAll(R2)) if (c.rename) c.rename(R2, oldN, newN); for (const d of T.RULE_DEFS || []) if (typeof d.rename === "function") d.rename(R2, m2, oldN, newN); }
    catch (e) { A.toast(T.t("{who} の改名を取り消しました: プラグインの人ごとのデータの追随に失敗しました（{err}）。プラグインの作成者に知らせてください", { who: oldN, err: e && e.message || e })); return null; }
    return { R2, m2 };
  }
  const renameTrial = (oldN, newN) => !!renameTrialOn(state.rules, state.month, oldN, newN);
  // 改名を記録する（起きた順にすべて。同期の後に足した人の氏名の変更も）。統合のときに、共通の元の名簿にいた人から始まる対応だけを使う（T.effectiveRenames）
  function noteRename(oldN, newN) { if (oldN !== newN) (state.renames ||= []).push([oldN, newN]); }
  // 削除の印は操作ごとに一意にする。空いた氏名を別人が使っても、Undo が別人の削除を戻さない。
  // 保存で改名の記録が消えても Undo の記録は残るため、取り消し履歴がある間は使用済みの印を再利用しない。
  const usedRemovalNames = new Set();
  function removalName(name) {
    for (const pair of state.renames || []) for (const n of pair) if (String(n).startsWith(T.GONE)) usedRemovalNames.add(n);
    const base = T.GONE + name; let n = base, i = 1; while (usedRemovalNames.has(n)) n = `${base}\u0000${i++}`;
    usedRemovalNames.add(n); return n;
  }
  // 名簿から外す: 月の入力と、設定の側の人ごとの条件（隠れている規則の欄・表示順・プラグインの項目）も外す。外したことを改名の記録に残す（外した後にその氏名を別の人が使っても、相手の版の元の人の入力を別の人に付けない）
  function removalTrial(i) {
    const R = state.rules, nm = (R.doctors[i] || {}).name; if (nm === undefined) return null;
    const R2 = JSON.parse(JSON.stringify(R)), m2 = JSON.parse(JSON.stringify(state.month));
    try {
      // 名簿を直している途中の設定でも削除できるよう、Problem の成立ではなくプラグインの契約だけを確認する。
      if ((T.plugins && (T.plugins.errors().length || T.plugins.stale().length)) ||
          Object.entries(R.rule_states || {}).some(([id, st]) => !T.RULE_BY_ID[id] && (st !== "off" || /^local\./.test(id))) ||
          (state.month.plugins_used || []).some(id => !T.RULE_BY_ID[id]) || T.hookCheck(R2, m2).length) throw new Error("incomplete plugins");
      T.purgeRulesNames(R2, [nm]); T.purgeMonthNames(m2, [nm]); R2.doctors.splice(i, 1);
    } catch (e) {
      A.toast(T.t("名簿から外せません: 施設のプラグインが欠けているか、人ごとの設定の削除に失敗しました。プラグインを確認してください")); return null;
    }
    return { R2, m2, nm };
  }
  function removeDoctor(i) {
    const trial = removalTrial(i); if (!trial) return false;
    replaceInto(state.rules, trial.R2); replaceInto(state.month, trial.m2); noteRename(trial.nm, removalName(trial.nm)); return true;
  }
  function renameDoctor(oldN, newN) {
    if (oldN !== newN && hasHistoricalName(newN)) { A.toast(historicalRenameMessage(newN)); return false; }
    const t = renameTrialOn(state.rules, state.month, oldN, newN); if (!t) return false; const { R2, m2 } = t;
    T.renameMonthName(m2, oldN, newN);
    const ren1 = w => Array.isArray(w) ? w.map(x => x === oldN ? newN : x) : (w === oldN ? newN : w);
    const renAsg = a => { for (const v of Object.values(a || {})) { if (v && v.work !== undefined) v.work = ren1(v.work); if (v && v.oc) v.oc = v.oc.map(x => x === oldN ? newN : x); } };
    if (state.result) { renAsg(state.result.asg); renAsg(state.result.base_asg); if (state.result.avoid_ref && state.result.avoid_ref[oldN] !== undefined) { state.result.avoid_ref[newN] = state.result.avoid_ref[oldN]; delete state.result.avoid_ref[oldN]; } }
    // 共通の元（最後に同期した内容）は書き換えない。改名の対応を覚えておき、次の統合で相手の月と共通の元に同じ変換を当ててから比べる（相手が旧名のまま持っている入力を「旧名への追加」と誤って統合しない）。保存・読込で同期したら消す
    noteRename(oldN, newN);
    replaceInto(state.month, m2); replaceInto(state.rules, R2); return true; // 採用（参照は保つ。呼ぶ側が R.doctors を読み直しの結果で置き換える）
  }
  // 施設のプラグインが揃っていないか（改名と共有用の書き出しを断る判定）: 計算用の欠落・読込失敗・変換失敗に加え、設定が参照する local. の規則は「なし」でも登録が無ければ欠けているとみなす（独自データはその規則が持つ）
  function pluginsIncomplete(R, m) {
    let broken = true; try { broken = T.lintPlugins(new T.Problem(R, m)).some(x => ["LINT_PLUGIN_MISSING", "LINT_PLUGIN_ERROR", "LINT_PLUGIN_STALE", "LINT_PLUGIN_HOOK"].includes(x.code)); } catch (e) { broken = true; }
    if (!broken) broken = Object.keys(R.rule_states || {}).some(id => /^local\./.test(id) && !T.RULE_BY_ID[id]) || ((m || {}).plugins_used || []).some(id => !T.RULE_BY_ID[id]);
    return broken;
  }
  // ---------- 施設プロファイルの書き出し・読み込み ----------
  // 書き出し: 規則そのもの（施設の構成・規則の状態・重み・値）。月データは含めない。
  // withRoster でなければ共有用: 名簿は役割と目安（回数・比重）だけを残して氏名を「役割名＋番号」に置き換え、経験年数・資格・個人別の条件・プラグインが足した欄は落とす。
  // 名簿の外にある氏名は、個人別のキーを落とし、氏名そのものの値（表示順など）は仮の名前へ。既知の構造キー・識別子は維持し、独自データで両者を判別できなければ断る。
  // それでも残る氏名（プロファイルの名前や規則の文に書いた氏名は文の一部なので置き換えない）は leftover で返し、呼ぶ側が書き出す前に知らせる
  const EXPORT_DOCTOR_KEYS = ["team", "quota", "share"]; // 共有用の名簿に残す欄（役割と目安）
  // Only these schema edges are structural. In particular, recognizing a container never
  // exempts its unknown children, labels, or free text. Plug-in payloads stay opaque.
  function exportSchema(R, columnKeys) {
    const opaque = {}, plain = x => x && typeof x === "object" && !Array.isArray(x);
    const text = { accept: x => typeof x === "string" }, bool = { accept: x => typeof x === "boolean" };
    const obj = fields => ({ fields: new Map(Object.entries(fields)), accept: plain }), arr = item => ({ item, accept: Array.isArray });
    const oneOf = values => ({ safe: x => values.includes(x), accept: x => values.includes(x), tokens: values }), id = { safe: x => typeof x === "string" && !!x, accept: x => typeof x === "string", warn: "all" };
    const number = { safe: x => typeof x === "string" && x.trim() !== "" && Number.isFinite(Number(x)), accept: x => x == null || x === "" || (typeof x === "number" || typeof x === "string") && Number.isFinite(Number(x)) };
    const roleIds = T.normalizeRolesOf(R).map(x => x.id), role = Object.assign(oneOf(roleIds), { warn: "embedded" }), shift = oneOf(["day", "night"]);
    const dict = (keys, value, keyWarn) => ({ fields: new Map(keys.map(k => [k, value])), keyWarn, accept: plain });
    const ocRoles = [...new Set([...roleIds, ...(T.DEFAULT_ROLES || []).map(x => x.id)])];
    const languages = [...new Set(["ja", "en", ...(T.LANGS ? T.LANGS().map(([code]) => code) : [])])];
    const label = Object.assign(dict(languages, text), { accept: x => typeof x === "string" || plain(x) && Object.keys(x).every(k => languages.includes(k)) });
    const count = obj({ weekday: number, off_days: number }); count.safe = number.safe; count.accept = x => number.accept(x) || plain(x) && Object.entries(x).every(([k, v]) => count.fields.has(k) && number.accept(v));
    const counts = obj({ day: count, night: count, weekday: number, off_days: number }); counts.safe = number.safe; counts.accept = x => number.accept(x) || plain(x) && Object.entries(x).every(([k, v]) => counts.fields.has(k) && counts.fields.get(k).accept(v));
    const bounds = obj({ min: number, max: number });
    const profile = obj({ id, label, quota_mode: oneOf(["absolute", "share"]),
      roles: arr(obj({ id: role, label, refs: arr(oneOf(["charge", "other", "junior", "reserve"])), standby: bool })),
      shifts: arr(obj({ id: shift, label, on: oneOf(["off_days", "all", "weekdays", "none"]), oncall: bool })),
      positions: obj({ work: Object.assign(obj({ count: counts, min: counts, ideal: counts, day: count, night: count, weekday: number, off_days: number }), { safe: number.safe, accept: x => number.accept(x) || plain(x) }) }),
      calendar: obj({ holidays: id, closure: arr(obj({ month: number, days: arr(number) })) }),
      day_flags: arr(Object.assign(obj({ id, label, short: label }), { accept: x => typeof x === "string" || plain(x) })), fixed_tags: arr(Object.assign(obj({ label, shifts: arr(shift) }), { accept: x => typeof x === "string" || plain(x) })) });
    const defs = T.RULE_DEFS || [], weights = [...new Set([...Object.keys(WEIGHT_LABELS), ...defs.flatMap(d => [d.weight, ...(d.sub || []), ...Object.keys(d.w0sub || {})]).filter(Boolean)])];
    const fields = {
      profile, doctors: arr(obj({ name: text, team: role, quota: number, share: number })), name_order: arr(text),
      oncall_requirement: dict(ocRoles, dict(ocRoles, number, "embedded"), "embedded"), weights: dict(weights, number),
      rule_states: obj(Object.fromEntries(defs.map(d => [d.id, oneOf(d.states || ["hard", "soft", "off"])]))),
      rules_version: { accept: x => typeof x === "string" || typeof x === "number" }, notes: text, plugins_off: arr(id),
      friday_night_min: obj({}), friday_night_exact: obj({}), dayoff_work_max: opaque, weekend_dayshift_wish: arr(text),
      pm_clinic_arrhythmia_candidates: arr(text), arrhythmia_responsible_night: arr(text),
      quota_tolerance: number, max_same_weekday_shifts: number, dayoff_weekday_max: number, weekend_balance_max_diff: number,
      rest_day_required: bool, pm_external_night: oneOf(["allow", "confirm", "forbid"]),
      shift_run_max: dict(["day", "night"], number), shift_counts: dict(["day", "night"], bounds),
      pair_cap: obj({ shift, max: number }), run_length: obj({ min: number, max: number, exempt_qual: text }),
      days_off: obj({ min: { safe: x => x === "auto" || number.safe(x), accept: x => x === "auto" || number.accept(x) }, hours_per_week: number, hours_per_day: number, basis: oneOf(["hours", "holidays"]), mode: oneOf(["exact", "min"]), ake_is_off: bool, pair_min: number, pair_count: oneOf(["pairs", "runs"]), max_extra: number }),
      wish_off: obj({ max: number, counts: oneOf(["unavailable", "avoid", "both"]) }),
      forbid_sequence: arr(obj({ from: oneOf(["day", "night", "any"]), to: oneOf(["day", "night", "any"]) })),
      composition: arr(obj({ shift: oneOf(["day", "night", "all"]), days: oneOf(["all", "weekdays", "off_days"]), label, qual: text, not_qual: text, years_min: number, years_max: number, min: number, max: number })),
      docx: obj({ template: id, font: text, paper: obj({ size: oneOf(["A3", "A4", "Letter"]), orient: oneOf(["portrait", "landscape"]), margin: number }) }),
    };
    for (const d of defs) { for (const p of d.params || []) if (!(p.key in fields)) fields[p.key] = number; if (d.legacy && !(d.legacy in fields)) fields[d.legacy] = { accept: x => x == null || typeof x !== "object" }; }
    // A column declares its container, not every unrelated datum stored beside it.
    for (const k of columnKeys) if (!(k in fields)) fields[k] = opaque;
    return obj(fields);
  }
  function profileForExport(withRoster) {
    let R = JSON.parse(JSON.stringify(state.rules));
    delete R.toban_profile;
    const leftover = [];
    if (!withRoster) {
      if (pluginsIncomplete(state.rules, state.month)) throw new Error(T.t("施設のプラグインが欠けている・読めない間は共有用の書き出しができません（プラグインが共有から除くはずの個人の記録を除けないため）。プラグインを揃えてから書き出してください")); // 名簿込み（施設内の引き継ぎ用）は対象外
      const plain = x => x && typeof x === "object" && !Array.isArray(x), pathKey = p => JSON.stringify(p);
      const columnKeys = new Set(), personalKeys = new Set(), personalArrays = new Map();
      const personal = (orig, cleared, p) => {
        if (Array.isArray(orig)) { const keep = (Array.isArray(cleared) ? cleared : []).map(x => JSON.stringify(x)), removed = personalArrays.get(pathKey(p)) || new Set();
          orig.forEach(x => { const item = JSON.stringify(x); if (!keep.includes(item)) removed.add(item); }); personalArrays.set(pathKey(p), removed); return; }
        if (!plain(orig)) return; for (const [k, v] of Object.entries(orig)) {
        const q = [...p, k]; if (!plain(cleared) || !Object.prototype.hasOwnProperty.call(cleared, k)) personalKeys.add(pathKey(q));
        personal(v, plain(cleared) ? cleared[k] : undefined, q);
      } };
      try { T.pruneRosterRefs(R, { strict: true, onClear(k, orig, cleared) { columnKeys.add(k); personal(orig, cleared, [k]); } }); }
      catch (e) { throw new Error(T.t("名簿の個人別の欄を安全に除けないため、共有用の書き出しを中止しました。プラグインの欄の変換を確認してください")); }
      const schema = exportSchema(R, columnKeys), safeKeys = new Set(), safeValues = new Map(), valueWarnings = new Map(), structural = new Set();
      const collect = s => { if (!s) return; for (const v of s.tokens || []) structural.add(v); for (const [k, child] of s.fields || []) { structural.add(k); collect(child); } collect(s.item); }; collect(schema);
      const roles = T.normalizeRolesOf(R), cnt = new Map(), map = new Map(), origNames = (R.doctors || []).map(d => d.name).filter(n => typeof n === "string" && n);
      const doctors = (R.doctors || []).map(d => { const r = roles.find(x => x.id === d.team); const base = r ? r.label : (d.team || "S"); const n = (cnt.get(base) || 0) + 1; cnt.set(base, n); const nn = `${base}${n}`; if (d.name) map.set(d.name, nn);
        const o = { name: nn }; for (const k of EXPORT_DOCTOR_KEYS) if (d[k] !== undefined) o[k] = d[k]; return o; });
      const childOf = (s, k) => s && s.fields && s.fields.get(k);
      const fits = (s, v) => {
        if (!s || s.accept && !s.accept(v)) return false;
        if (Array.isArray(v) && s.item) return v.every(x => fits(s.item, x));
        if (plain(v) && s.fields) return Object.entries(v).every(([k, x]) => !s.fields.has(k) || fits(s.fields.get(k), x));
        return true;
      };
      // Snapshot the original structural edges/values before share hooks run. A hook
      // cannot introduce a name into a structural-looking location to evade the scan.
      const prove = (v, s, p = []) => { if (typeof v === "string" && s && s.safe && s.safe(v)) { safeValues.set(pathKey(p), v); if (s.warn) valueWarnings.set(pathKey(p), s.warn); structural.add(v); }
        if (Array.isArray(v)) v.forEach((x, i) => prove(x, s && s.item, [...p, i]));
        else if (plain(v)) for (const [k, x] of Object.entries(v)) { const q = [...p, k], child = childOf(s, k); if (fits(child, x) && !personalKeys.has(pathKey(q))) safeKeys.add(pathKey(q)); prove(x, child, q); }
      }; prove(R, schema);
      const ambiguous = (k, p) => map.has(k) && structural.has(k) && !personalKeys.has(pathKey(p)) && !(typeof p[p.length - 1] === "number" && (personalArrays.get(pathKey(p.slice(0, -1))) || new Set()).has(JSON.stringify(k)));
      const ambiguousValue = (v, s, p) => typeof v === "string" && !s && ambiguous(v, p);
      const isRecord = x => plain(x) && map.has(x.name);
      const structuralRecord = s => s && s.item && s.item.fields && !s.item.fields.has("name");
      const walk = (v, s, p = []) => {
        if (Array.isArray(v)) return v.flatMap((x, i) => !structuralRecord(s) && isRecord(x) ? [] : [structuralRecord(s) && isRecord(x) ? x : walk(x, s && s.item, [...p, i])]);
        if (plain(v)) return Object.fromEntries(Object.entries(v).filter(([k]) => { const q = [...p, k]; return safeKeys.has(pathKey(q)) || !map.has(k) || ambiguous(k, q); }).map(([k, x]) => [k, walk(x, childOf(s, k), [...p, k])]));
        return typeof v === "string" && map.has(v) && safeValues.get(pathKey(p)) !== v && !ambiguousValue(v, s, p) ? map.get(v) : v;
      };
      delete R.doctors; R = walk(R, schema); R.doctors = doctors;
      R.name_order = (R.name_order || []).filter(n => doctors.some(d => d.name === n));
      const failed = []; for (const d of T.RULE_DEFS || []) if (typeof d.share === "function") { try { d.share(R); } catch (e) { failed.push(d.id); } } // プラグインが名簿の外に持つ個人の記録を、プラグイン自身が除く（docs/rule-modules.md §4）
      if (failed.length) throw new Error(T.t("プラグインの規則 {ids} の共有用の変換に失敗したため、書き出しを中止しました（除けなかった個人の記録を含めないため）", { ids: failed.join(T.listSep()) })); // 失敗の詳細は個人の記録を含みうるので出さない
      // Scan only proven structural occurrences without a warning. Unknown keys that
      // also name schema terms are ambiguous: give share a chance to remove them,
      // then refuse rather than silently deleting possibly essential configuration.
      const seen = new Set(), hit = (str, exactIsStructural = false) => { for (const n of origNames) if (!seen.has(n) && str.includes(n) && !(exactIsStructural && str === n)) { seen.add(n); leftover.push(n); } };
      const refuse = () => { throw new Error(T.t("独自データの項目が氏名か設定の識別子か判断できないため、共有用の書き出しを中止しました。プラグインの share で個人の記録を除いてください")); };
      const scan = (v, s, p = []) => { if (Array.isArray(v)) v.forEach((x, i) => { if (structuralRecord(s) && isRecord(x)) refuse(); scan(x, s && s.item, [...p, i]); }); else if (plain(v)) for (const [k, x] of Object.entries(v)) {
        const q = [...p, k], pk = pathKey(q), child = childOf(s, k); if (!fits(child, x) || personalKeys.has(pk)) { if (ambiguous(k, q)) refuse(); hit(k); } else if (s.keyWarn) hit(k, s.keyWarn === "embedded"); scan(x, child, q);
      } else if (typeof v === "string") { const pk = pathKey(p); if (ambiguousValue(v, s, p)) refuse(); if (safeValues.get(pk) !== v || valueWarnings.has(pk)) hit(v, safeValues.get(pk) === v && valueWarnings.get(pk) === "embedded"); } };
      scan(R, schema);
    }
    R.toban_profile = { version: 1, roster: withRoster ? "included" : "placeholder" };
    return { rules: R, leftover };
  }
  async function exportProfile() {
    if (readSettings() === false) return;
    const withRoster = !!($("#setExportRoster") || {}).checked;
    let ex; try { ex = profileForExport(withRoster); } catch (e) { return alert(e && e.message || e); } // share の失敗など: 書き出さない
    const R = ex.rules, id = ((R.profile || {}).id || "custom").replace(/[^\w.-]+/g, "-");
    if (ex.leftover.length && !confirm(T.t("書き出す内容に名簿の氏名が残っています（{n} 名: {who}）。プロファイルの名前や規則の文に氏名を入れていないか確かめてください。このまま書き出しますか", { n: ex.leftover.length, who: ex.leftover.join(T.nameSep()) }))) return;
    const name = `profile_${id}${withRoster ? "_with_roster" : ""}.json`, blob = new Blob([JSON.stringify(R, null, 1)], { type: "application/json" });
    if (A.dirHandle) { await A.writeFile(A.dirHandle, name, blob); A.toast(T.t("フォルダに {name} を保存しました", { name })); } else A.download(name, blob);
  }
  // 設定と月の正規化は複製で完了させる。不正な名簿や正規化の失敗で、編集中の状態・取り消し履歴を壊さない。
  function prepareRulesImport(input, keepRoster = false) {
    const clone = x => JSON.parse(JSON.stringify(x));
    if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error(T.t("doctors（{person}一覧）がありません"));
    const rules = clone(input), month = clone(state.month);
    if (keepRoster && (rules.doctors == null || Array.isArray(rules.doctors) && !rules.doctors.length)) { rules.doctors = clone(state.rules.doctors); rules.name_order = clone(state.rules.name_order || []); }
    if (!Array.isArray(rules.doctors)) throw new Error(T.t("doctors（{person}一覧）がありません"));
    if (!rules.doctors.every(d => d && typeof d === "object" && !Array.isArray(d) && typeof d.name === "string" && d.name.trim())) throw new Error(T.t("勤務表データの設定（rules）の{person}一覧に、氏名の無い要素があります"));
    const historical = historicalImportNames(rules);
    if (historical.length) throw new Error(T.t("履歴・前月の記録にある氏名を新たに含むため、設定を読み込みませんでした: {who}。同じ本人なら、先に名簿の「追加」で確認してから、もう一度読み込んでください。別人なら、読み込む設定で別の氏名にしてください", { who: historical.join(T.nameSep()) }));
    T.fillDefaultRules(rules); T.normalizeMonth(month, rules);
    return { rules, month };
  }
  async function importProfile(file) {
    // 読み取り中の未確定の入力も守る。change 前の文字を再描画で捨てない。
    let edited = false; const markEdited = () => { edited = true; };
    for (const event of ["input", "change"]) document.addEventListener?.(event, markEdited, true);
    try { return await A.transition("data", () => importProfileCore(file, () => edited)); }
    finally { for (const event of ["input", "change"]) document.removeEventListener?.(event, markEdited, true); }
  }
  async function importProfileCore(file, edited) {
    const stopEdited = () => { if (!edited()) return false; A.toast(T.t("プロファイルの読み込みを中止しました（読み取りの間に入力が変更されました）。入力を確定してから、もう一度読み込んでください")); return true; };
    if (stopEdited()) return;
    let R; try { R = JSON.parse(await file.text()); } catch (e) { return alert(tx("プロファイルのファイルを読めませんでした（JSON の形式ではありません）")); }
    if (stopEdited()) return;
    if (!R || typeof R !== "object" || (!R.profile && !Array.isArray(R.doctors))) return alert(tx("施設プロファイルのファイルではありません（profile も doctors もありません）"));
    const label = T.pickLabel((R.profile || {}).label, (R.profile || {}).id || file.name);
    if (!confirm(T.t("施設プロファイル「{name}」を読み込みます。施設の構成・規則・規則の状態が置き換わります（「元に戻す」で取り消せます）。", { name: label }))) return;
    if (stopEdited()) return;
    delete R.toban_profile;
    let prepared; try { prepared = prepareRulesImport(R, true); } catch (e) { return alert(T.t("読み込み失敗: {err}", { err: e && e.message || e })); }
    pushUndo("施設プロファイルの読み込み");
    state.rules = prepared.rules; state.month = prepared.month;
    A.save(); A.renderAll();
    A.toast(T.t("施設プロファイル「{name}」を読み込みました。名簿と規則を確かめてください", { name: label }));
  }

  // ---------- 元に戻す ----------
  // 設定タブでの変更（表の編集・追加・削除・プロファイルの読み込み・JSON の反映・重みの初期化）の直前の状態を積み、1 つずつ取り消す。
  // 積むのはこの画面を開いている間だけ（再読み込みで消える）。月データも一緒に戻す（名簿の変更は月データの氏名にも及ぶため）
  // 履歴は「変更の直前」の写し（設定・月・結果）と、変更の直後の月の写し（after。同じ処理の中で変更が終わった後に取る）。
  // 戻すときに月が after と違っていれば（後から月別条件を入力した）、月と結果は戻さず設定だけ戻す。月・施設・JSON を切り替えたら履歴は捨てる（A.clearUndo）
  // ヘッダーの「元に戻す」は、設定の変更に加えて月別条件の入力（職員別カレンダーの不可・希望・固定、月の設定、固定配置）も戻す。入力の画面は変更の直前に pushUndo(label, { auto: true }) を呼ぶ。
  // auto の記録は、処理の直後に何も変わっていなければ捨てる（職員の切替など）。戻すときは、記録の直後の内容からその後に記録の無い変更（別の PC の変更の統合など）が入っていれば戻さない
  const undoStack = [], UNDO_MAX = 50;
  // ID集合が同じ入れ替え（X↔Y）も改名。実際に追随した操作を記録し、単なる役割の表示順の変更とは区別する。
  function noteUndoRoleRenames(renames) { const entry = undoStack[undoStack.length - 1]; if (entry && entry.after === null && renames.size) entry.rolesRenamed = true; }
  const monthSig = m => { const x = Object.assign({}, m); delete x.doc_versions; return JSON.stringify(A.canon(x)); }; // 月の中身の比較（版の記録と、画面の読み戻しが補う空値・集合の並びは差にしない）
  const unchangedSince = entry => { const o = JSON.parse(entry.snap); return monthSig(o.month) === monthSig(state.month) && A.rulesSig(o.rules) === A.rulesSig(state.rules) && JSON.stringify(o.result) === JSON.stringify(state.result); };
  // この操作で実際に行った改名だけを覚える。設定JSON・プロファイルの置換や並べ替えは改名ではない。
  // 保存で state.renames が確定・消去された後にも取り消せるよう、元の記録の配列から独立した写しにする。
  const undoRenames = entry => entry.renames || (entry.renames = entry.renameLog.slice(entry.renameStart).map(pair => pair.slice()));
  function pushUndo(label, opts = {}) {
    const snap = JSON.stringify({ rules: state.rules, month: state.month, result: state.result });
    if (undoStack.length && undoStack[undoStack.length - 1].snap === snap) {
      if (undoStack[undoStack.length - 1].after === null) return; // 同じ処理内の重複だけまとめる
      undoStack.pop(); // 前の無変化の操作は、新しい操作の auto / after を引き継がせず置き換える
    }
    const renameLog = (state.renames ||= []), entry = { snap, label, after: null, auto: !!opts.auto, renameLog, renameStart: renameLog.length }; undoStack.push(entry); if (undoStack.length > UNDO_MAX) undoStack.shift();
    queueMicrotask(() => { if (entry.after !== null) return; undoRenames(entry); entry.after = monthSig(state.month); entry.afterRules = A.rulesSig(state.rules); // 変更を行った処理が終わった直後の月と設定
      if (entry.auto && unchangedSince(entry)) { const i = undoStack.indexOf(entry); if (i >= 0) undoStack.splice(i, 1); renderUndo(); } });
    renderUndo();
  }
  function clearUndo() { undoStack.length = 0; usedRemovalNames.clear(); renderUndo(); }
  function renderUndo() {
    const b = $("#btnUndo"), note = $("#undoNote"); const last = undoStack[undoStack.length - 1];
    if (b) b.disabled = !last; if (!note) return; // 設定タブを描く前でも呼ばれる（切替時の履歴の破棄など）
    note.textContent = last ? T.t("直前の変更: {what}（あと {n} 回戻せます）", { what: T.term(tx(last.label), state.rules), n: undoStack.length }) : tx("取り消せる変更はありません"); note.title = note.textContent;
  }
  function undo() {
    if (A.solving) return A.toast(T.t("計算中は元に戻せません。計算が終わってから操作してください"));
    let last; while ((last = undoStack.pop()) && last.after !== null && unchangedSince(last)) { } // いまの状態と同じ記録（何も変えなかった操作）は飛ばす。押したのに何も起きない、を作らない
    renderUndo(); if (!last) return; // ヘッダーのボタンは、どのタブを描いているかに関わらずここで更新する
    const o = JSON.parse(last.snap);
    const monthUntouched = last.after === null || last.after === monthSig(state.month);
    const keepVersions = m => { const v = state.month.doc_versions; if (v !== undefined) m.doc_versions = v; else delete m.doc_versions; return m; }; // 版の記録は保存の履歴なので巻き戻さない
    if (last.auto) { // 月別条件の入力: 記録の直後の内容のままなら、月と結果を入力の前に戻す
      if (!monthUntouched || (last.afterRules && last.afterRules !== A.rulesSig(state.rules))) { renderUndo(); return A.toast(T.t("この変更は取り消せません: その後に別の経路（別のPCの変更の統合・データの取り込みなど）で内容が変わっています（{what}）", { what: T.term(tx(last.label), state.rules) })); }
      const keepDoctor = typeof A.doctorUndoCheckpoint === "function" ? A.doctorUndoCheckpoint() : null; // 設定（名簿）は差し替えない。選んでいた本人を確かめられれば、職員別カレンダーの選択を保って戻した値を見せる
      state.month = keepVersions(o.month); state.result = o.result; if (keepDoctor) keepDoctor();
      A.ensureMonth(state.month); A.save(); A.renderAll();
      return A.toast(T.t("元に戻しました（{what}）", { what: T.term(tx(last.label), state.rules) }));
    }
    // 名簿の位置から本人の対応を推測しない。実際の改名は操作の逆順で戻し、残る追加・削除は氏名で照合する。
    const renames = undoRenames(last), cur = (state.rules.doctors || []).map(d => d.name), old = (o.rules.doctors || []).map(d => d.name);
    const namesChanged = renames.length > 0 || JSON.stringify(cur.slice().sort()) !== JSON.stringify(old.slice().sort());
    if (!monthUntouched && namesChanged) { renderUndo(); return A.toast(T.t("この変更は取り消せません: 名簿の氏名を変えた後に月別条件も変更されているため、設定だけを戻すと氏名の対応が壊れます。手で直してください（{what}）", { what: tx(last.label) })); } // 不整合な状態を作らない（履歴からは外す）
    const roleIds = R => JSON.stringify(T.normalizeRolesOf(R).map(r => r.id).sort());
    if (!monthUntouched && (last.rolesRenamed || roleIds(o.rules) !== roleIds(state.rules))) { renderUndo(); return A.toast(T.t("この変更は取り消せません: 役割の識別子を変えた後に月別条件も変更されているため、設定だけを戻すと固定OCなしの役割との対応が壊れます。手で直してください（{what}）", { what: tx(last.label) })); }
    if (namesChanged) {
      const restored = new Set(cur);
      for (const [from, to] of renames.slice().reverse()) { noteRename(to, from); restored.delete(to); if (!String(from).startsWith(T.GONE)) restored.add(from); }
      const baseNames = (state.baseRules && state.baseRules.doctors || []).map(d => d.name);
      // 未保存のプロファイル置換を戻しただけなら、元からいた人を新しく足した別人と扱わない。
      for (const n of old) if (!restored.has(n) && T.renameOrigin(state.renames, baseNames, n) === null && !T.newPersons(state.renames, baseNames, [n]).includes(n)) noteRename(removalName(n), n);
      for (const n of restored) if (!old.includes(n)) noteRename(n, removalName(n));
    }
    state.rules = o.rules;
    if (monthUntouched) { state.month = keepVersions(o.month); state.result = o.result; } // 月別条件をその後に触っていなければ月と結果も戻す
    A.ensureMonth(state.month); A.save(); A.renderAll();
    A.toast(T.t("元に戻しました（{what}）", { what: tx(last.label) }) + (monthUntouched ? "" : T.t("。月別条件はその後に変更されているので戻していません")));
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
    const cleanupPanel = $("#historyCleanup");
    if (cleanupPanel) {
      cleanupPanel.addEventListener("toggle", renderHistoryCleanup);
      cleanupPanel.addEventListener("change", ev => { if (ev.target.name === "historyCleanupPerson") $("#btnHistoryCleanup").disabled = false; });
      cleanupPanel.addEventListener("click", ev => { if (ev.target.id === "btnHistoryCleanup") cleanSelectedHistory(); });
    }
    $("#btnReloadPlugins").addEventListener("click", () => A.transition("plugins", async () => { if (!A.dirHandle) return A.toast(T.t("保存フォルダに接続していません")); const n = await A.loadFolderPlugins(); if (!n) A.toast(T.t("保存フォルダに plugins/ のプラグインはありません")); renderSettings(); }));
    $("#settings").addEventListener("click", ev => {
      const b = ev.target.closest("button"); if (!b || !b.dataset.act) return;
      const act = b.dataset.act, mod = (T.RULE_DEFS || []).find(d => d.ui && d.ui.acts && d.ui.acts[act]); // プラグインの設定欄のボタン（表の行の追加・削除など）
      let addedName;
      if (!mod && act === "add") {
        if ([...document.querySelectorAll('#doctorTable tr[data-i]')].some(tr => tr.querySelector('[data-f="name"]').value.trim() !== state.rules.doctors[+tr.dataset.i]?.name)) {
          A.toast(T.t("編集中の氏名の変更を確定してから、名簿に追加してください")); return;
        }
        const raw = prompt(T.t("追加する{person}の氏名を入力してください"));
        if (raw === null) return;
        addedName = raw.trim();
        if (!addedName) { A.toast(T.t("氏名を入力してください")); return; }
        const pendingNames = [...document.querySelectorAll('#doctorTable tr[data-i]')].map(tr => tr.querySelector('[data-f="name"]').value.trim());
        if (state.rules.doctors.some(d => d.name === addedName) || pendingNames.includes(addedName)) { A.toast(T.t("氏名「{name}」は名簿にあります。別の氏名にしてください", { name: addedName })); return; }
        if (hasHistoricalName(addedName) && !confirm(T.t("氏名「{name}」は履歴・前月の記録にあります。同じ本人を再び追加しますか。履歴は引き継ぎますが、削除した当月の入力や個人設定は復元せず、初期値で追加します。別人ならキャンセルして別の氏名にしてください", { name: addedName }))) {
          A.toast(T.t("追加を中止しました。別人を追加する場合は別の氏名にしてください")); return;
        }
      }
      if (!mod && act === "del" && !removalTrial(+(b.closest("tr") || { dataset: {} }).dataset.i)) return; // 読み戻し・Undo 記録の前に失敗を検出
      if (readSettings(mod ? mod.ui.acts[act] : { add: "名簿に追加", del: "名簿から削除", up: "名簿の並べ替え", down: "名簿の並べ替え", roleAdd: "役割を追加", roleDel: "役割を削除" }[act] || "設定の変更") === false) return;
      const R = state.rules, tr = b.closest("tr"), i = tr ? +tr.dataset.i : -1;
      if (mod) { mod.ui.act(R, act, b); A.save(); renderSettings(); return; }
      if (b.dataset.act === "roleAdd" || b.dataset.act === "roleDel") { // 役割の追加・削除
        const roles = T.normalizeRolesOf(R).map(x => Object.assign({}, rawRoleOf(R, x.id), { id: x.id, label: x.labelRaw ?? x.label, refs: [...x.refs], standby: x.standby }));
        if (b.dataset.act === "roleAdd") {
          let i = roles.length + 1, id = `R${i}`; while (roles.some(r => r.id === id)) id = `R${++i}`;
          roles.push({ id, label: id, refs: [], standby: false });
          // 新しい役割は OC 資格が無い間も行・列を明示的な 0 で持つ。後の改名で既定 ID を再使用しても
          // 古い保存データ向けの欠損補完（Problem の既定人数）を新規入力として復活させない。
          const oc = R.oncall_requirement || {};
          R.oncall_requirement = Object.fromEntries(roles.map(r => [r.id, r.id === id
            ? Object.fromEntries(roles.map(c => [c.id, 0]))
            : Object.fromEntries([...Object.entries(Object.prototype.hasOwnProperty.call(oc, r.id) ? oc[r.id] || {} : {}), [id, 0]])]));
        }
        else { const i = +b.closest("tr").dataset.ri; const gone = roles[i]; if (!gone) return;
          const used = R.doctors.filter(d => d.team === gone.id).map(d => d.name);
          if (used.length && !confirm(T.t("役割「{role}」は {n} 名（{who}）が使っています。削除すると名簿の役割が空欄になります。よろしいですか", { role: gone.label, n: used.length, who: used.slice(0, 3).join(T.nameSep()) + (used.length > 3 ? T.t(" ほか") : "") }))) return;
          for (const d of R.doctors) if (d.team === gone.id) d.team = ""; // 確認で案内したとおり未指定へ。別の役割は利用者が明示的に選ぶ。
          roles.splice(i, 1);
          // 資格の切替とは違い、役割自体の削除では潜在している OC 人数も行・列とも削除する。
          if (R.oncall_requirement) R.oncall_requirement = Object.fromEntries(Object.entries(R.oncall_requirement).filter(([id]) => id !== gone.id)
            .map(([id, row]) => [id, Object.fromEntries(Object.entries(row || {}).filter(([col]) => col !== gone.id))])); }
        (R.profile ||= {}).roles = roles;
        T.fillDefaultRules(R); A.ensureMonth(state.month); A.save(); renderSettings(); A.renderSettingsMonth(); A.renderDoctor(); return;
      }
      if (b.dataset.act === "add") {
        const d = { name: addedName, team: (T.normalizeRolesOf(R).find(x => x.refs.includes("junior")) || T.normalizeRolesOf(R)[0] || {}).id || "Y", years: 0, quota: 5, cath: null };
        R.doctors.push(d); noteRename(removalName(d.name), d.name); // 当月の入力は新しい追加として記録し、削除した入力を復活させない。履歴の本人への接続だけは、追加前の明示的な確認で認める。
      }
      else if (b.dataset.act === "del") { const nm = R.doctors[i].name, refs = T.monthNameRefs(state.month)[nm];
        if (!confirm(refs ? T.t("{who} を名簿から外します。この月の {who} の入力（{kinds}）も消します", { who: nm, kinds: refs.join(T.listSep()) }) : T.t("{who} を名簿から外します", { who: nm }))) return;
        if (!removeDoctor(i)) return; } // 設定の側の人ごとの条件（隠れている規則の欄・表示順・プラグインの項目）も外す
      else if (b.dataset.act === "up" && i > 0) { [R.doctors[i - 1], R.doctors[i]] = [R.doctors[i], R.doctors[i - 1]]; }
      else if (b.dataset.act === "down" && i < R.doctors.length - 1) { [R.doctors[i + 1], R.doctors[i]] = [R.doctors[i], R.doctors[i + 1]]; }
      A.refreshNameOrder(R);
      A.ensureMonth(state.month); A.save(); renderSettings(); A.renderSettingsMonth(); A.renderDoctor(); A.renderFixed(); // 名簿が変わったので他の画面も描き直す
    });
    $("#settings").addEventListener("click", ev => { if (ev.target.id === "btnExportProfile") exportProfile(); });
    const settings = $("#settings"), isRuleNumber = el => ["setRunMax", "setRunMin", "setHrWeek", "setHrDay", "setOffMin", "setPairMax", "setWishOffMax", "setDoMaxExtra", "setPairMin"].includes(el.id), committedRuleValues = new WeakMap();
    const customNumberSelector = '[data-scr], [data-srm], [data-f="fri"], [data-cymin], [data-cymax], [data-cmin], [data-cmax], [data-oc]';
    const isCustomNumber = input => input.matches?.(customNumberSelector), committedCustomValues = new WeakMap();
    const refreshCustomNumbers = () => {
      const R = state.rules;
      for (const input of settings.querySelectorAll(customNumberSelector)) {
        let shown;
        if (input.dataset.scr !== undefined) { const [shift, bound] = input.dataset.scr.split(":"); shown = ((R.shift_counts || { night: { min: 3, max: 5 } })[shift] || {})[bound] ?? ""; }
        else if (input.dataset.srm !== undefined) shown = (R.shift_run_max || { day: 3 })[input.dataset.srm] ?? "";
        else if (input.dataset.f === "fri") shown = (R.friday_night_min || {})[R.doctors[+input.closest("tr[data-i]").dataset.i].name] ?? "";
        else if (input.dataset.oc !== undefined) shown = ((R.oncall_requirement || {})[input.closest("tr[data-t]").dataset.t] || {})[input.dataset.oc] ?? 0;
        else { const row = (R.composition || [])[+input.closest("tr[data-ci]").dataset.ci] || {};
          const field = [["cymin", "years_min"], ["cymax", "years_max"], ["cmin", "min"], ["cmax", "max"]].find(([key]) => input.dataset[key] !== undefined)[1];
          shown = row[field] ?? "";
        }
        const value = T.numberInputText(shown);
        input.value = value; input.setAttribute("value", value); delete input.dataset.numericEdited;
        committedCustomValues.set(input, input.value);
      }
    };
    let committingCustomNumber = false;
    const commitCustomNumber = input => {
      if (committingCustomNumber || !settings.contains(input) || input.dataset.numericEdited !== "1") return;
      committingCustomNumber = true;
      try {
        const rosterColumns = T.rules.columns(state.rules).map(c => c.key).join("\0");
        if (readSettings(input.closest("#profileBuilder") ? "施設の構成の変更" : input.closest("#doctorTable") ? "名簿の変更" : "規則・重みの変更") === false) return;
        // Keep the focused row and refresh snapshots after committing all visible settings.
        if (input.dataset.scr !== undefined && rosterColumns !== T.rules.columns(state.rules).map(c => c.key).join("\0")) renderSettingsRoster();
        refreshCustomNumbers();
        $("#rulesJson").value = JSON.stringify(state.rules, null, 1);
        A.renderSettingsMonth(); A.renderDoctor();
      } finally { committingCustomNumber = false; }
    };
    let committingRuleNumber = false;
    const commitRuleNumber = input => {
      if (committingRuleNumber || !settings.contains(input) || $("#" + input.id) !== input || input.dataset.numericEdited !== "1") return;
      committingRuleNumber = true;
      try {
        if (readSettings("規則・重みの変更") === false) return;
        // 設定DOMを残し、Tabやクリックで移った先の欄を失わない。確定済みの編集印は各欄から除く。
        const rest = state.rules.days_off || {}, restText = v => typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) ? String(Number(v)) : String(v).replace(/\r\n?/g, "\n").replace(/\0/g, "\uFFFD");
        for (const [id, shown] of [["setRunMax", (state.rules.run_length || {}).max ?? 5], ["setRunMin", (state.rules.run_length || {}).min ?? 3],
          ["setHrWeek", restText(rest.hours_per_week ?? 40)], ["setHrDay", restText(rest.hours_per_day ?? 8)], ["setOffMin", restText(rest.min != null && rest.min !== "auto" ? rest.min : "")],
          ["setPairMax", T.numberInputText((state.rules.pair_cap || {}).max ?? 2)], ["setWishOffMax", T.numberInputText((state.rules.wish_off || {}).max ?? 3)],
          ["setDoMaxExtra", T.numberInputText(rest.max_extra ?? 1)], ["setPairMin", T.numberInputText(rest.pair_min ?? 1)]]) {
          const el = $("#" + id); if (!el) continue;
          const value = ["setRunMax", "setRunMin"].includes(id) ? String(shown).replace(/[\r\n]/g, "") : String(shown);
          el.value = value; el.setAttribute("value", value); delete el.dataset.numericEdited; committedRuleValues.set(el, el.value);
        }
        $("#rulesJson").value = JSON.stringify(state.rules, null, 1);
        A.renderSettingsMonth(); A.renderDoctor();
      } finally { committingRuleNumber = false; }
    };
    settings.addEventListener("input", ev => { if (ev.target.matches?.(ruleTextSelector)) ev.target.dataset.textEdited = "1"; if (ev.target.id === "setCalClosure") ev.target.dataset.closureEdited = "1"; if (["quota", "share", "years", "shift_max_day", "shift_max_night"].includes(ev.target.dataset?.f) || ev.target.dataset?.prm !== undefined || isRuleNumber(ev.target) || isCustomNumber(ev.target)) ev.target.dataset.numericEdited = "1"; });
    // 改行だけ・空配列の保存値は空欄に見える。同じ空欄へ編集するとchangeが出ないため、離れた時にも確定する。
    settings.addEventListener("focusout", ev => {
      if (ev.target.matches?.(ruleTextSelector) && ev.target.dataset.textEdited === "1" && settings.contains(ev.target)) {
        if (readSettings("規則・重みの変更") === false) return;
        $("#rulesJson").value = JSON.stringify(state.rules, null, 1);
        A.renderSettingsMonth(); A.renderDoctor(); return;
      }
      if (ev.target.id === "setCalClosure" && ev.target.dataset.closureEdited === "1" && settings.contains(ev.target)) {
        if (readSettings("施設の構成の変更") === false) return;
        $("#rulesJson").value = JSON.stringify(state.rules, null, 1);
        A.renderSettingsMonth(); A.renderDoctor(); return;
      }
      if (ev.target.dataset?.prm !== undefined && ev.target.dataset.numericEdited === "1" && settings.contains(ev.target)) {
        if (readSettings("規則・重みの変更") === false) return;
        const input = ev.target, value = T.numberInputText(state.rules[input.dataset.prm] ?? "");
        input.value = value; input.setAttribute("value", value); delete input.dataset.numericEdited;
        $("#rulesJson").value = JSON.stringify(state.rules, null, 1);
        A.renderSettingsMonth(); A.renderDoctor(); return;
      }
      if (isCustomNumber(ev.target)) { commitCustomNumber(ev.target); return; }
      if (isRuleNumber(ev.target)) commitRuleNumber(ev.target);
      const input = ev.target;
      if (!["share", "years", "shift_max_day", "shift_max_night"].includes(input.dataset?.f) || input.dataset.numericEdited !== "1" || !settings.contains(input)) return;
      if (readSettings("名簿の変更") === false) return;
      const value = T.numberInputText(state.rules.doctors[+input.closest("tr[data-i]").dataset.i][input.dataset.f] ?? (input.dataset.f === "share" ? 1 : ""));
      input.value = value; input.setAttribute("value", value); delete input.dataset.numericEdited;
      $("#rulesJson").value = JSON.stringify(state.rules, null, 1);
      A.renderSettingsMonth(); A.renderDoctor();
    });
    $("#settings").addEventListener("change", ev => {
      if (ev.target.matches?.(ruleTextSelector)) {
        if (ev.target.dataset.textEdited !== "1" && ev.target.dataset.textCommitted === "1" && ev.target.value === ev.target.dataset.textShown) return;
        ev.target.dataset.textEdited = "1";
      }
      if (ev.target.id === "setCalClosure") ev.target.dataset.closureEdited = "1";
      if (isCustomNumber(ev.target)) {
        if (ev.target.dataset.numericEdited !== "1" && committedCustomValues.get(ev.target) === ev.target.value) return;
        ev.target.dataset.numericEdited = "1"; commitCustomNumber(ev.target); return;
      }
      if (isRuleNumber(ev.target)) {
        if (ev.target.dataset.numericEdited !== "1" && committedRuleValues.get(ev.target) === ev.target.value) return;
        ev.target.dataset.numericEdited = "1"; commitRuleNumber(ev.target); return;
      }
      if (ev.target.dataset?.prm !== undefined || ["quota", "share", "years", "shift_max_day", "shift_max_night"].includes(ev.target.dataset?.f)) ev.target.dataset.numericEdited = "1";
      if (ev.target.id === "fileLoadProfile") { const f = ev.target.files && ev.target.files[0]; ev.target.value = ""; if (f) importProfile(f); return; }
      if (ev.target.id === "setProfile" || ev.target.id === "setExportRoster") return; // 読み込む・書き出すボタンを押すまで設定は変えない
      if (ev.target.closest("#doctorTable, #weightsTable, #hardRules, #profileBuilder")) { if (readSettings(ev.target.closest("#profileBuilder") ? "施設の構成の変更" : ev.target.closest("#doctorTable") ? "名簿の変更" : "規則・重みの変更") === false) return; renderSettings(); A.renderSettingsMonth(); A.renderDoctor(); } });
    $("#btnApplyRules").addEventListener("click", () => A.transition("data", () => { try { const prepared = prepareRulesImport(JSON.parse($("#rulesJson").value)); pushUndo("JSON の反映"); state.rules = prepared.rules; state.month = prepared.month; A.save(); renderSettings(); A.renderSettingsMonth(); A.renderDoctor(); A.toast(T.t("JSONを反映しました")); } catch (e) { alert(T.t("JSONの形式が不正です: {err}", { err: e })); } }));
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
    let prepared; try { prepared = prepareRulesImport(src); } catch (e) { return alert(T.t("読み込み失敗: {err}", { err: e && e.message || e })); }
    pushUndo("施設プロファイルの読み込み");
    state.rules = prepared.rules; state.month = prepared.month;
    A.save(); A.renderAll();
    A.toast(T.t("施設プロファイルを「{name}」にしました。名簿と規則を確認し、この施設の月を新しく作ってください", { name }));
  }
  Object.assign(A, { renderSettings, bindSettings, loadProfileById, profileForExport, renameDoctor, removeDoctor, readSettings, clearUndo, pushUndo, undo }); // 他のファイルから使う関数
})(globalThis.T = globalThis.T || {}, globalThis.T.app = globalThis.T.app || {});

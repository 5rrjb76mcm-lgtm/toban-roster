// 当直表アプリ: 入力（rules + month）から問題オブジェクトを作る。toban.py の Problem に対応
(function (T) {
  const DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const DOW_JA = ["月", "火", "水", "木", "金", "土", "日"];
  const PARTS = { am: ["am"], pm: ["pm"], full: ["am", "pm"] };
  // 勤務内容の種別（画面・報告・docx で共通）
  const KINDS = { outpatient: "外来", ward: "病棟番", external: "外勤", absent: "不在" };
  // 勤務者の種別ごとに必要なオンコール（規則に無いときの既定。部長 C はソルバーの扱い＝主担当1＋若手1 に合わせる）
  const DEFAULT_OC_REQ = { I: { I: 0, Y: 1 }, A: { I: 1, Y: 1 }, Y: { I: 1, Y: 0 }, C: { I: 1, Y: 0 } }; // 部長の登用時は主担当OC1名（2026-09-17）
  const DEFAULT_CATH_REQ = { A_am: 0, A_pm: 0, I: 1, pm_clinic: false };
  // 勤務帯（当番枠の種別）。この版では id は day / night の 2 つで、「どの日に枠があるか」と表示名を設定で決める。
  //   on: "off_days"=土日祝だけ（既定の日勤） / "all"=毎日（2交代制の日勤） / "weekdays"=平日だけ / "none"=計算で決めない（日中だけ。夜は必須）
  const DEFAULT_SHIFTS = [{ id: "day", label: "日勤", on: "off_days" }, { id: "night", label: "夜勤", on: "all" }];
  const SHIFT_IDS = ["day", "night"];
  // 役割（チーム）。識別子は施設が自由に決められる（既定は I / A / Y / C）。
  // 規則の側は識別子ではなく「役割の機能」を参照する。機能は 4 つ:
  //   charge  = 期間責任者になれる役割（休日・週末を通して担当する）
  //   other   = もう一方の専門の役割（同日のチーム集約・若手OCの省略条件で使う）
  //   junior  = オンコールに入る若手の役割
  //   reserve = 原則配置しない予備の役割（部長）
  // 既定のプロファイル（勤務医の見本）では charge=I, other=A, junior=Y, reserve=C。
  const DEFAULT_ROLES = [
    { id: "I", label: "主担当", refs: ["charge"], standby: true },
    { id: "A", label: "副担当", refs: ["other"] },
    { id: "Y", label: "若手", refs: ["junior"], standby: true },
    { id: "C", label: "部長", refs: ["reserve"] },
  ];
  const ROLE_REFS = ["charge", "other", "junior", "reserve"];
  function normalizeRoles(rules) {
    const src = ((rules || {}).profile || {}).roles;
    if (!Array.isArray(src) || !src.length) return DEFAULT_ROLES.map(x => Object.assign({}, x, { refs: [...x.refs], labelRaw: x.label }));
    const out = [];
    for (const x of src) {
      const id = String((x || {}).id || "").trim();
      if (!id) throw new Error("設定の profile.roles に識別子のない役割があります");
      if (/[:|]/.test(id) || /[\u0000-\u001f]/.test(id)) throw new Error(`役割の識別子に使えない文字があります（「${id}」。: と | は使えません）`);
      if (out.some(o => o.id === id)) throw new Error(`設定の profile.roles に役割「${id}」が重複しています`);
      const refs = [].concat(x.refs || []).filter(r => ROLE_REFS.includes(r));
      out.push({ id, label: T.pickLabel ? T.pickLabel(x.label, id) : String(x.label || id), labelRaw: x.label ?? id, refs, standby: !!x.standby });
    }
    for (const r of ROLE_REFS) {
      const n = out.filter(o => o.refs.includes(r)).length;
      if (n > 1) throw new Error(`役割の機能「${r}」を持つ役割が ${n} つあります（1 つにしてください）`);
    }
    return out;
  }
  const roleLabelsOf = rules => Object.fromEntries(normalizeRoles(rules).map(r => [r.id, r.label]));
  // 勤務者の配置人数。整数、または勤務帯ごと {day: n, night: m}、または日の種別ごと {weekday: n, off_days: m}
  // min=true なら下限（positions.work.min。書いていなければ count と同じ＝固定の人数）
  function workerCount(rules, kind, isHoliday, min = false) {
    const c = (((rules || {}).profile || {}).positions || {}).work;
    if (min) { if (!c || c.min === undefined) return workerCount(rules, kind, isHoliday); return Math.min(workerCount(rules, kind, isHoliday), workerCount({ profile: { positions: { work: { count: c.min } } } }, kind, isHoliday)); }
    const pick = v => {
      if (v == null) return 1;
      if (typeof v === "number") return Math.max(0, Math.round(v));
      if (typeof v === "object") {
        if (v[kind] !== undefined) return pick(v[kind]);
        const byDay = isHoliday ? v.off_days : v.weekday;
        if (byDay !== undefined) return pick(byDay);
      }
      return 1;
    };
    return pick(c && c.count !== undefined ? c.count : c);
  }
  function normalizeShifts(rules) {
    const src = ((rules || {}).profile || {}).shifts;
    if (!Array.isArray(src) || !src.length) return DEFAULT_SHIFTS.map(x => Object.assign({}, x, { labelRaw: x.label, oncall: true }));
    const out = [];
    for (const x of src) {
      const base = DEFAULT_SHIFTS.find(d => d.id === (x || {}).id);
      if (!base) throw new Error(`この版で使える勤務帯は ${SHIFT_IDS.join(" / ")} だけです（設定の profile.shifts にある「${(x || {}).id}」は使えません）`);
      if (out.some(o => o.id === base.id)) throw new Error(`設定の profile.shifts に勤務帯「${base.id}」が重複しています`);
      const on = ["off_days", "all", "weekdays", "none"].includes(x.on) ? x.on : base.on;
      if (on === "none" && base.id === "night") throw new Error("夜の勤務帯は計算で決める必要があります（この版では夜の枠を前提にした規則があるため）");
      out.push({ id: base.id, label: T.pickLabel ? T.pickLabel(x.label, base.label) : (x.label || base.label), labelRaw: x.label ?? base.label, on, oncall: x.oncall !== false }); // oncall: この勤務帯の枠にオンコールを付けるか（既定は付ける）
    }
    for (const base of DEFAULT_SHIFTS) if (!out.some(o => o.id === base.id)) out.push(Object.assign({}, base, { labelRaw: base.label, oncall: true })); // 書かれていない帯は既定のまま
    return out;
  }

  // 月の休みの最低日数。実務では暦の日数で決まる（変形労働時間制）ので、既定は暦から計算する。
  //   所定労働日数 = floor(暦日数 × 週の所定労働時間 / 7 / 1日の所定労働時間)、休みの日数 = 暦日数 − 所定労働日数
  //   週40時間・1日8時間なら 28日→8日、29日→9日、30日→9日、31日→9日
  // rules.days_off.min に数を書けばその値を使う（暦に連動させたくない施設向け）。
  function minDaysOff(rules, N) {
    const d = (rules || {}).days_off || {};
    if (d.min != null && d.min !== "" && d.min !== "auto") return Math.max(0, Math.min(N, Math.round(+d.min) || 0));
    const wk = +(d.hours_per_week ?? 40), hr = +(d.hours_per_day ?? 8);
    if (!(wk > 0) || !(hr > 0)) return 0;
    return Math.max(0, N - Math.floor(N * wk / 7 / hr));
  }

  // 規則の名前に埋め込む役割の呼び方。{charge} などを施設の表示名に置き換える（焼き込みを避ける）
  const REF_JA = { charge: "期間責任者", other: "対の役割", junior: "補助の役割", reserve: "予備の役割" };
  function term(s, rules) {
    let roles = null;
    return String(s).replace(/\{(charge|other|junior|reserve)\}/g, (_, k) => {
      if (!roles) { try { roles = normalizeRoles(rules); } catch (e) { roles = []; } }
      const r = roles.find(o => o.refs.includes(k));
      return r ? r.label : (T.t ? T.t(REF_JA[k]) : REF_JA[k]);
    });
  }

  // 規則を並べる区分（設定画面の見出し）
  const RULE_GROUPS = [
    ["basic", "枠と回数"],
    ["combo", "同じ日・連続・間隔"],
    ["rest", "休みの日"],
    ["team", "役割とオンコール"],
    ["wish", "希望と公平"],
    ["duty", "日中の業務との関係"],
  ];

  // 規則の状態（必須 / 減点 / なし）。施設ごとに変えられる規則の一覧で、ソルバー・検算・入力チェック・設定画面が
  // すべてこの表を見る。state は rules.rule_states[id]。古い保存データは legacy のキーから読み替える。
  //   hard = 必須条件（守れないときは解なし）／soft = 調整目標（weight の重みで減点）／off = 適用しない
  // w0 は「減点」にしたときの既定の重み。fillDefaultRules が rules.weights に書き出すので、解くときに隠れた既定値は無い。
  // sub は、その規則の内側で使う重み（規則を「なし」にすると一緒に効かなくなるもの）。設定画面はこれを規則の下にまとめて出す。
  // 規則の一覧。プラグイン（rules-core.js の T.rules.register）に登録し、rules/*.js の実装がこの上に重なる。docs/rule-modules.md
  const RULE_DEFS_INLINE = [
    // ---- 枠と回数 ----
    { id: "quota_range", group: "basic" }, // 中身は rules/quota_range.js
    { id: "quota_target", group: "basic" }, // 中身は rules/quota_target.js
    { id: "shift_balance", group: "basic" }, // 中身は rules/shift_balance.js
    { id: "count_target", group: "basic" }, // 中身は rules/count_target.js
    { id: "staff_per_day", group: "basic" }, // 中身は rules/staff_per_day.js
    { id: "friday_night_min", group: "basic" }, // 中身は rules/friday_night_min.js
    // ---- 同じ日・連続・間隔 ----
    { id: "same_day_double", group: "combo" }, // 中身は rules/same_day_double.js
    { id: "consecutive_days", group: "combo" }, // 中身は rules/consecutive_days.js
    { id: "run_length_max", group: "combo" }, // 中身は rules/run_length_max.js
    { id: "run_length_min", group: "combo" }, // 中身は rules/run_length_min.js
    { id: "shift_sequence", group: "combo" }, // 中身は rules/shift_sequence.js
    { id: "same_weekday_cap", group: "combo" }, // 中身（名前・扱い・重み・実装）は rules/same_weekday_cap.js。ここは一覧での位置だけ（以下の控えも同じ）
    { id: "oc_consecutive", group: "combo" }, // 中身は rules/oc_consecutive.js
    { id: "nonadjacent_consecutive", group: "combo" }, // 中身は rules/nonadjacent_consecutive.js
    { id: "work_gap", group: "combo" }, // 中身は rules/work_gap.js
    // ---- 休みの日 ----
    { id: "rest_day", group: "rest" }, // 中身は rules/rest_day.js
    { id: "days_off_min", group: "rest" }, // 中身は rules/days_off_min.js
    { id: "days_off_pair", group: "rest" }, // 中身は rules/days_off_pair.js
    { id: "wish_off_cap", group: "rest" }, // 中身は rules/wish_off_cap.js
    // ---- 役割とオンコール ----
    { id: "composition", group: "team" }, // 中身は rules/composition.js
    { id: "oncall", group: "team", label: "オンコールを置く（勤務者の役割に応じた {charge}OC・{junior}OC）", states: ["hard", "off"], def: "hard",
      weight: null, w0: null, sub: ["missing_young_oc"] },
    { id: "period_charge", group: "team" }, // 中身は rules/period_charge.js
    { id: "weekend_balance", group: "team" }, // 中身は rules/weekend_balance.js
    // same_day_team・same_day_charge_other（休日の役割の組合せ）は出発点の施設のプラグインへ移した（本体には無い）
    // ---- 希望と公平 ----
    { id: "wish_night", group: "wish" }, // 中身は rules/wish_night.js
    { id: "wish_weekend_dayshift", group: "wish" }, // 中身は rules/wish_weekend_dayshift.js
    { id: "avoid_days", group: "wish" }, // 中身は rules/avoid_days.js
    { id: "spread_standby", group: "wish" }, // 中身は rules/spread_standby.js
    // ---- 日中の業務との関係 ----
    { id: "duty_conflicts", group: "duty" }, // 中身は rules/duty_conflicts.js
    { id: "duty_after_night", group: "duty" }, // 中身は rules/duty_after_night.js
    // cath_requirement・arrhythmia_pre_workday_night（専門業務の必要人数・指定した人の平日夜勤回避）は出発点の施設のプラグインへ移した（本体には無い）
  ];
  RULE_DEFS_INLINE.forEach((d, i) => T.rules.register(Object.assign({ order: (i + 1) * 100 }, d))); // order はプラグインが上書きする（解く側での順）
  const RULE_DEFS = T.rules.defs, RULE_BY_ID = T.rules.byId;
  const STATE_JA = { hard: "必須", soft: "減点", off: "なし" };
  // 規則の状態を決める: rules.rule_states → 旧キー → 既定
  // プラグインの出どころ: 登録口は T.pluginSource（読み込み中のファイル名。実行時は plugins.js、組み立て時は build.py が包む）を定義に写す。
  // rules.plugins_off = [ファイル名] に入っているプラグインは、規則は「なし」、日ごとの区分とカレンダーの拡張は無いものとして扱う（確認用の付け外し。設定タブ「施設の構成を作る」の施設のプラグイン）
  T.pluginSource = T.pluginSource || null;
  const pluginOff = (rules, src) => !!src && ((rules || {}).plugins_off || []).includes(src);
  const stampSource = def => { if (T.pluginSource && !def.source) def.source = T.pluginSource; return def; };
  T.pluginOff = pluginOff; T.stampSource = stampSource;
  function ruleState(rules, id) { const def = RULE_BY_ID[id]; if (!def) return "off"; return pluginOff(rules, def.source) ? "off" : ruleStateRaw(rules, id); } // プラグインごと無効なら「なし」
  function ruleStateRaw(rules, id) { // 設定に書かれた状態（プラグインの付け外しを見ない。fillDefaultRules が rule_states に書き出すのはこちら＝無効の間も状態を覚えておく）
    const def = RULE_BY_ID[id]; if (!def) return "off";
    const rs = (rules || {}).rule_states || {}, v = rs[id];
    if (def.states.includes(v)) return v;
    for (const a of def.aliases || []) if (def.states.includes(rs[a])) return rs[a]; // 旧 id で保存された状態
    if (def.legacy && rules && rules[def.legacy] !== undefined && rules[def.legacy] !== null) return def.fromLegacy(rules[def.legacy]);
    return def.def;
  }
  // HTML エスケープ（report / app で共通。docx は XML 用に別途 制御文字も落とす）
  const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  // 当直の候補か（規則の duty: never=候補外, no_unless_needed=月の設定で許可したときだけ）。画面（app-core.js の dutyNames）と Problem が同じ判定を使う
  const isDutyCandidate = (doc, allowChief) => doc.duty !== "never" && (doc.duty !== "no_unless_needed" || !!allowChief);

  function daysInMonth(y, m) { return new Date(y, m, 0).getDate(); }
  // 「避：…」の曜日パターンを日付に展開する（平日のみ。土日祝の避けたい日はカレンダーで個別に申告する）。Problem と expandAvoid の両方が使う
  function avoidDaysFromPatterns(pats, N, dowOf, nthOf, isHoliday) {
    const out = [];
    for (const it of pats || []) {
      if (!String(it.kind).startsWith("avoid_")) continue;
      const part = it.kind.slice(6);
      for (let d = 1; d <= N; d++) { if (DOW.indexOf(it.dow) !== dowOf(d)) continue; if (isHoliday(d)) continue; if (it.nth && it.nth.length && !it.nth.map(Number).includes(nthOf(d))) continue; out.push([d, part]); }
    }
    return out;
  }

  class Problem {
    constructor(rules, month) {
      this.rules = rules; this.m = month;
      this.fridayMin = rules.friday_night_min || rules.friday_night_exact || {};
      // 将来変わりうる必須条件（設定タブで変更できる）
      this.shifts = normalizeShifts(rules); // 勤務帯（id・表示名・どの日に枠があるか）
      this.roles = normalizeRoles(rules); // 役割（識別子・表示名・機能）
      this.roleIds = this.roles.map(r => r.id);
      this.roleOfRef = {}; for (const r of ROLE_REFS) { const x = this.roles.find(o => o.refs.includes(r)); this.roleOfRef[r] = x ? x.id : null; }
      this.standbyRoleIds = this.roles.filter(r => r.standby).map(r => r.id);
      // 連勤（run_length）と勤務帯のつながり（forbid_sequence）のパラメータ
      const rl = rules.run_length || {};
      this.runMax = Math.max(1, +(rl.max ?? 5) || 5); // 何日まで続けてよいか
      this.runExempt = String(rl.exempt_qual || "").split(/[・|,、]+/).map(x => x.trim()).filter(Boolean); // 連勤の規則の対象外にする資格（例: 平日に続けて勤務する師長）
      this.runMin = Math.max(2, +(rl.min ?? 3) || 3); // 続けるなら何日以上か
      this.seqRules = [].concat(rules.forbid_sequence || []).map(x => ({
        from: x && x.from ? String(x.from) : "night",
        to: x && x.to ? String(x.to) : "any", // "any" はその日のすべての勤務帯
      }));
      if (!this.seqRules.length) this.seqRules = [{ from: "night", to: "any" }]; // 既定は「夜勤の翌日は勤務なし」＝明け休み
      // 休みの日数（days_off）と希望休の上限（wish_off）
      const doff = rules.days_off || {}, woff = rules.wish_off || {};
      this.pairMin = Math.max(0, Math.round(+(doff.pair_min ?? 1)) || 0); // 月に何回の 2 連休を作るか
      this.offBasis = doff.basis === "holidays" ? "holidays" : "hours"; // 休みの日数の決め方: hours=労働時間から / holidays=その月の土日祝の数
      this.offExact = doff.mode === "exact"; // 休みの日数を「ちょうど」にする（既定は「以上」）
      this.akeIsOff = doff.ake_is_off !== false; // 夜勤の翌日（明け）を休みに数えるか（2 交代の病棟では数えない）
      this.pairRuns = doff.pair_count === "runs"; // 2 連休の数え方: runs=続いた休みを 1 回（3 連休も 1 回）／既定=続く 2 日の組の数（3 連休は 2 回）
      // 構成の規則（composition）: 勤務帯の枠ごとに、条件に合う人の人数の下限・上限。条件は経験年数（何年目か）と資格
      this.comp = (Array.isArray(rules.composition) ? rules.composition : []).map((c, i) => ({
        i, shift: ["day", "night"].includes(c.shift) ? c.shift : "all", days: ["weekdays", "off_days"].includes(c.days) || /^flag:./.test(String(c.days || "")) ? c.days : "all", label: c.label || "", // flag:<id> = 日ごとの区分が付いた日だけ
        ymin: c.years_min === "" || c.years_min == null ? null : +c.years_min, ymax: c.years_max === "" || c.years_max == null ? null : +c.years_max,
        // 資格は「・」や「|」で区切ると「どれか 1 つを持つ（持たない）」の意味。例: "管理者・リーダー"
        qual: c.qual ? String(c.qual) : "", notQual: c.not_qual ? String(c.not_qual) : "",
        quals: String(c.qual || "").split(/[・|,、]+/).map(x => x.trim()).filter(Boolean), notQuals: String(c.not_qual || "").split(/[・|,、]+/).map(x => x.trim()).filter(Boolean),
        min: c.min === "" || c.min == null ? null : Math.max(0, +c.min), max: c.max === "" || c.max == null ? null : Math.max(0, +c.max),
      })).filter(c => c.min != null || c.max != null);
      this.wishOffMax = Math.max(0, Math.round(+(woff.max ?? 3)) || 0); // 1 人が申告できる希望休の上限（日）
      this.wishOffCounts = ["unavailable", "avoid", "both"].includes(woff.counts) ? woff.counts : "both"; // 何を希望休として数えるか
      this.multi = SHIFT_IDS.some(k => workerCount(rules, k, true) > 1 || workerCount(rules, k, false) > 1); // 1 枠に複数名を置く施設か
      this.ruleStates = {}; for (const def of RULE_DEFS) this.ruleStates[def.id] = ruleState(rules, def.id); // 規則の状態（必須/減点/なし）
      this.restDayRequired = this.ruleStates.rest_day === "hard"; // 外勤のある医師に週休日を月1日以上（必須のときだけ）
      this.pmExtNight = rules.pm_external_night || "confirm"; // 午後外勤日の夜勤・夜間OC: confirm / forbid / allow
      this.sameDayChargeOtherBanned = this.ruleStates.same_day_charge_other === "hard"; // 休日の日勤と夜勤が期間責任者＋対の役割（必須のときだけ禁止） // 金曜夜勤の最低回数（旧名 friday_night_exact＝ちょうど n 回 も最低回数として読む）
      this.year = +month.year; this.month = +month.month;
      this.N = daysInMonth(this.year, this.month);
      this.minDaysOff = minDaysOff(rules, this.N); // 月の休みの日数（暦の日数から決まる。決め方が「土日祝の数」なら buildCalendar で置き換える）
      this.holidaysExtra = new Set((month.holidays || []).map(Number));
      // カテ室配置が不要な日（カテ0件確定。学会など）。副担当・主担当で別に設定（旧 cath_off_days は両方に適用）
      const legacyOff = (month.cath_off_days || []).map(Number);
      this.cathOffA = new Set([...legacyOff, ...(month.cath_off_days_A || []).map(Number)]);
      this.cathOffI = new Set([...legacyOff, ...(month.cath_off_days_I || []).map(Number)]);
      // 規則の正規化: 欠けている項目は既定で補う（設定の JSON 直接編集や古い保存データでも落ちないように）
      // オンコール構成: 勤務者の役割ごとに「どの役割を何人」。行も列も役割の識別子（既定は I/A/Y/C）
      this.cathReq = {}; for (const w of DOW.slice(0, 5)) this.cathReq[w] = Object.assign({}, DEFAULT_CATH_REQ, (rules.cath_requirement || {})[w] || {});
      if (this.multi) { // 1 枠に複数名を置く施設では、勤務者のチームで人数が決まる仕組み（OC 構成・期間責任者）はまだ使えない
        const ng = [];
        if (this.ruleStates.oncall !== "off") ng.push("オンコール（oncall）");
        if (this.ruleStates.period_charge !== "off") ng.push("期間責任者（period_charge）");
        if ((this.ruleStates.same_day_team || "off") !== "off") ng.push("同日のチーム集約（same_day_team）"); // プラグインが無ければ登録も無い
        if (ng.length) throw new Error((T.t || (x => x))("1 枠に複数名を置く設定では {list} を「なし」にしてください（勤務者が 1 名である前提の規則です）", { list: ng.join(T.nameSep ? T.nameSep() : "・") }));
      }
      this.dutiesOnHolidays = !!month.duties_on_holidays;
      this.nextFirstHoliday = !!month.next_month_first_day_is_holiday;

      this.doctors = {}; this.names = [];
      for (const d of rules.doctors) { this.doctors[d.name] = d; this.names.push(d.name); }
      this.team = {}; for (const n of this.names) this.team[n] = this.doctors[n].team;
      this.allowChief = !!month.allow_chief_duty;
      this.dutyNames = this.names.filter(n => this.dutyAllowed(n));
      this.nameOrder = [...new Set([...(rules.name_order || []).filter(n => this.doctors[n]), ...this.dutyNames])]; // 表示順（名簿にない名前は無視、無い候補は末尾）
      this.byRole = {}; for (const id of this.roleIds) this.byRole[id] = this.dutyNames.filter(n => this.team[n] === id);
      // 規則が使う別名（役割の機能から引く。既定のプロファイルでは I / A / Y そのもの）
      this.I = this.byRole[this.roleOfRef.charge] || [];
      this.A = this.byRole[this.roleOfRef.other] || [];
      this.Y = this.byRole[this.roleOfRef.junior] || [];
      this.standbyNames = this.dutyNames.filter(n => this.standbyRoleIds.includes(this.team[n]));
      this.ocReq = {};
      for (const id of this.roleIds) {
        const row = Object.assign({}, DEFAULT_OC_REQ[id] || {}, (rules.oncall_requirement || {})[id] || {});
        const r = {}; for (const sid of this.standbyRoleIds) r[sid] = +(row[sid] || 0);
        this.ocReq[id] = r;
      }
      if (this.ruleStates.oncall === "off") for (const t of Object.keys(this.ocReq)) for (const sid of Object.keys(this.ocReq[t])) this.ocReq[t][sid] = 0; // オンコールを置かない施設
      this.ocReqNone = Object.fromEntries(Object.entries(this.ocReq).map(([t, r]) => [t, Object.fromEntries(Object.keys(r).map(k => [k, 0]))])); // オンコールを付けない勤務帯の枠
      this.cathA = this.names.filter(n => this.doctors[n].cath === "A");
      this.cathI = this.names.filter(n => this.doctors[n].cath === "I");

      // 勤務回数の目安の決め方: absolute=名簿の quota（月◯回）／share=名簿の比重 share でその月の必要な延べ人数を按分（buildCalendar の後で計算）
      this.quotaMode = ((rules.profile || {}).quota_mode === "share") ? "share" : "absolute";
      this.shareQuotas = null; this.targets = {};
      this.tol = +(rules.quota_tolerance ?? 1);

      this.duties = {}; for (const n of this.names) this.duties[n] = (month.regular_duties || {})[n] || [];
      this.dutyDays = month.duty_days && typeof month.duty_days === "object" ? month.duty_days : null;
      this.unavailNight = {}; for (const [n, v] of Object.entries(month.unavailable_night || {})) this.unavailNight[n] = new Set((v || []).map(Number));
      this.unavailOther = {}; for (const u of month.unavailable_other || []) { (this.unavailOther[u.name] ||= []).push([+u.day, u.part]); }
      // 有給（カレンダーの印）: その日は勤務に入らず（不可：日夜両方と同じ）、休みの日数にその分を足す
      this.paidDays = {}; for (const u of month.unavailable_other || []) if (u.paid && +u.day >= 1) (this.paidDays[u.name] ||= new Set()).add(+u.day);
      this.confirmedPmExtNight = new Set((month.confirmed_pm_external_night || []).map(x => `${+x.day}:${x.name}`));

      const w = month.wishes || {};
      this.wishWeekendDay = [...(w.weekend_dayshift || [])];
      this.wishNight = {}; for (const [n, v] of Object.entries(w.night_on || {})) this.wishNight[n] = (v || []).map(Number);
      this.wishDay = {}; for (const [n, v] of Object.entries(w.day_on || {})) this.wishDay[n] = (v || []).map(Number); // 日勤の希望（2 交代など日勤の枠がある施設。規則 wish_day）
      // できれば避けたい日（調整目標）: [日, 時間帯 allday/day/night]。不可とは別で、勤務・OCを減点で避ける
      this.avoid = {}; for (const u of month.avoid || []) { if (!u || !u.name) continue; (this.avoid[u.name] ||= []).push([+(u.day ?? u.date), u.part || "allday"]); }
      // 曜日パターン運用（duty_days なし）のときは「避：…」パターンをここで展開する（カレンダー運用ではカレンダーの申告が正。Python と同じ扱い）
      if (!this.dutyDays) for (const n of this.names) { const seen = new Set((this.avoid[n] || []).map(([d, p]) => `${d}|${p}`)); for (const [d, p] of avoidDaysFromPatterns(this.duties[n], this.N, x => this.dow(x), x => this.nth(x), x => this.isHoliday(x))) if (!seen.has(`${d}|${p}`)) { (this.avoid[n] ||= []).push([d, p]); seen.add(`${d}|${p}`); } }

      const f = month.fixed || {};
      const inM = k => +k >= 1 && +k <= this.N; // 当月の日だけ（翌月1日欄の固定は nextFixed に分ける）
      // 勤務者の固定は 1 枠に複数名を書ける（保存形: 1 名なら文字列、複数なら配列）。内部では常に配列（空は落とす）
      const namesOf = v => [].concat(v || []).filter(x => typeof x === "string" && x);
      this.fixedNight = {}; for (const [k, v] of Object.entries(f.night || {})) if (inM(k) && namesOf(v).length) this.fixedNight[+k] = namesOf(v);
      this.fixedDay = {}; for (const [k, v] of Object.entries(f.day || {})) if (inM(k) && namesOf(v).length) this.fixedDay[+k] = namesOf(v);
      this.fixedCharge = {}; for (const [k, v] of Object.entries(f.weekend_charge || {})) if (inM(k)) this.fixedCharge[+k] = v;
      // 日ごとの区分と予定（month.day_flags = {日: [id]}、month.day_notes = {日: 文}）。区分の種類は T.dayFlags に登録したもの
      this.dayFlags = {}; for (const [k, v] of Object.entries(month.day_flags || {})) if (+k >= 1 && +k <= this.N) { const ids = [].concat(v || []).filter(x => typeof x === "string" && x); if (ids.length) this.dayFlags[+k] = ids; }
      this.dayNotes = {}; for (const [k, v] of Object.entries(month.day_notes || {})) if (+k >= 1 && +k <= this.N && typeof v === "string" && v.trim()) this.dayNotes[+k] = v.trim();
      this.personDays = month.person_days && typeof month.person_days === "object" ? month.person_days : {}; // 職員別カレンダーの拡張の欄の値 {id: {氏名: {日: 値}}}
      // 固定の印（month.fixed_tags: "日:勤務帯|名前" → "研修" など）。固定した理由を勤務表・説明資料に名前の後ろに出す
      this.fixedTags = {}; for (const [k, v] of Object.entries(month.fixed_tags || {})) if (typeof v === "string" && v.trim()) this.fixedTags[k] = v.trim();
      // 固定「若手OCなし」など: その枠に指定チームのOCを追加しない（キー "日:枠" → チームの集合）
      this.fixedOcNone = {}; for (const [tbl, kind] of [["day_oc_none", "day"], ["night_oc_none", "night"]]) for (const [k, v] of Object.entries(f[tbl] || {})) if (inM(k) && [].concat(v || []).length) this.fixedOcNone[`${+k}:${kind}`] = new Set([].concat(v));
      this.fixedDayOc = {}; for (const [k, v] of Object.entries(f.day_oc || {})) if (inM(k)) this.fixedDayOc[+k] = [].concat(v || []);
      this.fixedNightOc = {}; for (const [k, v] of Object.entries(f.night_oc || {})) if (inM(k)) this.fixedNightOc[+k] = [].concat(v || []);
      // 翌月1日の固定（カレンダーの翌月1日欄）。当月の計算では月末との連続禁止と月またぎの土日の主担当担当の接続に使い、翌月作成時に1日の固定として引き継ぐ
      const nk = String(this.N + 1);
      this.nextFixed = { day: namesOf((f.day || {})[nk]), night: namesOf((f.night || {})[nk]), charge: (f.weekend_charge || {})[nk] || null, day_oc: [].concat((f.day_oc || {})[nk] || []), night_oc: [].concat((f.night_oc || {})[nk] || []) };
      // 固定指定の集合。固定した枠・医師については、不可・連続禁止・定期業務の翌日制約などの必須条件を緩める（減点付き）
      this.fixedWorkKeys = new Set(); this.fixedEngKeys = new Set();
      for (const [d, ns] of Object.entries(this.fixedNight)) for (const n of ns) { this.fixedWorkKeys.add(`${d}:night|${n}`); this.fixedEngKeys.add(`${d}:night|${n}`); }
      for (const [d, ns] of Object.entries(this.fixedDay)) for (const n of ns) { this.fixedWorkKeys.add(`${d}:day|${n}`); this.fixedEngKeys.add(`${d}:day|${n}`); }
      for (const [d, ns] of Object.entries(this.fixedDayOc)) for (const n of ns) this.fixedEngKeys.add(`${d}:day|${n}`);
      for (const [d, ns] of Object.entries(this.fixedNightOc)) for (const n of ns) this.fixedEngKeys.add(`${d}:night|${n}`);
      for (const [d, n] of Object.entries(this.fixedCharge)) { this.fixedEngKeys.add(`${d}:day|${n}`); this.fixedEngKeys.add(`${d}:night|${n}`); }

      const ex = month.exceptions || {};
      this.weekendMaxDiff = +(ex.weekend_balance_max_diff ?? rules.weekend_balance_max_diff ?? 1);

      const pm = month.prev_month || {};
      this.prevLastDays = pm.last_days || [];
      this.prevLastWeekendCharge = pm.last_weekend_charge || null;
      this.prevPrevWeekendCharge = pm.prev_weekend_charge || null;
      const h = month.history || {};
      this.histWeekend = {}; for (const [n, v] of Object.entries(h.weekend_charge || {})) this.histWeekend[n] = +v;
      this.histHoliday = {}; for (const [n, v] of Object.entries(h.holiday_charge || {})) this.histHoliday[n] = +v;

      // 重み: 配布時の既定（T.DEFAULT_RULES）を規則の値で上書き。ソルバー側に既定値は持たない
      this.weights = Object.assign({}, (T.DEFAULT_RULES || {}).weights || {}, rules.weights || {});
      // 「なし」にした規則の重みは 0 にする（その規則の内側でだけ使う重み sub も同じ）。
      // ソルバーの objAdd は 0 の項を作らないので、これだけでその規則の減点は消える（式の生成自体も主な規則では省く）
      for (const def of RULE_DEFS) if (this.ruleStates[def.id] === "off") for (const k of [def.weight].concat(def.sub || [])) if (k) this.weights[k] = 0;
      this.buildCalendar();
      // 目安（P.quota）と当月の目標（P.targets。月の設定の targets で上書き）。相対のときは枠の数から按分するので暦の後
      if (this.quotaMode === "share") this.shareQuotas = shareQuotas(this);
      for (const n of this.names) this.targets[n] = this.quota(n);
      for (const [n, t] of Object.entries(month.targets || {})) this.targets[n] = +t;
      this.prm = {}; for (const def of RULE_DEFS) if (def.read) this.prm[def.id] = def.read(this, rules); // プラグインごとの値（docs/rule-modules.md §4）
    }

    dutyAllowed(n) { return isDutyCandidate(this.doctors[n], this.allowChief); }
    // 履歴込み週末担当の上限（整数変数の範囲に使う。履歴は組数なので日数換算で2倍）
    histWeekendBound() { const h = Object.values(this.histWeekend).map(Number).filter(x => !isNaN(x)); return 2 * Math.max(0, ...h) + 2 * (this.periods || []).length + 4; }
    date(d) { return new Date(this.year, this.month - 1, d); }
    dow(d) { return (this.date(d).getDay() + 6) % 7; } // Mon=0
    isWeekend(d) { return this.dow(d) >= 5; }
    quota(n) { return this.quotaMode === "share" ? +((this.shareQuotas || {})[n] || 0) : +(this.doctors[n] || {}).quota || 0; } // 勤務回数の目安（月）
    countOf(s) { return workerCount(this.rules, s[1], this.isHoliday(s[0])); } // その枠に置く勤務者の人数（幅があるときは上限）
    countMinOf(s) { return workerCount(this.rules, s[1], this.isHoliday(s[0]), true); } // その枠に置く勤務者の人数の下限（幅が無ければ countOf と同じ）
    // その枠の人数の理想値（positions.work.ideal。書いていなければ null）。下限〜上限に収める。ずれは規則 count_target で減点
    countIdealOf(s) { const c = (((this.rules || {}).profile || {}).positions || {}).work, iv = c && c.ideal; if (iv === undefined || iv === null) return null;
      // その勤務帯（または日の種別）に書いていなければ理想値なし（人数の読み取りの「書いていなければ 1 人」は使わない）
      if (typeof iv === "object" && iv[s[1]] === undefined && iv[this.isHoliday(s[0]) ? "off_days" : "weekday"] === undefined) return null;
      const v = workerCount({ profile: { positions: { work: { count: iv } } } }, s[1], this.isHoliday(s[0])); return Math.max(this.countMinOf(s), Math.min(this.countOf(s), v)); }
    maxCount() { return Math.max(1, ...this.slots.map(s => this.countOf(s))); }
    shiftOn(sh, d) { return sh.on === "none" ? false : sh.on === "all" ? true : sh.on === "weekdays" ? !this.isHoliday(d) : this.isHoliday(d); } // none=計算で決めない（枠を作らない）
    slotExists(d, kind) { return this.slotSet ? this.slotSet.has(`${d}:${kind}`) : (kind === "night" || this.isHoliday(d)); } // その日にその勤務帯の枠があるか
    // a〜b 日のどこかに「終日の不可」があるか（連勤の下限の減点から外すため）
    unavailAllDayAny(n, a, b) {
      for (let d = Math.max(1, a); d <= Math.min(this.N, b); d++) {
        if ((this.unavailOther[n] || []).some(([dd, pp]) => dd === d && pp === "allday")) return true;
        const un = this.unavailNight[n]; const night = un ? (un.has ? un.has(d) : [].concat(un).includes(d)) : false;
        if (night && (this.unavailOther[n] || []).some(([dd, pp]) => dd === d && pp === "day")) return true;
      }
      return false;
    }
    // 希望休として数える申告の日（規則 wish_off_cap。不可・避けたい日のどちらを数えるかは wish_off.counts）
    wishOffDays(n) {
      const out = new Set();
      if (this.wishOffCounts !== "avoid") {
        for (const d of this.unavailNight[n] || []) if (d >= 1 && d <= this.N) out.add(+d);
        for (const [d] of this.unavailOther[n] || []) if (d >= 1 && d <= this.N) out.add(+d);
      }
      if (this.wishOffCounts !== "unavailable") for (const [d] of this.avoid[n] || []) if (d >= 1 && d <= this.N) out.add(+d);
      return [...out].sort((a, b) => a - b);
    }
    isRole(n, ref) { const id = this.roleOfRef[ref]; return !!id && this.team[n] === id; } // その人の役割が機能 ref を持つか
    refId(ref) { return this.roleOfRef[ref]; } // 機能に割り当てられた役割の識別子
    isStandby(n) { return this.standbyRoleIds.includes(this.team[n]); } // オンコールに入れる役割か
    roleLabel(id) { const r = (this.roles || []).find(x => x.id === id); return r ? r.label : id; }
    // 前月の最終日（d=0）がその人の休みだったと分かるか（前月末の接続にその日があり、勤務も明けも無い）。2 連休を「続いた休みで 1 回」と数えるときに使う
    prevOffDay0(n) { const prevN = new Date(this.year, this.month - 1, 0).getDate(); if (!this.prevLastDays.some(e => +e.date === prevN)) return false;
      if (["day", "night"].some(k => this.prevWorked([0, k], n))) return false; return this.akeIsOff || !this.prevWorked([-1, "night"], n); }
    // 連勤の規則（上限・下限）をその人に当てはめるか（対象外の資格を持つ人は外す）
    runApplies(n) { if (this.isFixedOnly(n)) return false; const q = [].concat((this.doctors[n] || {}).quals || []); return !this.runExempt.some(x => q.includes(x)); } // 「固定したときだけ」の人の並びは固定で決まるので連勤の規則は当てはめない
    // 前月末の枠でその人が勤務したか（勤務者は 1 名なら文字列、複数名なら配列）
    prevWorked(s, n) { const w = (this.prevFixed[`${s[0]}:${s[1]}`] || {}).work; return Array.isArray(w) ? w.includes(n) : w === n; }
    // 構成の規則の条件に合う人か（経験年数は「何年目か」。資格は名簿の quals）
    compMatch(c, n) { const d = this.doctors[n] || {}, y = +(d.years || 0), q = [].concat(d.quals || []);
      return (c.ymin == null || y >= c.ymin) && (c.ymax == null || y <= c.ymax) && (!c.quals.length || c.quals.some(x => q.includes(x))) && !c.notQuals.some(x => q.includes(x)); }
    // その勤務帯に入りうる人か（構成の規則で、すべての日に「最大 0 人」とされた条件に当たる人は入れない）。回数の偏りはこの人たちの間で見る
    shiftEligible(n, kind) { return this.ruleStates.composition === "off" || !this.comp.some(c => c.max === 0 && c.days === "all" && (c.shift === "all" || c.shift === kind) && this.compMatch(c, n)); }
    compOn(c, s) { return (c.shift === "all" || c.shift === s[1]) && (c.days === "all" || (/^flag:/.test(c.days) ? this.dayHas(s[0], c.days.slice(5)) : (c.days === "weekdays") === !this.isHoliday(s[0]))); } // 勤務帯と日（すべて／平日だけ／土日祝だけ／日ごとの区分が付いた日） // 勤務帯と日の種別（すべて／平日だけ／土日祝だけ）
    // 構成の規則の条件を文にする（名前を付けていればその名前）
    compLabel(c) {
      if (c.label) return c.label;
      const t = (s, v) => T.t ? T.t(s, v) : s.replace(/\{(\w+)\}/g, (_, k) => v[k]), parts = [];
      if (c.ymin != null && c.ymax != null) parts.push(t("{a}〜{b}年目", { a: c.ymin, b: c.ymax }));
      else if (c.ymin != null) parts.push(t("{a}年目以上", { a: c.ymin })); else if (c.ymax != null) parts.push(t("{b}年目以下", { b: c.ymax }));
      if (c.quals.length) parts.push(t(c.quals.length > 1 ? "資格「{q}」のどれか" : "資格「{q}」あり", { q: c.quals.join("・") }));
      if (c.notQuals.length) parts.push(t("資格「{q}」なし", { q: c.notQuals.join("・") }));
      return parts.join(T.listSep ? T.listSep() : "・") || t("全員", {});
    }
    // その人の休みの日数（ちょうど／以上の基準）: 土日祝の数（または労働時間から）＋有給の日数
    offTarget(n) { return this.minDaysOff + ((this.paidDays || {})[n] ? [...this.paidDays[n]].filter(d => d <= this.N).length : 0); }
    // その枠で勤務者の役割ごとに必要なオンコール（勤務帯がオンコールを付けないなら全員 0）。解く側・検算・減点・説明資料が同じものを使う
    ocReqAt(s) { const sh = (this.shifts || []).find(x => x.id === s[1]); return !sh || sh.oncall !== false ? this.ocReq : this.ocReqNone; }
    shiftHasOncall(kind) { const sh = (this.shifts || []).find(x => x.id === kind); return this.ruleStates.oncall !== "off" && (!sh || sh.oncall !== false); }
    shiftLabel(kind) { const sh = (this.shifts || []).find(x => x.id === kind); return sh ? sh.label : (kind === "day" ? "日勤" : "夜勤"); }
    isHoliday(d) { if (d < 1) return this.dow(d) >= 5; return this.isWeekend(d) || this.holidaysExtra.has(d); }
    nth(d) { return Math.floor((d - 1) / 7) + 1; }
    nextIsHoliday(d) { return d + 1 <= this.N ? this.isHoliday(d + 1) : this.nextDayIsHoliday(); } // 月末は翌月1日（土日も休日）
    state(id) { return this.ruleStates[id] || "off"; } // 規則の状態（"hard" / "soft" / "off"）
    on(id) { return this.state(id) !== "off"; } // 適用する規則か（「なし」でない）
    term(s) { return term(s, this.rules); } // 文面の {charge} などを施設の役割名に置き換える
    msg(code, args) { return T.msg ? T.msg(code, args, this.rules) : code; } // 違反・入力チェックの文面（messages.js）
    isHard(id) { return this.state(id) === "hard"; }
    isSoft(id) { return this.state(id) === "soft"; }
    softW(id) { const def = RULE_BY_ID[id]; return this.weights[def.weight]; } // 「減点」のときの重み（fillDefaultRules が必ず入れる）
    preWorkdayNights() { const out = []; for (let d = 1; d <= this.N; d++) if (!this.isHoliday(d) && !this.nextIsHoliday(d)) out.push(d); return out; }
    // 前月の日（前月末の接続で d ≤ 0）の表示。例: 10/31(土)
    dowLabel(d) { return T.dowLabel ? T.dowLabel(this.dow(d)) : DOW_JA[this.dow(d)]; }
    labelPrev(d) { const prevN = new Date(this.year, this.month - 1, 0).getDate(); const pm = this.month === 1 ? 12 : this.month - 1; return `${pm}/${prevN + d}(${this.dowLabel(d)})`; }
    label(d) { if (d === this.N + 1) return this.nextLabel(); if (d < 1) return this.labelPrev(d); let s = `${this.month}/${d}(${this.dowLabel(d)}`; if (this.holidaysExtra.has(d)) s += (this.m.closure_days || []).map(Number).includes(d) ? T.t("・休") : T.t("・祝"); return s + ")"; }
    static key(s) { return `${s[0]}:${s[1]}`; }

    buildCalendar() {
      this.slots = [];
      for (let d = 1; d <= this.N; d++) for (const sh of this.shifts) if (this.shiftOn(sh, d)) this.slots.push([d, sh.id]);
      this.slotSet = new Set(this.slots.map(Problem.key));
      this.prevFixed = {};
      const prevN = new Date(this.year, this.month - 1, 0).getDate();
      for (const e of this.prevLastDays) {
        const off = +e.date - prevN;
        const ok = v => Array.isArray(v) ? v.filter(Boolean).length > 0 : !!v;
        if (ok(e.day)) this.prevFixed[`${off}:day`] = { work: e.day, oc: [...(e.day_oc || [])] };
        if (ok(e.night)) this.prevFixed[`${off}:night`] = { work: e.night, oc: [...(e.night_oc || [])] };
      }
      if (this.offBasis === "holidays") { let c = 0; for (let d = 1; d <= this.N; d++) if (this.isHoliday(d)) c++; this.minDaysOff = c; } // その月の土日祝の数
      this.prevSlots = Object.keys(this.prevFixed).map(k => { const [d, kind] = k.split(":"); return [+d, kind]; })
        .sort((a, b) => a[0] - b[0] || (a[1] === "day" ? -1 : 1));
      this.allSlots = this.prevSlots.concat(this.slots);
      this.allSlotSet = new Set(this.allSlots.map(Problem.key));

      this.periods = []; const used = new Set();
      for (let d = 1; d <= this.N; d++) {
        if (used.has(d)) continue;
        const w = this.dow(d); let p = null;
        if (w === 5) { const days = [d].concat(d + 1 <= this.N ? [d + 1] : []); p = { days, kind: "weekend", full: days.length === 2, crossing: days.length === 1, prevDays: [] }; }
        else if (w === 6) { p = { days: [d], kind: "weekend", full: false, crossing: true, prevDays: this.dow(0) === 5 ? [0] : [] }; }
        else if (this.isHoliday(d)) { p = { days: [d], kind: "holiday", full: false, crossing: false, prevDays: [] }; }
        else continue;
        this.periods.push(p); p.days.forEach(x => used.add(x));
      }
      this.periodOfSlot = {};
      this.periods.forEach((p, i) => {
        p.id = i; p.slots = this.slots.filter(s => p.days.includes(s[0]));
        // 期間の呼び名は表示のたびに組み立てる（言語を切り替えたときに Problem を作り直さなくても追随する）
        const mo = this.month;
        Object.defineProperty(p, "name", { enumerable: true, get() {
          const base = p.kind === "weekend" ? p.days.map(x => `${mo}/${x}`).join("-") : `${mo}/${p.days[0]}${T.t("（祝）")}`;
          return (p.crossing && p.prevDays.length ? T.t("前月末-") : "") + base;
        } });
        for (const s of p.slots) this.periodOfSlot[Problem.key(s)] = i;
        for (const pd of p.prevDays) for (const k of ["day", "night"]) this.periodOfSlot[`${pd}:${k}`] = i;
      });
    }

    dutyItems(n, d, part, kinds = ["outpatient", "ward", "external"]) {
      if (d === this.N + 1) return this.nextMonthItems(n, part, kinds); // 翌月1日（第7節: 月末夜間担当の翌日の制限には翌月の定期業務を使う）
      if (d < 1 || d > this.N) return [];
      // 日別モード（duty_days がある月）: カレンダーで置いた値をそのまま使う
      if (this.dutyDays) {
        const e = (this.dutyDays[n] || {})[d] || {};
        const k = e[part];
        return (k && kinds.includes(k)) ? [{ kind: k, part }] : [];
      }
      if (this.isHoliday(d) && !this.dutiesOnHolidays) return [];
      const out = [];
      for (const it of this.duties[n] || []) {
        if (!kinds.includes(it.kind)) continue;
        if (DOW.indexOf(it.dow) !== this.dow(d)) continue;
        if (it.nth && it.nth.length && !it.nth.map(Number).includes(this.nth(d))) continue;
        if (!PARTS[it.part || "full"].includes(part)) continue;
        out.push(it);
      }
      return out;
    }
    busy(n, d, part, kinds) { return this.dutyItems(n, d, part, kinds).length > 0; }
    // できれば避けたい日に該当する枠
    avoidSlots(n) { const out = []; for (const [d, part] of this.avoid[n] || []) { if (d < 1 || d > this.N) continue; if (part !== "night" && this.slotExists(d, "day")) out.push([d, "day"]); if (part !== "day" && this.slotExists(d, "night")) out.push([d, "night"]); } return out; } // 枠がある日だけ（2 交代の平日日勤も対象）
    // 翌月1日の定期業務。翌月の実データは持たないので、曜日パターン（無ければ当月カレンダーからの推定）を翌月の第1週として当てる
    nextMonthPatterns() {
      if (this._nextPats) return this._nextPats;
      const out = {}; let inferred = null;
      for (const n of this.names) { let p = this.duties[n] || []; if (!p.length && this.dutyDays) { inferred ||= inferPatterns(this.rules, this.m); p = inferred[n] || []; } out[n] = p; }
      return (this._nextPats = out);
    }
    // カレンダーを翌月1日まで伸ばした月データでは、その欄が正（空欄＝業務なし）。伸ばす前のデータは曜日パターンから推定
    nextMonthItems(n, part, kinds = ["outpatient", "ward", "external"]) {
      if (this.dutyDays && this.m.next_first_day_in_calendar) { const e = (this.dutyDays[n] || {})[this.N + 1] || {}; const k = e[part]; return k && kinds.includes(k) ? [{ kind: k, part }] : []; }
      return this.estimateNextMonthItems(n, part, kinds);
    }
    estimateNextMonthItems(n, part, kinds = ["outpatient", "ward", "external"]) {
      if (this.nextDayIsHoliday() && !this.dutiesOnHolidays) return []; // 翌月1日が土日祝なら定期業務なし
      const w = (this.dow(this.N) + 1) % 7, out = [];
      for (const it of this.nextMonthPatterns()[n] || []) {
        if (!kinds.includes(it.kind)) continue;
        if (DOW.indexOf(it.dow) !== w) continue;
        if (it.nth && it.nth.length && !it.nth.map(Number).includes(1)) continue;
        if (!PARTS[it.part || "full"].includes(part)) continue;
        out.push(it);
      }
      return out;
    }
    isFixedWork(s, n) { return this.fixedWorkKeys.has(`${s[0]}:${s[1]}|${n}`); }
    isFixedEng(s, n) { return this.fixedEngKeys.has(`${s[0]}:${s[1]}|${n}`); }
    isFixedOnly(n) { return (this.doctors[n] || {}).duty === "fixed_only"; } // 名簿の当番の欄が「固定したときだけ」（師長など。固定した枠にだけ入る）
    isExempt(n) { return this.isRole(n, "reserve") || this.isFixedOnly(n); } // 回数・休み・偏りの規則を当てはめない人（予備の役割と「固定したときだけ」の人）
    fixedWorkCount(n) { let c = 0; for (const k of this.fixedWorkKeys) if (k.endsWith("|" + n)) c++; return c; }
    nextDayIsHoliday() { return ((this.dow(this.N) + 1) % 7) >= 5 || this.nextFirstHoliday; }
    nextFirstSlotKind() { return this.nextDayIsHoliday() ? "day" : "night"; } // 翌月1日の最初の枠（月末の夜勤に隣接する枠）
    pmExtNightBanned(d, n) { return this.pmExtNight === "forbid" || (this.pmExtNight !== "allow" && !this.confirmedPmExtNight.has(`${d}:${n}`)); } // 午後外勤日の夜勤・夜間OCを禁止するか
    ocNone(s, team) { const x = this.fixedOcNone[`${s[0]}:${s[1]}`]; return !!(x && x.has(team)); } // その枠で team の OC を置かない固定があるか
    nextFixedWorks(n) { const x = this.nextFixed; return x.day.includes(n) || x.night.includes(n); }
    fixedWorkersOf(s) { return (s[1] === "night" ? this.fixedNight : this.fixedDay)[s[0]] || []; } // その枠に固定した勤務者（配列）
    fixedTag(s, n) { return this.fixedTags[`${s[0]}:${s[1]}|${n}`] || ""; } // 固定の印（研修・会議など）
    dayHas(d, id) { return (this.dayFlags[d] || []).includes(id); } // その日に区分 id が付いているか
    daysWith(id) { return Object.keys(this.dayFlags).map(Number).filter(d => this.dayHas(d, id)).sort((a, b) => a - b); }
    dayNote(d) { return this.dayNotes[d] || ""; }
    personDay(id, n, d) { const v = ((this.personDays[id] || {})[n] || {})[d]; return v == null ? "" : v; } // 職員別カレンダーの拡張の欄の値
    nameWithTag(s, n) { const t = this.fixedTag(s, n); return t ? `${n}(${t})` : n; } // 表示用: 名前(印)
    nextFixedEngaged(n, k) { const x = this.nextFixed; if (x.charge === n) return true; return k === "day" ? (x.day.includes(n) || x.day_oc.includes(n)) : (x.night.includes(n) || x.night_oc.includes(n)); }
    nextFixedAny() { const x = this.nextFixed; return !!(x.day.length || x.night.length || x.charge || x.day_oc.length || x.night_oc.length); }
    lastCrossingPeriod() { const p = this.periods[this.periods.length - 1]; return p && p.kind === "weekend" && p.crossing && !p.prevDays.length && p.days.includes(this.N) ? p : null; } // 月末が土曜で翌月1日へ続く土日
    nextLabel() { const w = (this.dow(this.N) + 1) % 7; return `${this.month === 12 ? 1 : this.month + 1}/1(${T.dowLabel ? T.dowLabel(w) : DOW_JA[w]}${this.nextFirstHoliday && w < 5 ? T.t("・祝") : ""})`; }
    hasExternal(n) { for (let d = 1; d <= this.N; d++) for (const p of ["am", "pm"]) if (this.busy(n, d, p, ["external"])) return true; return false; }
    leave(n, d, part) {
      for (const [dd, pp] of this.unavailOther[n] || []) if (dd === d && (pp === "allday" || (pp === "day" && ["am", "pm", "day"].includes(part)))) return true;
      return false;
    }
  }

  // 曜日パターン（regular_duties）を日別（duty_days）に展開する。names を省略すると全員
  function expandDuties(rules, month, names = null) {
    const m = Object.assign({}, month); delete m.duty_days;
    const P = new Problem(rules, m);
    const out = {};
    for (const n of names || P.names) {
      const dd = {};
      for (let d = 1; d <= P.N + 1; d++) { // N+1 は翌月1日の欄（曜日パターンからの推定）
        const e = {};
        for (const part of ["am", "pm"]) { const its = P.dutyItems(n, d, part); if (its.length) e[part] = its[0].kind; }
        if (Object.keys(e).length) dd[d] = e;
      }
      out[n] = dd;
    }
    return out;
  }
  // ---- 暦（祝日の出どころと施設の休日）。docs/rule-modules.md §10 ----
  // 祝日は国ごとのプラグイン（src/calendars/<id>.js）が T.calendars.register({ id, label, holidays(y, m) }) で登録する。"none"（土日だけ）は本体。
  // 施設の休日（年末年始など、毎年同じ月日の休み）は施設プロファイルの calendar.closure（[{ month, days }]）。
  // 月の設定の holidays / closure_days は月ごとの写し（暦から自動入力し、施設が手で直せる）。計算はその写しだけを見る。
  const CAL_DEFS = [], CAL_BY_ID = {};
  function registerCalendar(def) {
    if (!def || !def.id || typeof def.holidays !== "function") throw new Error("暦のプラグインには id と holidays(y, m) が要ります");
    stampSource(def); const i = CAL_DEFS.findIndex(c => c.id === def.id); if (i >= 0) CAL_DEFS[i] = def; else CAL_DEFS.push(def); CAL_BY_ID[def.id] = def; // 同じ id は defs も置き換える（組み立て時の上書きが有効な定義になる）
    if (T.plugins && T.plugins.recording) T.plugins.recording.push({ kind: "calendars", id: def.id });
    return def;
  }
  function unregisterCalendar(id) { const i = CAL_DEFS.findIndex(c => c.id === id); if (i >= 0) CAL_DEFS.splice(i, 1); delete CAL_BY_ID[id]; } // プラグインのフォルダを切り替えたとき
  registerCalendar({ id: "none", label: { ja: "祝日なし（土日だけ）", en: "No public holidays (weekends only)" }, holidays() { return []; } });
  const DEFAULT_CALENDAR = { holidays: "jp", closure: [{ month: 12, days: [29, 30, 31] }, { month: 1, days: [2, 3] }] }; // 暦の指定が無い保存データ（循環器の既定）
  function calendarOf(rules) {
    const c = ((rules || {}).profile || {}).calendar;
    if (!c || typeof c !== "object") return DEFAULT_CALENDAR;
    return { holidays: CAL_BY_ID[c.holidays] && !pluginOff(rules, CAL_BY_ID[c.holidays].source) ? c.holidays : (c.holidays === "none" ? "none" : DEFAULT_CALENDAR.holidays), // 無効にしたプラグインの暦は既定へ
      closure: Array.isArray(c.closure) ? c.closure.map(x => ({ month: +x.month, days: [].concat(x.days || []).map(Number).filter(d => d >= 1 && d <= 31) })).filter(x => x.month >= 1 && x.month <= 12 && x.days.length) : [] };
  }
  const closureOf = (rules, y, m) => calendarOf(rules).closure.filter(x => x.month === m).flatMap(x => x.days).filter(d => d <= new Date(y, m, 0).getDate()).sort((a, b) => a - b);
  // その月の祝日と施設の休日: { holidays: 祝日＋施設の休日（月の設定の holidays に入れる形）, closure: 施設の休日だけ }
  function holidaysOf(rules, y, m) {
    const src = CAL_BY_ID[calendarOf(rules).holidays] || CAL_BY_ID.none, closure = closureOf(rules, y, m);
    return { holidays: [...new Set([...src.holidays(y, m), ...closure])].sort((a, b) => a - b), closure };
  }
  function isOffDay(rules, y, m, d) { const w = new Date(y, m - 1, d).getDay(); return w === 0 || w === 6 || holidaysOf(rules, y, m).holidays.includes(d); }
  // 月の入力（当月分）に出てくる氏名 → どこに出てくるか（種類の一覧）。前月末の接続と履歴は記録なので含めない
  function monthNameRefs(m) {
    const out = {}, add = (n, kind) => { if (!n) return; (out[n] ||= []); if (!out[n].includes(kind)) out[n].push(kind); };
    const keysOf = (o, kind) => { for (const [n, v] of Object.entries(o || {})) if (v && (!Array.isArray(v) || v.length) && (typeof v !== "object" || Array.isArray(v) || Object.keys(v).length)) add(n, kind); };
    keysOf(m.duty_days, "duty_days"); keysOf(m.regular_duties, "regular_duties"); keysOf(m.unavailable_night, "unavailable"); keysOf(m.targets, "targets"); keysOf((m.wishes || {}).night_on, "wishes"); keysOf((m.wishes || {}).day_on, "wishes");
    for (const u of m.unavailable_other || []) add(u.name, "unavailable");
    for (const n of (m.wishes || {}).weekend_dayshift || []) add(n, "wishes");
    for (const u of m.avoid || []) add(u.name, "avoid");
    for (const u of m.confirmed_pm_external_night || []) add(u.name, "confirmed_pm_external_night");
    const f = m.fixed || {};
    for (const k of ["night", "day", "weekend_charge"]) for (const v of Object.values(f[k] || {})) for (const n of [].concat(v || [])) add(n, "fixed");
    for (const k of ["day_oc", "night_oc"]) for (const v of Object.values(f[k] || {})) for (const n of [].concat(v || [])) add(n, "fixed");
    for (const k of Object.keys(m.fixed_tags || {})) add(k.split("|")[1], "fixed");
    for (const byName of Object.values(m.person_days || {})) for (const [n, v] of Object.entries(byName || {})) if (v && Object.keys(v).length) add(n, "person_days");
    return out;
  }
  // 名簿にない人の入力を月から消す（名簿から外した・施設プロファイルを読み込んだ後の残り）。消した件数を返す
  function purgeMonthNames(m, names) {
    const bad = new Set(names); let c = 0;
    const dropKeys = o => { for (const n of Object.keys(o || {})) if (bad.has(n)) { delete o[n]; c++; } };
    dropKeys(m.duty_days); dropKeys(m.regular_duties); dropKeys(m.unavailable_night); dropKeys(m.targets); dropKeys((m.wishes || {}).night_on); dropKeys((m.wishes || {}).day_on);
    const filt = (arr, f) => { if (!Array.isArray(arr)) return arr; const out = arr.filter(f); c += arr.length - out.length; return out; };
    m.unavailable_other = filt(m.unavailable_other, u => !bad.has(u.name)); m.avoid = filt(m.avoid, u => !bad.has(u.name)); m.confirmed_pm_external_night = filt(m.confirmed_pm_external_night, u => !bad.has(u.name));
    if (m.wishes) m.wishes.weekend_dayshift = filt(m.wishes.weekend_dayshift, n => !bad.has(n));
    const f = m.fixed || {};
    for (const k of ["night", "day", "weekend_charge"]) for (const d of Object.keys(f[k] || {})) { const v = f[k][d]; if (Array.isArray(v)) { const out = v.filter(n => !bad.has(n)); c += v.length - out.length; if (out.length) f[k][d] = out; else delete f[k][d]; } else if (bad.has(v)) { delete f[k][d]; c++; } }
    for (const k of ["day_oc", "night_oc"]) for (const d of Object.keys(f[k] || {})) { const v = [].concat(f[k][d] || []), out = v.filter(n => !bad.has(n)); c += v.length - out.length; if (out.length) f[k][d] = out; else delete f[k][d]; }
    for (const k of Object.keys(m.fixed_tags || {})) if (bad.has(k.split("|")[1])) { delete m.fixed_tags[k]; c++; }
    for (const byName of Object.values(m.person_days || {})) for (const n of Object.keys(byName || {})) if (bad.has(n)) { delete byName[n]; c++; }
    return c;
  }
  T.monthNameRefs = monthNameRefs; T.purgeMonthNames = purgeMonthNames;
  T.calendars = { defs: CAL_DEFS, byId: CAL_BY_ID, register: registerCalendar, unregister: unregisterCalendar };
  // 日ごとの区分（month.day_flags = {日: [id]}）の種類。施設のプラグインが登録する（例: 行事の日）。月別条件タブに日ごとの表として出て、予定の文（month.day_notes = {日: 文}）と並ぶ
  const DAYFLAG_DEFS = [], DAYFLAG_BY_ID = {};
  function registerDayFlag(def) {
    if (!def || !def.id || !def.label) throw new Error("日ごとの区分には id と label が要ります");
    stampSource(def); const i = DAYFLAG_DEFS.findIndex(x => x.id === def.id); if (i >= 0) DAYFLAG_DEFS[i] = def; else DAYFLAG_DEFS.push(def); DAYFLAG_BY_ID[def.id] = def;
    if (T.plugins && T.plugins.recording) T.plugins.recording.push({ kind: "dayflags", id: def.id });
    return def;
  }
  // 施設の設定（プロファイル）で決める日ごとの区分: R.profile.day_flags = ["行事", …] または [{ id, label, short }]
  const profileFlags = R => [].concat(((R || {}).profile || {}).day_flags || []).map(x => typeof x === "string" ? { id: x, label: x } : x).filter(x => x && x.id).map(x => Object.assign({ label: x.id }, x, { fromProfile: true }));
  const dayFlagsFor = R => DAYFLAG_DEFS.filter(f => { if (pluginOff(R, f.source)) return false; if (!R || typeof f.when !== "function") return true; try { return !!f.when(R); } catch (x) { return false; } })
    .concat(profileFlags(R).filter(f => !DAYFLAG_BY_ID[f.id])); // プラグインが登録した区分（付け外しは when）＋プロファイルの区分
  const dayFlagLabel = (R, id) => { const f = DAYFLAG_BY_ID[id] || profileFlags(R).find(x => x.id === id); return f ? (T.pickLabel ? T.pickLabel(f.short || f.label, id) : String(f.short || f.label)) : id; };
  function unregisterDayFlag(id) { const i = DAYFLAG_DEFS.findIndex(x => x.id === id); if (i >= 0) DAYFLAG_DEFS.splice(i, 1); delete DAYFLAG_BY_ID[id]; }
  T.dayFlags = { defs: DAYFLAG_DEFS, byId: DAYFLAG_BY_ID, register: registerDayFlag, unregister: unregisterDayFlag, activeFor: dayFlagsFor, labelOf: dayFlagLabel };
  // 職員別カレンダーの拡張（施設のプラグインが登録する）。1 つの登録は次を持てる（どれも任意）:
  //   fixedTags: [{ label, shifts: ["day","night"] }]  … 固定欄の横に「印」の選択肢（研修・会議など）を出す（month.fixed_tags に入る）
  //   fields:    [{ id, label, options: [[値, 表示]] }] … 日ごとの欄を足す（month.person_days = {id: {氏名: {日: 値}}}。規則からは P.personDay(id, n, d)）
  //   hideDuties: true … 午前・午後の業務の欄を隠す（定期業務のない施設）
  //   paidLeave:  true … 規則 days_off_min を使っていなくても不可の選択肢に「有給」を出す
  //   dayHead:    true … 職員別カレンダー（入力・結果）の日付の見出しに、日ごとの予定と日ごとの区分を出す（入力側では区分のチェックで付け外しできる）
  //   symbol(P, A, n, d) … 計算結果のその人・その日の記号 { pre, t, sup, sub, u: "single"|"double", box, bold, small, title }（勤務表の様式と同じ記号をカレンダーにも出す）
  //   legend(P) … 記号の凡例 [[記号, 説明]]
  //   when(R) … 施設の設定（規則の状態など）で付け外しする。偽ならこの登録は無いものとして扱う
  const CALEXT = [];
  function registerCalExt(def) { if (!def || !def.id) throw new Error("カレンダーの拡張には id が要ります"); stampSource(def); const i = CALEXT.findIndex(x => x.id === def.id); if (i >= 0) CALEXT[i] = def; else CALEXT.push(def);
    if (T.plugins && T.plugins.recording) T.plugins.recording.push({ kind: "calext", id: def.id }); return def; }
  function unregisterCalExt(id) { const i = CALEXT.findIndex(x => x.id === id); if (i >= 0) CALEXT.splice(i, 1); }
  function mergedCalExt(R) { const out = { fixedTags: [], fields: [], hideDuties: false, paidLeave: false, dayHead: false, symbol: null, legend: null, };
    // 施設の設定（プロファイル）で決める固定の印: R.profile.fixed_tags = ["研修", …] または [{ label, shifts }]
    for (const t of [].concat(((R || {}).profile || {}).fixed_tags || [])) { const x = typeof t === "string" ? { label: t } : t; if (x && x.label && !out.fixedTags.some(y => y.label === x.label)) out.fixedTags.push({ label: String(x.label), shifts: [].concat(x.shifts || ["day", "night"]) }); }
    for (const e of CALEXT) { if (pluginOff(R, e.source)) continue; if (R && typeof e.when === "function") { let on = false; try { on = !!e.when(R); } catch (x) { on = false; } if (!on) continue; }
      if (e.dayHead) out.dayHead = true; if (!out.symbol && typeof e.symbol === "function") out.symbol = e.symbol; if (!out.legend && typeof e.legend === "function") out.legend = e.legend;
 for (const t of e.fixedTags || []) if (t && t.label && !out.fixedTags.some(x => x.label === t.label)) out.fixedTags.push({ label: String(t.label), shifts: [].concat(t.shifts || ["day", "night"]) });
      for (const f of e.fields || []) if (f && f.id && Array.isArray(f.options) && !out.fields.some(x => x.id === f.id)) out.fields.push(f);
      if (e.hideDuties) out.hideDuties = true; if (e.paidLeave) out.paidLeave = true; }
    return out; }
  // 記号を HTML に（上付き・下付き・下線・枠囲み）。カレンダーと凡例で共通
  const escH = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  function symbolHtml(sym) { if (!sym || !(sym.t || sym.pre || sym.sup || sym.sub)) return "";
    const st = [sym.u === "double" ? "text-decoration:underline double" : sym.u ? "text-decoration:underline" : "", sym.box ? "border:1px solid currentColor;padding:0 1px" : "", sym.bold ? "font-weight:bold" : "", sym.small ? "font-size:85%" : ""].filter(Boolean).join(";");
    return `<span class="calsym"${sym.title ? ` title="${escH(sym.title)}"` : ""}>${sym.pre ? `<sup>${escH(sym.pre)}</sup>` : ""}<span style="${st}">${escH(sym.t || "")}</span>${sym.sup ? `<sup>${escH(sym.sup)}</sup>` : ""}${sym.sub ? `<sub>${escH(sym.sub)}</sub>` : ""}</span>`; }
  T.calendarExt = { defs: CALEXT, register: registerCalExt, unregister: unregisterCalExt, merged: mergedCalExt, symbolHtml };
  T.PLUGINS = /*__PLUGINS__*/[]; // 組み立て時に取り込んだ施設のプラグインの一覧（build.py --plugins が埋める） T.DEFAULT_CALENDAR = DEFAULT_CALENDAR;
  T.calendarOf = calendarOf; T.holidaysOf = holidaysOf; T.isOffDay = isOffDay; T.shareQuotas = shareQuotas;

  // 前月のカレンダー（duty_days）から曜日パターンを推定する（毎週＝その曜日の全回、そうでなければ第n曜日）
  function inferPatterns(rules, month) {
    const m = Object.assign({}, month); const P = new Problem(rules, Object.assign({}, m, { duty_days: null }));
    const dd = month.duty_days || {}; const out = {};
    for (const n of P.names) {
      const occ = {}; // key dow|part|kind -> [nth...]
      const totalByDow = {};
      const onHol = !!month.duties_on_holidays;
      const known = {}; // dow|part -> 業務が置けた（祝日でも不在でもない）回の nth
      for (let d = 1; d <= P.N; d++) { const w = P.dow(d); const e = (dd[n] || {})[d] || (dd[n] || {})[String(d)] || {}; for (const part of ["am", "pm"]) { if ((!P.isHoliday(d) || onHol) && e[part] !== "absent") (known[`${w}|${part}`] ||= []).push(P.nth(d)); if (e[part] && e[part] !== "absent") (occ[`${w}|${part}|${e[part]}`] ||= []).push(P.nth(d)); } }
      // 第n曜日の推定: 祝日・不在で欠けた回は「不明」として、毎週 → 第1・3・5 → 第2・4 → 観測どおり の順で矛盾しない最初のものを採る
      const nthOf = (w, arr, part) => {
        const present = new Set(arr), kn = known[`${w}|${part}`] || [];
        const consistent = cand => kn.every(k => cand.includes(k) === present.has(k));
        if (kn.every(k => present.has(k))) return null;
        for (const cand of [[1, 3, 5], [2, 4]]) if (consistent(cand)) return cand;
        return [...present].sort((x, y) => x - y);
      };
      const items = [];
      // 午前と午後が同じ種別・同じ回なら終日にまとめる
      const keys = Object.keys(occ);
      const merged = new Set();
      for (const k of keys) {
        const [w, part, kind] = k.split("|"); if (part !== "am") continue;
        const kp = `${w}|pm|${kind}`; if (occ[kp] && occ[kp].join(",") === occ[k].join(",")) { const it = { kind, dow: DOW[+w], part: "full" }; const nth = nthOf(+w, occ[k], "am"); if (nth) it.nth = nth; items.push(it); merged.add(k); merged.add(kp); }
      }
      for (const k of keys) { if (merged.has(k)) continue; const [w, part, kind] = k.split("|"); const it = { kind, dow: DOW[+w], part }; const nth = nthOf(+w, occ[k], part); if (nth) it.nth = nth; items.push(it); }
      out[n] = items;
    }
    return out;
  }
  T.inferPatterns = inferPatterns;
  // 「避：…」の曜日パターンを、その月の「できれば避けたい日」に展開する（土日祝も対象）
  function expandAvoid(rules, month, names = null) {
    const P = new Problem(rules, Object.assign({}, month, { duty_days: null, avoid: [] }));
    const out = {};
    for (const n of names || P.names) out[n] = (P.avoid[n] || []).map(([day, part]) => ({ name: n, day, part }));
    return out;
  }
  T.expandAvoid = expandAvoid;

  // 規則の欠損項目を配布時の既定で補う（古い保存データ・rules.json・JSON 直接編集への備え）。値が違う項目は変えない
  // 重みの鍵の改名（施設ごとの役割の文字 I/A/Y を含む名前をやめた。2026-09-23）。古い保存データは読み込み時に移す
  const WEIGHT_RENAMES = { same_day_IA_soft: "same_day_charge_other_soft", same_day_AY: "same_day_other_junior", same_day_AA: "same_day_other_both" };
  function fillDefaultRules(R) {
    if (!R) return R;
    const D = T.DEFAULT_RULES || {};
    if (R.friday_night_min === undefined && R.friday_night_exact) { R.friday_night_min = R.friday_night_exact; } delete R.friday_night_exact; // 旧名（ちょうど n 回）→ 最低 n 回（版1.11）
    R.weights ||= {};
    for (const [o, n] of Object.entries(WEIGHT_RENAMES)) if (R.weights[o] !== undefined) { if (R.weights[n] === undefined || R.weights[n] === null || R.weights[n] === "") R.weights[n] = R.weights[o]; delete R.weights[o]; } // 旧い鍵 → 新しい鍵（既定で埋める前に）
    for (const [k, v] of Object.entries(D.weights || {})) if (R.weights[k] === undefined || R.weights[k] === null || R.weights[k] === "") R.weights[k] = v;
    // 表形式の規則は行ごとに補う（古い保存データに「部長」行や曜日が無いとき、設定タブが 0 を表示して 0 のまま保存してしまわないように）
    const roleIdsNow = new Set(normalizeRoles(R).map(r => r.id));
    if (R.oncall_requirement) for (const row of Object.keys(R.oncall_requirement)) if (!roleIdsNow.has(row)) delete R.oncall_requirement[row]; // 役割を消した・改名したときの取り残し
    // 表の全部が 0 のときだけ既定に戻す（2026-09-17 の設定画面が欠けた行を 0 で書き込んだデータの復旧用。
    // 施設が意図して 0 にした行は残す。オンコールを置かない施設は規則 oncall を「なし」にする）
    const allZeroTable = R.oncall_requirement && typeof R.oncall_requirement === "object" &&
      Object.values(R.oncall_requirement).every(v => v && typeof v === "object" && Object.values(v).every(x => !(+x)));
    for (const tbl of ["oncall_requirement", "cath_requirement"]) { if (!D[tbl]) continue; if (tbl === "oncall_requirement" && (ruleState(R, "oncall") === "off" || !roleIdsNow.has("I"))) continue; if (!R[tbl] || typeof R[tbl] !== "object") R[tbl] = {}; for (const [row, v] of Object.entries(D[tbl])) { const cur = R[tbl][row]; const allZero = tbl === "oncall_requirement" && allZeroTable && cur && typeof cur === "object" && Object.values(cur).every(x => !(+x)); if (cur === undefined || cur === null || allZero) R[tbl][row] = JSON.parse(JSON.stringify(v)); } } // OC構成の全部 0 の行は、以前の設定画面が欠けた行を 0 で書き込んだもの（2026-09-17 修正）なので既定に戻す
    for (const k of ["cath_requirement", "oncall_requirement", "quota_tolerance", "weekend_balance_max_diff", "arrhythmia_pre_workday_night", "arrhythmia_responsible_night", "friday_night_min", "pm_clinic_arrhythmia_candidates", "max_same_weekday_shifts", "exclude_post_night_from_cath", "rest_day_required", "pm_external_night", "same_day_IA"]) if (R[k] === undefined && D[k] !== undefined) R[k] = JSON.parse(JSON.stringify(D[k]));
    // 施設プロファイルの識別子（どの施設の設定か）。月データにも記録して取り違えを防ぐ
    const dp = D.profile || { id: "cardiology", label: { ja: "週 5 日勤＋夜勤（勤務医の見本）", en: "Weekday days + night duty (physician sample)" } }; // id は保存データとの互換のため cardiology のまま
    if (!R.profile || typeof R.profile !== "object") R.profile = { id: dp.id, label: dp.label };
    R.profile.id ||= dp.id; R.profile.label ||= R.profile.id;
    // 規則の状態（必須/減点/なし）。旧キーから読み替えて rule_states に明示し、旧キー側も揃える（Python 版と旧版の HTML のため）
    R.rule_states ||= {};
    for (const def of RULE_DEFS) for (const a of def.aliases || []) if (R.rule_states[a] !== undefined) { if (R.rule_states[def.id] === undefined) R.rule_states[def.id] = R.rule_states[a]; delete R.rule_states[a]; } // 旧 id → 新 id
    for (const def of RULE_DEFS) {
      const st = ruleStateRaw(R, def.id); // 無効にしたプラグインの規則も、設定どおりの状態を書く（付け外しは ruleState 側で見る）
      R.rule_states[def.id] = st;
      if (def.legacy) R[def.legacy] = def.toLegacy(st);
      if (def.weight && (R.weights[def.weight] === undefined || R.weights[def.weight] === null || R.weights[def.weight] === "")) R.weights[def.weight] = def.w0;
      for (const [k, v] of Object.entries(def.w0sub || {})) if (R.weights[k] === undefined || R.weights[k] === null || R.weights[k] === "") R.weights[k] = v; // sub の重みの既定（プラグインの規則は見本の重みの表に無いので自分で持つ）
    }
    if (Array.isArray(R.doctors)) { const names = new Set(R.doctors.map(d => d.name)); R.name_order = (R.name_order || []).filter(n => names.has(n)); }
    return R;
  }
  T.fillDefaultRules = fillDefaultRules;
  // 月データの形を整える（欠けている入れ物を作る・旧形式を移す）。読込・統合・新規作成のあとに必ず通す
  function normalizeMonth(m, rules) {
    const names = (rules.doctors || []).map(d => d.name);
    if (m.cath_off_days && m.cath_off_days.length) { // 旧データ: 副担当・主担当の両方に振り分ける
      const u = a => [...new Set([...(a || []), ...m.cath_off_days].map(Number))].sort((x, y) => x - y); m.cath_off_days_A = u(m.cath_off_days_A); m.cath_off_days_I = u(m.cath_off_days_I);
    }
    delete m.cath_off_days; delete m.next_month_first_day_duties; delete m.allow_split_weekend;
    if (!m.duty_days || typeof m.duty_days !== "object") m.duty_days = expandDuties(rules, m);
    if (!m.profile_id && rules.profile && rules.profile.id) m.profile_id = rules.profile.id; // 施設の記録が無い月データは、いまの施設のものとして扱う
    for (const n of names) { m.duty_days[n] ||= {}; (m.regular_duties ||= {})[n] ||= []; (m.unavailable_night ||= {})[n] ||= []; }
    if (!m.next_first_day_in_calendar) { // 旧データ: カレンダーを翌月1日まで伸ばし、曜日パターンからの推定を入れておく（一度だけ）
      try { const P = new Problem(rules, m), nd = P.N + 1; for (const n of names) { const e = {}; for (const part of ["am", "pm"]) { const its = P.estimateNextMonthItems(n, part); if (its.length) e[part] = its[0].kind; } if (Object.keys(e).length) m.duty_days[n][nd] = e; else delete m.duty_days[n][nd]; } m.next_first_day_in_calendar = true; } catch (e) { }
    }
    m.history ||= {}; m.history.work_balance ||= {}; m.history.weekend_charge ||= {}; m.history.holiday_charge ||= {};
    m.wishes ||= { weekend_dayshift: [], night_on: {} }; m.wishes.night_on ||= {}; m.wishes.day_on ||= {}; m.wishes.weekend_dayshift ||= [];
    m.fixed ||= {}; for (const k of ["night", "day", "weekend_charge", "day_oc", "night_oc", "day_oc_none", "night_oc_none"]) m.fixed[k] ||= {};
    m.fixed_tags ||= {}; m.day_flags ||= {}; m.day_notes ||= {}; m.person_days ||= {};
    m.exceptions ||= {}; m.targets ||= {}; m.holidays ||= []; m.closure_days ||= []; m.unavailable_other ||= []; m.confirmed_pm_external_night ||= [];
    m.prev_month ||= { last_days: [], last_weekend_charge: null, prev_weekend_charge: null };
    if (Array.isArray(m.avoid) && !m.avoid.length) delete m.avoid;
    return m;
  }
  T.normalizeMonth = normalizeMonth;

  // 相対の目安: その月の必要な延べ人数（枠ごとの人数。幅があるときは理想値、無ければ上限）を、当番に入る人（予備の役割を除く）の比重で按分する。
  // 整数にするのは最大剰余法（端数の大きい人から 1 ずつ）。端数が同じなら累計の過不足（history.work_balance）が少ない人 → 年数の短い人 → 名簿の順。
  // 比重 0 の人は 0 回。比重の合計が 0 なら全員 0（入力チェックが人数の不足を知らせる）
  function shareQuotas(P) {
    const people = P.dutyNames.filter(n => !P.isRole(n, "reserve")), w = {}; let W = 0;
    for (const n of people) { const s = Math.max(0, +((P.doctors[n] || {}).share ?? 1) || 0); w[n] = s; W += s; }
    const need = P.slots.reduce((a, s) => a + (P.countIdealOf(s) ?? P.countOf(s)), 0);
    const out = {}; for (const n of P.names) out[n] = 0;
    P.shareInfo = { need, W };
    if (!W) return out;
    const bal = ((P.m || {}).history || {}).work_balance || {};
    const ex = people.map(n => { const x = need * w[n] / W, q = Math.floor(x + 1e-9); return { n, q, r: x - q }; });
    let left = need - ex.reduce((a, e) => a + e.q, 0);
    const order = ex.filter(e => w[e.n] > 0).sort((a, b) => b.r - a.r || (+(bal[a.n] || 0)) - (+(bal[b.n] || 0)) || (+(P.doctors[a.n].years || 0)) - (+(P.doctors[b.n].years || 0)) || people.indexOf(a.n) - people.indexOf(b.n));
    for (let i = 0; left > 0 && order.length; i = (i + 1) % order.length) { order[i].q++; left--; }
    for (const e of ex) out[e.n] = e.q;
    return out;
  }
  // 当月の枠数に合わせて勤務目安を±1の範囲で自動調整する
  //   減らす: 目安の大きい人 → 累計の過不足（worked−目安 の累計）が大きい人 → 経験年数の長い人 の順（同じ目安の中で累計を見る）
  //   増やす: 目安の大きい人 → 累計で不足している人 → 経験年数の短い人 の順
  function autoTargets(rules, month) {
    const m = Object.assign({}, month); delete m.targets;
    const P = new Problem(rules, m);
    const bal = (month.history && month.history.work_balance) || {};
    const docs = P.dutyNames.filter(n => P.quota(n) > 0).map(n => ({ n, q: P.quota(n), y: +(P.doctors[n].years || 0), b: +(bal[n] || 0) }));
    const S = P.slots.length, Q = docs.reduce((a, d) => a + d.q, 0);
    const targets = {}; docs.forEach(d => targets[d.n] = d.q);
    const lines = [T.t("必要枠 {slots}、目安合計 {quota}、差 {diff}", { slots: S, quota: Q, diff: S - Q })];
    let diff = S - Q;
    const tol = P.tol;
    if (diff < 0) {
      const order = [...docs].sort((a, b) => b.q - a.q || b.b - a.b || b.y - a.y);
      for (let k = 0; k < tol && diff < 0; k++) for (const d of order) { if (diff >= 0) break; targets[d.n]--; diff++; lines.push(T.t("{who} {from}→{to}（累計 {bal}）", { who: d.n, from: d.q, to: targets[d.n], bal: (d.b >= 0 ? "+" : "") + d.b })); }
    } else if (diff > 0) {
      const order = [...docs].sort((a, b) => b.q - a.q || a.b - b.b || a.y - b.y);
      for (let k = 0; k < tol && diff > 0; k++) for (const d of order) { if (diff <= 0) break; targets[d.n]++; diff--; lines.push(T.t("{who} {from}→{to}（累計 {bal}）", { who: d.n, from: d.q, to: targets[d.n], bal: (d.b >= 0 ? "+" : "") + d.b })); }
    }
    if (diff !== 0) lines.push(T.t("±{tol} の範囲では {n} 枠分を調整しきれません（目安の見直しが必要）", { tol, n: Math.abs(diff) }));
    if (S === Q) lines.push(T.t("調整不要（目安どおり）"));
    // 変更のない人は targets に入れない（目安と同じ）
    for (const d of docs) if (targets[d.n] === d.q) delete targets[d.n];
    return { targets, lines, slots: S, quotaSum: Q };
  }
  // 前月末の接続で取り込む日数: 連勤の規則を使う施設は「連勤の上限＋2 日」（上限 3 日なら 5 日）、使わない施設は 2 日
  T.prevLookback = rules => { const on = id => ruleState(rules, id) !== "off"; const mx = Math.max(1, +(((rules || {}).run_length || {}).max ?? 5) || 5);
    let lb = on("run_length_max") || on("run_length_min") ? Math.max(2, mx + 2) : 2;
    for (const def of RULE_DEFS) if (on(def.id) && typeof def.lookback === "function") { try { lb = Math.max(lb, Math.round(+def.lookback(rules) || 0)); } catch (e) { } } // プラグインが必要とする日数（例: shift_run_max）
    return lb; };
  T.qualNames = rules => { const out = [], add = v => String(v || "").split(/[・|,、]+/).map(x => x.trim()).filter(Boolean).forEach(x => { if (!out.includes(x)) out.push(x); });
    for (const c of (rules || {}).composition || []) { add(c.qual); add(c.not_qual); } for (const d of (rules || {}).doctors || []) for (const q of [].concat(d.quals || [])) add(q); return out; };
  T.isMultiWork = rules => SHIFT_IDS.some(k => workerCount(rules, k, true) > 1 || workerCount(rules, k, false) > 1); // 1 枠に複数名を置く施設か
  T.DEFAULT_ROLES = DEFAULT_ROLES; T.roleLabels = roleLabelsOf; T.normalizeRolesOf = normalizeRoles; T.normalizeShiftsOf = normalizeShifts; T.DEFAULT_SHIFTS = DEFAULT_SHIFTS;
  T.RULE_DEFS = RULE_DEFS; T.RULE_BY_ID = RULE_BY_ID; T.STATE_JA = STATE_JA; T.ruleState = ruleState;

  // ---- 規則の要約 ----
  // いまの設定から「この施設の規則」を文にする。設定そのものから作るので、手書きの文書のようにずれない。
  // 戻り値は [{head, items}]。説明資料の第 0 節と設定タブが同じものを出す
  function rulesSummary(P) {
    const t = s => (T.t ? T.t(s) : s), tv = (s, v) => (T.t ? T.t(s, v) : s);
    const sep = T.listSep ? T.listSep() : "、";
    const shifts = P.shifts.filter(sh => P.slots.some(x => x[1] === sh.id));
    const out = [];
    // 施設の構成
    const cfg = [];
    { const pr = P.rules.profile || {}; cfg.push(tv("施設プロファイル: {label}（{id}）", { label: T.pickLabel ? T.pickLabel(pr.label, pr.id || "") : (pr.label || ""), id: pr.id || "" })); }
    cfg.push(tv("役割: {roles}", { roles: P.roles.map(r => r.label + (r.refs.length ? `（${t({ charge: "期間の責任者になれる", other: "対になる役割", junior: "補助として入る役割", reserve: "原則配置しない予備" }[r.refs[0]] || r.refs[0])}）` : "")).join(sep) }));
    cfg.push(tv("勤務帯: {shifts}", { shifts: shifts.map(sh => tv("{label}（{on}・1枠 {n} 人）", {
      label: sh.label, n: (s => P.countMinOf(s) === P.countOf(s) ? P.countOf(s) : `${P.countMinOf(s)}〜${P.countOf(s)}` + (P.countIdealOf(s) != null && P.on("count_target") ? tv("（理想 {n}）", { n: P.countIdealOf(s) }) : ""))([P.slots.find(x => x[1] === sh.id)[0], sh.id]),
      on: t({ all: "毎日", off_days: "土日祝だけ", weekdays: "平日だけ" }[sh.on] || sh.on) })).join(sep) }));
    { const cal = calendarOf(P.rules), src = CAL_BY_ID[cal.holidays];
      cfg.push(tv("暦: {src}。施設の休日: {closure}", { src: T.pickLabel ? T.pickLabel(src ? src.label : cal.holidays, cal.holidays) : cal.holidays, closure: cal.closure.flatMap(x => x.days.map(d => `${x.month}/${d}`)).join(sep) || t("なし") })); }
    cfg.push(tv("名簿: {n} 人（当番に入るのは {duty} 人）。枠は {slots}、勤務回数の目安の合計は {quota}", {
      n: P.names.length, duty: P.dutyNames.length, slots: P.slots.reduce((a, x) => a + P.countOf(x), 0),
      quota: P.dutyNames.reduce((a, n) => a + P.quota(n), 0) }));
    if (P.quotaMode === "share") cfg.push(tv("勤務回数の目安は相対: 必要な延べ人数 {need} を名簿の比重（合計 {w}）で按分", { need: (P.shareInfo || {}).need, w: (P.shareInfo || {}).W }));
    out.push({ head: t("施設の構成"), items: cfg });
    // 規則ごとの一言（設定の値を添える）
    const names = list => (list || []).filter(n => P.doctors[n]).join(sep) || t("なし");
    const detail = id => {
      const def = RULE_BY_ID[id]; if (def && def.summary) return def.summary(P, P.prm[id], tv); // プラグインが持つ要約
      switch (id) {
        case "oncall": return P.roleIds.map(r => { const need = P.standbyRoleIds.map(sid => +(P.ocReq[r] || {})[sid] || 0); return need.some(x => x) ? `${P.roleLabel(r)}→${P.standbyRoleIds.map((sid, i) => `${P.roleLabel(sid)}${need[i]}`).filter((_, i) => need[i]).join("+")}` : null; }).filter(Boolean).join(sep) || t("なし");
        default: return "";
      }
    };
    for (const [state, head] of [["hard", "必ず守る規則"], ["soft", "できるだけ守る規則（減点）"]]) {
      const items = [];
      for (const def of T.RULE_DEFS) {
        if (P.state(def.id) !== state) continue;
        const d = detail(def.id), w = state === "soft" && def.weight ? tv("減点 {w}", { w: P.weights[def.weight] }) : "";
        items.push((def.source || /^local\./.test(def.id) ? t("〔プラグイン〕") : "") + T.ruleLabel(P.rules, def) + (d ? `: ${d}` : "") + (w ? tv("（{w}）", { w }) : "")); // プラグイン由来は明記
      }
      if (items.length) out.push({ head: t(head), items });
    }
    const off = T.RULE_DEFS.filter(d => P.state(d.id) === "off").map(d => (d.source || /^local\./.test(d.id) ? t("〔プラグイン〕") : "") + T.ruleLabel(P.rules, d));
    if (off.length) out.push({ head: t("使わない規則"), items: [off.join(sep)] });
    return out;
  }
  T.rulesSummary = rulesSummary;
  T.RULE_GROUPS = RULE_GROUPS; T.term = term; T.ruleLabel = (rules, def) => term(T.t ? T.t(def.label) : def.label, rules); T.minDaysOff = minDaysOff;
  T.DOW = DOW; T.DOW_JA = DOW_JA; T.PARTS = PARTS; T.KINDS = KINDS; T.Problem = Problem; T.expandDuties = expandDuties; T.autoTargets = autoTargets;
  T.esc = esc; T.isDutyCandidate = isDutyCandidate;
  T.kindJa = k => KINDS[k] || k; // 互換（日本語固定）
  T.kindLabel = k => (T.t ? T.t(KINDS[k] || k) : (KINDS[k] || k)); // 表示言語で読む
})(globalThis.T = globalThis.T || {});

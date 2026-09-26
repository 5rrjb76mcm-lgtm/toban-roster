// 当直表アプリ: 検算の違反と入力チェックの文面。
//
// 文面は「種類（code）＋差し込む値（args）」で持つ。画面に出すときに、その言語の書き方へ組み立てる。
//   - 違反の同一性が文面から切り離されるので、言い回しを直しても回帰テスト（golden）の基準は変わらない。
//   - 言語ごとに語順が違っても、鍵ではなく組み立て方を変えるだけで済む。
// 新しい文面は **英語を先に書く**（en が原文、ja はその言い換え）。en が無いときは ja、ja も無いときは code をそのまま出す。
//
// 差し込みは {name} の形。{charge} {other} {junior} {reserve} は施設の役割の表示名に置き換わる（model.js の term）。
(function (T) {
  const MSG = {
    // ---- 枠の充足と役割構成 ----
    SLOT_WORKER_COUNT: { en: "{slot}: {got} on duty (needs {need}){who}", ja: "{slot}: 勤務者が {got} 名（必要 {need} 名）{who}" },
    SLOT_WORKER_DUP: { en: "{slot}: the same person is listed twice ({who})", ja: "{slot}: 同じ人が重ねて入っている（{who}）" },
    SLOT_WORKER_UNKNOWN: { en: "{slot}: not on the roster ({who})", ja: "{slot}: 勤務者が不正（{who}）" },
    SLOT_OC_ON_MULTI: { en: "{slot}: on-call attached to a multi-person slot ({who})", ja: "{slot}: 複数名の枠にOCが付いている（{who}）" },
    SLOT_OC_MISMATCH: { en: "{slot}: on-call does not match the required make-up. On duty {worker} ({role}), on-call {oc}", ja: "{slot}: OC構成不一致 勤務者{worker}（{role}） OC={oc}" },
    SLOT_OC_SELF: { en: "{slot}: {worker} is on duty and on-call at once", ja: "{slot}: 勤務者{worker}がOCを兼ねている" },
    SLOT_OC_NOT_STANDBY: { en: "{slot}: {who} cannot take on-call", ja: "{slot}: {who} はOC対象外" },
    // ---- 不可 ----
    UNAVAIL_NIGHT: { en: "{day}: {who} is on night duty but declared the night unavailable", ja: "{day}: {who} は夜間不可だが夜間担当" },
    UNAVAIL_DAY: { en: "{day}: {who} is on day duty but declared {scope} unavailable", ja: "{day}: {who} は{scope}不可だが日勤帯担当" },
    UNAVAIL_ALLDAY_NIGHT: { en: "{day}: {who} declared the whole day unavailable but is on duty that night", ja: "{day}: {who} は日夜両方の不可だが当夜に担当" },
    // ---- 回数 ----
    RESERVE_ASSIGNED: { en: "{who}: {reserve} is assigned to shifts ({count})", ja: "{who}: {reserve}が勤務に配置されている（{count}回）" },
    // ---- 同じ日・連続 ----
    // ---- 休みの日 ----
    // ---- 期間責任者 ----
    // ---- 固定指定 ----
    FIXED_MISMATCH: { en: "{day} {slot}: does not match the hand-fixed {who}", ja: "{day}{slot}: 固定指定{who}と不一致" },
    // ---- 曜日・金曜夜勤 ----
    // ---- 日中の業務との関係 ----
    // ---- 日中の専門業務 ----
    CATH_OTHER_SHORT: { en: "{other} {got} people < {need} needed", ja: "{other} {got}人 < 必要{need}" },
    CATH_CHARGE_SHORT: { en: "{charge} {got} people < {need} needed", ja: "{charge} {got}人 < 必要{need}" },
    CATH_CLINIC_OTHER_SHORT: { en: "specialty clinic: {got} {other} available < {need} on the specialty duty + 1 in clinic", ja: "専門外来: {other}の候補 {got}人 < 専門業務{need}+外来1" },
    CATH_CLINIC_JUNIOR_NONE: { en: "specialty clinic: no {junior} available", ja: "専門外来: {junior}の候補なし" },
    // ---- 同日の役割の組合せ ----

    // ---- 説明資料の印 ----
    AVOID_MARK_ALL: { en: "b", ja: "両" },
    AVOID_MARK_DAY: { en: "d", ja: "日" },
    AVOID_MARK_NIGHT: { en: "n", ja: "夜" },

    // ---- 入力チェック（lint）。_HINT はその下に出す直し方 ----
    LINT_NAME_ORDER_UNKNOWN: { en: "The display order (name_order) contains \"{who}\", who is not on the roster", ja: "表示順（name_order）に名簿にない名前「{who}」があります" },
    LINT_NAME_ORDER_UNKNOWN_HINT: { en: "Save the roster on the settings tab (it is rebuilt from the table)", ja: "設定タブで{person}一覧を保存すると整います（表から作り直します）" },
    LINT_FRIDAY_MIN_NOT_CANDIDATE: { en: "The minimum Friday nights (friday_night_min) lists \"{who}\", who is not a duty candidate", ja: "金曜夜勤の最低回数（friday_night_min）に当直候補でない{person}「{who}」があります" },
    LINT_FRIDAY_MIN_NOT_CANDIDATE_HINT: { en: "Clear the column on the settings tab, or make the person a duty candidate", ja: "設定タブでその欄を空にするか、当直候補にする" },
    LINT_NEXT_FIRST_TWO_CHARGE: { en: "The 1st of next month fixes {charge} duty to {who}, but another {charge} ({others}) is also fixed on the day side", ja: "翌月1日欄で{charge}担当 {who} と別の{charge}（{others}）が日勤側に固定されています" },
    LINT_NEXT_FIRST_TWO_CHARGE_HINT: { en: "Per-person calendar → leave one person fixed in the next-month column", ja: "{person}別カレンダー → 翌月1日欄の固定を1名にする" },
    LINT_NEXT_FIRST_TWO_CHARGE2: { en: "Two {charge} ({others}) are fixed on the day side of the 1st of next month", ja: "翌月1日欄の日勤側に{charge}が2名（{others}）固定されています" },
    LINT_NAME_BAD_CHARS: { en: "The name \"{who}\" contains a control character or \":\" or \"|\"", ja: "{person}名「{who}」に制御文字または「:」「|」が含まれています" },
    LINT_NAME_BAD_CHARS_HINT: { en: "Rename the person on the settings tab (those characters are used as separators in the saved data)", ja: "設定タブの{person}一覧で名前を直す（保存データの区切りに使う文字です）" },
    LINT_UNAVAIL_DOUBLE: { en: "{who} has both a night and a day/all-day unavailability on {day}", ja: "{who} の {day} に夜勤不可と日勤帯/終日の不可が重ねて入っています" },
    LINT_UNAVAIL_DOUBLE_HINT: { en: "Per-person calendar → {who} → {day}: leave one of them", ja: "{person}別カレンダー → {who} → {day} のどちらかにする" },
    LINT_NEXT_FIRST_TWO_CHARGE2_HINT: { en: "Per-person calendar → leave one person fixed in the next-month column", ja: "{person}別カレンダー → 翌月1日欄の固定を1名にする" },
    LINT_FIXED_NIGHT_NEXT_PM_HINT: { en: "Per-person calendar → {who} → {next}: check the afternoon duty, or remove the fixed assignment", ja: "{person}別カレンダー → {who} → {next} 午後の業務を確認するか、固定指定を削除" },
    LINT_PERIOD_CHARGE_NEEDS_ONCALL_HINT: { en: "In \"Set up the facility\", attach on-call to this shift, or untick the period-charge rule", ja: "「施設の構成を作る」でこの勤務帯にオンコールを付けるか、期間責任者の規則を使わないにする" },
    LINT_FIXED_OC_NO_ONCALL_SHIFT_HINT: { en: "Month tab → fixed assignments → remove it, or attach on-call to this shift in \"Set up the facility\"", ja: "月の設定 → 固定指定 から削除するか、「施設の構成を作る」でこの勤務帯にオンコールを付ける" },
    LINT_FIXED_OC_NOT_STANDBY_HINT: { en: "Month tab → fixed assignments → remove it", ja: "月の設定 → 固定指定 から削除" },
    LINT_FIXED_OC_NEXT_EXTERNAL_HINT: { en: "Per-person calendar → {who} → {next}: check the outside work, or remove the fixed assignment", ja: "{person}別カレンダー → {who} → {next} の外勤を確認するか、固定指定を削除" },
    LINT_FIXED_OC_TWO_SAME_ROLE_HINT: { en: "Month tab → fixed assignments → review it", ja: "月の設定 → 固定指定 を見直す" },
    LINT_FIXED_CONSECUTIVE_HINT: { en: "Month tab → fixed assignments → review it", ja: "月の設定 → 固定指定 を見直す" },
    LINT_FIXED_CHARGE_NOT_ROLE_HINT: { en: "Month tab → fixed assignments → remove it", ja: "月の設定 → 固定指定 から削除" },
    LINT_FIXED_CHARGE_NOT_OFF_DAY_HINT: { en: "Month tab → fixed assignments → remove it", ja: "月の設定 → 固定指定 から削除" },
    LINT_FIXED_CHARGE_VS_UNAVAIL_HINT: { en: "Per-person calendar → {who} → {day}: drop the unavailability, or remove the fixed assignment", ja: "{person}別カレンダー → {who} → {day} の不可を外すか、固定指定を削除" },
    LINT_UNAVAIL_AND_AVOID: { en: "{who} has both an unavailability and an avoid-if-possible on {day} (unavailable wins)", ja: "{who} の {day} に不可と避けたい日が両方あります（不可が優先されます）" },
    LINT_UNAVAIL_AND_AVOID_HINT: { en: "Per-person calendar → {who} → {day}: keep one of them", ja: "{person}別カレンダー → {who} → {day} をどちらかにする" },
    LINT_FIXED_NOT_CANDIDATE: { en: "Fixed \"{day} {slot} {who}\": {who} is not a duty candidate", ja: "固定指定「{day} {slot} {who}」: {who} は当直の候補ではありません" },
    LINT_FIXED_NOT_CANDIDATE_HINT: { en: "Month tab → fixed assignments → remove it. If the person is no longer on the roster, the box at the top of the month settings removes every input left for people not on the roster", ja: "月の設定 → 固定指定 から削除。名簿にいない人なら、月の設定の先頭の箱から「名簿にない人の入力を削除」で一括で消せます" },
    LINT_NAME_DUP: { en: "The same name appears more than once in the roster: {who}. Names identify people, so make them distinct", ja: "名簿に同じ氏名が 2 人以上います: {who}。氏名は個人の識別子なので別の表記にしてください" },
    LINT_NAME_DUP_HINT: { en: "Fix the names on the settings tab (e.g. add an initial). Conditions such as unavailable days are keyed by name and one person's would overwrite the other's", ja: "設定タブの名簿で氏名を直してください（例: イニシャルを添える）。不可日などは氏名で結び付くので、同じ氏名では片方の条件が上書きされます" },
    LINT_DAYS_OFF_PAID_OVER: { en: "{who}: the required days off ({min} + {paid} paid) exceed the days in the month ({N})", ja: "{who}: 休みの必要日数（最低 {min} 日＋有給 {paid} 日）が月の日数（{N} 日）を超えています" },
    LINT_DAYS_OFF_PAID_OVER_HINT: { en: "As a hard rule this has no solution. Reduce the paid days or the minimum, or set the rule to Penalty", ja: "必須のままでは解がありません。有給の日数か最低日数を減らすか、規則を「減点」にしてください" },
    LINT_PLUGIN_HOOK: { en: "The {hook} step of facility plug-in rule {who} failed: {err}. Its data was left unchanged", ja: "施設のプラグインの規則 {who} の {hook} が失敗しました: {err}。そのデータは変えずに残しています" },
    LINT_PLUGIN_HOOK_HINT: { en: "Until it succeeds, solving and writing the roster are stopped. Fix the plug-in file under plugins/ and press \"Reload the plug-ins\" on the settings tab, or tell the plug-in's author", ja: "直るまで計算と勤務表の書き出しを止めます。保存フォルダの plugins/ のファイルを直して設定タブの「プラグインを読み直す」を押すか、プラグインの作成者に知らせてください" },
    LINT_PLUGIN_ERROR: { en: "Facility plug-in {name} could not be loaded: {err}", ja: "施設のプラグイン {name} が読めません: {err}" },
    LINT_PLUGIN_ERROR_HINT: { en: "Fix the file under plugins/ in the save folder, then press \"Reload the plug-ins\" on the settings tab (administrator section). The other parts keep working", ja: "保存フォルダの plugins/ のファイルを直し、設定タブの管理者向け「プラグインを読み直す」を押してください。他の部分は動いています" },
    LINT_PLUGIN_STALE: { en: "Facility plug-in rule {who} was loaded from a previous folder and is still registered", ja: "前のフォルダの施設のプラグイン {who} が残っています" },
    LINT_PLUGIN_STALE_HINT: { en: "Reload the page (F5) after switching folders so that only this folder's plug-ins are active", ja: "フォルダを切り替えたあとはページを読み直してください（このフォルダのプラグインだけが有効になります）" },
    LINT_PLUGIN_OVERRIDE: { en: "Facility plug-in {name} re-registered rule {who}, which {was} had already defined; the definition read later is in effect", ja: "施設のプラグイン {name} が規則 {who} を登録し直しました（先に {was} が定義していたもの）。後から読んだ定義が使われます" },
    LINT_PLUGIN_OVERRIDE_HINT: { en: "If this is not intended, change the rule id (local.<facility>.<name>) or remove the duplicate file", ja: "意図したものでなければ、規則の id（local.<施設>.<名前>）を変えるか、重なっているファイルを外してください" },
    LINT_RULE_OVERLAP: { en: "Rules \"{who}\" and \"{other}\" cover the same thing and both are in use ({a}, {b})", ja: "規則「{who}」と「{other}」は同じことを扱い、両方とも使われています（{a}・{b}）" },
    LINT_RULE_OVERLAP_HINT: { en: "Settings tab → Build the facility profile → Rules in use: turn one of them off, or keep both if that is what the facility wants", ja: "設定タブ → 施設の構成を作る → 使う規則 で片方を外すか、両方でよいか確かめてください" },
    LINT_CALENDAR_MISSING: { en: "Calendar plug-in \"{id}\" is not loaded; automatic holiday filling falls back to the default calendar", ja: "暦のプラグイン「{id}」が読み込まれていません。祝日の自動入力は既定の暦になります" },
    LINT_CALENDAR_MISSING_HINT: { en: "Put the calendar file under plugins/calendars/ in the save folder, or choose another source under settings → set up the facility → calendar", ja: "保存フォルダの plugins/calendars/ に暦のファイルを置くか、設定タブ → 施設の構成 → 暦 で別の出どころを選んでください" },
    LINT_DOCX_TEMPLATE_MISSING: { en: "Document layout \"{id}\" is not loaded; the roster document cannot be produced with it", ja: "勤務表の様式「{id}」が読み込まれていません。この様式では勤務表を書き出せません" },
    LINT_DOCX_TEMPLATE_MISSING_HINT: { en: "Put the layout file under plugins/docx/ in the save folder, or choose a bundled layout under settings → set up the facility → output", ja: "保存フォルダの plugins/docx/ に様式のファイルを置くか、設定タブ → 施設の構成 → 出力 で同梱の様式を選んでください" },
    LINT_PLUGIN_MISSING: { en: "This month was solved with facility plug-in rules that are not loaded now: {who}", ja: "この月は、いま読み込まれていない施設のプラグインの規則で計算されました: {who}" },
    LINT_PLUGIN_MISSING_HINT: { en: "Put the plug-in files under plugins/ in the save folder (or use a toban.html built with them) and reconnect; otherwise the result will differ from the saved one", ja: "保存フォルダの plugins/ にプラグインのファイルを置いて（またはプラグインを組み込んだ toban.html で）接続し直してください。そのまま計算すると保存されている結果と違う勤務表になります" },
    LINT_MONTH_UNKNOWN_NAMES: { en: "Inputs for {n} people who are not on the roster remain in this month: {who}", ja: "名簿にない {n} 人の入力がこの月に残っています: {who}" },
    LINT_MONTH_UNKNOWN_NAMES_HINT: { en: "Left over after removing someone from the roster or loading a facility profile. The box at the top of the month settings lists them and can remove them (fixed slots, unavailable days, requests, duties, targets). Rename the person in the roster instead if it is the same person under a new name", ja: "名簿から外した後や施設プロファイルを読み込んだ後の残りです。月の設定の先頭の箱に一覧が出て、まとめて消せます（固定指定・不可・希望・業務・目標）。同じ人の改名なら、名簿の氏名を書き換えれば月の入力も追随します" },
    LINT_FIXED_VS_UNAVAIL: { en: "Fixed \"{day} {slot} {who}\" conflicts with {who}'s {scope}unavailability on {day}", ja: "固定指定「{day} {slot} {who}」と、{who} の {day} の{scope}不可 が矛盾しています" },
    SCOPE_ALLDAY: { en: "all-day ", ja: "日夜両方の" },
    SCOPE_DAY: { en: "daytime ", ja: "日勤帯" },
    SCOPE_NIGHT: { en: "night ", ja: "夜間" },
    LINT_FIXED_VS_UNAVAIL_HINT: { en: "Per-person calendar → {who} → {day}: drop the unavailability, or remove the fixed assignment", ja: "{person}別カレンダー → {who} → {day} の不可を外すか、固定指定を削除" },
    LINT_FIXED_NIGHT_NEXT_EXTERNAL: { en: "Fixed \"{day} {slot} {who}\": {who} has outside work the next day, {next} (outside work after a night shift is forbidden)", ja: "固定指定「{day} {slot} {who}」の翌日 {next} に {who} の外勤があります（夜勤明けの外勤は禁止）" },
    LINT_FIXED_NIGHT_NEXT_EXTERNAL_HINT: { en: "Per-person calendar → {who} → {next}: check the outside work, or remove the fixed assignment", ja: "{person}別カレンダー → {who} → {next} の外勤を確認するか、固定指定を削除" },
    LINT_FIXED_NIGHT_NEXT_PM: { en: "Fixed \"{day} {slot} {who}\": {who} has duty on the afternoon of the next day, {next} (afternoon duty after a night shift is forbidden)", ja: "固定指定「{day} {slot} {who}」の翌日 {next} 午後に {who} の業務があります（夜勤翌日の午後業務は禁止）" },
    LINT_FIXED_NIGHT_PM_EXTERNAL: { en: "Fixed \"{day} {slot} {who}\": {who} has outside work that afternoon (allowed only where it is recorded as confirmed in time)", ja: "固定指定「{day} {slot} {who}」の当日午後に {who} の外勤があります（間に合う確認の記録があるときだけ可）" },
    LINT_FIXED_NIGHT_PM_EXTERNAL_HINT: { en: "Add the confirmation under \"night shift and night on-call on an afternoon-outside day\" on the month tab, or remove the fixed assignment", ja: "月の設定の「午後外勤後の夜勤・夜間OC」に確認を追加するか、固定指定を削除" },
    LINT_FIXED_PRE_WORKDAY_NIGHT: { en: "Fixed \"{day} {slot} {who}\" is a weekday night before a working day (forbidden here)", ja: "固定指定「{day} {slot} {who}」は、翌日が休日でない平日の夜勤です（禁止設定）" },
    LINT_FIXED_PRE_WORKDAY_NIGHT_HINT: { en: "Set the rule back to Penalty, or remove the fixed assignment", ja: "規則を「減点」に戻すか、固定指定を削除" },
    LINT_FIXED_OVER_COUNT: { en: "Fixed \"{day} {slot} {who}\": {n} people are fixed but the slot takes {count}", ja: "固定指定「{day} {slot} {who}」: {n} 名を固定していますが、この枠の人数は {count} 名です" },
    LINT_FIXED_OVER_COUNT_HINT: { en: "Month tab → fixed assignments → remove the extra people (or raise the slot count in the settings)", ja: "月の設定 → 固定指定 から人を減らす（または設定タブで枠の人数を増やす）" },
    LINT_FIXED_DUP: { en: "Fixed \"{day} {slot} {who}\": the same person is listed twice", ja: "固定指定「{day} {slot} {who}」: 同じ人が 2 回入っています" },
    LINT_FIXED_DUP_HINT: { en: "Month tab → fixed assignments → list each person once", ja: "月の設定 → 固定指定 で 1 人 1 回にする" },
    LINT_FIXED_NO_SLOT: { en: "Fixed \"{day} {slot} {who}\": there is no {slot} slot on that day", ja: "固定指定「{day} {slot} {who}」: {day} に{slot}の枠がありません" },
    LINT_FIXED_NO_SLOT_HINT: { en: "Month tab → fixed assignments → remove it (add the date to the holidays if it should be one)", ja: "月の設定 → 固定指定 から削除（祝日なら暦の祝日に日付を足す）" },
    LINT_FIXED_SAME_DAY_CHARGE_OTHER: { en: "Fixed \"{day} day {a} ({aRole})\" and \"night {b} ({bRole})\" make the {charge} + {other} pairing on a day off, which is not used here", ja: "固定指定「{day} 日勤 {a}（{aRole}）」と「夜勤 {b}（{bRole}）」は休日の{charge}＋{other}の組合せで、共通ルールでは採用しません" },
    LINT_FIXED_SAME_DAY_CHARGE_OTHER_HINT: { en: "Change one of them, or set the rule \"day and night shift on a day off being {charge} + {other}\" to None", ja: "どちらかの固定を変えるか、設定タブ → 規則 → 「休日の日勤と夜勤が{charge}＋{other}の組合せ」を「なし」にする" },
    LINT_PERIOD_CHARGE_NEEDS_ONCALL: { en: "The period-charge rule needs the person in charge in every slot of the period, but the {shift} shift has no on-call; the same person would have to work consecutive days, which usually has no solution", ja: "期間責任者の規則は期間中の全枠に担当者が関わる必要がありますが、{shift}にはオンコールを付けていません。同じ人が連日勤務するしかなく、多くの場合は解なしになります" },
    LINT_FIXED_OC_NO_ONCALL_SHIFT: { en: "Fixed \"{day} {slot} {who}\": the {shift} shift has no on-call", ja: "固定指定「{day} {slot} {who}」: {shift}にはオンコールを付けていません" },
    LINT_FIXED_OC_NOT_STANDBY: { en: "Fixed \"{day} {slot} {who}\": only {roles} can take on-call ({who} is {role})", ja: "固定指定「{day} {slot} {who}」: OCに入れるのは {roles} だけです（{who} は{role}）" },
    LINT_FIXED_WORKER_IS_OC: { en: "Fixed: the {shift} and the {slot} on {day} are both {who} (someone on duty cannot also be on-call)", ja: "固定指定で {day} の{shift}と{slot}が同じ {who} です（勤務者はOCを兼ねられない）" },
    LINT_FIXED_WORKER_IS_OC_HINT: { en: "Month tab → fixed assignments → review it", ja: "月の設定 → 固定指定 を見直す" },
    LINT_FIXED_OC_NEXT_EXTERNAL: { en: "Fixed \"{day} {slot} {who}\": {who} has outside work on the next morning, {next} (outside work after night on-call is forbidden)", ja: "固定指定「{day} {slot} {who}」の翌朝 {next} に {who} の外勤があります（夜間OC翌朝の外勤は禁止）" },
    LINT_FIXED_OC_PM_EXTERNAL: { en: "Fixed \"{day} {slot} {who}\": {who} has outside work that afternoon ({why})", ja: "固定指定「{day} {slot} {who}」の当日午後に {who} の外勤があります（{why}）" },
    LINT_FIXED_OC_PM_EXTERNAL_DAY: { en: "day on-call on an afternoon-outside day is forbidden", ja: "午後外勤日の日勤OCは禁止" },
    LINT_FIXED_OC_PM_EXTERNAL_NIGHT: { en: "night on-call after afternoon outside work is allowed only where it is recorded as confirmed in time", ja: "午後外勤後の夜間OCは「間に合う」確認の記録があるときだけ可" },
    LINT_FIXED_OC_PM_EXTERNAL_HINT: { en: "Per-person calendar → {who} → {day}: check the outside work, or remove the fixed assignment{extra}", ja: "{person}別カレンダー → {who} → {day} の外勤を確認するか、固定指定を削除{extra}" },
    LINT_FIXED_OC_PM_EXTERNAL_HINT_EXTRA: { en: ". If it is in time, add the confirmation under \"night shift and night on-call on an afternoon-outside day\" on the month tab", ja: "。間に合うなら月の設定の「午後外勤後の夜勤・夜間OC」に確認を追加" },
    LINT_FIXED_OC_TWO_SAME_ROLE: { en: "Fixed \"{day} {slot} {who}\": at most one person per role can be on-call in the same half of the day", ja: "固定指定「{day} {slot} {who}」: 同じ時間帯のOCは役割ごとに1名までです" },
    LINT_FIXED_OVER_QUOTA: { en: "{count} shifts are fixed for {who}, above the target {quota} + {tol} (they will be assigned anyway and reported as allowed by the fixed assignment)", ja: "固定指定で {who} の勤務が {count} 件あり、目安 {quota}+{tol} 回を超えます（そのまま配置され、検算で「固定指定により許容」と出ます）" },
    LINT_FIXED_OVER_QUOTA_HINT: { en: "Fix fewer shifts, or review the target on the settings tab", ja: "固定指定を減らすか、設定の目安を見直す" },
    LINT_FIXED_SAME_DAY: { en: "{who} is fixed to both the day and the night shift on {day} (two shifts on one day are forbidden; the fixed assignment wins and is penalised)", ja: "固定指定で {who} が {day} の日勤と夜勤の両方に入っています（同日の実勤務は禁止。固定指定が優先され減点付きで配置されます）" },
    LINT_FIXED_SAME_DAY_HINT: { en: "Month tab → fixed assignments → remove one of them", ja: "月の設定 → 固定指定 のどちらかを削除" },
    LINT_FIXED_CONSECUTIVE: { en: "{who} is fixed to work on {day} and {next}, which are consecutive (or the same) days (forbidden)", ja: "固定指定で {who} が {day} と {next} の連日（または同日）の実勤務になります（禁止）" },
    LINT_FIXED_CHARGE_NOT_ROLE: { en: "Fixed \"{day} {charge} duty {who}\": {who} is not {charge}", ja: "固定指定「{day} {charge}担当 {who}」: {who} は{charge}ではありません" },
    LINT_FIXED_CHARGE_NOT_OFF_DAY: { en: "Fixed \"{day} {charge} duty {who}\": {day} is not a weekend or holiday", ja: "固定指定「{day} {charge}担当 {who}」: {day} は土日祝ではありません" },
    LINT_FIXED_CHARGE_VS_UNAVAIL: { en: "Fixed \"{day} {charge} duty {who}\" conflicts with {who}'s unavailability on the {day} (the period lead is on duty or on call through every slot of the day)", ja: "固定指定「{day} {charge}担当 {who}」と、{who} の {day} の不可 が矛盾しています（期間責任者はその日の全枠を通して勤務かOCに入る）" },
    LINT_PREV_CHARGE_UNAVAIL: { en: "Weekend across the month boundary: {who}, who held {charge} duty at the end of last month, is unavailable on {day} (one person covers the whole weekend)", ja: "月またぎの土日: 前月末の{charge}担当 {who} が {day} に不可です（土日は同じ人が通して担当）" },
    LINT_PREV_CHARGE_UNAVAIL_HINT: { en: "Per-person calendar → {who} → {day}: review the unavailability, or check the carry-over from last month on the month tab", ja: "{person}別カレンダー → {who} → {day} の不可を見直すか、月の設定の前月末の接続を確認" },
    LINT_PREV_CHARGE_TWO: { en: "Two or more {charge} appear in the carry-over from last month ({who})", ja: "前月末の接続で{charge}が2名以上入っています（{who}）" },
    LINT_PREV_CHARGE_TWO_HINT: { en: "Month tab → carry-over from last month → check it", ja: "月の設定 → 前月末の接続 を確認" },
    LINT_NO_CHARGE_CANDIDATE: { en: "No one can take {charge} duty on {day} (everyone is unavailable, or has outside work the next morning)", ja: "{day} の{charge}担当になれる人がいません（全員が不可、または翌朝外勤）" },
    LINT_NO_CHARGE_CANDIDATE_HINT: { en: "Per-person calendar: review unavailability and next-day outside work for {charge} ({who})", ja: "{person}別カレンダー で{charge}（{who}）の不可・翌日の外勤を見直す" },
    LINT_RUN_VS_CONSECUTIVE_MAX: { en: "The longest-run rule is used together with \"no work on consecutive days\"", ja: "連勤の上限と「連日の実勤務は禁止」を同時に使っています" },
    LINT_RUN_VS_CONSECUTIVE_MAX_HINT: { en: "Runs cannot happen while consecutive days are forbidden. Set \"working on consecutive days\" or the longest-run rule to None", ja: "連日を禁止しているので連勤は起きません。設定タブで「連日の実勤務」を「なし」にするか、連勤の上限を「なし」にしてください" },
    LINT_RUN_VS_CONSECUTIVE_MIN: { en: "The shortest-run rule is used together with \"no work on consecutive days\"", ja: "連勤の下限と「連日の実勤務は禁止」を同時に使っています" },
    LINT_RUN_VS_CONSECUTIVE_MIN_HINT: { en: "The minimum cannot be met while consecutive days are forbidden. Set \"working on consecutive days\" to None", ja: "連日を禁止しているので下限は満たせません。設定タブで「連日の実勤務」を「なし」にしてください" },
    LINT_RUN_MIN_OVER_MAX: { en: "The shortest run ({min} days) is longer than the longest run ({max} days)", ja: "連勤の下限（{min} 日）が上限（{max} 日）より大きいです" },
    LINT_RUN_MIN_OVER_MAX_HINT: { en: "Review the run lengths on the settings tab", ja: "設定タブの連勤の日数を見直してください" },
    LINT_ROLE_NOT_LISTED: { en: "Roles on the roster are not in the role table: {who}", ja: "名簿の役割が役割一覧にありません: {who}" },
    LINT_ROLE_NOT_LISTED_HINT: { en: "Add \"{role}\" to the role table on the settings tab, or pick another role for those people", ja: "設定タブの役割の表に「{role}」を足すか、その{person}の役割を選び直してください" },
    LINT_ROLE_REF_MISSING: { en: "No role has the part \"{ref}\" in the rules", ja: "規則での役目「{ref}」を持つ役割がありません" },
    LINT_ROLE_REF_MISSING_HINT: { en: "Give that part to one of the roles on the settings tab, or set the rule that uses it to None", ja: "設定タブの役割の表でどれかの役割にその機能を付けるか、対応する規則を「なし」にしてください" },
    LINT_PROFILE_MISMATCH: { en: "This month's data belongs to another facility ({got}); the current settings are {want}", ja: "この月データは別の施設（{got}）のものです。いまの設定は {want} です" },
    LINT_PROFILE_MISMATCH_HINT: { en: "At the top of the month settings, press \"Make this month belong to the current facility ({want})\" or \"Revert the settings to this month's facility ({got})\" — or create a new month for the current facility (month list in the header). The month data also lives in the browser, so deleting the month folder does not remove it (to start over, use \"Clear the browser's saved state and start over\" on the start screen)", ja: "月の設定の先頭にある「この月をいまの施設（{want}）の月にする」か「設定をこの月の施設（{got}）に戻す」を押してください。いまの施設の月を新しく作るのでもよいです（ヘッダーの月の一覧）。月データはブラウザ内にも残るので、フォルダの月を消しても消えません（まっさらにするには開始画面の「ブラウザ内の保存を消して最初から始める」）" },
    LINT_BUSY_DAYS_TOO_MANY: { en: "The {people} people must work {supply} days in total (days off are fixed exactly), but the slots need only {need} working days (night shifts count the post-night day too). {diff} days are left over, so there is no solution", ja: "この月は {people} 人の勤務日が合わせて {supply} 日（休みの日数がちょうど決まっているため）ですが、枠が求める延べの勤務日は {need} 日です（夜勤は明けの日も数えます）。{diff} 日分余るので解がありません" },
    LINT_BUSY_DAYS_TOO_MANY_HINT: { en: "Fix one of these: enter {diff} more days of paid leave in total; raise the upper head count of a shift (in \"Set up the facility\"); or remove people from the roster (one person is {per} days)", ja: "どれかで合わせてください: 有給を合計 {diff} 日入れる／「施設の構成を作る」で勤務帯の人数の上限を上げる／名簿の人数を減らす（1 人で {per} 日分）" },
    LINT_BUSY_DAYS_TOO_FEW: { en: "The {people} people can work at most {supply} days in total, but the slots need at least {need} working days (night shifts count the post-night day too). {diff} days are missing, so there is no solution", ja: "この月は {people} 人の勤務日が合わせて最大 {supply} 日ですが、枠が求める延べの勤務日は最低 {need} 日です（夜勤は明けの日も数えます）。{diff} 日分足りないので解がありません" },
    LINT_BUSY_DAYS_TOO_FEW_HINT: { en: "Fix one of these: add people to the roster (one person is {per} days); lower the minimum head count of a shift (in \"Set up the facility\"); or review the days-off rule", ja: "どれかで合わせてください: 名簿に人を足す（1 人で {per} 日分）／「施設の構成を作る」で勤務帯の人数の下限を下げる／休みの日数の決め方を見直す" },
    LINT_SHIFT_CAPACITY: { en: "{shift} shifts need at least {need} working days, but the people who can take them have only {cap}", ja: "{shift}には延べ最低 {need} 日の勤務が要りますが、{shift}に入れる人の勤務日は合わせて {cap} 日です" },
    LINT_SHIFT_CAPACITY_HINT: { en: "Allow more people on this shift (check \"max 0\" conditions in the composition rule), or lower its head count", ja: "構成の規則で「最大 0」にしている条件を見直すか、この勤務帯の人数を減らしてください" },
    LINT_COMPOSITION_TOO_FEW_PEOPLE: { en: "Composition \"{cond}\" on {shift} needs at least {min} per slot, but only {have} people meet it", ja: "構成の規則「{cond}」は{shift}の枠ごとに {min} 人以上が必要ですが、条件に合う人が {have} 人しかいません" },
    LINT_COMPOSITION_TOO_FEW_PEOPLE_HINT: { en: "Give the qualification to more people in the roster, or lower the minimum", ja: "名簿で資格を持つ人を増やすか、最低人数を下げてください" },
    LINT_COMPOSITION_CAPACITY: { en: "Composition \"{cond}\" on {shift} needs {need} working days in total, but the {who} people who meet it can work only {cap} days", ja: "構成の規則「{cond}」は{shift}に延べ {need} 日分が必要ですが、条件に合う {who} 人の勤務日は合わせて {cap} 日です" },
    LINT_COMPOSITION_CAPACITY_HINT: { en: "Give the qualification to more people, or lower the minimum or limit the days it applies to", ja: "資格を持つ人を増やすか、最低人数を下げる・効く日を絞る（平日だけなど）かしてください" },
    LINT_PERSON_TOO_FEW_DAYS: { en: "{who} can work on only {avail} days this month (unavailable days, paid leave and composition rules considered), but must work {need} days (days off are fixed)", ja: "{who} は今月 {avail} 日しか勤務に入れません（不可・有給・構成の規則を考えた結果）が、休みの日数から {need} 日の勤務が要ります" },
    LINT_PERSON_TOO_FEW_DAYS_HINT: { en: "Reduce this person's unavailable days, add paid leave, or relax the composition rule that keeps them out of some shifts", ja: "不可日を減らす・有給を入れる・その人を外している構成の規則を見直す、のどれかで合わせてください" },
    LINT_PERSON_FORCED_RUN: { en: "{who} must work every day they can in order to meet the required days, which makes {len} days in a row from {from} (maximum {max})", ja: "{who} は休みの日数を満たすには入れる日を全部勤務するしかなく、{from} から {len} 連勤になります（上限 {max} 日）" },
    LINT_PERSON_FORCED_RUN_HINT: { en: "If this person normally works these days in a row (e.g. a head nurse on weekdays), add their qualification to \"exempt\" in the maximum-run rule; otherwise widen the days they can work", ja: "平日に続けて勤務するのが普通の人（師長など）なら、連勤の上限の「対象外の資格」にその資格を足してください。そうでなければ入れる日を増やしてください" },
    LINT_CAPACITY_HIGH: { en: "There are {need} slots but the upper bounds add up to only {total} (each person's target + {tol})", ja: "枠が {need} なのに、勤務回数の上限の合計が {total} しかありません（各{person}の目安+{tol}）" },
    LINT_CAPACITY_HIGH_HINT: { en: "Raise the targets on the settings tab, or add duty candidates. Even at everyone's maximum the slots cannot be filled", ja: "設定タブで目安を増やすか、当直候補の{person}を増やしてください。全員を上限まで入れても枠が埋まりません" },
    LINT_CAPACITY_LOW: { en: "There are {need} slots but the lower bounds add up to {total} (each person's target − {tol})", ja: "枠が {need} なのに、勤務回数の下限の合計が {total} あります（各{person}の目安−{tol}）" },
    LINT_CAPACITY_LOW_HINT: { en: "Lower the targets on the settings tab. Even at everyone's minimum there are not enough slots", ja: "設定タブで目安を減らしてください。全員を下限まで減らしても枠が足りません" },
    LINT_SLOT_NO_CANDIDATE: { en: "No one can work {day} {slot}", ja: "{day} {slot} に勤務できる{person}がいません" },
    LINT_SLOT_NO_CANDIDATE_HINT: { en: "Per-person calendar: review unavailability and duties", ja: "{person}別カレンダー で不可と業務を見直す" },
    LINT_PERSON_TOO_FEW_SLOTS: { en: "{who} can work only {count} slots, short of the target {quota} − {tol}", ja: "{who} は勤務できる枠が {count} 枠しかなく、目安 {quota}−{tol} 回に足りません" },
    LINT_PERSON_TOO_FEW_SLOTS_HINT: { en: "Per-person calendar → {who}: review unavailability and duties, or change the target in the settings", ja: "{person}別カレンダー → {who} の不可・業務を見直すか、設定で目安を変更" },
    LINT_FRIDAY_TOO_FEW: { en: "{who} can work only {count} Friday nights, short of the minimum {min}", ja: "{who} が勤務できる金曜夜勤が {count} 枠で、最低 {min} 回に足りません" },
    LINT_FRIDAY_TOO_FEW_HINT: { en: "Per-person calendar → {who}: review Friday unavailability and Saturday outside work", ja: "{person}別カレンダー → {who} の金曜の不可・土曜の外勤を見直す" },
    LINT_CATH_OTHER_TOO_FEW: { en: "{day} {half}: {count} {other} available ({who}) for {need} needed — short on duties alone, and fewer still once night-shift leavers are excluded", ja: "{day} {half}: {other}の担当候補が {count} 人（{who}）で必要 {need} 人に足りません（外来・外勤・不在の設定だけで不足。夜勤明けを除くと更に減ります）" },
    LINT_CATH_OTHER_TOO_FEW_HINT: { en: "Per-person calendar: review the duties of {other} ({who}), or check the required numbers in the settings", ja: "{person}別カレンダー で{other}の担当（{who}）の業務を見直すか、設定の必要人数を確認" },
    LINT_CATH_CHARGE_TOO_FEW: { en: "{day} {half}: {count} {charge} available for {need} needed", ja: "{day} {half}: {charge}の担当候補が {count} 人で必要 {need} 人に足りません" },
    LINT_CATH_CHARGE_TOO_FEW_HINT: { en: "Per-person calendar: review the duties of {charge}", ja: "{person}別カレンダー で{charge}の担当の業務を見直す" },
    LINT_CATH_CLINIC_TOO_FEW: { en: "{day} afternoon: {count} {other} available for the specialty clinic, against {need} on the specialty duty + 1 in clinic", ja: "{day} 午後: 専門外来の{other}の候補が {count} 人で、専門業務 {need} 人＋外来 1 人に足りません" },
    LINT_CATH_CLINIC_TOO_FEW_HINT: { en: "Per-person calendar: review the afternoon duties of {other} on that weekday", ja: "{person}別カレンダー で{other}のその曜日の午後の業務を見直す" },
    LINT_CATH_CLINIC_NO_JUNIOR: { en: "{day} afternoon: no {junior} available for the specialty clinic", ja: "{day} 午後: 専門外来に出せる{junior}がいません" },
    LINT_CATH_CLINIC_NO_JUNIOR_HINT: { en: "Per-person calendar: review the afternoon duties of {junior} on that weekday", ja: "{person}別カレンダー で{junior}のその曜日の午後の業務を見直す" },
    LINT_DAYS_OFF_TOO_MANY: { en: "The monthly minimum of days off ({min}) is not less than the number of days in the month ({N})", ja: "月の休みの最低日数（{min} 日）が暦の日数（{N} 日）以上です" },
    LINT_DAYS_OFF_TOO_MANY_HINT: { en: "Review the scheduled hours under settings → rules → minimum days off per month", ja: "設定タブ → 規則 → 月の休みの最低日数 の所定労働時間を見直してください" },
    LINT_QUOTA_VS_DAYS_OFF: { en: "{who}'s target of {quota} shifts does not fit with {min} days off a month (at most {maxWork} working days)", ja: "{who} の勤務の目安 {quota} 回は、月の休み {min} 日を取ると入りきりません（勤務できるのは最大 {maxWork} 日）" },
    LINT_QUOTA_VS_DAYS_OFF_HINT: { en: "Lower the target on the settings tab, or review the minimum days off", ja: "設定タブで目安を減らすか、休みの最低日数を見直す" },
    LINT_PAIR_VS_DAYS_OFF: { en: "{pair} two-day breaks need {days} days off, but the monthly minimum of days off is {min}", ja: "2 連休 {pair} 回には休みが {days} 日要りますが、月の休みの最低日数は {min} 日です" },
    LINT_PAIR_VS_DAYS_OFF_HINT: { en: "Review the minimum number of two-day breaks or the minimum days off under settings → rules", ja: "設定タブ → 規則 → 2 連休の最低回数 か 月の休みの最低日数 を見直す" },
    LINT_REST_DAY_IMPOSSIBLE: { en: "{who} has outside work and so needs one weekly rest day, but no day shift on a day off or night before one is open to them", ja: "{who} は外勤があるので週休日が1日必要ですが、休日の日勤・休日前日の夜勤に入れる枠がありません" },
    LINT_REST_DAY_IMPOSSIBLE_HINT: { en: "Per-person calendar → {who}: review the unavailability", ja: "{person}別カレンダー → {who} の不可を見直す" },
  };

  // code と差し込む値から文面を作る。文面は「その言語の lang ファイル → 英語 → 日本語」の順に探す
  // （日本語のときは英語へ落とさない。lang ファイルは webapp/lang/<コード>.json）
  function msg(code, args, rules) {
    const m = MSG[code] || null;
    const lang = T.lang ? T.lang() : "ja";
    const of = c => ((T.langData && T.langData(c)) || {}).msg || {};
    let s = of(lang)[code];
    if (s == null) s = lang === "ja" ? (m && m.ja) : (of("en")[code] != null ? of("en")[code] : (m && (m.en || m.ja)));
    if (s == null) s = m && (m.ja || m.en);
    if (s == null) return args && Object.keys(args).length ? `${code} ${JSON.stringify(args)}` : String(code);
    if (args) s = s.replace(/\{(\w+)\}/g, (x, k) => (args[k] === undefined || args[k] === null ? x : String(args[k])));
    if (T.person) s = T.person(s); // 名簿の人の呼び方（{person} など。「職員」に統一）
    return T.term ? T.term(s, rules) : s;
  }

  for (const d of (T.rules ? T.rules.defs : [])) if (d.messages) Object.assign(MSG, d.messages); // 先に登録されたプラグインの文面
  T.MSG = MSG; T.msg = msg;
})(globalThis.T = globalThis.T || {});

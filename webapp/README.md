# 当直表作成アプリ（toban.html）

ファイルサーバーに置いた1枚の HTML を Edge で開くだけで、月別条件の入力、配置の計算（HiGHS 整数計画ソルバーを WASM で内蔵、別スレッドで実行）、
検算・集計の表示、当直表 docx と説明資料 HTML の出力ができる。外部通信なし。LLM は使わない。
運用の正本は JS 版（このアプリ）。Python 版（`../tools/toban.py`）は同じ制約の別実装で、相互検算に使う。

## ファイル

- `toban.html` — 配布物（約5MB）。これだけをコピーして使う。ライセンスはヘルプ末尾（MIT。同梱の HiGHS / highs-js / JSZip / pako も MIT）
- `toban-probe.html` — 本番環境の動作検査（WASM・Worker・ファイル読込・ダウンロード・保存領域）
- `synth_sample.py` — 同梱の見本（勤務医の見本（架空の例））の入力を乱数から作り直す（年数・業務・不可・希望・固定・前月末・履歴。入力チェックに引っかからず解ける組が出るまで振り直し、保存データ形式の見本は計算結果も作る）。実データ由来の並びを公開物に残さないための道具
- `build.py` — `src/`・`libs/`・`data/`・共通ルール.md から `toban.html` を組み立てる（`../tools/.venv/bin/python build.py`）。`--plugins <施設の部品フォルダ>` で施設の部品（規則・暦・docx の様式・訳・プロファイル）を取り込む（`../plugin-example/README.md`）。
  `../tools/rules.yaml` から `data/rules.json` も生成する（手書きしない）。埋め込む文字列はすべて `</script` と `<!--` を無害化する
- `src/` — 読み込み順は `build.py` の `SRC_FILES`
  - `model.js` 暦・入力の読み取り（`Problem`）・暦の登録口（`T.calendars`）・曜日パターンの展開と推定（`inferPatterns` はアプリでは未使用。翌月作成は「翌月へ引き継ぐ」を付けた行だけを引き継ぐ）・翌月1日の推定・勤務目標の自動調整・規則と月データの正規化（`fillDefaultRules` / `normalizeMonth`）・共通ヘルパー（`esc`, `KINDS`, `isDutyCandidate`）
  - `rules-core.js` 規則の部品の登録（`T.rules.register`）と共通の道具（解く側 `solveCtx`・検算 `checkCtx`・3 状態の `limit`・名簿の欄 `columns`）。設計は `../docs/rule-modules.md`
  - 勤務回数の目安は `profile.quota_mode`（`absolute`＝名簿の `quota`／`share`＝名簿の `share` で按分。`P.quota(n)`）
  - `calendars/<id>.js` 暦の部品（祝日の出どころ。`T.calendars.register`。いまは `jp`。`none` は本体）。施設の休日はプロファイルの `calendar.closure`
  - `rules/<id>.js` 規則の部品（2026-09-25 時点で 35 個）。1 規則につき解く側 `solve`・検算 `check`・減点 `penalty`・設定欄 `params` / `ui`・名簿の欄 `columns`・説明資料の行 `report`・文面 `messages`・試験の設定 `fixtures` を 1 ファイルに持つ
  - `solver.js` 必須条件と調整目標を LP に組み立てて HiGHS で解く。`solve` は同期・非同期の両対応、`solveWithAvoidRef` は避けたい日の参照解方式、`diagnose` は解なし診断
  - `check.js` 割当の独立検算（`check` → `{V: 違反, W: 固定指定により許容, charge, A}`）、専門業務の配置、集計、入力チェック（`lint`。規則ごとの分は部品の `lint`）
  - `report.js` 結果 HTML（第1〜10節。第 9 節の行は部品の `report` が出す）
  - `docxgen.js` 当直表 docx（OOXML 直書き、JSZip）
  - `merge.js` 月データの3者統合（`flattenMonth` / `unflattenMonth` / `mergeMonth`）
  - `app-*.js` 画面（7ファイル）。`T.app`（各ファイル内では `A`）を介して互いを参照する。他のファイルの関数・共有変数は必ず `A.` を付け、呼ばれる側の末尾 `Object.assign(A, {...})` に名前を足す（`build.py --check` が検査。`jsscan.py` はその走査器）
    - `app-core.js` 共有状態（`A.state`, `A.dirHandle` など）・保存署名（`sig` / `isDirty`）・ブラウザ内保存・共通ヘルパー・確認ダイアログ（`choose`）
    - `app-folder.js` フォルダ接続（File System Access API）・開始画面・保存と版の書き出し（`saveToFolder`）・別PCとの自動統合（`tryAutoMerge` / `checkConflict`）・ヘッダー（月の一覧・保存状態）
    - `app-month.js` 月データの作成（`blankMonth` / `fromPrevious` / `applyConnection`）・月の切替（`onMonthChange`）
    - `app-input.js` 月の設定と医師別カレンダーの描画・読み戻し
    - `app-settings.js` 設定タブ（名簿・重み）・改名時の月データの追随
    - `app-solve.js` 計算（HiGHS を Web Worker で実行）・結果の表示（3-1 結果／3-2 医師別カレンダー `renderDocCal`）・docx / 説明資料のダウンロード
    - `app-main.js` 起動（タブ・イベント・初期化）
  - `index.html`（ヘルプを含む）, `style.css`
- `libs/` — highs.js / highs.wasm（highs-js 1.15.2 = HiGHS 1.15）、jszip.min.js（3.10.1）
- `data/` — rules.json（build.py が生成）、202611.json（曜日パターン形式のサンプル月。`synth_sample.py` が乱数から作る合成データ）、js_assignment*.json（テスト用の割当）
- `202611/` 等 — 月ごとのフォルダ（保存データ JSON・docx・説明資料）。運用中のデータなのでテストからは参照しない（テストは `data/202611_data_test.json` の固定した写しを使う）。`旧/` は退避したもの
- テスト — `sh run_tests.sh [highs の npm パッケージのパス]` で一式を実行（下記）

## 使い方（利用者向け）

ヘルプタブ（アプリ内）が正。要点:

1. 開くと開始画面が出る。「開始（前回のフォルダに再接続）」または「フォルダを開いて開始」でフォルダに接続してから始める（ブラウザの許可はこの操作の中で求められる）。
2. ヘッダーの月の一覧で月を選ぶ。保存データがあれば開き、無ければ前月から作るか空で作るかを選ぶ。
3. 「1 月別条件」の月の設定（暦・目標・固定の一覧・前月末の接続・履歴・専門業務の配置）と、医師別カレンダー（午前・午後の業務、不可・避、希望、固定、翌月1日欄、曜日パターン）を入力する。
4. 「2 計算」。入力の矛盾は計算前に具体名で指摘し、解なしのときは衝突している条件を診断する。計算は別スレッドなので画面は固まらない。
5. 「3 結果」で検算（違反／固定指定により許容した条件）と集計を確認し、表題（確認版／確定版）を選ぶ。計算が成功すると自動でフォルダに保存し、当直表 docx と説明資料 HTML は版番号付きで追加される（上書きしない）。

## 保存と照合

- 保存データ `YYYYMM_data.json` は `{rules, month, result, saved_at}`。`rules` はその月で使った設定（名簿・重み）で、設定タブの値はここから読む。
  役割（チーム）は `rules.profile.roles = [{id, label, refs, standby}]`。識別子・数・表示名は施設が決める。規則は識別子ではなく役目
  （`refs`: charge / other / junior / reserve）を見る。`P.byRole[id]`、`P.refId(ref)`、`P.isRole(name, ref)`、`P.isStandby(name)` を使い、
  `P.I` / `P.A` / `P.Y` は役目から引く別名。オンコール構成 `oncall_requirement` は行も列も役割の識別子。
  連勤は `rules.run_length = {max, min}`（規則 `run_length_max` / `run_length_min`）。勤務帯のつながりの禁止（明け休み）は
  `rules.forbid_sequence = [{from, to}]`（規則 `shift_sequence`。`to: "any"` はその日のすべての帯）。前月末と翌月1日の固定も連勤の窓に入る。
  1 枠に置く勤務者の人数は `rules.profile.positions.work.count`（整数 / 勤務帯ごと / 日の種別ごと）。`P.countOf(slot)` が返す。
  割当は 1 名なら文字列、複数名なら配列で、読み出しは `Asg.workers(slot)` と `Asg.workText(slot)` に一本化してある。
  複数名の設定では `oncall` / `period_charge` / `same_day_team` を「なし」にしないと `Problem` が止まる（勤務者 1 名が前提の規則のため）。
  勤務帯（当番枠の種別）は `rules.profile.shifts` で決める（`{id, label, on}`。on は off_days / all / weekdays）。id は `day` と `night` の 2 つで、
  知らない id は `Problem` が理由を添えて止める。「その日にその枠があるか」の判定は `P.slotExists(d, kind)` を使う（`isHoliday` で代用しない）。
  設定タブの「必須条件の設定」には**施設プロファイルの選択**（同梱は `data/profiles/*.json`。`build.py` が `T.PROFILES` として埋め込む）と、
  **規則の状態の表**がある。規則ごとに「必須（守れないときは解なし）／減点（重みで避ける）／なし」を選ぶ。
  一覧と既定値は `model.js` の `RULE_DEFS`、保存先は `rules.rule_states`。旧キー（`rest_day_required`, `same_day_IA`,
  `arrhythmia_pre_workday_night`）は読み込み時に状態へ読み替え、保存時に状態から書き戻す（Python 版と旧版の HTML のため）。
  「減点」にしたときの重みは `RULE_DEFS` の `w0` を `fillDefaultRules` が `rules.weights` に書き出すので、解くときの隠れた既定値は無い。
  Python 版は「必須」と「なし」だけを実装し、未対応の「減点」を指定した設定では止まる（相互検算が意味を持たなくなるため）。
  その他に設定タブで変えられる規則: `quota_tolerance`, `oncall_requirement`, `cath_requirement`, `exclude_post_night_from_cath`, `rest_day_required`, `pm_external_night`（confirm/forbid/allow）, `same_day_IA`（forbid/allow）, `arrhythmia_pre_workday_night`, `max_same_weekday_shifts`, `weekend_balance_max_diff`。solver.js / check.js / toban.py が同じキーを読む（`Problem` の `restDayRequired` / `pmExtNightBanned()` / `sameDayIABanned`）。
  組み込みの版と食い違う項目は設定タブに注意書きが出る（重みは「重みを既定に戻す」で配布時の値に）。
- ブラウザ内（localStorage）にも状態を持つが、キーは HTML の場所ごと（`toban_state_v2:<パス>`）。同じ PC の別コピーとは混ざらない。
- フォルダ接続時と保存の直前に `saved_at` で版を照合する。自分が最後に同期した版と違えば、最後に保存した版を元に3者統合を自動で行う（衝突した項目だけ確認）。
  時刻の大小は使わない（別 PC の時計がずれていても安全）。共通の元が無いとき（このブラウザで初めて扱う月に未保存の変更があるとき）だけ「読み込む／上書き」を聞く。
- 固定指定の表は `fixed.{day,night,weekend_charge,day_oc,night_oc,day_oc_none,night_oc_none}`（`*_oc_none` は「若手OCなし」などチーム名の配列。`Problem.ocNone(s, team)`）。医師別カレンダーの「固定」欄と「固定配置」画面（`renderFixed`）は同じ表を編集する。`readAll` は表示中の画面だけを読み戻す。
  `fixed.day` / `fixed.night` の値は勤務者の名前で、1 枠に複数名を置く施設では配列（`"6": ["Ns A", "Ns B"]`）。1 名なら文字列のまま（従来の保存データと同じ）。枠の人数を超える固定は入力チェック（`LINT_FIXED_OVER_COUNT`）が知らせる。
  `fixed_tags`（`"日:勤務帯|名前": "研修"`）は固定の印で、固定配置の画面で「名前(印)」と書くと入り、勤務表（月の表の docx・説明資料）に名前(印)で出る。
  `day_flags`（`{"9": ["<区分 id>"]}`）は日ごとの区分で、種類は施設の部品が `T.dayFlags.register({id, label})` で登録する（月別条件タブの「日ごとの区分・予定」の列になる）。
  `day_notes`（`{"5": "1年目研修"}`）は日ごとの予定の文（同じ表の右端。勤務表の様式が使える）
- 統合の単位は医師×日×時間帯など（`merge.js` の `flattenMonth`）。不可・避は医師×日で 1 項目だが、同じ日に条件がいくつかあるときは `"day+avoid_night"` のように並べた値にして、どれも落とさない（同じ時間帯の不可と避も両方残す。その枠を固定すると不可は許容になるが、避の減点は残るため。表示の優先と重複の注意は画面と入力チェックの役目）。手元で改名した後の統合は、先に設定の採用先を決め、氏名を採用する名簿に揃えてから比べる: 自分の設定を使うなら改名の記録（`state.renames`。最後に同期してからの氏名の変更と名簿から外したことを、起きた順にすべて持つ。使うときに `T.effectiveRenames` が人ごとの連なりにして、共通の元の名簿にいた人から始まる対応だけを取り出す。同期の後に足した人が空いた氏名を使っても、相手の版の元の人と取り違えない。名簿から外した人は当月の入力に印を付けて比べ、相手がその人の入力を変えていれば確認に戻る。履歴・前月末の接続は記録なので触らない）を相手の月と共通の元に当て、相手の設定を使うなら手元の月を改名の前の氏名に戻す（`T.renameEverywhere`。プラグインの `rename` フックも呼ぶ。失敗したら統合を止める）。採用する名簿にいない氏名が統合で新しく入るとき（両方が同じ人を別の氏名に変えたなど）は自動で統合せず、読み込むか上書きするかの確認に戻る。計算結果は新しい方を採るが、氏名は採用する名簿に揃える（割当・変更前の割当・避けたい日の基準回数とも）。揃えられない結果は採らず、どちらも採れなければ結果なしにして再計算を促す。共通の元そのものは書き換えない。月データに項目を足すときは `flattenMonth` / `unflattenMonth` / `label` と `normalizeMonth`（model.js）を更新する。
  `test_refine_node.js` が実データの全項目の往復を検査する。
- 「変更の3秒後に自動保存」。フォルダの読み書きに失敗したときは接続を切って知らせ、入力はブラウザ内に残る。

## 固定指定の優先

固定した枠・医師については、不可・連続担当の禁止・定期業務の翌日制約・副担当責任医師の平日夜勤禁止・目安+1を超える回数を適用しない。
競合した条件は減点（`fixed_conflict`）のうえ、検算で「固定指定により許容した条件」として別に表示する（判定は違反に関わる日・医師と固定指定の照合。文言には依存しない）。
枠の充足・チーム構成・主担当担当の日ごとの一貫性・専門業務の必要人数（プラグイン）は固定でも緩めない。

## Python 版との関係

`../tools/toban.py`（OR-Tools CP-SAT）は同じ制約の別実装。`toban.py solve <月別条件.yaml | アプリの保存JSON>` と `check` があり、
アプリの保存 JSON を渡すと保存データ側の規則で解く（`--rules` で上書き可）。相互検算は `run_tests.sh` の最後で行う
（`test_node.js`）。合格の条件は次の 4 つで、1 つでも外れればテストが失敗する。

1. Python の割当を JS で検算して、必須条件の違反 0 件
2. JS で解いた割当を JS で検算して、違反 0 件
3. JS の割当を Python で検算して（`toban.py check`）、違反 0 件
4. 2 つの割当それぞれを両方の実装で採点して（全枠を固定して解く。JS は `solve(P, highs, {pin})`、Python は `toban.py score`）、減点の合計が一致する

当番表そのものの一致は求めない（最良の解は複数ありうる）。4 は制約と減点の式の食い違いを捕まえるためのもので、
希望（夜勤・休日日勤）は両方とも「叶わなかった件数 × 重み」で数える。

## テスト

- `test_calendar_day_readback_node.js` — 数値文字列で読み込んだ日勤・夜勤希望と夜勤不可をカレンダーに表示し、無関係な編集・保存・再読込でも日付を落とさず、明示的な解除ができることを架空データとDOM代替で確かめる
- `test_next_fixed_work_slots_node.js` — 存在しない翌月勤務帯の古い固定入力を保持したまま、連日・連勤・勤務帯のつながり・明け休み・勤務間隔の判定に実在する枠だけを数えることを解く側・検算・減点・説明資料で確かめる
- `test_fixed_oc_capacity_node.js` — 同じ役割のOCを複数名必要とする設定で、固定OCの入力チェックが一律1名ではなく勤務者に応じた必要数と照合し、人数超過・OCなし・無効な勤務帯も見分けることを架空データで確かめる
- `test_role_delete_preservation_node.js` — 使用中の役割の削除後に職員を別の役割へ勝手に移さず、未指定・不明な役割を無関係な編集で保持し、キャンセルとUndoで入力を守ることを架空データで確かめる
- `test_oc_period_boundary_node.js` — 夜勤のみの月末土曜から翌月日曜へ同じ週末の期間責任者が継続するとき、連続OCの減点を重ねず、実在しない翌月枠を数えないことを対照例とともに確かめる
- `test_history_numeric_carry_node.js` — 数値文字列の履歴を前月から取り込むとき、週末・祝日担当の累計と勤務回数の過不足を文字列連結せず加算し、小数の目安・累計、年越し・閏年、未計算月を保持することを架空データで確かめる
- `test_fractional_targets_node.js` — 小数の目安・当月目標を保持し、解く側・検算の減点と参照実装の扱いが一致すること、不正な数値を計算前に止めること、自動調整が小数の残りを超えて増減しないことを架空データで確かめる
- `test_role_edit_preservation_node.js` — 役割の識別子・機能の不正な編集が名簿、OC構成、固定指定を壊さず、正常な改名が対応を保つことを架空データで確かめる
- `test_undo_profile_identity_node.js` — プロファイルの読み込みを取り消した後も、保存・統合で別の職員へ入力が移らないことと、実際の改名の取り消しを確かめる
- `test_period_charge_next_slot_node.js` — 月末土曜から翌月日曜への期間責任者の接続が、翌月の最初の勤務帯（日勤または夜勤）の固定勤務・OCと一致することを解く側・検算・入力チェック・翌月作成で確かめる

```
sh run_tests.sh /path/to/node_modules/highs
```

- `test_input_escape_node.js` — JSON から復元した数値欄・日付の一覧も HTML 属性として無害化されることを、設定・月別入力・規則の欄で検査する（架空の文字列、Python 標準の HTMLParser。ブラウザでの実行試験ではない）
- `test_delimited_names_node.js` — 氏名に `:`・`|` があるときも、月データの統合・履歴の読み戻し・固定の印・前月末の接続・翌月への引き継ぎ・固定指定の例外判定で人や入力を取り違えないことを架空データで確かめる
- `test_refine_node.js` — assert 付きの回帰テスト（名簿の正規化、規則の欠損補完、固定指定の検算分類、docx の整形式、統合の往復、避パターン展開）
- `test_merge_node.js` `test_docx_node.js` `test_dutydays_node.js` `test_infer_node.js` `test_prevconn_node.js` `test_lint_node.js` — 各機能の確認（出力を目視）
- `test_node.js` — Python 版との突き合わせ（上の 4 条件。外れれば失敗）
- `test_penalty_node.js` — 減点の二重実装の突き合わせ。解いた割当について、検算の側で数え直した減点の合計（`check.js` の `penalty`）と、解く側の目的関数の値（同じ割当に全枠を固定して解いた値）が一致することを、見本の施設 4 種と規則の状態を変えた設定 19 通りで確かめる。乱数の重みで崩した割当（`solve` の `jitter`）も使い、どの設定でも 0 点だった項があれば一覧に出す
- `test_plugins_node.js` — 施設の部品の見本（`../plugin-example`）が登録の検査を通り、解けて、`build.py --plugins` で取り込めるか
- `test_profile_export_node.js` `test_save_node.js` `test_solve_guard_node.js` — 画面の層の検査（共有用プロファイルの匿名化、フォルダ保存の版と署名・保存中の切替、計算の入口の守り）。DOM・フォルダ・帳票の生成は代替
- `../plugin-example/test_local_data_node.js` — プラグインの独自データの約束（`plugin-example/README.md` 6）のひな形の試験。施設の `plugins/` に複製して使う。一式では見本のプラグインに対して走らせる
- `test_browser_e2e.js` — 実ブラウザの通し試験（Playwright ＋ インストール済みの Google Chrome、ヘッドレス）。編集→保存→閉じる→再読込、同名の別フォルダへ切替、プラグイン欠落時の計算・出力・直接ダウンロードの停止、共有用書き出し、外部 JSON の読込と再開、JSON のダウンロード後の自動保存、医師別カレンダーの読み戻し 2 本（規則を「なし」にした有給の値の保持、日勤と期間責任者の両方の固定の保持）、名簿から外した人の条件が共有用の書き出しに残らないこと、固定配置を開いた後の改名で固定が旧名へ戻らないこと、月の読取り中の保存フォルダの変更と起動時の自動の再接続（読取りを保留して操作）、同じ日の不可と「避」の保持、プラグインの日ごとの欄の旧値の保持、実行時に足した表示言語、照合中の自動保存、施設の設定の言語、日の種別ごとの人数の保持、役割の識別子の変更、改名の後の統合で相手の設定を使う場合、改名の後の統合で相手の新しい計算結果を採る場合、固定配置の画面の 2 人目の固定 OC、配置禁止にした人の目標と累計、結果の職員別カレンダーの休みの日数の 24 本を、画面の操作から保存されたファイルまで確かめる（約 2 分）。偽のフォルダは IndexedDB に場所だけを覚え、同じ context で開き直すと権限が残っているときの自動の再接続を通る。フォルダは Node 側に置いた偽の FileSystemDirectoryHandle。`cd ~/.toban-test && npm i playwright` で入れると `run_tests.sh` が走らせる（無ければ省略）
- `lint_same_node.js` — 入力チェックを部品に移すときの確認。git の版と いまの src で、見本の施設とわざと矛盾を入れた月の指摘の集合が同じかを比べる（`node lint_same_node.js HEAD`）
- `lp_same_node.js` — 規則を部品に移すときの確認。git の版と いまの src で、解く側に渡す LP の文字列が同じかを 8 設定で比べる（`node lp_same_node.js HEAD`）
- `test_oc_matrix_node.js` — OC を実際に置いた割当の照合。待機に入れる役割を持つ小さな構成で、勤務／OC の組み合わせ × 月内・前月末・翌月 1 日の固定 × 連日の必須（固定で許容）× 隣の枠（翌日の夜勤・翌日の日勤・日勤の枠を挟む夜勤）× 翌月 1 日が平日の月の勤務帯の設定を、HiGHS で全枠を固定して解き、目的関数＝減点＝規則の文から決めた期待値、検算の違反 0、説明資料の行を確かめる（104 件。数秒）
- `test_spec_examples_node.js` — 仕様の正解例。人が規則の文から決めた期待値（枠の人数・違反か許容か・減点の額・按分の目安）を、検算（`T.check`）と減点（`T.penalty`）の結果と直接突き合わせる 10 例（枠の充足、不可と固定の許容、複数名の枠、月またぎの明け休み、勤務帯ごとの連続、連勤、同日 2 枠、当月目標、0.5 人換算の按分、夜勤の希望）。3 実装の一致試験が同じ解釈違いを見逃す穴を補う
- `test_brute_node.js` — 総当たりとの突き合わせ。一度解いた割当のうち数枠（窓）だけを空け、窓に入りうる割当をすべて並べて、検算で規則を満たすものを `penalty` で採点した最小値と、同じ窓を HiGHS で解いた最適値が一致することを確かめる（見本 4 施設、15 窓、約 23 万通り）。あわせて、規則を満たす割当（50 通り以下なら全部、多ければ 30 通り）を全枠固定で解き、解く側が最適でない割当まで禁止していないかを見る。`solve` の `pin` は一部の枠だけでもよい（無い枠は固定しない）
- 画面の側の約束（新しい操作を足す人へ）: 状態を切り替える操作（月・データの読込・フォルダ・言語・プラグイン）は `A.transition(kind, fn)` に処理を渡す（計算中は断り、進行中の保存を待つ）。フォルダへの保存は `A.prepareSave` → `A.writeSave` → `A.commitSave` の 3 段階（`docs/rule-modules.md` §8）
- `build.py --check` — 画面（`app-*.js`）の相互参照の検査（`run_tests.sh` の先頭で実行。組み立て時にも同じ検査が走る）
- highs パッケージは組み込みの wasm と同じ `highs@1.15.2` を使う（`run_tests.sh` が無ければ `~/.toban-test` に入れる）

## ネットワーク共有（¥¥サーバー名）の注意

Edge のフォルダアクセス機能は UNC パス（¥¥サーバー名¥共有）を直接選ぶと認識しないことがある。共有フォルダをドライブ文字に割り当ててから選ぶ。

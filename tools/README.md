# 当直表ソルバー（toban.py）

共通ルール（docs/sample-rules-cardiology.md 版1.6）の必須条件を CP-SAT（Google OR-Tools）のハード制約、
調整目標を重み付き目的関数として解き、第9節の集計と第10節の検算をコードで出力する。
LLM の仕事は「原資料 → 月別条件YAML の転記」と「結果 → 説明資料・引継ぎの文書化」だけ。

## 実行

ホスト（venv あり）:

    cd <このリポジトリ>/tools
    .venv/bin/python toban.py solve month-conditions-template.yaml --time 60

（月別条件 YAML の書き方は `month-conditions-template.yaml` を写して使う）

サブコマンド:

| コマンド | 役割 | 出力 |
| --- | --- | --- |
| `solve <月別条件.yaml> [--time 秒] [--base-docx 既存表.docx --base-weight 30]` | 配置を計算。`--base-docx` を付けると既存案からの変更量も最小化（重み30以上でほぼ最小変更） | `YYYYMM ソルバー割当.json`、`YYYYMM ソルバー結果.md` |
| `check <月別条件.yaml> (--docx 表.docx \| --json 割当.json)` | 既存の表を必須条件に照らして検算し、集計を出す | `YYYYMM 検算結果.md` |
| `docx <月別条件.yaml> --json 割当.json --template 前月表.docx --out 出力.docx [--label 確認版]` | 前月表の書式で docx を書き出し、読み戻して一致を確認 | docx |

解なしのときは終了コード 2 と「必須条件が両立しない」旨を出す。不可日・固定指定・例外（exceptions）を作成責任者と見直す。

## ファイル

- `rules.yaml` — 名簿・目安・専門業務の資格・必要人数（プラグインの規則。既定は「なし」）・重み。共通ルールの改版時はここと `toban.py` を直す
- `YYYYMM/YYYYMM 月別条件.yaml` — 当月の入力。`202611/202611 月別条件.yaml` が記入例
- 出力の md は「ソルバー結果」「検算結果」など**濁点のない名前**にしてある（Docker 越しの NFC/NFD 不一致対策）

## 月別条件 YAML の項目

| キー | 内容 |
| --- | --- |
| `year`, `month`, `holidays` | 対象月と土日以外の祝日（日付の数字） |
| `duties_on_holidays` | 土日祝に定期業務があるか（通常 false） |
| `next_month_first_day_is_holiday` | 翌月1日が休日なら true（月末夜勤の週休日に影響） |
| `targets` | 当月の勤務目標（省略時は目安）。目安±1の範囲内でだけ有効 |
| `regular_duties` | 全医師の外来・病棟番・外勤の曜日パターン。`{kind: outpatient\|ward\|external, dow: Mon..Sun, part: am\|pm\|full, nth: [2,4]}` |
| `duty_days` | 日別の業務（Webアプリのカレンダー形式）。`{医師: {日: {am: 種別, pm: 種別}}}`。これがある月はパターンより優先 |
| `confirmed_pm_external_night` | 午後外勤後の夜勤を「間に合う」と確認した `{day, name}` の一覧 |
| `unavailable_night` | 日付だけの不可（その日から始まる夜勤・夜間OCの不可） |
| `unavailable_other` | 時間帯付きの不可 `{name, day, part: allday\|day}`。allday はその日の日勤・夜勤とOCの不可（前夜からの担当は除外しない。未明から不可なら前日も不可にする） |
| `wishes.weekend_dayshift` / `wishes.night_on` | 土日日勤の希望者、特定日の当直希望 |
| `fixed.night` / `fixed.day` / `fixed.weekend_charge` | 固定指定（日付→氏名）。月またぎの主担当担当は `weekend_charge` |
| `fixed.day_oc` / `fixed.night_oc` | OCの固定指定（日付→氏名の配列。主担当・若手のみ） |
| `exceptions.weekend_balance_max_diff` | 週末担当の均等配分の許容差（承認済み例外のみ） |
| `allow_split_weekend` | 均等配分のために土日1組を土曜担当・日曜担当の2名で分けてよいか（既定 true。分割は減点付きで必要な組だけ） |
| `prev_month.last_days` | 前月末2日分の勤務・OC（接続の判定に使う） |
| `prev_month.last_weekend_charge` / `prev_weekend_charge` | 前月最後の週末担当と、その1つ前（連続週末の判定） |
| `history.weekend_charge` / `history.holiday_charge` | 前月までの累計（月またぎ週末は当月側で数えるので含めない） |
| `allow_chief_duty` | Dr Bを当直候補に含める（部長以外で作成不能のときだけ true） |

## 実装している必須条件

枠の充足とチーム別OC構成、勤務者とOCの重複禁止、不可日、目安±1、実勤務の連続禁止（同日・連日）、
隣接枠の連続禁止（主担当の同一土日・祝日と若手の同日兼務を除く）、非主担当の連続夜間担当禁止、
週末・祝日の主担当担当（日ごとに1名、土日は原則同一人。均等配分に必要なときだけ土曜・日曜で分割）と月またぎ接続、完全な土日の均等配分（分割は0.5組）、固定指定、金曜夜勤の最低回数（名簿で指定した人）、
定期業務（翌朝外勤・翌日午後業務・午後外勤日のOC・午後外勤後の夜勤）、
専門業務の時間帯別必要人数（プラグインの規則。既定は「なし」）、外勤者の週休日1日以上、
同日集約（I+A/A+I 不採用、I+Y/Y+I の若手兼務）。

調整目標（重みは rules.yaml の `weights`）: 当月目標との差、当直希望、土日日勤の希望、A+Y の同日集約、休日の A+A、同じ曜日の勤務が月2回を超える分（`max_same_weekday_shifts`）、
副担当責任医師の翌日が休日でない平日夜勤（`arrhythmia_pre_workday_night: avoid|forbid|allow`）、土日の分割、連続する週末、履歴込みの週末担当の偏り、週末担当者の日勤、
夜間OC翌日の業務、夜勤翌日午前業務、隣接しない連日の当番、OC・休日勤務の偏り、既存案からの変更量。

## Webアプリ版

`../webapp/toban.html`は同じ制約を JavaScript に移植し、HiGHS（WASM）で解く単一HTML。LLM不要で、職場のファイルサーバーに置いて Edge で開く。組立は `webapp/build.py`、Python版との照合は `webapp/test_node.js`。共通ルールを改版したら両方を直す。

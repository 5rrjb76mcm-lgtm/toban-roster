# 汎用化と公開の方針（草案）

> この文書は 2026-09 の設計案と作業の記録です。現行の手順・構成は `README.md`・`docs/rule-modules.md`・`plugin-example/README.md`・`docs/publishing.md`・`CONTRIBUTING.md` が正で、食い違うところは「当時の案」と注記しています。

- 版: 0.3 草案（2026-09-16。ライセンスは MIT のままとする決定と DCO の採用を反映）
- 対象: Toban Roster（当直表作成アプリ。旧称 toban）本体 `webapp/`、相互検算 `tools/toban.py`、規則の正本 `docs/sample-rules-cardiology.md`（2026-09-25 に出発点の施設のフォルダへ移した。リポジトリには無い）、既定値 `tools/rules.yaml`
- 読者: 作成責任者（依頼者本人）、将来の協力者、他施設の担当者
- 位置づけ: 実装前の方針書。実装はこの順序で、途中で止まっても運用が続くように進める
- 読み方: 第 0〜3 節と第 8〜10 節は全員向け。第 4〜7 節と第 11 節は実装者向け（設定の書き方・数式・関数名を含む）
- 続き: 2 交代制・3 交代制を見込んだ現状分析と作業の順序は内部の作業記録（公開リポジトリには含めない）にある。共通ルール 1.11 で規則の一部が設定で変えられるようになった結果も反映してある

## 0. 要約（全員向け、1 ページ）

**利用者から見て変わらないこと**

- 1 枚の HTML を共有フォルダに置き、ブラウザで開いて使う運用。外部通信なし。
- 出発点の科の保存データ（月ごとの JSON）はそのまま開け、同じ結果が出る。（当時の目標。現在は、出発点の科だけが使う 4 規則を施設のプラグインとして読み込んだ状態で同じ結果になる。本体だけでは該当の規則が無いものとして扱う）
- 医師別カレンダーと当直表 docx の見た目。

**利用者から見て変わること**

- 設定タブで、役割（例: 主担当・副担当・若手）、勤務帯（例: 日勤・夜勤・準夜・深夜）、勤務帯ごとの配置人数、それぞれの表示名を決められる。
- 規則を「型」の一覧から選んで数値を入れる形になる（連勤の上限・下限、同じ日に入れない組合せ、曜日別の上限など）。この型で表せない施設独自の規則は、施設ごとのブランチに小さなモジュールを足す。
- 画面と出力を日本語／英語で切り替えられる。

**公開の形（ライセンス）の要点**

- ライセンスは現行どおり MIT（OSI 承認のオープンソースライセンス）。同梱の HiGHS / highs-js / JSZip / pako も MIT。
- どの施設も、無償で使い、改変し、複製し、共有できる。商用利用も制限しない。他施設向けの商用サービス提供を条文で禁じる案（Elastic License 2.0 など）も検討したが、制限付きライセンスは境界事例の判断と管理が難しいため採らない（2026-09-16 決定）。
- 広める手段は条文ではなく、作成責任者による講演などの発信に置く。「オープンソース」と名乗ってよい。
- 貢献の受け入れは DCO（`Signed-off-by` の署名 1 行）で始める。

**作成責任者に決めてほしいこと**（第 10 節）

現時点で未決の項目はない。決定済み: ライセンスは MIT のまま（第 10 節 1・2・20）、貢献は DCO で受ける（第 10 節 15）、プロジェクト名は toban-roster（第 10 節 19）。

## 1. 目的と前提（全員向け）

### 1.1 何を汎用にするか

| 汎用にするもの | 現行での固定内容 | 汎用化後 |
| --- | --- | --- |
| 役割（グループ）の数と名前 | I 主担当 / A 副担当 / Y 若手 / C 部長 の 4 値がソルバー・検算・画面に直書き | 設定で定義。表示名は日英 |
| 資格タグ | `cath: A / I` の単値 | 複数タグ。日中要員モジュールが参照 |
| 勤務帯の数と名前 | day（休日のみ）/ night（毎日）の 2 帯 | 設定で定義。ある日・順序・翌日にまたがるかを持つ |
| 枠ごとの配置人数 | 勤務者 1 名＋OC（主担当・若手の構成表） | 配置ごとに人数。定数、日種別、勤務者の役割で決まる表 |
| 規則の有効／無効と数値 | `rules.yaml` の 24 個の重みと数個の数値 | 規則モジュールごとに有効化・パラメータ・重み |
| 新しい型の規則 | なし | 連勤の上下限、同日の禁止組合せ、帯間の禁止遷移、月の休日下限 |
| 表示言語 | 日本語のみ | 日本語／英語の切替 |
| docx の行構成・表題・ファイル名 | docxgen.js に直書き | 設定。レイアウトは 2 種を同梱 |

汎用にしないもの（設計上の固定）は次の 5 点。

| 固定するもの | 理由 |
| --- | --- |
| 整数計画（HiGHS の LP テキスト）で解く方式 | 規則の追加が制約の追加で済む。現行の検算・診断の枠組みがそのまま使える |
| 単一 HTML の配布とブラウザ内完結 | 外部通信なしで院内 PC に置ける。導入がコピー 1 回で済む |
| 共有フォルダ運用と 3 者統合（merge.js） | 現運用の中核。保存形を変えないことで守る |
| 配置の種類は「勤務者（work）」と「待機（standby）」の 2 種、日中業務の区分は am/pm | これ以上の一般化は現行コードの骨格を変える。必要になった施設はブランチで対応 |
| 検算（check.js）はソルバーと独立した実装 | 二重実装の食い違いで誤りを検出する現行の安全装置を残す |

### 1.2 現運用を壊さない原則

| 原則 | 具体的な担保 |
| --- | --- |
| 出発点の科の保存 JSON は無変更で開け、同じ最適値になる（当時の目標。現在は対応するプラグインを読み込んだ状態で） | 回帰フィクスチャ（`data/202611*.json` と `202611/`）で目的関数値・違反 0 件・W 件数・固定枠が一致することを各フェーズの完了条件にする |
| 循環器プロファイルでは保存形（month のキー）を変えない | merge.js の `flattenMonth` はキー名で差分を取る。旧版と新版が同じフォルダを触っても偽の衝突を出さない |
| 画面の使用感を変えない | 設定タブの医師表・医師別カレンダー・docx は、循環器プロファイルでは現行と同じ見た目になる（表示名を設定から引くだけ） |
| 各フェーズは単独で出荷できる | 途中で止まっても運用が続く順に並べる（第 8 節） |
| 旧版の toban.html が残る PC への配慮 | 旧 rules キーを保存時に併記する。フェーズ 0 以降の版は、汎用形のデータ（`legacy_compatible: false`）を開いたとき警告して上書き保存しない。フェーズ 0 より前の版にはこの仕組みが無いので、公開時に全 PC の toban.html を入れ替えることを運用手順にする |

### 1.3 ブランチ運用の前提

- 本体（core）は「設定で表せる範囲」と「モジュールを登録する口」を提供する。
- 細かなカスタマイズは各施設がブランチ（または fork）で行う。本体のファイルには触らず、`tools/profiles/<施設 id>.yaml` と `src/mod-<施設 id>.js` を足す。（当時の案。現行は保存フォルダの `plugins/` に置く施設のプラグイン方式。`plugin-example/README.md` を参照）
- 出発点の科の現行規則も同じ仕組みで `tools/profiles/cardiology.yaml` と `src/mod-cardio.js` として同梱し、本体のテストの基準にする。（当時の案。現行は出発点の科の規則を非公開のプラグインとし、本体の試験は架空の見本データだけで行う）
- Python 版（`tools/toban.py`）は本体の核と循環器モジュールだけ追随する。施設ブランチに Python 移植の義務は課さない。

### 1.4 採った設計案と理由

3 案（A 段階的パラメータ化、B 宣言的ルール型、C 運用者起点）を独立に書き、実装者・運用者・他施設導入者の 3 つの観点で比べた。本書は案 A を骨格にし、B・C から下表の点を移植する。3 案の全文と審査の記録は内部文書（公開リポジトリには含めない）にある（本書と食い違う箇所は本書が正）。

案 A を骨格にした理由は 3 点。第一に、保存 JSON の形と旧版との同居を最も丁寧に守る。第二に、フェーズ 1（表示名だけ）で solver.js・check.js を変えずに「役割・勤務帯に名前を付ける」要望を満たせる。第三に、回帰の物差しを目的関数値に置くので、LP テキストの並び順に縛られずに分割できる。

| 移植元 | 移植する点 | 効果 |
| --- | --- | --- |
| C | 待機配置を `oc_I` / `oc_Y` のように別配置にし、`store_as: oc` で保存・表示は `asg.oc[]` に束ねる | 待機 2 種が表せる。若手 OC の欠員許容が配置属性に閉じる |
| B | `calendar.prev_month_tail`（前月末を何日分持つか）と `off_days`（休日の定義） | 連勤規則に必要な日数を持てる。土曜を平日扱いする施設に対応 |
| B・C | 不可の時間帯 → 枠集合の写像表 `parts` と、帯が覆う日中区分 `covers` | 「日付だけの不可＝夜勤」と「日勤帯不可が日中要員にも効く」を 1 つの表で定義 |
| B | 枠クラス規則に `at_most` と `group_by: dow` | 「夜勤は月 N 回まで」が書ける。曜日上限もこれに吸収 |
| B | `days_off_min`（どの枠にも入らない日数の下限） | 看護師型の「4 週 8 休」 |
| C | `forbid_sequence`（帯 → 翌日の帯の禁止遷移） | 準夜 → 翌日勤の禁止が隣接判定に頼らず書ける |
| B・C | 固定指定が上書きしてよい規則の一覧を `fixed_priority` に集約 | F7 の見通し |
| B・C | 緩和キー＝規則行の id | 個人ごとの指定を 1 件ずつ外す診断が組める |
| B | `legacy_compatible: false` と `type: custom` 登録 API | 旧版への警告、施設ブランチの拡張口 |
| B | 相互検算の契約（相手の検算で違反 0、最適値一致、指標一致） | 済（2026-09-21）: 相手の検算で違反 0、同じ割当の減点の合計が一致。外れればテスト失敗。Python 版は循環器内科の構成の参照実装として凍結し、全構成の二重化は JS 内の `check.js` の `penalty` で行う。指標一致は未 |
| B | LP テキストのスナップショット試験を「コードを移すだけ」の区間に限って併用 | 制約の欠落・重複を捕まえる |
| C | 設定タブの並び（基本 → 役割・資格 → 勤務帯 → 配置 → 名簿 → 規則 → モジュール → 出力 → JSON） | 非エンジニアが上から順に埋められる |
| C | docx の `month_table` レイアウトと言語別ファイル名、`holidays: jp / none / custom` | 配置人数 > 1 の施設と英語運用 |
| C | docs 一式（settings / rule-types / facility-branch / data-format） | 他施設が README だけで導入できる |
| C | 型ごとの合成問題テスト | 新しい規則型の正しさをゴールデンとは別に保証 |

## 2. 用語（全員向け）

公開に関わる用語:

| 用語 | 意味 |
| --- | --- |
| fork（フォーク） | 他の人がリポジトリを丸ごと複製して、自分の側で改変すること |
| ブランチ | 同じリポジトリの中の派生。施設ごとの改変を本体と分けて持つ単位 |
| PR（プルリクエスト） | 改変を本体に取り込んでほしいという依頼 |
| DCO | 貢献者が「これは自分が書いたもので、提出する権利がある」と署名する 1 行（`Signed-off-by`） |
| CLA | 同じことを契約書の形にしたもの。法人の貢献者が出たときに使う |
| inbound MIT | 貢献者は自分の書いた部分を MIT（誰でも何にでも使える許諾）で提供する、という取り決め |
| SPDX 識別子 | ライセンスの短い識別子（例: `MIT`） |
| source-available | ソースコードは公開されているが、OSI の定義するオープンソースの条件（用途を制限しない等）は満たさないもの。本プロジェクトは MIT なのでこれには当たらない |
| OSI / OSD | Open Source Initiative と、その「オープンソースの定義」 |
| ゴールデン（回帰フィクスチャ） | 変更の前後で結果が同じことを確かめるための基準データ |
| rebase / merge | 施設ブランチに本体の更新を取り込む操作 |

アプリの用語:

| 用語 | 英語 | 意味 | 現行コードでの対応 |
| --- | --- | --- | --- |
| 役割 | role / group | 人に付ける属性。配置の資格や規則の対象集合に使う | `doctors[].team`（I/A/Y/C） |
| 資格タグ | skill | 人に付ける追加の属性。複数持てる | `doctors[].cath`（単値） |
| 勤務帯 | shift | 一日の中の勤務の区分 | `kind`（day / night） |
| 枠 | slot | 日 × 勤務帯 | `[d, kind]`、`"d:kind"` |
| 配置 | position | 枠に置く席の種類。勤務者と待機 | `asg[k].work`、`asg[k].oc[]` |
| 配置人数 | count | 配置ごとの必要人数 | 勤務者 1、OC は `oncall_requirement` |
| 勤務者 | worker（kind: work） | 勤務回数に数える配置 | `work` |
| 待機 | standby | 勤務回数に数えない配置（OC） | `oc` |
| 日中業務 | duty | 外来・病棟番・外勤・不在。午前／午後 | `duty_days`、`regular_duties` |
| 休日 | off day | 土日・祝日・施設休日。枠の有無と期間の単位 | `isHoliday(d)` |
| 期間 | period | 期間責任者の単位（土日 1 組、祝日単日） | `periods` |
| 期間責任者 | period charge | 期間の全枠に関与する 1 名 | 主担当担当 `cday` |
| 規則 | rule | 必須条件（hard）または調整目標（soft） | 共通ルール.md の各項 |
| 規則モジュール | rule module | 規則の型と、その LP・検算・入力チェック・報告・画面を一組にした実装 | solver.js / check.js の各ブロック |
| 施設プロファイル | facility profile | 役割・勤務帯・配置・規則の有効化と数値の一式 | `rules.yaml` |
| 施設固有モジュール | facility module | 本体で表せない規則の実装 | 該当なし（`mod-cardio.js` を新設） |
| 固定指定 | fixed assignment | 事前に決めた割当 | `month.fixed.*` |
| 不可／避／希望 | unavailable / avoid / wish | 本人の申告 | `unavailable_*` / `avoid` / `wishes` |
| 目安／当月目標 | quota / target | 月の勤務回数の基準と当月の値 | `doctors[].quota`、`month.targets` |
| 緩和キー | relaxation key | 診断で一時的に外す制約の名前 | `T.RELAXATIONS` |
| 参照解 | reference solution | 避を無視して求めた解。回数の下限に使う | `solveWithAvoidRef` |
| 基準解 | base solution | 最小変更の基準になる既存案 | `opts.base` |
| ゴールデン | golden | 回帰試験の基準値（目的関数値など） | 新設 |
| 本体／ブランチ | core / branch | 公開リポジトリの main と、施設ごとの派生 | — |

## 3. 公開の形（全員向け）

### 3.1 決定: MIT ライセンスのまま公開する（2026-09-16）

- ライセンスは現行の MIT を変えない。同梱の HiGHS / highs-js / JSZip / pako も MIT で、表示義務（著作権表示と許諾文の保持）は現行のヘルプ末尾 `#licenses` 節で満たしている。
- MIT は OSI 承認のオープンソースライセンスなので、README やヘルプで「オープンソース」と書いてよい。GitHub のライセンス欄も MIT と自動検出される。
- どの施設も、無償で利用・改変・複製・共有できる。商用利用（他施設向けのホスティングや有償の改修・運用代行を含む）も条文では制限しない。
- 広める手段は条文ではなく、作成責任者による講演などの発信に置く。

### 3.2 検討した制限付きライセンス（記録。採用しない）

「他施設に対する商用サービス提供を禁じたい」という当初の要望に対し、条文を確認して候補を比べた。結論として、境界事例（委託先ベンダーのサーバーで運用する、業者が手元で計算して納品する、関連法人へ配る、無償のホスティング）の可否判断と、貢献者の権利処理・将来のライセンス変更の管理が難しいため、採用しない。記録として要点だけ残す。

| 候補 | (a) 自施設利用 | (b) 他施設向け商用サービス | 備考 |
| --- | --- | --- | --- |
| Elastic License 2.0 | 可 | ホスト／マネージドサービスとしての第三者提供を禁止（有償・無償を問わない） | 定型条文、SPDX `Elastic-2.0`、公式日本語ページあり。計算代行や有償改修は禁じられない。OSI 非承認 |
| Business Source License 1.1 | 既定は非本番のみ。Additional Use Grant を自作して許可 | AUG の書き方次第で運用代行・有償改修も禁止できる | 制限の中核を自分で英文起草。Change Date で自動的に MIT 等へ移行。OSI 非承認 |
| MIT + Commons Clause | 可 | 「販売」（ホスティング・コンサル料を含む）を禁止 | MIT 本文の sell と条件文が衝突して読みにくい。SPDX 未登録 |
| PolyForm Noncommercial | 私立病院・医療法人が「health organization」に当たるか不明確 | 禁止 | (a) を確実に満たせない |
| AGPL-3.0 | 可 | 禁止できない（ソース提供義務のみ） | OSI 承認。本アプリは配布物＝ソースなので §13 は空振り |

OSI の Open Source Definition 第 6 項は「事業分野による利用制限」を禁じるので、(b) を満たすライセンスはすべて OSI 準拠ではなく、採用していれば「オープンソース」と名乗れなかった。条文の詳細と境界事例の整理は内部文書のライセンス調査に残してある（公開リポジトリには含めない）。

### 3.3 呼び方

推奨文（日本語）:

> MIT ライセンスのオープンソースソフトウェアです。どの施設も無償で利用・改変・複製・共有できます。同梱の HiGHS・highs-js・JSZip・pako も MIT ライセンスです。

推奨文（英語、`README.en.md`）:

> Open source under the MIT License. Any hospital department may use, modify, copy and share it free of charge. Bundled components (HiGHS, highs-js, JSZip, pako) are also MIT-licensed.

### 3.4 ライセンス表記の場所

- `LICENSE`（MIT 全文）、`README.md` / `README.en.md` / `webapp/README.md`、`index.html` の先頭コメントと `#licenses` 節（本体と同梱部品 4 件の表示）。
- `build.py --check` に「これらの表記がすべて MIT で一致する」検査を足す（3.9）。
- ELv2 は Limitations 3 で表示の除去を禁じていたが、MIT でも「著作権表示と許諾文を全ての複製に含める」義務は同じなので、施設ブランチでも `#licenses` 節を残すよう README で注意喚起する。
- `index.html` 2 行目にある作成経緯の一文（Claude を用いて作成し、作成責任者が仕様の決定と動作の検証を行った旨）は残す。

### 3.5〜3.7（欠番）

0.2 草案の ELv2 向けの LICENSE 文言・境界事例・同梱部品の節は、MIT のまま公開する決定により不要になった。節番号は後続の参照を保つため欠番にする。

### 3.8 リポジトリの慣行チェックリスト

| 項目 | 推奨 |
| --- | --- |
| README.md（日本語、正） | 冒頭に「MIT ライセンスのオープンソース。どの施設も無償で利用・改変・共有できる」を明記。既存の「他の施設・部署で使うには」節は活かす |
| README.en.md | 要約。MIT License、想定用途（hospital duty rosters）、日本発のプロジェクトである旨を書く |
| LICENSE | 現行の MIT 全文（著作権者は 5rrjb76mcm-lgtm）。GitHub が MIT と自動検出する |
| THIRD-PARTY-NOTICES.md | 同梱 MIT 部品 4 件の表示 |
| CONTRIBUTING.md | 貢献は本体と同じ MIT で提供する旨と DCO sign-off（決定済み。雛形は `CONTRIBUTING.md`）。`sh run_tests.sh` と `build.py --check` の通過。規則変更は規則文書（`docs/sample-rules-cardiology.md`。フェーズ 6 以降は `tools/profiles/cardiology/README.md`）、プロファイル（`tools/rules.yaml`。フェーズ 3 以降は `tools/profiles/cardiology.yaml`）、`tools/toban.py` の 3 点を同時に直す。実データは貼らず架空化する。本体に触らず `src/mod-*.js` と `tools/profiles/*.yaml` を足す方法（当時の案。現行の貢献手順は `CONTRIBUTING.md` が正） |
| CONTRIBUTORS.md | 貢献者の氏名（または GitHub 名）と年を記録し、MIT の著作権表示要件を満たす |
| CODE_OF_CONDUCT.md | Contributor Covenant 2.1（公式日本語訳あり）＋連絡先 1 行 |
| SECURITY.md | 外部通信なしのローカル実行アプリである旨、脆弱性報告先、「Issue に実在の名簿・勤務データを貼らない」を最重要事項として記載 |
| CHANGELOG.md | Keep a Changelog 1.1.0 形式。`rules_version` の変更も Changed に記録。施設モジュールに影響する変更に「施設モジュール影響」の印 |
| バージョン | `v0.y.z`（枠構成が施設固有のうちは 0 系）。保存 JSON の非互換で MAJOR、機能追加で MINOR、修正で PATCH |
| Releases | `toban.html` と `toban-probe.html` を添付し SHA-256 を併記。リポジトリへの toban.html のコミットはリリース時のみ（当時の案。現行は toban.html をコミットせず Release に添付だけ。`docs/publishing.md` が正） |
| Issue / PR テンプレート | Bug: 版・ブラウザ・再現手順・「実データ禁止、`webapp/data/202611.json` を改変して再現」。Feature: 規則の出典。PR: テスト通過・3 点同期・DCO のチェック欄 |
| DCO / CLA | DCO（決定済み）。法人貢献者が出たら CLA に格上げを検討 |

### 3.9 リリースの単位と版番号

| 種類 | 形 | 上げる条件 |
| --- | --- | --- |
| アプリの版（タグ） | `v0.y.z` | リリースごと。`build.py` の表示は `v0.y.z (YYYY-MM-DD) 共通ルール X` に |
| 規則の版 `rules_version` | 文字列（施設ごと） | 施設が規則を変えたとき。プロファイルごとに独立 |
| 月データの `month.schema_version` | 整数（現行 = 1、汎用形 = 2） | month の保存形が変わったときだけ |
| モジュール API の版 `module_api` | 整数 | `T.modules.register` の引数や ctx の形が非互換に変わったとき |

初回コミット前の点検は次の 3 点を `build.py --check` に組み込む。

- 名簿外の氏名の走査: `data/*.json`、`202611/*.json`、`index.html`、テストの `js_assignment*.json`、`doc_versions` のファイル名を対象に、`rules.doctors` に無い氏名が `result.asg`・`fixed`・`prev_month` に現れないことを検査する。2026-09-16 の点検で `202611/202611 当直表データ.json` の `result.asg` に実名 13 件が残っていた（JSON の `\u` エスケープ表記が文字列置換を逃れた）ため、架空名簿に合わせて差し替え済み。この検査を `git commit` の前提にする（push 後は履歴から消せない）。
- ライセンス表記の一致（3.6）: `LICENSE`、README、`index.html` の先頭コメントと `#licenses` 節がすべて MIT であること。
- `name_order ⊆ doctors`（現行の検査）。

### 3.10 外部貢献の受け入れ

- 貢献は本体と同じ MIT で受ける。貢献者は `Signed-off-by` の 1 行（DCO 1.1）で「自分が書いたもので、MIT で提出する権利がある」ことを表明する。契約書（CLA）は求めない。
- 貢献者の氏名（または GitHub 名）と年は `CONTRIBUTORS.md` に記録し、MIT の著作権表示要件を満たす。
- 施設ブランチからの PR は、汎用部分（規則型・モジュール口・i18n・docs）だけ本体に受け入れる。施設固有の意味づけは `profiles/` と `mod-*.js` に留める。

## 4. 設定モデル（実装者向け）

### 4.1 構造の概要

`rules` は次の 8 つの部分に分かれる。`profile` は「何を並べるか」、`modules` は「どう縛るか」、`weights` は「どれだけ嫌うか」を持つ。

| 部分 | 内容 | 現行キーとの関係 |
| --- | --- | --- |
| `profile` | 役割・資格・勤務帯・配置・不可の時間帯・日中業務・暦 | `DEFAULT_OC_REQ`、`KINDS`、`jpHolidays`、`closureDays` を設定に出す |
| `doctors`, `name_order` | 名簿と表示順 | そのまま。`cath` は `skills[]` の別名 |
| `modules` | 規則モジュールごとの有効化・パラメータ・重みキー | `oncall_requirement` 等の旧キーは別名として読む |
| `fixed_priority` | 固定指定が上書きしてよい規則の一覧 | `weights.fixed_conflict` と `isFixedWork/isFixedEng` 判定の散在を 1 か所に |
| `weights` | 重み表 | そのまま（24 キー）。未知キーはキー名のまま表示 |
| `solver` | 時間上限・2 段階解法・診断の上限 | `opts.timeLimit` |
| `docx`, `files` | 出力書式とファイル名 | docxgen.js / app-core.js の直書きを出す |
| `lang`, `rules_version`, `module_api` | 既定言語と版 | `rules_version` は現行のまま。月データの形の版は rules ではなく `month.schema_version`（第 7 節） |

省略時の既定（4.4 の最小例はこの既定で成立する）:

| 項目 | 省略時 |
| --- | --- |
| `profile.parts` | 勤務帯ごとに 1 つ（`slots: [{shift: <id>}]`、`daytime` は `covers` から）＋ `allday`（全帯） |
| `profile.unavailable` | `date_only_means: allday`、選択肢は全 parts |
| `profile.calendar` | `{holidays: jp, off_days: [Sat, Sun, holiday], prev_month_tail: 2, next_month_head: 1}` |
| `positions.*.eligible` | 全役割 |
| `profile.duty_layer` | `duty_kinds` に `is_duty: false` 以外の種別があれば true、無ければ false |
| `docx` | `template: month_table`、A4 横、言語別の既定フォント |
| `modules.*` | 無い規則は無効。`quota` と `consecutive.same_day_work: forbid` だけは既定で有効 |

### 4.2 勤務医の見本プロファイル（このモデルで書いた架空の例）

> 2026-09-25 注: 以下の数値・名指し・専門業務の必要人数は、同梱の見本（`webapp/data/rules.json`。乱数で作った架空のもの）に合わせた例で、実在の運用の値ではありません。専門業務の必要人数と名指しの規則は本体には無く、施設のプラグインで表すものです。

```yaml
rules_version: "2.0"
module_api: 1
lang: ja

profile:
  id: cardiology
  label: {ja: 勤務医の見本, en: Physician sample}
  roles:                                   # 役割 A/B/C… に名前を付ける。順序＝表示順
    - {id: I, label: {ja: 主担当,   en: Primary}}
    - {id: A, label: {ja: 副担当, en: Secondary}}
    - {id: Y, label: {ja: 若手,   en: Junior}}
    - {id: C, label: {ja: 部長,   en: Chief}, reserve: true}   # 予備要員（modules.reserve_role）
  skills:                                  # 資格タグ。複数可
    - {id: taskA,    label: {ja: 専門業務 A の資格, en: Specialty task A}}
    - {id: taskB,    label: {ja: 専門業務 B の資格,   en: Specialty task B}}
    - {id: clinic,   label: {ja: 専門外来の候補,         en: Clinic candidate}}
  shifts:                                  # 勤務帯 1/2/3… に名前を付ける
    - {id: day,   label: {ja: 日勤, en: Day},   on: off_days, order: 1, covers: [am, pm]}
    - {id: night, label: {ja: 夜勤, en: Night}, on: all,      order: 2, covers: [], ends_next_day: true}
  positions:                               # 配置。キーが asg のキー（store_as で束ねる）
    work: {kind: work, label: {ja: 勤務者, en: Worker}, count: 1}
    oc_I: {kind: standby, store_as: oc, label: {ja: 主担当OC, en: IC on-call},
           eligible: {roles: [I]}, count: {by_worker_role: {I: 0, A: 1, Y: 1, C: 1}}}
    oc_Y: {kind: standby, store_as: oc, label: {ja: 若手OC, en: Junior on-call},
           eligible: {roles: [Y]}, count: {by_worker_role: {I: 1, A: 1, Y: 0, C: 1}},
           shortfall: {when_worker_role: [A], weight: missing_young_oc}}   # S3
  parts:                                   # 不可・避の時間帯 → 枠集合。daytime は日中要員から除く区分
    night:  {label: {ja: 夜勤,     en: Night},    slots: [{shift: night}]}
    day:    {label: {ja: 日勤帯,   en: Daytime},  slots: [{shift: day}], daytime: [am, pm]}
    allday: {label: {ja: 日夜両方, en: All day},  slots: [{shift: day}, {shift: night}], daytime: [am, pm]}
  unavailable: {date_only_means: night, weekday_options: [night, allday], holiday_options: [allday, day, night],
                avoid_options: {weekday: [night], holiday: [allday, day, night]}}   # 現行の平日 4 択・休日 7 択を再現
  day_parts: [am, pm]
  duty_kinds:
    - {id: outpatient, label: {ja: 外来,   en: Clinic}}
    - {id: ward,       label: {ja: 病棟番, en: Ward}}
    - {id: external,   label: {ja: 外勤,   en: Off-site}}
    - {id: absent,     label: {ja: 不在,   en: Absent}, is_duty: false}
  duty_layer: true                         # false なら業務欄・曜日パターンを画面から隠す
  calendar: {holidays: jp, off_days: [Sat, Sun, holiday], closure: {12: [29, 30, 31], 1: [2, 3]},
             prev_month_tail: 2, next_month_head: 1}
  quota_unit: shifts                       # 目安の単位の表示（shifts: 回 / days: 日）

doctors:                                   # 現行のまま。cath は skills の別名として読む
  - {name: Dr B, team: C, years: 29, quota: 0, skills: [taskA, clinic], duty: no_unless_needed}
  - {name: Dr E, team: I, years: 17, quota: 2, skills: [taskB]}
  - {name: Dr M, team: A, years: 20, quota: 3, skills: [clinic]}
  # …（略）
name_order: [Dr E, Dr F, Dr J]            # …（略）

modules:
  quota: {tolerance: 1, weight: target_deviation, auto_targets: true, history_key: history.work_balance}
  reserve_role: {role: C, max_per_month: 1, weight: chief_duty, month_key: allow_chief_duty}
  consecutive:
    same_day_work: forbid
    consecutive_day_work: forbid
    adjacent_engaged: {mode: forbid,
                       exceptions: [{roles: [I], within: period},
                                    {roles: [Y], within: same_day, unless: [standby, standby]}]}
    same_shift_consecutive: [{shift: night, mode: forbid, exempt_roles: [I]}]
    forbid_sequence: []
    nonadjacent_consecutive: {weight: nonadjacent_consecutive, exempt_roles: [I]}
  slot_class_rules:                        # 枠クラス × 人 の回数
    - {id: weekday_cap, doc: D1, class: {position: work}, group_by: dow, at_most: 2,
       mode: soft, weight: same_weekday_excess}
    - {id: friday_night, doc: FR1, class: {shift: night, dow: [Fri]}, persons: {names: [Dr G]}, exact: 1}   # 名指しは架空の例
    - {id: weekend_dayshift, doc: O2, class: {shift: day, dow: [Sat, Sun]},
       persons: {names: [Dr E, Dr F], plus_month_key: wishes.weekend_dayshift},
       at_least: 1, mode: soft, weight: wish_weekend_dayshift}
    - {id: rest_day, doc: RS1, class: {any: [{shift: day}, {shift: night, next_day: off}]},
       persons: {has_duty_kind: external}, at_least: 1, metric: rest_days}
    - {id: arrhythmia_pre_workday, doc: O3, class: {shift: night, next_day: workday},
       persons: {names: [Dr K, Dr L]}, mode: avoid, weight: arrhythmia_pre_workday_night}
  duty_coupling:
    next_day:
      - {id: r1a, after: {shift: night, position: work},    duty: {kind: [external]},            effect: forbid}
      - {id: r1b, after: {shift: night, position: work},    duty: {part: [pm]},                  effect: forbid}
      - {id: r2,  after: {shift: night, position: standby}, duty: {kind: [external], part: [am]}, effect: forbid}
      - {id: o7,  after: {shift: night, position: standby}, duty: any,                           effect: {penalty: night_oc_then_duty}}
      - {id: o8,  after: {shift: night, position: work},    duty: {part: [am], not_part: [pm]},  effect: {penalty: night_then_am_duty}}
    same_day:
      - {id: r3, duty: {kind: external, part: pm}, target: {shift: day, position: standby}, effect: forbid}
      - {id: r4, duty: {kind: external, part: pm}, target: {shift: night, position: any},
         effect: forbid_unless_confirmed, month_key: confirmed_pm_external_night}
  staffing:                                # 日中要員（専門業務）
    only: workdays
    post_shift: {shift: night, am: count_with_penalty, pm: exclude, weight: cath_post_night}
    rows:
      - {id: taskA, group: {skill: taskA}, off_days_key: task_off_days_A,
         need: {weekday: [1, 1]}}   # 曜日ごとに変えられる（例は一律）
      - {id: taskB, group: {skill: taskB}, off_days_key: task_off_days_B, need: {weekday: [1, 1]}}
      - {id: clinic_Y, group: {role: Y}, need: {weekday: [0, 1]}}
      - {id: clinic_A, group: {skill: [taskA, clinic]}, need: {weekday: [0, {over: taskA, plus: 1}]},
         off_days_floor: 1}                # 候補は taskA と clinic の和集合（現行どおり）。★ over/plus は mod-cardio.js の拡張構文
  period_charge:                           # 期間責任者（主担当担当）
    role: I
    label: {ja: 主担当担当, en: IC charge}
    periods: [{kind: weekend, days: [Sat, Sun], crossing: true}, {kind: holiday}]
    split: {weight: split_weekend}
    balance: {max_diff: 1, month_override: exceptions.weekend_balance_max_diff}
    history: {month_key: history.weekend_charge, unit: pairs, weight: weekend_history_spread}
    consecutive: {weight: consecutive_weekend}
    prefer_position: {shift: day, position: work, weight: charge_without_dayshift}
    prev_connection: true
    fixed_key: fixed.weekend_charge
  same_day_pairs:                          # 休日の日勤者 × 夜勤者
    shifts: [day, night]
    table:
      - {a: I, b: A, effect: forbid}
      - {a: A, b: I, effect: forbid}
      - {a: A, b: A, effect: {penalty: same_day_AA}}
      - {a: I, b: Y, effect: {b_worker_is_standby_of_a: must}}
      - {a: Y, b: I, effect: {a_worker_is_standby_of_b: must}}
      - {a: A, b: Y, effect: {b_worker_is_standby_of_a: prefer, weight: same_day_AY}}
      - {a: Y, b: A, effect: {a_worker_is_standby_of_b: prefer, weight: same_day_AY}}
  spread:
    - {id: o10, group: {role: I}, count: {position: oc_I, shift: night}, weight: spread_I_nightoc}
    - {id: o11, group: {role: Y}, count: {position: oc_Y},               weight: spread_Y_oc}
    - {id: o12, group: {role: Y}, count: {position: work, on: off_days}, weight: spread_Y_holiday_work}
  wishes: {night_on: {shift: night, position: work, weight: wish_night}}
  avoid:  {weight: avoid_day, no_reduction: {method: reference_solution, weight: avoid_no_reduction}, exempt_roles: [C]}
  base_change: {weight: base_change}
  run_length: null                         # 看護師型で使う（4.3）
  days_off_min: null
  incompatible: []

fixed_priority:                            # 固定指定が他の規則より優先されるときの緩め方（F7）。現行コードと同じ挙動
  weight: fixed_conflict
  may_override: {unavailable: skip, duty_coupling.*: skip, slot_class_rules.arrhythmia_pre_workday: skip,
                 quota.upper: raise_to_fixed_count, consecutive.*: penalize}
  never_override: [coverage, eligibility, period_charge.consistency, staffing]

weights: {target_deviation: 15, wish_night: 30, missing_young_oc: 300, fixed_conflict: 50}   # …現行 24 キーのまま
solver: {time_limit: 60, two_stage_avoid: true, diagnose: {max_solves: 40, each_limit: 30, total_limit: 600}}

docx:
  template: week_block                     # 現行の A3 週ブロック。もう 1 つは month_table
  paper: {size: A3, orientation: portrait, margin: 720}
  font: {ja: ＭＳ ゴシック, en: Arial}
  rows:                                    # 日付行は自動。以下の 8 行で週ブロック計 9 行
    - {label: {ja: 日勤},       source: {shift: day,   position: work}}
    - {label: {ja: 夜勤},       source: {shift: night, position: work}}
    - {label: {ja: オンコール}, source: {store: oc, join: "/"}}
    - {label: {ja: ダメ日},     source: {unavailable: [night, allday], abbrev: true}}
    - {label: {ja: 振休 午前}}
    - {label: {ja: 振休 午後}}
    - {label: {ja: 夜勤明け休}}
    - {label: {ja: 出張}}
  fills: {sun: F7CAAC, sat: BDD6EE, changed: C00000}
  title: {ja: "{year}年{month}月　勤務表 {date}　{label}",
          en: "Duty roster {year}-{month} {date} {label}"}
  footer: {label: {ja: 週休日数, en: Rest days}, metric: rest_days, order: name_order,
           digits: {ja: fullwidth, en: ascii}}
  abbrev: {ja: first_char, en: initials}
files:
  data:   {ja: "{tag} 当直表データ.json", en: "{tag} roster-data.json"}
  docx:   {ja: "{year}{month}_roster_v{ver}_{label}.docx", en: "roster {year}-{month} v{ver} ({label}).docx"}
  report: {ja: "{tag} 説明資料 v{ver}（{label}）.html", en: "{tag} report v{ver} ({label}).html"}
  rules:  {ja: 共通ルール.json, en: rules.json}
```

`count` の書き方は 5 通りある。整数（毎日同じ）、`{weekday: n, off_days: m}`（日種別）、勤務帯別 `{<shift id>: <count>}`（値は他の形のいずれか。4.3 の看護師型が使う）、`{by_worker_role: {…}}`（同じ枠の勤務者の役割で決まる。その枠に kind: work の配置が 1 つだけで count 1 のときに限る）、月データの `count_overrides: [{day, position, count}]`（特定日の増減）。

### 4.3 看護師型の例（3 勤務帯・複数配置・連勤の上下限・同日の禁止組合せ）

```yaml
profile:
  id: ward-nurse
  roles:
    - {id: L, label: {ja: リーダー, en: Leader}}
    - {id: N, label: {ja: 一般,     en: Staff}}
    - {id: F, label: {ja: 新人,     en: New}}
  skills: []
  shifts:
    - {id: s1, label: {ja: 日勤, en: Day},     on: all, order: 1, covers: [am, pm]}
    - {id: s2, label: {ja: 準夜, en: Evening}, on: all, order: 2}
    - {id: s3, label: {ja: 深夜, en: Night},   on: all, order: 3, ends_next_day: true}
  positions:
    work:   {kind: work, count: {s1: {weekday: 4, off_days: 3}, s2: 2, s3: 2}, eligible: {roles: [L, N, F]}}
    leader: {kind: work, count: {s1: 1, s2: 1, s3: 1}, eligible: {roles: [L]}}   # 各帯にリーダー 1 名
  parts:
    s1: {slots: [{shift: s1}], daytime: [am, pm]}
    s2: {slots: [{shift: s2}]}
    s3: {slots: [{shift: s3}]}
    allday: {slots: [{shift: s1}, {shift: s2}, {shift: s3}], daytime: [am, pm]}
  unavailable: {date_only_means: allday, weekday_options: [allday, s1, s2, s3], holiday_options: [allday, s1, s2, s3]}
  duty_kinds: [{id: absent, label: {ja: 不在, en: Absent}, is_duty: false}]
  duty_layer: false
  calendar: {holidays: jp, off_days: [Sat, Sun, holiday], prev_month_tail: 5, next_month_head: 1}
  quota_unit: days
doctors:
  - {name: Ns A, team: L, quota: 20, never_shifts: [s3]}      # 恒常の不可（産休・時短など）
  - {name: Ns B,   team: N, quota: 20}
modules:
  quota: {tolerance: 1, weight: target_deviation}
  consecutive:
    same_day_work: forbid
    consecutive_day_work: allow                # 連勤は run_length で扱う
    adjacent_engaged: forbid                   # 深夜 → 翌日勤 などの隣接
    forbid_sequence: [{from: {shift: s2}, to: {shift: s1, day_offset: 1}, mode: forbid}]
  run_length:                                  # 「原則 3 日以上連続、5 連勤は禁止」
    class: {position: [work, leader]}
    max: 4                                     # 5 連勤禁止 ＝ 連続上限 4（必須）
    min: {days: 3, mode: soft, weight: run_short}
    boundary: {unavailable: cut_free, month_start: free, month_end: free}
  days_off_min: {min: 8, mode: hard}           # 4 週 8 休
  slot_class_rules:
    - {id: night_cap, class: {shift: s3}, persons: all, at_most: 4}                    # 深夜は月 4 回まで
    - {id: wish_off_cap, class: {source: wishes.off}, persons: all, at_most: 3, kind: input}   # 希望休は月 3 日まで（入力チェック）
  incompatible:
    - {persons: [Ns A, Ns B], scope: day}
    - {role: F, scope: slot, max: 1}           # 同じ枠に新人 2 名を置かない（1 役割の上限）
    # 異なる 2 役割の同席上限は {roles: [L, F], scope: slot, max: 1} の形（同じ役割を 2 回書くのは lint で拒否）
  spread:
    - {id: night_spread, group: {role: N}, count: {position: work, shift: s3}, weight: spread_night,
       history_key: history.by_shift.s3}
  wishes: {night_on: {shift: s3, position: work, weight: wish_night}, off: {weight: wish_off}}
  avoid:  {weight: avoid_day, no_reduction: {method: reference_solution, weight: avoid_no_reduction}}
weights: {target_deviation: 15, run_short: 20, spread_night: 3, wish_night: 30, wish_off: 30, avoid_day: 20,
          avoid_no_reduction: 1000, fixed_conflict: 50, base_change: 1}
docx: {template: month_table, paper: {size: A4, orientation: landscape}}
```

この例の読み方を 2 点補う。

- 「連続日勤」を日勤帯だけに限るなら `run_length.class: {shift: s1}`、勤務日全体（日勤・準夜・深夜のどれかに入った日）の連続なら `class: {position: [work, leader]}`。上の例は後者で、依頼文の「3 日以上連続日勤、5 連勤は禁止」を勤務日の連続として読んでいる。日勤帯だけに掛けたい施設は前者にする。
- `days_off_min: {min: 8}` は「4 週 8 休」の暦月近似（31 日の月なら 9 日相当）。28 日窓で数えたい場合は `window: 28` を将来足す。

### 4.4 当直医型の最小例

```yaml
profile:
  id: generic-oncall
  roles: [{id: S, label: {ja: 上級医, en: Senior}}, {id: J, label: {ja: 若手, en: Junior}}]
  shifts: [{id: day, label: {ja: 日直, en: Day}, on: off_days, order: 1, covers: [am, pm]},
           {id: night, label: {ja: 当直, en: Night}, on: all, order: 2, ends_next_day: true}]
  positions: {work: {kind: work, count: 1}, backup: {kind: standby, store_as: oc, eligible: {roles: [S]}, count: 1}}
  duty_kinds: [{id: outpatient, label: {ja: 外来}}, {id: external, label: {ja: 外勤}}, {id: absent, label: {ja: 不在}, is_duty: false}]
modules:
  quota: {tolerance: 1, weight: target_deviation}
  consecutive: {same_day_work: forbid, consecutive_day_work: forbid, adjacent_engaged: forbid}
  duty_coupling: {next_day: [{id: r1, after: {shift: night, position: work}, duty: any, effect: forbid}]}
  slot_class_rules: [{id: rest_day, class: {any: [{shift: day}, {shift: night, next_day: off}]}, persons: all, at_least: 1}]
```

### 4.5 現行規則の対応表

「現行 ID」は本書の付録 11.1 で定義する番号で、`docs/sample-rules-cardiology.md` の節と `solver.js` / `check.js` の実装箇所に対応づけてある。フェーズ 0 で共通ルール.md の各項にも同じ番号を付記する。

| 現行 ID | このモデルでの表現 | 区分 |
| --- | --- | --- |
| S1 各枠の勤務者 1 名 | `positions.work.count: 1` | 汎用 |
| S2・S3 OC 構成と若手欠員の許容 | `positions.oc_I / oc_Y` の `count.by_worker_role`、`shortfall` | 汎用 |
| S4 A・C は OC 不可 | `positions.*.eligible.roles` | 汎用 |
| S5 同一枠の兼務禁止 | 配置の排他（本体の既定） | 汎用 |
| U1・U2 不可 | `profile.parts` と `unavailable`、月データは現行キー | 汎用 |
| Q1 部長の登用 | `roles[].reserve` ＋ `modules.reserve_role` | 汎用 |
| Q2〜Q4 回数・目標・自動調整 | `modules.quota` | 汎用 |
| C1〜C4 連続禁止 | `modules.consecutive` の 4 項目。例外は役割リスト | 汎用 |
| O9 隣接しない連日 | `consecutive.nonadjacent_consecutive` | 汎用 |
| F1〜F6 固定指定と翌月 1 日 | 月データ `fixed.*`（キー名は現行のまま）、`calendar.next_month_head` | 汎用 |
| F7 固定の優先順位 | `fixed_priority` | 汎用 |
| W1〜W4・O4〜O6・F5 主担当担当 | `modules.period_charge` | 汎用 |
| D1 曜日上限 | `slot_class_rules[weekday_cap]`（`group_by: dow`, `at_most`） | 汎用 |
| FR1 金曜夜勤 1 回 | `slot_class_rules[friday_night]`（`exact`） | 汎用（個人名は設定値） |
| O2 土日日勤の希望 | `slot_class_rules[weekend_dayshift]`（`at_least`, soft） | 汎用 |
| RS1 週休日 | `slot_class_rules[rest_day]`（`persons.has_duty_kind`） | 汎用 |
| O3 副担当責任医師の平日夜勤 | `slot_class_rules[arrhythmia_pre_workday]`（mode avoid / forbid / allow） | 汎用 |
| R1〜R4・O7・O8 業務との結合 | `modules.duty_coupling` | 汎用 |
| K1・K2 専門業務の必要人数 | `modules.staffing.rows` と `post_shift` | 汎用 |
| K3 専門外来「専門業務の人数＋1、配置不要日でも 1 名」 | `need: {over: taskA, plus: 1}`, `off_days_floor` | **施設固有モジュール `mod-cardio.js`** |
| SD1〜SD4 休日の組合せ表 | `modules.same_day_pairs.table` | 汎用（本体に残す。第 10 節 8） |
| AV1・AV2 避と参照解 | `modules.avoid` | 汎用 |
| O1 夜勤希望 | `modules.wishes.night_on` | 汎用 |
| O10〜O12 偏り | `modules.spread[]` | 汎用 |
| O13 最小変更 | `modules.base_change` | 汎用 |
| X1 診断 | 各モジュールの `relaxations` と `diagnoseCands`、`solver.diagnose` の上限 | 汎用 |
| 年末年始の施設休日 | `calendar.closure` | 設定値 |
| docx の週ブロック 9 行・表題・A3 | `docx`（`template: week_block`） | 設定値（レイアウト実装は本体同梱） |
| 「日付だけの不可＝夜勤」 | `unavailable.date_only_means` | 設定値 |
| 履歴の単位（組・0.5） | `period_charge.history.unit` | 設定値 |

施設固有モジュールとして名指しするのは 2 つだけになる。施設固有の部品の専門外来の結合構文（K3）と、docx の週ブロック行定義の既定値である。SD3・SD4（若手の兼務強制・推奨）と C3 の若手例外は、表の 1 行と例外リストで書けるので本体の型に残す。

### 4.6 このモデルで意図的に固定するもの

- 配置の種類は `work` と `standby` の 2 種。半日枠や 3 種目の配置は将来の課題。
- 日中業務の区分は am / pm の 2 区分。
- `by_worker_role` は勤務者の count が 1 の枠でしか使えない（count > 1 では役割指標が 0/1 にならない）。lint で拒否する。
- 同日組合せ表は 2 帯（`shifts: [a, b]`）の組ごとに書く。3 帯以上は表を帯の組だけ増やす。

## 5. 規則型のカタログ（実装者向け）

記法: `x[p,s,n]` は配置 p・枠 s・人 n の 0/1 変数。`W(s,n)` は勤務者配置の和、`E(s,n)` は全配置の和（関与）。`isRole[s][r]` は枠 s の勤務者が役割 r である指標（count 1 のとき 0/1）。前月末の枠は定数。`le1(fixed, expr)` は固定が絡めば減点付き、絡まなければ必須の `expr ≤ 1`。

| 型 | 主なパラメータ | 種別 | LP の要点 | 検算・入力チェック | CP-SAT |
| --- | --- | --- | --- | --- | --- |
| coverage（配置の充足） | `positions[].count`（定数／日種別／`by_worker_role`／月の上書き） | 必須 | `Σ_n x[p,s,n] = need(p,s)`。表なら `Σ_r table[r]·isRole[s][r]` | 人数不一致、資格外、同枠兼務。lint: 枠の候補数 < count | `Add(sum == need)` |
| shortfall（欠員許容） | `positions[].shortfall {when_worker_role, weight}` | 必須＋調整目標 | `= need − m`、`m ≤ Σ_{r∈when} isRole`、`+w·m` | 欠員が条件下でのみ許容されているか | 同型 |
| eligibility / exclusive | `eligible.roles/skills`、`doctors[].never_shifts / never_positions` | 必須 | 資格外は変数を作らない。`Σ_p x[p,s,n] ≤ 1` | 資格外の配置 | 変数を作らない |
| unavailable | `parts`、月データ | 必須（固定で緩和） | `x = 0`。固定が絡む枠は張らない | 不可なのに担当 | `x == 0` |
| fixed | 月データ `fixed.*`、`fixed_priority` | 必須 | `x = 1`。`may_override` の緩め方は 3 種。skip＝固定が絡む (枠, 人) にはその制約を張らない（無減点。不可・業務との結合・副担当責任医師の forbid）。penalize＝`le1(fixed, expr)` で超過分に fixed_conflict（連続禁止）。raise_to_fixed_count＝上限を固定件数まで上げる（目安の上限）。いずれも現行 solver.js / toban.py と同じ | 固定不一致（W にしない）、W 分類は code の属性で | `x == 1` |
| quota | `tolerance`、`auto_targets`、`history_key` | 必須＋調整目標 | `q−tol ≤ total ≤ max(q+tol, 固定件数)`、`dev ≥ ±(total−target)` | 範囲外、固定による超過（W） | `AddAbsEquality` |
| reserve_role | `role`、`max_per_month`、`weight` | 必須＋調整目標 | `total ≤ max`、`+w·total` | 未許可の登用 | 同型 |
| consecutive | `same_day_work`、`consecutive_day_work`、`adjacent_engaged {exceptions}`、`same_shift_consecutive`、`forbid_sequence`、`nonadjacent_consecutive` | 必須（固定で緩和）／調整目標 | 各組に `le1(fx, 和)`。例外は役割・状況の述語でスキップ。nonadjacent は OR 指標の AND を減点 | 同じ述語で走査。lint: 固定同士の同日・連日 | `AddBoolOr` / 線形 |
| run_length | `class`、`max`、`min {days, mode}`、`boundary` | 必須（max）／調整目標（min） | `y[d] = Σ_{s∈class,日=d} x`。max K: 全窓 `Σ_{j=0..K} y[d+j] ≤ K`。min L: `st[d] ≥ y[d]−y[d−1]`、`y[d+j] + short[d] ≥ st[d]`。前月末は定数、不可日で切れた連は short を張らない | 連の長さを走査。lint: 可能日の最長連 < min | `AddMinEquality` 不要、同型の線形 |
| days_off_min | `min`、`mode`、`exclude_after: [<ends_next_day の帯>]`（明けを休みに数えない。既定は除外なし） | 必須／調整目標 | `N − Σ_d b[d] ≥ min`。`b[d]` は日 d の OR 指標で、`b[d] ≥ W(s,n)` の他に `exclude_after` の帯について `b[d] ≥ x[s, d−1]` も含める | 休日数 | 同型 |
| incompatible | `persons: [a, b]`（個人の組）／`role: r`（1 役割の上限）／`roles: [r1, r2]`（異なる 2 役割の同席上限）、`scope: slot / day`、`max` | 必須 | 個人の組: slot は `E(s,a)+E(s,b) ≤ 1`、day は日集約 OR 指標の和 ≤ 1。1 役割: `Σ_{n∈r} x ≤ max`。異なる 2 役割: `Σ_{n∈r1} x + Σ_{n∈r2} x ≤ max`（r1 = r2 は同じ人を二重に数えるので lint で拒否） | 同じ組合せの検出 | 同型 |
| slot_class_rules | `class`（shift / dow / on / next_day / position / any。`kind: input` 専用に `source: <月データのキー>`）、`persons`、`exact` / `at_least` / `at_most`、`group_by`、`mode` | 必須／調整目標 | `T = Σ_{s∈class} x`。exact: `T = k`。at_least: `T ≥ k`（soft は報酬 `h ≤ T`）。at_most: `T ≤ k`（soft は超過 `ex ≥ T−k`）。avoid/forbid: `+w·x` / `x = 0` | 回数の照合。lint: 可能枠数 < 必要回数 | 同型 |
| duty_coupling | `next_day[]`、`same_day[]`（`after`、`duty {kind, part}`、`effect`、`month_key`） | 必須（固定で緩和）／調整目標 | 条件に当たる `(d, n)` で `x = 0` または `+w·x`。翌月 1 日は推定業務 | 翌日・当日業務との衝突。lint: 固定との矛盾 | `x == 0` |
| staffing | `rows[] {group, need, off_days_key}`、`post_shift`、`only` | 必須＋調整目標 | `avail(g,d,half) = Σ_{n∈g, 空き} (1 − [除外]·W([d−1, post], n)) ≥ need`。`count_with_penalty` は不足量 `cpn` を減点 | 時間帯別の候補表（cathTable の一般化）。lint: 業務だけで候補不足 | 同型 |
| period_charge | `role`、`periods`、`split`、`balance`、`history`、`consecutive`、`prefer_position`、`prev_connection`、`fixed_key` | 必須＋調整目標 | `c[d,n]`、`E(s,n) = c[d,n]`、`Σ_n c = 1`、`cp = OR_d c`、分割 `\|c[d1]−c[d2]\| ≤ sp`、`max−min ≤ 2·diff`、履歴込み max/min | 責任者 1 名、日を通した一貫性、前月末・翌月接続、固定不一致、最大差 | `AddMaxEquality` |
| same_day_pairs | `shifts: [a, b]`、`table[] {a, b, effect}` | 必須／調整目標 | forbid: `isRole[a]+isRole[b] ≤ 1`。penalty: AND 指標。must: `x[work,b,n] + isRole[a] − 1 ≤ x[standby,a,n]`。prefer: 同式の右辺に `+v` | 組合せの照合、兼務の照合 | 同型 |
| spread | `group`、`count {position, shift, on}`、`history_key` | 調整目標 | `a ≥ T(n)`、`b ≤ T(n)`、`+w(a−b)`。履歴は定数を加算 | 集計のみ | `AddMaxEquality` |
| wishes / avoid | `night_on`、`off`、`no_reduction` | 調整目標 | `−w·x`、`+w·E`。参照解方式は 2 回解いて回数の下限 `avdn ≥ floor − total` | 第 9 節の集計 | 同型 |
| base_change | `weight` | 調整目標 | 基準解との差分 `±w·x` | 変更枠の一覧 | 同型 |

補足の設計判断は 4 点。

- `fixed_priority.may_override` に無い規則は固定指定でも緩めない。現行の「枠の充足・チーム構成・主担当の一貫性・専門業務の必要人数は固定でも緩めない」をそのまま表す。固定で緩めた条件に減点が付くのは連続禁止（penalize）だけで、これも現行と同じ。したがって循環器プロファイルの目的関数値は変わらない。
- 診断（緩和 → 1 件ずつ戻す）は `solver.diagnose` の `max_solves`・`each_limit`・`total_limit` で打ち切り、進捗と中止ボタンを出す。候補はモジュールが返す（`diagnoseCands`）。
- `run_length.min` の減点は、不可日・休日申告・月初で切れた連には掛けない（`boundary`）。これで避けたい日と同じ「申告で損をする」問題を避ける。
- `slot_class_rules` の `kind: input`（希望休の上限など）は LP に入れず、入力チェックだけで判定する。

## 6. アーキテクチャ（実装者向け）

### 6.1 ファイル構成（変更後）

| ファイル | 役割 | 変更 |
| --- | --- | --- |
| `src/model.js` | Problem。`profile` の読み取り、枠生成、派生集合、`canonicalizeRules` / `validateRules` | 大 |
| `src/solver.js` | LP ビルダー、核の制約、モジュールループ、solve、diagnose | 大（本体は縮む） |
| `src/check.js` | 核の検算・lint、モジュールループ、metrics | 大 |
| `src/modules/*.js` | 規則モジュール（quota, reserve_role, consecutive, run_length, days_off_min, incompatible, slot_class, duty_coupling, staffing, period_charge, same_day_pairs, spread, wishes_avoid, base_change） | 新規 |
| 施設固有の部品（現在は保存フォルダの plugins/） | 専門外来の `over/plus`、docx 週ブロックの既定行 | 新規 |
| `src/i18n.js` | 文字列表 ja / en、`T.t`、`T.msg`、日付書式 | 新規 |
| `src/report.js` | 列と節をモジュールから生成 | 大 |
| `src/docxgen.js` | `week_block` と `month_table` の 2 テンプレート、設定から行・フォント・表題 | 中 |
| `src/merge.js` | flatten をモジュール委譲、汎用形のキー | 中 |
| `src/app-settings.js` | 設定タブの 9 セクション | 大 |
| `src/app-input.js`、`app-month.js` | 選択肢・前月末表・履歴の生成、グリッド入力 | 中 |
| `src/app-core.js`、`app-folder.js`、`app-solve.js`、`app-main.js` | ファイル名・言語切替・診断表示 | 小 |
| `src/index.html`、`help/ja.html`、`help/en.html` | 設定タブ骨格、ヘルプ 2 言語 | 中 |
| `build.py` | SRC_FILES 追加、profiles 埋め込み、`--profile`、`--rules-doc`、検査 3 点、旧キー併記の `data/rules.json` 生成（フェーズ 3〜4） | 小 |
| `tools/profiles/*.yaml` | cardiology / ward-nurse / generic-oncall | 新規 |
| `tools/toban.py` | プロファイル読み取り、モジュール関数化、code 化 | 大（モジュール単位で段階的） |
| `docs/*.md` | settings / rule-types（ja, en）/ facility-branch / data-format | 新規 |

### 6.2 ソルバー

- 変数は `x[pos][k|n]`。現行の `work` / `oc` は `x.work` と `store_as: oc` の配置の和として残す。`Wv / Ov / Ev / has` の統一アクセサは現行どおり前月末を定数化する。
- `buildLP` は次の順で進む。(1) 変数と集計式（`total`、`isRole`）。(2) 核の制約（充足・欠員・資格・排他・固定）。(3) `ctx = {P, lp, x, Wv, Ov, Ev, has, le1, total, isRole, relax, W, opts}` を作り、有効なモジュールの `lp(ctx)` を順に呼ぶ。(4) 解の取り出しは「勤務種（kind: work）の配置は count に一致、待機（standby）は need − shortfall に一致（shortfall 変数の値も読む）、全変数が整数」を条件にする。現行の「勤務者 1 名と整数性だけを見て OC はそのまま取る」と同じ結果になる。
- **（2026-09-22）この節のモジュール登録の素案は `docs/rule-modules.md` に置き換えた。** 登録の関数は `T.rules.register`、解く側・検算・減点の数え直しを別々に書く形で、減点の突き合わせ・総当たりの試験に自動で乗る。以下は経緯として残す。
- モジュール登録の形は次のとおり。`api` は `T.MODULE_API` と一致しなければ登録を拒否する。

```js
T.modules.register({
  id: "run_length", api: 1, doc_id: "RL1",
  defaults: {...}, aliases: {},                   // 旧キー → 新キー
  prepare(P) {}, lp(ctx) {}, check(P, A, viol) {}, lint(P, push) {},
  metrics(P, A, rows) {}, report(P, A) {}, soft(P, A) {},
  monthKeys: [], flatten(m, put) {}, unflatten(f, m) {}, normalizeMonth(m) {}, blankMonth(m) {},
  relaxations(P) { return [["run_length", "relax.run_length"]]; }, diagnoseCands(P, key) {},
  settingsUI: [{path: "max", type: "int", labelKey: "run_length.max"}], monthUI: []
});
```

- 施設ブランチの拡張口は同じ `register` で、`id` を `local.<施設>.<名前>` にする。本体はこの接頭辞を予約しない。

### 6.3 検算の独立性

- `check(P, A, viol)` は `ctx.x` や `ctx.lp` を受け取らない。受け取るのは Problem と割当だけである。
- 枠クラス・業務・不可の述語は `src/pred-solver.js` と `src/pred-check.js` の 2 本を別に書く。check 側は solver 側を import しない。
- 2 本の述語が一致することは `test_pred_node.js` で全枠 × 全員 × 全述語について突合する。述語のバグが同じ形で両方に入る危険を、突合テストで補う。
- 違反は `{code, args, days, names, keep_as_violation}` で返し、文字列は `T.msg(code, args)` で作る。W 分類（固定指定により許容）は現行の文言判定（`"と不一致"` の部分一致）をやめ、code の属性で判定する。
- 独立なのは述語と制約の組み立てまでである。暦・業務・不可の読み取り（`Problem`）は現行どおりソルバーと検算で共有するので、その層の誤りは両方に同じ形で入る。そこは Python 版（第三の実装）との突合で捕まえる。
- Python 版は核と循環器モジュールの第三の実装として残す（6.11）。

### 6.4 入力チェック（lint）

- 核の可行性検査（各枠に入れる人がいるか、固定と不可の矛盾、固定同士の連日）は本体。モジュールは自分の検査を `lint(P, push)` で足す。
- `validateRules` は設定の整合を具体名で報告する。未知の役割・勤務帯・配置 id への参照（`doctors`、`modules`、`month.fixed`、`result.asg`）、count > 1 での `by_worker_role`、`may_override` に無い id、使用中の id の削除、を拒否する。
- id の改名は `renameId(kind, old, new)` で全参照（名簿・規則・月データ・結果）を追随させる。現行の `renameDoctor` と同じ扱い。

### 6.5 画面

設定タブは次の 9 セクションを上から順に並べる。後半は `<details>` で畳む。id は表示する。新しい行には `r1` / `s1` のような既定 id を自動で付け、変更は `renameId` 経由でのみ許す（名簿・規則・月データ・結果の参照を追随させる）。循環器プロファイルの id（I / A / Y / C、day / night、oc_I / oc_Y）は保存互換のため固定する。

| 順 | セクション | 内容 |
| --- | --- | --- |
| 1 | 基本 | 言語、プロファイル（既定に戻す元）、規則の版 |
| 2 | 役割と資格 | 行の追加・削除、表示名（ja / en）、予備要員の印 |
| 3 | 勤務帯 | 表示名、ある日（平日／休日／毎日）、順序、覆う区分、翌日にまたがる |
| 4 | 配置 | 勤務帯 × 配置の表。人数（定数／日種別／勤務者の役割で決まる小表）、担当できる役割・資格、欠員許容 |
| 5 | 名簿 | 氏名・役割・年数・目安・資格タグ・当直（候補／予備／禁止）・恒常の不可・表示順。個人リスト型パラメータの列は規則から自動生成 |
| 6 | 規則 | モジュールごとのカード。有効／必須か減点か／重み／パラメータ。対象者は名簿からチェック、枠クラスは帯・曜日・翌日区分のチェック。表型（duty_coupling、staffing.rows、same_day_pairs）は列名を i18n 表から出す |
| 7 | 期間責任者・日中要員 | 有効、役割、期間の定義、許容差、要件表 |
| 8 | 出力 | docx テンプレート、行構成、フォント、表題、ファイル名 |
| 9 | JSON | 現行の直接編集。`validateRules` の結果を具体名で表示 |

月別条件は次のように生成する。

- 不可・避の選択肢は `parts` と `weekday_options / holiday_options` から。循環器では現行の 7 択／4 択が再現される。
- 固定の選択肢は「その日に存在する帯 × その人が eligible な配置」。`period_charge` が有効なら責任者の項目を足す。count > 1 の配置は複数選択。
- 前月末の接続表の列は帯 × 配置。行数は `prev_month_tail`。履歴・配置不要日・「予備要員を候補に含める」はモジュールが有効なときだけ出す。
- `duty_layer: false` のプロファイルでは業務欄・曜日パターン・翌月 1 日の業務欄を隠す。
- 人数が多い施設向けに、人 × 日のグリッド（不可・希望・固定の一括入力）と CSV 取り込みをフェーズ 4 に含める。

設定タブは「設定 → フォーム記述（JSON）→ DOM」の 2 段にし、フォーム記述と設定の往復（render → read で全項目が戻り、未知キーを落とさない）を Node で検査する。

### 6.6 docx の差し替え方

- 本体は 2 つのテンプレートを持つ。`week_block`（現行の A3 週ブロック 9 行、行の中身は `docx.rows`）と `month_table`（行＝日、列＝帯 × 配置。count > 1 向け）。
- 用紙は `docx.paper` で A3 / A4 / Letter と向きを選ぶ。フォント・表題・数字（全角／半角）・略称規則（先頭 1 文字／イニシャル）は言語別。
- これ以外のレイアウトが要る施設は `mod-<施設>.js` で `T.docx.register(id, renderFn)` を呼び、`docx.template: <id>` で選ぶ。renderFn は `(P, A, opts) → {xml, files}` を返す。
- 現行の出力と同一であることは `test_docx_node.js` で、固定した割当に対して document.xml を比較して保証する（表題の日付は `opts.today` で固定する）。

### 6.7 説明資料（report.js）

- 第 0〜3 節と第 10 節は本体。第 4 節（期間責任者）、第 5 節（同日組合せ）、第 6 節（週休日）、第 7 節（業務との重なり）、第 8 節（日中要員）はモジュールが返す。無効なモジュールの節は省き、節番号は現行を維持する。
- 第 9 節（調整目標の達成状況）は各モジュールの `soft()` の連結。
- 第 0 節に「規則の要約」を足す。`modules` の設定から生成し、設定タブにも同じ文を出す。手書きの規則文書と設定の乖離をここで見つける。
- 説明資料 HTML の第 11・12 節（割当根拠と変更説明・作成責任者への確認事項）は `report.js` ではなく書き出し側（app-solve.js の `reportHtml`）が足している。現行のまま。

### 6.8 統合（merge.js）

- 循環器プロファイルでは flatten のキーを一切変えない。
- 汎用形（2 帯以外、count > 1）ではモジュールが `flatten / unflatten` を登録する。キーは `un:<name>:<d>:<part>`、`av:<name>:<d>:<part>`、`fx:<d>:<shift>:<pos>:<name>`、`cnt:<d>:<pos>`。
- `rules` は `mergeMonth` に渡さない（引数は現行のまま）。別関数 `diffRules(mine, theirs)` で差分一覧を表示し、採用は現行どおり相手側（ファイル）の rules。自分の変更は「共通ルール.json をフォルダに保存」で反映する。

### 6.9 言語切替

- `src/i18n.js` に `T.L = {ja, en}` と `T.t(key, vars)`、`T.msg(code, args)`、`T.dateLabel(d, opts)` を置く。対象は UI ラベル・ボタン・toast・確認文・`WEIGHT_LABELS`・`RELAXATIONS`・`KINDS`・曜日・違反と lint の code 文言・report の節題と表ヘッダ・docx の行ラベルと表題。日本語の文字列は約 700 か所（check・report・app-* に集中）。
- 役割・勤務帯・配置・業務種別の名前は設定側の `label: {ja, en}`。文字列 1 本なら全言語共通。
- 言語の決定は `rules.lang`（施設既定）→ localStorage の上書き → ヘッダーの切替ボタン。1 枚の HTML に両言語を埋め込む。ヘルプは `help/ja.html` と `help/en.html` を両方埋め込み表示を切り替える。
- ヘルプに埋め込む規則文書は `build.py --rules-doc <path>` で差し替える。本体の既定は「規則型リファレンス」、循環器ブランチは `docs/sample-rules-cardiology.md`。
- ファイル名は `files` の言語別テンプレート。既定は現行の日本語名。`findMonthData` は現行名と設定名の両方を探す。
- toban.py の文言は日本語のまま。突合は code 比較なので影響しない。

### 6.10 テスト

| テスト | 目的 | 導入フェーズ |
| --- | --- | --- |
| `test_golden_node.js` | 回帰フィクスチャの目的関数値（1e-6 で丸める）・違反 0・W 件数・固定枠・避の参照解の回数（avoid_ref）が基準と一致。割当そのものは同点解の中で制約の並び順により変わるので比べない | 0 |
| `test_docx_node.js`（拡張） | 固定した割当 JSON（`data/js_assignment*.json`）から作った document.xml が基準と一致。`docxXml` に `opts.today` を足して表題の日付を注入し、テストでは固定日付を渡す | 0 |
| `test_lp_snapshot_node.js` | 正規化した LP テキスト（変数名と補助変数の連番を正準化し、制約を整列）の一致。solver.js を分割する区間だけ有効にし、分割後は golden に緩める | 3 |
| `test_pred_node.js` | solver 側と check 側の述語の一致（全枠 × 全員） | 3 |
| `test_rules_node.js` | モジュールごとの小さな合成問題（run_length、incompatible、forbid_sequence、days_off_min、count > 1） | 3 |
| `test_parity_node.js` / `tools/parity.py` | (a) 双方の解が相手の検算で違反 0、(b) Optimal 同士で目的関数値一致（希望の重み定数を正規化）、(c) metrics 一致。未実装モジュールを含むプロファイルは skip と表示 | 5 |
| `test_settings_node.js` | 設定タブのフォーム記述 ↔ 設定の往復 | 4 |
| `build.py --check` | 参照検査、名簿外氏名の走査、ライセンス表記（MIT）の一致、`name_order ⊆ doctors`、profile 整合 | 0 |
| 既存 `test_*.js` | 文言の部分一致 assert（「部長」「夜間不可」「固定指定」「勤務」）は code 判定に置換。`team === "C"` は `roles[].reserve` に | 2 |

### 6.11 Python 版の位置づけ

- `tools/toban.py` は核と循環器モジュールの第三の実装として維持する。施設ブランチに移植義務はない。
- 移行はモジュール単位で進める。`build_and_solve` の各ブロックを `mod_<id>(ctx)` に切り出し、未移植のモジュールは旧内部辞書への逆変換で現行コードを動かす。
- `--profile` で未実装モジュールを含むプロファイルを読んだときは、skip と明示して終了する。黙って一部だけ解かない。
- `split_fixed_warnings` の文言依存は JS と同じ code 化で置き換える。

### 6.12 未知のモジュール・プロファイルの扱い

- 保存 JSON の `rules.modules` に本体が知らない id がある、または `rules.profile.id` が埋め込みプロファイルにも登録済み `mod-*.js` にも無いときは、計算を無効化して読み取り専用で開く。表示・docx 出力・説明資料は可。
- 設定タブと計算タブに「このファイルは `<id>` を必要とします。対応する版またはブランチで開いてください」と出す。黙って無視すると必須条件が落ちた当直表が出るため、拒否を既定にする。
- `module_api` の不一致も同じ扱い。

## 7. データと後方互換（実装者向け）

| 対象 | 方針 |
| --- | --- |
| 保存 JSON `{rules, month, result, saved_at}` | 形は不変。`rules.profile / modules` が無ければ `fillDefaultRules` が循環器プロファイルを補う。現運用の JSON はそのまま開け、同じ LP になる |
| 旧 rules キー（`oncall_requirement`、`cath_requirement`、`quota_tolerance`、`max_same_weekday_shifts`、`weekend_balance_max_diff`、`friday_night_exact`、`weekend_dayshift_wish`、`arrhythmia_*`、`pm_clinic_arrhythmia_candidates`、`exclude_post_night_from_cath`） | `canonicalizeRules` が読込時にモジュール側へ写す。保存時は循環器プロファイルの範囲内なら旧キーも併記する（`exportLegacyRules`）。旧版 toban.html は未知キーを無視して動く。優先順位: 循環器プロファイルでは `cath`・`friday_night_exact` 等の旧キーを正とし、`modules` の該当項目と `skills` は読込時に旧キーから再生成する（`exportLegacyRules` の逆写像）。旧版の設定タブは `doctors` を作り直すので `skills` は消えるが、旧キーが正なら失われない。旧キーで表せない設定（規則の無効化、新しい規則型の行）を使った保存データは `legacy_compatible: false` にする |
| month のキー | 循環器プロファイルでは一切変えない。汎用形（`unavailable: [{name, day, part}]`、`fixed[<shift> / <pos>]`、`count_overrides`、`history.by_shift`）は 2 帯・count 1・待機 2 種の範囲を超えたプロファイルでだけ使う |
| `month.legacy_compatible`（既定 true） | month の中に置く。保存 JSON の最上位に置くと現行の `payloadJson` が落とし、`applyLoaded` も読まないため。汎用形を使った保存データに `false` を立てる。フェーズ 0 以降の版はこのフラグを見て「新しい版で開いてください」と警告し、上書き保存しない。それより前の版が残る PC は、フェーズ 3 の配布前に全て入れ替える（第 8 節） |
| `result.asg` | count が 1 なら `work` は文字列のまま。count > 1 の配置だけ配列。`Asg.workers(s, pos)` が両方を読む |
| `month.profile_id`、`result.profile_id` | 新設。前月からの引き継ぎ（`applyConnection`）は前月の profile_id が違えば、id の一致する帯・配置だけ取り込み、残りは空にして notes に警告を書く |
| `prev_month.last_days` | 日数は `calendar.prev_month_tail`。循環器は 2 のまま |
| 統合のキー | 循環器プロファイルは現行の `cal:<name>:<d>`（医師×日で 1 値。値の `night / day / allday / avoid_*` は part id なので互換）。それ以外は `un:<name>:<d>:<part>` と `av:<name>:<d>:<part>`（part ごとに 1 項目。同じ日に複数の帯だけ不可、が表せる。6.8） |
| localStorage、IndexedDB のフォルダ参照 | 不変 |
| `data/rules.json` | `build.py` が `tools/profiles/cardiology.yaml` から生成。他プロファイルは `T.PROFILES` として埋め込む |
| 名簿の改名 | `renameDoctor` の追随対象に、個人名を持つモジュール設定（`persons.names`、`incompatible.persons`、`staffing.rows[].plus_names`）を加える |
| `month.schema_version` | 現行 = 1（未記載）。汎用形で保存したとき 2。循環器プロファイルは 1 のまま。rules 側には置かない |
| `rules_version` | 「2.0」に上げる。埋め込みの既定と保存データの版が違うときの注意書きは現行どおり |

## 8. 段階計画（全員向け）

各フェーズの完了条件は「`sh run_tests.sh` が緑」かつ「回帰フィクスチャで目的関数値・違反 0・W 件数・固定枠が前フェーズと一致」。割当そのものは同じ目的関数値の同点解の中で制約の並び順により変わるので比べない（実測: 制約の順序を変えると目的関数値は同じまま 47 枠中 20〜30 枠が入れ替わる）。docx は固定した割当に対する document.xml の一致を別テストで見る（6.10）。ゆっくり進める前提で、どのフェーズで止まっても運用が続く。

| フェーズ | 成果物 | 運用への影響 | 検証 |
| --- | --- | --- | --- |
| 0 公開準備 | ライセンスは MIT のまま（LICENSE / README / ヘルプは差し替え不要。表記の一致検査だけ足す）、THIRD-PARTY-NOTICES、CONTRIBUTING 等の雛形、`test_golden_node.js`、`build.py --check` の 3 検査、共通ルール.md への規則 ID の付記、旧版側の `legacy_compatible` 警告、初回コミット（202611 サンプルの `result.asg` の実名は 2026-09-16 に差し替え済み） | なし（表記とテストの追加のみ） | golden が現行と一致。名簿外氏名 0 件を初回コミットの前提にする |
| 1 名前付け | `rules.profile` の読み取り（役割・資格・勤務帯・配置の表示名）。`validateRules` は役割 id が I / A / Y / C、勤務帯が day / night、配置が work / oc_I / oc_Y 以外を明示的に拒否（solver.js / check.js がこれらを直書きしているため）。画面・報告・docx の「主担当／副担当／若手／部長」「日勤／夜勤」が設定の表示名になる。設定タブのセクション 1〜4 は表示名（ja / en）の編集のみ。行の追加・削除、人数・資格の編集はフェーズ 3 で有効化 | 表示名が設定から出るだけで見た目は同じ | golden 一致。solver.js / check.js は無変更 |
| 2 言語と違反コード | `i18n.js`、`T.t / T.msg`、違反と lint の code 化、W 分類の code 属性化、ヘルプ 2 言語、docx の言語別書式、ファイル名の言語別テンプレート | ヘッダーに言語切替が増える。既定は日本語のまま | 既存テストの文言 assert を code に置換。golden 一致 |
| 3 モジュール化と新規則 | solver.js / check.js の分割、`x[pos]`、`ctx`、モジュール登録表、`mod-cardio.js`、run_length / days_off_min / incompatible / forbid_sequence / at_most、count > 1 の内部形（`Asg.workers`）、待機 2 配置、`fixed_priority`、診断の上限、`tools/profiles/` 3 種 | 循環器では変化なし。JSON 編集で規則の有効／無効と数値が変えられる | golden 一致、LP スナップショット（分割区間のみ）、`test_pred`、`test_rules`。看護師フィクスチャで解あり |
| 4 画面の生成化 | 設定タブの 9 セクション、月別条件の選択肢・前月末表・履歴欄の生成、count > 1 の全経路（固定の複数選択、チップ、last_days、merge、docx セル、report 列）、グリッド入力と CSV 取り込み、`duty_layer` の隠し、`month_table` | 設定タブの並びが変わる。医師別カレンダーは同じ | `test_settings` の往復、目視、golden 一致 |
| 5 Python 追随 | `toban.py` のプロファイル読み取りとモジュール関数化（未移植は逆変換）、`--profile`、`tools/parity.py`、`test_parity_node.js` | なし | parity 3 条件 |
| 6 公開整備 | docs 一式、README（ja / en）、規則型リファレンス、`docs/sample-rules-cardiology.md` を `tools/profiles/cardiology/README.md` へ、リリース v0.1.0 | なし | `build.py --profile ward-nurse` を run_tests に追加 |

フェーズの順序について。0 → 1 → 2 → 3 は固定である。4 と 5 は 3 の後で独立に進められる。6 は 4 の後が望ましいが、docs の一部（ライセンス・データ形式）は 0 で書ける。

フェーズ 3〜4 の間、`build.py` は `data/rules.json` を旧キー併記（`exportLegacyRules` と同じ写像を Python 側にも持つ）で生成し、`toban.py` は無変更で `run_tests.sh` の突合を続ける。旧キーの併記をやめるのはフェーズ 5 の `parity.py` 導入後。フェーズ 3 の配布前には、全 PC の toban.html がフェーズ 0 以降の版であることを確認する（旧版は汎用形のデータを黙って上書きしうるため）。

フェーズ 3 が最大の山になる。分割の途中で止まらないよう、次の順で細分する。

1. `x[pos]` と `ctx` の導入（LP は同一。スナップショットで確認）。
2. モジュール登録表の導入と、現行ブロックを 1 つずつモジュールへ移す（1 モジュールごとにスナップショット一致を確認）。
3. check.js を同じ順で分割（golden の違反 0・W 件数で確認）。
4. 新規則型の追加（`test_rules` で確認）。
5. count > 1 と待機 2 配置の内部形（看護師フィクスチャで確認）。

## 9. 施設ブランチの運用ガイド（全員向け）

### 9.1 本体とブランチの分担

| 本体（main）が持つもの | ブランチが持つもの |
| --- | --- |
| 規則型と規則モジュール（第 5 節） | 施設プロファイル `tools/profiles/<施設 id>.yaml` |
| モジュール登録の口（`T.modules.register`、`T.docx.register`） | 施設固有モジュール `src/mod-<施設>.js` |
| docx テンプレート 2 種 | 追加の docx テンプレート |
| i18n の本体文字列 | 施設の表示名（プロファイル内の `label`） |
| 規則型リファレンス、設定の説明 | 施設の規則文書（`build.py --rules-doc`） |
| サンプルプロファイル 3 種（cardiology / ward-nurse / generic-oncall） | 施設のサンプル月データ（架空名） |

循環器内科も同じ形のブランチとして扱う。本体に同梱する `cardiology` は「参照プロファイル」であり、本体のテストの基準になる。

### 9.2 ブランチの作り方

1. `main` の最新タグから `facility/<施設 id>` を切る（fork でもよい）。
2. `tools/profiles/<施設 id>.yaml` を作る。まず `generic-oncall` か `ward-nurse` を複製し、役割・勤務帯・配置・規則を埋める。
3. 本体の型で表せない規則があれば `src/mod-<施設 id>.js` に `T.modules.register({id: "local.<施設 id>.<名前>", api: T.MODULE_API, …})` で足す。本体のファイルは変更しない。
4. `build.py --profile <施設 id> --plugins src/mod-<施設 id>.js --rules-doc <施設の規則文書>` で toban.html を作る。
5. 架空名のサンプル月を `data/<施設 id>_sample.json` に置き、`test_rules_node.js` の形で施設固有規則のテストを足す。

### 9.3 本体の更新の取り込み

- 本体はタグごとに CHANGELOG を出す。「施設モジュール影響」の印が付いた変更は、`module_api` の増加、ctx の形の変更、month の汎用形の変更のいずれかである。
- ブランチは本体のタグに rebase（または merge）する。衝突が起きるのは `build.py` の SRC_FILES と `index.html` のヘルプ差し替えに限られる想定である。
- `module_api` が上がったら `mod-<施設>.js` の `api` を合わせ、`validateRules` と `test_rules` を通す。合わない版で開くと計算が無効化される（6.12）。

### 9.4 本体への還元

- 汎用に使える規則型・モジュール・i18n・docs は PR で本体に還元する。条件は CONTRIBUTING の 4 点（テスト通過、3 点同期、架空データ、DCO）と inbound MIT 宣言。
- 施設固有の意味づけ（特定の外来、特定の個人指定）は本体に入れない。個人名を含む設定はプロファイル側に留める。
- Issue と PR に実在の名簿・勤務データを貼らない。再現は `webapp/data/202611.json` を改変して行う。

### 9.5 プロファイルの置き場

| 置き場 | 内容 |
| --- | --- |
| `tools/profiles/*.yaml` | 本体同梱のサンプルと参照プロファイル。`build.py` が `T.PROFILES` として埋め込む |
| 施設ブランチの `tools/profiles/<施設 id>.yaml` | 施設の正本。`data/rules.json` はここから生成 |
| 共有フォルダの `共通ルール.json` | 運用中の値。設定タブの「共通ルール.json をフォルダに保存」で書く。プロファイルの yaml とは `rules_version` で対応づける |

## 10. 未決事項（全員向け）

| # | 項目 | 選択肢 | 推奨 | 決める時期 |
| --- | --- | --- | --- | --- |
| 1 | ライセンス | （済）MIT のまま。制限付きライセンスは管理が難しいため採らない | 済（2026-09-16） | 済 |
| 2 | 計算代行・有償改修の扱い | （済）MIT なので条文では制限しない | 済 | 済 |
| 3 | 202611 サンプルの `result.asg` に残っていた実名 13 件 | （済）架空名簿に合わせて差し替えた（2026-09-16） | 済。再発防止に `build.py --check` の名簿外氏名の走査をコミットの前提にする | 済 |
| 4 | 配置人数 > 1 のときの `asg` の形 | （済）1 名は文字列のまま、複数名だけ配列。`Asg.workers` で吸収（2026-09-20） | 済 | 済 |
| 5 | 「日付だけの不可」の既定 | `night`（現行）／`allday` | プロファイルごとの設定値にし、循環器は `night`、新規プロファイルの雛形は `allday` | フェーズ 1 |
| 6 | 旧 rules キーの併記をいつやめるか | 恒久／全 PC の更新後にやめる | 「旧版の toban.html を全 PC で入れ替えた」と判断した版（v0.3 目安）で `exportLegacyRules` を既定オフに | フェーズ 3 以降 |
| 7 | Python 版の範囲 | 核＋循環器のみ／看護師型まで／凍結 | 核＋循環器＋看護師型のモジュール（run_length、incompatible）。それ以外は skip | フェーズ 5 |
| 8 | SD3・SD4 と C3 の若手例外の置き場 | 本体の型（`same_day_pairs` の must / prefer、`adjacent_engaged.exceptions`）／`mod-cardio.js` | 本体。表 1 行と例外リストで書け、本体だけで現行と同値になる | フェーズ 3 |
| 9 | 重みの既定 | プロファイル横断 1 表／プロファイルごとに同梱 | プロファイルごとに同梱し、未知キーはキー名のまま表示 | フェーズ 3 |
| 10 | docx のレイアウトをどこまで設定化するか | 2 テンプレート＋登録口（本案）／週ブロックの列数・行数まで設定 | 本案。列数・行数の設定化は要望が出てから | フェーズ 4 |
| 11 | 看護師型の目安の意味 | 総勤務日数／帯別の回数 | `quota` は総勤務日数、帯別は `slot_class_rules.at_most` と `spread.history_key` で表す。`autoTargets` は Σcount を枠数にする | フェーズ 3 |
| 12 | 連勤の月またぎ | 月末で打ち切り／翌月冒頭の予定枠を入力 | `next_month_head` の日数分だけ翌月の固定を入力できるようにし、無ければ打ち切り | フェーズ 3 |
| 13 | 診断の上限の既定 | `max_solves 40 / total 600 秒`（本案）／もっと小さく | 本案。看護師型で計測してから調整 | フェーズ 3 |
| 14 | 入力画面のグリッド化 | 医師別カレンダーのみ／グリッドと CSV を追加 | 追加（フェーズ 4）。循環器は既定でカレンダー | フェーズ 4 |
| 15 | CLA の要否 | （済）DCO で始める。法人貢献者が出たら CLA を検討 | 済（2026-09-16） | 済 |
| 16 | 英語運用時の略称と用紙 | イニシャル・A4 or Letter | `docx.abbrev` と `docx.paper` で設定。既定は言語別 | フェーズ 2 |
| 17 | `unavailable_other.part: "day"` が日中要員にも効く二重の意味 | 現行のまま／`parts[].daytime` で明示 | `parts[].daytime` で明示（循環器は現行と同じ値） | フェーズ 3 |
| 18 | 規則の要約の自動生成をどこに出すか | 説明資料第 0 節のみ／設定タブにも | 両方 | フェーズ 4 |
| 19 | プロジェクト名 | （済）`toban-roster`（表示名 Toban Roster、副題 "Duty roster builder for hospital departments"）。配布物のファイル名 `toban.html` と Python 版 `toban.py` は変えない | 済（2026-09-16） | 済 |
| 20 | 無償の他施設向けホスティングの扱い | （済）MIT なので制限しない | 済 | 済 |

## 11. 付録（実装者向け）

### 11.1 現状の規則一覧の要約（規則 ID の定義）

ID は本書で付けた番号で、`docs/sample-rules-cardiology.md` の節と `webapp/src/solver.js`（`buildLP`）・`check.js` の実装箇所に対応づける。フェーズ 0 で共通ルール.md の各項にも同じ ID を付記する。行番号は 2026-09-15 時点。

| ID | 名称 | 種別 | 共通ルール.md の節 | 実装箇所 | 汎用化後の置き場 |
| --- | --- | --- | --- | --- | --- |
| S1〜S5 | 各枠の勤務者 1 名、OC 構成（主担当・若手。S3 は A 勤務時の若手欠員を大幅減点で許容）、A・C は OC 不可、同一枠の兼務禁止 | 必須（S3 は緩和付き） | 第 3 節の表 | buildLP L84-92、check §1 | `profile.positions`（本体） |
| U1・U2 | 夜間不可、日勤帯／両方の不可 | 必須（固定で緩和） | 第 3 節 | buildLP L98-103、check §2 | `profile.parts` ＋ 月データ（本体） |
| Q1 | 部長の登用は月 1 回まで（大幅減点） | 必須＋調整目標 | 第 2 節 | buildLP L109、check §3 | `modules.reserve_role` |
| Q2〜Q4 | 回数は目安 ±1、当月目標からの乖離、自動調整 | 必須／調整目標／入力補助 | 第 2 節、第 9 節 | buildLP L110-114、model.js autoTargets | `modules.quota` |
| C1〜C4 | 同日、連日、隣接枠、非主担当の連続夜間の禁止（例外: 主担当の同一期間、若手の同日勤務↔OC） | 必須（固定で緩和） | 第 4 節 | buildLP L124-138、check §4・§5 | `modules.consecutive` |
| F1〜F7 | 固定指定 5 種（夜勤・日勤・日勤 OC・夜間 OC・主担当担当）、翌月 1 日との接続、固定と他条件の競合の減点許容 | 必須／固定で緩和 | 第 1 節、第 7 節（翌月 1 日） | buildLP L120・L166・L179-195、check §7・末尾の W 分類 | 本体 ＋ `fixed_priority` |
| W1〜W4 | 休日ごとの主担当担当 1 名、土日 1 組の同一人（分割は減点）、月またぎの接続、担当数の最大差 | 必須／調整目標 | 第 6 節 | buildLP L153-176、check §6 | `modules.period_charge` |
| D1 | 同じ曜日の勤務は月 2 回まで（超過は減点） | 調整目標 | 第 2 節 | buildLP L198-203 | `modules.slot_class_rules` |
| FR1 | 金曜夜勤の指定回数（個人） | 必須 | 第 2 節 | buildLP L205-206、check §7 | `modules.slot_class_rules` |
| R1〜R4 | 夜勤翌日の外勤・午後業務、夜間 OC 翌朝の外勤、午後外勤日の日勤 OC、午後外勤後の夜勤（確認済みのみ） | 必須（固定で緩和） | 第 7 節 | buildLP L212-218、check §8 | `modules.duty_coupling` |
| K1〜K3 | 専門業務の必要人数（午前は夜勤明けを数えると減点）、特定の曜日の専門外来 | 必須＋調整目標 | 第 7 節 | buildLP L222-236、check.js cathTable | `modules.staffing`（K3 の結合は `mod-cardio.js`） |
| RS1 | 外勤のある医師の週休日 1 日以上 | 必須 | 第 8 節 | buildLP L239-243、check §10 | `modules.slot_class_rules` |
| SD1〜SD4 | 休日の日勤者 × 夜勤者の組合せ表（I+A 禁止、A+A 減点、I+Y の兼務強制、A+Y の兼務推奨） | 必須／調整目標 | 第 5 節 | buildLP L248-256、check §11 | `modules.same_day_pairs` |
| AV1・AV2 | 避けたい日、参照解方式 | 調整目標 | 第 3 節 | buildLP L143-147、solver.js solveWithAvoidRef | `modules.avoid` |
| O1・O2 | 夜勤希望、土日日勤の希望 | 調整目標 | 第 2 節、第 9 節 | buildLP L260-265 | `modules.wishes`、`slot_class_rules` |
| O3 | 副担当責任医師の翌日が休日でない平日夜勤 | 調整目標／必須 | 第 2 節 | buildLP L266-267、check §7 | `modules.slot_class_rules` |
| O4〜O6 | 連続する週末、履歴込みの週末担当の偏り、担当者にその期間の日勤がない | 調整目標 | 第 6 節、第 9 節 | buildLP L269-279 | `modules.period_charge` |
| O7〜O9 | 夜間 OC 翌日の業務、夜勤翌日午前の業務、隣接しない連日 | 調整目標 | 第 4 節、第 7 節 | buildLP L283-291 | `duty_coupling`、`consecutive` |
| O10〜O12 | 主担当の夜間 OC・若手の OC・若手の休日勤務の偏り | 調整目標 | 第 9 節 | buildLP L293-296 | `modules.spread` |
| O13 | 既存案からの変更量 | 調整目標 | 第 11 節 | buildLP L298 | `modules.base_change` |
| X1・X2 | 緩和キーによる診断、解の採用条件（整数性・各枠 1 名） | 実装 | 第 10 節 | solver.js RELAXATIONS L54-65、diagnose L345-377、solve L304-332 | 本体（`solver.diagnose` の上限を追加） |
| CK1〜CK38 | 検算 38 項目と集計（`check.js` の `viol` 呼び出しと `metrics`） | 検算 | 各節 | check.js §1〜§11、metrics L191-204 | 本体とモジュールの `check / metrics`（code 化） |
| LT1〜LT18 | 入力チェック 18 項目（`check.js` の `lint`） | 入力チェック | 第 10 節 | check.js lint L213-293 | 本体とモジュールの `lint`（code 化） |

CK・LT の番号ごとの内訳（項目名と実装行）は 内部文書（設計審査の記録。公開リポジトリには含めない）の末尾の規則の棚卸し表にある。

### 11.2 新設する規則型

| 型 | 用途 | 例 |
| --- | --- | --- |
| run_length | 連勤の上限（必須）と下限（原則） | 5 連勤禁止、原則 3 日以上連続 |
| days_off_min | 月の休日数の下限 | 4 週 8 休 |
| incompatible | 同じ枠・同じ日に入れない組（個人・役割） | 新人 2 名を同じ枠に置かない |
| forbid_sequence | 帯 → 翌日の帯の禁止遷移 | 準夜 → 翌日勤 |
| slot_class_rules.at_most | 枠クラスの上限 | 深夜は月 4 回まで |

### 11.3 参考リンク

| 項目 | URL |
| --- | --- |
| Elastic License 2.0（原文。検討記録用） | https://www.elastic.co/licensing/elastic-license |
| Elastic License 2.0（日本語） | https://www.elastic.co/jp/licensing/elastic-license |
| Elastic License FAQ | https://www.elastic.co/licensing/elastic-license/faq |
| Business Source License 1.1 | https://mariadb.com/bsl11/ |
| Open Source Definition（OSI） | https://opensource.org/osd |
| SPDX License List | https://spdx.org/licenses/ |
| Keep a Changelog 1.1.0 | https://keepachangelog.com/ja/1.1.0/ |
| Semantic Versioning 2.0.0 | https://semver.org/lang/ja/ |
| Contributor Covenant 2.1 | https://www.contributor-covenant.org/ja/version/2/1/code_of_conduct/ |
| Developer Certificate of Origin 1.1 | https://developercertificate.org/ |
| HiGHS | https://highs.dev/ |
| highs-js | https://github.com/lovasoa/highs-js |
| JSZip | https://stuk.github.io/jszip/ |
| pako | https://github.com/nodeca/pako |
| 現行の規則の正本 | `docs/sample-rules-cardiology.md`（リポジトリ直下） |
| 現行の既定値 | `tools/rules.yaml` |

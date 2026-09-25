# Toban Roster — 当直表作成アプリ

Duty roster builder for hospital departments. 日本の病院の当直表（当番表）作成のために作られたので「当番（toban）」の名を付けています。

施設の規則（必須条件と調整目標）に従って、月の当番表を整数計画ソルバーで作成する単一ファイルの Web アプリです。
1枚の HTML（`webapp/toban.html`）をファイルサーバーに置いて Edge / Chrome で開くだけで、月別条件の入力、配置の計算、検算・集計、当番表 docx と説明資料 HTML の出力ができます。外部通信なし、LLM は使いません。画面・説明資料・ヘルプは日本語と英語を切り替えられます。

- 計算エンジン: [HiGHS](https://highs.dev)（WebAssembly、Web Worker で実行）
- 検算用の別実装: `tools/toban.py`（OR-Tools CP-SAT）。既定の見本構成に対応する参照実装で、同じ制約の二重実装として相互検算する（施設のプラグインの規則は対象外）
- ライセンス: MIT（同梱の HiGHS / highs-js / JSZip / pako も MIT）。どの施設も無償で利用・改変・複製・共有できます。貢献は DCO 署名付きで受け付けます（`CONTRIBUTING.md`）

このリポジトリの名簿・規則・サンプル月はすべて架空のものです。実際の運用データは含みません。

## 構成

```
docs/
  generalization-policy.md           汎用化と公開の方針
tools/
  rules.yaml               既定の規則（勤務医の見本、架空の例: 架空名の名簿・目安・OC構成・重み。名簿の年数と見本の月は webapp/synth_sample.py が乱数から作る合成データ）
  month-conditions-template.yaml   Python 版に渡す月別条件のひな形
  toban.py                 Python 版（solve / check）。相互検算に使う
  requirements.txt         pyyaml, ortools
webapp/
  src/                     アプリのソース（i18n / model / messages / solver / check / report / docxgen / merge / app-*）
  lang/                    表示言語（ja.json / en.json）。言語を足すときはここに 1 ファイル足すだけ
  i18n_new.py              言語のひな形を作る・訳の進み具合を見る
  libs/                    highs.js, highs.wasm（highs-js 1.15.2）, jszip.min.js（3.10.1）
  data/                    rules.json（build.py が rules.yaml から生成）、profiles/（同梱の施設プロファイル）、fixtures/（試験だけが使う見本）、テスト用のデータ
  build.py                 src / libs / data / lang から toban.html を組み立てる
  run_tests.sh             テスト一式（node の回帰テスト、画面ソースの相互参照検査、Python 版との突合）
  toban.html               配布物（build.py の出力）
  README.md                開発者向けの詳細
```

## 使い方（利用者）

1. GitHub の Releases から `toban.html` をダウンロードする（1 ファイル。約 5 MB）。ダウンロードのページに SHA-256 が書いてあるので、必要なら照合する。
2. Edge か Chrome で開く。外部との通信はなく、計算も保存もその PC の中で行う。
3. 画面の「ヘルプ」に使い方とライセンスがある。保存先のフォルダを選ぶと、月ごとのデータがそのフォルダに保存される。

## 使い方（開発）

```
cd tools && python3 -m venv .venv && .venv/bin/pip install -r requirements.txt && cd ..
cd webapp && ../tools/.venv/bin/python build.py      # toban.html を組み立てる
sh run_tests.sh                                       # テスト（highs の npm パッケージが無ければ ~/.toban-test に入れる）
```

利用者向けの説明はアプリ内のヘルプタブにあります。

## 言語を足す

```
cd webapp && python3 i18n_new.py fr "Français"   # lang/fr.json を作る
# lang/fr.json の値を訳す（画面の文面 ui、違反の文面 msg、ヘルプ help、曜日・日付・区切り）
python3 i18n_new.py fr --check                   # 進み具合
../tools/.venv/bin/python build.py               # toban.html に入る。選択肢も自動で増える
```

訳が無い項目は英語で出るので、途中の状態でも使えます。

## 汎用化と公開の方針

- `docs/generalization-policy.md` — 役割・勤務帯・配置人数を設定化する方針、規則型のカタログ、ライセンスと公開の慣行、段階計画、未決事項
- `docs/rule-modules.md` — 規則を 1 規則 1 部品にまとめる設計（登録の関数・解く側と検算の道具・試験との約束・移し方）。実装済み（2026-09-25 時点で 35 部品）
- `plugin-example/README.md` — 施設の部品（プラグイン）の作り方と見本。`build.py --plugins <フォルダ>` で規則・暦・docx の様式・訳・プロファイルを組み立て時に取り込む
- `docs/publishing.md` — 公開手順（履歴の作り直し、事前点検 `tools/prepublish_check.sh`、GitHub への作成と Release）

## 運用上の注意（共有フォルダで複数人が使うとき）

- 月データはフォルダに保存され、別の PC から同じ月を開いて保存すると 3 者統合が働きます。ただし **2 人が同時に保存する瞬間の取りこぼしは防げません**（後に書いた方が勝つ）。同じ月を同時に編集する人は 1 人に決めるか、時間をずらしてください。
- 保存フォルダの `plugins/` に置いた JS はアプリと同じ権限で動きます。そこに書ける人は、実質アプリの動きを変えられる人です。入力担当者と部品の管理者を分け、追加・変更は内容を確認した人が行ってください。
- 施設プロファイルの識別子（`profile.id`）は施設ごとに付け直してください。同梱の id のまま複数の施設が使うと、月データの取り違えを検出できません。

## 他の施設・部署で使うには

設定タブで、施設プロファイル（同梱: 週 5 日勤＋夜勤（勤務医の見本）・一般当直（最小構成）・2 交代（最小）・病棟看護師 2 交代）を選び、役割・勤務帯と 1 枠の人数・規則（必須／減点／なし）・docx の様式を施設に合わせて変えます。手順はアプリ内のヘルプの「施設の設定のしかた」にあります。

設定で表せない規則・暦・帳票は、施設の部品（プラグイン）として保存フォルダの `plugins/` に置きます（`plugin-example/README.md`）。本体に汎用の部品として足すときは `webapp/src/rules/<id>.js`（`docs/rule-modules.md`）。

## 作成について

本アプリは Anthropic の Claude（Claude Fable 5.1）を用いて作成し、作成責任者（GitHub: 5rrjb76mcm-lgtm）が仕様の決定と動作の検証を行いました。

## 免責

本ソフトウェアは MIT ライセンスのもと「現状のまま」提供され、明示・黙示を問わずいかなる保証もありません（`LICENSE` 参照）。

作成された当番表・勤務表は計算の結果であり、勤務の決定そのものではありません。実際に用いる前に、施設の責任者が内容（人数・法令や就業規則との適合・個々の事情）を確認し、必要な修正を行ってください。本ソフトウェアの利用や結果に起因する損害について、作成者・貢献者は責任を負いません。

入力した名簿・勤務データは利用者の端末とフォルダにのみ保存され、作成者に送られることはありません（外部との通信はありません）。


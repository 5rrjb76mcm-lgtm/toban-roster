# 貢献のしかた / Contributing

このプロジェクトは MIT ライセンスです。貢献も同じ MIT ライセンスで受け入れます。

## 貢献の条件

1. **DCO（Developer Certificate of Origin 1.1）に署名する。** コミットに `Signed-off-by: 氏名 <メールアドレス>` の行を付けます（`git commit -s`）。これは「自分が書いたもので、MIT ライセンスで提出する権利がある」ことの表明です。契約書（CLA）は求めません。
2. **実在のデータを貼らない。** Issue・PR・テストデータに実在の名簿・勤務表・不可日を入れないでください。再現は `webapp/data/202611.json`（架空名）を改変して行います。
3. **テストを通す。** `webapp/` で `sh run_tests.sh` と `../tools/.venv/bin/python build.py --check` が通ること。
4. **規則を変えるときは、解く側・検算・減点の数え直しを同時に直す。** 部品にした規則（`webapp/src/rules/<id>.js`）は 1 つのファイルの `solve` / `check` / `penalty` を揃えて直す。まだ部品にしていない規則はソルバー（`webapp/src/solver.js`）、検算（`webapp/src/check.js` の `check` と `penalty`）を直す。既定値は `tools/rules.yaml`。新しい規則は部品として書く（`docs/rule-modules.md`）。同じ規則を解く側と検算の側で二重に持つ設計で、`test_penalty_node.js` が両者の減点の合計の一致を、見本の施設と規則の状態を変えた設定で確かめます。Python 版（`tools/toban.py`）は循環器内科の既定の構成だけを確かめる参照実装として凍結しており、直す必要はありません（対応していない規則を使う設定では、自分から止まります）。
5. **本体に施設固有の意味づけを入れない。** 特定の外来や個人名に依存する規則は施設の部品（保存フォルダの `plugins/`。`plugin-example/README.md`）に置きます（`docs/generalization-policy.md` 第 9 節）。

貢献者の氏名（または GitHub 名）と年は `CONTRIBUTORS.md` に記録します。

## English summary

Contributions are accepted under the same MIT License as the project. Sign off each commit (`git commit -s`, DCO 1.1). Never post real staff names or real roster data; reproduce issues with the fictitious sample `webapp/data/202611.json`. Run `sh run_tests.sh` and `build.py --check` before opening a PR. When changing a rule, edit its module `webapp/src/rules/<id>.js` and keep its `solve`, `check` and `penalty` consistent (write the messages in English first); `test_penalty_node.js` verifies that the solver and the checker count the same penalty. `tools/toban.py` is a frozen reference implementation for the default sample profile and need not follow every new rule. Keep facility-specific rules out of the core: put them in a plug-in under `plugins/` in the save folder (see `plugin-example/README.md`).

# 公開手順（履歴の作り直しと初回公開）

公開は「いまの内容から」行う。過去の履歴には、架空化する前の見本データや内部向けの資料が含まれていた時期があるため、公開リポジトリには持ち込まない
（`docs/generalization-policy.md` 未決事項 3 を参照）。

方針は次の 3 点。

- **作業フォルダはそのまま、履歴だけを新しくする。** フォルダの場所を変えないので、試用フォルダの `更新する.sh` や運用フォルダの手順はそのまま使える。
- **古い履歴は端末の中に鏡（mirror）として残し、どこにも push しない。** 参照や取り消しのためだけに置く。
- **実在の名簿はこの端末から出さない。** 点検スクリプトは名前そのものを表示せず、見つかったファイル名と件数だけを出す。

以下、`<repo>` はこのリポジトリのフォルダ（`toban-roster/`）。`git stash` は使わない（作業ツリーがきれいな状態で始める）。

## 1. 事前点検

```sh
cd <repo>
PUBLISH=1 FULL=1 TOBAN_PROD_DIR=<運用フォルダ> sh tools/prepublish_check.sh
```

- `PUBLISH=1` は公開用の厳しい形。名簿の検査を必須にし、フォルダが無い・入れないサブフォルダがある・JSON が読めない・名簿が 0 名のときは NG で止まる。
  何かを省略したときは最後の表示が「すべて通過」ではなく「実施した検査は通過（省略: …）」になり、省略した項目を名指しする。
- `TOBAN_PROD_DIR` は実名の名簿が入った運用フォルダ（`rules.json` や月データ JSON を含む場所）。JSON から `doctors[].name` を集め、公開する内容に含まれないことを見る。
  名前は本文（そのままの表記、JSON のエスケープ表記 `\uXXXX`、JSON を解析した後の文字列）に加え、ファイル名（パス）、未公開コミットのメッセージと著者名、注釈付きタグでも探す。
  パスやタグ名そのものに名前があるときは、その名前を表示せず件数だけ出す。見本の架空名簿と `LICENSE` の著作権者の名前は検査から除く。
  `TOBAN_REAL_NAMES=<1 行 1 名のファイル>` でも同じ検査ができる。名簿と無関係で読めない JSON がフォルダにあるときは `TOBAN_PROD_EXCLUDE=<パスの一部>` で
  そのファイルだけを除く（サブフォルダごと除くと、そこに入っていた名前も集まらなくなる）。
- `FULL=1` で試験一式（`webapp/run_tests.sh`。数分）も回す。
- ほかに見るもの: 追跡されている配布物・運用データ・内部文書・月フォルダが無いこと、トークンや鍵に見える文字列、端末のパス（ホームから始まる絶対パス）、`build.py --check`。
- 環境変数はそのコマンドにだけ効く。以後の実行でも毎回 `PUBLISH=1 TOBAN_PROD_DIR=…` を付ける。

目で確認すること:

- `README.md`・`LICENSE`・`CONTRIBUTING.md` の内容（著作権者の表記は `LICENSE` と一致しているか）。
- 内部向けの文書（設計審査の記録、作業記録）は `../toban-roster-内部文書/` に置き、リポジトリでは追跡しない（点検スクリプトが確認する）。
  公開しないと決めた文書は、この段階で削除してコミットしておく（履歴を作り直すので、削除前の内容は公開リポジトリに残らない）。

決めておくこと:

| 項目 | 選択肢 | 影響 |
| --- | --- | --- |
| コミットの著者メール | いまの `git config user.email`（個人のメール）か、GitHub の noreply アドレス | 公開リポジトリのコミットに載る。DCO の `Signed-off-by` も同じアドレスにする |
| リポジトリ名 | `toban-roster`（README の表記と同じ） | URL |
| 公開の順 | まず private で作って中身をブラウザで確認し、それから public に切り替える（推奨） | 誤って公開したものを取り消す手間を避ける |
| 初回のタグ | `v0.1.0`（`generalization-policy.md` 3.9 の `v0.y.z`） | Release の名前。`build.py` の表示は日付版（`v2026.09.23` の形）のままでよい |

## 2. 古い履歴の退避

```sh
cd <repo>
git clone --mirror . ../toban-roster-旧履歴.git
git -C ../toban-roster-旧履歴.git remote remove origin
git -C ../toban-roster-旧履歴.git remote            # 何も出ない
git -C ../toban-roster-旧履歴.git for-each-ref | wc -l   # 元の参照の数（main と pre-ward-trial で 2 以上）
```

`--mirror` で作った複製には元の作業フォルダを指す `origin` が付き、`git remote update` を実行すると新しい履歴に合わせて参照が書き換わってしまう。
そのため作成直後に `origin` を外し、**同期する鏡ではなく、固定した履歴の写し**として扱う。端末内だけに置き、push 先は作らない。

## 3. 履歴の作り直し

作業ツリーがきれい（`git status` に何も出ない）であることを確かめてから、順に実行する。

```sh
cd <repo>
git checkout --orphan fresh
git add -A
git commit -s -m "Toban Roster: 初回公開" -m "勤務表（当直表）作成アプリ。単一 HTML（webapp/）、Python の参照実装（tools/）、規則文書と設計文書（docs/）、施設の部品の例（plugin-example/）。"
git branch -D main
git branch -m main
git for-each-ref --format='%(refname)' refs/tags refs/remotes | xargs -n1 git update-ref -d   # 旧タグ（pre-ward-trial など）と remote 追跡の参照を消す。タグは旧履歴を保持するので必須
git reflog expire --expire=now --all
git gc --prune=now --aggressive
```

確認（1 つでも違えば止める。pack の容量は判定に使わない）:

```sh
git for-each-ref --format='%(refname)'   # refs/heads/main の 1 行だけ
git rev-list --all --count               # 1
git fsck --unreachable --no-reflogs      # 何も出ない
git status                               # きれい
FRESH=1 sh tools/prepublish_check.sh     # 上の 2 点を機械的に確認する（参照が main だけ、全コミット数 1）
```

`git commit -s` は `Signed-off-by` を付ける（CONTRIBUTING の DCO と同じ形）。著者メールを変えるときは、この前に `git config user.email <アドレス>` を設定しておく。

## 4. もう一度点検

```sh
PUBLISH=1 PUSH=1 FRESH=1 TOBAN_PROD_DIR=<運用フォルダ> sh tools/prepublish_check.sh
```

最後の行が「実施した検査は通過（省略: 試験一式）」であることを確認する（省略してよいのは試験一式だけ。手順 1 で通している）。名簿の検査が省略されていたら指定漏れなので止める。
`PUSH=1` は上流が無いのでこれから送る全履歴（1 コミット）の中身・ファイル名・コミットメッセージを走査し、`FRESH=1` は参照が main だけであることを見る。

## 5. GitHub にリポジトリを作る

```sh
cd <repo>
gh repo create toban-roster --private --source=. --remote=origin --push --description "Duty roster builder for hospital departments (単一 HTML の勤務表・当直表作成アプリ)"
```

ブラウザで中身を確認する（ファイル一覧、README の表示、LICENSE が MIT と検出されていること、コミットが 1 つだけであること）。問題がなければ公開に切り替える。

```sh
gh repo edit --visibility public --accept-visibility-change-consequences
gh repo edit --add-topic roster --add-topic scheduling --add-topic hospital --add-topic highs --add-topic single-file
```

## 6. 初回リリース（配布物の添付）

配布物はリポジトリにコミットせず、Release に添付する（`generalization-policy.md` 3.8）。点検したのは追跡中のソースなので、配るファイルが**そのコミットから**作られたことを
次の順で確かめる。

```sh
cd <repo>
git tag -a v0.1.0 -m "v0.1.0"
git describe --exact-match --tags        # v0.1.0（配布元のコミットを確定）
PUBLISH=1 TAGS=v0.1.0 TOBAN_PROD_DIR=<運用フォルダ> sh tools/prepublish_check.sh   # タグの名前と注釈も照合（コミットを送り終えた後に付けたタグは PUSH=1 の範囲に入らないため明示する）
cd webapp && ../tools/.venv/bin/python build.py && cd ..
git status --porcelain                   # 何も出ない（build.py は data/rules.json を書き直す。差分が出たら、ソースと配布物の入力が食い違っているので止める）
PUBLISH=1 ARTIFACT=webapp/toban.html TOBAN_PROD_DIR=<運用フォルダ> sh tools/prepublish_check.sh   # 組み立て結果も名簿・トークンの走査に含める
shasum -a 256 webapp/toban.html
```

さらに、組み立てた `toban.html` をブラウザで開き、見本データで計算・検算・書き出しが動くことを見てから添付する。
`toban-probe.html`（動作検査）は、highs の npm パッケージ 1.15.2（同梱の wasm と同じ版）を置いて `build_probe.py` で作ったものだけを添付する。出自の分からない手元の版は添付しない。
用意できないときは初回は toban.html だけでよい。

```sh
git push origin v0.1.0
gh release create v0.1.0 webapp/toban.html --verify-tag --title "v0.1.0" --notes "初回公開。toban.html の SHA-256: <上で出た値>"
```

`--verify-tag` は、タグが無いときに gh が勝手にタグを作るのを防ぐ。

添付したあと、別の空フォルダへ取得し直して照合する（添付物の取り違えを防ぐ。組み立てたファイル・取得したファイル・Release 本文の 3 つの SHA-256 が一致すること）:

```sh
mkdir -p /tmp/toban-rel && cd /tmp/toban-rel && gh release download v0.1.0 -R 5rrjb76mcm-lgtm/toban-roster -p toban.html
shasum -a 256 toban.html                  # 組み立てたファイルの値・Release 本文の値と同じか
gh release view v0.1.0 -R 5rrjb76mcm-lgtm/toban-roster --json body --jq .body
```

## 7. 以後の運用

- 試用フォルダ（`toban-roster-試用/更新する.sh`）と運用フォルダの手順は変えなくてよい（フォルダの場所が同じ）。
- 実名の入ったデータは運用フォルダにだけ置く。公開リポジトリへ push する前に、毎回次を回す。作業ツリーだけでなく、これから送る未公開のコミット（`@{u}..HEAD`）の中身も
  走査するので、「氏名入りをコミット → 気づいて削除をコミット」のように途中のコミットにだけ残った場合も止まる。

  ```sh
  PUBLISH=1 PUSH=1 TOBAN_PROD_DIR=<運用フォルダ> sh tools/prepublish_check.sh && git push
  ```

  タグを送るときは `TAGS=<タグ名>` を付けて、タグの名前と注釈も照合してから `git push origin <タグ名>` する（`PUSH=1` は手元の全タグも見るが、送るタグを明示した方が確実）。

  止まったときは、該当コミットを含む範囲を作り直す（`git rebase -i` で該当コミットを直す、または対話的でない `git reset --soft` でまとめ直す）。push してからでは取り消せない。
- `CONTRIBUTORS.md` は外部の貢献者が現れたときに作る（`CONTRIBUTING.md` の記載どおり）。
- 古い履歴の鏡（`../toban-roster-旧履歴.git`）は、参照する必要がなくなったら消してよい。

## 8. 取り消し方

履歴の作り直しをやり直すときは、鏡から作業フォルダを戻す。

```sh
cd <repo>/.. && mv toban-roster toban-roster-作り直し中 && git clone toban-roster-旧履歴.git toban-roster
```

戻るのは Git が追跡している内容だけ。`tools/.venv`（`python3 -m venv` と `pip install -r requirements.txt` で作り直す）、組み立て済みの `webapp/toban.html`（`build.py` で作り直す）、
`git config` のローカル設定（著者名・メール）は戻らない。移した `toban-roster-作り直し中/` は、戻した側で試験一式と組み立てが通ることを確かめるまで消さない。

公開後に取り消すときは、GitHub のリポジトリを削除するか private に戻す（`gh repo delete` / `gh repo edit --visibility private`）。公開したものは複製されている可能性があるので、
公開前の点検（1・4）で止めることを優先する。

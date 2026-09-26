#!/bin/sh
# 当直表アプリのテスト一式。使い方: sh run_tests.sh [highs の npm パッケージのパス]
#   highs パッケージが無ければ scratch に npm i highs@1.15.2 で用意する（組み込みの wasm と同じ版）。
#   Python 版との突合（toban.py）は ../tools/.venv があるときだけ行う。
set -u
cd "$(dirname "$0")"
HP="${1:-}"
if [ -z "$HP" ]; then
  for c in "$HOME/.toban-test/node_modules/highs" ./node_modules/highs; do [ -d "$c" ] && HP="$c" && break; done
fi
if [ -z "$HP" ]; then
  mkdir -p "$HOME/.toban-test" && (cd "$HOME/.toban-test" && npm init -y >/dev/null 2>&1 && npm i highs@1.15.2 --silent) && HP="$HOME/.toban-test/node_modules/highs"
fi
echo "highs: $HP"
fail=0
run() { echo "== $1"; if ! node "$@" ; then fail=1; fi; }
PY=../tools/.venv/bin/python
echo "== 画面（src/app-*.js）の構文と相互参照"
for f in src/*.js; do node --check "$f" || fail=1; done
if [ -x "$PY" ]; then "$PY" build.py --check || fail=1; fi
# 未定義の変数（関数の中で外の変数を使っている、など。画面のコードは node の試験を通らないので、ここで拾う）。eslint 8 が ~/.toban-test にあるときだけ
ESL="$HOME/.toban-test/node_modules/.bin/eslint"
if [ -x "$ESL" ]; then
  echo "== 未定義の変数（eslint no-undef）"
  "$ESL" --no-eslintrc --env browser,es2022 --parser-options=ecmaVersion:2022 --rule '{"no-undef":"error"}' --global T,A,state,JSZip,Module src/*.js src/rules/*.js src/calendars/*.js ../plugin-example/*/*.js || fail=1
else echo "--  未定義の変数の検査は省略（cd ~/.toban-test && npm i eslint@8 で入れると走る）"; fi
run test_golden_node.js "$HP"
run test_refine_node.js "$HP"
run test_merge_node.js
run test_profile_export_node.js
run test_save_node.js
run test_solve_guard_node.js
echo "== 公開前点検のパス判定（tools/test_private_paths.py）"; python3 ../tools/test_private_paths.py || fail=1
run test_docx_node.js /tmp/toban_test.docx
run test_files_node.js
run test_dutydays_node.js "$HP"
run test_infer_node.js "$HP"
run test_prevconn_node.js "$HP"
run test_lint_node.js "$HP"
run test_penalty_node.js "$HP"
run test_brute_node.js "$HP"
run test_plugins_node.js "$HP"
# 実ブラウザの通し試験（Playwright + インストール済みの Chrome）。組み立てた HTML を一時ファイルに作って使う。Playwright か Chrome が無ければ試験の側が省略と表示する
if [ -x "$PY" ]; then
  E2E_HTML=$(mktemp -d)/toban_e2e.html
  if "$PY" build.py --out "$E2E_HTML" >/dev/null 2>&1; then run test_browser_e2e.js "$E2E_HTML"; else echo "FAIL 通し試験用の組み立てに失敗"; fail=1; fi
  rm -f "$E2E_HTML"
else echo "--  実ブラウザの通し試験は省略（../tools/.venv が無いので組み立てられない）"; fi
PY=../tools/.venv/bin/python
PYSKIP=""
if [ -x "$PY" ] && [ -f ../tools/toban.py ]; then
  echo "== Python 版との突合（同じ規則 data/rules.json、曜日パターン形式 data/202611.json）"
  TMP=$(mktemp -d)
  if cp data/202611.json "$TMP/202611.json" && (cd ../tools && "$PY" toban.py solve "$TMP/202611.json" --rules "$(pwd)/../webapp/data/rules.json" --time 60 | grep "状態"); then
    run test_node.js "$TMP/202611_py_assignment.json" "$HP" 60
  else echo "FAIL Python 版の実行に失敗（突合できない）"; fail=1; fi
else echo "警告: Python 版との突合を省略（../tools/.venv か ../tools/toban.py が無い）"; PYSKIP=1; fi
[ "$fail" = 0 ] && echo "ALL OK${PYSKIP:+（Python 突合は省略）}" || { echo "FAILED"; exit 1; }

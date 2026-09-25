#!/bin/sh
# 公開前の点検。docs/publishing.md から呼ぶ。実在の名簿はこの端末の外へ出さない（名前そのものは表示せず、ファイル名と件数だけ出す）。
#
#   sh tools/prepublish_check.sh                                  # 開発中の軽い点検（名簿の検査は省略。最後に「省略あり」と出る）
#   PUBLISH=1 TOBAN_PROD_DIR=<運用フォルダ> sh tools/prepublish_check.sh   # 公開用。名簿の検査を必須にし、読めない・0 名・解析失敗は NG
#   PUBLISH=1 TOBAN_REAL_NAMES=<1 行 1 名のファイル> sh …           # 名簿を一覧で渡す形
#   TOBAN_PROD_EXCLUDE=<パスの一部:…>  # 運用フォルダのうち名簿と無関係なサブフォルダを除く（読めない JSON があるとき）
#   PUSH=1 …        # これから push する未公開のコミット（@{u}..HEAD。上流が無ければ全履歴）の中身も走査する（途中のコミットに残った氏名・トークンも拒否）
#   FRESH=1 …       # 履歴を作り直した直後の確認（参照が refs/heads/main だけ、全コミット数が 1）
#   ARTIFACT=webapp/toban.html …   # 配布する組み立て結果も走査する（複数は : 区切り）
#   TAGS=v0.1.0 …   # 送るタグの名前と注釈を照合する（複数は : 区切り。PUSH=1 のときは手元の全タグを見る）
#   FULL=1 …        # 試験一式（run_tests.sh。数分）も回す
set -u
cd "$(dirname "$0")/.."
ng=0; skipped=""
fail() { echo "NG  $*"; ng=1; }
ok() { echo "ok  $*"; }
skip() { echo "--  $1$2"; skipped="${skipped:+${skipped}、}$1"; }

# 1 作業ツリーがきれいで、公開しないものが追跡されていない
[ -z "$(git status --porcelain)" ] && ok "作業ツリーに未コミットの変更なし" || fail "未コミットの変更があります（git status）"
[ -z "$(git ls-files -ci --exclude-standard)" ] && ok ".gitignore に当たるファイルは追跡されていない" || fail "無視すべきファイルが追跡されています: $(git ls-files -ci --exclude-standard | wc -l | tr -d ' ') 件（パスに氏名が入りうるので表示しない。git ls-files -ci --exclude-standard で確認）"
for p in webapp/toban.html webapp/toban-probe.html webapp/rules.json; do git ls-files --error-unmatch "$p" >/dev/null 2>&1 && fail "$p が追跡されています（配布物・運用データはコミットしない）"; done
git ls-files | grep -E '^webapp/2[0-9]{5}' >/dev/null && fail "月フォルダ（webapp/2xxxxx/）が追跡されています" || ok "月フォルダは追跡されていない"
for p in docs/design-review-2026-09.md docs/time-structure-and-two-shift.md; do git ls-files --error-unmatch "$p" >/dev/null 2>&1 && fail "$p は内部文書です（../toban-roster-内部文書/ に置き、追跡しない）"; done
# 名前の違う非公開物も止める: 施設のプラグイン（plugin-example/ 以外の plugins/ と local.<施設>.* のファイル）、試用記録・内部文書、ルート直下などの月フォルダ
# 判定は tools/private_paths.py（生のパスで見る。core.quotepath のエスケープに影響されない。PUSH=1 なら送る履歴の全コミットのパスも）
if priv="$(PUSH="${PUSH:-}" python3 "$(dirname "$0")/private_paths.py")"; then ok "施設のプラグイン・試用記録・内部文書・月フォルダは追跡されていない（PUSH=1 なら履歴も）"
else fail "非公開のものが追跡されています（プラグイン・試用記録・内部文書・月フォルダ。PUSH=1 なら送る履歴も）: $(echo "$priv" | tr '\n' ' ')"; fi

# 2 履歴を作り直した直後の確認（FRESH=1）
if [ "${FRESH:-}" = 1 ]; then
  refs="$(git for-each-ref --format='%(refname)')"; n_commits="$(git rev-list --all --count)"
  [ "$refs" = "refs/heads/main" ] && ok "参照は refs/heads/main だけ" || fail "main 以外の参照が残っています（旧タグ・旧ブランチ・remote）: $(echo "$refs" | tr '\n' ' ')"
  [ "$n_commits" = 1 ] && ok "全コミット数 1" || fail "全参照から届くコミットが $n_commits 個あります（旧履歴が残っている）"
fi

# 3 組み立て検査（app-*.js の相互参照、見本データの名簿外の氏名、name_order）
( cd webapp && ../tools/.venv/bin/python build.py --check >/dev/null 2>&1 ) && ok "build.py --check 通過" || fail "build.py --check が失敗（cd webapp && ../tools/.venv/bin/python build.py --check）"

# 4 名簿を集める（名前は表示しない）。探索できないフォルダ・読めない JSON・正規化後 0 名は、入力方法に関わらず NG
tmp="$(mktemp)"; trap 'rm -f "$tmp"' EXIT
names_status="skipped"
if [ -n "${TOBAN_REAL_NAMES:-}" ]; then
  if [ -f "$TOBAN_REAL_NAMES" ] && [ -r "$TOBAN_REAL_NAMES" ] && grep -v '^[[:space:]]*$' "$TOBAN_REAL_NAMES" | sed 's/^[[:space:]]*//; s/[[:space:]]*$//' > "$tmp"; then names_status="list"; else names_status="unreadable"; : > "$tmp"; fi
elif [ -n "${TOBAN_PROD_DIR:-}" ]; then
  names_status="$(TOBAN_PROD_DIR="$TOBAN_PROD_DIR" TOBAN_PROD_EXCLUDE="${TOBAN_PROD_EXCLUDE:-}" python3 - "$tmp" <<'PY'
import json, os, sys
root = os.environ["TOBAN_PROD_DIR"]; excl = [e for e in os.environ.get("TOBAN_PROD_EXCLUDE", "").split(":") if e]
if not os.path.isdir(root): print("nodir"); sys.exit(0)
names, files, bad, denied = set(), [], [], []
def walk(o):
    if isinstance(o, dict):
        if isinstance(o.get("doctors"), list):
            for d in o["doctors"]:
                if isinstance(d, dict) and isinstance(d.get("name"), str) and d["name"].strip(): names.add(d["name"].strip())
        for v in o.values(): walk(v)
    elif isinstance(o, list):
        for v in o: walk(v)
for dirpath, dirnames, filenames in os.walk(root, onerror=lambda e: denied.append(e.filename)):  # 入れないフォルダは記録して NG にする（黙って飛ばさない）
    for fn in filenames:
        p = os.path.join(dirpath, fn)
        if not fn.endswith(".json") or any(e in p for e in excl): continue
        files.append(p)
        try: walk(json.load(open(p, encoding="utf-8")))
        except Exception: bad.append(p)
open(sys.argv[1], "w", encoding="utf-8").write("\n".join(sorted(names)) + ("\n" if names else ""))
print(f"files={len(files)} bad={len(bad)} denied={len(denied)} names={len(names)}" + (" 読めない JSON があります（パスは表示しない。TOBAN_PROD_EXCLUDE で除くか、手元で json.load を試す）" if bad else "") + (" 入れないフォルダがあります（パスは表示しない）" if denied else ""))
PY
)" || { names_status="error"; : > "$tmp"; }
fi
case "$names_status" in
  skipped) if [ "${PUBLISH:-}" = 1 ]; then fail "公開用の点検には名簿が要ります（TOBAN_PROD_DIR か TOBAN_REAL_NAMES を指定）"; else skip "名簿の検査" "は省略（TOBAN_PROD_DIR か TOBAN_REAL_NAMES を指定すると走る）"; fi ;;
  nodir) fail "TOBAN_PROD_DIR の指定先が存在しません（指定した値は表示しない）" ;;
  unreadable) fail "TOBAN_REAL_NAMES の指定先が読めません（指定した値は表示しない）" ;;
  error) fail "運用フォルダの探索に失敗しました（python3 のエラーを確認）" ;;
  list) ok "名簿の一覧を読んだ" ;;
  files=*) echo "--  運用フォルダの JSON: $names_status"
    case "$names_status" in *"bad=0"*) ;; *) fail "運用フォルダに読めない JSON があります（名簿を取りこぼす。壊れたファイルを直すか TOBAN_PROD_EXCLUDE でそのファイルを除く）";; esac
    case "$names_status" in *"denied=0"*) ;; *) fail "運用フォルダに入れないサブフォルダがあります（権限を直す。探索できない範囲の名簿は集まらない）";; esac ;;
  *) fail "名簿の収集で想定外の結果: $names_status" ;;
esac
if [ "$names_status" != "skipped" ]; then
  n_names="$(grep -c . "$tmp" 2>/dev/null || echo 0)"
  [ "$n_names" -gt 0 ] && ok "名簿 $n_names 名を照合に使う" || fail "名簿が 0 名です（空のファイル・空白行だけ・doctors[].name が無い）"
fi

# 5 走査: 追跡ファイル・（PUSH=1）未公開コミットの中身・（ARTIFACT）配布物 に、名簿の名前（そのまま／\uXXXX 表記／JSON を解析した文字列）、トークン、端末のパスが無いこと
scan_out="$(PUSH="${PUSH:-}" ARTIFACT="${ARTIFACT:-}" TAGS="${TAGS:-}" python3 - "$tmp" <<'PY'
import json, os, re, subprocess, sys
names_file = sys.argv[1]
names = [l.rstrip("\n") for l in open(names_file, encoding="utf-8") if l.strip()]
fict = {d["name"] for d in json.load(open("webapp/data/rules.json", encoding="utf-8"))["doctors"]}
lic = open("LICENSE", encoding="utf-8").read()
names = [n for n in names if n not in fict and n not in lic]   # 見本の架空名簿と LICENSE の著作権者は除く
esc = {n: json.dumps(n, ensure_ascii=True)[1:-1] for n in names}
esc = {n: e for n, e in esc.items() if e != n}                 # 非 ASCII の名前だけ \uXXXX 表記を持つ
home_pat = "/Us" + "ers/"
tok = re.compile(r"gho_[A-Za-z0-9]{10}|ghp_[A-Za-z0-9]{10}|github_pat_[A-Za-z0-9_]{10}|sk-[A-Za-z0-9]{16}|BEGIN (RSA|OPENSSH|EC) PRIVATE|AKIA[0-9A-Z]{12}")
hits = {"raw": [], "esc": [], "json": [], "token": [], "path": [], "fname": [], "msg": [], "tagmsg": []}
import base64
try: wasm_b64 = base64.b64encode(open("webapp/libs/highs.wasm", "rb").read()).decode()  # build.py が配布物に埋め込む同梱 wasm と同じ文字列
except OSError: wasm_b64 = ""
art_labels = set()
def name_in(text): return any(n in text for n in names) or any(e in text for e in esc.values())
def strings_of(o, out):
    if isinstance(o, str): out.append(o)
    elif isinstance(o, dict):
        for k, v in o.items(): out.append(str(k)); strings_of(v, out)
    elif isinstance(o, list):
        for v in o: strings_of(v, out)
def scan(label, data, is_json):
    try: text = data.decode("utf-8")
    except UnicodeDecodeError: text = data.decode("utf-8", "replace")
    if "\x00" in text[:4096]: return  # バイナリ（wasm など）は飛ばす。名前は文字列としてしか入らない
    c = sum(text.count(n) for n in names)
    if c: hits["raw"].append(f"{label}:{c}")
    c = sum(text.count(e) for e in esc.values())
    if c: hits["esc"].append(f"{label}:{c}")
    if is_json:
        try:
            out = []; strings_of(json.loads(text), out)
            c = sum(1 for s in out for n in names if n in s)
            if c: hits["json"].append(f"{label}:{c}")
        except Exception: pass
    text2 = text.replace(wasm_b64, "") if (wasm_b64 and label in art_labels) else text  # 配布物の中の同梱 wasm（Base64。鍵の形に偶然一致する）だけを除く。それ以外は削らない
    if tok.search(text2): hits["token"].append(label)
    if home_pat in text2: hits["path"].append(label)
def git(*a): return subprocess.run(["git", *a], capture_output=True, check=True).stdout
# 追跡ファイル（作業ツリー）。ファイル名（パス）に名前があるときは、そのパスを出さずに件数だけ出す
tracked = [p for p in git("ls-files", "-z").decode().split("\0") if p]
masked = 0
for p in tracked:
    if name_in(p): masked += 1
    with open(p, "rb") as f: scan(p if not name_in(p) else f"(パスに氏名)#{masked}", f.read(), p.endswith(".json"))
if masked: hits["fname"].append(f"作業ツリー:{masked}")
# 未公開コミットの中身（PUSH=1）: 途中のコミットにだけ残った氏名・トークンも拒否する
n_commits = 0
if os.environ.get("PUSH") == "1":
    try: up = git("rev-parse", "--abbrev-ref", "@{u}").decode().strip(); rng = f"{up}..HEAD"
    except subprocess.CalledProcessError: rng = "HEAD"
    commits = [c for c in git("rev-list", rng).decode().split() if c]; n_commits = len(commits)
    seen = set()
    for c in commits:
        meta = git("log", "-1", "--format=%B%n%an%n%cn", c).decode("utf-8", "replace")  # コミットメッセージ・著者名: 氏名・トークン・端末のパスのどれも拒否
        if name_in(meta) or tok.search(meta) or home_pat in meta: hits["msg"].append(c[:7])
        npath = 0
        for line in git("ls-tree", "-r", "-z", c).decode().split("\0"):
            if not line: continue
            meta, path = line.split("\t", 1); blob = meta.split()[2]
            if name_in(path): npath += 1
            if blob in seen: continue
            seen.add(blob); scan(f"{c[:7]}:{path}" if not name_in(path) else f"{c[:7]}:(パスに氏名)", git("cat-file", "blob", blob), path.endswith(".json"))
        if npath: hits["fname"].append(f"{c[:7]}:{npath}")
# タグ: 名前と本文（注釈）を照合する。PUSH=1 なら手元の全タグ（公開済みのコミットに後から付けたタグも送れば公開されるので、範囲とは切り離す）、
# TAGS=a:b なら指定したタグ（無ければ NG）。タグ名そのものに名前があるときは名前を出さず番号で示す
want = [t for t in os.environ.get("TAGS", "").split(":") if t]
tag_rows = []
for line in git("for-each-ref", "--format=%(refname:short)%00%(*objectname)%(objectname)%00%(contents)%01", "refs/tags").decode("utf-8", "replace").split("\x01"):
    parts = line.strip("\n").split("\x00")
    if len(parts) >= 3: tag_rows.append((parts[0], parts[1][:40], parts[2]))
known = {t for t, _, _ in tag_rows}
for i, t in enumerate(want):
    if t not in known: hits["tagmsg"].append(f"(指定したタグ #{i + 1} が存在しない)")  # 指定した値は表示しない（名前や鍵の形が入りうる）
n_tags = 0
for i, (tag, target, body) in enumerate(tag_rows):
    if not (os.environ.get("PUSH") == "1" or tag in want): continue
    n_tags += 1
    if name_in(tag) or tok.search(tag) or home_pat in tag or name_in(body) or tok.search(body) or home_pat in body: hits["tagmsg"].append(f"タグ#{i + 1}({target[:7]})")
    if subprocess.run(["git", "merge-base", "--is-ancestor", target, "HEAD"], capture_output=True).returncode != 0: hits["tagmsg"].append(f"タグ#{i + 1}({target[:7]}) は公開する履歴（HEAD から辿れるコミット）の外を指す")  # 走査していないコミットを公開しない
# 配布物（ARTIFACT=a:b）
arts = [a for a in os.environ.get("ARTIFACT", "").split(":") if a]
for i, a in enumerate(arts):
    label = a if not name_in(a) else f"(パスに氏名の配布物)#{i + 1}"
    art_labels.add(label)
    if not os.path.exists(a): hits["path"].append(f"(missing artifact) {label}"); continue
    if name_in(a): hits["fname"].append(f"配布物#{i + 1}:1")
    with open(a, "rb") as f: scan(label, f.read(), a.endswith(".json"))
print(json.dumps({"n_names": len(names), "n_tracked": len(tracked), "n_commits": n_commits, "n_artifacts": len(arts), "n_tags": n_tags, "hits": hits}, ensure_ascii=False))
PY
)"
py_ok=$?
if [ $py_ok != 0 ] || [ -z "$scan_out" ]; then fail "走査そのものが失敗しました（python3 のエラーを確認）"; else
  summary="$(printf '%s' "$scan_out" | python3 -c '
import json, sys
r = json.load(sys.stdin); h = r["hits"]; lines = []
def rep(key, what):
    if h[key]: lines.append(f"NG  {what}: " + " ".join(h[key]))
nt, nc, na, nn = r["n_tracked"], r["n_commits"], r["n_artifacts"], r["n_names"]
scope = f"追跡ファイル {nt}"
if nc: scope += f"、未公開コミット {nc}"
if na: scope += f"、配布物 {na}"
ntag = r.get("n_tags", 0)
if ntag: scope += f"、タグ {ntag}"
if nn:
    rep("raw", "名簿の名前がそのまま入っています（対象:件数）"); rep("esc", "名簿の名前が uXXXX 表記（JSON のエスケープ）で入っています"); rep("json", "JSON を解析した文字列に名簿の名前が入っています")
    if not (h["raw"] or h["esc"] or h["json"] or h["fname"] or h["msg"] or h["tagmsg"]): lines.append(f"ok  名簿の名前（{nn} 名。本文そのまま／エスケープ表記／JSON 解析後／ファイル名／コミットメッセージ／タグ）は無い（{scope}）")
    rep("fname", "ファイル名（パス）に名簿の名前があります（対象:件数。パスは表示しない）"); rep("msg", "コミットメッセージか著者名に名簿の名前があります（コミット）"); rep("tagmsg", "注釈付きタグのメッセージかタグ名に名簿の名前があります")
rep("token", "トークンや鍵に見える文字列があります"); rep("path", "端末のパス（ホームから始まる絶対パス）があります")
if not h["token"]: lines.append(f"ok  トークン・鍵に見える文字列なし（{scope}）")
if not h["path"]: lines.append(f"ok  端末のパスなし（{scope}）")
print("\n".join(lines))')"
  echo "$summary"; echo "$summary" | grep -q '^NG' && ng=1
fi

# 6 試験一式（任意）
if [ "${FULL:-}" = 1 ]; then
  ( cd webapp && sh run_tests.sh > /tmp/toban-prepublish-tests.log 2>&1 ) && ok "試験一式 通過" || fail "試験一式が失敗（/tmp/toban-prepublish-tests.log）"
else skip "試験一式" "は省略（FULL=1 で回す）"; fi

if [ $ng != 0 ]; then echo "点検に NG があります"; exit 1; fi
if [ -n "$skipped" ]; then echo "実施した検査は通過（省略: ${skipped}）"; else echo "すべて通過"; fi

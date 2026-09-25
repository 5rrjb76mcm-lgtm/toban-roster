#!/usr/bin/env python3
# 公開前点検の一部: 非公開のもの（施設のプラグイン・試用記録・内部文書・運用の月フォルダ）のパスが追跡されていないかを、
# git の生のパス（-z 区切り。core.quotepath のエスケープを受けない）で見る。PUSH=1 なら、これから送る履歴の全コミット（@{u}..HEAD。上流が無ければ全履歴）のパスも見る。
# 見つかれば 1 で終わり、該当パスを 1 行ずつ出す（氏名を含みうるので、行の一部を伏せて出す）。
import os, re, subprocess, sys
PAT = re.compile(r"(^|/)plugins/|試用|内部文書|(^|/)2[0-9]{5}(/|$)|(^|/)local\.[A-Za-z0-9_-]+\.")
OK = re.compile(r"^plugin-example/|(^|/)local\.example\.")
def git(*a): return subprocess.check_output(["git", *a], stderr=subprocess.DEVNULL)
def lines(b): return [p for p in b.decode("utf-8", "surrogateescape").split("\0") if p]
paths = set(lines(git("ls-files", "-z")))
if os.environ.get("PUSH") == "1":
    try: up = git("rev-parse", "--abbrev-ref", "@{u}").decode().strip(); rng = f"{up}..HEAD"
    except subprocess.CalledProcessError: rng = "HEAD"
    for c in git("rev-list", rng).decode().split():
        paths.update(lines(git("ls-tree", "-r", "-z", "--name-only", c)))
bad = sorted(p for p in paths if PAT.search(p) and not OK.search(p))
KINDS = [(re.compile(r"(^|/)plugins/"), "非公開のプラグイン（plugins/）"), (re.compile(r"試用"), "試用記録"), (re.compile(r"内部文書"), "内部文書"),
         (re.compile(r"(^|/)2[0-9]{5}(/|$)"), "運用の月フォルダ"), (re.compile(r"(^|/)local\.[A-Za-z0-9_-]+\."), "施設固有の local.<名前>.* ファイル")]
def kind(p):  # パスの文字列は出さない（ディレクトリ名や local.<名前> に氏名・施設名が入りうる）。種類だけを出す
    for r, label in KINDS:
        if r.search(p): return label
    return "非公開のもの"
for i, p in enumerate(bad, 1): print(f"{kind(p)} #{i}")
sys.exit(1 if bad else 0)

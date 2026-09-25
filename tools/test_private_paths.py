#!/usr/bin/env python3
# tools/private_paths.py の試験: 一時的な git リポジトリで、日本語のパス・plugins/・履歴にだけ残る非公開物・正当な plugin-example を試す。python3 tools/test_private_paths.py
import os, subprocess, sys, tempfile, shutil
HERE = os.path.dirname(os.path.abspath(__file__)); SCRIPT = os.path.join(HERE, "private_paths.py")
def sh(cwd, *a, env=None): return subprocess.run(a, cwd=cwd, env=dict(os.environ, **(env or {})), capture_output=True, text=True)
def check(cwd, push=False): r = sh(cwd, sys.executable, SCRIPT, env={"PUSH": "1" if push else ""}); return r.returncode, r.stdout
def commit(cwd, msg): sh(cwd, "git", "add", "-A"); sh(cwd, "git", "-c", "user.name=t", "-c", "user.email=t@example.com", "commit", "-q", "-m", msg)
def write(cwd, rel, text="x\n"): p = os.path.join(cwd, rel); os.makedirs(os.path.dirname(p), exist_ok=True); open(p, "w", encoding="utf-8").write(text)
fails = 0
def expect(cond, label):
    global fails
    print(("ok   " if cond else "FAIL ") + label); fails += 0 if cond else 1
d = tempfile.mkdtemp(prefix="toban_priv_")
try:
    sh(d, "git", "init", "-q"); sh(d, "git", "config", "core.quotepath", "true")
    write(d, "README.md"); write(d, "plugin-example/rules/local.example.x.js"); commit(d, "init")
    expect(check(d)[0] == 0 and check(d, True)[0] == 0, "正当なファイルだけなら通る（plugin-example の local.example.* を含む）")
    write(d, "docs/試用記録.md"); commit(d, "add jp")
    rc, out = check(d); expect(rc == 1 and "試用" in out, "日本語のパス（quotepath=true でも）を止める: " + out.strip())
    sh(d, "git", "rm", "-q", "docs/試用記録.md"); commit(d, "rm jp")
    expect(check(d)[0] == 0, "消した後の作業ツリーは通る")
    expect(check(d, True)[0] == 1, "履歴にだけ残る非公開物は PUSH=1 で止まる")
    write(d, "plugins/rules/local.ward.js"); commit(d, "add plugin")
    rc, out = check(d); expect(rc == 1 and "plugins/" in out, "plugins/ を止める")
    sh(d, "git", "rm", "-rq", "plugins"); write(d, "202611/x.json"); commit(d, "month")
    rc, out = check(d); expect(rc == 1 and "月フォルダ" in out, "月フォルダを止める")
    sh(d, "git", "rm", "-rq", "202611"); write(d, "webapp/src/rules/local.acme.rule.js"); commit(d, "local rule")
    rc, out = check(d); expect(rc == 1 and "local." in out, "local.<施設>.* のファイルを止める")
    # 出力に氏名・施設名（架空）が残らない: ディレクトリ名と local.<名前> の名前の部分
    sh(d, "git", "rm", "-rq", "webapp"); write(d, "架空職員ABC/plugins/rules/x.js"); write(d, "webapp/src/local.FictionalNameABC.rule.js"); commit(d, "names in paths")
    r = sh(d, sys.executable, SCRIPT, env={"PUSH": "1"}); both = r.stdout + r.stderr
    expect(r.returncode == 1 and "架空職員ABC" not in both and "FictionalNameABC" not in both and "#2" in both, "検出しても標準出力・標準エラーに名前を出さない: " + both.strip().replace("\n", " / "))
finally: shutil.rmtree(d, ignore_errors=True)
print(f"{'FAIL' if fails else 'ALL OK'} ({fails} failures)"); sys.exit(1 if fails else 0)

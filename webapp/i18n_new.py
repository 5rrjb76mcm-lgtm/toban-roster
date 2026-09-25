#!/usr/bin/env python3
"""表示言語を足す・更新するための道具。

    python3 i18n_new.py fr "Français"   # lang/fr.json を作る（英語の文面を入れた状態）
    python3 i18n_new.py fr              # すでにある lang/fr.json を更新（足りない項目を英語で補い、使わない項目を消す）
    python3 i18n_new.py fr --check      # 書き換えず、訳の進み具合だけを表示

lang/<コード>.json の 1 ファイルを埋めれば翻訳は完了する（画面の文面 ui、違反と入力チェックの文面 msg、
ヘルプ help、曜日 dow、日付の書き方 date_locale、並べるときの区切り list_sep / name_sep）。
値が英語のままの項目が「未訳」として数えられる。英語のままでも表示は英語になるので、途中でも使える。
"""
import json, pathlib, sys, collections

HERE = pathlib.Path(__file__).resolve().parent
LANG = HERE / "lang"

def load(code):
    p = LANG / f"{code}.json"
    return json.loads(p.read_text(encoding="utf-8")) if p.exists() else None

def main(argv):
    if not argv or argv[0].startswith("-"):
        print(__doc__); return 1
    code = argv[0]
    name = next((a for a in argv[1:] if not a.startswith("-")), None)
    check = "--check" in argv
    en = load("en")
    if not en:
        print("lang/en.json がありません"); return 1
    cur = load(code) or {}
    if code in ("en", "ja") and not check:
        print(f"{code} は原文の言語なので、この道具では書き換えません"); return 1

    out = collections.OrderedDict()
    out["code"] = code
    out["name"] = name or cur.get("name") or code
    for k, dflt in [("dow", en["dow"]), ("date_locale", "en-GB"), ("list_sep", ", "), ("name_sep", ", ")]:
        out[k] = cur.get(k, dflt)
    # 画面の文面と、違反・入力チェックの文面。英語にある項目をすべて並べ、訳が無ければ英語を入れておく
    for part in ("ui", "msg"):
        src, had = en[part], cur.get(part, {})
        out[part] = {k: had.get(k, v) for k, v in src.items()}
    # ヘルプは節（id）ごと。訳が無い節は英語を出発点にする
    cur_help = cur.get("help") or {}
    if isinstance(cur_help, list):  # その言語だけ構成を変えている場合はそのまま
        out["help"] = cur_help
    else:
        out["help"] = {i: cur_help.get(i, json.loads(json.dumps(b))) for i, b in en["help"].items()}

    todo = {p: [k for k, v in out[p].items() if v == en[p][k]] for p in ("ui", "msg")}
    help_left = ([] if isinstance(out["help"], list)
                 else [i for i, b in out["help"].items() if json.dumps(b, ensure_ascii=False) == json.dumps(en["help"][i], ensure_ascii=False)])
    dropped = {p: sorted(set(cur.get(p, {})) - set(en[p])) for p in ("ui", "msg")}

    print(f"言語 {out['code']}（{out['name']}）")
    for p, label in [("ui", "画面の文面"), ("msg", "違反・入力チェックの文面")]:
        n = len(out[p]); left = len(todo[p])
        print(f"  {label}: {n - left}/{n} 訳済み（残り {left}）" + (f"　※使われなくなった {len(dropped[p])} 件を落とします" if dropped[p] else ""))
    n_help = len(out["help"])
    print(f"  ヘルプ: {n_help - len(help_left)}/{n_help} 節 訳済み" + (f"（残り {len(help_left)}: {'、'.join(help_left[:4])}{'…' if len(help_left) > 4 else ''}）" if help_left else ""))
    if check:
        for p in ("ui", "msg"):
            for k in todo[p][:5]: print(f"    未訳({p}): {k[:70]}")
            if len(todo[p]) > 5: print(f"    …ほか {len(todo[p]) - 5} 件")
        return 0
    LANG.mkdir(exist_ok=True)
    (LANG / f"{code}.json").write_text(json.dumps(out, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print(f"  → lang/{code}.json を書きました。このファイルの値を訳してください（build.py で toban.html に入ります）")
    return 0

if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))

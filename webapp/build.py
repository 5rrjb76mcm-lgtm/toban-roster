#!/usr/bin/env python3
"""当直表アプリを1枚の HTML（toban.html）に組み立てる。

使い方: python3 build.py [--libs DIR] [--check]
  DIR には highs パッケージ（package/build/highs.js, highs.wasm）と jszip（jszip/package/dist/jszip.min.js）を展開しておく
  （既定は build.py と同じ場所の libs/）。rules.json / サンプル月は data/ から埋め込む。
  --check は app-*.js の相互参照の検査だけを行う（組み立てない。run_tests.sh から呼ぶ）。組み立て時にも同じ検査を行う。
"""
import base64, json, pathlib, datetime, argparse, re, sys, html as html_mod, yaml

here = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(here))
import jsscan
ap = argparse.ArgumentParser()
ap.add_argument("--libs", default=str(here / "libs"))
ap.add_argument("--out", default=str(here / "toban.html"))
ap.add_argument("--check", action="store_true", help="app-*.js の相互参照の検査だけを行う")
ap.add_argument("--plugins", action="append", default=[], metavar="DIR",
                help="施設の部品のフォルダ（rules/ calendars/ docx/ lang/ profiles/ の下に置く。繰り返し可。plugin-example/README.md）")
args = ap.parse_args()
libs = pathlib.Path(args.libs)

SRC_FILES = [("i18n.js", "表示言語の切替（日本語を鍵にした訳の表）"), ("rules-core.js", "規則の部品の登録と共通の道具（docs/rule-modules.md）"), ("model.js", "暦・入力の読み取り・曜日パターン展開・勤務目標の自動調整"),
             *[(f"calendars/{p.name}", f"暦の部品: {p.stem}") for p in sorted((pathlib.Path(__file__).resolve().parent / "src" / "calendars").glob("*.js"))], ("messages.js", "検算の違反と入力チェックの文面（code + 差し込む値）"), ("solver.js", "必須条件と調整目標を整数計画に組み立てて HiGHS で解く。解なし診断"), ("check.js", "割当の検算（必須条件）・集計・入力チェック"), ("report.js", "結果の表示（第1〜10節）"), ("docxgen.js", "当直表 docx の生成"), ("plugins.js", "施設の部品の読み込み口（保存フォルダの plugins/ と組み立て時。plugin-example/README.md）"), ("merge.js", "月データの3者統合（同時編集の統合）"),
             *[(f"rules/{p.name}", f"規則の部品: {p.stem}") for p in sorted((pathlib.Path(__file__).resolve().parent / "src" / "rules").glob("*.js"))],
             # 画面（app-*.js）は T.app（A）を介して互いを参照する。読み込み順は依存に関係なく、起動（app-main.js の init）が最後
             ("app-core.js", "画面: 共有状態・保存署名・ブラウザ内保存・共通ヘルパー・確認ダイアログ"), ("app-folder.js", "画面: フォルダ接続・開始画面・保存と版の書き出し・自動統合・ヘッダー"), ("app-month.js", "画面: 月データの作成・前月からの引き継ぎ・月の切替"),
             ("app-input.js", "画面: 月の設定・医師別カレンダー"), ("app-settings.js", "画面: 設定タブ（名簿・重み）"), ("app-solve.js", "画面: 計算（Worker）・結果・ダウンロード"), ("app-main.js", "画面: 起動（タブ・イベント・初期化）")]
APP_FILES = [f for f, _ in SRC_FILES if f.startswith("app-")]


def check_app_split():
    """app-*.js の相互参照の検査。決まり: 他のファイルの関数・共有変数は A. を付けて参照する／A.xxx はどこかのファイルが Object.assign(A, {...}) で公開している
    ／同じ名前を2つのファイルで宣言しない／$・esc・state は使うファイルごとに const で別名を宣言する。違反を文字列の一覧で返す。"""
    LOCAL = {"$": "const $ = ", "esc": "const esc = ", "state": "const state = A.state"}  # 各ファイルで宣言する別名
    SHARED = {"state", "highs", "dirHandle", "monthDirs", "storedHandle", "autosaveTimer", "solving"}  # app-core.js が A に置く共有変数
    texts = {f: (here / "src" / f).read_text(encoding="utf-8") for f in APP_FILES}
    decl, exports, owner, errors = {}, {}, {}, []
    for f, t in texts.items():
        decl[f] = [x for x in jsscan.declared(t) if x not in LOCAL]
        m = re.search(r"Object\.assign\(A, \{([^}]*)\}\)", t)
        exports[f] = {x.strip() for x in m.group(1).split(",") if x.strip()} if m else set()
        for x in sorted(exports[f] - set(decl[f])):
            errors.append(f"{f}: 公開している {x} がこのファイルで宣言されていない")
        for x in decl[f]:
            if x in owner:
                errors.append(f"{x} が {owner[x]} と {f} の両方で宣言されている")
            owner[x] = f
    exported = {x for s in exports.values() for x in s} | SHARED
    for f, t in texts.items():
        toks = jsscan.identifiers(t)
        used_local = set()
        for i, (name, s, e, prev, nxt) in enumerate(toks):
            line = t.count("\n", 0, s) + 1
            if name == "A" and nxt == "=":
                errors.append(f"{f}:{line}: A（T.app）に代入している")
            if prev == ".":
                if i > 0 and toks[i - 1][0] == "A" and t[toks[i - 1][2]:s].strip() == "." and name not in exported:
                    errors.append(f"{f}:{line}: A.{name} はどのファイルも公開していない")
                continue
            if nxt == ":" and prev in "{,":
                continue  # オブジェクトのキー
            if name in LOCAL:
                used_local.add(name)
            elif name in SHARED:
                errors.append(f"{f}:{line}: 共有変数 {name} は A.{name} と書く")
            elif name in owner and owner[name] != f:
                errors.append(f"{f}:{line}: {name} は {owner[name]} の関数なので A.{name} と書く")
        for x in sorted(used_local):
            if LOCAL[x] not in t:
                errors.append(f"{f}: {x} を使っているが冒頭で {LOCAL[x]} … の別名を宣言していない")
    return errors


def check_names():
    """公開しても差し支えない名前だけが入っているかの検査。
    data/ と 202611/ の JSON（月データ・割当・集計）に、その保存データの名簿（rules.doctors）に無い氏名が
    result.asg / fixed / prev_month に現れないことを見る。架空化の漏れ（過去に JSON の Unicode エスケープ表記を
    取りこぼした）を初回コミット前と各リリース前に捕まえるための検査。"""
    errors = []

    def names_of(rules):
        return {d.get("name") for d in (rules or {}).get("doctors", []) if isinstance(d, dict)}

    def used_in(month, result):
        out = set()
        for v in ((result or {}).get("asg") or {}).values():
            if isinstance(v, dict):
                if v.get("work"): out.add(v["work"])
                out.update(v.get("oc") or [])
        fx = (month or {}).get("fixed") or {}
        for tbl in fx.values():
            if isinstance(tbl, dict):
                for v in tbl.values():
                    out.update(v if isinstance(v, list) else [v])
        for e in ((month or {}).get("prev_month") or {}).get("last_days") or []:
            for k in ("day", "night"):
                if e.get(k): out.add(e[k])
            for k in ("day_oc", "night_oc"):
                out.update(e.get(k) or [])
        return {n for n in out if isinstance(n, str) and n}

    for path in sorted(here.glob("data/*.json")) + sorted(here.glob("2*/*.json")):
        try:
            o = json.loads(path.read_text(encoding="utf-8"))
        except Exception as e:
            errors.append(f"{path.name}: JSON として読めません（{e}）")
            continue
        if not isinstance(o, dict): continue
        month = o.get("month") if isinstance(o.get("month"), dict) else (o if "year" in o else None)
        rules = o.get("rules") if isinstance(o.get("rules"), dict) else rules_default
        known = names_of(rules)
        if not known: continue
        unknown = sorted(used_in(month, o.get("result")) - known)
        if unknown:
            errors.append(f"{path.name}: 名簿に無い氏名が割当・固定・前月末に残っています: {'、'.join(unknown)}")
    return errors


split_errors = check_app_split()
if split_errors:
    print("app-*.js の相互参照に問題があります:\n  " + "\n  ".join(split_errors))
    sys.exit(1)
rules_default = json.loads((here / "data/rules.json").read_text(encoding="utf-8")) if (here / "data/rules.json").exists() else None
name_errors = check_names()
if name_errors:
    print("公開できない氏名が残っています:\n  " + "\n  ".join(name_errors))
    sys.exit(1)
if args.check:
    print(f"app-*.js の相互参照 OK（{len(APP_FILES)} ファイル）、名簿外の氏名なし")
    sys.exit(0)

highs_js = (libs / "highs.js").read_text(encoding="utf-8")
wasm_b64 = base64.b64encode((libs / "highs.wasm").read_bytes()).decode()
jszip = (libs / "jszip.min.js").read_text(encoding="utf-8")
css = (here / "src/style.css").read_text(encoding="utf-8")
# rules は tools/rules.yaml を正とする（あれば）。無ければ data/rules.json
rules_yaml = here.parent / "tools" / "rules.yaml"
if rules_yaml.exists():
    rules = yaml.safe_load(rules_yaml.read_text(encoding="utf-8"))
else:
    rules = json.loads((here / "data/rules.json").read_text(encoding="utf-8"))
sample_path = here / "data/202611.json"
sample = json.loads(sample_path.read_text(encoding="utf-8")) if sample_path.exists() else None
# ---- 施設の部品（--plugins DIR）。種類ごとのサブフォルダから集め、本体の同じ種類の後ろに置く（plugin-example/README.md）
PLUGIN_KINDS = {"rules": "*.js", "calendars": "*.js", "docx": "*.js", "lang": "*.json", "profiles": "*.json"}
plugin_files = {k: [] for k in PLUGIN_KINDS}   # kind -> [(表示名, Path)]
plugin_info = []                                # 埋め込む一覧（T.PLUGINS）
for d in args.plugins:
    pdir = pathlib.Path(d).expanduser().resolve()
    if not pdir.is_dir():
        sys.exit(f"--plugins: フォルダがありません: {pdir}")
    found = {}
    for kind, pat in PLUGIN_KINDS.items():
        files = sorted((pdir / kind).glob(pat)) if (pdir / kind).is_dir() else []
        for q in files:
            if kind in ("lang", "profiles"):
                try: json.loads(q.read_text(encoding="utf-8"))
                except Exception as e: sys.exit(f"--plugins: {q} を JSON として読めません: {e}")
            plugin_files[kind].append((f"{pdir.name}/{kind}/{q.name}", q))
        if files: found[kind] = [q.name for q in files]
    unknown = sorted(x.name for x in pdir.iterdir() if x.is_dir() and x.name not in PLUGIN_KINDS and not x.name.startswith("."))
    if unknown:
        print(f"--plugins: {pdir.name}: 知らないサブフォルダは無視します: {', '.join(unknown)}（使えるのは {', '.join(PLUGIN_KINDS)}）")
    if not found:
        print(f"--plugins: {pdir.name}: 部品が見つかりません（rules/ calendars/ docx/ lang/ profiles/ の下に置きます）")
    plugin_info.append({"dir": pdir.name, "files": found})
def plugin_src(kind):
    return "".join(f"\n// ============================================================\n// [部品 {name}]\n// ============================================================\nT.pluginSource = {json.dumps(kind + '/' + q.name, ensure_ascii=False)};\n" + q.read_text(encoding="utf-8") + "\n;T.pluginSource = null;\n" for name, q in plugin_files[kind])  # 出どころ（実行時の読み込みと同じ「種類/ファイル名」）
def with_plugins(f, code):  # 本体のファイル f の後ろに、同じ種類の部品を続ける
    if f.startswith("rules/") and f == [x for x, _ in SRC_FILES if x.startswith("rules/")][-1]: code += plugin_src("rules")
    if f.startswith("calendars/") and f == [x for x, _ in SRC_FILES if x.startswith("calendars/")][-1]: code += plugin_src("calendars")
    if f == "docxgen.js": code += plugin_src("docx")
    return code

src = "\n".join(f"\n// ============================================================\n// [{f}] {desc}\n// ============================================================\n" + with_plugins(f, (here / "src" / f).read_text(encoding="utf-8")) for f, desc in SRC_FILES)
version = f"v{datetime.date.today():%Y.%m.%d}"

# 設定の整合性（名簿にない名前が表示順に混ざると出力側で落ちる）
names = {d["name"] for d in rules.get("doctors", [])}
bad = [n for n in rules.get("name_order", []) if n not in names]
assert not bad, f"rules.yaml の name_order に名簿にない名前があります: {bad}"
# node テストと相互検算が同じ規則を使えるように、rules.yaml から data/rules.json を作る（手書きしない）
(here / "data").mkdir(exist_ok=True)
(here / "data/rules.json").write_text(json.dumps(rules, ensure_ascii=False, indent=1), encoding="utf-8")

def js_safe(s):
    """<script> の中に入れる文字列（コード・JSON・CSS）で、script の終端と HTML コメント開始を潰す。
    JS の文字列・正規表現・コメント内でも <\\/ は等価、JSON 文字列でも有効なエスケープ。"""
    return re.sub(r"</(script)", r"<\\/\1", s, flags=re.I).replace("<!--", "<\\!--")

html = (here / "src/index.html").read_text(encoding="utf-8")
def put(marker, content):
    global html
    assert marker in html, marker
    html = html.replace(marker, content, 1)
put("/*__CSS__*/", css)
# 「共通ルール」は表示言語で訳すので、別の要素にして埋め込む（文字列のままだと訳の仕組みが拾えない）
put("/*__VERSION__*/", f"v{datetime.date.today():%Y.%m.%d}" + (" +" + "・".join(p["dir"] for p in plugin_info) if plugin_info else ""))  # 規則の内容は設定タブと説明資料が示すので版の文字列は出さない。部品を取り込んだときはそのフォルダ名
assert "/*__PLUGINS__*/[]" in src, "model.js の T.PLUGINS の目印がありません"
src = src.replace("/*__PLUGINS__*/[]", js_safe(json.dumps(plugin_info, ensure_ascii=False)), 1)  # T.PLUGINS（model.js）。src は後で埋め込む
import hashlib
src_stamp = hashlib.sha256((src + css + (here / "src/index.html").read_text(encoding="utf-8")).encode("utf-8")).hexdigest()[:12] + " " + datetime.date.today().isoformat()
while "/*__SRC_STAMP__*/" in html: put("/*__SRC_STAMP__*/", html_mod.escape(src_stamp))  # 無ければ何もしない（ヘルプは lang/*.json 側）
put("/*__JSZIP__*/", js_safe(jszip))
put("/*__HIGHS__*/", js_safe(highs_js))
put("/*__WASM_B64__*/", wasm_b64)
put("/*__RULES__*/", js_safe(json.dumps(rules, ensure_ascii=False)))
# 同梱する施設プロファイル（data/profiles/*.json）。設定タブから選んで読み込める出発点
profiles = [json.loads(q.read_text(encoding="utf-8")) for q in sorted((here / "data/profiles").glob("*.json"))]
profiles += [json.loads(q.read_text(encoding="utf-8")) for _, q in plugin_files["profiles"]]  # 施設の部品のプロファイル
put("/*__PROFILES__*/", js_safe(json.dumps(profiles, ensure_ascii=False)))
# 表示言語（lang/*.json）。言語を足すときはこのフォルダに 1 ファイル足すだけ
langs = [json.loads(q.read_text(encoding="utf-8")) for q in sorted((here / "lang").glob("*.json"))]
langs += [json.loads(q.read_text(encoding="utf-8")) for _, q in plugin_files["lang"]]  # 施設の部品の訳（同じ code なら本体の表に重ねる。i18n.js の registerLang）
for L in langs:  # ヘルプの中の差し込み（ソース識別子・同梱の規則文書）を埋める
    h = L.get("help") or {}
    for blk in (h if isinstance(h, list) else h.values()):
        blk["html"] = blk.get("html", "").replace("/*__SRC_STAMP__*/", html_mod.escape(src_stamp))
put("/*__LANGS__*/", js_safe(json.dumps(langs, ensure_ascii=False)))
put("/*__SAMPLE__*/", js_safe(json.dumps(sample, ensure_ascii=False)) if sample else "null")
put("/*__CSS_STR__*/", js_safe(json.dumps(css, ensure_ascii=False)))
put("/*__SRC__*/", js_safe(src))
out = pathlib.Path(args.out)
out.write_text(html, encoding="utf-8")
print(f"{out} {out.stat().st_size/1e6:.2f} MB  ({version})")

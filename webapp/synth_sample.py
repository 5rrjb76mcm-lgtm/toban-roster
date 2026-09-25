"""同梱のサンプル（架空の循環器内科）の入力を合成データで作り直す。
実データ由来の並び（外来・病棟番・外勤の曜日、不可日、希望、経験年数など）を残さないために、乱数（固定の種）で作る。
作り直すもの: tools/rules.yaml の経験年数、docs/sample-rules-cardiology.md の表、data/202611.json（曜日パターン形式）、
data/202611_data_test.json（保存データ形式。duty_days と計算結果は node で作る）。
使い方: ../tools/.venv/bin/python synth_sample.py [--seed N]   のあと  python build.py → sh run_tests.sh（golden は --update）
"""
import json, random, re, subprocess, pathlib, argparse, datetime
here = pathlib.Path(__file__).resolve().parent
ap = argparse.ArgumentParser(); ap.add_argument("--seed", type=int, default=20260923); args = ap.parse_args()
rng = random.Random(args.seed)
DOW = ["Mon", "Tue", "Wed", "Thu", "Fri"]

# ---- 名簿（役割は既定の設定のまま。年数だけ役割の帯の中で振り直す）
yaml_p = here.parent / "tools" / "rules.yaml"; yaml = yaml_p.read_text(encoding="utf-8")
docs = [dict(zip(["name", "team"], m.groups())) for m in re.finditer(r"- \{name: (Dr [A-Z]), team: ([A-Z]),", yaml)]
BAND = {"C": (24, 32), "I": (8, 26), "A": (8, 22), "Y": (2, 8)}
years = {}
for d in docs:
    lo, hi = BAND[d["team"]]; years[d["name"]] = rng.randint(lo, hi)
# 若手は先輩より若く、部長は最も長く（並びの自然さだけ。個人の年数は乱数）
for d in docs:
    if d["team"] == "Y": years[d["name"]] = min(years[d["name"]], 8)
yaml = re.sub(r"(- \{name: (Dr [A-Z]), team: [A-Z], years: )\d+", lambda m: f"{m.group(1)}{years[m.group(2)]}", yaml)
yaml_p.write_text(yaml, encoding="utf-8")
doc_p = here.parent / "docs" / "sample-rules-cardiology.md"
if doc_p.exists():
    t = doc_p.read_text(encoding="utf-8")
    t = re.sub(r"(\| [^|]+ \| (Dr [A-Z]) \| )\d+( \|)", lambda m: f"{m.group(1)}{years.get(m.group(2), 0)}{m.group(3)}", t)
    doc_p.write_text(t, encoding="utf-8")

names = [d["name"] for d in docs]; team = {d["name"]: d["team"] for d in docs}
I = [n for n in names if team[n] == "I"]; A = [n for n in names if team[n] == "A"]; Y = [n for n in names if team[n] == "Y"]; C = [n for n in names if team[n] == "C"]
duty = [n for n in names if team[n] != "C"] + [C[0]]  # 部長 1 人は候補外だが業務はある

def duties_for(n, carry):
    """1 人の定期業務（曜日パターン）。外来が主、病棟番と外勤を少し。半分の人に外勤（週休日・翌朝外勤の規則の題材）"""
    k = rng.choice([1, 2, 2]) if (team[n] == "A") else rng.choice([2, 2, 3, 3]); out = []; used = set()  # 専門業務の資格者（A）は業務を軽めに（必要人数が足りる形）
    for i in range(k):
        dow = rng.choice([d for d in DOW if d not in used]); used.add(dow)
        kind = rng.choices(["outpatient", "ward", "external"], weights=[55, 25, 20])[0]
        part = rng.choice(["am", "pm", "full"]) if kind != "external" else rng.choice(["am", "pm"])
        e = {"kind": kind, "dow": dow, "part": part}
        if rng.random() < 0.25: e["nth"] = rng.choice([[2, 4], [1, 3, 5]])
        if carry: e["carry"] = True
        out.append(e)
    return out
def month_inputs(pattern_form):
    reg = {n: (duties_for(n, not pattern_form) if team[n] != "C" or n == C[0] else []) for n in names}
    ext = [n for n in names if any(e["kind"] == "external" for e in reg[n])]
    while len(ext) < 4:  # 外勤のある人を最低 4 人（週休日・翌朝外勤の試験の題材）
        n = rng.choice([x for x in duty if x not in ext]); reg[n].append({"kind": "external", "dow": rng.choice(DOW), "part": rng.choice(["am", "pm"]), **({"carry": True} if not pattern_form else {})}); ext.append(n)
    un_night = {}
    for n in names:
        if team[n] == "C": continue
        k = rng.choices([0, 1, 2, 3, 4, 6, 8], weights=[2, 3, 3, 3, 2, 1, 1])[0]
        days = set()
        while len(days) < k:
            d = rng.randint(1, 30); days.add(d)
            if rng.random() < 0.4 and d < 30: days.add(d + 1)  # 続いた不可も
        un_night[n] = sorted(days)[:k]
    un_other = []
    for _ in range(rng.randint(2, 4) if pattern_form else rng.randint(20, 30)):
        n = rng.choice(duty); d = rng.randint(1, 30)
        if d in set(un_night.get(n, [])) or any(u["name"] == n and u["day"] == d for u in un_other): continue  # 夜間不可と重ねない（入力チェックが指摘する形）
        un_other.append({"name": n, "day": d, "part": rng.choice(["allday", "allday", "day", "pm"])})
    wk = rng.sample(I + A, rng.randint(2, 4))
    wishes = {"weekend_dayshift": wk, "night_on": {rng.choice(Y): [rng.randint(2, 28)]}}
    who_avoid = rng.choice(A); cand_days = [d for d in range(1, 31) if d not in set(un_night.get(who_avoid, []))]
    avoid = [{"name": who_avoid, "day": d, "part": "night"} for d in sorted(rng.sample(cand_days, min(len(cand_days), rng.randint(8, 14))))]  # 不可の日とは重ねない
    fixed = {"night": {}, "day": {}, "weekend_charge": {"1": rng.choice(I)}}
    if pattern_form: fixed["night"][str(rng.randint(2, 28))] = rng.choice(I + A)
    ch = fixed["weekend_charge"]["1"]  # 月またぎの土日（10/31–11/1）の期間責任者は 1 人（前月末の OC も同じ人）
    prev = {"last_days": [{"date": 30, "night": rng.choice(A), "night_oc": [rng.choice([i for i in I if i != ch])]}, {"date": 31, "day": rng.choice(Y), "day_oc": [ch], "night": rng.choice(Y), "night_oc": [ch]}],
            "last_weekend_charge": ch, "prev_weekend_charge": rng.choice([i for i in I if i != ch])}
    hist = {"weekend_charge": {n: rng.choice([0, 1, 1]) for n in I}, "holiday_charge": {n: rng.choice([0, 0, 1]) for n in I}, "work_balance": {n: rng.choice([-2, -1, -1, 0, 1]) for n in rng.sample(duty, 4)}}
    hist["work_balance"] = {k: v for k, v in hist["work_balance"].items() if v}
    return reg, un_night, un_other, wishes, avoid, fixed, prev, hist


NODE_HEAD = r"""
const fs=require("fs"),vm=require("vm");globalThis.T={};
for(const f of ["i18n.js","rules-core.js","model.js"])vm.runInThisContext(fs.readFileSync("src/"+f,"utf8"),{filename:f});
for(const d of ["calendars","rules"])for(const f of fs.readdirSync("src/"+d))vm.runInThisContext(fs.readFileSync(`src/${d}/`+f,"utf8"),{filename:f});
for(const f of ["messages.js","solver.js","check.js"])vm.runInThisContext(fs.readFileSync("src/"+f,"utf8"),{filename:f});
for(const q of fs.readdirSync("lang"))T.registerLang(JSON.parse(fs.readFileSync("lang/"+q,"utf8")));
T.DEFAULT_RULES=JSON.parse(fs.readFileSync("data/rules.json","utf8"));
"""
NODE_LINT = NODE_HEAD + r"""
const rp=JSON.parse(fs.readFileSync("data/rules.json","utf8")); T.fillDefaultRules(rp); const mp=JSON.parse(fs.readFileSync("data/202611.json","utf8"));
const o=JSON.parse(fs.readFileSync("data/202611_data_test.json","utf8")); const rr=JSON.parse(JSON.stringify(o.rules)); T.fillDefaultRules(rr); // rules は保存データの形のまま（試験が旧キーで状態を変えられるように）
const pat=JSON.parse(JSON.stringify(o.month)); pat.duty_days=null; o.month.duty_days=T.expandDuties(rr, pat);
fs.writeFileSync("data/202611_data_test.json", JSON.stringify(o,null,1)+"\n");
const l1=T.lint(new T.Problem(rp, T.normalizeMonth(JSON.parse(JSON.stringify(mp)), rp))).map(x=>x.code);
const l2=T.lint(new T.Problem(rr, T.normalizeMonth(JSON.parse(JSON.stringify(o.month)), rr))).map(x=>x.code);
console.log(JSON.stringify({pattern:l1, saved:l2}));
"""
NODE_SOLVE = NODE_HEAD + r"""
(async()=>{const o=JSON.parse(fs.readFileSync("data/202611_data_test.json","utf8")); const rr=JSON.parse(JSON.stringify(o.rules)); T.fillDefaultRules(rr);
 const month=T.normalizeMonth(JSON.parse(JSON.stringify(o.month)), rr); const P=new T.Problem(rr, month);
 const highs=await require(process.env.HOME+"/.toban-test/node_modules/highs")();
 const r=await T.solveWithAvoidRef(P, highs, {timeLimit:180}); if(!r.asg){console.error("解けない:", r.status); process.exit(1);}
 const c=T.check(P,r.asg); console.log("status",r.status,"obj",r.objective,"viol",c.V.length,"W",c.W.length);
 o.result={asg:r.asg,status:r.status,seconds:Math.round(r.seconds*10)/10,objective:r.objective,at:"2026-09-23T00:00:00.000Z",rules_version:rr.rules_version,avoid_ref:r.avoidRef||null,base_asg:null,mark_changes:false};
 o.saved_at="2026-09-23T00:00:00.000Z";
 fs.writeFileSync("data/202611_data_test.json", JSON.stringify(o,null,1)+"\n");})();
"""
def run_node(code):
    (here / "_synth_tmp.js").write_text(code, encoding="utf-8")
    try:
        r = subprocess.run(["node", "_synth_tmp.js"], cwd=here, capture_output=True, text=True)
        if r.returncode: raise SystemExit("node が失敗: " + r.stderr[-1500:])
        return r.stdout.strip()
    finally:
        (here / "_synth_tmp.js").unlink(missing_ok=True)

p1 = here / "data" / "202611.json"; base1 = json.loads(p1.read_text(encoding="utf-8"))
p2 = here / "data" / "202611_data_test.json"; base2 = json.loads(p2.read_text(encoding="utf-8"))
BAD = ("LINT_UNAVAIL", "LINT_PREV_CHARGE", "LINT_CATH_", "LINT_NO_CHARGE", "LINT_FIXED_", "LINT_CAPACITY", "LINT_SLOT_NO", "LINT_FRIDAY", "LINT_PERSON", "LINT_REST")  # 見本は入力チェックに引っかからない形にする
for attempt in range(300):
    # ---- data/202611.json（曜日パターン形式のサンプル月）
    m1 = json.loads(json.dumps(base1))
    reg, un_night, un_other, wishes, avoid, fixed, prev, hist = month_inputs(True)
    m1.update({"regular_duties": reg, "unavailable_night": un_night, "unavailable_other": un_other, "wishes": wishes, "fixed": fixed, "prev_month": prev, "history": hist, "confirmed_pm_external_night": [], "avoid": [], "exceptions": {}})
    p1.write_text(json.dumps(m1, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    # ---- data/202611_data_test.json（保存データ形式）
    o2 = json.loads(json.dumps(base2)); m2 = o2["month"]
    reg, un_night, un_other, wishes, avoid, fixed, prev, hist = month_inputs(False)
    m2.update({"regular_duties": reg, "unavailable_night": un_night, "unavailable_other": un_other, "wishes": wishes, "avoid": avoid,
               "fixed": {"day": {}, "night": {}, "weekend_charge": fixed["weekend_charge"], "day_oc": {}, "night_oc": {}, "day_oc_none": {}, "night_oc_none": {}},
               "prev_month": prev, "history": hist, "confirmed_pm_external_night": [], "targets": {}, "doc_versions": [], "cath_off_days_A": [], "cath_off_days_I": [],
               "notes": "合成データの見本（synth_sample.py）。月またぎの土日: 11/1 の担当を前月末から接続"})
    r2 = o2["rules"]
    for d in r2["doctors"]: d["years"] = years.get(d["name"], d.get("years"))
    r2["friday_night_min"] = {rng.choice(I): 1}; r2["weekend_dayshift_wish"] = rng.sample(I, 2)
    pass  # 循環器内科の規則（副担当の指定など）は非公開のプラグイン側
    o2["month"] = m2; o2["rules"] = r2
    p2.write_text(json.dumps(o2, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    lint = json.loads(run_node(NODE_LINT))
    bad = [c for c in lint["pattern"] + lint["saved"] if c.startswith(BAD)]
    if bad: continue
    print(f"attempt {attempt}: pattern {lint['pattern']} saved {lint['saved']}")
    try: print(run_node(NODE_SOLVE)); break  # 解けたら採用
    except SystemExit as e: print("  解けないので振り直し:", str(e)[-80:].strip())
else:
    raise SystemExit("入力チェックに引っかからず解ける見本が作れませんでした")
print("years:", years)

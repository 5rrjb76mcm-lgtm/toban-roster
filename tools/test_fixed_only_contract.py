"""Synthetic supported-Python fixed-only contract regressions.

python tools/test_fixed_only_contract.py
TOBAN_PYTHON_ROOT=/path/to/unchanged/repo python tools/test_fixed_only_contract.py
The optional --cases JSON is consumed by test_python_fixed_only_contract_node.js.
No real names, private roster, new Python rule, or unsupported profile is used.
"""
import copy
import json
import os
from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(Path(os.environ.get("TOBAN_PYTHON_ROOT", ROOT)) / "tools"))
from toban import Problem, build_and_solve, check, split_fixed_warnings

A, B, C, D, Y = ["Synthetic " + n for n in ("Alpha", "Beta", "Gamma", "Delta", "Young")]


def rules():
    r = json.loads((ROOT / "webapp/data/rules.json").read_text())
    r["doctors"] = [{"name": n, "team": "Y" if n == Y else "I", "quota": 0, "years": 1} for n in (A, B, C, D, Y)]
    r["name_order"] = [A, B, C, D, Y]
    r["quota_tolerance"] = 100
    r["oncall_requirement"] = {t: {"I": int(t == "Y"), "Y": 0} for t in ("I", "A", "Y", "C")}
    r["rule_states"] = {k: "off" for k in ("same_day_double", "consecutive_days", "weekend_balance", "friday_night_min", "rest_day", "same_day_charge_other", "cath_requirement", "same_weekday_cap")}
    r["weights"] = {k: 0 for k in r["weights"]}
    r["weights"]["fixed_conflict"] = 50
    return r


def fixture(label, rule=None, month=None):
    r = rules()
    if rule:
        r["rule_states"][rule] = "hard"
    m = {"year": 2026, "month": 12, "holidays": [], "fixed": {}, **(month or {})}
    p = Problem(copy.deepcopy(r), copy.deepcopy(m))
    asg = {f"{d}:{k}": {"work": (B, C, D)[(i if rule == "same_day_double" else d) % 3], "oc": []} for i, (d, k) in enumerate(p.slots)}
    return {"label": label, "rules": r, "month": m, "asg": asg, "expected": {"hard": 0, "fixed": 0, "objective": 0}}


def work(x, d, kind="night", n=A):
    x["asg"][f"{d}:{kind}"] = {"work": n, "oc": []}


def oc(x, d, kind="night"):
    x["asg"][f"{d}:{kind}"] = {"work": Y, "oc": [A]}


def fixed(x, d, kind="night", mode="work"):
    x["month"]["fixed"].setdefault(kind + ("_oc" if mode == "oc" else ""), {})[str(d)] = [A] if mode == "oc" else A


def expected(x, hard=0, allowed=0, score=0):
    x["expected"] = {"hard": hard, "fixed": allowed, "objective": None if hard else score}
    return x


def cases():
    out = []
    for state in ("none", "left", "right", "both"):
        x = fixture("same day " + state, "same_day_double")
        work(x, 5, "day"); work(x, 5)
        if state in ("left", "both"): fixed(x, 5, "day")
        if state in ("right", "both"): fixed(x, 5)
        out.append(expected(x, hard=int(state != "both"), allowed=int(state == "both"), score=50))
        x = fixture("consecutive " + state, "consecutive_days")
        work(x, 10); work(x, 11)
        if state in ("left", "both"): fixed(x, 10)
        if state in ("right", "both"): fixed(x, 11)
        out.append(expected(x, hard=int(state != "both"), allowed=int(state == "both"), score=50))
    for boundary in ("previous", "next"):
        for external in ("work", "oc"):
            for pinned in (False, True):
                x = fixture(f"{boundary} {external} current fixed={pinned}", "consecutive_days")
                d = 1 if boundary == "previous" else 31
                work(x, d)
                if pinned: fixed(x, d)
                if boundary == "previous":
                    row = {"date": 30, "night": A if external == "work" else Y, "night_oc": [A] if external == "oc" else []}
                    x["month"]["prev_month"] = {"last_days": [row]}
                else: fixed(x, 32, mode=external)
                collision = external == "work"
                out.append(expected(x, hard=int(collision and not pinned), allowed=int(collision and pinned), score=50 if collision else 0))
    for boundary in ("within", "next"):
        for mode in ("oc", "charge"):
            d = 5 if boundary == "within" else 31
            x = fixture(f"{boundary} fixed {mode} is not fixed work", "consecutive_days", {"holidays": [31]})
            oc(x, d, "day"); work(x, d)
            if mode == "oc": fixed(x, d, "day", "oc")
            else: x["month"]["fixed"]["weekend_charge"] = {str(d): A}
            if boundary == "within": work(x, d + 1); fixed(x, d + 1)
            else: fixed(x, 32)
            out.append(expected(x, hard=1))
    x = fixture("previous-only collisions do not constrain this month", "consecutive_days")
    x["month"]["prev_month"] = {"last_days": [{"date": 29, "day": A, "night": A}, {"date": 30, "night": A}]}
    out.append(x)
    x = fixture("previous-only same-day ignored", "same_day_double")
    x["month"]["prev_month"] = {"last_days": [{"date": 30, "day": A, "night": A}]}
    out.append(x)
    x = fixture("next boundary honors consecutive off")
    work(x, 31); fixed(x, 32); out.append(x)
    x = fixture("nonexistent next weekday day is not work", "consecutive_days")
    work(x, 31); fixed(x, 32, "day"); out.append(x)
    for extra in (False, True):
        x = fixture(f"quota fixed count plus extra={extra}", month={"count_max": {A: 1}})
        work(x, 2); work(x, 9); fixed(x, 2); fixed(x, 9)
        if extra: work(x, 16)
        out.append(expected(x, hard=int(extra), allowed=int(not extra)))
    x = fixture("nonexistent work cannot inflate quota", month={"count_max": {A: 1}})
    work(x, 2); work(x, 9); fixed(x, 2); fixed(x, 9, "day")
    # An invalid fixed input also remains a hard mismatch, independently of the cap.
    out.append(expected(x, hard=2))
    for mode in ("work", "oc"):
        for exact in (False, True):
            x = fixture(f"unavailable night {mode} exact={exact}", month={"unavailable_night": {A: [5]}})
            (work if mode == "work" else oc)(x, 5)
            if exact: fixed(x, 5, mode=mode)
            else: work(x, 5, "day"); fixed(x, 5, "day")
            out.append(expected(x, hard=int(not exact), allowed=int(exact)))
    for rule in ("night_then_duty", "night_oc_then_duty", "day_oc_pm", "night_oc_pm", "night_work_pm"):
        for exact in (False, True):
            is_oc = "oc" in rule
            kind = "day" if rule == "day_oc_pm" else "night"
            dutyd = 6 if "then" in rule else 5
            part = "am" if "then" in rule else "pm"
            x = fixture(f"duty {rule} exact={exact}", month={"duty_days": {A: {str(dutyd): {part: "external"}}}})
            (oc if is_oc else work)(x, 5, kind)
            if exact: fixed(x, 5, kind, "oc" if is_oc else "work")
            elif kind == "night": work(x, 5, "day"); fixed(x, 5, "day")
            else:
                # Charge fixes engagement, but it doesn't force this person to be OC.
                x["month"]["fixed"]["weekend_charge"] = {"5": A}
            out.append(expected(x, hard=int(not exact), allowed=int(exact)))
    x = fixture("two unavoidable same-day rows score twice", "same_day_double")
    for d in (5, 12):
        work(x, d, "day"); work(x, d); fixed(x, d, "day"); fixed(x, d)
    out.append(expected(x, allowed=2, score=100))
    x = fixture("four fixed slots make one consecutive day pair", "consecutive_days")
    for d in (5, 6):
        work(x, d, "day"); work(x, d); fixed(x, d, "day"); fixed(x, d)
    out.append(expected(x, allowed=1, score=50))
    for part in ("day", "allday"):
        for exact in (False, True):
            x = fixture(f"unavailable {part} exact={exact}", month={"unavailable_other": [{"name": A, "day": 5, "part": part}]})
            work(x, 5, "day"); work(x, 5)
            fixed(x, 5)
            if exact: fixed(x, 5, "day")
            out.append(expected(x, hard=int(not exact), allowed=int(exact) + int(part == "allday")))
    x = fixture("fixed count never excuses a lower-bound shortfall", month={"count_min": {A: 3}})
    work(x, 2); work(x, 9); fixed(x, 2); fixed(x, 9)
    out.append(expected(x, hard=1))
    for gap, weight in ((2, 7), (3, 11)):
        x = fixture(f"work gap {gap} drops relaxed next fixed endpoint")
        # Unique background workers isolate the boundary term from all in-month gaps.
        for d in range(1, 32):
            n = f"Synthetic Day {d}"
            x["rules"]["doctors"].append({"name": n, "team": "I", "quota": 0, "years": 1})
            x["rules"]["name_order"].append(n)
            for key in x["asg"]:
                if int(key.split(":")[0]) == d: x["asg"][key]["work"] = n
        x["rules"]["weights"][f"work_gap_{gap - 1}"] = weight
        work(x, 32 - gap); fixed(x, 32)
        expected(x, score=weight)
        x["relaxed_objective"] = 0
        out.append(x)
    for x in out:
        if x["label"] in ("same day both", "consecutive both", "previous work current fixed=True", "unavailable night work exact=True", "unavailable night oc exact=True", "quota fixed count plus extra=False") or (x["label"].startswith("duty ") and x["label"].endswith("exact=True")):
            x["relaxed_objective"] = None
        elif x["label"] == "next work current fixed=True":
            x["relaxed_objective"] = 0
    return out


def evaluate(x):
    p = Problem(copy.deepcopy(x["rules"]), copy.deepcopy(x["month"]))
    hard, allowed = split_fixed_warnings(p, check(p, x["asg"])[0])
    status, _, objective = build_and_solve(p, pin=x["asg"], time_limit=10)
    return {"hard": len(hard), "fixed": len(allowed), "objective": objective}, status, hard, allowed


class FixedOnlyContractTest(unittest.TestCase):
    def test_supported_boundaries_checker_and_pinned_solver(self):
        for x in cases():
            with self.subTest(case=x["label"]):
                got, status, hard, allowed = evaluate(x)
                self.assertEqual(got, x["expected"], f"{status}; hard={hard}; allowed={allowed}")
                self.assertEqual(status, "INFEASIBLE" if x["expected"]["hard"] else "OPTIMAL")

    def test_relaxed_fixed_equalities_cannot_leave_exception_proofs(self):
        for x in cases():
            if "relaxed_objective" not in x:
                continue
            with self.subTest(case=x["label"]):
                p = Problem(copy.deepcopy(x["rules"]), copy.deepcopy(x["month"]))
                status, _, obj = build_and_solve(p, pin=x["asg"], time_limit=10, relax={"fixed"})
                self.assertEqual(obj, x["relaxed_objective"])
                self.assertEqual(status, "INFEASIBLE" if obj is None else "OPTIMAL")

    def test_plain_text_is_never_fixed_proof(self):
        x = fixture("text is not proof")
        fixed(x, 5)
        p = Problem(x["rules"], x["month"])
        values = [f"{p.label(5)}: {A} 任意の違反", f"{p.label(5)}: {A} はOC対象外", f"{p.label(5)}: {A} 固定指定と不一致"]
        self.assertEqual(split_fixed_warnings(p, values), (values, []))

    def test_fixed_proof_does_not_depend_on_a_name_or_message_substring(self):
        x = next(x for x in cases() if x["label"] == "same day both")
        for name in ("Synthetic Alpha 件のため", "Synthetic Alpha 固定指定", "Synthetic Alpha 月1回まで"):
            y = json.loads(json.dumps(x).replace(A, name))
            self.assertEqual(evaluate(y)[0], y["expected"])

    def test_fixed_warning_strings_preserve_report_and_json_contract(self):
        x = next(x for x in cases() if x["label"] == "same day both")
        p = Problem(x["rules"], x["month"])
        values = check(p, x["asg"])[0]
        self.assertTrue(all(isinstance(v, str) for v in values))
        self.assertEqual(json.loads(json.dumps(values)), list(map(str, values)))

    def test_unsupported_modes_still_fail_closed(self):
        for rid, state in (("same_day_double", "soft"), ("consecutive_days", "soft"), ("run_length_max", "hard"), ("quota_range", "off")):
            with self.subTest(rule=rid, state=state):
                r = rules(); r["rule_states"][rid] = state
                with self.assertRaises(SystemExit): Problem(r, {"year": 2026, "month": 12})
        for state in ("soft", "off"):
            r = rules(); r["rule_states"]["same_weekday_cap"] = state
            Problem(r, {"year": 2026, "month": 12})


if __name__ == "__main__":
    if "--cases" in sys.argv:
        data = cases()
        for x in data:
            x["python"] = evaluate(x)[0]
            if "relaxed_objective" in x:
                p = Problem(copy.deepcopy(x["rules"]), copy.deepcopy(x["month"]))
                x["python_relaxed_objective"] = build_and_solve(p, pin=x["asg"], time_limit=10, relax={"fixed"})[2]
        print(json.dumps(data, ensure_ascii=False))
    else:
        unittest.main()

"""Post-PR48 work-gap report scope, on supported Python configurations only.

Synthetic inputs; tests the real checker/report and pinned CP-SAT objective.
Authored but not executed in the cloud. TOBAN_PYTHON_ROOT targets baseline code.
No new Python profile/rule support is introduced by this reporting correction.
"""
import atexit
import calendar
import copy
import json
import os
from pathlib import Path
import sys
import traceback

ROOT = Path(__file__).resolve().parents[1]
SOURCE_ROOT = Path(os.environ.get("TOBAN_PYTHON_ROOT", ROOT))
sys.path.insert(0, str(SOURCE_ROOT / "tools"))
from toban import Problem, build_and_solve, check, report, split_fixed_warnings

REGULAR, RESERVE = "Synthetic Gap <&>", "Synthetic Reserve <&>"
CASES = [
    dict(id="previous-only gap 2", prev=[-2, 0], pairs=[]),
    dict(id="previous-only gap 3", prev=[-3, 0], pairs=[]),
    dict(id="reserve previous boundary", reserve=True, prev=[0], work=[2], pairs=[]),
    dict(id="reserve next boundary", reserve=True, work=[28], next=["night"], pairs=[]),
    dict(id="current gap 2", work=[5, 7], pairs=[(5, 7)]),
    dict(id="current gap 3", work=[5, 8], pairs=[(5, 8)]),
    dict(id="previous boundary gap 2", prev=[-1], work=[1], pairs=[(-1, 1)]),
    dict(id="previous boundary gap 3", prev=[0], work=[3], pairs=[(0, 3)]),
    dict(id="next boundary gap 2", work=[29], next=["night"], pairs=[(29, 31)]),
    dict(id="next boundary gap 3", work=[28], next=["night"], pairs=[(28, 31)]),
    dict(id="two shifts still one day pair", work=[5, 7], double=True, pairs=[(5, 7)]),
    dict(id="previous and current double shifts", prev=[0], work=[2], double=True, pairs=[(0, 2)]),
    dict(id="two next shifts still one day pair", work=[29], next=["day", "night"], next_holiday=True, pairs=[(29, 31)]),
    dict(id="both gap lengths without duplicates", work=[5, 7, 8], pairs=[(5, 7), (5, 8)]),
    dict(id="gap 4 is not charged", work=[5, 9], pairs=[]),
    dict(id="next OC is not work", work=[29], next=["night_oc"], pairs=[]),
    dict(id="absent next day slot", work=[29], next=["day"], pairs=[]),
    dict(id="no work pair", work=[5], pairs=[]),
    dict(id="history-only excluded but crossing kept", prev=[-2, 0], work=[1], pairs=[(-2, 1)]),
]
EXPECTED = 19
FINISHED = False


def completion_guard():
    if not FINISHED:
        print("FAIL: work-gap Python regression did not finish", file=sys.stderr, flush=True)
        os._exit(1)


def fixture(c):
    # Default day=off_days/night=all and default role identities are supported.
    year, month, count = 2026, 11, 30
    names = [REGULAR, RESERVE] + [f"Synthetic Background {d}" for d in range(1, count + 1)]
    weights = json.loads((SOURCE_ROOT / "webapp/data/rules.json").read_text())["weights"]
    r = {
        "rules_version": "synthetic-work-gap", "doctors": [
            {"name": n, "team": "C" if n == RESERVE else "I", "quota": 0} for n in names],
        "name_order": names, "quota_tolerance": 100, "weights": dict.fromkeys(weights, 0),
        "rule_states": {k: "off" for k in ("oncall", "period_charge", "weekend_balance",
            "same_day_double", "consecutive_days", "friday_night_min", "rest_day",
            "same_day_charge_other", "same_day_team", "cath_requirement", "same_weekday_cap")},
    }
    r["weights"].update(work_gap_1=7, work_gap_2=11)
    m = {"year": year, "month": month, "allow_chief_duty": True,
         "holidays": list(c.get("work", [])) if c.get("double") else [],
         "next_month_first_day_is_holiday": c.get("next_holiday", False), "fixed": {}}
    who = RESERVE if c.get("reserve") else REGULAR
    prev_n = calendar.monthrange(year, month - 1)[1]
    m["prev_month"] = {"last_days": [
        {"date": prev_n + d, "night": who, **({"day": who} if c.get("double") else {})}
        for d in c.get("prev", [])]}
    for kind in c.get("next", []):
        m["fixed"][kind] = {str(count + 1): [who] if kind.endswith("_oc") else who}
    p = Problem(r, m)
    asg = {f"{d}:{k}": {"work": f"Synthetic Background {d}", "oc": []} for d, k in p.slots}
    for d in c.get("work", []):
        for kind in ("day", "night") if c.get("double") else ("night",):
            assert (d, kind) in p.all_slots_set
            asg[f"{d}:{kind}"]["work"] = who
    return p, asg, who


def main():
    global FINISHED
    atexit.register(completion_guard)
    assert len(CASES) == EXPECTED
    ids = [c["id"] for c in CASES]
    assert len(set(ids)) == EXPECTED
    print("WORK_GAP_REGISTER " + json.dumps(ids), flush=True)
    started, completed, passed, failed = [], [], 0, 0
    for c in CASES:
        started.append(c["id"])
        print("WORK_GAP_START " + json.dumps(c["id"]), flush=True)
        try:
            p, asg, who = fixture(c)
            before = copy.deepcopy((p.rules, p.m, asg))
            hard, warnings = split_fixed_warnings(p, check(p, asg)[0])
            assert not hard and not warnings, (hard, warnings)
            # Explicit pair lists are independent expected values, not a reimplementation.
            expected_score = sum(7 if b - a == 2 else 11 for a, b in c["pairs"])
            status, pinned, score = build_and_solve(p, pin=asg, time_limit=20)
            assert status == "OPTIMAL", status
            assert score == expected_score, (score, expected_score)
            assert pinned == asg, "pinned assignment changed"
            text, report_hard = report(p, asg, status, score)
            assert not report_hard, report_hard
            section = text.split("## 9 ", 1)[1].split("## 10 ", 1)[0]
            rows = [line for line in section.splitlines()
                    if line.startswith(f"- {who} の勤務間隔が短い組（減点対象）:")]
            assert len(rows) == int(bool(c["pairs"])), rows
            actual = "\n".join(rows)
            assert actual.count("→") == len(c["pairs"]), actual
            for a, b in c["pairs"]:
                assert f"{p.label(a)}→{p.label(b)}" in actual, actual
            assert (p.rules, p.m, asg) == before, "solver/report mutated input"
            passed += 1
            print("PASS " + c["id"], flush=True)
        except Exception:
            failed += 1
            traceback.print_exc()
        completed.append(c["id"])
        print("WORK_GAP_COMPLETE " + json.dumps(c["id"]), flush=True)
    assert started == completed == ids
    assert passed + failed == EXPECTED
    FINISHED = True
    print("WORK_GAP_ACCOUNTING " + json.dumps(dict(registered=EXPECTED, started=len(started),
        completed=len(completed), passed=passed, failed=failed, skipped=0)), flush=True)
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())

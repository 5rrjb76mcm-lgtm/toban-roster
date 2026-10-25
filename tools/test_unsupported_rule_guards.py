"""Fail closed on unsupported JS hard rules and fixed-only roster mode.

All fixtures are fictional. Constructor/checker tests only; no solver is invoked.
--cases exports the same inputs for test_python_unsupported_rules_node.js.
TOBAN_PYTHON_ROOT can target the unchanged checkout for a red run.
"""
import atexit
import copy
from contextlib import contextmanager
import json
import os
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace
import unittest

_finished = False


def require_completion():
    # sys.exit(0) during import/setup/test/export must not produce a false pass.
    # SystemExit from an atexit handler is ignored, so use a nonzero process exit.
    if not _finished:
        sys.stderr.write("FAIL: unsupported-rule regression ended before verified completion\n")
        sys.stderr.flush()
        os._exit(1)


if __name__ == "__main__":
    atexit.register(require_completion)
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(Path(os.environ.get("TOBAN_PYTHON_ROOT", ROOT)) / "tools"))
from toban import Problem, check, load

A, B = "Synthetic Alpha", "Synthetic Beta"
RULE_CASES = (
    ("shift_run_max", {"shift_run_max": {"night": 1}}, (2, 3), "SHIFT_RUN_TOO_LONG"),
    ("shift_count_range", {"shift_counts": {"night": {"max": 0}}}, (2,), "SHIFT_COUNT_OVER"),
    ("rest_after_ake", {}, (2, 4), "REST_AFTER_AKE"),
    ("dayoff_weekday_cap", {"dayoff_weekday_max": 1}, (6, 13), "DAYOFF_WEEKDAY_OVER"),
)
CASE_IDS = ("shift_run_max", "shift_count_range", "rest_after_ake", "dayoff_weekday_cap",
            "fixed_only:default", "fixed_only:hard", "fixed_only:off")
EXPECTED_SCENARIOS = {
    "test_active_rules_and_roster_mode_rejected_before_checking": CASE_IDS,
    "test_saved_webapp_files_use_the_same_guard": CASE_IDS,
    "test_disabled_rules_keep_supported_inputs_and_unused_params": CASE_IDS[:4],
    "test_supported_default_and_ordinary_roster_mode_still_accepted": ("bundled", "default", "hard", "off"),
    "test_fixed_only_off_still_has_incompatible_quota_semantics": ("fixed_only:off:quota",),
}
started_scenarios, completed_scenarios = [], []


def case_id(x):
    return x["id"] if x["id"] != "fixed_only" else "fixed_only:" + (x["state"] or "default")


def supported():
    rules = json.loads((ROOT / "webapp/data/rules.json").read_text())
    rules["doctors"] = [{"name": n, "team": "I", "quota": 0, "years": 1} for n in (A, B)]
    rules["name_order"] = [A, B]
    rules["quota_tolerance"] = 100
    rules["rule_states"] = {rid: "off" for rid in (
        "oncall", "period_charge", "same_day_double", "consecutive_days",
        "weekend_balance", "friday_night_min", "rest_day", "same_weekday_cap",
        "same_day_charge_other", "same_day_team", "cath_requirement")}
    month = {"year": 2026, "month": 12, "holidays": [], "fixed": {}}
    problem = Problem(copy.deepcopy(rules), copy.deepcopy(month))
    asg = {f"{d}:{kind}": {"work": B, "oc": []} for d, kind in problem.slots}
    return {"rules": rules, "month": month, "asg": asg}


def cases():
    out = []
    for rid, params, days, code in RULE_CASES:
        x = supported()
        x.update(id=rid, code=code)
        x["rules"].update(copy.deepcopy(params))
        x["rules"]["rule_states"][rid] = "hard"
        for day in days:
            x["asg"][f"{day}:night"]["work"] = A
        out.append(x)
    for state in (None, "hard", "off"):
        x = supported()
        x.update(id="fixed_only", state=state, code="FIXED_ONLY_ASSIGNED" if state != "off" else None)
        x["rules"]["doctors"][0]["duty"] = "fixed_only"
        x["asg"]["2:night"]["work"] = A
        if state is not None:
            x["rules"]["rule_states"]["fixed_only"] = state
        out.append(x)
    return out


class UnsupportedRuleGuardsTest(unittest.TestCase):
    @contextmanager
    def scenario(self, label):
        key = (self._testMethodName, label)
        self.assertIn(label, EXPECTED_SCENARIOS[self._testMethodName])
        self.assertNotIn(key, started_scenarios)
        started_scenarios.append(key)
        print("SCENARIO_START " + json.dumps(key), flush=True)
        with self.subTest(case=label):
            yield
        completed_scenarios.append(key)
        print("SCENARIO_COMPLETE " + json.dumps(key), flush=True)

    def test_active_rules_and_roster_mode_rejected_before_checking(self):
        for x in cases():
            with self.scenario(case_id(x)):
                with self.assertRaisesRegex(SystemExit, x["id"]):
                    Problem(copy.deepcopy(x["rules"]), copy.deepcopy(x["month"]))

    def test_saved_webapp_files_use_the_same_guard(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "synthetic-month.json"
            for x in cases():
                with self.scenario(case_id(x)):
                    path.write_text(json.dumps({"rules": x["rules"], "month": x["month"]}))
                    with self.assertRaisesRegex(SystemExit, x["id"]):
                        load(SimpleNamespace(rules=None, month=str(path)))

    def test_disabled_rules_keep_supported_inputs_and_unused_params(self):
        for x in cases()[:len(RULE_CASES)]:
            with self.scenario(case_id(x)):
                x["rules"]["rule_states"][x["id"]] = "off"
                before = copy.deepcopy(x)
                p = Problem(x["rules"], x["month"])
                violations, _ = check(p, x["asg"])
                self.assertEqual(violations, [])
                self.assertEqual(x, before)

    def test_supported_default_and_ordinary_roster_mode_still_accepted(self):
        with self.scenario("bundled"):
            rules = json.loads((ROOT / "webapp/data/rules.json").read_text())
            month = json.loads((ROOT / "webapp/data/202611.json").read_text())
            Problem(rules, month)
        for state in (None, "hard", "off"):
            with self.scenario(state or "default"):
                x = supported()
                if state is not None:
                    x["rules"]["rule_states"]["fixed_only"] = state
                Problem(x["rules"], x["month"])

    def test_fixed_only_off_still_has_incompatible_quota_semantics(self):
        # JS quota_range exempts the roster mode even while fixed_only is off.
        # The Python reference applies quota_range to this same person instead.
        with self.scenario("fixed_only:off:quota"):
            x = cases()[-1]
            x["rules"]["doctors"][0]["quota"] = 20
            x["rules"]["quota_tolerance"] = 0
            with self.assertRaisesRegex(SystemExit, "fixed_only"):
                Problem(x["rules"], x["month"])


if __name__ == "__main__":
    if "--cases" in sys.argv:
        data = cases()
        if len(data) != 7 or tuple(map(case_id, data)) != CASE_IDS:
            raise AssertionError("Expected exactly the seven registered fixture cases")
        print(json.dumps(data, ensure_ascii=False), flush=True)
        _finished = True
    else:
        methods = {name for name in dir(UnsupportedRuleGuardsTest) if name.startswith("test_")}
        if methods != set(EXPECTED_SCENARIOS) or len(methods) != 5:
            raise AssertionError("Expected exactly the five registered test methods")
        program = unittest.main(exit=False)
        expected = {(method, label) for method, labels in EXPECTED_SCENARIOS.items() for label in labels}
        if (program.result.testsRun != 5 or len(expected) != 23
                or len(started_scenarios) != 23 or len(completed_scenarios) != 23
                or set(started_scenarios) != expected or set(completed_scenarios) != expected):
            raise AssertionError("Expected all five methods and all 23 scenario starts/completions")
        print("ACCOUNTING " + json.dumps({"tests": program.result.testsRun,
              "registered": len(expected), "started": len(started_scenarios),
              "completed": len(completed_scenarios),
              "failures": len(program.result.failures), "errors": len(program.result.errors),
              "successful": program.result.wasSuccessful()}), flush=True)
        _finished = True
        sys.exit(not program.result.wasSuccessful())

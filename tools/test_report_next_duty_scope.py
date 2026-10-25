"""Real Python report regression for synthetic, supported next-duty cases.

Uses the existing fixed-only fixture and real CP-SAT evaluator. This regression
is prepared but unexecuted in the post-PR46 static-only audit.
TOBAN_PYTHON_ROOT may target unchanged production source for the red run.
Python does not support duty_conflicts=off; retain that guard rather than
introduce a new rule mode merely to test a reporting correction.
"""
import atexit
import copy
from contextlib import contextmanager
import json
import os
import sys
import unittest

EXPECTED_METHODS = {
    "test_real_report_checker_and_pinned_solver",
    "test_duty_conflicts_off_remains_unsupported",
}
EXPECTED_CASES = 32
COMPLETED_METHODS = set()
COMPLETED_CASES = 0
STARTED_CASES = []
COMPLETED_IDS = []
FINISHED = False


def require_completion():
    if not FINISHED:
        print(f"Python next-duty report regression did not finish successfully: "
              f"cases={COMPLETED_CASES}/{EXPECTED_CASES}, "
              f"methods={sorted(COMPLETED_METHODS)}", file=sys.stderr, flush=True)
        os._exit(1)  # An early sys.exit(0) must never report a passing regression.


if __name__ == "__main__":
    atexit.register(require_completion)

from test_fixed_only_contract import fixture, evaluate, work, fixed, A
from toban import Problem, check, report, split_fixed_warnings


class NextDutyReportScopeTest(unittest.TestCase):
    @contextmanager
    def scenario(self, state, is_fixed, boundary, scope):
        global COMPLETED_CASES
        key = (state, is_fixed, boundary, scope)
        self.assertNotIn(key, STARTED_CASES)
        STARTED_CASES.append(key)
        print("SCENARIO_START " + json.dumps(key), flush=True)
        with self.subTest(state=state, fixed=is_fixed, boundary=boundary, scope=scope):
            yield
        COMPLETED_CASES += 1
        COMPLETED_IDS.append(key)
        print("SCENARIO_COMPLETE " + json.dumps(key), flush=True)

    def test_real_report_checker_and_pinned_solver(self):
        global COMPLETED_CASES
        for state in ("default", "hard"):
            for is_fixed in (False, True):
                for boundary in (False, True):
                    for scope in ("none", "am", "pm", "both"):
                        with self.scenario(state, is_fixed, boundary, scope):
                            x = fixture("night followed by " + scope, month={"month": 11})
                            x["rules"]["rule_states"]["period_charge"] = "off"
                            if state == "hard":
                                x["rules"]["rule_states"]["duty_conflicts"] = "hard"
                            else:
                                x["rules"]["rule_states"].pop("duty_conflicts", None)
                            day = 30 if boundary else 1
                            duties = {} if scope == "none" else ({"am": "outpatient"} if scope == "am"
                                      else {"pm": "ward"} if scope == "pm"
                                      else {"am": "outpatient", "pm": "ward"})
                            x["month"]["duty_days"] = {A: {str(day + 1): duties}}
                            x["month"]["next_first_day_in_calendar"] = True
                            work(x, day)
                            if is_fixed:
                                fixed(x, day)
                            conflict = scope in ("pm", "both")
                            want_hard = int(conflict and not is_fixed)
                            want_fixed = int(conflict and is_fixed)
                            original = copy.deepcopy((x["rules"], x["month"], x["asg"]))
                            got, status, hard, warnings = evaluate(x)
                            self.assertEqual(got, {"hard": want_hard, "fixed": want_fixed,
                                                   "objective": None if want_hard else 0})
                            self.assertEqual(status, "INFEASIBLE" if want_hard else "OPTIMAL")
                            self.assertEqual(len(hard), want_hard)
                            self.assertEqual(len(warnings), want_fixed)
                            p = Problem(copy.deepcopy(x["rules"]), copy.deepcopy(x["month"]))
                            self.assertEqual(split_fixed_warnings(p, check(p, x["asg"])[0]), (hard, warnings))
                            before_report = copy.deepcopy((p.rules, p.m, x["asg"]))
                            text, report_hard = report(p, x["asg"], status, got["objective"])
                            self.assertEqual(report_hard, hard)
                            section = text.split("## 7 ", 1)[1].split("## 8 ", 1)[0]
                            rows = [line for line in section.splitlines() if line.startswith(f"| {p.label(day)} 夜勤 | {A} |")]
                            if scope == "none":
                                self.assertEqual(rows, [])
                                self.assertIn("なし", section)
                            else:
                                self.assertEqual(len(rows), 1)
                                self.assertIn(f"翌{p.label(day + 1)}", rows[0])
                                self.assertEqual("午前" in rows[0], scope in ("am", "both"))
                                self.assertEqual("午後" in rows[0], scope in ("pm", "both"))
                                self.assertEqual("（午前のみ）" in rows[0], scope == "am")
                            self.assertEqual((p.rules, p.m, x["asg"]), before_report)
                            self.assertEqual((x["rules"], x["month"], x["asg"]), original)
        self.assertEqual(COMPLETED_CASES, EXPECTED_CASES, "all planned real Python cases completed")
        COMPLETED_METHODS.add("test_real_report_checker_and_pinned_solver")

    def test_duty_conflicts_off_remains_unsupported(self):
        print("SCENARIO_START " + json.dumps("duty_conflicts:off"), flush=True)
        x = fixture("unsupported duty off")
        x["rules"]["rule_states"]["duty_conflicts"] = "off"
        with self.assertRaisesRegex(SystemExit, "duty_conflicts"):
            Problem(x["rules"], x["month"])
        COMPLETED_METHODS.add("test_duty_conflicts_off_remains_unsupported")
        print("SCENARIO_COMPLETE " + json.dumps("duty_conflicts:off"), flush=True)


if __name__ == "__main__":
    loader = unittest.TestLoader()
    methods = set(loader.getTestCaseNames(NextDutyReportScopeTest))
    if methods != EXPECTED_METHODS:
        raise AssertionError(f"Unexpected test methods: {sorted(methods)}")
    suite = loader.loadTestsFromTestCase(NextDutyReportScopeTest)
    if suite.countTestCases() != len(EXPECTED_METHODS):
        raise AssertionError("Unexpected suite size")
    result = unittest.TextTestRunner(verbosity=2).run(suite)
    expected_ids = {(state, is_fixed, boundary, scope)
                    for state in ("default", "hard") for is_fixed in (False, True)
                    for boundary in (False, True) for scope in ("none", "am", "pm", "both")}
    ledger_complete = (len(STARTED_CASES) == len(COMPLETED_IDS) == EXPECTED_CASES
                       and set(STARTED_CASES) == set(COMPLETED_IDS) == expected_ids)
    FINISHED = (ledger_complete and result.wasSuccessful() and result.testsRun == len(EXPECTED_METHODS)
                and COMPLETED_METHODS == EXPECTED_METHODS and COMPLETED_CASES == EXPECTED_CASES)
    print(f"ACCOUNTING tests={result.testsRun}/{len(EXPECTED_METHODS)} "
          f"registered={EXPECTED_CASES + 1} started={len(STARTED_CASES) + int('test_duty_conflicts_off_remains_unsupported' in COMPLETED_METHODS)} "
          f"cases={COMPLETED_CASES}/{EXPECTED_CASES} failures={len(result.failures)} errors={len(result.errors)} "
          f"finished={FINISHED}", flush=True)
    sys.exit(0 if FINISHED else 1)

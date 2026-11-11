"""Reports must use the same normalized quota as the supported Python solver.

Fictional fixtures only. TOBAN_PYTHON_ROOT selects baseline source for red runs.
No input acceptance rules, constraints, or objective functions are changed.
"""
import copy
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
SOURCE_ROOT = Path(os.environ.get("TOBAN_PYTHON_ROOT", ROOT))
sys.path.insert(0, str(SOURCE_ROOT / "tools"))
from toban import Asg, Problem, build_and_solve, check, metrics, report
from test_fixed_only_contract import A, fixture


ACCEPTED = [
    ("omitted", None, 0), ("null", None, 0), ("empty", "", 0),
    ("zero", 0, 0), ("integer", 3, 3), ("decimal", 1.5, 1.5),
    ("decimal-string", "1.5", 1.5), ("padded-string", " 3 ", 3),
    ("hex-string", "0x10", 16), ("binary-string", "0b10", 2),
    ("octal-string", "0o10", 8), ("exponent-string", "1e1", 10),
]


def case(label, raw, excluded=False):
    x = fixture("normalized report quota: " + label)
    doc = next(d for d in x["rules"]["doctors"] if d["name"] == A)
    if label == "omitted":
        doc.pop("quota")
    else:
        doc["quota"] = raw
    if excluded:
        doc["duty"] = "never"
    return x


def quota_row(text):
    section = text.split("## 3 ", 1)[1].split("### 当番開始日", 1)[0]
    return next(line for line in section.splitlines() if line.startswith(f"| {A} |"))


class NormalizedQuotaReportTest(unittest.TestCase):
    def test_metrics_report_and_pinned_solver_use_normalized_quota(self):
        self.assertEqual(len(ACCEPTED), 12)
        completed = 0
        for label, raw, wanted in ACCEPTED:
            for excluded in (False, True):
                with self.subTest(label=label, excluded=excluded):
                    x = case(label, raw, excluded)
                    before = copy.deepcopy(x)
                    p = Problem(copy.deepcopy(x["rules"]), copy.deepcopy(x["month"]))
                    self.assertEqual(p.quotas[A], wanted)
                    violations, charge = check(p, x["asg"])
                    self.assertEqual(violations, [])
                    status, pinned, objective = build_and_solve(p, pin=x["asg"], time_limit=10)
                    self.assertEqual((status, objective), ("OPTIMAL", 0))
                    self.assertEqual(pinned, x["asg"])
                    state = copy.deepcopy((p.rules, p.m, x["asg"]))
                    got = metrics(p, Asg(p, x["asg"]), charge)[A]["quota"]
                    self.assertIsInstance(got, (int, float))
                    self.assertEqual(got, wanted)
                    md, reported = report(p, x["asg"], status, objective)
                    self.assertEqual(reported, violations)
                    self.assertTrue(quota_row(md).startswith(f"| {A} | {wanted} | {wanted} |"))
                    self.assertIn(f"目安合計{0 if excluded else wanted}", md)
                    self.assertEqual((p.rules, p.m, x["asg"]), state)
                    self.assertEqual(x, before)
                    completed += 1
        self.assertEqual(completed, 24)

    def test_cli_check_and_solve_write_complete_outputs_when_quota_is_omitted(self):
        x = case("omitted", None)
        with tempfile.TemporaryDirectory() as directory:
            tmp = Path(directory)
            saved, assignment = tmp / "saved.json", tmp / "assignment.json"
            saved.write_text(json.dumps({k: x[k] for k in ("rules", "month")}), encoding="utf-8")
            assignment.write_text(json.dumps(x["asg"]), encoding="utf-8")
            for command, options, name in [
                ("check", ["--json", str(assignment)], "202612_py_check.md"),
                ("solve", ["--time", "10"], "202612_py_result.md"),
            ]:
                with self.subTest(command=command):
                    got = subprocess.run([sys.executable, str(SOURCE_ROOT / "tools/toban.py"),
                        command, str(saved), *options], text=True, capture_output=True, timeout=30)
                    self.assertEqual(got.returncode, 0, got.stdout + got.stderr)
                    md = (tmp / name).read_text(encoding="utf-8")
                    self.assertTrue(quota_row(md).startswith(f"| {A} | 0 | 0 |"))
                    self.assertIn("## 10 月末の接続", md)
                    if command == "solve":
                        asg = json.loads((tmp / "202612_py_assignment.json").read_text())
                        p = Problem(copy.deepcopy(x["rules"]), copy.deepcopy(x["month"]))
                        self.assertEqual(check(p, asg)[0], [])

    def test_invalid_quotas_remain_rejected(self):
        for raw in (True, False, -1, -0.5, "-1", " ", "bad", [], {}, float("inf"), float("nan")):
            with self.subTest(raw=raw):
                x = case("invalid", raw)
                with self.assertRaisesRegex(ValueError, "quota"):
                    Problem(x["rules"], x["month"])


if __name__ == "__main__":
    unittest.main(verbosity=2)

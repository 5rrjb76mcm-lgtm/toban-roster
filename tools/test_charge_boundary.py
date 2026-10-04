"""Synthetic regressions for first-slot period charge across a month boundary.
Run with the repository's Python environment: python tools/test_charge_boundary.py.
"""
import copy
import json
from pathlib import Path
import unittest

from toban import Problem, build_and_solve, check


class ChargeBoundaryTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.names = ["Synthetic Alpha", "Synthetic Beta"]
        cls.rules = json.loads((Path(__file__).resolve().parents[1] / "webapp/data/rules.json").read_text())
        cls.rules["doctors"] = [{"name": n, "team": "I", "quota": 0, "years": 1} for n in cls.names]
        cls.rules["name_order"] = cls.names[:]
        cls.rules["quota_tolerance"] = 100
        cls.rules["oncall_requirement"] = {t: {"I": 0, "Y": 0} for t in ("I", "A", "Y", "C")}
        for rid in ("same_day_double", "consecutive_days", "weekend_balance", "friday_night_min", "rest_day", "same_day_charge_other", "cath_requirement"):
            cls.rules.setdefault("rule_states", {})[rid] = "off"
        cls.rules["weights"] = {k: 0 for k in cls.rules["weights"]}
        cls.rules["weights"]["charge_handover"] = 200

    def problem(self, month=11, **extra):
        return Problem(copy.deepcopy(self.rules), {"year": 2026, "month": month, "holidays": [], **extra})

    def assignment(self, p, who=None):
        return {f"{d}:{k}": {"work": who or self.names[0], "oc": []} for d, k in p.slots}

    def links(self, p, asg, label):
        return [v for v in check(p, asg)[0] if label in v and "接続していない" in v]

    def test_previous_handover_uses_first_slot_in_checker(self):
        a, b = self.names
        p = self.problem(prev_month={"last_days": [{"date": 31, "day": a, "night": b}]})
        bad = self.assignment(p, b)
        self.assertEqual(len(self.links(p, bad, "前月末")), 1)
        good = self.assignment(p)
        good["1:night"]["work"] = b
        self.assertEqual(self.links(p, good, "前月末"), [])

    def test_previous_handover_uses_first_slot_in_solver(self):
        a, b = self.names
        p = self.problem(prev_month={"last_days": [{"date": 31, "day": a, "night": b}]})
        self.assertEqual(build_and_solve(p, pin=self.assignment(p, b), time_limit=10)[0], "INFEASIBLE")
        good = self.assignment(p)
        good["1:night"]["work"] = b
        status, asg, objective = build_and_solve(p, pin=good, time_limit=10)
        self.assertEqual(status, "OPTIMAL")
        self.assertEqual(objective, 200)
        self.assertEqual(self.links(p, asg, "前月末"), [])

    def test_previous_night_only_still_connects(self):
        a, b = self.names
        p = self.problem(prev_month={"last_days": [{"date": 31, "night": a}]})
        self.assertEqual(len(self.links(p, self.assignment(p, b), "前月末")), 1)
        self.assertEqual(build_and_solve(p, pin=self.assignment(p, b), time_limit=10)[0], "INFEASIBLE")
        self.assertEqual(build_and_solve(p, pin=self.assignment(p), time_limit=10)[0], "OPTIMAL")

    def test_ambiguous_previous_first_slot_is_not_arbitrarily_selected(self):
        a, b = self.names
        p = self.problem(prev_month={"last_days": [{"date": 31, "day": a, "day_oc": [b], "night": a}]})
        self.assertEqual(self.links(p, self.assignment(p, b), "前月末"), [])
        self.assertEqual(build_and_solve(p, pin=self.assignment(p, b), time_limit=10)[0], "OPTIMAL")

    def test_fixed_charge_exempts_only_its_first_slot(self):
        a, b = self.names
        p = self.problem(fixed={"weekend_charge": {"7": a}}, unavailable_night={a: [7]})
        self.assertTrue(p.is_fixed_eng((7, "day"), a))
        self.assertFalse(p.is_fixed_eng((7, "night"), a))
        self.assertEqual(build_and_solve(p, pin=self.assignment(p), time_limit=10)[0], "INFEASIBLE")
        good = self.assignment(p)
        good["7:night"]["work"] = b
        status, _, objective = build_and_solve(p, pin=good, time_limit=10)
        self.assertEqual(status, "OPTIMAL")
        self.assertEqual(objective, 200)
        separately_fixed = self.problem(fixed={"weekend_charge": {"7": a}, "night": {"7": a}}, unavailable_night={a: [7]})
        self.assertTrue(separately_fixed.is_fixed_eng((7, "night"), a))
        self.assertEqual(build_and_solve(separately_fixed, pin=self.assignment(p), time_limit=10)[0], "OPTIMAL")

    def test_disabled_charge_does_not_create_fixed_exemptions(self):
        a = self.names[0]
        rules = copy.deepcopy(self.rules)
        rules["rule_states"]["period_charge"] = "off"
        p = Problem(rules, {"year": 2026, "month": 11, "fixed": {"weekend_charge": {"7": a}}})
        self.assertFalse(p.is_fixed_eng((7, "day"), a))
        self.assertFalse(p.is_fixed_eng((7, "night"), a))

    def test_charge_fixed_outside_a_period_creates_no_exemption(self):
        a = self.names[0]
        p = self.problem(fixed={"weekend_charge": {"2": a}}, unavailable_night={a: [2]})
        self.assertFalse(p.is_fixed_eng((2, "night"), a))
        self.assertEqual(build_and_solve(p, pin=self.assignment(p), time_limit=10)[0], "INFEASIBLE")

    def test_non_charge_and_unknown_names_create_no_charge_exemption(self):
        rules = copy.deepcopy(self.rules)
        staff, unknown = "Synthetic Staff", "Synthetic Unknown"
        rules["doctors"].append({"name": staff, "team": "Y", "quota": 0, "years": 1})
        p = Problem(rules, {"year": 2026, "month": 11, "fixed": {"weekend_charge": {"7": staff, "14": unknown}, "night": {"7": staff}}})
        self.assertFalse(p.is_fixed_eng((7, "day"), staff))
        self.assertFalse(p.is_fixed_eng((14, "day"), unknown))
        self.assertFalse(p.is_fixed_eng((14, "night"), unknown))
        self.assertTrue(p.is_fixed_eng((7, "night"), staff))

    def test_next_link_checker_rejects_first_slot_mismatch_despite_handover(self):
        a, b = self.names
        for fixed in ({"weekend_charge": {"32": a}}, {"day_oc": {"32": [a]}}):
            with self.subTest(fixed_kind=next(iter(fixed))):
                p = self.problem(month=10, fixed=fixed)
                bad = self.assignment(p)
                bad["31:day"]["work"] = b
                self.assertEqual(len(self.links(p, bad, "翌月1日")), 1)
                self.assertEqual(build_and_solve(p, pin=bad, time_limit=10)[0], "INFEASIBLE")
                good = self.assignment(p)
                good["31:night"]["work"] = b
                self.assertEqual(self.links(p, good, "翌月1日"), [])
                status, _, objective = build_and_solve(p, pin=good, time_limit=10)
                self.assertEqual(status, "OPTIMAL")
                self.assertEqual(objective, 200)


if __name__ == "__main__":
    unittest.main()

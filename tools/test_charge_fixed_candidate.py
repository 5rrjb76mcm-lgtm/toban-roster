"""Fictional period-charge fixed inputs; real CP-SAT, unchanged JS contract.
TOBAN_PYTHON_ROOT may target the unchanged source. No real data or external services.
"""
import copy
import json
import os
from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(Path(os.environ.get('TOBAN_PYTHON_ROOT', ROOT)) / 'tools'))
from toban import Problem, build_and_solve, check

A, B, OTHER, INELIGIBLE, UNKNOWN = ('Synthetic Alpha', 'Synthetic Beta', 'Synthetic Junior', 'Synthetic Excluded', 'Synthetic Unknown')

class FixedChargeCandidateTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.rules = json.loads((ROOT / 'webapp/data/rules.json').read_text())
        cls.rules['doctors'] = [{'name': n, 'team': t, 'quota': 0, 'years': 1, **({'duty': 'never'} if n == INELIGIBLE else {})} for n, t in [(A, 'I'), (B, 'I'), (OTHER, 'Y'), (INELIGIBLE, 'I')]]
        cls.rules['name_order'] = [A, B, OTHER, INELIGIBLE]
        cls.rules['quota_tolerance'] = 100
        cls.rules['oncall_requirement'] = {t: {'I': 0, 'Y': 0} for t in ('I', 'A', 'Y', 'C')}
        cls.rules['rule_states'] = {k: 'off' for k in ('oncall', 'same_day_double', 'consecutive_days', 'weekend_balance', 'friday_night_min', 'rest_day', 'same_weekday_cap', 'same_day_charge_other', 'same_day_team', 'cath_requirement')}
        cls.rules['weights'] = {k: 0 for k in cls.rules['weights']}
    def fixture(self, who, date='7', state='hard'):
        rules = copy.deepcopy(self.rules); rules['rule_states']['period_charge'] = state
        m = {'year': 2026, 'month': 11, 'holidays': [], 'fixed': {'weekend_charge': {date: who}}}
        p = Problem(rules, m)
        asg = {f'{d}:{k}': {'work': A, 'oc': []} for d, k in p.slots}
        return p, asg
    def solve(self, p, a):
        return build_and_solve(p, pin=a, time_limit=10)[0]
    def test_invalid_charge_candidate_is_ignored_in_solver_but_flagged_in_checker(self):
        for who in (OTHER, INELIGIBLE, UNKNOWN):
            with self.subTest(who=who):
                p, a = self.fixture(who)
                self.assertEqual(self.solve(p, a), 'OPTIMAL')
                self.assertTrue(any('固定指定の主担当担当' in v and who in v for v in check(p, a)[0]))
                self.assertFalse(p.is_fixed_eng((7, 'day'), who))
    def test_unpinned_invalid_input_preserved_and_visible(self):
        p, _ = self.fixture(UNKNOWN)
        before = copy.deepcopy((p.rules, p.m))
        status, asg, _ = build_and_solve(p, time_limit=10)
        self.assertEqual(status, 'OPTIMAL')
        self.assertTrue(any('固定指定の主担当担当' in v and UNKNOWN in v for v in check(p, asg)[0]))
        self.assertEqual((p.rules, p.m), before)
    def test_valid_fixed_relaxation_still_works(self):
        p, a = self.fixture(B)
        self.assertEqual(build_and_solve(p, pin=a, relax={'fixed'}, time_limit=10)[0], 'OPTIMAL')
        self.assertTrue(any('固定指定の主担当担当' in v for v in check(p, a)[0]))
    def test_valid_candidate_still_enforced(self):
        p, a = self.fixture(B)
        self.assertEqual(self.solve(p, a), 'INFEASIBLE')
        a['7:day']['work'] = B
        self.assertEqual(self.solve(p, a), 'OPTIMAL')
        self.assertFalse(any('固定指定の主担当担当' in v for v in check(p, a)[0]))
        self.assertTrue(p.is_fixed_eng((7, 'day'), B))
    def test_off_or_nonperiod_input_not_enforced(self):
        for date, state in [('7', 'off'), ('2', 'hard')]:
            for who in (B, OTHER, INELIGIBLE, UNKNOWN):
                with self.subTest(date=date, state=state, who=who):
                    p, a = self.fixture(who, date, state)
                    self.assertEqual(self.solve(p, a), 'OPTIMAL')
                    self.assertFalse(any('固定指定の主担当担当' in v for v in check(p, a)[0]))
                    self.assertFalse(p.is_fixed_eng((int(date), 'day'), who))
if __name__ == '__main__':
    unittest.main()

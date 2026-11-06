"""Frozen Python reference: supported night rule state, legacy fallback and report.
Fictional fixtures only. TOBAN_PYTHON_ROOT targets unchanged source for a red run.
"""
import copy
import unittest
from test_fixed_only_contract import fixture, work, fixed, A, B
from toban import Problem, build_and_solve, check, report, split_fixed_warnings

RID = 'arrhythmia_pre_workday_night'


def make(legacy, state, pinned=False, day=2):
    x = fixture('night state')
    x['rules']['arrhythmia_responsible_night'] = [A]
    x['rules']['weights'][RID] = 17
    if legacy is None:
        x['rules'].pop(RID, None)
    else:
        x['rules'][RID] = legacy
    if state is None:
        x['rules']['rule_states'].pop(RID, None)
    else:
        x['rules']['rule_states'][RID] = state
    work(x, day)
    if pinned:
        fixed(x, day)
    return x


def effective(legacy, state):
    return state or {'forbid': 'hard', 'allow': 'off'}.get(legacy, 'soft')


class ArrhythmiaNightStateTest(unittest.TestCase):
    def test_legacy_state_matrix_checker_solver_report(self):
        scenarios = 0
        for legacy in (None, 'avoid', 'allow', 'forbid'):
            for state in (None, 'hard', 'soft', 'off'):
                for pinned in (False, True):
                    with self.subTest(legacy=legacy, state=state, fixed=pinned):
                        x = make(legacy, state, pinned)
                        original = copy.deepcopy(x)
                        p = Problem(x['rules'], x['month'])
                        st = effective(legacy, state)
                        hard, allowed = split_fixed_warnings(p, check(p, x['asg'])[0])
                        self.assertEqual(len(hard), int(st == 'hard' and not pinned))
                        self.assertEqual(len(allowed), int(st == 'hard' and pinned))
                        status, _, objective = build_and_solve(p, pin=x['asg'], time_limit=5)
                        self.assertEqual(status, 'INFEASIBLE' if hard else 'OPTIMAL')
                        self.assertEqual(objective, None if hard else 17 if st == 'soft' else 0)
                        text, report_hard = report(p, x['asg'], status, objective)
                        self.assertEqual(report_hard, hard)
                        line = f'- {A} の翌日が休日でない平日夜勤'
                        if st == 'off':
                            self.assertNotIn(line, text)
                        else:
                            label = '禁止設定' if st == 'hard' else '原則配置しない'
                            self.assertIn(f'{line}（{label}）: 12/2', text)
                        self.assertEqual(x, original, 'input must not be mutated')
                        scenarios += 1
        self.assertEqual(scenarios, 32)

    def test_holiday_and_next_day_scope_unchanged(self):
        # Friday before Saturday, weekend, and a weekday before an explicit holiday.
        for day, holidays in ((4, []), (5, []), (2, [3])):
            with self.subTest(day=day, holidays=holidays):
                x = make('allow', 'hard', day=day)
                x['month']['holidays'] = holidays
                p = Problem(x['rules'], x['month'])
                # Fill any newly created holiday day slot using another candidate.
                for d, kind in p.slots:
                    x['asg'].setdefault(f'{d}:{kind}', {'work': B, 'oc': []})
                self.assertEqual(check(p, x['asg'])[0], [])
                status, _, objective = build_and_solve(p, pin=x['asg'], time_limit=5)
                self.assertEqual((status, objective), ('OPTIMAL', 0))

    def test_unpinned_solver_obeys_explicit_hard(self):
        x = make('allow', 'hard')
        p = Problem(x['rules'], x['month'])
        status, asg, _ = build_and_solve(p, time_limit=5)
        self.assertEqual(status, 'OPTIMAL')
        self.assertTrue(all(asg[f'{d}:night']['work'] != A for d in p.pre_workday_nights()))
        self.assertEqual(check(p, asg)[0], [])


if __name__ == '__main__':
    unittest.main()

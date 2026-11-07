"""Previous OC survives an unknown worker in the frozen Python reference.
Fictional inputs; TOBAN_PYTHON_ROOT may select an unchanged baseline.
The pinned solver test requires OR-Tools.
"""
import copy
import unittest
from test_fixed_only_contract import fixture, A, B
from toban import Problem, Asg, report, build_and_solve


class PreviousOCWithoutWorkerTest(unittest.TestCase):
    def test_partial_history_and_controls(self):
        count = 0
        for shift in ('day', 'night'):
            for previous in ('oc-only', 'worker-and-oc', 'worker-only', 'empty'):
                count += 1
                with self.subTest(shift=shift, previous=previous):
                    x = fixture('partial previous OC')
                    entry = {'date': 30}
                    if previous in ('oc-only', 'worker-and-oc'):
                        entry[shift + '_oc'] = [A]
                    if previous == 'worker-and-oc':
                        entry[shift] = B
                    if previous == 'worker-only':
                        entry[shift] = A
                    x['month']['prev_month'] = {'last_days': [entry]}
                    x['asg']['1:night'] = {'work': A, 'oc': []}
                    before = copy.deepcopy(x)
                    p = Problem(x['rules'], x['month'])
                    self.assertEqual((0, shift) in p.all_slots_set, previous != 'empty')
                    self.assertEqual(A in Asg(p, x['asg']).oc((0, shift)), previous in ('oc-only', 'worker-and-oc'))
                    text, _ = report(p, x['asg'], 'OPTIMAL', 0)
                    line = next(s for s in text.splitlines() if 'OC を含む隣接枠' in s)
                    target = f'{A}: {p.label(0)}' in line
                    self.assertEqual(target, previous in ('oc-only', 'worker-and-oc'))
                    self.assertEqual(x, before)
        self.assertEqual(count, 8)


    def test_pinned_solver_against_independent_boundary_count(self):
        # A has only the day-1 current assignment, so its known previous OC
        # creates exactly one six-point boundary. No other OC is assigned.
        for shift in ('day', 'night'):
            for previous in ('oc-only', 'worker-and-oc', 'worker-only', 'empty'):
                with self.subTest(shift=shift, previous=previous):
                    x = fixture('partial previous OC pinned')
                    x['rules']['rule_states']['period_charge'] = 'off'
                    x['rules']['rule_states']['oc_consecutive'] = 'soft'
                    x['rules']['weights']['oc_consecutive'] = 6
                    entry = {'date': 30}
                    if previous in ('oc-only', 'worker-and-oc'):
                        entry[shift + '_oc'] = [A]
                    if previous == 'worker-and-oc': entry[shift] = B
                    if previous == 'worker-only': entry[shift] = A
                    x['month']['prev_month'] = {'last_days': [entry]}
                    x['asg']['1:night'] = {'work': A, 'oc': []}
                    p = Problem(x['rules'], x['month'])
                    status, asg, objective = build_and_solve(p, pin=x['asg'], time_limit=10)
                    self.assertEqual(status, 'OPTIMAL')
                    self.assertIsNotNone(asg)
                    self.assertEqual(objective, 6 if previous in ('oc-only', 'worker-and-oc') else 0)


    def test_blank_oc_entries_do_not_create_phantom_slots(self):
        # The known OC in the previous day slot must stay adjacent to day 1.
        # A blank-only night OC array is valid saved JSON, not an actual slot.
        # Retain raw values and match JS truthiness, including JSON null.
        for empty in ([], [''], [None], ['', None], [False, 0, '']):
            with self.subTest(night_oc=empty):
                x = fixture('blank previous OC')
                x['rules']['rule_states']['period_charge'] = 'off'
                x['rules']['rule_states']['oc_consecutive'] = 'soft'
                x['rules']['weights']['oc_consecutive'] = 6
                x['month']['prev_month'] = {'last_days': [{'date': 30, 'day_oc': [A], 'night_oc': empty}]}
                x['asg']['1:night'] = {'work': A, 'oc': []}
                before = copy.deepcopy(x)
                p = Problem(x['rules'], x['month'])
                self.assertEqual(p.prev_slots, [(0, 'day')])
                status, asg, objective = build_and_solve(p, pin=x['asg'], time_limit=10)
                self.assertEqual((status, objective), ('OPTIMAL', 6))
                text, _ = report(p, asg, status, objective)
                self.assertIn(f'{A}: {p.label(0)}', next(s for s in text.splitlines() if 'OC を含む隣接枠' in s))
                self.assertEqual(x, before)
        for value in ([B], ['', B], [None, B]):
            with self.subTest(night_oc=value):
                x = fixture('known previous night OC')
                x['rules']['rule_states']['period_charge'] = 'off'
                x['rules']['rule_states']['oc_consecutive'] = 'soft'
                x['rules']['weights']['oc_consecutive'] = 6
                x['month']['prev_month'] = {'last_days': [{'date': 30, 'day_oc': [A], 'night_oc': value}]}
                x['asg']['1:night'] = {'work': A, 'oc': []}
                p = Problem(x['rules'], x['month'])
                self.assertEqual(p.prev_slots, [(0, 'day'), (0, 'night')])
                status, _, objective = build_and_solve(p, pin=x['asg'], time_limit=10)
                self.assertEqual((status, objective), ('OPTIMAL', 0))
        for field in ('day', 'night'):
            for value, expected in (([''], False), ([None], False), (['', A], True), ([], False)):
                with self.subTest(field=field, value=value):
                    x = fixture('worker array presence')
                    x['month']['prev_month'] = {'last_days': [{'date': 30, field: value}]}
                    p = Problem(x['rules'], x['month'])
                    self.assertEqual((0, field) in p.all_slots_set, expected)


    def test_blank_oc_with_and_without_worker_both_shifts(self):
        # Compare both shift kinds with/without a known worker. The other
        # previous shift contains A as a known OC to expose false adjacency.
        for shift in ('day', 'night'):
            other = 'night' if shift == 'day' else 'day'
            for worker in (False, True):
                for values in ([], [''], [None, ''], ['Synthetic Former']):
                    with self.subTest(shift=shift, worker=worker, oc=values):
                        x = fixture('blank OC and worker matrix')
                        x['rules']['rule_states']['period_charge'] = 'off'
                        x['rules']['rule_states']['oc_consecutive'] = 'soft'
                        x['rules']['weights']['oc_consecutive'] = 6
                        entry = {'date': 30, other + '_oc': [A], shift + '_oc': values}
                        if worker: entry[shift] = B
                        x['month']['prev_month'] = {'last_days': [entry]}
                        x['asg']['1:night'] = {'work': A, 'oc': []}
                        before = copy.deepcopy(x)
                        p = Problem(x['rules'], x['month'])
                        present = worker or values == ['Synthetic Former']
                        self.assertEqual((0, shift) in p.all_slots_set, present)
                        status, _, objective = build_and_solve(p, pin=x['asg'], time_limit=10)
                        expected = 6 if shift == 'day' or not present else 0
                        self.assertEqual((status, objective), ('OPTIMAL', expected))
                        self.assertEqual(x, before)


if __name__ == '__main__':
    unittest.main()

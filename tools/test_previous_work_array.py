"""Fictional previous-month worker array compatibility, frozen single-worker profile.
TOBAN_PYTHON_ROOT selects the product implementation; --cases supplies JS tests.
"""
import copy, json, os, sys, unittest
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(Path(os.environ.get('TOBAN_PYTHON_ROOT', ROOT)) / 'tools'))
from toban import Problem, Asg, check, split_fixed_warnings, build_and_solve, report
from test_fixed_only_contract import fixture, A, B, C


def cases():
    out = []
    # The same historical assignment represented as a scalar or as a list.
    # Arrays can arise from a previous multi-worker month; the current profile
    # remains the supported one-worker profile throughout.
    for previous, contains in [(A, True), ([A], True), ([B, A], True), ([B], False), ([], False), ([None, ''], False)]:
        for fixed in (False, True):
            x = fixture('boundary ' + repr(previous) + ' fixed=' + str(fixed), 'consecutive_days')
            x['rules']['rule_states']['period_charge'] = 'off'
            x['month']['prev_month'] = {'last_days': [{'date': 30, 'night': previous}]}
            x['asg']['1:night']['work'] = A
            if fixed: x['month']['fixed'] = {'night': {'1': A}}
            x['expected'] = {'hard': int(contains and not fixed), 'fixed': int(contains and fixed),
                             'objective': None if contains and not fixed else 50 if contains and fixed else 0}
            out.append(x)
    # The previous night's second worker must count toward a post-night cath
    # exclusion and a work-gap penalty, even if the first worker is someone else.
    for previous, contains in [(A, True), ([A], True), ([B, A], True), ([B], False), ([], False)]:
        x = fixture('cath ' + repr(previous))
        x['rules']['rule_states'].update(period_charge='off', cath_requirement='hard')
        x['rules']['cath_requirement'] = {d: {'A_am': 0, 'A_pm': 0, 'I': 1, 'pm_clinic': False} for d in ['Mon','Tue','Wed','Thu','Fri']}
        for dr in x['rules']['doctors']: dr['cath'] = 'I' if dr['name'] == A else None
        x['month']['cath_off_days_I'] = list(range(2, 32))
        x['month']['prev_month'] = {'last_days': [{'date': 30, 'night': previous}]}
        x['expected'] = {'hard': int(contains), 'fixed': 0, 'objective': None if contains else 0}
        out.append(x)
    for previous, contains in [(A, True), ([A], True), ([B, A], True), ([B], False), ([], False)]:
        x = fixture('gap ' + repr(previous))
        x['rules']['rule_states']['period_charge'] = 'off'
        x['rules']['weights']['work_gap_1'] = 7
        x['month']['prev_month'] = {'last_days': [{'date': 29, 'night': previous}]}
        # No in-month gap involving A apart from the chosen day.
        x['asg']['1:night']['work'] = A
        x['expected'] = {'hard': 0, 'fixed': 0, 'objective': 7 if contains else 0}
        out.append(x)
    # A month beginning on Sunday inherits the Saturday period's unique
    # charge worker. Two previous charge workers intentionally do not force a
    # connection in either implementation.
    for previous, mismatch in [(A, True), ([A], True), ([A, B], False), ([B], False), ([], False)]:
        x = fixture('charge ' + repr(previous))
        x['month']['month'] = 11
        x['month']['prev_month'] = {'last_days': [{'date': 31, 'night': previous}]}
        p = Problem(copy.deepcopy(x['rules']), copy.deepcopy(x['month']))
        x['asg'] = {f'{d}:{k}': {'work': B if d == 1 else C, 'oc': []} for d, k in p.slots}
        x['expected'] = {'hard': int(mismatch), 'fixed': 0, 'objective': None if mismatch else 0}
        out.append(x)
    return out


def evaluate(x):
    p = Problem(copy.deepcopy(x['rules']), copy.deepcopy(x['month']))
    v, _ = check(p, x['asg'])
    hard, fixed = split_fixed_warnings(p, v)
    status, _, objective = build_and_solve(p, pin=x['asg'], time_limit=10)
    # report runs the same Asg traversal as CLI check; ensure it does not crash.
    report(p, x['asg'], status, objective)
    return {'hard': len(hard), 'fixed': len(fixed), 'objective': objective}, status

class PreviousWorkArrayTest(unittest.TestCase):
    def test_cross_boundary(self):
        fixtures = cases()
        self.assertEqual(len(fixtures), 27)
        for x in fixtures:
            with self.subTest(label=x['label']):
                before = copy.deepcopy(x)
                got, status = evaluate(x)
                self.assertEqual(got, x['expected'])
                self.assertEqual(status, 'INFEASIBLE' if got['hard'] else 'OPTIMAL')
                self.assertEqual(x, before)

if __name__ == '__main__':
    if '--cases' in sys.argv:
        out = cases()
        for x in out:
            x['python'], _ = evaluate(x)
        print(json.dumps(out))
    else: unittest.main(verbosity=2)

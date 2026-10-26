"""Static-authored candidate: this regression and product code were NOT RUN.

python tools/test_asg_boundary_authority.py
TOBAN_PYTHON_ROOT=/path/to/unchanged/repo selects the pre-fix implementation.
Only synthetic supported Python settings are used. No solver or DOCX is run.
"""
import atexit
import copy
import json
import os
from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parents[1]
SOURCE_ROOT = Path(os.environ.get('TOBAN_PYTHON_ROOT', ROOT))
sys.path.insert(0, str(SOURCE_ROOT / 'tools'))
from toban import Asg, Problem, check, report, split_fixed_warnings

A, B, C = ['Synthetic ' + n for n in ('Alpha', 'Beta', 'Gamma')]
EXTRA_MESSAGE = '当月の勤務帯の設定にない枠に割当があります'


def fixture(consecutive=False, previous=None, assigned=(), fixed=None):
    r = json.loads((SOURCE_ROOT / 'webapp/data/rules.json').read_text())
    r['doctors'] = [{'name': n, 'team': 'I', 'quota': 0, 'years': 1} for n in (A, B, C)]
    r['name_order'] = [A, B, C]
    r['quota_tolerance'] = 100
    r['oncall_requirement'] = {t: {'I': 0, 'Y': 0} for t in ('I', 'A', 'Y', 'C')}
    r['rule_states'] = {k: 'off' for k in ('same_day_double', 'consecutive_days', 'weekend_balance',
        'friday_night_min', 'rest_day', 'same_day_charge_other', 'cath_requirement', 'same_weekday_cap', 'period_charge', 'oncall')}
    if consecutive:
        r['rule_states']['consecutive_days'] = 'hard'
    r['weights'] = {k: 0 for k in r['weights']}
    r['weights']['fixed_conflict'] = 29
    # December starts on a weekday; its first active slot is night.
    m = {'year': 2026, 'month': 12, 'holidays': [], 'fixed': copy.deepcopy(fixed or {}),
         'prev_month': {'last_days': copy.deepcopy(previous or [])}}
    p = Problem(r, m)
    asg = {f'{d}:{k}': {'work': B if d % 2 else C, 'oc': []} for d, k in p.slots}
    for d in assigned:
        asg[f'{d}:night'] = {'work': A, 'oc': []}
    return p, asg


def boundary_messages(p, asg):
    return [v for v in check(p, asg)[0] if '連日の実勤務' in v]


class AsgBoundaryAuthorityTest(unittest.TestCase):
    def test_current_and_previous_assignments_are_preserved(self):
        p, asg = fixture(previous=[{'date': 29, 'night': B, 'night_oc': [C]}, {'date': 30, 'night': B, 'night_oc': [A]}])
        before = copy.deepcopy((asg, p.prev_fixed))
        view = Asg(p, asg)
        for d, k in p.slots:
            self.assertEqual(view.a[(d, k)], asg[f'{d}:{k}'])
        self.assertEqual(view.work((-1, 'night')), B)
        self.assertEqual(view.oc((-1, 'night')), [C])
        self.assertEqual(view.work((0, 'night')), B)
        self.assertEqual(view.oc((0, 'night')), [A])
        self.assertEqual(check(p, asg)[0], [])
        self.assertEqual((asg, p.prev_fixed), before)

    def test_empty_history_keys_cannot_erase_hard_boundary(self):
        for v in ({}, {'work': '', 'oc': []}, {'work': None, 'oc': []}, {'work': [], 'oc': []}):
            with self.subTest(value=v):
                p, asg = fixture(True, [{'date': 30, 'night': A}], [1])
                asg['0:night'] = copy.deepcopy(v)
                before = copy.deepcopy(asg)
                self.assertEqual(len(boundary_messages(p, asg)), 1)
                self.assertEqual(Asg(p, asg).work((0, 'night')), A)
                self.assertFalse(any(EXTRA_MESSAGE in v for v in check(p, asg)[0]))
                self.assertEqual(asg, before)

    def test_fixed_current_boundary_retains_fixed_warning(self):
        p, asg = fixture(True, [{'date': 30, 'night': A}], [1], {'night': {'1': A}})
        asg['0:night'] = {'work': '', 'oc': []}
        hard, allowed = split_fixed_warnings(p, check(p, asg)[0])
        self.assertEqual(hard, [])
        self.assertEqual(len(allowed), 1)
        self.assertIn('連日の実勤務', allowed[0])

    def test_raw_nonempty_extras_are_hard_and_do_not_replace_history(self):
        for k in ('0:night', '-1:night', '-8:night', '32:night', '1:day', '1:unknown', '01:night', 'bad', '1:night:extra'):
            for v in ({'work': A, 'oc': []}, {'work': '', 'oc': [A]}):
                with self.subTest(key=k, value=v):
                    p, asg = fixture(previous=[{'date': 29, 'night': B, 'night_oc': [C]}, {'date': 30, 'night': B, 'night_oc': [C]}])
                    asg[k] = copy.deepcopy(v)
                    before = copy.deepcopy(asg)
                    hard, allowed = split_fixed_warnings(p, check(p, asg)[0])
                    self.assertEqual(len(hard), 1)
                    self.assertIn(k + ':', hard[0]); self.assertIn(EXTRA_MESSAGE, hard[0])
                    self.assertEqual(allowed, [])
                    view = Asg(p, asg)
                    self.assertEqual(view.work((-1, 'night')), B); self.assertEqual(view.oc((-1, 'night')), [C])
                    self.assertEqual(view.work((0, 'night')), B); self.assertEqual(view.oc((0, 'night')), [C])
                    self.assertEqual(view.work((1, 'night')), B, 'noncanonical 01 key must not replace canonical day one')
                    self.assertEqual(set(view.a), set(p.slots) | set(p.prev_fixed))
                    self.assertEqual(asg, before)

    def test_empty_extras_without_history_do_not_become_assignments(self):
        p, asg = fixture()
        for k in ('0:night', '-1:night', '32:night', '1:day', '1:unknown', 'bad'):
            asg[k] = {'work': '', 'oc': []}
        self.assertEqual(check(p, asg)[0], [])
        view = Asg(p, asg)
        self.assertEqual(set(view.a), set(p.slots))
        self.assertIsNone(view.work((0, 'night'))); self.assertEqual(view.oc((0, 'night')), [])

    def test_falsey_occupant_placeholders_are_empty_like_js(self):
        for v in ({'work': '', 'oc': [None, '']}, {'work': [None, ''], 'oc': [None, '']}):
            with self.subTest(value=v):
                p, asg = fixture(previous=[{'date': 30, 'night': A, 'night_oc': [C]}])
                asg['0:night'] = copy.deepcopy(v)
                asg['32:night'] = copy.deepcopy(v)
                self.assertEqual(check(p, asg)[0], [])
                self.assertEqual(Asg(p, asg).work((0, 'night')), A)
                self.assertEqual(Asg(p, asg).oc((0, 'night')), [C])
                self.assertIsNone(Asg(p, asg).work((32, 'night')))

    def test_previous_oc_survives_empty_placeholder_in_report(self):
        p, asg = fixture(previous=[{'date': 30, 'night': B, 'night_oc': [A]}], assigned=[1])
        baseline, violations = report(p, asg, 'check', '-')
        self.assertEqual(violations, [])
        asg['0:night'] = {'work': '', 'oc': []}
        actual, violations = report(p, asg, 'check', '-')
        self.assertEqual(violations, [])
        line = lambda text: next(s for s in text.splitlines() if '（減点 oc_consecutive' in s)
        self.assertIn(A, line(baseline))
        self.assertEqual(line(actual), line(baseline))
        self.assertEqual(Asg(p, asg).oc((0, 'night')), [A])

    def test_negative_history_placeholder_preserves_work_and_oc(self):
        p, asg = fixture(previous=[{'date': 29, 'night': A, 'night_oc': [C]}])
        asg['-1:night'] = {'work': None, 'oc': []}
        self.assertEqual(Asg(p, asg).work((-1, 'night')), A)
        self.assertEqual(Asg(p, asg).oc((-1, 'night')), [C])
        self.assertEqual(check(p, asg)[0], [])

    def test_next_month_constant_stays_separate(self):
        p, asg = fixture(True, assigned=[31], fixed={'night': {'32': A}})
        asg['32:night'] = {'work': '', 'oc': []}
        self.assertEqual(len(boundary_messages(p, asg)), 1)
        self.assertIsNone(Asg(p, asg).work((32, 'night')))

    def test_corrected_current_assignment_restores_clean_check_and_report(self):
        p, asg = fixture(True, [{'date': 30, 'night': A}], [1])
        # Same dictionary acceptance as CLI `check --json`; do not sanitize extras.
        asg = json.loads(json.dumps({**asg, '0:night': {'work': '', 'oc': []}}))
        _, violations = report(p, asg, 'check', '-')
        self.assertEqual(len(violations), 1)
        self.assertIn('連日の実勤務', violations[0])
        asg['1:night']['work'] = B
        self.assertEqual(check(p, asg)[0], [])
        _, violations = report(p, asg, 'check', '-')
        self.assertEqual(violations, [])


if __name__ == '__main__':
    # Count methods, not subtests. Direct invocation must not pass after an
    # early successful exit; unittest discovery still uses the TestCase above.
    EXPECTED_METHODS = 10
    accounting = {'registered': 0, 'started': 0, 'ended': 0, 'finished': False, 'success': False}

    def final_accounting():
        print('ACCOUNTING ' + ' '.join(f'{k}={v}' for k, v in accounting.items()), flush=True)
        if (not accounting['finished'] or not accounting['success'] or
                any(accounting[k] != EXPECTED_METHODS for k in ('registered', 'started', 'ended'))):
            # SystemExit inside an atexit handler is ignored by Python.
            sys.stdout.flush(); sys.stderr.flush(); os._exit(1)

    atexit.register(final_accounting)

    class AccountingResult(unittest.TextTestResult):
        def startTest(self, test):
            super().startTest(test)
            accounting['started'] += 1
            print(f"START {accounting['started']}/{EXPECTED_METHODS} {test.id()}", flush=True)

        def stopTest(self, test):
            accounting['ended'] += 1
            print(f"END {accounting['ended']}/{EXPECTED_METHODS} {test.id()}", flush=True)
            super().stopTest(test)

    suite = unittest.defaultTestLoader.loadTestsFromTestCase(AsgBoundaryAuthorityTest)
    accounting['registered'] = suite.countTestCases()
    for i, test in enumerate(suite, 1):
        print(f'REGISTER {i}/{EXPECTED_METHODS} {test.id()}', flush=True)
    if accounting['registered'] != EXPECTED_METHODS:
        raise AssertionError('Python Asg method inventory changed')
    result = unittest.TextTestRunner(verbosity=2, resultclass=AccountingResult).run(suite)
    accounting['finished'] = True
    accounting['success'] = result.wasSuccessful()
    sys.exit(0 if accounting['success'] else 1)

"""Synthetic incomplete-assignment reports; no solver or private inputs required."""
import copy
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
SOURCE_ROOT = Path(os.environ.get('TOBAN_PYTHON_ROOT', ROOT))
sys.path.insert(0, str(SOURCE_ROOT / 'tools'))
from toban import Problem, check, report, split_fixed_warnings
from test_fixed_only_contract import A, B, C, Y, fixture


def cases():
    for slot in ('1:night', '5:day', '5:night'):
        for mode in ('missing-slot', 'missing-work-key', 'null-work', 'empty-work'):
            x = fixture(slot + '/' + mode)
            if mode == 'missing-slot':
                del x['asg'][slot]
            elif mode == 'missing-work-key':
                del x['asg'][slot]['work']
            else:
                x['asg'][slot]['work'] = None if mode == 'null-work' else ''
            yield x
    # Exercise the A+A soft-summary lookup even when the day worker is valid.
    x = fixture('A day missing night')
    for d in x['rules']['doctors']:
        if d['name'] == x['asg']['5:day']['work']:
            d['team'] = 'A'
    del x['asg']['5:night']
    yield x
    x = fixture('empty assignment')
    x['asg'] = {}
    yield x


class MissingWorkReportTest(unittest.TestCase):
    def test_incomplete_report_retains_violations_and_finishes(self):
        samples = list(cases())
        self.assertEqual(len(samples), 14)
        for x in samples:
            with self.subTest(case=x['label']):
                p = Problem(copy.deepcopy(x['rules']), copy.deepcopy(x['month']))
                state = copy.deepcopy((p.rules, p.m, x['asg']))
                expected, _ = split_fixed_warnings(p, check(p, x['asg'])[0])
                self.assertTrue(any('勤務者が不正' in v for v in expected))
                md, got = report(p, x['asg'], 'check', '-')
                self.assertEqual(got, expected)
                self.assertIn('## 10 月末の接続', md)
                self.assertNotIn('違反なし（', md)
                for violation in expected:
                    self.assertIn('- ' + violation, md)
                if not x['label'].startswith('1:night/'):
                    self.assertIn('勤務者が未設定または不正（第1節参照）', md)
                self.assertEqual((p.rules, p.m, x['asg']), state)

    def test_complete_assignment_still_has_no_violations(self):
        x = fixture('valid control')
        p = Problem(x['rules'], x['month'])
        md, got = report(p, x['asg'], 'check', '-')
        self.assertEqual(got, [])
        self.assertIn('違反なし（', md)
        self.assertNotIn('勤務者が未設定または不正', md)
        self.assertIn('当番に入った延べ人数（1人・1日を1と数える）: 31\n', md)

    def test_duty_person_days_ignore_vacancies_deduplicate_and_keep_oc(self):
        for mode in ('omitted', 'null', 'blank'):
            with self.subTest(mode=mode):
                x = fixture('count only duty participants')
                p = Problem(x['rules'], x['month'])
                # 12/5: the night worker also handles day/5 OC, so count only once.
                # 12/6: OC despite a missing worker. 12/7: an empty slot.
                x['asg'] = {
                    '5:day': {'work': B, 'oc': [A]},
                    '5:night': {'work': A, 'oc': [C]},
                    '6:day': {'oc': [A]},
                    '7:night': {'oc': []},
                }
                if mode != 'omitted':
                    for slot in ('6:day', '7:night'):
                        x['asg'][slot]['work'] = None if mode == 'null' else ''
                md, violations = report(p, x['asg'], 'check', '-')
                self.assertIn('当番に入った延べ人数（1人・1日を1と数える）: 4\n', md)
                self.assertTrue(any('勤務者が不正' in v for v in violations))
        x = fixture('empty duty totals')
        md, _ = report(Problem(x['rules'], x['month']), {}, 'check', '-')
        self.assertIn('当番に入った延べ人数（1人・1日を1と数える）: 0\n', md)

    def test_unknown_people_are_reported_not_crashes(self):
        unknown = 'Synthetic Unregistered'
        for mode in ('day worker', 'night worker', 'day OC I+Y', 'night OC Y+I', 'day OC A+A', 'night OC A+A'):
            with self.subTest(mode=mode):
                x = fixture(mode)
                day, night = x['asg']['5:day'], x['asg']['5:night']
                day['work'], night['work'] = B, C
                if mode.endswith('worker'):
                    target = day if mode.startswith('day') else night
                    target['work'] = unknown
                else:
                    if mode.endswith('I+Y'):
                        night['work'] = Y
                    elif mode.endswith('Y+I'):
                        day['work'] = Y
                    else:
                        for doctor in x['rules']['doctors']:
                            if doctor['name'] in (B, C):
                                doctor['team'] = 'A'
                    target = day if mode.startswith('day') else night
                    target['oc'] = [unknown]
                # Saturday's night qualifies for a rest-day record on Sunday.
                p = Problem(x['rules'], x['month'])
                md, violations = report(p, x['asg'], 'check', '-')
                label = '勤務者が不正' if mode.endswith('worker') else 'OCが当番候補でない'
                self.assertTrue(any(label in v and unknown in v for v in violations), violations)
                self.assertIn('## 10 月末の接続', md)
                self.assertIn(label, md)

    def test_cli_check_writes_report_with_missing_or_unknown_people(self):
        for slot, mode in (('1:night', 'missing-slot'), ('5:day', 'missing-slot'),
                           ('5:day', 'missing-work-key'), ('5:night', 'unknown-worker'),
                           ('5:day', 'unknown-oc')):
            with self.subTest(slot=slot, mode=mode), tempfile.TemporaryDirectory() as directory:
                tmp = Path(directory)
                x = fixture('CLI missing ' + slot)
                if mode == 'missing-slot':
                    del x['asg'][slot]
                elif mode == 'missing-work-key':
                    del x['asg'][slot]['work']
                elif mode == 'unknown-worker':
                    x['asg'][slot]['work'] = 'Synthetic Unregistered'
                else:
                    x['asg']['5:night']['work'] = Y
                    x['asg'][slot]['oc'] = ['Synthetic Unregistered']
                (tmp / 'month.json').write_text(json.dumps({k: x[k] for k in ('rules', 'month')}))
                (tmp / 'assignment.json').write_text(json.dumps(x['asg']))
                got = subprocess.run([sys.executable, str(SOURCE_ROOT / 'tools/toban.py'), 'check', str(tmp / 'month.json'), '--json', str(tmp / 'assignment.json')], text=True, capture_output=True, timeout=20)
                self.assertEqual(got.returncode, 0, got.stdout + got.stderr)
                if mode == 'missing-slot':
                    self.assertIn('割当のない枠:', got.stdout)
                md = (tmp / '202612_py_check.md').read_text()
                self.assertIn('OCが当番候補でない' if mode == 'unknown-oc' else '勤務者が不正', md)
                self.assertIn('## 10 月末の接続', md)


if __name__ == '__main__':
    unittest.main(verbosity=2)

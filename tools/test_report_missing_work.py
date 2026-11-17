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
from test_fixed_only_contract import fixture


def cases():
    for slot in ('1:night', '5:day', '5:night'):
        for mode in ('missing-slot', 'null-work', 'empty-work'):
            x = fixture(slot + '/' + mode)
            if mode == 'missing-slot':
                del x['asg'][slot]
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
        count = 0
        for x in cases():
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
                count += 1
        self.assertEqual(count, 11)

    def test_complete_assignment_still_has_no_violations(self):
        x = fixture('valid control')
        p = Problem(x['rules'], x['month'])
        md, got = report(p, x['asg'], 'check', '-')
        self.assertEqual(got, [])
        self.assertIn('違反なし（', md)
        self.assertNotIn('勤務者が未設定または不正', md)

    def test_cli_check_writes_report_for_missing_day_and_weekday_night(self):
        for slot in ('1:night', '5:day'):
            with self.subTest(slot=slot), tempfile.TemporaryDirectory() as directory:
                tmp = Path(directory)
                x = fixture('CLI missing ' + slot)
                del x['asg'][slot]
                (tmp / 'month.json').write_text(json.dumps({k: x[k] for k in ('rules', 'month')}))
                (tmp / 'assignment.json').write_text(json.dumps(x['asg']))
                got = subprocess.run([sys.executable, str(SOURCE_ROOT / 'tools/toban.py'), 'check', str(tmp / 'month.json'), '--json', str(tmp / 'assignment.json')], text=True, capture_output=True, timeout=20)
                self.assertEqual(got.returncode, 0, got.stdout + got.stderr)
                self.assertIn('割当のない枠:', got.stdout)
                md = (tmp / '202612_py_check.md').read_text()
                self.assertIn('勤務者が不正', md)
                self.assertIn('## 10 月末の接続', md)


if __name__ == '__main__':
    unittest.main(verbosity=2)

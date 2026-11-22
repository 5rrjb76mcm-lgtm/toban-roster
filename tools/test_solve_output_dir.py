"""Exercise solve --out with the real Python CLI and only synthetic data."""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

from test_fixed_only_contract import fixture

ROOT = Path(__file__).resolve().parents[1]
SOURCE_ROOT = Path(os.environ.get('TOBAN_PYTHON_ROOT', ROOT)).resolve()
SOLVER = SOURCE_ROOT / 'tools/toban.py'
OUTPUTS = ('202612_py_assignment.json', '202612_py_result.md')


class SolveOutputDirectoryTest(unittest.TestCase):
    def test_explicit_and_default_solve_destinations(self):
        for mode in ('new', 'existing', 'non-directory', 'default'):
            with self.subTest(mode=mode), tempfile.TemporaryDirectory() as root:
                cwd = Path(root)
                source = cwd / 'inputs'
                source.mkdir()
                month = source / 'month.json'
                x = fixture('solve output destination')
                month.write_text(json.dumps({k: x[k] for k in ('rules', 'month')}), encoding='utf-8')
                original = 'Keep these earlier outputs untouched\n'
                if mode != 'default':
                    for name in OUTPUTS:
                        (source / name).write_text(original, encoding='utf-8')
                target = Path('other') / 'new output'
                if mode == 'existing':
                    (cwd / target).mkdir(parents=True)
                elif mode == 'non-directory':
                    (cwd / target).parent.mkdir()
                    (cwd / target).write_text('Not a directory', encoding='utf-8')

                command = [sys.executable, str(SOLVER), 'solve', str(month), '--time', '15']
                if mode != 'default':
                    command += ['--out', str(target)]
                got = subprocess.run(command, cwd=cwd, capture_output=True, text=True, timeout=30)

                if mode == 'non-directory':
                    self.assertEqual(got.returncode, 2, got.stdout + got.stderr)
                    self.assertIn('--out', got.stderr)
                    self.assertNotIn('Traceback', got.stderr)
                    self.assertEqual((cwd / target).read_text(encoding='utf-8'), 'Not a directory')
                else:
                    self.assertEqual(got.returncode, 0, got.stdout + got.stderr)
                    out = source if mode == 'default' else cwd / target
                    self.assertTrue((out / OUTPUTS[0]).is_file(), 'assignment not in requested directory')
                    self.assertTrue((out / OUTPUTS[1]).is_file(), 'report not in requested directory')
                    asg = json.loads((out / OUTPUTS[0]).read_text(encoding='utf-8'))
                    self.assertEqual(set(asg), set(x['asg']))
                    self.assertIn('## 10 月末の接続', (out / OUTPUTS[1]).read_text(encoding='utf-8'))
                if mode != 'default':
                    for name in OUTPUTS:
                        self.assertEqual((source / name).read_text(encoding='utf-8'), original)


    def test_check_keeps_supporting_file_and_directory_outputs(self):
        with tempfile.TemporaryDirectory() as root:
            cwd = Path(root)
            month, assignment = cwd / 'month.json', cwd / 'assignment.json'
            x = fixture('check output destination')
            month.write_text(json.dumps({k: x[k] for k in ('rules', 'month')}), encoding='utf-8')
            assignment.write_text(json.dumps(x['asg']), encoding='utf-8')
            target_dir = cwd / 'existing out'
            target_dir.mkdir()
            target_file = cwd / 'custom.md'
            command = [sys.executable, str(SOLVER), 'check', str(month), '--json', str(assignment)]
            for out, report in ((target_dir, target_dir / '202612_py_check.md'), (target_file, target_file)):
                with self.subTest(kind='directory' if out == target_dir else 'file'):
                    got = subprocess.run(command + ['--out', str(out)], capture_output=True, text=True, timeout=15)
                    self.assertEqual(got.returncode, 0, got.stdout + got.stderr)
                    self.assertIn('## 10 月末の接続', report.read_text(encoding='utf-8'))
            self.assertFalse((cwd / '202612_py_check.md').exists())


if __name__ == '__main__':
    unittest.main(verbosity=2)

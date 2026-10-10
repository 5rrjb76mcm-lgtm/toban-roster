"""Fictional supported Python quota-checker candidate scope.

TOBAN_PYTHON_ROOT can target unchanged source for red runs. No new profile,
rule, or input policy: excluded staff remain in the roster and keep their
quota/count limits, but only duty candidates must meet those work counts.
"""
import copy
import json
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from test_fixed_only_contract import fixture, evaluate, expected, work, fixed, A
from toban import Problem, build_and_solve, check, report, load


def make(label, duty='never', allow=False, limits=False, team='I'):
    x = fixture(label)
    x['rules']['quota_tolerance'] = 1
    for doc in x['rules']['doctors']:
        doc['quota'] = sum(v['work'] == doc['name'] for v in x['asg'].values())
    doc = next(d for d in x['rules']['doctors'] if d['name'] == A)
    doc.update(team=team, quota=2, duty=duty)
    x['month']['allow_chief_duty'] = allow
    if limits:
        x['month']['count_min'] = {A: 2}
        x['month']['count_max'] = {A: 3}
    return x


def cases():
    out = []
    for team in ('I', 'A', 'Y'):
        for duty, allow in (('never', False), ('never', True), ('no_unless_needed', False)):
            for limits in (False, True):
                x = make(f'excluded {team} {duty} allow={allow} limits={limits}', duty, allow, limits, team)
                x['status'] = 'OPTIMAL'
                out.append(x)
    for duty, allow in (('', False), ('no_unless_needed', True)):
        for limits in (False, True):
            x = make(f'active {duty or "ordinary"} missing required work limits={limits}', duty, allow, limits)
            expected(x, hard=1); x['status'] = 'INFEASIBLE'; out.append(x)
            x = make(f'active {duty or "ordinary"} meets required work limits={limits}', duty, allow, limits)
            work(x, 1)
            if limits: work(x, 2)
            x['status'] = 'OPTIMAL'; out.append(x)
    for kind in ('night', 'day'):
        x = make(f'excluded fixed {kind} must still be reported')
        fixed(x, 5, kind)
        x['expected']['hard'] = 1  # Solver ignores invalid fixed candidates; checker still rejects their mismatch.
        x['status'] = 'OPTIMAL'; out.append(x)
    return out


def solve_payload(payload):
    # The actual saved-wrapper reader, also used by the CLI.
    with tempfile.TemporaryDirectory() as d:
        path = Path(d) / 'synthetic_saved.json'
        path.write_text(json.dumps(payload))
        p = load(SimpleNamespace(rules=None, month=str(path)))
    status, asg, objective = build_and_solve(p, time_limit=10)
    hard = check(p, asg)[0] if asg is not None else None
    md, reported = report(p, asg, status, objective) if asg is not None else ('', None)
    return {'status': status, 'objective': objective, 'asg': asg,
            'hard': list(hard) if hard is not None else None,
            'reported': list(reported) if reported is not None else None,
            'report_clean': '違反なし' in md, 'candidates': p.duty_names}


class QuotaCandidateScopeTest(unittest.TestCase):
    def test_checker_and_pinned_real_solver(self):
        for x in cases():
            with self.subTest(case=x['label']):
                got, status, hard, allowed = evaluate(x)
                self.assertEqual(got, x['expected'], f'{status}; {hard}; {allowed}')
                self.assertEqual(status, x['status'])

    def test_unpinned_solver_output_and_saved_wrapper_report(self):
        for duty, allow in (('never', False), ('never', True), ('no_unless_needed', False)):
            for limits in (False, True):
                with self.subTest(duty=duty, allow=allow, limits=limits):
                    x = make('saved wrapper', duty, allow, limits)
                    payload = {k: copy.deepcopy(x[k]) for k in ('rules', 'month')}
                    before = copy.deepcopy(payload)
                    got = solve_payload(payload)
                    self.assertEqual((got['status'], got['objective']), ('OPTIMAL', 0))
                    self.assertNotIn(A, got['candidates'])
                    self.assertTrue(all(v['work'] != A and A not in v['oc'] for v in got['asg'].values()))
                    self.assertEqual(got['hard'], [])
                    self.assertEqual(got['reported'], [])
                    self.assertTrue(got['report_clean'])
                    self.assertEqual(payload, before)

    def test_excluded_assignment_and_reserve_checks_still_reject(self):
        for team in ('I', 'C'):
            with self.subTest(team=team):
                x = make('corrupt assignment must remain invalid', team=team)
                work(x, 2)
                p = Problem(x['rules'], x['month'])
                messages = check(p, x['asg'])[0]
                self.assertTrue(any('勤務者が不正' in m for m in messages))
                if team == 'C':
                    self.assertTrue(any('部長が勤務に配置' in m for m in messages))
                self.assertEqual(build_and_solve(p, pin=x['asg'], time_limit=10)[0], 'INFEASIBLE')


if __name__ == '__main__':
    if '--cases' in sys.argv:
        data = cases()
        for x in data:
            x['python'], x['python_status'], _, _ = evaluate(x)
        print(json.dumps(data, ensure_ascii=False))
    elif '--payload' in sys.argv:
        print(json.dumps(solve_payload(json.load(sys.stdin)), ensure_ascii=False))
    else:
        unittest.main()

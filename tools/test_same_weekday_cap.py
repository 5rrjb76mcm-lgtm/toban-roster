"""Fictional same-weekday fixed-only regressions; --cases exports JS parity inputs."""
import json
import sys
import unittest
from test_fixed_only_contract import fixture, work, oc, fixed, expected, evaluate, A
from toban import Problem, build_and_solve


def isolated(label, state='hard', cap=1):
    x = fixture(label, 'same_weekday_cap')
    x['rules']['rule_states']['same_weekday_cap'] = state
    x['rules']['max_same_weekday_shifts'] = cap
    x['rules']['weights']['same_weekday_excess'] = 17
    # Unique fictional background workers avoid unrelated same-weekday excess.
    for i, a in enumerate(x['asg'].values()):
        n = f'Synthetic Slot {i}'
        x['rules']['doctors'].append({'name': n, 'team': 'I', 'quota': 0, 'years': 1})
        x['rules']['name_order'].append(n)
        a['work'] = n
    return x


def cases():
    out = []
    for state in ('hard', 'soft', 'off'):
        for nf in (0, 1, 2, 3):
            for extra in (False, True):
                x = isolated(f'{state}: fixed={nf}, extra={extra}', state)
                days = (7, 14, 21)[:max(2, nf)]
                for d in days: work(x, d)
                for d in (7, 14, 21)[:nf]: fixed(x, d)
                if extra: work(x, 28)
                count = len(days) + int(extra)
                hard = state == 'hard' and count > max(1, nf)
                allowed = state == 'hard' and not hard
                score = (count - 1) * (50 if state == 'hard' else 17 if state == 'soft' else 0)
                x['expected_penalty'] = 50 * max(0, nf - 1) if state == 'hard' else score
                if state == 'hard' and nf >= 2: x['relaxed_objective'] = None
                out.append(expected(x, hard=int(hard), allowed=int(allowed), score=score))
    x = isolated('two fixed slots on one Saturday count twice')
    for kind in ('day', 'night'): work(x, 5, kind); fixed(x, 5, kind)
    out.append(expected(x, allowed=1, score=50))
    x = isolated('fixed work on another weekday gives no allowance')
    for d in (7, 14): work(x, d)
    work(x, 8); fixed(x, 8)
    out.append(expected(x, hard=1))
    x = isolated('fixed OC is not fixed work')
    for d in (7, 14): work(x, d)
    oc(x, 21); fixed(x, 21, mode='oc')
    out.append(expected(x, hard=1))
    x = isolated('charge is not fixed work')
    for d in (5, 12): work(x, d, 'day')
    x['month']['fixed']['weekend_charge'] = {'5': A, '12': A}
    out.append(expected(x, hard=1))
    x = isolated('previous and next month do not enlarge allowance')
    for d in (4, 11): work(x, d)
    x['month']['prev_month'] = {'last_days': [{'date': 27, 'night': A}]}
    fixed(x, 32)
    out.append(expected(x, hard=1))
    x = isolated('nonexistent weekday day cannot enlarge allowance')
    for d in (7, 14): work(x, d); fixed(x, d, 'day')
    out.append(expected(x, hard=3))  # cap plus two fixed mismatches
    for cap in (None, 0, 2):
        x = isolated(f'no excess cap={cap}', cap=cap)
        for d in (7, 14): work(x, d)
        out.append(x)
    return out


class SameWeekdayCapTest(unittest.TestCase):
    def test_checker_solver_and_score(self):
        for x in cases():
            with self.subTest(case=x['label']):
                got, status, hard, allowed = evaluate(x)
                self.assertEqual(got, x['expected'], f'{status}; V={hard}; W={allowed}')
                self.assertEqual(status, 'INFEASIBLE' if x['expected']['hard'] else 'OPTIMAL')

    def test_relax_fixed_removes_allowance(self):
        x = isolated('relax fixed')
        for d in (7, 14): work(x, d); fixed(x, d)
        p = Problem(x['rules'], x['month'])
        self.assertEqual(build_and_solve(p, pin=x['asg'], relax={'fixed'}, time_limit=10)[0], 'INFEASIBLE')


if __name__ == '__main__':
    if '--cases' in sys.argv:
        data = cases()
        for x in data:
            x['python'] = evaluate(x)[0]
            if 'relaxed_objective' in x:
                p = Problem(x['rules'], x['month'])
                x['python_relaxed_objective'] = build_and_solve(p, pin=x['asg'], relax={'fixed'}, time_limit=10)[2]
        print(json.dumps(data, ensure_ascii=False))
    else:
        unittest.main()

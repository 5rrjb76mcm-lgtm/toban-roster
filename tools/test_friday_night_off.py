"""Fictional supported Python/JS Friday minimum state/candidate contract.

TOBAN_PYTHON_ROOT can target unchanged source for a red run.
Fractional minima are deliberately outside this integer-count regression contract:
this fix does not change their existing input or rounding semantics.
"""
import copy
import json
import unittest
from unittest.mock import patch
from test_fixed_only_contract import fixture, evaluate, expected, work, fixed, A, Y
from toban import Problem, build_and_solve, check, report
from ortools.sat.python import cp_model

UNKNOWN = 'Synthetic Removed'


def make(label, state='off', minimum=1):
    x = fixture(label)
    x['rules']['friday_night_min'] = {A: minimum}
    if state == 'default': x['rules']['rule_states'].pop('friday_night_min')
    else: x['rules']['rule_states']['friday_night_min'] = state
    return x


def cases():
    out = []
    for state in ('off', 'hard', 'default'):
        active = state != 'off'
        for count in (0, 1, 2):
            x = make(f'{state} Friday count={count}', state)
            # December 2026 Fridays are 4, 11, 18 and 25.
            for d in (4, 11)[:count]: work(x, d)
            out.append(expected(x, hard=int(active and count == 0)))
        x = make(f'{state} zero minimum', state, 0)
        out.append(x)
        for mode in ('empty', 'omitted'):
            x = make(f'{state} {mode} minimum', state)
            if mode == 'empty': x['rules']['friday_night_min'] = {}
            else: x['rules'].pop('friday_night_min')
            out.append(x)
        for count in (0, 1):
            x = make(f'{state} legacy minimum count={count}', state)
            x['rules']['friday_night_exact'] = x['rules'].pop('friday_night_min')
            if count: work(x, 4)
            out.append(expected(x, hard=int(active and not count)))
        x = make(f'{state} Friday holiday night counts', state)
        x['month']['holidays'] = [4]
        work(x, 4, 'day', n=x['asg']['4:night']['work']); work(x, 4)
        out.append(x)
        x = make(f'{state} Friday holiday day does not count', state)
        x['month']['holidays'] = [4]
        work(x, 4, 'day')
        out.append(expected(x, hard=int(active)))
        x = make(f'{state} Friday OC does not count', state)
        x['asg']['4:night'] = {'work': Y, 'oc': [A]}
        out.append(expected(x, hard=int(active)))
        x = make(f'{state} Thursday work does not count', state)
        work(x, 3)
        out.append(expected(x, hard=int(active)))
        x = make(f'{state} fixed Friday work still counts', state)
        work(x, 4); fixed(x, 4)
        x['month']['unavailable_night'] = {A: [4]}
        out.append(expected(x, allowed=1))
        x = make(f'{state} fixed one Friday cannot excuse minimum two', state, 2)
        work(x, 4); fixed(x, 4)
        out.append(expected(x, hard=int(active)))
        x = make(f'{state} fixed other Fridays cannot excuse shortfall', state)
        x['month']['fixed']['night'] = {str(d): x['asg'][f'{d}:night']['work'] for d in (4, 11, 18, 25)}
        out.append(expected(x, hard=int(active)))
        x = make(f'{state} fixed next-month Friday does not count', state)
        fixed(x, 32)
        out.append(expected(x, hard=int(active)))
        for candidate in ('removed', 'never', 'reserve-disabled', 'reserve-enabled', 'ordinary-zero-quota'):
            x = make(f'{state} candidate {candidate}', state)
            doc = next(d for d in x['rules']['doctors'] if d['name'] == A)
            if candidate == 'removed':
                x['rules']['doctors'].remove(doc)
                x['rules']['name_order'].remove(A)
            if candidate == 'never': doc['duty'] = 'never'
            if candidate.startswith('reserve-'):
                doc['duty'] = 'no_unless_needed'
                x['month']['allow_chief_duty'] = candidate == 'reserve-enabled'
            included = candidate in ('reserve-enabled', 'ordinary-zero-quota')
            out.append(expected(x, hard=int(active and included)))
        x = make(f'{state} unknown stale name', state)
        x['rules']['friday_night_min'] = {UNKNOWN: 1}
        out.append(x)
        x = make(f'{state} mixed active and stale names', state)
        x['rules']['friday_night_min'][UNKNOWN] = 1
        out.append(expected(x, hard=int(active)))
    return out


class FridayNightStateTest(unittest.TestCase):
    def test_checker_and_real_solver(self):
        for x in cases():
            with self.subTest(case=x['label']):
                got, status, hard, fixed_warnings = evaluate(x)
                self.assertEqual(got, x['expected'], f'{status}; {hard}; {fixed_warnings}')
                self.assertEqual(status, 'INFEASIBLE' if x['expected']['hard'] else 'OPTIMAL')

    def test_off_unpinned_solver_and_report(self):
        x = make('off unpinned all Fridays unavailable')
        x['month']['unavailable_night'] = {A: [4, 11, 18, 25]}
        raw = copy.deepcopy((x['rules'], x['month']))
        p = Problem(x['rules'], x['month'])
        status, asg, objective = build_and_solve(p, time_limit=10)
        self.assertEqual((status, objective), ('OPTIMAL', 0))
        self.assertTrue(all(asg[f'{d}:night']['work'] != A for d in (4, 11, 18, 25)))
        self.assertEqual(check(p, asg)[0], [])
        text, hard = report(p, asg, status, objective)
        self.assertEqual(hard, [])
        self.assertNotIn('金曜夜勤0回（月1回以上の指定）', text)
        self.assertEqual((x['rules'], x['month']), raw)
        for state in ('hard', 'default'):
            r, m = copy.deepcopy(raw)
            if state == 'default': r['rule_states'].pop('friday_night_min')
            else: r['rule_states']['friday_night_min'] = state
            q = Problem(r, m)
            self.assertEqual(build_and_solve(q, time_limit=10)[0], 'INFEASIBLE')

    def test_hard_default_and_off_empty_models_identical(self):
        protos = []
        original = cp_model.CpSolver.Solve
        def solve(solver, model, *args, **kwargs):
            protos.append(str(model.Proto()))
            return original(solver, model, *args, **kwargs)
        with patch.object(cp_model.CpSolver, 'Solve', solve):
            for state in ('hard', 'default', 'off', 'empty'):
                x = make('same model', 'off' if state == 'empty' else state)
                if state == 'empty': x['rules']['friday_night_min'] = {}
                work(x, 4)
                p = Problem(x['rules'], x['month'])
                self.assertEqual(build_and_solve(p, pin=x['asg'], time_limit=10)[0], 'OPTIMAL')
        self.assertEqual(protos[0], protos[1])
        self.assertEqual(protos[2], protos[3])

    def test_ignored_entries_are_not_parsed(self):
        for state, candidate in (('off', 'active'), ('hard', 'unknown'), ('default', 'never')):
            x = make('ignored stale value', state, 'unused stale value')
            if candidate == 'unknown': x['rules']['friday_night_min'] = {UNKNOWN: 'unused stale value'}
            if candidate == 'never': x['rules']['doctors'][0]['duty'] = 'never'
            with self.subTest(state=state, candidate=candidate):
                got, status, hard, fixed_warnings = evaluate(x)
                self.assertEqual(got, x['expected'], f'{hard}; {fixed_warnings}')
                self.assertEqual(status, 'OPTIMAL')

    def test_unsupported_guards_remain(self):
        for kind in ('soft', 'profile', 'always-on'):
            x = make(kind)
            if kind == 'soft': x['rules']['rule_states']['friday_night_min'] = 'soft'
            if kind == 'profile': x['rules']['profile'] = {'positions': {'work': {'count': 2}}}
            if kind == 'always-on': x['rules']['rule_states']['oc_consecutive'] = 'off'
            with self.subTest(kind=kind), self.assertRaises(SystemExit):
                Problem(x['rules'], x['month'])


if __name__ == '__main__':
    import sys
    if '--cases' in sys.argv:
        data = cases()
        for x in data:
            got, status, hard, fixed_warnings = evaluate(x)
            x['python'] = got
            x['python_status'] = status
        print(json.dumps(data, ensure_ascii=False))
    else: unittest.main()

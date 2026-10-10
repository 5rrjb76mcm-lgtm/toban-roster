"""Fictional supported Python/JS global oncall-state contract.
TOBAN_PYTHON_ROOT can target unchanged source for a red run.
"""
import copy
import json
import unittest
from unittest.mock import patch
from test_fixed_only_contract import fixture, evaluate, expected, A, B, C, D, Y
from toban import Problem, build_and_solve, check, report
from ortools.sat.python import cp_model

DEFAULT_OC = {'I': {'I': 0, 'Y': 1}, 'A': {'I': 1, 'Y': 1},
              'Y': {'I': 1, 'Y': 0}, 'C': {'I': 1, 'Y': 0}}


def make(label, state='off'):
    x = fixture(label)
    x['rules']['oncall_requirement'] = copy.deepcopy(DEFAULT_OC)
    if state != 'default': x['rules']['rule_states']['oncall'] = state
    x['rules']['weights']['missing_young_oc'] = 11
    return x


def cases():
    out = []
    for table in ('populated', 'omitted', 'empty', 'partial'):
        x = make('off effective table: ' + table)
        if table == 'omitted': x['rules'].pop('oncall_requirement')
        if table == 'empty': x['rules']['oncall_requirement'] = {}
        if table == 'partial': x['rules']['oncall_requirement'] = {'I': {'Y': 2}}
        out.append(x)
    for state in ('hard', 'default'):
        x = make('on no OC is a hard mismatch: ' + state, state)
        out.append(expected(x, hard=39))
        x = make('on populated requirements still enforced: ' + state, state)
        for a in x['asg'].values(): a['oc'] = [Y]
        out.append(x)
        x = make('on fixed no-young retains missing penalty: ' + state, state)
        for a in x['asg'].values(): a['oc'] = [Y]
        x['asg']['1:night']['oc'] = []
        x['month']['fixed']['night_oc_none'] = {'1': ['Y']}
        out.append(expected(x, score=11))
    x = make('off fixed no-young does not create missing penalty')
    x['month']['fixed']['night_oc_none'] = {'1': ['Y']}
    out.append(x)
    x = make('off unexpected OC is still a hard mismatch')
    x['asg']['1:night']['oc'] = [Y]
    out.append(expected(x, hard=1))
    for present in (False, True):
        x = make('off retained fixed OC present=' + str(present))
        x['month']['fixed']['night_oc'] = {'1': [Y]}
        if present: x['asg']['1:night']['oc'] = [Y]
        out.append(expected(x, hard=1))
    x = make('off fixed OC is not a work unavailability exemption')
    x['month']['fixed']['night_oc'] = {'1': [C]}
    x['month']['unavailable_night'] = {C: [1]}
    out.append(expected(x, hard=2))
    x = make('off fixed OC is not an OC duty exemption')
    x['month']['fixed']['night_oc'] = {'1': [Y]}
    x['month']['duty_days'] = {Y: {'2': {'am': 'external'}}}
    x['asg']['1:night']['oc'] = [Y]
    out.append(expected(x, hard=2))
    for state in ('hard', 'default'):
        x = make('on zero table retains fixed-OC exemption semantics: ' + state, state)
        x['rules']['oncall_requirement'] = {t: {'I': 0, 'Y': 0} for t in DEFAULT_OC}
        x['month']['fixed']['night_oc'] = {'1': [C]}
        x['month']['unavailable_night'] = {C: [1]}
        out.append(expected(x, hard=1, allowed=1))
    x = make('off ordinary fixed work still exempts unavailability')
    x['month']['fixed']['night'] = {'1': C}
    x['month']['unavailable_night'] = {C: [1]}
    out.append(expected(x, allowed=1))
    for team in ('A', 'Y'):
        x = make('off weekday work has no OC regardless of role: ' + team)
        x['rules']['doctors'][0]['team'] = team
        x['asg']['1:night']['work'] = A
        out.append(x)
    x = make('off reserve work keeps quota exemption and chief penalty')
    x['rules']['doctors'][0].update(team='C', duty='no_unless_needed', quota=10)
    x['month']['allow_chief_duty'] = True
    x['rules']['weights'].update(target_deviation=7, chief_duty=17)
    # All other staff have zero target deviation weight effect after setting their target to actual counts.
    x['month']['targets'] = {n: sum(a['work'] == n for a in x['asg'].values()) for n in (B,C,D,Y)}
    x['month']['targets'][C] -= 1
    x['asg']['1:night']['work'] = A
    out.append(expected(x, score=17))
    x = make('off no junior candidates needed')
    x['rules']['doctors'] = [d for d in x['rules']['doctors'] if d['name'] != Y]
    out.append(x)
    for state in ('hard', 'default', 'off'):
        x = make('off oncall leaves independent period state: ' + state)
        if state != 'default': x['rules']['rule_states']['period_charge'] = state
        out.append(x)
    x = make('off oncall cannot disable period charge requirement')
    x['asg']['5:day']['work'] = Y
    out.append(expected(x, hard=1))
    x = make('off previous OC still contributes independent consecutive penalty')
    x['month']['prev_month'] = {'last_days': [{'date': 30, 'night': B, 'night_oc': [A]}]}
    x['asg']['1:night']['work'] = A
    x['rules']['weights']['oc_consecutive'] = 13
    out.append(expected(x, score=13))
    for mode in ('night_oc', 'night', 'weekend_charge'):
        x = make('off next fixed ' + mode + ' retains existing boundary semantics')
        x['month']['fixed'][mode] = {'32': [C] if mode.endswith('_oc') else C}
        x['rules']['weights']['oc_consecutive'] = 13
        out.append(expected(x, score=0 if mode == 'night' else 13))
    x = make('off crossing next OC still binds independent period charge')
    x['month']['month'] = 10
    # Rebuild the normal month slots for a month ending on Saturday.
    p = Problem(copy.deepcopy(x['rules']), copy.deepcopy(x['month']))
    x['asg'] = {f'{d}:{k}': {'work': (B,C,D)[d % 3], 'oc': []} for d,k in p.slots}
    x['month']['fixed']['day_oc'] = {'32': [A]}
    out.append(expected(x, hard=1))
    return out


class OncallStateTest(unittest.TestCase):
    def test_checker_and_real_solver(self):
        for x in cases():
            with self.subTest(case=x['label']):
                got, status, hard, fixed = evaluate(x)
                self.assertEqual(got, x['expected'], f'{status}; {hard}; {fixed}')
                self.assertEqual(status, 'INFEASIBLE' if x['expected']['hard'] else 'OPTIMAL')

    def test_effective_table_and_raw_input_preservation(self):
        for x in cases()[:4]:
            raw = copy.deepcopy((x['rules'], x['month']))
            p = Problem(x['rules'], x['month'])
            self.assertTrue(all(v == 0 for row in p.oc_req.values() for v in row.values()))
            self.assertEqual((x['rules'], x['month']), raw)
            # Re-enabling the same raw input restores populated and defaulted values.
            x['rules']['rule_states']['oncall'] = 'hard'
            q = Problem(x['rules'], x['month'])
            self.assertGreater(q.oc_req['I']['Y'], 0)

    def test_unpinned_off_solver_and_missing_young_report(self):
        x = make('unpinned other-role weekdays')
        x['rules']['doctors'][0]['team'] = 'A'
        x['month']['fixed']['night'] = {'1': A}
        p = Problem(x['rules'], x['month'])
        status, asg, objective = build_and_solve(p, time_limit=10)
        self.assertEqual((status, objective), ('OPTIMAL', 0))
        self.assertTrue(all(not a['oc'] for a in asg.values()))
        self.assertEqual(check(p, asg)[0], [])
        text, hard = report(p, asg, status, objective)
        self.assertEqual(hard, [])
        self.assertIn('若手OCを置けなかった枠（減点 missing_young_oc）: なし', text)

    def test_hard_and_default_models_identical(self):
        protos = []
        original = cp_model.CpSolver.Solve
        def solve(solver, model, *args, **kwargs):
            protos.append(str(model.Proto()))
            return original(solver, model, *args, **kwargs)
        with patch.object(cp_model.CpSolver, 'Solve', solve):
            for state in ('hard', 'default'):
                x = make('same model', state)
                for a in x['asg'].values(): a['oc'] = [Y]
                p = Problem(x['rules'], x['month'])
                self.assertEqual(build_and_solve(p, pin=x['asg'], time_limit=10)[0], 'OPTIMAL')
        self.assertEqual(protos[0], protos[1])

    def test_unsupported_guards_remain(self):
        for kind in ('soft', 'shift', 'always-on'):
            x = make(kind)
            if kind == 'soft': x['rules']['rule_states']['oncall'] = 'soft'
            if kind == 'shift': x['rules']['profile'] = {'shifts': [{'id': 'day', 'on': 'off_days', 'oncall': False}]}
            if kind == 'always-on': x['rules']['rule_states']['oc_consecutive'] = 'off'
            with self.subTest(kind=kind), self.assertRaises(SystemExit):
                Problem(x['rules'], x['month'])


if __name__ == '__main__':
    import sys
    if '--cases' in sys.argv:
        data = cases()
        for x in data: x['python'] = evaluate(x)[0]
        print(json.dumps(data, ensure_ascii=False))
    else: unittest.main()

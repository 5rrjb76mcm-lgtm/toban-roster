"""Fictional supported Python/JS disabled-period-charge contract.
TOBAN_PYTHON_ROOT may point at unchanged source for the red run.
"""
import copy
import json
import sys
import unittest
from unittest.mock import patch
from test_fixed_only_contract import fixture, rules, evaluate, expected, A, B, C, D, Y
from toban import Problem, build_and_solve, check, report
from ortools.sat.python import cp_model

CHARGE_WEIGHTS = dict(charge_handover=31, split_weekend=37, consecutive_weekend=41,
                      weekend_history_spread=43, charge_without_dayshift=47)


def make(label, month=12, no_charge=False):
    x = fixture(label, month={'month': month})
    x['rules']['rule_states']['period_charge'] = 'off'
    x['rules']['weights'].update(CHARGE_WEIGHTS)
    x['rules']['oncall_requirement'] = {t: {'I': 0, 'Y': 0} for t in ('I', 'A', 'Y', 'C')}
    if no_charge:
        for d in x['rules']['doctors']: d['team'] = 'A'
    return x


def cases():
    out = []
    for absent in (False, True):
        for state in ('off', 'hard', 'default'):
            x = make(f'off charge absent={absent}, balance={state}', no_charge=absent)
            if state == 'default': x['rules']['rule_states'].pop('weekend_balance')
            else: x['rules']['rule_states']['weekend_balance'] = state
            x['rules']['weekend_balance_max_diff'] = 0
            x['month']['history'] = {'weekend_charge': {A: 100, B: 0}}
            out.append(x)
    x = make('off handover and split have no objective')
    x['asg']['5:night']['work'] = A
    out.append(x)
    for kind, name in (('valid', A), ('unknown', 'Synthetic Archived'), ('noncharge', Y)):
        x = make('off current fixed charge ignored: ' + kind)
        x['month']['fixed']['weekend_charge'] = {'5': name, '1': name}
        out.append(x)
    x = make('off fixed charge cannot exempt unavailability')
    x['month']['fixed']['weekend_charge'] = {'5': D}
    x['month']['unavailable_other'] = [{'name': D, 'day': 5, 'part': 'am'}]
    out.append(expected(x, hard=1))
    x = make('off ordinary fixed work remains enforced')
    x['month']['fixed']['night'] = {'2': A}
    out.append(expected(x, hard=1))
    x = make('off previous charge link ignored', month=11)
    x['month']['prev_month'] = {'last_days': [{'date': 31, 'day': A, 'night': A}], 'last_weekend_charge': A}
    out.append(x)
    for mode in ('charge', 'day', 'day_oc'):
        x = make('off crossing next ' + mode + ' cannot require charge', month=10)
        x['month']['fixed']['weekend_charge' if mode == 'charge' else mode] = {'32': [A] if mode.endswith('_oc') else A}
        x['rules']['weights']['oc_consecutive'] = 13
        out.append(x)
    x = make('off next fixed charge retains independent OC semantics')
    x['month']['fixed']['weekend_charge'] = {'32': C}
    x['rules']['weights']['oc_consecutive'] = 13
    out.append(expected(x, score=13))
    x = make('off next fixed work retains consecutive prohibition')
    x['month']['fixed']['night'] = {'32': C}
    x['rules']['rule_states']['consecutive_days'] = 'hard'
    out.append(expected(x, hard=1))
    for state in ('hard', 'default'):
        x = make('on no charge staff remains infeasible: ' + state, no_charge=True)
        if state == 'default': x['rules']['rule_states'].pop('period_charge')
        else: x['rules']['rule_states']['period_charge'] = state
        out.append(expected(x, hard=16))
        x = make('on handover weights remain active: ' + state)
        if state == 'default': x['rules']['rule_states'].pop('period_charge')
        else: x['rules']['rule_states']['period_charge'] = state
        x['rules']['weights'].update({k: 0 for k in CHARGE_WEIGHTS})
        x['rules']['weights']['charge_handover'] = 31
        x['asg']['5:night']['work'] = A
        out.append(expected(x, score=31))
    return out


class DisabledChargeTest(unittest.TestCase):
    def test_checker_and_real_solver(self):
        for x in cases():
            with self.subTest(case=x['label']):
                got, status, hard, fixed = evaluate(x)
                self.assertEqual(got, x['expected'], f'{status}; {hard}; {fixed}')
                self.assertEqual(status, 'INFEASIBLE' if x['expected']['hard'] else 'OPTIMAL')

    def test_no_charge_variables_report_or_assignment_facts(self):
        x = make('structural check')
        x['rules']['rule_states']['weekend_balance'] = 'hard'
        x['month']['history'] = {'weekend_charge': {A: 100}}
        x['asg']['5:night']['work'] = A
        p = Problem(copy.deepcopy(x['rules']), copy.deepcopy(x['month']))
        models = []
        original = cp_model.CpSolver.Solve
        def solve(solver, model, *args, **kwargs):
            models.append(model.Proto())
            return original(solver, model, *args, **kwargs)
        with patch.object(cp_model.CpSolver, 'Solve', solve):
            status, asg, score = build_and_solve(p, pin=x['asg'], time_limit=10)
        self.assertEqual((status, score), ('OPTIMAL', 0))
        self.assertTrue(models)
        charge_names = ('c_', 'cp_', 'handover_', 'split_', 'cw_', 'cd_')
        self.assertFalse([v.name for v in models[0].variables if v.name.startswith(charge_names) or v.name in ('wmax', 'wmin')])
        violations, charge = check(p, asg)
        self.assertEqual(violations, [])
        self.assertEqual(charge, {q['id']: {d: None for d in q['days']} for q in p.periods})
        text, warnings = report(p, asg, status, score)
        self.assertEqual(warnings, [])
        for forbidden in ('日の途中で担当が交代した日:', '前月までの履歴込み:', '分割した土日:', '連続する週末担当:'):
            self.assertNotIn(forbidden, text)
        self.assertIn('period_charge', text)

    def test_unpinned_off_solver_and_input_preservation(self):
        x = make('unrestricted off solver', no_charge=True)
        x['month']['fixed']['weekend_charge'] = {'5': A}
        original = copy.deepcopy((x['rules'], x['month']))
        p = Problem(x['rules'], x['month'])
        status, asg, objective = build_and_solve(p, time_limit=10)
        self.assertEqual((status, objective), ('OPTIMAL', 0))
        self.assertEqual(check(p, asg)[0], [])
        self.assertEqual(set(asg), set(x['asg']))
        self.assertTrue(all(a['work'] in p.names for a in asg.values()))
        self.assertEqual((x['rules'], x['month']), original)

    def test_unsupported_guards_unchanged(self):
        for rid, state in (('period_charge', 'soft'), ('weekend_balance', 'soft'), ('run_length_max', 'hard'), ('oc_consecutive', 'off')):
            x = make('unsupported')
            x['rules']['rule_states'][rid] = state
            with self.subTest(rule=rid), self.assertRaises(SystemExit):
                Problem(x['rules'], x['month'])


if __name__ == '__main__':
    if '--cases' in sys.argv:
        data = cases()
        for x in data: x['python'] = evaluate(x)[0]
        print(json.dumps(data, ensure_ascii=False))
    else:
        unittest.main()

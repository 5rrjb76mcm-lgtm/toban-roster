"""Saved one-person count representations; no generalized Python profiles."""
import copy
import json
import unittest
from pathlib import Path
from unittest.mock import patch
from test_fixed_only_contract import fixture, evaluate
from toban import Problem, build_and_solve
from ortools.sat.python import cp_model

ACCEPTED = [None, 1, 1.0, {}, {'day': 1, 'night': 1}, {'day': 1},
            {'night': None}, {'weekday': 1, 'off_days': 1},
            {'day': {'off_days': 1}, 'night': {'weekday': 1, 'off_days': 1}},
            {'day': {}, 'night': {'weekday': None}},
            {'day': 1, 'night': 1, 'weekday': 1, 'off_days': 1}]
REJECTED = [float('nan'), float('inf'), -float('inf'), 0, -1, 2, 0.5, 1.2, '1', '', True, False, [], [1],
            {'day': 0}, {'night': 2}, {'day': 1.2}, {'night': '1'},
            {'day': True}, {'night': []}, {'evening': 1},
            {'weekday': 0}, {'off_days': 2}, {'weekday': '1'},
            {'night': {'weekday': 1, 'off_days': 2}},
            {'day': 1, 'night': 1, 'unknown': 1},
            {'day': {'unknown': 1}}, {'day': 1, 'weekday': 2}]


def case(count):
    x = fixture('saved single-person count')
    x['rules'].setdefault('profile', {}).setdefault('positions', {})['work'] = {'count': copy.deepcopy(count)}
    return x


class SavedCountTest(unittest.TestCase):
    def test_equivalent_counts_and_exact_cp_models(self):
        protos = []
        original = cp_model.CpSolver.Solve
        def solve(solver, model, *args, **kwargs):
            protos.append(str(model.Proto()))
            return original(solver, model, *args, **kwargs)
        variants = [fixture('omitted count')] + [case(c) for c in ACCEPTED]
        with patch.object(cp_model.CpSolver, 'Solve', solve):
            for x in variants:
                with self.subTest(count=x['rules'].get('profile', {}).get('positions')):
                    before = copy.deepcopy(x)
                    got, status, hard, allowed = evaluate(x)
                    self.assertEqual(got, x['expected'], f'{hard}; {allowed}')
                    self.assertEqual(status, 'OPTIMAL')
                    self.assertEqual(x, before)
        self.assertEqual(len(protos), len(variants))
        self.assertTrue(all(p == protos[0] for p in protos))

    def test_bundled_default_on_models_identical(self):
        root = Path(__file__).resolve().parents[1]
        rules = json.loads((root / 'webapp/data/rules.json').read_text())
        month = json.loads((root / 'webapp/data/202611.json').read_text())
        month = month.get('month', month) if isinstance(month.get('month'), dict) else month
        protos = []
        class Captured(Exception): pass
        def capture(solver, model, *args, **kwargs):
            protos.append(str(model.Proto()))
            raise Captured()
        with patch.object(cp_model.CpSolver, 'Solve', capture):
            for count in (None, 1, {'day': 1, 'night': 1}, {'weekday': 1, 'off_days': 1}):
                r = copy.deepcopy(rules)
                if count is not None:
                    r.setdefault('profile', {}).setdefault('positions', {})['work'] = {'count': count}
                with self.assertRaises(Captured):
                    build_and_solve(Problem(r, copy.deepcopy(month)), time_limit=10)
        self.assertEqual(len(protos), 4)
        self.assertTrue(all(p == protos[0] for p in protos))

    def test_malformed_or_non_single_counts_rejected(self):
        for c in REJECTED:
            with self.subTest(count=c), self.assertRaises(SystemExit):
                x = case(c)
                Problem(x['rules'], x['month'])

    def test_other_guards_still_reject(self):
        modifications = [
            {'positions': {'work': {'count': {'day': 1, 'night': 1}, 'min': 1}}},
            {'quota_mode': 'share'},
            {'roles': [{'id': 'New', 'refs': ['charge']}]},
            {'shifts': [{'id': 'day', 'on': 'all'}, {'id': 'night', 'on': 'all'}]},
            {'shifts': [{'id': 'night', 'oncall': False}]},
            {'shifts': [{'id': 'evening', 'on': 'all'}]},
            {'shifts': [{'on': 'all'}]},
        ]
        for change in modifications:
            with self.subTest(change=change), self.assertRaises(SystemExit):
                x = case({'day': 1, 'night': 1})
                x['rules']['profile'].update(change)
                Problem(x['rules'], x['month'])


    def test_shift_ids_rejected_for_scalar_and_mapped_counts(self):
        for count in (1, {'day': 1, 'night': 1}):
            for shifts in ([{'id': 'evening', 'on': 'all'}], [{'on': 'all'}]):
                with self.subTest(count=count, shifts=shifts), self.assertRaises(SystemExit):
                    x = case(count)
                    x['rules']['profile']['shifts'] = shifts
                    Problem(x['rules'], x['month'])
            x = case(count)
            x['rules']['profile']['shifts'] = [
                {'id': 'day', 'label': 'Synthetic Day', 'on': 'off_days'},
                {'id': 'night', 'label': 'Synthetic Night', 'on': 'all'}]
            Problem(x['rules'], x['month'])


if __name__ == '__main__': unittest.main()

"""Synthetic Python report/solver agreement for next-month OC boundary.
TOBAN_PYTHON_ROOT may select pristine baseline source; no private inputs.
"""
import copy
import os
import sys
from pathlib import Path
sys.path.insert(0, str(Path(os.environ.get('TOBAN_PYTHON_ROOT', Path(__file__).resolve().parents[1])) / 'tools'))
from toban import Problem, build_and_solve, report
from test_fixed_only_contract import fixture, work, oc, fixed, A

CASES = [
    ('work to next OC', 'work', 'oc', 6),
    ('OC to next work', 'oc', 'work', 6),
    ('OC to next OC', 'oc', 'oc', 6),
    ('work to next work', 'work', 'work', 0),
    ('work without next', 'work', None, 0),
]

def main():
    failed = 0
    for label, current, nxt, score in CASES:
        x = fixture(label, month={'month': 11})
        x['rules']['rule_states']['period_charge'] = 'off'
        x['rules']['weights']['oc_consecutive'] = 6
        (work if current == 'work' else oc)(x, 30)
        if nxt: fixed(x, 31, mode=nxt)
        p = Problem(x['rules'], x['month'])
        before = copy.deepcopy((x['rules'], x['month'], x['asg']))
        status, asg, objective = build_and_solve(p, pin=x['asg'], time_limit=10)
        text, _ = report(p, x['asg'], status, objective)
        line = next(s for s in text.splitlines() if 'OC を含む隣接枠' in s)
        link = f'{p.label(30)}夜間→{p.label(31)}夜間'
        observed = link in line and A + ':' in line
        print(f'OBSERVED {label}: status={status}, objective={objective}, report={observed}, expected={score}', flush=True)
        try:
            assert status == 'OPTIMAL' and objective == score
            assert observed == bool(score), line
            assert (x['rules'], x['month'], x['asg']) == before
            print('PASS', label, flush=True)
        except AssertionError as e:
            failed += 1; print('FAIL', label, str(e), flush=True)
    extra = [
        ('nonexistent weekday day', 11, False, ['day_oc'], 0),
        ('holiday day OC', 11, True, ['day_oc'], 6),
        ('holiday night alone for charge role', 11, True, ['night_oc'], 0),
        ('holiday day and night for charge role', 11, True, ['day_oc', 'night_oc'], 6),
        ('same weekend charge exemption', 10, False, ['day_oc'], 0),
    ]
    for label, month, holiday, kinds, score in extra:
        x = fixture(label, month={'month': month, 'next_month_first_day_is_holiday': holiday})
        x['rules']['rule_states']['period_charge'] = 'off'
        x['rules']['weights']['oc_consecutive'] = 6
        d = 30 if month == 11 else 31
        work(x, d)
        for kind in kinds:
            fixed(x, d + 1, kind.split('_')[0], mode='oc')
        p = Problem(x['rules'], x['month'])
        status, _, objective = build_and_solve(p, pin=x['asg'], time_limit=10)
        text, _ = report(p, x['asg'], status, objective)
        line = next(s for s in text.splitlines() if 'OC を含む隣接枠' in s)
        reported = A + ': ' + p.label(d) + '夜間→' + p.label(d + 1) in line
        print(f'OBSERVED {label}: status={status}, objective={objective}, report={reported}, expected={score}', flush=True)
        try:
            assert status == 'OPTIMAL' and objective == score
            assert reported == bool(score), line
            print('PASS', label, flush=True)
        except AssertionError as e:
            failed += 1; print('FAIL', label, str(e), flush=True)
    # A non-charge role on a holiday can incur both adjacent day and
    # night terms; assert both are reported, independently of team I rules.
    for kinds, score in ((['day_oc'], 6), (['night_oc'], 6), (['day_oc', 'night_oc'], 12)):
        x = fixture('non-charge holiday', month={'month': 11, 'next_month_first_day_is_holiday': True})
        next(doc for doc in x['rules']['doctors'] if doc['name'] == A)['team'] = 'Y'
        x['rules']['rule_states']['period_charge'] = 'off'
        x['rules']['weights']['oc_consecutive'] = 6
        work(x, 30); x['asg']['30:night']['oc'] = [x['rules']['doctors'][1]['name']]
        for kind in kinds: fixed(x, 31, kind.split('_')[0], mode='oc')
        p = Problem(x['rules'], x['month'])
        status, _, objective = build_and_solve(p, pin=x['asg'], time_limit=10)
        text, _ = report(p, x['asg'], status, objective)
        line = next(s for s in text.splitlines() if 'OC を含む隣接枠' in s)
        found = sum(f"{p.label(30)}夜間→{p.label(31)}{suffix}" in line for suffix in ('日勤帯', '夜間'))
        print(f'OBSERVED non-charge {kinds}: status={status}, objective={objective}, report_count={found}, expected={score}', flush=True)
        try:
            assert status == 'OPTIMAL' and objective == score
            assert found == len(kinds), line
            print('PASS non-charge', kinds, flush=True)
        except AssertionError as e:
            failed += 1; print('FAIL non-charge', kinds, str(e), flush=True)
    for month, expected in ((11, 6), (10, 0)):
        x = fixture('next fixed charge', month={'month': month})
        x['rules']['rule_states']['period_charge'] = 'off'
        x['rules']['weights']['oc_consecutive'] = 6
        d = 30 if month == 11 else 31
        work(x, d); x['month']['fixed']['weekend_charge'] = {str(d + 1): A}
        p = Problem(x['rules'], x['month'])
        status, _, objective = build_and_solve(p, pin=x['asg'], time_limit=10)
        text, _ = report(p, x['asg'], status, objective)
        line = next(s for s in text.splitlines() if 'OC を含む隣接枠' in s)
        found = A + ': ' + p.label(d) + '夜間→' + p.label(d + 1) in line
        print(f'OBSERVED next fixed charge {month}: status={status}, objective={objective}, report={found}, expected={expected}', flush=True)
        try:
            assert status == 'OPTIMAL' and objective == expected
            assert found == bool(expected), line
            print('PASS next fixed charge', month, flush=True)
        except AssertionError as e:
            failed += 1; print('FAIL next fixed charge', month, str(e), flush=True)
    total = len(CASES) + len(extra) + 5
    print(f'{total-failed} passed, {failed} failed, {total} total')
    if failed: raise SystemExit(1)
if __name__ == '__main__': main()

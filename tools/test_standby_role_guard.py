"""Frozen Python rejects non-default effective standby roles. Fictional data only.
TOBAN_PYTHON_ROOT selects baseline/fixed sources without changing this test.
--cases exports the same JSON fixtures for the JS semantic counterpart.
"""
import atexit
import copy
import json
import os
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace

ROOT = Path(__file__).resolve().parents[1]
SOURCE = Path(os.environ.get("TOBAN_PYTHON_ROOT", ROOT))
finished = False
started = []
completed = []
failures = []


def completion_guard():
    if not finished:
        sys.stderr.write("FAIL: standby guard ended before completion\n")
        sys.stderr.flush()
        os._exit(1)


atexit.register(completion_guard)
sys.path.insert(0, str(SOURCE / "tools"))
from toban import Problem, load


def fixtures():
    rules = json.loads((ROOT / "webapp/data/rules.json").read_text())
    month = json.loads((ROOT / "webapp/data/202611.json").read_text())
    roles = [{"id": "I", "refs": ["charge"], "standby": True},
             {"id": "A", "refs": ["other"]},
             {"id": "Y", "refs": ["junior"], "standby": True},
             {"id": "C", "refs": ["reserve"]}]
    out = []
    def add(label, rs, accepted, off=False):
        r = copy.deepcopy(rules)
        r.setdefault("profile", {})["roles"] = copy.deepcopy(rs)
        if label == "missing":
            r["profile"].pop("roles")
        if off:
            r.setdefault("rule_states", {})["oncall"] = "off"
        out.append(dict(id=label, rules=r, month=copy.deepcopy(month), accepted=accepted))
    add("missing", None, True)
    add("empty", [], True)
    add("explicit-default", roles, True)
    cosmetic = copy.deepcopy(roles)
    cosmetic.reverse()
    for r in cosmetic:
        r["label"] = {"ja": "架空 " + r["id"], "en": "Synthetic " + r["id"]}
    add("cosmetic-and-order", cosmetic, True)
    ac_false = copy.deepcopy(roles)
    ac_false[1]["standby"] = False
    ac_false[3]["standby"] = False
    add("non-standby-explicit-false", ac_false, True)
    for role_id in ("I", "Y"):
        for value, label in ((False, "false"), (None, "null"), (0, "zero"), ("", "empty-string"), ("missing", "omitted")):
            rs = copy.deepcopy(roles)
            role = next(r for r in rs if r["id"] == role_id)
            if value == "missing":
                role.pop("standby")
            else:
                role["standby"] = value
            add(role_id + ":" + label, rs, False)
    for role_id in ("A", "C"):
        rs = copy.deepcopy(roles)
        next(r for r in rs if r["id"] == role_id)["standby"] = True
        add(role_id + ":enabled", rs, False)
    rs = copy.deepcopy(roles)
    rs[2].pop("standby")
    add("Y:omitted:oncall-off", rs, False, off=True)
    # Match JS truthiness of JSON values rather than Python's []/{} falsiness.
    for value, label in (([], "array"), ({}, "object"), ("false", "string")):
        rs = copy.deepcopy(roles)
        rs[2]["standby"] = value
        add("Y:truthy-" + label, rs, True)
        rs = copy.deepcopy(roles)
        rs[1]["standby"] = value
        add("A:truthy-" + label, rs, False)
    assert len(out) == 24
    return out


def scenario(label, action):
    started.append(label)
    print("SCENARIO_START " + label, flush=True)
    try:
        action()
    except BaseException as exc:
        failures.append(label)
        print("FAIL " + label + ": " + repr(exc), flush=True)
    completed.append(label)
    print("SCENARIO_COMPLETE " + label, flush=True)


def verify(x, use_saved, folder):
    before = copy.deepcopy(x)
    try:
        if use_saved:
            p = Path(folder) / "synthetic.json"
            p.write_text(json.dumps({"rules": x["rules"], "month": x["month"]}))
            load(SimpleNamespace(rules=None, month=str(p)))
        else:
            Problem(x["rules"], x["month"])
    except SystemExit as exc:
        if x["accepted"] or "profile.roles.standby" not in str(exc):
            raise AssertionError("Unexpected rejection: " + str(exc)) from exc
    else:
        if not x["accepted"]:
            raise AssertionError("Unsupported standby configuration was accepted")
    assert x == before, "input mutated"


if __name__ == "__main__":
    cases = fixtures()
    if "--cases" in sys.argv:
        print(json.dumps(cases, ensure_ascii=False), flush=True)
        finished = True
    else:
        with tempfile.TemporaryDirectory() as folder:
            for saved in (False, True):
                for x in cases:
                    scenario(("saved:" if saved else "constructor:") + x["id"],
                             lambda x=x, saved=saved: verify(x, saved, folder))
        assert len(started) == len(completed) == len(set(completed)) == 48
        print("ACCOUNTING " + json.dumps(dict(expected=48, started=len(started), completed=len(completed), failed=len(failures))), flush=True)
        finished = True
        sys.exit(bool(failures))

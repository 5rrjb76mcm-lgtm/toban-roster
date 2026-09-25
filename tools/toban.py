#!/usr/bin/env python3
"""当直表ソルバー（CP-SAT）

共通ルール 版1.6 の必須条件をハード制約、調整目標を重み付き目的関数として解き、
第9節の集計と第10節の検算をコードで出力する。

使い方:
  toban.py solve <月別条件.yaml> [--rules rules.yaml] [--base 割当.json] [--out DIR] [--time 60]
  toban.py check <月別条件.yaml> (--docx 当直表.docx | --json 割当.json) [--rules rules.yaml]
  toban.py docx  <月別条件.yaml> --json 割当.json --template 前月表.docx --out 出力.docx [--label 確認版]
"""
from __future__ import annotations

import argparse
import calendar
import copy
import datetime as dt
import json
import os
import sys
from collections import defaultdict

import yaml

DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
DOW_JA = ["月", "火", "水", "木", "金", "土", "日"]
PARTS = {"am": {"am"}, "pm": {"pm"}, "full": {"am", "pm"}}


# ----------------------------------------------------------------------------
# 入力
# ----------------------------------------------------------------------------
# Python 版が「減点」として扱える規則（JS 版と同じ式を持つもの）。ここに無い規則を soft にした設定は受け付けない
# Python 版が「減点」のまま実装している規則（JS 版の RULE_DEFS のうち、もともと調整目標だったもの）
SOFT_OK_PY = {"arrhythmia_pre_workday_night", "same_weekday_cap", "quota_target", "staff_per_day", "oc_consecutive",
              "nonadjacent_consecutive", "work_gap", "wish_night", "wish_weekend_dayshift", "avoid_days",
              "spread_standby", "duty_after_night"}
# 上のうち「なし」にできるのは JS 版だけ（Python 版は常に適用する）
ALWAYS_ON_PY = ("quota_range", "quota_target", "staff_per_day", "oc_consecutive", "nonadjacent_consecutive",
                "work_gap", "wish_night", "wish_weekend_dayshift", "avoid_days", "spread_standby",
                "duty_after_night", "duty_conflicts")  # cath_requirement は循環器内科のプラグインの規則（rule_states で付け外し。表も資格も無ければ「なし」）


class Problem:
    def __init__(self, rules: dict, month: dict):
        self.rules = rules
        if self.rules.get('friday_night_min') is None and self.rules.get('friday_night_exact'):  # 旧名（ちょうど n 回）→ 最低 n 回
            self.rules['friday_night_min'] = self.rules['friday_night_exact']
        self.m = month
        self.year = int(month["year"])
        self.month = int(month["month"])
        self.N = calendar.monthrange(self.year, self.month)[1]
        self.holidays_extra = set(int(x) for x in month.get("holidays", []))
        # カテ室配置が不要な日（カテ0件確定。学会など）。副担当・主担当で別に設定（旧 cath_off_days は両方に適用）
        legacy_off = set(int(x) for x in month.get("cath_off_days") or [])
        self.cath_off_A = legacy_off | set(int(x) for x in month.get("cath_off_days_A") or [])
        self.cath_off_I = legacy_off | set(int(x) for x in month.get("cath_off_days_I") or [])
        self.duties_on_holidays = bool(month.get("duties_on_holidays", False))
        self.next_first_holiday = bool(month.get("next_month_first_day_is_holiday", False))

        # 規則の正規化: 欠けている項目は既定で補う（JS の model.js と同じ既定）
        _oc_default = {"I": {"I": 0, "Y": 1}, "A": {"I": 1, "Y": 1}, "Y": {"I": 1, "Y": 0}, "C": {"I": 1, "Y": 0}}
        self.oc_req = {t: dict(_oc_default[t], **((rules.get("oncall_requirement") or {}).get(t) or {})) for t in _oc_default}
        self.cath_req = {w: dict({"A_am": 0, "A_pm": 0, "I": 1, "pm_clinic": False}, **((rules.get("cath_requirement") or {}).get(w) or {})) for w in DOW[:5]}
        self.doctors = {d["name"]: d for d in rules["doctors"]}
        self.names = [d["name"] for d in rules["doctors"]]
        self.team = {n: self.doctors[n]["team"] for n in self.names}
        self.allow_chief = bool(month.get("allow_chief_duty", False))
        self.duty_names = [n for n in self.names if self.duty_allowed(n)]
        # 表示順: 名簿にない名前は無視し、表示順に無い当直候補は末尾に足す
        self.name_order = list(dict.fromkeys([n for n in (rules.get("name_order") or []) if n in self.doctors] + self.duty_names))
        self.I = [n for n in self.duty_names if self.team[n] == "I"]
        self.A = [n for n in self.duty_names if self.team[n] == "A"]
        self.Y = [n for n in self.duty_names if self.team[n] == "Y"]
        self.cathA = [n for n in self.names if self.doctors[n].get("cath") == "A"]
        self.cathI = [n for n in self.names if self.doctors[n].get("cath") == "I"]

        self.targets = {n: int(self.doctors[n]["quota"]) for n in self.names}
        for n, t in (month.get("targets") or {}).items():
            self.targets[n] = int(t)
        self.tol = int(rules.get("quota_tolerance", 1))

        self.duties = {n: (month.get("regular_duties") or {}).get(n, []) or [] for n in self.names}
        self.duty_days = month.get("duty_days") if isinstance(month.get("duty_days"), dict) else None
        self.unavail_night = {n: set(int(x) for x in v or []) for n, v in (month.get("unavailable_night") or {}).items()}
        self.unavail_other = defaultdict(set)  # (name) -> {(day, part)}
        for u in month.get("unavailable_other") or []:
            self.unavail_other[u["name"]].add((int(u["day"]), u["part"]))
        self.confirmed_pm_ext_night = {(int(x["day"]), x["name"]) for x in month.get("confirmed_pm_external_night") or []}
        # 将来変わりうる必須条件（アプリの設定タブで変更できる）
        # 規則の状態（必須 / 減点 / なし）は JS 版の rules.rule_states が正。Python 版は「必須」と「なし」だけを実装し、
        # 「減点」は未対応。黙って違う制約で解くと相互検算の意味が無くなるので、そのときは止める。
        roles = ((self.rules.get("profile") or {}).get("roles") or [])
        if roles:
            want = {"I": "charge", "A": "other", "Y": "junior", "C": "reserve"}
            got = {(r or {}).get("id"): ((r or {}).get("refs") or [None])[0] for r in roles}
            if got != want:
                raise SystemExit("Python 版は役割の識別子の変更に未対応です（JS 版で計算してください）: " + "、".join(sorted(got)))
        pos = (((self.rules.get("profile") or {}).get("positions") or {}).get("work") or {})
        cnt = pos.get("count", pos if not isinstance(pos, dict) or "count" in pos else 1)
        if cnt not in (None, 1) and cnt != {}:
            raise SystemExit("Python 版は 1 枠に複数名を置く設定に未対応です（JS 版で計算してください）")
        sh = ((self.rules.get("profile") or {}).get("shifts") or [])
        if any((x or {}).get("on") not in (None, "off_days" if (x or {}).get("id") == "day" else "all") for x in sh):
            raise SystemExit("Python 版は勤務帯の設定（profile.shifts の on）に未対応です（JS 版で計算してください）")
        if isinstance(pos, dict) and pos.get("min") is not None:
            raise SystemExit("Python 版は 1 枠の人数の幅（profile.positions.work.min）に未対応です（JS 版で計算してください）")
        if (self.rules.get("profile") or {}).get("quota_mode") == "share":
            raise SystemExit("Python 版は相対の回数目安（profile.quota_mode=share）に未対応です（JS 版で計算してください）")
        if any((x or {}).get("oncall") is False for x in sh):
            raise SystemExit("Python 版は勤務帯ごとのオンコールの付け外し（profile.shifts の oncall）に未対応です（JS 版で計算してください）")
        states = self.rules.get("rule_states") or {}
        unsupported = [k for k in ("run_length_max", "run_length_min", "shift_sequence", "days_off_min", "days_off_pair", "wish_off_cap", "composition", "shift_balance") if states.get(k, "off") != "off"]
        unsupported += [k for k in ALWAYS_ON_PY if states.get(k, "hard") == "off"]  # これらを「なし」にできるのは JS 版だけ
        if unsupported:
            raise SystemExit("Python 版は次の規則に未対応です（JS 版で計算してください）: " + "、".join(unsupported))
        if states.get("same_day_team") == "off" or states.get("oncall") == "off" or states.get("period_charge") == "off":
            pass  # 下の st(...) で個別に扱う（未対応ではない）
        soft = sorted(k for k, v in states.items() if v == "soft" and k not in SOFT_OK_PY)
        if soft:
            raise SystemExit("Python 版は次の規則の「減点」に未対応です（JS 版で計算してください）: " + "、".join(soft))
        st = lambda rid, default: states.get(rid, default)
        self.rest_day_required = st("rest_day", "hard" if self.rules.get("rest_day_required", True) is not False else "off") == "hard"
        self.pm_ext_night = self.rules.get("pm_external_night") or "confirm"
        self.same_day_IA_banned = states.get("same_day_charge_other", st("same_day_IA", "hard" if (self.rules.get("same_day_IA") or "allow") == "forbid" else "off")) == "hard"  # 規則 id は same_day_charge_other（旧 same_day_IA）
        self.same_day_team_on = st("same_day_team", "off") == "hard"  # 循環器内科のプラグインの規則。rule_states で明示したときだけ
        has_cath = bool(self.rules.get("cath_requirement")) or any((d or {}).get("cath") for d in self.rules.get("doctors") or [])
        self.cath_on = st("cath_requirement", "hard" if has_cath else "off") != "off"  # 同上。表か資格があれば既定で必須
        self.same_day_double_on = st("same_day_double", "hard") != "off"
        self.consecutive_days_on = states.get("consecutive_days", st("consecutive_work", "hard")) != "off"  # 旧 id consecutive_work（JS 側の aliases と同じ）
        self.weekend_balance_on = st("weekend_balance", "hard") != "off"
        self.friday_night_on = st("friday_night_min", "hard") != "off"
        self.same_weekday_state = st("same_weekday_cap", "soft")

        w = month.get("wishes") or {}
        self.wish_weekend_day = list(w.get("weekend_dayshift") or [])
        self.wish_night = {n: [int(x) for x in v] for n, v in (w.get("night_on") or {}).items()}
        # できれば避けたい日（調整目標）: name -> [(day, part)]。不可とは別で、勤務・OCを減点で避ける
        self.avoid = defaultdict(list)
        for u in month.get("avoid") or []:
            self.avoid[u["name"]].append((int(u.get("day", u.get("date"))), u.get("part") or "allday"))
        if self.duty_days is None:  # 曜日パターン運用: 「避：…」パターンを展開（カレンダー運用ではカレンダーの申告が正）
            seen = {(n, d, p) for n, lst in self.avoid.items() for (d, p) in lst}
            for n, pats in self.duties.items():
                for it in pats:
                    k = str(it.get("kind", ""))
                    if not k.startswith("avoid_"):
                        continue
                    part = k[6:]
                    for d in range(1, self.N + 1):
                        if DOW.index(it["dow"]) != self.dow(d):
                            continue
                        if self.is_holiday(d):  # 避パターンは平日だけ（土日祝はカレンダーで個別申告）
                            continue
                        if it.get("nth") and self.nth(d) not in [int(x) for x in it["nth"]]:
                            continue
                        if (n, d, part) not in seen:
                            self.avoid[n].append((d, part)); seen.add((n, d, part))

        f = month.get("fixed") or {}
        in_m = lambda k: 1 <= int(k) <= self.N  # 当月の日だけ（翌月1日欄の固定は next_fixed に分ける）
        self.fixed_night = {int(k): v for k, v in (f.get("night") or {}).items() if in_m(k)}
        self.fixed_day = {int(k): v for k, v in (f.get("day") or {}).items() if in_m(k)}
        self.fixed_charge = {int(k): v for k, v in (f.get("weekend_charge") or {}).items() if in_m(k)}
        self.fixed_day_oc = {int(k): list(v if isinstance(v, list) else [v]) for k, v in (f.get("day_oc") or {}).items() if in_m(k)}
        self.fixed_night_oc = {int(k): list(v if isinstance(v, list) else [v]) for k, v in (f.get("night_oc") or {}).items() if in_m(k)}
        # 固定「若手OCなし」など: その枠に指定チームのOCを追加しない（(日, 枠) → チームの集合）
        self.fixed_oc_none = {}
        for tbl, kind in (("day_oc_none", "day"), ("night_oc_none", "night")):
            for k, v in (f.get(tbl) or {}).items():
                teams = set(v if isinstance(v, list) else [v])
                if in_m(k) and teams:
                    self.fixed_oc_none[(int(k), kind)] = teams
        # 翌月1日の固定（Webアプリのカレンダーの翌月1日欄）。月末との連続禁止と月またぎの土日の主担当担当の接続に使う
        nk = self.N + 1
        g = lambda tbl: (f.get(tbl) or {}).get(nk) or (f.get(tbl) or {}).get(str(nk))
        lst = lambda v: list(v if isinstance(v, list) else [v]) if v else []
        self.next_fixed = {"day": g("day"), "night": g("night"), "charge": g("weekend_charge"), "day_oc": lst(g("day_oc")), "night_oc": lst(g("night_oc"))}
        # 固定指定の集合。固定した枠・医師については不可・連続禁止・定期業務の翌日制約などを緩める（減点付き）
        self.fixed_work_keys = set()
        self.fixed_eng_keys = set()
        for d, n in self.fixed_night.items():
            self.fixed_work_keys.add(((d, "night"), n)); self.fixed_eng_keys.add(((d, "night"), n))
        for d, n in self.fixed_day.items():
            self.fixed_work_keys.add(((d, "day"), n)); self.fixed_eng_keys.add(((d, "day"), n))
        for d, ns in self.fixed_day_oc.items():
            for n in ns: self.fixed_eng_keys.add(((d, "day"), n))
        for d, ns in self.fixed_night_oc.items():
            for n in ns: self.fixed_eng_keys.add(((d, "night"), n))
        for d, n in self.fixed_charge.items():
            self.fixed_eng_keys.add(((d, "day"), n)); self.fixed_eng_keys.add(((d, "night"), n))

        ex = month.get("exceptions") or {}
        self.weekend_max_diff = int(ex.get("weekend_balance_max_diff", rules.get("weekend_balance_max_diff", 1)))

        pm = month.get("prev_month") or {}
        self.prev_last_days = pm.get("last_days") or []
        self.prev_last_weekend_charge = pm.get("last_weekend_charge")
        self.prev_prev_weekend_charge = pm.get("prev_weekend_charge")
        h = month.get("history") or {}
        self.hist_weekend = {n: float(v) for n, v in (h.get("weekend_charge") or {}).items()}  # 分割土日は 0.5 組刻み（JS と同じ）
        self.hist_holiday = {n: int(v) for n, v in (h.get("holiday_charge") or {}).items()}

        self.weights = rules["weights"]
        self.build_calendar()

    # -- 医師 --
    def duty_allowed(self, n):
        d = self.doctors[n]
        if d.get("duty") == "never":
            return False
        if d.get("duty") == "no_unless_needed":
            return self.allow_chief
        return True

    # -- 暦 --
    def date(self, d):
        return dt.date(self.year, self.month, 1) + dt.timedelta(days=d - 1)

    def dow(self, d):
        return self.date(d).weekday()  # Mon=0

    def is_weekend(self, d):
        return self.dow(d) >= 5

    def is_holiday(self, d):
        if d < 1:
            return self.dow(d) >= 5  # 前月分は曜日だけで判定
        return self.is_weekend(d) or d in self.holidays_extra

    def nth(self, d):
        return (d - 1) // 7 + 1

    def next_is_holiday(self, d):
        return self.is_holiday(d + 1) if d + 1 <= self.N else self.next_day_is_holiday()  # 月末は翌月1日（土日も休日）

    def pre_workday_nights(self):
        """平日で、翌日も休日でない日（その夜勤が対象）"""
        return [d for d in range(1, self.N + 1) if not self.is_holiday(d) and not self.next_is_holiday(d)]

    def label(self, d):
        if d == self.N + 1:
            return self.next_label()
        s = f"{self.month}/{d}({DOW_JA[self.dow(d)]}"
        if d in self.holidays_extra:
            s += "・祝"
        return s + ")"

    def build_calendar(self):
        self.slots = []  # (d, kind) 時系列
        for d in range(1, self.N + 1):
            if self.is_holiday(d):
                self.slots.append((d, "day"))
            self.slots.append((d, "night"))
        # 前月末の仮想枠（定数）
        self.prev_fixed = {}  # (d<=0, kind) -> {"work": name, "oc": [names]}
        prev_N = (dt.date(self.year, self.month, 1) - dt.timedelta(days=1)).day
        for e in self.prev_last_days:
            off = int(e["date"]) - prev_N  # 前月末日=0
            if e.get("day"):
                self.prev_fixed[(off, "day")] = {"work": e.get("day"), "oc": list(e.get("day_oc") or [])}
            if e.get("night"):
                self.prev_fixed[(off, "night")] = {"work": e.get("night"), "oc": list(e.get("night_oc") or [])}
        self.prev_slots = sorted(self.prev_fixed.keys(), key=lambda s: (s[0], 0 if s[1] == "day" else 1))
        self.all_slots = self.prev_slots + self.slots
        self.all_slots_set = set(self.all_slots)

        # 担当期間（土日1組 / 祝日1日）
        self.periods = []
        used = set()
        for d in range(1, self.N + 1):
            if d in used:
                continue
            w = self.dow(d)
            if w == 5:
                days = [d] + ([d + 1] if d + 1 <= self.N else [])
                self.periods.append({"days": days, "kind": "weekend", "full": len(days) == 2,
                                     "crossing": len(days) == 1, "prev_days": []})
            elif w == 6:
                self.periods.append({"days": [d], "kind": "weekend", "full": False, "crossing": True,
                                     "prev_days": [0] if self.dow(0) == 5 else []})
            elif self.is_holiday(d):
                self.periods.append({"days": [d], "kind": "holiday", "full": False, "crossing": False, "prev_days": []})
            else:
                continue
            used.update(self.periods[-1]["days"])
        for i, p in enumerate(self.periods):
            p["id"] = i
            p["slots"] = [s for s in self.slots if s[0] in p["days"]]
            p["name"] = ("-".join(f"{self.month}/{x}" for x in p["days"]) if p["kind"] == "weekend"
                         else f"{self.month}/{p['days'][0]}（祝）")
            if p["crossing"] and p["prev_days"]:
                p["name"] = "前月末-" + p["name"]
        self.period_of_slot = {}
        for p in self.periods:
            for s in p["slots"]:
                self.period_of_slot[s] = p["id"]
            for pd in p["prev_days"]:
                for k in ("day", "night"):
                    self.period_of_slot[(pd, k)] = p["id"]

    # -- 定期業務 --
    def duty_items(self, n, d, part, kinds=("outpatient", "ward", "external")):
        """医師 n の日 d（当月）の時間帯 part(am/pm) に該当する定期業務"""
        if d == self.N + 1:
            return self.next_month_items(n, part, kinds)  # 翌月1日（第7節: 月末夜間担当の翌日の制限には翌月の定期業務を使う）
        if d < 1 or d > self.N:
            return []
        # 日別モード（duty_days がある月）: Webアプリのカレンダーで置いた値をそのまま使う
        if self.duty_days is not None:
            k = ((self.duty_days.get(n) or {}).get(d) or (self.duty_days.get(n) or {}).get(str(d)) or {}).get(part)
            return [{"kind": k, "part": part}] if (k and k in kinds) else []
        if self.is_holiday(d) and not self.duties_on_holidays:
            return []
        out = []
        for it in self.duties.get(n, []):
            if it["kind"] not in kinds:
                continue
            if DOW.index(it["dow"]) != self.dow(d):
                continue
            if it.get("nth") and self.nth(d) not in [int(x) for x in it["nth"]]:
                continue
            if part not in PARTS[it.get("part", "full")]:
                continue
            out.append(it)
        return out

    def busy(self, n, d, part, kinds=("outpatient", "ward", "external")):
        return bool(self.duty_items(n, d, part, kinds))

    def avoid_slots(self, n):
        """できれば避けたい日に該当する枠"""
        out = []
        for d, part in self.avoid.get(n, []):
            if d < 1 or d > self.N:
                continue
            if part != "night" and self.is_holiday(d):
                out.append((d, "day"))
            if part != "day":
                out.append((d, "night"))
        return out

    def next_month_items(self, n, part, kinds=("outpatient", "ward", "external")):
        """翌月1日の定期業務。翌月の実データは持たないので、曜日パターンを翌月の第1週として当てる（翌月1日が休日なら業務なし）"""
        # Webアプリの月データ（カレンダーを翌月1日まで伸ばした版）: カレンダーの翌月1日欄が正（空欄＝業務なし）
        if self.duty_days is not None and self.m.get("next_first_day_in_calendar"):
            nd = self.N + 1
            k = ((self.duty_days.get(n) or {}).get(nd) or (self.duty_days.get(n) or {}).get(str(nd)) or {}).get(part)
            return [{"kind": k, "part": part}] if (k and k in kinds) else []
        # 月別条件YAMLで翌月1日の業務を指定した医師（時間帯）はその指定を優先（"" は業務なし）
        ov = ((self.m.get("next_month_first_day_duties") or {}).get(n) or {})
        if part in ov and ov[part] is not None:
            return [{"kind": ov[part], "part": part}] if (ov[part] and ov[part] in kinds) else []
        if self.next_day_is_holiday() and not self.duties_on_holidays:
            return []
        w = (self.dow(self.N) + 1) % 7
        out = []
        for it in self.duties.get(n, []):
            if it["kind"] not in kinds:
                continue
            if DOW.index(it["dow"]) != w:
                continue
            if it.get("nth") and 1 not in [int(x) for x in it["nth"]]:
                continue
            if part not in PARTS[it.get("part", "full")]:
                continue
            out.append(it)
        return out

    def is_fixed_work(self, s, n):
        return (tuple(s), n) in self.fixed_work_keys

    def is_fixed_eng(self, s, n):
        return (tuple(s), n) in self.fixed_eng_keys

    def fixed_work_count(self, n):
        return sum(1 for (_, m) in self.fixed_work_keys if m == n)

    def next_day_is_holiday(self):
        return ((self.dow(self.N) + 1) % 7) >= 5 or self.next_first_holiday

    def next_first_slot_kind(self):
        return "day" if self.next_day_is_holiday() else "night"

    def next_fixed_works(self, n):
        return self.next_fixed["day"] == n or self.next_fixed["night"] == n

    def next_fixed_engaged(self, n, k):
        x = self.next_fixed
        if x["charge"] == n:
            return True
        return (x["day"] == n or n in x["day_oc"]) if k == "day" else (x["night"] == n or n in x["night_oc"])

    def next_fixed_any(self):
        x = self.next_fixed
        return bool(x["day"] or x["night"] or x["charge"] or x["day_oc"] or x["night_oc"])

    def last_crossing_period(self):
        """月末が土曜で翌月1日へ続く土日（前月側）"""
        if not self.periods:
            return None
        p = self.periods[-1]
        return p if (p["kind"] == "weekend" and p.get("crossing") and not p.get("prev_days") and self.N in p["days"]) else None

    def hist_weekend_bound(self):
        """履歴込み週末担当の上限（日換算）。整数変数の範囲に使う"""
        h = [float(v) for v in self.hist_weekend.values()]
        return int(2 * max([0.0] + h)) + 2 * len(self.periods) + 4

    def next_label(self):
        w = (self.dow(self.N) + 1) % 7
        return f"{1 if self.month == 12 else self.month + 1}/1({DOW_JA[w]})"

    def pm_ext_night_banned(self, d, n):
        """午後外勤日の夜勤・夜間OCを禁止するか（confirm=確認の記録が無ければ禁止 / forbid / allow）"""
        return self.pm_ext_night == "forbid" or (self.pm_ext_night != "allow" and (d, n) not in self.confirmed_pm_ext_night)

    def oc_none(self, s, team):
        """その枠で team の OC を置かない固定があるか"""
        return team in self.fixed_oc_none.get(tuple(s), set())

    def has_external(self, n):
        return any(self.busy(n, d, p, ("external",)) for d in range(1, self.N + 1) for p in ("am", "pm"))

    def leave(self, n, d, part):
        """時間帯付きの不可（allday / day）"""
        for (dd, pp) in self.unavail_other.get(n, ()):
            if dd == d and (pp == "allday" or (pp == "day" and part in ("am", "pm", "day"))):
                return True
        return False


# ----------------------------------------------------------------------------
# モデル
# ----------------------------------------------------------------------------
RELAXATIONS = [
    ("weekend_balance", "完全な土日の均等配分（最多−最少の許容差）"),
    ("quota", "勤務目安±1回"),
    ("cath", "カテ室責任医師の必要人数"),
    ("friday_night", "金曜夜勤の最低回数（friday_night_min）"),
    ("rest", "外勤のある医師の週休日1日以上"),
    ("duties", "定期業務との関係（翌朝外勤・翌日午後業務・午後外勤日のOC・午後外勤後の夜勤）"),
    ("fixed", "固定指定"),
    ("unavailable", "不可日"),
    ("consecutive", "連続担当の禁止"),
    ("sameday_IA", "休日の日勤と夜勤が主担当＋副担当（I+A／A+I）の組合せの禁止"),
    ("prev_connection", "前月末からの接続（月またぎの土日の主担当担当を前月の担当者にする）"),
]


def build_and_solve(P: Problem, base=None, time_limit=60, log=False, relax=frozenset(), ignore_avoid=False, avoid_ref=None, pin=None):
    from ortools.sat.python import cp_model

    W = P.weights
    M = cp_model.CpModel()
    names = P.duty_names
    slots = P.slots

    work, oc = {}, {}
    for s in slots:
        for n in names:
            work[s, n] = M.NewBoolVar(f"w_{s[0]}_{s[1]}_{n}")
            oc[s, n] = M.NewBoolVar(f"o_{s[0]}_{s[1]}_{n}")

    def Wv(s, n):  # 前月分は定数
        if s[0] < 1:
            return 1 if P.prev_fixed.get(s, {}).get("work") == n else 0
        return work.get((s, n), 0)

    def Ov(s, n):
        if s[0] < 1:
            return 1 if n in P.prev_fixed.get(s, {}).get("oc", []) else 0
        return oc.get((s, n), 0)

    def Ev(s, n):
        return Wv(s, n) + Ov(s, n)

    # 採点（pin: 割当）: 全枠の勤務・OCをその割当に固定して解くと、目的関数値がその割当の減点の合計になる（JS 版との突き合わせ用）
    if pin is not None:
        for s in slots:
            a = pin.get(f"{s[0]}:{s[1]}") or {}
            ws = a.get("work") or []
            ws = ws if isinstance(ws, list) else [ws]
            for n in names:
                M.Add(work[s, n] == (1 if n in ws else 0))
                M.Add(oc[s, n] == (1 if n in (a.get("oc") or []) else 0))

    obj = []  # 調整目標（減点）の項
    isI, isA, isY = {}, {}, {}
    for s in slots:
        M.AddExactlyOne(work[s, n] for n in names)
        isI[s] = sum(work[s, n] for n in P.I)
        isA[s] = sum(work[s, n] for n in P.A)
        isY[s] = sum(work[s, n] for n in P.Y)
        # チーム構成: I勤務→若手OC1, A勤務→主担当1+若手1, Y勤務→主担当1
        # OC 構成は規則の oncall_requirement（P.oc_req）から組む（JS と同じ表）
        isC = sum(work[s, n] for n in names if P.team[n] == "C")
        def need_of(kind):
            return sum(int((P.oc_req.get(t) or P.oc_req["C"]).get(kind, 0)) * v for t, v in (("I", isI[s]), ("A", isA[s]), ("Y", isY[s]), ("C", isC)))
        M.Add(sum(oc[s, n] for n in P.I) == need_of("I"))
        # 若手OC: I勤務→必須。A勤務→原則必須だが、置けないときは大幅減点で許容
        miss_y = M.NewBoolVar(f"missY_{s[0]}_{s[1]}")
        M.Add(sum(oc[s, n] for n in P.Y) == need_of("Y") - miss_y)
        if P.oc_none(s, "Y"):  # 固定「若手OCなし」: 若手OCを置かず、勤務者のチームに関わらず miss_y で吸収（減点）
            M.Add(sum(oc[s, n] for n in P.Y) == 0)
        else:
            M.Add(miss_y <= isA[s])
        obj.append((P.rules.get("weights") or {}).get("missing_young_oc", 3) * miss_y)
        for n in names:
            if n not in P.I and n not in P.Y:
                M.Add(oc[s, n] == 0)
            M.Add(work[s, n] + oc[s, n] <= 1)

    # 不可日
    for n in (names if "unavailable" not in relax else []):
        # 固定指定した枠・医師には不可を適用しない（固定指定が優先。検算で「固定指定により許容」として表示）
        for d in P.unavail_night.get(n, ()):
            if 1 <= d <= P.N and not P.is_fixed_eng((d, "night"), n):
                M.Add(work[(d, "night"), n] == 0)
                M.Add(oc[(d, "night"), n] == 0)
        for (d, part) in P.unavail_other.get(n, ()):
            if not (1 <= d <= P.N):
                continue
            if (d, "day") in work_slots(P) and not P.is_fixed_eng((d, "day"), n):
                M.Add(work[(d, "day"), n] == 0)
                M.Add(oc[(d, "day"), n] == 0)
            if part == "allday" and not P.is_fixed_eng((d, "night"), n):  # 前夜からの担当は除外しない（未明から不可なら前日も不可にする運用）
                M.Add(work[(d, "night"), n] == 0)
                M.Add(oc[(d, "night"), n] == 0)

    # 勤務回数 目安±1（当月目標からの乖離は目的関数）
    total = {n: sum(work[s, n] for s in slots) for n in names}
    for n in names:
        q = int(P.doctors[n]["quota"])
        if P.team[n] == "C":
            M.Add(total[n] <= 1)
            obj.append(W.get("chief_duty", 1000) * total[n])
            continue
        tol = P.tol if "quota" not in relax else 99
        M.Add(total[n] >= q - tol)
        M.Add(total[n] <= max(q + tol, P.fixed_work_count(n)))  # 固定指定で目安+1を超える場合はその数まで許す
        dev = M.NewIntVar(0, P.N + 2, f"dev_{n}")
        M.Add(dev >= total[n] - P.targets[n])
        M.Add(dev >= P.targets[n] - total[n])
        obj.append(W["target_deviation"] * dev)
        # できれば避けたい日（調整目標）: その枠の勤務・OCに減点。申告で負担が減らないよう、基準回数を下回る分に大きな減点。
        # 基準回数＝避けたい日を無視した参照解での回数（avoid_ref、solve コマンドが2段階で計算）。無ければ当月目標
        av = P.avoid_slots(n)
        if av and not ignore_avoid:
            for s in av:
                if s in P.all_slots_set:
                    obj.append(W.get("avoid_day", 30) * Ev(s, n))
            floor = (avoid_ref or {}).get(n, P.targets[n])
            down = M.NewIntVar(0, P.N + 2, f"avdn_{n}")
            M.Add(down >= floor - total[n])
            obj.append(W.get("avoid_no_reduction", 1000) * down)

    # 実勤務の連続禁止（同日、連日）
    def workday(d, n):
        return sum(Wv((d, k), n) for k in ("day", "night") if (d, k) in P.all_slots_set)
    first_prev = min([s[0] for s in P.prev_slots], default=1)
    # 連続禁止は、固定指定した枠・医師が絡む組だけ「減点付きで許容」（fixed_conflict）。それ以外は必須
    def le1(fixed_involved, expr):
        if fixed_involved:
            v = M.NewIntVar(0, 3, f"fxc_{len(obj)}")  # 超過分だけ減点（式の最大は4）
            M.Add(expr <= 1 + v)
            obj.append(W.get("fixed_conflict", 50) * v)
        else:
            M.Add(expr <= 1)

    def fx_w(d, n):
        return any(P.is_fixed_work((d, k), n) for k in ("day", "night"))

    for n in (names if "consecutive" not in relax else []):
        if P.same_day_double_on:
            for d in range(1, P.N + 1):
                if (d, "day") in P.all_slots_set:
                    le1(fx_w(d, n), work[(d, "day"), n] + work[(d, "night"), n])
        if P.consecutive_days_on:
            for d in range(max(first_prev, 0), P.N):  # 前月どうしの組は対象外（定数の式で解なしにしない）
                le1(fx_w(d, n) or fx_w(d + 1, n), workday(d, n) + workday(d + 1, n))

    # 隣接枠の連続禁止（例外: 主担当の同一期間、若手の同日兼務）
    def same_period(s1, s2):
        p1, p2 = P.period_of_slot.get(s1), P.period_of_slot.get(s2)
        return p1 is not None and p1 == p2

    # OC を含む隣接枠の連続（OC→OC、OC→勤務、勤務→OC）は減点で許容（weights.oc_consecutive。2026-09-17 に必須条件から変更）。
    # 実勤務どうしの連続は上の連日禁止で必須のまま。同じ日の中（日勤帯→夜間）と主担当医師の同じ土日・祝日は減点しない
    def pen_cons(s1, s2, n):
        v = M.NewBoolVar(f"occ_{s1[0]}_{s1[1]}_{s2[0]}_{s2[1]}_{n}")
        M.Add(Ev(s1, n) + Ev(s2, n) - 1 <= v)
        obj.append(W["oc_consecutive"] * v)
    for s1, s2 in zip(P.all_slots, P.all_slots[1:]):
        if s2[0] < 1 or s1[0] == s2[0]:
            continue
        for n in names:
            if P.team[n] == "I" and same_period(s1, s2):
                continue
            pen_cons(s1, s2, n)
    # 非主担当の連続する夜間担当（間に休日の日勤枠がある組。日勤枠が無い組は上で減点済み）
    for n in names:
        if P.team[n] == "I":
            continue
        for d in range(max(first_prev, 0), P.N):
            if (d, "night") in P.all_slots_set and (d + 1, "day") in P.all_slots_set:
                pen_cons((d, "night"), (d + 1, "night"), n)

    # 週末・祝日の主担当担当: 日ごとに1名。土日は原則同一人で、均等配分のためだけに土曜・日曜の分割を認める
    cday, chargedP, split = {}, {}, {}
    for p in P.periods:
        for d in p["days"]:
            for n in P.I:
                cday[d, n] = M.NewBoolVar(f"c_{d}_{n}")
                for s in p["slots"]:
                    if s[0] == d:
                        M.Add(Ev(s, n) == cday[d, n])
            M.AddExactlyOne(cday[d, n] for n in P.I)
        if p["kind"] == "weekend" and p["full"]:
            d1, d2 = p["days"]
            split[p["id"]] = M.NewBoolVar(f"split_{p['id']}")
            for n in P.I:
                M.Add(cday[d1, n] - cday[d2, n] <= split[p["id"]])
                M.Add(cday[d2, n] - cday[d1, n] <= split[p["id"]])
            obj.append(W.get("split_weekend", 60) * split[p["id"]])
        for n in P.I:
            chargedP[p["id"], n] = M.NewBoolVar(f"cp_{p['id']}_{n}")
            for d in p["days"]:
                M.Add(chargedP[p["id"], n] >= cday[d, n])
            M.Add(chargedP[p["id"], n] <= sum(cday[d, n] for d in p["days"]))
        for d, n in P.fixed_charge.items():
            if d in p["days"] and "fixed" not in relax:  # 診断で固定指定を外すときは主担当担当の固定も外す（JS と同じ）
                M.Add(cday[d, n] == 1)
    # 月またぎの土日: 前月末（土曜）の主担当担当者が翌月1日（日曜）も担当する
    if "prev_connection" not in relax:
        for p in P.periods:
            if not p["prev_days"]:
                continue
            prev_i = [n for n in P.I if any(Wv((pd, k), n) == 1 or Ov((pd, k), n) == 1 for pd in p["prev_days"] for k in ("day", "night"))]
            if len(prev_i) == 1:
                M.Add(cday[p["days"][0], prev_i[0]] == 1)
    # 完全な土日の均等配分（担当日数で比較。土日1組=2日、許容差は組数×2）
    full_days = {n: sum(cday[d, n] for p in P.periods if p["kind"] == "weekend" and p["full"] for d in p["days"]) for n in P.I}
    if any(p["kind"] == "weekend" and p["full"] for p in P.periods) and "weekend_balance" not in relax:
        for a in P.I:
            for b in P.I:
                if a != b and P.weekend_balance_on:
                    M.Add(full_days[a] - full_days[b] <= 2 * P.weekend_max_diff)

    # 固定指定
    if "fixed" not in relax:
        # 存在しない枠・候補外の医師への固定は無視する（JS と同じ。検算で「固定指定と不一致」として出る）
        for d, n in P.fixed_night.items():
            if ((d, "night"), n) in work:
                M.Add(work[(d, "night"), n] == 1)
        for d, n in P.fixed_day.items():
            if ((d, "day"), n) in work:
                M.Add(work[(d, "day"), n] == 1)
        for d, ns in P.fixed_day_oc.items():
            for n in ns:
                if ((d, "day"), n) in oc:
                    M.Add(oc[(d, "day"), n] == 1)
        for d, ns in P.fixed_night_oc.items():
            for n in ns:
                if ((d, "night"), n) in oc:
                    M.Add(oc[(d, "night"), n] == 1)
        # 翌月1日の固定指定: 月末との連続禁止（連日の実勤務・隣接枠・非主担当の連続夜間）と月またぎの土日の主担当担当の接続
        if P.next_fixed_any():
            N, first_k, cross = P.N, P.next_first_slot_kind(), P.last_crossing_period()
            # 月末の枠もその医師で固定されているとき（長い連休で主担当担当を2日連続にする等）は、連続を減点付きで許容（fixed_conflict）
            def le0(fixed_involved, expr):
                if fixed_involved:
                    v = M.NewIntVar(0, 3, f"fxc_{len(obj)}")
                    M.Add(expr <= v)
                    obj.append(W.get("fixed_conflict", 50) * v)
                else:
                    M.Add(expr <= 0)
            # 月末の日勤・夜勤どちらかの固定でも「固定が絡む」とみなす（休日の主担当医師は日勤に入れば同日の夜間にも主担当担当として入るため）
            def fx_n(n):
                return P.is_fixed_eng((N, "day"), n) or P.is_fixed_eng((N, "night"), n)
            for n in names:
                if P.next_fixed_works(n):
                    le0(fx_n(n), workday(N, n))
                if P.next_fixed_engaged(n, first_k) and (N, "night") in P.all_slots_set:
                    if P.team[n] == "I" and cross and first_k == "day":
                        if not P.next_fixed["charge"]:  # 主担当担当の固定があればそれを優先（下で1本だけ張る）
                            M.Add(cday[N, n] == 1)
                    else:
                        obj.append(W["oc_consecutive"] * Ev((N, "night"), n))  # OC を含む連続は減点（実勤務どうしは上の workday で必須）
                if P.team[n] != "I" and first_k == "day" and P.next_fixed_engaged(n, "night") and (N, "night") in P.all_slots_set:
                    obj.append(W["oc_consecutive"] * Ev((N, "night"), n))
            if cross and P.next_fixed["charge"] and (N, P.next_fixed["charge"]) in cday:
                M.Add(cday[N, P.next_fixed["charge"]] == 1)

    # 同じ曜日の勤務は月 max_same_weekday_shifts 回まで
    mx_dow = P.rules.get("max_same_weekday_shifts") if P.same_weekday_state != "off" else None
    if mx_dow:
        for n in names:
            for w in range(7):
                ex = M.NewIntVar(0, 10, f"dowex_{n}_{w}")
                M.Add(ex >= sum(work[s, n] for s in slots if P.dow(s[0]) == w) - int(mx_dow))
                obj.append(W.get("same_weekday_excess", 0) * ex)

    # 金曜夜勤 月1回以上 等（friday_night_min: 最低回数。上限は付けない）
    for n, k in (P.rules.get("friday_night_min") or {}).items():
        if n not in names:  # 当直候補でない医師の指定はソルバーも無視する
            continue
        if n in names and P.friday_night_on and "friday_night" not in relax:
            M.Add(sum(work[(d, "night"), n] for d in range(1, P.N + 1) if P.dow(d) == 4) >= int(k))

    # 定期業務（第7節）
    for n in (names if "duties" not in relax else []):
        for d in range(1, P.N + 1):
            nd = d + 1  # 月末は翌月1日（曜日パターンからの推定）を翌日として判定する
            if nd <= P.N + 1:
                ext_am = P.busy(n, nd, "am", ("external",))
                ext_pm = P.busy(n, nd, "pm", ("external",))
                pm_full = P.busy(n, nd, "pm")  # 午後または終日の外来・病棟番・外勤
                if (ext_am or ext_pm or pm_full) and not P.is_fixed_work((d, "night"), n):  # 固定指定した枠は適用しない
                    M.Add(work[(d, "night"), n] == 0)
                if ext_am and not P.is_fixed_eng((d, "night"), n):
                    M.Add(oc[(d, "night"), n] == 0)
            # 午後外勤日のOC禁止・同日夜勤
            if P.busy(n, d, "pm", ("external",)):  # 午後外勤日: 日勤OCは不可。夜勤・夜間OCは規則 pm_external_night（confirm / forbid / allow。固定指定した枠は適用しない）
                if (d, "day") in P.all_slots_set and not P.is_fixed_eng((d, "day"), n):
                    M.Add(oc[(d, "day"), n] == 0)
                if P.pm_ext_night_banned(d, n):
                    if not P.is_fixed_eng((d, "night"), n):
                        M.Add(oc[(d, "night"), n] == 0)
                    if not P.is_fixed_work((d, "night"), n):
                        M.Add(work[(d, "night"), n] == 0)

    # カテ室責任医師の必要人数（平日）
    req = P.cath_req
    excl_post = bool(P.rules.get("exclude_post_night_from_cath", True))
    clinic_cand = P.rules.get("pm_clinic_arrhythmia_candidates") or []

    def avail_expr(group, d, half, excl_post_here):
        terms = []
        for n in group:
            if P.busy(n, d, half, ("outpatient", "ward", "external", "absent")) or P.leave(n, d, half):
                continue
            post = Wv((d - 1, "night"), n) if excl_post_here else 0
            terms.append(1 - post)
        return sum(terms) if terms else 0

    for d in (range(1, P.N + 1) if ("cath" not in relax and P.cath_on) else []):
        if P.is_holiday(d):
            continue
        r = req[DOW[P.dow(d)]]
        off_A, off_I = d in P.cath_off_A, d in P.cath_off_I  # カテ室配置不要の日（副担当／主担当）
        for half in ("am", "pm"):
            for grp, need, off in ((P.cathA, int(r[f"A_{half}"]), off_A), (P.cathI, int(r.get("I", 1)), off_I)):
                if off:
                    continue
                if half == "pm" or not excl_post:
                    M.Add(avail_expr(grp, d, half, excl_post) >= need)  # 午後: 夜勤明けは除外（必須）
                else:
                    # 午前: 夜勤明けも人数に数えてよい（必須）が、数えて初めて足りる分は減点
                    M.Add(avail_expr(grp, d, half, False) >= need)
                    sh = M.NewIntVar(0, 10, f"cpn_{d}_{half}_{'A' if grp is P.cathA else 'I'}")
                    M.Add(sh >= need - avail_expr(grp, d, half, True))
                    obj.append((P.rules.get("weights") or {}).get("cath_post_night", 30) * sh)
        if r.get("pm_clinic"):  # 副担当が配置不要でも外来の担当1名は確保
            M.Add(avail_expr(sorted(set(P.cathA) | set(clinic_cand)), d, "pm", excl_post) >= (0 if off_A else int(r["A_pm"])) + 1)
            M.Add(avail_expr(P.Y, d, "pm", excl_post) >= 1)

    # 週休日: 外勤のある医師は最低1日
    rest_terms = {}
    for n in names:
        t = [work[(d, "day"), n] for d in range(1, P.N + 1) if (d, "day") in P.all_slots_set]
        t += [work[(d, "night"), n] for d in range(1, P.N + 1)
              if P.next_is_holiday(d)]
        rest_terms[n] = t
        if P.rest_day_required and P.has_external(n) and "rest" not in relax:
            M.Add(sum(t) >= 1)

    # 同日集約（第5節）
    for p in P.periods:
        for d in p["days"]:
            sd, sn = (d, "day"), (d, "night")
            if sd not in P.all_slots_set:
                continue
            if P.same_day_IA_banned and "sameday_IA" not in relax:  # I+A / A+I は規則 same_day_IA（forbid=採用しない）
                M.Add(isI[sd] + isA[sn] <= 1)
                M.Add(isA[sd] + isI[sn] <= 1)
            if not P.same_day_team_on:  # 規則 same_day_team（勤務者が1名でチーム構成がある施設の規則）
                continue
            vaa = M.NewBoolVar(f"aa_{d}")
            M.Add(isA[sd] + isA[sn] - 1 <= vaa)  # A+A は軽い減点
            obj.append(W.get("same_day_other_both", W.get("same_day_AA", 0)) * vaa)  # 旧名 same_day_AA
            # 休日の若手OCは日勤帯と夜間で同じ人にまとめる（young_oc_split: 両方に若手OCがあって別人のとき減点）
            d_y = sum(oc[sd, n] for n in P.Y)
            n_y = sum(oc[sn, n] for n in P.Y)
            same = []
            for n in P.Y:
                u = M.NewBoolVar(f"ysame_{d}_{n}")
                M.Add(u <= oc[sd, n]); M.Add(u <= oc[sn, n]); same.append(u)
            vs = M.NewBoolVar(f"ysplit_{d}")
            M.Add(d_y + n_y - 1 - sum(same) <= vs)
            obj.append(W.get("young_oc_split", 4) * vs)  # プラグインの規則の sub の重み。無ければ既定
            # I+Y / Y+I（必須）と A+Y / Y+A（原則）: 同日集約。この日の枠 sd/sn に対して（2026-09-23: 字下げの誤りで別の繰り返しの中にあり、最後の休日の枠にしか効いていなかったのを直した）
            for n in P.Y:
                # I+Y / Y+I: 必須
                M.Add(work[sn, n] + isI[sd] - 1 <= oc[sd, n])
                M.Add(work[sd, n] + isI[sn] - 1 <= oc[sn, n])
                # A+Y / Y+A: 原則適用（未適用は目的関数）
                v1 = M.NewBoolVar(f"ay1_{d}_{n}")
                M.Add(work[sn, n] + isA[sd] - 1 - oc[sd, n] <= v1)
                v2 = M.NewBoolVar(f"ay2_{d}_{n}")
                M.Add(work[sd, n] + isA[sn] - 1 - oc[sn, n] <= v2)
                obj.append(W.get("same_day_other_junior", W.get("same_day_AY", 0)) * (v1 + v2))  # 旧名 same_day_AY
    # 当番に入る人数（調整目標）: 1人・1日あたり weights.staff_per_day。同じ人が同日の複数役割を兼ねれば1人。無駄な人員配置を避け、A+Y の同日集約などを優先する
    for d in range(1, P.N + 1):
        for n in names:
            terms = [Ev((d, k), n) for k in ("day", "night") if (d, k) in P.all_slots_set]
            if not terms:
                continue
            v = M.NewBoolVar(f"staff_{d}_{n}")
            for t in terms:
                M.Add(t <= v)
            obj.append(W["staff_per_day"] * v)

    # ---- 調整目標 ----
    for n, days in P.wish_night.items():
        for d in days:
            if n in names and ((d, "night"), n) in work:
                obj.append(W["wish_night"] * (1 - work[(d, "night"), n]))
    wk_days = [d for d in range(1, P.N + 1) if P.is_weekend(d)]
    for n in set(P.wish_weekend_day) | set(P.rules.get("weekend_dayshift_wish") or []):
        if n not in names:
            continue
        has = M.NewBoolVar(f"wkday_{n}")
        M.Add(has <= sum(work[(d, "day"), n] for d in wk_days))
        obj.append(W["wish_weekend_dayshift"] * (1 - has))
    # 副担当責任医師: 翌日が休日でない平日の夜勤に原則配置しない
    mode = {"hard": "forbid", "soft": "avoid", "off": "allow"}[(P.rules.get("rule_states") or {}).get(
        "arrhythmia_pre_workday_night", {"forbid": "hard", "allow": "off"}.get(P.rules.get("arrhythmia_pre_workday_night", "avoid"), "soft"))]
    for n in P.rules.get("arrhythmia_responsible_night") or []:
        if n not in names:
            continue
        for d in P.pre_workday_nights():
            if mode == "forbid":
                if not P.is_fixed_work((d, "night"), n):
                    M.Add(work[(d, "night"), n] == 0)
            elif mode == "avoid":
                obj.append(W["arrhythmia_pre_workday_night"] * work[(d, "night"), n])
    # 連続する週末
    wps = [p for p in P.periods if p["kind"] == "weekend"]
    prev_c = P.prev_prev_weekend_charge if (wps and wps[0]["crossing"] and wps[0]["prev_days"]) else P.prev_last_weekend_charge
    for i, p in enumerate(wps):
        for n in P.I:
            prev_term = chargedP[wps[i - 1]["id"], n] if i > 0 else (1 if prev_c == n else 0)
            v = M.NewBoolVar(f"cw_{p['id']}_{n}")
            M.Add(prev_term + chargedP[p["id"], n] - 1 <= v)
            obj.append(W["consecutive_weekend"] * v)
    # 履歴込みの週末担当数の偏り（土日1組=2日換算。月またぎの土日は1組として2日分）
    tot_w = {n: int(round(2 * P.hist_weekend.get(n, 0))) + full_days[n]
             + 2 * sum(chargedP[p["id"], n] for p in wps if not p["full"]) for n in P.I}
    wb = P.hist_weekend_bound()  # 上限はデータから決める（固定値だと履歴の累積で解なしになる）
    mx, mn = M.NewIntVar(0, wb, "wmax"), M.NewIntVar(0, wb, "wmin")
    for n in P.I:
        M.Add(mx >= tot_w[n])
        M.Add(mn <= tot_w[n])
    obj.append(W["weekend_history_spread"] * (mx - mn))
    # 週末担当者の日勤
    for p in P.periods:
        for n in P.I:
            v = M.NewBoolVar(f"cd_{p['id']}_{n}")
            M.Add(chargedP[p["id"], n] - sum(work[s, n] for s in p["slots"] if s[1] == "day") <= v)
            obj.append(W["charge_without_dayshift"] * v)
    # 夜間OC翌日の通常業務 / 夜勤翌日午前業務（月末は翌月1日を翌日とする）
    for n in names:
        for d in range(1, P.N + 1):
            nd = d + 1
            if P.busy(n, nd, "am") or P.busy(n, nd, "pm"):
                obj.append(W["night_oc_then_duty"] * oc[(d, "night"), n])
            if P.busy(n, nd, "am") and not P.busy(n, nd, "pm"):
                obj.append(W["night_then_am_duty"] * work[(d, "night"), n])
    # 隣接しない連日の当番（非主担当）
    for n in names:
        if P.team[n] == "I":
            continue
        for d in range(1, P.N):
            e1 = sum(Ev((d, k), n) for k in ("day", "night") if (d, k) in P.all_slots_set)
            e2 = sum(Ev((d + 1, k), n) for k in ("day", "night") if (d + 1, k) in P.all_slots_set)
            v = M.NewBoolVar(f"cc_{d}_{n}")
            b1 = M.NewBoolVar(f"b1_{d}_{n}")
            b2 = M.NewBoolVar(f"b2_{d}_{n}")
            M.Add(e1 >= 1).OnlyEnforceIf(b1)
            M.Add(e1 == 0).OnlyEnforceIf(b1.Not())
            M.Add(e2 >= 1).OnlyEnforceIf(b2)
            M.Add(e2 == 0).OnlyEnforceIf(b2.Not())
            M.Add(b1 + b2 - 1 <= v)
            obj.append(W["nonadjacent_consecutive"] * v)
    # 勤務の間隔（調整目標）: 同じ医師の実勤務が中1日・中2日で続く組に減点（中3日以上は減点なし）。前月末の勤務（定数）と翌月1日の固定も相手に含める
    for n in names:
        if P.team[n] == "C":
            continue
        def wd(d, n=n):
            if d > P.N:
                return 1 if P.next_fixed_works(n) else 0
            return workday(d, n)
        def prev_worked(d, n=n):
            return any(Wv((d, k), n) == 1 for k in ("day", "night") if (d, k) in P.all_slots_set)
        for gap, w in ((2, W["work_gap_1"]), (3, W["work_gap_2"])):
            for d in range(first_prev, P.N + 2 - gap):
                if d < 1 and (d + gap < 1 or not prev_worked(d)):
                    continue
                if d + gap > P.N and not P.next_fixed_works(n):
                    continue
                v = M.NewIntVar(0, 3, f"gap{gap}_{d}_{n}")  # 固定指定で同日に日勤＋夜勤があると式が3になるので整数
                M.Add(wd(d) + wd(d + gap) - 1 <= v)
                obj.append(w * v)
    # 偏り
    def spread(vals, key):
        a, b = M.NewIntVar(0, 100, f"{key}_max"), M.NewIntVar(0, 100, f"{key}_min")
        for v in vals:
            M.Add(a >= v)
            M.Add(b <= v)
        return a - b
    obj.append(W["spread_I_nightoc"] * spread([sum(oc[(d, "night"), n] for d in range(1, P.N + 1)) for n in P.I], "inoc"))
    obj.append(W["spread_Y_oc"] * spread([sum(oc[s, n] for s in slots) for n in P.Y], "yoc"))
    obj.append(W["spread_Y_holiday_work"] * spread([sum(work[s, n] for s in slots if P.is_holiday(s[0])) for n in P.Y], "yhol"))
    # 既存案からの変更量
    if base:
        for s in slots:
            key = f"{s[0]}:{s[1]}"
            b = base.get(key)
            if not b:
                continue
            for n in names:
                obj.append(W["base_change"] * ((1 - work[s, n]) if b.get("work") == n else work[s, n]))
                obj.append(W["base_change"] * ((1 - oc[s, n]) if n in b.get("oc", []) else oc[s, n]))

    M.Minimize(sum(obj))
    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = float(time_limit)
    solver.parameters.num_workers = 8
    solver.parameters.log_search_progress = log
    st = solver.Solve(M)
    status = solver.StatusName(st)
    if st not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        return status, None, None
    asg = {}
    for s in slots:
        asg[f"{s[0]}:{s[1]}"] = {
            "work": next(n for n in names if solver.Value(work[s, n])),
            "oc": [n for n in names if solver.Value(oc[s, n])],
        }
    return status, asg, solver.ObjectiveValue()


def work_slots(P):
    return set(P.slots)


def diagnose(P: Problem, time_limit=30):
    """解なしのとき、必須条件を1つずつ外して解けるか試し、衝突している条件を報告する"""
    lines = []
    for key, label in RELAXATIONS:
        st, asg, _ = build_and_solve(P, time_limit=time_limit, relax=frozenset({key}))
        if asg is not None:
            note = ""
            if key == "weekend_balance":
                A = Asg(P, asg)
                _, charge = check(P, asg)
                fw = full_weekend_units(P, charge)
                note = f"（この条件を外した解の完全な土日の担当（組）: {fmt_half(fw)}、差 {(max(fw.values())-min(fw.values()))/2:g}）"
            lines.append(f"- 「{label}」を外すと解あり{note}")
    if not lines:
        lines.append("- 単一の条件を外しても解なし。複数の条件が同時に衝突している（不可日・固定指定・カテ室条件を見直す）")
    return lines


# ----------------------------------------------------------------------------
# 独立した検算（ソルバーの符号化とは別に、割当をルール文に照らす）
# ----------------------------------------------------------------------------
class Asg:
    """割当: key "d:kind" -> {work, oc}. 前月末の定数も取り込む"""

    def __init__(self, P: Problem, asg: dict):
        self.P = P
        self.a = {}
        for s, v in P.prev_fixed.items():
            self.a[s] = {"work": v["work"], "oc": list(v.get("oc") or [])}
        for k, v in asg.items():
            d, kind = k.split(":")
            self.a[(int(d), kind)] = {"work": v["work"], "oc": list(v.get("oc") or [])}

    def work(self, s):
        return self.a.get(s, {}).get("work")

    def oc(self, s):
        return self.a.get(s, {}).get("oc", [])

    def engaged(self, s):
        v = self.a.get(s)
        if not v:
            return set()
        return set([v["work"]] + v["oc"]) - {None}

    def worked(self, n, s):
        return self.work(s) == n

    def eng(self, n, s):
        return n in self.engaged(s)


def check(P: Problem, asg: dict):
    A = Asg(P, asg)
    V = []
    T = P.team
    names = P.duty_names
    lab = P.label

    def slab(s):
        return f"{lab(s[0]) if s[0] >= 1 else '前月'+str(s)}{'日勤' if s[1]=='day' else '夜勤'}"

    # 1 充足とチーム構成
    for s in P.slots:
        w = A.work(s)
        if w not in names:
            V.append(f"{slab(s)}: 勤務者が不正（{w}）")
            continue
        ocs = A.oc(s)
        need = P.oc_req.get(T[w]) or P.oc_req["C"]
        cnt = {"I": sum(1 for n in ocs if T.get(n) == "I"), "Y": sum(1 for n in ocs if T.get(n) == "Y")}
        # A勤務で若手OCが置けない（Y=0）は必須違反ではなく減点（第9節に出す）
        young_miss_allowed = (T[w] == "A" or P.oc_none(s, "Y")) and cnt["Y"] == 0 and cnt["I"] == need["I"] and len(ocs) == cnt["I"]
        if not young_miss_allowed and (cnt["I"] != need["I"] or cnt["Y"] != need["Y"] or len(ocs) != cnt["I"] + cnt["Y"]):
            V.append(f"{slab(s)}: OC構成不一致 勤務者{w}({T[w]}) OC={ocs}")
        if w in ocs:
            V.append(f"{slab(s)}: 勤務者{w}がOCを兼ねている")
        for n in ocs:
            if T.get(n) in ("A", "C"):
                V.append(f"{slab(s)}: {n} はOC対象外")
    # 2 不可
    for n in names:
        for d in P.unavail_night.get(n, ()):
            if 1 <= d <= P.N and A.eng(n, (d, "night")):
                V.append(f"{lab(d)}: {n} は夜間不可だが夜間担当")
        for (d, part) in P.unavail_other.get(n, ()):
            if A.eng(n, (d, "day")):
                V.append(f"{lab(d)}: {n} は{part}不可だが日勤帯担当")
            if part == "allday" and A.eng(n, (d, "night")):
                V.append(f"{lab(d)}: {n} は終日不可だが当夜に担当")
    # 3 回数
    for n in P.names:
        tot = sum(1 for s in P.slots if A.worked(n, s))
        q = int(P.doctors[n]["quota"])
        if T[n] == "C":
            if tot and (P.doctors[n].get("duty") == "never" or not P.allow_chief):
                V.append(f"{n}: 部長が勤務に配置されている（{tot}回）")
            continue
        fc = P.fixed_work_count(n)
        ub = max(q + P.tol, fc)  # 固定指定で目安+1を超える分は許容（固定指定により許容として表示）
        if tot < q - P.tol or tot > ub:
            V.append(f"{n}: 勤務{tot}回が目安{q}±{P.tol}の範囲外")
        elif tot > q + P.tol:
            V.append(f"{n}: 勤務{tot}回が目安{q}±{P.tol}を超える（固定指定 {fc} 件のため）")
    # 4 実勤務の連続
    first_prev = min([s[0] for s in P.prev_slots], default=1)
    for n in names:
        for d in range(first_prev, P.N + 1):
            if P.same_day_double_on and A.worked(n, (d, "day")) and A.worked(n, (d, "night")):
                V.append(f"{lab(d)}: {n} 同日の日勤＋夜勤")
            if P.consecutive_days_on and d < P.N and any(A.worked(n, (d, k)) for k in ("day", "night")) and any(A.worked(n, (d + 1, k)) for k in ("day", "night")):
                V.append(f"{lab(max(d,1))}→翌日: {n} 連日の実勤務")
    # 5 隣接枠の連続
    # 5 隣接枠の連続: OC を含む連続は 2026-09-17 から減点（oc_consecutive）。実勤務どうしの連続は 4 で検出済み
    # 翌月1日の固定指定（カレンダーの翌月1日欄）との連続・接続
    if P.next_fixed_any():
        N, first_k, cross, nl = P.N, P.next_first_slot_kind(), P.last_crossing_period(), lab(P.N + 1)
        for n in names:
            if P.next_fixed_works(n) and any(A.worked(n, (N, k)) for k in ("day", "night") if (N, k) in P.all_slots_set):
                V.append(f"{lab(N)}→{nl}: {n} 連日の実勤務（翌月1日の固定）")
        if cross:
            cd = [n for n in P.I if any(A.eng(n, (N, k)) for k in ("day", "night") if (N, k) in P.all_slots_set)]
            want = P.next_fixed["charge"] or next((n for n in P.I if P.next_fixed_engaged(n, "day")), None)
            if want and len(cd) == 1 and cd[0] != want:
                V.append(f"{cross['name']}: 翌月1日の固定 {want} と月末の主担当担当 {cd[0]} が接続していない")
    # 6 主担当担当（日ごとに1名。土日の分割は減点付きで常に候補）
    charge = {}  # period id -> {day: name}
    for p in P.periods:
        cd = {}
        for d in p["days"]:
            cs = set()
            for s in p["slots"]:
                if s[0] != d:
                    continue
                e = {n for n in A.engaged(s) if T.get(n) == "I"}
                if len(e) != 1:
                    V.append(f"{slab(s)}: 主担当医師の担当が1名でない")
                cs |= e
            if len(cs) != 1:
                V.append(f"{lab(d)}: 主担当担当が日勤・夜勤を通して1名でない {sorted(cs)}")
            cd[d] = sorted(cs)[0] if len(cs) == 1 else None
        charge[p["id"]] = cd
        first = cd.get(p["days"][0])
        prev_i = sorted({n for pd in p["prev_days"] for k in ("day", "night") for n in A.engaged((pd, k)) if T.get(n) == "I"})
        if len(prev_i) == 1 and first and first != prev_i[0]:  # 前月末に主担当医師が2名いる入力はソルバーも接続しない（lint 相当の警告で知らせる）
            V.append(f"{p['name']}: 前月末の主担当担当{prev_i[0]}と接続していない")
        for d, n in P.fixed_charge.items():
            if d in p["days"] and cd.get(d) != n:
                V.append(f"{lab(d)}: 固定指定の主担当担当{n}と不一致")
    fw = full_weekend_units(P, charge)
    if P.weekend_balance_on and fw and max(fw.values()) - min(fw.values()) > 2 * P.weekend_max_diff:
        V.append(f"完全な土日の担当（組）の差が{P.weekend_max_diff}を超える: {fmt_half(fw)}")
    # 7 固定・金曜
    for d, n in P.fixed_night.items():
        if A.work((d, "night")) != n:
            V.append(f"{lab(d)}夜勤: 固定指定{n}と不一致")
    for d, n in P.fixed_day.items():
        if A.work((d, "day")) != n:
            V.append(f"{lab(d)}日勤: 固定指定{n}と不一致")
    for d, ns in P.fixed_day_oc.items():
        for n in ns:
            if n not in A.oc((d, "day")):
                V.append(f"{lab(d)}日勤OC: 固定指定{n}と不一致")
    for d, ns in P.fixed_night_oc.items():
        for n in ns:
            if n not in A.oc((d, "night")):
                V.append(f"{lab(d)}夜間OC: 固定指定{n}と不一致")
    for n, k in (P.rules.get("friday_night_min") or {}).items():
        c = sum(1 for d in range(1, P.N + 1) if P.dow(d) == 4 and A.worked(n, (d, "night")))
        if c < int(k):
            V.append(f"{n}: 金曜夜勤{c}回（月{k}回以上の指定）")
    # 7b 副担当責任医師の平日夜勤（forbid のときだけ必須条件）
    if P.rules.get("arrhythmia_pre_workday_night", "avoid") == "forbid":
        for n in P.rules.get("arrhythmia_responsible_night") or []:
            for d in P.pre_workday_nights():
                if A.worked(n, (d, "night")):
                    V.append(f"{lab(d)}夜勤: {n} 副担当責任医師の翌日が休日でない平日夜勤（禁止設定）")
    # 8 定期業務
    for n in names:
        for d in range(1, P.N + 1):
            nd = d + 1  # 月末は翌月1日を翌日として判定
            if nd <= P.N + 1:
                if A.worked(n, (d, "night")) and (P.busy(n, nd, "am", ("external",)) or P.busy(n, nd, "pm")):
                    V.append(f"{lab(d)}夜勤: {n} 翌日に外勤または午後・終日の業務")
                if n in A.oc((d, "night")) and P.busy(n, nd, "am", ("external",)):
                    V.append(f"{lab(d)}夜間OC: {n} 翌朝に外勤")
            if P.busy(n, d, "pm", ("external",)):
                if n in A.oc((d, "day")):
                    V.append(f"{lab(d)}: {n} 午後外勤日に日勤OC")
                if n in A.oc((d, "night")) and P.pm_ext_night_banned(d, n):
                    V.append(f"{lab(d)}: {n} 午後外勤後の夜間OC（{'禁止設定' if P.pm_ext_night == 'forbid' else '未確認'}）")
                if A.worked(n, (d, "night")) and P.pm_ext_night_banned(d, n):
                    V.append(f"{lab(d)}: {n} 午後外勤後の夜勤（{'禁止設定' if P.pm_ext_night == 'forbid' else '未確認'}）")
    # 9 カテ室
    cath = cath_table(P, A) if P.cath_on else []
    for row in cath:
        for msg in row["ng"]:
            V.append(f"{row['label']}: {msg}")
    # 10 週休日
    rest = rest_days(P, A)
    for n in names:
        if P.rest_day_required and P.has_external(n) and not rest[n]:
            V.append(f"{n}: 外勤があるのに週休日が発生しない")
    # 11 同日集約
    for p in P.periods:
        for d in p["days"]:
            sd, sn = (d, "day"), (d, "night")
            if sd not in A.a:
                continue
            wd, wn = A.work(sd), A.work(sn)
            td, tn = T.get(wd), T.get(wn)
            if P.same_day_IA_banned and {td, tn} == {"I", "A"}:
                V.append(f"{lab(d)}: {td}+{tn} の組合せ（採用しない）")
            if P.same_day_team_on:
                if td == "I" and tn == "Y" and wn not in A.oc(sd):
                    V.append(f"{lab(d)}: I+Y だが若手夜勤者{wn}が日勤帯の若手OCでない")
                if td == "Y" and tn == "I" and wd not in A.oc(sn):
                    V.append(f"{lab(d)}: Y+I だが若手日勤者{wd}が夜間の若手OCでない")
    return V, charge


def cath_table(P: Problem, A: Asg):
    req = P.cath_req
    excl_post = bool(P.rules.get("exclude_post_night_from_cath", True))
    clinic_cand = P.rules.get("pm_clinic_arrhythmia_candidates") or []
    rows = []
    for d in range(1, P.N + 1):
        if P.is_holiday(d):
            continue
        r = req[DOW[P.dow(d)]]
        off_A, off_I = d in P.cath_off_A, d in P.cath_off_I
        post = A.work((d - 1, "night"))
        nightoc = A.oc((d - 1, "night"))
        for half in ("am", "pm"):
            def av(group):
                ok, ex, strict = [], [], []
                for n in group:
                    its = P.duty_items(n, d, half, ("outpatient", "ward", "external", "absent"))
                    if its:
                        ex.append(f"{n}({'/'.join(kind_ja(i['kind']) for i in its)})")
                    elif P.leave(n, d, half):
                        ex.append(f"{n}(不可)")
                    elif excl_post and post == n:
                        if half == "am":
                            ok.append(f"{n}(夜勤明け)")  # 午前は候補に数えてよい（数えて初めて足りる場合は減点対象）
                        else:
                            ex.append(f"{n}(夜勤明け)")
                    else:
                        ok.append(n + ("*" if n in nightoc else ""))
                        strict.append(n)
                return ok, ex, strict
            okA, exA, stA = av(P.cathA)
            okI, exI, stI = av(P.cathI)
            ng = []
            needA = 0 if off_A else int(r[f"A_{half}"])
            needI = 0 if off_I else int(r.get("I", 1))
            if len(okA) < needA:
                ng.append(f"副担当責任医師 {len(okA)}人 < 必要{needA}")
            if len(okI) < needI:
                ng.append(f"主担当責任医師 {len(okI)}人 < 必要{needI}")
            post_used = half == "am" and not ng and (len(stA) < needA or len(stI) < needI)
            row = {"label": f"{P.label(d)} {'午前' if half=='am' else '午後'}", "d": d, "half": half,
                   "needA": needA, "okA": okA, "exA": exA, "okI": okI, "exI": exI, "ng": ng, "post_used": post_used, "off_A": off_A, "off_I": off_I, "clinic": None}
            if half == "pm" and r.get("pm_clinic"):
                okC, exC, _ = av(sorted(set(P.cathA) | set(clinic_cand)))
                okY, exY, _ = av(P.Y)
                if len(okC) < needA + 1:
                    ng.append(f"ペースメーカー外来: 副担当担当医の候補 {len(okC)}人 < カテ室{needA}+外来1")
                if len(okY) < 1:
                    ng.append("ペースメーカー外来: 若手の候補なし")
                row["clinic"] = {"okC": okC, "exC": exC, "okY": okY, "exY": exY}
            rows.append(row)
    return rows


def kind_ja(k):
    return {"outpatient": "外来", "ward": "病棟番", "external": "外勤", "absent": "不在"}.get(k, k)


def rest_days(P: Problem, A: Asg):
    out = {n: [] for n in P.names}
    for d in range(1, P.N + 1):
        if P.is_holiday(d):
            w = A.work((d, "day"))
            if w:
                out[w].append(f"{P.month}/{d}日勤")
        nh = P.next_is_holiday(d)
        if nh:
            w = A.work((d, "night"))
            if w:
                out[w].append(f"{P.month}/{d}夜勤(翌日休日)")
    return out


def metrics(P: Problem, A: Asg, charge):
    T = P.team
    rows = {}
    for n in P.names:
        day = sum(1 for s in P.slots if s[1] == "day" and A.worked(n, s))
        night = sum(1 for s in P.slots if s[1] == "night" and A.worked(n, s))
        doc = sum(1 for s in P.slots if s[1] == "day" and n in A.oc(s))
        noc = sum(1 for s in P.slots if s[1] == "night" and n in A.oc(s))
        days = sorted({s[0] for s in P.slots if A.eng(n, s)})
        hdays = [d for d in days if P.is_holiday(d)]
        wk = [p for p in P.periods if p["kind"] == "weekend" and any(A.eng(n, s) for s in p["slots"])]
        dual = sum(1 for d in range(1, P.N + 1) if (d, "day") in A.a and
                   ((A.worked(n, (d, "day")) and n in A.oc((d, "night"))) or (n in A.oc((d, "day")) and A.worked(n, (d, "night")))))
        rows[n] = {"quota": P.doctors[n]["quota"], "target": P.targets[n], "day": day, "night": night, "total": day + night,
                   "dayoc": doc, "nightoc": noc, "days": days, "ndays": len(days), "hdays": len(hdays),
                   "weekends": len(wk), "weekends_crossing": sum(1 for p in wk if p["crossing"]), "dual": dual}
    rest = rest_days(P, A)
    for n in P.names:
        rows[n]["rest"] = rest[n]
    return rows


# ----------------------------------------------------------------------------
# 報告書（Markdown）
# ----------------------------------------------------------------------------
def split_fixed_warnings(P: Problem, V):
    """固定指定した枠・医師に関わる違反を「固定指定により許容（要確認）」に分ける（固定指定との不一致そのものは違反のまま）"""
    by_day = {}
    for (s, n) in P.fixed_eng_keys:
        by_day.setdefault(s[0], set()).add(n)
    V2, Wf = [], []
    for v in V:
        moved = False
        if "固定指定" not in v or "件のため" in v:
            for d, ns in by_day.items():
                if any(n in v for n in ns) and (P.label(d) in v or ("翌" in v and d > 1 and P.label(d - 1) in v)):
                    Wf.append(v); moved = True; break
        if not moved:
            V2.append(v)
    return V2, Wf


def report(P: Problem, asg: dict, status: str, objective, base_label="", avoid_ref=None):
    A = Asg(P, asg)
    V, charge = check(P, asg)
    V, Wf = split_fixed_warnings(P, V)
    met = metrics(P, A, charge)
    T = P.team
    L = []
    L.append(f"# {P.year}年{P.month}月 当直表 ソルバー結果")
    L.append("")
    L.append(f"- 生成: {now_jst():%Y-%m-%d %H:%M}　共通ルール {P.rules.get('rules_version')}　ソルバー状態: {status}（目的関数値 {objective}）")
    L.append(f"- 必要枠: 平日夜勤{sum(1 for d in range(1,P.N+1) if not P.is_holiday(d))}、休日日勤{sum(1 for d in range(1,P.N+1) if P.is_holiday(d))}、休日夜勤{sum(1 for d in range(1,P.N+1) if P.is_holiday(d))}、計{len(P.slots)}枠。目安合計{sum(int(P.doctors[n]['quota']) for n in P.duty_names)}")
    if base_label:
        L.append(f"- 既存案: {base_label}（変更量を目的関数に含めた）")
    L.append("")
    L.append("## 1 必須条件の検算")
    L.append("")
    if V:
        L.append(f"**違反 {len(V)} 件**")
        L.extend(f"- {v}" for v in V)
    else:
        L.append("違反なし（全枠の充足とチーム構成、不可日、実勤務の連続、隣接枠の連続、月またぎ、主担当担当、固定指定、金曜夜勤、定期業務、カテ室責任医師、週休日、同日集約）")
    if Wf:
        L.append("")
        L.append(f"**固定指定により許容した条件 {len(Wf)} 件（要確認。固定指定を優先し、次の条件は満たしていない）**")
        L.extend(f"- {v}" for v in Wf)
    L.append("")
    L.append("## 2 当直表")
    L.append("")
    L.append("| 日付 | 日勤 | 日勤OC | 夜勤 | 夜間OC | 不可申告（夜間） |")
    L.append("| --- | --- | --- | --- | --- | --- |")
    for d in range(1, P.N + 1):
        un = "・".join(n for n in P.duty_names if d in P.unavail_night.get(n, ()))
        if P.is_holiday(d):
            L.append(f"| {P.label(d)} | {A.work((d,'day'))} | {'・'.join(A.oc((d,'day')))} | {A.work((d,'night'))} | {'・'.join(A.oc((d,'night')))} | {un} |")
        else:
            L.append(f"| {P.label(d)} | ― | ― | {A.work((d,'night'))} | {'・'.join(A.oc((d,'night')))} | {un} |")
    L.append("")
    L.append("## 3 個人別集計（第9節）")
    L.append("")
    L.append("| 医師 | 目安 | 当月目標 | 日勤 | 夜勤 | 計 | 日勤OC | 夜間OC | 当番開始日数 | 休日当番日数 | 当番のある週末数 | 同日兼務日数 | 週休日発生数 |")
    L.append("| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |")
    for n in P.name_order:
        m = met[n]
        wk = f"{m['weekends']}" + (f"（うち月またぎ{m['weekends_crossing']}）" if m["weekends_crossing"] else "")
        L.append(f"| {n} | {m['quota']} | {m['target']} | {m['day']} | {m['night']} | {m['total']} | {m['dayoc']} | {m['nightoc']} | {m['ndays']} | {m['hdays']} | {wk} | {m['dual']} | {len(m['rest'])} |")
    L.append("")
    L.append("### 当番開始日")
    L.append("")
    L.append("| 医師 | 当番開始日 |")
    L.append("| --- | --- |")
    for n in P.name_order:
        L.append(f"| {n} | {'、'.join(f'{P.month}/{d}' for d in met[n]['days'])} |")
    L.append("")
    L.append("## 4 週末・祝日の主担当担当")
    L.append("")
    L.append("| 期間 | 区分 | 主担当担当 | 日勤 |")
    L.append("| --- | --- | --- | --- |")
    for p in P.periods:
        kind = "完全な土日" if (p["kind"] == "weekend" and p["full"]) else ("月またぎ土日" if p["kind"] == "weekend" else "祝日")
        cd = charge[p["id"]]
        ds = "、".join(f"{P.month}/{s[0]}" for s in p["slots"] if s[1] == "day" and A.work(s) == cd.get(s[0]))
        L.append(f"| {p['name']} | {kind} | {charge_label(P, p, cd)} | {ds or 'なし'} |")
    fw = full_weekend_units(P, charge)
    allw = {n: fw[n] + 2 * sum(1 for p in P.periods if p['kind'] == 'weekend' and not p['full'] and n in charge[p['id']].values()) for n in P.I}
    hc = {n: sum(1 for p in P.periods if p['kind'] == 'holiday' and n in charge[p['id']].values()) for n in P.I}
    splits = [p["name"] for p in P.periods if p["kind"] == "weekend" and p["full"] and len({v for v in charge[p["id"]].values() if v}) > 1]
    L.append("")
    L.append(f"- 完全な土日の担当（組。分割は0.5）: {fmt_half(fw)}（最多−最少 {(max(fw.values())-min(fw.values()))/2 if fw else 0:g}、許容差 {P.weekend_max_diff}）")
    L.append(f"- 分割した土日: {'、'.join(splits) if splits else 'なし'}（分割は減点 {(P.rules.get('weights') or {}).get('split_weekend', 60)}。均等配分に必要なときだけ）")
    L.append(f"- 月またぎを含む土日担当（土曜日の日付で1組）: {fmt_half(allw)}")
    L.append(f"- 前月までの履歴込み: {fmt_half({n: 2*P.hist_weekend.get(n,0)+allw[n] for n in P.I})}（履歴 {fmt(P.hist_weekend)}）")
    L.append(f"- 祝日の担当: {fmt(hc)}（履歴 {fmt(P.hist_holiday)}）")
    # 連続週末
    wps = [p for p in P.periods if p["kind"] == "weekend"]
    prev_c = P.prev_prev_weekend_charge if (wps and wps[0]['crossing'] and wps[0]['prev_days']) else P.prev_last_weekend_charge
    seq = [({prev_c} if prev_c else set(), "前月")]
    seq += [({v for v in charge[p["id"]].values() if v}, p["name"]) for p in wps]
    cons = [f"{a[1]}→{b[1]} {'・'.join(sorted(a[0] & b[0]))}" for a, b in zip(seq, seq[1:]) if a[0] & b[0]]
    L.append(f"- 連続する週末担当: {'、'.join(cons) if cons else 'なし'}")
    L.append("")
    L.append("## 5 同日集約の対象一覧（全土日祝、昼夜両方向）")
    L.append("")
    L.append("| 日付 | 日勤者 | 夜勤者 | 組合せ | 適用結果 |")
    L.append("| --- | --- | --- | --- | --- |")
    for d in range(1, P.N + 1):
        if not P.is_holiday(d):
            continue
        wd, wn = A.work((d, "day")), A.work((d, "night"))
        td, tn = T[wd], T[wn]
        combo = f"{td}+{tn}"
        if tn == "Y" and td in ("I", "A"):
            res = f"若手夜勤者{wn}が日勤帯の若手OC（適用）" if wn in A.oc((d, "day")) else f"別担当（日勤帯若手OC={'・'.join(x for x in A.oc((d,'day')) if T[x]=='Y')}）"
        elif td == "Y" and tn in ("I", "A"):
            res = f"若手日勤者{wd}が夜間の若手OC（適用）" if wd in A.oc((d, "night")) else f"別担当（夜間若手OC={'・'.join(x for x in A.oc((d,'night')) if T[x]=='Y')}）"
        elif td == "A" and tn == "A":
            res = f"若手OCを日勤・夜間に各1名（{'・'.join(x for x in A.oc((d,'day')) if T[x]=='Y')} / {'・'.join(x for x in A.oc((d,'night')) if T[x]=='Y')}）"
        elif td == "Y" and tn == "Y":
            res = "若手OC不要（主担当OCのみ）"
        else:
            res = "対象外"
        L.append(f"| {P.label(d)} | {wd}（{td}） | {wn}（{tn}） | {combo} | {res} |")
    L.append("")
    L.append("## 6 週休日（第8節: 休日の日勤＋休日前日の夜勤）")
    L.append("")
    L.append("| 医師 | 週休日発生数 | 対象勤務日 | 外勤あり |")
    L.append("| --- | ---: | --- | --- |")
    for n in P.name_order:
        L.append(f"| {n} | {len(met[n]['rest'])} | {'、'.join(met[n]['rest']) or '―'} | {'○' if P.has_external(n) else ''} |")
    L.append("")
    L.append("## 7 定期業務との重なり（残る負担）")
    L.append("")
    notes = []
    for n in P.duty_names:
        for d in range(1, P.N + 1):
            nd = d + 1
            its = [f"{'午前' if h=='am' else '午後'}{kind_ja(i['kind'])}" for h in ("am", "pm") for i in P.duty_items(n, nd, h)]
            if not its:
                continue
            if n in A.oc((d, "night")):
                notes.append(f"| {P.label(d)} 夜間OC | {n} | 翌{P.label(nd)} {'・'.join(dict.fromkeys(its))} |")
            if A.worked(n, (d, "night")):
                notes.append(f"| {P.label(d)} 夜勤 | {n} | 翌{P.label(nd)} {'・'.join(dict.fromkeys(its))}（午前のみ） |")
    if notes:
        L.append("| 担当 | 医師 | 翌日の業務 |")
        L.append("| --- | --- | --- |")
        L.extend(notes)
    else:
        L.append("なし")
    L.append("")
    L.append("## 8 カテ室責任医師の時間帯別配置（平日）")
    L.append("")
    L.append("候補＝資格者から外来・病棟番・外勤・不在・不可を除いた医師。夜勤明けは午前だけ候補に含める（数えて初めて足りる時間帯は減点）。午後は除外。`*` は前夜の夜間OC（呼出し後の代替を確認）。実際の配置は当月条件で確定させる。")
    L.append("")
    L.append("| 日付 | 時間帯 | 副担当 必要 | 副担当 候補 | 副担当 除外 | 主担当 候補 | 主担当 除外 | 専門外来 候補（副担当の資格者 / 若手） | 判定 |")
    L.append("| --- | --- | ---: | --- | --- | --- | --- | --- | --- |")
    for r in (cath_table(P, A) if P.cath_on else []):
        cl = f"{'・'.join(r['clinic']['okC'])} / {'・'.join(r['clinic']['okY'])}" if r["clinic"] else ""
        L.append(f"| {r['label'].split(' ')[0]} | {r['label'].split(' ')[1]} | {r['needA']} | {'・'.join(r['okA'])} | {'、'.join(r['exA'])} | {'・'.join(r['okI'])} | {'、'.join(r['exI'])} | {cl} | {'**不足**: '+'; '.join(r['ng']) if r['ng'] else ('配置不要（設定）' if r.get('off_A') and r.get('off_I') else '副担当は配置不要（設定）' if r.get('off_A') else '主担当は配置不要（設定）' if r.get('off_I') else '充足（夜勤明けを含む・減点）' if r.get('post_used') else '充足')} |")
    L.append("")
    L.append("## 9 調整目標の達成状況")
    L.append("")
    soft = []
    for n, days in P.wish_night.items():
        for d in days:
            soft.append(f"- {n} の{P.label(d)}当直希望: {'反映' if A.worked(n,(d,'night')) else '未反映'}")
    my = [f"{P.label(s[0])}{'日勤' if s[1] == 'day' else '夜勤'}（{A.work(s)}）" for s in P.slots if T[A.work(s)] == "A" and not any(T.get(n) == "Y" for n in A.oc(s))]
    soft.append(f"- 副担当医師の勤務で若手OCを置けなかった枠（減点 missing_young_oc）: {'、'.join(my) if my else 'なし'}")
    for n in P.duty_names:
        av = P.avoid_slots(n)
        if not av:
            continue
        hit = [f"{P.label(s[0])}{'日勤' if s[1] == 'day' else '夜勤'}" for s in av if A.eng(n, s)]
        tot = sum(1 for s in P.slots if A.worked(n, s))
        ref = (avoid_ref or {}).get(n)
        note = ("。参照解を下回る＝他の必須条件のため" if (ref is not None and tot < ref) else "。目標未満＝他の必須条件のため" if (ref is None and tot < P.targets[n]) else "")
        soft.append(f"- {n} のできれば避けたい日（{len(av)}枠）: {'配置あり ' + '、'.join(hit) if hit else 'すべて回避'}。勤務{tot}回（当月目標{P.targets[n]}回{f'、避けたい日を無視した参照解では{ref}回' if ref is not None else ''}{note}）")
    for n in dict.fromkeys(list(P.wish_weekend_day) + list(P.rules.get("weekend_dayshift_wish") or [])):
        ds = [f"{P.month}/{d}" for d in range(1, P.N + 1) if P.is_weekend(d) and A.worked(n, (d, "day"))]
        soft.append(f"- {n} の土日日勤: {'反映（'+'、'.join(ds)+'）' if ds else '未反映'}")
    pw = set(P.pre_workday_nights())
    for n in P.rules.get("arrhythmia_responsible_night") or []:
        ds = [f"{P.label(d)}" for d in range(1, P.N + 1) if d in pw and A.worked(n, (d, "night"))]
        soft.append(f"- {n} の翌日が休日でない平日夜勤（原則配置しない）: {'、'.join(ds) if ds else 'なし'}")
    lines = []
    lo = min([s[0] for s in P.prev_slots], default=1)
    for n in P.duty_names:
        cc = []
        for s1, s2 in zip(P.all_slots, P.all_slots[1:]):
            if s2[0] < 1 or s1[0] == s2[0] or not (A.eng(n, s1) and A.eng(n, s2)):
                continue
            p1, p2 = P.period_of_slot.get(s1), P.period_of_slot.get(s2)
            if T[n] == "I" and p1 is not None and p1 == p2:
                continue
            cc.append(f"{P.label(s1[0])}{'日勤帯' if s1[1] == 'day' else '夜間'}→{P.label(s2[0])}{'日勤帯' if s2[1] == 'day' else '夜間'}")
        if T[n] != "I":
            for d in range(lo, P.N):
                if (d + 1, "day") in A.a and A.eng(n, (d, "night")) and A.eng(n, (d + 1, "night")):
                    cc.append(f"{P.label(d)}夜間→{P.label(d + 1)}夜間")
        if cc:
            lines.append(f"{n}: {'、'.join(cc)}")
    soft.append(f"- OC を含む隣接枠の連続（減点 oc_consecutive。同日の日勤帯→夜間は除く）: {'／'.join(lines) if lines else 'なし'}")
    for n in P.duty_names:
        if T[n] == "I":
            continue
        cc = [f"{P.month}/{d}-{d+1}" for d in range(1, P.N) if any(A.eng(n, (d, k)) for k in ("day", "night")) and any(A.eng(n, (d + 1, k)) for k in ("day", "night"))]
        if cc:
            soft.append(f"- {n} の隣接しない連日の当番: {'、'.join(cc)}")
    for n in P.duty_names:
        lo = min([s[0] for s in P.prev_slots], default=1)
        def wk(d, n=n):
            if d > P.N:
                return P.next_fixed_works(n)
            return any(A.worked(n, (d, k)) for k in ("day", "night") if (d, k) in P.all_slots_set)
        g1 = [f"{P.label(d)}→{P.label(d + 2)}" for d in range(lo, P.N + 1) if wk(d) and d + 2 <= P.N + 1 and wk(d + 2)]
        g2 = [f"{P.label(d)}→{P.label(d + 3)}" for d in range(lo, P.N + 1) if wk(d) and d + 3 <= P.N + 1 and wk(d + 3)]
        if g1 or g2:
            parts = [x for x in ["中1日 " + "、".join(g1) if g1 else "", "中2日 " + "、".join(g2) if g2 else ""] if x]
            soft.append(f"- {n} の勤務間隔が短い組（減点対象）: {'／'.join(parts)}")
    aa = [P.label(d) for d in range(1, P.N + 1) if P.is_holiday(d) and T[A.work((d, "day"))] == "A" and T[A.work((d, "night"))] == "A"]
    soft.append(f"- 休日の A+A の日: {'、'.join(aa) if aa else 'なし'}")
    sp = []
    for d in range(1, P.N + 1):
        if (d, "day") not in A.a:
            continue
        yd = [n for n in A.oc((d, "day")) if T.get(n) == "Y"]; yn = [n for n in A.oc((d, "night")) if T.get(n) == "Y"]
        if yd and yn and not set(yd) & set(yn):
            sp.append(f"{P.label(d)}（日勤帯 {'・'.join(yd)}／夜間 {'・'.join(yn)}）")
    soft.append(f"- 休日の若手OCが日勤帯と夜間で別人の日（減点 young_oc_split）: {'、'.join(sp) if sp else 'なし'}")
    ia = [P.label(d) for d in range(1, P.N + 1) if P.is_holiday(d) and {T.get(A.work((d, "day"))), T.get(A.work((d, "night")))} == {"I", "A"}]
    soft.append(f"- 休日の I+A／A+I の日: {'、'.join(ia) if ia else 'なし'}")
    staff = sum(len({n for k in ("day", "night") if (d, k) in P.all_slots_set for n in [A.work((d, k))] + list(A.oc((d, k)))}) for d in range(1, P.N + 1))
    soft.append(f"- 当番に入った延べ人数（1人・1日を1と数える）: {staff}")
    for n in P.duty_names:
        cnt = defaultdict(int)
        for s in P.slots:
            if A.worked(n, s):
                cnt[P.dow(s[0])] += 1
        mx_dow = int(P.rules.get("max_same_weekday_shifts") or 99)
        over = [f"{DOW_JA[w]}曜{c}回" for w, c in sorted(cnt.items()) if c > mx_dow]
        if over:
            soft.append(f"- {n} の同じ曜日の勤務が{mx_dow}回を超過: {'、'.join(over)}")
    for n in P.duty_names:
        if met[n]["total"] != P.targets[n]:
            soft.append(f"- {n} の勤務回数 {met[n]['total']}（当月目標 {P.targets[n]}）")
    L.extend(soft or ["- 特記なし"])
    L.append("")
    L.append("## 10 月末の接続（翌月へ）")
    L.append("")
    for d in range(max(1, P.N - 1), P.N + 1):
        if P.is_holiday(d):
            L.append(f"- {P.label(d)}: 日勤 {A.work((d,'day'))}（OC {'・'.join(A.oc((d,'day')))}）、夜勤 {A.work((d,'night'))}（OC {'・'.join(A.oc((d,'night')))}）")
        else:
            L.append(f"- {P.label(d)}: 夜勤 {A.work((d,'night'))}（OC {'・'.join(A.oc((d,'night')))}）")
    last = P.periods[-1] if P.periods else None
    if last and last["kind"] == "weekend" and last["crossing"] and not last["prev_days"]:
        L.append(f"- 月またぎの土日 {last['name']}: 主担当担当 {charge_label(P, last, charge[last['id']])}（翌月1日へ接続）")
    L.append(f"- 翌月初日の定期業務: {'翌月条件で要確認' }")
    return "\n".join(L) + "\n", V


def fmt(d):
    return "、".join(f"{k}{v}" for k, v in d.items())


def fmt_half(d):
    """日数（土日1組=2）を組数で表示"""
    return "、".join(f"{k}{v/2:g}" for k, v in d.items())


def full_weekend_units(P, charge):
    """完全な土日の担当日数（分割は1日=0.5組）"""
    return {n: sum(1 for p in P.periods if p["kind"] == "weekend" and p["full"] for d in p["days"] if charge[p["id"]].get(d) == n) for n in P.I}


def charged_periods(P, charge, n):
    return [p for p in P.periods if n in charge[p["id"]].values()]


def charge_label(P, p, cd):
    vals = [cd.get(d) for d in p["days"]]
    if len(set(vals)) == 1:
        return vals[0] or "―"
    return "／".join(f"{DOW_JA[P.dow(d)]} {cd.get(d)}" for d in p["days"]) + "（分割）"


def now_jst():
    """コンテナ内（UTC）でも日本時間で記録する"""
    from zoneinfo import ZoneInfo
    return dt.datetime.now(ZoneInfo("Asia/Tokyo"))


# ----------------------------------------------------------------------------
# docx 入出力
# ----------------------------------------------------------------------------
def parse_docx(P: Problem, path):
    import docx
    doc = docx.Document(path)
    t = doc.tables[0]
    rows = [[c.text.strip() for c in r.cells] for r in t.rows]
    asg = {}
    i = 1
    while i + 3 < len(rows):
        dates, dayr, nightr, ocr = rows[i], rows[i + 1], rows[i + 2], rows[i + 3]
        for col in range(1, 8):
            cell = dates[col]
            if not cell:
                continue
            d = int(cell.split("/")[-1])
            night = nightr[col]
            day = dayr[col]
            occell = ocr[col].replace("／", "/")
            if "/" in occell:
                doc_oc, noc = occell.split("/", 1)
            else:
                doc_oc, noc = ("", occell) if not day else (occell, "")
            split = lambda s: [x for x in s.replace(",", "・").replace("、", "・").split("・") if x]
            if day:
                asg[f"{d}:day"] = {"work": day, "oc": split(doc_oc)}
            if night:
                asg[f"{d}:night"] = {"work": night, "oc": split(noc)}
        i += 9
    return asg


def set_cell_text(cell, text):
    """書式を保つため最初の run に文字を入れ、残りを空にする"""
    paras = cell.paragraphs
    for pi, p in enumerate(paras):
        for ri, r in enumerate(p.runs):
            r.text = text if (pi == 0 and ri == 0) else ""
    if not paras or not paras[0].runs:
        (paras[0] if paras else cell.add_paragraph()).add_run(text)


FILL_SUN, FILL_SAT, FILL_WEEKDAY = "F7CAAC", "BDD6EE", "FFFFFF"


def set_shading(cell, fill):
    from docx.oxml import OxmlElement
    from docx.oxml.ns import qn
    tcPr = cell._tc.get_or_add_tcPr()
    shd = tcPr.find(qn("w:shd"))
    if shd is None:
        shd = OxmlElement("w:shd")
        tcPr.append(shd)
    shd.set(qn("w:val"), "clear")
    shd.set(qn("w:color"), "auto")
    shd.set(qn("w:fill"), fill)


def write_docx(P: Problem, asg: dict, template, out, label="確認版"):
    import docx
    A = Asg(P, asg)
    doc = docx.Document(template)
    t = doc.tables[0]
    rest = rest_days(P, A)
    # 表題
    p0 = doc.paragraphs[0]
    today = now_jst().date()
    title = f"{P.year}年{P.month}月　夜勤・日勤・振替休日・緊急カテ表 {today.year}.{today.month}/{today.day}　{label}　　"
    for ri, r in enumerate(p0.runs):
        r.text = title if ri == 0 else ""
    # 枠外の週休日数
    order = P.name_order
    if len(doc.paragraphs) >= 3:
        for ri, r in enumerate(doc.paragraphs[1].runs):
            r.text = ("週休日数　" + "　".join(order)) if ri == 0 else ""
        nums = "　　　　　　" + "　　".join(str(len(rest[n])).translate(str.maketrans("0123456789", "０１２３４５６７８９")) for n in order)
        for ri, r in enumerate(doc.paragraphs[2].runs):
            r.text = nums if ri == 0 else ""
    # 表: 週ブロック（日付, 日勤, 夜勤, 緊カテ当番, ダメ日, ...）×9行
    first_col = (P.dow(1) + 1) % 7  # 列0=日曜
    week = 0
    col = first_col
    # 週ブロック数を当月に合わせる（不足なら最後のブロックを複製、余れば削除。表を低く保つ）
    need = (first_col + P.N + 6) // 7
    have = (len(t.rows) - 1) // 9
    if have < 1:
        raise SystemExit("テンプレートに週ブロックがありません")
    while have < need:
        last = t.rows[1 + 9 * (have - 1):1 + 9 * have]
        for r in last:
            t._tbl.append(copy.deepcopy(r._tr))
        have += 1
    while have > need:
        for r in t.rows[1 + 9 * (have - 1):1 + 9 * have]:
            t._tbl.remove(r._tr)
        have -= 1
    # まず全セルを空にし、塗りを平日色に戻す（テンプレート月の祝日色を消す）
    for r in t.rows[1:]:
        for c in r.cells[1:]:
            set_cell_text(c, "")
            set_shading(c, FILL_WEEKDAY)
    abbr = {n: n[0] for n in P.names}
    for d in range(1, P.N + 1):
        base = 1 + 9 * week
        if base + 4 >= len(t.rows):
            raise SystemExit("テンプレートの行数が足りません")
        set_cell_text(t.rows[base].cells[col + 1], f"{P.month}/{d}" if d == 1 else str(d))
        fill = FILL_SUN if (P.dow(d) == 6 or d in P.holidays_extra) else (FILL_SAT if P.dow(d) == 5 else FILL_WEEKDAY)
        for rr in range(base, min(base + 9, len(t.rows))):
            set_shading(t.rows[rr].cells[col + 1], fill)
        if P.is_holiday(d):
            set_cell_text(t.rows[base + 1].cells[col + 1], A.work((d, "day")))
            occ = "・".join(A.oc((d, "day"))) + "/" + "・".join(A.oc((d, "night")))
        else:
            occ = "・".join(A.oc((d, "night")))
        set_cell_text(t.rows[base + 2].cells[col + 1], A.work((d, "night")))
        set_cell_text(t.rows[base + 3].cells[col + 1], occ)
        # ダメ日: 3人までは「・」区切り、4人以上は詰めて1行に収める（前月表の慣例）
        una = [abbr[n] for n in P.duty_names if d in P.unavail_night.get(n, ())]
        un = "・".join(una) if len(una) <= 3 else "".join(una)
        set_cell_text(t.rows[base + 4].cells[col + 1], un)
        col += 1
        if col == 7:
            col = 0
            week += 1
    doc.save(out)


# ----------------------------------------------------------------------------
def load(args):
    here = os.path.dirname(os.path.abspath(__file__))
    rules_path = args.rules or os.path.join(here, "rules.yaml")
    with open(rules_path, encoding="utf-8") as f:
        rules = yaml.safe_load(f)
    with open(args.month, encoding="utf-8") as f:
        month = yaml.safe_load(f)
    # Web アプリの保存データ（{rules, month, result, saved_at}）をそのまま渡せる。--rules が無ければ保存データ側の規則を使う（同じ条件で検算するため）
    if isinstance(month, dict) and isinstance(month.get("month"), dict) and month.get("rules"):
        if not args.rules:
            rules = month["rules"]
        month = month["month"]
    return Problem(rules, month)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("solve")
    s.add_argument("month")
    s.add_argument("--rules")
    s.add_argument("--base", help="既存案の割当JSON（変更量を最小化）")
    s.add_argument("--base-docx", help="既存案の当直表docx（変更量を最小化）")
    s.add_argument("--out", help="出力先ディレクトリ（既定: 月別条件と同じ）")
    s.add_argument("--time", type=float, default=60)
    s.add_argument("--base-weight", type=int, help="既存案からの変更1箇所あたりの重み（既定は rules.yaml の base_change。20以上で最小変更に近づく）")
    s.add_argument("--log", action="store_true")
    c = sub.add_parser("check")
    c.add_argument("month")
    c.add_argument("--rules")
    c.add_argument("--docx")
    c.add_argument("--json")
    c.add_argument("--out")
    sc = sub.add_parser("score", help="割当を固定して減点の合計を出す（JS 版との突き合わせ用。避けたい日の基準回数は当月目標）")
    sc.add_argument("month")
    sc.add_argument("--rules")
    sc.add_argument("--json", required=True)
    sc.add_argument("--time", type=float, default=60)
    w = sub.add_parser("docx")
    w.add_argument("month")
    w.add_argument("--rules")
    w.add_argument("--json", required=True)
    w.add_argument("--template", required=True)
    w.add_argument("--out", required=True)
    w.add_argument("--label", default="確認版")
    args = ap.parse_args()
    P = load(args)
    tag = f"{P.year}{P.month:02d}"
    outdir = args.out if getattr(args, "out", None) and os.path.isdir(args.out) else os.path.dirname(os.path.abspath(args.month))

    if args.cmd == "solve":
        base, base_label = None, ""
        if args.base:
            base = json.load(open(args.base, encoding="utf-8"))
            base_label = args.base
        elif args.base_docx:
            base = parse_docx(P, args.base_docx)
            base_label = args.base_docx
        if base and args.base_weight is not None:
            P.weights = dict(P.weights, base_change=args.base_weight)
        # 避けたい日の参照解方式: 避けたい日を無視した参照解での申告者の回数を基準回数にする
        avoid_ref = None
        declarers = [n for n in P.duty_names if P.avoid_slots(n) and P.team[n] != "C"]
        if declarers:
            _, asg0, _ = build_and_solve(P, base=base, time_limit=args.time, ignore_avoid=True)
            if asg0 is not None:
                avoid_ref = {n: sum(1 for v in asg0.values() if v.get("work") == n) for n in declarers}
                print("参照解（避けたい日を無視）: " + "、".join(f"{n} {c}回" for n, c in avoid_ref.items()) + "。本計算ではこの回数を基準にする")
        status, asg, obj = build_and_solve(P, base=base, time_limit=args.time, log=args.log, avoid_ref=avoid_ref)
        if asg is None:
            print(f"解なし: {status}。必須条件が両立しない。衝突している条件を診断する（各30秒）…")
            for line in diagnose(P):
                print(line)
            print("対応: 作成責任者の承認を得たうえで、月別条件YAMLの exceptions / fixed / confirmed_pm_external_night 等を修正して再実行する")
            sys.exit(2)
        md, V = report(P, asg, status, obj, base_label, avoid_ref=avoid_ref)
        jpath = os.path.join(outdir, f"{tag}_py_assignment.json")
        mpath = os.path.join(outdir, f"{tag}_py_result.md")
        json.dump(asg, open(jpath, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
        open(mpath, "w", encoding="utf-8").write(md)
        print(f"状態 {status}、目的関数 {obj}、必須条件の違反 {len(V)} 件")
        print(f"割当: {jpath}\n報告: {mpath}")
        for v in V:
            print("  違反:", v)
    elif args.cmd == "check":
        if args.docx:
            asg = parse_docx(P, args.docx)
            src = args.docx
        else:
            asg = json.load(open(args.json, encoding="utf-8"))
            src = args.json
        missing = [f"{s[0]}:{s[1]}" for s in P.slots if f"{s[0]}:{s[1]}" not in asg]
        if missing:
            print("割当のない枠:", missing)
        md, V = report(P, asg, "check", "-", src)
        mpath = args.out if args.out and not os.path.isdir(args.out) else os.path.join(outdir, f"{tag}_py_check.md")
        open(mpath, "w", encoding="utf-8").write(md)
        print(f"検算: 必須条件の違反 {len(V)} 件 → {mpath}")
        for v in V:
            print("  違反:", v)
    elif args.cmd == "score":
        asg = json.load(open(args.json, encoding="utf-8"))
        status, _, obj = build_and_solve(P, time_limit=args.time, pin=asg)
        print(f"採点: 状態 {status}、減点の合計 {obj}")
        if status != "OPTIMAL":
            sys.exit(2)
    elif args.cmd == "docx":
        asg = json.load(open(args.json, encoding="utf-8"))
        write_docx(P, asg, args.template, args.out, args.label)
        back = parse_docx(P, args.out)
        diff = [k for k in asg if back.get(k) != asg[k]]
        print(f"書き出し: {args.out}（読み戻し不一致 {len(diff)} 枠）")
        for k in diff:
            print("  ", k, asg[k], "→", back.get(k))


if __name__ == "__main__":
    main()

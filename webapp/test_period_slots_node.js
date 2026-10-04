// Period charge applies to actual shift slots. All people and settings below are fictional.
// node test_period_slots_node.js <path/to/highs>
const fs = require("fs"), vm = require("vm"), path = require("path"), assert = require("assert/strict");
globalThis.T = {};
for (const f of ["i18n.js", "rules-core.js", "model.js", "messages.js", "solver.js", "check.js"]) vm.runInThisContext(fs.readFileSync(path.join(__dirname, "src", f), "utf8"), { filename: f });
for (const f of fs.readdirSync(path.join(__dirname, "src/rules")).filter(f => f.endsWith(".js")).sort()) vm.runInThisContext(fs.readFileSync(path.join(__dirname, "src/rules", f), "utf8"), { filename: `rules/${f}` });
const names = ["Synthetic Alpha", "Synthetic Beta"], clone = x => JSON.parse(JSON.stringify(x));
function rulesOf(day = "none", night = "weekdays", balance = "off", chargeMembers = true) {
  const r = {
    profile: { id: "synthetic-period-slots", roles: [{ id: "I", label: "Charge", refs: ["charge"], standby: false }, { id: "S", label: "Staff", standby: false }],
      shifts: [{ id: "day", on: day }, { id: "night", on: night }], positions: { work: { count: 1 } } },
    doctors: names.map(name => ({ name, team: chargeMembers ? "I" : "S", quota: 0, years: 1 })), name_order: names.slice(),
    rule_states: Object.assign(Object.fromEntries(T.RULE_DEFS.map(d => [d.id, "off"])), { period_charge: "hard", weekend_balance: balance }),
    weekend_balance_max_diff: 0, weights: {},
  };
  T.fillDefaultRules(r);
  for (const k in r.weights) r.weights[k] = 0;
  Object.assign(r.weights, { split_weekend: 60, consecutive_weekend: 6, weekend_history_spread: 5, charge_without_dayshift: 7, weekend_balance_excess: 3 });
  return r;
}
function problem(r, extra = {}) { return new T.Problem(r, T.normalizeMonth(Object.assign({ year: 2026, month: 11, holidays: [] }, clone(extra)), r)); }
const assignment = (P, who = () => names[0]) => Object.fromEntries(P.slots.map(s => [T.Problem.key(s), { work: who(s), oc: [] }]));
let runs = 0, fails = 0;
(async () => {
  const highs = await require(process.argv[2])();
  const test = (label, f) => { runs++; try { f(); console.log("PASS", label); } catch (e) { fails++; console.log("FAIL", label, e.message); } };
  const consistent = (P, want, pin) => {
    const solved = T.solve(P, highs, { pin, timeLimit: 10, mipGap: 0 });
    assert.equal(solved.status, "Optimal");
    const checked = T.check(P, solved.asg), penalty = T.penalty(P, solved.asg);
    assert.equal(checked.V.length, 0, checked.VC.map(v => v.code).join(","));
    assert.equal(penalty.total, want, "independent penalty");
    assert.ok(Math.abs(solved.objective - want) < 1e-6, `solver objective ${solved.objective}; expected ${want}`);
    return checked;
  };
  for (const [day, night] of [["none", "weekdays"], ["weekdays", "weekdays"]]) {
    for (const balance of ["off", "hard", "soft"]) test(`no holiday slots: ${day}/${night}, balance ${balance}`, () => {
      const P = problem(rulesOf(day, night, balance), { holidays: [23] });
      assert.equal(P.periods.length, 6, "retain calendar periods for display and month history");
      assert.ok(P.periods.every(p => !p.slots.length));
      assert.deepEqual(T.lint(P), []);
      const chk = consistent(P, 0);
      assert.ok(P.periods.every(p => p.days.every(d => chk.charge[p.id][d] === null)), "slotless dates have no charge");
      assert.deepEqual(T.fullWeekendUnits(P, chk.charge), Object.fromEntries(names.map(n => [n, 0])));
    });
  }
  for (const balance of ["hard", "soft"]) test(`empty periods retain actual history: ${balance}`, () => {
    const P = problem(rulesOf("none", "weekdays", balance), { history: { weekend_charge: { [names[0]]: 3, [names[1]]: 1 } } });
    consistent(P, 20); // Difference is (3 - 1) * 2 days * weight 5, with no new weekend duties.
  });
  test("no charge-role members needed on slotless holidays", () => {
    const P = problem(rulesOf("none", "weekdays", "hard", false));
    assert.equal(P.I.length, 0); assert.deepEqual(T.lint(P), []); consistent(P, 0);
  });
  test("active holidays still require a charge-role member", () => {
    const P = problem(rulesOf("none", "all", "hard", false));
    assert.ok(T.lint(P).some(x => x.code === "LINT_NO_CHARGE_CANDIDATE"));
    assert.equal(T.solve(P, highs, { timeLimit: 10 }).status, "Infeasible");
  });
  test("unavailable staff and previous-month charge do not create duty on empty dates", () => {
    const P = problem(rulesOf(), { holidays: [23], unavailable_night: Object.fromEntries(names.map(n => [n, [1, 7, 8, 14, 15, 21, 22, 23, 28, 29]])),
      prev_month: { last_days: [{ date: 31, night: names[0], night_oc: [] }], last_weekend_charge: names[0], prev_weekend_charge: names[0] } });
    assert.deepEqual(T.lint(P), []); consistent(P, 0);
  });
  test("fixed charge on a slotless date is reported rather than silently dropped", () => {
    const P = problem(rulesOf(), { fixed: { weekend_charge: { 7: names[0] } } });
    assert.ok(T.lint(P).some(x => x.code === "LINT_FIXED_CHARGE_NO_SLOT"));
    assert.ok(T.check(P, assignment(P)).VC.some(v => v.code === "PERIOD_CHARGE_FIXED_MISMATCH"));
  });
  test("next-month charge on a slotless first day is reported", () => {
    const P = problem(rulesOf(), { month: 10, fixed: { weekend_charge: { 32: names[0] } } });
    assert.ok(T.lint(P).some(x => x.code === "LINT_FIXED_CHARGE_NO_SLOT"));
  });
  test("active nights retain crossing, full-weekend, history and no-day penalties", () => {
    const P = problem(rulesOf("none", "all"), { history: { weekend_charge: { [names[0]]: 2 } },
      prev_month: { last_days: [{ date: 31, night: names[0], night_oc: [] }], last_weekend_charge: names[0], prev_weekend_charge: names[0] } });
    // 5 consecutive weekends * 6 + 5 periods without day duty * 7 + (2*2 + 8 + 2) history-day spread * 5.
    const chk = consistent(P, 135, assignment(P));
    assert.deepEqual(T.fullWeekendUnits(P, chk.charge), { [names[0]]: 8, [names[1]]: 0 });
  });
  test("active weekday holiday still has a charge and no-day penalty", () => {
    const r = rulesOf("none", "all"); for (const k in r.weights) r.weights[k] = 0; r.weights.charge_without_dayshift = 7;
    const P = problem(r, { holidays: [23] }); consistent(P, 42, assignment(P));
  });
  test("day-only active periods do not incur no-day penalty", () => {
    const r = rulesOf("off_days", "weekdays"); for (const k in r.weights) r.weights[k] = 0; r.weights.charge_without_dayshift = 7;
    const P = problem(r); consistent(P, 0, assignment(P));
  });
  for (const balance of ["hard", "soft"]) test(`active full-weekend balance: ${balance}`, () => {
    const r = rulesOf("none", "all", balance); for (const k in r.weights) r.weights[k] = 0; r.weights.weekend_balance_excess = 3;
    const P = problem(r), asg = assignment(P);
    if (balance === "soft") consistent(P, 24, asg); // 8 actual days above a zero-day allowed difference.
    else {
      assert.ok(T.check(P, asg).VC.some(v => v.code === "WEEKEND_BALANCE"));
      assert.equal(T.solve(P, highs, { pin: asg, timeLimit: 10 }).status, "Infeasible");
      const alternating = assignment(P, s => [14, 15, 28, 29].includes(s[0]) ? names[1] : names[0]);
      consistent(P, 0, alternating);
    }
  });
  test("active previous-month crossing still connects to its charge", () => {
    const r = rulesOf("none", "all"); for (const k in r.weights) r.weights[k] = 0;
    const P = problem(r, { prev_month: { last_days: [{ date: 31, night: names[0], night_oc: [] }] } });
    consistent(P, 0, assignment(P));
    const bad = assignment(P); bad["1:night"].work = names[1];
    assert.ok(T.check(P, bad).VC.some(v => v.code === "PERIOD_CHARGE_PREV_LINK"));
    assert.equal(T.solve(P, highs, { pin: bad, timeLimit: 10 }).status, "Infeasible");
  });
  test("active next-month crossing still honors explicit charge", () => {
    const r = rulesOf("none", "all"); for (const k in r.weights) r.weights[k] = 0;
    const P = problem(r, { month: 10, fixed: { weekend_charge: { 32: names[0] } } });
    consistent(P, 0, assignment(P));
    const bad = assignment(P); bad["31:night"].work = names[1];
    assert.ok(T.check(P, bad).VC.some(v => v.code === "PERIOD_CHARGE_NEXT_LINK"));
    assert.equal(T.solve(P, highs, { pin: bad, timeLimit: 10 }).status, "Infeasible");
  });
  test("day-only month end connects to next month's fixed day worker", () => {
    const r = rulesOf("off_days", "weekdays"); for (const k in r.weights) r.weights[k] = 0;
    const P = problem(r, { month: 10, fixed: { day: { 32: names[1] } } }), bad = assignment(P);
    assert.deepEqual(T.lint(P), []);
    assert.ok(T.check(P, bad).VC.some(v => v.code === "PERIOD_CHARGE_NEXT_LINK"));
    assert.equal(T.solve(P, highs, { pin: bad, timeLimit: 10 }).status, "Infeasible");
    const good = clone(bad); good["31:day"].work = names[1]; consistent(P, 0, good);
  });
  test("active fixed charge and split-weekend penalty remain effective", () => {
    const r = rulesOf("none", "all"); for (const k in r.weights) r.weights[k] = 0; r.weights.split_weekend = 60;
    const P = problem(r, { fixed: { weekend_charge: { 7: names[0], 8: names[1] } } }), asg = assignment(P);
    asg["8:night"].work = names[1]; consistent(P, 60, asg);
    asg["7:night"].work = names[1];
    assert.ok(T.check(P, asg).VC.some(v => v.code === "PERIOD_CHARGE_FIXED_MISMATCH"));
    assert.equal(T.solve(P, highs, { pin: asg, timeLimit: 10 }).status, "Infeasible");
  });
  test("previous-month handover connects to the first slot's person", () => {
    const r = rulesOf("off_days", "all"); for (const k in r.weights) r.weights[k] = 0; r.weights.charge_handover = 200;
    const P = problem(r, { prev_month: { last_days: [{ date: 31, day: names[0], night: names[1] }] } });
    assert.ok(!T.lint(P).some(x => x.code === "LINT_PREV_CHARGE_TWO"), "a valid handover is not an ambiguous charge");
    const good = assignment(P); good["1:night"].work = names[1];
    consistent(P, 200, good); // Current-day handover remains allowed; its first slot carries the previous charge.
    const bad = assignment(P); bad["1:day"].work = names[1]; bad["1:night"].work = names[1];
    assert.ok(T.check(P, bad).VC.some(x => x.code === "PERIOD_CHARGE_PREV_LINK"));
    assert.equal(T.solve(P, highs, { pin: bad, timeLimit: 10 }).status, "Infeasible");
  });
  test("previous-month first-slot OC establishes charge and supports multiple workers", () => {
    const r = rulesOf("off_days", "all"); for (const k in r.weights) r.weights[k] = 0;
    const P = problem(r, { prev_month: { last_days: [{ date: 31, day: ["Synthetic Staff"], day_oc: [names[0]], night: names[1] }] } });
    const bad = assignment(P, () => names[1]);
    assert.ok(T.check(P, bad).VC.some(x => x.code === "PERIOD_CHARGE_PREV_LINK"));
    assert.equal(T.solve(P, highs, { pin: bad, timeLimit: 10 }).status, "Infeasible");
    consistent(P, 0, assignment(P));
  });
  test("previous-month handover availability warning names only the first-slot charge", () => {
    const r = rulesOf("off_days", "all"), prev_month = { last_days: [{ date: 31, day: names[0], night: names[1] }] };
    const first = T.lint(problem(r, { prev_month, unavailable_other: [{ name: names[0], day: 1, part: "allday" }] })).filter(x => x.code === "LINT_PREV_CHARGE_UNAVAIL");
    assert.equal(first.length, 1); assert.equal(first[0].args.who, names[0]);
    assert.ok(!T.lint(problem(r, { prev_month, unavailable_other: [{ name: names[1], day: 1, part: "allday" }] })).some(x => x.code === "LINT_PREV_CHARGE_UNAVAIL"));
  });
  test("ambiguous first-slot carry-over still warns and does not choose a charge", () => {
    const r = rulesOf("off_days", "all"); for (const k in r.weights) r.weights[k] = 0;
    const P = problem(r, { prev_month: { last_days: [{ date: 31, day: names[0], day_oc: [names[1]], night: names[0] }] } });
    assert.ok(T.lint(P).some(x => x.code === "LINT_PREV_CHARGE_TWO"));
    assert.ok(!T.check(P, assignment(P)).VC.some(x => x.code === "PERIOD_CHARGE_PREV_LINK"));
    consistent(P, 0, assignment(P));
  });
  test("next-month connection uses the first slot even when the last day has a handover", () => {
    const r = rulesOf("off_days", "all"); for (const k in r.weights) r.weights[k] = 0; r.weights.charge_handover = 200;
    const P = problem(r, { month: 10, fixed: { weekend_charge: { 32: names[0] } } }), good = assignment(P);
    good["31:night"].work = names[1]; consistent(P, 200, good);
    const bad = assignment(P); bad["31:day"].work = names[1];
    assert.ok(T.check(P, bad).VC.some(x => x.code === "PERIOD_CHARGE_NEXT_LINK"));
    assert.equal(T.solve(P, highs, { pin: bad, timeLimit: 10 }).status, "Infeasible");
  });
  test("split-day availability is feasible without false fixed-charge or candidate warnings", () => {
    const r = rulesOf("off_days", "all"); for (const k in r.weights) r.weights[k] = 0; r.weights.charge_handover = 200;
    const P = problem(r, { fixed: { weekend_charge: { 7: names[0] } }, unavailable_night: { [names[0]]: [7] }, unavailable_other: [{ name: names[1], day: 7, part: "day" }] });
    const good = assignment(P); good["7:night"].work = names[1]; consistent(P, 200, good);
    assert.ok(!T.lint(P).some(x => ["LINT_FIXED_CHARGE_VS_UNAVAIL", "LINT_NO_CHARGE_CANDIDATE"].includes(x.code)));
  });
  test("previous charge can hand over at night when only its night is unavailable", () => {
    const r = rulesOf("off_days", "all"); for (const k in r.weights) r.weights[k] = 0; r.weights.charge_handover = 200;
    const P = problem(r, { prev_month: { last_days: [{ date: 31, day: names[0], night: names[1] }] }, unavailable_night: { [names[0]]: [1] } });
    const good = assignment(P); good["1:night"].work = names[1]; consistent(P, 200, good);
    assert.ok(!T.lint(P).some(x => x.code === "LINT_PREV_CHARGE_UNAVAIL"));
  });
  test("unavailable first-slot charge and an uncovered later slot still warn", () => {
    const r = rulesOf("off_days", "all");
    const P = problem(r, { fixed: { weekend_charge: { 7: names[0] } }, unavailable_other: [{ name: names[0], day: 7, part: "day" }] });
    assert.ok(T.lint(P).some(x => x.code === "LINT_FIXED_CHARGE_VS_UNAVAIL"));
    const fixedResult = T.solve(P, highs, { timeLimit: 10 }); assert.equal(fixedResult.status, "Optimal");
    assert.ok(T.check(P, fixedResult.asg).WC.some(x => x.code === "UNAVAIL_DAY")); // Actual first-slot fixed conflict remains an explicit exception.
    const q = problem(r, { unavailable_night: Object.fromEntries(names.map(n => [n, [7]])) });
    assert.ok(T.lint(q).some(x => x.code === "LINT_NO_CHARGE_CANDIDATE"));
    assert.equal(T.solve(q, highs, { timeLimit: 10 }).status, "Infeasible");
  });
  test("night-only charge ignores daytime unavailability but still respects night unavailability", () => {
    const r = rulesOf("none", "all"); for (const k in r.weights) r.weights[k] = 0;
    const extra = { fixed: { weekend_charge: { 7: names[0] } }, unavailable_other: [{ name: names[0], day: 7, part: "day" }] };
    const P = problem(r, extra); consistent(P, 0, assignment(P));
    assert.ok(!T.lint(P).some(x => x.code === "LINT_FIXED_CHARGE_VS_UNAVAIL"));
    const bad = problem(r, { ...extra, unavailable_night: { [names[0]]: [7] } });
    assert.ok(T.lint(bad).some(x => x.code === "LINT_FIXED_CHARGE_VS_UNAVAIL"));
    assert.equal(T.solve(bad, highs, { timeLimit: 10 }).status, "Optimal"); // First-slot fixed conflict remains permitted.
  });
  test("fixed charge exempts only the first slot, not an unpinned later night", () => {
    const r = rulesOf("off_days", "all"); for (const k in r.weights) r.weights[k] = 0; r.weights.charge_handover = 200;
    const P = problem(r, { fixed: { weekend_charge: { 7: names[0] } }, unavailable_night: { [names[0]]: [7] } });
    const bad = assignment(P);
    assert.ok(T.check(P, bad).VC.some(x => x.code === "UNAVAIL_NIGHT"));
    assert.equal(T.solve(P, highs, { pin: bad, timeLimit: 10 }).status, "Infeasible");
    const good = assignment(P); good["7:night"].work = names[1]; consistent(P, 200, good);
    const separatelyFixed = problem(r, { fixed: { weekend_charge: { 7: names[0] }, night: { 7: names[0] } }, unavailable_night: { [names[0]]: [7] } });
    assert.ok(T.check(separatelyFixed, bad).WC.some(x => x.code === "UNAVAIL_NIGHT"));
    assert.equal(T.solve(separatelyFixed, highs, { pin: bad, timeLimit: 10 }).status, "Optimal");
  });
  test("disabled charge does not exempt either slot from unavailability", () => {
    const r = rulesOf("off_days", "all"); r.rule_states.period_charge = "off";
    const P = problem(r, { fixed: { weekend_charge: { 7: names[0] } }, unavailable_night: { [names[0]]: [7] }, unavailable_other: [{ name: names[0], day: 7, part: "day" }] });
    assert.ok(!P.isFixedEng([7, "day"], names[0])); assert.ok(!P.isFixedEng([7, "night"], names[0]));
    const bad = assignment(P), check = T.check(P, bad);
    assert.ok(check.VC.some(x => x.code === "UNAVAIL_DAY")); assert.ok(check.VC.some(x => x.code === "UNAVAIL_NIGHT"));
    assert.equal(T.solve(P, highs, { pin: bad, timeLimit: 10 }).status, "Infeasible");
  });
  test("charge fixed outside a period does not exempt an unrelated shift", () => {
    const r = rulesOf("off_days", "all"), P = problem(r, { fixed: { weekend_charge: { 2: names[0] } }, unavailable_night: { [names[0]]: [2] } });
    assert.ok(T.lint(P).some(x => x.code === "LINT_FIXED_CHARGE_NOT_OFF_DAY"));
    assert.ok(!P.isFixedEng([2, "night"], names[0]));
    const bad = assignment(P); assert.ok(T.check(P, bad).VC.some(x => x.code === "UNAVAIL_NIGHT"));
    assert.equal(T.solve(P, highs, { pin: bad, timeLimit: 10 }).status, "Infeasible");
  });
  test("non-charge and unknown charge names do not create fixed exemptions", () => {
    const r = rulesOf("off_days", "all"), staff = "Synthetic Staff", unknown = "Synthetic Unknown";
    r.doctors.push({ name: staff, team: "S", quota: 0, years: 1 });
    const P = problem(r, { fixed: { weekend_charge: { 7: staff, 14: unknown }, night: { 7: staff } } });
    assert.ok(T.lint(P).some(x => x.code === "LINT_FIXED_CHARGE_NOT_ROLE"));
    assert.ok(!P.isFixedEng([7, "day"], staff)); assert.ok(!P.isFixedEng([14, "day"], unknown));
    assert.ok(!P.isFixedEng([14, "night"], unknown)); assert.ok(P.isFixedEng([7, "night"], staff), "keep the separate actual night fixed assignment");
  });
  T.app = { state: {}, names: () => names.slice(), iNames: () => names.slice(), daysIn: (y, m) => new Date(y, m, 0).getDate() };
  vm.runInThisContext(fs.readFileSync(path.join(__dirname, "src/app-month.js"), "utf8"), { filename: "app-month.js" });
  for (const active of [false, true]) test(`month-end Saturday carryover: ${active ? "active" : "no"} holiday slots`, () => {
    const r = rulesOf("none", active ? "all" : "weekdays"), P = problem(r, { month: 10, history: { weekend_charge: { [names[0]]: 2 }, holiday_charge: { [names[0]]: 4 } } });
    const prev = { rules: r, month: P.m, result: { asg: assignment(P) } }, before = JSON.stringify(prev);
    T.app.state.rules = r;
    const next = T.app.fromPrevious(prev, 2026, 11);
    assert.equal(next.history.weekend_charge[names[0]], active ? 6 : 2, "count actual full weekends only");
    assert.equal(next.history.holiday_charge[names[0]], 4);
    assert.equal(JSON.stringify(prev), before, "preserve previous-month data");
    assert.ok(!next.notes.includes("undefined"));
    if (active) {
      assert.equal(next.fixed.weekend_charge[1], names[0]);
      assert.equal(next.prev_month.last_weekend_charge, names[0]);
    } else {
      assert.ok(!Object.hasOwn(next.fixed.weekend_charge, "1"), "no phantom fixed charge on next month's first day");
      assert.equal(next.prev_month.last_weekend_charge, null);
      assert.equal(next.prev_month.prev_weekend_charge, null);
      assert.equal(next.notes, "");
    }
  });
  test("handover carry-over preserves the first-slot charge in fixed duty and history", () => {
    const r = rulesOf("off_days", "all"), P = problem(r, { month: 10 }), asg = assignment(P);
    asg["31:night"].work = names[1]; T.app.state.rules = r;
    const prev = { rules: r, month: P.m, result: { asg } }, before = JSON.stringify(prev);
    const next = T.app.fromPrevious(prev, 2026, 11);
    assert.equal(JSON.stringify(prev), before);
    assert.equal(next.fixed.weekend_charge[1], names[0]);
    assert.equal(next.prev_month.last_weekend_charge, names[0]);
    assert.deepEqual(next.history.weekend_charge, { [names[0]]: 4, [names[1]]: 0 });
    assert.ok(!T.lint(new T.Problem(r, next)).some(x => x.code === "LINT_PREV_CHARGE_TWO"));
  });
  console.log(`Period slot regression: ${runs - fails} passed, ${fails} failed`); process.exitCode = fails ? 1 : 0;
})().catch(e => { console.error(e); process.exitCode = 1; });

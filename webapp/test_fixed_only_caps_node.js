// Fixed-input exemptions are bounded by the unavoidable excess, never nearby pins.
// Synthetic data only. Usage: node test_fixed_only_caps_node.js <highs package path>
// TOBAN_WEBAPP_ROOT=/path/to/baseline/webapp reruns these same assertions on a baseline.
const fs = require("fs"), vm = require("vm"), path = require("path"), assert = require("assert");
const root = process.env.TOBAN_WEBAPP_ROOT || __dirname;
globalThis.T = {};
for (const f of ["i18n.js", "rules-core.js", "model.js", "messages.js", "solver.js", "check.js"])
  vm.runInThisContext(fs.readFileSync(path.join(root, "src", f), "utf8"), { filename: f });
for (const f of fs.readdirSync(path.join(root, "src/rules")).filter(f => f.endsWith(".js")))
  vm.runInThisContext(fs.readFileSync(path.join(root, "src/rules", f), "utf8"), { filename: "rules/" + f });
const highsPath = process.argv[2];
if (!highsPath) { console.log("SKIP fixed-input cap regressions (pass the HiGHS package path)"); process.exit(0); }
const A = "Synthetic A", B = "Synthetic B", C = "Synthetic C", D = "Synthetic D", E = "Synthetic E", Q = "Synthetic Q", R = "Synthetic R", S = "Synthetic S";
const names = [A, B, C, D, E, Q, R, S], fixedDays = [1, 8, 15], key = s => `${s[0]}:${s[1]}`;
const clone = x => JSON.parse(JSON.stringify(x)), byDay = (ds, value = A) => Object.fromEntries(ds.map(d => [d, value]));
const PROBE = "synthetic_fixed_cap_probe", CODE = "SYNTHETIC_FIXED_CAP";
const probeOpts = p => ({ code: CODE, days: p.days || [1], names: [A], ...(p.proof || {}), ub: 30 });
// This third-party-style rule deliberately does not use any production cap helper.
T.rules.register({ id: PROBE, api: 1, order: 9900, group: "basic", label: "Synthetic fixed cap probe",
  states: ["hard", "soft", "off"], def: "off", weight: "synthetic_fixed_cap", w0: 7,
  read(P, rules) { return rules.synthetic_probe || {}; },
  solve(ctx, p) {
    const x = p.negative ? ctx.LP.E(ctx.work([1, "night"], A), ctx.LP.sub(ctx.work([3, "night"], A), ctx.work([2, "night"], A))) : ctx.total(A);
    ctx.limit(PROBE, x, p.sense || "<=", p.cap ?? 1, probeOpts(p));
  },
  check(ctx, p) {
    if (p.direct) { ctx.viol(CODE, {}, p.days || [1], A, p.proof?.fixed); return; }
    const x = p.negative ? +ctx.worked(A, [1, "night"]) - +ctx.worked(A, [2, "night"]) + +ctx.worked(A, [3, "night"]) : ctx.P.slots.filter(s => ctx.worked(A, s)).length;
    ctx.limit(PROBE, x, p.sense || "<=", p.cap ?? 1, probeOpts(p));
  },
  penalty(ctx, p) {
    if (p.direct) return;
    const x = p.negative ? +ctx.worked(A, [1, "night"]) - +ctx.worked(A, [2, "night"]) + +ctx.worked(A, [3, "night"]) : ctx.P.slots.filter(s => ctx.worked(A, s)).length;
    ctx.limit(PROBE, x, p.sense || "<=", p.cap ?? 1, probeOpts(p));
  },
  messages: { [CODE]: { en: "Synthetic cap exceeded", ja: "架空の上限超過" } }
});
function problem({ id, state = "hard", fixed = { night: byDay(fixedDays) }, multi = false, day = "none", oncall = false,
  doctor = {}, rules = {}, month = {}, probe = {} } = {}) {
  const rr = { profile: { id: "synthetic-fixed-cap", quota_mode: "absolute",
    roles: [{ id: "Staff", label: "Staff", refs: [], standby: oncall }],
    shifts: [{ id: "day", on: day }, { id: "night", on: "all" }], positions: { work: multi ? { count: 4, min: 1 } : { count: 1 } } },
    doctors: names.map(name => ({ name, team: "Staff", quota: 1, ...(doctor[name] || {}) })), quota_tolerance: 0,
    dayoff_weekday_max: 1, shift_counts: { night: {} }, synthetic_probe: probe,
    weights: { fixed_conflict: 1000, chief_duty: 0, missing_young_oc: 0, dayoff_weekday_excess: 11, shift_count_range: 13, composition_miss: 17, synthetic_fixed_cap: 7 },
    rule_states: {}, ...rules };
  T.fillDefaultRules(rr);
  for (const def of T.RULE_DEFS) if (def.states.includes("off")) rr.rule_states[def.id] = "off";
  if (id) rr.rule_states[id] = state;
  rr.rule_states.oncall = oncall ? "hard" : "off";
  return new T.Problem(rr, T.normalizeMonth({ year: 2026, month: 11, holidays: [], fixed, ...month }, rr));
}
// Count from the assignment JSON, independent of T.Asg and the production helpers.
const worked = (asg, d, n = A, kind = "night") => [].concat(asg[`${d}:${kind}`]?.work || []).includes(n);
const workCount = (asg, n = A) => Object.values(asg).filter(v => [].concat(v.work || []).includes(n)).length;
const sundayCount = (asg, n = A) => [1, 8, 15, 22, 29].filter(d => ["day", "night"].some(k => worked(asg, d, n, k) || (asg[`${d}:${k}`]?.oc || []).includes(n))).length;
function assignment(P, aDays = fixedDays) {
  const saturdays = [7, 14, 21, 28], sundays = [1, 8, 15, 22, 29], out = {};
  for (const s of P.slots) out[key(s)] = { work: aDays.includes(s[0]) ? A : saturdays.includes(s[0]) ? [B, C, D, E][saturdays.indexOf(s[0])] : sundays.includes(s[0]) ? [B, C, D, E, Q][sundays.indexOf(s[0])] : B, oc: [] };
  return out;
}
function classify(P, asg, code, expected) {
  const c = T.check(P, asg), vs = c.VC.filter(v => v.code === code), ws = (c.WC || []).filter(v => v.code === code);
  assert.strictEqual(vs.length, expected === "V" ? 1 : 0, `${code}: required violation count`);
  assert.strictEqual(ws.length, expected === "W" ? 1 : 0, `${code}: fixed-input warning count`);
  return c;
}
let passed = 0, failed = 0, solves = 0;
function test(label, fn) { try { fn(); passed++; console.log("ok   " + label); } catch (e) { failed++; console.error("FAIL " + label + "\n     " + (e.stack || e)); } }
(async () => {
  const highs = await require(highsPath)();
  function pinned(P, asg, status, expectedPenalty) {
    const before = JSON.stringify({ rules: P.rules, month: P.m, asg }), result = T.solve(P, highs, { pin: asg, timeLimit: 10, mipGap: 0 }); solves++;
    assert.strictEqual(result.status, status, "actual pinned HiGHS status");
    assert.strictEqual(JSON.stringify({ rules: P.rules, month: P.m, asg }), before, "solve must preserve all inputs");
    if (status === "Optimal") {
      assert.deepStrictEqual(T.check(P, result.asg).VC, [], "a feasible solution has no required violations");
      assert.strictEqual(result.objective, expectedPenalty, "solver objective agrees with independent excess");
      assert.strictEqual(T.penalty(P, result.asg).total, expectedPenalty, "recount agrees with objective");
    }
    return result;
  }
  for (const [id, code, weight, count] of [
    ["dayoff_weekday_cap", "DAYOFF_WEEKDAY_OVER", 11, sundayCount],
    ["shift_count_range", "SHIFT_COUNT_OVER", 13, workCount]
  ]) for (const state of ["hard", "soft", "off"]) for (const extra of [false, true]) {
    test(`${id}/${state}: three fixed shifts, ${extra ? "one extra discretionary shift" : "exact fixed excess"}`, () => {
      const P = problem({ id, state, doctor: { [A]: { shift_max_night: 1 } } }), asg = assignment(P, extra ? [...fixedDays, 22] : fixedDays);
      const excess = count(asg) - 1; assert.strictEqual(excess, extra ? 3 : 2);
      classify(P, asg, code, state === "hard" ? extra ? "V" : "W" : "none");
      const pen = T.penalty(P, asg);
      assert.strictEqual(pen.total, state === "hard" ? 2000 : state === "soft" ? excess * weight : 0, "hard recount charges only the unavoidable fixed excess");
      pinned(P, asg, state === "hard" && extra ? "Infeasible" : "Optimal", pen.total);
    });
  }
  // Separate solver-first assertions ensure baseline failures cannot stop at checker classification.
  for (const id of ["dayoff_weekday_cap", "shift_count_range"]) test(`${id}: hard solver ceiling rejects excess even with zero conflict weight`, () => {
    const P = problem({ id, doctor: { [A]: { shift_max_night: 1 } }, rules: { weights: { fixed_conflict: 0, chief_duty: 0, missing_young_oc: 0 } } });
    pinned(P, assignment(P, [...fixedDays, 22]), "Infeasible");
  });
  for (const id of ["dayoff_weekday_cap", "shift_count_range"]) test(`${id}: one fixed shift does not excuse an avoidable second shift`, () => {
    const P = problem({ id, fixed: { night: { 1: A } }, doctor: { [A]: { shift_max_night: 1 } } }), asg = assignment(P, [1, 8]);
    classify(P, asg, id === "dayoff_weekday_cap" ? "DAYOFF_WEEKDAY_OVER" : "SHIFT_COUNT_OVER", "V");
    assert.strictEqual(T.penalty(P, asg).total, 0); pinned(P, asg, "Infeasible");
  });
  for (const id of ["dayoff_weekday_cap", "shift_count_range"]) test(`${id}: multi-person fixed slots count each person once`, () => {
    const P = problem({ id, multi: true, fixed: { night: byDay(fixedDays, [A, R]) }, doctor: { [A]: { shift_max_night: 1 }, [R]: { shift_max_night: 1 } } });
    const asg = assignment(P); for (const d of fixedDays) asg[`${d}:night`].work = [A, R];
    const code = id === "dayoff_weekday_cap" ? "DAYOFF_WEEKDAY_OVER" : "SHIFT_COUNT_OVER", c = T.check(P, asg);
    assert.strictEqual(c.WC.filter(x => x.code === code).length, 2); assert.deepStrictEqual(c.VC, []);
    assert.strictEqual(workCount(asg, A), 3); assert.strictEqual(workCount(asg, R), 3);
    pinned(P, asg, "Optimal", 4000);
  });
  test("dayoff cap counts two fixed shifts on the same day as one day", () => {
    const P = problem({ id: "dayoff_weekday_cap", day: "all", fixed: { day: byDay(fixedDays), night: byDay(fixedDays) } }), asg = assignment(P);
    assert.strictEqual(workCount(asg), 6); assert.strictEqual(sundayCount(asg), 3);
    classify(P, asg, "DAYOFF_WEEKDAY_OVER", "W"); pinned(P, asg, "Optimal", 2000);
  });
  for (const [state, extra] of [["hard", false], ["hard", true], ["soft", true], ["off", true]]) test(`dayoff/${state}: OC-only fixed excess${extra ? " plus discretionary OC" : ""}`, () => {
    const P = problem({ id: "dayoff_weekday_cap", state, oncall: true, fixed: { night_oc: byDay(fixedDays, [A]) }, rules: { oncall_requirement: { Staff: { Staff: 1 } } } });
    const asg = Object.fromEntries(P.slots.map(s => [key(s), { work: B, oc: [C] }]));
    for (const [d, w, o] of [[1, B, A], [8, C, A], [15, D, A], [22, E, extra ? A : Q], [29, R, S], [7, A, B], [14, C, D], [21, E, Q], [28, R, S]]) asg[`${d}:night`] = { work: w, oc: [o] };
    assert.strictEqual(workCount(asg, A), 1); assert.strictEqual(sundayCount(asg, A), extra ? 4 : 3);
    classify(P, asg, "DAYOFF_WEEKDAY_OVER", state === "hard" ? extra ? "V" : "W" : "none");
    const penalty = state === "hard" ? 2000 : state === "soft" ? 33 : 0;
    assert.strictEqual(T.penalty(P, asg).total, penalty); pinned(P, asg, state === "hard" && extra ? "Infeasible" : "Optimal", penalty);
  });
  const quotaMonth = { count_min: Object.fromEntries(names.map(n => [n, 0])), count_max: Object.fromEntries(names.map(n => [n, n === A ? 1 : 30])) };
  for (const extra of [false, true]) test(`quota max(cap, fixed count): ${extra ? "fourth shift rejected" : "explicit fixed warning retained"}`, () => {
    const P = problem({ id: "quota_range", month: quotaMonth }), asg = assignment(P, extra ? [...fixedDays, 22] : fixedDays);
    classify(P, asg, extra ? "COUNT_OUT_OF_LIMIT" : "COUNT_LIMIT_OVER_BY_FIXED", extra ? "V" : "W");
    assert.strictEqual(T.penalty(P, asg).total, 0, "quota fixed exception keeps its existing zero penalty");
    pinned(P, asg, extra ? "Infeasible" : "Optimal", 0);
  });
  test("inactive retained work never increases quota fixed count or hard ceiling", () => {
    const P = problem({ id: "quota_range", month: quotaMonth, fixed: { night: byDay(fixedDays), day: { 2: A } } }), asg = assignment(P, [...fixedDays, 22]);
    assert.strictEqual(P.fixedWorkCount(A), 3, "inactive retained day shift is excluded");
    classify(P, asg, "COUNT_OUT_OF_LIMIT", "V"); pinned(P, asg, "Infeasible");
  });
  for (const state of ["hard", "soft", "off"]) for (const extra of [false, true]) test(`composition/${state}: ${extra ? "fourth qualified worker" : "three fixed qualified workers"}`, () => {
    const P = problem({ id: "composition", state, multi: true, fixed: { night: { 1: [A, Q, R] } },
      doctor: Object.fromEntries([A, B, Q, R].map(n => [n, { quals: ["Synthetic qualified"] }])),
      rules: { composition: [{ shift: "night", qual: "Synthetic qualified", max: 1 }] } });
    const asg = Object.fromEntries(P.slots.map(s => [key(s), { work: s[0] === 1 ? [A, Q, R, ...(extra ? [B] : [])] : C, oc: [] }]));
    const excess = asg["1:night"].work.length - 1; assert.strictEqual(excess, extra ? 3 : 2);
    classify(P, asg, "COMPOSITION_OVER", state === "hard" ? extra ? "V" : "W" : "none");
    const penalty = state === "soft" ? excess * 17 : 0;
    assert.strictEqual(T.penalty(P, asg).total, penalty, "composition retains its existing penalty policy");
    pinned(P, asg, state === "hard" && extra ? "Infeasible" : "Optimal", penalty);
  });
  for (const [label, proof, fixed, aDays, expected, penalty] of [
    ["boolean proof defaults to one unit", { fixed: true }, [1, 8], [1, 8], "W", 1000],
    ["boolean proof cannot cover two units", { fixed: true }, [1, 8], [1, 8, 15], "V", 1000],
    ["explicit two-unit allowance", { fixed: true, fixedExcess: 2 }, fixedDays, fixedDays, "W", 2000],
    ["explicit allowance cannot cover extra third unit", { fixed: true, fixedExcess: 2 }, fixedDays, [...fixedDays, 22], "V", 2000],
    ["zero allowance remains hard", { fixed: true, fixedExcess: 0 }, [1], [1, 8], "V", 0],
    ["numeric allowance without proof remains hard", { fixedExcess: 2 }, [1], [1, 8], "V", 0],
    ["omitted proof ignores nearby fixed day and name", {}, [1], [1, 8], "V", 0],
    ["explicit false overrides nearby fixed day and name", { fixed: false }, [1], [1, 8], "V", 0]
  ]) test(`custom ctx.limit: ${label}`, () => {
    const P = problem({ id: PROBE, probe: { proof }, fixed: { night: byDay(fixed) } }), asg = assignment(P, aDays);
    classify(P, asg, CODE, expected); assert.strictEqual(T.penalty(P, asg).total, penalty);
    pinned(P, asg, expected === "V" ? "Infeasible" : "Optimal", penalty);
  });
  for (const proof of [{ fixed: true }, { fixed: true, fixedExcess: 2 }]) test(`custom ctx.limit: independent solver ceiling for ${JSON.stringify(proof)}`, () => {
    const allowance = proof.fixedExcess ?? 1, ds = [1, 8, 15, 22], P = problem({ id: PROBE, probe: { proof }, fixed: { night: byDay(ds.slice(0, allowance + 1)) } });
    pinned(P, assignment(P, ds.slice(0, allowance + 2)), "Infeasible");
  });
  for (const state of ["soft", "off"]) test(`custom ctx.limit/${state}: fixed allowance does not cap ordinary soft slack`, () => {
    const P = problem({ id: PROBE, state, probe: { proof: { fixed: true, fixedExcess: 1 } } }), asg = assignment(P, [...fixedDays, 22]);
    classify(P, asg, CODE, "none"); pinned(P, asg, "Optimal", state === "soft" ? 3 * 7 : 0);
  });
  for (const allowance of [-1, 0.5, NaN, Infinity, "2", true]) test(`custom ctx.limit: reject invalid hard allowance ${String(allowance)}`, () => {
    const proof = { fixed: true, fixedExcess: allowance }, P = problem({ id: PROBE, probe: { proof } }), asg = new T.Asg(P, assignment(P));
    assert.throws(() => T.buildLP(P), /fixedExcess/, "solver rejects a non-integer/non-numeric allowance");
    for (const mode of ["check", "penalty"]) {
      const ctx = T.rules.checkCtx(P, asg, mode, () => {});
      assert.throws(() => ctx.limit(PROBE, 3, "<=", 1, proof), /fixedExcess/, `${mode} rejects the same invalid allowance`);
    }
  });
  test("central checker: direct plugin violation without proof stays V despite exact fixed slot/name", () => {
    const P = problem({ id: PROBE, probe: { direct: true, days: [[1, "night"]] } }); classify(P, assignment(P), CODE, "V");
  });
  test("negative literal: fixed outer shifts do not prove an avoidable work-rest-work violation", () => {
    const P = problem({ id: PROBE, fixed: { night: byDay([1, 3]) }, probe: { negative: true, days: [1, 2, 3], proof: { fixed: false } } }), asg = assignment(P, [1, 3]);
    assert.strictEqual(+worked(asg, 1) - +worked(asg, 2) + +worked(asg, 3), 2);
    classify(P, asg, CODE, "V"); assert.strictEqual(T.penalty(P, asg).total, 0); pinned(P, asg, "Infeasible");
    const corrected = clone(asg); corrected["2:night"].work = A;
    classify(P, corrected, CODE, "none"); pinned(P, corrected, "Optimal", 0);
  });
  for (const [label, value, rhs, proof, expectedFixed, charge] of [
    ["unit shortfall", 1, 2, { fixed: true }, true, 1],
    ["shortfall above allowance", 0, 2, { fixed: true }, false, 1],
    ["bounded multi-unit shortfall", 0, 2, { fixed: true, fixedExcess: 2 }, true, 2],
    ["actual excess smaller than allowance", 1, 2, { fixed: true, fixedExcess: 3 }, true, 1],
    ["satisfied constraint", 3, 2, { fixed: true, fixedExcess: 2 }, null, 0]
  ]) test(`checkCtx lower-bound contract: ${label}`, () => {
    const P = problem({ id: PROBE }), asg = new T.Asg(P, {}), seen = [], counted = [];
    const c = T.rules.checkCtx(P, asg, "check", (...args) => seen.push(args)), p = T.rules.checkCtx(P, asg, "penalty", (k, w, x) => counted.push(w * x));
    c.limit(PROBE, value, ">=", rhs, { ...proof, code: CODE }); p.limit(PROBE, value, ">=", rhs, proof);
    assert.strictEqual(seen.length, expectedFixed === null ? 0 : 1); if (seen.length) assert.strictEqual(seen[0][4], expectedFixed);
    assert.strictEqual(counted.reduce((a, b) => a + b, 0), charge * 1000);
  });
  test("fixed facts distinguish active work, OC, work-day and previous/next constants", () => {
    const P = problem({ day: "all", oncall: true, fixed: { day: { 1: A, 31: Q }, night: { 2: B, 31: R }, day_oc: { 1: C, 31: A }, night_oc: { 2: D, 31: B } },
      month: { prev_month: { last_days: [{ date: 31, day: C, day_oc: [D], night: E, night_oc: [Q] }] } } });
    const c = T.rules.checkCtx(P, new T.Asg(P, {}), "check", () => {});
    for (const [slot, w, o] of [[[1, "day"], A, C], [[2, "night"], B, D], [[0, "day"], C, D], [[0, "night"], E, Q], [[31, "day"], Q, A], [[31, "night"], R, B]]) {
      assert.strictEqual(c.fixedWorkAt(slot, w), true); assert.strictEqual(c.fixedOcAt(slot, o), true);
      assert.strictEqual(c.fixedEngAt(slot, w), true); assert.strictEqual(c.fixedEngAt(slot, o), true);
      assert.strictEqual(c.fixedWorkAt(slot, o), false); assert.strictEqual(c.fixedOcAt(slot, w), false);
      assert.strictEqual(c.fixedWorkDay(slot[0], w), true);
    }
    assert.strictEqual(c.fixedWorkDay(1, C), false, "OC is engagement, not a work day");
    assert.strictEqual(c.fixedWorkAt([1, "night"], A), false, "same-day other shift is not pinned");
    assert.strictEqual(c.fixedWorkAt([32, "night"], R), false, "only the known boundary day is a constant");
  });
  test("fixed facts ignore retained inactive slots and OC when oncall is disabled", () => {
    const P = problem({ fixed: { day: { 1: A, 31: A }, night_oc: { 1: B, 31: B } } }), c = T.rules.checkCtx(P, new T.Asg(P, {}), "check", () => {});
    for (const d of [1, 31]) {
      assert.strictEqual(c.fixedWorkAt([d, "day"], A), false); assert.strictEqual(c.fixedEngAt([d, "day"], A), false);
      assert.strictEqual(c.fixedOcAt([d, "night"], B), false); assert.strictEqual(c.fixedEngAt([d, "night"], B), false);
    }
  });
  for (const state of ["hard", "off"]) test(`fixed charge/${state}: first active engagement only, never a work or OC fact`, () => {
    const P = problem({ id: "period_charge", state, fixed: { weekend_charge: { 7: Q } }, doctor: { [Q]: { team: "Charge" } },
      rules: { profile: { roles: [{ id: "Staff", refs: [], standby: false }, { id: "Charge", refs: ["charge"], standby: true }],
        shifts: [{ id: "day", on: "all" }, { id: "night", on: "all" }] } } });
    const c = T.rules.checkCtx(P, new T.Asg(P, {}), "check", () => {});
    assert.strictEqual(c.fixedEngAt([7, "day"], Q), state === "hard");
    assert.strictEqual(c.fixedEngAt([7, "night"], Q), false, "same-day later slot remains discretionary");
    assert.strictEqual(c.fixedWorkAt([7, "day"], Q), false); assert.strictEqual(c.fixedOcAt([7, "day"], Q), false);
    assert.strictEqual(c.fixedWorkDay(7, Q), false, "charge engagement is not proof of work");
  });
  test("lint fixedWork deduplicates repeated names within one active slot", () => {
    const P = problem({ id: "same_day_double", multi: true, fixed: { night: { 7: [A, A, R, R] } } });
    const c = T.rules.checkCtx(P, new T.Asg(P, {}), "lint", () => {});
    assert.deepStrictEqual(c.fixedWork(), { [A]: [7], [R]: [7] }, "one fact per person and actual work slot");
    assert.deepStrictEqual(T.lint(P).filter(v => v.code === "LINT_FIXED_SAME_DAY"), [], "duplicate input in one slot is not two same-day work slots");
  });
  test("lint fixedWork filters inactive day/night slots and other-month work", () => {
    for (const inactive of ["day", "night"]) {
      const active = inactive === "day" ? "night" : "day";
      const P = problem({ fixed: { [inactive]: { 7: A }, [active]: { 8: B, 31: A } },
        rules: { profile: { roles: [{ id: "Staff", refs: [], standby: false }], shifts: [{ id: "day", on: active === "day" ? "all" : "none" }, { id: "night", on: active === "night" ? "all" : "weekdays" }] } },
        month: { prev_month: { last_days: [{ date: 31, [active]: A }] } } });
      const c = T.rules.checkCtx(P, new T.Asg(P, {}), "lint", () => {});
      assert.deepStrictEqual(c.fixedWork(), { [B]: [8] }, `only active current-month work remains when ${inactive} is inactive`);
    }
  });
  test("same-day fixed lint requires both actual work slots and emits one warning", () => {
    for (const day of ["all", "none"]) {
      const P = problem({ id: "same_day_double", day, fixed: { day: { 7: A }, night: { 7: [A, A] } } });
      const warnings = T.lint(P).filter(v => v.code === "LINT_FIXED_SAME_DAY");
      assert.strictEqual(warnings.length, day === "all" ? 1 : 0, "retained nonexistent day work cannot make a same-day conflict");
      if (warnings.length) assert.strictEqual(warnings[0].args.who, A);
    }
  });
  test("one fixed plus discretionary same-day work is invalid but not fixed-input lint", () => {
    const P = problem({ id: "same_day_double", day: "all", fixed: { day: { 7: A } } });
    const asg = new T.Asg(P, { "7:day": { work: A }, "7:night": { work: A } }), checked = [], linted = [];
    T.rules.runCheck(T.rules.checkCtx(P, asg, "check", (...args) => checked.push(args)), ["same_day_double"]);
    assert.strictEqual(checked.length, 1); assert.strictEqual(checked[0][0], "SAME_DAY_DOUBLE"); assert.strictEqual(checked[0][4], false);
    T.rules.runLint(T.rules.checkCtx(P, asg, "lint", (...args) => linted.push(args)), ["same_day_double"]);
    assert.deepStrictEqual(linted, [], "the invalid assignment must not contaminate fixed-input facts");
    assert.deepStrictEqual(T.lint(P).filter(v => v.code === "LINT_FIXED_SAME_DAY"), []);
  });
  test("consecutive fixed lint requires both days, deduplicates shifts and ignores discretionary work", () => {
    for (const both of [false, true]) {
      const P = problem({ id: "consecutive_days", day: "all", fixed: { day: { 7: A }, night: { 7: [A, A], ...(both ? { 8: A } : {}) } } });
      const asg = new T.Asg(P, { "7:day": { work: A }, "7:night": { work: A }, "8:night": { work: A } }), linted = [];
      T.rules.runLint(T.rules.checkCtx(P, asg, "lint", (code, args) => linted.push({ code, args })), ["consecutive_days"]);
      assert.strictEqual(linted.length, both ? 1 : 0, "multiple fixed slots on the first day count as one consecutive pair");
      assert.deepStrictEqual(T.lint(P).filter(v => v.code === "LINT_FIXED_CONSECUTIVE").map(({ code, args }) => ({ code, args })), linted);
      if (linted.length) assert.deepStrictEqual(linted[0], { code: "LINT_FIXED_CONSECUTIVE", args: { who: A, day: P.label(7), next: P.label(8) } });
    }
  });
  console.log(`Fixed-input cap boundaries: ${passed} passed, ${failed} failed; ${solves} pinned HiGHS solves`);
  if (failed) process.exitCode = 1;
})().catch(e => { console.error(e.stack || e); process.exitCode = 1; });

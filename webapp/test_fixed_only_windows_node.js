// Only input-forced violations may soften a hard run window. Fictional data only.
// node test_fixed_only_windows_node.js <path/to/highs>
// TOBAN_WEBAPP_ROOT can point at an older checkout to reproduce regressions.
const fs = require("fs"), vm = require("vm"), path = require("path"), assert = require("assert/strict");
const root = process.env.TOBAN_WEBAPP_ROOT || __dirname;
globalThis.T = {};
for (const f of ["i18n.js", "rules-core.js", "model.js", "messages.js", "solver.js", "check.js"])
  vm.runInThisContext(fs.readFileSync(path.join(root, "src", f), "utf8"), { filename: f });
for (const f of fs.readdirSync(path.join(root, "src/rules")).filter(f => f.endsWith(".js")).sort())
  vm.runInThisContext(fs.readFileSync(path.join(root, "src/rules", f), "utf8"), { filename: "rules/" + f });
const names = ["Synthetic Alpha", "Synthetic Beta", "Synthetic Gamma", "Synthetic Delta", "Synthetic Epsilon"], who = names[0];
const days = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i), slots = (ds, k = "night") => ds.map(d => [d, k]);
function fixture(id, opts = {}) {
  const R = { profile: { id: "synthetic-fixed-run-windows", calendar: { holidays: "none", closure: [] },
    roles: [{ id: "S", label: "Staff", refs: [], standby: false }],
    shifts: [{ id: "day", on: opts.dayOn || "all" }, { id: "night", on: opts.nightOn || "all" }], positions: { work: { count: 1 } } },
    doctors: names.map((name, i) => ({ name, team: "S", quota: 0, quals: i || opts.exempt ? ["X"] : [], duty: !i && opts.fixedOnly ? "fixed_only" : "normal" })), name_order: names.slice(),
    rule_states: {}, weights: {}, run_length: { max: opts.cap || 3, min: opts.min || 3, exempt_qual: "X" },
    shift_run_max: { night: opts.cap || 3 }, forbid_sequence: [{ from: "night", to: "any" }] };
  T.fillDefaultRules(R);
  for (const def of T.RULE_DEFS) R.rule_states[def.id] = "off";
  R.rule_states[id] = opts.state || "hard";
  if (opts.ake) R.rule_states.shift_sequence = "hard";
  for (const k of Object.keys(R.weights)) R.weights[k] = 0;
  R.weights.run_length_over = R.weights.shift_run_max = R.weights.run_short = 13; R.weights.fixed_conflict = 29;
  const month = opts.month || 11, prevN = new Date(2026, month - 1, 0).getDate();
  const fixed = {}, prev = new Map();
  for (const [d, k] of opts.fixed || []) (fixed[k] ||= {})[d] = who;
  for (const [d, k] of opts.previous || []) { if (!prev.has(d)) prev.set(d, { date: prevN + d }); prev.get(d)[k] = who; }
  const M = T.normalizeMonth({ year: 2026, month, holidays: [], fixed,
    unavailable_other: (opts.unavailable || []).map(day => ({ name: who, day, part: "allday" })), prev_month: { last_days: [...prev.values()] } }, R);
  const P = new T.Problem(R, M), pin = Object.fromEntries(P.slots.map(([d, k]) => [`${d}:${k}`, { work: names[1 + (d + (k === "night" ? (opts.ake ? 2 : 1) : 0)) % 4], oc: [] }]));
  for (const [d, k] of [...(opts.assigned || []), ...(opts.fixed || []).filter(([d, k]) => d <= P.N && !k.endsWith("_oc") && P.slotExists(d, k))]) pin[`${d}:${k}`] = { work: who, oc: [] };
  return { P, M, pin };
}
let passed = 0, failed = 0;
(async () => {
  const highs = await require(process.argv[2] || "highs")();
  function test(label, f) { try { f(); passed++; console.log("PASS", label); } catch (e) { failed++; console.error("FAIL", label, e.message); } }
  function verify(id, label, opts, want) {
    test(`${id}: ${label}`, () => {
      const { P, pin } = fixture(id, opts), code = id === "run_length_max" ? "RUN_TOO_LONG" : "SHIFT_RUN_TOO_LONG";
      const c = T.check(P, pin), vc = c.VC.filter(x => x.code === code), wc = c.WC.filter(x => x.code === code);
      assert.equal(vc.length, want.v || 0, "manual checker must retain discretionary violations");
      assert.equal(wc.length, want.w || 0, "only a fully forced violating window is allowed");
      assert.equal(T.penalty(P, pin).total, want.cost || 0, "independent penalty must use the same exact window");
      const solved = T.solve(P, highs, { pin, relax: opts.relax || [], timeLimit: 10, mipGap: 0 });
      assert.equal(solved.status, want.status || (want.v || opts.relax?.length ? "Infeasible" : "Optimal"), "pinned real HiGHS status");
      if (solved.asg) assert.equal(solved.objective, want.solveCost ?? want.cost ?? 0, "HiGHS objective must equal independently expected cost");
    });
  }
  for (const id of ["run_length_max", "shift_run_max"]) {
    for (let mask = 0; mask < 16; mask++) {
      const fixed = slots(days(5, 8).filter((_, i) => mask & (1 << i)));
      verify(id, `hard four-day run, fixed mask ${mask}`, { assigned: slots(days(5, 8)), fixed }, mask === 15 ? { w: 1, cost: 29 } : { v: 1 });
    }
    for (const state of ["soft", "off"]) for (const n of [0, 1, 2, 4])
      verify(id, `${state} with ${n} fixed days`, { state, assigned: slots(days(5, 8)), fixed: slots(days(5, 8).slice(0, n)) }, { cost: state === "soft" ? 13 : 0 });
    for (const n of [0, 1, 2])
      verify(id, `two previous constants, ${n} current fixed days`, { assigned: slots([1, 2]), previous: slots([-1, 0]), fixed: slots([1, 2].slice(0, n)) }, n === 2 ? { w: 1, cost: 29 } : { v: 1 });
    for (const n of [0, 1, 2, 3])
      verify(id, `active next-month constant, ${n} current fixed days`, { assigned: slots([28, 29, 30]), fixed: slots([...days(28, 30).slice(0, n), 31]) }, n === 3 ? { w: 1, cost: 29 } : { v: 1 });
    for (const relaxation of ["fixed", "fixed:next"])
      verify(id, `diagnosis releases next boundary: ${relaxation}`, { assigned: slots([28, 29, 30]), fixed: slots([28, 29, 30, 31]), relax: [relaxation] }, { w: 1, cost: 29, status: "Optimal", solveCost: 0 });
    verify(id, "all-fixed window next to a discretionary extension", { assigned: slots(days(5, 9)), fixed: slots(days(5, 8)) }, { v: 1, w: 1, cost: 29 });
    verify(id, "previous-month-only violations are ignored", { previous: slots(days(-4, 0)) }, {});
    verify(id, "fixed-only staff stay exempt", { assigned: slots(days(5, 8)), fixedOnly: true }, {});
    verify(id, "diagnosis removes one fixed input", { assigned: slots(days(5, 8)), fixed: slots(days(5, 8)), relax: ["fixed:night:8"] }, { w: 1, cost: 29 });
    verify(id, "diagnosis removes all current fixed input", { assigned: slots(days(5, 8)), fixed: slots(days(5, 8)), relax: ["fixed"] }, { w: 1, cost: 29 });
    verify(id, "one fixed day cannot excuse a two-day run", { cap: 1, assigned: slots([5, 6]), fixed: slots([5]) }, { v: 1 });
    verify(id, "two fully fixed days allow a two-day run", { cap: 1, assigned: slots([5, 6]), fixed: slots([5, 6]) }, { w: 1, cost: 29 });
  }
  verify("run_length_max", "different shifts still fix workdays", { assigned: slots(days(5, 8)), fixed: slots(days(5, 8), "day") }, { w: 1, cost: 29 });
  verify("run_length_max", "qualified staff remain exempt", { assigned: slots(days(5, 8)), exempt: true }, {});
  verify("shift_run_max", "another shift cannot excuse a night run", { assigned: slots(days(5, 8)), fixed: slots(days(5, 8), "day") }, { v: 1 });
  // Structural checking separately flags stale inactive fixed inputs. Focus on the run row.
  for (const id of ["run_length_max", "shift_run_max"]) verify(id, "inactive day fixed inputs cannot exempt active nights", { dayOn: "none", assigned: slots(days(5, 8)), fixed: slots(days(5, 8), "day") }, { v: 1 });
  for (const id of ["run_length_max", "shift_run_max"]) verify(id, "inactive next-month work is ignored", { cap: 1, assigned: slots([30]), fixed: slots([31], "day"), dayOn: "none" }, {});
  for (const id of ["run_length_max", "shift_run_max"]) {
    verify(id, "inactive weekend next-night cannot extend month-end run", { month: 7, nightOn: "weekdays", assigned: slots([29, 30, 31]), fixed: slots([32]) }, {});
    test(`${id}: OC-only fixed inputs do not relax work rows`, () => {
      const { P, pin } = fixture(id, { assigned: slots(days(5, 8)), fixed: slots(days(5, 8), "day_oc") });
      const c = T.check(P, pin), code = id === "run_length_max" ? "RUN_TOO_LONG" : "SHIFT_RUN_TOO_LONG";
      assert.equal(c.VC.filter(x => x.code === code).length, 1); assert.equal(c.WC.filter(x => x.code === code).length, 0);
      assert.equal(T.penalty(P, pin).total, 0);
      // Remove just OC equalities for a pin test: their presence must never soften work rows.
      const solved = T.solve(P, highs, { pin, relax: ["fixed:dayoc:5", "fixed:dayoc:6", "fixed:dayoc:7", "fixed:dayoc:8"], timeLimit: 10 });
      assert.equal(solved.status, "Infeasible");
    });
    test(`${id}: inactive assignment slots do not fabricate a run`, () => {
      const { P, pin } = fixture(id, { dayOn: "none", assigned: slots([5, 6, 7]) }); pin["8:day"] = { work: who, oc: [] };
      const c = T.check(P, pin), code = id === "run_length_max" ? "RUN_TOO_LONG" : "SHIFT_RUN_TOO_LONG";
      assert(c.VC.some(x => x.code === "SLOT_NOT_EXISTS")); assert.equal(c.VC.filter(x => x.code === code).length, 0);
      assert.equal(T.penalty(P, pin).total, 0);
    });
  }
  // A fixed positive start does not force a preceding or later negative work literal.
  // Minimum run remains a soft cost; all five-day binary patterns validate the start row.
  for (let mask = 0; mask < 32; mask++) for (const allFixed of [false, true]) test(`run_length_min: five-bit pattern ${mask}, fixed ${allFixed}`, () => {
    const assigned = slots(days(5, 9).filter((_, i) => mask & (1 << i)));
    const { P, pin } = fixture("run_length_min", { state: "soft", assigned, fixed: allFixed ? assigned : [] });
    const on = new Set(assigned.map(s => s[0])); let shorts = 0;
    for (let d = 1; d <= 28; d++) if (on.has(d) && !on.has(d - 1) && (!on.has(d + 1) || !on.has(d + 2))) shorts++;
    const solved = T.solve(P, highs, { pin, timeLimit: 10, mipGap: 0 });
    assert.equal(solved.status, "Optimal"); assert.equal(solved.objective, shorts * 13);
    assert.equal(T.penalty(P, pin).total, shorts * 13); assert.equal(T.check(P, pin).VC.length, 0);
  });
  for (const c of [
    { label: "previous work removes day-one start", previous: slots([0]), assigned: slots([1]), expected: 0 },
    { label: "month-end incomplete horizon is ignored", assigned: slots([30]), expected: 0 },
    { label: "unavailability truncation is ignored", assigned: slots([5]), unavailable: [6], expected: 0 },
    { label: "fixed preceding day shifts start without removing short cost", assigned: slots([5]), fixed: slots([4]), expected: 13 },
  ]) test(`run_length_min: ${c.label}`, () => {
    const { P, pin } = fixture("run_length_min", { ...c, state: "soft" });
    const solved = T.solve(P, highs, { pin, timeLimit: 10, mipGap: 0 });
    assert.equal(solved.status, "Optimal"); assert.equal(solved.objective, c.expected); assert.equal(T.penalty(P, pin).total, c.expected);
  });
  // The night-count lower-bound cut is valid only without fixed sequence exceptions.
  // Fixed engagement conservatively disables the cut; it does not waive any short-run cost.
  for (const fixed of [false, true]) test(`run_length_min: night-count cut with fixed engagement ${fixed}`, () => {
    const assigned = fixed ? slots([5, 6]) : slots([5, 8]);
    const { P, pin } = fixture("run_length_min", { state: "soft", ake: true, assigned, fixed: fixed ? assigned : [] });
    const solved = T.solve(P, highs, { pin, timeLimit: 10, mipGap: 0 });
    const expected = fixed ? 13 + 29 : 2 * 13;
    assert.equal(solved.status, "Optimal"); assert.equal(solved.objective, expected); assert.equal(T.penalty(P, pin).total, expected);
    assert.equal(T.check(P, pin).VC.length, 0);
  });
  console.log(`Fixed-only windows: ${passed} passed, ${failed} failed`); process.exitCode = failed ? 1 : 0;
})().catch(e => { console.error(e); process.exitCode = 1; });

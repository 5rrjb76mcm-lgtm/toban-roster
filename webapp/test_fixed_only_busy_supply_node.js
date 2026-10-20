// Busy-day lint must not exclude work supplied by staff exempt from days-off rules.
// Synthetic data only. No saved roster or month is read.
// node test_fixed_only_busy_supply_node.js /absolute/path/to/highs
// TOBAN_WEBAPP_ROOT=/path/to/baseline/webapp runs these assertions against a baseline.
const fs = require("fs"), vm = require("vm"), path = require("path"), assert = require("assert");
const highsPath = process.argv[2];
if (!highsPath) throw new Error("Pass an existing HiGHS package path; solver assertions must not be skipped");
const root = process.env.TOBAN_WEBAPP_ROOT || __dirname;
globalThis.T = {};
for (const f of ["i18n.js", "rules-core.js", "model.js", "messages.js", "solver.js", "check.js"])
  vm.runInThisContext(fs.readFileSync(path.join(root, "src", f), "utf8"), { filename: f });
for (const f of fs.readdirSync(path.join(root, "src/rules")).filter(f => f.endsWith(".js")))
  vm.runInThisContext(fs.readFileSync(path.join(root, "src/rules", f), "utf8"), { filename: "rules/" + f });

const F = "Synthetic Fixed", S = "Synthetic Staff", Q = "Synthetic Qualified";
const days = (from, to) => Array.from({ length: to - from + 1 }, (_, i) => from + i);
const pins = ds => Object.fromEntries(ds.map(d => [d, F]));
const SHORT = "LINT_BUSY_DAYS_TOO_FEW", LONG = "LINT_BUSY_DAYS_TOO_MANY", SHIFT = "LINT_SHIFT_CAPACITY";
const relevant = new Set([SHORT, LONG, SHIFT, "LINT_COMPOSITION_TOO_FEW_PEOPLE", "LINT_COMPOSITION_CAPACITY"]);
function fixture(o = {}) {
  const R = {
    profile: { id: "synthetic-fixed-busy-supply", quota_mode: "absolute",
      roles: [{ id: "Staff", label: "Staff", refs: [], standby: false },
        { id: "Fixed", label: "Fixed", refs: o.reserve ? ["reserve"] : [], standby: false }],
      shifts: [{ id: "day", on: o.twoShifts ? "all" : "none" }, { id: "night", on: "all" }],
      positions: { work: { count: o.count ?? 1 } } },
    doctors: [
      ...Array.from({ length: o.staff ?? 1 }, (_, i) => ({ name: i ? `${S} ${i + 1}` : S, team: "Staff", quota: 0, quals: o.allQualified ? [Q] : [] })),
      ...(o.omitFixed ? [] : [{ name: F, team: "Fixed", duty: "fixed_only", quota: 0, quals: [Q] }])],
    days_off: { min: o.min ?? 7, mode: o.exact ? "exact" : "min", ake_is_off: !o.ake },
    forbid_sequence: o.ake ? [{ from: "night", to: "any" }] : [],
    composition: o.composition || [], weights: { fixed_conflict: 1000, chief_duty: 0 }, rule_states: {}
  };
  T.fillDefaultRules(R);
  for (const d of T.RULE_DEFS) if (d.states.includes("off")) R.rule_states[d.id] = "off";
  Object.assign(R.rule_states, { days_off_min: "hard", fixed_only: o.state || "off",
    same_day_double: "hard", shift_sequence: o.ake ? "hard" : "off", composition: o.composition ? "hard" : "off" });
  const M = T.normalizeMonth({ year: 2026, month: 2, holidays: [], fixed: o.fixed || {},
    allow_chief_duty: !!o.allowed, ...(o.previous ? { prev_month: { last_days: [{ date: 31, night: F }] } } : {}) }, R);
  return new T.Problem(R, M);
}
function assignment(P, fixedDays = days(22, 28)) {
  return Object.fromEntries(P.slots.map(s => [`${s[0]}:${s[1]}`, { work: fixedDays.includes(s[0]) ? F : S, oc: [] }]));
}
const diagnostics = P => T.lint(P).filter(x => relevant.has(x.code));
let passed = 0, failed = 0, solves = 0, finished = false;
// Exit guard and watchdog like the other regressions: an early exit(0) or an unsettled promise must not look like success.
const watchdog = setTimeout(() => { console.error("FAIL fixed-only busy supply regression timed out"); process.exit(1); }, 180000);
process.on("exit", () => { if (!finished || passed + failed !== 48 || solves !== 17 || failed) { console.error(`Incomplete busy-supply regression: completed=${passed + failed}, passed=${passed}, failed=${failed}, solves=${solves}, finished=${finished}`); process.exitCode = 1; } });
const solveCases = [];
function test(label, fn) {
  try { fn(); passed++; console.log("ok  ", label); }
  catch (e) { failed++; console.error("FAIL", label, "\n    ", e.stack || e); }
}
function feasible(label, o, ds) {
  test(label, () => {
    const P = fixture(o), asg = assignment(P, ds), before = JSON.stringify({ rules: P.rules, month: P.m, asg });
    assert.strictEqual(P.isFixedOnly(F), true);
    assert.strictEqual(P.isExempt(F), true, "lint-only fix preserves the existing solver/model exemption");
    assert.deepStrictEqual(T.check(P, asg).VC, [], "independent feasible witness");
    assert.deepStrictEqual(diagnostics(P), [], "a feasible witness must not receive a capacity impossibility diagnosis");
    assert.strictEqual(JSON.stringify({ rules: P.rules, month: P.m, asg }), before, "no input mutation");
  });
  // Keep solver assertions separate, so baseline lint failures cannot prevent them.
  solveCases.push({ label, o, ds, status: "Optimal" });
}

// 28 daily slots; ordinary worker can supply 21 days, fixed-only/off fills the other 7.
// Baseline: supply=21, need=28, diff=7, although the checker accepts this witness.
feasible("off/no fixed: seven discretionary days close the reported shortage", {});
feasible("off/no fixed: rest exemption permits all 28 days, not a false 21-day ceiling", { staff: 0 }, days(1, 28));
feasible("off/exact: optional exempt capacity is not mandatory work", { exact: true });
feasible("hard/seven fixed shifts: fixed work also supplies the seven days", { state: "hard", fixed: { night: pins(days(22, 28)) } });
feasible("hard/all fixed: exempt work is not capped by ordinary days off", { state: "hard", fixed: { night: pins(days(1, 28)) } }, days(1, 28));
feasible("off/qualified supplier: shared composition headcount and capacity include them", {
  composition: [{ shift: "night", qual: Q, min: 1 }]
}, days(1, 28));
feasible("hard/qualified fixed supplier: shared composition capacity includes fixed work", {
  state: "hard", fixed: { night: pins(days(1, 28)) }, composition: [{ shift: "night", qual: Q, min: 1 }]
}, days(1, 28));
feasible("hard/fixed composition max-zero exception still supplies shift capacity", {
  state: "hard", fixed: { night: pins(days(1, 28)) }, composition: [{ shift: "night", qual: Q, max: 0 }]
}, days(1, 28));
feasible("hard/fixed same-day doubles count both filled slots", {
  state: "hard", staff: 0, twoShifts: true, fixed: { day: pins(days(1, 28)), night: pins(days(1, 28)) }
}, days(1, 28));
feasible("hard/fixed night-sequence overlaps keep a conservative weighted upper", {
  state: "hard", staff: 0, ake: true, fixed: { night: pins(days(1, 28)) }
}, days(1, 28));
feasible("hard/exempt previous night does not consume ordinary days-off capacity", { previous: true, ake: true,
  state: "hard", staff: 0, fixed: { night: pins(days(1, 28)) } }, days(1, 28));
feasible("reserve/allowed: one fixed shift supplies the missing day", {
  state: "hard", min: 1, reserve: true, allowed: true, fixed: { night: pins([28]) }
}, [28]);

for (const [label, o, diff] of [
  ["hard/no fixed retains genuine seven-day shortage", { state: "hard" }, 7],
  ["hard/six fixed retains one-day shortage", { state: "hard", fixed: { night: pins(days(23, 28)) } }, 1],
  ["hard/OC, next-month and inactive-shift pins add no work supply", { state: "hard", fixed: {
    night_oc: { 1: [F] }, night: { 29: F }, day: { 1: F }
  } }, 7],
  ["reserve/off is still limited to one work slot", { reserve: true, allowed: true, min: 7 }, 6],
  ["reserve/not allowed supplies no work", { reserve: true, min: 1 }, 1],
  ["ordinary-only shortage remains unchanged", { omitFixed: true }, 7]
]) {
  // normalizeMonth fills o.fixed in place (adds night_oc etc.), so decide before the lint case runs.
  const solvable = !o.fixed?.night_oc;
  test(label, () => {
    const out = diagnostics(fixture(o)), warning = out.find(x => x.code === SHORT);
    assert.ok(warning, "retain the real shortage diagnosis");
    assert.strictEqual(warning.args.diff, diff);
    assert.ok(out.some(x => x.code === SHIFT), "retain the shift-capacity diagnosis");
  });
  if (solvable) solveCases.push({ label, o, status: "Infeasible" });
}
test("exact/genuine ordinary excess remains even with an exempt off supplier", () => {
  const P = fixture({ staff: 2, exact: true }), out = diagnostics(P), warning = out.find(x => x.code === LONG);
  assert.ok(warning); assert.strictEqual(warning.args.supply, 42); assert.strictEqual(warning.args.diff, 14);
  assert.strictEqual(warning.args.people, 2); assert.ok(!out.some(x => x.code === SHORT));
});
test("hard/insufficient qualified fixed capacity retains composition warning", () => {
  const out = diagnostics(fixture({ state: "hard", fixed: { night: pins(days(22, 28)) }, composition: [{ shift: "night", qual: Q, min: 1 }] }));
  const warning = out.find(x => x.code === "LINT_COMPOSITION_CAPACITY");
  assert.ok(warning); assert.strictEqual(warning.args.need, 28); assert.strictEqual(warning.args.cap, 7);
});
test("ordinary-only feasible exact allocation remains free of capacity warnings", () => {
  const P = fixture({ omitFixed: true, staff: 2, min: 14, exact: true });
  const asg = Object.fromEntries(P.slots.map(s => [`${s[0]}:${s[1]}`, { work: s[0] <= 14 ? S : `${S} 2`, oc: [] }]));
  assert.deepStrictEqual(T.check(P, asg).VC, []); assert.deepStrictEqual(diagnostics(P), []);
});
test("ordinary-only exact excess retains the original amount and headcount", () => {
  const warning = diagnostics(fixture({ omitFixed: true, staff: 2, exact: true })).find(x => x.code === LONG);
  assert.ok(warning); assert.strictEqual(warning.args.supply, 42); assert.strictEqual(warning.args.diff, 14);
  assert.strictEqual(warning.args.people, 2);
});
test("off/zero fixed is still an exempt and eligible discretionary supplier", () => {
  const P = fixture(), C = T.rules.checkCtx(P, new T.Asg(P, {}), "lint", () => {});
  assert.strictEqual(P.fixedWorkCount(F), 0);
  assert.strictEqual(P.isExempt(F), true); assert.strictEqual(C.canWork(F, [1, "night"]), true);
  assert.strictEqual(P.runApplies(F), false, "retained exemption is not migrated to ordinary run limits");
});
for (const state of ["off", "hard"]) for (const fixed of [false, true]) test(`explainSlot/${state}/${fixed ? "one fixed" : "zero fixed"}: exclude only when hard`, () => {
  const P = fixture({ state, fixed: fixed ? { night: pins([1]) } : {} });
  const reasons = T.rules.explainSlot(P, [2, "night"], F).filter(x => x.code === "FIXED_ONLY_CANDIDATE");
  assert.strictEqual(reasons.length, state === "hard" ? 1 : 0);
});
test("explainSlot/hard: an explicitly fixed work slot is not excluded", () => {
  const P = fixture({ state: "hard", fixed: { night: pins([1]) } });
  assert.ok(!T.rules.explainSlot(P, [1, "night"], F).some(x => x.code === "FIXED_ONLY_CANDIDATE"));
});
const NOTE = "BUSY_DAYS_FIXED_ONLY_OFF_NOTE";
const summary = P => T.rulesSummary(P).flatMap(g => g.items).join("\n");
test("capacity assumption is visible in the summary without creating a lint warning", () => {
  const P = fixture(), note = P.msg(NOTE);
  assert.ok(note.includes("固定以外の日を数えます"));
  assert.ok(note.includes("施設の部品が課す制限は含まない"));
  assert.ok(note.includes("実際に配置できる日数を保証しません"));
  assert.ok(summary(P).includes(note), "show the assumption even when the shortage disappears");
  assert.deepStrictEqual(T.lint(P), [], "an explanation alone is not an input contradiction");
  for (const o of [{ state: "hard" }, { omitFixed: true }, { reserve: true }])
    assert.ok(!summary(fixture(o)).includes(note), "do not claim off-state supply when none is included");
});
test("all affected capacity diagnostics carry the assumption exactly once", () => {
  const seen = new Set();
  for (const allQualified of [false, true]) {
    const P = fixture({ count: 2, allQualified, composition: [{ shift: "night", qual: Q, min: 2 }] }), note = P.msg(NOTE);
    assert.ok(note.includes("固定以外の日を数えます"));
    for (let repeat = 0; repeat < 2; repeat++) for (const item of diagnostics(P)) {
      assert.strictEqual(item.msg.split(note).length - 1, 1, `${item.code}: append once without mutating cached text`);
      seen.add(item.code);
    }
  }
  assert.deepStrictEqual([...seen].sort(), [SHORT, SHIFT, "LINT_COMPOSITION_TOO_FEW_PEOPLE", "LINT_COMPOSITION_CAPACITY"].sort());
});
test("capacity assumption has an English fallback and no untranslated placeholder", () => {
  T.registerLang({ code: "ja", name: "Japanese" }); T.registerLang({ code: "en", name: "English" }); T.setLang("en");
  try {
    const P = fixture({ count: 2 }), note = P.msg(NOTE);
    assert.ok(note.includes("non-fixed shifts")); assert.ok(note.includes("Facility plug-in restrictions are not included"));
    assert.ok(note.includes("does not guarantee an achievable schedule"));
    assert.ok(summary(P).includes(note)); assert.ok(diagnostics(P).every(x => x.msg.includes(note)));
  } finally { T.setLang("ja"); }
});

(async () => {
  assert.strictEqual(passed + failed, 31, "all lint/check/explanation cases must execute");
  assert.strictEqual(solveCases.length, 17, "all actual-solver cases must be scheduled");
  const highs = await require(highsPath)();
  for (const { label, o, ds, status } of solveCases) test(`HiGHS: ${label}`, () => {
    const P = fixture(o), opts = status === "Optimal" ? { pin: assignment(P, ds) } : {};
    const r = T.solve(P, highs, { ...opts, timeLimit: 10, mipGap: 0 }); solves++;
    assert.strictEqual(r.status, status);
    if (r.asg) { assert.deepStrictEqual(T.check(P, r.asg).VC, []); assert.strictEqual(T.penalty(P, r.asg).total, r.objective); }
  });
  assert.strictEqual(solves, 17, "solver errors cannot silently reduce coverage");
  assert.strictEqual(passed + failed, 48, "all regression cases must execute");
  finished = true; clearTimeout(watchdog);
  console.log(`fixed-only busy supply: ${passed} passed, ${failed} failed; ${solves} solver cases`);
  if (failed) process.exitCode = 1;
})().catch(e => { clearTimeout(watchdog); console.error(e); process.exitCode = 1; });

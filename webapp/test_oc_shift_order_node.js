// Chronological OC adjacency must not depend on profile.shifts array order.
// Synthetic data only. Static-authored candidate, not executed during preparation.
// node test_oc_shift_order_node.js /path/to/highs [source-webapp-directory]
// The optional source path permits a separate pristine-baseline failure run.
// Run under an external process timeout; the in-process timer cannot interrupt synchronous solves.
const fs = require("fs"), path = require("path"), vm = require("vm"), assert = require("assert");
const EXPECTED = 128, source = process.argv[3] || __dirname;
const counts = { registered: 0, started: 0, completed: 0, passed: 0 };
let finished = false;
process.on("exit", code => {
  if (code === 0 && (!finished || Object.values(counts).some(n => n !== EXPECTED))) {
    console.error("FAIL incomplete OC shift-order regression", counts); process.exitCode = 1;
  }
});
const watchdog = setTimeout(() => {
  console.error("FAIL OC shift-order regression exceeded 300 seconds", counts); process.exit(1);
}, 300000);
watchdog.unref();
globalThis.T = {};
for (const file of ["i18n.js", "rules-core.js", "model.js", "messages.js", "solver.js", "check.js"])
  vm.runInThisContext(fs.readFileSync(path.join(source, "src", file), "utf8"), { filename: file });
for (const file of fs.readdirSync(path.join(source, "src/rules")).filter(f => f.endsWith(".js")).sort())
  vm.runInThisContext(fs.readFileSync(path.join(source, "src/rules", file), "utf8"), { filename: "rules/" + file });
for (const file of fs.readdirSync(path.join(source, "lang")).filter(f => f.endsWith(".json")))
  T.registerLang(JSON.parse(fs.readFileSync(path.join(source, "lang", file), "utf8")));
T.DEFAULT_RULES = JSON.parse(fs.readFileSync(path.join(source, "data/rules.json"), "utf8"));
const TARGET = "Synthetic Target", clone = x => JSON.parse(JSON.stringify(x));
const filler = (d, k, mode) => `Synthetic ${d % 3} ${k} ${mode}`;
const names = [TARGET, "Synthetic Previous W", "Synthetic Previous O"];
for (let d = 0; d < 3; d++) for (const k of ["day", "night"]) for (const mode of ["W", "O"]) names.push(filler(d, k, mode));
const scenarios = [
  { id: "month night to next day", dayOn: "all", a: [5, "night"], b: [6, "day"], adjacent: true },
  { id: "month day to next night is not adjacent", dayOn: "all", a: [5, "day"], b: [6, "night"], adjacent: false },
  { id: "night to night across day slot", dayOn: "all", a: [5, "night"], b: [6, "night"], adjacent: true },
  { id: "same day is excluded", dayOn: "all", a: [5, "day"], b: [5, "night"], adjacent: false },
  { id: "previous month to day one", dayOn: "all", a: [0, "night"], b: [1, "day"], adjacent: true },
  { id: "next month day fixed", dayOn: "all", a: [30, "night"], b: [31, "day"], adjacent: true },
  { id: "night-only control", dayOn: "none", a: [5, "night"], b: [6, "night"], adjacent: true },
  { id: "weekday-day control", dayOn: "weekdays", a: [4, "night"], b: [5, "day"], adjacent: true },
  { id: "partial profile Friday to Saturday", dayOn: "off_days", a: [6, "night"], b: [7, "day"], adjacent: true },
  { id: "partial profile previous month to Sunday", dayOn: "off_days", a: [0, "night"], b: [1, "day"], adjacent: true },
  { id: "hard consecutive fixed-only exception", dayOn: "all", a: [5, "night"], b: [6, "day"], adjacent: true, hard: true },
  { id: "same weekend charge exemption", dayOn: "off_days", a: [7, "night"], b: [8, "day"], adjacent: true, charge: true },
  { id: "previous weekend charge exemption", dayOn: "off_days", a: [0, "night"], b: [1, "day"], adjacent: true, charge: true },
  { id: "disabled OC penalty control", dayOn: "all", a: [5, "night"], b: [6, "day"], adjacent: true, off: true }
];
function fixture(spec, layout, aMode, bMode) {
  const day = { id: "day", on: spec.dayOn, label: { en: "Synthetic Day", ja: "架空日勤" } };
  const night = { id: "night", on: "all", label: { en: "Synthetic Night", ja: "架空夜勤" }, local_metadata: { keep: 7 } };
  const shifts = layout === "partial-night" ? [night] : layout === "night-first" ? [night, day] : [day, night];
  const rules = { profile: { id: "synthetic-shift-order", roles: [{ id: "S", label: "Synthetic Staff", standby: true, refs: spec.charge ? ["charge"] : [] }], shifts },
    doctors: names.map(name => ({ name, team: "S", quota: 0 })), oncall_requirement: { S: { S: 1 } }, weights: {}, rule_states: {} };
  T.fillDefaultRules(rules);
  for (const d of T.RULE_DEFS) if (d.states.includes("off")) rules.rule_states[d.id] = "off";
  rules.rule_states.oncall = "hard"; rules.rule_states.oc_consecutive = spec.off ? "off" : "soft";
  if (spec.hard) rules.rule_states.consecutive_days = "hard";
  for (const key of Object.keys(rules.weights)) rules.weights[key] = 0;
  rules.weights.oc_consecutive = 6; rules.weights.fixed_conflict = 50;
  const month = { year: 2026, month: 11, holidays: [], fixed: { day: {}, night: {}, day_oc: {}, night_oc: {} } };
  const pin = {};
  // Construct assignments in explicit civil-time order, independently of P.allSlots.
  for (let d = 1; d <= 30; d++) {
    const weekend = [0, 6].includes(new Date(2026, 10, d).getDay());
    if (spec.dayOn === "all" || spec.dayOn === "weekdays" && !weekend || spec.dayOn === "off_days" && weekend)
      pin[`${d}:day`] = { work: filler(d, "day", "W"), oc: [filler(d, "day", "O")] };
    pin[`${d}:night`] = { work: filler(d, "night", "W"), oc: [filler(d, "night", "O")] };
  }
  for (const [slot, mode] of [[spec.a, aMode], [spec.b, bMode]]) {
    const [d, k] = slot;
    if (d === 0) month.prev_month = { last_days: [{ date: 31, night: mode === "W" ? TARGET : "Synthetic Previous W", night_oc: [mode === "O" ? TARGET : "Synthetic Previous O"] }] };
    else if (d === 31) month.fixed[k + (mode === "O" ? "_oc" : "")][d] = mode === "W" ? TARGET : [TARGET];
    else {
      assert(pin[`${d}:${k}`], "test endpoint must be an existing shift");
      if (mode === "W") pin[`${d}:${k}`].work = TARGET; else pin[`${d}:${k}`].oc = [TARGET];
      if (spec.hard && aMode === "W" && bMode === "W") month.fixed[k][d] = TARGET;
    }
  }
  const normalized = T.normalizeMonth(month, rules);
  const raw = JSON.stringify({ rules, month: normalized });
  const P = new T.Problem(rules, normalized);
  return { rules, month: normalized, raw, P, pin };
}
const cases = [];
for (const spec of scenarios) for (const layout of (spec.dayOn === "off_days" ? ["day-first", "night-first", "partial-night"] : ["day-first", "night-first"]))
  for (const [a, b] of [["W", "W"], ["W", "O"], ["O", "W"], ["O", "O"]]) cases.push({ spec, layout, a, b });
counts.registered = cases.length;
cases.forEach((testCase, index) => {
  testCase.caseId = `C02-${String(index + 1).padStart(3, "0")}`;
  console.log("REGISTER " + testCase.caseId + " " + JSON.stringify(`${testCase.spec.id} / ${testCase.layout} / ${testCase.a}->${testCase.b}`));
});
(async () => {
  assert.strictEqual(counts.registered, EXPECTED, "registered case count");
  assert(process.argv[2], "Pass an existing HiGHS package path; this script installs nothing");
  const highs = await require(process.argv[2])();
  for (const { caseId, spec, layout, a, b } of cases) {
    const label = `${spec.id} / ${layout} / ${a}->${b}`; counts.started++;
    console.log("CASE_START " + caseId + " " + JSON.stringify(label));
    const passedBefore = counts.passed;
    try {
      const { rules, month, raw, P, pin } = fixture(spec, layout, a, b);
      const expectedOC = spec.adjacent && !spec.charge && !spec.off && !(a === "W" && b === "W") ? 6 : 0;
      const expectedFixed = spec.hard && a === "W" && b === "W" ? 50 : 0;
      const checked = T.check(P, pin), score = T.penalty(P, pin);
      assert.deepStrictEqual(checked.VC, [], label + ": hard-rule check");
      assert.strictEqual(checked.WC.length, expectedFixed ? 1 : 0, label + ": tolerated fixed-only conflict");
      assert.strictEqual(score.items.oc_consecutive || 0, expectedOC, label + ": independent civil-time OC expectation");
      assert.strictEqual(score.total, expectedOC + expectedFixed, label + ": full independently recounted score");
      const result = T.solve(P, highs, { pin, timeLimit: 5, mipGap: 0 });
      assert.strictEqual(result.status, "Optimal", label + ": pinned solver status");
      assert(result.asg, label + ": pinned assignment exists");
      assert(Math.abs(result.objective - expectedOC - expectedFixed) < 1e-6, label + ": solver objective");
      assert.deepStrictEqual(T.check(P, result.asg).VC, [], label + ": solver result passes independent check");
      for (const lang of ["ja", "en"]) {
        T.setLang(lang); const lines = [];
        T.rules.runReport(T.rules.checkCtx(P, checked.A, "report", line => lines.push(line)), ["oc_consecutive"]);
        const targetLine = lines.find(line => line.includes(TARGET + ":"));
        assert.strictEqual(!!targetLine, expectedOC > 0, label + ": " + lang + " report membership");
        if (expectedOC) for (const [d, k] of [spec.a, spec.b])
          assert(targetLine.includes(P.label(d) + P.shiftLabel(k)), label + ": " + lang + " report endpoint");
      }
      const chronological = clone(P.prevSlots);
      for (let d = 1; d <= P.N; d++) for (const k of ["day", "night"]) if (P.slotExists(d, k)) chronological.push([d, k]);
      assert.deepStrictEqual(P.allSlots, chronological, label + ": combined timeline is chronological");
      assert.deepStrictEqual([...P.allSlotSet].sort(), [...new Set(P.prevSlots.concat(P.slots).map(T.Problem.key))].sort(), label + ": membership unchanged");
      assert.deepStrictEqual(P.shifts.map(sh => sh.id), layout === "day-first" ? ["day", "night"] : ["night", "day"], label + ": normalized display order retained");
      for (let d = 1; d <= P.N; d++) assert.deepStrictEqual(P.slots.filter(s => s[0] === d).map(s => s[1]), P.shifts.filter(sh => P.slotExists(d, sh.id)).map(sh => sh.id), label + ": current-slot display order retained");
      assert.strictEqual(JSON.stringify({ rules, month }), raw, label + ": accepted raw input unchanged");
      counts.passed++; console.log("PASS " + label);
    } catch (error) { console.error("FAIL " + label + "\n" + error.stack); }
    finally {
      counts.completed++;
      console.log("CASE_END " + caseId + " " + (counts.passed > passedBefore ? "PASS" : "FAIL") + " " + JSON.stringify(label));
    }
  }
  finished = true; clearTimeout(watchdog);
  console.log("OC shift-order regression", counts);
  if (Object.values(counts).some(n => n !== EXPECTED)) process.exitCode = 1;
})().catch(error => { clearTimeout(watchdog); console.error(error.stack, counts); process.exitCode = 1; });

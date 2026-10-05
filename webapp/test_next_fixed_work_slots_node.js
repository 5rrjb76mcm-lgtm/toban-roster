// Only actual next-month slots count as work for rest/sequence rules. Synthetic data only.
// node test_next_fixed_work_slots_node.js <path/to/highs>
// TOBAN_WEBAPP_ROOT may point at an unmodified checkout to reproduce the regression.
const fs = require("fs"), vm = require("vm"), path = require("path"), assert = require("assert/strict");
const root = process.env.TOBAN_WEBAPP_ROOT || __dirname;
globalThis.T = {};
const run = f => vm.runInThisContext(fs.readFileSync(path.join(root, "src", f), "utf8"), { filename: f });
for (const f of ["i18n.js", "rules-core.js", "model.js", "messages.js", "solver.js", "check.js"]) run(f);
for (const f of fs.readdirSync(path.join(root, "src/rules")).filter(f => f.endsWith(".js")).sort()) run("rules/" + f);
const names = ["Synthetic Alpha", "Synthetic Beta", "Synthetic Gamma", "Synthetic Delta", "Synthetic Epsilon"], who = names[0];
const layouts = [
  { label: "weekday night before weekend", month: 7, day: "none", night: "weekdays", source: "night", next: "night", active: false },
  { label: "off-day night before weekday", month: 5, day: "none", night: "off_days", source: "night", next: "night", active: false },
  { label: "weekday night before explicit holiday", month: 4, day: "none", night: "weekdays", source: "night", next: "night", holiday: true, active: false },
  { label: "disabled day beside active night", month: 7, day: "none", night: "all", source: "night", next: "day", active: false },
  { label: "absent weekend night beside active day", month: 7, day: "all", night: "weekdays", source: "day", next: "night", active: false },
  { label: "enabled daily night", month: 7, day: "none", night: "all", source: "night", next: "night", active: true },
  { label: "enabled weekday night", month: 4, day: "none", night: "weekdays", source: "night", next: "night", active: true },
  { label: "enabled off-day night", month: 1, day: "none", night: "off_days", source: "night", next: "night", active: true },
  { label: "enabled daily day", month: 7, day: "all", night: "all", source: "day", next: "day", active: true },
];
const rules = [
  { id: "consecutive_days", code: "CONSECUTIVE_NEXT_MONTH", offset: 0 },
  { id: "run_length_max", code: "RUN_TOO_LONG", offset: 0 },
  { id: "shift_sequence", code: "SHIFT_SEQUENCE", offset: 0 },
  { id: "shift_run_max", code: "SHIFT_RUN_TOO_LONG", offset: 0 },
  { id: "rest_after_ake", code: "REST_AFTER_AKE", offset: 1 },
  { id: "work_gap", offset: 1, weight: 11 },
  { id: "work_gap", offset: 2, weight: 7 },
];
function fixture(layout, rule, state, fixed = false, any = true) {
  const R = { profile: { id: "synthetic-next-work-slots", calendar: { holidays: "none", closure: [] },
    roles: [{ id: "S", label: "Staff", refs: [], standby: false }],
    shifts: [{ id: "day", on: layout.day }, { id: "night", on: layout.night }], positions: { work: { count: 1 } } },
    doctors: names.map(name => ({ name, team: "S", quota: 0 })), name_order: names.slice(),
    rule_states: {}, weights: {}, run_length: { max: 1 }, shift_run_max: { [layout.source]: 1 },
    forbid_sequence: [{ from: layout.source, to: any ? "any" : layout.next }] };
  T.fillDefaultRules(R);
  for (const def of T.RULE_DEFS) R.rule_states[def.id] = "off";
  R.rule_states[rule.id] = state;
  for (const k of Object.keys(R.weights)) R.weights[k] = 0;
  R.weights[T.RULE_BY_ID[rule.id].weight] = 13;
  R.weights.work_gap_1 = 11; R.weights.work_gap_2 = 7; R.weights.fixed_conflict = 29;
  const N = new Date(2026, layout.month, 0).getDate(), d = N - rule.offset;
  const nextFixed = { [layout.next]: { [N + 1]: who } };
  if (fixed) (nextFixed[layout.source] ||= {})[d] = who;
  const M = T.normalizeMonth({ year: 2026, month: layout.month, holidays: [], next_month_first_day_is_holiday: !!layout.holiday, fixed: nextFixed }, R);
  const P = new T.Problem(R, M);
  assert.equal(P.nextSlotExists(layout.next), layout.active);
  const pin = Object.fromEntries(P.slots.map(s => [T.Problem.key(s), { work: names[1 + s[0] % 4], oc: [] }]));
  if (!P.slotExists(d, layout.source)) return null;
  pin[`${d}:${layout.source}`].work = who;
  return { P, M, pin, d };
}
let passed = 0, failed = 0;
(async () => {
  const highs = await require(process.argv[2] || "highs")();
  const test = (label, f) => { try { f(); passed++; console.log("PASS", label); } catch (e) { failed++; console.error("FAIL", label, e.message); } };
  for (const layout of layouts) for (const rule of rules) {
    if (rule.id === "rest_after_ake" && layout.source !== "night") continue;
    const states = rule.id === "work_gap" ? ["soft"] : ["hard", "soft"];
    for (const state of states) for (const fixed of state === "hard" ? [false, true] : [false]) {
      const f = fixture(layout, rule, state, fixed); if (!f) continue;
      test(`${rule.id}/${rule.offset} ${state}${fixed ? " fixed" : ""}: ${layout.label}`, () => {
        const { P, M, pin } = f;
        const conflict = layout.active && (rule.id !== "shift_run_max" || layout.source === layout.next);
        const expectInfeasible = conflict && state === "hard" && !fixed;
        const solved = T.solve(P, highs, { pin, timeLimit: 10, mipGap: 0 });
        assert.equal(solved.status, expectInfeasible ? "Infeasible" : "Optimal", "phantom next-month work must not block a valid roster");
        const checked = T.check(P, pin), expected = conflict ? (state === "hard" ? (fixed ? 29 : 0) : (rule.weight || 13)) : 0;
        assert.deepEqual(checked.VC.map(x => x.code), expectInfeasible ? [rule.code] : []);
        assert.deepEqual(checked.WC.map(x => x.code), conflict && state === "hard" && fixed ? [rule.code] : []);
        assert.equal(T.penalty(P, pin).total, expected, "independent penalty");
        if (!expectInfeasible) assert.equal(solved.objective, expected, "solver objective must equal the independently expected penalty");
        assert.equal(P.nextFixedWorks(who), layout.active, "day-level next work must use real slots");
        assert.deepEqual(P.nextFixed[layout.next], [who], "preserve raw future input for correction or later layout changes");
        assert.equal(M.fixed[layout.next][P.N + 1], who);
        if (rule.id === "work_gap") {
          const lines = [], ctx = T.rules.checkCtx(P, new T.Asg(P, pin), "report", line => lines.push(line));
          T.RULE_BY_ID.work_gap.report(ctx);
          assert.equal(lines.length, conflict ? 1 : 0, "work-gap report must not announce a phantom pair");
        }
      });
    }
  }
  for (const layout of layouts) test(`explicit shift transition: ${layout.label}`, () => {
    const rule = rules.find(r => r.id === "shift_sequence"), { P, pin } = fixture(layout, rule, "soft", false, false);
    const solved = T.solve(P, highs, { pin, timeLimit: 10, mipGap: 0 });
    assert.equal(solved.status, "Optimal");
    assert.equal(solved.objective, layout.active ? 13 : 0);
    assert.equal(T.penalty(P, pin).total, layout.active ? 13 : 0);
  });
  test("a stale next day cannot mislabel a real next-night transition", () => {
    const layout = layouts.find(x => x.label === "enabled daily night"), rule = rules.find(r => r.id === "shift_sequence");
    const { P, pin } = fixture(layout, rule, "hard");
    P.nextFixed.day = [who]; // Old day input remains stored after its shift is disabled.
    const violations = T.check(P, pin).VC;
    assert.equal(violations.length, 1); assert.equal(violations[0].args.to, P.shiftLabel("night"));
  });
  console.log(`Next fixed work slots: ${passed} passed, ${failed} failed`);
  process.exitCode = failed ? 1 : 0;
})().catch(e => { console.error(e); process.exitCode = 1; });

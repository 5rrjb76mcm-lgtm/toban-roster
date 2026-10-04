// Next-month period charge follows the first actual slot. All names and rosters are synthetic.
// node test_period_charge_next_slot_node.js <path/to/highs>
// TOBAN_WEBAPP_ROOT can point at a read-only base checkout to demonstrate the regression.
const fs = require("fs"), vm = require("vm"), path = require("path"), assert = require("assert/strict");
const root = process.env.TOBAN_WEBAPP_ROOT || __dirname;
globalThis.T = {};
const run = f => vm.runInThisContext(fs.readFileSync(path.join(root, "src", f), "utf8"), { filename: f });
for (const f of ["i18n.js", "rules-core.js", "model.js", "messages.js", "solver.js", "check.js"]) run(f);
for (const f of fs.readdirSync(path.join(root, "src/rules")).filter(f => f.endsWith(".js")).sort()) run("rules/" + f);
for (const f of fs.readdirSync(path.join(root, "lang")).filter(f => f.endsWith(".json"))) T.registerLang(JSON.parse(fs.readFileSync(path.join(root, "lang", f), "utf8")));
T.setLang("ja");
T.DEFAULT_RULES = JSON.parse(fs.readFileSync(path.join(root, "data/rules.json"), "utf8"));
const [a, b, staff] = ["Synthetic Alpha", "Synthetic Beta", "Synthetic Staff"], names = [a, b, staff];
function fixture(day = "none", fixed = {}, month = 10, night = "all") {
  const R = {
    profile: { id: "synthetic-next-period-slot", roles: [
      { id: "I", label: "Charge", refs: ["charge"], standby: true },
      { id: "S", label: "Staff", refs: [], standby: false },
      { id: "Y", label: "Junior", refs: ["junior"], standby: false },
    ], shifts: [{ id: "day", label: { ja: "日勤", en: "Day" }, on: day }, { id: "night", label: { ja: "夜勤", en: "Night" }, on: night }], positions: { work: { count: 1 } } },
    doctors: names.map(name => ({ name, team: name === staff ? "S" : "I", quota: 0, years: 1 })), name_order: names.slice(),
    oncall_requirement: { I: { I: 0 }, S: { I: 1 }, Y: { I: 0 } },
    rule_states: Object.assign(Object.fromEntries(T.RULE_DEFS.map(d => [d.id, "off"])), { oncall: "hard", period_charge: "hard" }),
    weights: {},
  };
  T.fillDefaultRules(R); for (const k in R.weights) R.weights[k] = 0;
  const M = T.normalizeMonth({ year: 2026, month, holidays: [], fixed }, R);
  const P = new T.Problem(R, M);
  const pin = Object.fromEntries(P.slots.map(s => [T.Problem.key(s), { work: a, oc: [] }]));
  return { R, M, P, pin };
}
let passed = 0, failed = 0;
(async () => {
  const highs = await require(process.argv[2] || "highs")();
  const test = (label, f) => { try { f(); passed++; console.log("PASS", label); } catch (e) { failed++; console.error("FAIL", label, e.message); } };
  const consistent = (P, pin) => {
    const solved = T.solve(P, highs, { pin, timeLimit: 10, mipGap: 0 });
    assert.equal(solved.status, "Optimal"); assert.ok(solved.asg);
    assert.deepEqual(T.check(P, solved.asg).VC, [], "independent check");
    assert.equal(solved.objective, T.penalty(P, solved.asg).total, "solver/penalty agreement");
    return solved;
  };
  const nextLink = (P, pin) => T.check(P, pin).VC.filter(x => x.code === "PERIOD_CHARGE_NEXT_LINK");
  T.app = { state: {}, names: () => names.slice(), iNames: () => [a, b], daysIn: (y, m) => new Date(y, m, 0).getDate() };
  run("app-month.js");
  // 2026-10-31 is Saturday; 2026-11-1 is Sunday. With no Sunday day slot,
  // its fixed night worker/on-call member establishes Sunday's charge.
  for (const day of ["none", "weekdays"]) for (const oc of [false, true]) {
    const tag = `${day} day slots, next first-slot ${oc ? "night OC" : "night worker"}`;
    const fixed = oc ? { night: { 32: staff }, night_oc: { 32: [b] } } : { night: { 32: b } };
    test(`${tag}: a conflicting month-end charge is rejected`, () => {
      const { P, pin } = fixture(day, fixed);
      assert.equal(P.nextFirstSlotKind(), "night"); assert.equal(P.lastCrossingPeriod().days[0], 31);
      assert.deepEqual(T.lint(P), []);
      assert.equal(nextLink(P, pin).length, 1, "checker must identify the ignored future first slot");
      assert.equal(T.solve(P, highs, { pin, timeLimit: 10 }).status, "Infeasible");
    });
    test(`${tag}: matching solve and next-month carryover stay feasible`, () => {
      const { R, M, P, pin } = fixture(day, fixed); pin["31:night"].work = b;
      consistent(P, pin);
      const result = consistent(P);
      assert.equal(result.asg["31:night"].work, b, "un-pinned solve honors next month's first slot");
      T.app.state.rules = R;
      const next = T.app.fromPrevious({ rules: R, month: M, result }, 2026, 11);
      assert.equal(next.fixed.weekend_charge[1], b);
      const Q = new T.Problem(R, next);
      assert.ok(!T.lint(Q).some(x => x.code === "LINT_FIXED_CHARGE_VS_FIRST_SLOT"));
      consistent(Q);
    });
  }
  for (const day of ["all", "off_days"]) for (const oc of [false, true]) test(`${day} day slots: first-slot day ${oc ? "OC" : "worker"} still controls the boundary`, () => {
    const fixed = oc ? { day: { 32: staff }, day_oc: { 32: [b] }, night: { 32: a } } : { day: { 32: b }, night: { 32: a } };
    const { P, pin } = fixture(day, fixed);
    assert.equal(P.nextFirstSlotKind(), "day"); assert.deepEqual(T.lint(P), []);
    assert.equal(nextLink(P, pin).length, 1);
    assert.equal(T.solve(P, highs, { pin, timeLimit: 10 }).status, "Infeasible");
    pin["31:day"].work = b; // A later-night handover does not change the day's charge.
    consistent(P, pin);
  });
  test("a later next-night assignment does not establish charge when a day slot exists", () => {
    const { P, pin } = fixture("off_days", { night: { 32: b } });
    assert.deepEqual(T.lint(P), []); assert.deepEqual(nextLink(P, pin), []); consistent(P, pin);
  });
  test("explicit charge retains priority over a conflicting first-slot night worker and warns", () => {
    const { P, pin } = fixture("none", { weekend_charge: { 32: b }, night: { 32: a } });
    const lint = T.lint(P).filter(x => x.code === "LINT_NEXT_FIRST_TWO_CHARGE");
    assert.equal(lint.length, 1); assert.equal(lint[0].args.who, b); assert.equal(lint[0].args.others, a);
    assert.equal(nextLink(P, pin)[0].args.want, b);
    assert.equal(T.solve(P, highs, { pin, timeLimit: 10 }).status, "Infeasible");
    pin["31:night"].work = b; consistent(P, pin);
  });
  test("explicit charge retains priority over a conflicting first-slot night OC and warns", () => {
    const { P, pin } = fixture("none", { weekend_charge: { 32: b }, night: { 32: staff }, night_oc: { 32: [a] } });
    assert.ok(T.lint(P).some(x => x.code === "LINT_NEXT_FIRST_TWO_CHARGE"));
    pin["31:night"].work = b; consistent(P, pin);
  });
  test("two charge members fixed on the next first-night slot are identified", () => {
    const { P } = fixture("none", { night: { 32: a }, night_oc: { 32: [b] } });
    const lint = T.lint(P).filter(x => x.code === "LINT_NEXT_FIRST_TWO_CHARGE2");
    assert.equal(lint.length, 1); assert.ok(lint[0].args.others.includes(a)); assert.ok(lint[0].args.others.includes(b));
    assert.equal(T.solve(P, highs, { timeLimit: 10 }).status, "Infeasible");
  });
  test("explicit charge and later-night handover do not conflict when the first slot is day", () => {
    const { P, pin } = fixture("off_days", { weekend_charge: { 32: b }, day: { 32: b }, night: { 32: a } });
    assert.deepEqual(T.lint(P), []); pin["31:day"].work = b; consistent(P, pin);
  });
  test("a non-crossing month end does not force a period-charge link", () => {
    const { P, pin } = fixture("none", { night: { 32: b } }, 8); // August 31 is Monday.
    assert.equal(P.lastCrossingPeriod(), null); assert.deepEqual(nextLink(P, pin), []); consistent(P, pin);
  });
  test("an absent next day slot cannot override the actual next night slot", () => {
    const { P, pin } = fixture("none", { day: { 32: a }, night: { 32: b } });
    assert.equal(nextLink(P, pin)[0].args.want, b); pin["31:night"].work = b; consistent(P, pin);
  });
  test("no next slots do not infer a charge from stale day/night assignments", () => {
    const { P, pin } = fixture("weekdays", { day: { 32: a }, night: { 32: b } }, 10, "weekdays");
    assert.equal(P.nextSlotExists("day"), false); assert.equal(P.nextSlotExists("night"), false);
    assert.ok(!T.lint(P).some(x => /^LINT_NEXT_FIRST_TWO_CHARGE/.test(x.code)));
    consistent(P, pin);
  });
  for (const lang of ["ja", "en"]) for (const first of ["day", "night"]) for (const explicit of [false, true]) test(`${lang} ${first} conflict message names the actual first shift (${explicit ? "explicit charge" : "two members"})`, () => {
    T.setLang(lang);
    try {
      const fixed = explicit ? { weekend_charge: { 32: b }, [first]: { 32: a } } : { [first]: { 32: a }, [first + "_oc"]: { 32: [b] } };
      const { P } = fixture(first === "day" ? "off_days" : "none", fixed);
      const item = T.lint(P).find(x => x.code === (explicit ? "LINT_NEXT_FIRST_TWO_CHARGE" : "LINT_NEXT_FIRST_TWO_CHARGE2"));
      const label = lang === "ja" ? (first === "day" ? "日勤" : "夜勤") : (first === "day" ? "Day" : "Night");
      assert.ok(item); assert.equal(item.args.shift, label); assert.ok(item.msg.includes(label));
      assert.ok(item.msg.includes(lang === "ja" ? "最初の勤務帯" : "first shift"));
      assert.ok(!/\{\w+\}/.test(item.msg), "all message placeholders interpolate");
    } finally { T.setLang("ja"); }
  });
  console.log(`Next-slot period charge: ${passed} passed, ${failed} failed`); process.exitCode = failed ? 1 : 0;
})().catch(e => { console.error(e); process.exitCode = 1; });

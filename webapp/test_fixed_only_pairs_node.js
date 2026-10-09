// Fixed exceptions require the offending row to follow from fixed work alone.
// Synthetic assignments are checked independently and pinned in real HiGHS.
// node test_fixed_only_pairs_node.js <path/to/highs>
// TOBAN_WEBAPP_ROOT can point at the unchanged source to reproduce failures.
const fs = require("fs"), path = require("path"), vm = require("vm"), assert = require("assert/strict");
const root = process.env.TOBAN_WEBAPP_ROOT || __dirname;
globalThis.T = {};
const load = f => vm.runInThisContext(fs.readFileSync(path.join(root, "src", f), "utf8"), { filename: f });
for (const f of ["i18n.js", "rules-core.js", "model.js", "messages.js", "solver.js", "check.js"]) load(f);
for (const f of fs.readdirSync(path.join(root, "src/rules")).filter(f => f.endsWith(".js")).sort()) load("rules/" + f);
const names = "ABCDEFGHIJKLM".split("").map(x => "Synthetic " + x), who = names[0];
const key = s => s.join(":"), clone = x => JSON.parse(JSON.stringify(x));
const codes = { same_day_double: "SAME_DAY_DOUBLE", consecutive_days: "CONSECUTIVE_DAYS", shift_sequence: "SHIFT_SEQUENCE", rest_after_ake: "REST_AFTER_AKE" };
function fixture(id, opt = {}) {
  const R = { profile: { id: "synthetic-fixed-pairs", roles: [{ id: "S", label: "Staff", standby: !!opt.oc, refs: [] }, { id: "C", label: "Charge", standby: true, refs: ["charge"] }],
    shifts: [{ id: "day", on: opt.dayOn || "all" }, { id: "night", on: opt.nightOn || "all" }], positions: { work: { count: 1 } } },
    doctors: names.map((name, i) => ({ name, team: opt.charge && i === 0 ? "C" : "S", quota: 0, ...(opt.fixedOnly && i === 0 ? { duty: "fixed_only" } : {}) })),
    name_order: names.slice(), oncall_requirement: { S: { S: opt.oc ? 1 : 0, C: 0 }, C: { S: opt.oc ? 1 : 0, C: 0 } },
    forbid_sequence: [{ from: "night", to: "day" }], rule_states: {}, weights: {} };
  T.fillDefaultRules(R); for (const def of T.RULE_DEFS) R.rule_states[def.id] = "off";
  for (const k in R.weights) R.weights[k] = 0;
  R.rule_states[id] = opt.state || "hard"; R.weights.fixed_conflict = 29; R.weights[T.RULE_BY_ID[id].weight] = 13;
  if (opt.oc) { R.rule_states.oncall = "hard"; R.oncall_requirement = { S: { S: 1, C: 0 }, C: { S: 1, C: 0 } }; }
  const raw = { year: 2026, month: opt.month || 2, holidays: [], fixed: {}, ...(clone(opt.monthData || {})) };
  const P0 = new T.Problem(R, T.normalizeMonth(clone(raw), R));
  const asg = Object.fromEntries(P0.slots.map(([d, k]) => [`${d}:${k}`, { work: names[1 + (d + (k === "night" ? 3 : 0)) % 6], oc: opt.oc ? [names[7 + (d + (k === "night" ? 3 : 0)) % 6]] : [] }]));
  const fix = (s, mode = "W", person = who) => { (raw.fixed[s[1] + (mode === "O" ? "_oc" : "")] ||= {})[s[0]] = mode === "O" ? [person] : person; };
  const put = (s, mode = "W") => { if (s[0] <= 0) { const prevN = new Date(raw.year, raw.month - 1, 0).getDate(); raw.prev_month ||= { last_days: [] }; let row = raw.prev_month.last_days.find(x => x.date === prevN + s[0]); if (!row) raw.prev_month.last_days.push(row = { date: prevN + s[0] }); row[s[1]] = mode === "W" ? who : names[1]; row[s[1] + "_oc"] = mode === "O" ? [who] : []; }
    else if (s[0] > P0.N) fix(s, mode);
    else if (mode === "W") asg[key(s)].work = who; else asg[key(s)].oc = [who]; };
  const build = () => ({ P: new T.Problem(R, T.normalizeMonth(clone(raw), R)), asg, R, raw });
  return { R, raw, asg, fix, put, build, N: P0.N };
}
let passed = 0, failed = 0;
(async () => {
  const highs = await require(process.argv[2] || "highs")();
  function test(label, fn) { try { fn(); passed++; } catch (e) { failed++; console.error("FAIL", label, e.message); } }
  function assertResult(f, { id, fixed = false, conflict = true, state = "hard", relax = [], extra = 0 }) {
    const { P, asg } = f.build(), code = id === "consecutive_days" && f.next ? "CONSECUTIVE_NEXT_MONTH" : codes[id];
    const checked = T.check(P, asg), pen = T.penalty(P, asg), hard = conflict && state === "hard" && !fixed;
    const vc = checked.VC.filter(v => v.code === code && v.args.who === who), wc = checked.WC.filter(v => v.code === code && v.args.who === who);
    assert.equal(vc.length, hard ? 1 : 0, "discretionary assignment must remain a violation");
    assert.equal(wc.length, conflict && state === "hard" && fixed ? 1 : 0, "only fixed-only contradiction is a warning");
    const want = extra + (conflict ? (state === "soft" ? 13 : fixed ? 29 : 0) : 0);
    assert.equal(pen.total, want, "independent penalty");
    const result = T.solve(P, highs, { pin: asg, timeLimit: 10, mipGap: 0, relax });
    assert.equal(result.status, hard ? "Infeasible" : "Optimal", "pinned solve status");
    if (!hard) assert.equal(result.objective, want, "objective matches explicit expected penalty");
  }
  // Each work endpoint may be fixed or discretionary. Pinning a test roster is not user fixing.
  for (const id of Object.keys(codes)) for (const fixedMask of [0, 1, 2, 3]) for (const state of ["hard", "soft", "off"]) test(`${id} ${state} fixed mask ${fixedMask}`, () => {
    const f = fixture(id, { state }), a = id === "same_day_double" ? [5, "day"] : [5, "night"], b = [id === "same_day_double" ? 5 : id === "rest_after_ake" ? 7 : 6, "day"];
    if (id === "same_day_double") b[1] = "night";
    f.put(a); f.put(b); if (fixedMask & 1) f.fix(a); if (fixedMask & 2) f.fix(b);
    assertResult(f, { id, fixed: fixedMask === 3, state, conflict: state !== "off" });
  });
  // Previous-month work is an actual constant; future fixed work only counts on real slots.
  for (const id of ["consecutive_days", "shift_sequence", "rest_after_ake"]) for (const boundary of ["prev", "next"]) for (const fixed of [false, true]) for (const state of ["hard", "soft", "off"]) test(`${id} ${boundary} ${state} fixed=${fixed}`, () => {
    const f = fixture(id, { state }), delta = id === "rest_after_ake" ? 2 : 1;
    const a = boundary === "prev" ? [0, "night"] : [f.N + 1 - delta, "night"], b = boundary === "prev" ? [delta, "day"] : [f.N + 1, "day"];
    f.put(a); f.put(b); if (fixed) f.fix(boundary === "prev" ? b : a); f.next = boundary === "next";
    assertResult(f, { id, fixed, state, conflict: state !== "off" });
  });
  // Day-level rows permit either actual shift as the fixed work; night-specific rows do not.
  for (const id of ["consecutive_days", "rest_after_ake"]) test(`${id}: unrelated source day work is not fixed night`, () => {
    const f = fixture(id), a = [5, "night"], b = [id === "rest_after_ake" ? 7 : 6, "day"];
    f.put(a); f.put(b); f.put([5, "day"]); f.fix([5, "day"]); f.fix(b);
    assertResult(f, { id, fixed: id === "consecutive_days" });
  });
  for (const id of ["same_day_double", "consecutive_days", "shift_sequence", "rest_after_ake"]) test(`${id}: another person's fixed endpoints cannot exempt target`, () => {
    const f = fixture(id), a = id === "same_day_double" ? [5, "day"] : [5, "night"], b = [id === "same_day_double" ? 5 : id === "rest_after_ake" ? 7 : 6, id === "same_day_double" ? "night" : "day"];
    f.put(a); f.put(b); f.fix(a, "W", names[2]); f.fix(b, "W", names[2]); assertResult(f, { id });
  });
  // Manually invalid work at an OC-fixed endpoint is a hard work-rule violation, never W.
  for (const id of ["same_day_double", "consecutive_days", "shift_sequence", "rest_after_ake"]) for (const ocIndex of [0, 1]) test(`${id}: OC-only fixed endpoint ${ocIndex}`, () => {
    const f = fixture(id, { oc: true }), a = id === "same_day_double" ? [5, "day"] : [5, "night"], b = [id === "same_day_double" ? 5 : id === "rest_after_ake" ? 7 : 6, id === "same_day_double" ? "night" : "day"];
    f.put(a); f.put(b); f.fix([a, b][ocIndex], "O"); f.fix([a, b][1 - ocIndex]); assertResult(f, { id });
  });
  for (const id of ["consecutive_days", "rest_after_ake"]) test(`${id}: disabled source shift fixed input does not exempt`, () => {
    const f = fixture(id, { dayOn: "none" }), a = [5, "night"], b = [id === "rest_after_ake" ? 7 : 6, "night"];
    f.put(a); f.put(b); f.fix([5, "day"]); f.fix(b); assertResult(f, { id });
  });
  for (const id of ["consecutive_days", "shift_sequence", "rest_after_ake"]) test(`${id}: OC fixed on another current slot cannot exempt next-boundary work`, () => {
    const f = fixture(id, { oc: true }), a = [id === "rest_after_ake" ? 27 : 28, "night"], b = [29, "day"];
    f.put(a); f.put(b); f.fix([a[0], "day"], "O"); f.put([a[0], "day"], "O"); f.next = true; assertResult(f, { id });
  });
  test("rest_after_ake retains fixed-only staff exemption", () => {
    const id = "rest_after_ake", f = fixture(id, { fixedOnly: true }); f.put([5, "night"]); f.put([7, "day"]); f.fix([5, "night"]); assertResult(f, { id, conflict: false });
  });
  // Removing one fixed endpoint during diagnosis must restore the hard pair row.
  for (const id of Object.keys(codes)) for (const relax of ["fixed", "fixed:night:5"]) test(`${id}: relaxed fixed endpoint ${relax}`, () => {
    const f = fixture(id), a = [5, "night"], b = [id === "same_day_double" ? 5 : id === "rest_after_ake" ? 7 : 6, "day"];
    f.put(a); f.put(b); f.fix(a); f.fix(b); const { P, asg } = f.build();
    assert.equal(T.solve(P, highs, { pin: asg, relax: [relax], mipGap: 0, timeLimit: 10 }).status, "Infeasible");
  });
  for (const id of ["consecutive_days", "shift_sequence", "rest_after_ake"]) test(`${id}: relaxed next-month input removes boundary row`, () => {
    const f = fixture(id), a = [f.N + 1 - (id === "rest_after_ake" ? 2 : 1), "night"], b = [f.N + 1, "day"]; f.put(a); f.put(b);
    const { P, asg } = f.build(), result = T.solve(P, highs, { pin: asg, relax: ["fixed:next"], mipGap: 0, timeLimit: 10 });
    assert.equal(result.status, "Optimal"); assert.equal(result.objective, 0);
  });
  // OC adjacency is charged only when at least one endpoint is OC. In particular,
  // omitting work/work auxiliary variables is safe only when the hard day row forbids both.
  for (const dayOn of ["all", "none"]) for (const boundary of ["month", "prev", "next"]) for (const second of dayOn === "all" ? ["day", "night"] : ["night"])
    for (const modes of [["W", "W"], ["W", "O"], ["O", "W"], ["O", "O"]]) for (const fixedMask of [0, 1, 2, 3]) test(`OC ${dayOn}/${boundary}/${second}/${modes.join("")}/fixed ${fixedMask}`, () => {
      const f = fixture("oc_consecutive", { oc: true, state: "soft", dayOn }); f.R.rule_states.consecutive_days = "hard";
      const a = boundary === "prev" ? [0, "night"] : [boundary === "next" ? f.N : 5, "night"], b = [boundary === "prev" ? 1 : boundary === "next" ? f.N + 1 : 6, second];
      f.put(a, modes[0]); f.put(b, modes[1]);
      if ((fixedMask & 1) && a[0] > 0) f.fix(a, modes[0]); if ((fixedMask & 2) && b[0] <= f.N) f.fix(b, modes[1]);
      const bothWork = modes.every(x => x === "W"), forced = (a[0] <= 0 || !!(fixedMask & 1)) && (b[0] > f.N || !!(fixedMask & 2)), hard = bothWork && !forced;
      const { P, asg } = f.build(), checked = T.check(P, asg), pen = T.penalty(P, asg), result = T.solve(P, highs, { pin: asg, timeLimit: 10, mipGap: 0 });
      assert.equal(checked.VC.length, hard ? 1 : 0, "only a discretionary work/work pair may violate");
      assert.equal(checked.WC.length, bothWork && forced ? 1 : 0, "OC must never cause a fixed work exception");
      assert.equal(pen.total, bothWork ? (forced ? 29 : 0) : 13, "OC-only literal independently evaluated");
      assert.equal(result.status, hard ? "Infeasible" : "Optimal");
      if (!hard) assert.equal(result.objective, pen.total, "OC objective equals independent rule score");
    });
  // For an already forced day-level conflict, work on a different actual shift can
  // still occur under same_day_double=off. noBoth must use the same day-level row.
  test("OC noBoth retains work/work exclusion when other shifts force both workdays", () => {
    const f = fixture("oc_consecutive", { oc: true, state: "soft" }); f.R.rule_states.consecutive_days = "hard";
    for (const d of [5, 6]) { f.put([d, "night"]); f.put([d, "day"]); f.fix([d, "day"]); }
    const { P, asg } = f.build(), result = T.solve(P, highs, { pin: asg, timeLimit: 10, mipGap: 0 });
    assert.equal(result.status, "Optimal"); assert.equal(result.objective, 29); assert.equal(T.penalty(P, asg).total, 29);
  });
  for (const boundary of ["month", "prev", "next"]) for (const charge of [false, true]) test(`OC period role exemption ${boundary}/${charge}`, () => {
    const f = fixture("oc_consecutive", { oc: true, state: "soft" });
    if (charge) { f.R.profile.roles = [{ id: "S", label: "Staff", standby: true, refs: ["charge"] }]; f.R.oncall_requirement = { S: { S: 1 } }; }
    const a = boundary === "prev" ? [0, "night"] : [boundary === "next" ? f.N : 7, "night"], b = [boundary === "prev" ? 1 : boundary === "next" ? f.N + 1 : 8, "day"];
    f.put(a, "O"); f.put(b, "W"); const { P, asg } = f.build(), result = T.solve(P, highs, { pin: asg, timeLimit: 10, mipGap: 0 });
    assert.equal(result.status, "Optimal"); assert.equal(T.check(P, asg).VC.length, 0);
    assert.equal(T.penalty(P, asg).total, charge ? 0 : 13); assert.equal(result.objective, charge ? 0 : 13);
  });
  console.log(`Fixed-only pair regressions: ${passed} passed, ${failed} failed`); process.exitCode = failed ? 1 : 0;
})().catch(e => { console.error(e); process.exitCode = 1; });

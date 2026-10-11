// Rule diagnostics remove declared hard rows only. Synthetic staff and inputs only.
// node test_rule_diagnostic_rows_node.js [path/to/highs]
const fs = require("fs"), vm = require("vm"), path = require("path"), assert = require("assert/strict"), crypto = require("crypto");
globalThis.T = {};
for (const f of ["i18n.js", "rules-core.js", "model.js", "messages.js", "solver.js", "check.js"])
  vm.runInThisContext(fs.readFileSync(path.join(__dirname, "src", f), "utf8"), { filename: f });
const ruleRoot = process.env.TOBAN_BASELINE_RULES || path.join(__dirname, "src/rules");
for (const f of fs.readdirSync(ruleRoot).filter(f => f.endsWith(".js")).sort())
  vm.runInThisContext(fs.readFileSync(path.join(ruleRoot, f), "utf8"), { filename: "rules/" + f });
const names = ["Synthetic: Alpha", "Synthetic Beta", "Synthetic Gamma"], key = T.rules.relaxKey;
const clone = x => JSON.parse(JSON.stringify(x));
function fixture(states = {}, opts = {}) {
  const R = { profile: { id: "synthetic-diagnostic-rows", calendar: { holidays: "none", closure: [] },
    roles: [{ id: "S", label: "Staff", refs: [], standby: false }],
    shifts: [{ id: "day", on: "all" }, { id: "night", on: opts.nightOn || "all" }], positions: { work: { count: 1 } } },
    doctors: names.map((name, i) => ({ name, team: "S", years: i + 1, quota: 0, duty: !i && opts.fixedOnly ? "fixed_only" : "normal" })),
    name_order: names.slice(), rule_states: {}, weights: { fixed_conflict: 19, chief_duty: 0, missing_young_oc: 0 }, run_length: { max: 3 }, shift_run_max: { day: 3 },
    shift_counts: { night: { min: 1, max: 15 } }, max_same_weekday_shifts: 3, dayoff_weekday_max: 1,
    composition: [{ shift: "day", years_max: 2, min: 1, max: 1 }], forbid_sequence: [{ from: "night", to: "any" }] };
  T.fillDefaultRules(R); for (const d of T.RULE_DEFS) R.rule_states[d.id] = "off";
  Object.assign(R.rule_states, states);
  const fixed = {}, prev = new Map();
  for (const [d, k] of opts.fixed || []) (fixed[k] ||= {})[d] = names[0];
  for (const [d, k] of opts.previous || []) { if (!prev.has(d)) prev.set(d, { date: 31 + d }); prev.get(d)[k] = names[0]; }
  return new T.Problem(R, T.normalizeMonth({ year: 2026, month: 11, holidays: [], fixed, prev_month: { last_days: [...prev.values()] } }, R));
}
const snapshotCases = {
  hard: { shift_run_max: "hard", run_length_max: "hard", composition: "hard", same_day_double: "hard", shift_sequence: "hard" },
  soft: { shift_run_max: "soft", run_length_max: "soft", composition: "soft", same_day_double: "soft", shift_sequence: "soft" },
  off: {},
};
const hash = lp => crypto.createHash("sha256").update(lp.toLP() + "\nobjC=" + lp.objC).digest("hex");
if (process.env.TOBAN_BASELINE_RULES) {
  console.log(JSON.stringify(Object.fromEntries(Object.entries(snapshotCases).map(([label, states]) => [label, hash(T.buildLP(fixture(states, { fixed: [[5, "day"], [6, "day"], [7, "day"], [8, "day"]] })).lp)])), null, 2));
} else {
let passed = 0, failed = 0;
function test(label, fn) { try { fn(); passed++; console.log("PASS", label); } catch (e) { failed++; console.error("FAIL", label, e.stack); } }
function context(state = "hard", relax = [], diagnosticRows = []) {
  const lp = new T.LP(), P = { state: () => state, softW: () => 7, weights: { fixed_conflict: 19 }, prm: {} };
  const ctx = T.rules.solveCtx({ P, LP: T.LP, lp, relax: new Set(relax), opts: { diagnosticRows }, names: [], slots: [], work: {}, oc: {} });
  return { ctx, lp, rows: diagnosticRows };
}
const id = "local:unit:cap", n = names[0];
test("canonical keys encode colon-containing IDs, names, and shift IDs", () => {
  assert.equal(key(id), "rule:local%3Aunit%3Acap");
  assert.equal(key(id, { name: n }), "rule:local%3Aunit%3Acap:name:Synthetic%3A%20Alpha");
  assert.equal(key(id, { slot: [7, "day:extra"] }), "rule:local%3Aunit%3Acap:slot:7:day%3Aextra");
  assert.notEqual(key(id, { day: 7 }), key(id + ":day:7"));
});
test("hard row metadata is normalized and detached from caller arrays", () => {
  const { ctx, rows } = context(), scope = { days: [3, 3], slot: [4, "day"], slots: [[4, "day"], [5, "night"]], names: [n, n] };
  ctx.limit(id, "x", "<=", 1, scope); scope.days.push(99); scope.slot[0] = 99; scope.slots[1][0] = 99; scope.names.push("Other");
  assert.deepEqual(rows, [{ id, key: key(id), days: [3, 4, 5], slot: [4, "day"], slots: [[4, "day"], [5, "night"]], names: [n] }]);
});
test("generic relaxation runs the full hook and preserves direct structural rows", () => {
  let ran = 0;
  T.rules.register({ id, api: 1, states: ["hard", "soft", "off"], solve(ctx) { ran++; const x = ctx.lp.bin("x"), y = ctx.lp.bin("y"); ctx.lp.add(y, "=", x); ctx.limit(id, y, "<=", 0); }, check() {}, penalty() {} });
  const { ctx, lp, rows } = context("hard", [key(id)]); T.rules.runSolve(ctx, [id]);
  assert.equal(ran, 1); assert.equal(lp.cons.length, 1); assert.equal(lp.cons[0].sense, "="); assert.equal(rows.length, 1);
  T.rules.unregister(id);
});
for (const [label, scope, target, remains] of [
  ["day", { days: [4, 5] }, { day: 5 }, false],
  ["day outside row", { days: [4, 5] }, { day: 6 }, true],
  ["single slot", { slot: [5, "day"] }, { slot: [5, "day"] }, false],
  ["window slot", { slots: [[4, "day"], [5, "day"]] }, { slot: [5, "day"] }, false],
  ["wrong shift", { slots: [[4, "day"], [5, "day"]] }, { slot: [5, "night"] }, true],
  ["slot implies day", { slot: [5, "day"] }, { day: 5 }, false],
  ["colon name", { names: [n] }, { name: n }, false],
  ["different name", { names: [n] }, { name: "Synthetic" }, true],
  ["unscoped row", {}, { day: 5 }, true],
]) test(`targeted ${label} relaxation affects only matching rows`, () => {
  const { ctx, lp } = context("hard", [key(id, target)]); ctx.limit(id, "x", "<=", 0, scope); assert.equal(lp.cons.length, remains ? 1 : 0);
});
test("rule ID prefixes and encoded percent signs never collide", () => {
  const { ctx, lp } = context("hard", [key("local:unit", { name: n }), key("local%3Aunit%3Acap")]);
  ctx.limit(id, "x", "<=", 0, { names: [n] }); assert.equal(lp.cons.length, 1);
});
test("generic and targeted keys leave soft penalty rows and objective unchanged", () => {
  const a = context("soft"), b = context("soft", [key(id), key(id, { day: 5 }), key(id, { name: n })]);
  for (const x of [a, b]) x.ctx.limit(id, "x", "<=", 0, { days: [5], names: [n], aux: "soft", ub: 4 });
  assert.equal(a.lp.toLP(), b.lp.toLP()); assert.deepEqual([...a.lp.obj], [...b.lp.obj]); assert.equal(b.rows.length, 0);
});
test("off rows create no metadata, constraints, variables, or objective", () => {
  const { ctx, lp, rows } = context("off", [key(id)]); ctx.limit(id, "x", "<=", 0, { names: [n] });
  assert.equal(lp.cons.length + lp.vars.size + lp.obj.size + rows.length, 0);
});
test("fixed allowance is retained normally and removed only with its hard row", () => {
  const ordinary = context(), relaxed = context("hard", [key(id)]);
  for (const x of [ordinary, relaxed]) x.ctx.limit(id, "x", "<=", 0, { fixed: true, fixedExcess: 2, names: [n] });
  assert.equal([...ordinary.lp.vars.values()][0].ub, 2); assert.equal([...ordinary.lp.obj.values()][0], 19);
  assert.equal(relaxed.lp.vars.size + relaxed.lp.cons.length + relaxed.lp.obj.size, 0);
});
test("inactive dependency prevents rows and solve hook execution", () => {
  const dep = "local:dependency", child = "local:dependent";
  T.rules.register({ id: dep, states: ["hard", "off"] });
  T.rules.register({ id: child, api: 1, states: ["hard", "off"], needs: [dep], solve() { throw new Error("inactive hook called"); }, check() {} });
  const { ctx, rows } = context(); ctx.P.state = x => x === dep ? "off" : "hard"; T.rules.runSolve(ctx, [child]); assert.equal(rows.length, 0);
  T.rules.unregister(child); T.rules.unregister(dep);
});
// SHA-256 of LP text and objective constant before this diagnostic-only change (29922f5).
const snapshots = {
  hard: "3dd86612450ea57e6b7d92a8dffeb9f375ded288d72d8a24cc1b2f70c10558b1",
  soft: "ba6f87d3815e37fae69596f440003e96b1c282a6a92d027648a8bcbc49d7a55a",
  off: "60766bdf8ff17385d004fba7534a486457e0498d4017170af5045d63176b8922",
};
for (const [label, states] of Object.entries(snapshotCases)) test(`ordinary ${label} LP is byte-identical to pre-diagnostic baseline`, () => {
  const P = fixture(states, { fixed: [[5, "day"], [6, "day"], [7, "day"], [8, "day"]] }), rows = [];
  const ordinary = T.buildLP(P).lp, collected = T.buildLP(P, { diagnosticRows: rows }).lp;
  assert.equal(hash(ordinary), snapshots[label]); assert.equal(ordinary.toLP(), collected.toLP()); assert.equal(ordinary.objC, collected.objC);
  if (label !== "hard") assert.equal(rows.length, 0);
});
test("run windows and composition expose accurate scoped rows", () => {
  const P = fixture({ shift_run_max: "hard", run_length_max: "hard", composition: "hard" }), rows = []; T.buildLP(P, { diagnosticRows: rows });
  assert(rows.some(r => r.id === "shift_run_max" && r.names[0] === n && JSON.stringify(r.slots) === JSON.stringify([[5, "day"], [6, "day"], [7, "day"], [8, "day"]])));
  assert(rows.some(r => r.id === "run_length_max" && r.names[0] === n && r.days.join() === "5,6,7,8"));
  assert(rows.some(r => r.id === "composition" && r.slot?.join() === "5,day" && r.names.join() === names.slice(0, 2).join()));
});
test("all other scoped hard limit built-ins report their intended person or date", () => {
  for (const id of ["same_weekday_cap", "consecutive_days", "fixed_only", "dayoff_weekday_cap", "shift_count_range", "rest_after_ake", "same_day_double", "shift_sequence"]) {
    const rows = [], P = fixture({ [id]: "hard" }, { fixedOnly: id === "fixed_only" }); T.buildLP(P, { diagnosticRows: rows });
    const own = rows.filter(r => r.id === id); assert(own.length, id); assert(own.every(r => r.names.length), id + " names");
    if (id !== "shift_count_range") assert(own.every(r => r.days.length), id + " days");
  }
});
const explanations = (P, opts = {}, slot = [8, "day"]) => T.rules.explainSlot(P, slot, n, opts).filter(r => r.id === "shift_run_max");
test("shift cap explains only a fully proven window around the candidate", () => {
  const P = fixture({ shift_run_max: "hard" }, { fixed: [[5, "day"], [6, "day"], [7, "day"]] }), before = JSON.stringify(P.month);
  const got = explanations(P); assert.equal(got.length, 1); assert.equal(got[0].code, "SHIFT_RUN_FORCED_WINDOW");
  assert.deepEqual(got[0].days, [5, 6, 7, 8]); assert.deepEqual(got[0].evidence.fixedSlots, [[5, "day"], [6, "day"], [7, "day"]]);
  assert.equal(JSON.stringify(P.month), before);
  assert.equal(explanations(fixture({ shift_run_max: "hard" }, { fixed: [[5, "day"], [7, "day"]] })).length, 0);
});
test("forced-window explanation respects full fixed exception, state, exemptions, and relaxations", () => {
  const fixed = [[5, "day"], [6, "day"], [7, "day"]];
  assert.equal(explanations(fixture({ shift_run_max: "hard" }, { fixed: [...fixed, [8, "day"]] })).length, 0);
  for (const state of ["soft", "off"]) assert.equal(explanations(fixture({ shift_run_max: state }, { fixed })).length, 0);
  assert.equal(explanations(fixture({ shift_run_max: "hard" }, { fixed, fixedOnly: true })).length, 0);
  const P = fixture({ shift_run_max: "hard" }, { fixed });
  for (const r of ["fixed", "fixed:day:6", key("shift_run_max"), key("shift_run_max", { day: 6 }), key("shift_run_max", { slot: [6, "day"] }), key("shift_run_max", { name: n })])
    assert.equal(explanations(P, { relax: [r] }).length, 0, r);
  assert.equal(explanations(P, { relax: [key("shift_run_max", { slot: [6, "night"] })] }).length, 1);
});
test("forced-window evidence includes valid previous and next boundary constants", () => {
  const prev = fixture({ shift_run_max: "hard" }, { previous: [[-1, "day"], [0, "day"]], fixed: [[1, "day"]] });
  assert(explanations(prev, {}, [2, "day"]).some(r => r.days.join() === "-1,0,1,2"));
  const next = fixture({ shift_run_max: "hard" }, { fixed: [[28, "day"], [29, "day"], [31, "day"]] });
  assert(explanations(next, {}, [30, "day"]).some(r => r.days.join() === "28,29,30,31"));
  assert.equal(explanations(next, { relax: ["fixed:next"] }, [30, "day"]).length, 0);
});
test("fixed-only evidence requires the active hard rule and an unfixed work slot", () => {
  const P = fixture({ fixed_only: "hard" }, { fixedOnly: true, fixed: [[5, "day"]] });
  const at = (slot, opts = {}) => T.rules.explainSlot(P, slot, n, opts).filter(r => r.id === "fixed_only");
  assert.equal(at([5, "day"]).length, 0); assert.equal(at([6, "day"])[0].code, "FIXED_ONLY_CANDIDATE");
  assert.equal(at([6, "day"], { relax: [key("fixed_only", { slot: [6, "day"] })] }).length, 0);
  assert.equal(T.rules.explainSlot(fixture({ fixed_only: "off" }, { fixedOnly: true }), [6, "day"], n).length, 0);
});
(async () => {
  if (process.argv[2]) {
    const highs = await require(process.argv[2])();
    test("real HiGHS distinguishes targeted shift kind and generic row relaxation", () => {
      const P = fixture({ shift_run_max: "hard" }), pin = Object.fromEntries(P.slots.map(s => [s.join(":"), { work: s[1] === "day" && s[0] >= 5 && s[0] <= 8 ? n : names[1 + s[0] % 2], oc: [] }]));
      const solve = relax => T.solve(P, highs, { pin, relax, timeLimit: 10, mipGap: 0 }).status;
      assert.equal(solve([]), "Infeasible"); assert.equal(solve([key("shift_run_max", { slot: [8, "night"] })]), "Infeasible");
      assert.equal(solve([key("shift_run_max", { slot: [8, "day"] })]), "Optimal"); assert.equal(solve([key("shift_run_max")]), "Optimal");
    });
  }
  console.log(`rule diagnostic rows: ${passed} passed, ${failed} failed`); if (failed) process.exitCode = 1;
})().catch(e => { console.error(e); process.exitCode = 1; });
}

// Fixed OC counts follow the configured worker/standby-role matrix, not a one-per-role limit.
// node test_fixed_oc_capacity_node.js <highs package path> [source webapp directory]
// All staff and months are synthetic. The optional source directory reproduces the same cases before a fix.
const fs = require("fs"), vm = require("vm"), path = require("path"), assert = require("assert");
const source = process.argv[3] || __dirname;
globalThis.T = {};
for (const f of ["i18n.js", "rules-core.js", "model.js", "messages.js", "solver.js", "check.js"])
  vm.runInThisContext(fs.readFileSync(path.join(source, "src", f), "utf8"), { filename: f });
for (const f of fs.readdirSync(path.join(source, "src/rules")).filter(f => f.endsWith(".js")))
  vm.runInThisContext(fs.readFileSync(path.join(source, "src/rules", f), "utf8"), { filename: "rules/" + f });
for (const f of fs.readdirSync(path.join(source, "lang"))) T.registerLang(JSON.parse(fs.readFileSync(path.join(source, "lang", f), "utf8")));
T.setLang("en");
const CODE = "LINT_FIXED_OC_TWO_SAME_ROLE", DISABLED = "LINT_FIXED_OC_NO_ONCALL_SHIFT";
function problem({ kind = "night", fixedWorker = "Worker Two", fixedCount = 2, required = 2,
  role = "Standby", none = false, oncall = true, shiftOncall = true, twoDuty = "yes",
  omitTwo = false, unavailableTwo = false } = {}) {
  const R = {
    profile: { id: "synthetic-fixed-oc-capacity", roles: [
      { id: "Two", label: "Two", refs: [] }, { id: "One", label: "One", refs: [] },
      { id: "Zero", label: "Zero", refs: [] }, { id: "Standby", label: "Standby", refs: [], standby: true },
      { id: "Junior", label: "Junior", refs: ["junior"], standby: true }
    ], shifts: [{ id: "day", on: kind === "day" ? "all" : "none", oncall: shiftOncall }, { id: "night", on: "all", oncall: shiftOncall }] },
    doctors: [
      ...(!omitTwo ? [{ name: "Worker Two", team: "Two", duty: twoDuty }] : []),
      { name: "Worker One", team: "One" }, { name: "Worker Zero", team: "Zero" },
      ...[1, 2, 3].map(i => ({ name: `OC ${i}`, team: role }))
    ].map(d => ({ quota: 0, ...d })),
    oncall_requirement: { Two: { [role]: required }, One: { [role]: 1 }, Zero: {}, Standby: {}, Junior: {} },
    weights: { missing_young_oc: 0, chief_duty: 0, fixed_conflict: 0 }, rule_states: {}
  };
  T.fillDefaultRules(R);
  for (const d of T.RULE_DEFS) if (d.states.includes("off")) R.rule_states[d.id] = "off";
  Object.assign(R.rule_states, { oncall: oncall ? "hard" : "off", fixed_only: "hard" });
  for (const k in R.weights) R.weights[k] = 0;
  const m = { year: 2026, month: 2, holidays: [], fixed: {
    [kind]: fixedWorker ? { 1: fixedWorker } : {},
    [kind + "_oc"]: { 1: [1, 2, 3].slice(0, fixedCount).map(i => `OC ${i}`) },
    [kind + "_oc_none"]: none ? { 1: [role] } : {}
  } };
  if (unavailableTwo) {
    if (kind === "night") m.unavailable_night = { "Worker Two": [1] };
    else m.unavailable_other = [{ name: "Worker Two", day: 1, part: "day" }];
  }
  return new T.Problem(R, T.normalizeMonth(m, R));
}
let passed = 0, failed = 0;
(async () => {
  if (!process.argv[2]) throw new Error("Specify an installed highs package path");
  const highs = await require(process.argv[2])();
  const run = (label, options, status, capacity, disabled = false) => {
    try {
      const P = problem(options), result = T.solve(P, highs, { timeLimit: 5, mipGap: 0 });
      assert.strictEqual(result.status, status, "solver status");
      const violations = result.asg ? T.check(P, result.asg).VC : null;
      if (result.asg) assert.deepStrictEqual(violations, [], "solver assignment must pass independent check");
      const lint = T.lint(P), warning = lint.find(x => x.code === CODE);
      console.log(`case ${label}: solver=${result.status}, check=${violations ? violations.length : "n/a"}, capacity lint=${!!warning}`);
      assert.strictEqual(!!warning, capacity != null, "fixed OC capacity warning");
      assert.strictEqual(lint.some(x => x.code === DISABLED), disabled, "disabled OC warning");
      if (warning) {
        assert.strictEqual(warning.args.count, capacity, "applicable capacity");
        assert.strictEqual(warning.args.n, options.fixedCount ?? 2, "fixed OC count");
        assert.strictEqual(warning.args.role, options.role || "Standby", "standby role label");
        for (const lang of ["en", "ja"]) {
          T.setLang(lang);
          const text = P.msg(CODE, warning.args);
          assert.ok(!/\{[^}]+\}/.test(text), `${lang}: unresolved placeholders: ${text}`);
          assert.ok(text.includes(String(capacity)), `${lang}: capacity missing: ${text}`);
        }
        T.setLang("en");
      }
      passed++;
    } catch (e) { failed++; console.error("FAIL " + label + ": " + e.message); }
  };
  for (const kind of ["day", "night"]) {
    for (const role of ["Standby", "Junior"]) {
      run(`${kind}/${role}: two fixed, two required`, { kind, role }, "Optimal", null);
      run(`${kind}/${role}: one fixed, two required`, { kind, role, fixedCount: 1 }, "Optimal", null);
      run(`${kind}/${role}: three fixed, three required`, { kind, role, fixedCount: 3, required: 3 }, "Optimal", null);
      run(`${kind}/${role}: three fixed, two required`, { kind, role, fixedCount: 3 }, "Infeasible", 2);
      run(`${kind}/${role}: fixed worker requires only one`, { kind, role, fixedWorker: "Worker One" }, "Infeasible", 1);
      run(`${kind}/${role}: fixed worker needs no OC`, { kind, role, fixedWorker: "Worker Zero", fixedCount: 1 }, "Infeasible", 0);
      run(`${kind}/${role}: unfixed worker can support two`, { kind, role, fixedWorker: null }, "Optimal", null);
      run(`${kind}/${role}: no roster worker supports two`, { kind, role, fixedWorker: null, omitTwo: true }, "Infeasible", 1);
    }
    run(`${kind}: inactive worker cannot supply capacity`, { kind, fixedWorker: null, twoDuty: "never" }, "Infeasible", 1);
    run(`${kind}: unfixed fixed-only worker cannot supply capacity`, { kind, fixedWorker: null, twoDuty: "fixed_only" }, "Infeasible", 1);
    run(`${kind}: unavailable unfixed worker cannot supply capacity`, { kind, fixedWorker: null, unavailableTwo: true }, "Infeasible", 1);
    run(`${kind}: unavailable fixed worker keeps its matrix row`, { kind, unavailableTwo: true }, "Optimal", null);
    run(`${kind}: junior OC-none has capacity zero`, { kind, role: "Junior", none: true, fixedCount: 1 }, "Infeasible", 0);
    run(`${kind}: empty junior OC-none remains valid`, { kind, role: "Junior", none: true, fixedCount: 0 }, "Optimal", null);
    run(`${kind}: OC-none applies only to the junior role`, { kind, none: true }, "Optimal", null);
    run(`${kind}: global OC disabled`, { kind, oncall: false }, "Infeasible", null, true);
    run(`${kind}: shift OC disabled`, { kind, shiftOncall: false }, "Infeasible", null, true);
  }
  const catalog = JSON.parse(fs.readFileSync(path.join(source, "lang/en.json"), "utf8"));
  assert.strictEqual(catalog.msg[CODE], T.MSG[CODE].en, "English catalog and source message agree");
  console.log(`Fixed OC capacity: ${passed} passed, ${failed} failed`);
  if (failed) process.exitCode = 1;
})().catch(e => { console.error(e); process.exitCode = 1; });

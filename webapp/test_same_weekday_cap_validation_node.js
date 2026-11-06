// Active same-weekday cap validation and fixed-overflow semantics.
// node test_same_weekday_cap_validation_node.js [path/to/highs]
// TOBAN_WEBAPP_ROOT selects unchanged source for the baseline regression run.
// Synthetic night-only roster; no on-call or period-charge behavior is involved.
const fs = require("fs"), vm = require("vm"), path = require("path"), assert = require("assert/strict");
const root = process.env.TOBAN_WEBAPP_ROOT || __dirname;
globalThis.T = {};
const run = f => vm.runInThisContext(fs.readFileSync(path.join(root, "src", f), "utf8"), { filename: f });
for (const f of ["i18n.js", "rules-core.js", "model.js", "messages.js", "solver.js", "check.js"]) run(f);
for (const f of fs.readdirSync(path.join(root, "src/rules")).filter(f => f.endsWith(".js")).sort()) run("rules/" + f);
T.DEFAULT_RULES = JSON.parse(fs.readFileSync(path.join(root, "data/rules.json"), "utf8"));
function fixture() {
  const names = ["Synthetic Alpha", "Synthetic Beta"];
  const R = { profile: { id: "synthetic-weekday-validation", roles: [{ id: "S", label: "Staff", refs: [], standby: false }],
      shifts: [{ id: "day", on: "none" }, { id: "night", on: "all" }], positions: { work: { count: 1 } } },
    doctors: names.map(name => ({ name, team: "S", quota: 0 })),
    rule_states: Object.fromEntries(T.RULE_DEFS.map(d => [d.id, "off"])), weights: {} };
  T.fillDefaultRules(R); for (const key of Object.keys(R.weights)) R.weights[key] = 0;
  const M = T.normalizeMonth({ year: 2026, month: 7, holidays: [] }, R), P = new T.Problem(R, M);
  const asg = Object.fromEntries(P.slots.map(s => [T.Problem.key(s), { work: names[s[0] === 31 ? 0 : 1], oc: [] }]));
  return { P, asg };
}
const values = [undefined, null, "", "  ", 0, "0", 1, "2", 10, Number.MAX_SAFE_INTEGER,
  1.5, "1.5", -1, "-1", "abc", Infinity, NaN, true, false, [], [2], {}, Number.MAX_SAFE_INTEGER + 1];
let passed = 0, failed = 0;
(async () => {
  const highs = await require(process.argv[2] || path.join(root, "libs/highs.js"))();
  for (const lang of ["ja", "en"]) {
    T.registerLang(JSON.parse(fs.readFileSync(path.join(root, "lang", lang + ".json"), "utf8"))); T.setLang(lang);
    for (const state of ["hard", "soft", "off"]) for (const [index, value] of values.entries()) {
      const label = [lang, state, index].join("/");
      try {
        const f = fixture(), R = f.P.rules, M = f.P.m;
        R.rule_states.oc_consecutive = "off"; R.rule_states.same_weekday_cap = state;
        R.max_same_weekday_shifts = value;
        const original = value;
        if (index >= 10 && state !== "off") {
          assert.throws(() => new T.Problem(R, M), /max_same_weekday_shifts/, "reject invalid cap at the model boundary");
        } else {
          const P = new T.Problem(R, M);
          assert.equal(P.prm.same_weekday_cap.max, index >= 10 || index < 6 ? 0 : Number(value));
          assert.doesNotThrow(() => T.buildLP(P));
          assert.doesNotThrow(() => T.check(P, f.asg));
          assert.doesNotThrow(() => T.penalty(P, f.asg));
        }
        assert.ok(Object.is(R.max_same_weekday_shifts, original), "source setting preserved");
        passed++; console.log("PASS", label);
      } catch (e) { failed++; console.error("FAIL", label, e.message); }
    }
  }
  // Fixed overflow remains allowed and scored in hard mode; soft overflow remains scored.
  for (const state of ["hard", "soft"]) {
    const f = fixture(), R = f.P.rules, M = f.P.m;
    R.rule_states.oc_consecutive = "off"; R.rule_states.same_weekday_cap = state; R.max_same_weekday_shifts = 1;
    R.weights.same_weekday_excess = 7; R.weights.fixed_conflict = 11;
    // All assignments are hand-fixed so hard allowance has no discretionary overflow.
    for (const [key, value] of Object.entries(f.asg)) M.fixed[key.split(":")[1]][key.split(":")[0]] = value.work;
    const P = new T.Problem(R, M), penalty = T.penalty(P, f.asg), solved = T.solve(P, highs, { pin: f.asg, timeLimit: 10, mipGap: 0 });
    assert.equal(solved.status, "Optimal"); assert.equal(solved.objective, penalty.total); assert.ok(penalty.total > 0);
    assert.deepEqual(T.check(P, f.asg).VC, []); passed++; console.log("PASS fixed-overflow", state);
  }
  assert.equal(passed + failed, 140);
  console.log(JSON.stringify({ expected: 140, passed, failed })); process.exitCode = failed ? 1 : 0;
})().catch(e => { console.error(e); process.exitCode = 1; });

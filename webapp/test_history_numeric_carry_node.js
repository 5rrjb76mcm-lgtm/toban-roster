// Carry accepted numeric-string histories arithmetically, including fractional balances.
// Synthetic valid rosters only. TOBAN_HISTORY_ROOT supports an unchanged baseline checkout.
const fs = require("fs"), path = require("path"), vm = require("vm"), assert = require("assert");
const root = process.env.TOBAN_HISTORY_ROOT || path.join(__dirname, ".."), src = path.join(root, "webapp/src");
globalThis.location = { pathname: "/synthetic/history-carry.html" };
globalThis.localStorage = { setItem() {} }; globalThis.document = { querySelector: () => null }; globalThis.T = {};
for (const f of ["i18n.js", "rules-core.js", "model.js", "messages.js", "check.js", "app-core.js", "app-folder.js", "app-month.js"])
  vm.runInThisContext(fs.readFileSync(path.join(src, f), "utf8"), { filename: f });
for (const f of fs.readdirSync(path.join(src, "rules")).filter(f => f.endsWith(".js")))
  vm.runInThisContext(fs.readFileSync(path.join(src, "rules", f), "utf8"), { filename: f });
const A = T.app, clone = x => JSON.parse(JSON.stringify(x)), names = ["Synthetic Alpha", "Synthetic Beta"];
const rules = { profile: { id: "synthetic-history", roles: [{ id: "I", label: "Charge", refs: ["charge"] }],
  shifts: [{ id: "day", on: "none" }, { id: "night", on: "all" }] }, doctors: names.map(name => ({ name, team: "I", quota: 15.5 })) };
T.fillDefaultRules(rules); for (const def of T.RULE_DEFS) if (def.states.includes("off")) rules.rule_states[def.id] = "off";
rules.rule_states.period_charge = "hard";
let source, saves = 0, alerts = [];
const dir = { async getDirectoryHandle() { return dir; }, async getFileHandle() { return { getFile: async () => ({ text: async () => JSON.stringify(source) }) }; } };
A.readAll = A.refreshMonths = A.clearUndo = A.renderSettingsMonth = A.renderDoctor = A.renderFixed = A.toast = () => {};
A.save = () => { saves++; }; globalThis.alert = text => alerts.push(text);
function fixture(y, m, strings, calculated = true) {
  const history = { weekend_charge: {}, holiday_charge: {}, work_balance: {} };
  for (const [key, vals] of Object.entries({ weekend_charge: [3, 1.5], holiday_charge: [4, 0], work_balance: [2, -1.25] }))
    names.forEach((n, i) => { history[key][n] = strings ? String(vals[i]) : vals[i]; });
  const month = T.normalizeMonth({ year: y, month: m, history, holidays: [5], next_first_day_in_calendar: true }, rules);
  const P = new T.Problem(rules, month), asg = Object.fromEntries(P.slots.map((s, i) => [T.Problem.key(s), { work: names[i < 16 ? 0 : 1], oc: [] }]));
  assert.deepStrictEqual(T.check(P, asg).V, [], "fixture is a valid complete roster");
  return { rules: clone(rules), month, result: calculated ? { asg } : null };
}
function build(prior) {
  A.state.rules = clone(rules); const before = JSON.stringify(prior), oldRules = A.state.rules;
  const out = A.buildFromPrevious(prior); assert(!out.error, out.error);
  assert.strictEqual(JSON.stringify(prior), before, "source data must remain unchanged");
  assert.strictEqual(A.state.rules, oldRules, "conversion restores the current rules");
  return out.month;
}
let passed = 0, failed = 0;
async function test(label, fn) { try { await fn(); passed++; console.log("ok " + label); } catch (e) { failed++; console.error("FAIL " + label + ": " + e.stack); } }
(async () => {
  for (const [y, m] of [[2026, 10], [2026, 11], [2026, 12], [2028, 2]]) for (const calculated of [true, false]) {
    await test(`${y}-${m}, ${calculated ? "calculated" : "uncomputed"}: strings match numeric histories`, () => {
      const expected = build(fixture(y, m, false, calculated)), actual = build(fixture(y, m, true, calculated));
      assert.deepStrictEqual(actual.history, expected.history);
      assert.deepStrictEqual(actual.targets, expected.targets, "auto-target balance ordering sees the same numeric history");
      for (const vals of Object.values(actual.history)) for (const v of Object.values(vals)) assert.strictEqual(typeof v, "number");
    });
  }
  await test("known October counts preserve fractional balance and add history exactly", () => {
    const next = build(fixture(2026, 10, true));
    assert.deepStrictEqual(next.history.work_balance, { [names[0]]: 2.5, [names[1]]: -1.75 });
    assert.deepStrictEqual(next.history.weekend_charge, { [names[0]]: 5, [names[1]]: 3.5 });
    assert.deepStrictEqual(next.history.holiday_charge, { [names[0]]: 5, [names[1]]: 0 });
  });
  await test("previous-month import entry point preserves unrelated current input", async () => {
    source = fixture(2026, 10, true); const expected = build(fixture(2026, 10, false));
    Object.assign(A.state, { rules: clone(rules), month: A.blankMonth(2026, 11), ui: {}, result: null });
    A.state.month.notes = "synthetic current note"; A.dirHandle = dir; A.dirGen++; A.monthDirs = ["202610"];
    const before = JSON.stringify(source); saves = 0; alerts = [];
    await A.importPrevious();
    assert.deepStrictEqual(A.state.month.history, expected.history); assert.deepStrictEqual(A.state.month.targets, expected.targets);
    assert.strictEqual(A.state.month.notes, "synthetic current note"); assert.strictEqual(JSON.stringify(source), before);
    assert.strictEqual(saves, 1); assert.deepStrictEqual(alerts, []);
  });
  await test("zero and canceled fractional balance stay numeric and sparse", () => {
    const prior = fixture(2026, 10, true); prior.month.history.work_balance[names[0]] = "-0.5";
    prior.month.history.work_balance[names[1]] = "0";
    prior.month.history.weekend_charge[names[0]] = "0"; prior.month.history.holiday_charge[names[0]] = "0";
    const next = build(prior);
    assert(!Object.hasOwn(next.history.work_balance, names[0]), "zero cumulative balance stays absent");
    assert.strictEqual(next.history.work_balance[names[1]], -0.5);
    assert.strictEqual(next.history.weekend_charge[names[0]], 2); assert.strictEqual(next.history.holiday_charge[names[0]], 1);
  });
  console.log(`numeric history carry: ${passed} passed, ${failed} failed`); if (failed) process.exitCode = 1;
})().catch(e => { console.error(e.stack); process.exitCode = 1; });

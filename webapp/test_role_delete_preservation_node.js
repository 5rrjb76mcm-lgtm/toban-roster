// Deleting a role must leave its staff unassigned, never silently select another role.
// Synthetic data; actual handlers/rendered option markup with a small DOM substitute.
// TOBAN_WEBAPP_ROOT=/path/to/webapp node test_role_delete_preservation_node.js
const fs = require("fs"), path = require("path"), vm = require("vm"), assert = require("assert");
const root = process.env.TOBAN_WEBAPP_ROOT || __dirname, elements = new Map();
function element(sel) {
  if (!elements.has(sel)) elements.set(sel, { handlers: {}, value: "", textContent: "", innerHTML: "", disabled: false,
    addEventListener(type, fn) { (this.handlers[type] ||= []).push(fn); } });
  return elements.get(sel);
}
for (const id of ["settings", "btnUndo", "undoNote", "btnReloadPlugins", "btnApplyRules", "btnResetRules", "doctorTable", "weightsTable", "hardRules", "profileBuilder", "rulesJson", "pluginsInfo"]) element("#" + id);
let doctors = [], roles = [], weights = [], confirmValue = true, confirmations = [];
globalThis.location = { pathname: "/synthetic/role-delete.html" };
globalThis.localStorage = { getItem() { return null; }, setItem() {} };
globalThis.document = {
  querySelector(sel) { return elements.get(sel) || null; },
  querySelectorAll(sel) { return ({ "#doctorTable tr[data-i]": doctors, "#roleTbl tr[data-ri]": roles, "#weightsTable [data-w]": weights })[sel] || []; }
};
globalThis.confirm = text => { confirmations.push(String(text)); return confirmValue; };
globalThis.alert = text => { throw new Error(String(text)); };
globalThis.T = {};
for (const f of ["i18n.js", "rules-core.js", "model.js", "messages.js", "plugins.js", "check.js", "app-core.js", "app-settings.js"])
  vm.runInThisContext(fs.readFileSync(path.join(root, "src", f), "utf8"), { filename: f });
for (const f of fs.readdirSync(path.join(root, "src/rules")).filter(f => f.endsWith(".js")))
  vm.runInThisContext(fs.readFileSync(path.join(root, "src/rules", f), "utf8"), { filename: f });
const A = T.app, clone = x => JSON.parse(JSON.stringify(x)), tick = () => Promise.resolve(), N = ["Synthetic A", "Synthetic B"];
for (const key of ["save", "renderHeader", "renderSettingsMonth", "renderDoctor", "renderFixed", "renderAll", "toast"]) A[key] = () => {};
const decode = s => s.replace(/&quot;|&#39;|&lt;|&gt;|&amp;/g, x => ({ "&quot;": '"', "&#39;": "'", "&lt;": "<", "&gt;": ">", "&amp;": "&" })[x]);
function rosterSelects() {
  return [...element("#doctorTable").innerHTML.matchAll(/<tr data-i="(\d+)">([\s\S]*?)<\/tr>/g)].map(m => {
    const markup = m[2].match(/<select data-f="team">([\s\S]*?)<\/select>/)[1];
    const options = [...markup.matchAll(/<option value="([^"]*)"([^>]*)>/g)].map(o => ({ value: decode(o[1]), selected: /\bselected\b/.test(o[2]) }));
    // A single-select with no explicit selected option defaults to its first option in the browser.
    return { options, value: (options.find(o => o.selected) || options[0] || { value: "" }).value };
  });
}
function inputs() {
  const R = A.state.rules, selects = rosterSelects();
  doctors = R.doctors.map((d, i) => {
    const fields = Object.fromEntries(Object.entries({ name: d.name, team: selects[i].value, years: String(d.years || 0), quota: String(d.quota || 0), duty: d.duty || "" }).map(([k, value]) => [k, { value }]));
    return { dataset: { i: String(i) }, fields, querySelector(sel) { const m = sel.match(/^\[data-f="(.+)"\]$/); return m ? fields[m[1]] || null : null; } };
  });
  roles = T.normalizeRolesOf(R).map((r, i) => {
    const fields = { rid: { value: r.id }, rlabel: { value: r.label }, rref: { value: r.refs[0] || "" }, rstandby: { checked: !!r.standby } };
    return { dataset: { ri: String(i) }, fields, querySelector(sel) { const m = sel.match(/^\[data-(.+)\]$/); return m ? fields[m[1]] : null; } };
  });
  weights = [{ dataset: { w: "wish_night" }, value: String(R.weights.wish_night) }];
}
function paint() { A.renderSettings(); inputs(); }
function setup() {
  const rules = { profile: { id: "synthetic-roles", roles: [{ id: "X", label: "First", refs: ["charge"], standby: true }, { id: "Y", label: "Second", refs: ["junior"], standby: true }] },
    doctors: N.map((name, i) => ({ name, team: i ? "Y" : "X", years: i + 1, quota: i + 2 })), weights: { wish_night: 30 },
    oncall_requirement: { X: { X: 0, Y: 1 }, Y: { X: 1, Y: 0 } } };
  T.fillDefaultRules(rules);
  const month = T.normalizeMonth({ year: 2026, month: 11, next_first_day_in_calendar: true, notes: "Keep synthetic monthly input", unavailable_night: { [N[0]]: [5], [N[1]]: [6] } }, rules);
  Object.assign(A.state, { rules, month, result: { asg: { "1:night": { work: N[0], oc: [N[1]] } } }, meta: { savedSig: "synthetic" }, base: clone(month), baseRules: clone(rules), renames: [], ui: { doctor: 0 } });
  A.solving = false; A.dirHandle = null; A.clearUndo(); confirmValue = true; confirmations = []; paint();
}
function deleteRole(i) {
  const target = { id: "", dataset: { act: "roleDel" }, closest(sel) { return sel === "button" ? this : sel === "tr" ? { dataset: { ri: String(i) } } : null; } };
  for (const fn of element("#settings").handlers.click) fn({ target });
}
function editWeight(value) {
  weights[0].value = String(value);
  const target = { id: "", closest(sel) { return sel === "#doctorTable, #weightsTable, #hardRules, #profileBuilder" ? element("#weightsTable") : null; } };
  for (const fn of element("#settings").handlers.change) fn({ target });
}
const roleWarnings = () => T.lint(new T.Problem(A.state.rules, A.state.month)).filter(x => x.code === "LINT_ROLE_NOT_LISTED");
A.bindSettings();
let passed = 0, failed = 0;
async function test(name, fn) { try { await fn(); console.log("ok " + name); passed++; } catch (e) { console.error("FAIL " + name + ": " + (e.stack || e)); failed++; } }
(async () => {
  await test("accepted deletion clears only affected staff and survives unrelated readback and Undo", async () => {
    setup(); const before = clone(A.state); deleteRole(1); await tick();
    assert.strictEqual(confirmations.length, 1); assert(/空欄/.test(confirmations[0]));
    assert.deepStrictEqual(A.state.rules.doctors.map(d => d.team), ["X", ""], "the confirmed deletion leaves affected staff unassigned");
    for (const k of ["month", "result", "meta", "base", "baseRules", "renames"]) assert.deepStrictEqual(A.state[k], before[k], "preserve " + k);
    assert.deepStrictEqual(A.state.rules.profile.roles.map(r => r.id), ["X"]);
    paint(); assert.strictEqual(rosterSelects()[1].value, ""); assert(rosterSelects()[1].options.some(o => o.value === "" && o.selected));
    assert.strictEqual(roleWarnings().length, 1, "require an explicit valid role selection");
    editWeight(31); await tick(); paint();
    assert.strictEqual(A.state.rules.doctors[1].team, "", "an unrelated edit must not choose the first remaining role");
    assert.strictEqual(roleWarnings().length, 1);
    A.undo(); await tick(); paint(); assert.strictEqual(A.state.rules.weights.wish_night, 30); assert.strictEqual(A.state.rules.doctors[1].team, "");
    A.undo(); assert.deepStrictEqual(A.state.rules, before.rules); assert.deepStrictEqual(A.state.month, before.month); assert.deepStrictEqual(A.state.result, before.result);
    assert(element("#btnUndo").disabled);
  });
  await test("cancel leaves roles and staff intact and preserves an earlier Undo", async () => {
    setup(); editWeight(31); await tick(); paint(); const before = clone(A.state); confirmValue = false;
    deleteRole(1); await tick(); assert.strictEqual(confirmations.length, 1); assert.deepStrictEqual(A.state, before);
    paint(); assert.deepStrictEqual(rosterSelects().map(s => s.value), ["X", "Y"]);
    A.undo(); assert.strictEqual(A.state.rules.weights.wish_night, 30); assert.deepStrictEqual(A.state.rules.doctors.map(d => d.team), ["X", "Y"]);
  });
  await test("imported unknown role stays selected and linted until explicitly reassigned", async () => {
    setup(); const unknown = 'Missing<&"Role', rules = clone(A.state.rules); rules.doctors[1].team = unknown;
    element("#rulesJson").value = JSON.stringify(rules); await element("#btnApplyRules").handlers.click[0](); await tick(); paint();
    assert.strictEqual(rosterSelects()[1].value, unknown); assert(rosterSelects()[1].options.some(o => o.value === unknown && o.selected));
    assert.strictEqual(roleWarnings().length, 1); editWeight(31); await tick(); paint();
    assert.strictEqual(A.state.rules.doctors[1].team, unknown); assert.strictEqual(roleWarnings().length, 1);
    doctors[1].fields.team.value = "X"; A.readSettings("Explicit role selection"); await tick();
    assert.strictEqual(A.state.rules.doctors[1].team, "X"); assert.strictEqual(roleWarnings().length, 0);
    A.undo(); paint(); assert.strictEqual(A.state.rules.doctors[1].team, unknown); assert.strictEqual(rosterSelects()[1].value, unknown);
  });
  await test("blank and missing imported roles never fall back to the first role", async () => {
    for (const team of ["", undefined]) {
      setup(); const rules = clone(A.state.rules); if (team === undefined) delete rules.doctors[1].team; else rules.doctors[1].team = team;
      element("#rulesJson").value = JSON.stringify(rules); await element("#btnApplyRules").handlers.click[0](); await tick(); paint();
      assert.strictEqual(rosterSelects()[1].value, ""); editWeight(31); await tick();
      assert.strictEqual(A.state.rules.doctors[1].team, ""); assert.strictEqual(roleWarnings().length, 1);
    }
  });
  await test("deleting the sole role leaves staff unassigned even with the legacy default-role fallback", async () => {
    setup(); A.state.rules.profile.roles = [A.state.rules.profile.roles[0]]; A.state.rules.doctors.forEach(d => d.team = "X");
    T.fillDefaultRules(A.state.rules); paint(); const before = clone(A.state);
    deleteRole(0); await tick(); paint(); assert.strictEqual(confirmations.length, 1);
    assert.deepStrictEqual(A.state.rules.doctors.map(d => d.team), ["", ""]);
    assert.deepStrictEqual(rosterSelects().map(s => s.value), ["", ""], "default roles must not silently become staff assignments");
    editWeight(31); await tick(); assert.deepStrictEqual(A.state.rules.doctors.map(d => d.team), ["", ""]);
    for (const k of ["month", "result", "meta", "base", "baseRules", "renames"]) assert.deepStrictEqual(A.state[k], before[k], "preserve " + k);
    A.undo(); A.undo(); assert.deepStrictEqual(A.state.rules, before.rules); assert.deepStrictEqual(A.state.month, before.month);
  });
  await test("deleting an unused role preserves staff and requires no confirmation", async () => {
    setup(); A.state.rules.profile.roles.push({ id: "Z", label: "Unused", refs: [] }); paint(); const before = clone(A.state.rules);
    deleteRole(2); await tick(); assert.strictEqual(confirmations.length, 0); assert.deepStrictEqual(A.state.rules.doctors, before.doctors);
    paint(); editWeight(31); await tick(); A.undo(); A.undo(); assert.deepStrictEqual(A.state.rules, before);
  });
  console.log(`role deletion preservation: ${passed} passed, ${failed} failed`); if (failed) process.exitCode = 1;
})().catch(e => { console.error(e.stack || e); process.exitCode = 1; });

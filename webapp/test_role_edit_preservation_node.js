// Invalid role edits must not partly rewrite the roster, OC requirements, month or undo history.
// Synthetic data only. Exercise the real settings reader and event handlers with a small DOM substitute.
const fs = require("fs"), path = require("path"), vm = require("vm"), assert = require("assert");
const root = process.env.TOBAN_WEBAPP_ROOT || __dirname, elements = new Map();
function element(sel) {
  if (!elements.has(sel)) elements.set(sel, { handlers: {}, value: "", textContent: "", innerHTML: "", disabled: false,
    addEventListener(type, fn) { (this.handlers[type] ||= []).push(fn); } });
  return elements.get(sel);
}
for (const id of ["settings", "btnUndo", "undoNote", "btnReloadPlugins", "btnApplyRules", "btnResetRules", "doctorTable", "weightsTable", "hardRules", "profileBuilder", "rulesJson", "pluginsInfo"]) element("#" + id);
let doctors = [], roles = [], ocRows = [], weights = [], showOC = false;
globalThis.location = { pathname: "/synthetic/role-edit.html" };
globalThis.localStorage = { getItem() { return null; }, setItem() {} };
globalThis.document = {
  querySelector(sel) { return sel === "#ocReqTbl" ? (showOC ? {} : null) : elements.get(sel) || null; },
  querySelectorAll(sel) { return ({ "#doctorTable tr[data-i]": doctors, "#roleTbl tr[data-ri]": roles, "#ocReqTbl tr[data-t]": ocRows, "#weightsTable [data-w]": weights })[sel] || []; }
};
globalThis.confirm = () => { throw new Error("Unexpected confirmation for role edit"); };
globalThis.T = {};
for (const f of ["i18n.js", "rules-core.js", "model.js", "messages.js", "plugins.js", "app-core.js", "app-settings.js"])
  vm.runInThisContext(fs.readFileSync(path.join(root, "src", f), "utf8"), { filename: f });
for (const f of fs.readdirSync(path.join(root, "src/rules")).filter(f => f.endsWith(".js")))
  vm.runInThisContext(fs.readFileSync(path.join(root, "src/rules", f), "utf8"), { filename: f });
const A = T.app, clone = x => JSON.parse(JSON.stringify(x)), N = ["Synthetic A", "Synthetic B"];
let toasts, saves, paints, downloads;
A.toast = x => toasts.push(String(x)); A.save = () => saves++; A.download = () => downloads++;
for (const name of ["renderHeader", "renderSettingsMonth", "renderDoctor", "renderFixed", "renderAll"]) A[name] = () => {};
function inputs() {
  const R = A.state.rules;
  doctors = R.doctors.map((d, i) => {
    const fields = Object.fromEntries(Object.entries({ name: d.name, team: d.team, years: String(d.years || 0), quota: String(d.quota || 0), duty: d.duty || "" }).map(([k, value]) => [k, { value }]));
    return { dataset: { i: String(i) }, fields, querySelector(sel) { const m = sel.match(/^\[data-f="(.+)"\]$/); return m ? fields[m[1]] || null : null; } };
  });
  roles = R.profile.roles.map((r, i) => {
    const fields = { rid: { value: r.id }, rlabel: { value: r.label }, rref: { value: r.refs[0] || "" }, rstandby: { checked: !!r.standby } };
    return { dataset: { ri: String(i) }, fields, querySelector(sel) { const m = sel.match(/^\[data-(.+)\]$/); return m ? fields[m[1]] : null; } };
  });
  ocRows = Object.entries(R.oncall_requirement).map(([id, row]) => ({ dataset: { t: id },
    cells: Object.entries(row).map(([col, value]) => ({ dataset: { oc: col }, value: String(value) })),
    querySelectorAll() { return this.cells; } }));
  weights = [{ dataset: { w: "wish_night" }, value: String(R.weights.wish_night) }];
}
const render = A.renderSettings;
A.renderSettings = () => { render(); paints++; inputs(); };
A.bindSettings();
function setup(visible = false) {
  const rules = { profile: { id: "synthetic-roles", roles: [{ id: "X", label: "First", refs: ["charge"], standby: true }, { id: "Y", label: "Second", refs: ["junior"], standby: true }] },
    doctors: N.map((name, i) => ({ name, team: i ? "Y" : "X", years: i + 1, quota: i + 2 })), weights: { wish_night: 30 },
    oncall_requirement: { X: { X: 1, Y: 2 }, Y: { X: 3, Y: 4 } } };
  T.fillDefaultRules(rules);
  const month = T.normalizeMonth({ year: 2026, month: 11, notes: "keep synthetic input", unavailable_night: { [N[0]]: [5], [N[1]]: [6] },
    fixed: { day_oc_none: { 1: ["X"], 8: ["Y"] }, night_oc_none: { 3: ["X", "Y"], 4: ["Y"] } } }, rules);
  Object.assign(A.state, { rules, month, result: { asg: { "1:night": { work: N[0], oc: [N[1]] } } }, meta: { savedSig: "synthetic" },
    base: clone(month), baseRules: clone(rules), renames: [], ui: { doctor: 0 } });
  A.solving = false; A.dirHandle = null; A.clearUndo();
  toasts = []; saves = 0; paints = 0; downloads = 0; showOC = visible; inputs();
}
function change() {
  const target = { id: "", closest(sel) { return sel.includes("#profileBuilder") ? element("#profileBuilder") : null; } };
  for (const fn of element("#settings").handlers.change) fn({ target });
}
function click(act) {
  const target = { id: act === "export" ? "btnExportProfile" : "", dataset: act === "export" ? {} : { act },
    closest(sel) { return sel === "button" ? this : null; } };
  for (const fn of element("#settings").handlers.click) fn({ target });
}
const invalid = [
  ["duplicate IDs", rows => { rows[0].fields.rid.value = "Y"; }],
  ["colon ID", rows => { rows[0].fields.rid.value = "X:bad"; }],
  ["pipe ID", rows => { rows[0].fields.rid.value = "X|bad"; }],
  ["control-character ID", rows => { rows[0].fields.rid.value = "X\u0001bad"; }],
  ["blank ID", rows => { rows[0].fields.rid.value = "   "; }],
  ["all blank IDs", rows => { for (const r of rows) r.fields.rid.value = ""; }],
  ["duplicate role refs", rows => { rows[1].fields.rref.value = "charge"; }],
  ["valid rename before invalid second row", rows => { rows[0].fields.rid.value = "Z"; rows[1].fields.rid.value = "Y:bad"; }],
];
let passed = 0, failed = 0;
async function test(label, fn) { try { await fn(); console.log("ok " + label); passed++; } catch (e) { console.error("FAIL " + label + ": " + (e.stack || e)); failed++; } }
(async () => {
  for (const [label, edit] of invalid) await test(label + " preserves all state and existing undo", async () => {
    for (const visible of [false, true]) {
      setup(visible);
      A.pushUndo("prior valid edit"); A.state.rules.weights.wish_night = 45; await Promise.resolve(); inputs();
      const before = JSON.stringify(A.state), refs = { ...A.state }, roster = A.state.rules.doctors, matrix = A.state.rules.oncall_requirement;
      const undoText = element("#undoNote").textContent;
      edit(roles);
      // Preflight must also run before unrelated roster edits, weight reads or name migration hooks.
      doctors[0].fields.name.value = "Synthetic Renamed"; doctors[0].fields.years.value = "99"; weights[0].value = "999";
      assert.doesNotThrow(change, "failed role edit must be handled by the UI");
      await Promise.resolve();
      assert.strictEqual(JSON.stringify(A.state), before, "reject without changing any live state");
      for (const key of Object.keys(refs)) assert.strictEqual(A.state[key], refs[key], "preserve " + key + " identity");
      assert.strictEqual(A.state.rules.doctors, roster); assert.strictEqual(A.state.rules.oncall_requirement, matrix);
      assert.strictEqual(saves, 0); assert.strictEqual(toasts.length, 1); assert.strictEqual(paints, 1, "repaint from the valid state");
      assert.deepStrictEqual(roles.map(r => r.fields.rid.value), ["X", "Y"]);
      assert.strictEqual(element("#undoNote").textContent, undoText, "failure must not consume undo history");
      A.undo(); assert.strictEqual(A.state.rules.weights.wish_night, 30, "previous valid undo still works");
      assert(element("#btnUndo").disabled);
    }
  });
  await test("direct reads and settings buttons stop on invalid roles", async () => {
    for (const prior of [false, true]) for (const action of [() => A.readSettings(), () => click("roleAdd"), () => click("add"), () => click("export")]) {
      setup();
      if (prior) { A.pushUndo("prior valid edit"); A.state.rules.weights.wish_night = 45; await Promise.resolve(); inputs(); }
      roles[0].fields.rid.value = "Y";
      const before = JSON.stringify(A.state), undoText = element("#undoNote").textContent;
      assert.doesNotThrow(action); await Promise.resolve();
      assert.strictEqual(JSON.stringify(A.state), before); assert.strictEqual(saves, 0); assert.strictEqual(downloads, 0);
      assert.strictEqual(toasts.length, 1); assert.strictEqual(paints, 1); assert.strictEqual(element("#undoNote").textContent, undoText);
      if (prior) { A.undo(); assert.strictEqual(A.state.rules.weights.wish_night, 30); }
      assert(element("#btnUndo").disabled);
    }
  });
  for (const [label, ids] of [["rename", ["Z", "Y"]], ["swap", ["Y", "X"]], ["rename chain", ["Y", "Z"]]]) await test("valid " + label + " preserves both OC axes, fixed exclusions and undo", async () => {
    for (const visible of [false, true]) {
      setup(visible); const before = clone(A.state), [x, y] = ids;
      roles.forEach((r, i) => { r.fields.rid.value = ids[i]; });
      // The visible matrix has pending numeric edits; the hidden matrix must retain its saved values.
      if (visible) ocRows[0].cells[1].value = "7";
      A.pushUndo("valid role edit"); assert.doesNotThrow(() => A.readSettings()); await Promise.resolve();
      assert.deepStrictEqual(A.state.rules.profile.roles.map(r => r.id), ids);
      assert.deepStrictEqual(A.state.rules.doctors.map(d => d.team), ids);
      assert.deepStrictEqual(A.state.rules.oncall_requirement, { [x]: { [x]: 1, [y]: visible ? 7 : 2 }, [y]: { [x]: 3, [y]: 4 } });
      assert.deepStrictEqual(A.state.month.fixed.day_oc_none, { 1: [x], 8: [y] });
      assert.deepStrictEqual(A.state.month.fixed.night_oc_none, { 3: [x, y], 4: [y] });
      assert.deepStrictEqual(A.state.month.unavailable_night, before.month.unavailable_night);
      assert.deepStrictEqual(A.state.result, before.result); assert.deepStrictEqual(A.state.base, before.base); assert.deepStrictEqual(A.state.baseRules, before.baseRules);
      assert.deepStrictEqual(A.state.renames, []); assert.strictEqual(saves, 1); assert.strictEqual(toasts.length, 0);
      A.renderSettings(); const after = JSON.stringify(A.state); A.readSettings();
      assert.strictEqual(JSON.stringify(A.state), after, "reading the repainted inputs must not remap the role twice");
      A.undo(); assert.deepStrictEqual(A.state.rules, before.rules); assert.deepStrictEqual(A.state.month, before.month); assert.deepStrictEqual(A.state.result, before.result);
    }
  });
  await test("valid bound change records a usable undo after validation", async () => {
    setup(true); const before = clone(A.state); roles[0].fields.rid.value = "Z";
    assert.doesNotThrow(change); await Promise.resolve();
    assert.strictEqual(A.state.rules.doctors[0].team, "Z"); assert(!element("#btnUndo").disabled);
    A.undo(); assert.deepStrictEqual(A.state.rules, before.rules); assert.deepStrictEqual(A.state.month, before.month);
  });
  for (const initiallyEmpty of [false, true]) await test("swap undo refuses later monthly edits with " + (initiallyEmpty ? "new" : "existing") + " OC exclusions", async () => {
    for (const visible of [false, true]) {
      setup(visible);
      if (initiallyEmpty) { A.state.month.fixed.day_oc_none = {}; A.state.month.fixed.night_oc_none = {}; }
      roles[0].fields.rid.value = "Y"; roles[1].fields.rid.value = "X";
      assert.doesNotThrow(change); await Promise.resolve();
      assert.deepStrictEqual(A.state.rules.doctors.map(d => d.team), ["Y", "X"]);
      assert.deepStrictEqual(A.state.rules.oncall_requirement, { Y: { Y: 1, X: 2 }, X: { Y: 3, X: 4 } });
      // A later, unrecorded monthly edit means Undo must not restore settings alone: swapping IDs
      // would reinterpret both old exclusions and ones added after the rename as the other role.
      A.state.month.notes = "synthetic later monthly input";
      if (initiallyEmpty) { A.state.month.fixed.day_oc_none[2] = ["Y"]; A.state.month.fixed.night_oc_none[5] = ["X"]; }
      const before = JSON.stringify(A.state), saved = saves; toasts = [];
      assert.doesNotThrow(() => A.undo());
      assert.strictEqual(JSON.stringify(A.state), before, "rejected partial undo keeps swapped roles and monthly inputs consistent");
      assert.strictEqual(saves, saved); assert.strictEqual(toasts.length, 1);
      assert(/取り消せません/.test(toasts[0]), "explain why the role-ID edit cannot be undone");
      assert(element("#btnUndo").disabled);
    }
  });
  console.log(`role edit preservation: ${passed} passed, ${failed} failed`);
  if (failed) process.exitCode = 1;
})().catch(e => { console.error(e.stack || e); process.exitCode = 1; });

// Previous-history import keeps current settings: role-ID fixed exclusions need informed consent.
// Synthetic data only; real import transition/folder reader with an in-memory file handle. No browser.
const fs = require("fs"), vm = require("vm"), path = require("path"), assert = require("assert");
const root = process.env.TOBAN_WEBAPP_ROOT || __dirname;
globalThis.location = { pathname: "/synthetic/import-role-identity.html" };
globalThis.localStorage = { setItem() {} }; globalThis.document = { querySelector: () => null }; globalThis.T = {};
for (const f of ["i18n.js", "rules-core.js", "model.js", "messages.js", "check.js", "app-core.js", "app-folder.js", "app-month.js"])
  vm.runInThisContext(fs.readFileSync(path.join(root, "src", f), "utf8"), { filename: f });
for (const f of fs.readdirSync(path.join(root, "src/rules")).filter(f => f.endsWith(".js")))
  vm.runInThisContext(fs.readFileSync(path.join(root, "src/rules", f), "utf8"), { filename: f });
const A = T.app, clone = x => JSON.parse(JSON.stringify(x));
const oldRules = { profile: { id: "synthetic-import-identity", roles: [
  { id: "X", label: "Synthetic Charge", refs: ["charge"], standby: true },
  { id: "Y", label: "Synthetic Junior", refs: ["junior"], standby: true }] },
  doctors: [{ name: "Synthetic Alpha", team: "X" }, { name: "Synthetic Beta", team: "Y" }] };
T.fillDefaultRules(oldRules);
const swapped = clone(oldRules);
swapped.profile.roles[0].id = "Y"; swapped.profile.roles[1].id = "X";
swapped.doctors[0].team = "Y"; swapped.doctors[1].team = "X";
let source, prompts, saves, alerts, toasts, approve, duringConfirm;
const dir = { async getDirectoryHandle() { return dir; }, async getFileHandle(name) {
  assert.strictEqual(name, "202610_data.json"); return { getFile: async () => ({ text: async () => JSON.stringify(source) }) }; } };
A.refreshMonths = A.readAll = A.renderSettingsMonth = A.renderDoctor = A.renderFixed = () => {};
A.save = () => saves++; A.toast = s => toasts.push(String(s)); globalThis.alert = s => alerts.push(String(s));
globalThis.confirm = text => { prompts.push(String(text)); if (duringConfirm) duringConfirm(); return approve; };
A.choose = async () => { throw new Error("Unexpected facility choice"); };
function setup({ bare = false, same = false, ids = ["Y"], day = 32 } = {}) {
  const R = clone(same ? oldRules : swapped);
  Object.assign(A.state, { rules: R, month: T.normalizeMonth({ year: 2026, month: 11, notes: "Keep current month",
    fixed: { night: { 7: "Synthetic Alpha" }, day_oc_none: { 8: ["X"] } }, fixed_tags: { "7:night|Synthetic Alpha": "Keep tag" } }, R),
    result: { marker: "keep" }, meta: { marker: "keep" }, base: null, baseRules: null, renames: [], ui: { doctor: 0 } });
  const previousMonth = T.normalizeMonth({ year: 2026, month: 10, next_first_day_in_calendar: true,
    fixed: { night_oc_none: { [day]: ids }, night: { 32: "Synthetic Beta" } } }, oldRules);
  source = bare ? previousMonth : { rules: clone(oldRules), month: previousMonth, result: null };
  A.dirHandle = dir; A.dirGen++; A.monthDirs = ["202610"]; A.solving = false; A.switching = 0;
  prompts = []; saves = 0; alerts = []; toasts = []; approve = false; duringConfirm = null;
}
const snapshot = () => JSON.stringify({ rules: A.state.rules, month: A.state.month, result: A.state.result,
  meta: A.state.meta, base: A.state.base, baseRules: A.state.baseRules, renames: A.state.renames });
let passed = 0, failed = 0;
async function test(label, fn) { try { await fn(); passed++; console.log("ok " + label); } catch (e) { failed++; console.error("FAIL " + label + ": " + e.stack); } }
function retained() {
  assert.strictEqual(A.state.month.fixed.night[7], "Synthetic Alpha");
  assert.strictEqual(A.state.month.fixed_tags["7:night|Synthetic Alpha"], "Keep tag");
  assert.deepStrictEqual(A.state.month.fixed.day_oc_none[8], ["X"]);
}
(async () => {
  for (const bare of [false, true]) {
    await test(`${bare ? "legacy" : "wrapped"}: declining preserves all state and does not save`, async () => {
      setup({ bare }); const before = snapshot(); await A.importPrevious();
      assert.strictEqual(prompts.length, 1); assert.strictEqual(saves, 0); assert.deepStrictEqual(alerts, []); assert.strictEqual(snapshot(), before);
      assert(prompts[0].includes("Y:") && prompts[0].includes("Synthetic Charge"));
      if (!bare) assert(prompts[0].includes("Synthetic Junior"));
    });
    await test(`${bare ? "legacy" : "wrapped"}: acceptance keeps literal IDs/current rules and unrelated fixed entries`, async () => {
      setup({ bare }); approve = true; const rules = JSON.stringify(A.state.rules); await A.importPrevious();
      assert.strictEqual(prompts.length, 1); assert.strictEqual(saves, 1); assert.deepStrictEqual(alerts, []);
      assert.strictEqual(JSON.stringify(A.state.rules), rules); assert.deepStrictEqual(A.state.month.fixed.night_oc_none[1], ["Y"]);
      assert.strictEqual(A.state.month.fixed.night[1], "Synthetic Beta"); retained();
    });
    await test(`${bare ? "legacy" : "wrapped"}: undefined carried ID requires consent and remains on acceptance`, async () => {
      setup({ bare, ids: ["Unknown"] }); approve = true; await A.importPrevious();
      assert.strictEqual(prompts.length, 1); assert(prompts[0].includes("Unknown")); assert.strictEqual(saves, 1);
      assert.deepStrictEqual(A.state.month.fixed.night_oc_none[1], ["Unknown"]); retained();
    });
  }
  await test("same wrapped role meanings import without another question", async () => {
    setup({ same: true }); await A.importPrevious(); assert.strictEqual(prompts.length, 0); assert.strictEqual(saves, 1);
    assert.deepStrictEqual(A.state.month.fixed.night_oc_none[1], ["Y"]); retained();
  });
  for (const bare of [false, true]) await test(`${bare ? "legacy" : "wrapped"}: previous-month-only exclusions do not prompt`, async () => {
    setup({ bare, day: 31 }); await A.importPrevious(); assert.strictEqual(prompts.length, 0); assert.strictEqual(saves, 1);
    assert.strictEqual(A.state.month.fixed.night_oc_none[1], undefined); retained();
  });
  await test("changed function with unchanged role label still requires consent", async () => {
    setup({ same: true }); A.state.rules.profile.roles[1].refs = []; const before = snapshot(); await A.importPrevious();
    assert.strictEqual(prompts.length, 1); assert.strictEqual(saves, 0); assert.strictEqual(snapshot(), before);
  });
  for (const change of ["rules", "month", "folder"]) await test(`accepted confirmation becomes stale after ${change} changes`, async () => {
    setup(); approve = true;
    duringConfirm = () => { if (change === "rules") A.state.rules.doctors[0].quota = 99;
      else if (change === "month") A.state.month.notes = "New edit"; else A.dirGen++; };
    await A.importPrevious(); assert.strictEqual(prompts.length, 1); assert.strictEqual(saves, 0);
    assert.strictEqual(A.state.month.fixed.night_oc_none[1], undefined); retained();
  });
  console.log(`previous-import role identity: ${passed} passed, ${failed} failed`); if (failed) process.exitCode = 1;
})().catch(e => { console.error(e.stack); process.exitCode = 1; });

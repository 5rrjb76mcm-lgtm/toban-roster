// Role-ID edits must not reinterpret fixed OC exclusions when another client saves.
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
for (const f of ["i18n.js", "rules-core.js", "model.js", "messages.js", "plugins.js", "merge.js", "app-core.js", "app-folder.js", "app-settings.js", "app-month.js"])
  vm.runInThisContext(fs.readFileSync(path.join(root, "src", f), "utf8"), { filename: f });
for (const f of fs.readdirSync(path.join(root, "src/rules")).filter(f => f.endsWith(".js")))
  vm.runInThisContext(fs.readFileSync(path.join(root, "src/rules", f), "utf8"), { filename: f });
const A = T.app, clone = x => JSON.parse(JSON.stringify(x)), N = ["Synthetic A", "Synthetic B"];
let toasts, saves, paints, downloads;
A.toast = x => toasts.push(String(x)); A.save = () => saves++; A.download = () => downloads++;
for (const name of ["renderHeader", "renderSettingsMonth", "renderDoctor", "renderFixed", "renderAll", "showTab", "readAll"]) A[name] = () => {};
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

const tick = () => Promise.resolve(), fileName = "202611_data.json", baseAt = "2026-10-01T00:00:00Z", peerAt = "2026-10-02T00:00:00Z";
const missing = () => Object.assign(new Error("Synthetic file not found"), { name: "NotFoundError" });
function setupMerge({ noExclusions = false, noBaseRules = false } = {}) {
  setup(true); A.state.result = null; globalThis.confirm = unexpectedConfirm;
  A.state.month.fixed.day_oc_none = {};
  A.state.month.fixed.night_oc_none = noExclusions ? {} : { 3: ["Y"] };
  const files = {}, writes = [];
  const dir = { name: "Synthetic merge", async *entries() { yield ["202611", { kind: "directory" }]; },
    async getDirectoryHandle() { return dir; },
    async getFileHandle(name, opts = {}) {
      if (!opts.create && !(name in files)) throw missing();
      return { getFile: async () => ({ text: async () => files[name] }),
        createWritable: async () => ({ write: async blob => { files[name] = await blob.text(); writes.push(name); }, close: async () => {} }) };
    }
  };
  A.dirHandle = dir; A.dirGen++; A.monthDirs = ["202611"]; A.markSaved("フォルダ Synthetic merge", baseAt);
  const base = JSON.parse(A.payloadJson(baseAt)), peer = clone(base); peer.saved_at = peerAt;
  if (noBaseRules) delete A.state.baseRules;
  A.choose = async () => { throw new Error("Unexpected merge choice"); };
  return { base, peer, files, writes, publish() { files[fileName] = JSON.stringify(this.peer); } };
}
async function rename(mode) {
  inputs();
  if (mode === "swap") { roles[0].fields.rid.value = "Y"; roles[1].fields.rid.value = "X"; }
  else roles[1].fields.rid.value = "Z";
  change(); await tick();
}
async function conflicting(mode, side, table = "night_oc_none", day = 9) {
  const f = setupMerge(); await rename(mode);
  if (side === "peer") {
    f.peer.rules = clone(A.state.rules); f.peer.month = clone(A.state.month);
    A.state.rules = clone(f.base.rules); A.state.month = clone(f.base.month);
    A.state.month.fixed[table][day] = ["Y"];
    A.state.month.notes = "Synthetic local input";
  } else { f.peer.month.fixed[table][day] = ["Y"]; f.peer.month.notes = "Synthetic peer input"; }
  f.publish(); return f;
}
const unexpectedConfirm = () => { throw new Error("Unexpected duplicate/native confirmation"); };
const messageHasConsent = msg => {
  assert.ok(msg.includes("固定「OCなし」")); assert.ok(msg.includes("現在の設定での対応:"));
  assert.ok(msg.includes("IDを変更せず")); assert.ok(msg.includes("未定義のIDは保持"));
};
const run = route => route === "reconcile" ? A.reconcileWithFolder() : route === "manual" ? A.saveToFolder() : A.autosaveJson();
async function expectBlocked(f, route = "auto") {
  const before = JSON.stringify(A.state), beforeFile = f.files[fileName], gen = A.saveGen; let asked = 0;
  A.choose = async (msg, opts) => {
    asked++; assert.ok(msg.includes("固定「OCなし」"));
    assert.ok(!msg.includes("自動統合の元になる版がありません"));
    assert.deepStrictEqual(opts.map(o => o.value), route === "reconcile" ? ["file", null] : ["load", "overwrite", null]); return null;
  };
  const result = await run(route); if (route !== "reconcile") assert.strictEqual(result, "skipped");
  assert.strictEqual(asked, 1); assert.strictEqual(JSON.stringify(A.state), before);
  assert.strictEqual(f.files[fileName], beforeFile); assert.deepStrictEqual(f.writes, []); assert.strictEqual(A.saveGen, gen);
}
let passed = 0;
async function test(label, fn) { await fn(); console.log("ok " + label); passed++; }
(async () => {
  for (const mode of ["rename", "swap"]) for (const side of ["local", "peer"]) for (const table of ["day_oc_none", "night_oc_none"]) for (const day of [9, 31])
    await test(`${side} role ${mode}, ${table} day ${day}: cancel preserves both complete versions`, async () => { await expectBlocked(await conflicting(mode, side, table, day)); });
  for (const route of ["manual", "reconcile"]) await test(`complete role mismatch is explained on ${route}`, async () => { await expectBlocked(await conflicting("swap", "local"), route); });
  await test("missing base settings do not guess exclusion identity", async () => {
    const f = setupMerge({ noBaseRules: true }); A.state.month.notes = "Synthetic local edit"; f.peer.month.fixed.night_oc_none[9] = ["Y"]; f.publish(); await expectBlocked(f);
  });
  // The legacy-file choice is informed consent for this exact load. There must be no second dialog.
  for (const route of ["auto", "manual", "reconcile"]) for (const noBase of [false, true]) for (const approve of [false, true]) await test(`legacy ${route}, no base ${noBase}, approve ${approve}`, async () => {
    const f = await conflicting("rename", "local"); delete f.peer.rules;
    f.peer.month.fixed.day_oc_none[8] = ["X", "Legacy-Unknown"]; if (noBase) { A.state.base = null; A.state.baseRules = null; } f.publish();
    const before = JSON.stringify(A.state), beforeRules = clone(A.state.rules), beforeFile = f.files[fileName]; let asked = 0;
    A.choose = async (msg, opts) => {
      asked++; messageHasConsent(msg); assert.ok(msg.includes("X: First")); assert.ok(msg.includes("Y: 現在の設定にないID（未定義）")); assert.ok(msg.includes("Legacy-Unknown: 現在の設定にないID（未定義）"));
      const value = route === "reconcile" ? "file" : "load"; assert.ok(opts.find(o => o.value === value).label.includes("現在の役割")); return approve ? value : null;
    };
    const result = await run(route); if (route !== "reconcile") assert.strictEqual(result, "skipped"); assert.strictEqual(asked, 1);
    if (approve) { assert.deepStrictEqual(A.state.rules, beforeRules); assert.deepStrictEqual(A.state.month.fixed, f.peer.month.fixed); }
    else assert.strictEqual(JSON.stringify(A.state), before);
    assert.strictEqual(f.files[fileName], beforeFile); assert.deepStrictEqual(f.writes, []);
  });
  await test("approved legacy load uses reused IDs literally, never guessed renames", async () => {
    const f = await conflicting("swap", "local"); delete f.peer.rules; f.publish(); let asked = 0;
    A.choose = async (msg) => { asked++; messageHasConsent(msg); assert.ok(msg.includes("Y: First")); return "load"; };
    assert.strictEqual(await A.autosaveJson(), "skipped"); assert.strictEqual(asked, 1); assert.deepStrictEqual(A.state.month.fixed.night_oc_none[9], ["Y"]);
    assert.strictEqual(A.state.rules.profile.roles.find(r => r.refs.includes("junior")).id, "X");
  });
  await test("legacy conflict still permits explicit overwrite with local rules and month", async () => {
    const f = await conflicting("rename", "local"), local = clone({ rules: A.state.rules, month: A.state.month }); delete f.peer.rules; f.publish();
    A.choose = async (msg, opts) => { messageHasConsent(msg); assert.deepStrictEqual(opts.map(o => o.value), ["load", "overwrite", null]); return "overwrite"; };
    assert.strictEqual(await A.autosaveJson(), "saved"); const disk = JSON.parse(f.files[fileName]); assert.deepStrictEqual(disk.rules, local.rules); assert.deepStrictEqual(disk.month, local.month);
  });
  for (const bare of [false, true]) for (const approve of [false, true]) await test(`clean legacy reconciliation, bare ${bare}, approve ${approve}`, async () => {
    const f = await conflicting("rename", "local"); A.markSaved("フォルダ Synthetic merge", baseAt); delete f.peer.rules; if (bare) f.peer = f.peer.month; f.publish();
    const before = JSON.stringify(A.state), rules = clone(A.state.rules), beforeFile = f.files[fileName]; let asked = 0;
    globalThis.confirm = msg => { asked++; messageHasConsent(msg); return approve; };
    assert.strictEqual(A.isDirty(), false); await A.reconcileWithFolder(); assert.strictEqual(asked, 1);
    if (approve) { assert.deepStrictEqual(A.state.rules, rules); assert.deepStrictEqual(A.state.month.fixed, (bare ? f.peer : f.peer.month).fixed); }
    else assert.strictEqual(JSON.stringify(A.state), before);
    assert.strictEqual(f.files[fileName], beforeFile); assert.deepStrictEqual(f.writes, []);
  });
  for (const bare of [false, true]) for (const fromFolder of [false, true]) for (const approve of [false, true]) await test(`direct legacy load, bare ${bare}, folder ${fromFolder}, approve ${approve}`, async () => {
    const f = await conflicting("swap", "local"); delete f.peer.rules; const incoming = bare ? f.peer.month : f.peer, before = JSON.stringify(A.state), rules = clone(A.state.rules); let asked = 0;
    globalThis.confirm = msg => { asked++; messageHasConsent(msg); return approve; };
    const result = A.applyLoaded(incoming, "Synthetic load", { fromFolder }); assert.strictEqual(asked, 1);
    if (approve) { assert.notStrictEqual(result, false); assert.deepStrictEqual(A.state.rules, rules); assert.deepStrictEqual(A.state.month.fixed, f.peer.month.fixed); }
    else { assert.strictEqual(result, false); assert.strictEqual(JSON.stringify(A.state), before); }
    assert.deepStrictEqual(f.writes, []);
  });
  for (const approve of [false, true]) await test(`openMonth returns correct status after legacy approval ${approve}`, async () => {
    const f = setupMerge(); f.files["202612_data.json"] = JSON.stringify({ month: { year: 2026, month: 12, fixed: { day_oc_none: { 1: ["Y"] } } } });
    const before = JSON.stringify(A.state); globalThis.confirm = msg => { messageHasConsent(msg); return approve; };
    assert.strictEqual(await A.openMonth("202612"), approve); if (approve) assert.strictEqual(A.state.month.month, 12); else assert.strictEqual(JSON.stringify(A.state), before); assert.deepStrictEqual(f.writes, []);
  });
  await test("canceling a legacy month switch preserves current input and its completed pre-navigation save", async () => {
    for (const id of ["folderBar", "btnOpenFolder", "monthTitle", "docLabel", "saveState", "monthSel"]) element("#" + id);
    const oldWindow = globalThis.window, oldAlert = globalThis.alert;
    globalThis.window = {}; globalThis.alert = msg => { throw new Error("Unexpected alert: " + msg); };
    try {
      const f = setupMerge(); f.files[fileName] = JSON.stringify(f.base); const currentBefore = f.files[fileName], target = "202612_data.json";
      f.files[target] = JSON.stringify({ month: { year: 2026, month: 12, fixed: { day_oc_none: { 1: ["Y"] } } } }); const targetBefore = f.files[target];
      A.state.month.notes = "Synthetic unsaved work"; const inputBefore = clone({ rules: A.state.rules, month: A.state.month }), startGen = A.saveGen;
      let asked = 0, promptState, promptGen, promptCurrentFile;
      globalThis.confirm = msg => { asked++; messageHasConsent(msg); promptState = JSON.stringify(A.state); promptGen = A.saveGen; promptCurrentFile = f.files[fileName]; return false; };
      assert.strictEqual(A.isDirty(), true); assert.strictEqual(await A.openMonth("202612"), false); assert.strictEqual(asked, 1); assert.strictEqual(A.tag(), "202611");
      assert.deepStrictEqual(A.state.month, inputBefore.month); assert.deepStrictEqual(A.state.rules, inputBefore.rules);
      // The current month was saved before the role confirmation. Cancel does not undo that successful save.
      assert.notStrictEqual(f.files[fileName], currentBefore); assert.strictEqual(JSON.parse(f.files[fileName]).month.notes, "Synthetic unsaved work"); assert.ok(A.saveGen > startGen);
      assert.strictEqual(JSON.stringify(A.state), promptState); assert.strictEqual(A.saveGen, promptGen); assert.strictEqual(f.files[fileName], promptCurrentFile);
      assert.strictEqual(f.files[target], targetBefore); assert.ok(!f.writes.includes(target), "the incoming month is never written on cancel");
    } finally { globalThis.window = oldWindow; globalThis.alert = oldAlert; }
  });
  for (const bare of [false, true]) await test(`incoming month without exclusions loads without asking despite local exclusions, bare ${bare}`, async () => {
    setupMerge(); const rules = clone(A.state.rules), month = { year: 2026, month: 12, notes: "Synthetic replacement" };
    assert.notStrictEqual(A.applyLoaded(bare ? month : { month }, "Synthetic load", { fromFolder: false }), false);
    assert.strictEqual(A.state.month.month, 12); assert.deepStrictEqual(A.state.rules, rules);
  });
  await test("peer with no incoming exclusions can be selected despite local exclusions", async () => {
    const f = setupMerge(); A.state.month.notes = "Synthetic local edit"; delete f.peer.rules; f.peer.month.fixed.night_oc_none = {}; f.publish();
    A.choose = async () => "load"; assert.strictEqual(await A.autosaveJson(), "skipped"); assert.deepStrictEqual(A.state.month.fixed.night_oc_none, {});
  });
  await test("clean reconcile adopts complete settings/month atomically without legacy confirmation", async () => {
    const f = await conflicting("rename", "peer"); A.state.month = clone(f.base.month); A.markSaved("フォルダ Synthetic merge", baseAt);
    await A.reconcileWithFolder(); assert.deepStrictEqual(A.state.rules.profile.roles, f.peer.rules.profile.roles); assert.deepStrictEqual(A.state.month.fixed, f.peer.month.fixed);
  });
  for (const bare of [false, true]) for (const table of ["day_oc_none", "night_oc_none"]) await test(`previous-month creation confirms only carried exclusions (${table}, bare ${bare})`, async () => {
    const f = setupMerge(), month = clone(f.peer.month); month.fixed.day_oc_none = {}; month.fixed.night_oc_none = {}; month.fixed[table][31] = ["Y", "Legacy-Unknown"];
    month.fixed[table][9] = ["Not-carried"]; const incoming = bare ? month : { month }, before = JSON.stringify(A.state); let asked = 0;
    globalThis.confirm = msg => { asked++; messageHasConsent(msg); assert.ok(msg.includes("Y: Second")); assert.ok(msg.includes("Legacy-Unknown")); assert.ok(!msg.includes("Not-carried")); return false; };
    let result = A.buildFromPrevious(incoming); assert.ok(result.error); assert.strictEqual(asked, 1); assert.strictEqual(JSON.stringify(A.state), before);
    globalThis.confirm = () => { asked++; return true; }; result = A.buildFromPrevious(incoming); assert.ok(!result.error, result.error); assert.deepStrictEqual(result.month.fixed[table][1], ["Y", "Legacy-Unknown"]); assert.strictEqual(asked, 2);
    globalThis.confirm = unexpectedConfirm;
    result = A.buildFromPrevious({ month, rules: f.peer.rules }); assert.ok(!result.error, result.error); assert.deepStrictEqual(result.month.fixed[table][1], ["Y", "Legacy-Unknown"]);
    result = A.buildFromPrevious(incoming, 2027, 1); assert.ok(!result.error, result.error); assert.ok(!Object.keys(result.month.fixed[table] || {}).length);
    delete month.fixed[table][31]; result = A.buildFromPrevious(incoming); assert.ok(!result.error, result.error); assert.ok(!Object.keys(result.month.fixed[table] || {}).length); assert.strictEqual(JSON.stringify(A.state), before);
  });
  // Same-month edits and same-tag replacements must invalidate an asynchronous approval, not just navigation.
  const edits = {
    notes: () => { A.state.month.notes = "Synthetic newer input"; },
    fixed: () => { A.state.month.fixed.night[8] = N[0]; },
    roles: () => { A.state.rules.profile.roles[0].label = "Synthetic newer role"; },
    monthObject: () => { A.state.month = clone(A.state.month); },
    rulesObject: () => { A.state.rules = clone(A.state.rules); },
    result: () => { A.state.result = { at: "synthetic newer result" }; },
    month: () => { A.state.month.month = 12; },
    folder: () => { A.dirGen++; },
    sync: () => { A.saveGen++; }
  };
  for (const route of ["auto", "manual", "reconcile"]) for (const [label, edit] of Object.entries(edits)) await test(`legacy ${route} approval refuses newer ${label}`, async () => {
    const f = await conflicting("rename", "local"); delete f.peer.rules; f.publish(); const beforeFile = f.files[fileName];
    let enter, release; const entered = new Promise(r => enter = r), answer = new Promise(r => release = r);
    A.choose = async msg => { messageHasConsent(msg); enter(); return answer; };
    const pending = run(route); await entered; edit(); const newer = JSON.stringify(A.state); release(route === "reconcile" ? "file" : "load");
    const status = await pending; if (route !== "reconcile") assert.strictEqual(status, "skipped"); assert.strictEqual(JSON.stringify(A.state), newer); assert.strictEqual(f.files[fileName], beforeFile); assert.deepStrictEqual(f.writes, []);
  });
  for (const route of ["auto", "reconcile"]) await test(`complete role-mismatch ${route} choice also preserves newer input`, async () => {
    const f = await conflicting("swap", "local"); let enter, release; const entered = new Promise(r => enter = r), answer = new Promise(r => release = r);
    A.choose = async () => { enter(); return answer; }; const pending = run(route); await entered; A.state.month.notes = "Synthetic newer"; const newer = JSON.stringify(A.state); release(route === "reconcile" ? "file" : "load");
    await pending; assert.strictEqual(JSON.stringify(A.state), newer); assert.deepStrictEqual(f.writes, []);
  });
  await test("direct consent cannot approve a changed incoming object", async () => {
    const f = setupMerge(); delete f.peer.rules; const before = JSON.stringify(A.state);
    globalThis.confirm = () => { f.peer.month.fixed.night_oc_none[9] = ["New-ID"]; return true; };
    assert.strictEqual(A.applyLoaded(f.peer, "Synthetic"), false); assert.strictEqual(JSON.stringify(A.state), before);
  });
  await test("direct consent cannot approve changed current settings", async () => {
    const f = setupMerge(); delete f.peer.rules; let newer;
    globalThis.confirm = () => { A.state.rules.profile.roles[1].label = "Synthetic changed"; newer = JSON.stringify(A.state); return true; };
    assert.strictEqual(A.applyLoaded(f.peer, "Synthetic"), false); assert.strictEqual(JSON.stringify(A.state), newer);
  });
  await test("previous-month confirmation cannot approve changed settings", async () => {
    const f = setupMerge(), month = clone(f.peer.month); month.fixed.night_oc_none[31] = ["Y"]; let newer;
    globalThis.confirm = () => { A.state.rules.profile.roles[1].label = "Synthetic changed"; newer = JSON.stringify(A.state); return true; };
    assert.ok(A.buildFromPrevious({ month }).error); assert.strictEqual(JSON.stringify(A.state), newer);
  });
  await test("identical role changes on both sides still require known base correspondence", async () => {
    const f = setupMerge(); await rename("swap"); f.peer.rules = clone(A.state.rules); f.peer.month = clone(A.state.month); f.peer.month.fixed.night_oc_none[9] = ["X"]; f.publish(); await expectBlocked(f);
  });
  await test("labels conservatively protect same-ID identity changes", async () => {
    const f = setupMerge(); A.state.rules.profile.roles[1].label = "Synthetic changed role"; f.peer.month.fixed.night_oc_none[9] = ["Y"]; f.publish(); await expectBlocked(f);
  });
  for (const choice of ["load", "overwrite"]) await test(`complete version ${choice} remains atomic`, async () => {
    const f = await conflicting("swap", "local"), local = clone({ rules: A.state.rules, month: A.state.month }), beforeFile = f.files[fileName]; let asked = 0;
    A.choose = async () => { asked++; return choice; }; assert.strictEqual(await A.autosaveJson(), choice === "overwrite" ? "saved" : "skipped"); assert.strictEqual(asked, 1);
    const chosen = choice === "overwrite" ? local : f.peer; assert.deepStrictEqual(A.state.rules.profile.roles, chosen.rules.profile.roles); assert.deepStrictEqual(A.state.month.fixed, chosen.month.fixed);
    const disk = JSON.parse(f.files[fileName]); if (choice === "load") { assert.strictEqual(f.files[fileName], beforeFile); assert.deepStrictEqual(f.writes, []); }
    else { assert.deepStrictEqual(disk.rules.profile.roles, local.rules.profile.roles); assert.deepStrictEqual(disk.month.fixed, local.month.fixed); }
  });
  await test("unchanged role definitions still auto-merge disjoint exclusions", async () => {
    const f = setupMerge(); A.state.month.fixed.day_oc_none[8] = ["Y"]; f.peer.month.fixed.night_oc_none[9] = ["Y"]; f.publish(); assert.strictEqual(await A.autosaveJson(), "saved"); assert.deepStrictEqual(A.state.month.fixed.day_oc_none[8], ["Y"]); assert.deepStrictEqual(A.state.month.fixed.night_oc_none[9], ["Y"]);
  });
  await test("pure role-table reorder still auto-merges", async () => {
    const f = setupMerge(); A.state.rules.profile.roles.reverse(); f.peer.month.fixed.night_oc_none[9] = ["Y"]; f.publish(); assert.strictEqual(await A.autosaveJson(), "saved"); assert.deepStrictEqual(A.state.month.fixed.night_oc_none[9], ["Y"]);
  });
  for (const missingBase of [false, true]) await test(`no OC exclusions retain merge behavior, missing base settings ${missingBase}`, async () => {
    const f = setupMerge({ noExclusions: true, noBaseRules: missingBase }); if (!missingBase) await rename("rename"); else A.state.month.notes = "Synthetic local edit";
    f.peer.month.day_notes = { 9: "Synthetic peer note" }; f.publish(); assert.strictEqual(await A.autosaveJson(), "saved"); assert.strictEqual(A.state.month.day_notes[9], "Synthetic peer note");
  });
  await test("base-only exclusions still protect role changes", async () => {
    const f = setupMerge(); await rename("rename"); A.state.month.fixed.night_oc_none = {}; f.peer.month.fixed.night_oc_none = {}; f.peer.month.notes = "Synthetic peer edit"; f.publish(); await expectBlocked(f);
  });
  console.log(`role merge preservation: ${passed} passed`);
})().catch(e => { console.error(e.stack || e); process.exitCode = 1; });

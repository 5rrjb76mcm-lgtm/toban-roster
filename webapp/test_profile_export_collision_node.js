// Shared-profile export must distinguish staff names from schema keys and IDs.
// Exercises the actual sanitizer and rendered export/download/import entry points.
// All staff, settings, browser storage and downloads here are synthetic.
const fs = require("fs"), path = require("path"), vm = require("vm"), assert = require("assert"), { execFileSync } = require("child_process");
const root = process.env.TOBAN_TEST_ROOT || __dirname, elements = new Map();
const element = s => { if (!elements.has(s)) elements.set(s, { value: "", innerHTML: "", textContent: "", hidden: false, disabled: false, className: "", listeners: {}, querySelectorAll: () => [], querySelector: () => null, addEventListener(k, fn) { (this.listeners[k] ||= []).push(fn); } }); return elements.get(s); };
let alerts = [], confirmations = [], downloads = [], toasts = [], saves = 0, confirmAnswer = true, unhandled = [];
const blobs = new Map(); let blobId = 0;
URL.createObjectURL = blob => { const id = `blob:synthetic/${++blobId}`; blobs.set(id, blob); return id; };
URL.revokeObjectURL = id => blobs.delete(id);
globalThis.document = { querySelector: element, querySelectorAll: () => [], addEventListener() {},
  body: { appendChild() {} }, createElement(tag) { assert.strictEqual(tag, "a"); return { click() { downloads.push({ name: this.download, blob: blobs.get(this.href) }); }, remove() {} }; } };
globalThis.confirm = text => { confirmations.push(String(text)); return confirmAnswer; };
globalThis.alert = text => alerts.push(String(text));
globalThis.window = globalThis;
globalThis.location = { pathname: "/synthetic/export-collision.html", protocol: "file:", href: "file:///synthetic/export-collision.html" };
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.T = {};
for (const f of ["i18n.js", "rules-core.js", "model.js", "messages.js", "solver.js", "check.js", "merge.js", "plugins.js", "app-core.js", "app-folder.js", "app-settings.js"])
  vm.runInThisContext(fs.readFileSync(path.join(root, "src", f), "utf8"), { filename: f });
for (const f of fs.readdirSync(path.join(root, "src/rules")).filter(f => f.endsWith(".js")))
  vm.runInThisContext(fs.readFileSync(path.join(root, "src/rules", f), "utf8"), { filename: f });
for (const f of fs.readdirSync(path.join(root, "lang"))) T.registerLang(JSON.parse(fs.readFileSync(path.join(root, "lang", f), "utf8")));
T.setLang("ja");
const A = T.app, clone = o => JSON.parse(JSON.stringify(o)), B = "Synthetic B", C = "Synthetic C", FORMER = "Synthetic Former";
T.DEFAULT_RULES = JSON.parse(fs.readFileSync(path.join(root, "data/rules.json"), "utf8"));
for (const key of ["renderAll", "renderHeader", "readAll", "renderSettingsMonth", "renderDoctor", "renderFixed", "showTab"]) A[key] = () => {};
A.save = () => saves++; A.toast = text => toasts.push(String(text));
process.on("unhandledRejection", error => unhandled.push(error));
A.bindSettings();
let passed = 0, failed = 0;
async function test(label, fn) { try { await fn(); console.log("ok " + label); passed++; } catch (error) { console.error("FAIL " + label + ": " + error.stack); failed++; } }
// Reuse the actual-settings-renderer harness from test_roster_cleanup_collision_node.js.
// Only DOM selection/event dispatch and the browser download boundary are adapted.
const parseControls = html => JSON.parse(execFileSync("python3", ["-c", `import json,sys
from html.parser import HTMLParser
class Controls(HTMLParser):
 def __init__(self): super().__init__(); self.root={'tag':'root','attrs':{},'children':[]}; self.stack=[self.root]
 def handle_starttag(self,tag,attrs):
  n={'tag':tag,'attrs':dict(attrs),'children':[]}; self.stack[-1]['children'].append(n)
  if tag not in ('input','br','hr','img','meta','link'): self.stack.append(n)
 def handle_endtag(self,tag):
  for i in range(len(self.stack)-1,0,-1):
   if self.stack[i]['tag']==tag: self.stack=self.stack[:i]; break
p=Controls(); p.feed(sys.stdin.read()); print(json.dumps(p.root))`], { input: html, encoding: "utf8" }));
const matchesControl = (el, selector) => selector.split(",").some(s => {
  s=s.trim();const tag=s.match(/^[\w-]+/),id=s.match(/#([\w-]+)/);
  if(tag&&el.tag!==tag[0]||id&&el.attrs.id!==id[1])return false;
  return [...s.matchAll(/\[([^=\]]+)(?:=(?:"([^"]*)"|([^\]]+)))?\]/g)].every(([,k,a,b])=>Object.hasOwn(el.attrs,k)&&(a===undefined&&b===undefined||el.attrs[k]===(a??b)));
});
function controlNode(raw,parent=null) {
  const e={...raw,parent,id:raw.attrs.id||"",value:raw.attrs.value||"",checked:Object.hasOwn(raw.attrs,"checked"),type:raw.attrs.type||"text",
    dataset:Object.fromEntries(Object.entries(raw.attrs).filter(([k])=>k.startsWith("data-")).map(([k,v])=>[k.slice(5).replace(/-([a-z])/g,(_,c)=>c.toUpperCase()),v])),
    getAttribute(k){return this.attrs[k]??null;},hasAttribute(k){return Object.hasOwn(this.attrs,k);},
    querySelectorAll(s){return this.children.flatMap(c=>(matchesControl(c,s)?[c]:[]).concat(c.querySelectorAll(s)));},querySelector(s){return this.querySelectorAll(s)[0]||null;},
    closest(s){for(let n=this;n;n=n.parent)if(matchesControl(n,s))return n;return null;}};
  e.children=raw.children.map(c=>controlNode(c,e));
  if(e.tag==="select"){const options=e.querySelectorAll("option");e.value=(options.find(o=>o.hasAttribute("selected"))||options[0]||{attrs:{}}).attrs.value||"";}
  return e;
}
const settingsPanes=["doctorTable","weightsTable","hardRules","profileBuilder"], parsedPanes=new Map();
function settingsTree(id){const html=element("#"+id).innerHTML,old=parsedPanes.get(id);if(old&&old.html===html)return old.tree;const tree=controlNode(parseControls(html));parsedPanes.set(id,{html,tree});return tree;}
function uiLookup(s){const parts=s.trim().split(/\s+/),first=parts.shift();let found;
  if(first.startsWith("#")&&elements.has(first))found=[elements.get(first)];
  else found=settingsPanes.flatMap(id=>settingsTree(id).querySelectorAll(first));
  for(const part of parts)found=found.flatMap(e=>e.querySelectorAll(part));return found;}

const structureKeys = ["profile", "weights", "rule_states", "oncall_requirement", "shift_counts"];
const structure = R => Object.fromEntries(structureKeys.map(k => [k, clone(R[k])]));
function setup(name = "night") {
  document.querySelector = element; document.querySelectorAll = () => []; parsedPanes.clear();
  alerts = []; confirmations = []; downloads = []; toasts = []; saves = 0; unhandled = []; confirmAnswer = true;
  const R = { profile: { id: "synthetic-export", label: { ja: "施設ひな型" }, roles: [
    { id: "I", label: "職員", refs: ["charge"] }, { id: "Y", label: "補助", refs: ["junior"] }],
    shifts: [{ id: "day", label: "日勤", on: "none" }, { id: "night", label: "夜勤", on: "all" }],
    positions: { work: { count: { day: 1, night: 2 } } } },
    doctors: [{ name, team: "I", quota: 4, share: 1, years: 19, quals: ["private qualification"], local_note: "private staff note", duty: "never" },
      { name: B, team: "I", quota: 4 }, { name: C, team: "Y", quota: 4 }],
    name_order: [C, name, B], oncall_requirement: { I: { Y: 1 }, Y: { I: 2 } },
    shift_counts: { day: { min: 1, max: 8 }, night: { min: 2, max: 12 } } };
  T.fillDefaultRules(R);
  for (const def of T.RULE_DEFS) if ((def.states || []).includes("off")) R.rule_states[def.id] = "off";
  R.weights.target_deviation = 123; R.weights.same_weekday_excess = 321;
  R.rest_day_required = false; R.days_off = { ake_is_off: true }; R.rules_version = 1;
  R.profile.roles[0].standby = true; R.profile.shifts[1].oncall = true;
  R.friday_night_min = { [name]: 2, [B]: 1, [FORMER]: 3 };
  R.dayoff_work_max = { [name]: 3, [B]: 4, [FORMER]: 2 };
  R.weekend_dayshift_wish = [name, B, FORMER];
  R.pm_clinic_arrhythmia_candidates = [name, B]; R.arrhythmia_responsible_night = [name, B];
  R.opaque = { by_name: { [B]: { max: 2 }, [C]: { max: 3 } }, contact: B, nested: [{ values: [B, C] }],
    records: [{ name, note: "private person record" }, { name: B }, { kind: "neutral" }] };
  Object.assign(A.state, { rules: R, month: T.normalizeMonth({ year: 2026, month: 11, notes: "synthetic month unchanged", unavailable_night: { [name]: [5] } }, R),
    result: null, meta: null, base: null, baseRules: null, renames: [], ui: { doctor: 0 } });
  A.dirHandle = null; A.solving = false; A.switching = 0; A.clearUndo();
  return R;
}
function assertStaffing(R) {
  const P = new T.Problem(R, T.normalizeMonth({ year: 2026, month: 11 }, R));
  assert.strictEqual(P.countOf([1, "night"]), 2, "two night workers survive export/import");
  assert.strictEqual(P.countMinOf([1, "night"]), 2, "two night workers remain required");
  assert.strictEqual(P.countOf([1, "day"]), 1);
  const names = R.doctors.map(d => d.name), assignments = {};
  for (const slot of P.slots) assignments[`${slot[0]}:${slot[1]}`] = { work: names.slice(0, P.countOf(slot)), oc: [] };
  assert(!T.check(P, assignments).VC.some(v => v.code === "SLOT_WORKER_COUNT"), "two workers satisfy the exported/imported requirement");
  assignments["1:night"].work = names[0];
  assert(T.check(P, assignments).VC.some(v => v.code === "SLOT_WORKER_COUNT"), "checker still rejects only one night worker");
}
function assertShared(R, original) {
  assert.deepStrictEqual(structure(R), structure(original), "structural keys, IDs, enum values and rule settings are preserved");
  assert.deepStrictEqual(R.doctors.map(d => d.name), ["職員1", "職員2", "補助1"]);
  assert.deepStrictEqual(R.doctors.map(d => d.team), ["I", "I", "Y"], "role references are not staff references");
  assert.deepStrictEqual(Object.keys(R.doctors[0]).sort(), ["name", "quota", "share", "team"]);
  const rename = new Map(original.doctors.map((d, i) => [d.name, R.doctors[i].name]));
  assert.deepStrictEqual(R.name_order, original.name_order.map(n => rename.get(n)));
  assert.deepStrictEqual(R.friday_night_min, {}); assert.deepStrictEqual(R.dayoff_work_max, {});
  assert.deepStrictEqual(R.weekend_dayshift_wish, ["職員1", "職員2"]);
  assert.deepStrictEqual(R.pm_clinic_arrhythmia_candidates, ["職員1", "職員2"]);
  assert.deepStrictEqual(R.arrhythmia_responsible_night, ["職員1", "職員2"]);
  assert.deepStrictEqual(R.opaque, { by_name: {}, contact: "職員2", nested: [{ values: ["職員2", "補助1"] }], records: [{ kind: "neutral" }] });
  assert(!JSON.stringify(R).includes(FORMER), "former staff do not survive in hidden registered columns");
  assert(!JSON.stringify(R).includes("private staff note")); assert(!JSON.stringify(R).includes("private person record"));
  assertStaffing(R);
}
function renderControls() {
  A.renderSettings();
  for (const id of settingsPanes) { const el = element("#" + id); el.querySelectorAll = s => settingsTree(id).querySelectorAll(s); el.querySelector = s => settingsTree(id).querySelector(s); }
  document.querySelector = s => uiLookup(s)[0] || null; document.querySelectorAll = uiLookup;
  A.renderAll = () => A.renderSettings();
  // Real readback canonically fills the displayed controls before taking mutation snapshots.
  assert.notStrictEqual(A.readSettings(), false); A.renderSettings(); A.clearUndo(); saves = 0;
}
async function dispatch(type, target) {
  assert(target, "actual rendered control exists");
  for (const fn of element("#settings").listeners[type] || []) await fn({ target });
  await new Promise(resolve => setImmediate(resolve));
  assert.strictEqual(unhandled.length, 0, "UI handler has no unhandled rejection");
}
async function clickExport() { await dispatch("click", document.querySelector("#btnExportProfile")); }
async function importDownload(download) {
  const input = document.querySelector("#fileLoadProfile"); assert(input, "actual rendered import input exists");
  input.files = [{ name: download.name, text: () => download.blob.text() }]; input.value = download.name;
  await dispatch("change", input);
}
function registerPersonalColumn(state = "off") {
  const id = "local.export.personal";
  T.rules.register({ id, api: 1, states: ["hard", "off"], def: "off", columns: [{ key: "personal_fixture", when: () => false,
    begin() { return {}; }, end(R) { if (R.local_person) { R.local_person.by_name = {}; R.local_person.names = []; R.local_person.members = []; } } }] });
  const R = A.state.rules; R.rule_states[id] = state;
  R.local_person = { by_name: { night: { max: 2 }, [B]: { max: 1 }, [FORMER]: { max: 7 } }, names: [FORMER, "night", B],
    members: [{ name: FORMER }, { name: "night", private: true }, { name: B }], version: 17 };
  return id;
}
(async () => {
  await test("reported night collision preserves two-worker capacity and minimum", async () => {
    const R = setup("night"); delete R.profile.shifts; // Default shifts isolate the original silent 2 -> 1 capacity regression.
    const before = JSON.stringify(A.state), exported = A.profileForExport(false).rules;
    const P = new T.Problem(exported, T.normalizeMonth({ year: 2026, month: 11 }, exported));
    console.log("night capacity before=2 after=" + P.countOf([1, "night"]) + "; minimum before=2 after=" + P.countMinOf([1, "night"]));
    assert.strictEqual(P.countOf([1, "night"]), 2); assert.strictEqual(P.countMinOf([1, "night"]), 2);
    assert.strictEqual(JSON.stringify(A.state), before); assert.deepStrictEqual(exported.profile.positions, R.profile.positions); assertStaffing(exported);
  });
  const collisionNames = ["night", "day", "work", "count", "I", "Y", "target_deviation", "same_weekday_excess", "quota_target", "profile", "positions", "shifts", "roles", "weights", "rule_states", "off", "all", "none", "charge", "oncall_requirement", "name_order", "doctors", "id", "label", "team", "quota", "share", "min", "max"];
  for (const name of collisionNames) await test(`profileForExport collision ${name}`, async () => {
    const R = setup(name), original = clone(R), before = JSON.stringify(A.state);
    const exported = A.profileForExport(false);
    assertShared(exported.rules, original);
    assert.deepStrictEqual(exported.leftover, [], "pure schema collisions are not privacy leftovers");
    assert.strictEqual(exported.rules.toban_profile.roster, "placeholder");
    assert.strictEqual(JSON.stringify(A.state), before, "export never mutates source state");
    assertShared(JSON.parse(JSON.stringify(exported.rules)), original);
  });
  for (const state of ["off", "hard"]) await test(`registered ${state}/hidden personal columns scrub current and former staff`, async () => {
    setup(); const id = registerPersonalColumn(state), before = JSON.stringify(A.state);
    try {
      assert(!T.rules.columns(A.state.rules).some(c => c.key === "personal_fixture"), "fixture column is really hidden");
      const exported = A.profileForExport(false), R = exported.rules;
      assert.deepStrictEqual(R.local_person, { by_name: {}, names: ["職員1", "職員2"], members: [], version: 17 });
      assert.deepStrictEqual(exported.leftover, []); assert.strictEqual(JSON.stringify(A.state), before); assertStaffing(R);
    } finally { T.rules.unregister(id); }
  });
  await test("opaque unknown subtrees inside known containers still receive privacy cleanup", async () => {
    const R = setup();
    R.profile.local_extension = { by_name: { [B]: { secret: true } }, members: [{ name: "night", private: true }], names: [B, C] };
    const before = JSON.stringify(A.state), exported = A.profileForExport(false);
    assert.deepStrictEqual(exported.rules.profile.local_extension, { by_name: {}, members: [], names: ["職員2", "補助1"] });
    assert.strictEqual(JSON.stringify(A.state), before); assertStaffing(exported.rules);
  });
  for (const where of ["opaque-map", "opaque-scalar", "opaque-enum", "opaque-array", "profile-extension"]) await test(`ambiguous structural-name key in ${where} blocks shared export`, async () => {
    const R = setup();
    if (where === "opaque-map") R.opaque.by_name.night = { max: 2 };
    else if (where === "opaque-scalar") R.opaque.night = 17;
    else if (where === "opaque-enum") R.opaque.shift = "night";
    else if (where === "opaque-array") R.opaque.allowed_shifts = ["night", "day"];
    else R.profile.local_extension = { night: 17 };
    const before = JSON.stringify(A.state);
    assert.throws(() => A.profileForExport(false), "unknown night key cannot silently be erased as a person or exempted as structure");
    assert.strictEqual(JSON.stringify(A.state), before);
    renderControls(); alerts = []; const renderedBefore = JSON.stringify(A.state);
    await clickExport(); assert.strictEqual(downloads.length, 0); assert.strictEqual(alerts.length, 1);
    assert.strictEqual(JSON.stringify(A.state), renderedBefore);
  });
  await test("share hook can explicitly clear ambiguous custom structural-name data", async () => {
    const R = setup(); R.opaque.night = 17;
    const id = "local.export.clear";
    T.rules.register({ id, api: 1, states: ["off"], def: "off", share(rules) { delete rules.opaque.night; } });
    R.rule_states[id] = "off"; const before = JSON.stringify(A.state);
    try { const exported = A.profileForExport(false); assert(!Object.hasOwn(exported.rules.opaque, "night")); assertStaffing(exported.rules); assert.strictEqual(JSON.stringify(A.state), before); }
    finally { T.rules.unregister(id); }
  });
  await test("share hook cannot hide a newly injected name in a previously structural field", async () => {
    const R = setup(), id = "local.export.inject";
    T.rules.register({ id, api: 1, states: ["off"], def: "off", share(rules) { rules.profile.id = "night"; } });
    R.rule_states[id] = "off"; const before = JSON.stringify(A.state);
    try { const exported = A.profileForExport(false); assert(exported.leftover.includes("night")); assert.strictEqual(JSON.stringify(A.state), before); }
    finally { T.rules.unregister(id); }
  });
  await test("registered locale key colliding with a staff name preserves translated labels", async () => {
    const langs = T.langsSnapshot(); T.registerLang({ code: "es", name: "Español" });
    try {
      const R = setup("es"); delete R.opaque;
      R.profile.label.es = "Centro"; R.profile.roles[0].label = { ja: "職員", es: "Equipo" }; R.profile.shifts[1].label = { ja: "夜勤", es: "Turno" };
      const before = JSON.stringify(A.state), profile = clone(R.profile), exported = A.profileForExport(false);
      assert.deepStrictEqual(exported.rules.profile, profile); assert.deepStrictEqual(exported.leftover, []);
      assertStaffing(exported.rules); assert.strictEqual(JSON.stringify(A.state), before);
    } finally { T.langsRestore(langs); }
  });
  for (const injected of [false, true]) await test(`registered locale object payload ${injected ? "injected by share" : "in source"} refuses export`, async () => {
    const langs = T.langsSnapshot(), id = "local.export.locale"; T.registerLang({ code: "es", name: "Español" });
    try {
      const R = setup("es"); R.profile.label.es = "Centro";
      const edit = rules => { rules.profile.label.es = { note: "PRIVATE-NOTE" }; };
      if (injected) { T.rules.register({ id, api: 1, states: ["off"], def: "off", share: edit }); R.rule_states[id] = "off"; } else edit(R);
      const before = JSON.stringify(A.state); assert.throws(() => A.profileForExport(false)); assert.strictEqual(JSON.stringify(A.state), before);
    } finally { T.rules.unregister(id); T.langsRestore(langs); }
  });
  const malformedStructural = [
    ["count", "night", R => { R.profile.positions.work.count.night = { note: "PRIVATE-NOTE" }; }],
    ["oncall-cell", "Y", R => { R.oncall_requirement.I.Y = { note: "PRIVATE-NOTE" }; }],
    ["weight", "target_deviation", R => { R.weights.target_deviation = { note: "PRIVATE-NOTE" }; }],
    ["rule-state", "work_gap", R => { R.rule_states.work_gap = { note: "PRIVATE-NOTE" }; }],
    ["boolean-rest", "rest_day_required", R => { R.rest_day_required = { note: "PRIVATE-NOTE" }; }],
    ["boolean-role", "standby", R => { R.profile.roles[0].standby = { note: "PRIVATE-NOTE" }; }],
    ["boolean-shift", "oncall", R => { R.profile.shifts[1].oncall = { note: "PRIVATE-NOTE" }; }],
    ["boolean-day-off", "ake_is_off", R => { R.days_off.ake_is_off = { note: "PRIVATE-NOTE" }; }],
    ["localized-label", "ja", R => { R.profile.label = { ja: { note: "PRIVATE-NOTE" } }; }],
    ["rules-version", "rules_version", R => { R.rules_version = { note: "PRIVATE-NOTE" }; }],
    ["scalar-array-refs", "refs", R => { R.profile.roles[0].refs = [{ note: "PRIVATE-NOTE" }]; }],
    ["scalar-array-days", "days", R => { R.profile.calendar = { holidays: "none", closure: [{ month: 1, days: [{ note: "PRIVATE-NOTE" }] }] }; }],
    ["scalar-array-shifts", "shifts", R => { R.profile.fixed_tags = [{ label: "fixture", shifts: [{ note: "PRIVATE-NOTE" }] }]; }],
    ["scalar-array-plugins", "plugins_off", R => { R.plugins_off = [{ note: "PRIVATE-NOTE" }]; }],
  ];
  for (const [where, name, edit] of malformedStructural) await test(`object payload at structural ${where} is not privacy-exempt`, async () => {
    const R = setup(name); edit(R); const before = JSON.stringify(A.state);
    assert.doesNotThrow(() => new T.Problem(R, A.state.month), "fixture reaches export privacy validation");
    assert.throws(() => A.profileForExport(false), "a colliding key with a non-schema object payload must refuse export");
    assert.strictEqual(JSON.stringify(A.state), before);
    const included = A.profileForExport(true).rules; delete included.toban_profile; assert.deepStrictEqual(included, R);
  });
  for (const [where, name, edit] of malformedStructural) await test(`share hook cannot inject object payload at structural ${where}`, async () => {
    const R = setup(name), id = "local.export.shape";
    if (where === "scalar-array-days") R.profile.calendar = { holidays: "none", closure: [{ month: 1, days: [2] }] };
    if (where === "scalar-array-shifts") R.profile.fixed_tags = [{ label: "fixture", shifts: ["night"] }];
    if (where === "scalar-array-plugins") R.plugins_off = [];
    T.rules.register({ id, api: 1, states: ["off"], def: "off", share: edit }); R.rule_states[id] = "off";
    const before = JSON.stringify(A.state);
    try { assert.throws(() => A.profileForExport(false), "a previously proven structural path does not exempt a later private object payload"); assert.strictEqual(JSON.stringify(A.state), before); }
    finally { T.rules.unregister(id); }
  });
  for (const name of ["night", B]) for (const where of ["roles", "shifts", "closure", "forbid-sequence"]) await test(`person record ${name} inside structural ${where} cannot leak`, async () => {
    const R = setup(), person = { name, private_note: "PRIVATE-NOTE" };
    if (where === "roles") Object.assign(R.profile.roles[0], person);
    else if (where === "shifts") Object.assign(R.profile.shifts[0], person);
    else if (where === "closure") R.profile.calendar = { holidays: "none", closure: [{ month: 1, days: [2], ...person }] };
    else R.forbid_sequence = [{ from: "day", to: "night", ...person }];
    const before = JSON.stringify(A.state);
    let exported; try { exported = A.profileForExport(false); } catch (error) { assert(error instanceof Error); }
    if (exported) assert(!JSON.stringify(exported.rules).includes("PRIVATE-NOTE"), "privacy guard must refuse or safely omit the person record");
    assert.strictEqual(JSON.stringify(A.state), before, "guard never modifies original personal record");
  });
  await test("included-roster export stays lossless even for structural collisions", async () => {
    const R = setup("night"), before = JSON.stringify(A.state), exported = A.profileForExport(true), actual = clone(exported.rules);
    delete actual.toban_profile; assert.deepStrictEqual(actual, R); assert.deepStrictEqual(exported.leftover, []);
    assert.strictEqual(exported.rules.toban_profile.roster, "included"); assert.strictEqual(JSON.stringify(A.state), before);
  });
  for (const name of ["night", "I", "target_deviation", "profile"]) await test(`rendered shared export/download/import preserves ${name} semantics`, async () => {
    setup(name); renderControls(); const original = clone(A.state.rules), source = JSON.stringify(A.state);
    assert.strictEqual(document.querySelector("#setExportRoster").checked, false);
    await clickExport(); assert.strictEqual(alerts.length, 0, alerts.join("|")); assert.strictEqual(confirmations.length, 0, "schema collision needs no privacy override");
    assert.strictEqual(downloads.length, 1, "actual download anchor clicked exactly once");
    const downloaded = downloads[0]; assert.strictEqual(downloaded.name, "profile_synthetic-export.json");
    assert(downloaded.blob instanceof Blob); assert.strictEqual(downloaded.blob.type, "application/json");
    const parsed = JSON.parse(await downloaded.blob.text()); assertShared(parsed, original);
    assert.strictEqual(JSON.stringify(A.state), source, "export readback is stable and sanitizer does not mutate source");
    await importDownload(downloaded); assert.strictEqual(alerts.length, 0, alerts.join("|"));
    assert.strictEqual(confirmations.length, 1, "normal import confirmation remains");
    assertShared(A.state.rules, original); assert(!Object.hasOwn(A.state.rules, "toban_profile"));
    assert.strictEqual(A.state.month.notes, "synthetic month unchanged");
  });
  for (const name of ["night", 'Fictional "Q"']) for (const where of ["label", "path", "embedded-key"]) await test(`embedded ${name} in ${where} warns and cancelled rendered export produces no file`, async () => {
    const R = setup(name);
    if (where === "label") R.profile.label = `Facility for ${name}`;
    else if (where === "path") R.profile.output = { folder: `/synthetic/${name}/reports` };
    else R.opaque[`memo-${name}-detail`] = "private context";
    const exported = A.profileForExport(false); assert(exported.leftover.includes(name));
    assert(JSON.stringify(exported.rules).includes(JSON.stringify(name).slice(1, -1)), "embedded text remains available for review");
    renderControls(); confirmAnswer = false; const before = JSON.stringify(A.state);
    await clickExport(); assert.strictEqual(downloads.length, 0); assert.strictEqual(confirmations.length, 1); assert(confirmations[0].includes(name));
    assert.strictEqual(alerts.length, 0); assert.strictEqual(JSON.stringify(A.state), before);
    confirmAnswer = true; await clickExport(); assert.strictEqual(downloads.length, 1, "explicit privacy override retains established export behavior");
  });
  for (const kind of ["missing-off", "failed-load", "normalize", "share", "column-begin", "column-end"]) await test(`failed ${kind} blocks shared export atomically`, async () => {
    setup(); const id = "local.export.broken";
    if (kind === "missing-off") A.state.rules.rule_states[id] = "off";
    else if (kind === "failed-load") T.plugins.fail("rules", "rules/synthetic-broken.js", new Error("synthetic load failure"));
    else {
      const def = { id, api: 1, states: ["hard", "off"], def: "off" };
      if (kind === "normalize") def.normalize = R => { R.profile = {}; throw new Error("sensitive synthetic detail"); };
      if (kind === "share") def.share = R => { R.profile = {}; throw new Error("sensitive synthetic detail"); };
      if (kind.startsWith("column")) def.columns = [{ key: "broken", when: () => false,
        begin(R) { if (kind === "column-begin") { R.profile = {}; throw new Error("sensitive synthetic detail"); } return {}; },
        end(R) { R.profile = {}; if (kind === "column-end") throw new Error("sensitive synthetic detail"); } }];
      T.rules.register(def); A.state.rules.rule_states[id] = "off";
    }
    try {
      const before = JSON.stringify(A.state);
      assert.throws(() => A.profileForExport(false)); assert.strictEqual(JSON.stringify(A.state), before);
      const included = A.profileForExport(true).rules; delete included.toban_profile; assert.deepStrictEqual(included, A.state.rules);
      renderControls(); alerts = []; const renderedBefore = JSON.stringify(A.state);
      await clickExport(); assert.strictEqual(downloads.length, 0); assert.strictEqual(alerts.length, 1, "rendered export reports failure");
      assert(!alerts[0].includes("sensitive synthetic detail"), "error details must not leak personal data");
      assert.strictEqual(JSON.stringify(A.state), renderedBefore, "failed shared transformation never changes live state");
    } finally { T.rules.unregister(id); T.plugins.loaded.length = 0; }
  });
  console.log(`profile export collision: ${passed} passed, ${failed} failed`);
  if (failed) process.exitCode = 1;
})().catch(error => { console.error(error); process.exitCode = 1; });

// Unrelated settings edits must preserve multilingual role labels and all supported role functions.
// Fictional data. Actual rendered controls are parsed by Python HTMLParser; events/readback/Undo
// run in a DOM substitute, not a browser. TOBAN_WEBAPP_ROOT also runs this against an older tree.
const fs = require("fs"), path = require("path"), vm = require("vm"), assert = require("assert"), { execFileSync } = require("child_process");
const root = process.env.TOBAN_WEBAPP_ROOT || __dirname, elements = new Map();
const parse = html => JSON.parse(execFileSync("python3", ["-c", `import json,sys
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
const matches = (el, sel) => sel.split(",").some(s => {
  s = s.trim(); const tag = s.match(/^[\w-]+/), id = s.match(/#([\w-]+)/);
  if (tag && el.tag !== tag[0] || id && el.attrs.id !== id[1]) return false;
  return [...s.matchAll(/\[([^=\]]+)(?:=(?:"([^"]*)"|([^\]]+)))?\]/g)].every(([, k, a, b]) => Object.hasOwn(el.attrs, k) && (a === undefined && b === undefined || el.attrs[k] === (a ?? b)));
});
function node(raw) {
  const e = { ...raw, dataset: Object.fromEntries(Object.entries(raw.attrs).filter(([k]) => k.startsWith("data-")).map(([k, v]) => [k.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase()), v])),
    value: raw.attrs.value || "", checked: Object.hasOwn(raw.attrs, "checked"), type: raw.attrs.type || "text", getAttribute(k) { return this.attrs[k] ?? null; }, hasAttribute(k) { return Object.hasOwn(this.attrs, k); },
    querySelectorAll(s) { return this.children.flatMap(c => (matches(c, s) ? [c] : []).concat(c.querySelectorAll(s))); }, querySelector(s) { return this.querySelectorAll(s)[0] || null; } };
  e.children = raw.children.map(node);
  if (e.tag === "select") { const os = e.querySelectorAll("option"); e.value = (os.find(o => o.hasAttribute("selected")) || os[0] || { attrs: {} }).attrs.value || ""; }
  return e;
}
function element(sel) {
  if (!elements.has(sel)) elements.set(sel, { handlers: {}, value: "", textContent: "", innerHTML: "", disabled: false,
    addEventListener(k, fn) { (this.handlers[k] ||= []).push(fn); }, querySelectorAll() { return []; } });
  return elements.get(sel);
}
for (const id of ["settings", "btnUndo", "undoNote", "btnReloadPlugins", "btnApplyRules", "btnResetRules", "doctorTable", "weightsTable", "hardRules", "profileBuilder", "rulesJson", "pluginsInfo"]) element("#" + id);
let doctors = [], roles = [], weights = [];
globalThis.document = { querySelector: s => elements.get(s) || null, querySelectorAll: s => ({ "#doctorTable tr[data-i]": doctors, "#roleTbl tr[data-ri]": roles, "#weightsTable [data-w]": weights })[s] || [] };
globalThis.location = { pathname: "/synthetic/role-metadata.html" }; globalThis.localStorage = { getItem: () => null, setItem() {} }; globalThis.confirm = () => true; globalThis.alert = text => { throw new Error(String(text)); }; globalThis.T = {};
for (const f of ["i18n.js", "rules-core.js", "model.js", "messages.js", "plugins.js", "check.js", "merge.js", "app-core.js", "app-settings.js", ...fs.readdirSync(path.join(root, "src/rules")).filter(f => f.endsWith(".js")).sort().map(f => "rules/" + f)]) vm.runInThisContext(fs.readFileSync(path.join(root, "src", f), "utf8"), { filename: f });
const A = T.app, clone = x => JSON.parse(JSON.stringify(x)), tick = () => Promise.resolve();
T.registerLang({ code: "ja" }); T.registerLang({ code: "en" });
for (const k of ["save", "renderHeader", "renderSettingsMonth", "renderDoctor", "renderFixed", "toast"]) A[k] = () => {};
const sync = () => { doctors = node(parse(element("#doctorTable").innerHTML)).querySelectorAll("tr[data-i]"); roles = node(parse(element("#profileBuilder").innerHTML)).querySelectorAll("tr[data-ri]"); weights = node(parse(element("#weightsTable").innerHTML)).querySelectorAll("[data-w]"); };
const paint = () => { A.renderSettings(); sync(); }; A.renderAll = paint; A.bindSettings();
function setup(rules, lang = "en") {
  const R = clone(rules); T.fillDefaultRules(R); T.setLang(lang);
  Object.assign(A.state, { rules: R, month: T.normalizeMonth({ year: 2026, month: 11, notes: "Synthetic monthly input", fixed: { night_oc_none: { 7: [R.profile.roles[0].id] } } }, R), result: null, renames: [], ui: { doctor: 0 }, meta: null, base: null, baseRules: null });
  A.solving = false; A.dirHandle = null; A.clearUndo(); paint();
}
async function edit(control, value, section = "#doctorTable") {
  assert(control, "the actual renderer must produce the input"); if (control.type === "checkbox") control.checked = value; else control.value = value;
  control.closest = selector => selector.split(",").map(s => s.trim()).includes(section) ? element(section) : null;
  for (const fn of element("#settings").handlers.change) fn({ target: control });
  await tick(); sync();
}
async function importRules(R, mode) {
  if (mode === "json") { element("#rulesJson").value = JSON.stringify(R); await element("#btnApplyRules").handlers.click[0](); }
  else if (mode === "file") { const target = { id: "fileLoadProfile", files: [{ name: "synthetic-profile.json", text: async () => JSON.stringify(R) }], value: "", closest: () => null }; for (const fn of element("#settings").handlers.change) fn({ target }); await new Promise(resolve => setImmediate(resolve)); }
  else { T.PROFILES = [clone(R)]; await A.loadProfileById(R.profile.id); }
  await tick(); paint();
}
const synthetic = () => ({ profile: { id: "synthetic-role-metadata", roles: [{ id: "S", label: { ja: "架空担当", en: "Synthetic staff" }, refs: ["charge", "other", "junior"], standby: true }, { id: "R", label: { ja: "架空予備", en: "Synthetic reserve" }, refs: ["reserve"] }] }, doctors: [{ name: "Synthetic A", team: "S", quota: 10 }, { name: "Synthetic B", team: "R", quota: 10 }], weights: {} });
const metadata = () => A.state.rules.profile.roles.map(r => ({ id: r.id, label: clone(r.label), refs: [].concat(r.refs || []) }));
const meaning = () => { const P = new T.Problem(A.state.rules, A.state.month); return { roleOfRef: P.roleOfRef, byRole: P.byRole, standby: P.roles.map(r => [r.id, r.standby]) }; };
let passed = 0, failed = 0;
async function test(label, fn) { try { await fn(); console.log("ok " + label); passed++; } catch (e) { console.error("FAIL " + label + ": " + e.stack); failed++; } }
(async () => {
  for (const profile of ["oncall-min", "two-shift", "nurse-2shift"]) for (const lang of ["en", "ja"]) await test(`${profile} / ${lang}: unrelated edit, language switch and saved JSON preserve labels`, async () => {
    const R = JSON.parse(fs.readFileSync(path.join(root, "data/profiles", profile + ".json"), "utf8")); setup(R, lang); const before = metadata(), month = clone(A.state.month);
    for (let i = 0; i < 2; i++) { await edit(doctors[0].querySelector('[data-f="years"]'), String(40 + i)); assert.deepStrictEqual(metadata(), before); A.readSettings(); sync(); assert.deepStrictEqual(metadata(), before); }
    assert.deepStrictEqual(JSON.parse(A.payloadJson()).rules.profile.roles.map(r => r.label), R.profile.roles.map(r => r.label)); assert.deepStrictEqual(A.state.month, month);
    T.setLang(lang === "en" ? "ja" : "en"); paint(); assert.strictEqual(roles[0].querySelector("[data-rlabel]").value, R.profile.roles[0].label[T.lang()]);
    A.undo(); assert.deepStrictEqual(metadata(), before);
  });
  for (const mode of ["json", "file", "bundled"]) await test(`${mode} import retains all role functions through settings readback, save and Undo`, async () => {
    const start = synthetic(); start.profile.id = "synthetic-start"; start.profile.roles[0].refs = ["charge"]; setup(start); await importRules(synthetic(), mode);
    const before = metadata(), semantics = clone(meaning()), month = clone(A.state.month); assert.strictEqual(semantics.roleOfRef.junior, "S");
    await edit(doctors[0].querySelector('[data-f="years"]'), "44"); assert.deepStrictEqual(metadata(), before); assert.deepStrictEqual(meaning(), semantics); assert.deepStrictEqual(A.state.month, month);
    const saved = JSON.parse(A.payloadJson()); assert.deepStrictEqual(saved.rules.profile.roles[0].refs, ["charge", "other", "junior"]);
    await edit(weights[0], "15", "#weightsTable"); assert.deepStrictEqual(metadata(), before); A.undo(); assert.deepStrictEqual(metadata(), before); A.undo(); assert.deepStrictEqual(metadata(), before); A.undo(); assert.deepStrictEqual(A.state.rules.profile.roles[0].refs, ["charge"]);
  });
  await test("explicit label edits and blank labels retain existing behavior, with Undo restoring translations", async () => {
    for (const value of ["Synthetic replacement", " Synthetic replacement ", "", "   "]) { setup(synthetic()); const before = metadata(); await edit(roles[0].querySelector("[data-rlabel]"), value, "#profileBuilder"); assert.strictEqual(A.state.rules.profile.roles[0].label, value.trim() || "S"); assert.deepStrictEqual(A.state.rules.profile.roles[0].refs, before[0].refs); A.undo(); assert.deepStrictEqual(metadata(), before); }
  });
  await test("unchanged whitespace-padded bilingual labels retain both translations", async () => {
    for (const lang of ["en", "ja"]) { const R = synthetic(); R.profile.roles[0].label = { ja: " 架空担当 ", en: " Synthetic staff " }; setup(R, lang); const before = metadata();
      assert.strictEqual(roles[0].querySelector("[data-rlabel]").value, R.profile.roles[0].label[lang]);
      await edit(doctors[0].querySelector('[data-f="years"]'), "44"); assert.deepStrictEqual(metadata(), before); A.readSettings(); sync(); assert.deepStrictEqual(metadata(), before);
      const saved = JSON.parse(A.payloadJson()); assert.deepStrictEqual(saved.rules.profile.roles[0].label, R.profile.roles[0].label);
      T.setLang(lang === "en" ? "ja" : "en"); paint(); assert.strictEqual(roles[0].querySelector("[data-rlabel]").value, R.profile.roles[0].label[T.lang()]); A.undo(); assert.deepStrictEqual(metadata(), before);
    }
  });
  await test("explicit role-function replacement or removal takes effect and Undo restores all functions", async () => {
    for (const value of ["", "junior"]) { setup(synthetic()); const before = metadata(); await edit(roles[0].querySelector("[data-rref]"), value, "#profileBuilder"); assert.deepStrictEqual(A.state.rules.profile.roles[0].refs, value ? [value] : []); assert.strictEqual(meaning().roleOfRef.charge, null); A.undo(); assert.deepStrictEqual(metadata(), before); assert.strictEqual(meaning().roleOfRef.other, "S"); }
  });
  await test("role ID and standby edits preserve labels/functions and update existing OC-none references", async () => {
    setup(synthetic()); const before = metadata(); await edit(roles[0].querySelector("[data-rid]"), "Staff", "#profileBuilder"); assert.deepStrictEqual(A.state.rules.profile.roles[0].label, before[0].label); assert.deepStrictEqual(A.state.rules.profile.roles[0].refs, before[0].refs); assert.strictEqual(A.state.rules.doctors[0].team, "Staff"); assert.deepStrictEqual(A.state.month.fixed.night_oc_none[7], ["Staff"]);
    await edit(roles[0].querySelector("[data-rstandby]"), false, "#profileBuilder"); assert.deepStrictEqual(A.state.rules.profile.roles[0].refs, before[0].refs); assert.strictEqual(A.state.rules.profile.roles[0].standby, undefined); A.undo(); A.undo(); assert.deepStrictEqual(metadata(), before); assert.deepStrictEqual(A.state.month.fixed.night_oc_none[7], ["S"]);
  });
  console.log(`role metadata preservation: ${passed} passed, ${failed} failed`); if (failed) process.exitCode = 1;
})().catch(e => { console.error(e); process.exitCode = 1; });

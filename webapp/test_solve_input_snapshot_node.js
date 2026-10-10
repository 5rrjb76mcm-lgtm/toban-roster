// Solve snapshots remain stable while ordinary settings edits are committed between async phases.
// Synthetic sample-derived data; real HiGHS and rendered controls/settings change handler.
// Promise gates deterministically model Worker timing. This is a DOM substitute, not a browser test.
// TOBAN_WEBAPP_ROOT can run this against an older source tree; argv[2] is the highs package path.
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

(async () => {
  for (const f of ["solver.js", "report.js", "app-solve.js"]) vm.runInThisContext(fs.readFileSync(path.join(root, "src", f), "utf8"), { filename: f });
  const rendered = new Map(), oldQuery = document.querySelector;
  const syncAll = () => {
    sync();
    for (const key of ["#doctorTable", "#profileBuilder", "#hardRules", "#weightsTable"]) {
      const r = node(parse(element(key).innerHTML)); rendered.set(key, r);
      element(key).querySelectorAll = s => r.querySelectorAll(s); element(key).querySelector = s => r.querySelector(s);
    }
  };
  const queryAll = s => {
    const parts = s.trim().split(/\s+/);
    let found = rendered.has(parts[0]) ? [rendered.get(parts.shift())] : [...rendered.values()];
    for (const part of parts) found = found.flatMap(n => n.querySelectorAll(part));
    return found;
  };
  document.querySelector = s => oldQuery(s) || queryAll(s)[0] || null;
  document.querySelectorAll = queryAll;
  for (const key of ["#useBase", "#baseWeight", "#markChanges", "#timeLimit", "#btnSolve", "#btnCancel", "#calcLog", "#calcStatus", "#result", "#docCal"]) element(key);
  element("#timeLimit").value = "5"; element("#baseWeight").value = "1"; element("#markChanges").checked = true;
  Object.assign(A, { readAll() {}, loadPendingPlugins: async () => {}, saveToFolder: async () => {}, showTab() {} });
  const highs = await require(process.argv[2] || "highs")();
  function setup(useBase) {
    const R = JSON.parse(fs.readFileSync(path.join(root, "data/rules.json"), "utf8")); T.DEFAULT_RULES = clone(R);
    T.fillDefaultRules(R); for (const d of T.RULE_DEFS) R.rule_states[d.id] = "off";
    R.rule_states.count_target = "soft"; R.weights.count_deviation = 5; R.weights.base_change = 13;
    R.profile.shifts = [{ id: "day", label: "Day", on: "none" }, { id: "night", label: "Night", on: "all" }];
    R.profile.positions = { work: { count: { day: 2, night: 2 }, min: { day: 1, night: 1 }, ideal: { day: 2, night: 2 } } };
    const name = R.doctors.find(d => d.team !== "C").name;
    const month = T.normalizeMonth({ year: 2026, month: 11, avoid: [{ name, day: 1, part: "night" }] }, R);
    const result = useBase ? { asg: Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`${i + 1}:night`, { work: [name], oc: [] }])), status: "Optimal" } : null;
    Object.assign(A.state, { rules: R, month, result, renames: [], ui: { doctor: 0 }, meta: null, base: null, baseRules: null });
    A.solving = false; A.dirHandle = null; A.clearUndo(); element("#useBase").checked = useBase;
    paint(); syncAll(); A.readSettings(); paint(); syncAll();
    return { sig: A.inputSig(), previous: result, name };
  }
  function changeIdeal(value) {
    const control = document.querySelector('#shiftTbl input[data-countideal="night"]');
    assert(control, "actual renderer must produce the ideal-count control");
    control.closest = s => s.split(",").map(x => x.trim()).includes("#profileBuilder") ? element("#profileBuilder") : null;
    control.value = String(value);
    for (const fn of element("#settings").handlers.change) fn({ target: control });
    syncAll();
  }
  let failures = 0;
  for (const useBase of [false, true]) for (const restore of [false, true]) {
    const before = setup(useBase); let calls = 0, capturedP;
    const solve0 = T.solveWithAvoidRef;
    T.solveWithAvoidRef = (P, h, opts) => { capturedP = P; return solve0(P, h, opts); };
    A.highs = { isWorker: true, solve: async (text, opts) => {
      calls++; const sol = highs.solve(text, opts);
      // Changes are committed by the real settings handler while runSolve is busy.
      assert.strictEqual(A.solving, true);
      if (calls === 1) changeIdeal(1); else if (restore) changeIdeal(2);
      return sol;
    } };
    await A.runSolve(); T.solveWithAvoidRef = solve0;
    try {
      assert.strictEqual(calls, 2, "avoid entry must exercise reference and main solves");
      assert.strictEqual(A.state.rules.weights.base_change, 13, "run-only base weight must not persist");
      assert.strictEqual(capturedP.weights.base_change, useBase ? 1 : 13);
      assert.strictEqual(A.solving, false); assert.strictEqual(A.runSolve.busy, false);
      assert.strictEqual(element("#btnSolve").disabled, false); assert.strictEqual(element("#btnCancel").hidden, true);
      assert.strictEqual(element("#calcStatus").textContent, "");
      if (!restore) {
        assert.notStrictEqual(A.inputSig(), before.sig);
        assert.strictEqual(A.state.result, before.previous, "an unrestored edit must reject the pending result");
        assert.match(element("#calcLog").textContent, /changed|変わった/);
      } else {
        assert.strictEqual(A.inputSig(), before.sig, "ordinary settings edits restore the exact input signature");
        const r = A.state.result; assert(r && r !== before.previous);
        assert.strictEqual(r.input_sig, before.sig); assert.strictEqual(r.status, "Optimal");
        console.log(`evidence restored base=${useBase}: workers/night=${[...new Set(Object.values(r.asg).map(s => [].concat(s.work).length))]}, reported objective=${r.objective}, current-input penalty=${T.penalty(new T.Problem(A.state.rules, A.state.month), r.asg).total}`);
        assert(Object.values(r.asg).every(s => [].concat(s.work).length === 2), "accepted current-input result must still target two workers, not transient ideal one");
        assert.strictEqual(T.penalty(new T.Problem(A.state.rules, A.state.month), r.asg).total, 0);
        assert.strictEqual(r.base_asg !== null, useBase); assert.strictEqual(r.mark_changes, useBase);
      }
      assert.notStrictEqual(capturedP.rules, A.state.rules, "Problem must own its rules snapshot");
      assert.notStrictEqual(capturedP.m, A.state.month, "Problem must own its month snapshot");
      assert.strictEqual(capturedP.countIdealOf([1, "night"]), 2, "live settings must not mutate the running Problem");
      console.log(`ok solve snapshot: base=${useBase}, restore=${restore}`);
    } catch (e) { failures++; console.error(`FAIL solve snapshot: base=${useBase}, restore=${restore}: ${e.stack}`); }
  }
  if (failures) process.exitCode = 1;
  else console.log("OK solve snapshot: real settings changes, two-phase solve, current-result claims, base weight, repeated-run cleanup");
})().catch(e => { console.error(e.stack); process.exitCode = 1; });

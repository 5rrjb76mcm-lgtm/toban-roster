// Calendar and fixed grid preserve inactive and overlapping fixed input until explicitly edited.
// Synthetic data only. Render the real markup, parse controls with Python's HTMLParser,
// and substitute only DOM selection/events. No browser is launched.
const fs = require("fs"), path = require("path"), vm = require("vm"), assert = require("assert"), { execFileSync } = require("child_process");
const elements = new Map();
globalThis.document = { querySelector: s => elements.get(s) || null, querySelectorAll: () => [] };
globalThis.location = { pathname: "/synthetic/calendar-day-readback.html" };
globalThis.localStorage = { getItem: () => null, setItem() {} };
globalThis.T = {};
for (const f of ["i18n.js", "rules-core.js", "model.js", "messages.js", "check.js", "app-core.js", "app-input.js"])
  vm.runInThisContext(fs.readFileSync(f === "app-input.js" && process.env.TOBAN_UI_INPUT_SOURCE || path.join(__dirname, "src", f), "utf8"), { filename: f });
for (const f of fs.readdirSync(path.join(__dirname, "src/rules")).filter(f => f.endsWith(".js")).sort())
  vm.runInThisContext(fs.readFileSync(path.join(__dirname, "src/rules", f), "utf8"), { filename: "rules/" + f });
const A = T.app, names = ["Synthetic A", "Synthetic B"], clone = x => JSON.parse(JSON.stringify(x));
A.save = () => {}; A.toast = () => {};
let passed = 0, failed = 0;
const test = (label, fn) => { try { fn(); passed++; console.log("ok " + label); } catch (e) { failed++; console.error("FAIL " + label + ": " + e.message); } };
const parseControls = html => JSON.parse(execFileSync("python3", ["-c", `import json,sys
from html.parser import HTMLParser
class Controls(HTMLParser):
 def __init__(self): super().__init__(); self.controls=[]; self.select=None
 def handle_starttag(self,tag,attrs):
  a=dict(attrs)
  if tag=='input': self.controls.append({'attrs':a,'value':a.get('value',''),'checked':'checked' in a})
  if tag=='select': self.select={'attrs':a,'options':[]}; self.controls.append(self.select)
  if tag=='option' and self.select is not None: self.select['options'].append(a)
 def handle_endtag(self,tag):
  if tag=='select': self.select=None
p=Controls(); p.feed(sys.stdin.read()); print(json.dumps(p.controls))`], { input: html, encoding: "utf8" }));
const datasetOf = attrs => Object.fromEntries(Object.entries(attrs).filter(([k]) => k.startsWith("data-")).map(([k, v]) => [k.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase()), v]));

const pending = []; globalThis.setTimeout = fn => { pending.push(fn); return pending.length; };
function pane() {
  return { children: [{}], dataset: {}, controls: [], handlers: {}, addEventListener(k, fn) { this.handlers[k] = fn; },
    querySelectorAll(s) { return this.controls.filter(c => s.split(',').some(sel => {
      const tag = sel.match(/^(select|input)/); if (tag && c.tag !== tag[1]) return false;
      return [...sel.matchAll(/\[([^=\]]+)(?:="([^"]*)")?\]/g)].every(([, a, v]) => c.attrs[a] !== undefined && (v === undefined || c.attrs[a] === v));
    })); }, querySelector(s) { return this.querySelectorAll(s)[0] || null; },
    set innerHTML(html) { this.html = html; this.controls = parseControls(html).map(c => {
      const opts = c.options, value = opts ? (opts.find(o => Object.hasOwn(o, "selected")) || opts[0] || {}).value || "" : c.value;
      const el = { attrs: c.attrs, tag: opts ? 'select' : 'input', dataset: datasetOf(c.attrs), id: c.attrs.id || "", type: c.attrs.type || (opts ? "select-one" : "text"), value, checked: !!c.checked, options: opts || [], hasAttribute(a) { return Object.hasOwn(this.attrs, a); } };
      if (el.id) elements.set("#" + el.id, el); return el;
    }); }, get innerHTML() { return this.html; } };
}
function setup(fixed, { team = 'I', next = false, tags = {} } = {}) {
  pending.length = 0; elements.clear();
  const R = { profile: { id: "synthetic-fixed-readback", roles: [{ id: "S", label: "Staff", refs: [] }, { id: "I", label: "Lead", refs: ['charge'], standby: true }], shifts: [{ id: "day", on: 'all' }, { id: "night", on: "all" }] }, doctors: [{ name: names[0], team, quota: 30 }, { name: names[1], team: 'I', quota: 30 }], rule_states: {}, weights: {} };
  T.fillDefaultRules(R); for (const def of T.RULE_DEFS) if (def.states.includes("off")) R.rule_states[def.id] = "off";
  const M = T.normalizeMonth({ year: 2026, month: 11, next_first_day_in_calendar: next, fixed, fixed_tags: tags }, R);
  Object.assign(A.state, { rules: R, month: M, ui: { doctor: 0 }, result: null });
  const doctor = pane(), grid = pane(); grid.hidden = true; elements.set('#doctorPane', doctor); elements.set('#fixedPane', grid);
  A.bindDoctor(); A.bindFixed(); A.renderDoctor(); A.renderFixed();
  const change = (root, sel, value) => { const el = root.querySelector(sel); assert.ok(el, sel); el.value = value; root.handlers.change({ target: el }); while(pending.length) pending.shift()(); };
  return { R, M, doctor, grid, change };
}
const at = (d,k) => `[data-cal="fixed"][data-k="${k}"][data-d="${d}"]`;
const fx = (d,k) => `[data-fx="${k}"][data-d="${d}"]`;
const canonical = x => Array.isArray(x) ? x.map(canonical) : x && typeof x === "object" ? Object.fromEntries(Object.keys(x).sort().map(k => [k, canonical(x[k])])) : x;
const snap = M => JSON.stringify(canonical({ fixed: M.fixed, tags: M.fixed_tags }));
for (const d of [1,31]) for (const k of ['day','night']) test(`overlapping ${k} work and OC survive unrelated readback on day ${d}`, () => {
  const {M,doctor,change} = setup({[k]:{[d]:names[0]},[k+'_oc']:{[d]:[names[0],names[1]]}}, {next:true,tags:{[`${d}:${k}|${names[0]}`]:'Synthetic tag'}}), before=snap(M);
  change(doctor,'[data-cal="wish"][data-d="6"]',''); A.readAll(); A.readAll(); assert.equal(snap(M),before);
  change(doctor,at(d,k),''); assert.ok(!M.fixed[k][d]); assert.deepStrictEqual(M.fixed[k+'_oc'][d],[names[0],names[1]]); assert.equal(doctor.querySelector(at(d,k)).value,k+'oc');
  change(doctor,at(d,k),''); assert.deepStrictEqual(M.fixed[k+'_oc'][d],[names[1]]); A.readAll(); assert.deepStrictEqual(M.fixed[k+'_oc'][d],[names[1]]); assert.ok(!M.fixed[k][d]);
});
for (const d of [1,31]) for (const k of ['day','night']) test(`inactive ${k} OC survives unrelated edits on day ${d}`,()=>{
 const {M,doctor,change}=setup({[k+'_oc']:{[d]:[names[0]]}}, {team:'S',next:true}); const before=snap(M);
 assert.equal(doctor.querySelector(at(d,k)).value,k+'oc'); change(doctor,'[data-cal="wish"][data-d="6"]',''); A.readAll(); assert.equal(snap(M),before);
 change(doctor,at(d,k),''); assert.ok(!M.fixed[k+'_oc'][d]); A.readAll(); assert.ok(!M.fixed[k+'_oc'][d]);
});
for (const screen of ['doctor','grid']) test(`inactive charge survives ${screen} readback and clears explicitly`,()=>{
 const {M,doctor,grid,change}=setup({weekend_charge:{1:names[0]}},{team:'S'}); doctor.hidden = screen !== 'doctor'; grid.hidden = screen !== 'grid'; const root=screen==='doctor'?doctor:grid, sel=screen==='doctor'?at(1,'day'):fx(1,'charge');
 assert.equal(root.querySelector(sel).value,screen==='doctor'?'charge':names[0]);
 change(root,screen==='doctor'?'[data-cal="wish"][data-d="6"]':fx(6,'night'),''); assert.equal(M.fixed.weekend_charge[1],names[0]);
 change(root,sel,''); assert.ok(!M.fixed.weekend_charge[1]);
});
test('hidden charge and OC are retained when the visible work selection changes',()=>{
 const {M,doctor,change}=setup({day:{1:names[0]},day_oc:{1:[names[0]]},weekend_charge:{1:names[0]}});
 change(doctor,at(1,'day'),'dayoc'); assert.ok(!M.fixed.day[1]); assert.deepStrictEqual(M.fixed.day_oc[1],[names[0]]); assert.equal(M.fixed.weekend_charge[1],names[0]);
 change(doctor,at(1,'day'),''); assert.ok(!M.fixed.day_oc[1]); assert.equal(M.fixed.weekend_charge[1],names[0]); assert.equal(doctor.querySelector(at(1,'day')).value,'charge');
 change(doctor,at(1,'day'),''); assert.ok(!M.fixed.weekend_charge[1]);
});
test('new work conflicts still retain the other person and explain rejection',()=>{
 const {M,doctor,change}=setup({night:{1:names[1]}}); const notices=[]; A.toast=x=>notices.push(x);
 change(doctor,at(1,'night'),'night'); assert.equal(M.fixed.night[1],names[1]); assert.equal(notices.length,1); A.toast=()=>{};
});
for (const k of ['day','night']) test(`rejected OC to occupied ${k} retains original OC`,()=>{
 const {M,doctor,change}=setup({[k]:{1:names[1]},[k+'_oc']:{1:[names[0]]}}), before=snap(M);
 change(doctor,at(1,k),k); assert.equal(snap(M),before); A.readAll(); assert.equal(snap(M),before);
});
test('rejected tagged work to occupied charge retains work and tag',()=>{
 const {M,doctor,change}=setup({day:{1:names[0]},weekend_charge:{1:names[1]}},{tags:{[`1:day|${names[0]}`]:'Synthetic tag'}}), before=snap(M);
 change(doctor,at(1,'day'),'charge'); assert.equal(snap(M),before); A.readAll(); assert.equal(snap(M),before);
});
test('accepted ordinary fixed edits do not queue a focus-destroying redraw',()=>{
 const {M,doctor}=setup({}); const el=doctor.querySelector(at(1,'night')); el.value='night'; doctor.handlers.change({target:el});
 assert.equal(M.fixed.night[1],names[0]); assert.equal(pending.length,0);
});
console.log(`fixed condition readback: ${passed} passed, ${failed} failed`); if(failed) process.exitCode=1;

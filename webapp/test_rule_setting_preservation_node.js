// Temporarily disabling shift rules must preserve their saved parameters.
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
  const e = { ...raw, id: raw.attrs.id || "", disabled: Object.hasOwn(raw.attrs, "disabled"), dataset: Object.fromEntries(Object.entries(raw.attrs).filter(([k]) => k.startsWith("data-")).map(([k, v]) => [k.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase()), v])),
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
let doctors = [], roles = [], weights = [], trees = [];
const lookup = s => { const parts = s.trim().split(/\s+/); let found = parts[0].startsWith('#') && elements.has(parts[0]) ? [elements.get(parts[0])] : trees.flatMap(t => t.querySelectorAll(parts[0]));
  for (const p of parts.slice(1)) found = found.flatMap(e => e.querySelectorAll(p)); return found; };
globalThis.document = { querySelector: s => lookup(s)[0] || null, querySelectorAll: lookup };
globalThis.location = { pathname: "/synthetic/role-metadata.html" }; globalThis.localStorage = { getItem: () => null, setItem() {} }; globalThis.confirm = () => true; globalThis.alert = text => { throw new Error(String(text)); }; globalThis.T = {};
for (const f of ["i18n.js", "rules-core.js", "model.js", "messages.js", "plugins.js", "solver.js", "check.js", "merge.js", "app-core.js", "app-settings.js", ...fs.readdirSync(path.join(root, "src/rules")).filter(f => f.endsWith(".js")).sort().map(f => "rules/" + f)]) vm.runInThisContext(fs.readFileSync(path.join(root, "src", f), "utf8"), { filename: f });
const A = T.app, clone = x => JSON.parse(JSON.stringify(x)), tick = () => Promise.resolve();
T.registerLang({ code: "ja" }); T.registerLang({ code: "en" });
for (const k of ["save", "renderHeader", "renderSettingsMonth", "renderDoctor", "renderFixed", "toast"]) A[k] = () => {};
const sync = () => { trees = []; for (const id of ['doctorTable','weightsTable','hardRules','profileBuilder']) { const e=element('#'+id), tree=node(parse(e.innerHTML)); e.querySelectorAll=s=>tree.querySelectorAll(s); e.querySelector=s=>tree.querySelector(s); trees.push(tree); }
 doctors = document.querySelectorAll('#doctorTable tr[data-i]'); };
const paint = () => { A.renderSettings(); sync(); }; A.renderAll = paint; A.bindSettings();
function setup(rules, lang = "en") {
  const R = clone(rules); T.fillDefaultRules(R); T.setLang(lang);
  Object.assign(A.state, { rules: R, month: T.normalizeMonth({ year: 2026, month: 11, notes: "Synthetic monthly input", fixed: {} }, R), result: null, renames: [], ui: { doctor: 0 }, meta: null, base: null, baseRules: null });
  A.solving = false; A.dirHandle = null; A.clearUndo(); paint();
}
async function edit(control, value, section = "#doctorTable") {
  assert(control, "the actual renderer must produce the input"); if (control.type === "checkbox") control.checked = value; else control.value = value;
  control.closest = selector => selector.split(",").map(s => s.trim()).includes(section) ? element(section) : null;
  for (const fn of element("#settings").handlers.change) fn({ target: control });
  await tick(); sync();
}

const synthetic = (id, state) => {
 const r={ profile:{id:'synthetic-rule-preservation',roles:[{id:'S',label:'Synthetic staff',refs:[]}], shifts:[{id:'day',on:'all'},{id:'night',on:'all'}]},doctors:[{name:'Synthetic A',team:'S',quota:30},{name:'Synthetic B',team:'S',quota:30}],weights:{},rule_states:{},shift_counts:{day:{min:2,max:20},night:{min:3,max:20}},shift_run_max:{day:2,night:2}};
 T.fillDefaultRules(r); for(const d of T.RULE_DEFS) if(d.states.includes('off'))r.rule_states[d.id]='off'; r.rule_states[id]=state; return r;
};
let passed=0, failed=0;
async function test(label, fn) { try { await fn(); console.log('ok '+label);passed++; } catch(e){ console.error('FAIL '+label+': '+e.stack);failed++; } }
(async()=>{
 const highs = process.argv[2] ? await require(process.argv[2])() : null;
 for(const [id,key,attr] of [['shift_count_range','shift_counts','data-scr'],['shift_run_max','shift_run_max','data-srm']]) for(const st of ['hard','soft']) await test(`${id} ${st}: off, unrelated edit, on restores caps and scoring`,async()=>{
  setup(synthetic(id,st)); const before=clone(A.state.rules[key]), initial=new T.Problem(A.state.rules,A.state.month);
  const pin={}; for(const s of initial.slots) pin[`${s[0]}:${s[1]}`]={work:'Synthetic A',oc:[]};
  const check0=T.check(initial,pin), pen0=T.penalty(initial,pin).total;
  await edit(document.querySelector(`[data-ron="${id}"]`),false,'#profileBuilder');
  assert.equal(A.state.rules.rule_states[id],'off'); assert.equal(document.querySelector(`[${attr}]`),null,'disabled rule controls are actually hidden');
  await edit(doctors[0].querySelector('[data-f="years"]'),'7');
  A.readSettings(); sync();
  await edit(document.querySelector(`[data-ron="${id}"]`),true,'#profileBuilder');
  if(st==='soft') await edit(document.querySelector(`[data-rsv="${id}"]`),'soft','#hardRules');
  const after=new T.Problem(A.state.rules,A.state.month), check=T.check(after,pin), pen=T.penalty(after,pin).total;
  if(highs){ const result=T.solve(after,highs,{pin,timeLimit:10}); console.log(`  solver ${result.status}; violations ${check.V.length}; penalty ${pen}`);
   if(st==='hard')assert.equal(result.status,'Infeasible','preserved caps reject the pinned violating schedule');
   else {assert.equal(result.status,'Optimal');assert.ok(Math.abs(result.objective-pen0)<1e-6,`expected objective ${pen0}, got ${result.objective}`);}
  }
  assert.deepStrictEqual(A.state.rules[key],before); assert.deepStrictEqual(check.V,check0.V);assert.equal(pen,pen0);
 });
 for(const [id,key,selectors] of [['shift_count_range','shift_counts',['[data-scr="day:min"]','[data-scr="day:max"]','[data-scr="night:min"]','[data-scr="night:max"]']],['shift_run_max','shift_run_max',['[data-srm="day"]','[data-srm="night"]']]]) {
  await test(`${id}: explicit visible clearing, repeat readback, off/on and Undo`,async()=>{
   setup(synthetic(id,'hard'));
   for(const sel of selectors) await edit(document.querySelector(sel),'','#hardRules');
   assert.deepStrictEqual(A.state.rules[key],{}); A.readSettings();sync();assert.deepStrictEqual(A.state.rules[key],{});
   A.undo();sync();assert.ok(Object.keys(A.state.rules[key]).length,'Undo restores the last explicitly cleared limit');
   await edit(document.querySelector(selectors.at(-1)),'','#hardRules');
   await edit(document.querySelector(`[data-ron="${id}"]`),false,'#profileBuilder');
   await edit(doctors[0].querySelector('[data-f="years"]'),'9');
   await edit(document.querySelector(`[data-ron="${id}"]`),true,'#profileBuilder');assert.deepStrictEqual(A.state.rules[key],{},'explicit empty stays empty instead of resetting defaults');
  });
  await test(`${id}: unused rule retains implicit defaults on first enable`,async()=>{
   const r=synthetic(id,'off');delete r[key];setup(r);A.readSettings();sync();assert.ok(!Object.hasOwn(A.state.rules,key));
   await edit(document.querySelector(`[data-ron="${id}"]`),true,'#profileBuilder');
   const expected=id==='shift_count_range'?{night:{min:3,max:5}}:{day:3};
   A.readSettings();sync();assert.deepStrictEqual(A.state.rules[key],expected);
  });
  await test(`${id}: absent shift fields retained while visible fields clear`,()=>{
   const r=synthetic(id,'hard'),before=clone(r[key].night),sel=selectors[0];
   T.RULE_BY_ID[id].ui.read(r,s=>s===sel?{value:''}:null);
   assert.deepStrictEqual(r[key].night,before);if(id==='shift_count_range')assert.equal(r[key].day.max,20);else assert.ok(!Object.hasOwn(r[key],'day'));
  });
 }
 console.log(`rule setting preservation: ${passed} passed, ${failed} failed`); if(!highs)console.log('SKIP solver: pass HiGHS package path'); if(failed)process.exitCode=1;
})().catch(e=>{console.error(e);process.exitCode=1;});

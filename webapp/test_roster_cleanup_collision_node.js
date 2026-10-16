// Staff names may coincide with structural keys. Exercise actual deletion and rendered buttons.
// Synthetic roster, browser storage and folder only.
const fs = require("fs"), path = require("path"), vm = require("vm"), assert = require("assert"), { execFileSync } = require("child_process");
const root = process.env.TOBAN_TEST_ROOT || __dirname, elements = new Map();
const element = s => { if (!elements.has(s)) elements.set(s, { value: "", innerHTML: "", textContent: "", hidden: false, className: "", listeners: {}, querySelectorAll: () => [], querySelector: () => null, addEventListener(k, fn) { (this.listeners[k] ||= []).push(fn); } }); return elements.get(s); };
globalThis.document = { querySelector: element, querySelectorAll: () => [], addEventListener() {} };
globalThis.confirm = () => true;
globalThis.alert = text => { throw new Error(String(text)); };
globalThis.window = globalThis;
globalThis.location = { pathname: "/synthetic/undo-order.html", protocol: "file:" };
globalThis.localStorage = { getItem: () => null, setItem() {} };
globalThis.T = {};
for (const f of ["i18n.js", "rules-core.js", "model.js", "messages.js", "solver.js", "check.js", "merge.js", "plugins.js", "app-core.js", "app-folder.js", "app-settings.js"])
  vm.runInThisContext(fs.readFileSync(path.join(root, "src", f), "utf8"), { filename: f });
for (const f of fs.readdirSync(path.join(root, "src/rules")).filter(f => f.endsWith(".js")))
  vm.runInThisContext(fs.readFileSync(path.join(root, "src/rules", f), "utf8"), { filename: f });
const A = T.app, clone = o => JSON.parse(JSON.stringify(o));
const N = ["Synthetic A", "Synthetic B", "Synthetic C"], Z = "Synthetic Z";
for (const k of ["save", "renderAll", "renderHeader", "readAll", "renderSettingsMonth", "renderDoctor", "showTab"]) A[k] = () => {};
A.choose = async () => { throw new Error("Unexpected merge conflict"); };
let toasts;
A.toast = s => toasts.push(String(s));
function setup() {
  const rules = { profile: { id: "synthetic-order", roles: [{ id: "S", label: "Staff", refs: [] }] }, doctors: N.map(name => ({ name, team: "S" })), name_order: N.slice() };
  T.fillDefaultRules(rules);
  const month = T.normalizeMonth({ year: 2026, month: 11, unavailable_night: { [N[0]]: [5], [N[1]]: [6], [N[2]]: [7] } }, rules);
  Object.assign(A.state, { rules, month, result: null, meta: null, base: null, baseRules: null, renames: [], ui: { doctor: 0 } });
  A.dirHandle = null; A.clearUndo(); toasts = [];
  A.markSaved("synthetic", "2026-10-01T00:00:00Z");
}
function rename(from, to) {
  assert.strictEqual(A.renameDoctor(from, to), true);
  A.state.rules.doctors.find(d => d.name === from).name = to;
  A.refreshNameOrder(A.state.rules);
}


A.bindSettings();
let passed=0, failed=0;
async function test(label,fn){try{await fn(); console.log('ok '+label);passed++;}catch(e){console.error('FAIL '+label+': '+e.stack);failed++;}}
// Parse the actual settings renderer for the Add/Delete click regressions below. Only DOM
// selection and event dispatch are adapted; readback, roster mutation, Undo and saving are real.
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
    getAttribute(k){return this.attrs[k]??null;},setAttribute(k,v){this.attrs[k]=String(v);},hasAttribute(k){return Object.hasOwn(this.attrs,k);},
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
function setupButtons(){
  const name=setupCollision("night"); A.renderFixed=()=>{}; A.renderSettings();
  for(const id of settingsPanes){const e=element("#"+id);e.querySelectorAll=s=>settingsTree(id).querySelectorAll(s);e.querySelector=s=>settingsTree(id).querySelector(s);}
  document.querySelector=s=>uiLookup(s)[0]||null;document.querySelectorAll=uiLookup;
  A.renderAll=()=>A.renderSettings();A.readSettings();A.renderSettings();A.markSaved("synthetic","2026-10-01T00:00:00Z");A.clearUndo();
  return name;
}
async function clickRoster(act,name){
  const selector=act==="add"?'#doctorTable button[data-act="add"]':`#doctorTable tr[data-i="${A.names().indexOf(name)}"]`;
  let button=document.querySelector(selector);if(act!=="add")button=button&&button.querySelector(`button[data-act="${act}"]`);
  assert(button,"actual rendered roster button exists");
  for(const fn of element("#settings").listeners.click)await fn({target:button});await Promise.resolve();
}

function setupCollision(name) {
  document.querySelector=element; document.querySelectorAll=()=>[];
  setup(); const R=A.state.rules;
  R.doctors[0].name=name; R.name_order[0]=name;
  R.profile.roles=[{id:'Rin',label:'Synthetic role',refs:[]}];
  R.doctors.forEach(d=>d.team='Rin');
  R.profile.positions={work:{count:{day:1,night:2}}};
  R.profile.shifts=[{id:'day',on:'none'},{id:'night',on:'all'}];
  R.oncall_requirement={Rin:{Rin:2}};
  for(const def of T.RULE_DEFS) if(def.states.includes('off'))R.rule_states[def.id]='off';
  R.friday_night_min={[name]:2,[N[1]]:1};
  R.dayoff_work_max={[name]:3,[N[1]]:4};
  R.weekend_dayshift_wish=[name,N[1]];
  R.pm_clinic_arrhythmia_candidates=[name,N[1]];R.arrhythmia_responsible_night=[name,N[1]];
  R.opaque={ [name]:{ note:'unknown schema'}, members:[name,{name}], structural:['night','day'] };
  A.state.month=T.normalizeMonth({year:2026,month:11,unavailable_night:{[name]:[5]},fixed:{night:{7:name}}},R);
  A.clearUndo();return name;
}
const personalPlugin={id:'local.cleanup.fixture',api:1,states:['hard','off'],def:'off',columns:[{
  key:'personal_fixture',begin(){return {};},end(R){if(R.local_person){R.local_person.by_name={};R.local_person.members=[];R.local_person.names=[];}}
}]};
(async()=>{
 for(const name of ['night','day','Rin','work','count','off','same_weekday_excess','Synthetic Removed']) await test('delete '+name+' preserves structural keys and removes known refs',async()=>{
  setupCollision(name); const R=A.state.rules, structural=clone({profile:R.profile,weights:R.weights,states:R.rule_states,oc:R.oncall_requirement,opaque:R.opaque});
  A.removeDoctor(0);
  assert(!A.names().includes(name));
  assert.deepStrictEqual({profile:R.profile,weights:R.weights,states:R.rule_states,oc:R.oncall_requirement,opaque:R.opaque},structural);
  for(const key of ['friday_night_min','dayoff_work_max'])assert(!Object.hasOwn(R[key],name));
  assert(!R.name_order.includes(name));assert.deepStrictEqual(R.pm_clinic_arrhythmia_candidates,[N[1]]);assert.deepStrictEqual(R.arrhythmia_responsible_night,[N[1]]);assert(!R.weekend_dayshift_wish.includes(name));
  assert(!Object.hasOwn(A.state.month.unavailable_night,name));assert(!Object.hasOwn(A.state.month.fixed.night,7));
  const P=new T.Problem(R,A.state.month);assert.strictEqual(P.countOf([1,'night']),2);assert.strictEqual(P.countMinOf([1,'night']),2);
 });
 await test('off-state plugin maps, name arrays and person records cleaned; unrelated values preserved',async()=>{
  setupCollision('night');T.rules.register(personalPlugin);
  const R=A.state.rules;R.rule_states[personalPlugin.id]='off';R.local_person={by_name:{night:{max:2},[N[1]]:{max:1}},members:[{name:'night',note:'fictional'},{name:N[1]}],names:['night',N[1]],night:17};
  try{assert.strictEqual(A.removeDoctor(0),true);assert.deepStrictEqual(R.local_person,{by_name:{[N[1]]:{max:1}},members:[{name:N[1]}],names:[N[1]],night:17});}finally{T.rules.unregister(personalPlugin.id);}
 });
 for(const kind of ['missing-off','throwing-end','throwing-begin','hook-failure'])await test('atomic rejection '+kind,async()=>{
  setupCollision('night');const R=A.state.rules,id='local.cleanup.failure';R.rule_states[id]='off';
  if(kind!=='missing-off')T.rules.register({id,api:1,states:['off'],def:'off',columns:[{key:'bad',begin(){if(kind==='throwing-begin')throw Error('synthetic');return {};},end(r){r.profile={};if(kind==='throwing-end')throw Error('synthetic');}}],normalize:kind==='hook-failure'?()=>{throw Error('synthetic');}:undefined});
  const before=JSON.stringify(A.state);
  try{assert.strictEqual(A.removeDoctor(0),false);assert.strictEqual(JSON.stringify(A.state),before);assert(toasts.length);}finally{T.rules.unregister(id);}
 });
 await test('rendered Delete and Undo preserve night staffing and restore personal inputs',async()=>{
  setupButtons(); const before=clone(A.state.rules),month=clone(A.state.month);
  await clickRoster('del','night');assert(!A.names().includes('night'));assert.strictEqual(new T.Problem(A.state.rules,A.state.month).countOf([1,'night']),2);
  A.undo();assert.deepStrictEqual(A.state.rules,before);assert.deepStrictEqual(A.state.month,month);
 });
 await test('rendered missing-plugin rejection changes neither state nor Undo',async()=>{
  setupButtons();A.state.rules.rule_states['local.cleanup.missing']='off';
  const before=JSON.stringify(A.state),undo=element('#undoNote').textContent;
  await clickRoster('del','night');assert.strictEqual(JSON.stringify(A.state),before);assert.strictEqual(element('#undoNote').textContent,undo);assert(toasts.length);
 });
 await test('rendered throwing cleanup changes neither state nor Undo',async()=>{
  setupButtons();const id='local.cleanup.throw';A.state.rules.rule_states[id]='off';
  T.rules.register({id,api:1,states:['off'],def:'off',columns:[{key:'bad',end(R){R.profile={};throw Error('synthetic');}}]});
  const before=JSON.stringify(A.state),undo=element('#undoNote').textContent;let saves=0;const save=A.save;A.save=()=>saves++;
  try{await clickRoster('del','night');assert.strictEqual(JSON.stringify(A.state),before);assert.strictEqual(element('#undoNote').textContent,undo);assert.strictEqual(saves,0);}finally{T.rules.unregister(id);A.save=save;}
 });
 await test('real solver still assigns two and checker rejects one after deletion',async()=>{
  setupCollision('night');assert.strictEqual(A.removeDoctor(0),true);
  const P=new T.Problem(A.state.rules,A.state.month), hp=process.argv[2];
  assert(hp,'Pass a HiGHS package path; this regression must run a real solve');
  const highs=await require(hp)();const result=await T.solve(P,highs,{time:10});assert(result.asg,result.status);
  for(const assignment of Object.values(result.asg))assert.strictEqual([].concat(assignment.work).length,2);
  assert.strictEqual(T.check(P,result.asg).V.length,0);
  result.asg['1:night'].work=N[1];assert(T.check(P,result.asg).VC.some(v=>v.code==='SLOT_WORKER_COUNT'));
 });
 console.log(`cleanup collision: ${passed} passed, ${failed} failed`);if(failed)process.exitCode=1;
})().catch(e=>{console.error(e);process.exitCode=1;});

// Distinguish actual deletion from Undo of a same-name addition, including save boundaries.
// Synthetic roster, browser storage and folder only.
const fs = require("fs"), path = require("path"), vm = require("vm"), assert = require("assert"), { execFileSync } = require("child_process");
const root = process.argv[2] || __dirname, elements = new Map();
const element = s => { if (!elements.has(s)) elements.set(s, { value: "", innerHTML: "", textContent: "", hidden: false, className: "", listeners: {}, querySelectorAll: () => [], querySelector: () => null, addEventListener(k, fn) { (this.listeners[k] ||= []).push(fn); } }); return elements.get(s); };
globalThis.document = { querySelector: element, querySelectorAll: () => [], addEventListener() {} };
globalThis.confirm = () => true;
globalThis.alert = text => { throw new Error(String(text)); };
globalThis.window = globalThis;
globalThis.location = { pathname: "/synthetic/undo-order.html", protocol: "file:" };
globalThis.localStorage = { getItem: () => null, setItem() {} };
globalThis.T = {};
for (const f of ["i18n.js", "rules-core.js", "model.js", "messages.js", "merge.js", "plugins.js", "app-core.js", "app-folder.js", "app-settings.js"])
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
async function reorder(order) {
  A.pushUndo("名簿の並べ替え");
  const rows = A.state.rules.doctors.slice();
  A.state.rules.doctors = order.map(i => rows[i]);
  A.refreshNameOrder(A.state.rules);
  await Promise.resolve(); // The real undo entry captures the month after the edit in a microtask.
}
function folder(data) {
  const files = new Map([["202611_data.json", JSON.stringify(data)]]);
  const dir = { name: "synthetic-folder", async *entries() { yield ["202611", { kind: "directory" }]; },
    async getDirectoryHandle() { return dir; },
    async getFileHandle(name, options = {}) {
      if (!files.has(name) && !options.create) throw Object.assign(new Error("synthetic missing file"), { name: "NotFoundError" });
      return { getFile: async () => ({ text: async () => files.get(name) }),
        createWritable: async () => ({ write: async blob => files.set(name, await blob.text()), close: async () => {} }) };
    }
  };
  A.dirHandle = dir; A.monthDirs = ["202611"]; A.dirGen++;
  return files;
}


A.bindSettings();
let passed=0, failed=0;
async function test(label,fn){try{await fn(); console.log('ok '+label);passed++;}catch(e){console.error('FAIL '+label+': '+e.stack);failed++;}}
function setupDefault() { setup(); const name=T.t('新規'); rename(N[0],name); A.markSaved('synthetic','2026-10-01T00:00:00Z'); return name; }
async function removeName(name) { A.pushUndo('remove person'); A.removeDoctor(A.names().indexOf(name)); A.refreshNameOrder(A.state.rules); A.ensureMonth(A.state.month); await Promise.resolve(); }
async function addDefault() { A.pushUndo('add default-name person'); const used=new Set(A.names()), base=T.t('新規'); let name=base,k=2; while(used.has(name)) name=base+' '+k++; A.state.rules.doctors.push({name,team:'S'}); A.refreshNameOrder(A.state.rules); A.ensureMonth(A.state.month); await Promise.resolve(); return name; }
function origin(name) { return T.renameOrigin(A.state.renames,A.state.baseRules.doctors.map(d=>d.name),name); }
function additions() { return T.newPersons(A.state.renames,A.state.baseRules.doctors.map(d=>d.name),A.names()); }

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
function setupButtons(){
  const name=setupDefault(); A.renderFixed=()=>{}; A.renderSettings();
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
(async()=>{
 await test('Undo addition then original deletion restores original identity',async()=>{
   const name=setupDefault(); await removeName(name); assert.strictEqual(await addDefault(),name); A.undo(); A.undo();
   assert.deepStrictEqual(A.state.month.unavailable_night[name],[5]); assert.strictEqual(origin(name),name); assert.deepStrictEqual(additions(),[]);
 });
 await test('Undo actual new-person deletion restores new identity',async()=>{
   const name=setupDefault(); await removeName(name); assert.strictEqual(await addDefault(),name); await removeName(name); A.undo();
   assert.strictEqual(origin(name),null); assert.deepStrictEqual(additions(),[name]);
 });
 await test('Saved replacement followed by two Undos does not become the new saved person',async()=>{
   const name=setupDefault(), files=folder(JSON.parse(A.payloadJson('2026-10-01T00:00:00Z')));
   await removeName(name); assert.strictEqual(await A.autosaveJson(),'saved'); assert.strictEqual(await addDefault(),name); assert.strictEqual(await A.autosaveJson(),'saved');
   A.undo(); A.undo(); assert.deepStrictEqual(A.state.month.unavailable_night[name],[5]); assert.strictEqual(origin(name),null); assert.deepStrictEqual(additions(),[name]);
   const remote=JSON.parse(files.get('202611_data.json')); remote.month.unavailable_night[name]=[9]; remote.saved_at='2026-10-03T00:00:00Z'; files.set('202611_data.json',JSON.stringify(remote)); const before=files.get('202611_data.json');
   let decisions=0; A.choose=async(message,options)=>{decisions++;assert.ok(options.some(o=>o.value==='load'));return null;};
   assert.strictEqual(await A.autosaveJson(),'skipped'); assert.strictEqual(decisions,1); assert.strictEqual(files.get('202611_data.json'),before); assert.deepStrictEqual(A.state.month.unavailable_night[name],[5]);
 });

 await test('JSON roster replacement Undo preserves the live new person using a deleted base name',async()=>{
   setup(); await removeName(N[0]); const added=await addDefault();
   A.pushUndo('rename new person');rename(added,N[0]);await Promise.resolve();
   const before=clone(A.state.renames), rules=clone(A.state.rules);rules.doctors=rules.doctors.filter(d=>d.name!==N[0]);A.refreshNameOrder(rules);
   element('#rulesJson').value=JSON.stringify(rules);await element('#btnApplyRules').listeners.click[0]();await Promise.resolve();
   assert.ok(!A.names().includes(N[0]));A.undo();
   assert.ok(A.names().includes(N[0]));assert.strictEqual(origin(N[0]),null);assert.deepStrictEqual(additions(),[N[0]]);
   assert.deepStrictEqual(A.state.renames,before,'the existing new-person chain already identifies the restored person');
 });

 await test('Legacy live-name alias with only one deletion marker blocks automatic merge',async()=>{
   setup();const remote=JSON.parse(A.payloadJson('2026-10-02T00:00:00Z'));remote.month.unavailable_night[N[0]].push(9);const files=folder(remote), original=files.get('202611_data.json');
   await removeName(N[0]);const added=await addDefault();A.pushUndo('rename new person');rename(added,N[0]);await Promise.resolve();
   A.state.month.unavailable_night[N[0]]=[6];
   // Persisted output of the old JSON/profile Undo path: it revived original A's marker although new A already had a live chain.
   A.state.renames.push([T.GONE+N[0],N[0]]);A.state.renames=JSON.parse(JSON.stringify(A.state.renames));A.clearUndo();
   assert.strictEqual(A.state.renames.filter(([,n])=>n.startsWith(T.GONE)).length,1);
   let decisions=0;A.choose=async(message,options)=>{decisions++;assert.ok(message.includes('以前の版'));assert.ok(options.some(o=>o.value==='load'));return null;};
   assert.strictEqual(await A.autosaveJson(),'skipped');assert.strictEqual(decisions,1);assert.strictEqual(files.get('202611_data.json'),original);assert.deepStrictEqual(A.state.month.unavailable_night[N[0]],[6]);
 });
 for(const choice of [null,"load","overwrite"])await test(`actual Add/Delete buttons: reused default name requires whole-version choice ${choice}`,async()=>{
   const name=setupButtons(),remote=JSON.parse(A.payloadJson("2026-10-02T00:00:00Z"));remote.month.unavailable_night[name].push(9);
   const files=folder(remote),before=files.get("202611_data.json");
   await clickRoster("del",name);await clickRoster("add");assert.ok(A.names().includes(name));A.state.month.unavailable_night[name]=[6];
   const mine=structuredClone(A.state.month),mineRules=structuredClone(A.state.rules);let decisions=0;
   A.choose=async(message,options)=>{decisions++;assert.ok(options.some(o=>o.value==="load"));assert.ok(options.some(o=>o.value==="overwrite"));return choice;};
   assert.strictEqual(await A.autosaveJson(),choice==="overwrite"?"saved":"skipped");assert.strictEqual(decisions,1);
   if(choice===null){assert.deepStrictEqual(A.state.month,mine);assert.deepStrictEqual(A.state.rules,mineRules);assert.strictEqual(files.get("202611_data.json"),before);}
   else if(choice==="load"){assert.deepStrictEqual(A.state.month.unavailable_night[name],[5,9]);assert.strictEqual(files.get("202611_data.json"),before);}
   else assert.deepStrictEqual(JSON.parse(files.get("202611_data.json")).month.unavailable_night[name],[6]);
 });
 await test("actual Add/Delete buttons: another person's remote edit merges without reviving removed input",async()=>{
   const name=setupButtons(),remote=JSON.parse(A.payloadJson("2026-10-02T00:00:00Z"));remote.month.unavailable_night[N[1]].push(12);const files=folder(remote);
   await clickRoster("del",name);await clickRoster("add");A.state.month.unavailable_night[name]=[6];let decisions=0;A.choose=async()=>{decisions++;return null;};
   assert.strictEqual(await A.autosaveJson(),"saved");assert.strictEqual(decisions,0);
   const saved=JSON.parse(files.get("202611_data.json"));assert.deepStrictEqual(saved.month.unavailable_night[name],[6]);assert.deepStrictEqual(saved.month.unavailable_night[N[1]],[6,12]);
 });
 await test("actual Add/Delete buttons: Undo addition then deletion restores original identity",async()=>{
   const name=setupButtons();await clickRoster("del",name);await clickRoster("add");assert.strictEqual(origin(name),null);assert.deepStrictEqual(additions(),[name]);
   A.undo();assert.ok(!A.names().includes(name));A.undo();assert.strictEqual(origin(name),name);assert.deepStrictEqual(A.state.month.unavailable_night[name],[5]);assert.deepStrictEqual(additions(),[]);
 });
 await test("actual Add/Delete buttons: saved replacement and two Undos retain distinct identities",async()=>{
   const name=setupButtons(),files=folder(JSON.parse(A.payloadJson("2026-10-01T00:00:00Z")));await clickRoster("del",name);assert.strictEqual(await A.autosaveJson(),"saved");
   await clickRoster("add");assert.strictEqual(await A.autosaveJson(),"saved");A.undo();A.undo();assert.strictEqual(origin(name),null);assert.deepStrictEqual(additions(),[name]);assert.deepStrictEqual(A.state.month.unavailable_night[name],[5]);
   const remote=JSON.parse(files.get("202611_data.json"));remote.month.unavailable_night[name]=[9];remote.saved_at="2026-10-03T00:00:00Z";files.set("202611_data.json",JSON.stringify(remote));const before=files.get("202611_data.json");
   let decisions=0;A.choose=async(message,options)=>{decisions++;assert.ok(options.some(o=>o.value==="load"));return null;};
   assert.strictEqual(await A.autosaveJson(),"skipped");assert.strictEqual(decisions,1);assert.strictEqual(files.get("202611_data.json"),before);
 });
 console.log(`deleted-name occurrences: ${passed} passed, ${failed} failed`);if(failed)process.exitCode=1;
})().catch(e=>{console.error(e);process.exitCode=1});

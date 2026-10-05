// Empty rosters are an allowed intermediate state while rebuilding the roster.
// Exercise real deletion, persistence, calendar rendering/readback and recovery.
const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert');
const elements = new Map(), saved = new Map();
function element() { return { dataset: {}, children: [], innerHTML: '', value: '', textContent: '', querySelectorAll: () => [], querySelector: () => null, addEventListener() {} }; }
globalThis.document = { querySelector(s) { if (!elements.has(s)) elements.set(s, element()); return elements.get(s); }, querySelectorAll: () => [] };
globalThis.location = { pathname: '/synthetic/empty-roster.html' };
globalThis.localStorage = { getItem: k => saved.get(k) || null, setItem: (k,v) => saved.set(k,v) };
globalThis.T = {};
for (const f of ['i18n.js','rules-core.js','model.js','messages.js','app-core.js','app-input.js','app-settings.js'])
  vm.runInThisContext(fs.readFileSync(f === 'app-input.js' && process.env.TOBAN_UI_INPUT_SOURCE || path.join(__dirname,'src',f),'utf8'), {filename:f});
for (const f of fs.readdirSync(path.join(__dirname,'src/rules')).filter(f => f.endsWith('.js'))) vm.runInThisContext(fs.readFileSync(path.join(__dirname,'src/rules',f),'utf8'));
T.registerLang(JSON.parse(fs.readFileSync(path.join(__dirname,'lang/en.json'),'utf8')));
const A = T.app, n = 'Synthetic Solo', clone = o => JSON.parse(JSON.stringify(o));
A.renderHeader = () => {}; A.toast = () => {}; A.renderAll = () => A.renderDoctor();
function setup() {
  const R = { profile: { id:'empty-roster-test', roles:[{id:'S',label:'Staff',refs:[]}] }, doctors:[{name:n,team:'S',quota:1}], name_order:[n] };
  T.fillDefaultRules(R); const M = T.normalizeMonth({year:2026,month:11,unavailable_night:{[n]:[5]},notes:'Synthetic note'},R);
  Object.assign(A.state,{rules:R,month:M,result:null,ui:{doctor:0},renames:[],meta:null,base:null,baseRules:null});
  A.dirHandle=null; A.clearUndo(); elements.clear(); T.setLang('en'); return M;
}
let count=0;
function test(label,fn) { fn(); console.log('ok '+label); count++; }
test('deleting the last person renders an actionable empty calendar',()=>{
  setup(); A.renderDoctor(); A.removeDoctor(0); A.refreshNameOrder(A.state.rules); A.save();
  assert.doesNotThrow(()=>A.renderDoctor()); const root=document.querySelector('#doctorPane');
  assert(root.innerHTML.includes('The roster is empty')); assert(!Object.hasOwn(root.dataset,'doctor')); assert(!root.innerHTML.includes('docNext'));
  assert.deepStrictEqual(A.state.rules.doctors,[]); assert.deepStrictEqual(A.state.rules.name_order,[]); assert.strictEqual(A.state.month.notes,'Synthetic note');
});
test('reloading a persisted empty roster does not fail calendar initialization',()=>{
  setup(); A.removeDoctor(0); A.persist(); const loaded=A.load(); assert(loaded); Object.assign(A.state,loaded); A.ensureMonth(A.state.month);
  assert.doesNotThrow(()=>A.renderDoctor()); assert.deepStrictEqual(A.state.rules.doctors,[]);
});
test('readback with no selected person cannot manufacture undefined-name data',()=>{
  setup(); A.removeDoctor(0); A.renderDoctor(); const before=clone(A.state.month);
  document.querySelector('#doctorPane').children=[{}]; A.readAll(); A.readAll();
  assert.deepStrictEqual(clone(A.state.month),before); assert(!JSON.stringify(A.state.month).includes('undefined'));
});
test('adding a new person restores the calendar without reloading',()=>{
  setup(); A.removeDoctor(0); A.renderDoctor(); A.state.rules.doctors.push({name:'Synthetic New',team:'S',quota:1}); A.refreshNameOrder(A.state.rules);
  A.renderDoctor(); const root=document.querySelector('#doctorPane'); assert.strictEqual(root.dataset.doctor,'Synthetic New'); assert(root.innerHTML.includes('data-cal="duty"'));
});
(async()=>{
  setup(); A.pushUndo('remove last person'); A.removeDoctor(0); A.refreshNameOrder(A.state.rules); await Promise.resolve(); A.renderDoctor(); A.undo();
  assert.strictEqual(A.state.rules.doctors[0].name,n); assert.strictEqual(document.querySelector('#doctorPane').dataset.doctor,n);
  assert.deepStrictEqual(A.state.month.unavailable_night[n],[5]); console.log('ok undo restores the deleted person and calendar'); count++;
  console.log(`ALL OK (${count})`);
})().catch(e=>{console.error(e);process.exitCode=1;});

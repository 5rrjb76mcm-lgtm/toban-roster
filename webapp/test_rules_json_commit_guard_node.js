// Isolated production focusout listener regression. All data synthetic.
// readSettings is replaced with a model mutation to isolate editor synchronization;
// this is not a DOM/browser integration test. TOBAN_WEBAPP_ROOT selects source tree.
const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert/strict');
const root = path.resolve(process.env.TOBAN_WEBAPP_ROOT || __dirname);
let src = fs.readFileSync(path.join(root, 'src/app-settings.js'), 'utf8');
const occurrences = (src.match(/(?<!function )readSettings\(/g) || []).length;
assert(occurrences > 0, 'expected production calls to readSettings');
src = src.replace(/(?<!function )readSettings\(/g, 'testReadSettings(');
function harness() {
 const els = new Map();
 class Element { constructor(id){this.id=id;this.value='';this.dataset={};this.handlers={};} addEventListener(t,f){(this.handlers[t] ||= []).push(f)} setAttribute(){} contains(){return true} querySelectorAll(){return []} closest(){return null} matches(){return false} emit(t,target=this){for(const f of this.handlers[t]||[])f({target});} }
 const el = s => { if(!els.has(s)) els.set(s,new Element(s.slice(1))); return els.get(s); };
 const state = {rules:{run_length:{max:5,min:3},days_off:{}, doctors:[], weights:{}},month:{}};
 const T={app:{state,save(){},renderSettingsMonth(){},renderDoctor(){}}, numberInputText:x=>String(x),t:x=>x};
 const document={querySelector:el,querySelectorAll:()=>[]};
 const context={T,document,localStorage:{getItem:()=>null,setItem(){}},confirm:()=>true,alert(){},prompt(){},testReadSettings(){state.rules.run_length.max=7;return true;}};
 vm.runInNewContext(src,context,{filename:'app-settings.js'}); T.app.bindSettings();
 const json=el('#rulesJson'), max=el('#setRunMax'), settings=el('#settings');
 json.value=JSON.stringify(state.rules,null,1);
 return {json,max,settings,state,T};
}
function commit(h) {h.max.value='7'; h.max.dataset.numericEdited='1'; h.settings.emit('focusout',h.max); assert.equal(h.state.rules.run_length.max,7,'simulated commit executed');}
const results = [];
function test(name, fn) { try { fn(); results.push({name, ok:true}); console.log('PASS ' + name); } catch (e) { results.push({name, ok:false}); console.error('FAIL ' + name + ': ' + e.message); } }
for(const [name, draft] of [['invalid', '{"incomplete":'], ['valid', '{"valid":true}']]) test(name + ' draft', () => {
 const h=harness(); h.json.value=draft; h.json.emit('input'); commit(h);
 assert.equal(h.json.value,draft,'committing a rule number must retain the unapplied JSON');
 assert.equal(h.T.app.hasPendingRulesJsonDraft(),true,'draft remains pending');
});
test('reverted draft', () => {
 const h=harness(); const initial=h.json.value; h.json.value=initial+' '; h.json.emit('input'); h.json.value=initial; h.json.emit('input'); assert.equal(h.json.dataset.pluginDraft, '1', 'marker remains compatible'); assert.equal(h.T.app.hasPendingRulesJsonDraft(), false, 'reverted content is not pending'); commit(h);
 assert.equal(h.json.value,JSON.stringify(h.state.rules,null,1),'reverted editor follows committed model');
 assert.equal(h.T.app.hasPendingRulesJsonDraft(),false);
});
test('minimal editor without dataset', () => {
 const h=harness(); delete h.json.dataset; h.json.emit('input'); commit(h);
 assert.equal(h.T.app.hasPendingRulesJsonDraft(), false);
 assert.equal(h.json.value, JSON.stringify(h.state.rules, null, 1));
});
if (results.some(r => !r.ok)) process.exitCode = 1;

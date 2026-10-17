// Disabled plug-in intent survives partial inventories and unrelated settings edits.
// Actual markup, init, delegated settings events,
// Problem and localStorage. Fictional data only; jsdom supplies the DOM.
// No browser, layout, OS permissions or network test is claimed; no sockets are opened.
// Run: TOBAN_DOM_MODULE=/path/to/node_modules/jsdom node test_plugins_off_preservation_dom_node.js
const fs = require('fs'), path = require('path'), assert = require('assert');
// Verified with jsdom 26.1.0. Dependency lookup never downloads/install packages.
let JSDOM;
for (const name of [process.env.TOBAN_DOM_MODULE, 'jsdom', path.join(process.env.HOME || '', '.toban-test/node_modules/jsdom')].filter(Boolean)) {
  try { ({ JSDOM } = require(name)); break; } catch (e) { if (e.code !== 'MODULE_NOT_FOUND') throw e; }
}
if (!JSDOM) throw new Error('Settings builder DOM-adapter regression requires jsdom 26.1.0. Set TOBAN_DOM_MODULE to its installed module path. This test was NOT run.');
const N = ['Synthetic Trainer', 'Synthetic Colleague'], clone = x => JSON.parse(JSON.stringify(x));
const root = process.env.TOBAN_SOURCE_ROOT || __dirname;
const source = f => fs.readFileSync(path.join(root, 'src', f), 'utf8');
const scripts = ['i18n.js','rules-core.js','model.js', ...fs.readdirSync(path.join(root,'src/calendars')).filter(f=>f.endsWith('.js')).sort().map(f=>'calendars/'+f),
  'messages.js','solver.js','check.js','report.js','docxgen.js','plugins.js','merge.js', ...fs.readdirSync(path.join(root,'src/rules')).filter(f=>f.endsWith('.js')).sort().map(f=>'rules/'+f),
  'app-core.js','app-folder.js','app-month.js','app-input.js','app-settings.js','app-solve.js','app-main.js'];
const key = 'toban_state_v2:/synthetic/settings-builder-preservation.html';
const rawRules = {profile:{id:'synthetic-settings-builder-preservation',roles:[{id:'S',label:'Staff',refs:[]}],shifts:[{id:'day',on:'all'},{id:'night',on:'all'}]},doctors:N.map(name=>({name,team:'S',quota:15})),rule_states:{oncall:'off'},weights:{}};
const rawMonth = {year:2026,month:11,notes:'Synthetic settings builder roundtrip'};
async function makeApp(saved, fixture=rawRules, defaults=fixture) {
  const dom = new JSDOM(source('index.html'), {url:'https://example.invalid/synthetic/settings-builder-preservation.html',runScripts:'outside-only'}), w=dom.window;
  await new Promise(resolve=>w.document.readyState==='complete'?resolve():w.addEventListener('load',resolve,{once:true}));
  const errors=[]; w.addEventListener('error',e=>{errors.push(e.error || e.message);e.preventDefault();});
  w.confirm=()=>true; w.alert=msg=>{throw new Error('Unexpected alert: '+msg);}; w.prompt=()=>null;
  w.T={DEFAULT_RULES:clone(defaults), SAMPLE_MONTH:clone(rawMonth), PROFILES:[], LANGS_DATA:['en','ja'].map(code=>JSON.parse(fs.readFileSync(path.join(root,'lang',code+'.json'),'utf8')))};
  for(const f of scripts) w.eval(source(f)+'\n//# sourceURL='+f);
  const A=w.T.app; A.restoreFolder=()=>{}; // Start-gate/OS-folder access is outside this DOM-adapter test.
  A.toast=()=>{};
  w.localStorage.setItem('toban.lang','en');
  const initial=clone(fixture); w.T.fillDefaultRules(initial);
  for(const def of w.T.RULE_DEFS) if(def.states.includes('off') && fixture.rule_states?.[def.id] === undefined) initial.rule_states[def.id]='off';
  w.T.fillDefaultRules(initial);
  w.localStorage.setItem(key,saved || JSON.stringify({rules:initial,month:rawMonth,result:null,ui:{doctor:1}}));
  w.T.init();
  const q=s=>w.document.querySelector(s), click=s=>{assert(q(s),'Missing '+s);q(s).click();}, change=(s,v)=>{const el=typeof s==='string'?q(s):s;assert(el,'Missing '+s);if(el.type==='checkbox')el.checked=v;else el.value=v;el.dispatchEvent(new w.Event('change',{bubbles:true}));};
  const tick=()=>new Promise(r=>w.setTimeout(r,0));
  const enter=()=>{click('.tab[data-tab="settings"]');click('[data-setmode="build"]');};
  return {dom,w,A,q,click,change,tick,enter,errors};
}



async function imported(a,r){
 for(const d of a.w.T.RULE_DEFS)if(d.states.includes('off') && r.rule_states[d.id]===undefined)r.rule_states[d.id]='off';
 const input=a.q('#fileLoadProfile');Object.defineProperty(input,'files',{configurable:true,value:[{name:'synthetic-plugins.json',text:async()=>JSON.stringify(r)}]});input.dispatchEvent(new a.w.Event('change',{bubbles:true}));await a.tick();await a.tick();assert.equal(a.A.state.rules.profile.id,r.profile.id);a.enter();
}
const off=a=>a.A.state.rules.plugins_off===undefined?undefined:clone(a.A.state.rules.plugins_off);
const edit=a=>a.change('#doctorTable tr[data-i="0"] [data-f="years"]','12');
const cases=[],test=(name,fn)=>cases.push({name,fn});
const EXPECTED_CASES=27;let passed=0,failed=0,completed=false;
process.on('exit',()=>{if(!completed || passed+failed!==EXPECTED_CASES){console.error('FAIL incomplete plug-in preservation cases');process.exitCode=1;}});
const watchdog=setTimeout(()=>{console.error('FAIL plug-in preservation timeout');process.exit(1);},120000);watchdog.unref();
async function scenario(visible,disabled,action,expected){
 const r=clone(rawRules);r.profile.id='synthetic-disabled-plugin-import';if(disabled!==undefined)r.plugins_off=clone(disabled);
 r.plugin_metadata={object:{a:1},list:[null,false,2],text:'keep'};
 const a=await makeApp();try{
  for(const name of visible)assert(a.w.T.plugins.load('rules',name,'').ok);a.enter();await imported(a,r);
  assert.deepStrictEqual(off(a),disabled,'accepted import');action(a);assert.deepStrictEqual(off(a),expected,'after action');
  assert.deepStrictEqual(clone(a.A.state.rules.plugin_metadata),r.plugin_metadata);
  a.A.readSettings();a.A.readSettings();assert.deepStrictEqual(off(a),expected,'repeated read');
  assert.deepStrictEqual(JSON.parse(a.w.localStorage.getItem(key)).rules.plugins_off,expected,'persisted');
  const b=await makeApp(a.w.localStorage.getItem(key));try{assert.deepStrictEqual(off(b),expected,'reload');}finally{b.dom.window.close();}
  a.A.undo();assert.deepStrictEqual(off(a),disabled,'local Undo restores disabled intent');assert.deepStrictEqual(a.errors,[]);
 }finally{a.dom.window.close();}
}
const present=['rules/present.js'],missing='rules/absent.js';
test('unrelated edit with enabled visible plug-in',()=>scenario(present,[missing],edit,[missing]));
test('unrelated edit with disabled visible plug-in',()=>scenario(present,[missing,...present],edit,[missing,...present]));
test('no visible plug-ins',()=>scenario([],[missing],edit,[missing]));
test('all plug-ins visible',()=>scenario([...present,'rules/second.js'],[...present,'rules/second.js'],edit,[...present,'rules/second.js']));
test('explicit disable retains absent entry',()=>scenario(present,[missing],a=>a.change('[data-pon="rules/present.js"]',false),[missing,...present]));
test('explicit enable retains absent entry',()=>scenario(present,[missing,...present],a=>a.change('[data-pon="rules/present.js"]',true),[missing]));
test('explicit enable final visible entry clears list',()=>scenario(present,present,a=>a.change('[data-pon="rules/present.js"]',true),undefined));
test('explicit disable creates list',()=>scenario(present,undefined,a=>a.change('[data-pon="rules/present.js"]',false),present));
test('absent list stays absent',()=>scenario(present,undefined,edit,undefined));
test('empty list stays empty',()=>scenario(present,[],edit,[]));
const foreign=[missing,'calendars/holiday.js','docx/custom.js',' future / id ','__proto__'];
test('unknown file names survive',()=>scenario(present,foreign,edit,foreign));
const opaque=[missing,null,7,false,{future:'opaque'}];
test('opaque array entries remain untouched',()=>scenario(present,opaque,edit,opaque));
test('duplicates and order survive unrelated edit',()=>scenario(present,[missing,...present,missing,...present],edit,[missing,...present,missing,...present]));
test('explicit enable removes owned duplicates only',()=>scenario(present,[missing,...present,missing,...present],a=>a.change('[data-pon="rules/present.js"]',true),[missing,missing]));
test('disabled absent plug-in stays off when legitimately restored',async()=>{
 const a=await makeApp();try{
  const code="T.rules.register({id:'local.absent',label:'Synthetic rule',states:['hard','off'],def:'hard'});";
  assert(a.w.T.plugins.load('rules',missing,code).ok);a.A.state.rules.plugins_off=[missing];a.A.state.rules.rule_states['local.absent']='hard';
  assert.equal(a.w.T.ruleState(a.A.state.rules,'local.absent'),'off');a.w.T.plugins.beginFolder();assert(!a.w.T.RULE_BY_ID['local.absent']);
  assert(a.w.T.plugins.load('rules',present[0],'').ok);a.enter();edit(a);assert.deepStrictEqual(off(a),[missing]);
  assert(!a.w.T.RULE_BY_ID['local.absent']);assert.equal(a.w.T.ruleState(a.A.state.rules,'local.absent'),'off');
  assert(a.w.T.plugins.load('rules',missing,code).ok);assert.equal(a.w.T.ruleState(a.A.state.rules,'local.absent'),'off');
  a.A.renderSettings();a.change('[data-pon="rules/absent.js"]',true);assert.equal(a.w.T.ruleState(a.A.state.rules,'local.absent'),'hard');assert.deepStrictEqual(a.errors,[]);
 }finally{a.dom.window.close();}
});
test('non-toggle inventory entries do not claim disabled names',async()=>{
 const a=await makeApp();try{
  assert(a.w.T.plugins.load('profiles','profiles/example.json',JSON.stringify(rawRules)).ok);
  a.A.state.rules.plugins_off=[missing,'profiles/example.json'];a.enter();edit(a);assert.deepStrictEqual(off(a),[missing,'profiles/example.json']);assert.deepStrictEqual(a.errors,[]);
 }finally{a.dom.window.close();}
});
test('failed visible file can still be explicitly disabled',async()=>{
 const a=await makeApp();try{
  a.w.T.plugins.fail('rules',present[0],'Synthetic read failure');a.A.state.rules.plugins_off=[missing];a.enter();a.change('[data-pon="rules/present.js"]',false);assert.deepStrictEqual(off(a),[missing,...present]);assert.deepStrictEqual(a.errors,[]);
 }finally{a.dom.window.close();}
});
// Malformed but renderable imports keep the preexisting checkbox-derived behavior.
for(const value of ['rules/absent.js','x',null,false,0,''])test('non-array import does not throw: '+JSON.stringify(value),()=>scenario(present,value,edit,undefined));
test('non-array explicit disable keeps previous canonicalization',()=>scenario(present,'rules/absent.js',a=>a.change('[data-pon="rules/present.js"]',false),present));
test('non-array explicit enable keeps previous canonicalization',()=>scenario(['x'],'x',a=>a.change('[data-pon="x"]',true),undefined));
// Truthy noniterables already fail the renderer's new Set boundary; do not widen this patch.
for(const value of [7,{future:'opaque'}])test('existing noniterable render boundary: '+JSON.stringify(value),async()=>{
 const a=await makeApp();try{a.A.state.rules.plugins_off=value;assert.throws(()=>a.A.renderSettings(),/iterable/);}finally{a.dom.window.close();}
});
(async()=>{assert.equal(cases.length,EXPECTED_CASES);for(const c of cases){try{await c.fn();passed++;console.log('PASS '+c.name);}catch(e){failed++;console.error('FAIL '+c.name,e);}}completed=true;clearTimeout(watchdog);console.log(`plug-in preservation: ${passed} passed, ${failed} failed, ${cases.length} total`);if(failed)process.exitCode=1;})().catch(e=>{console.error(e);process.exitCode=1;});

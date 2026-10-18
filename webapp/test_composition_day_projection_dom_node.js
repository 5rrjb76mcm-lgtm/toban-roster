// Exact composition flag IDs survive HTML projection without conflating distinct options.
// Actual markup, init, delegated settings events,
// Problem and localStorage. Fictional data only; jsdom supplies the DOM.
// No browser, layout, OS permissions or network test is claimed; no sockets are opened.
// Run: TOBAN_DOM_MODULE=/path/to/node_modules/jsdom node test_composition_day_projection_dom_node.js
const fs = require('fs'), path = require('path'), assert = require('assert');
// Verified with jsdom 26.1.0. Dependency lookup never downloads/install packages.
let JSDOM;
for (const name of [process.env.TOBAN_DOM_MODULE, 'jsdom', path.join(process.env.HOME || '', '.toban-test/node_modules/jsdom')].filter(Boolean)) {
  try { ({ JSDOM } = require(name)); break; } catch (e) { if (e.code !== 'MODULE_NOT_FOUND') throw e; }
}
if (!JSDOM) throw new Error('Composition day selector DOM-adapter regression requires jsdom 26.1.0. Set TOBAN_DOM_MODULE to its installed module path. This test was NOT run.');
const N = ['Synthetic Trainer', 'Synthetic Colleague'], clone = x => JSON.parse(JSON.stringify(x));
const root = process.env.TOBAN_SOURCE_ROOT || __dirname;
const source = f => fs.readFileSync(path.join(root, 'src', f), 'utf8');
const scripts = ['i18n.js','rules-core.js','model.js', ...fs.readdirSync(path.join(root,'src/calendars')).filter(f=>f.endsWith('.js')).sort().map(f=>'calendars/'+f),
  'messages.js','solver.js','check.js','report.js','docxgen.js','plugins.js','merge.js', ...fs.readdirSync(path.join(root,'src/rules')).filter(f=>f.endsWith('.js')).sort().map(f=>'rules/'+f),
  'app-core.js','app-folder.js','app-month.js','app-input.js','app-settings.js','app-solve.js','app-main.js'];
const key = 'toban_state_v2:/synthetic/composition-day-selector-preservation.html';
const rawRules = {profile:{id:'synthetic-composition-day-selector-preservation',roles:[{id:'S',label:'Staff',refs:[]}],shifts:[{id:'day',on:'all'},{id:'night',on:'all'}]},doctors:N.map(name=>({name,team:'S',quota:15})),rule_states:{oncall:'off'},weights:{}};
const rawMonth = {year:2026,month:11,notes:'Synthetic settings builder roundtrip'};
async function makeApp(saved, fixture=rawRules, defaults=fixture) {
  const dom = new JSDOM(source('index.html'), {url:'https://example.invalid/synthetic/composition-day-selector-preservation.html',runScripts:'outside-only'}), w=dom.window;
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


// The month is fictional model input; no calendar controls are opened or edited.
const ID = { cr:'Synthetic\rtraining', crlf:'Synthetic\r\ntraining', nul:'Synthetic\u0000training', lf:'Synthetic\ntraining', replacement:'Synthetic\uFFFDtraining', tab:'Synthetic\ttraining', normal:'Synthetic ordinary' };
rawMonth.day_flags = {7:[ID.cr,ID.crlf,ID.nul,ID.tab],8:[ID.lf,ID.replacement],9:[ID.normal]};
const EXPECTED_CASES=29;
let finished=false,passed=0,failed=0;
const watchdog=setTimeout(()=>{console.error('FAIL composition day projection test timed out');process.exit(1);},120000);
process.on('exit',()=>{if(!finished || passed+failed!==EXPECTED_CASES){console.error(`FAIL incomplete composition day projection test: ${passed+failed}/${EXPECTED_CASES}`);process.exitCode=1;}});
const cases=[],test=(name,fn)=>cases.push({name,fn});
const savedRows=a=>clone(a.A.state.rules.composition);
const editYears=a=>{a.click('[data-setmode="daily"]');a.change('#doctorTable tr[data-i="0"] [data-f="years"]','12');};
async function fixture(a,{id=ID.cr,state='hard',active=true,ids=[id,ID.normal],rows,viaFile=false}={}){
 a.enter();a.A.readSettings();const r=clone(a.A.state.rules);
 r.profile.label='Synthetic projection import';r.rule_states.composition=state;r.weights.composition_miss=100;r.doctors[0].quals=['trainer'];
 r.composition=rows || [{shift:'night',days:'flag:'+id,min:1,qual:'trainer',local_extra:{id:'original',flags:[false,0]}}];
 if(active)r.profile.day_flags=ids.map((id,i)=>({id,label:'Synthetic scope '+i}));else delete r.profile.day_flags;
 if(viaFile){const input=a.q('#fileLoadProfile');Object.defineProperty(input,'files',{configurable:true,value:[{name:'synthetic-composition.json',text:async()=>JSON.stringify(r)}]});input.dispatchEvent(new a.w.Event('change',{bubbles:true}));await a.tick();await a.tick();}
 else{a.q('#rulesJson').value=JSON.stringify(r);a.click('#btnApplyRules');await a.tick();}
 assert.equal(a.A.state.rules.profile.label,r.profile.label,'production import completed');
 assert.deepStrictEqual(savedRows(a),r.composition,'production import accepts exact saved references');return r;
}
function semantics(a){const p=new a.w.T.Problem(a.A.state.rules,a.A.state.month),asg=Object.fromEntries(p.slots.map(s=>[s.join(':'),{work:s[0]===7?N[1]:N[0],oc:[]}]));return {scope:clone(p.comp.flatMap(c=>p.slots.filter(s=>p.compOn(c,s)))),violations:a.w.T.check(p,asg).VC.filter(v=>v.code==='COMPOSITION_SHORT').length,penalty:a.w.T.penalty(p,asg).total};}
async function reload(a,fn){const saved=a.w.localStorage.getItem(key);assert(saved);const b=await makeApp(saved);try{await fn(b);assert.deepStrictEqual(b.errors,[]);}finally{b.w.close();}}
const projected=id=>id.replace(/\r\n?/g,'\n').replace(/\0/g,'\uFFFD');
for(const [kind,id]of Object.entries(ID).filter(([k])=>['cr','crlf','nul'].includes(k)))for(const state of ['hard','soft'])for(const active of [true,false])test(`${kind} ${state} ${active?'declared':'inactive'}: accepted scope survives unrelated edit, reads and reload`,async a=>{
 const r=await fixture(a,{id,state,active}),before=semantics(a),month=clone(a.A.state.month);
 assert.equal(a.q('[data-cdays]').value,'flag:'+projected(id),'actual HTML projection differs from raw ID');
 assert.deepStrictEqual(before,{scope:[[7,'night']],violations:state==='hard'?1:0,penalty:state==='soft'?100:0});
 editYears(a);a.A.readSettings();a.A.readSettings();r.doctors[0].years=12;
 assert.deepStrictEqual(savedRows(a),r.composition);assert.deepStrictEqual(semantics(a),before);assert.deepStrictEqual(clone(a.A.state.month),month);
 assert.deepStrictEqual(JSON.parse(a.w.localStorage.getItem(key)).rules.composition,r.composition);
 await reload(a,b=>{assert.deepStrictEqual(savedRows(b),r.composition);assert.deepStrictEqual(semantics(b),before);assert.deepStrictEqual(clone(b.A.state.month),month);});
});
for(const kind of ['lf','tab'])for(const state of ['hard','soft'])test(`${kind} ${state}: non-lossy control keeps source and semantics`,async a=>{const r=await fixture(a,{id:ID[kind],state}),before=semantics(a);editYears(a);a.A.readSettings();assert.deepStrictEqual(savedRows(a),r.composition);assert.deepStrictEqual(semantics(a),before);await reload(a,b=>{assert.deepStrictEqual(savedRows(b),r.composition);assert.deepStrictEqual(semantics(b),before);});});
for(const [kind,first,second]of [['CR/LF',ID.cr,ID.lf],['NUL/replacement',ID.nul,ID.replacement]])for(const state of ['hard','soft'])test(`${kind} ${state}: distinct same-value options remain independently selectable`,async a=>{
 const r=await fixture(a,{id:first,state,ids:[first,second]}),before=semantics(a),month=clone(a.A.state.month);
 const select=()=>a.q('[data-cdays]');assert.equal(select().options[3].value,select().options[4].value,'both values collide in real DOM');assert.equal(select().selectedIndex,3);
 editYears(a);assert.equal(a.A.state.rules.composition[0].days,'flag:'+first);assert.equal(select().selectedIndex,3);assert.deepStrictEqual(semantics(a),before);
 // A real choice is option identity, even when .value strings are identical.
 select().selectedIndex=4;select().dispatchEvent(new a.w.Event('change',{bubbles:true}));assert.equal(a.A.state.rules.composition[0].days,'flag:'+second);assert.equal(select().selectedIndex,4);
 const after=semantics(a);assert.deepStrictEqual(after,{scope:[[8,'night']],violations:0,penalty:0});a.A.readSettings();a.A.readSettings();assert.deepStrictEqual(semantics(a),after);
 assert.deepStrictEqual(clone(a.A.state.rules.composition[0].local_extra),r.composition[0].local_extra);assert.deepStrictEqual(clone(a.A.state.month),month);
 await reload(a,b=>{assert.equal(b.A.state.rules.composition[0].days,'flag:'+second);assert.deepStrictEqual(semantics(b),after);});
 select().selectedIndex=3;select().dispatchEvent(new a.w.Event('change',{bubbles:true}));assert.equal(a.A.state.rules.composition[0].days,'flag:'+first);assert.deepStrictEqual(semantics(a),before);
 a.A.undo();assert.equal(a.A.state.rules.composition[0].days,'flag:'+second);assert.deepStrictEqual(semantics(a),after);
});
for(const choice of ['all','weekdays','off_days','flag:'+ID.normal])test('explicit ordinary selection '+choice+' retains existing meaning',async a=>{
 const r=await fixture(a),month=clone(a.A.state.month);a.change('[data-cdays]',choice);
 if(choice==='all')delete r.composition[0].days;else r.composition[0].days=choice;
 assert.deepStrictEqual(savedRows(a),r.composition);assert.equal(semantics(a).scope.length,{all:30,weekdays:21,off_days:9,['flag:'+ID.normal]:1}[choice]);
 a.A.readSettings();assert.deepStrictEqual(savedRows(a),r.composition);assert.deepStrictEqual(clone(a.A.state.month),month);await reload(a,b=>assert.deepStrictEqual(savedRows(b),r.composition));
});
test('add/delete and duplicate rows retain raw scope plus their own metadata',async a=>{
 const row={shift:'night',days:'flag:'+ID.cr,min:1,qual:'trainer'};await fixture(a,{rows:[{...row,local_extra:{id:'first'}},{...row,local_extra:{id:'second'}}]});
 const original=savedRows(a);a.click('[data-act="compAdd"]');assert.deepStrictEqual(savedRows(a),[...original,{shift:'night',min:1}]);
 editYears(a);assert.deepStrictEqual(savedRows(a).slice(0,2),original);a.click('[data-ci="0"] [data-act="compDel"]');assert.deepStrictEqual(savedRows(a)[0],original[1]);
 a.click('[data-ci="1"] [data-act="compDel"]');assert.deepStrictEqual(savedRows(a),[original[1]]);a.A.readSettings();await reload(a,b=>assert.deepStrictEqual(savedRows(b),[original[1]]));
});
test('off/on retains inactive exact flag and metadata',async a=>{const r=await fixture(a,{active:false}),before=semantics(a);a.change('[data-ron="composition"]',false);assert.equal(a.q('[data-cdays]'),null);editYears(a);assert.deepStrictEqual(savedRows(a),r.composition);a.change('[data-ron="composition"]',true);a.A.readSettings();assert.deepStrictEqual(savedRows(a),r.composition);assert.deepStrictEqual(semantics(a),before);await reload(a,b=>assert.deepStrictEqual(savedRows(b),r.composition));});
test('non-flag unknown scope retains baseline all-days normalization',async a=>{await fixture(a,{rows:[{shift:'night',days:'synthetic.unknown',min:1}]});const before=semantics(a);assert.equal(a.q('[data-cdays]').value,'all');editYears(a);assert.equal(a.A.state.rules.composition[0].days,undefined);assert.deepStrictEqual(semantics(a),before);});
test('malformed object scope retains baseline all-days normalization',async a=>{await fixture(a,{rows:[{shift:'night',days:{},min:1}]});const before=semantics(a);editYears(a);assert.equal(a.A.state.rules.composition[0].days,undefined);assert.deepStrictEqual(semantics(a),before);});
test('profile-file import and roster-included export retain exact IDs',async a=>{const r=await fixture(a,{id:ID.nul,viaFile:true}),before=semantics(a);editYears(a);const exported=clone(a.A.profileForExport(true).rules);assert.deepStrictEqual(exported.composition,r.composition);assert.deepStrictEqual(exported.profile.day_flags,r.profile.day_flags);assert.deepStrictEqual(semantics(a),before);await reload(a,b=>{assert.deepStrictEqual(savedRows(b),r.composition);assert.deepStrictEqual(semantics(b),before);});});
(async()=>{assert.equal(cases.length,EXPECTED_CASES);for(const c of cases){const a=await makeApp();try{await c.fn(a);assert.deepStrictEqual(a.errors,[]);passed++;console.log('PASS '+c.name);}catch(e){failed++;console.error('FAIL '+c.name,e);}finally{a.w.close();}}console.log(`composition day projection: ${passed} passed, ${failed} failed, ${cases.length} total`);assert.equal(passed+failed,EXPECTED_CASES);finished=true;clearTimeout(watchdog);if(failed)process.exitCode=1;})().catch(e=>{console.error(e);process.exitCode=1;});

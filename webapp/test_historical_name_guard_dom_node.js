// Historical identity guard: actual markup, init, delegated settings events,
// Problem and localStorage. Fictional data only; jsdom supplies the DOM.
// No browser, layout, OS permissions or network test is claimed; no sockets are opened.
// Run: TOBAN_DOM_MODULE=/path/to/node_modules/jsdom node test_historical_name_guard_dom_node.js
const fs = require('fs'), path = require('path'), assert = require('assert');
// Verified with jsdom 26.1.0. Dependency lookup never downloads/install packages.
let JSDOM;
for (const name of [process.env.TOBAN_DOM_MODULE, 'jsdom', path.join(process.env.HOME || '', '.toban-test/node_modules/jsdom')].filter(Boolean)) {
  try { ({ JSDOM } = require(name)); break; } catch (e) { if (e.code !== 'MODULE_NOT_FOUND') throw e; }
}
if (!JSDOM) throw new Error('Historical-name DOM-adapter regression requires jsdom 26.1.0. Set TOBAN_DOM_MODULE to its installed module path. This test was NOT run.');
const N = ['Synthetic Trainer', 'Synthetic Colleague'], clone = x => JSON.parse(JSON.stringify(x));
const root = process.env.TOBAN_SOURCE_ROOT || __dirname;
const source = f => fs.readFileSync(path.join(root, 'src', f), 'utf8');
const scripts = ['i18n.js','rules-core.js','model.js', ...fs.readdirSync(path.join(root,'src/calendars')).filter(f=>f.endsWith('.js')).sort().map(f=>'calendars/'+f),
  'messages.js','solver.js','check.js','report.js','docxgen.js','plugins.js','merge.js', ...fs.readdirSync(path.join(root,'src/rules')).filter(f=>f.endsWith('.js')).sort().map(f=>'rules/'+f),
  'app-core.js','app-folder.js','app-month.js','app-input.js','app-settings.js','app-solve.js','app-main.js'];
const key = 'toban_state_v2:/synthetic/historical-name-guard.html';
const rawRules = {profile:{id:'synthetic-historical-name-guard',roles:[{id:'S',label:'Staff',refs:[]}],shifts:[{id:'day',on:'none'},{id:'night',on:'all'}]},doctors:N.map(name=>({name,team:'S',quota:15})),rule_states:{oncall:'off'},weights:{}};
const rawMonth = {year:2026,month:11,notes:'Synthetic historical-name guard'};
async function makeApp(saved, fixture=rawRules, defaults=fixture) {
  const dom = new JSDOM(source('index.html'), {url:'https://example.invalid/synthetic/historical-name-guard.html',runScripts:'outside-only'}), w=dom.window;
  await new Promise(resolve=>w.document.readyState==='complete'?resolve():w.addEventListener('load',resolve,{once:true}));
  const errors=[]; w.addEventListener('error',e=>{errors.push(e.error || e.message);e.preventDefault();});
  w.confirm=()=>true; w.alert=()=>{}; w.prompt=()=>null;
  w.T={DEFAULT_RULES:clone(defaults), SAMPLE_MONTH:clone(rawMonth), PROFILES:[], LANGS_DATA:[JSON.parse(fs.readFileSync(path.join(root,'lang/en.json'),'utf8'))]};
  for(const f of scripts) w.eval(source(f)+'\n//# sourceURL='+f);
  const A=w.T.app; A.restoreFolder=()=>{}; // Start-gate/OS-folder access is outside this DOM-adapter test.
  A.toast=()=>{};
  w.localStorage.setItem('toban.lang','en');
  w.localStorage.setItem(key,saved || JSON.stringify({rules:fixture,month:rawMonth,result:null,ui:{doctor:1}}));
  w.T.init();
  const q=s=>w.document.querySelector(s), click=s=>{assert(q(s),'Missing '+s);q(s).click();}, change=(s,v)=>{const el=typeof s==='string'?q(s):s;assert(el,'Missing '+s);if(el.type==='checkbox')el.checked=v;else el.value=v;el.dispatchEvent(new w.Event('change',{bubbles:true}));};
  const tick=()=>new Promise(r=>w.setTimeout(r,0));
  const enter=()=>{click('.tab[data-tab="settings"]');click('[data-setmode="build"]');};
  return {dom,w,A,q,click,change,tick,enter,errors};
}
const retired='Synthetic Retired';
const cases = [
 ...['weekend_charge','holiday_charge','work_balance'].map(k=>[k,m=>{m.history={[k]:{[retired]:0}};}]),
 ...['day','night'].flatMap(k=>[false,true].map(array=>[k+(array?' array':' string'),m=>{m.prev_month={last_days:[{date:31,[k]:array?[retired]:retired}]};}])),
 ...['day_oc','night_oc'].map(k=>[k,m=>{m.prev_month={last_days:[{date:31,[k]:[retired]}]};}]),
 ...['last_weekend_charge','prev_weekend_charge'].map(k=>[k,m=>{m.prev_month={[k]:retired};}])
];
const expectedTests=28;
let passed=0, completed=false;
const watchdog=setTimeout(()=>{console.error(`FAIL: historical-name regression did not finish (${passed}/${expectedTests})`);process.exit(1);},120000);
process.on('exit',()=>{if(!completed || passed!==expectedTests){console.error(`FAIL: incomplete historical-name regression (${passed}/${expectedTests})`);process.exitCode=1;}});
async function test(name,fn){await fn();passed++;console.log('ok '+name);}
async function fixture(seed=cases[0][1]) {
 const m={...clone(rawMonth),fixed:{night:{7:N[0]}},unavailable_night:{[N[0]]:[9]},local_synthetic:{protected:'keep'}};seed(m);
 const a=await makeApp(JSON.stringify({rules:rawRules,month:m,result:null,ui:{}}));a.enter();
 const normalizedHistory=clone(a.A.state.month.history), normalizedPrevious=clone(a.A.state.month.prev_month);
 seed(a.A.state.month); // Exercise retained current state, including OC records hidden by this fixture’s disabled OC rule.
 a.A.state.month.history={...normalizedHistory,...a.A.state.month.history};
 a.A.state.month.prev_month={...normalizedPrevious,...a.A.state.month.prev_month};
 a.notices=[];a.alerts=[];a.confirms=[];a.saves=0;
 a.A.toast=x=>a.notices.push(String(x));a.w.alert=x=>a.alerts.push(String(x));a.w.confirm=x=>{a.confirms.push(String(x));return true;};
 const save=a.A.save;a.A.save=()=>{a.saves++;return save();};
 a.A.pushUndo('prior valid edit');a.A.state.rules.weights.wish_night=123;await a.tick();
 a.A.renderSettings();
 return a;
}
const snap=a=>JSON.stringify(a.A.state), undoText=a=>a.q('#undoNote').textContent;
async function unchanged(a,fn) {
 const before=snap(a),undo=undoText(a),storage=a.w.localStorage.getItem(key),saves=a.saves;
 await fn();await a.tick();assert.equal(snap(a),before);assert.equal(undoText(a),undo);assert.equal(a.saves,saves);assert.equal(a.w.localStorage.getItem(key),storage);assert.deepStrictEqual(a.errors,[]);
}
(async()=>{
 for(const [label,seed] of cases) await test('reject rename: '+label,async()=>{
  const a=await fixture(seed);
  try{
   a.q('#doctorTable tr[data-i="1"] [data-f="years"]').value='99';
   await unchanged(a,()=>a.change('#doctorTable tr[data-i="0"] [data-f="name"]',retired));
   assert.equal(a.q('#doctorTable tr[data-i="1"] [data-f="years"]').value,'99');
   assert.equal(a.q('#doctorTable tr[data-i="0"] [data-f="name"]').value,N[0]);
   await unchanged(a,()=>assert.equal(a.A.renameDoctor(N[0],retired),false));
   assert(a.notices.every(x=>x.includes(retired)));a.A.undo();assert.notEqual(a.A.state.rules.weights.wish_night,123);
  }finally{a.dom.window.close();}
 });
 await test('own-property history detection excludes inherited names',async()=>{
  const a=await fixture(m=>{m.history={weekend_charge:{}};});try{
   a.A.state.month.history.weekend_charge=Object.create({[retired]:4});
   assert.equal(a.A.renameDoctor(N[0],retired),true);
  }finally{a.dom.window.close();}
 });
 await test('history outside the current month does not reserve a name',async()=>{
  const a=await fixture(m=>{m.history={};m.prev_month={};});try{
   a.A.state.base={history:{weekend_charge:{[retired]:9}},prev_month:{last_weekend_charge:retired}};
   assert.equal(a.A.renameDoctor(N[0],retired),true);
  }finally{a.dom.window.close();}
 });
 await test('profile with omitted roster preserves roster despite retained history',async()=>{
  const a=await fixture();try{
   const incoming={profile:clone(a.A.state.rules.profile),weights:{wish_night:77}};
   const el=a.q('#fileLoadProfile');Object.defineProperty(el,'files',{value:[{name:'synthetic.json',text:async()=>JSON.stringify(incoming)}]});el.dispatchEvent(new a.w.Event('change',{bubbles:true}));await a.tick();await a.tick();
   assert.deepStrictEqual(clone(a.A.names()),N);assert.equal(a.alerts.length,0);assert.equal(a.A.state.rules.weights.wish_night,77);assert.equal(a.A.state.month.history.weekend_charge[retired],0);
  }finally{a.dom.window.close();}
 });
 await test('ordinary unique rename migrates source and retains retired history',async()=>{
  const a=await fixture(m=>{m.history={weekend_charge:{[N[0]]:2,[retired]:9}};});try{
   a.change('#doctorTable tr[data-i="0"] [data-f="name"]','Synthetic Renamed');
   assert.deepStrictEqual(clone(a.A.state.month.history.weekend_charge),{[retired]:9,'Synthetic Renamed':2});
   assert.equal(a.A.state.rules.doctors[0].name,'Synthetic Renamed');
  }finally{a.dom.window.close();}
 });
 for(const response of [null,'  ',N[0],retired]) await test('canceled or invalid Add is atomic: '+String(response),async()=>{
  const a=await fixture();try{
   a.q('#doctorTable tr[data-i="1"] [data-f="years"]').value='99';a.w.prompt=()=>response;a.w.confirm=()=>false;
   await unchanged(a,()=>a.click('#doctorTable [data-act="add"]'));
   assert.equal(a.q('#doctorTable tr[data-i="1"] [data-f="years"]').value,'99');
  }finally{a.dom.window.close();}
 });
 await test('same-person Add keeps history, uses defaults, survives save/reload and Undo',async()=>{
  const a=await fixture(m=>{m.history={weekend_charge:{[retired]:9}};m.prev_month={last_days:[{date:31,night:retired}]};});try{
   a.A.state.rules.doctors.push({name:retired,team:'S',years:44,quota:12});a.A.state.rules.friday_night_min={[retired]:2};
   a.A.state.month.unavailable_night[retired]=[12];a.A.renderSettings();a.click('#doctorTable tr[data-i="2"] [data-act="del"]');await a.tick();a.confirms=[];
   const before=clone(a.A.state.month),count=a.A.names().length;a.w.prompt=()=>retired;
   a.click('#doctorTable [data-act="add"]');await a.tick();assert.equal(a.confirms.length,1);assert(/defaults/.test(a.confirms[0]));
   const d=a.A.state.rules.doctors.find(d=>d.name===retired);assert(d);assert.equal(d.quota,5);assert.equal(d.years,0);assert.equal(a.A.names().length,count+1);
   assert.deepStrictEqual(clone(a.A.state.month.history),before.history);assert.deepStrictEqual(clone(a.A.state.month.prev_month),before.prev_month);
   assert(!Object.hasOwn(a.A.state.rules.friday_night_min,retired));assert(!a.A.state.month.unavailable_night[retired]?.length);assert.equal(a.A.state.month.fixed.night[7],N[0]);
   const b=await makeApp(a.w.localStorage.getItem(key));assert(b.A.names().includes(retired));assert.deepStrictEqual(clone(b.A.state.month.history),before.history);b.dom.window.close();
   a.A.undo();assert(!a.A.names().includes(retired));assert.deepStrictEqual(clone(a.A.state.month.history),before.history);
  }finally{a.dom.window.close();}
 });
 await test('fresh Add asks before creating and creates requested name directly',async()=>{
  const a=await fixture();try{
   const count=a.A.names().length;a.w.prompt=()=>{assert.equal(a.A.names().length,count);assert.equal(a.saves,0);return '  Synthetic New  ';};
   a.click('#doctorTable [data-act="add"]');assert(a.A.names().includes('Synthetic New'));assert.equal(a.confirms.length,0);
  }finally{a.dom.window.close();}
 });
 for(const route of ['json','profile','bundled']) await test('atomic historical import and explicit Add retry: '+route,async()=>{
  const a=await fixture();try{
   const incoming=clone(a.A.state.rules);incoming.profile.id='synthetic-import-other';incoming.doctors.push({name:retired,team:'S',quota:12},{name:'Synthetic Extra',team:'S'});
   const apply=async()=>{
    if(route==='json'){a.q('#rulesJson').value=JSON.stringify(incoming);a.click('#btnApplyRules');}
    if(route==='profile'){const el=a.q('#fileLoadProfile');Object.defineProperty(el,'files',{configurable:true,value:[{name:'synthetic.json',text:async()=>JSON.stringify(incoming)}]});el.dispatchEvent(new a.w.Event('change',{bubbles:true}));}
    if(route==='bundled'){a.w.T.PROFILES=[incoming];await a.A.loadProfileById(incoming.profile.id);}
    await a.tick();await a.tick();
   };
   const pending=a.q('#doctorTable tr[data-i="1"] [data-f="years"]');pending.value='99';
   const pendingRulesJson='Synthetic pending JSON draft';if(route!=='json')a.q('#rulesJson').value=pendingRulesJson;
   await unchanged(a,apply);assert.strictEqual(a.q('#doctorTable tr[data-i="1"] [data-f="years"]'),pending);assert.equal(pending.value,'99');
   assert.equal(a.q('#rulesJson').value,route==='json'?JSON.stringify(incoming):pendingRulesJson);
   assert(a.alerts.some(x=>x.includes(retired)));assert(!a.A.names().includes('Synthetic Extra'));
   a.w.prompt=()=>retired;a.click('#doctorTable [data-act="add"]');await a.tick();await apply();
   assert(a.A.names().includes('Synthetic Extra'));assert.equal(a.A.state.rules.doctors.find(d=>d.name===retired).quota,12);assert.equal(a.A.state.month.history.weekend_charge[retired],0);
  }finally{a.dom.window.close();}
 });
 for(const historical of [false,true]) await test('Add refuses pending name-collision edits before dialogs: '+historical,async()=>{
  const a=await fixture();try{
   const third='Synthetic Third',suffix=N[1]+' 2';a.A.state.rules.doctors.push({name:third,team:'S'});if(historical)a.A.state.month.history.weekend_charge[suffix]=9;a.A.renderSettings();
   [N[1],third,N[1]].forEach((n,i)=>{a.q(`#doctorTable tr[data-i="${i}"] [data-f="name"]`).value=n;});
   const years=a.q('#doctorTable tr[data-i="0"] [data-f="years"]');years.value='99';
   let dialogs=0;a.w.prompt=()=>{dialogs++;return suffix;};a.w.confirm=()=>{dialogs++;return true;};
   await unchanged(a,()=>a.click('#doctorTable [data-act="add"]'));
   assert.equal(dialogs,0);assert.equal(years.value,'99');assert.deepStrictEqual([0,1,2].map(i=>a.q(`#doctorTable tr[data-i="${i}"] [data-f="name"]`).value),[N[1],third,N[1]]);assert.equal(a.A.names().length,3);
  }finally{a.dom.window.close();}
 });
 await test('generated collision suffix cannot claim historical identity or consume Undo',async()=>{
  const a=await fixture();try{
   const third='Synthetic Third',suffix=N[1]+' 2';a.A.state.rules.doctors.push({name:third,team:'S'});a.A.state.month.history.weekend_charge[suffix]=9;a.A.renderSettings();
   [N[1],third,N[1]].forEach((n,i)=>{a.q(`#doctorTable tr[data-i="${i}"] [data-f="name"]`).value=n;});
   const years=a.q('#doctorTable tr[data-i="0"] [data-f="years"]');years.value='99';
   await unchanged(a,()=>assert.equal(a.A.readSettings('Synthetic pending rename'),false));
   assert.equal(years.value,'99');assert.equal(a.notices.length,1);assert(a.notices[0].includes(suffix));assert(!/plug-in/.test(a.notices[0]));
  }finally{a.dom.window.close();}
 });
 await test('whole-month JSON restore ignores outgoing historical-name collisions',async()=>{
  const a=await fixture();try{
   const incomingRules=clone(rawRules);incomingRules.doctors.push({name:retired,team:'S',quota:8});
   const payload=JSON.stringify({rules:incomingRules,month:{year:2026,month:11,notes:'Synthetic restored payload',history:{weekend_charge:{[retired]:7}},fixed:{night:{8:retired}}},result:null});
   a.A.applyLoaded(JSON.parse(payload),'Synthetic restored payload',{fromFolder:false});
   assert.equal(a.alerts.length,0);assert(a.A.names().includes(retired));assert.equal(a.A.state.month.history.weekend_charge[retired],7);assert.equal(a.A.state.month.notes,'Synthetic restored payload');assert.equal(a.A.state.month.fixed.night[8],retired);assert(a.q('#btnUndo').disabled);assert.deepStrictEqual(a.errors,[]);
  }finally{a.dom.window.close();}
 });
 assert.equal(passed,expectedTests);completed=true;clearTimeout(watchdog);
 console.log(`${passed} historical-name guards passed`);
})().catch(e=>{clearTimeout(watchdog);console.error(e);process.exitCode=1;});

// Current-month historical cleanup: actual markup, init, delegated settings events,
// Problem and localStorage. Fictional data only; jsdom supplies the DOM.
// No browser, layout, OS permissions or network test is claimed; no sockets are opened.
// Run: TOBAN_DOM_MODULE=/path/to/node_modules/jsdom node test_history_cleanup_dom_node.js
const fs = require('fs'), path = require('path'), assert = require('assert');
// Verified with jsdom 26.1.0. Dependency lookup never downloads/install packages.
let JSDOM;
for (const name of [process.env.TOBAN_DOM_MODULE, 'jsdom', path.join(process.env.HOME || '', '.toban-test/node_modules/jsdom')].filter(Boolean)) {
  try { ({ JSDOM } = require(name)); break; } catch (e) { if (e.code !== 'MODULE_NOT_FOUND') throw e; }
}
if (!JSDOM) throw new Error('History-cleanup DOM-adapter regression requires jsdom 26.1.0. Set TOBAN_DOM_MODULE to its installed module path. This test was NOT run.');
const N = ['Synthetic Trainer', 'Synthetic Colleague'], clone = x => JSON.parse(JSON.stringify(x));
const root = process.env.TOBAN_SOURCE_ROOT || __dirname;
const source = f => fs.readFileSync(path.join(root, 'src', f), 'utf8');
const scripts = ['i18n.js','rules-core.js','model.js', ...fs.readdirSync(path.join(root,'src/calendars')).filter(f=>f.endsWith('.js')).sort().map(f=>'calendars/'+f),
  'messages.js','solver.js','check.js','report.js','docxgen.js','plugins.js','merge.js', ...fs.readdirSync(path.join(root,'src/rules')).filter(f=>f.endsWith('.js')).sort().map(f=>'rules/'+f),
  'app-core.js','app-folder.js','app-month.js','app-input.js','app-settings.js','app-solve.js','app-main.js'];
const key = 'toban_state_v2:/synthetic/history-cleanup.html';
const rawRules = {profile:{id:'synthetic-history-cleanup',roles:[{id:'S',label:'Staff',refs:[]}],shifts:[{id:'day',on:'none'},{id:'night',on:'all'}]},doctors:N.map(name=>({name,team:'S',quota:15})),rule_states:{oncall:'off'},weights:{}};
const rawMonth = {year:2026,month:11,notes:'Synthetic history cleanup'};
async function makeApp(saved, fixture=rawRules, defaults=fixture) {
  const dom = new JSDOM(source('index.html'), {url:'https://example.invalid/synthetic/history-cleanup.html',runScripts:'outside-only'}), w=dom.window;
  await new Promise(resolve=>w.document.readyState==='complete'?resolve():w.addEventListener('load',resolve,{once:true}));
  const errors=[]; w.addEventListener('error',e=>{errors.push(e.error || e.message);e.preventDefault();});
  w.confirm=()=>true; w.alert=()=>{}; w.prompt=()=>null;
  w.T={DEFAULT_RULES:clone(defaults), SAMPLE_MONTH:clone(rawMonth), PROFILES:[], LANGS_DATA:['en','ja'].map(code=>JSON.parse(fs.readFileSync(path.join(root,'lang',code+'.json'),'utf8')))};
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
const retired='Synthetic Retired', other='Synthetic Other Retired';
const expectedTests=91;
let passed=0, completed=false;
const watchdog=setTimeout(()=>{console.error(`FAIL: history-cleanup regression did not finish (${passed})`);process.exit(1);},120000);
process.on('exit',()=>{if(!completed){console.error(`FAIL: incomplete history-cleanup regression (${passed})`);process.exitCode=1;}});
async function test(name,fn){await fn();passed++;console.log('ok '+name);}
async function fixture(seed=()=>{}, name=retired) {
 const a=await makeApp();a.click('.tab[data-tab="settings"]');a.click('[data-setmode="daily"]');
 const m=a.A.state.month;m.history={weekend_charge:{[name]:0,[other]:7,[N[0]]:3},holiday_charge:{},work_balance:{}};m.prev_month={last_days:[],last_weekend_charge:null,prev_weekend_charge:null};
 m.local_synthetic={protected:'keep'};seed(m,a);
 a.notices=[];a.confirms=[];a.saves=0;a.A.toast=x=>a.notices.push(String(x));a.w.confirm=x=>{a.confirms.push(String(x));return true;};
 a.A.pushUndo('prior valid edit');a.A.state.rules.weights.wish_night=123;await a.tick();a.A.save();a.A.renderSettings();
 const save=a.A.save;a.A.save=()=>{a.saves++;return save();};
 a.open=async()=>{a.q('#historyCleanup').open=true;await a.tick();};
 a.options=()=>[...a.w.document.querySelectorAll('#historyCleanup input[name="historyCleanupPerson"]')].map(el=>el.parentNode.textContent.trim());
 a.select=who=>{const el=[...a.w.document.querySelectorAll('#historyCleanup input[name="historyCleanupPerson"]')].find(el=>el.parentNode.textContent.trim()===who);assert(el,'missing candidate '+who);el.checked=true;el.dispatchEvent(new a.w.Event('change',{bubbles:true}));};
 a.remove=async(who=name)=>{a.select(who);a.click('#btnHistoryCleanup');await a.tick();await a.tick();};
 return a;
}
const snap=a=>JSON.stringify(a.A.state), undoText=a=>a.q('#undoNote').textContent;
async function unchanged(a,fn) {const before=snap(a),undo=undoText(a),storage=a.w.localStorage.getItem(key),saves=a.saves;await fn();await a.tick();assert.equal(snap(a),before);assert.equal(undoText(a),undo);assert.equal(a.saves,saves);assert.equal(a.w.localStorage.getItem(key),storage);assert.deepStrictEqual(a.errors,[]);}
const allReferences=(m,name=retired)=>{m.history={weekend_charge:{[name]:0,[other]:7},holiday_charge:{[name]:4,[other]:8},work_balance:{[name]:-2,[other]:3},custom:{[name]:'unknown history metadata'}};m.prev_month={last_days:[{date:30,day:[name,other,name],day_oc:[other,name],night:name,night_oc:[name],metadata:{[name]:'keep'},custom:'keep row'},{date:31,day:other,night:[name],night_oc:[other]}],last_weekend_charge:name,prev_weekend_charge:name,custom:{[name]:'keep'}};};
(async()=>{
 await test('collapsed sibling, zero-valued records, single unselected choice, read-only open/select',async()=>{const a=await fixture();try{
  const panel=a.q('#historyCleanup');assert.equal(panel.open,false);assert.equal(a.q('#doctorTable').contains(panel),false);assert.equal(a.q('#historyCleanupBody').textContent,'');
  await unchanged(a,a.open);assert(a.options().includes(retired));assert(!a.q('#historyCleanup input:checked'));assert(a.q('#btnHistoryCleanup').disabled);
  assert(a.q('#historyCleanupBody').textContent.includes('2026'));assert(a.q('#historyCleanupBody').textContent.includes('11'));assert(a.q('#historyCleanupBody').textContent.includes('): 0'));
  await unchanged(a,()=>a.select(retired));assert(!a.q('#btnHistoryCleanup').disabled);a.select(other);assert.equal(a.w.document.querySelectorAll('#historyCleanup input:checked').length,1);
  panel.open=false;await a.tick();panel.open=true;await a.tick();assert(!a.q('#historyCleanup input:checked'));
 }finally{a.dom.window.close();}});
 const blockers=[
  ...['duty_days','regular_duties','unavailable_night','targets','count_min','count_max'].flatMap(k=>[0,'',[],{},'invalid'].map(v=>[k+' '+JSON.stringify(v),m=>{(m[k]||={})[retired]=v;}])),
  ...['night_on','day_on'].map(k=>['wishes.'+k,m=>{m.wishes[k]={[retired]:[]};}]),
  ['wishes.weekend_dayshift',m=>{m.wishes.weekend_dayshift=[retired];}],
  ...['unavailable_other','avoid','confirmed_pm_external_night'].map(k=>[k,m=>{m[k]=[{name:retired,day:5}];}]),
  ...['day','night','weekend_charge','day_oc','night_oc'].flatMap(k=>[false,true].map(array=>['fixed.'+k+(array?' array':' scalar'),m=>{m.fixed[k]={32:array?[retired]:retired};}])),
  ['fixed_tags',m=>{m.fixed_tags={['32:night|'+retired]:'keep'};}],
  ['person_days empty',m=>{m.person_days={'local.custom':{[retired]:{}}};}],
  ['local_ key',m=>{m.local_custom={deep:{[retired]:0}};}],
  ['local. value',m=>{m['local.custom']={deep:[{who:retired}]};}],
 ];
 for(const [label,seed] of blockers) await test('exclude current input: '+label,async()=>{const a=await fixture(seed);try{await unchanged(a,a.open);assert(!a.options().includes(retired));assert(a.options().includes(other));}finally{a.dom.window.close();}});
 for(const duty of ['', 'never','fixed_only','no_unless_needed']) await test('exclude entire roster regardless of duty '+duty,async()=>{const a=await fixture((m,a)=>{a.A.state.rules.doctors.push({name:retired,team:'S',duty});});try{await a.open();assert(!a.options().includes(retired));}finally{a.dom.window.close();}});
 await test('cancel preserves inputs, all Undo, storage, pending DOM values',async()=>{const a=await fixture(m=>allReferences(m));try{await a.open();const years=a.q('#doctorTable tr[data-i="0"] [data-f="years"]');years.value='99';a.w.confirm=()=>false;await unchanged(a,()=>a.remove());assert.equal(years.value,'99');a.A.undo();assert.notEqual(a.A.state.rules.weights.wish_night,123);}finally{a.dom.window.close();}});
 await test('pending uncommitted roster name blocks before confirmation',async()=>{const a=await fixture();try{await a.open();const el=a.q('#doctorTable tr[data-i="0"] [data-f="name"]');el.value=retired;await unchanged(a,()=>a.remove());assert.equal(a.confirms.length,0);assert.equal(el.value,retired);}finally{a.dom.window.close();}});
 const staleChanges=[
  ['same month new object',a=>{a.A.state.month=clone(a.A.state.month);}],
  ['new month',a=>{a.A.state.month.month=12;}],
  ['same rules new object',a=>{a.A.state.rules=clone(a.A.state.rules);}],
  ['new facility',a=>{a.A.state.rules.profile.id='changed-synthetic';}],
  ['new roster member',a=>{a.A.state.rules.doctors.push({name:retired,team:'S'});}],
  ['new current input',a=>{a.A.state.month.count_min[retired]=0;}],
  ['new prior reference',a=>{a.A.state.month.prev_month.last_weekend_charge=retired;}],
  ['changed history count',a=>{a.A.state.month.history.weekend_charge[retired]=4;}],
  ['changed folder',a=>{a.A.dirGen++;}],
  ['pending name',a=>{a.q('#doctorTable tr[data-i="0"] [data-f="name"]').value=retired;}],
  ['closed panel',a=>{a.q('#historyCleanup').open=false;}],
  ['different selection',a=>{a.select(other);}]
 ];
 for(const [label,change] of staleChanges) await test('revalidate immediately after confirm: '+label,async()=>{const a=await fixture();try{await a.open();a.select(retired);let after,undo,storage; a.w.confirm=()=>{change(a);after=snap(a);undo=undoText(a);storage=a.w.localStorage.getItem(key);return true;};a.click('#btnHistoryCleanup');await a.tick();await a.tick();assert.equal(snap(a),after);assert.equal(undoText(a),undo);assert.equal(a.w.localStorage.getItem(key),storage);assert.equal(a.saves,0);assert(a.notices.length);assert.deepStrictEqual(a.errors,[]);}finally{a.dom.window.close();}});
 await test('stale preview blocks before confirm and refresh remains unselected',async()=>{const a=await fixture();try{await a.open();a.select(retired);a.A.state.month.notes='changed';await unchanged(a,async()=>{a.click('#btnHistoryCleanup');await a.tick();});assert.equal(a.confirms.length,0);a.q('#historyCleanup').open=false;await a.tick();await a.open();assert(!a.q('#historyCleanup input:checked'));}finally{a.dom.window.close();}});
 for(const flag of ['solving','switching']) await test('busy '+flag+' blocks without clearing Undo',async()=>{const a=await fixture();try{await a.open();a.A[flag]=1;await unchanged(a,()=>a.remove());assert.equal(a.confirms.length,0);a.A[flag]=0;}finally{a.dom.window.close();}});
 await test('delete exact known references, retain structure, inputs, other records and saved past-month baselines',async()=>{const a=await fixture(m=>allReferences(m));try{
  a.A.state.base={year:2026,month:10,history:{weekend_charge:{[retired]:9}}};a.A.state.baseRules=clone(a.A.state.rules);const baseline=JSON.stringify(a.A.state.base),rules=JSON.stringify(a.A.state.rules);
  a.A.state.result={asg:{},input_sig:a.A.inputSig(),status:'Synthetic'};const result=JSON.stringify(a.A.state.result);await a.open();const years=a.q('#doctorTable tr[data-i="0"] [data-f="years"]');years.value='99';
  const expected=clone(a.A.state.month);for(const k of ['weekend_charge','holiday_charge','work_balance'])delete expected.history[k][retired];
  expected.prev_month.last_days[0].day=[other];expected.prev_month.last_days[0].day_oc=[other];expected.prev_month.last_days[0].night=null;expected.prev_month.last_days[0].night_oc=[];expected.prev_month.last_days[1].night=[];expected.prev_month.last_weekend_charge=null;expected.prev_month.prev_weekend_charge=null;
  await a.remove();assert.deepStrictEqual(clone(a.A.state.month),expected);assert.equal(JSON.stringify(a.A.state.rules),rules);assert.equal(JSON.stringify(a.A.state.result),result);assert.notEqual(a.A.state.result.input_sig,a.A.inputSig());assert.equal(JSON.stringify(a.A.state.base),baseline);assert.equal(years.value,'99');assert(a.q('#btnUndo').disabled);assert.equal(a.saves,1);assert(!a.options().includes(retired));assert(!a.q('#historyCleanup input:checked'));
  const confirm=a.confirms[0];for(const ref of ['history.weekend_charge','history.holiday_charge','history.work_balance','prev_month.last_days[0].day','prev_month.last_days[0].night','prev_month.last_days[0].day_oc','prev_month.last_days[0].night_oc','prev_month.last_weekend_charge','prev_month.prev_weekend_charge'])assert(confirm.includes(ref),ref);assert(confirm.includes(retired));assert(confirm.includes('2026'));assert(confirm.includes('11'));assert(/previous edits/.test(confirm));
  a.A.undo();assert.deepStrictEqual(clone(a.A.state.month),expected);assert.equal(a.A.state.rules.weights.wish_night,123);
  a.A.pushUndo('subsequent edit');a.A.state.rules.weights.wish_night=321;await a.tick();a.A.undo();assert.equal(a.A.state.rules.weights.wish_night,123);assert.deepStrictEqual(clone(a.A.state.month.history),expected.history);assert.deepStrictEqual(clone(a.A.state.month.prev_month),expected.prev_month);
  const b=await makeApp(a.w.localStorage.getItem(key));try{assert.deepStrictEqual(clone(b.A.state.month.history),expected.history);assert.deepStrictEqual(clone(b.A.state.month.prev_month),expected.prev_month);}finally{b.dom.window.close();}
 }finally{a.dom.window.close();}});
 for(const name of ['day','constructor','__proto__','Synthetic: A|B"><img data-injected="yes">&']) await test('exact name and escaped markup: '+name,async()=>{const a=await fixture((m)=>{m.prev_month.last_days=[{date:31,day:[name,other],night:name,night_oc:[other]}];},name);try{await a.open();assert(a.options().includes(name));assert(!a.q('[data-injected]'));await a.remove(name);assert(!Object.hasOwn(a.A.state.month.history.weekend_charge,name));assert.deepStrictEqual(clone(a.A.state.month.prev_month.last_days[0]),{date:31,day:[other],night:null,night_oc:[other]});assert.deepStrictEqual(a.errors,[]);}finally{a.dom.window.close();}});
 for(const oc of [false,true]) await test('retained OC-only rows and metadata survive unrelated edit/save/reload, OC '+oc,async()=>{const a=await fixture((m,a)=>{allReferences(m);m.prev_month.last_days[0]={...m.prev_month.last_days[0],...JSON.parse('{"__proto__":{"keep":"custom metadata"}}')};a.A.state.rules.rule_states.oncall=oc?'hard':'off';});try{await a.open();await a.remove();const expected=clone(a.A.state.month.prev_month);
  a.click('.tab[data-tab="input"]');a.A.renderSettingsMonth();const notes=a.q('#monthSettings [data-path="notes"]');a.change(notes,'Unrelated synthetic note');await a.tick();a.A.readSettingsMonth();a.A.save();assert.deepStrictEqual(clone(a.A.state.month.prev_month),expected);
  const b=await makeApp(a.w.localStorage.getItem(key));try{assert.deepStrictEqual(clone(b.A.state.month.prev_month),expected);}finally{b.dom.window.close();}
 }finally{a.dom.window.close();}});
 await test('intentional cleanup frees name while remaining historical names stay guarded',async()=>{const a=await fixture();try{await a.open();await a.remove();assert.equal(a.A.renameDoctor(N[0],other),false);assert.equal(a.A.renameDoctor(N[0],retired),true);}finally{a.dom.window.close();}});
 await test('reintroduced previous history is eligible again and has protection',async()=>{const a=await fixture();try{await a.open();await a.remove();a.A.state.month.history.weekend_charge[retired]=9;assert.equal(a.A.renameDoctor(N[0],retired),false);a.A.renderSettings();assert(a.options().includes(retired));}finally{a.dom.window.close();}});
 await test('repeated deletion click commits only once',async()=>{const a=await fixture();try{await a.open();a.select(retired);const button=a.q('#btnHistoryCleanup');button.click();button.click();await a.tick();await a.tick();assert.equal(a.saves,1);assert.equal(a.confirms.length,1);assert(a.q('#btnUndo').disabled);}finally{a.dom.window.close();}});
 await test('staging failure preserves data and all prior Undo',async()=>{const a=await fixture(m=>{m.prev_month.last_days=[{date:31,night:[retired,other]}];});try{await a.open();const values=a.A.state.month.prev_month.last_days[0].night;a.w.confirm=()=>{values.filter=()=>{throw new Error('Synthetic staging failure');};return true;};await unchanged(a,()=>a.remove());assert(a.notices.some(x=>/failed/.test(x)));assert(!a.q('#btnUndo').disabled);}finally{a.dom.window.close();}});
 await test('context changed while waiting for a save blocks before confirmation',async()=>{const a=await fixture();let release;try{await a.open();const waiting=a.A.serialized(()=>new Promise(r=>{release=r;}));await a.tick();a.select(retired);a.click('#btnHistoryCleanup');await a.tick();a.A.state.month.notes='Changed during synthetic pending save';const before=snap(a),undo=undoText(a);release();await waiting;await a.tick();await a.tick();assert.equal(snap(a),before);assert.equal(undoText(a),undo);assert.equal(a.saves,0);assert.equal(a.confirms.length,0);}finally{if(release)release();a.dom.window.close();}});
 await test('deletion preserves unrelated in-memory values without JSON normalization',async()=>{const a=await fixture(m=>{m.local_synthetic={unrelated:{invalid:NaN,missing:undefined,empty:[]}};});try{const before=a.A.state.month.local_synthetic;await a.open();await a.remove();assert.strictEqual(a.A.state.month.local_synthetic,before);assert(Number.isNaN(before.unrelated.invalid));assert(Object.hasOwn(before.unrelated,'missing'));}finally{a.dom.window.close();}});
 await test('no eligible staff gives empty state and no deletion control',async()=>{const a=await fixture(m=>{m.history={};m.prev_month={last_days:[]};});try{await unchanged(a,a.open);assert.deepStrictEqual(a.options(),[]);assert(!a.q('#btnHistoryCleanup'));assert(/No staff/.test(a.q('#historyCleanupBody').textContent));}finally{a.dom.window.close();}});
 await test('Japanese warning explicitly covers all prior edits',async()=>{const a=await fixture();try{a.w.T.setLang('ja');a.A.renderSettings();await a.open();assert(a.q('#historyCleanupBody').textContent.includes('この操作より前の編集にも『元に戻す』で戻れなくなります。'));a.w.confirm=text=>{assert(text.includes('この削除は取り消せません。'));assert(text.includes('この操作より前の編集にも『元に戻す』で戻れなくなります。'));return false;};await unchanged(a,()=>a.remove());}finally{a.dom.window.close();}});
 for(const ocOn of [false,true]) for(const work of ['day','night']) await test('explicit worker clear and replacement cannot revive previous OC: '+work+' '+ocOn,async()=>{const oc=work+'_oc',a=await fixture((m,a)=>{m.prev_month.last_days=[{date:31,[work]:N[0],[oc]:[other]}];a.A.state.rules.rule_states.oncall=ocOn?'hard':'off';});try{
  a.click('.tab[data-tab="input"]');a.A.renderSettingsMonth();const input=a.q('#monthSettings tr[data-ld="0"] [data-f="'+work+'"]');a.change(input,'');
  if(ocOn){const ocInput=a.q('#monthSettings tr[data-ld="0"] [data-f="'+oc+'"]');assert.equal(ocInput.value,'');assert.equal(ocInput.dataset.prevNames,'[]');assert.equal(ocInput.dataset.shown,'');}
  for(let i=0;i<3;i++){a.A.readSettingsMonth();assert.deepStrictEqual(clone(a.A.state.month.prev_month.last_days),[{date:31}]);}
  a.change(input,N[1]);const expected=[{date:31,[work]:N[1],[oc]:[]}];for(let i=0;i<3;i++){a.A.readSettingsMonth();assert.deepStrictEqual(clone(a.A.state.month.prev_month.last_days),expected);}
  a.A.renderSettingsMonth();a.A.readSettingsMonth();assert.deepStrictEqual(clone(a.A.state.month.prev_month.last_days),expected);a.A.save();const b=await makeApp(a.w.localStorage.getItem(key));try{assert.deepStrictEqual(clone(b.A.state.month.prev_month.last_days),expected);}finally{b.dom.window.close();}
 }finally{a.dom.window.close();}});
 assert.equal(passed,expectedTests);completed=true;clearTimeout(watchdog);console.log(`${passed} history-cleanup regressions passed`);
})().catch(e=>{clearTimeout(watchdog);console.error(e);process.exitCode=1;});

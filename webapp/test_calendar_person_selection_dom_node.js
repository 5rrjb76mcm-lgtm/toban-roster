// Production DOM-adapter regression: real index.html, all app source, init, navigation,
// rendering, delegated events, Undo and persistence. jsdom supplies the DOM only.
// No browser, layout, OS permissions or network test is claimed; no sockets are opened.
// Run: TOBAN_DOM_MODULE=/path/to/node_modules/jsdom node test_calendar_person_selection_dom_node.js
const fs = require('fs'), path = require('path'), assert = require('assert');
// Verified with jsdom 26.1.0. Dependency lookup never downloads/install packages.
let JSDOM;
for (const name of [process.env.TOBAN_DOM_MODULE, 'jsdom', path.join(process.env.HOME || '', '.toban-test/node_modules/jsdom')].filter(Boolean)) {
  try { ({ JSDOM } = require(name)); break; } catch (e) { if (e.code !== 'MODULE_NOT_FOUND') throw e; }
}
if (!JSDOM) throw new Error('Calendar DOM-adapter regression requires jsdom 26.1.0. Set TOBAN_DOM_MODULE to its installed module path. This test was NOT run.');
const N = ['Synthetic Alpha', 'Synthetic Beta'], clone = x => JSON.parse(JSON.stringify(x));
const source = f => fs.readFileSync(path.join(__dirname, 'src', f), 'utf8');
const scripts = ['i18n.js','rules-core.js','model.js', ...fs.readdirSync(path.join(__dirname,'src/calendars')).filter(f=>f.endsWith('.js')).sort().map(f=>'calendars/'+f),
  'messages.js','solver.js','check.js','report.js','docxgen.js','plugins.js','merge.js', ...fs.readdirSync(path.join(__dirname,'src/rules')).filter(f=>f.endsWith('.js')).sort().map(f=>'rules/'+f),
  'app-core.js','app-folder.js','app-month.js','app-input.js','app-settings.js','app-solve.js','app-main.js'];
const key = 'toban_state_v2:/synthetic/calendar-selection.html';
const rawRules = {profile:{id:'synthetic-selection',roles:[{id:'S',label:'Staff',refs:[]}],shifts:[{id:'day',on:'all'},{id:'night',on:'all'}]},doctors:N.map(name=>({name,team:'S',quota:20})),rule_states:{},weights:{}};
const rawMonth = {year:2026,month:11,next_first_day_in_calendar:true,unavailable_night:{[N[0]]:[5],[N[1]]:[9]},wishes:{night_on:{[N[1]]:[8]}},duty_days:{[N[1]]:{7:{am:'ward'}}},notes:'Synthetic note'};
async function makeApp(saved) {
  const dom = new JSDOM(source('index.html'), {url:'https://example.invalid/synthetic/calendar-selection.html',runScripts:'outside-only'}), w=dom.window;
  await new Promise(resolve=>w.document.readyState==='complete'?resolve():w.addEventListener('load',resolve,{once:true}));
  const errors=[]; w.addEventListener('error',e=>{errors.push(e.error || e.message);e.preventDefault();});
  w.confirm=()=>true; w.alert=msg=>{throw new Error('Unexpected alert: '+msg);}; w.prompt=()=>null;
  w.T={DEFAULT_RULES:clone(rawRules), SAMPLE_MONTH:clone(rawMonth), PROFILES:[], LANGS_DATA:[JSON.parse(fs.readFileSync(path.join(__dirname,'lang/en.json'),'utf8'))]};
  for(const f of scripts) w.eval(source(f)+'\n//# sourceURL='+f);
  const A=w.T.app; A.restoreFolder=()=>{}; // Start-gate/OS-folder access is outside this DOM-adapter test.
  A.toast=()=>{};
  w.localStorage.setItem('toban.lang','en');
  w.localStorage.setItem(key,saved || JSON.stringify({rules:rawRules,month:rawMonth,result:null,ui:{doctor:1}}));
  w.T.init();
  const q=s=>w.document.querySelector(s), click=s=>{assert(q(s),'Missing '+s);q(s).click();}, change=(s,v)=>{const el=typeof s==='string'?q(s):s;assert(el,'Missing '+s);if(el.type==='checkbox')el.checked=v;else el.value=v;el.dispatchEvent(new w.Event('change',{bubbles:true}));};
  const tick=()=>new Promise(r=>w.setTimeout(r,0));
  const enter=()=>{click('.tab[data-tab="input"]');click('.sub[data-sub="doctorPane"]');};
  const select=n=>change('#docSel',n);
  const placeholder=()=>{assert.equal(q('#docSel').value,'');assert.equal(q('#doctorPane').dataset.doctor,undefined);assert.equal(q('#doctorPane [data-cal]'),null);assert.equal(q('#doctorPane [data-act]'),null);assert.equal(q('#docPrev'),null);assert.equal(q('#docNext'),null);};
  const selected=n=>{assert.equal(q('#docSel').value,n);assert.equal(q('#doctorPane').dataset.doctor,n);assert.equal(q('.doctorEditing').textContent,'Editing: '+n);assert(q('#doctorPane [data-cal]'));};
  const reset=()=>{A.dirHandle=null;A.applyLoaded({rules:clone(rawRules),month:clone(rawMonth),result:null},'Synthetic reset',{fromFolder:false});enter();placeholder();};
  return {dom,w,A,q,click,change,tick,enter,select,placeholder,selected,reset,errors};
}
(async()=>{
 const app=await makeApp(),{w,A,q,click,change,tick,enter,select,placeholder,selected,reset,errors}=app;let count=0;
 const test=async(label,fn)=>{await fn();assert.deepStrictEqual(errors,[]);count++;console.log('ok '+label);};
 const model=()=>JSON.stringify({rules:A.state.rules,month:A.state.month,result:A.state.result});
 const un=d=>`#doctorPane [data-cal="unavail"][data-d="${d}"]`;
 const duty=d=>`#doctorPane [data-cal="duty"][data-d="${d}"][data-part="am"]`;
 await test('real init ignores a previously stored second-person index',()=>{enter();placeholder();assert.equal(A.state.ui.doctor,null);});
 await test('entering, choosing nobody and attempting hidden/bulk actions do not mutate data',()=>{
   const before=model();A.renderDoctor();A.readAll();change('#docSel','');
   const b=w.document.createElement('button');b.dataset.act='calClear';q('#doctorPane').appendChild(b);b.click();b.remove();
   const input=w.document.createElement('select');input.dataset.cal='unavail';q('#doctorPane').appendChild(input);change(input,'night');input.remove();
   assert.equal(model(),before);placeholder();
 });
 await test('explicit person choice renders the correct grid and a prominent name without editing data',()=>{const before=A.sig();select(N[1]);selected(N[1]);assert.equal(q(un(9)).value,'night');assert.equal(A.sig(),before);});
 await test('normal edits and repeated full/language/partial rerenders retain the selected person',async()=>{
   const other=clone(A.state.month.unavailable_night[N[0]]);change(un(10),'night');await tick();
   A.renderDoctor();A.renderAll();w.T.setLang('ja');A.renderAll();w.T.setLang('en');A.renderAll();selected(N[1]);
   assert.deepStrictEqual(clone(A.state.month.unavailable_night[N[0]]),other);assert(A.state.month.unavailable_night[N[1]].includes(10));
 });
 await test('clicking the already active top/subtab does not reset an editing session',()=>{click('.tab[data-tab="input"]');click('.sub[data-sub="doctorPane"]');selected(N[1]);});
 await test('pending controls are read before switching people and never written to the new person',()=>{
   q(duty(12)).value='external';select(N[0]);selected(N[0]);assert.equal(A.state.month.duty_days[N[1]][12].am,'external');assert(!A.state.month.duty_days[N[0]][12]);
 });
 await test('previous/next are explicit person changes only after a selection',()=>{click('#docNext');selected(N[1]);click('#docPrev');selected(N[0]);});
 await test('top-tab exit flushes pending form input and return requires a new choice',()=>{
   q(duty(13)).value='ward';click('.tab[data-tab="settings"]');assert.equal(A.state.month.duty_days[N[0]][13].am,'ward');click('.tab[data-tab="input"]');placeholder();
 });
 await test('subtab exit flushes pending form input and return requires a new choice',()=>{
   select(N[1]);q(duty(14)).value='external';click('.sub[data-sub="monthSettings"]');assert.equal(A.state.month.duty_days[N[1]][14].am,'external');click('.sub[data-sub="doctorPane"]');placeholder();
 });
 await test('hidden stale calendar controls and readAll cannot overwrite another view',()=>{
   select(N[0]);const stale=q(un(5));click('.sub[data-sub="fixedPane"]');const before=clone(A.state.month.unavailable_night);change(stale,'');A.readAll();assert.deepStrictEqual(clone(A.state.month.unavailable_night),before);enter();placeholder();
 });
 await test('deselecting back to the placeholder flushes the old person and removes edit/bulk controls',()=>{select(N[0]);q(duty(15)).value='ward';select('');placeholder();assert.equal(A.state.month.duty_days[N[0]][15].am,'ward');});
 for(const [label,replace] of [
   ['same-month data replacement',()=>{A.state.month=clone(A.state.month);}],
   ['month number changed in place',()=>{A.state.month.month=12;}],
   ['year changed in place',()=>{A.state.month.year=2027;}],
   ['rules/profile replacement',()=>{A.state.rules=clone(A.state.rules);}],
   ['month profile changed',()=>{A.state.month.profile_id='another-synthetic-profile';}],
   ['folder context changed',()=>{A.dirGen++;}]
 ]) await test(label+' rejects stale readback and requires selection',()=>{
   reset();select(N[0]);const stale=q(un(5));replace();const before=model();change(stale,'');A.readAll();assert.equal(model(),before);A.renderDoctor();placeholder();
 });
 await test('production month-switch adoption requires a new person selection',async()=>{
   reset();select(N[1]);const saveBefore=A.saveBeforeSwitch,choose=A.choose;
   A.saveBeforeSwitch=async()=>true;A.choose=async()=>'empty';
   try {await A.onMonthChange(2026,12);assert.equal(A.state.month.month,12);placeholder();}finally {A.saveBeforeSwitch=saveBefore;A.choose=choose;}
 });
 await test('production new-month button requires a new selection after adopting its data',async()=>{
   reset();select(N[0]);const saveBefore=A.saveBeforeSwitch,prompt=w.prompt,answers=['2027','1'];
   A.saveBeforeSwitch=async()=>true;w.prompt=()=>answers.shift();
   try {click('#btnNewMonth');await tick();assert.equal(A.state.month.year,2027);assert.equal(A.state.month.month,1);placeholder();}finally {A.saveBeforeSwitch=saveBefore;w.prompt=prompt;}
 });
 await test('a stale chooser from a replaced context cannot authorize editing that context',()=>{reset();const stale=q('#docSel');A.state.month=clone(A.state.month);change(stale,N[1]);placeholder();});
 await test('roster reorder preserves the actual selected identity and never follows its former index',()=>{reset();select(N[1]);A.state.rules.doctors.reverse();A.renderDoctor();selected(N[1]);change(un(16),'night');assert(A.state.month.unavailable_night[N[1]].includes(16));assert(!A.state.month.unavailable_night[N[0]].includes(16));});
 await test('deleted person and same-name replacement are not treated as the former selection',()=>{
   reset();select(N[0]);const stale=q(un(5));assert(A.removeDoctor(0));A.state.rules.doctors.push({name:N[0],team:'S'});const before=model();change(stale,'');A.readAll();assert.equal(model(),before);A.renderDoctor();placeholder();select(N[0]);selected(N[0]);
 });
 await test('a stale chooser cannot select a deleted identity that has been replaced by the same name',()=>{reset();const old=q('#docSel');A.state.rules.doctors[0]={...A.state.rules.doctors[0]};change(old,N[0]);placeholder();});
 await test('rename clears the selected identity without writing stale controls under either name',()=>{
   reset();select(N[0]);assert(A.renameDoctor(N[0],'Synthetic Renamed'));A.state.rules.doctors[0].name='Synthetic Renamed';const before=model();A.readAll();assert.equal(model(),before);A.renderDoctor();placeholder();
 });
 // Undo of a monthly input replaces only the month; the settings object and its roster entries stay the same objects.
 // The selection is kept only when that same person object is still in the same roster for the same month/facility/folder. A matching name alone never restores it.
 await test('real Undo of a calendar edit keeps the selected person and shows the reverted value',async()=>{
   reset();select(N[1]);const person=A.state.rules.doctors.find(d=>d.name===N[1]),rules=A.state.rules;
   change(un(17),'night');await tick();assert(A.state.month.unavailable_night[N[1]].includes(17));assert(!q('#btnUndo').disabled);
   click('#btnUndo');assert(!A.state.month.unavailable_night[N[1]].includes(17));selected(N[1]);assert.equal(q(un(17)).value,'');
   assert.equal(A.state.rules,rules);assert.equal(A.state.rules.doctors.find(d=>d.name===N[1]),person);
   change(un(19),'night');assert(A.state.month.unavailable_night[N[1]].includes(19));assert(!(A.state.month.unavailable_night[N[0]]||[]).includes(19));selected(N[1]);
 });
 await test('two calendar edits are undone one by one while the same person stays selected',async()=>{
   reset();select(N[1]);change(un(17),'night');await tick();change(un(18),'night');await tick();
   click('#btnUndo');selected(N[1]);assert.equal(q(un(18)).value,'');assert.equal(q(un(17)).value,'night');
   click('#btnUndo');selected(N[1]);assert.equal(q(un(17)).value,'');assert(q('#btnUndo').disabled);
 });
 await test('Undo of another person\'s calendar edit keeps the person chosen afterwards',async()=>{
   reset();select(N[1]);change(un(17),'night');await tick();select(N[0]);await tick();selected(N[0]); // the switch itself records nothing once its microtask has run
   click('#btnUndo');assert(!A.state.month.unavailable_night[N[1]].includes(17));selected(N[0]);
   change(un(20),'night');assert(A.state.month.unavailable_night[N[0]].includes(20));assert(!A.state.month.unavailable_night[N[1]].includes(20));
 });
 await test('Undo that changes the roster clears the selection, and a re-used name does not restore it',async()=>{
   reset();select(N[0]);const original=A.state.rules.doctors.find(d=>d.name===N[0]);
   A.pushUndo('Synthetic roster removal');assert(A.removeDoctor(0));await tick();A.renderDoctor();placeholder();
   A.pushUndo('Synthetic roster addition');A.state.rules.doctors.push({name:N[0],team:'S'});await tick();A.renderDoctor();placeholder();
   select(N[0]);selected(N[0]);const replacement=A.state.rules.doctors.find(d=>d.name===N[0]);assert.notEqual(replacement,original);
   click('#btnUndo');assert(!A.names().includes(N[0]));placeholder();                                   // the added same-name person is removed
   click('#btnUndo');assert(A.names().includes(N[0]));placeholder();                                    // the original returns under the same name: still no automatic selection
   assert.equal(q('#doctorPane [data-cal]'),null);select(N[0]);selected(N[0]);
 });
 await test('Undo that replaces the settings object asks again even when the roster names are unchanged',async()=>{
   reset();A.pushUndo('Synthetic settings change');A.state.rules.weights.target_deviation=(+A.state.rules.weights.target_deviation||0)+1;await tick();
   A.renderDoctor();select(N[1]);selected(N[1]);const rules=A.state.rules;click('#btnUndo');assert.notEqual(A.state.rules,rules);assert(A.names().includes(N[1]));placeholder();
 });
 await test('Undo after the selected person was removed and re-added neither rewrites data nor selects the new same-name person',async()=>{
   reset();select(N[1]);change(un(17),'night');await tick();const i=A.names().indexOf(N[1]);
   assert(A.removeDoctor(i));A.state.rules.doctors.push({name:N[1],team:'S'});const before=model();
   click('#btnUndo');assert.equal(model(),before);            // the application refuses this Undo (the month was changed by the removal); nothing is rewritten
   const stale=q(un(18));if(stale)change(stale,'night');assert.equal(model(),before);                   // a stale control of the removed person cannot write to the new person
   A.renderDoctor();placeholder();assert.equal(q('#doctorPane [data-cal]'),null);
   reset();select(N[1]);selected(N[1]);                                                                // restore the state expected by the following tests
 });
 await test('real JSON applyLoaded clears selection and preserves selected-person edits on roundtrip',()=>{
   change(un(18),'night');const payload=A.payloadJson('synthetic-saved');A.applyLoaded(JSON.parse(payload),'Synthetic reload',{fromFolder:false});placeholder();select(N[1]);assert.equal(q(un(18)).value,'night');
 });
 await test('real local save/reload retains data but cannot restore editing authorization',async()=>{
   A.save();const saved=w.localStorage.getItem(key);assert.equal(JSON.parse(saved).ui.doctor,null);
   const restored=await makeApp(saved);restored.enter();restored.placeholder();restored.select(N[1]);assert.equal(restored.q(un(18)).value,'night');assert.deepStrictEqual(restored.errors,[]);restored.dom.window.close();
 });
 await test('registered normalization hooks may clone the roster without dropping the first or later edit',()=>{
   reset();
   const def={id:'local.synthetic-normalizer',states:['off'],normalize(R){R.local_synthetic_normalized=true;}};w.T.RULE_DEFS.push(def);
   try { select(N[1]);change(un(19),'night');assert(A.state.month.unavailable_night[N[1]].includes(19));
     A.renderAll();selected(N[1]);A.renderSettingsMonth();A.renderFixed();A.renderDoctor();change(un(20),'night');
     assert(A.state.month.unavailable_night[N[1]].includes(20));selected(N[1]);
     w.T.setLang('ja');A.renderAll();w.T.setLang('en');A.renderAll();selected(N[1]);
   } finally {w.T.RULE_DEFS.splice(w.T.RULE_DEFS.indexOf(def),1);}
 });
 await test('normalization that actually renames a person cannot preserve editing authorization',()=>{
   reset();select(N[0]);const def={id:'local.synthetic-rename',states:['off'],normalize(R){R.doctors[0].name='Synthetic Changed';}};w.T.RULE_DEFS.push(def);
   try {A.renderDoctor();placeholder();}finally {w.T.RULE_DEFS.splice(w.T.RULE_DEFS.indexOf(def),1);}
 });
 await test('explicit reset removes editing authorization without mutating calendar data',()=>{const before=model();A.resetDoctorSelection();A.renderDoctor();placeholder();A.readAll();assert.equal(model(),before);});
 app.dom.window.close();console.log(`calendar person selection DOM adapter: ${count} passed; no real-browser execution`);
})().catch(e=>{console.error(e.stack || e);process.exitCode=1;});

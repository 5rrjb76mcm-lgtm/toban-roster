// C02: retained fixed input on removed day slots remains visible and individually removable.
// Full app markup/handlers + jsdom; synthetic people, no browser/OS/network operations.
// Authored but NOT executed. Run with installed jsdom 26.1.0:
// TOBAN_DOM_MODULE=/path/to/jsdom node test_inactive_day_fixed_dom_node.js
// TOBAN_SOURCE_ROOT points at another webapp tree for baseline/group-revert comparison.
const fs = require('fs'), path = require('path'), assert = require('assert/strict');
let JSDOM;
for (const name of [process.env.TOBAN_DOM_MODULE, 'jsdom', path.join(process.env.HOME || '', '.toban-test/node_modules/jsdom')].filter(Boolean)) {
  try { ({ JSDOM } = require(name)); break; } catch (e) { if (e.code !== 'MODULE_NOT_FOUND') throw e; }
}
if (!JSDOM) throw new Error('Requires installed jsdom 26.1.0; set TOBAN_DOM_MODULE. This source has NOT been executed.');
const root = process.env.TOBAN_SOURCE_ROOT || __dirname, copy = x => JSON.parse(JSON.stringify(x));
const N = ['Synthetic Alpha', 'Synthetic Beta'], key = 'toban_state_v2:/synthetic/inactive-day-fixed.html';
const source = f => fs.readFileSync(path.join(root, 'src', f), 'utf8');
const scripts = ['i18n.js','rules-core.js','model.js', ...fs.readdirSync(path.join(root,'src/calendars')).filter(f=>f.endsWith('.js')).sort().map(f=>'calendars/'+f),
  'messages.js','solver.js','check.js','report.js','docxgen.js','plugins.js','merge.js', ...fs.readdirSync(path.join(root,'src/rules')).filter(f=>f.endsWith('.js')).sort().map(f=>'rules/'+f),
  'app-core.js','app-folder.js','app-month.js','app-input.js','app-settings.js','app-solve.js','app-main.js'];
async function app(on, day, kind, saved) {
  const dom = new JSDOM(source('index.html'), {url:'https://example.invalid/synthetic/inactive-day-fixed.html',runScripts:'outside-only'}), w = dom.window;
  await new Promise(resolve => w.document.readyState === 'complete' ? resolve() : w.addEventListener('load',resolve,{once:true}));
  const errors=[]; w.addEventListener('error', e=>{errors.push(String(e.error||e.message)); e.preventDefault();});
  w.confirm=()=>true; w.prompt=()=>null; w.alert=msg=>{throw new Error('Unexpected alert: '+msg);};
  const rules={profile:{id:'synthetic-inactive-day',calendar:{holidays:'none',closure:[]},fixed_tags:['Training'],roles:[{id:'Q',refs:['charge'],standby:true},{id:'J',refs:['junior'],standby:true}],shifts:[{id:'day',on},{id:'night',on:'all'}]},
    doctors:N.map((name,i)=>({name,team:i?'J':'Q',quota:15})),rule_states:{},weights:{}};
  const month={year:2026,month:11,holidays:[],next_first_day_in_calendar:true,next_month_first_day_is_holiday:false,
    fixed:{day:{},day_oc:{},night:{9:N[1]},weekend_charge:{}},fixed_tags:{['9:night|'+N[1]]:'Training'}};
  if(kind==='work'||kind==='overlap') {month.fixed.day[day]=N[0];month.fixed_tags[day+':day|'+N[0]]='Training';}
  if(kind==='oc'||kind==='overlap') month.fixed.day_oc[day]=[N[0],N[1]];
  if(kind==='charge') month.fixed.weekend_charge[day]=N[0];
  w.T={DEFAULT_RULES:copy(rules),SAMPLE_MONTH:copy(month),PROFILES:[],LANGS_DATA:['en','ja'].map(code=>JSON.parse(fs.readFileSync(path.join(root,'lang',code+'.json'),'utf8')))};
  for(const file of scripts) w.eval(source(file)+'\n//# sourceURL='+file);
  const T=w.T,A=T.app; T.fillDefaultRules(rules); for(const def of T.RULE_DEFS) if(def.states.includes('off')) rules.rule_states[def.id]='off';
  A.restoreFolder=()=>{}; A.toast=()=>{}; w.localStorage.setItem('toban.lang','en');
  w.localStorage.setItem(key,saved||JSON.stringify({rules,month,result:null,ui:{}})); T.init();
  const q=s=>w.document.querySelector(s), click=s=>{assert(q(s),'Missing '+s);q(s).click();};
  const change=(s,v)=>{const el=typeof s==='string'?q(s):s;assert(el,'Missing '+s);el.value=v;el.dispatchEvent(new w.Event('change',{bubbles:true}));};
  const tick=()=>new Promise(r=>w.setTimeout(r,0));
  const enter=route=>{click('.tab[data-tab="input"]');click('.sub[data-sub="'+(route==='table'?'fixedPane':'doctorPane')+'"]');if(route==='calendar')change('#docSel',N[0]);};
  const target=(route,kind,d=day)=>q(route==='table'?`#fixedPane [data-fx="${kind==='oc'?'dayI':'day'}"][data-d="${d}"]`:`#doctorPane [data-cal="fixed"][data-k="day"][data-d="${d}"]`);
  const close=async()=>{await tick();w.clearTimeout(A.autosaveTimer);const problems=errors.slice();w.close();assert.deepEqual(problems,[]);};
  return {w,T,A,q,click,change,tick,enter,target,close,stored:()=>JSON.parse(w.localStorage.getItem(key))};
}
const tests=[],test=(name,fn)=>tests.push({name,fn});
const untouched = a => {assert.equal(a.A.state.month.fixed.night[9],N[1]);assert.equal(a.A.state.month.fixed_tags['9:night|'+N[1]],'Training');};
for(const on of ['none','off_days']) for(const day of [2,31]) for(const route of ['table','calendar']) for(const kind of ['work','oc']) {
  test(`${on}/${day===31?'next':'current'}/${route}/${kind}: preserve, isolated clear, save and Undo`,async()=>{
    const a=await app(on,day,kind);try{
      a.enter(route);await a.tick();const before=copy(a.A.state.month.fixed),tags=copy(a.A.state.month.fixed_tags);
      const el=a.target(route,kind);assert(el,'retained inactive day input must be shown');assert.notEqual(el.value,'');
      assert.equal(el.options.length,2,'blank and existing value only');assert.equal(el.options[0].value,'');
      assert(el.selectedOptions[0].textContent.includes(a.T.t('（現在は使わない値）')));
      a.A.readAll();a.A.readAll();assert.deepEqual(copy(a.A.state.month.fixed),before);assert.deepEqual(copy(a.A.state.month.fixed_tags),tags);
      // Blank is an explicit edit; no global clear and no change to schedule configuration.
      a.change(el,'');await a.tick();untouched(a);
      if(kind==='work'){assert.equal(a.A.state.month.fixed.day[day],undefined);assert.equal(a.A.state.month.fixed_tags[day+':day|'+N[0]],undefined);}
      else assert.deepEqual(copy(a.A.state.month.fixed.day_oc[day]),[N[1]],'second OC must survive');
      assert.equal(a.A.state.rules.profile.shifts.find(s=>s.id==='day').on,on);
      const saved=a.stored();assert.deepEqual(saved.month.fixed,copy(a.A.state.month.fixed));assert.deepEqual(saved.month.fixed_tags,copy(a.A.state.month.fixed_tags));
      // Use the real header Undo event after its queueMicrotask checkpoint.
      assert.equal(a.q('#btnUndo').disabled,false);a.click('#btnUndo');await a.tick();
      assert.deepEqual(copy(a.A.state.month.fixed),before);assert.deepEqual(copy(a.A.state.month.fixed_tags),tags);untouched(a);
      // A fresh application sees restored data and still exposes targeted removal.
      const b=await app(on,day,kind,a.w.localStorage.getItem(key));try{b.enter(route);assert(b.target(route,kind));assert.deepEqual(copy(b.A.state.month.fixed),before);}finally{await b.close();}
    }finally{await a.close();}
  });
}
test('inactive empty days offer no new day assignment, current or boundary, in either editor',async()=>{
  const a=await app('none',2,'empty');try{for(const route of ['table','calendar']){a.enter(route);for(const d of [2,31]){
    if(route==='calendar')assert.equal(a.target(route,'work',d),null);
    else {assert.equal(a.target(route,'work',d),null);assert.equal(a.target(route,'oc',d),null);assert.equal(a.q(`#fixedPane [data-fx="dayY"][data-d="${d}"]`),null);}
  }}untouched(a);}finally{await a.close();}
});
test('overlapping day work and OC reveal remaining OC after clearing work without losing another person',async()=>{
  const a=await app('none',2,'overlap');try{a.enter('calendar');assert.equal(a.target('calendar','work').value,'day');a.change(a.target('calendar','work'),'');await a.tick();
    assert.equal(a.A.state.month.fixed.day[2],undefined);assert.deepEqual(copy(a.A.state.month.fixed.day_oc[2]),N);assert.equal(a.target('calendar','oc').value,'dayoc');
    assert.equal(a.A.state.month.fixed_tags['2:day|'+N[0]],undefined);a.change(a.target('calendar','oc'),'');await a.tick();assert.deepEqual(copy(a.A.state.month.fixed.day_oc[2]),[N[1]]);untouched(a);
  }finally{await a.close();}
});
test('inactive day retains existing period charge but never offers new charge, table keeps holiday charge behavior',async()=>{
  const a=await app('none',1,'charge');try{a.enter('calendar');const el=a.target('calendar','work',1);assert(el);assert.deepEqual([...el.options].map(o=>o.value),['','charge']);
    a.change(el,'');await a.tick();assert.equal(a.A.state.month.fixed.weekend_charge[1],undefined);
    // A sole cleared choice can remain blank until repaint; readDoctor redraws
    // automatically only when another retained fixed choice needs revealing.
    a.A.renderDoctor();assert.equal(a.target('calendar','work',1),null);
    a.enter('table');assert(a.q('#fixedPane [data-fx="charge"][data-d="1"]'),'existing holiday charge editor remains independent of day slot');assert.equal(a.q('#fixedPane [data-fx="charge"][data-d="2"]'),null);untouched(a);
  }finally{await a.close();}
});
test('enabled day still offers new work and OC and uses ordinary assignment controls',async()=>{
  const a=await app('all',2,'empty');try{a.enter('calendar');let el=a.target('calendar','work');assert(el);assert([...el.options].some(o=>o.value==='day'));assert([...el.options].some(o=>o.value==='dayoc'));
    a.change(el,'day');await a.tick();assert.equal(a.A.state.month.fixed.day[2],N[0]);a.enter('table');el=a.target('table','work');assert(el);assert([...el.options].some(o=>o.value===N[1]));untouched(a);
  }finally{await a.close();}
});
const expected=20;let finished=false,passed=0,failed=0;
process.on('exit',()=>{if(!finished||passed+failed!==expected){console.error('Incomplete inactive-day regression: '+(passed+failed)+'/'+expected);process.exitCode=1;}});
const watchdog=setTimeout(()=>{console.error('Inactive-day DOM regression timeout');process.exit(1);},120000);
(async()=>{assert.equal(tests.length,expected);for(const t of tests){try{await t.fn();passed++;console.log('ok '+t.name);}catch(e){failed++;console.error('FAIL '+t.name+'\n'+(e.stack||e));}}
  finished=true;clearTimeout(watchdog);console.log(`inactive day fixed DOM: ${passed} passed, ${failed} failed, ${expected} expected`);if(failed)process.exitCode=1;
})().catch(e=>{clearTimeout(watchdog);console.error(e.stack||e);process.exitCode=1;});

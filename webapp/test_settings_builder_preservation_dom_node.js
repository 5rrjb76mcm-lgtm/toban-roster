// Settings builder preserves zero staffing counts and fixed-tag definitions.
// Actual markup, init, delegated settings events,
// Problem and localStorage. Fictional data only; jsdom supplies the DOM.
// No browser, layout, OS permissions or network test is claimed; no sockets are opened.
// Run: TOBAN_DOM_MODULE=/path/to/node_modules/jsdom node test_settings_builder_preservation_dom_node.js [/path/to/node_modules/highs]
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

// Exit must not report a pass if an asynchronous case never finishes.
let completed=false, passed=0, failed=0;
process.on('exit',()=>{if(!completed){console.error('FAIL settings builder regression exited before all cases completed');process.exitCode=1;}});
const watchdog=setTimeout(()=>{console.error('FAIL settings builder regression timed out');process.exit(1);},120000);
const cases=[];
const test=(label,fixture,fn)=>cases.push({label,fixture,fn});
const rulesFor=work=>{const r=clone(rawRules);if(work!==undefined)r.profile.positions={work:clone(work)};return r;};
const editYears=a=>a.change('#doctorTable tr[data-i="0"] [data-f="years"]','12');
const P=a=>new a.w.T.Problem(a.A.state.rules,a.A.state.month);
const semantics=a=>{const p=P(a);return clone(p.slots.map(s=>[s,p.countOf(s),p.countMinOf(s),p.countIdealOf(s)]));};
const tags=a=>clone(a.A.state.rules.profile.fixed_tags);
const effectiveTags=a=>clone(a.w.T.calendarExt.merged(a.A.state.rules).fixedTags);
async function reload(a,r,fn){const saved=a.w.localStorage.getItem(key);assert(saved,'settings were saved');const b=await makeApp(saved,r,r);try{await fn(b);assert.deepStrictEqual(b.errors,[]);}finally{b.dom.window.close();}}
let highs=null;
(async()=>{
 if(process.argv[2])highs=await require(process.argv[2])();
 for(const [label,list] of [
  ['separator-bearing object labels',['Training・Meeting','Training,Meeting','Training、Meeting'].map(label=>({label,shifts:['day']}))],
  ['separator-bearing string labels',['Training・Meeting','Training,Meeting','Training、Meeting']],
  ['newline labels',[{label:'Training\r\nDay',shifts:['day']},'Plain\nTag']],
  ['whitespace and repeated labels',[{label:' Training ',shifts:['night']},{label:'Training',shifts:['day']},{label:'Training',shifts:['night']}]],
 ]){
  const r=rulesFor();r.profile.fixed_tags=clone(list);
  test('fixed tags: '+label,r,async(a,r)=>{
   const before=tags(a),effective=effectiveTags(a),month=clone(a.A.state.month);
   editYears(a);a.A.readSettings();a.A.readSettings();assert.deepStrictEqual(tags(a),before);assert.deepStrictEqual(effectiveTags(a),effective);assert.deepStrictEqual(clone(a.A.state.month),month);
   assert.deepStrictEqual(JSON.parse(a.w.localStorage.getItem(key)).rules.profile.fixed_tags,before);
   await reload(a,r,b=>{assert.deepStrictEqual(tags(b),before);assert.deepStrictEqual(effectiveTags(b),effective);});
  });
 }
 {
  const r=rulesFor(),first={label:'Training',shifts:['day']},second={label:'Meeting',shifts:['night']};r.profile.fixed_tags=[first,second];
  test('fixed tags: explicit simple add, remove and clear retain existing restrictions',r,async(a,r)=>{
   a.change('#setFixedTags','Training・Meeting・Travel');assert.deepStrictEqual(tags(a),[first,second,'Travel']);
   a.change('#setFixedTags','Meeting・Travel');assert.deepStrictEqual(tags(a),[second,'Travel']);a.A.readSettings();assert.deepStrictEqual(tags(a),[second,'Travel']);
   await reload(a,r,b=>assert.deepStrictEqual(tags(b),[second,'Travel']));
   a.change('#setFixedTags','');assert.strictEqual(a.A.state.rules.profile.fixed_tags,undefined);a.A.readSettings();assert.strictEqual(a.A.state.rules.profile.fixed_tags,undefined);
   await reload(a,r,b=>assert.strictEqual(b.A.state.rules.profile.fixed_tags,undefined));
  });
 }
 for(const [label,work,total] of [
  ['scalar zero',{count:0},0],
  ['per-shift zero',{count:{day:0,night:1}},30],
  ['day-type zero',{count:{weekday:0,off_days:1}},null],
  ['per-shift day-type zero',{count:{day:{weekday:0,off_days:0},night:1}},30],
  ['positive counts',{count:{day:1,night:2}},90],
  ['default count',undefined,60],
 ])test('staffing: '+label+' survives unrelated changes and reload',rulesFor(work),async(a,r)=>{
   const before=semantics(a);if(work?.count===0)assert.strictEqual(a.q('[data-count="day"]').getAttribute('min'),'0');
   const beforeP=P(a),assignment=Object.fromEntries(beforeP.slots.map(s=>[s.join(':'),{work:beforeP.names.slice(0,beforeP.countOf(s)),oc:[]}]));
   assert.deepStrictEqual(clone(a.w.T.check(beforeP,assignment).V),[]);
   editYears(a);a.A.readSettings();a.A.readSettings();assert.deepStrictEqual(semantics(a),before);
   assert.deepStrictEqual(clone(a.w.T.check(P(a),assignment).V),[]);
   if(highs){const solved=a.w.T.solve(P(a),highs,{timeLimit:3});assert.strictEqual(solved.status,'Optimal');assert.deepStrictEqual(clone(a.w.T.check(P(a),solved.asg).V),[]);
    const assigned=Object.values(solved.asg).reduce((n,x)=>n+[].concat(x.work||[]).length,0);assert.strictEqual(assigned,total??before.reduce((n,row)=>n+row[1],0));}
   await reload(a,r,b=>assert.deepStrictEqual(semantics(b),before));
 });
 test('staffing: explicit zero, positive and blank count inputs',rulesFor({count:2}),async(a,r)=>{
  a.change('[data-count="day"]','0');assert.strictEqual(P(a).countOf([1,'day']),0);assert.strictEqual(a.A.state.rules.profile.positions.work.count.day,0);
  a.change('[data-count="day"]','3');assert.strictEqual(P(a).countOf([1,'day']),3);
  a.change('[data-count="day"]','');assert.strictEqual(P(a).countOf([1,'day']),1);
  a.change('[data-count="day"]','0');a.A.readSettings();await reload(a,r,b=>assert.strictEqual(P(b).countOf([1,'day']),0));
 });
 for(const [label,count] of [['numeric',0],['day-type',{weekday:0,off_days:0}]])test('staffing: '+label+' zero upper bound caps effective min and ideal while retaining raw ideal',rulesFor({count,min:1,ideal:1}),async(a,r)=>{
  const capped=(b,cleared=false)=>{const p=P(b);for(const shift of ['day','night'])for(const day of [1,2]){
   assert.strictEqual(p.countOf([day,shift]),0);assert.strictEqual(p.countMinOf([day,shift]),0);assert.strictEqual(p.countIdealOf([day,shift]),cleared&&shift==='day'?null:0);
  }for(const slot of p.slots){assert(p.countMinOf(slot)<=p.countOf(slot));assert(p.countIdealOf(slot)==null||p.countIdealOf(slot)<=p.countOf(slot));}};
  editYears(a);assert.strictEqual(a.A.state.rules.profile.positions.work.ideal,1,'unrelated edit retains accepted raw ideal');
  for(const shift of ['day','night']){
   assert.strictEqual(a.A.state.rules.profile.positions.work.min[shift],0,'existing minimum storage normalization is unchanged');
   assert.strictEqual(a.q(`[data-countideal="${shift}"]`).value,'1','editor shows raw ideal separately from effective zero');
  }
  capped(a);const before=semantics(a);a.A.readSettings();await reload(a,r,b=>{assert.strictEqual(b.A.state.rules.profile.positions.work.ideal,1);capped(b);assert.deepStrictEqual(semantics(b),before);});
  const bounds=clone({count:a.A.state.rules.profile.positions.work.count,min:a.A.state.rules.profile.positions.work.min});
  a.change('[data-countideal="day"]','3');
  assert.deepStrictEqual(clone(a.A.state.rules.profile.positions.work.ideal),{day:0,night:1},'explicit edit is clamped to zero; untouched sibling keeps raw one');
  capped(a);await reload(a,r,b=>{assert.deepStrictEqual(clone(b.A.state.rules.profile.positions.work.ideal),{day:0,night:1});capped(b);});
  a.change('[data-countideal="day"]','');a.A.readSettings();a.A.readSettings();
  const cleared=b=>{assert.deepStrictEqual(clone(b.A.state.rules.profile.positions.work.ideal),{night:1},'explicit deletion owns only day and is not restored by readback');assert.deepStrictEqual(clone({count:b.A.state.rules.profile.positions.work.count,min:b.A.state.rules.profile.positions.work.min}),bounds,'ideal deletion leaves count and minimum unchanged');capped(b,true);};
  cleared(a);await reload(a,r,b=>{b.enter();b.A.readSettings();cleared(b);});
 });
 test('staffing: partial day-type count retains missing-day default of one',rulesFor({count:{weekday:0},min:1,ideal:1}),async(a,r)=>{
  const capped=(b,cleared=false)=>{const p=P(b);for(const shift of ['day','night'])for(const [day,expected] of [[1,1],[2,0]]){
   assert.strictEqual(p.countOf([day,shift]),expected);assert.strictEqual(p.countMinOf([day,shift]),expected);assert.strictEqual(p.countIdealOf([day,shift]),cleared&&shift==='day'?null:expected);
  }for(const slot of p.slots){assert(p.countMinOf(slot)<=p.countOf(slot));assert(p.countIdealOf(slot)==null||p.countIdealOf(slot)<=p.countOf(slot));}};
  editYears(a);assert.strictEqual(a.A.state.rules.profile.positions.work.ideal,1,'unrelated edit retains accepted raw ideal');
  for(const shift of ['day','night']){
   assert.strictEqual(a.A.state.rules.profile.positions.work.min[shift],1,'existing minimum storage normalization is unchanged');
   assert.strictEqual(a.q(`[data-countideal="${shift}"]`).value,'1');
  }
  capped(a);const before=semantics(a);a.A.readSettings();await reload(a,r,b=>{assert.strictEqual(b.A.state.rules.profile.positions.work.ideal,1);capped(b);assert.deepStrictEqual(semantics(b),before);});
  const bounds=clone({count:a.A.state.rules.profile.positions.work.count,min:a.A.state.rules.profile.positions.work.min});
  a.change('[data-countideal="day"]','3');
  assert.deepStrictEqual(clone(a.A.state.rules.profile.positions.work.ideal),{day:1,night:1},'explicit edit uses the existing day-type maximum of one; untouched sibling keeps raw one');
  capped(a);await reload(a,r,b=>{assert.deepStrictEqual(clone(b.A.state.rules.profile.positions.work.ideal),{day:1,night:1});capped(b);});
  a.change('[data-countideal="day"]','');a.A.readSettings();a.A.readSettings();
  const cleared=b=>{assert.deepStrictEqual(clone(b.A.state.rules.profile.positions.work.ideal),{night:1},'explicit deletion owns only day and is not restored by readback');assert.deepStrictEqual(clone({count:b.A.state.rules.profile.positions.work.count,min:b.A.state.rules.profile.positions.work.min}),bounds,'ideal deletion leaves count and minimum unchanged');capped(b,true);};
  cleared(a);await reload(a,r,b=>{b.enter();b.A.readSettings();cleared(b);});
 });
 for(const [label,ideal] of [['scalar zero',0],['per-shift zero',{day:0,night:0}],['partial shift zero',{day:0}],['empty object',{}]]){
  const r=rulesFor({count:1,min:0,ideal});r.rule_states.count_target='off';
  test('ideal: existing '+label+' does not reactivate an off rule',r,async(a,r)=>{
   const before=semantics(a),assignment=Object.fromEntries(P(a).slots.map(s=>[s.join(':'),{work:N[0],oc:[]}]));
   assert.strictEqual(a.w.T.penalty(P(a),assignment).total,0);editYears(a);a.A.readSettings();
   assert.strictEqual(a.A.state.rules.rule_states.count_target,'off');assert.deepStrictEqual(semantics(a),before);assert.strictEqual(a.w.T.penalty(P(a),assignment).total,0);
   await reload(a,r,b=>{assert.strictEqual(b.A.state.rules.rule_states.count_target,'off');assert.deepStrictEqual(semantics(b),before);});
  });
 }
 for(const [label,ideal] of [['missing',undefined],['null',null]]){
  const work={count:1,min:0};if(ideal!==undefined)work.ideal=ideal;const r=rulesFor(work);r.rule_states.count_target='off';
  test('ideal: '+label+' stays off until a new visible ideal is added',r,async(a,r)=>{
   editYears(a);assert.strictEqual(a.A.state.rules.rule_states.count_target,'off');assert.strictEqual(P(a).countIdealOf([1,'day']),null);
   a.change('[data-countideal="day"]','0');assert.strictEqual(a.A.state.rules.rule_states.count_target,'soft');assert.strictEqual(P(a).countIdealOf([1,'day']),0);
   await reload(a,r,b=>assert.strictEqual(b.A.state.rules.rule_states.count_target,'soft'));
  });
 }
 assert.strictEqual(cases.length,21,'the full planned case list was registered');
 for(const {label,fixture:r,fn} of cases){let a;try{a=await makeApp(null,r,r);a.enter();await fn(a,r);assert.deepStrictEqual(a.errors,[]);passed++;console.log('ok '+label);}catch(e){failed++;console.error('FAIL '+label+'\n'+e.stack);}finally{a?.dom.window.close();}}
 assert.strictEqual(passed+failed,cases.length);completed=true;clearTimeout(watchdog);
 console.log(`settings builder preservation: ${passed} passed, ${failed} failed`);if(!highs)console.log('SKIP solver checks (pass an installed HiGHS package path)');if(failed)process.exitCode=1;
})().catch(e=>{clearTimeout(watchdog);console.error(e.stack);process.exitCode=1;});

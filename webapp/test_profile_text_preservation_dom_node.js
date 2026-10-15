// Preserve imported multilingual profile/shift/role labels and facility identity.
// Actual markup, init, delegated settings events,
// Problem and localStorage. Fictional data only; jsdom supplies the DOM.
// No browser, layout, OS permissions or network test is claimed; no sockets are opened.
// Run: TOBAN_DOM_MODULE=/path/to/node_modules/jsdom node test_profile_text_preservation_dom_node.js
const fs = require('fs'), path = require('path'), assert = require('assert');
// Verified with jsdom 26.1.0. Dependency lookup never downloads/install packages.
let JSDOM;
for (const name of [process.env.TOBAN_DOM_MODULE, 'jsdom', path.join(process.env.HOME || '', '.toban-test/node_modules/jsdom')].filter(Boolean)) {
  try { ({ JSDOM } = require(name)); break; } catch (e) { if (e.code !== 'MODULE_NOT_FOUND') throw e; }
}
if (!JSDOM) throw new Error('Profile text DOM-adapter regression requires jsdom 26.1.0. Set TOBAN_DOM_MODULE to its installed module path. This test was NOT run.');
const N = ['Synthetic Trainer', 'Synthetic Colleague'], clone = x => JSON.parse(JSON.stringify(x));
const root = process.env.TOBAN_SOURCE_ROOT || __dirname;
const source = f => fs.readFileSync(path.join(root, 'src', f), 'utf8');
const scripts = ['i18n.js','rules-core.js','model.js', ...fs.readdirSync(path.join(root,'src/calendars')).filter(f=>f.endsWith('.js')).sort().map(f=>'calendars/'+f),
  'messages.js','solver.js','check.js','report.js','docxgen.js','plugins.js','merge.js', ...fs.readdirSync(path.join(root,'src/rules')).filter(f=>f.endsWith('.js')).sort().map(f=>'rules/'+f),
  'app-core.js','app-folder.js','app-month.js','app-input.js','app-settings.js','app-solve.js','app-main.js'];
const key = 'toban_state_v2:/synthetic/profile-text-preservation.html';
const rawRules = {profile:{id:'synthetic-profile-text-preservation',roles:[{id:'S',label:'Staff',refs:[]}],shifts:[{id:'day',label:'Day',on:'all'},{id:'night',label:'Night',on:'all'}]},doctors:N.map(name=>({name,team:'S',quota:15})),rule_states:{oncall:'off'},weights:{}};
const rawMonth = {year:2026,month:11,notes:'Synthetic settings builder roundtrip'};
async function makeApp(saved, fixture=rawRules, defaults=fixture) {
  const dom = new JSDOM(source('index.html'), {url:'https://example.invalid/synthetic/profile-text-preservation.html',runScripts:'outside-only'}), w=dom.window;
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


let failures=0, passed=0, completed=false;
process.on('exit',()=>{if(!completed){console.error('FAIL profile text cases did not finish');process.exitCode=1;}});
const watchdog=setTimeout(()=>{console.error('FAIL profile text timeout');process.exit(1);},120000);
const projection = a => clone({id:a.A.state.rules.profile.id,label:a.A.state.rules.profile.label,roles:a.A.state.rules.profile.roles.map(r=>r.label),shifts:a.A.state.rules.profile.shifts.map(s=>s.label)});
async function importFile(a,r) {
 const el=a.q('#fileLoadProfile');
 Object.defineProperty(el,'files',{configurable:true,value:[{name:'synthetic-profile.json',text:async()=>JSON.stringify(r)}]});
 el.dispatchEvent(new a.w.Event('change',{bubbles:true}));
 for(let i=0;i<10;i++){await a.tick();if(!a.A.switching)break;}
 assert.strictEqual(a.A.switching,0);
}
async function test(name,fn){try{await fn();passed++;console.log('PASS '+name);}catch(e){failures++;console.error('FAIL '+name+' '+e.stack);}}
(async()=>{
 for(const [name,label] of [['plain',{en:'Synthetic facility',ja:'架空施設'}],['spaces',{en:' Synthetic facility ',ja:' 架空施設 '}],['newlines',{en:'Synthetic\r\nfacility',ja:'架空\n施設'}]]) {
  for(const field of ['profile','shift','role']) await test(field+' '+name+' import and unrelated edit',async()=>{
   const r=clone(rawRules);if(field==='profile')r.profile.label=label;else if(field==='shift')r.profile.shifts[0].label=label;else r.profile.roles[0].label=label;
   const a=await makeApp();try{a.enter();await importFile(a,r);a.enter();const before=projection(a);assert.deepStrictEqual(field==='profile'?before.label:field==='shift'?before.shifts[0]:before.roles[0],label);
    a.change('#doctorTable tr[data-i="0"] [data-f="years"]','12');a.A.readSettings();a.A.readSettings();
    const saved=a.w.localStorage.getItem(key);const b=await makeApp(saved,r);try{assert.deepStrictEqual(projection(b),before);b.w.T.setLang('ja');b.enter();b.A.readSettings();assert.deepStrictEqual(projection(b),before);assert.deepStrictEqual(b.errors,[]);}finally{b.dom.window.close();}
    assert.deepStrictEqual(a.errors,[]);
   }finally{a.dom.window.close();}
  });
 }
 await test('Unicode profile ID survives import, unrelated edit and reload',async()=>{
  const r=clone(rawRules);r.profile.id='架空施設';const a=await makeApp(null,r);try{a.enter();await importFile(a,r);a.enter();assert.strictEqual(a.A.state.month.profile_id,r.profile.id);a.change('#doctorTable tr[data-i="0"] [data-f="years"]','12');
   const b=await makeApp(a.w.localStorage.getItem(key),r);try{assert.strictEqual(b.A.state.rules.profile.id,r.profile.id);assert.strictEqual(b.A.state.rules.profile.id,b.A.state.month.profile_id);assert(!b.w.T.lint(new b.w.T.Problem(b.A.state.rules,b.A.state.month)).some(x=>x.code==='LINT_PROFILE_MISMATCH'));}finally{b.dom.window.close();}
  }finally{a.dom.window.close();}
 });
 await test('explicit edits retain existing trimming and ID sanitization',async()=>{
  const a=await makeApp();try{a.enter();a.change('#setProfLabel',' New facility ');assert.strictEqual(a.A.state.rules.profile.label,'New facility');a.change('[data-slabel]',' New shift ');assert.strictEqual(a.A.state.rules.profile.shifts[0].label,'New shift');a.change('[data-rlabel]',' New role ');assert.strictEqual(a.A.state.rules.profile.roles[0].label,'New role');a.change('#setProfId',' new facility ');assert.strictEqual(a.A.state.rules.profile.id,'new-facility');}finally{a.dom.window.close();}
 });
 assert.strictEqual(passed+failures,11);completed=true;clearTimeout(watchdog);console.log('profile text preservation: '+passed+' passed, '+failures+' failed');if(failures)process.exitCode=1;
})().catch(e=>{clearTimeout(watchdog);console.error(e);process.exitCode=1;});

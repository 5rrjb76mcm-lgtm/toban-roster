// Preserve imported collection values through ordinary current-month DOM readback.
// Actual markup, init, JSON import, delegated monthly input events,
// Problem and localStorage. Fictional data only; jsdom supplies the DOM.
// No browser, layout, OS permissions or network test is claimed; no sockets are opened.
// Run: TOBAN_DOM_MODULE=/path/to/node_modules/jsdom node test_weekend_wish_ownership_dom_node.js
const fs = require('fs'), path = require('path'), assert = require('assert');
// Verified with jsdom 26.1.0. Dependency lookup never downloads/install packages.
let JSDOM;
for (const name of [process.env.TOBAN_DOM_MODULE, 'jsdom', path.join(process.env.HOME || '', '.toban-test/node_modules/jsdom')].filter(Boolean)) {
  try { ({ JSDOM } = require(name)); break; } catch (e) { if (e.code !== 'MODULE_NOT_FOUND') throw e; }
}
if (!JSDOM) throw new Error('Month text DOM-adapter regression requires jsdom 26.1.0. Set TOBAN_DOM_MODULE to its installed module path. This test was NOT run.');
const N = ['Synthetic Trainer', 'Synthetic Colleague'], clone = x => JSON.parse(JSON.stringify(x));
const root = process.env.TOBAN_SOURCE_ROOT || __dirname;
const source = f => fs.readFileSync(path.join(root, 'src', f), 'utf8');
const scripts = ['i18n.js','rules-core.js','model.js', ...fs.readdirSync(path.join(root,'src/calendars')).filter(f=>f.endsWith('.js')).sort().map(f=>'calendars/'+f),
  'messages.js','solver.js','check.js','report.js','docxgen.js','plugins.js','merge.js', ...fs.readdirSync(path.join(root,'src/rules')).filter(f=>f.endsWith('.js')).sort().map(f=>'rules/'+f),
  'app-core.js','app-folder.js','app-month.js','app-input.js','app-settings.js','app-solve.js','app-main.js'];
const key = 'toban_state_v2:/synthetic/month-text-preservation.html';
const rawRules = {profile:{id:'synthetic-month-text-preservation',roles:[{id:'S',label:'Staff',refs:[]}],shifts:[{id:'day',label:'Day',on:'all'},{id:'night',label:'Night',on:'all'}]},doctors:N.map(name=>({name,team:'S',quota:15})),rule_states:{oncall:'off'},weights:{}};
const rawMonth = {year:2026,month:11,notes:'Synthetic month text roundtrip'};
async function makeApp(saved, fixture=rawRules, defaults=fixture) {
  const dom = new JSDOM(source('index.html'), {url:'https://example.invalid/synthetic/month-text-preservation.html',runScripts:'outside-only'}), w=dom.window;
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
  return {dom,w,A,q,click,change,tick,errors};
}


let completed=false,passed=0,failed=0;
const expected=9;
process.on('exit',()=>{if(!completed || passed+failed!==expected){console.error('Incomplete collection cases');process.exitCode=1;}});
const watchdog=setTimeout(()=>{console.error('Collection timeout');process.exit(1);},120000);
async function imported(a,month){a.A.choose=async()=>"go";await a.A.loadJsonFile({name:'synthetic-collection.json',text:async()=>JSON.stringify({rules:clone(a.A.state.rules),month:{year:2026,month:11,next_first_day_in_calendar:true,...month},result:null})});}
async function test(name,fn){try{await fn();passed++;console.log('PASS '+name);}catch(e){failed++;console.error('FAIL '+name+' '+e.stack);}}
(async()=>{
const former='Synthetic Former Staff', original=[N[0],former,N[1]];
for(const state of ['soft','off'])for(const operation of ['duty','read','navigation'])await test(`${state} ${operation} preserves roster-missing wishes`,async()=>{const fixture=clone(rawRules);fixture.rule_states.wish_weekend_dayshift=state;const a=await makeApp(null,fixture);try{
await imported(a,{wishes:{weekend_dayshift:original}});assert(a.q('#btnPurgeUnknown'),'separate purge offered');
a.click('[data-sub="doctorPane"]');a.change('#docSel',N[0]);
if(operation==='duty')a.change('[data-cal="duty"][data-d="5"][data-part="am"]','ward');else if(operation==='navigation')a.click('#docNext');else a.A.readAll();
for(let i=0;i<3;i++){a.A.readAll();a.A.renderDoctor();assert.deepStrictEqual(clone(a.A.state.month.wishes.weekend_dayshift),original);}
const b=await makeApp(a.w.localStorage.getItem(key),fixture);try{assert.deepStrictEqual(clone(b.A.state.month.wishes.weekend_dayshift),original);}finally{await Promise.resolve();b.dom.window.close();}
assert.deepStrictEqual(a.errors,[]);
}finally{await Promise.resolve();a.dom.window.close();}});
await test('checkbox clear edits only selected person; Undo restores',async()=>{const fixture=clone(rawRules);fixture.rule_states.wish_weekend_dayshift='soft';const a=await makeApp(null,fixture);try{
await imported(a,{wishes:{weekend_dayshift:original}});a.click('[data-sub="doctorPane"]');a.change('#docSel',N[0]);a.A.clearUndo();a.change('#wkwish',false);a.A.readAll();assert.deepStrictEqual(clone(a.A.state.month.wishes.weekend_dayshift),[former,N[1]]);a.A.undo();a.A.readAll();assert.deepStrictEqual(clone(a.A.state.month.wishes.weekend_dayshift),original);
}finally{await Promise.resolve();a.dom.window.close();}});
for(const consent of [true,false])await test(`explicit unknown purge consent=${consent}`,async()=>{const a=await makeApp();try{await imported(a,{wishes:{weekend_dayshift:original}});let asked=0;a.w.confirm=()=>{asked++;return consent;};a.click('#btnPurgeUnknown');assert.strictEqual(asked,1);assert.deepStrictEqual(clone(a.A.state.month.wishes.weekend_dayshift),consent?[N[0],N[1]]:original);a.A.readAll();assert.deepStrictEqual(clone(a.A.state.month.wishes.weekend_dayshift),consent?[N[0],N[1]]:original);}finally{await Promise.resolve();a.dom.window.close();}});
assert.strictEqual(passed+failed,expected);completed=true;clearTimeout(watchdog);console.log(`collection DOM: ${passed} passed, ${failed} failed`);if(failed)process.exitCode=1;
})().catch(e=>{console.error(e);clearTimeout(watchdog);process.exitCode=1;});

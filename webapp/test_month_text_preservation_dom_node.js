// Preserve current-month memo and day-note source text through ordinary local readback.
// Actual markup, init, JSON import, delegated monthly input events,
// Problem and localStorage. Fictional data only; jsdom supplies the DOM.
// No browser, layout, OS permissions or network test is claimed; no sockets are opened.
// Run: TOBAN_DOM_MODULE=/path/to/node_modules/jsdom node test_month_text_preservation_dom_node.js
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
const expected=40;
process.on('exit',()=>{if(!completed || passed+failed!==expected){console.error('Incomplete month text cases');process.exitCode=1;}});
const watchdog=setTimeout(()=>{console.error('Month text timeout');process.exit(1);},120000);
const projection=a=>clone({notes:a.A.state.month.notes,day_notes:a.A.state.month.day_notes});
async function imported(a,month){a.A.choose=async(_message,choices)=>{assert(choices.some(x=>x.value==="go"));return "go";};await a.A.loadJsonFile({name:'synthetic-month.json',text:async()=>JSON.stringify({rules:clone(a.A.state.rules),month:{year:2026,month:11,...month},result:null})});}
async function test(name,fn){try{await fn();passed++;console.log('PASS '+name);}catch(e){failed++;console.error('FAIL '+name+' '+e.stack);}}
(async()=>{
 const values=['Synthetic\nmeeting','Synthetic\rmeeting','Synthetic\r\nmeeting','\nSynthetic meeting','  Synthetic meeting  ','Synthetic\0meeting','\r\n',''];
 for(const lang of ['en','ja']) for(const field of ['notes','day_notes']) for(const value of values) await test(`${lang} ${field} ${JSON.stringify(value)} import/read/redraw/reload`,async()=>{
  const a=await makeApp();try{
   a.w.T.setLang(lang); const month={notes:'Synthetic memo',day_notes:{5:'Synthetic day',6:'Independent note'}};
   if(field==='notes')month.notes=value;else month.day_notes[5]=value;
   await imported(a,month);assert.deepStrictEqual(projection(a),month,'supported JSON import retains source');
   const expectedSemantics=clone(new a.w.T.Problem(a.A.state.rules,a.A.state.month).dayNotes);
   a.change('[data-path="holidays"]','3');
   assert.deepStrictEqual(projection(a),month,'unrelated edit preserves source text');
   assert.deepStrictEqual(clone(a.A.state.month.holidays),[3],'unrelated edit remains writable');
   for(let i=0;i<3;i++){a.A.readAll();a.A.renderSettingsMonth();assert.deepStrictEqual(projection(a),month);}
   assert.deepStrictEqual(clone(new a.w.T.Problem(a.A.state.rules,a.A.state.month).dayNotes),expectedSemantics,'effective day note content remains unchanged');
   const serialized=a.A.payloadJson();assert.deepStrictEqual(JSON.parse(serialized).month.notes,month.notes);
   const b=await makeApp(a.w.localStorage.getItem(key));try{b.A.readAll();assert.deepStrictEqual(projection(b),month);assert.deepStrictEqual(b.errors,[]);}finally{await Promise.resolve();b.dom.window.close();}
   assert.deepStrictEqual(a.errors,[]);
  }finally{await Promise.resolve();a.dom.window.close();}
 });
 for(const field of ['notes','day_notes'])for(const kind of ['change','input'])await test(`${field} explicit ${kind} edit/clear and local Undo`,async()=>{
  const a=await makeApp();try{
   const original={notes:'\nSynthetic\r\nmemo',day_notes:{5:'Synthetic\nmeeting',6:'Independent note'}};await imported(a,original);a.A.clearUndo();
   const selector=field==='notes'?'[data-path="notes"]':'[data-dnote="5"]';
   const edit=async v=>{const el=a.q(selector);el.value=v;el.dispatchEvent(new a.w.Event(kind,{bubbles:true}));if(kind==='input')a.A.readAll();await a.tick();};
   await edit('Edited synthetic text');assert.strictEqual(field==='notes'?a.A.state.month.notes:a.A.state.month.day_notes[5],'Edited synthetic text');
   a.A.readAll();a.A.renderSettingsMonth();await edit('');assert.strictEqual(field==='notes'?a.A.state.month.notes:a.A.state.month.day_notes[5],field==='notes'?null:undefined);
   a.A.readAll();a.A.renderSettingsMonth();assert.strictEqual(field==='notes'?a.A.state.month.notes:a.A.state.month.day_notes[5],field==='notes'?null:undefined);
   assert.strictEqual(a.A.state.month.day_notes[6],original.day_notes[6]);
   if(kind==='change'){a.A.undo();assert.strictEqual(field==='notes'?a.A.state.month.notes:a.A.state.month.day_notes[5],'Edited synthetic text');a.A.undo();assert.deepStrictEqual(projection(a),original);a.A.readAll();assert.deepStrictEqual(projection(a),original);}
   assert.deepStrictEqual(a.errors,[]);
  }finally{await Promise.resolve();a.dom.window.close();}
 });
 for(const field of ['notes','day_notes'])await test(`${field} visually blank imported newline can be explicitly cleared`,async()=>{
  const a=await makeApp();try{await imported(a,{notes:field==='notes'?'\n':'Other',day_notes:{5:field==='day_notes'?'\n':'Other'}});a.change(field==='notes'?'[data-path="notes"]':'[data-dnote="5"]','');assert.strictEqual(field==='notes'?a.A.state.month.notes:a.A.state.month.day_notes[5],field==='notes'?null:undefined);}finally{await Promise.resolve();a.dom.window.close();}
 });
 await test('newly entered multiline memo survives holiday redraw',async()=>{const a=await makeApp();try{const value='\nSynthetic new memo\nSecond line';a.change('[data-path="notes"]',value);a.change('[data-path="holidays"]','3');a.A.readAll();assert.strictEqual(a.A.state.month.notes,value);}finally{await Promise.resolve();a.dom.window.close();}});
 await test('unrepresented day-note keys survive unrelated edits',async()=>{const a=await makeApp();try{await imported(a,{notes:'Synthetic memo',day_notes:{5:'Visible',31:'Outside current month'}});a.change('[data-path="holidays"]','3');assert.strictEqual(a.A.state.month.day_notes[31],'Outside current month');}finally{await Promise.resolve();a.dom.window.close();}});
 assert.strictEqual(passed+failed,expected);completed=true;clearTimeout(watchdog);console.log(`month text DOM: ${passed} passed, ${failed} failed`);if(failed)process.exitCode=1;
})().catch(e=>{console.error(e);clearTimeout(watchdog);process.exitCode=1;});

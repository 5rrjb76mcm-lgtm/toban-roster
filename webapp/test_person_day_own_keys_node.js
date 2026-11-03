// C03 static candidate: authored, NOT executed. No package installation or skips.
// Whole-source negative control: TOBAN_WEBAPP_ROOT=/absolute/baseline/webapp node this-file.js
const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert');
const ROOT = path.resolve(process.env.TOBAN_WEBAPP_ROOT || __dirname);
console.log('SOURCE_ROOT ' + ROOT);
const src = f => fs.readFileSync(path.join(ROOT, 'src', f), 'utf8');
const data = f => JSON.parse(fs.readFileSync(path.join(ROOT, 'data', f), 'utf8'));
const clone = x => JSON.parse(JSON.stringify(x));
let JSDOM;
for (const name of [process.env.TOBAN_DOM_MODULE, 'jsdom', path.join(process.env.HOME || '', '.toban-test/node_modules/jsdom')].filter(Boolean)) {
  try { ({JSDOM} = require(name)); break; } catch (e) { if (e.code !== 'MODULE_NOT_FOUND') throw e; }
}
if (!JSDOM) throw new Error('Requires installed jsdom 26.1.0; set TOBAN_DOM_MODULE. No installation/skip.');
const ruleFiles = fs.readdirSync(path.join(ROOT, 'src/rules')).filter(f => f.endsWith('.js')).sort().map(f => 'rules/' + f);
const scripts = ['i18n.js','rules-core.js','model.js', ...fs.readdirSync(path.join(ROOT,'src/calendars')).filter(f=>f.endsWith('.js')).sort().map(f=>'calendars/'+f),
  'messages.js','solver.js','check.js','report.js','docxgen.js','plugins.js','merge.js',...ruleFiles,'app-core.js','app-folder.js','app-month.js','app-input.js','app-settings.js','app-solve.js','app-main.js'];
const ids = ['__proto__','constructor','toString','local.pref','review_kind',':'];
const rules = data('rules.json'), owner = rules.doctors[0].name; // Fictional distributed roster only.
const tree = (id, values = {5:'active',6:0,7:true}) => Object.fromEntries([[id, {[owner]:values}]]);
const fixture = id => Object.assign(data('202611.json'), {person_days:tree(id),next_first_day_in_calendar:true});
const own = (o,k) => Object.prototype.hasOwnProperty.call(o,k);
const checkTree = (m,id,expected) => { assert(own(m.person_days,id),'own field '+id); assert(own(m.person_days[id],owner)); assert.deepStrictEqual(clone(m.person_days),expected); };
// Snapshot descriptors, not JSON: detect additions to both prototypes and inherited functions.
const snapshotCode = '[Object.prototype, Object, Object.prototype.toString].map(x => Object.getOwnPropertyDescriptors(x))';
function realm(id) {
  const c = vm.createContext({console,setTimeout,clearTimeout,Blob,URL,location:{pathname:'/synthetic/own-fields.html'},
    document:{querySelector:()=>null,querySelectorAll:()=>[],addEventListener(){}},localStorage:{getItem:()=>null,setItem(){},removeItem(){}}});
  vm.runInContext('globalThis.T = {}',c);
  for (const f of ['i18n.js','rules-core.js','model.js','messages.js','check.js','plugins.js','merge.js',...ruleFiles,'app-core.js','app-folder.js']) vm.runInContext(src(f),c,{filename:f});
  const R = vm.runInContext('JSON.parse('+JSON.stringify(JSON.stringify(rules))+')',c);
  c.T.fillDefaultRules(R);
  const M = c.T.normalizeMonth(vm.runInContext('JSON.parse('+JSON.stringify(JSON.stringify(fixture(id)))+')',c),R);
  const before = vm.runInContext(snapshotCode,c);
  return {c,R,M,done(){clearTimeout(c.T.app.autosaveTimer);assert.deepStrictEqual(vm.runInContext(snapshotCode,c),before,'no prototype/function mutation');}};
}
async function autosave(x,id) {
  const {c,R,M}=x,A=c.T.app, files={},writes=[],choices=[];
  for(const k of ['renderHeader','renderAll','readAll','toast','showTab','clearUndo']) A[k]=()=>{};
  const dir={name:'Synthetic own fields',async getDirectoryHandle(){return dir;},async getFileHandle(n,opt={}){
    if(!opt.create && !own(files,n))throw Object.assign(new Error('missing'),{name:'NotFoundError'});
    return {async getFile(){return {async text(){return files[n];}};},async createWritable(){return {async write(b){files[n]=typeof b==='string'?b:await b.text();writes.push(n);},async close(){}};}};
  }};
  Object.assign(A.state,{rules:R,month:M,result:null,ui:{},meta:null,base:null,baseRules:null,renames:[]});
  A.dirHandle=dir;A.dirGen++;A.monthDirs=['202611'];A.markSaved(undefined,'2026-10-01T00:00:00Z');
  const peer=JSON.parse(A.payloadJson('2026-10-02T00:00:00Z'));peer.month.day_notes[7]='Synthetic peer note';files['202611_data.json']=JSON.stringify(peer);
  A.state.month.notes='Synthetic local note';A.choose=async(msg,opts)=>{choices.push([msg,opts]);return null;};
  assert.strictEqual(await A.autosaveJson(),'saved');assert.strictEqual(choices.length,0);
  const saved=JSON.parse(files['202611_data.json']);checkTree(saved.month,id,tree(id));checkTree(A.state.month,id,tree(id));
  assert.equal(saved.month.notes,'Synthetic local note');assert.equal(saved.month.day_notes[7],'Synthetic peer note');assert(writes.includes('202611_data.json'));assert.equal(A.isDirty(),false);
}
const storageKey='toban_state_v2:/synthetic/own-fields.html';
async function app(id,saved) {
  const dom=new JSDOM(src('index.html'),{url:'https://example.invalid/synthetic/own-fields.html',runScripts:'outside-only'}),w=dom.window;
  await new Promise(r=>w.document.readyState==='complete'?r():w.addEventListener('load',r,{once:true}));
  const errors=[];w.addEventListener('error',e=>{errors.push(String(e.error||e.message));e.preventDefault();});w.confirm=()=>true;w.alert=m=>{throw new Error(m);};w.prompt=()=>null;
  const month=fixture(id);month.person_days={};
  w.T={DEFAULT_RULES:clone(rules),SAMPLE_MONTH:month,PROFILES:[],LANGS_DATA:['en','ja'].map(code=>JSON.parse(fs.readFileSync(path.join(ROOT,'lang',code+'.json'),'utf8')))};
  for(const f of scripts)w.eval(src(f)+'\n//# sourceURL='+f);
  const A=w.T.app;A.restoreFolder=()=>{};w.localStorage.setItem('toban.lang','en');if(saved)w.localStorage.setItem(storageKey,saved);w.T.init();
  w.T.calendarExt.register({id:'local.synthetic.own_fields',fields:[{id,label:'Synthetic field',options:[['active','Active'],['other','Other']]}]});
  const before=w.eval(snapshotCode),q=s=>w.document.querySelector(s),change=(el,value)=>{el.value=value;el.dispatchEvent(new w.Event('change',{bubbles:true}));};
  const calendar=()=>{q('.tab[data-tab="input"]').click();q('.sub[data-sub="doctorPane"]').click();change(q('#docSel'),owner);};
  return {w,A,q,change,calendar,async done(){try{assert.deepStrictEqual(w.eval(snapshotCode),before,'no prototype/function mutation');assert.deepStrictEqual(errors,[]);}finally{dom.window.close();}}};
}
const cases=[];
for(const id of ids){
  cases.push(['roundtrip '+id,async()=>{const x=realm(id);try{
    const T=x.c.T, expected=tree(id);checkTree(x.M,id,expected);assert.strictEqual(new T.Problem(x.R,x.M).personDay(id,owner,6),0);
    for(const template of [undefined,x.M]){const back=T.unflattenMonth(T.flattenMonth(x.M),template);checkTree(back,id,expected);checkTree(JSON.parse(JSON.stringify(back)),id,expected);assert.strictEqual(Object.getPrototypeOf(back.person_days),vm.runInContext('Object.prototype',x.c));}
    const empty=clone(x.M);Object.assign(empty.person_days[id][owner],{8:false,9:null,10:''});checkTree(T.unflattenMonth(T.flattenMonth(empty)),id,expected);
  }finally{x.done();}}]);
  cases.push(['merge conflict/delete '+id,async()=>{const x=realm(id);try{
    const T=x.c.T,b=x.M,m=clone(b),t=clone(b);m.person_days[id][owner][5]='mine';t.person_days[id][owner][5]='peer';
    for(const preference of ['mine','theirs']){const r=T.mergeMonth(b,m,t,preference);assert.equal(r.conflicts.length,1);checkTree(r.merged,id,tree(id,{5:preference==='mine'?'mine':'peer',6:0,7:true}));}
    const gone=clone(b);delete gone.person_days[id][owner][5];const conflict=T.mergeMonth(b,gone,t,'mine');assert.equal(conflict.conflicts.length,1);checkTree(conflict.merged,id,tree(id,{6:0,7:true}));
    const peer=clone(b);peer.notes='Synthetic peer';const deleted=T.mergeMonth(b,gone,peer);assert.equal(deleted.conflicts.length,0);checkTree(deleted.merged,id,tree(id,{6:0,7:true}));
  }finally{x.done();}}]);
  cases.push(['folder autosave '+id,async()=>{const x=realm(id);try{await autosave(x,id);}finally{x.done();}}]);
  cases.push(['DOM new edit/reload/Undo '+id,async()=>{const a=await app(id);try{
    a.calendar();a.A.clearUndo();const selector='[data-cal="pfield"][data-d="5"]';a.change(a.q(selector),'active');checkTree(a.A.state.month,id,tree(id,{5:'active'}));
    a.A.readAll();a.A.readAll();checkTree(JSON.parse(a.A.payloadJson()).month,id,tree(id,{5:'active'}));
    const saved=a.w.localStorage.getItem(storageKey);assert(saved);const b=await app(id,saved);try{b.calendar();b.A.readAll();checkTree(b.A.state.month,id,tree(id,{5:'active'}));}finally{await b.done();}
    a.A.undo();assert(!own(a.A.state.month.person_days,id),'Undo restores missing field');a.calendar();a.change(a.q(selector),'other');a.change(a.q(selector),'');assert(!own(a.A.state.month.person_days[id],owner),'explicit clear removes own person');
    Object.defineProperty(a.A.state.month.person_days,id,{value:null,enumerable:true,writable:true,configurable:true});a.A.renderDoctor();a.change(a.q(selector),'active');checkTree(a.A.state.month,id,tree(id,{5:'active'}));
  }finally{await a.done();}}]);
}
const EXPECTED_CASES=24;let passed=0,failed=0,completed=0,finished=false;
for(const [label] of cases)console.log('REGISTER '+label);
const watchdog=setTimeout(()=>{console.error('TIMEOUT own fields');process.exit(1);},120000);
process.on('exit',()=>{if(!finished||completed!==EXPECTED_CASES||passed!==EXPECTED_CASES||failed){console.error(`INCOMPLETE own fields ${passed}/${EXPECTED_CASES}; completed=${completed}; failed=${failed}`);process.exitCode=1;}});
(async()=>{assert.equal(cases.length,EXPECTED_CASES);for(const [label,fn] of cases){console.log('CASE_START '+label);try{await fn();passed++;console.log('PASS '+label);}catch(e){failed++;console.error('FAIL '+label,e.stack||e);}finally{completed++;console.log('CASE_END '+label);}}finished=true;clearTimeout(watchdog);console.log(`Own fields: ${passed}/${EXPECTED_CASES}; failed=${failed}`);if(failed)process.exitCode=1;})().catch(e=>{console.error(e);clearTimeout(watchdog);process.exitCode=1;});

// Full production entry DOM adapter: index.html, all apps, T.init and bound input/save events.
// Synthetic File System Access handles; no real browser, permissions, layout or network claim.
// Run: TOBAN_DOM_MODULE=/installed/node_modules/jsdom node test_save_catalog_dom_node.js
const fs = require('fs'), path = require('path'), assert = require('assert');
let JSDOM;
for (const name of [process.env.TOBAN_DOM_MODULE, 'jsdom', path.join(process.env.HOME || '', '.toban-test/node_modules/jsdom')].filter(Boolean)) {
  try { ({ JSDOM } = require(name)); break; } catch (e) { if (e.code !== 'MODULE_NOT_FOUND') throw e; }
}
if (!JSDOM) throw new Error('Save catalog DOM regression requires jsdom 26.1.0. Set TOBAN_DOM_MODULE to its installed path. This test was NOT run.');
const source = f => fs.readFileSync(f === 'app-folder.js' && process.env.TOBAN_SAVE_FOLDER_SOURCE || path.join(__dirname, 'src', f), 'utf8');
const scripts = ['i18n.js','rules-core.js','model.js', ...fs.readdirSync(path.join(__dirname,'src/calendars')).filter(f=>f.endsWith('.js')).sort().map(f=>'calendars/'+f),
  'messages.js','solver.js','check.js','report.js','docxgen.js','plugins.js','merge.js', ...fs.readdirSync(path.join(__dirname,'src/rules')).filter(f=>f.endsWith('.js')).sort().map(f=>'rules/'+f),
  'app-core.js','app-folder.js','app-month.js','app-input.js','app-settings.js','app-solve.js','app-main.js'];
const clone = x => JSON.parse(JSON.stringify(x));
const rules = {profile:{id:'synthetic-save',roles:[{id:'S',label:'Staff',refs:[]}],shifts:[{id:'day',on:'all'},{id:'night',on:'all'}]},doctors:[{name:'Synthetic Alpha',team:'S',quota:20}],rule_states:{},weights:{}};
const month = {year:2026,month:11,next_first_day_in_calendar:true,notes:'Synthetic initial draft'};
const missing = () => Object.assign(new Error('Synthetic missing'), {name:'NotFoundError'});
function memoryFolder() {
  const dirs = new Map(), files = new Map();
  const root = {name:'Synthetic empty folder',kind:'directory',dirs,files,fail:false,beforeClose:null,
    async *entries(){yield* dirs;},
    async getDirectoryHandle(n,o={}) { if(!dirs.has(n)){if(!o.create)throw missing();dirs.set(n,{name:n,kind:'directory',files:new Map(),getFileHandle(n,o={}){return file(this.files,n,o);}});}return dirs.get(n); },
    async getFileHandle(n,o={}){return file(files,n,o);}
  };
  async function file(files,n,o){if(!o.create&&!files.has(n))throw missing();return {getFile:async()=>({text:async()=>files.get(n)}),createWritable:async()=>{let text;return {
    async write(blob){text=typeof blob==='string'?blob:await blob.text();},async close(){if(root.beforeClose)await root.beforeClose();if(root.fail)throw new Error('Synthetic close denied');files.set(n,text);}
  };}};}
  return root;
}
async function makeApp(){
  const dom=new JSDOM(source('index.html'),{url:'https://example.invalid/synthetic/save-catalog.html',runScripts:'outside-only'}),w=dom.window;
  await new Promise(r=>w.document.readyState==='complete'?r():w.addEventListener('load',r,{once:true}));
  const errors=[];w.addEventListener('error',e=>{errors.push(e.error||e.message);e.preventDefault();});
  w.Blob=globalThis.Blob;w.confirm=()=>true;w.alert=msg=>{throw new Error(msg);};w.prompt=()=>null;
  w.T={DEFAULT_RULES:clone(rules),SAMPLE_MONTH:clone(month),PROFILES:[],LANGS_DATA:[JSON.parse(fs.readFileSync(path.join(__dirname,'lang/ja.json'),'utf8'))]};
  for(const f of scripts)w.eval(source(f)+'\n//# sourceURL='+f);
  const A=w.T.app;A.restoreFolder=()=>{}; // OS folder picker/start gate only, not save/render/input code.
  A.toast=()=>{};w.localStorage.setItem('toban.lang','ja');w.T.init();
  const root=memoryFolder();A.dirHandle=root;A.dirGen++;await A.refreshMonths();
  let scheduled=null;const nativeTimer=w.setTimeout.bind(w);w.setTimeout=(fn,delay,...args)=>{if(delay===3000){scheduled=fn;return 12345;}return nativeTimer(fn,delay,...args);};
  const q=s=>w.document.querySelector(s);
  const change=value=>{const notes=q('#monthSettings [data-path="notes"]');assert(notes);notes.value=value;notes.dispatchEvent(new w.Event('change',{bubbles:true}));};
  return {dom,w,A,root,q,change,errors,runTimer:()=>{assert(scheduled,'bound edit schedules autosave');const fn=scheduled;scheduled=null;return fn();}};
}
// The run must reach its end: an awaited step that never settles would otherwise end the process with status 0.
const EXPECTED_CASES=5;let cases=0,finished=false;
process.on('exit',()=>{if((!finished||cases!==EXPECTED_CASES)&&!process.exitCode){console.error('NOT COMPLETED: '+cases+'/'+EXPECTED_CASES+' cases passed, finished='+finished);process.exitCode=1;}});
(async()=>{
  for(const mode of ['auto','header']){
    const app=await makeApp(),{dom,A,root,q,change,errors}=app;
    try{
      assert.strictEqual(root.dirs.size,0);assert.match(q('#monthSel').selectedOptions[0].textContent,/未保存/);
      change('Synthetic edited through real textarea');assert.strictEqual(A.state.month.notes,'Synthetic edited through real textarea');assert.strictEqual(q('#saveState').className,'dirty');
      // The header is published after the write (how many times is an implementation detail: a manual save also lists the folder again).
      // What must hold: the list and the save state are right, and the field being edited keeps its focus and its text.
      const notes=q('#monthSettings [data-path="notes"]');notes.focus();assert.strictEqual(dom.window.document.activeElement,notes);
      let renders=0;const observer=new dom.window.MutationObserver(records=>{renders+=records.length;});root.beforeClose=async()=>observer.observe(q('#monthTitle'),{childList:true});
      if(mode==='auto')assert.strictEqual(await app.runTimer(),'saved');else{q('#btnHeaderSave').click();await A.awaitSaves();}
      await Promise.resolve();observer.disconnect();root.beforeClose=null;assert.ok(renders>=1,'successful current-month write publishes the header');
      assert.strictEqual(dom.window.document.activeElement,notes,'the edited field keeps focus through the save');assert.strictEqual(notes.value,'Synthetic edited through real textarea');assert.deepStrictEqual([...A.monthDirs],['202611']);
      assert.strictEqual(q('#monthSel').value,'202611');assert.doesNotMatch(q('#monthSel').selectedOptions[0].textContent,/未保存/);
      assert.strictEqual(q('#saveState').className,'saved');assert.strictEqual(A.isDirty(),false);
      assert.strictEqual([...q('#monthSel').options].filter(o=>o.value==='202611').length,1);
      const data=JSON.parse(root.dirs.get('202611').files.get('202611_data.json'));assert.strictEqual(data.month.notes,'Synthetic edited through real textarea');assert.strictEqual(data.month.month,11);
      change('Synthetic repeated edit');if(mode==='auto')await app.runTimer();else{q('#btnHeaderSave').click();await A.awaitSaves();}
      assert.strictEqual(JSON.parse(root.dirs.get('202611').files.get('202611_data.json')).month.notes,'Synthetic repeated edit');
      assert.strictEqual([...q('#monthSel').options].filter(o=>o.value==='202611').length,1);assert.deepStrictEqual(errors,[]);
      cases++;console.log('PASS full production init + bound textarea + '+mode+' save to truly empty folder');
    }finally{dom.window.close();}
  }
  {const app=await makeApp(),{dom,A,root,q,change,errors}=app;try{
    root.fail=true;change('Synthetic retained after denied close');assert.strictEqual(await app.runTimer(),'failed');
    assert.match(q('#monthSel').selectedOptions[0].textContent,/未保存/);assert.strictEqual(q('#saveState').className,'dirty');assert.strictEqual(A.isDirty(),true);assert.strictEqual(q('[data-path="notes"]').value,'Synthetic retained after denied close');assert.deepStrictEqual(errors,[]);
    cases++;console.log('PASS failed real-entry save keeps draft and unsaved selector');
  }finally{dom.window.close();}}
  {const app=await makeApp(),{dom,A,root,q,change,errors}=app;try{
    let entered,release;const started=new Promise(r=>{entered=r;}),gate=new Promise(r=>{release=r;});
    root.beforeClose=async()=>{entered();await gate;};change('Synthetic snapshot before write');
    const saving=app.runTimer();await started;change('Synthetic newer live draft');release();assert.strictEqual(await saving,'saved');
    assert.strictEqual(JSON.parse(root.dirs.get('202611').files.get('202611_data.json')).month.notes,'Synthetic snapshot before write');
    assert.strictEqual(q('[data-path="notes"]').value,'Synthetic newer live draft');assert.strictEqual(A.state.month.notes,'Synthetic newer live draft');
    assert.strictEqual(A.isDirty(),true);assert.strictEqual(q('#saveState').className,'dirty');assert.doesNotMatch(q('#monthSel').selectedOptions[0].textContent,/未保存/);assert.deepStrictEqual(errors,[]);
    cases++;console.log('PASS real textarea edit during close stays dirty while saved month enters selector');
  }finally{dom.window.close();}}
  {const app=await makeApp(),{dom,A,root,q,change,errors}=app;try{
    change('Synthetic first save');q('#btnHeaderSave').click();await A.awaitSaves();assert.deepStrictEqual([...A.monthDirs],['202611']);
    // Another window (or PC) saves December into the same folder.
    const dec=await root.getDirectoryHandle('202612',{create:true});dec.files.set('202612_data.json',JSON.stringify({rules:A.state.rules,month:{year:2026,month:12,notes:'Synthetic other window'},result:null,saved_at:'2026-10-02T00:00:00.000Z'}));
    const notes=q('#monthSettings [data-path="notes"]');notes.focus();change('Synthetic edit while another window saved December');
    q('#btnHeaderSave').click();await A.awaitSaves();
    assert.deepStrictEqual([...A.monthDirs],['202611','202612'],'the manual save lists the folder again');
    const decOption=[...q('#monthSel').options].filter(o=>o.value==='202612');assert.strictEqual(decOption.length,1);assert.doesNotMatch(decOption[0].textContent,/未保存|作成/,'December is offered as a saved month');
    assert.strictEqual(q('#monthSel').value,'202611');assert.doesNotMatch(q('#monthSel').selectedOptions[0].textContent,/未保存/);assert.strictEqual(q('#saveState').className,'saved');assert.strictEqual(A.isDirty(),false);
    assert.strictEqual(dom.window.document.activeElement,notes,'the edited field keeps focus');assert.strictEqual(notes.value,'Synthetic edit while another window saved December');
    assert.strictEqual(JSON.parse(root.dirs.get('202611').files.get('202611_data.json')).month.notes,'Synthetic edit while another window saved December');assert.deepStrictEqual(errors,[]);
    cases++;console.log('PASS manual save lists a month saved by another window; focus and text of the edited field are kept');
  }finally{dom.window.close();}}
  console.log(cases+'/'+EXPECTED_CASES+' full-entry DOM save cases passed');finished=true;
})().catch(e=>{console.error(e.stack);process.exitCode=1;});

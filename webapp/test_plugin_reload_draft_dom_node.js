// C03: real markup, events, read hooks and reload button. Synthetic handles; not a real browser test.
// No execution is claimed by this source. Local Claude must run baseline/fixed/group-revert.
const fs = require('fs'), path = require('path'), assert = require('assert');
// Targets existing jsdom 26.1.0. This new regression has not been executed. No downloads/installations.
let JSDOM;
for (const name of [process.env.TOBAN_DOM_MODULE, 'jsdom', path.join(process.env.HOME || '', '.toban-test/node_modules/jsdom')].filter(Boolean)) {
  try { ({ JSDOM } = require(name)); break; } catch (e) { if (e.code !== 'MODULE_NOT_FOUND') throw e; }
}
if (!JSDOM) throw new Error('Plug-in reload draft DOM-adapter regression requires jsdom 26.1.0. Set TOBAN_DOM_MODULE to its installed module path. This test was NOT run.');
const N = ['Synthetic Trainer', 'Synthetic Colleague'], clone = x => JSON.parse(JSON.stringify(x));
const root = process.env.TOBAN_SOURCE_ROOT || __dirname;
const source = f => fs.readFileSync(path.join(root, 'src', f), 'utf8');
const scripts = ['i18n.js','rules-core.js','model.js', ...fs.readdirSync(path.join(root,'src/calendars')).filter(f=>f.endsWith('.js')).sort().map(f=>'calendars/'+f),
  'messages.js','solver.js','check.js','report.js','docxgen.js','plugins.js','merge.js', ...fs.readdirSync(path.join(root,'src/rules')).filter(f=>f.endsWith('.js')).sort().map(f=>'rules/'+f),
  'app-core.js','app-folder.js','app-month.js','app-input.js','app-settings.js','app-solve.js','app-main.js'];
const key = 'toban_state_v2:/synthetic/plugin-reload-draft.html';
const rawRules = {profile:{id:'synthetic-plugin-reload-draft',roles:[{id:'S',label:'Staff',refs:[]}],shifts:[{id:'day',on:'all'},{id:'night',on:'all'}]},doctors:N.map(name=>({name,team:'S',quota:15})),rule_states:{oncall:'off'},weights:{}};
const rawMonth = {year:2026,month:11,notes:'before'};
async function makeApp(saved, fixture=rawRules, defaults=fixture) {
  const dom = new JSDOM(source('index.html'), {url:'https://example.invalid/synthetic/plugin-reload-draft.html',runScripts:'outside-only'}), w=dom.window;
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
const nf=()=>Object.assign(new Error('synthetic missing'),{name:'NotFoundError'});
function gate(){let enter,release;return {entered:new Promise(r=>enter=r),wait:new Promise(r=>release=r),enter,release};}
function folder(g,mode='file',code=''){
 return {name:'synthetic-reload',async getDirectoryHandle(name){
  assert.equal(name,'plugins');g.enter();await g.wait;
  if(mode==='missing')throw nf();if(mode==='error')throw new Error('synthetic permission failure');
  return {async getDirectoryHandle(kind){if(kind!=='rules'||mode==='empty')throw nf();return {async *entries(){yield ['same.js',{kind:'file',getFile:async()=>({text:async()=>code})}];}};}};
 }};
}
async function begin(a,mode='file',code=''){
 const g=gate();a.A.dirHandle=folder(g,mode,code);a.A.dirGen++;a.enter();
 const real=a.A.loadFolderPlugins;let pending;a.A.loadFolderPlugins=(...args)=>(pending=real(...args));
 a.click('#btnReloadPlugins');await g.entered;
 return {release:async()=>{g.release();await pending;await a.tick();a.A.loadFolderPlugins=real;}};
}
const monthPane=a=>{a.click('.tab[data-tab="input"]');a.click('.sub[data-sub="monthSettings"]');};
function draft(a,selector,value){const el=a.q(selector);assert(el,selector);el.focus();el.value=value;el.dispatchEvent(new a.w.Event('input',{bubbles:true}));assert.strictEqual(a.w.document.activeElement,el);return el;}
async function finish(a){await a.tick();a.w.clearTimeout(a.A.autosaveTimer);a.dom.window.close();}
const cases=[],test=(name,fn)=>cases.push({name,fn});
for(const mode of ['file','empty','missing','error'])test('unblurred note survives '+mode+' reload',async()=>{
 const a=await makeApp();try{if(mode==='empty'||mode==='missing'){assert(a.w.T.plugins.load('rules','rules/same.js',"T.rules.register({id:'local.same',api:1,label:'Synthetic',states:['hard','off'],def:'hard',solve(){},check(){},penalty(){}});").ok);a.w.T.fillDefaultRules(a.A.state.rules);a.A.renderAll();} // 前のフォルダの規則がある状態で空/不存在の plugins/ を読み直す（置き換えが起きる場合だけ再描画する）
 const loading=await begin(a,mode);monthPane(a);draft(a,'[data-path="notes"]','draft '+mode);assert.equal(a.A.state.month.notes,'before','input has not fired change');await loading.release();
 assert.equal(a.A.state.month.notes,'draft '+mode);assert.equal(a.q('[data-path="notes"]').value,'draft '+mode);assert.equal(JSON.parse(a.w.localStorage.getItem(key)).month.notes,'draft '+mode);assert.equal(a.A.switching,0);
 assert.equal(a.w.T.plugins.errors().length,mode==='error'?1:0);a.A.undo();assert.equal(a.A.state.month.notes,'before','draft flush participates in Undo');assert.deepStrictEqual(a.errors,[]);
 }finally{await finish(a);}
});
const plug=(marker,keyName)=>`T.rules.register({id:'local.capture',api:1,label:'Synthetic input',states:['hard','off'],def:'hard',marker:${JSON.stringify(marker)},ui:{month:{render(R,m){return '<input id="syntheticPluginText" value="'+T.esc(m.local_capture||'old')+'">';},read(m,box){m[${JSON.stringify(keyName)}]=box.querySelector('input').value;}}},solve(){},check(){},penalty(){}});`;
test('old month read hook captures draft before replacement',async()=>{
 const a=await makeApp();try{assert(a.w.T.plugins.load('rules','rules/same.js',plug('old','local_capture')).ok);a.w.T.fillDefaultRules(a.A.state.rules);a.A.renderAll();const loading=await begin(a,'file',plug('new','local_wrong_hook'));monthPane(a);draft(a,'#syntheticPluginText','captured by old hook');await loading.release();assert.equal(a.A.state.month.local_capture,'captured by old hook');assert.equal(a.A.state.month.local_wrong_hook,undefined);assert.equal(a.w.T.RULE_BY_ID['local.capture'].marker,'new');assert.equal(a.q('#syntheticPluginText').value,'captured by old hook');assert.deepStrictEqual(a.errors,[]);}finally{await finish(a);}
});
test('focused settings number commits before repaint',async()=>{const a=await makeApp();try{const before=a.A.state.rules.doctors[0].years;const loading=await begin(a);const el=draft(a,'#doctorTable tr[data-i="0"] [data-f="years"]','12');assert.equal(el.dataset.numericEdited,'1');await loading.release();assert.equal(a.A.state.rules.doctors[0].years,12);assert.equal(a.q('#doctorTable tr[data-i="0"] [data-f="years"]').value,'12');a.A.undo();assert.equal(a.A.state.rules.doctors[0].years,before,'settings Undo restores rules too');assert.deepStrictEqual(a.errors,[]);}finally{await finish(a);}});
test('unapplied JSON draft is retained but never auto-applied',async()=>{const a=await makeApp();try{const loading=await begin(a);const json=clone(a.A.state.rules);json.profile.id='do-not-apply';const text=JSON.stringify(json,null,2);draft(a,'#rulesJson',text);await loading.release();assert.equal(a.q('#rulesJson').value,text);assert.notEqual(a.A.state.rules.profile.id,'do-not-apply');assert.strictEqual(a.w.document.activeElement,a.q('#rulesJson'));assert.deepStrictEqual(a.errors,[]);}finally{await finish(a);}});
test('rejected settings flush does not repaint pending input',async()=>{const a=await makeApp();try{const loading=await begin(a);const el=draft(a,'#doctorTable tr[data-i="0"] [data-f="years"]','12');const real=a.A.readSettings;a.A.readSettings=()=>false;await loading.release();assert.strictEqual(a.q('#doctorTable tr[data-i="0"] [data-f="years"]'),el);assert.equal(el.value,'12');assert.equal(a.A.pluginsPending,true);assert.equal(a.w.T.plugins.errors().length,1);assert.equal(a.A.switching,0);a.A.readSettings=real;assert.deepStrictEqual(a.errors,[]);}finally{await finish(a);}});
test('untouched notes remain unchanged (control)',async()=>{const a=await makeApp();try{const loading=await begin(a,'empty');monthPane(a);await loading.release();assert.equal(a.A.state.month.notes,'before');assert.equal(a.q('[data-path="notes"]').value,'before');assert.deepStrictEqual(a.errors,[]);}finally{await finish(a);}});
test('hidden JSON draft survives reload commit (not later tab re-entry)',async()=>{const a=await makeApp();try{const loading=await begin(a);const text='{"unapplied":"synthetic hidden draft"}';draft(a,'#rulesJson',text);monthPane(a);await loading.release();assert.equal(a.q('#rulesJson').value,text);assert.equal(a.q('#rulesJson').dataset.pluginDraft,'1');assert.equal(a.A.state.rules.unapplied,undefined);assert.deepStrictEqual(a.errors,[]);}finally{await finish(a);}});
// ---- post49 追補（案 C）の対照: 前のフォルダから何も読んでいない状態で plugins/ が空・不存在なら、置き換える登録が無いので入力・状態・Undo・保存基準に触らない。その後の通常の確定・保存は正常。
const snap=a=>({rules:clone(a.A.state.rules),month:clone(a.A.state.month),meta:a.A.state.meta===undefined?null:clone(a.A.state.meta),undo:a.q('#undoNote').textContent,undoDisabled:a.q('#btnUndo').disabled,saved:a.w.localStorage.getItem(key),gen:a.w.T.plugins.generation(),langs:a.w.T.LANGS().map(x=>x[0]),sel:[...a.q('#langSel').options].map(o=>o.value)});
for(const mode of ['empty','missing'])test('control: no prior plug-ins, '+mode+' reload leaves the unconfirmed note, focus, state, Undo and save baseline untouched, then commits normally',async()=>{
 const a=await makeApp();try{const tt=[];a.A.toast=m=>tt.push(String(m));const loading=await begin(a,mode);monthPane(a);const before=snap(a);const el=draft(a,'[data-path="notes"]','draft '+mode);await loading.release();
  const after=snap(a);
  assert.strictEqual(a.q('[data-path="notes"]'),el,'the note element was not repainted');assert.equal(el.value,'draft '+mode);assert.strictEqual(a.w.document.activeElement,el,'focus kept');
  assert.equal(a.A.state.month.notes,'before','unconfirmed input is not flushed into the month');
  assert.deepStrictEqual(after.rules,before.rules,'rules untouched');assert.deepStrictEqual(after.month,before.month,'month untouched');assert.deepStrictEqual(after.meta,before.meta,'save baseline untouched');assert.equal(after.saved,before.saved,'browser copy not rewritten');
  assert.equal(after.undo,before.undo,'no Undo entry');assert.equal(after.undoDisabled,before.undoDisabled);
  assert.equal(after.gen,before.gen+1,'beginFolder advanced the generation exactly once');assert.deepStrictEqual(after.langs,before.langs);assert.deepStrictEqual(after.sel,before.sel,'language select unchanged');
  assert.equal(a.w.T.plugins.errors().length,0);assert.equal(a.A.pluginsPending,false);assert.equal(a.A.switching,0);
  assert.ok(tt.some(t=>/plugins\//.test(t)),'empty folder reported: '+JSON.stringify(tt));assert.ok(!tt.some(t=>/Loaded \d+|読み込みました/.test(t)),'no false success: '+JSON.stringify(tt));
  el.dispatchEvent(new a.w.Event('change',{bubbles:true}));await a.tick();
  assert.equal(a.A.state.month.notes,'draft '+mode,'ordinary commit');assert.equal(JSON.parse(a.w.localStorage.getItem(key)).month.notes,'draft '+mode,'ordinary save');assert.deepStrictEqual(a.A.state.month.doc_versions,before.month.doc_versions,'doc_versions untouched');
  a.A.undo();assert.equal(a.A.state.month.notes,'before','ordinary commit is undoable');assert.deepStrictEqual(a.errors,[]);
 }finally{await finish(a);}
});
test('control: no prior plug-ins, empty reload keeps a focused settings number unconfirmed, then it commits and Undo restores',async()=>{
 const a=await makeApp();try{const before=a.A.state.rules.doctors[0].years;const loading=await begin(a,'empty');const el=draft(a,'#doctorTable tr[data-i="0"] [data-f="years"]','12');const undo0=a.q('#undoNote').textContent;await loading.release();
  assert.strictEqual(a.q('#doctorTable tr[data-i="0"] [data-f="years"]'),el,'settings table not repainted');assert.equal(el.value,'12');assert.strictEqual(a.w.document.activeElement,el,'focus kept');assert.equal(a.A.state.rules.doctors[0].years,before,'not flushed');assert.equal(a.q('#undoNote').textContent,undo0,'no Undo entry');
  el.dispatchEvent(new a.w.Event('change',{bubbles:true}));await a.tick();assert.equal(a.A.state.rules.doctors[0].years,12,'ordinary commit');a.A.undo();assert.equal(a.A.state.rules.doctors[0].years,before,'Undo restores');assert.deepStrictEqual(a.errors,[]);
 }finally{await finish(a);}});
// 置き換えがある場合（前のフォルダの規則・訳がある）は、空・不存在でも旧登録を外し、言語の一覧を描き直す。
const RULE_SAME="T.rules.register({id:'local.same',api:1,label:'Synthetic',states:['hard','off'],def:'hard',solve(){},check(){},penalty(){}});",LANG_ZZ=JSON.stringify({code:'zz',name:'Synthetic ZZ',ui:{}});
async function withOldPlugins(a){assert(a.w.T.plugins.load('rules','rules/same.js',RULE_SAME).ok);assert(a.w.T.plugins.load('lang','lang/same.json',LANG_ZZ).ok);a.w.T.fillDefaultRules(a.A.state.rules);a.A.renderAll();a.A.renderLangs();assert.ok(a.w.T.RULE_BY_ID['local.same']);assert.ok(a.w.T.LANGS().some(x=>x[0]==='zz'));assert.ok([...a.q('#langSel').options].some(o=>o.value==='zz'),'zz offered');}
for(const mode of ['empty','missing'])test('old folder rule and language are removed by a '+mode+' reload and the language list is repainted',async()=>{
 const a=await makeApp();try{await withOldPlugins(a);const gen=a.w.T.plugins.generation();const loading=await begin(a,mode);await loading.release();
  assert.equal(a.w.T.RULE_BY_ID['local.same'],undefined,'old rule removed');assert.ok(!a.w.T.LANGS().some(x=>x[0]==='zz'),'old language removed');assert.ok(![...a.q('#langSel').options].some(o=>o.value==='zz'),'language select repainted');assert.equal(a.w.T.lang(),'en');
  assert.equal(a.w.T.plugins.generation(),gen+1);assert.equal(a.w.T.plugins.errors().length,0);assert.equal(a.A.pluginsPending,false);assert.deepStrictEqual(a.errors,[]);
 }finally{await finish(a);}});
test('current UI language from the old folder is removed by an empty reload without errors (boundary recorded)',async()=>{
 const a=await makeApp();try{await withOldPlugins(a);a.change('#langSel','zz');await a.tick();assert.equal(a.w.T.lang(),'zz','switched to the folder language');const loading=await begin(a,'empty');await loading.release();
  assert.ok(!a.w.T.LANGS().some(x=>x[0]==='zz'));assert.ok(![...a.q('#langSel').options].some(o=>o.value==='zz'));const after={lang:a.w.T.lang(),sel:a.q('#langSel').value,sample:a.w.T.t('保存フォルダに plugins/ のプラグインはありません')};console.log('BOUNDARY '+JSON.stringify(after));
  assert.equal(typeof after.sample,'string');assert.ok(after.sample.length>0);a.change('#langSel','en');await a.tick();assert.equal(a.w.T.lang(),'en','can switch back');assert.deepStrictEqual(a.errors,[]);
 }finally{await finish(a);}});
const EXPECTED=16;let completed=0,failed=0,finished=false;
process.on('exit',()=>{if(!finished||completed!==EXPECTED){console.error('FAIL incomplete plugin-reload draft ledger');process.exitCode=1;}});
(async()=>{assert.equal(cases.length,EXPECTED);for(const c of cases){console.log('START '+c.name);try{await c.fn();console.log('PASS '+c.name);}catch(e){failed++;console.error('FAIL '+c.name,e);}finally{completed++;console.log('END '+c.name);}}finished=true;console.log(`plugin-reload-draft ${completed} completed, ${failed} failed`);if(failed)process.exitCode=1;})().catch(e=>{console.error(e);process.exitCode=1;});

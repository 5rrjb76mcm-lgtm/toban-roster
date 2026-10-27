// C02/C03: real folder loader + real registries, deterministic synthetic file handles.
// No solver, browser, network or filesystem permission claim. No dependency installation.
const fs=require('fs'),vm=require('vm'),path=require('path'),assert=require('assert');
const root=process.env.TOBAN_SOURCE_ROOT || __dirname;
const clone=x=>JSON.parse(JSON.stringify(x));
function context(){
 const elems=new Map(),el=s=>{if(!elems.has(s))elems.set(s,{textContent:'',hidden:true,addEventListener(){}});return elems.get(s);};
 const c={console,setTimeout,clearTimeout,queueMicrotask,document:{querySelector:el,querySelectorAll:()=>[],addEventListener(){}},location:{pathname:'/synthetic/plugin-generation.html'},localStorage:{getItem:()=>null,setItem(){},removeItem(){}},T:{}};c.window=c;vm.createContext(c);
 const run=f=>vm.runInContext(fs.readFileSync(path.join(root,'src',f),'utf8'),c,{filename:f});
 for(const f of ['i18n.js','rules-core.js','model.js','messages.js','plugins.js','app-core.js'])run(f);
 for(const dir of ['rules','calendars'])for(const f of fs.readdirSync(path.join(root,'src',dir)).filter(x=>x.endsWith('.js')).sort())run(dir+'/'+f);
 for(const l of ['en','ja'])c.T.registerLang(JSON.parse(fs.readFileSync(path.join(root,'lang',l+'.json'),'utf8')));
 run('app-folder.js');const T=c.T,A=T.app,stats={read:0,paint:0,langs:0,ensure:0};
 A.state.rules=JSON.parse(fs.readFileSync(path.join(root,'data/rules.json'),'utf8'));T.fillDefaultRules(A.state.rules);A.state.month={year:2026,month:11,notes:'before'};
 A.readAll=()=>{stats.read++;};A.renderAll=()=>{stats.paint++;};A.renderLangs=()=>{stats.langs++;};A.ensureMonth=()=>{stats.ensure++;};A.toast=()=>{};
 return {A,T,stats};
}
const nf=()=>Object.assign(new Error('synthetic missing directory'),{name:'NotFoundError'});
function gate(){let enter,release;return {entered:new Promise(r=>enter=r),wait:new Promise(r=>release=r),enter,release};}
function folder(marker,opt={}){
 const cfg={marker,used:false,...opt};
 const pause=async stage=>{if(cfg.stage===stage&&!cfg.used){cfg.used=true;cfg.g.enter();await cfg.g.wait;if(cfg.reject)throw new Error('synthetic stale read failure');}};
 const rootHandle={name:'synthetic-folder',cfg,async *entries(){},async getDirectoryHandle(name){
  if(name!=='plugins')throw nf();const value=cfg.marker;await pause('root');if(cfg.missing)throw nf();if(cfg.rootError)throw new Error('synthetic current permission failure');
  return {async getDirectoryHandle(kind){await pause('kind:'+kind);if(!['rules','lang','profiles'].includes(kind)||cfg.empty)throw nf();
   return {async *entries(){await pause('entries:'+kind);const filename=kind==='rules'?'same.js':'same.json';yield [filename,{kind:'file',async getFile(){await pause('getFile:'+kind);return {async text(){await pause('text:'+kind);
    if(kind==='rules')return `T.rules.register({id:'local.same',api:1,label:'Synthetic',states:['hard','off'],def:'hard',marker:${JSON.stringify(value)},solve(){},check(){},penalty(){}});`;
    if(kind==='lang')return JSON.stringify({code:'zz',label:value,messages:{}});
    return JSON.stringify({profile:{id:'synthetic-same',label:value}});
   }};}}];}};
  }};
 }};return rootHandle;
}
const snapshot=x=>JSON.stringify({stamp:x.T.plugins.stamp(),inventory:x.T.plugins.inventory(),errors:x.T.plugins.errors(),generation:x.T.plugins.generation(),marker:x.T.RULE_BY_ID['local.same']?.marker,langs:x.T.LANGS(),profiles:x.T.PROFILES,month:x.A.state.month,rules:x.A.state.rules,stats:x.stats});
const cases=[],test=(name,fn)=>cases.push({name,fn});
for(const stage of ['root','kind:rules','entries:rules','getFile:rules','text:rules','text:lang','text:profiles'])for(const reject of [false,true])test('stale '+stage+' '+(reject?'failure':'success'),async()=>{
 const x=context(),g=gate(),a=folder('A',{stage,g,reject}),b=folder('B');x.A.dirHandle=a;const old=x.A.loadFolderPlugins();await g.entered;
 x.A.dirHandle=b;x.A.dirGen++;await x.A.loadFolderPlugins();assert.equal(x.T.RULE_BY_ID['local.same'].marker,'B');const before=snapshot(x);g.release();await old;assert.equal(snapshot(x),before,'obsolete load has zero registry/state/UI effects');
});
test('same root newer load wins',async()=>{const x=context(),g=gate(),a=folder('A',{stage:'text:rules',g});x.A.dirHandle=a;const old=x.A.loadFolderPlugins();await g.entered;a.cfg.marker='B';await x.A.loadFolderPlugins();const before=snapshot(x);g.release();await old;assert.equal(snapshot(x),before);assert.equal(x.T.RULE_BY_ID['local.same'].marker,'B');});
test('same root new connection generation invalidates read',async()=>{const x=context(),g=gate();x.A.dirHandle=folder('A',{stage:'text:rules',g});const old=x.A.loadFolderPlugins();await g.entered;x.A.dirGen++;const before=snapshot(x);g.release();await old;assert.equal(snapshot(x),before);});
test('no registry reset while file bytes are pending',async()=>{const x=context();x.A.dirHandle=folder('old');await x.A.loadFolderPlugins();const g=gate();x.A.dirHandle=folder('new',{stage:'text:rules',g});const before=JSON.stringify(x.T.plugins.stamp());const p=x.A.loadFolderPlugins();await g.entered;assert.equal(x.T.RULE_BY_ID['local.same'].marker,'old');assert.equal(JSON.stringify(x.T.plugins.stamp()),before);g.release();await p;assert.equal(x.T.RULE_BY_ID['local.same'].marker,'new');});
test('pending entry reserves transition and rejects folder transition',async()=>{const x=context(),g=gate();x.A.dirHandle=folder('A',{stage:'text:rules',g});x.A.pluginsPending=true;const p=x.A.loadPendingPlugins();await g.entered;assert.equal(x.A.switching,1);let ran=false;assert.equal(await x.A.transition('folder',async()=>{ran=true;}),false);assert.equal(ran,false);g.release();await p;assert.equal(x.A.switching,0);assert.equal(x.A.pluginsPending,false);});
test('pending rejection retains retry intent',async()=>{const x=context();x.A.dirHandle=folder('A');x.A.pluginsPending=true;x.A.switching=1;assert.equal(await x.A.loadPendingPlugins(),false);assert.equal(x.A.pluginsPending,true);x.A.switching=0;await x.A.loadPendingPlugins();assert.equal(x.A.pluginsPending,false);assert.equal(x.T.RULE_BY_ID['local.same'].marker,'A');});
test('calculation beginning during read defers commit',async()=>{const x=context(),g=gate();x.A.dirHandle=folder('A',{stage:'text:rules',g});const p=x.A.loadFolderPlugins();await g.entered;const before=snapshot(x);x.A.solving=true;g.release();await p;assert.equal(snapshot(x),before);assert.equal(x.A.pluginsPending,true);x.A.solving=false;await x.A.loadPendingPlugins();assert.equal(x.T.RULE_BY_ID['local.same'].marker,'A');});
test('input flush runs with old rule hooks and thrown flush leaves registry intact',async()=>{const x=context();x.A.dirHandle=folder('old');await x.A.loadFolderPlugins();const before=JSON.stringify(x.T.plugins.stamp());x.A.readAll=()=>{assert.equal(x.T.RULE_BY_ID['local.same'].marker,'old');throw new Error('synthetic flush failure');};x.A.dirHandle=folder('new');await assert.rejects(x.A.loadFolderPlugins(),/synthetic flush failure/);assert.equal(JSON.stringify(x.T.plugins.stamp()),before);assert.equal(x.T.RULE_BY_ID['local.same'].marker,'old');assert.equal(x.T.plugins.errors().length,1);assert.equal(x.A.pluginsPending,true);x.A.readAll=()=>{};await x.A.loadFolderPlugins();assert.equal(x.T.RULE_BY_ID['local.same'].marker,'new');assert.equal(x.T.plugins.errors().length,0);assert.equal(x.A.pluginsPending,false,'successful manual retry consumes pending intent');});
for(const mode of ['empty','missing','rootError'])test(mode+' folder still flushes and repaints',async()=>{const x=context();x.A.dirHandle=folder('old');await x.A.loadFolderPlugins();let read=0;x.A.readAll=()=>{read++;assert.equal(x.T.RULE_BY_ID['local.same'].marker,'old');x.A.state.month.notes='new draft';};const before=x.stats.paint;x.A.dirHandle=folder('new',{[mode]:true});await x.A.loadFolderPlugins();assert.equal(read,1);assert.equal(x.A.state.month.notes,'new draft');assert.equal(x.stats.paint,before+1);assert.equal(x.T.RULE_BY_ID['local.same'],undefined);assert.equal(x.T.plugins.errors().length,mode==='rootError'?1:0);});
const EXPECTED=24;let completed=0,failed=0,finished=false;
process.on('exit',()=>{if(!finished||completed!==EXPECTED){console.error('FAIL incomplete plugin-generation ledger');process.exitCode=1;}});
(async()=>{assert.equal(cases.length,EXPECTED);for(const c of cases){console.log('START '+c.name);try{await c.fn();console.log('PASS '+c.name);}catch(e){failed++;console.error('FAIL '+c.name,e);}finally{completed++;console.log('END '+c.name);}}finished=true;console.log(`plugin-generation ${completed} completed, ${failed} failed`);if(failed)process.exitCode=1;})().catch(e=>{console.error(e);process.exitCode=1;});

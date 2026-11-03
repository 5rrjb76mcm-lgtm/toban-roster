// Static-authored candidate; no cloud execution. Synthetic records only.
// TOBAN_WEBAPP_ROOT selects an independent unchanged baseline for red controls.
const fs=require('fs'),path=require('path'),vm=require('vm'),assert=require('assert/strict');
const root=path.resolve(process.env.TOBAN_WEBAPP_ROOT||__dirname);
console.log('SOURCE_ROOT '+JSON.stringify(root));
globalThis.location={pathname:'/synthetic/history-merge.html'};
globalThis.localStorage={getItem:()=>null,setItem(){}};
globalThis.document={querySelector:()=>null,querySelectorAll:()=>[]};globalThis.T={};
for(const f of ['i18n.js','rules-core.js','model.js','messages.js','merge.js','app-core.js','app-folder.js'])
 vm.runInThisContext(fs.readFileSync(path.join(root,'src',f),'utf8'),{filename:f});
for(const f of fs.readdirSync(path.join(root,'src/rules')).filter(x=>x.endsWith('.js')).sort())
 vm.runInThisContext(fs.readFileSync(path.join(root,'src/rules',f),'utf8'),{filename:f});
const A=T.app,clone=x=>JSON.parse(JSON.stringify(x)),tables=['weekend_charge','holiday_charge','work_balance'];
for(const k of ['renderHeader','renderAll','readAll','toast','showTab','save','clearUndo'])A[k]=()=>{};
const rules=JSON.parse(fs.readFileSync(path.join(root,'data/rules.json'),'utf8'));T.fillDefaultRules(rules);
function fixture(table,value=2){const m=JSON.parse(fs.readFileSync(path.join(root,'data/202611.json'),'utf8'));T.normalizeMonth(m,rules);m.history[table]=JSON.parse('{"__proto__":'+value+',"constructor":3,"toString":4,"Synthetic Retired":5}');return m;}
const own=(o,k)=>Object.prototype.hasOwnProperty.call(o,k);
function preserved(m,table,value){assert(own(m.history[table],'__proto__'));assert.equal(m.history[table].__proto__,value);assert.equal(Object.getPrototypeOf(m.history[table]),Object.prototype);assert.equal(m.history[table].constructor,3);assert.equal(m.history[table].toString,4);assert.equal(m.history[table]['Synthetic Retired'],5);assert.deepEqual(clone(m.history[table]),m.history[table]);}
const cases=[];const add=(label,fn)=>cases.push({label,fn});
for(const table of tables){
 add(table+' roundtrip zero',()=>{const m=fixture(table,0),before=JSON.stringify(m);preserved(T.unflattenMonth(T.flattenMonth(m),m),table,0);assert.equal(JSON.stringify(m),before);});
 add(table+' unrelated edits',()=>{const b=fixture(table),a=clone(b),c=clone(b);a.notes='local';c.day_notes[7]='peer';const r=T.mergeMonth(b,a,c);assert.equal(r.conflicts.length,0);preserved(r.merged,table,2);assert.equal(r.merged.notes,'local');assert.equal(r.merged.day_notes[7],'peer');});
 for(const prefer of ['mine','theirs'])add(table+' conflict '+prefer,()=>{const b=fixture(table),a=clone(b),c=clone(b);a.history[table].__proto__=7;c.history[table].__proto__=8;const r=T.mergeMonth(b,a,c,prefer);assert.equal(r.conflicts.length,1);preserved(r.merged,table,prefer==='mine'?7:8);});
 add(table+' delete',()=>{const b=fixture(table),a=clone(b);delete a.history[table].__proto__;const r=T.mergeMonth(b,a,clone(b));assert(!own(r.merged.history[table],'__proto__'));assert.equal(r.merged.history[table].constructor,3);});
 add(table+' signature and dirty tracking',()=>{const m=fixture(table);Object.assign(A.state,{rules:clone(rules),month:m,result:null,ui:{},meta:null,base:null,baseRules:null,renames:[]});A.markSaved(undefined,'2026-10-01T00:00:00Z');assert.equal(A.isDirty(),false);const sig=A.sig();m.history[table].__proto__=9;assert.notEqual(A.sig(),sig);assert.equal(A.isDirty(),true);preserved(JSON.parse(A.payloadJson()).month,table,9);m.history[table].__proto__=2;assert.equal(A.sig(),sig);assert.equal(A.isDirty(),false);});
 add(table+' canonical key order',()=>{const a=fixture(table),b=clone(a);b.history[table]=Object.fromEntries(Object.entries(b.history[table]).reverse());assert.equal(JSON.stringify(A.canon(a)),JSON.stringify(A.canon(b)));preserved(A.canon(a),table,2);assert.equal(Object.getPrototypeOf(A.canon(a).history[table]),Object.prototype);});
 add(table+' folder autosave',async()=>{const b=fixture(table),a=clone(b),c=clone(b);a.notes='local';c.day_notes[7]='peer';let disk='',pending='',writes=0,choices=0;
 const dir={name:'Synthetic folder',async getDirectoryHandle(){return dir;},async getFileHandle(name){assert.equal(name,'202611_data.json');return{getFile:async()=>({text:async()=>disk}),createWritable:async()=>({write:async blob=>{pending=await blob.text();},close:async()=>{disk=pending;writes++;}})};}};
 Object.assign(A.state,{rules:clone(rules),month:b,result:null,ui:{},meta:null,base:null,baseRules:null,renames:[]});A.dirHandle=dir;A.dirGen++;A.monthDirs=['202611'];A.markSaved(undefined,'2026-10-01T00:00:00Z');
 const peer=JSON.parse(A.payloadJson('2026-10-02T00:00:00Z'));peer.month=c;disk=JSON.stringify(peer);A.state.month=a;A.choose=async()=>{choices++;return null;};
 assert.equal(await A.autosaveJson(),'saved');assert.equal(choices,0);assert.equal(writes,1);preserved(JSON.parse(disk).month,table,2);preserved(A.state.month,table,2);assert.equal(JSON.parse(disk).month.notes,'local');assert.equal(JSON.parse(disk).month.day_notes[7],'peer');
 });
}
const EXPECTED=24;assert.equal(cases.length,EXPECTED);
console.log('REGISTER '+JSON.stringify(cases.map(c=>c.label)));
let complete=0,passed=0,finished=false;
const timer=setTimeout(()=>{console.error('history own-key tests timed out');process.exit(1);},60000);
process.on('exit',()=>{if(!finished||complete!==EXPECTED||passed!==EXPECTED)process.exitCode=1;});
(async()=>{for(const c of cases){console.log('START '+c.label);let outcome='fail';try{await c.fn();passed++;outcome='pass';console.log('PASS '+c.label);}catch(e){console.error('FAIL '+c.label+'\n'+e.stack);}finally{complete++;console.log('SCENARIO_COMPLETE '+JSON.stringify({label:c.label,outcome}));}}finished=true;clearTimeout(timer);console.log(`${passed}/${EXPECTED} passed; ${complete} completed`);process.exitCode=passed===EXPECTED?0:1;})().catch(e=>{console.error(e);clearTimeout(timer);process.exitCode=1;});

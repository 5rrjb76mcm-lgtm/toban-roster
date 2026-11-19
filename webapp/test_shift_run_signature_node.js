// Synthetic regression for shift-run settings signatures and folder persistence.
// TOBAN_CORE_SOURCE may point to the original app-core.js for a source-only reversion.
const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert');
const elements = new Map();
globalThis.document = { querySelector(s) { if (!elements.has(s)) elements.set(s, { value: '', textContent: '', addEventListener() {} }); return elements.get(s); }, querySelectorAll: () => [], addEventListener() {} };
globalThis.window = globalThis; globalThis.location = { pathname: '/synthetic/staffing-signature.html', protocol: 'file:' };
globalThis.localStorage = { getItem: () => null, setItem() {} }; globalThis.T = {};
for (const f of ['i18n.js', 'rules-core.js', 'model.js', 'messages.js', 'merge.js', 'plugins.js', 'app-core.js', 'app-folder.js', 'app-settings.js'])
  vm.runInThisContext(fs.readFileSync(f === 'app-core.js' && process.env.TOBAN_CORE_SOURCE || path.join(__dirname, 'src', f), 'utf8'), { filename: f });
for (const f of fs.readdirSync(path.join(__dirname, 'src/rules')).filter(f => f.endsWith('.js')))
  vm.runInThisContext(fs.readFileSync(path.join(__dirname, 'src/rules', f), 'utf8'), { filename: 'rules/' + f });
const A = T.app, clone = x => JSON.parse(JSON.stringify(x));
for (const k of ['save', 'renderAll', 'renderHeader', 'readAll', 'toast', 'showTab']) A[k] = () => {};

function setup(raw) {
 const rules = { profile:{id:'synthetic'}, doctors:[{name:'Synthetic A',team:'I'}],rule_states:{shift_run_max:'hard'} };
 T.fillDefaultRules(rules);
 const month=T.normalizeMonth({year:2026,month:11},rules);
 if(raw === undefined) delete rules.shift_run_max; else rules.shift_run_max=clone(raw);
 Object.assign(A.state,{rules,month,result:null,meta:null,base:null,baseRules:null,renames:[],ui:{}});
 A.dirHandle=null; A.clearUndo();
}
function folder(){const files={'202611_data.json':A.payloadJson('2026-11-01T00:00:00Z')};const dir={name:'Synthetic folder',async getDirectoryHandle(){return dir;},async getFileHandle(n,o={}){if(!o.create&&!(n in files))throw Object.assign(new Error('synthetic missing'),{name:'NotFoundError'});return{getFile:async()=>({text:async()=>files[n]}),createWritable:async()=>({write:async b=>{files[n]=await b.text()},close:async()=>{}})}} }; A.dirHandle=dir;A.dirGen++;A.monthDirs=['202611'];A.markSaved(undefined,'2026-11-01T00:00:00Z');return files;}
let passed=0,failed=0,finished=false;
const watchdog=setTimeout(()=>{console.error('TIMEOUT');process.exit(1)},15000);
process.on('exit',()=>{if(!finished||passed+failed!==8||failed)process.exitCode=1});
async function test(name,fn){try{await fn();passed++;console.log('PASS '+name)}catch(e){failed++;console.error('FAIL '+name+' '+e.stack)}}
(async()=>{
 await test('ordinary clear of default day limit persists to folder',async()=>{
 setup(undefined);const files=folder();const before=A.rulesSig(A.state.rules);
 // Same resulting settings object as shift_run_max.ui.read when the visible 3 is cleared.
 A.pushUndo('Synthetic clear limit');A.state.rules.shift_run_max={};
 const outcome=await A.autosaveJson();
 console.log('OBSERVE default-clear '+outcome+' disk-limit='+JSON.stringify(JSON.parse(files['202611_data.json']).rules.shift_run_max));
 assert.strictEqual(outcome,'saved');
 assert.notStrictEqual(A.rulesSig(A.state.rules),before,'no limit must differ from implicit day 3');
 const disk=JSON.parse(files['202611_data.json']); assert.deepStrictEqual(disk.rules.shift_run_max,{});
 A.applyLoaded(disk,'Synthetic reload');assert.deepStrictEqual(A.state.rules.shift_run_max,{});
 });
 for(const raw of [{},[]]) await test('repair invalid day '+JSON.stringify(raw)+' saves and reloads',async()=>{
 setup({day:raw});const files=folder();A.state.rules.shift_run_max={day:null};
 assert.strictEqual(await A.autosaveJson(),'saved');const disk=JSON.parse(files['202611_data.json']);assert.deepStrictEqual(disk.rules.shift_run_max,{day:null});
 A.applyLoaded(disk,'Synthetic reload');assert.deepStrictEqual(A.state.rules.shift_run_max,{day:null});
 });
 for(const raw of [{},[]]) await test('repair invalid night '+JSON.stringify(raw)+' saves and reloads',async()=>{
 setup({night:raw});const files=folder();A.state.rules.shift_run_max={night:null};
 assert.strictEqual(await A.autosaveJson(),'saved');const disk=JSON.parse(files['202611_data.json']);assert.deepStrictEqual(disk.rules.shift_run_max,{night:null});
 A.applyLoaded(disk,'Synthetic reload');assert.deepStrictEqual(A.state.rules.shift_run_max,{night:null});
 });
 await test('empty string root remains equivalent to omitted default',()=>{setup(undefined);const sig=A.rulesSig(A.state.rules);A.state.rules.shift_run_max='';assert.strictEqual(A.rulesSig(A.state.rules),sig)});
 await test('null root remains equivalent to omitted default',()=>{setup(undefined);const sig=A.rulesSig(A.state.rules);A.state.rules.shift_run_max=null;assert.strictEqual(A.rulesSig(A.state.rules),sig)});
 await test('blank day remains equivalent to absent day inside explicit object',()=>{setup({day:null});const sig=A.rulesSig(A.state.rules);A.state.rules.shift_run_max={};assert.strictEqual(A.rulesSig(A.state.rules),sig)});
 finished=true;clearTimeout(watchdog);clearTimeout(A.autosaveTimer);console.log(`shift run signature ${passed}/8 failed ${failed}`);
})().catch(e=>{console.error(e);clearTimeout(watchdog);process.exitCode=1});

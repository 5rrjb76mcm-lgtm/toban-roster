// Production DOM-adapter regression: actual markup, init, delegated settings events,
// Problem and localStorage. Fictional data only; jsdom supplies the DOM.
// No browser, layout, OS permissions or network test is claimed; no sockets are opened.
// Run: TOBAN_DOM_MODULE=/path/to/node_modules/jsdom node test_oncall_standby_preservation_dom_node.js
const fs = require('fs'), path = require('path'), assert = require('assert');
// Verified with jsdom 26.1.0. Dependency lookup never downloads/install packages.
let JSDOM;
for (const name of [process.env.TOBAN_DOM_MODULE, 'jsdom', path.join(process.env.HOME || '', '.toban-test/node_modules/jsdom')].filter(Boolean)) {
  try { ({ JSDOM } = require(name)); break; } catch (e) { if (e.code !== 'MODULE_NOT_FOUND') throw e; }
}
if (!JSDOM) throw new Error('Standby OC DOM-adapter regression requires jsdom 26.1.0. Set TOBAN_DOM_MODULE to its installed module path. This test was NOT run.');
const N = ['Synthetic Alpha', 'Synthetic Beta', 'Synthetic Gamma', 'Synthetic Delta', 'Synthetic Epsilon', 'Synthetic Zeta'], clone = x => JSON.parse(JSON.stringify(x));
const root = process.env.TOBAN_SOURCE_ROOT || __dirname;
const source = f => fs.readFileSync(path.join(root, 'src', f), 'utf8');
const scripts = ['i18n.js','rules-core.js','model.js', ...fs.readdirSync(path.join(root,'src/calendars')).filter(f=>f.endsWith('.js')).sort().map(f=>'calendars/'+f),
  'messages.js','solver.js','check.js','report.js','docxgen.js','plugins.js','merge.js', ...fs.readdirSync(path.join(root,'src/rules')).filter(f=>f.endsWith('.js')).sort().map(f=>'rules/'+f),
  'app-core.js','app-folder.js','app-month.js','app-input.js','app-settings.js','app-solve.js','app-main.js'];
const key = 'toban_state_v2:/synthetic/standby-oc.html';
const rawRules = {profile:{id:'synthetic-oc-preservation',roles:[{id:'S',label:'Staff',refs:[],standby:true},{id:'T',label:'Support',refs:[],standby:true}],shifts:[{id:'day',on:'all'},{id:'night',on:'all'}]},doctors:N.map((name,i)=>({name,team:i<3?'S':'T',quota:10})),oncall_requirement:{S:{S:1,T:2},T:{S:2,T:1}},rule_states:{oncall:'hard'},weights:{}};
const rawMonth = {year:2026,month:11,next_first_day_in_calendar:true,unavailable_night:{[N[0]]:[5],[N[1]]:[9]},wishes:{night_on:{[N[1]]:[8]}},duty_days:{[N[1]]:{7:{am:'ward'}}},notes:'Synthetic note'};
async function makeApp(saved, fixture=rawRules, defaults=fixture) {
  const dom = new JSDOM(source('index.html'), {url:'https://example.invalid/synthetic/standby-oc.html',runScripts:'outside-only'}), w=dom.window;
  await new Promise(resolve=>w.document.readyState==='complete'?resolve():w.addEventListener('load',resolve,{once:true}));
  const errors=[]; w.addEventListener('error',e=>{errors.push(e.error || e.message);e.preventDefault();});
  w.confirm=()=>true; w.alert=msg=>{throw new Error('Unexpected alert: '+msg);}; w.prompt=()=>null;
  w.T={DEFAULT_RULES:clone(defaults), SAMPLE_MONTH:clone(rawMonth), PROFILES:[], LANGS_DATA:[JSON.parse(fs.readFileSync(path.join(root,'lang/en.json'),'utf8'))]};
  for(const f of scripts) w.eval(source(f)+'\n//# sourceURL='+f);
  const A=w.T.app; A.restoreFolder=()=>{}; // Start-gate/OS-folder access is outside this DOM-adapter test.
  A.toast=()=>{};
  w.localStorage.setItem('toban.lang','en');
  w.localStorage.setItem(key,saved || JSON.stringify({rules:fixture,month:rawMonth,result:null,ui:{doctor:1}}));
  w.T.init();
  const q=s=>w.document.querySelector(s), click=s=>{assert(q(s),'Missing '+s);q(s).click();}, change=(s,v)=>{const el=typeof s==='string'?q(s):s;assert(el,'Missing '+s);if(el.type==='checkbox')el.checked=v;else el.value=v;el.dispatchEvent(new w.Event('change',{bubbles:true}));};
  const tick=()=>new Promise(r=>w.setTimeout(r,0));
  const enter=()=>{click('.tab[data-tab="settings"]');click('[data-setmode="build"]');};
  return {dom,w,A,q,click,change,tick,enter,errors};
}

(async()=>{
 let passed=0,failed=0;
 const expected=clone(rawRules.oncall_requirement);
 const test=async(label,fn,fixture=rawRules,defaults=fixture)=>{
  const a=await makeApp(null,fixture,defaults); a.enter();
  try { await fn(a);assert.deepStrictEqual(a.errors,[]);passed++;console.log('ok '+label); }
  catch(e){failed++;console.error('FAIL '+label+'\n'+e.stack);}
  finally{a.dom.window.close();}
 };
 const standby=(a,i,on)=>a.change(`#roleTbl tr[data-ri="${i}"] [data-rstandby]`,on);
 const table=a=>clone(a.A.state.rules.oncall_requirement);
 const effective=a=>clone(new a.w.T.Problem(a.A.state.rules,a.A.state.month).ocReq);
 const row=(a,t,c)=>a.q(`#ocReqTbl tr[data-t="${t}"] [data-oc="${c}"]`);
 await test('toggle off/on restores exact stored counts and effective Problem',a=>{
  assert.deepStrictEqual(effective(a),expected);
  standby(a,1,false);assert.deepStrictEqual(effective(a),{S:{S:1},T:{S:2}});assert.equal(row(a,'S','T'),null);
  standby(a,1,true);assert.deepStrictEqual(table(a),expected);assert.deepStrictEqual(effective(a),expected);assert.equal(row(a,'S','T').value,'2');
 });
 await test('unrelated settings edits and repeated reads preserve hidden counts but never activate them',a=>{
  const month=clone(a.A.state.month);standby(a,1,false);
  a.change('#setProfLabel','Synthetic edited facility');a.A.readSettings();a.A.readSettings();
  assert.deepStrictEqual(table(a),expected);assert.deepStrictEqual(effective(a),{S:{S:1},T:{S:2}});assert.deepStrictEqual(clone(a.A.state.month),month);
  standby(a,1,true);assert.deepStrictEqual(effective(a),expected);
 });
 await test('disabled-column counts survive actual localStorage save and fresh init',async a=>{
  standby(a,1,false);a.change('#setProfLabel','Synthetic persisted');
  const saved=a.w.localStorage.getItem(key);assert(saved);assert.deepStrictEqual(JSON.parse(saved).rules.oncall_requirement,expected);
  const b=await makeApp(saved);try{b.enter();assert.deepStrictEqual(table(b),expected);assert.deepStrictEqual(effective(b),{S:{S:1},T:{S:2}});standby(b,1,true);assert.deepStrictEqual(effective(b),expected);assert.deepStrictEqual(b.errors,[]);}finally{b.dom.window.close();}
 });
 await test('explicit visible count edits including zero remain effective while hidden cells are retained',a=>{
  standby(a,1,false);a.change(row(a,'S','S'),0);
  const edited={S:{S:0,T:2},T:{S:2,T:1}};assert.deepStrictEqual(table(a),edited);assert.deepStrictEqual(effective(a),{S:{S:0},T:{S:2}});
  standby(a,1,true);assert.deepStrictEqual(table(a),edited);assert.deepStrictEqual(effective(a),edited);
 });
 await test('role rename while disabled moves both axes and restores the renamed column',a=>{
  standby(a,1,false);a.change('#roleTbl tr[data-ri="1"] [data-rid]','U');
  const renamed={S:{S:1,U:2},U:{S:2,U:1}};assert.deepStrictEqual(table(a),renamed);assert.deepStrictEqual(effective(a),{S:{S:1},U:{S:2}});
  standby(a,1,true);assert.deepStrictEqual(effective(a),renamed);a.A.readSettings();assert.deepStrictEqual(table(a),renamed);
 });
 await test('explicit role deletion removes its row and does not resurrect counts on ID reuse',a=>{
  standby(a,1,false);a.click('#roleTbl tr[data-ri="1"] [data-act="roleDel"]');
  assert.equal(a.A.state.rules.profile.roles.some(r=>r.id==='T'),false);assert.equal(Object.hasOwn(table(a),'T'),false);assert.deepStrictEqual(table(a),{S:{S:1}});
  a.change('#setProfLabel','Synthetic after removal');assert.deepStrictEqual(table(a),{S:{S:1}});
  a.click('#profileBuilder [data-act="roleAdd"]');a.change('#roleTbl tr[data-ri="1"] [data-rid]','T');standby(a,1,true);
  assert.equal(table(a).S.T??0,0);assert.equal(effective(a).S.T,0);
 });
 for(const id of ['constructor','toString','__proto__']) await test('stored OC table preserves structural-looking role ID '+id,a=>{
  a.change('#roleTbl tr[data-ri="1"] [data-rid]',id);
  const before=Object.fromEntries([['S',Object.fromEntries([['S',1],[id,2]])],[id,Object.fromEntries([['S',2],[id,1]])]]);
  standby(a,1,false);a.change('#setProfLabel','Synthetic structural ID');standby(a,1,true);
  assert.deepStrictEqual(table(a),before);assert.equal(row(a,'S',id).value,'2');
 });
 await test('no standby roles and global oncall off keep counts dormant until explicitly enabled',a=>{
  standby(a,1,false);standby(a,0,false);a.change('#setProfLabel','Synthetic dormant');assert.deepStrictEqual(table(a),expected);assert.deepStrictEqual(effective(a),{S:{},T:{}});
  a.change('#profileBuilder [data-ron="oncall"]',false);a.change('#setProfLabel','Synthetic off');assert.deepStrictEqual(table(a),expected);
  standby(a,1,true);assert.deepStrictEqual(effective(a),{S:{T:0},T:{T:0}});
  a.change('#profileBuilder [data-ron="oncall"]',true);assert.deepStrictEqual(effective(a),{S:{T:2},T:{T:1}});
 });
 // Default IDs deliberately use counts unlike the built-in fallback (1), so revival cannot hide.
 const defaults=clone(rawRules);
 defaults.profile.roles=['I','A','Y','C'].map(id=>({id,label:id,refs:[],standby:['I','Y'].includes(id)}));
 defaults.doctors=N.map((name,i)=>({name,team:['I','A','Y','C'][i%4],quota:10}));
 defaults.oncall_requirement={I:{I:0,Y:1},A:{I:1,Y:1},Y:{I:1,Y:0},C:{I:1,Y:0}};
 const custom=clone(defaults);custom.oncall_requirement={I:{I:2,Y:5},A:{I:3,Y:6},Y:{I:7,Y:9},C:{I:4,Y:8}};
 const noY=a=>{const t=table(a);assert.equal(Object.hasOwn(t,'Y'),false,'deleted Y row must stay absent');for(const r of Object.values(t))assert.equal(Object.hasOwn(r,'Y'),false,'deleted Y column must stay absent');};
 const deleteY=a=>{standby(a,2,false);a.click('#roleTbl tr[data-ri="2"] [data-act="roleDel"]');};
 const addY=a=>{a.click('#profileBuilder [data-act="roleAdd"]');a.change('#roleTbl tr[data-ri="3"] [data-rid]','Y');};
 const zeroY=a=>{const t=table(a);for(const id of ['I','A','C','Y']){assert.strictEqual(t[id].Y,0,id+' → Y explicit zero');assert.strictEqual(t.Y[id],0,'Y → '+id+' explicit zero');}assert.strictEqual(effective(a).I.Y,0);assert.strictEqual(effective(a).A.Y,0);assert.strictEqual(effective(a).Y.I,0);assert.strictEqual(effective(a).Y.Y,0);};
 await test('default-ID standby toggle preserves distinct latent custom counts',a=>{
  standby(a,2,false);a.change('#setProfLabel','Synthetic default ID disabled');standby(a,2,true);assert.deepStrictEqual(table(a),custom.oncall_requirement);assert.equal(effective(a).I.Y,5);assert.equal(effective(a).Y.I,7);
 },custom,defaults);
 await test('deleted default-ID row and column stay absent after normalization and unrelated edits',a=>{
  deleteY(a);noY(a);a.w.T.fillDefaultRules(a.A.state.rules);noY(a);a.change('#setProfLabel','Synthetic after default deletion');a.A.readSettings();noY(a);
 },custom,defaults);
 await test('default-ID delete/add/rename/enable uses explicit zeros in raw DOM and Problem',a=>{
  deleteY(a);a.change('#setProfLabel','Synthetic unrelated edit');addY(a);
  for(const id of ['I','A','C','Y']){assert.strictEqual(table(a)[id].Y,0);assert.strictEqual(table(a).Y[id],0);}
  assert.equal(row(a,'I','Y'),null);standby(a,3,true);zeroY(a);assert.equal(row(a,'I','Y').value,'0');assert.equal(row(a,'Y','I').value,'0');
  a.A.readSettings();a.A.readSettings();zeroY(a);
 },custom,defaults);
 await test('new inactive role has a zero row and column before any rename',a=>{
  a.click('#profileBuilder [data-act="roleAdd"]');const t=table(a);for(const id of ['I','A','Y','C','R5']){assert.strictEqual(t[id].R5,0);assert.strictEqual(t.R5[id],0);}assert.equal(row(a,'I','R5'),null);
 },custom,defaults);
 await test('deleted default ID remains absent through localStorage save and fresh init',async a=>{
  deleteY(a);a.change('#setProfLabel','Synthetic deleted persist');noY(a);const saved=a.w.localStorage.getItem(key);assert.equal(Object.hasOwn(JSON.parse(saved).rules.oncall_requirement,'Y'),false);
  const b=await makeApp(saved,custom,defaults);try{b.enter();noY(b);assert.deepStrictEqual(b.errors,[]);}finally{b.dom.window.close();}
 },custom,defaults);
 await test('recreated default ID zeros persist while inactive and after re-enable/reload',async a=>{
  deleteY(a);addY(a);a.change('#setProfLabel','Synthetic recreated persist');
  const b=await makeApp(a.w.localStorage.getItem(key),custom,defaults);try{b.enter();assert.strictEqual(table(b).I.Y,0);standby(b,3,true);zeroY(b);assert.equal(row(b,'I','Y').value,'0');
   const c=await makeApp(b.w.localStorage.getItem(key),custom,defaults);try{c.enter();zeroY(c);assert.deepStrictEqual(c.errors,[]);}finally{c.dom.window.close();}assert.deepStrictEqual(b.errors,[]);
  }finally{b.dom.window.close();}
 },custom,defaults);
 await test('legacy missing C row, sparse cell and all-zero recovery semantics remain intact',a=>{
  const r=clone(defaults);delete r.oncall_requirement.C;a.w.T.fillDefaultRules(r);assert.deepStrictEqual(clone(r.oncall_requirement.C),defaults.oncall_requirement.C);
  r.oncall_requirement.C={I:0,Y:0};a.w.T.fillDefaultRules(r);assert.deepStrictEqual(clone(r.oncall_requirement.C),{I:0,Y:0});
  delete r.oncall_requirement.I.Y;assert.equal(new a.w.T.Problem(r,a.A.state.month).ocReq.I.Y,1,'legacy sparse cells still use defaults');
  for(const id of ['I','A','Y','C'])r.oncall_requirement[id]={I:0,Y:0};a.w.T.fillDefaultRules(r);assert.deepStrictEqual(clone(r.oncall_requirement),defaults.oncall_requirement);
 },custom,defaults);
 await test('default normalization limits both axes to existing roles even with a missing table',a=>{
  const r=clone(defaults);r.profile.roles=r.profile.roles.filter(x=>x.id!=='Y');delete r.oncall_requirement;a.w.T.fillDefaultRules(r);assert.equal(Object.hasOwn(r.oncall_requirement,'Y'),false);for(const v of Object.values(r.oncall_requirement))assert.equal(Object.hasOwn(v,'Y'),false);
 },custom,defaults);
 console.log(`standby OC preservation: ${passed} passed, ${failed} failed`);if(failed)process.exitCode=1;
})().catch(e=>{console.error(e.stack||e);process.exitCode=1});

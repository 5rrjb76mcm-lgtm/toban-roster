// Custom rule numeric scalars survive unrelated edits.
// Actual markup, init, delegated settings events,
// Problem and localStorage. Fictional data only; jsdom supplies the DOM.
// No browser, layout, OS permissions or network test is claimed; no sockets are opened.
// Run: TOBAN_DOM_MODULE=/path/to/node_modules/jsdom node test_custom_scalar_preservation_dom_node.js /path/to/node_modules/highs
const fs = require('fs'), path = require('path'), assert = require('assert');
// Verified with jsdom 26.1.0. Dependency lookup never downloads/install packages.
let JSDOM;
for (const name of [process.env.TOBAN_DOM_MODULE, 'jsdom', path.join(process.env.HOME || '', '.toban-test/node_modules/jsdom')].filter(Boolean)) {
  try { ({ JSDOM } = require(name)); break; } catch (e) { if (e.code !== 'MODULE_NOT_FOUND') throw e; }
}
if (!JSDOM) throw new Error('Rule-parameter numeric DOM-adapter regression requires jsdom 26.1.0. Set TOBAN_DOM_MODULE to its installed module path. This test was NOT run.');
const N = ['Synthetic Trainer', 'Synthetic Colleague'], clone = x => JSON.parse(JSON.stringify(x));
const root = process.env.TOBAN_SOURCE_ROOT || __dirname;
const source = f => fs.readFileSync(path.join(root, 'src', f), 'utf8');
const scripts = ['i18n.js','rules-core.js','model.js', ...fs.readdirSync(path.join(root,'src/calendars')).filter(f=>f.endsWith('.js')).sort().map(f=>'calendars/'+f),
  'messages.js','solver.js','check.js','report.js','docxgen.js','plugins.js','merge.js', ...fs.readdirSync(path.join(root,'src/rules')).filter(f=>f.endsWith('.js')).sort().map(f=>'rules/'+f),
  'app-core.js','app-folder.js','app-month.js','app-input.js','app-settings.js','app-solve.js','app-main.js'];
const key = 'toban_state_v2:/synthetic/settings-builder-preservation.html';
const rawRules = {profile:{id:'synthetic-settings-builder-preservation',roles:[{id:'S',label:'Staff',refs:[]}],shifts:[{id:'day',on:'all'},{id:'night',on:'all'}]},doctors:N.map(name=>({name,team:'S',quota:15})),rule_states:{oncall:'off'},weights:{}};
const rawMonth = {year:2026,month:11,notes:'Synthetic rule-parameter numeric roundtrip'};
async function makeApp(saved, fixture=rawRules, defaults=fixture) {
  const dom = new JSDOM(source('index.html'), {url:'https://example.invalid/synthetic/settings-builder-preservation.html',runScripts:'outside-only'}), w=dom.window;
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



async function imported(a,r) {
 for(const def of a.w.T.RULE_DEFS)if(def.states.includes("off") && r.rule_states[def.id]===undefined)r.rule_states[def.id]="off";
 const input=a.q('#fileLoadProfile');Object.defineProperty(input,'files',{configurable:true,value:[{name:'synthetic-rule-params.json',text:async()=>JSON.stringify(r)}]});
 input.dispatchEvent(new a.w.Event('change',{bubbles:true}));await a.tick();await a.tick();
 assert.strictEqual(a.A.state.rules.profile.id,r.profile.id,'actual file import finished');a.enter();
}

const fields=[['pair_cap','pair_cap','max','#setPairMax',' 2 ',2],['wish_off_cap','wish_off','max','#setWishOffMax','+3',3],['days_off_max','days_off','max_extra','#setDoMaxExtra',' 2 ',1],['days_off_pair','days_off','pair_min','#setPairMin','+2',1]];
const fixture=()=>{const r=clone(rawRules);r.profile.id='synthetic-custom-scalars';for(const [id,group,field,,value] of fields){r.rule_states[id]=id==='wish_off_cap'?'hard':'soft';r[group] ||= {};r[group][field]=value;r[group].plugin_metadata={keep:['fictional',7]};}return r;};
const snapshot=a=>fields.map(([,g,f])=>({present:Object.hasOwn(a.A.state.rules[g]||{},f),value:clone(a.A.state.rules[g]?.[f]??null)}));
const semantics=a=>{const p=new a.w.T.Problem(a.A.state.rules,a.A.state.month);return fields.map(([id])=>clone(a.w.T.RULE_BY_ID[id].read(p)));};
const fire=(a,x,type)=>x.dispatchEvent(new a.w.Event(type,{bubbles:true}));
const expectedCases = process.argv[2] ? 15 : 13;
let passed=0,failed=0,completed=false;
process.on('exit',()=>{if(!completed || passed + failed !== expectedCases){console.error('FAIL custom scalar incomplete case count');process.exitCode=1;}});
const watchdog=setTimeout(()=>{console.error('FAIL custom scalar timeout');process.exit(1);},300000);watchdog.unref();
(async()=>{
 const highs=process.argv[2]?await require(process.argv[2])():null;
 const cases=[],test=(n,f)=>cases.push([n,f]);
 for(const lang of ['en','ja'])test(`${lang}: actual JSON import, unrelated edit, repeat read, reload, local Undo, disabled`,async()=>{
  const r=fixture(),a=await makeApp();try{a.enter();await imported(a,r);a.w.T.setLang(lang);a.A.renderSettings();const before=snapshot(a),sem=semantics(a);
   a.change('#doctorTable tr[data-i="0"] [data-f="years"]','12');assert.deepStrictEqual(snapshot(a),before);assert.deepStrictEqual(semantics(a),sem);
   for(const [,g,f,s,v]of fields){assert.strictEqual(a.q(s).value,String(Number(v)));assert.deepStrictEqual(clone(a.A.state.rules[g].plugin_metadata),r[g].plugin_metadata);}
   a.A.readSettings();a.A.readSettings();assert.deepStrictEqual(snapshot(a),before);
   const b=await makeApp(a.w.localStorage.getItem(key),r,r);try{b.enter();assert.deepStrictEqual(snapshot(b),before);}finally{b.dom.window.close();}
   a.A.undo();assert.deepStrictEqual(snapshot(a),before);
   for(const [id]of fields)a.change(`[data-ron="${id}"]`,false);
   a.change('#doctorTable tr[data-i="0"] [data-f="years"]','13');assert.deepStrictEqual(snapshot(a),before);
   for(const [id]of fields)a.change(`[data-ron="${id}"]`,true);
   assert.deepStrictEqual(snapshot(a),before);assert.deepStrictEqual(a.errors,[]);
  }finally{a.dom.window.close();}
 });
 for(const value of [undefined,null,false,0,0.5,'not-a-number','',[], '\r\n', '\u0000'])test(`edge ${JSON.stringify(value)}: preserve, input/focusout clear, change, undo`,async()=>{
  const r=fixture();for(const [,g,f]of fields){if(value===undefined)delete r[g][f];else r[g][f]=value;}
  const a=await makeApp();try{a.enter();await imported(a,r);const before=snapshot(a);
   a.change('#doctorTable tr[data-i="0"] [data-f="years"]','14');a.A.readSettings();assert.deepStrictEqual(snapshot(a),before);
   a.A.undo();assert.deepStrictEqual(snapshot(a),before);
   for(const [,g,f,s]of fields){const previous=snapshot(a);let x=a.q(s);x.value='';fire(a,x,'input');fire(a,x,'focusout');assert.strictEqual(a.A.state.rules[g][f],0,'explicit blank contract remains zero');assert.strictEqual(a.q(s),x,'focusout preserves DOM');assert.strictEqual(x.dataset.numericEdited,undefined);assert.strictEqual(x.value,'0');
    fire(a,x,'change');a.A.readSettings();assert.strictEqual(a.A.state.rules[g][f],0);a.A.undo();assert.deepStrictEqual(snapshot(a),previous,'one Undo restores before focusout/change');
    x=a.q(s);x.value='4';fire(a,x,'input');fire(a,x,'change');assert.strictEqual(a.A.state.rules[g][f],4);a.A.readSettings();assert.strictEqual(a.A.state.rules[g][f],4);
    a.change(s,'');assert.strictEqual(a.A.state.rules[g][f],0,'change-only explicit clear');assert.deepStrictEqual(clone(a.A.state.rules[g].plugin_metadata),r[g].plugin_metadata);
   }assert.deepStrictEqual(a.errors,[]);
  }finally{a.dom.window.close();}
 });
 // Exercise actual registered solve/check/penalty hooks with a controlled fictional
 // two-person fixture. This inspects LP bounds, not a full optimizer integration.
 test('semantic consequence: pair cap, days-off excess, two-day breaks, wish-off lint',async()=>{
  const a=await makeApp();try{a.enter();await imported(a,fixture());
   const evaluate=()=>{const p=new a.w.T.Problem(a.A.state.rules,a.A.state.month),result={};
    for(const id of ['pair_cap','days_off_max']){const def=a.w.T.RULE_BY_ID[id],prm=def.read(p),bounds=[],cost=[];const ctx={P:p,names:N,slots:[[1,'night'],[2,'night'],[3,'night']],LP:{sum:x=>x,sub:(x,y)=>[x,y]},lp:{aux:()=>0,add:()=>{}},work:()=>1,busy:()=>1,limit:(id,l,op,r)=>bounds.push(r)};def.solve(ctx,prm);def.penalty({...ctx,P:Object.assign(Object.create(p),{slots:ctx.slots}),worked:()=>true,offDays:()=>Array(12).fill(0),limit:(id,l,op,r)=>cost.push(op==='<='?Math.max(0,l-r):Math.max(0,r-l))},prm);result[id]={bounds,cost};}
    const pair=a.w.T.RULE_BY_ID.days_off_pair,prm=pair.read(p),constraints=[],viol=[],cost=[];pair.solve({P:p,names:N,LP:{sum:x=>x},lp:{aux:()=>0,auxInt:()=>0,add:(l,op,r)=>{if(op==='>=')constraints.push(r);},objAdd:()=>{}},busy:()=>1},prm);pair.check({P:p,names:N,pairs:()=>1,viol:(code,data)=>viol.push(data.min)},prm);pair.penalty({P:p,N:30,names:N,busy:()=>true,pos:x=>Math.max(0,x),add:(id,w,n)=>cost.push(n)},prm);result.days_off_pair={constraints,viol,cost};
    const wish=a.w.T.RULE_BY_ID.wish_off_cap,lint=[];wish.lint({P:{dutyNames:N,wishOffDays:()=>[1,2]},push:(code,data)=>lint.push(data.max)},wish.read(p));result.wish_off_cap=lint;return result;
   };
   const before=evaluate();assert.deepStrictEqual(before.pair_cap.cost,[1]);assert.deepStrictEqual(before.days_off_pair.cost,[2,2]);assert.deepStrictEqual(before.wish_off_cap,[]);
   a.change('#doctorTable tr[data-i="0"] [data-f="years"]','12');assert.deepStrictEqual(evaluate(),before);
  }finally{a.dom.window.close();}
 });
 if(highs)for(const state of ['hard','soft'])test(`actual pinned HiGHS days-off pair ${state}`,async()=>{
  const r=clone(rawRules);r.profile.id='synthetic-pair-pinned';r.profile.shifts[0].on='none';r.days_off={pair_min:'+2'};r.rule_states.days_off_pair=state;
  const a=await makeApp();try{a.enter();await imported(a,r);
   const evaluate=()=>{const p=new a.w.T.Problem(a.A.state.rules,a.A.state.month),pin=Object.fromEntries(p.slots.map(s=>[s.join(':'),{work:N[s[0]%2],oc:[]}]));const result=a.w.T.solve(p,highs,{pin,timeLimit:10});return {status:result.status,objective:state==='soft'?result.objective:null,penalty:a.w.T.penalty(p,pin).total,violations:a.w.T.check(p,pin).VC.filter(v=>v.code==='DAYS_OFF_PAIR_SHORT').length};};
   const before=evaluate();assert.strictEqual(before.status,state==='hard'?'Infeasible':'Optimal');if(state==='soft')assert.strictEqual(before.objective,before.penalty);assert.strictEqual(before.violations,state==='hard'?2:0);
   a.change('#doctorTable tr[data-i="0"] [data-f="years"]','12');assert.deepStrictEqual(evaluate(),before);
  }finally{a.dom.window.close();}
 });
 for(const [name,fn]of cases){try{await fn();passed++;console.log('ok '+name);}catch(e){failed++;console.error('FAIL '+name+'\n'+e.stack);}}
 clearTimeout(watchdog);completed=true;console.log(`custom scalar preservation: ${passed} passed, ${failed} failed`);if(failed)process.exitCode=1;
})().catch(e=>{console.error(e);process.exitCode=1;});

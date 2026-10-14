// Profile day-flag preservation: actual markup, init, delegated settings events,
// Problem and localStorage. Fictional data only; jsdom supplies the DOM.
// No browser, layout, OS permissions or network test is claimed; no sockets are opened.
// Run: TOBAN_DOM_MODULE=/path/to/node_modules/jsdom node test_profile_day_flags_preservation_dom_node.js
const fs = require('fs'), path = require('path'), assert = require('assert');
// Verified with jsdom 26.1.0. Dependency lookup never downloads/install packages.
let JSDOM;
for (const name of [process.env.TOBAN_DOM_MODULE, 'jsdom', path.join(process.env.HOME || '', '.toban-test/node_modules/jsdom')].filter(Boolean)) {
  try { ({ JSDOM } = require(name)); break; } catch (e) { if (e.code !== 'MODULE_NOT_FOUND') throw e; }
}
if (!JSDOM) throw new Error('Profile day-flag DOM-adapter regression requires jsdom 26.1.0. Set TOBAN_DOM_MODULE to its installed module path. This test was NOT run.');
const N = ['Synthetic Trainer', 'Synthetic Colleague'], clone = x => JSON.parse(JSON.stringify(x));
const root = process.env.TOBAN_SOURCE_ROOT || __dirname;
const source = f => fs.readFileSync(path.join(root, 'src', f), 'utf8');
const scripts = ['i18n.js','rules-core.js','model.js', ...fs.readdirSync(path.join(root,'src/calendars')).filter(f=>f.endsWith('.js')).sort().map(f=>'calendars/'+f),
  'messages.js','solver.js','check.js','report.js','docxgen.js','plugins.js','merge.js', ...fs.readdirSync(path.join(root,'src/rules')).filter(f=>f.endsWith('.js')).sort().map(f=>'rules/'+f),
  'app-core.js','app-folder.js','app-month.js','app-input.js','app-settings.js','app-solve.js','app-main.js'];
const key = 'toban_state_v2:/synthetic/profile-day-flags.html';
const rawRules = {profile:{id:'synthetic-profile-day-flags',roles:[{id:'S',label:'Staff',refs:[]}],shifts:[{id:'day',on:'none'},{id:'night',on:'all'}]},doctors:N.map(name=>({name,team:'S',quota:15})),rule_states:{oncall:'off'},weights:{}};
const rawMonth = {year:2026,month:11,notes:'Synthetic day-flag roundtrip'};
async function makeApp(saved, fixture=rawRules, defaults=fixture) {
  const dom = new JSDOM(source('index.html'), {url:'https://example.invalid/synthetic/profile-day-flags.html',runScripts:'outside-only'}), w=dom.window;
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

let completed=false;process.on('exit',()=>{if(!completed){console.error('FAIL profile day-flag regression exited before all cases completed');process.exitCode=1;}});
const watchdog=setTimeout(()=>{console.error('FAIL profile day-flag regression timed out');process.exit(1);},120000);
(async()=>{
 let passed=0, failed=0;
 const localized={id:'training',label:{ja:'研修',en:'Training'},short:{ja:'研',en:'Train'}};
 const fixtureFor=flags=>{const r=clone(rawRules);r.profile.day_flags=clone(flags);r.composition=[{shift:'night',days:'flag:training',min:1,qual:'trainer'}];r.rule_states.composition='hard';r.doctors[0].quals=['trainer'];return r;};
 rawMonth.day_flags={7:['training']};
 const flagsOf=a=>clone(a.A.state.rules.profile.day_flags);
 const scope=a=>{const P=new a.w.T.Problem(a.A.state.rules,a.A.state.month);return clone(P.slots.filter(s=>P.compOn(P.comp[0],s)));};
 const test=async(label,fn,flags=[localized])=>{const r=fixtureFor(flags),a=await makeApp(null,r,r);a.enter();try{await fn(a,r);assert.deepStrictEqual(a.errors,[]);passed++;console.log('ok '+label);}catch(e){failed++;console.error('FAIL '+label+'\n'+e.stack);}finally{a.dom.window.close();}};
 for(const lang of ['en','ja']) await test(lang+': unrelated edits, language change, repeated reads and storage reload retain flag IDs and one-date composition',async(a,r)=>{
  a.w.T.registerLang({code:'ja'});a.w.T.setLang(lang);a.A.renderSettings();
  assert.equal(a.q('#setDayFlags').value,localized.label[lang]);
  assert.equal(a.q('[data-cdays]').value,'flag:training');assert.deepStrictEqual(scope(a),[[7,'night']]);
  for(const years of [12,13])a.change('#doctorTable tr[data-i="0"] [data-f="years"]',String(years));
  a.A.readSettings();a.A.readSettings();
  assert.deepStrictEqual(flagsOf(a),r.profile.day_flags);assert.deepStrictEqual(scope(a),[[7,'night']]);
  assert.deepStrictEqual(clone(a.A.state.rules.composition),r.composition);assert.deepStrictEqual(clone(a.A.state.month.day_flags),{7:['training']});
  a.w.T.setLang(lang==='en'?'ja':'en');a.A.renderSettings();a.A.readSettings();
  assert.deepStrictEqual(flagsOf(a),r.profile.day_flags);assert.deepStrictEqual(scope(a),[[7,'night']]);
  const b=await makeApp(a.w.localStorage.getItem(key),r,r);try{assert.deepStrictEqual(flagsOf(b),r.profile.day_flags);assert.deepStrictEqual(scope(b),[[7,'night']]);assert.deepStrictEqual(b.errors,[]);}finally{b.dom.window.close();}
 });
 await test('plain label with distinct ID remains unchanged',a=>{a.change('#doctorTable tr[data-i="0"] [data-f="years"]','12');assert.deepStrictEqual(flagsOf(a),[{id:'training',label:'Training',short:'Tr'}]);assert.deepStrictEqual(scope(a),[[7,'night']]);},[{id:'training',label:'Training',short:'Tr'}]);
 await test('duplicate translated labels and delimiter-bearing labels retain distinct IDs', (a,r)=>{a.change('#doctorTable tr[data-i="0"] [data-f="years"]','12');a.A.readSettings();assert.deepStrictEqual(flagsOf(a),r.profile.day_flags);assert.deepStrictEqual(scope(a),[[7,'night']]);},[localized,{id:'training-extra',label:{ja:'研修',en:'Training'},short:'X'},{id:'compound',label:{ja:'研修・会議',en:'Training・Meeting'}},'Plain・Compound']);
 await test('DOM-normalized newlines do not count as edits',(a,r)=>{assert.equal(a.q('#setDayFlags').value,'TrainingDay');a.change('#doctorTable tr[data-i="0"] [data-f="years"]','12');assert.deepStrictEqual(flagsOf(a),r.profile.day_flags);assert.deepStrictEqual(scope(a),[[7,'night']]);},[{id:'training',label:{ja:'研修\n日',en:'Training\r\nDay'},short:'Tr'}]);
 await test('explicit add/remove preserves retained object metadata and explicit clear works',a=>{
  a.change('#setDayFlags','Training・New event');assert.deepStrictEqual(flagsOf(a),[localized,'New event']);
  a.change('#setDayFlags','Training');assert.deepStrictEqual(flagsOf(a),[localized]);assert.deepStrictEqual(scope(a),[[7,'night']]);
  a.change('#setDayFlags','');assert.equal(a.A.state.rules.profile.day_flags,undefined);
 });

 await test('explicit edits prioritize shown labels over another flag ID',(a)=>{
  a.change('#setDayFlags','Training・New');assert.deepStrictEqual(flagsOf(a),[localized,'New']);
 },[localized,{id:'Training',label:'Other label',short:'Other'}]);
 await test('labels without current language use stable fallback',(a,r)=>{
  const before=a.q('#setDayFlags').value;assert.notEqual(before,'[object Object]');a.change('#doctorTable tr[data-i="0"] [data-f="years"]','12');assert.deepStrictEqual(flagsOf(a),r.profile.day_flags);assert.deepStrictEqual(scope(a),[[7,'night']]);
 },[{id:'training',label:{ja:'研修'},short:'Tr'},{id:'no-label'}]);
 await test('explicit label and ID aliases do not duplicate one definition',a=>{a.change('#setDayFlags','Training・training');assert.deepStrictEqual(flagsOf(a),[localized]);});
 assert.equal(passed+failed,9,'all planned cases completed');completed=true;clearTimeout(watchdog);
 console.log(`profile day-flag preservation: ${passed} passed, ${failed} failed`);if(failed)process.exitCode=1;
})().catch(e=>{clearTimeout(watchdog);console.error(e);process.exitCode=1;});

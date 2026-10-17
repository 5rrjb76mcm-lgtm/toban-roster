// Roster qualification text (doctors[].quals) survives unrelated roster edits and readback.
// Actual markup, init, delegated settings events, Problem and localStorage. Fictional data only; jsdom supplies the DOM.
// No browser, layout, OS permissions or network test is claimed; no sockets are opened.
// Run: TOBAN_DOM_MODULE=/path/to/node_modules/jsdom node test_roster_qual_preservation_dom_node.js
const fs = require('fs'), path = require('path'), assert = require('assert');
// Verified with jsdom 26.1.0. Dependency lookup never downloads/install packages.
let JSDOM;
for (const name of [process.env.TOBAN_DOM_MODULE, 'jsdom', path.join(process.env.HOME || '', '.toban-test/node_modules/jsdom')].filter(Boolean)) {
  try { ({ JSDOM } = require(name)); break; } catch (e) { if (e.code !== 'MODULE_NOT_FOUND') throw e; }
}
if (!JSDOM) throw new Error('Roster qualification DOM regression requires jsdom 26.1.0. Set TOBAN_DOM_MODULE to its installed module path. This test was NOT run.');
const N = ['Synthetic Trainer', 'Synthetic Colleague'], clone = x => JSON.parse(JSON.stringify(x));
const root = process.env.TOBAN_SOURCE_ROOT || __dirname;
const source = f => fs.readFileSync(path.join(root, 'src', f), 'utf8');
const scripts = ['i18n.js','rules-core.js','model.js', ...fs.readdirSync(path.join(root,'src/calendars')).filter(f=>f.endsWith('.js')).sort().map(f=>'calendars/'+f),
  'messages.js','solver.js','check.js','report.js','docxgen.js','plugins.js','merge.js', ...fs.readdirSync(path.join(root,'src/rules')).filter(f=>f.endsWith('.js')).sort().map(f=>'rules/'+f),
  'app-core.js','app-folder.js','app-month.js','app-input.js','app-settings.js','app-solve.js','app-main.js'];
const key = 'toban_state_v2:/synthetic/roster-qual-preservation.html';
const rawMonth = {year:2026,month:11,notes:'Synthetic roster qualification roundtrip'};
const Q = 'Trainer\r\nSenior';
function rulesWith(quals, qual = Q, exempt = Q) { return {profile:{id:'synthetic-roster-qual',roles:[{id:'S',label:'Staff',refs:[]}],shifts:[{id:'day',on:'all'},{id:'night',on:'all'}]},
  doctors:[{name:N[0],team:'S',quota:15,quals},{name:N[1],team:'S',quota:15}],rule_states:{oncall:'off',composition:'hard',run_length_max:'hard'},weights:{},
  composition:[{shift:'night',qual,min:1}],run_length:{max:3,exempt_qual:exempt}}; }
async function makeApp(rules, saved) {
  const dom = new JSDOM(source('index.html'), {url:'https://example.invalid/synthetic/roster-qual-preservation.html',runScripts:'outside-only'}), w=dom.window;
  await new Promise(resolve=>w.document.readyState==='complete'?resolve():w.addEventListener('load',resolve,{once:true}));
  const errors=[]; w.addEventListener('error',e=>{errors.push(e.error || e.message);e.preventDefault();});
  w.confirm=()=>true; w.alert=msg=>{throw new Error('Unexpected alert: '+msg);}; w.prompt=()=>null;
  w.T={DEFAULT_RULES:clone(rules), SAMPLE_MONTH:clone(rawMonth), PROFILES:[], LANGS_DATA:['en','ja'].map(code=>JSON.parse(fs.readFileSync(path.join(root,'lang',code+'.json'),'utf8')))};
  for(const f of scripts) w.eval(source(f)+'\n//# sourceURL='+f);
  const A=w.T.app; A.restoreFolder=()=>{}; A.toast=()=>{};
  w.localStorage.setItem('toban.lang','en');
  const initial=clone(rules); w.T.fillDefaultRules(initial);
  for(const def of w.T.RULE_DEFS) if(def.states.includes('off') && rules.rule_states?.[def.id] === undefined) initial.rule_states[def.id]='off';
  w.T.fillDefaultRules(initial);
  w.localStorage.setItem(key,saved || JSON.stringify({rules:initial,month:rawMonth,result:null,ui:{doctor:1}}));
  w.T.init();
  const q=s=>w.document.querySelector(s), click=s=>{assert(q(s),'Missing '+s);q(s).click();}, change=(s,v)=>{const el=typeof s==='string'?q(s):s;assert(el,'Missing '+s);if(el.type==='checkbox')el.checked=v;else el.value=v;el.dispatchEvent(new w.Event('change',{bubbles:true}));};
  const enter=()=>{click('.tab[data-tab="settings"]');click('[data-setmode="daily"]');};
  return {dom,w,A,q,click,change,enter,errors};
}
const quals=a=>clone(a.A.state.rules.doctors[0].quals === undefined ? null : a.A.state.rules.doctors[0].quals); // null = key absent
const sem=a=>{const P=new a.w.T.Problem(a.A.state.rules,a.A.state.month);return clone({matches:P.comp.map(c=>P.compMatch(c,N[0])),run:P.runApplies(N[0])});};
const unrelated=a=>a.change('#doctorTable tr[data-i="1"] [data-f="years"]','12'); // another person's years
const box=(a,name)=>[...a.q('#doctorTable tr[data-i="0"]').querySelectorAll('[data-q]')].find(x=>x.dataset.q===name);
const cases=[],test=(name,fn)=>cases.push({name,fn});
const EXPECTED_CASES=21;let passed=0,failed=0,completed=false;
process.on('exit',()=>{if(!completed || passed+failed!==EXPECTED_CASES){console.error('FAIL incomplete roster qualification cases');process.exitCode=1;}});
const watchdog=setTimeout(()=>{console.error('FAIL roster qualification timeout');process.exit(1);},120000);watchdog.unref();
async function untouched(stored, expectMatch, label) {
  const a=await makeApp(rulesWith(stored));try{
    a.enter();const before=stored, s0=sem(a);assert.deepStrictEqual(s0.matches,[expectMatch],label+' initial match');
    unrelated(a);assert.strictEqual(a.A.state.rules.doctors[1].years,12);assert.deepStrictEqual(quals(a),before,label+' after unrelated roster edit');assert.deepStrictEqual(sem(a),s0,label+' semantics');
    a.A.readSettings();a.A.renderSettings();a.A.readSettings();assert.deepStrictEqual(quals(a),before,label+' after repeated readback');
    assert.deepStrictEqual(JSON.parse(a.A.payloadJson()).rules.doctors[0].quals,before,label+' payload');
    const b=await makeApp(rulesWith(stored),a.w.localStorage.getItem(key));try{b.enter();b.A.readSettings();assert.deepStrictEqual(quals(b),before,label+' after reload');assert.deepStrictEqual(sem(b),s0);assert.deepStrictEqual(b.errors,[]);}finally{b.dom.window.close();}
    assert.deepStrictEqual(a.errors,[]);
  }finally{a.dom.window.close();}
}
test('CRLF qualification stays raw and keeps matching the rule',()=>untouched([Q],true,'CRLF'));
test('lone CR qualification stays raw',()=>untouched(['Trainer\rSenior'],false,'CR')); // rule text is CRLF here, so no match either way
test('LF qualification stays raw',()=>untouched(['Trainer\nSenior'],false,'LF'));
test('tab and U+2028 inside a qualification stay raw',()=>untouched(['Trainer\tSenior','Trainer Senior'],false,'control chars'));
test('surrounding blanks are opaque and kept',()=>untouched([' Trainer '],false,'blanks'));
test('separator characters inside one element are opaque and kept',()=>untouched(['Trainer・Senior','A,B','C、D','E|F'],false,'separators'));
test('duplicates are kept as stored',()=>untouched(['Trainer','Trainer'],false,'duplicates'));
test('plain qualification (control)',()=>untouched(['Trainer'],false,'plain'));
test('non-array quals (string) is kept as stored when untouched',async()=>{const a=await makeApp(rulesWith('Trainer','Trainer','Trainer'));try{a.enter();unrelated(a);assert.strictEqual(a.A.state.rules.doctors[0].quals,'Trainer');a.A.readSettings();assert.strictEqual(a.A.state.rules.doctors[0].quals,'Trainer');assert.deepStrictEqual(a.errors,[]);}finally{a.dom.window.close();}});
test('absent quals stays absent',async()=>{const a=await makeApp(rulesWith(undefined));try{a.enter();unrelated(a);assert.strictEqual(quals(a),null);assert.deepStrictEqual(a.errors,[]);}finally{a.dom.window.close();}});
test('empty quals array stays empty',async()=>{const a=await makeApp(rulesWith([]));try{a.enter();unrelated(a);assert.deepStrictEqual(quals(a),[]);assert.deepStrictEqual(a.errors,[]);}finally{a.dom.window.close();}});
test('CRLF element shows as checked and the rule-side CRLF text is unaffected',async()=>{const a=await makeApp(rulesWith([Q]));try{a.enter();const b=box(a,'Trainer\nSenior');assert(b,'normalized checkbox');assert.strictEqual(b.checked,true);unrelated(a);assert.strictEqual(a.A.state.rules.composition[0].qual,Q);assert.strictEqual(a.A.state.rules.run_length.exempt_qual,Q);assert.deepStrictEqual(a.errors,[]);}finally{a.dom.window.close();}});
test('unchecking removes only the elements that box owns (CR variants), opaque elements stay',async()=>{const a=await makeApp(rulesWith([Q,'Trainer\nSenior',' Trainer ','Other']));try{a.enter();a.change(box(a,'Trainer\nSenior'),false);assert.deepStrictEqual(quals(a),[' Trainer ','Other']);assert.deepStrictEqual(sem(a).matches,[false]);unrelated(a);assert.deepStrictEqual(quals(a),[' Trainer ','Other']);assert.deepStrictEqual(a.errors,[]);}finally{a.dom.window.close();}});
test('checking a box adds that name once and keeps opaque elements',async()=>{const a=await makeApp(rulesWith([' Trainer '],'Trainer','Trainer'));try{a.enter();assert.deepStrictEqual(sem(a).matches,[false]);a.change(box(a,'Trainer'),true);assert.deepStrictEqual(quals(a),[' Trainer ','Trainer']);assert.deepStrictEqual(sem(a).matches,[true]);a.A.readSettings();assert.deepStrictEqual(quals(a),[' Trainer ','Trainer']);assert.deepStrictEqual(a.errors,[]);}finally{a.dom.window.close();}});
test('unchecking the last owned element removes the key',async()=>{const a=await makeApp(rulesWith(['Trainer'],'Trainer','Trainer'));try{a.enter();a.change(box(a,'Trainer'),false);assert.strictEqual(quals(a),null);assert.deepStrictEqual(sem(a),{matches:[false],run:true});assert.deepStrictEqual(a.errors,[]);}finally{a.dom.window.close();}});
test('free text adds names (separators split) without touching stored elements',async()=>{const a=await makeApp(rulesWith(['Trainer・Senior']));try{a.enter();a.change('#doctorTable tr[data-i="0"] [data-f="quals"]','Chief・Lead, Lead');assert.deepStrictEqual(quals(a),['Trainer・Senior','Chief','Lead']);unrelated(a);assert.deepStrictEqual(quals(a),['Trainer・Senior','Chief','Lead']);assert.deepStrictEqual(a.errors,[]);}finally{a.dom.window.close();}});
test('explicit uncheck then check round trip restores a plain name',async()=>{const a=await makeApp(rulesWith(['Trainer'],'Trainer','Trainer'));try{a.enter();a.change(box(a,'Trainer'),false);assert.strictEqual(quals(a),null);a.change(box(a,'Trainer'),true);assert.deepStrictEqual(quals(a),['Trainer']);assert.deepStrictEqual(a.errors,[]);}finally{a.dom.window.close();}});
test('undo once restores the stored array after an explicit uncheck',async()=>{const a=await makeApp(rulesWith([Q,' Trainer ']));try{a.enter();a.A.clearUndo();a.change(box(a,'Trainer\nSenior'),false);assert.deepStrictEqual(quals(a),[' Trainer ']);a.A.undo();assert.deepStrictEqual(quals(a),[Q,' Trainer ']);assert(a.q('#btnUndo').disabled);assert.deepStrictEqual(a.errors,[]);}finally{a.dom.window.close();}});
test('rename of the person keeps the raw qualification',async()=>{const a=await makeApp(rulesWith([Q]));try{a.enter();a.change('#doctorTable tr[data-i="0"] [data-f="name"]','Synthetic Renamed');assert.strictEqual(a.A.state.rules.doctors[0].name,'Synthetic Renamed');assert.deepStrictEqual(quals(a),[Q]);assert.deepStrictEqual(a.errors,[]);}finally{a.dom.window.close();}});
test('editing the same person\'s years keeps the raw qualification',async()=>{const a=await makeApp(rulesWith([Q]));try{a.enter();a.change('#doctorTable tr[data-i="0"] [data-f="years"]','3');assert.strictEqual(a.A.state.rules.doctors[0].years,3);assert.deepStrictEqual(quals(a),[Q]);assert.deepStrictEqual(a.errors,[]);}finally{a.dom.window.close();}});
test('rule-side text edit keeps roster quals',async()=>{const a=await makeApp(rulesWith([Q]));try{a.enter();a.change('#setRunExempt','Other');assert.strictEqual(a.A.state.rules.run_length.exempt_qual,'Other');assert.deepStrictEqual(quals(a),[Q]);assert.deepStrictEqual(a.errors,[]);}finally{a.dom.window.close();}});
(async()=>{assert.strictEqual(cases.length,EXPECTED_CASES);for(const c of cases){try{await c.fn();passed++;console.log('PASS '+c.name);}catch(e){failed++;console.error('FAIL '+c.name,e);}}completed=true;clearTimeout(watchdog);console.log(`roster qualification preservation: ${passed} passed, ${failed} failed, ${cases.length} total`);if(failed)process.exitCode=1;})().catch(e=>{console.error(e);process.exitCode=1;});

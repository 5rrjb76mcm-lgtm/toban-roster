// Report notes must describe only active rules. Fictional normal inputs solved with real HiGHS.
const fs=require('fs'),vm=require('vm'),path=require('path'),assert=require('assert');globalThis.T={};
for(const f of ['i18n.js','rules-core.js','model.js','messages.js','solver.js','check.js','report.js'])vm.runInThisContext(fs.readFileSync(path.join(__dirname,'src',f),'utf8'),{filename:f});
for(const dir of ['rules','calendars'])for(const f of fs.readdirSync(path.join(__dirname,'src',dir)).filter(f=>f.endsWith('.js')))vm.runInThisContext(fs.readFileSync(path.join(__dirname,'src',dir,f),'utf8'));
for(const f of fs.readdirSync(path.join(__dirname,'lang')))T.registerLang(JSON.parse(fs.readFileSync(path.join(__dirname,'lang',f),'utf8')));
T.DEFAULT_RULES=JSON.parse(fs.readFileSync(path.join(__dirname,'data/rules.json'),'utf8'));T.setLang('en');
function fixture(states, { paid = false, exact = false, runs = false } = {}){const R=JSON.parse(JSON.stringify(T.DEFAULT_RULES));R.profile={id:'fictional-report',shifts:[{id:'day',on:'all'},{id:'night',on:'all'}],roles:[{id:'Q',label:'Charge',refs:['charge']}]};R.doctors=['Fictional A','Fictional B'].map(name=>({name,team:'Q',quota:30}));R.name_order=R.doctors.map(d=>d.name);R.friday_night_min={};R.rule_states=Object.assign(Object.fromEntries(T.RULE_DEFS.map(d=>[d.id,'off'])),states);R.days_off={min:states.days_off_min==='hard'?0:8,mode:exact?'exact':'min',pair_count:runs?'runs':'pairs'};
if(paid){R.doctors.push({name:'Fictional C',team:'Q',quota:0,duty:'never'});R.name_order.push('Fictional C');}T.fillDefaultRules(R);const fixed={day:{},night:{}};for(let d=1;d<=30;d++){fixed.day[d]='Fictional A';fixed.night[d]='Fictional B';}return new T.Problem(R,T.normalizeMonth({year:2026,month:11,holidays:[],fixed,unavailable_other:paid?[{name:'Fictional C',day:1,part:'allday',paid:true}]:[]},R));}

(async()=>{
 assert(process.argv[2], 'Pass the HiGHS package path');
 const highs=await require(process.argv[2])();let passed=0;
 for(const lang of ['en','ja'])for(const states of [{days_off_pair:'soft'},{days_off_min:'soft'},{days_off_min:'soft',days_off_pair:'soft'},{days_off_min:'hard'},{}])for(const exact of [false,true]){
  T.setLang(lang);const P=fixture(states,{paid:true,exact,runs:true}),r=await T.solve(P,highs,{timeLimit:5});
  assert.equal(r.status,'Optimal');assert.equal(T.check(P,r.asg).V.length,0);assert.equal(r.objective,T.penalty(P,r.asg).total);
  const html=T.buildReport(P,r.asg,r).sections.find(s=>s.id==='s6').html;
  const hasMin=!!states.days_off_min,hasPair=!!states.days_off_pair;
  assert.equal(html.includes(T.t('月の休みの日数と 2 連休')),hasMin||hasPair);
  if(hasMin||hasPair){
   assert.equal(html.includes(T.t(P.offExact?'暦 {N} 日。休みはちょうど {min} 日':'暦 {N} 日。最低の休み {min} 日',{N:P.N,min:P.minDaysOff})),hasMin,'disabled minimum must not be described as required');
   assert.equal(html.includes(T.t('。有給の日数は必要な休みに足す')),hasMin,'paid leave only changes an active days-off target');
   assert.equal(html.includes(T.t('、2 連休は最低 {pair} 回',{pair:P.pairMin})),hasPair);
   assert.equal(html.includes(T.t('。2 連休は続いた休みを 1 回と数える')),hasPair&&P.pairRuns);
  }
  passed++;
 }
 console.log(`${passed} report rule-state cases passed (real HiGHS, Japanese and English, minimum/exact, paid leave, and pair counting)`);
})().catch(e=>{console.error(e);process.exitCode=1});

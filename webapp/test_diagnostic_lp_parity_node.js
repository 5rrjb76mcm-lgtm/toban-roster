// Exact normal-model comparison against an optional pristine checkout (no private data).
const fs=require('fs'),path=require('path'),vm=require('vm'),assert=require('assert');
const baseline=process.argv[2];if(!baseline)throw new Error('Pass pristine webapp directory');
function load(root){const c=vm.createContext({console});for(const f of ['i18n.js','rules-core.js','model.js','messages.js','solver.js','check.js'])vm.runInContext(fs.readFileSync(path.join(root,'src',f),'utf8'),c);for(const dir of ['rules','calendars'])for(const f of fs.readdirSync(path.join(root,'src',dir)).filter(x=>x.endsWith('.js')).sort())vm.runInContext(fs.readFileSync(path.join(root,'src',dir,f),'utf8'),c);return c.T;}
const old=load(baseline),next=load(__dirname);let count=0;
for(const file of ['rules.json',...fs.readdirSync(path.join(__dirname,'data/fixtures')).filter(f=>f.endsWith('.json')).map(f=>'fixtures/'+f)]){
const r=JSON.parse(fs.readFileSync(path.join(__dirname,'data',file),'utf8'));if(!r.doctors)continue;
for(const state of ['default','hard','soft','off']) {
const models=[old,next].map(T=>{T.DEFAULT_RULES=JSON.parse(fs.readFileSync(path.join(__dirname,'data/rules.json'),'utf8'));const R=JSON.parse(JSON.stringify(r));T.fillDefaultRules(R);if(state!=='default')for(const d of T.RULE_DEFS)if(d.states.includes(state))R.rule_states[d.id]=state;if(file.includes('ward-')){R.rule_states.oncall='off';R.rule_states.period_charge='off';}const P=new T.Problem(R,T.normalizeMonth({year:2026,month:11,holidays:[3,23]},R));return T.buildLP(P).lp.toLP();});assert.strictEqual(models[1],models[0],file+' '+state);console.log('unchanged normal LP: '+file+' '+state);count++;}
}
assert(count>=2);console.log('ALL OK ('+count+' normal LP models byte-identical)');

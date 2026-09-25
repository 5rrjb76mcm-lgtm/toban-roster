const fs=require('fs'), vm=require('vm'), path=require('path');
globalThis.T={};
for (const f of ['i18n.js',"rules-core.js", 'model.js','messages.js','solver.js','check.js']) vm.runInThisContext(fs.readFileSync(path.join(__dirname,'src',f),'utf8'), {filename:f});
for (const f of fs.readdirSync(path.join(__dirname, "src/rules")).filter(x => x.endsWith(".js"))) vm.runInThisContext(fs.readFileSync(path.join(__dirname, "src/rules", f), "utf8"), { filename: "rules/" + f }); // 規則のプラグイン
for (const f of fs.readdirSync(path.join(__dirname, "src/calendars")).filter(x => x.endsWith(".js"))) vm.runInThisContext(fs.readFileSync(path.join(__dirname, "src/calendars", f), "utf8"), { filename: "calendars/" + f }); // 暦のプラグイン
for (const q of fs.readdirSync(path.join(__dirname,"lang"))) T.registerLang(JSON.parse(fs.readFileSync(path.join(__dirname,"lang",q),"utf8")));
const rules=JSON.parse(fs.readFileSync('data/rules.json','utf8')), month=JSON.parse(fs.readFileSync('data/202611.json','utf8'));
// 11月パターン→日別→パターン推定→12月展開 と、11月パターンをそのまま12月展開 を比較
const dd=T.expandDuties(rules, month); const m1=Object.assign({}, month, {duty_days: dd});
const inf=T.inferPatterns(rules, m1);
const dec=Object.assign({}, month, {year:2026, month:12, holidays:[]});
const a=T.expandDuties(rules, Object.assign({}, dec, {regular_duties: inf}));
const b=T.expandDuties(rules, dec);
let diff=0; for (const n of Object.keys(b)) for (let d=1; d<=31; d++) for (const p of ['am','pm']) { const x=((a[n]||{})[d]||{})[p]||'', y=((b[n]||{})[d]||{})[p]||''; if (x!==y) { diff++; if (diff<6) console.log('diff',n,d,p,x,y); } }
console.log('inferred patterns Dr E:', JSON.stringify(inf['Dr E']));
console.log('12月展開の差分（推定 vs 元パターン）:', diff);
// 固定OC の検証
const m2=JSON.parse(JSON.stringify(month)); m2.fixed.day_oc={7:['Dr S']}; m2.fixed.night_oc={7:['Dr G']};
const P=new T.Problem(rules, m2); console.log('lint:', T.lint(P).map(x=>x.msg));
(async()=>{ const highs=await require(process.argv[2])(); const r=T.solve(P,highs,{timeLimit:60}); console.log('solve with fixed OC:', r.status, r.seconds+'s'); const c=T.check(P,r.asg); console.log('violations', c.V.length, '7:day oc', r.asg['7:day'].oc, '7:night oc', r.asg['7:night'].oc);
  fs.writeFileSync('data/202611_fixedoc.json', JSON.stringify(m2,null,1)); fs.writeFileSync('data/js_assignment_fixedoc.json', JSON.stringify(r.asg,null,1)); })();

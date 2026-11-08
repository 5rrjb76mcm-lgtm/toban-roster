// Result calendar translates both half-day labels. The production app-solve renderer
// runs with a minimal DOM and a synthetic Problem; this is not a real-browser test.
const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert/strict');
const ROOT = path.resolve(process.env.TOBAN_WEBAPP_ROOT || __dirname);
const elements = Object.fromEntries(['result','docCal','dcSel','dcPrev','dcNext'].map(id => [id, {innerHTML:'', value:''}]));
global.document = {querySelector(s) { return elements[s.slice(1)]; }};
global.T = {app:{state:{rules:{}, month:{doc_versions:[]}, result:{asg:{},status:'Optimal'}}, isDirty:()=>false, inputSig:()=>'',}};
vm.runInThisContext(fs.readFileSync(path.join(ROOT,'src/i18n.js'),'utf8'), {filename:'i18n.js'});
for (const lang of ['ja','en']) T.registerLang(JSON.parse(fs.readFileSync(path.join(ROOT,'lang',lang+'.json'),'utf8')));
for (const f of ['rules-core.js','model.js']) vm.runInThisContext(fs.readFileSync(path.join(ROOT,'src',f),'utf8'), {filename:f});
T.rules.checkCtx = () => ({offDays:()=>[]});
Object.assign(T, {dayFlags:{activeFor:()=>[]}, buildReport:()=>({V:[],W:[],sections:[]}),
 Problem:class { constructor(){this.names=['Synthetic A'];this.rules={};this.year=2026;this.month=11;this.N=2;this.paidDays={};this.holidaysExtra=new Set();this.akeIsOff=true;} dow(){return 0;} dutyItems(n,d,part){return d === 2 ? [{kind:part==='am'?'ward':'external'}] : [];} prevWorked(){return false;} state(){return 'off';} isHard(){return false;} shiftLabel(k){return k;} },
 Asg:class {} });
vm.runInThisContext(fs.readFileSync(path.join(ROOT,'src/app-solve.js'),'utf8'), {filename:'app-solve.js'});
function render(l) { T.setLang(l); T.app.renderResult('resCal'); return elements.docCal.innerHTML; }
const checks = [
  ['English labels', () => { const en=render('en'); assert(en.includes('morning ward'), en); assert(en.includes('afternoon outside work'), en); assert(!en.includes('午前 ')); assert(!en.includes('午後 ')); }],
  ['Japanese labels', () => { const ja=render('ja'); assert(ja.includes('午前 病棟番'), ja); assert(ja.includes('午後 外勤'), ja); }],
  ['Other language with English fallback', () => { T.registerLang({code:'xx',name:'Synthetic',ui:{'午前':'matin'}}); const v=render('xx'); assert(v.includes('matin ward'), v); assert(v.includes('afternoon outside work'), v); }],
  ['Escapes translated time and duty labels', () => { T.registerLang({code:'xx',ui:{'午前':'<am & "x">','午後':'<pm>', '病棟番':'<ward>'}}); const v=render('xx'); assert(v.includes('&lt;am &amp; &quot;x&quot;&gt; &lt;ward&gt;'), v); assert(v.includes('&lt;pm&gt; outside work'), v); assert(!v.includes('<am')); assert(!v.includes('<ward>')); }],
  ['Missing in both custom and English falls back to Japanese', () => { T.registerLang({code:'xx',ui:{'午後':null}}); T.registerLang({code:'en',ui:{'午後':null}}); const v=render('xx'); assert(v.includes('午後 outside work'), v); }],
];
let failed = 0;
for (const [name, check] of checks) { try { check(); console.log('PASS ' + name); } catch (e) { failed++; console.log('FAIL ' + name + ': ' + e.message.slice(0,120)); } }
console.log(`RESULT ${checks.length-failed}/${checks.length}`); if (failed) process.exitCode = 1;

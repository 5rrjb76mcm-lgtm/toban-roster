const fs=require('fs'), vm=require('vm'), path=require('path');
globalThis.T={}; for (const f of ['i18n.js',"rules-core.js", 'model.js','messages.js','merge.js']) vm.runInThisContext(fs.readFileSync(path.join(__dirname,'src',f),'utf8'), {filename:f});
for (const f of fs.readdirSync(path.join(__dirname, "src/rules")).filter(x => x.endsWith(".js"))) vm.runInThisContext(fs.readFileSync(path.join(__dirname, "src/rules", f), "utf8"), { filename: "rules/" + f }); // 規則のプラグイン
for (const f of fs.readdirSync(path.join(__dirname, "src/calendars")).filter(x => x.endsWith(".js"))) vm.runInThisContext(fs.readFileSync(path.join(__dirname, "src/calendars", f), "utf8"), { filename: "calendars/" + f }); // 暦のプラグイン
for (const q of fs.readdirSync(path.join(__dirname,"lang"))) T.registerLang(JSON.parse(fs.readFileSync(path.join(__dirname,"lang",q),"utf8")));
const rules=JSON.parse(fs.readFileSync('data/rules.json','utf8')); const base=JSON.parse(fs.readFileSync('data/202611_rebuilt_month.json','utf8'));
// 往復
const rt=T.unflattenMonth(T.flattenMonth(base), base);
const norm=o=>{const f=T.flattenMonth(o); return JSON.stringify(Object.keys(f).sort().map(k=>[k,f[k]]));}; const eq=norm(rt)===norm(base); console.log('round trip equal:', eq); if(!eq){ process.exitCode=1; }
// mine: 祝日追加とDr Eの11/4午前を消す。theirs: Dr F 11/9 夜勤不可、メモ変更、Dr E 11/4 午前は同じまま
const mine=JSON.parse(JSON.stringify(base)); mine.holidays.push(24); delete mine.duty_days['Dr E']['4'].am;
const theirs=JSON.parse(JSON.stringify(base)); theirs.unavailable_night['Dr F'].push(9); theirs.notes='相手のメモ';
let r=T.mergeMonth(base, mine, theirs); console.log('no-conflict merge:', {mine:r.mineChanges, theirs:r.theirChanges, conflicts:r.conflicts.length, hol:r.merged.holidays, asano:r.merged.unavailable_night['Dr F'], notes:r.merged.notes, shimura4:r.merged.duty_days['Dr E'][4]});
// 衝突: 両方がメモを変更
const mine2=JSON.parse(JSON.stringify(mine)); mine2.notes='自分のメモ';
r=T.mergeMonth(base, mine2, theirs, 'theirs'); console.log('conflict:', r.conflicts.map(c=>[c.label,c.mine,c.theirs]), 'chosen notes:', r.merged.notes);
r=T.mergeMonth(base, mine2, theirs, 'mine'); console.log('prefer mine notes:', r.merged.notes);

// 新しい項目（固定の印・日ごとの区分・予定・プラグインの欄・使ったプラグイン）: 自分だけ削除／相手だけ削除／削除と変更の衝突で削除側を採用。往復で配列が重複しない
{ const b2=JSON.parse(JSON.stringify(base)); b2.fixed_tags={"5:day|Dr E":"研修"}; b2.day_flags={5:["行事"]}; b2.day_notes={5:"予定"}; b2.person_days={"local.x":{"Dr E":{5:"x"}}}; b2.plugins_used=["local.x"];
  const rt2=T.unflattenMonth(T.flattenMonth(b2), b2); const dup = rt2.day_flags[5].length!==1 || rt2.plugins_used.length!==1; console.log('round trip no dup (new items):', !dup); if (dup) process.exitCode=1;
  const mine3=JSON.parse(JSON.stringify(b2)); delete mine3.fixed_tags; delete mine3.day_flags; delete mine3.day_notes; delete mine3.person_days; delete mine3.plugins_used;
  const theirs3=JSON.parse(JSON.stringify(b2)); theirs3.notes='相手';
  const r3=T.mergeMonth(b2, mine3, theirs3); const gone = !Object.keys(r3.merged.fixed_tags||{}).length && !Object.keys(r3.merged.day_flags||{}).length && !Object.keys(r3.merged.day_notes||{}).length && !Object.keys((r3.merged.person_days||{})["local.x"]||{}).length && !(r3.merged.plugins_used||[]).length;
  console.log('mine deleted new items stay deleted:', gone, 'conflicts', r3.conflicts.length); if (!gone) process.exitCode=1;
  const r4=T.mergeMonth(b2, theirs3, mine3); const gone4 = !Object.keys(r4.merged.fixed_tags||{}).length && !(r4.merged.plugins_used||[]).length; console.log('theirs deleted new items stay deleted:', gone4); if (!gone4) process.exitCode=1;
  const theirs5=JSON.parse(JSON.stringify(b2)); theirs5.fixed_tags={"5:day|Dr E":"会議"}; const r5=T.mergeMonth(b2, mine3, theirs5, 'mine'); const c5=r5.conflicts.length>0 && !Object.keys(r5.merged.fixed_tags||{}).length; console.log('delete vs change conflict, mine(delete) chosen:', c5, r5.conflicts.map(c=>c.label)); if (!c5) process.exitCode=1; }

// 本体が知らないトップレベルの項目（プラグインの規則の ui.month が書く m.local_<施設>）: 値全体を 1 項目として 3 者比較する
{ const b=JSON.parse(JSON.stringify(base)); b.local_example={max:3, days:[1,2]};
  const rt=T.unflattenMonth(T.flattenMonth(b), b); const ok0 = JSON.stringify(rt.local_example)===JSON.stringify(b.local_example); console.log('unknown item round trip:', ok0); if(!ok0) process.exitCode=1;
  const mine=JSON.parse(JSON.stringify(b)); mine.local_example.max=7; const theirs=JSON.parse(JSON.stringify(b)); theirs.notes='相手のメモ';
  let r=T.mergeMonth(b, mine, theirs); const ok1 = r.merged.local_example.max===7 && r.merged.notes==='相手のメモ' && r.mineChanges===1 && r.theirChanges===1 && r.conflicts.length===0; console.log('unknown item mine-only change kept:', ok1, {max:r.merged.local_example.max, mine:r.mineChanges, theirs:r.theirChanges}); if(!ok1) process.exitCode=1;
  r=T.mergeMonth(b, theirs, mine); const ok2 = r.merged.local_example.max===7 && r.theirChanges===1; console.log('unknown item theirs-only change kept:', ok2); if(!ok2) process.exitCode=1;
  const theirs2=JSON.parse(JSON.stringify(b)); theirs2.local_example.max=9;
  r=T.mergeMonth(b, mine, theirs2, 'theirs'); const ok3 = r.conflicts.length===1 && /local_example/.test(r.conflicts[0].label) && r.merged.local_example.max===9; console.log('unknown item both changed -> conflict, theirs:', ok3, r.conflicts.map(c=>c.label)); if(!ok3) process.exitCode=1;
  r=T.mergeMonth(b, mine, theirs2, 'mine'); const ok4 = r.merged.local_example.max===7; console.log('unknown item conflict, mine:', ok4); if(!ok4) process.exitCode=1;
  const mine3=JSON.parse(JSON.stringify(b)); delete mine3.local_example; r=T.mergeMonth(b, mine3, theirs); const ok5 = !('local_example' in r.merged) && r.mineChanges===1 && r.conflicts.length===0; console.log('unknown item deleted by mine stays deleted:', ok5); if(!ok5) process.exitCode=1;
  r=T.mergeMonth(b, theirs, mine3); const ok6 = !('local_example' in r.merged); console.log('unknown item deleted by theirs stays deleted:', ok6); if(!ok6) process.exitCode=1;
  const mine4=JSON.parse(JSON.stringify(b)); mine4.local_example={}; r=T.mergeMonth(b, mine4, theirs); const ok7 = !('local_example' in r.merged) && r.mineChanges===1; console.log('unknown item emptied == deleted:', ok7); if(!ok7) process.exitCode=1; }

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
  const mine4=JSON.parse(JSON.stringify(b)); mine4.local_example={}; r=T.mergeMonth(b, mine4, theirs); const ok7 = JSON.stringify(r.merged.local_example)==='{}' && r.mineChanges===1; console.log('unknown item emptied stays {} (value kept, deletion = key absent):', ok7); if(!ok7) process.exitCode=1; }
// 未知の項目の false・null は値として残る（プラグインの「未指定なら true」と区別する）
{ const b=JSON.parse(JSON.stringify(base)); b.local_enabled=true; b.local_null=null;
  const rt=T.unflattenMonth(T.flattenMonth(b), b); const ok0 = rt.local_enabled===true && ('local_null' in rt) && rt.local_null===null; console.log('unknown false/null round trip:', ok0); if(!ok0) process.exitCode=1;
  const mine=JSON.parse(JSON.stringify(b)); mine.local_enabled=false; const theirs=JSON.parse(JSON.stringify(b)); theirs.notes='相手';
  let r=T.mergeMonth(b, mine, theirs); const ok1 = Object.hasOwn(r.merged,'local_enabled') && r.merged.local_enabled===false && r.mineChanges===1 && r.conflicts.length===0; console.log('unknown true->false by mine kept as false:', ok1); if(!ok1) process.exitCode=1;
  const theirs2=JSON.parse(JSON.stringify(b)); delete theirs2.local_enabled; r=T.mergeMonth(b, mine, theirs2, 'theirs'); const ok2 = r.conflicts.length===1 && !('local_enabled' in r.merged); console.log('mine false vs theirs delete -> conflict, theirs(delete):', ok2); if(!ok2) process.exitCode=1;
  r=T.mergeMonth(b, mine, theirs2, 'mine'); const ok3 = r.merged.local_enabled===false; console.log('mine false vs theirs delete -> conflict, mine(false):', ok3); if(!ok3) process.exitCode=1; }
// 同じ日の「日勤帯の不可＋夜勤の避」: 往復でも、無関係な項目の統合でも両方残る。片方だけを消した・変えた側の変更はそのとおりに入る。不可に含まれる避（同じ時間帯）は不可にまとまる
{ const assert = require('assert'), c = o => JSON.parse(JSON.stringify(o)), b0 = c(base); b0.unavailable_other = (b0.unavailable_other || []).filter(u => !(u.name === 'Dr E' && +u.day === 7)).concat([{ name: 'Dr E', day: 7, part: 'day' }]); b0.avoid = (b0.avoid || []).filter(u => !(u.name === 'Dr E' && +u.day === 7)).concat([{ name: 'Dr E', day: 7, part: 'night' }]); b0.unavailable_night['Dr E'] = (b0.unavailable_night['Dr E'] || []).filter(d => d !== 7);
  const both = m => ({ un: (m.unavailable_other || []).filter(u => u.name === 'Dr E' && +u.day === 7).map(u => u.part + (u.paid ? '_paid' : '')), av: (m.avoid || []).filter(u => u.name === 'Dr E' && +u.day === 7).map(u => u.part), night: (m.unavailable_night['Dr E'] || []).includes(7) });
  assert.strictEqual(JSON.parse(T.flattenMonth(b0)['cal:Dr E:7']), 'day+avoid_night'); assert.deepStrictEqual(both(T.unflattenMonth(T.flattenMonth(b0), b0)), { un: ['day'], av: ['night'], night: false }, '往復で両方残る');
  const mine = c(b0), theirs = c(b0); mine.day_notes = Object.assign({}, mine.day_notes, { 1: '手元の予定' }); theirs.notes = '相手のメモ';
  let r = T.mergeMonth(b0, mine, theirs); assert.strictEqual(r.conflicts.length, 0); assert.deepStrictEqual(both(r.merged), { un: ['day'], av: ['night'], night: false }, '無関係な項目の統合で片方が消えない'); assert.strictEqual(r.merged.notes, '相手のメモ'); assert.strictEqual(r.merged.day_notes[1], '手元の予定');
  const t2 = c(b0); t2.avoid = t2.avoid.filter(u => !(u.name === 'Dr E' && +u.day === 7)); r = T.mergeMonth(b0, mine, t2); assert.strictEqual(r.conflicts.length, 0); assert.deepStrictEqual(both(r.merged), { un: ['day'], av: [], night: false }, '相手が避だけ消した');
  const m3 = c(b0); m3.unavailable_other = m3.unavailable_other.filter(u => !(u.name === 'Dr E' && +u.day === 7)); r = T.mergeMonth(b0, m3, theirs); assert.deepStrictEqual(both(r.merged), { un: [], av: ['night'], night: false }, '手元が不可だけ消した');
  const m4 = c(b0); m4.unavailable_other = m4.unavailable_other.map(u => u.name === 'Dr E' && +u.day === 7 ? { name: 'Dr E', day: 7, part: 'allday', paid: true } : u); r = T.mergeMonth(b0, m4, t2); assert.strictEqual(r.conflicts.length, 1, '同じ日を両方が変えたら衝突'); assert.strictEqual(r.conflicts[0].mine, 'allday_paid+avoid_night', '手元は不可を有給に変えた（避はそのまま）'); assert.strictEqual(r.conflicts[0].theirs, 'day', '相手は避を消した');
  const b5 = c(b0); b5.avoid.push({ name: 'Dr E', day: 7, part: 'day' }); b5.unavailable_night['Dr E'].push(7); assert.strictEqual(JSON.parse(T.flattenMonth(b5)['cal:Dr E:7']), 'day+night+avoid_day+avoid_night', '不可と同じ時間帯の避も落とさない（その枠を固定すると不可は許容になるが、避の減点は残る）'); assert.deepStrictEqual(both(T.unflattenMonth(T.flattenMonth(b5), b5)), { un: ['day'], av: ['day', 'night'], night: true }, '往復で全部残る');
  { const mine5 = c(b5), theirs5 = c(b5); mine5.day_notes = Object.assign({}, mine5.day_notes, { 1: '手元の予定' }); theirs5.notes = '相手のメモ'; const r5 = T.mergeMonth(b5, mine5, theirs5); assert.strictEqual(r5.conflicts.length, 0); assert.deepStrictEqual(both(r5.merged), { un: ['day'], av: ['day', 'night'], night: true }, '無関係な項目の統合で、同じ時間帯の避が消えない'); }
  const b6 = c(b0); b6.unavailable_other.push({ name: 'Dr E', day: 7, part: 'allday' }); assert.strictEqual(JSON.parse(T.flattenMonth(b6)['cal:Dr E:7']), 'allday+day+avoid_night', '日夜両方の不可があっても、ほかの入力を落とさない');
  console.log('same-day unavailable + avoid kept: true'); }

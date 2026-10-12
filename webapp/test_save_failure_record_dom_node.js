// 保存できなかった記録（#saveFail）: フォルダへの保存が失敗した・止めた理由を、通知とは別に残す。
// 本体の index.html と全ての app-*.js を T.init まで動かし、入力欄の change・ヘッダーの保存ボタン・自動保存のタイマーから保存を通す。
// フォルダは架空の File System Access ハンドル。実ブラウザの配置・権限・通信は確かめない（配置は実ブラウザ側の試験で見る）。
// Run: TOBAN_DOM_MODULE=/installed/node_modules/jsdom node test_save_failure_record_dom_node.js
const fs = require('fs'), path = require('path'), assert = require('assert');
let JSDOM;
for (const name of [process.env.TOBAN_DOM_MODULE, 'jsdom', path.join(process.env.HOME || '', '.toban-test/node_modules/jsdom')].filter(Boolean)) {
  try { ({ JSDOM } = require(name)); break; } catch (e) { if (e.code !== 'MODULE_NOT_FOUND') throw e; }
}
if (!JSDOM) throw new Error('Save failure record DOM regression requires jsdom 26.1.0. Set TOBAN_DOM_MODULE to its installed path. This test was NOT run.');
const source = f => fs.readFileSync(path.join(__dirname, 'src', f), 'utf8');
const scripts = ['i18n.js','rules-core.js','model.js', ...fs.readdirSync(path.join(__dirname,'src/calendars')).filter(f=>f.endsWith('.js')).sort().map(f=>'calendars/'+f),
  'messages.js','solver.js','check.js','report.js','docxgen.js','plugins.js','merge.js', ...fs.readdirSync(path.join(__dirname,'src/rules')).filter(f=>f.endsWith('.js')).sort().map(f=>'rules/'+f),
  'app-core.js','app-folder.js','app-month.js','app-input.js','app-settings.js','app-solve.js','app-main.js'];
const clone = x => JSON.parse(JSON.stringify(x));
const rules = {profile:{id:'synthetic-save',roles:[{id:'S',label:'Staff',refs:[]}],shifts:[{id:'day',on:'all'},{id:'night',on:'all'}]},doctors:[{name:'Synthetic Alpha',team:'S',quota:20}],rule_states:{},weights:{}};
const month = {year:2026,month:11,next_first_day_in_calendar:true,notes:'Synthetic initial draft'};
const missing = () => Object.assign(new Error('Synthetic missing'), {name:'NotFoundError'});
// 架空のフォルダ。place が同じなら「同じフォルダを選び直した別の参照」（isSameEntry が true）。fail に文を入れると書込みの close がその文で失敗する
function memoryFolder(name, place, store) {
  const dirs = store ? store.dirs : new Map(), files = store ? store.files : new Map();
  const root = {name,kind:'directory',place,dirs,files,fail:null,beforeClose:null,sameEntryThrows:false,
    async *entries(){yield* dirs;},
    async getDirectoryHandle(n,o={}) { if(!dirs.has(n)){if(!o.create)throw missing();dirs.set(n,{name:n,kind:'directory',files:new Map(),getFileHandle(n,o={}){return file(this.files,n,o);}});}return dirs.get(n); },
    async getFileHandle(n,o={}){return file(files,n,o);},
    async isSameEntry(o){ if(root.sameEntryThrows) throw new Error('Synthetic isSameEntry failure'); return !!o && o.place === place; }
  };
  async function file(files,n,o){if(!o.create&&!files.has(n))throw missing();return {getFile:async()=>({text:async()=>files.get(n)}),createWritable:async()=>{let text;return {
    async write(blob){text=typeof blob==='string'?blob:await blob.text();},async close(){if(root.beforeClose)await root.beforeClose();if(root.fail)throw new Error(root.fail);files.set(n,text);}
  };}};}
  return root;
}
const tick = (ms = 0) => new Promise(r => setTimeout(r, ms));
async function makeApp(){
  const dom=new JSDOM(source('index.html'),{url:'https://example.invalid/synthetic/save-failure.html',runScripts:'outside-only'}),w=dom.window;
  await new Promise(r=>w.document.readyState==='complete'?r():w.addEventListener('load',r,{once:true}));
  const errors=[];w.addEventListener('error',e=>{errors.push(e.error||e.message);e.preventDefault();});
  w.Blob=globalThis.Blob;w.confirm=()=>true;w.alert=msg=>{throw new Error(msg);};w.prompt=()=>null;
  w.T={DEFAULT_RULES:clone(rules),SAMPLE_MONTH:clone(month),PROFILES:[],LANGS_DATA:['ja.json','en.json'].map(f=>JSON.parse(fs.readFileSync(path.join(__dirname,'lang',f),'utf8')))};
  for(const f of scripts)w.eval(source(f)+'\n//# sourceURL='+f);
  const A=w.T.app;A.restoreFolder=()=>{}; // OS のフォルダ選択と開始画面だけを外す（保存・描画・入力の処理は本体のまま）
  w.localStorage.setItem('toban.lang','ja');w.T.init();
  // 自動保存（3 秒）と通知の消去（4 秒）のタイマーは、待たずに試験から動かす。通知そのもの（A.toast）は本体のまま
  let scheduled=null,hideToast=null;const nativeTimer=w.setTimeout.bind(w);w.setTimeout=(fn,delay,...args)=>{if(delay===3000){scheduled=fn;return 12345;}if(delay===4000){hideToast=fn;return 12346;}return nativeTimer(fn,delay,...args);};
  const q=s=>w.document.querySelector(s);
  const connect=async root=>{A.dirHandle=root;A.dirGen++;await A.refreshMonths();A.renderHeader();};
  const root=memoryFolder('Synthetic folder','place-1');await connect(root);
  const change=value=>{const notes=q('#monthSettings [data-path="notes"]');assert(notes);notes.value=value;notes.dispatchEvent(new w.Event('change',{bubbles:true}));};
  const settle=async()=>{await A.awaitSaves();await tick();await tick();}; // 保存の後の解除（isSameEntry を待つ）まで済ませる
  const auto=async()=>{assert(scheduled,'bound edit schedules autosave');const fn=scheduled;scheduled=null;const r=await fn();await settle();return r;};
  const manual=async()=>{const b=q('#btnHeaderSave');assert(b,'header save button');b.click();await settle();};
  const answer=async re=>{for(let i=0;i<400;i++){const b=!q('#modal').hidden&&[...w.document.querySelectorAll('#modalBtns button')].find(b=>re.test(b.textContent));if(b){b.click();return;}await tick(5);}throw new Error('modal choice not offered: '+re+' / '+q('#modalMsg').textContent);};
  const rec=()=>{const el=q('#saveFail');return {shown:!el.hidden,text:el.textContent,items:[...el.querySelectorAll('#saveFailMsg p')].map(p=>p.textContent),button:!!q('#saveFailOk')};};
  return {dom,w,A,T:w.T,root,q,change,auto,manual,answer,rec,connect,settle,errors,hide:()=>{assert(hideToast,'toast armed its hide timer');const fn=hideToast;hideToast=null;fn();}};
}
let cases=0;
const total=17;
process.on('exit',()=>{if(cases!==total&&!process.exitCode){console.error('NOT COMPLETED: '+cases+'/'+total+' (a step is still waiting, for example an unanswered dialog)');process.exitCode=1;}});
async function scenario(name, fn){const app=await makeApp();try{await fn(app);assert.deepStrictEqual(app.errors,[],'no page error');cases++;console.log('PASS '+name);}finally{app.dom.window.close();}}
const NONE={shown:false,text:'',items:[],button:false};
// 保存先に「別の施設」の月データを置く（自動統合の対象にならず、必ず確認の画面が出る）
async function plantOtherFacility({root,change,auto}){change('Synthetic first save');assert.strictEqual(await auto(),'saved');const dir=root.dirs.get('202611'),o=JSON.parse(dir.files.get('202611_data.json'));o.rules.profile.id='synthetic-other-facility';o.month.profile_id='synthetic-other-facility';o.month.notes='Synthetic peer data';o.saved_at='2026-10-01T00:00:00.000Z';dir.files.set('202611_data.json',JSON.stringify(o));return dir;}
(async()=>{
  await scenario('自動保存の失敗は記録に残り、別の通知・通知の消去でも失われず、同じ保存先・同じ月の保存成功で消える', async({A,root,q,change,auto,rec,hide,w})=>{
    assert.deepStrictEqual(rec(),{shown:false,text:'',items:[],button:false});
    const notes=q('#monthSettings [data-path="notes"]');notes.focus();
    root.fail='Synthetic close denied';change('Synthetic draft 1');assert.strictEqual(await auto(),'failed');
    let r=rec();assert(r.shown&&r.button);assert.strictEqual(r.items.length,1);
    assert.match(r.items[0],/保存できていません/);assert.match(r.items[0],/202611/);assert.match(r.items[0],/Synthetic folder/);assert.match(r.items[0],/自動保存に失敗しました: Synthetic close denied/);
    assert.strictEqual(q('#toast').hidden,false);assert.match(q('#toast').textContent,/Synthetic close denied/,'the failure is also announced as a normal toast');
    assert.strictEqual(w.document.activeElement,notes,'recording a failure does not move focus');assert.strictEqual(notes.value,'Synthetic draft 1');
    A.toast('架空の別の通知');assert.strictEqual(q('#toast').textContent,'架空の別の通知');
    assert.deepStrictEqual(rec().items,r.items,'another toast does not replace the record');
    hide();assert.strictEqual(q('#toast').hidden,true);assert.deepStrictEqual(rec().items,r.items,'the record outlives the toast');assert.strictEqual(rec().shown,true);
    assert.strictEqual(q('#saveState').className,'dirty');assert.strictEqual(A.isDirty(),true);
    root.fail=null;change('Synthetic draft 2');assert.strictEqual(await auto(),'saved');
    assert.deepStrictEqual(rec(),{shown:false,text:'',items:[],button:false},'success on the same folder and month clears the record');
    assert.strictEqual(JSON.parse(root.dirs.get('202611').files.get('202611_data.json')).month.notes,'Synthetic draft 2');
  });
  await scenario('ヘッダーの保存の失敗も記録に残り、続けて失敗すると最新の理由 1 件になり、成功で消える', async({root,change,manual,rec})=>{
    root.fail='Synthetic denied A';change('Synthetic manual 1');await manual();
    let r=rec();assert.strictEqual(r.items.length,1);assert.match(r.items[0],/フォルダに保存できませんでした: Synthetic denied A/);
    root.fail='Synthetic denied B';await manual();
    r=rec();assert.strictEqual(r.items.length,1,'same folder and month keep one record');assert.match(r.items[0],/Synthetic denied B/);assert.doesNotMatch(r.items[0],/Synthetic denied A/);
    root.fail=null;await manual();assert.strictEqual(rec().shown,false);
  });
  await scenario('「確認しました」で消え、押してもフォーカスを奪わない。通知の文面だけでは記録を作らない', async({A,root,q,change,auto,rec,w})=>{
    A.toast('自動保存に失敗しました: 架空の文面だけの通知。入力はブラウザ内に残っています');assert.strictEqual(rec().shown,false,'a toast text alone never creates a record');
    root.fail='Synthetic close denied';change('Synthetic draft');assert.strictEqual(await auto(),'failed');assert.strictEqual(rec().shown,true);
    const ok=q('#saveFailOk');assert.strictEqual(ok.textContent,'確認しました');
    const down=new w.MouseEvent('mousedown',{bubbles:true,cancelable:true});ok.dispatchEvent(down);assert.strictEqual(down.defaultPrevented,true,'pressing the button keeps focus where it was');
    ok.click();assert.deepStrictEqual(rec(),{shown:false,text:'',items:[],button:false});
    assert.strictEqual(A.isDirty(),true,'acknowledging does not mark anything saved');assert.strictEqual(q('#saveState').className,'dirty');
  });
  await scenario('別の保存先（同じ名前の別フォルダ）の成功では消えず、選び直した同じフォルダの成功で消える', async({A,root,change,auto,rec,connect})=>{
    root.fail='Synthetic close denied';change('Synthetic draft');assert.strictEqual(await auto(),'failed');const kept=rec().items;assert.strictEqual(kept.length,1);
    const other=memoryFolder('Synthetic folder','place-2');await connect(other);
    change('Synthetic draft in other folder');assert.strictEqual(await auto(),'saved');assert(other.dirs.get('202611').files.has('202611_data.json'));
    assert.deepStrictEqual(rec().items,kept,'success in a different folder with the same name keeps the record');
    root.fail=null; // 以後は書込みを通す（同じ場所を指す参照は中身を共有し、月フォルダは最初の参照の設定で書く）
    const unsure=memoryFolder('Synthetic folder','place-1',root);unsure.sameEntryThrows=true;root.sameEntryThrows=true;await connect(unsure);
    change('Synthetic draft, identity unknown');assert.strictEqual(await auto(),'saved');assert.deepStrictEqual(rec().items,kept,'when the folder identity cannot be confirmed the record stays');
    root.sameEntryThrows=false;const again=memoryFolder('Synthetic folder','place-1',root);await connect(again);
    change('Synthetic draft after reconnect');assert.strictEqual(await auto(),'saved');assert.strictEqual(rec().shown,false,'the same folder picked again clears the record');
  });
  await scenario('別の月の成功では消えず、失敗した月に戻って保存が成功すると消える', async({A,root,q,change,auto,manual,rec,answer})=>{
    root.fail='Synthetic close denied';change('Synthetic November draft');assert.strictEqual(await auto(),'failed');assert.match(rec().items[0],/自動保存に失敗しました/);
    const sw=A.transition('month',()=>A.onMonthChange(2026,12));await answer(/保存せずに切り替える/);await answer(/空の月として作成/);await answer(/保存せずに切り替える/);await sw; // 置き換える直前にも未保存の確認が入る
    // 切替の前の保存（2 回）も同じ保存先・同じ月で失敗するので、記録は 1 件のまま最新の理由になる
    const kept=rec().items;assert.strictEqual(A.tag(),'202612');assert.strictEqual(kept.length,1,'switching the month keeps the record');assert.match(kept[0],/202611.*フォルダに保存できませんでした: Synthetic close denied/);
    root.fail=null;change('Synthetic December draft');await manual();
    assert(root.dirs.get('202612').files.has('202612_data.json'));assert.strictEqual(q('#saveState').className,'saved');
    assert.deepStrictEqual(rec().items,kept,'success for another month keeps the record');assert.match(rec().items[0],/202611/);
    root.fail='Synthetic December denied';change('Synthetic December draft 2');assert.strictEqual(await auto(),'failed');
    let r=rec();assert.strictEqual(r.items.length,2,'one record per folder and month');assert.strictEqual(q('#saveFailMsg .sum').textContent,'未解決 2 件（月データの保存 2 件）。下に続きます');assert.match(r.items[0],/202612.*Synthetic December denied/);assert.match(r.items[1],/202611.*Synthetic close denied/);
    root.fail=null;await manual();r=rec();assert.strictEqual(r.items.length,1);assert.match(r.items[0],/202611/,'December success clears only December');assert.strictEqual(q('#saveFailMsg .sum'),null);
    const back=A.transition('month',()=>A.onMonthChange(2026,11));await answer(/空の月として作成/);await back;assert.strictEqual(A.tag(),'202611');
    change('Synthetic November again');await manual();assert.strictEqual(rec().shown,false,'success for the failed month clears it');
  });
  await scenario('書込み中に保存先が替わったとき、記録は書いていた保存先のものになる（失敗は残り、成功は書いた先だけを消す）', async({A,root,change,auto,rec,connect,settle})=>{
    let entered,release;const started=new Promise(r=>{entered=r;}),gate=new Promise(r=>{release=r;});
    root.beforeClose=async()=>{entered();await gate;};root.fail='Synthetic denied while switching';change('Synthetic draft');
    const other=memoryFolder('Synthetic folder','place-2');
    const saving=auto();await started;A.dirHandle=other;A.dirGen++;release();assert.strictEqual(await saving,'failed');
    await A.refreshMonths();A.renderHeader();const kept=rec().items;assert.strictEqual(kept.length,1);assert.match(kept[0],/Synthetic denied while switching/);
    change('Synthetic draft in other folder');assert.strictEqual(await auto(),'saved');assert.deepStrictEqual(rec().items,kept,'the new folder succeeding does not clear the old folder failure');
    // 元の保存先へ戻り、書込み中にまた別の保存先へ替わっても、書込みが成功すれば元の保存先の記録は消える
    root.fail=null;await connect(root);let entered2,release2;const started2=new Promise(r=>{entered2=r;}),gate2=new Promise(r=>{release2=r;});root.beforeClose=async()=>{entered2();await gate2;};
    change('Synthetic draft back in first folder');const saving2=auto();await started2;A.dirHandle=other;A.dirGen++;release2();assert.strictEqual(await saving2,'saved');await settle();
    assert.strictEqual(rec().shown,false,'the completed write to the first folder clears its record');
  });
  await scenario('保存先のファイルを確かめられず保存を止めた理由も残り、「保存を見送りました」で失われない', async({root,q,change,manual,rec})=>{
    const dir=await root.getDirectoryHandle('202611',{create:true});dir.files.set('202611_data.json','{ synthetic broken json');
    change('Synthetic draft');await manual();
    assert.strictEqual(q('#toast').textContent,'保存を見送りました','the last toast is the generic one');
    const r=rec();assert.strictEqual(r.items.length,1);assert.match(r.items[0],/202611_data\.json が壊れていて読めません/);assert.match(r.items[0],/上書きしないよう保存を止めました/);
    assert.strictEqual(dir.files.get('202611_data.json'),'{ synthetic broken json','the unreadable file is not overwritten');
    dir.files.delete('202611_data.json');await manual();assert.strictEqual(rec().shown,false);
  });
  await scenario('表示言語を切り替えると記録の文面も切り替わる', async({A,T,root,change,auto,rec})=>{
    root.fail='Synthetic close denied';change('Synthetic draft');assert.strictEqual(await auto(),'failed');
    T.setLang('en');A.renderHeader();const r=rec();
    assert.match(r.items[0],/Not saved/);assert.match(r.items[0],/Autosave failed: Synthetic close denied/);assert.match(r.text,/Got it/);assert.doesNotMatch(r.text,/保存できていません|確認しました/);
  });
  // ---- 「確認しました」は記録の確認だけで、未保存のデータを保存済みにせず、再保存や未保存の保護を妨げない
  await scenario('確認しても未保存のまま: 保存表示・保存ボタン・ページを離れるときの警告が残る', async({A,root,q,change,auto,rec,w})=>{
    root.fail='Synthetic close denied';change('Synthetic draft');assert.strictEqual(await auto(),'failed');assert.strictEqual(rec().shown,true);
    q('#saveFailOk').click();assert.deepStrictEqual(rec(),NONE);
    assert.strictEqual(A.isDirty(),true);assert.strictEqual(q('#saveState').className,'dirty');assert(q('#btnHeaderSave'),'save button still offered');assert.match(q('#monthSel').selectedOptions[0].textContent,/未保存/);
    const ev=new w.Event('beforeunload',{cancelable:true});w.dispatchEvent(ev);assert.strictEqual(ev.defaultPrevented,true,'leaving the page still warns about unsaved changes');
    assert.strictEqual(root.dirs.get('202611')?.files.has('202611_data.json')||false,false,'nothing was written');assert.strictEqual(A.state.month.notes,'Synthetic draft');
  });
  await scenario('確認した後も再保存できる: まだ失敗するなら記録が戻り、直れば保存されて消える', async({A,root,q,change,auto,manual,rec})=>{
    root.fail='Synthetic close denied';change('Synthetic draft');assert.strictEqual(await auto(),'failed');q('#saveFailOk').click();assert.deepStrictEqual(rec(),NONE);
    await manual();let r=rec();assert.strictEqual(r.items.length,1,'the next failed save is recorded again');assert.match(r.items[0],/フォルダに保存できませんでした: Synthetic close denied/);
    q('#saveFailOk').click();change('Synthetic draft 2');assert.strictEqual(await auto(),'failed','autosave still runs after acknowledging');assert.strictEqual(rec().items.length,1);
    q('#saveFailOk').click();root.fail=null;await manual();assert.deepStrictEqual(rec(),NONE);assert.strictEqual(q('#saveState').className,'saved');assert.strictEqual(A.isDirty(),false);
    assert.strictEqual(JSON.parse(root.dirs.get('202611').files.get('202611_data.json')).month.notes,'Synthetic draft 2');
  });
  await scenario('確認した後も、月を切り替える前の未保存の保護が働く（中止を選ぶと月も入力もそのまま）', async({A,root,q,change,auto,rec,answer})=>{
    root.fail='Synthetic close denied';change('Synthetic draft');assert.strictEqual(await auto(),'failed');q('#saveFailOk').click();assert.deepStrictEqual(rec(),NONE);
    const sw=A.transition('month',()=>A.onMonthChange(2026,12));await answer(/切り替えを中止する/);await sw;
    assert.match(q('#modalMsg').textContent,/保存できませんでした.*未保存の入力が失われます/,'the unsaved-data dialog was shown');
    assert.strictEqual(A.tag(),'202611');assert.strictEqual(A.state.month.notes,'Synthetic draft');assert.strictEqual(A.isDirty(),true);assert.strictEqual(q('#saveState').className,'dirty');
    assert.strictEqual(rec().items.length,1,'the save attempted before switching failed and is recorded');
  });
  // ---- 利用者が意図的に取り消しただけの操作は、保存失敗として記録しない
  await scenario('取消: 手動保存の確認画面で「何もしない（後で判断）」: 記録しない', async(app)=>{const {A,q,change,manual,rec,answer}=app;const dir=await plantOtherFacility(app);
    change('Synthetic my edit');const p=manual();await answer(/何もしない（後で判断）/);await p;
    assert.strictEqual(q('#toast').textContent,'保存を見送りました');assert.deepStrictEqual(rec(),NONE);assert.strictEqual(A.isDirty(),true);assert.match(dir.files.get('202611_data.json'),/Synthetic peer data/,'peer file untouched');
  });
  await scenario('取消: 自動保存の確認画面で「何もしない（後で判断）」: 記録しない', async(app)=>{const {A,change,auto,rec,answer}=app;await plantOtherFacility(app);
    change('Synthetic my edit');const p=auto();await answer(/何もしない（後で判断）/);assert.strictEqual(await p,'skipped');assert.deepStrictEqual(rec(),NONE);assert.strictEqual(A.isDirty(),true);
  });
  await scenario('取消: 確認画面を Esc で閉じる: 記録しない', async(app)=>{const {A,q,w,change,manual,rec}=app;await plantOtherFacility(app);
    change('Synthetic my edit');const p=manual();for(let i=0;i<400&&q('#modal').hidden;i++)await tick(5);assert.strictEqual(q('#modal').hidden,false);w.document.dispatchEvent(new w.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));await p;
    assert.deepStrictEqual(rec(),NONE);assert.strictEqual(A.isDirty(),true);
  });
  await scenario('取消: 確認画面で「相手の保存データを読み込む」: 保存せず読み込むだけで、記録しない', async(app)=>{const {A,change,manual,rec,answer}=app;await plantOtherFacility(app);
    change('Synthetic my edit');const p=manual();await answer(/相手の保存データを読み込む/);await p;assert.deepStrictEqual(rec(),NONE);assert.strictEqual(A.state.month.notes,'Synthetic peer data');
  });
  await scenario('取消: 未接続で「接続して保存」を押し、フォルダの選択を取り消す: 記録しない', async({A,q,w,change,manual,rec})=>{
    A.dirHandle=null;A.storedHandle=null;A.dirGen++;let asked=0;w.showDirectoryPicker=async()=>{asked++;throw new w.DOMException('Synthetic user cancelled','AbortError');};A.renderHeader();
    change('Synthetic draft');assert.strictEqual(q('#btnHeaderSave').textContent,'接続して保存');await manual();
    assert.strictEqual(asked,1,'the folder picker was offered');assert.deepStrictEqual(rec(),NONE);assert.strictEqual(A.isDirty(),true);assert.strictEqual(q('#saveState').className,'dirty');
  });
  await scenario('取消: 月の作り方の選択で「やめる（今の月のまま）」: 記録しない', async({A,q,change,auto,rec,answer})=>{
    change('Synthetic draft');assert.strictEqual(await auto(),'saved');const sw=A.transition('month',()=>A.onMonthChange(2026,12));await answer(/やめる（今の月のまま）/);await sw;
    assert.strictEqual(A.tag(),'202611');assert.deepStrictEqual(rec(),NONE);assert.strictEqual(q('#saveState').className,'saved');
  });
  console.log(cases+'/'+total+' save failure record cases passed');
})().catch(e=>{console.error(e.stack);process.exitCode=1;});

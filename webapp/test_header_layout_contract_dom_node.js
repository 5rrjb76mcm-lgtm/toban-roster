// Production markup/renderers + CSS contract only. jsdom does NOT lay out boxes,
// load Windows fonts, or verify viewport geometry/hit testing. No browser/sockets.
// Run: TOBAN_DOM_MODULE=/installed/node_modules/jsdom node test_header_layout_contract_dom_node.js
const fs = require('fs'), path = require('path'), assert = require('assert');
let JSDOM;
for (const name of [process.env.TOBAN_DOM_MODULE, 'jsdom', path.join(process.env.HOME || '', '.toban-test/node_modules/jsdom')].filter(Boolean)) {
  try { ({ JSDOM } = require(name)); break; } catch (e) { if (e.code !== 'MODULE_NOT_FOUND') throw e; }
}
if (!JSDOM) throw new Error('Header layout contract requires jsdom 26.1.0. Set TOBAN_DOM_MODULE to its installed module path. This test was NOT run.');
const source = f => fs.readFileSync(path.join(__dirname, 'src', f), 'utf8');
const dom = new JSDOM(source('index.html').replace('/*__CSS__*/', source('style.css')), {url:'https://example.invalid/synthetic/layout.html',runScripts:'outside-only'});
const w = dom.window, q = s => w.document.querySelector(s);
for (const f of ['i18n.js','rules-core.js','model.js','app-core.js','app-folder.js','app-settings.js']) w.eval(source(f));
const T = w.T, A = T.app;
T.registerLang({code:'ja'}); T.registerLang(JSON.parse(fs.readFileSync(path.join(__dirname,'lang/en.json'),'utf8')));
A.state.rules = {profile:{id:'synthetic',label:'Synthetic facility'},doctors:[]};
A.state.month = {year:2026,month:11}; A.monthDirs = ['202611'];
// Inspect relevant declarations by exact selector. This is NOT a CSS layout or
// general cascade simulator; it only checks the explicit responsive policy.
function matchesMedia(text, width, height) {
  return text.split(',').some(part => {
    if (/\bprint\b/.test(part)) return false;
    const limits = [...part.matchAll(/\(max-(width|height):\s*(\d+)px\)/g)];
    assert(limits.length, 'Unexpected media query in contract: '+part);
    return limits.every(([,axis,n]) => (axis === 'width' ? width : height) <= +n);
  });
}
function declared(selector, width, height) {
  const out = {};
  function visit(rules) {
    for (const r of rules) {
      if (r.media) { if (matchesMedia(r.conditionText, width, height)) visit(r.cssRules); }
      else if (r.selectorText && r.selectorText.split(',').map(s=>s.trim()).includes(selector)) {
        for (let i=0; i<r.style.length; i++) { const prop=r.style[i]; out[prop]=r.style.getPropertyValue(prop); }
      }
    }
  }
  visit(w.document.styleSheets[0].cssRules); return out;
}
let cases = 0, completed = false;
const EXPECTED_CASES = 24; // 12 viewports x 2 languages
process.on('exit', () => { if ((!completed || cases !== EXPECTED_CASES) && !process.exitCode) { console.error(`NOT COMPLETED: reached ${cases}/${EXPECTED_CASES} viewport policies, completed=${completed}`); process.exitCode = 1; } });
try {
  for (const lang of ['ja','en']) {
    T.setLang(lang); T.applyI18n(w.document.body); A.renderHeader(); A.clearUndo();
    assert.equal(q('#monthSel').value,'202611');
    assert(q('#monthSel').selectedOptions[0].textContent.includes('2026'));
    assert(q('#monthSel').getAttribute('aria-label'));
    assert(q('#monthTitle .editing-month>span').textContent);
    assert(q('#undoNote').textContent); assert(q('#saveState').textContent);
    const undoLabel='Synthetic long change label '.repeat(12);
    A.pushUndo(undoLabel); A.state.month.notes=lang;
    assert.equal(q('#btnUndo').disabled,false); assert(q('#undoNote').textContent.includes(undoLabel));
    q('#monthSel').focus(); A.toast(T.t('保存を見送りました')+' Synthetic feedback '.repeat(20));
    const toast=q('#toast');
    assert.equal(toast.hidden,false); assert.equal(toast.getAttribute('role'),'status');
    assert.equal(toast.getAttribute('aria-live'),'polite'); assert.equal(toast.getAttribute('aria-atomic'),'true');
    assert.equal(w.document.activeElement,q('#monthSel'),'toast must not steal focus');
    // The status lives in its own row directly after the header (outside it, so the row is not
    // pinned with the header on large viewports) and before the content.
    const row=q('#toastRow');
    // It shares the row with the kept save-failure record, which shows only while no toast is visible.
    // The acknowledge button is a third, permanent element: a notification neither hides nor recreates it.
    const kept=q('#saveFail'), ack=q('#saveFailOk');
    assert.equal(toast.parentElement,row); assert.equal(kept.parentElement,row); assert.equal(ack.parentElement,row); assert.equal(row.children.length,3); assert.equal(row.hidden,false);
    assert.equal(toast.nextElementSibling,kept); assert.equal(kept.nextElementSibling,ack); assert.equal(ack.tagName,'BUTTON'); assert.equal(ack.getAttribute('type'),'button');
    assert.equal(kept.hidden,true,'no record unless a save failed'); assert.equal(kept.children.length,0); assert.equal(ack.hidden,true,'no acknowledge button without a record');
    // While a toast is visible the record text stays in place but unseen (not removed, so focus and scroll position inside it survive) and lets the pointer through to the toast.
    const under=declared('#toast:not([hidden])+#saveFail',1280,960);
    assert.equal(under.opacity,'0','a visible toast is read in the place of the record text'); assert.equal(under['pointer-events'],'none'); assert(!under.display && !under.visibility,'the record is not removed while a toast is shown');
    assert.equal(w.document.querySelectorAll('#saveFail button, #toast button').length,0,'the button is not inside an element that a toast covers');
    assert.equal(row.previousElementSibling,q('header')); assert.equal(row.nextElementSibling,q('main'));
    assert.equal(toast.closest('header'),null);
    assert(q('nav').compareDocumentPosition(toast) & w.Node.DOCUMENT_POSITION_FOLLOWING);
    assert.equal(toast.querySelector('button,a,input,select,[tabindex]'),null); assert.equal(toast.getAttribute('tabindex'),null);
    for (const tab of w.document.querySelectorAll('nav .tab')) { assert(!tab.disabled); assert(!tab.hidden); }
    for (const [width,height] of [[320,568],[375,667],[480,800],[481,800],[768,1024],[800,1024],[801,1024],[1280,960],[1280,568],[1280,640],[1280,641],[1024,768]]) {
      const header=declared('header',width,height), status=declared('#toast',width,height), statusRow=declared('#toastRow',width,height);
      const small=width<=800 || height<=640;
      assert.equal(header.position,small ? 'static' : 'sticky');
      // Reserved row on every viewport: the same height with or without a message, whatever its
      // length; never an overlay on top of the content, and not pinned like the header.
      assert.equal(statusRow.height,width<=480 ? 'calc(4.5em + 10px)' : 'calc(3em + 10px)','reserved status row height');
      assert.equal(statusRow['box-sizing'],'content-box');
      assert(!statusRow.position && !statusRow.top,'the row scrolls with the content');
      // One cell for the toast and the record text (same place, same size), a second column for the acknowledge button.
      assert.equal(statusRow.display,'grid'); const ackBtn=declared('#saveFailOk',width,height);
      const cell=x=>String(x['grid-area']||'').replace(/\s+/g,'');
      assert.equal(cell(status),'1/1'); assert.equal(cell(declared('#saveFail',width,height)),'1/1'); assert.equal(cell(ackBtn),'1/2'); assert(!ackBtn.position && !ackBtn.display);
      for (const box of [status, declared('#saveFail',width,height)]) {
        assert(!box.position && !box.transform && !box.bottom && !box['z-index'],'no overlay');
        assert(!box['pointer-events'] && !box['max-width']); assert.equal(box.height,'100%'); assert.equal(box['overflow-wrap'],'anywhere');
      }
      assert.equal(status['overflow-y'],'auto','long text is read by scrolling inside the row, not cut off');
      assert(!status['overscroll-behavior'],'the wheel over a short status still scrolls the page');
      // The kept record fills the same row: its text scrolls inside, the button stays beside it.
      const record=declared('#saveFail',width,height), recordText=declared('#saveFailMsg',width,height);
      assert(!record.display,'the record box is an ordinary block in the shared cell'); assert.equal(recordText.height,'100%'); assert(!recordText['max-height']);
      assert.equal(recordText['overflow-y'],'auto'); assert(!recordText['overscroll-behavior']);
      const select=declared('#monthTitle select',width,height);
      assert.equal(select['font-size'],width<=1080 ? '16px' : width<=1200 ? '17px' : '18px');
      const editing=declared('#monthTitle .editing-month',width,height);
      assert.equal(editing.width,'9.5em'); assert.equal(editing.background,'#fff1b8');
      if (width<=800) {
        const undo=declared('#undoBox .note',width,height);
        assert.equal(undo['white-space'],'normal'); assert.equal(undo['min-width'],'0');
        assert.equal(undo.overflow,'visible'); assert.equal(undo['overflow-wrap'],'anywhere');
        assert.equal(declared('#undoBox',width,height)['flex-wrap'],'wrap');
        assert.equal(declared('#monthTitle',width,height)['flex-wrap'],'wrap');
        assert.equal(declared('header nav',width,height)['flex-wrap'],'wrap');
        assert.equal(declared('header .hrow>*',width,height)['min-width'],'0');
        assert.equal(declared('header button',width,height)['max-width'],'100%');
      }
      cases++;
    }
    toast.hidden=true;
    assert.equal(w.getComputedStyle(toast).display,'none','hidden status is not rendered or announced');
    assert.notEqual(w.getComputedStyle(row).display,'none','the row that reserves the space stays');
  }
  // Real person selection and an in-progress (not yet committed) calendar edit.
  // Fire the production toast hide callback deterministically, without waiting 4s.
  for (const f of fs.readdirSync(path.join(__dirname,'src/rules')).filter(f=>f.endsWith('.js')).sort()) w.eval(source('rules/'+f));
  w.eval(source('app-input.js'));
  A.state.rules={profile:{id:'synthetic',roles:[{id:'S',label:'Staff',refs:[]}],shifts:[{id:'day',on:'all'},{id:'night',on:'all'}]},doctors:[{name:'Synthetic Alpha',team:'S',quota:20},{name:'Synthetic Beta',team:'S',quota:20}],rule_states:{},weights:{}};
  A.state.month={year:2026,month:11}; A.ensureMonth(A.state.month);
  q('#input').hidden=false; q('#doctorPane').hidden=false; A.bindDoctor(); A.renderDoctor();
  assert.equal(q('#docSel').value,'','opening calendar still requires explicit person choice');
  q('#docSel').value='Synthetic Beta'; q('#docSel').dispatchEvent(new w.Event('change',{bubbles:true}));
  assert.equal(q('#doctorPane').dataset.doctor,'Synthetic Beta');
  const field=q('#doctorPane [data-cal="unavail"][data-d="10"]');
  assert(field); field.value='night'; field.focus();
  const snapshot=JSON.stringify(A.state.month), setTimer=w.setTimeout, clearTimer=w.clearTimeout;
  // Deterministic timers: every setTimeout is recorded with its delay; clearTimeout marks it cancelled.
  // pending() lists timers that are neither cancelled nor fired; fire() runs one as its deadline passing.
  const timers=[]; let timerId=0;
  w.setTimeout=(fn,delay)=>{ const t={id:++timerId,fn,delay,cancelled:false,fired:false}; timers.push(t); return t.id; };
  w.clearTimeout=id=>{ const t=timers.find(x=>x.id===id); if (t) t.cancelled=true; };
  const pending=()=>timers.filter(t=>!t.cancelled && !t.fired), fire=t=>{ assert(!t.cancelled && !t.fired,'timer is still armed'); t.fired=true; t.fn(); };
  const hideToast=()=>{ const p=pending(); assert.equal(p.length,1,'exactly one armed notification timer'); fire(p[0]); };
  try {
    for (const lang of ['ja','en']) {
      T.setLang(lang); A.toast(T.t('保存を見送りました'));
      assert.equal(q('#toast').hidden,false);
      assert.equal(w.document.activeElement,field); assert.equal(field.value,'night');
      assert.equal(q('#docSel').value,'Synthetic Beta'); assert.equal(q('#doctorPane').dataset.doctor,'Synthetic Beta');
      assert.equal(JSON.stringify(A.state.month),snapshot,'showing toast must not commit or replace input');
      hideToast(); assert.equal(q('#toast').hidden,true);
      assert.equal(w.document.activeElement,field); assert.equal(field.value,'night');
      assert.equal(q('#docSel').value,'Synthetic Beta'); assert.equal(q('#doctorPane').dataset.doctor,'Synthetic Beta');
      assert.equal(JSON.stringify(A.state.month),snapshot,'hiding toast must not mutate calendar');
    }
    // While the status is being read (pointer over it, or keyboard focus in it) the hide
    // callback re-arms instead of hiding; a new message starts from the top of the row.
    const el=q('#toast'), matches=el.matches; let reading=true, asked='';
    el.matches=sel=>{ asked=sel; return reading; };
    try {
      assert.equal(pending().length,0,'no notification timer left over');
      A.toast('Synthetic long status'); let p=pending();
      assert.equal(p.length,1); assert.equal(p[0].delay,4000,'a notification is shown for four seconds');
      // The four seconds pass while it is being read: it stays, and a fresh, shorter timer is armed.
      const first=p[0]; fire(first);
      assert.equal(el.hidden,false,'not hidden while being read'); assert(asked.includes(':hover') && asked.includes(':focus'));
      p=pending(); assert.equal(p.length,1,'the hide timer was armed again'); assert.notEqual(p[0],first); assert.equal(p[0].delay,1000,'it looks again after one second');
      // Still being read at the next deadline: kept again, armed again.
      const second=p[0]; fire(second); assert.equal(el.hidden,false,'kept across a second deadline');
      p=pending(); assert.equal(p.length,1); assert.notEqual(p[0],second); assert.equal(p[0].delay,1000);
      // Reading ends: the next deadline hides it and nothing stays armed.
      reading=false; fire(p[0]); assert.equal(el.hidden,true,'hidden once no longer being read'); assert.equal(pending().length,0,'no timer after hiding');
      // After that the normal four-second timer works again, and a newer message replaces the timer of the older one.
      el.scrollTop=30; A.toast('Synthetic next status'); assert.equal(el.scrollTop,0,'next status starts from the top'); assert.equal(el.hidden,false);
      p=pending(); assert.equal(p.length,1); assert.equal(p[0].delay,4000); const older=p[0];
      A.toast('Synthetic newer status'); assert.equal(older.cancelled,true,'the older timer is cancelled, so it cannot hide the newer message early');
      p=pending(); assert.equal(p.length,1); assert.equal(p[0].delay,4000); assert.equal(el.textContent,'Synthetic newer status');
      fire(p[0]); assert.equal(el.hidden,true); assert.equal(pending().length,0);
    } finally { el.matches=matches; }
  } finally { w.setTimeout=setTimer; w.clearTimeout=clearTimer; }
  console.log(`PASS header/status DOM and responsive CSS contracts (${cases} JP/EN viewport policies; reserved fixed-height status row on every viewport, no overlay; visible/hidden notification preserves calendar focus/input/person; no browser geometry measured)`);
  completed = true;
} finally { dom.window.close(); }

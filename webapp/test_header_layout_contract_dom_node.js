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
let cases = 0;
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
    assert.equal(toast.parentElement,q('header')); assert.equal(q('header').lastElementChild,toast);
    assert(q('nav').compareDocumentPosition(toast) & w.Node.DOCUMENT_POSITION_FOLLOWING);
    assert.equal(toast.querySelector('button,a,input,select,[tabindex]'),null);
    for (const tab of w.document.querySelectorAll('nav .tab')) { assert(!tab.disabled); assert(!tab.hidden); }
    for (const [width,height] of [[320,568],[375,667],[768,1024],[1280,960],[1280,568],[1024,768]]) {
      const header=declared('header',width,height), status=declared('#toast',width,height);
      assert.equal(header.position,width<=800 || height<=640 ? 'static' : 'sticky');
      assert.equal(status.position,'static'); assert.equal(status['pointer-events'],'none');
      assert.equal(status['max-width'],'100%'); assert.equal(status['overflow-wrap'],'anywhere');
      assert(!status.transform && !status.bottom && !status.top,'status must remain in normal flow');
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
    assert.equal(w.getComputedStyle(toast).display,'none','hidden status consumes no row');
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
  const snapshot=JSON.stringify(A.state.month), setTimer=w.setTimeout;
  let hideToast; w.setTimeout=fn=>{hideToast=fn;return 0;};
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
  } finally { w.setTimeout=setTimer; }
  console.log(`PASS header/status DOM and responsive CSS contracts (${cases} JP/EN viewport policies; visible/hidden notification preserves calendar focus/input/person; no browser geometry measured)`);
} finally { dom.window.close(); }

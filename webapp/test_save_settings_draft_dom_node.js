// Settings DOM drafts survive automatic saving and peer adoption.
// Uses production DOM handlers and an in-memory filesystem; fictional sample data only.
// Full production index.html + T.init + bound inputs/buttons/modal, fictional data only.
// jsdom and in-memory File System Access handles: no browser/permissions/layout claim.
// Run with TOBAN_DOM_MODULE=/installed/node_modules/jsdom (26.1.0).
const fs = require('fs'), path = require('path'), assert = require('assert/strict');
const ROOT = path.resolve(process.env.TOBAN_WEBAPP_ROOT || __dirname);
console.log('SOURCE_ROOT ' + JSON.stringify(ROOT));
let JSDOM;
for (const name of [process.env.TOBAN_DOM_MODULE, 'jsdom', path.join(process.env.HOME || '', '.toban-test/node_modules/jsdom')].filter(Boolean)) {
  try { ({ JSDOM } = require(name)); break; } catch (e) { if (e.code !== 'MODULE_NOT_FOUND') throw e; }
}
if (!JSDOM) throw new Error('Rules JSON draft regression requires jsdom 26.1.0. Set TOBAN_DOM_MODULE; missing dependency is a failure, never a skip.');
const source = f => fs.readFileSync(path.join(ROOT, 'src', f), 'utf8');
const scripts = ['i18n.js', 'rules-core.js', 'model.js', ...fs.readdirSync(path.join(ROOT, 'src/calendars')).filter(f => f.endsWith('.js')).sort().map(f => 'calendars/' + f),
  'messages.js', 'solver.js', 'check.js', 'report.js', 'docxgen.js', 'plugins.js', 'merge.js', ...fs.readdirSync(path.join(ROOT, 'src/rules')).filter(f => f.endsWith('.js')).sort().map(f => 'rules/' + f),
  'app-core.js', 'app-folder.js', 'app-month.js', 'app-input.js', 'app-settings.js', 'app-solve.js', 'app-main.js'];
const clone = x => JSON.parse(JSON.stringify(x));
const gate = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const rules = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/rules.json'), 'utf8'));
const initial = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/202611.json'), 'utf8'));
initial.notes = 'Synthetic base note'; initial.day_notes = { 8: 'Synthetic retained meeting' };
initial.local_synthetic = { sentinel: 'Synthetic retained extension' };
initial.fixed ||= {}; initial.fixed.night ||= {}; initial.fixed.night[7] = ['Dr E', 'Dr F'];
const missing = () => Object.assign(new Error('Synthetic missing'), { name: 'NotFoundError' });
function memoryFolder() {
  const dirs = new Map(), writes = [], root = { name: 'Synthetic folder', kind: 'directory', dirs, writes, readHook: null,
    async *entries() { yield* dirs; },
    async getDirectoryHandle(name, options = {}) {
      if (!dirs.has(name)) {
        if (!options.create) throw missing();
        const dir = { name, kind: 'directory', files: new Map(), async getFileHandle(n, o = {}) { return file(dir, n, o); } }; dirs.set(name, dir);
      }
      return dirs.get(name);
    },
    async getFileHandle() { throw missing(); }
  };
  async function file(dir, name, options) {
    if (!dir.files.has(name)) { if (!options.create) throw missing(); dir.files.set(name, ''); } // create establishes an empty entry immediately.
    return { async getFile() { return { async text() { const text = dir.files.get(name); if (root.readHook) await root.readHook(name); return text; } }; },
      async createWritable() { let staged; return { async write(blob) { staged = typeof blob === 'string' ? blob : await blob.text(); }, async close() { if (staged !== undefined) dir.files.set(name, staged); writes.push(dir.name + '/' + name); } }; } };
  }
  return root;
}
const tick = () => new Promise(r => setImmediate(r));
async function until(fn, label) { const deadline = Date.now() + 7000; while (!fn()) { if (Date.now() > deadline) throw new Error('Timed out: ' + label); await tick(); } }
async function makeApp() {
  const dom = new JSDOM(source('index.html').replace('/*__CSS__*/', source('style.css')), { url: 'https://example.invalid/synthetic/rules-json-draft.html', runScripts: 'outside-only' }), w = dom.window;
  await new Promise(r => w.document.readyState === 'complete' ? r() : w.addEventListener('load', r, { once: true }));
  const errors = [], alerts = [];
  w.addEventListener('error', e => { errors.push(String(e.error || e.message)); e.preventDefault(); });
  w.Blob = globalThis.Blob; w.confirm = () => true; w.alert = msg => alerts.push(String(msg)); w.prompt = () => null;
  w.T = { DEFAULT_RULES: clone(rules), SAMPLE_MONTH: clone(initial), PROFILES: [], LANGS_DATA: [JSON.parse(fs.readFileSync(path.join(ROOT, 'lang/ja.json'), 'utf8'))] };
  for (const f of scripts) w.eval(source(f) + '\n//# sourceURL=' + f);
  const A = w.T.app; A.restoreFolder = () => {}; // OS attachment only; production input, merge, save and render functions remain intact.
  w.localStorage.setItem('toban.lang', 'ja'); w.T.init();
  let scheduled = null; const nativeTimer = w.setTimeout.bind(w);
  w.setTimeout = (fn, delay, ...args) => { if (delay === 3000) { scheduled = fn; return 12345; } if (delay === 4000) return 12346; return nativeTimer(fn, delay, ...args); };
  const root = memoryFolder(); A.dirHandle = root; A.dirGen++; await A.refreshMonths();
  const q = s => w.document.querySelector(s), key = 'toban_state_v2:/synthetic/rules-json-draft.html';
  const event = (el, type) => el.dispatchEvent(new w.Event(type, { bubbles: true }));
  const change = (selector, value) => { const el = q(selector); assert(el, selector); el.value = value; event(el, 'change'); return el; };
  const input = (selector, value) => { const el = q(selector); assert(el, selector); el.focus(); el.value = value; event(el, 'input'); return el; };
  const auto = () => { assert(scheduled, 'bound change scheduled autosave'); const fn = scheduled; scheduled = null; return fn(); };
  const dir = await root.getDirectoryHandle('202611', { create: true });
  // Establish the production common base via JSON autosave, not mocked state/meta.
  change('[data-path="notes"]', 'Synthetic base note'); assert.equal(await auto(), 'saved');
  const base = JSON.parse(dir.files.get('202611_data.json'));
  const peer = (conflict = false) => {
    const peer = clone(base); peer.saved_at = '2026-10-02T00:00:00.000Z'; peer.month.day_notes[7] = 'Synthetic peer day note';
    if (conflict) peer.month.notes = 'Synthetic competing peer note';
    dir.files.set('202611_data.json', JSON.stringify(peer)); root.writes.length = 0;
    return dir.files.get('202611_data.json');
  };
  const setup = (conflict = false) => { const bytes = peer(conflict); change('[data-path="notes"]', 'Synthetic committed local note'); return bytes; };
  const pause = () => { const entered = gate(), release = gate(); root.readHook = async name => { if (name === '202611_data.json') { root.readHook = null; entered.resolve(); await release.promise; } }; return { entered: entered.promise, release: release.resolve }; };
  const checkpoint = () => ({ state: JSON.stringify(A.state), refs: { ...A.state }, stored: w.localStorage.getItem(key), undo: q('#undoNote').textContent, undoDisabled: q('#btnUndo').disabled, generation: A.saveGen, disk: dir.files.get('202611_data.json') });
  const retained = (before, el, value, focused = true) => {
    assert.equal(JSON.stringify(A.state), before.state, 'no state/base/meta change');
    for (const k of Object.keys(before.refs)) assert.equal(A.state[k], before.refs[k], 'preserve ' + k + ' reference');
    assert.equal(w.localStorage.getItem(key), before.stored, 'browser storage contents unchanged'); assert.equal(q('#undoNote').textContent, before.undo); assert.equal(q('#btnUndo').disabled, before.undoDisabled);
    assert.equal(A.saveGen, before.generation); assert.equal(dir.files.get('202611_data.json'), before.disk); assert.deepEqual(root.writes, []);
    assert(el.isConnected, 'same input node remains connected'); assert.equal(el.value, value); if (focused) assert.equal(w.document.activeElement, el, 'draft remains focused');
    assert.equal(el.dataset.pluginDraft, '1', 'unapplied marker is retained');
  };
  const saved = () => JSON.parse(dir.files.get('202611_data.json'));
  const common = (meeting = 'Synthetic retained meeting') => { assert.equal(saved().month.day_notes[7], 'Synthetic peer day note'); assert.equal(saved().month.day_notes[8], meeting); assert.equal(saved().month.local_synthetic.sentinel, 'Synthetic retained extension'); assert.equal(A.isDirty(), false); };
  const modal = () => !q('#modal').hidden;
  const answer = cancel => { const buttons = [...w.document.querySelectorAll('#modalBtns button')]; const b = buttons.find(x => cancel ? /やめる|何もしない/.test(x.textContent) : /衝突は自分/.test(x.textContent)); assert(b, 'real merge decision button'); b.click(); };
  const removePeer = () => { dir.files.delete('202611_data.json'); root.writes.length = 0; };
  return { dom, w, A, root, q, event, change, input, auto, peer, setup, pause, checkpoint, retained, saved, common, modal, answer, removePeer, errors, alerts };
}

const cases = [], add = (name, fn) => cases.push({ name, fn });
const enter = a => { a.q('.tab[data-tab="settings"]').click(); };
const fields = [
  ['name', '#doctorTable [data-f="name"]', 'Synthetic Pending Name'],
  ['years', '#doctorTable [data-f="years"]', '12'],
  ['profile label', '#setProfLabel', 'Synthetic Pending Profile'],
  ['weight', '#weightsTable [data-w]', '37'],
];
function retained(a, before, el, value) {
  assert.equal(JSON.stringify(a.A.state), before.state, 'state unchanged');
  for (const k of Object.keys(before.refs)) assert.equal(a.A.state[k], before.refs[k], 'same state reference '+k);
  assert.equal(a.w.localStorage.getItem('toban_state_v2:/synthetic/rules-json-draft.html'), before.stored);
  assert.equal(a.A.saveGen, before.generation); assert.equal(a.q('#undoNote').textContent, before.undo);
  assert.equal(a.checkpoint().disk, before.disk); assert.deepEqual(a.root.writes, []);
  assert(el.isConnected); assert.equal(el.value, value); assert.equal(a.w.document.activeElement, el);
}
for (const [label, selector, value] of fields) for (const timing of ['before', 'during read']) {
  add(label+' draft '+timing+' autosave', async a => {
    a.setup(); enter(a); let saving, pause;
    if (timing === 'during read') { pause=a.pause(); saving=a.auto(); await pause.entered; }
    const el=a.input(selector,value), before=a.checkpoint();
    if (pause) pause.release(); else saving=a.auto();
    assert.equal(await saving,'skipped'); retained(a,before,el,value); assert.equal(a.modal(),false);
    a.event(el,'change'); assert.equal(a.A.hasPendingSettingsDrafts?.() || false,false,'successful commit clears draft');
    assert.equal(await a.auto(),'saved'); a.common();
    if(label==='name') assert.equal(a.saved().rules.doctors[0].name,value);
    if(label==='years') assert.equal(a.saved().rules.doctors[0].years,+value);
    if(label==='weight') assert.equal(a.saved().rules.weights[el.dataset.w],+value);
  });
}
for(const timing of ['before','during read']) add('clean reconciliation '+timing,async a=>{
  a.peer(); enter(a); let pending,pause;
  if(timing==='during read'){pause=a.pause();pending=a.A.reconcileWithFolder();await pause.entered;}
  const el=a.input(fields[0][1],fields[0][2]),before=a.checkpoint();
  if(pause)pause.release();else pending=a.A.reconcileWithFolder();
  await pending; retained(a,before,el,fields[0][2]);
  el.value=a.A.state.rules.doctors[0].name;a.event(el,'input');
  await a.A.reconcileWithFolder();assert.equal(a.A.state.month.day_notes[7],'Synthetic peer day note');
});
add('no draft merges normally',async a=>{a.setup();enter(a);assert.equal(await a.auto(),'saved');a.common();});
add('typed back projection is not sticky',async a=>{a.setup();enter(a);const el=a.q(fields[1][1]),shown=el.value;a.input(fields[1][1],'99');a.input(fields[1][1],shown);assert.equal(await a.auto(),'saved');a.common();});
add('unapplied profile picker is not a model draft',async a=>{a.setup();enter(a);a.q('#setExportRoster').checked=true;assert.equal(await a.auto(),'saved');a.common();});
add('normalized committed number does not block later autosave',async a=>{a.setup();enter(a);const el=a.input('#doctorTable [data-f="years"]','-0');a.event(el,'focusout');assert.equal(a.A.hasPendingSettingsDrafts?.() || false,false);assert.equal(await a.auto(),'saved');a.common();});
for (const cancel of [false,true]) add('draft while merge choice pending '+cancel,async a=>{
  a.setup(true);enter(a);const pending=a.auto();await until(a.modal,'merge modal');
  const el=a.input(fields[0][1],fields[0][2]),before=a.checkpoint();a.answer(cancel);
  assert.equal(await pending,'skipped');retained(a,before,el,fields[0][2]);
});
let passed=0;
(async()=>{for(const c of cases){let a;try{a=await makeApp();await c.fn(a);assert.deepEqual(a.errors,[]);assert.deepEqual(a.alerts,[]);passed++;console.log('PASS '+c.name);}catch(e){console.error('FAIL '+c.name+'\n'+e.stack);}finally{a?.dom.window.close();}}console.log(`ACCOUNTING ${passed}/${cases.length}`);process.exitCode=passed===cases.length?0:1;})().catch(e=>{console.error(e);process.exitCode=1;});

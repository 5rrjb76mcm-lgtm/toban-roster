// A pending profile import must not discard newer, uncommitted input.
// Full production index.html + T.init + bound inputs/buttons/modal, fictional data only.
// jsdom and in-memory File System Access handles: no browser/permissions/layout claim.
// Run with TOBAN_DOM_MODULE=/installed/node_modules/jsdom (26.1.0).
const fs = require('fs'), path = require('path'), assert = require('assert/strict');
let JSDOM;
for (const name of [process.env.TOBAN_DOM_MODULE, 'jsdom', path.join(process.env.HOME || '', '.toban-test/node_modules/jsdom')].filter(Boolean)) {
  try { ({ JSDOM } = require(name)); break; } catch (e) { if (e.code !== 'MODULE_NOT_FOUND') throw e; }
}
if (!JSDOM) throw new Error('Profile pending-input DOM regression requires jsdom 26.1.0. Set TOBAN_DOM_MODULE. This test was NOT run.');
const source = f => fs.readFileSync(f === 'app-settings.js' && process.env.TOBAN_SETTINGS_SOURCE || path.join(__dirname, 'src', f), 'utf8');
const scripts = ['i18n.js', 'rules-core.js', 'model.js', ...fs.readdirSync(path.join(__dirname, 'src/calendars')).filter(f => f.endsWith('.js')).sort().map(f => 'calendars/' + f),
  'messages.js', 'solver.js', 'check.js', 'report.js', 'docxgen.js', 'plugins.js', 'merge.js', ...fs.readdirSync(path.join(__dirname, 'src/rules')).filter(f => f.endsWith('.js')).sort().map(f => 'rules/' + f),
  'app-core.js', 'app-folder.js', 'app-month.js', 'app-input.js', 'app-settings.js', 'app-solve.js', 'app-main.js'];
const clone = x => JSON.parse(JSON.stringify(x));
const gate = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const alpha = 'Synthetic Alpha', beta = 'Synthetic Beta', gamma = 'Synthetic Gamma';
const rules = { profile: { id: 'synthetic-profile-pending-input', roles: [{ id: 'S', label: 'Staff', refs: [] }], shifts: [{ id: 'day', on: 'all' }, { id: 'night', on: 'all' }], positions: { work: { count: 2 } } },
  doctors: [alpha, beta, gamma].map(name => ({ name, team: 'S', quota: 20 })), rule_states: { oncall: 'off', period_charge: 'off' }, weights: {} };
const initial = { year: 2026, month: 11, next_first_day_in_calendar: true, notes: 'Synthetic original draft', fixed: { night: { 7: [alpha, beta] } },
  day_notes: { 8: 'Keep fictional meeting' }, fixed_tags: { ['7:night|' + alpha]: 'Keep tag' }, local_fictional: { sentinel: 'Keep extension' } };
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
  const dom = new JSDOM(source('index.html').replace('/*__CSS__*/', source('style.css')), { url: 'https://example.invalid/synthetic/profile-pending-input.html', runScripts: 'outside-only' }), w = dom.window;
  await new Promise(r => w.document.readyState === 'complete' ? r() : w.addEventListener('load', r, { once: true }));
  const errors = [], alerts = [], confirms = [];
  w.addEventListener('error', e => { errors.push(String(e.error || e.message)); e.preventDefault(); });
  w.Blob = globalThis.Blob; w.confirm = msg => { confirms.push(String(msg)); return true; }; w.alert = msg => alerts.push(String(msg)); w.prompt = () => null;
  w.T = { DEFAULT_RULES: clone(rules), SAMPLE_MONTH: clone(initial), PROFILES: [], LANGS_DATA: [JSON.parse(fs.readFileSync(path.join(__dirname, 'lang/ja.json'), 'utf8'))] };
  for (const f of scripts) w.eval(source(f) + '\n//# sourceURL=' + f);
  const A = w.T.app; A.restoreFolder = () => {}; // Initial OS attachment only; all input/import/save/merge/render code is production.
  w.localStorage.setItem('toban.lang', 'ja'); w.T.init();
  const guardListeners = new Map([['input', new Set()], ['change', new Set()]]);
  const addListener = w.document.addEventListener.bind(w.document), removeListener = w.document.removeEventListener.bind(w.document);
  w.document.addEventListener = (type, fn, options) => { if (options === true && guardListeners.has(type)) guardListeners.get(type).add(fn); return addListener(type, fn, options); };
  w.document.removeEventListener = (type, fn, options) => { if (options === true && guardListeners.has(type)) guardListeners.get(type).delete(fn); return removeListener(type, fn, options); };

  const nativeTimer = w.setTimeout.bind(w);
  w.setTimeout = (fn, delay, ...args) => { if (delay === 3000) { return 12345; } if (delay === 4000) return 12346; return nativeTimer(fn, delay, ...args); };
  const root = memoryFolder(); A.dirHandle = root; A.dirGen++; await A.refreshMonths();
  const q = s => w.document.querySelector(s);
  return { dom, w, A, root, q, errors, alerts, guardListeners };
}




// Full production DOM and bound handlers, synthetic OS file reads and in-memory folder only.
// A focused concurrency regression, not a browser visual/focus or full-suite claim.
const EXPECTED_CASES = 12; let passed=0, failed=0, finished=false;
const watchdog=setTimeout(()=>{console.error('Profile pending-input tests timed out');process.exit(1);},60000);
process.on('exit',()=>{if(!finished || passed+failed!==EXPECTED_CASES || failed){console.error(`NOT PASSED: ${passed}/${EXPECTED_CASES}; failed=${failed}; finished=${finished}`);process.exitCode=1;}});
async function scenario(label,fn){const app=await makeApp();try{await fn(app);for(const listeners of app.guardListeners.values())assert.equal(listeners.size,0,'guard listeners removed');assert.deepEqual(app.errors,[]);assert.deepEqual(app.alerts,[]);passed++;console.log('PASS '+label);}catch(e){failed++;console.error('FAIL '+label+': '+e.stack);}finally{app.dom.window.close();}}
async function startProfile(app){const {q,w,A}=app;q('.tab[data-tab="settings"]').click();const incoming=clone(A.state.rules);incoming.profile.label='Synthetic replacement profile';const entered=gate(),release=gate();const file={name:'fictional-profile.json',text:async()=>{entered.resolve();await release.promise;return JSON.stringify(incoming);}};const el=q('#fileLoadProfile');Object.defineProperty(el,'files',{value:[file],configurable:true});el.dispatchEvent(new w.Event('change',{bubbles:true}));await entered.promise;return async()=>{release.resolve();await until(()=>A.switching===0,'profile import completion');};}
function fixedField(app){app.q('.tab[data-tab="input"]').click();app.q('.sub[data-sub="fixedPane"]').click();const field=app.q('input[data-fx="night"][data-d="7"]');assert(field);return field;}
function checkpoint(app){return{state:JSON.stringify(app.A.state),month:app.A.state.month,rules:app.A.state.rules,storage:app.w.localStorage.getItem('toban_state_v2:/synthetic/profile-pending-input.html'),undo:app.q('#undoNote').textContent,writes:JSON.stringify(app.root.writes)};}
function preserved(app,before){assert.equal(JSON.stringify(app.A.state),before.state,'state unchanged');assert.equal(app.A.state.month,before.month);assert.equal(app.A.state.rules,before.rules);assert.equal(app.w.localStorage.getItem('toban_state_v2:/synthetic/profile-pending-input.html'),before.storage,'storage unchanged');assert.equal(app.q('#undoNote').textContent,before.undo,'Undo unchanged');assert.equal(JSON.stringify(app.root.writes),before.writes,'folder writes unchanged');}
(async()=>{
 for(const event of ['input','change']) await scenario('intervening fixed '+event+' aborts with state, Undo, storage and UI preserved',async app=>{const resume=await startProfile(app),field=fixedField(app);field.focus();field.value=gamma;field.dispatchEvent(new app.w.Event(event,{bubbles:true}));await tick();const before=checkpoint(app);await resume();preserved(app,before);assert.equal(app.q('[data-fx="night"][data-d="7"]'),field,'no replacement DOM');assert.equal(field.value,gamma);});
 await scenario('intervening month note input aborts without discarding pending text',async app=>{const resume=await startProfile(app);app.q('.tab[data-tab="input"]').click();const field=app.q('[data-path="notes"]');field.value='Pending fictional note';field.dispatchEvent(new app.w.Event('input',{bubbles:true}));const before=checkpoint(app);await resume();preserved(app,before);assert.equal(field,app.q('[data-path="notes"]'));assert.equal(field.value,'Pending fictional note');});
 await scenario('intervening settings input aborts without replacing settings text',async app=>{const resume=await startProfile(app);const field=app.q('#rulesJson');field.value+=' ';field.dispatchEvent(new app.w.Event('input',{bubbles:true}));const before=checkpoint(app),value=field.value;await resume();preserved(app,before);assert.equal(field,app.q('#rulesJson'));assert.equal(field.value,value);});
 await scenario('edit reported during confirmation aborts before adoption',async app=>{const resume=await startProfile(app);const field=fixedField(app);const before=checkpoint(app);app.w.confirm=()=>{field.value=gamma;field.dispatchEvent(new app.w.Event('input',{bubbles:true}));return true;};await resume();preserved(app,before);assert.equal(field,app.q('[data-fx="night"][data-d="7"]'));assert.equal(field.value,gamma);});
 await scenario('cancel without edits preserves all state and storage',async app=>{const resume=await startProfile(app);app.w.confirm=()=>false;const before=checkpoint(app);await resume();preserved(app,before);});
 await scenario('normal import and retry after input-abort succeed; listener is cleaned up',async app=>{let resume=await startProfile(app);const field=fixedField(app);field.value=gamma;field.dispatchEvent(new app.w.Event('input',{bubbles:true}));await resume();field.dispatchEvent(new app.w.Event('change',{bubbles:true}));await tick();resume=await startProfile(app);await resume();assert.equal(app.A.state.rules.profile.label,'Synthetic replacement profile');assert.equal(app.A.state.month.fixed.night[7],gamma);assert(app.q('#undoNote').textContent.includes('施設プロファイルの読み込み'));});

 await scenario('no-edit import succeeds without self-invalidating the file selection',async app=>{const resume=await startProfile(app);await resume();assert.equal(app.A.state.rules.profile.label,'Synthetic replacement profile');assert.deepEqual(clone(app.A.state.month.fixed.night[7]),[alpha,beta]);});
 await scenario('input while waiting for an earlier save aborts before file read',async app=>{const {A,q,w}=app;q('.tab[data-tab="settings"]').click();const blocked=gate(),release=gate();A.serialized(async()=>{blocked.resolve();await release.promise;});await blocked.promise;let reads=0;const el=q('#fileLoadProfile');Object.defineProperty(el,'files',{value:[{name:'fictional-profile.json',text:async()=>{reads++;return JSON.stringify(clone(A.state.rules));}}],configurable:true});el.dispatchEvent(new w.Event('change',{bubbles:true}));const field=fixedField(app);field.value=gamma;field.dispatchEvent(new w.Event('input',{bubbles:true}));const before=checkpoint(app);release.resolve();await until(()=>A.switching===0,'queued-save import abort');preserved(app,before);assert.equal(reads,0);assert.equal(field.value,gamma);assert.equal(field,app.q('[data-fx="night"][data-d="7"]'));});
 await scenario('file-read error preserves state and releases guard for a fresh import',async app=>{const {A,q,w}=app;q('.tab[data-tab="settings"]').click();const el=q('#fileLoadProfile');Object.defineProperty(el,'files',{value:[{name:'fictional-profile.json',text:async()=>{throw new Error('Synthetic read failure');}}],configurable:true});const before=checkpoint(app);el.dispatchEvent(new w.Event('change',{bubbles:true}));await until(()=>A.switching===0,'file-read failure');preserved(app,before);assert.equal(app.alerts.length,1);app.alerts.length=0;const resume=await startProfile(app);await resume();assert.equal(A.state.rules.profile.label,'Synthetic replacement profile');});

 await scenario('cancel at confirmation retains uncommitted text and does not add Undo',async app=>{const resume=await startProfile(app),field=fixedField(app),before=checkpoint(app);app.w.confirm=()=>{field.value=gamma;field.dispatchEvent(new app.w.Event('input',{bubbles:true}));return false;};await resume();preserved(app,before);assert.equal(field,app.q('[data-fx="night"][data-d="7"]'));assert.equal(field.value,gamma);});

 await scenario('transition rejection removes guard listeners and permits a later import',async app=>{const {A,q,w}=app;q('.tab[data-tab="settings"]').click();A.solving=true;let reads=0;const el=q('#fileLoadProfile');Object.defineProperty(el,'files',{value:[{name:'fictional-profile.json',text:async()=>{reads++;return '{}';}}],configurable:true});const before=checkpoint(app);el.dispatchEvent(new w.Event('change',{bubbles:true}));await tick();assert.equal(reads,0);preserved(app,before);for(const listeners of app.guardListeners.values())assert.equal(listeners.size,0);A.solving=false;const resume=await startProfile(app);await resume();assert.equal(A.state.rules.profile.label,'Synthetic replacement profile');});
 finished=true;clearTimeout(watchdog);console.log(`Profile pending-input: ${passed}/${EXPECTED_CASES} passed, ${failed} failed`);
})().catch(e=>{console.error(e);clearTimeout(watchdog);process.exitCode=1;});

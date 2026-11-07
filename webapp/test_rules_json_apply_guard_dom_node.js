// Applying a retained rules-JSON draft must not revert settings committed after the draft started.
// The guard compares the settings the draft is based on with the current settings right before replacement,
// stops with a message, and keeps the current settings, the draft, the Undo history and the save state.
// Covers settings commits (weight, years, rule number), further typing, invalid JSON, discard accept/cancel,
// restoring the settings (commit back, Undo), restoring the text, repeated edits, language switch, plug-in reload,
// a hidden (table-less) setting changed by adoption, a change during an in-progress save, and the no-marker import path.
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
  const dom = new JSDOM(source('index.html').replace('/*__CSS__*/', source('style.css')), { url: 'https://example.invalid/synthetic/rules-json-apply-guard.html', runScripts: 'outside-only' }), w = dom.window;
  await new Promise(r => w.document.readyState === 'complete' ? r() : w.addEventListener('load', r, { once: true }));
  const errors = [], alerts = [];
  w.addEventListener('error', e => { errors.push(String(e.error || e.message)); e.preventDefault(); });
  w.Blob = globalThis.Blob; w.confirm = () => true; w.alert = msg => alerts.push(String(msg)); w.prompt = () => null;
  w.T = { DEFAULT_RULES: clone(rules), SAMPLE_MONTH: clone(initial), PROFILES: [], LANGS_DATA: [JSON.parse(fs.readFileSync(path.join(ROOT, 'lang/ja.json'), 'utf8')), JSON.parse(fs.readFileSync(path.join(ROOT, 'lang/en.json'), 'utf8'))] };
  for (const f of scripts) w.eval(source(f) + '\n//# sourceURL=' + f);
  const A = w.T.app; A.restoreFolder = () => {}; // OS attachment only; production input, merge, save and render functions remain intact.
  w.localStorage.setItem('toban.lang', 'ja'); w.T.init();
  let scheduled = null; const nativeTimer = w.setTimeout.bind(w);
  w.setTimeout = (fn, delay, ...args) => { if (delay === 3000) { scheduled = fn; return 12345; } if (delay === 4000) return 12346; return nativeTimer(fn, delay, ...args); };
  const root = memoryFolder(); A.dirHandle = root; A.dirGen++; await A.refreshMonths();
  const q = s => w.document.querySelector(s), key = 'toban_state_v2:/synthetic/rules-json-apply-guard.html';
  const event = (el, type) => el.dispatchEvent(new w.Event(type, { bubbles: true }));
  const change = (selector, value) => { const el = q(selector); assert(el, selector); el.value = value; event(el, 'change'); return el; };
  const input = (selector, value) => { const el = q(selector); assert(el, selector); el.focus(); el.value = value; event(el, 'input'); return el; };
  const auto = () => { assert(scheduled, 'bound change scheduled autosave'); const fn = scheduled; scheduled = null; return fn(); };
  const dir = await root.getDirectoryHandle('202611', { create: true });
  // Establish the production common base via JSON autosave, not mocked state/meta.
  change('[data-path="notes"]', 'Synthetic base note'); assert.equal(await auto(), 'saved');
  const base = JSON.parse(dir.files.get('202611_data.json')); root.writes.length = 0;
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
const enter = a => { a.q('.tab[data-tab="settings"]').click(); a.q('#rulesJson').closest('details').open = true; };

const validDraft = a => { const R = clone(a.A.state.rules); R.local_synthetic_json_draft = { text: 'Synthetic explicit JSON edit' }; return JSON.stringify(R, null, 2); };
const draft = (a, value) => { const el = a.input('#rulesJson', value); el.setSelectionRange(5, 17); return el; };
const text = a => JSON.stringify(a.A.state.rules, null, 1);
const CHANGED = '設定のJSONを反映しませんでした。このJSONの編集を始めたあとに設定が変わっています', UNKNOWN = '設定のJSONを反映しませんでした。この編集の元になった設定を確認できない';
const EN_CHANGED = 'The settings JSON was not applied. The settings have changed since this JSON edit was started';
const weightSel = '#weightsTable [data-w]', yearsSel = '#doctorTable tr[data-i="0"] [data-f="years"]';
const commitWeight = (a, v) => { const el = a.input(weightSel, v); a.event(el, 'focusout'); return el; };
const commitYears = (a, v) => a.change(yearsSel, v);
const clickApply = async a => { a.q('#btnApplyRules').click(); await until(() => !a.A.switching, 'apply transition settled'); await tick(); };
// Assert the stop: one message, settings/draft/Undo/save state untouched (compared with the checkpoint taken after the commit).
const stopped = (a, before, el, value, message = CHANGED, base) => {
  assert.equal(a.alerts.length, 1, 'exactly one message, got ' + JSON.stringify(a.alerts)); assert.ok(a.alerts[0].startsWith(message), 'message: ' + a.alerts[0]); a.alerts.length = 0;
  a.retained(before, el, value, false); assert.equal(el.selectionStart, 5); assert.equal(el.selectionEnd, 17);
  assert.equal(a.A.state.rules.local_synthetic_json_draft, undefined, 'draft not applied'); assert.equal(a.A.hasPendingRulesJsonDraft(), true);
  if (base !== undefined && a.A.rulesJsonDraftBase) assert.equal(a.A.rulesJsonDraftBase(), base, 'draft base kept');
};
const applied = async (a, el) => {
  await until(() => !!a.A.state.rules.local_synthetic_json_draft, 'draft applied'); assert.deepEqual(a.alerts, []);
  assert.notEqual(el.dataset.pluginDraft, '1'); assert.equal(a.A.hasPendingRulesJsonDraft(), false); if (a.A.rulesJsonDraftBase) assert.equal(a.A.rulesJsonDraftBase(), null);
  assert.equal(el.value, text(a), 'editor follows the applied model');
};
const start = a => { enter(a); const base = text(a), value = validDraft(a), el = draft(a, value); if (a.A.rulesJsonDraftBase) assert.equal(a.A.rulesJsonDraftBase(), base); return { base, value, el }; };
const original = (a, sel) => a.q(sel).value; // the displayed value before the commit, restored later by committing it back

for (const [name, sel, commit, restore] of [['weight', weightSel, a => commitWeight(a, '37'), (a, v) => commitWeight(a, v)], ['years', yearsSel, a => commitYears(a, '12'), (a, v) => commitYears(a, v)], ['rule number', '#setRunMax', a => { a.A.state.rules.rule_states.run_length_max = 'hard'; a.A.renderSettings(); const el = a.input('#setRunMax', '7'); a.event(el, 'focusout'); return el; }, null]]) {
  add('commit ' + name + ' after the draft: apply stops and keeps settings, draft, Undo and save state', async a => {
    const d = start(a); const beforeRules = JSON.stringify(a.A.state.rules); commit(a);
    assert.notEqual(JSON.stringify(a.A.state.rules), beforeRules, 'settings commit changed the model'); assert.equal(d.el.value, d.value, 'draft retained through the commit');
    const before = a.checkpoint(); const dirty = a.A.isDirty();
    await clickApply(a); stopped(a, before, d.el, d.value, CHANGED, d.base);
    assert.equal(a.A.isDirty(), dirty, 'save state unchanged'); assert.equal(JSON.stringify(a.A.state.rules), JSON.stringify(JSON.parse(before.state).rules), 'committed settings kept');
  });
  if (restore) add('commit ' + name + ' then commit the original value back: the commit re-projected the settings, so apply still stops; Undo restores the base and apply proceeds', async a => {
    const d = start(a); const v0 = original(a, sel); commit(a); let before = a.checkpoint(); await clickApply(a); stopped(a, before, d.el, d.value, CHANGED, d.base);
    restore(a, v0); assert.equal(a.q(sel).value, v0, 'displayed value restored'); assert.equal(d.el.value, d.value, 'draft still retained');
    // A table commit re-projects the settings (defaults such as docx / profile.calendar are materialized), and the app's own
    // signature treats that as a change too, so the whole-settings comparison still differs from the draft base.
    assert.notEqual(text(a), d.base, 'settings text differs from the draft base after commit and commit-back'); assert.notEqual(a.A.rulesSig(a.A.state.rules), a.A.rulesSig(JSON.parse(d.base)), 'the app signature differs as well');
    before = a.checkpoint(); await clickApply(a); stopped(a, before, d.el, d.value, CHANGED, d.base);
    a.A.undo(); a.A.undo(); assert.equal(text(a), d.base, 'Undo of both commits restores the draft base'); assert.equal(d.el.value, d.value, 'draft retained through Undo');
    const rulesBefore = clone(a.A.state.rules); await clickApply(a); await applied(a, d.el);
    assert.ok(a.q('#undoNote').textContent.includes('JSON'), 'Undo entry for the apply: ' + a.q('#undoNote').textContent);
    a.A.undo(); assert.equal(JSON.stringify(a.A.state.rules), JSON.stringify(rulesBefore), 'Undo restores the settings before the apply');
  });
}
add('Undo of the committed change restores the draft base: apply proceeds', async a => {
  const d = start(a); commitWeight(a, '37'); const before = a.checkpoint(); await clickApply(a); stopped(a, before, d.el, d.value, CHANGED, d.base);
  a.A.undo(); assert.equal(text(a), d.base, 'Undo restored the settings'); assert.equal(d.el.value, d.value, 'draft retained through Undo');
  await clickApply(a); await applied(a, d.el);
});
add('further typing after the commit keeps the protection', async a => {
  const d = start(a); commitWeight(a, '37'); const more = d.value.replace('Synthetic explicit JSON edit', 'Synthetic explicit JSON edit, continued'); const el = draft(a, more);
  assert.equal(a.A.rulesJsonDraftBase(), d.base, 'base unchanged by further typing'); const before = a.checkpoint();
  await clickApply(a); stopped(a, before, el, more, CHANGED, d.base);
});
add('invalid JSON draft after the commit: the settings message, not the JSON error; draft kept', async a => {
  enter(a); const base = text(a), value = '{ "synthetic incomplete": ', el = draft(a, value); commitWeight(a, '37'); const before = a.checkpoint();
  await clickApply(a); stopped(a, before, el, value, CHANGED, base);
});
add('invalid JSON draft without a settings change: the JSON error as before', async a => {
  enter(a); const value = '{ "synthetic incomplete": ', el = draft(a, value); const before = a.checkpoint();
  await clickApply(a); assert.equal(a.alerts.length, 1); assert.ok(a.alerts[0].startsWith('JSONの形式が不正です'), a.alerts[0]); a.alerts.length = 0; a.retained(before, el, value, false);
});
for (const accept of [false, true]) add('explicit discard after a stop: ' + (accept ? 'accept' : 'cancel'), async a => {
  const d = start(a); commitWeight(a, '37'); const before = a.checkpoint(); await clickApply(a); stopped(a, before, d.el, d.value, CHANGED, d.base);
  let asked = 0; a.w.confirm = () => { asked++; return accept; }; a.q('#btnDiscardRulesJson').click(); assert.equal(asked, 1);
  assert.equal(JSON.stringify(a.A.state), before.state, 'discard never changes the settings'); assert.deepEqual(a.root.writes, []);
  if (!accept) { assert.equal(d.el.value, d.value); assert.equal(a.A.hasPendingRulesJsonDraft(), true); assert.equal(a.A.rulesJsonDraftBase(), d.base); }
  else { assert.equal(d.el.value, text(a), 'editor shows the current (committed) settings'); assert.equal(a.A.hasPendingRulesJsonDraft(), false); assert.equal(a.A.rulesJsonDraftBase(), null); assert.equal(a.A.state.rules.weights[a.q(weightSel).dataset.w], 37, 'committed weight kept'); }
});
add('restoring the text to the current settings after a stop: nothing to apply, no stop', async a => {
  const d = start(a); commitWeight(a, '37'); const before = a.checkpoint(); await clickApply(a); stopped(a, before, d.el, d.value, CHANGED, d.base);
  a.input('#rulesJson', text(a)); assert.equal(a.A.hasPendingRulesJsonDraft(), false, 'editor equals the settings');
  const rules = JSON.stringify(a.A.state.rules); await clickApply(a); assert.deepEqual(a.alerts, [], 'not stopped'); assert.equal(JSON.stringify(a.A.state.rules), rules, 'settings unchanged by the no-op apply'); assert.notEqual(d.el.dataset.pluginDraft, '1');
});
add('restoring the text to the draft base after a stop still stops (the settings differ from the base)', async a => {
  const d = start(a); commitWeight(a, '37'); const el = draft(a, d.base); const before = a.checkpoint();
  await clickApply(a); stopped(a, before, el, d.base, CHANGED, d.base);
});
add('repeated edits: stop, edit, stop again, Undo the commit, apply the latest draft', async a => {
  const d = start(a); commitWeight(a, '37'); let before = a.checkpoint(); await clickApply(a); stopped(a, before, d.el, d.value, CHANGED, d.base);
  const v2 = d.value.replace('Synthetic explicit JSON edit', 'Synthetic second edit'); const el = draft(a, v2); before = a.checkpoint(); await clickApply(a); stopped(a, before, el, v2, CHANGED, d.base);
  a.A.undo(); assert.equal(text(a), d.base); assert.equal(el.value, v2); await clickApply(a); await applied(a, el); assert.equal(a.A.state.rules.local_synthetic_json_draft.text, 'Synthetic second edit');
});
add('language switch after the draft: settings unchanged, apply proceeds', async a => {
  const d = start(a); a.change('#langSel', 'en'); await until(() => !a.A.switching && a.w.T.lang() === 'en', 'language switched');
  assert.equal(d.el.value, d.value, 'draft survives the language change'); assert.equal(text(a), d.base, 'language does not change the settings');
  await clickApply(a); await applied(a, d.el);
});
add('language switch after a stop: the message follows the language, settings still protected', async a => {
  const d = start(a); commitWeight(a, '37'); a.change('#langSel', 'en'); await until(() => !a.A.switching && a.w.T.lang() === 'en', 'language switched');
  const before = a.checkpoint(); await clickApply(a); stopped(a, before, d.el, d.value, EN_CHANGED, d.base);
});
add('plug-in reload (no folder plug-ins) after the draft: settings text unchanged, apply proceeds', async a => {
  const d = start(a); a.q('#btnReloadPlugins').click(); await until(() => !a.A.switching, 'reload settled'); await tick();
  assert.equal(d.el.value, d.value, 'draft survives the reload'); assert.equal(text(a), d.base, 'no-op reload leaves the settings text unchanged');
  await clickApply(a); await applied(a, d.el);
});
add('plug-in reload after a commit: still stopped', async a => {
  const d = start(a); commitWeight(a, '37'); a.q('#btnReloadPlugins').click(); await until(() => !a.A.switching, 'reload settled'); await tick();
  const before = a.checkpoint(); await clickApply(a); stopped(a, before, d.el, d.value, CHANGED, d.base);
});
add('hidden (table-less) setting changed by adoption after the draft: stop; changed back: apply proceeds', async a => {
  const d = start(a); a.A.state.rules.local_synthetic_hidden = { adopted: 'Synthetic peer value' }; // not shown in any table; no re-render
  const before = a.checkpoint(); await clickApply(a); stopped(a, before, d.el, d.value, CHANGED, d.base);
  delete a.A.state.rules.local_synthetic_hidden; assert.equal(text(a), d.base); await clickApply(a); await applied(a, d.el);
});
add('settings changed while the apply waits for an in-progress save: re-check stops it', async a => {
  // A save started before the draft is blocked while reading the peer file; the draft then makes that save abort at its own
  // re-check ('skipped', test_save_rules_json_draft_dom_node.js), and the apply waits for it (A.transition) before deciding.
  a.setup(); enter(a); const p = a.pause(); const saving = a.auto(); await p.entered;
  const d = start(a); a.q('#btnApplyRules').click(); await tick(); assert.equal(a.A.switching, 1, 'apply is waiting for the save'); assert.deepEqual(a.alerts, []);
  commitWeight(a, '37'); const committed = text(a);
  p.release(); assert.equal(await saving, 'skipped'); await until(() => !a.A.switching, 'apply settled'); await tick();
  assert.equal(a.alerts.length, 1); assert.ok(a.alerts[0].startsWith(CHANGED), a.alerts[0]); a.alerts.length = 0;
  assert.equal(text(a), committed, 'committed settings kept'); assert.equal(d.el.value, d.value); assert.equal(a.A.hasPendingRulesJsonDraft(), true); assert.equal(a.A.state.rules.local_synthetic_json_draft, undefined);
});
add('apply waiting for an in-progress save with no settings change: proceeds after the save', async a => {
  a.setup(); enter(a); const p = a.pause(); const saving = a.auto(); await p.entered;
  const d = start(a); a.q('#btnApplyRules').click(); await tick(); assert.equal(a.A.switching, 1); assert.equal(a.A.state.rules.local_synthetic_json_draft, undefined, 'not applied while waiting');
  p.release(); assert.equal(await saving, 'skipped'); await until(() => !a.A.switching, 'apply settled'); await applied(a, d.el);
});
add('marker without a recorded base: stop with the unknown-base message', async a => {
  enter(a); const el = a.q('#rulesJson'), value = validDraft(a); el.value = value; el.dataset.pluginDraft = '1'; el.setSelectionRange(5, 17); const before = a.checkpoint();
  await clickApply(a); assert.equal(a.alerts.length, 1); assert.ok(a.alerts[0].startsWith(UNKNOWN), a.alerts[0]); a.alerts.length = 0;
  a.retained(before, el, value, false); assert.equal(a.A.state.rules.local_synthetic_json_draft, undefined);
});
add('no marker: a programmatic editor value is applied as before (import contract)', async a => {
  enter(a); const el = a.q('#rulesJson'); el.value = validDraft(a); assert.notEqual(el.dataset.pluginDraft, '1');
  await clickApply(a); await until(() => !!a.A.state.rules.local_synthetic_json_draft, 'applied'); assert.deepEqual(a.alerts, []);
});
add('draft without any settings change applies as before and Undo restores it', async a => {
  const d = start(a); const rulesBefore = clone(a.A.state.rules); await clickApply(a); await applied(a, d.el); a.A.undo(); assert.equal(JSON.stringify(a.A.state.rules), JSON.stringify(rulesBefore));
});

const EXPECTED_CASES = 24; assert.equal(cases.length, EXPECTED_CASES);
let passed = 0, completed = 0, finished = false;
for (const c of cases) console.log('REGISTER ' + c.name);
const watchdog = setTimeout(() => { console.error('Rules JSON apply guard regression timed out'); process.exit(1); }, 180000);
// A transition left pending by a failed case may resume after its window was closed; log it instead of letting it end the process.
process.on('unhandledRejection', e => console.error('LATE_REJECTION ' + String(e && e.stack || e).slice(0, 300)));
process.on('exit', () => { if (!finished || completed !== EXPECTED_CASES || passed !== EXPECTED_CASES) { console.error(`INCOMPLETE_OR_FAILED ${passed}/${EXPECTED_CASES} passed; ${completed} completed`); process.exitCode = 1; } });
(async () => {
  for (const c of cases) { let a, outcome = 'fail'; console.log('START ' + c.name);
    try { a = await makeApp(); await c.fn(a); assert.deepEqual(a.errors, []); assert.deepEqual(a.alerts, [], 'every message was asserted and cleared'); passed++; outcome = 'pass'; console.log('PASS ' + c.name); }
    catch (e) { console.error('FAIL ' + c.name + '\n' + e.stack); }
    finally { if (a) { try { await until(() => !a.A.switching, 'transition settled before close'); } catch (e) { console.error('NOTE ' + c.name + ': ' + e.message); } a.dom.window.close(); } completed++; console.log('COMPLETE ' + JSON.stringify({ name: c.name, outcome })); }
  }
  finished = true; clearTimeout(watchdog); console.log(`${passed}/${EXPECTED_CASES} passed; ${completed} completed`); process.exitCode = passed === EXPECTED_CASES ? 0 : 1;
})().catch(e => { console.error(e); clearTimeout(watchdog); process.exitCode = 1; });

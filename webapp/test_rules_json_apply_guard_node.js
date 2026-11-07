// Isolated regression for the rules-JSON apply guard (minimal elements, no DOM/browser claim). All data synthetic.
// The guard compares the settings the draft started from with the settings right before replacement and stops the
// apply when they differ, when the base is unknown, or after the transition's wait for an in-progress save.
// readSettings is replaced with a model mutation (like test_rules_json_commit_guard_node.js). TOBAN_WEBAPP_ROOT selects source tree.
const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert/strict');
const root = path.resolve(process.env.TOBAN_WEBAPP_ROOT || __dirname);
let src = fs.readFileSync(path.join(root, 'src/app-settings.js'), 'utf8');
const occurrences = (src.match(/(?<!function )readSettings\(/g) || []).length;
assert(occurrences > 0, 'expected production calls to readSettings');
src = src.replace(/(?<!function )readSettings\(/g, 'testReadSettings(');
const CHANGED = '設定のJSONを反映しませんでした。このJSONの編集を始めたあとに設定が変わっています', UNKNOWN = '設定のJSONを反映しませんでした。この編集の元になった設定を確認できない';
function harness() {
  const els = new Map();
  class Element { constructor(id) { this.id = id; this.value = ''; this.dataset = {}; this.handlers = {}; this.disabled = false; this.textContent = ''; this.title = ''; }
    addEventListener(t, f) { (this.handlers[t] ||= []).push(f); } setAttribute() { } contains() { return true; } querySelectorAll() { return []; } querySelector() { return null; } closest() { return null; } matches() { return false; }
    emit(t, target = this) { for (const f of this.handlers[t] || []) f({ target, type: t, preventDefault() { } }); } }
  const el = s => { if (!els.has(s)) els.set(s, new Element(s.slice(1))); return els.get(s); };
  const state = { rules: { run_length: { max: 5, min: 3 }, days_off: {}, doctors: [], weights: {} }, month: {} };
  const log = { saves: 0, alerts: [], toasts: [], transitions: 0 };
  let hold = Promise.resolve();
  const T = { app: { state, save() { log.saves++; }, renderSettingsMonth() { }, renderDoctor() { }, toast(m) { log.toasts.push(String(m)); },
    async transition(kind, fn) { log.transitions++; await hold; return fn(); } }, numberInputText: x => String(x), t: x => x };
  const document = { querySelector: el, querySelectorAll: () => [], activeElement: null };
  const context = { T, document, localStorage: { getItem: () => null, setItem() { } }, confirm: () => true, alert(m) { log.alerts.push(String(m)); }, prompt() { },
    testReadSettings() { state.rules.run_length.max = 7; return true; } };
  vm.runInNewContext(src, context, { filename: 'app-settings.js' }); T.app.bindSettings();
  const json = el('#rulesJson'), max = el('#setRunMax'), settings = el('#settings');
  json.value = JSON.stringify(state.rules, null, 1);
  const click = async s => { el(s).emit('click'); await tick(); await tick(); }; // the Apply handler goes through the (async) transition
  return { el, json, max, settings, state, T, A: T.app, log, click, setHold(p) { hold = p; } };
}
const tick = () => new Promise(r => setImmediate(r));
const model = h => JSON.stringify(h.state.rules, null, 1);
function commit(h) { h.max.value = '7'; h.max.dataset.numericEdited = '1'; h.settings.emit('focusout', h.max); assert.equal(h.state.rules.run_length.max, 7, 'simulated commit executed'); }
const results = [];
async function test(name, fn) { try { await fn(); results.push({ name, ok: true }); console.log('PASS ' + name); } catch (e) { results.push({ name, ok: false }); console.error('FAIL ' + name + ': ' + e.message); } }
(async () => {
  await test('no marker: a programmatic editor value has no stop reason (existing import contract)', async () => {
    const h = harness(); h.json.value = '{"valid":true}'; assert.equal(h.A.rulesJsonApplyStop(), null); assert.equal(h.A.rulesJsonDraftBase(), null);
  });
  await test('draft start records the settings it is based on; unchanged settings do not stop', async () => {
    const h = harness(); const base = model(h); h.json.value = '{"valid":true}'; h.json.emit('input');
    assert.equal(h.A.rulesJsonDraftBase(), base); assert.equal(h.A.rulesJsonApplyStop(), null);
  });
  await test('settings changed after the draft started: stop, keep settings, draft and save state', async () => {
    const h = harness(); const base = model(h); h.json.value = '{"valid":true}'; h.json.emit('input'); commit(h);
    assert.equal(h.json.value, '{"valid":true}', 'draft retained through the commit (post57 C02)');
    const savesBefore = h.log.saves, rulesRef = h.state.rules, text = model(h);
    await h.click('#btnApplyRules');
    assert.equal(h.log.alerts.length, 1, 'apply stopped with one message (got ' + JSON.stringify(h.log.alerts) + ')'); assert.ok(h.log.alerts[0].startsWith(CHANGED), 'alert carries the changed-settings message');
    const reason = h.A.rulesJsonApplyStop(); assert.ok(reason && reason.startsWith(CHANGED), 'changed-settings reason: ' + reason);
    assert.equal(h.state.rules, rulesRef, 'state.rules object not replaced'); assert.equal(model(h), text, 'settings unchanged');
    assert.equal(h.json.value, '{"valid":true}'); assert.equal(h.json.dataset.pluginDraft, '1'); assert.equal(h.A.rulesJsonDraftBase(), base, 'base kept for the next attempt');
    assert.equal(h.log.saves, savesBefore, 'no save on stop'); assert.deepEqual(h.log.toasts, [], 'no applied toast');
  });
  await test('settings restored to the draft base: no stop reason', async () => {
    const h = harness(); h.json.value = '{"valid":true}'; h.json.emit('input'); commit(h); assert.ok(h.A.rulesJsonApplyStop());
    h.state.rules.run_length.max = 5; assert.equal(h.A.rulesJsonApplyStop(), null, 'same settings text as the base');
  });
  await test('further typing after the settings change keeps the original base', async () => {
    const h = harness(); const base = model(h); h.json.value = '{"valid":true}'; h.json.emit('input'); commit(h);
    h.json.value = '{"valid":true,"more":1}'; h.json.emit('input'); assert.equal(h.A.rulesJsonDraftBase(), base); assert.ok(h.A.rulesJsonApplyStop().startsWith(CHANGED));
  });
  await test('marker without a recorded base: unknown-base stop; editor equal to the settings is not stopped', async () => {
    const h = harness(); h.json.dataset.pluginDraft = '1'; h.json.value = '{"valid":true}';
    await h.click('#btnApplyRules'); assert.equal(h.log.alerts.length, 1, 'apply stopped (got ' + JSON.stringify(h.log.alerts) + ')'); assert.ok(h.log.alerts[0].startsWith(UNKNOWN)); assert.equal(h.log.saves, 0);
    const reason = h.A.rulesJsonApplyStop(); assert.ok(reason && reason.startsWith(UNKNOWN), reason);
    h.json.value = model(h); assert.equal(h.A.rulesJsonApplyStop(), null, 'editor equals the settings');
  });
  await test('re-check after the transition waits: a settings change during the wait stops the apply', async () => {
    const h = harness(); h.json.value = '{"valid":true}'; h.json.emit('input');
    let release; h.setHold(new Promise(r => { release = r; }));
    const clicked = h.click('#btnApplyRules'); await tick(); assert.equal(h.log.transitions, 1); assert.deepEqual(h.log.alerts, [], 'waiting, not yet decided');
    commit(h); release(); await clicked; await tick();
    assert.equal(h.log.alerts.length, 1); assert.ok(h.log.alerts[0].startsWith(CHANGED), 'stopped by the re-check after the wait'); assert.equal(h.log.saves, 0);
    assert.equal(h.json.value, '{"valid":true}'); assert.equal(h.json.dataset.pluginDraft, '1');
  });
  await test('minimal editor without dataset: no guard, no stop reason', async () => {
    const h = harness(); delete h.json.dataset; h.json.value = '{"valid":true}'; h.json.emit('input'); commit(h); assert.equal(h.A.rulesJsonApplyStop(), null);
  });
  await test('discard after a stop clears the base', async () => {
    const h = harness(); h.json.value = '{"valid":true}'; h.json.emit('input'); commit(h); assert.ok(h.A.rulesJsonApplyStop());
    h.el('#btnDiscardRulesJson').emit('click');
    assert.equal(h.json.value, model(h)); assert.equal(h.json.dataset.pluginDraft, undefined); assert.equal(h.A.rulesJsonDraftBase(), null); assert.equal(h.A.rulesJsonApplyStop(), null);
  });
  if (results.some(r => !r.ok)) process.exitCode = 1;
  console.log(`${results.filter(r => r.ok).length}/${results.length} passed`);
})().catch(e => { console.error(e); process.exitCode = 1; });

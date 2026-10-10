// Saved one-person count maps: real settings/save/readback and Python/JS parity.
// node test_python_saved_count_node.js <path/to/highs> [path/to/python]
// TOBAN_WEBAPP_ROOT / TOBAN_PYTHON_ROOT may target unchanged sources for a red run.
// The DOM, localStorage and download sink are substitutes, not a native browser.
// Rendering, settings handlers, JSON serialization/import, solvers and checkers are real.
// All staff and assignments come from the existing fictional supported-Python fixture.
const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert/strict');
const { execFileSync } = require('child_process');
const root = process.env.TOBAN_WEBAPP_ROOT || __dirname;
const toolsRoot = path.join(process.env.TOBAN_PYTHON_ROOT || path.resolve(root, '..'), 'tools');
const python = process.argv[3] || path.join(__dirname, '../tools/.venv/bin/python');
const clone = x => JSON.parse(JSON.stringify(x));
const elems = new Map(), storage = new Map();
function element(sel) {
  if (!elems.has(sel)) elems.set(sel, { value: '', innerHTML: '', textContent: '', handlers: {},
    addEventListener(type, fn) { (this.handlers[type] ||= []).push(fn); } });
  return elems.get(sel);
}
for (const id of ['settings', 'btnUndo', 'undoNote', 'btnReloadPlugins', 'btnApplyRules', 'btnResetRules', 'doctorTable', 'weightsTable', 'hardRules', 'profileBuilder', 'rulesJson', 'pluginsInfo']) element('#' + id);
let doctorRows = [], countInputs = [], countKeeps = [];
globalThis.window = globalThis;
globalThis.location = { pathname: '/synthetic/saved-count.html', protocol: 'file:', href: 'file:///synthetic/saved-count.html' };
globalThis.localStorage = { getItem: k => storage.get(k) || null, setItem: (k, v) => storage.set(k, v), removeItem: k => storage.delete(k) };
globalThis.document = {
  querySelector: sel => elems.get(sel) || null,
  querySelectorAll(sel) {
    if (sel === '#doctorTable tr[data-i]') return doctorRows;
    if (sel === '#shiftTbl input[data-count]') return countInputs;
    if (sel === '#shiftTbl [data-countkeep]') return countKeeps;
    return [];
  }, addEventListener() {}
};
globalThis.alert = message => { throw new Error('Unexpected alert: ' + message); };
globalThis.confirm = () => { throw new Error('Unexpected confirmation'); };
globalThis.T = {};
const load = f => vm.runInThisContext(fs.readFileSync(path.join(root, 'src', f), 'utf8'), { filename: f });
for (const f of ['i18n.js', 'rules-core.js', 'model.js', 'messages.js', 'solver.js', 'check.js', 'plugins.js', 'app-core.js', 'app-folder.js', 'app-settings.js']) load(f);
for (const dir of ['rules', 'calendars']) for (const f of fs.readdirSync(path.join(root, 'src', dir)).filter(x => x.endsWith('.js')).sort()) load(`${dir}/${f}`);
for (const f of fs.readdirSync(path.join(root, 'lang'))) T.registerLang(JSON.parse(fs.readFileSync(path.join(root, 'lang', f), 'utf8')));
T.setLang('en');
T.DEFAULT_RULES = JSON.parse(fs.readFileSync(path.join(root, 'data/rules.json'), 'utf8'));
const A = T.app;
A.renderHeader = A.renderSettingsMonth = A.renderDoctor = A.showTab = () => {};
A.toast = () => {};
A.choose = async () => { throw new Error('Unexpected save/discard prompt'); };
A.readAll = () => A.readSettings(); // Real settings readback; unrelated panels are absent.
A.renderAll = () => A.renderSettings();
let downloaded;
A.download = (name, blob) => { downloaded = { name, blob }; };

// Derive the count controls from the real rendered HTML, rather than manufacturing
// the regression's {day:1,night:1} object in the test. Unrelated UI rows are minimal.
function readRenderedControls() {
  doctorRows = A.state.rules.doctors.map((d, i) => {
    const fields = Object.fromEntries(Object.entries({ name: d.name, team: d.team, years: String(d.years || 0), quota: String(d.quota || 0), duty: d.duty || '' }).map(([k, value]) => [k, { value }]));
    return { dataset: { i: String(i) }, querySelector(sel) {
      const m = sel.match(/^\[data-f="(.+)"\]$/); return m ? fields[m[1]] || null : null;
    } };
  });
  const html = element('#profileBuilder').innerHTML;
  countInputs = [...html.matchAll(/<input\b[^>]*\bdata-count="([^"]+)"[^>]*>/g)].map(m => {
    const value = m[0].match(/\bvalue="([^"]*)"/);
    assert.ok(value, 'rendered count input has a value');
    return { dataset: { count: m[1] }, value: value[1] };
  });
  countKeeps = [...html.matchAll(/data-countkeep="(count:[^"]+)"/g)].map(m => ({ dataset: { countkeep: m[1] } }));
  assert.equal(countInputs.length + countKeeps.length, 2, 'rendered default day/night controls');
}
function settingsChange() {
  readRenderedControls();
  const target = { dataset: {}, closest: sel => sel.includes('#profileBuilder') ? element('#profileBuilder') : null };
  for (const handler of element('#settings').handlers.change) handler({ target });
  readRenderedControls();
}
function putFixture(x) {
  Object.assign(A.state, { rules: clone(x.rules), month: clone(x.month), result: { asg: clone(x.asg), status: 'Optimal' }, meta: null, base: null, baseRules: null, renames: [], ui: {} });
  A.ensureMonth(A.state.month); A.clearUndo(); A.renderSettings(); readRenderedControls();
}
const pythonScript = `import copy, hashlib, json, sys, tempfile
from pathlib import Path
from types import SimpleNamespace
sys.path.insert(0, sys.argv[1])
from toban import load, build_and_solve, check, split_fixed_warnings
raw = sys.stdin.read()
x = json.loads(raw)
before = copy.deepcopy(x)
with tempfile.TemporaryDirectory(prefix='toban-saved-count-') as tmp:
 saved = Path(tmp) / 'saved.json'
 saved.write_bytes(raw.encode())
 p = load(SimpleNamespace(rules=None, month=str(saved)))
hard, fixed = split_fixed_warnings(p, check(p, x['result']['asg'])[0])
status, asg, objective = build_and_solve(p, pin=x['result']['asg'], time_limit=10)
assert x == before, 'Python mutated the saved input'
print(json.dumps({'status': status, 'hard': len(hard), 'fixed': len(fixed), 'objective': objective,
                  'sha256': hashlib.sha256(raw.encode()).hexdigest()}))
`;
function pythonResult(savedJSON) {
  const result = JSON.parse(execFileSync(python, ['-c', pythonScript, toolsRoot], { input: savedJSON, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 }));
  assert.equal(result.sha256, require('crypto').createHash('sha256').update(savedJSON).digest('hex'), 'Python read the exact saved JSON bytes');
  delete result.sha256; return result;
}
function jsResult(savedJSON, highs) {
  const x = JSON.parse(savedJSON), before = JSON.stringify(x), P = new T.Problem(x.rules, x.month);
  const c = T.check(P, x.result.asg), r = T.solve(P, highs, { pin: x.result.asg, timeLimit: 10, mipGap: 0 });
  const got = { status: r.status.toUpperCase(), hard: c.V.length, fixed: c.WC.length, objective: Number.isFinite(r.objective) ? r.objective : null };
  if (got.status === 'OPTIMAL') assert.equal(T.penalty(P, x.result.asg).total, r.objective, 'independent JS penalty');
  assert.equal(JSON.stringify(x), before, 'JS solver/checker did not mutate saved input');
  return got;
}
function lp(savedJSON) {
  const x = JSON.parse(savedJSON); return T.buildLP(new T.Problem(x.rules, x.month)).lp.toLP();
}
function withCount(savedJSON, count) {
  const x = JSON.parse(savedJSON), work = x.rules.profile.positions.work;
  if (count === undefined) delete work.count; else work.count = clone(count);
  return JSON.stringify(x);
}

(async () => {
  const highs = await require(process.argv[2] || 'highs')();
  const fixture = JSON.parse(execFileSync(python, ['-c', "import json,sys; sys.path.insert(0,sys.argv[1]); from test_friday_night_off import cases; print(json.dumps(cases()[0]))", toolsRoot], { encoding: 'utf8' }));
  putFixture(fixture); A.bindSettings();
  assert.equal(A.state.rules.profile?.positions?.work?.count, undefined, 'fictional input starts with implicit one-person counts');
  settingsChange();
  assert.deepEqual(A.state.rules.profile.positions.work.count, { day: 1, night: 1 }, 'real settings handler produces the saved object count');
  settingsChange(); // Repeated/unrelated settings readback must remain stable.
  const count = clone(A.state.rules.profile.positions.work.count);
  const exported = A.profileForExport(true);
  assert.deepEqual(exported.rules.profile.positions.work.count, count, 'real profile export keeps the count map');
  assert.equal(exported.rules.toban_profile.roster, 'included');
  A.downloadMonthJson();
  assert.equal(downloaded.name, '202612_data.json');
  const savedJSON = await downloaded.blob.text(); // Never edit this exported payload.
  const saved = JSON.parse(savedJSON);
  assert.deepEqual(saved.rules.profile.positions.work.count, count);
  assert.equal(A.isDirty(), false, 'download marked this exact state saved');
  assert.deepEqual(A.load().rules.profile.positions.work.count, count, 'real browser-state save/load retains map');
  await A.loadJsonFile({ text: async () => savedJSON });
  assert.deepEqual(A.state.rules.profile.positions.work.count, count, 'real loadJsonFile/applyLoaded readback retains the map');
  assert.deepEqual(A.state.result.asg, fixture.asg, 'JSON readback retains the fictional assignment');
  console.log('OK real rendered count controls, repeated settings handlers, profile export, JSON download and readback (DOM/storage/download substitutes)');

  const expected = { status: 'OPTIMAL', hard: 0, fixed: 0, objective: 0 };
  const exactPy = pythonResult(savedJSON), exactJs = jsResult(savedJSON, highs);
  assert.deepEqual(exactPy, expected); assert.deepEqual(exactJs, expected);
  // Exercise the advertised CLI saved-wrapper path too. Only temporary fictional
  // files are written; savedJSON itself is copied byte-for-byte and never repaired.
  const tmp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'toban-saved-count-cli-'));
  try {
    const savedFile = path.join(tmp, 'saved.json'), assignmentFile = path.join(tmp, 'assignment.json');
    fs.writeFileSync(savedFile, savedJSON); fs.writeFileSync(assignmentFile, JSON.stringify(saved.result.asg));
    const cli = args => execFileSync(python, [path.join(toolsRoot, 'toban.py'), ...args], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
    assert.match(cli(['check', savedFile, '--json', assignmentFile]), /必須条件の違反 0 件/);
    assert.match(cli(['score', savedFile, '--json', assignmentFile, '--time', '10']), /状態 OPTIMAL、減点の合計 0(?:\.0)?(?:\n|$)/);
    assert.match(cli(['solve', savedFile, '--time', '10']), /状態 OPTIMAL、目的関数 0(?:\.0)?、必須条件の違反 0 件/);
    const solved = JSON.parse(fs.readFileSync(path.join(tmp, '202612_py_assignment.json'), 'utf8'));
    const P = new T.Problem(clone(saved.rules), clone(saved.month));
    assert.deepEqual(T.check(P, solved).V, [], 'JS independently checks the real Python CLI solution');
    assert.equal(T.penalty(P, solved).total, 0, 'JS independently scores the real Python CLI solution');
    assert.equal(fs.readFileSync(savedFile, 'utf8'), savedJSON, 'CLI did not rewrite the saved file');
    console.log('OK exact UI-exported saved JSON: real Python load/check/score/solve CLI, plus JS validation of its solution');
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  const baselineLP = lp(withCount(savedJSON, undefined));
  assert.equal(lp(savedJSON), baselineLP, 'unmodified UI-saved map LP is byte-identical to default');
  for (const [label, value] of [
    ['omitted', undefined], ['scalar one', 1], ['null/default', null], ['empty/default map', {}],
    ['partial day', { day: 1 }], ['partial night', { night: 1 }], ['day/night map', { day: 1, night: 1 }],
    ['day-type map', { weekday: 1, off_days: 1 }],
    ['nested day types', { day: { off_days: 1 }, night: { weekday: 1, off_days: 1 } }],
    ['nested null/default', { day: null, night: { weekday: null, off_days: 1 } }]
  ]) {
    // Comparison variants only: the real UI-exported savedJSON above stays intact.
    Object.assign(A.state, JSON.parse(withCount(savedJSON, value)));
    const variant = A.payloadJson(saved.saved_at);
    assert.deepEqual(pythonResult(variant), exactPy, label + ': Python parity');
    assert.deepEqual(jsResult(variant, highs), exactJs, label + ': JS parity');
    assert.equal(lp(variant), baselineLP, label + ': byte-identical JS LP');
    console.log('OK saved JSON Python/JS solver-checker parity and byte-identical LP: ' + label);
  }

  // The app's export must preserve types; the frozen Python profile must not
  // silently claim that strings, booleans, arrays or non-one capacities work.
  const rejectionScript = `import json,sys\nsys.path.insert(0,sys.argv[1])\nfrom toban import Problem\nx=json.load(sys.stdin)\ntry:\n Problem(x['rules'],x['month'])\nexcept SystemExit as e:\n assert 'profile.positions.work.count' in str(e), str(e)\n print('rejected')\nelse:\n raise AssertionError('unsupported saved count was accepted')\n`;
  const rejected = [0, 2, 1.5, '1', true, [], { night: 2 }, { night: '1' }, { day: false }, { unknown: 1 }, { day: 1, night: { weekday: 1, off_days: 2 } }];
  for (const value of rejected) {
    Object.assign(A.state, JSON.parse(withCount(savedJSON, value)));
    const before = JSON.stringify(A.state.rules), profile = A.profileForExport(true);
    assert.deepEqual(profile.rules.profile.positions.work.count, value, 'profile export preserves unsupported count types');
    const payload = A.payloadJson(saved.saved_at);
    assert.deepEqual(JSON.parse(payload).rules.profile.positions.work.count, value, 'save serialization preserves unsupported count types');
    assert.equal(JSON.stringify(A.state.rules), before, 'export does not repair/mutate unsupported data');
    assert.equal(execFileSync(python, ['-c', rejectionScript, toolsRoot], { input: payload, encoding: 'utf8' }).trim(), 'rejected');
  }
  console.log(`OK ${rejected.length} unsupported exported count types preserved and rejected by Python`);
  console.log('PASS saved count-map UI roundtrip and Python/JS compatibility');
})().catch(e => { console.error(e); process.exitCode = 1; });

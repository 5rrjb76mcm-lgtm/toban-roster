// Weekend work cap settings: synthetic data, export/privacy, readback, Undo, Python gate.
// node test_dayoff_work_settings_node.js [python executable]
const fs = require("fs"), vm = require("vm"), path = require("path"), assert = require("assert");
globalThis.location = { pathname: "/x/toban.html", protocol: "file:", href: "file:///x/toban.html" };
globalThis.document = { querySelector: () => null, querySelectorAll: () => [], addEventListener: () => { } }; globalThis.window = globalThis;
globalThis.localStorage = { getItem: () => null, setItem: () => { }, removeItem: () => { } };
globalThis.T = {};
for (const f of ["i18n.js", "rules-core.js", "model.js", "messages.js", "solver.js", "check.js", "app-core.js", "app-folder.js", "app-settings.js", "app-month.js"]) vm.runInThisContext(fs.readFileSync(path.join(__dirname, "src", f), "utf8"), { filename: f });
for (const f of fs.readdirSync(path.join(__dirname, "src/rules")).filter(x => x.endsWith(".js"))) vm.runInThisContext(fs.readFileSync(path.join(__dirname, "src/rules", f), "utf8"), { filename: "rules/" + f });
for (const q of fs.readdirSync(path.join(__dirname, "lang"))) T.registerLang(JSON.parse(fs.readFileSync(path.join(__dirname, "lang", q), "utf8")));
T.setLang("ja");
const A = T.app;
const rules = JSON.parse(fs.readFileSync(path.join(__dirname, "data/rules.json"), "utf8"));
T.DEFAULT_RULES = JSON.parse(JSON.stringify(rules));

const clone = x => JSON.parse(JSON.stringify(x));
for (const state of ['soft','off']) {
 const r=clone(rules), n=r.doctors[0].name; r.dayoff_work_max={[n]:0,'Former Synthetic Staff':2}; T.fillDefaultRules(r); r.rule_states.dayoff_work_cap=state;
 Object.assign(A.state,{rules:r,month:{year:2026,month:11},result:null});
 const before=JSON.stringify(r);
 assert.deepStrictEqual(A.profileForExport(false).rules.dayoff_work_max,{});
 assert.deepStrictEqual(A.profileForExport(true).rules.dayoff_work_max,r.dayoff_work_max);
 assert.strictEqual(JSON.stringify(r),before);
 const r2=clone(r); T.purgeRulesNames(r2,[n]); assert.deepStrictEqual(r2.dayoff_work_max,{'Former Synthetic Staff':2});
 const r3=clone(r); T.pruneRosterRefs(r3); assert.deepStrictEqual(r3.dayoff_work_max,{[n]:0});
 const col=T.rules.columnsAll(r).find(c=>c.key==='dwm'); col.rename(r3,n,'Renamed Synthetic'); assert.deepStrictEqual(r3.dayoff_work_max,{'Renamed Synthetic':0});
}
console.log('PASS weekend-cap soft/off export, included export, no mutation, remove, prune, rename');

// Imported malformed data must never retain personal records in an anonymous export.
// In particular, former staff names cannot be caught by scanning the current roster.
const former = "Former Synthetic Staff Private Record";
for (const state of ["soft", "off"]) {
  const cases = [former, [former], [{ note: former }], { unrelated: { note: former } },
    { [rules.doctors[0].name]: { note: former } }, null, 7];
  for (const value of cases) {
    const r = clone(rules); T.fillDefaultRules(r);
    r.rule_states.dayoff_work_cap = state; r.dayoff_work_max = clone(value);
    Object.assign(A.state, { rules: r, month: { year: 2026, month: 11 }, result: null });
    const before = JSON.stringify(r), exported = A.profileForExport(false);
    assert.deepStrictEqual(exported.rules.dayoff_work_max, {}, `anonymous ${state} export clears ${JSON.stringify(value)}`);
    assert.ok(!JSON.stringify(exported.rules).includes(former), "former staff record must not leak");
    assert.deepStrictEqual(exported.leftover, []);
    assert.deepStrictEqual(A.profileForExport(true).rules.dayoff_work_max, value, "with-roster export retains the original value");
    assert.strictEqual(JSON.stringify(r), before, "export must not change original imported data");
  }
}
console.log("PASS malformed cap export 14 cases: scalar, array, nested values, null and number; soft/off");

for (const state of ['soft','off']) {
 const r=clone(rules), n=r.doctors[0].name; T.fillDefaultRules(r); r.dayoff_work_max={[n]:'bad value'}; r.rule_states.dayoff_work_cap=state;
 Object.assign(A.state,{rules:r,month:T.normalizeMonth({year:2026,month:11},r),result:null,base:null});
 const rows=r.doctors.map((d,i)=>{const vals={name:i===0?'Renamed Synthetic':d.name,team:d.team,years:String(d.years||0),quota:String(d.quota||0),duty:d.duty||''}; return {dataset:{i:String(i)},querySelector(sel){const f=(sel.match(/data-f="([^"]+)"/)||[])[1];if(f)return f in vals?{value:vals[f]}:null;if(sel==='[data-col="dwm"]'&&state==='soft')return {querySelector(){return {value:i===0?'bad value':''}}};return null;}}});
 document.querySelectorAll=s=>s==='#doctorTable tr[data-i]'?rows:[]; A.renderHeader=()=>{}; A.toast=()=>{};
 A.readSettings(); assert.deepStrictEqual(r.dayoff_work_max,{'Renamed Synthetic':'bad value'});
}
console.log('PASS real settings readback rename preserves invalid value soft/off');

(async () => {
  // Real Undo API: a settings edit followed by a monthly edit must unwind in order.
  document.querySelectorAll = () => [];
  A.save = () => {}; A.renderAll = () => {}; A.renderSettings = () => {};
  const r = clone(rules), name = r.doctors[0].name;
  T.fillDefaultRules(r); r.dayoff_work_max = { [name]: 1 };
  Object.assign(A.state, { rules: r, month: T.normalizeMonth({ year: 2026, month: 11 }, r), result: null, renames: [], base: null, baseRules: null });
  A.clearUndo();
  A.pushUndo("Synthetic cap change"); A.state.rules.dayoff_work_max[name] = 0;
  await Promise.resolve();
  const monthBefore = clone(A.state.month);
  A.pushUndo("Synthetic monthly target", { auto: true }); A.state.month.targets[name] = 2.5;
  await Promise.resolve();
  A.undo(); assert.deepStrictEqual(A.state.month, monthBefore); assert.strictEqual(A.state.rules.dayoff_work_max[name], 0);
  A.undo(); assert.strictEqual(A.state.rules.dayoff_work_max[name], 1); assert.deepStrictEqual(A.state.month, monthBefore);
  console.log("PASS mixed settings/month Undo retains cap and month order");

  const python = process.argv[2];
  if (!python) { console.log("SKIP Python gate: provide Python executable as first argument"); return; }
  const script = `import sys,json,copy
sys.path.insert(0,sys.argv[1])
import toban
payload=json.load(sys.stdin)
r,m=payload['rules'],payload['month']
for state in [None,'soft','off']:
 for caps in [{},{r['doctors'][0]['name']:0},{r['doctors'][0]['name']:''}]:
  rr=copy.deepcopy(r); rr['dayoff_work_max']=caps
  rr.setdefault('rule_states',{}).pop('dayoff_work_cap',None)
  if state: rr['rule_states']['dayoff_work_cap']=state
  try: toban.Problem(rr,m); blocked=False
  except SystemExit as e:
   blocked=True
   assert 'dayoff_work_cap' in str(e), str(e)
  assert blocked == (bool(caps) and state!='off'), (state,caps,blocked)
print('PASS Python gating 9 cases: absent/soft/off state and empty/zero/blank caps')
`;
  const { spawnSync } = require("child_process");
  const ret = spawnSync(python, ["-c", script, path.resolve(__dirname, "../tools")], { encoding: "utf8", input: JSON.stringify({ rules, month: JSON.parse(fs.readFileSync(path.join(__dirname, "data/202611.json"), "utf8")) }) });
  if (ret.error && ret.error.code === "ENOENT") { console.log("SKIP Python gate: executable unavailable"); return; }
  assert.ifError(ret.error); assert.strictEqual(ret.status, 0, ret.stderr || ret.stdout); process.stdout.write(ret.stdout);
})().catch(e => { console.error(e); process.exitCode = 1; });

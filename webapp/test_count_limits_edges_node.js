// Per-person count limits: preserve input through UI reads/merges and match Python's numeric contract.
// Synthetic data only. Usage: node test_count_limits_edges_node.js [path/to/python]
const fs = require("fs"), vm = require("vm"), path = require("path"), assert = require("assert"), cp = require("child_process");
globalThis.T = {};
const run = f => vm.runInThisContext(fs.readFileSync(path.join(__dirname, "src", f), "utf8"), { filename: f });
for (const f of ["i18n.js", "rules-core.js", "model.js", "messages.js", "merge.js"]) run(f);
for (const f of fs.readdirSync(path.join(__dirname, "src/rules")).filter(f => f.endsWith(".js"))) run("rules/" + f);
const names = ["Synthetic A", "Synthetic B"], clone = x => JSON.parse(JSON.stringify(x));
function fixture(quota = 14) {
  const rules = { doctors: names.map(name => ({ name, team: "S", quota })), quota_tolerance: 1,
    profile: { roles: [{ id: "S", label: "Staff", refs: [] }], shifts: [{ id: "day", on: "none" }, { id: "night", on: "all" }] } };
  T.fillDefaultRules(rules); for (const def of T.RULE_DEFS) if (def.states.includes("off")) rules.rule_states[def.id] = "off";
  rules.rule_states.quota_range = "hard";
  return { rules, month: T.normalizeMonth({ year: 2026, month: 11 }, rules) };
}
let fields = [], state = fixture();
const root = { children: [{}], dataset: { names: names.join("|") }, querySelector: () => null,
  querySelectorAll: selector => fields.filter(el => Object.keys(el.dataset).some(k => selector === `[data-${k}]`)) };
globalThis.document = { querySelector: () => root };
T.app = { state, names: () => names, save() { } }; run("app-input.js");
let passed = 0, failed = 0;
const renderedLimits = [];
function test(label, fn) { try { fn(); passed++; console.log("ok " + label); } catch (e) { failed++; console.error("FAIL " + label + ": " + e.message); } }
test("UI retains negative/fractional limits so model validation rejects rather than rounding", () => {
  for (const [attr, key] of [["cmin", "count_min"], ["cmax", "count_max"]]) for (const value of ["-1", "1.5"]) {
    Object.assign(state, fixture()); fields = [{ dataset: { [attr]: names[0] }, value }];
    T.app.readSettingsMonth(); assert.strictEqual(state.month[key][names[0]], +value);
    assert.throws(() => new T.Problem(state.rules, state.month), new RegExp(key));
    fields[0].value = "0"; T.app.readSettingsMonth(); assert.strictEqual(state.month[key][names[0]], 0);
    assert.doesNotThrow(() => new T.Problem(state.rules, state.month));
  }
});
test("empty visible values clear only that person; hidden/off limits survive reads", () => {
  Object.assign(state, fixture()); state.month.count_min = { [names[0]]: 0, [names[1]]: 2 };
  state.month.count_max = { [names[0]]: 5, [names[1]]: 7 };
  fields = [{ dataset: { cmin: names[0] }, value: "" }, { dataset: { cmax: names[0] }, value: "0" }]; T.app.readSettingsMonth();
  assert.deepStrictEqual(state.month.count_min, { [names[1]]: 2 }); assert.deepStrictEqual(state.month.count_max, { [names[0]]: 0, [names[1]]: 7 });
  state.rules.rule_states.quota_range = "off"; fields = []; const before = clone(state.month); T.app.readSettingsMonth();
  assert.deepStrictEqual(state.month.count_min, before.count_min); assert.deepStrictEqual(state.month.count_max, before.count_max);
});
test("imported invalid limit text stays inside the input value attribute", () => {
  Object.assign(T.app, { ensureMonth: m => T.normalizeMonth(m, state.rules), workNames: () => names,
    daysIn: (y, m) => new Date(y, m, 0).getDate(), dowOf: (y, m, d) => (new Date(y, m - 1, d).getDay() + 6) % 7, nameSel: () => "<select></select>" });
  for (const [attr, key] of [["cmin", "count_min"], ["cmax", "count_max"]]) {
    Object.assign(state, fixture());
    const value = '0"><input id="synthetic-count-marker" onfocus="window.__countInjected=1" value="0';
    state.month[key] = { [names[0]]: value };
    T.normalizeMonth(state.month, state.rules); assert.throws(() => new T.Problem(state.rules, state.month), new RegExp(key));
    T.app.renderSettingsMonth(); renderedLimits.push({ html: root.innerHTML, attr, value });
    assert(!root.innerHTML.includes('<input id="synthetic-count-marker"'), "the imported count does not create another input");
    assert(root.innerHTML.includes(`data-${attr}="${names[0]}" value="${T.esc(value)}"`), "literal input value is escaped");
  }
});
test("auto adjustment never proposes a changed target outside either limit and keeps inputs intact", () => {
  for (const [quota, min, max] of [[14, 18, 20], [16, 10, 12]]) {
    const { rules, month } = fixture(quota); month.count_min = { [names[0]]: min }; month.count_max = { [names[0]]: max };
    const before = JSON.stringify(month), at = T.autoTargets(rules, month);
    assert.strictEqual(at.targets[names[0]], undefined, "do not create an out-of-range proposal or clamp the original target");
    assert.strictEqual(at.targets[names[1]], 15, "other eligible person's one-step adjustment is preserved");
    assert(at.lines.some(s => s.includes("調整しきれません")), "the remaining shortfall is still explained");
    assert.strictEqual(JSON.stringify(month), before);
  }
  const { rules, month } = fixture(); assert.deepStrictEqual(T.autoTargets(rules, month).targets, { [names[0]]: 15, [names[1]]: 15 }, "no limits retains the existing distribution");
});
test("target and limits keep complete colon-containing names through roundtrip and three-way merge", () => {
  const n = "Synthetic:A", { month } = fixture(); month.targets = { [n]: 3, Synthetic: 8 }; month.count_min = { [n]: 0 }; month.count_max = { [n]: 5 };
  const back = T.unflattenMonth(T.flattenMonth(month), month);
  for (const key of ["targets", "count_min", "count_max"]) assert.deepStrictEqual(back[key], month[key]);
  const mine = clone(month), theirs = clone(month); mine.targets[n] = 4; theirs.count_max[n] = 6;
  const merged = T.mergeMonth(month, mine, theirs); assert.strictEqual(merged.conflicts.length, 0); assert.deepStrictEqual(merged.merged.targets, mine.targets); assert.deepStrictEqual(merged.merged.count_max, theirs.count_max);
  theirs.targets[n] = 5; const conflict = T.mergeMonth(month, mine, theirs).conflicts.find(c => c.key === `target:${n}`);
  assert(conflict && conflict.label.includes(n), "conflict identifies the complete person name");
});
if (process.argv[2]) test("Python and JS accept the same nonnegative integer count values without truncation", () => {
  const rules = JSON.parse(fs.readFileSync(path.join(__dirname, "data/rules.json"), "utf8"));
  const month = JSON.parse(fs.readFileSync(path.join(__dirname, "data/202611.json"), "utf8"));
  const who = rules.doctors[0].name, values = [0, 2, 2.0, "2", "2.0", " 2 ", "2e0", "0x2", "0o2", "0b10", "", null, -1, 1.5, "1.5", true, false, [], {}, "bad", " ", "Infinity", "1e309", "\ufeff2", "2\ufeff", "\u001c2", "\u00852"];
  const js = values.map(v => { const m = clone(month); m.count_min = { [who]: v }; try { const P = new T.Problem(rules, m); return { valid: true, value: P.countMin[who] ?? null }; } catch (e) { return { valid: false }; } });
  const py = cp.spawnSync(process.argv[2], ["-c", `import sys,json,copy\nsys.path.insert(0,sys.argv[1])\nfrom toban import Problem\np=json.load(sys.stdin);out=[]\nfor value in p['values']:\n m=copy.deepcopy(p['month']);m['count_min']={p['who']:value}\n try:\n  x=Problem(copy.deepcopy(p['rules']),m);out.append({'valid':True,'value':x.count_min.get(p['who'])})\n except (ValueError,TypeError,OverflowError): out.append({'valid':False})\nprint(json.dumps(out))`, path.join(__dirname, "../tools")],
    { input: JSON.stringify({ rules, month, who, values }), encoding: "utf8", env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" } });
  assert.strictEqual(py.status, 0, py.stderr); const actual = JSON.parse(py.stdout);
  for (let i = 0; i < values.length; i++) assert.deepStrictEqual(actual[i], js[i], "value " + JSON.stringify(values[i]));
}); else console.log("SKIP Python parity (pass path/to/python)");
(async () => {
  let chromium;
  if (!process.argv.includes("--no-browser")) {
    try { ({ chromium } = require("playwright")); } catch (e) {
      try { ({ chromium } = require(path.join(process.env.HOME, ".toban-test/node_modules/playwright"))); } catch (e2) { }
    }
  }
  if (chromium && fs.existsSync("/Applications/Google Chrome.app")) {
    try {
      const browser = await chromium.launch({ channel: "chrome", headless: true });
      try {
        const context = await browser.newContext(), requests = [], errors = [];
        await context.route(/^https?:/, r => { requests.push(r.request().url()); return r.abort(); });
        const page = await context.newPage(); page.on("pageerror", e => errors.push(e.message));
        assert.strictEqual(renderedLimits.length, 2, "both limit fields are exercised");
        for (const { html, attr, value } of renderedLimits) {
          await page.setContent(html);
          const result = await page.evaluate(attr => {
            document.querySelector("#synthetic-count-marker")?.focus();
            return { marker: !!document.querySelector("#synthetic-count-marker"), executed: !!window.__countInjected,
              value: document.querySelector(`[data-${attr}]`).getAttribute("value") };
          }, attr);
          assert.deepStrictEqual(result, { marker: false, executed: false, value });
        }
        assert.deepStrictEqual(errors, []); assert.deepStrictEqual(requests, []);
        passed++; console.log("ok browser count values: no injected element/event; pageErrors=0 externalRequests=0");
      } finally { await browser.close(); }
    } catch (e) { failed++; console.error("FAIL browser count values: " + e.message); }
  } else console.log("SKIP count DOM browser check (Playwright/Google Chrome unavailable or --no-browser)");
  console.log(`${passed} passed, ${failed} failed`); if (failed) process.exitCode = 1;
})().catch(e => { console.error(e.message); process.exitCode = 1; });

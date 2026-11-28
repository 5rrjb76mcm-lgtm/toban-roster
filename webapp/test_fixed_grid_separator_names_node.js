// Fixed grid, multi-worker fields: a staff name that contains a list separator (・ 、 , |) stays one person when the field is edited.
// Synthetic data only. The real fixed-grid markup is rendered and parsed with Python's HTMLParser; only DOM selection/events are
// substituted (same harness as test_fixed_condition_readback_node.js). No browser is launched; this is not a real-browser test.
// TOBAN_UI_INPUT_SOURCE=/path/to/other/app-input.js swaps the file under test (the clean base is expected to fail the non-control cases).
const fs = require("fs"), path = require("path"), vm = require("vm"), assert = require("assert"), { execFileSync } = require("child_process");
const EXPECTED_CASES = 25;
const elements = new Map();
globalThis.document = { querySelector: s => elements.get(s) || null, querySelectorAll: () => [] };
globalThis.location = { pathname: "/synthetic/fixed-grid-separator-names.html" };
globalThis.localStorage = { getItem: () => null, setItem() {} };
globalThis.T = {};
for (const f of ["i18n.js", "rules-core.js", "model.js", "messages.js", "check.js", "app-core.js", "app-input.js"])
  vm.runInThisContext(fs.readFileSync(f === "app-input.js" && process.env.TOBAN_UI_INPUT_SOURCE || path.join(__dirname, "src", f), "utf8"), { filename: f });
for (const f of fs.readdirSync(path.join(__dirname, "src/rules")).filter(f => f.endsWith(".js")).sort())
  vm.runInThisContext(fs.readFileSync(path.join(__dirname, "src/rules", f), "utf8"), { filename: "rules/" + f });
const A = T.app, clone = x => JSON.parse(JSON.stringify(x));
A.save = () => {}; A.toast = () => {};
let passed = 0, failed = 0;
const test = (label, fn) => { try { fn(); passed++; console.log("ok " + label); } catch (e) { failed++; console.error("FAIL " + label + ": " + e.message); } };
const parseControls = html => JSON.parse(execFileSync("python3", ["-c", `import json,sys
from html.parser import HTMLParser
class Controls(HTMLParser):
 def __init__(self): super().__init__(); self.controls=[]; self.select=None
 def handle_starttag(self,tag,attrs):
  a=dict(attrs)
  if tag=='input': self.controls.append({'attrs':a,'value':a.get('value',''),'checked':'checked' in a})
  if tag=='select': self.select={'attrs':a,'options':[]}; self.controls.append(self.select)
  if tag=='option' and self.select is not None: self.select['options'].append(a)
 def handle_endtag(self,tag):
  if tag=='select': self.select=None
p=Controls(); p.feed(sys.stdin.read()); print(json.dumps(p.controls))`], { input: html, encoding: "utf8" }));
const datasetOf = attrs => Object.fromEntries(Object.entries(attrs).filter(([k]) => k.startsWith("data-")).map(([k, v]) => [k.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase()), v]));
const pending = []; globalThis.setTimeout = fn => { pending.push(fn); return pending.length; };
function pane() {
  return { children: [{}], dataset: {}, controls: [], handlers: {}, addEventListener(k, fn) { this.handlers[k] = fn; },
    querySelectorAll(s) { return this.controls.filter(c => s.split(',').some(sel => {
      const tag = sel.match(/^(select|input)/); if (tag && c.tag !== tag[1]) return false;
      return [...sel.matchAll(/\[([^=\]]+)(?:="([^"]*)")?\]/g)].every(([, a, v]) => c.attrs[a] !== undefined && (v === undefined || c.attrs[a] === v));
    })); }, querySelector(s) { return this.querySelectorAll(s)[0] || null; },
    set innerHTML(html) { this.html = html; this.controls = parseControls(html).map(c => {
      const opts = c.options, value = opts ? (opts.find(o => Object.hasOwn(o, "selected")) || opts[0] || {}).value || "" : c.value;
      const el = { attrs: c.attrs, tag: opts ? 'select' : 'input', dataset: datasetOf(c.attrs), id: c.attrs.id || "", type: c.attrs.type || (opts ? "select-one" : "text"), value, checked: !!c.checked, options: opts || [], hasAttribute(a) { return Object.hasOwn(this.attrs, a); } };
      if (el.id) elements.set("#" + el.id, el); return el;
    }); }, get innerHTML() { return this.html; } };
}
// A multi-worker facility (2 per slot, both shifts every day). The roster is given per case; every name is fictional.
function setup(fixed, roster, tags = {}) {
  pending.length = 0; elements.clear();
  const R = { profile: { id: "synthetic-fixed-separator", roles: [{ id: "S", label: "Staff", refs: [] }], shifts: [{ id: "day", on: "all" }, { id: "night", on: "all" }], positions: { work: { count: 2 } } }, doctors: roster.map(name => ({ name, team: "S", quota: 30 })), rule_states: {}, weights: {} };
  T.fillDefaultRules(R); for (const def of T.RULE_DEFS) if (def.states.includes("off")) R.rule_states[def.id] = "off";
  const M = T.normalizeMonth({ year: 2026, month: 11, fixed, fixed_tags: tags }, R);
  Object.assign(A.state, { rules: R, month: M, ui: { doctor: 0 }, result: null });
  const grid = pane(); elements.set('#fixedPane', grid);
  A.bindFixed(); A.renderFixed();
  const change = (sel, value) => { const el = grid.querySelector(sel); assert.ok(el, sel); el.value = value; grid.handlers.change({ target: el }); while (pending.length) pending.shift()(); };
  return { R, M, grid, change };
}
const fx = (d, k) => `input[data-fx="${k}"][data-d="${d}"]`;
const shown = (grid, d, k) => grid.querySelector(fx(d, k)).value;
const SEPS = [["middle dot", "・"], ["ideographic comma", "、"], ["comma", ","], ["vertical bar", "|"]];
const OTHER = "Synthetic Other", THIRD = "Synthetic Third";

// 1) each separator: adding a third worker to a field that already holds the delimited name keeps that name whole
for (const [label, sep] of SEPS) test(`adding a worker keeps a name containing ${label} (${sep}) whole`, () => {
  const name = `Synthetic Two${sep}Parts`;
  const { M, grid, change } = setup({ day: { 5: [name, OTHER] } }, [name, OTHER, THIRD]);
  assert.strictEqual(shown(grid, 5, "day"), `${name}・${OTHER}`);
  change(fx(5, "day"), `${shown(grid, 5, "day")}・${THIRD}`);
  assert.deepStrictEqual(M.fixed.day[5], [name, OTHER, THIRD]); assert.deepStrictEqual(M.fixed_tags, {});
});
// 2) typing the delimited name alone into an empty field stores one person (a single name is stored as a string)
test("typing the delimited name alone into an empty field stores one person", () => {
  const name = "Synthetic Two・Parts";
  const { M, change } = setup({}, [name, OTHER]);
  change(fx(6, "night"), name);
  assert.strictEqual(M.fixed.night[6], name); assert.deepStrictEqual(M.fixed_tags, {});
});
// 3) remove, reorder, repeat
test("removing another worker keeps the delimited name whole", () => {
  const name = "Synthetic Two・Parts";
  const { M, change } = setup({ night: { 5: [name, OTHER, THIRD] } }, [name, OTHER, THIRD]);
  change(fx(5, "night"), `${name}・${THIRD}`);
  assert.deepStrictEqual(M.fixed.night[5], [name, THIRD]);
});
test("reordering keeps the delimited name whole and follows the typed order", () => {
  const name = "Synthetic Two・Parts";
  const { M, change } = setup({ night: { 5: [name, OTHER] } }, [name, OTHER]);
  change(fx(5, "night"), `${OTHER}・${name}`);
  assert.deepStrictEqual(M.fixed.night[5], [OTHER, name]);
});
test("the delimited name written twice in one field is stored once", () => {
  const name = "Synthetic Two・Parts";
  const { M, change } = setup({}, [name, OTHER]);
  change(fx(5, "day"), `${name}・${name}・${OTHER}`);
  assert.deepStrictEqual(M.fixed.day[5], [name, OTHER]);
});
test("surrounding spaces around the delimited name are dropped like any other name", () => {
  const name = "Synthetic Two・Parts";
  const { M, change } = setup({}, [name, OTHER]);
  change(fx(5, "day"), ` ${name} ・ ${OTHER} `);
  assert.deepStrictEqual(M.fixed.day[5], [name, OTHER]); assert.deepStrictEqual(M.fixed_tags, {});
});
// 4) fixed tags (name(tag)) on a delimited name: stored tag kept, new tag read, full-width parentheses
test("a stored tag on the delimited name survives adding a worker", () => {
  const name = "Synthetic Two・Parts", key = `5:day|${name}`;
  const { M, grid, change } = setup({ day: { 5: [name] } }, [name, OTHER], { [key]: "senior" });
  assert.strictEqual(shown(grid, 5, "day"), `${name}(senior)`);
  change(fx(5, "day"), `${shown(grid, 5, "day")}・${OTHER}`);
  assert.deepStrictEqual(M.fixed.day[5], [name, OTHER]); assert.deepStrictEqual(M.fixed_tags, { [key]: "senior" });
});
test("a new tag typed after the delimited name is read as that person's tag", () => {
  const name = "Synthetic Two・Parts";
  const { M, change } = setup({ day: { 5: [OTHER] } }, [name, OTHER]);
  change(fx(5, "day"), `${name}(review)・${OTHER}`);
  assert.deepStrictEqual(M.fixed.day[5], [name, OTHER]); assert.deepStrictEqual(M.fixed_tags, { [`5:day|${name}`]: "review" });
});
test("a full-width parenthesized tag after the delimited name is read as that person's tag", () => {
  const name = "Synthetic Two、Parts";
  const { M, change } = setup({}, [name, OTHER]);
  change(fx(5, "night"), `${name}（training）・${OTHER}`);
  assert.deepStrictEqual(M.fixed.night[5], [name, OTHER]); assert.deepStrictEqual(M.fixed_tags, { [`5:night|${name}`]: "training" });
});
test("changing the tag of the delimited name replaces it without splitting the name", () => {
  const name = "Synthetic Two・Parts", key = `5:day|${name}`;
  const { M, change } = setup({ day: { 5: [name, OTHER] } }, [name, OTHER], { [key]: "senior" });
  change(fx(5, "day"), `${name}(lead)・${OTHER}`);
  assert.deepStrictEqual(M.fixed.day[5], [name, OTHER]); assert.deepStrictEqual(M.fixed_tags, { [key]: "lead" });
});
// 5) the longest-match rule when the roster holds "A", "B" and "A・B" at the same time
test("longest match: 'A・B' is the person named 'A・B', not A and B", () => {
  const a = "Synthetic A", b = "Synthetic B", ab = `${a}・${b}`;
  const { M, change } = setup({}, [a, b, ab]);
  change(fx(5, "day"), ab);
  assert.strictEqual(M.fixed.day[5], ab);
});
test("longest match: 'A・B・A' is the person 'A・B' followed by A", () => {
  const a = "Synthetic A", b = "Synthetic B", ab = `${a}・${b}`;
  const { M, change } = setup({}, [a, b, ab]);
  change(fx(5, "day"), `${ab}・${a}`);
  assert.deepStrictEqual(M.fixed.day[5], [ab, a]);
});
test("control: 'B・A' stays two people B and A (no candidate starts there)", () => {
  const a = "Synthetic A", b = "Synthetic B", ab = `${a}・${b}`;
  const { M, change } = setup({}, [a, b, ab]);
  change(fx(5, "day"), `${b}・${a}`);
  assert.deepStrictEqual(M.fixed.day[5], [b, a]);
});
test("longest match between two delimited roster names prefers the longer one", () => {
  const pq = "Synthetic P・Q", pqr = "Synthetic P・Q・R";
  const { M, change } = setup({}, [pq, pqr, OTHER]);
  change(fx(5, "night"), `${pqr}・${OTHER}`);
  assert.deepStrictEqual(M.fixed.night[5], [pqr, OTHER]);
  change(fx(6, "night"), `${pq}・${OTHER}`);
  assert.deepStrictEqual(M.fixed.night[6], [pq, OTHER]);
});
// 6) a person who is stored in the field but no longer in the roster (past staff) is kept by the field's own stored spelling
test("a stored delimited name that is no longer in the roster survives adding a worker", () => {
  const former = "Synthetic Former|Staff";
  const { M, grid, change } = setup({ day: { 5: [former, OTHER] } }, [OTHER, THIRD]);
  assert.strictEqual(shown(grid, 5, "day"), `${former}・${OTHER}`);
  change(fx(5, "day"), `${shown(grid, 5, "day")}・${THIRD}`);
  assert.deepStrictEqual(M.fixed.day[5], [former, OTHER, THIRD]);
});
// 7) unchanged behaviour (controls; these pass on the base as well)
test("control: an untouched field is not reinterpreted when another field changes", () => {
  const name = "Synthetic Two・Parts";
  const { M, change } = setup({ day: { 5: [name, OTHER] }, night: { 5: [OTHER] } }, [name, OTHER, THIRD]);
  const before = clone(M.fixed.day[5]);
  change(fx(6, "day"), THIRD); A.readAll(); A.readAll();
  assert.deepStrictEqual(M.fixed.day[5], before); assert.deepStrictEqual(M.fixed.day[6], THIRD);
});
test("control: without delimited names in roster or field, splitting and trimming are unchanged", () => {
  const { M, change } = setup({}, [OTHER, THIRD]);
  change(fx(5, "day"), ` ${OTHER} ・ ${THIRD}(review) `);
  assert.deepStrictEqual(M.fixed.day[5], [OTHER, THIRD]); assert.deepStrictEqual(M.fixed_tags, { [`5:day|${THIRD}`]: "review" });
  change(fx(6, "day"), `${OTHER},${THIRD}|${OTHER}、${THIRD}`);
  assert.deepStrictEqual(M.fixed.day[6], [OTHER, THIRD]);
});
test("control: text that merely starts with a delimited roster name is still split as before", () => {
  const name = "Synthetic Two・Parts";
  const { M, change } = setup({}, [name, OTHER]);
  change(fx(5, "day"), `${name}X・${OTHER}`);
  assert.deepStrictEqual(M.fixed.day[5], ["Synthetic Two", "PartsX", OTHER]);
});
test("control: a plain name that is a prefix of a delimited roster name stays itself", () => {
  const name = "Synthetic Two・Parts", plain = "Synthetic Two";
  const { M, change } = setup({}, [name, plain, OTHER]);
  change(fx(5, "day"), `${plain}・${OTHER}`);
  assert.deepStrictEqual(M.fixed.day[5], [plain, OTHER]);
});
test("control: clearing a field that held the delimited name removes the fixed input and its tag", () => {
  const name = "Synthetic Two・Parts", key = `5:day|${name}`;
  const { M, change } = setup({ day: { 5: [name, OTHER] } }, [name, OTHER], { [key]: "senior" });
  change(fx(5, "day"), "");
  assert.strictEqual(M.fixed.day[5], undefined); assert.deepStrictEqual(M.fixed_tags, {});
});
test("control: the delimited name typed into a single-select field is not affected (no separator parsing there)", () => {
  // In a 1-per-slot facility the fixed grid shows a select; the chosen option value is stored as is.
  pending.length = 0; elements.clear();
  const name = "Synthetic Two・Parts";
  const R = { profile: { id: "synthetic-fixed-separator-single", roles: [{ id: "S", label: "Staff", refs: [] }], shifts: [{ id: "day", on: "all" }, { id: "night", on: "all" }], positions: { work: { count: 1 } } }, doctors: [name, OTHER].map(n => ({ name: n, team: "S", quota: 30 })), rule_states: {}, weights: {} };
  T.fillDefaultRules(R); for (const def of T.RULE_DEFS) if (def.states.includes("off")) R.rule_states[def.id] = "off";
  const M = T.normalizeMonth({ year: 2026, month: 11 }, R); Object.assign(A.state, { rules: R, month: M, ui: { doctor: 0 }, result: null });
  const grid = pane(); elements.set('#fixedPane', grid); A.bindFixed(); A.renderFixed();
  const el = grid.querySelector(`select[data-fx="night"][data-d="5"]`); assert.ok(el); assert.ok(el.options.some(o => o.value === name));
  el.value = name; grid.handlers.change({ target: el }); while (pending.length) pending.shift()();
  assert.strictEqual(M.fixed.night[5], name);
});
test("the input check reports no unknown names after the edits", () => {
  const name = "Synthetic Two・Parts";
  const { R, M, change } = setup({ day: { 5: [name, OTHER] } }, [name, OTHER, THIRD]);
  change(fx(5, "day"), `${name}・${OTHER}・${THIRD}`);
  const codes = T.lint(new T.Problem(R, M)).map(x => x.code);
  assert.ok(!codes.includes("LINT_MONTH_UNKNOWN_NAMES"), codes.join(","));
});

console.log(`fixed grid separator names: ${passed} passed, ${failed} failed (expected ${EXPECTED_CASES} cases)`);
if (passed + failed !== EXPECTED_CASES) { console.error(`FAIL case count ${passed + failed} != ${EXPECTED_CASES}`); process.exitCode = 1; }
if (failed) process.exitCode = 1;

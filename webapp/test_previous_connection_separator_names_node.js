// Previous-month connection, list fields (workers in a multi-worker facility; on-call lists in every facility): a staff name that
// contains a list separator (・ 、 , |) stays one person when the field is edited. The field's own text grammar (which characters
// split, no trimming) is unchanged for everything that is not such a name.
// Synthetic data only. The real monthly-conditions markup is rendered and decoded with Python's HTMLParser; only the minimal DOM
// selection API is substituted (same approach as test_delimited_names_node.js). No browser is launched; this is not a real-browser test.
// TOBAN_UI_INPUT_SOURCE=/path/to/other/app-input.js swaps the file under test (the clean base is expected to fail the non-control cases).
const fs = require("fs"), path = require("path"), vm = require("vm"), assert = require("assert"), { execFileSync } = require("child_process");
const EXPECTED_CASES = 20;
const elements = new Map();
globalThis.document = { querySelector: s => elements.get(s) || null, querySelectorAll: () => [] };
globalThis.location = { pathname: "/synthetic/previous-connection-separator-names.html" };
globalThis.localStorage = { getItem: () => null, setItem() {} };
globalThis.T = {};
for (const f of ["i18n.js", "rules-core.js", "model.js", "messages.js", "check.js", "plugins.js", "app-core.js", "app-input.js", "app-settings.js"])
  vm.runInThisContext(fs.readFileSync(f === "app-input.js" && process.env.TOBAN_UI_INPUT_SOURCE || path.join(__dirname, "src", f), "utf8"), { filename: f });
for (const f of fs.readdirSync(path.join(__dirname, "src/rules")).filter(f => f.endsWith(".js")).sort())
  vm.runInThisContext(fs.readFileSync(path.join(__dirname, "src/rules", f), "utf8"), { filename: "rules/" + f });
const A = T.app, clone = x => JSON.parse(JSON.stringify(x));
A.save = () => {}; A.toast = () => {}; A.renderAll = () => A.renderSettingsMonth();
let passed = 0, failed = 0;
const test = (label, fn) => { try { fn(); passed++; console.log("ok " + label); } catch (e) { failed++; console.error("FAIL " + label + ": " + e.message); } };
const parseRows = html => JSON.parse(execFileSync("python3", ["-c", `import json,sys
from html.parser import HTMLParser
class Rows(HTMLParser):
 def __init__(self): super().__init__(); self.rows=[]; self.row=None; self.select=None
 def handle_starttag(self,tag,attrs):
  a=dict(attrs)
  if tag=='tr' and 'data-ld' in a: self.row={'attrs':a,'fields':{}}; self.rows.append(self.row)
  if self.row is not None and tag in ('input','select') and 'data-f' in a:
   f=dict(a); f['tag']=tag; f['options']=[]; self.row['fields'][a['data-f']]=f
   if tag=='select': self.select=f
  if tag=='option' and self.select is not None: self.select['options'].append(a)
 def handle_endtag(self,tag):
  if tag=='tr': self.row=None
  if tag=='select': self.select=None
p=Rows(); p.feed(sys.stdin.read()); print(json.dumps(p.rows))`], { input: html, encoding: "utf8" }));
const dataset = attrs => Object.fromEntries(Object.entries(attrs).filter(([k]) => k.startsWith("data-")).map(([k, v]) => [k.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase()), v]));
// count = workers per slot (2: the worker fields are free-text lists; 1: the worker fields are selects and only the on-call lists are free text)
function screen(lastDays, roster, { count = 2, oc = count === 1 } = {}) {
  elements.clear();
  const R = { profile: { id: "synthetic-previous-separator", roles: [{ id: "S", label: "Staff", refs: [], standby: true }], shifts: [{ id: "day", on: "all" }, { id: "night", on: "all" }], positions: { work: { count } } }, doctors: roster.map(name => ({ name, team: "S", quota: 10 })), rule_states: {} };
  T.fillDefaultRules(R); for (const def of T.RULE_DEFS) if (def.states.includes("off")) R.rule_states[def.id] = "off"; R.rule_states.oncall = oc ? "hard" : "off";
  const M = T.normalizeMonth({ year: 2026, month: 11, prev_month: { last_days: clone(lastDays) } }, R);
  Object.assign(A.state, { rules: R, month: M, result: null, renames: [], ui: { doctor: 0 } }); A.clearUndo();
  const root = { dataset: {}, children: [{}], handlers: {}, addEventListener(k, f) { this.handlers[k] = f; }, querySelectorAll: () => [], querySelector(s) { return this.querySelectorAll(s)[0] || null; },
    set innerHTML(html) { this.html = html; }, get innerHTML() { return this.html; } };
  elements.set("#monthSettings", root); A.renderSettingsMonth();
  const rows = parseRows(root.html).map(row => {
    // a select reports its selected option (or the first one), like a browser does
    const fields = Object.fromEntries(Object.entries(row.fields).map(([k, a]) => [k, { tag: a.tag, value: a.tag === "select" ? (a.options.find(o => Object.hasOwn(o, "selected")) || a.options[0] || {}).value || "" : a.value || "", dataset: dataset(a), hasAttribute: attr => Object.hasOwn(a, attr), getAttribute: attr => a[attr] ?? null }]));
    return { fields, dataset: dataset(row.attrs), querySelector: s => fields[(s.match(/^\[data-f="(.*)"\]$/) || [])[1]] || null };
  });
  root.querySelectorAll = s => s === "tr[data-ld]" ? rows : [];
  const read = () => A.readSettingsMonth();
  const set = (i, f, v) => { assert.ok(rows[i] && rows[i].fields[f], `row ${i} field ${f}`); rows[i].fields[f].value = v; read(); };
  const day = i => M.prev_month.last_days[i];
  return { M, R, rows, read, set, day };
}
const SEPS = [["middle dot", "・"], ["ideographic comma", "、"], ["comma", ","], ["vertical bar", "|"]];
const OTHER = "Synthetic Other", THIRD = "Synthetic Third";

// 1) worker fields of a multi-worker facility: each separator
for (const [label, sep] of SEPS) test(`worker field: adding a worker keeps a name containing ${label} (${sep}) whole`, () => {
  const name = `Synthetic Two${sep}Parts`;
  const { rows, set, day, read } = screen([{ date: 30, day: [name, OTHER] }], [name, OTHER, THIRD]);
  assert.ok(rows[0].fields.day.hasAttribute("data-multi")); assert.strictEqual(rows[0].fields.day.value, `${name}・${OTHER}`);
  set(0, "day", `${rows[0].fields.day.value}・${THIRD}`);
  assert.deepStrictEqual(day(0), { date: 30, day: [name, OTHER, THIRD], day_oc: [] });
  read(); read(); assert.deepStrictEqual(day(0), { date: 30, day: [name, OTHER, THIRD], day_oc: [] });
});
test("worker field: typing the delimited name alone into an empty field stores one person", () => {
  const name = "Synthetic Two・Parts";
  const { set, day } = screen([{ date: 30, day: [OTHER] }], [name, OTHER]);
  set(0, "night", name);
  assert.deepStrictEqual(day(0), { date: 30, day: [OTHER], night: [name], night_oc: [] });
});
test("worker field: removing another worker keeps the delimited name whole", () => {
  const name = "Synthetic Two・Parts";
  const { set, day } = screen([{ date: 30, night: [name, OTHER, THIRD] }], [name, OTHER, THIRD]);
  set(0, "night", `${name}・${THIRD}`);
  assert.deepStrictEqual(day(0).night, [name, THIRD]);
});
test("worker field: reordering keeps the delimited name whole and follows the typed order", () => {
  const name = "Synthetic Two・Parts";
  const { set, day } = screen([{ date: 30, night: [name, OTHER] }], [name, OTHER]);
  set(0, "night", `${OTHER}・${name}`);
  assert.deepStrictEqual(day(0).night, [OTHER, name]);
});
test("worker field: the delimited name written twice is stored twice, like any repeated name in this field", () => {
  const name = "Synthetic Two・Parts";
  const { set, day } = screen([{ date: 30, night: [OTHER] }], [name, OTHER]);
  set(0, "night", `${name}・${name}`); assert.deepStrictEqual(day(0).night, [name, name]);
  set(0, "day", `${OTHER}・${OTHER}`); assert.deepStrictEqual(day(0).day, [OTHER, OTHER]);
});
test("worker field: a stored delimited name that is no longer in the roster survives adding a worker", () => {
  const former = "Synthetic Former|Staff";
  const { rows, set, day } = screen([{ date: 30, day: [former, OTHER] }], [OTHER, THIRD]);
  assert.strictEqual(rows[0].fields.day.value, `${former}・${OTHER}`);
  set(0, "day", `${rows[0].fields.day.value}・${THIRD}`);
  assert.deepStrictEqual(day(0).day, [former, OTHER, THIRD]);
});
// 2) the longest-match rule when the roster holds "A", "B" and "A・B"
test("longest match: 'A・B' is the person named 'A・B', not A and B", () => {
  const a = "Synthetic A", b = "Synthetic B", ab = `${a}・${b}`;
  const { set, day } = screen([{ date: 30, day: [OTHER] }], [a, b, ab, OTHER]);
  set(0, "night", ab); assert.deepStrictEqual(day(0).night, [ab]);
  set(0, "night", `${ab}・${a}`); assert.deepStrictEqual(day(0).night, [ab, a]);
});
test("control: 'B・A' stays two people B and A (no candidate starts there)", () => {
  const a = "Synthetic A", b = "Synthetic B", ab = `${a}・${b}`;
  const { set, day } = screen([{ date: 30, day: [OTHER] }], [a, b, ab, OTHER]);
  set(0, "night", `${b}・${a}`); assert.deepStrictEqual(day(0).night, [b, a]);
});
// 3) on-call lists in a 1-per-slot facility (the default physician shape: worker fields are selects, on-call fields are lists)
test("on-call list: adding a name keeps the delimited name whole", () => {
  const name = "Synthetic Two・Parts";
  const { rows, set, day } = screen([{ date: 31, night: OTHER, night_oc: [name] }], [name, OTHER, THIRD], { count: 1 });
  assert.strictEqual(rows[0].fields.night.tag, "select", "the worker field is a select in a 1-per-slot facility"); assert.strictEqual(rows[0].fields.night.value, OTHER); assert.strictEqual(rows[0].fields.night_oc.value, name);
  set(0, "night_oc", `${name}・${THIRD}`);
  assert.deepStrictEqual(day(0), { date: 31, night: OTHER, night_oc: [name, THIRD] });
});
test("on-call list: typing the delimited name alone stores one person", () => {
  const name = "Synthetic Two、Parts";
  const { set, day } = screen([{ date: 31, day: OTHER, night: THIRD }], [name, OTHER, THIRD], { count: 1 });
  set(0, "day_oc", name);
  assert.deepStrictEqual(day(0).day_oc, [name]);
});
test("on-call list: a delimited name that is no longer in the roster survives an edit of the same field", () => {
  const former = "Synthetic Former,Staff";
  const { set, day } = screen([{ date: 31, night: OTHER, night_oc: [former] }], [OTHER, THIRD], { count: 1 });
  set(0, "night_oc", `${former}・${THIRD}`);
  assert.deepStrictEqual(day(0).night_oc, [former, THIRD]);
});
// 4) unchanged behaviour (controls; these pass on the base as well)
test("control: an untouched field keeps its stored array even when it contains a delimited name", () => {
  const name = "Synthetic Two・Parts";
  const before = [{ date: 30, day: [name, OTHER], night: [OTHER, THIRD], day_oc: [name], night_oc: [] }];
  const { set, M, read } = screen(before, [name, OTHER, THIRD]); // on-call is off in a multi-worker facility: the on-call lists are hidden and kept
  read(); read(); assert.deepStrictEqual(M.prev_month.last_days, before);
  set(0, "night", `${THIRD}`); assert.deepStrictEqual(M.prev_month.last_days[0], { date: 30, day: [name, OTHER], night: [THIRD], day_oc: [name], night_oc: [] });
});
test("control: the existing text grammar is unchanged (every separator splits; spaces are not trimmed)", () => {
  const { set, day } = screen([{ date: 30, day: [OTHER] }], [OTHER, THIRD]);
  set(0, "night", `${OTHER},${THIRD}|${OTHER}、${THIRD}`); assert.deepStrictEqual(day(0).night, [OTHER, THIRD, OTHER, THIRD]);
  set(0, "night", `${OTHER} ・ ${THIRD}`); assert.deepStrictEqual(day(0).night, [`${OTHER} `, ` ${THIRD}`]);
  set(0, "night", "・・"); assert.strictEqual(day(0).night, undefined);
});
test("control: spaces around a delimited name are kept, as this field keeps them for every name", () => {
  const name = "Synthetic Two・Parts";
  const { set, day } = screen([{ date: 30, day: [OTHER] }], [name, OTHER]);
  set(0, "night", ` ${name}・${OTHER}`); assert.deepStrictEqual(day(0).night, [" Synthetic Two", "Parts", OTHER]);
});
test("control: text that merely starts with a delimited roster name is still split as before", () => {
  const name = "Synthetic Two・Parts";
  const { set, day } = screen([{ date: 30, day: [OTHER] }], [name, OTHER]);
  set(0, "night", `${name}X・${OTHER}`); assert.deepStrictEqual(day(0).night, ["Synthetic Two", "PartsX", OTHER]);
});
test("control: a plain name that is a prefix of a delimited roster name stays itself", () => {
  const name = "Synthetic Two・Parts", plain = "Synthetic Two";
  const { set, day } = screen([{ date: 30, day: [OTHER] }], [name, plain, OTHER]);
  set(0, "night", `${plain}・${OTHER}`); assert.deepStrictEqual(day(0).night, [plain, OTHER]);
});
test("control: clearing a worker field that held the delimited name removes the workers and their on-call list", () => {
  const name = "Synthetic Two・Parts";
  const { set, day } = screen([{ date: 30, day: [name, OTHER], day_oc: [THIRD] }], [name, OTHER, THIRD]);
  set(0, "day", ""); assert.deepStrictEqual(day(0), { date: 30 });
});

console.log(`previous connection separator names: ${passed} passed, ${failed} failed (expected ${EXPECTED_CASES} cases)`);
if (passed + failed !== EXPECTED_CASES) { console.error(`FAIL case count ${passed + failed} != ${EXPECTED_CASES}`); process.exitCode = 1; }
if (failed) process.exitCode = 1;

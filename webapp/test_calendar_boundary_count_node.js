// Next-month fixed-worker capacity must use the next first-day holiday setting.
// Synthetic data only. Render the real markup, parse controls with Python's HTMLParser,
// and substitute only DOM selection/events. No browser is launched.
const fs = require("fs"), path = require("path"), vm = require("vm"), assert = require("assert"), { execFileSync } = require("child_process");
const sourceRoot = process.env.TOBAN_WEBAPP_ROOT || __dirname;
const elements = new Map();
globalThis.document = { querySelector: s => elements.get(s) || null, querySelectorAll: () => [] };
globalThis.location = { pathname: "/synthetic/calendar-day-readback.html" };
globalThis.localStorage = { getItem: () => null, setItem() {} };
globalThis.T = {};
for (const f of ["i18n.js", "rules-core.js", "model.js", "messages.js", "check.js", "app-core.js", "app-input.js", "app-month.js"])
  vm.runInThisContext(fs.readFileSync(f === "app-input.js" && process.env.TOBAN_UI_INPUT_SOURCE || path.join(sourceRoot, "src", f), "utf8"), { filename: f });
for (const f of fs.readdirSync(path.join(sourceRoot, "src/rules")).filter(f => f.endsWith(".js")).sort())
  vm.runInThisContext(fs.readFileSync(path.join(sourceRoot, "src/rules", f), "utf8"), { filename: "rules/" + f });
const A = T.app, names = ["Synthetic A", "Synthetic B"], clone = x => JSON.parse(JSON.stringify(x));
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
function setup({ numeric = false, dayOn = "all", dayRule = "soft" } = {}) {
  const R = { profile: { id: "synthetic-calendar-days", roles: [{ id: "S", label: "Staff", refs: [] }], shifts: [{ id: "day", on: dayOn }, { id: "night", on: "all" }] }, doctors: names.map(name => ({ name, team: "S", quota: 30 })), rule_states: {}, weights: {} };
  T.fillDefaultRules(R); for (const def of T.RULE_DEFS) if (def.states.includes("off")) R.rule_states[def.id] = "off";
  R.rule_states.wish_night = "soft"; R.rule_states.wish_day = dayRule;
  const first = n => numeric ? n : String(n);
  const M = T.normalizeMonth({ year: 2026, month: 11, next_first_day_in_calendar: true,
    wishes: { night_on: { [names[0]]: [first(5), 12], [names[1]]: ["6"] }, day_on: { [names[0]]: [first(7), 14], [names[1]]: ["8"] } },
    unavailable_night: { [names[0]]: [first(8), 16] }, fixed: { night: { 20: names[1] } }, fixed_tags: { [`20:night|${names[1]}`]: "Synthetic tag" } }, R);
  Object.assign(A.state, { rules: R, month: M, ui: { doctor: 0 }, result: null }); elements.clear();
  const root = { children: [{}], dataset: {}, controls: [], handlers: {}, addEventListener(k, fn) { this.handlers[k] = fn; },
    querySelectorAll(s) { const match = s.match(/^\[data-cal="([^"]+)"\]$/); return match ? this.controls.filter(c => c.dataset.cal === match[1]) : []; },
    querySelector(s) { return this.querySelectorAll(s)[0] || null; },
    set innerHTML(html) { this.html = html; this.controls = parseControls(html).map(c => {
      const opts = c.options, value = opts ? (opts.find(o => Object.hasOwn(o, "selected")) || opts[0] || {}).value || "" : c.value;
      const el = { dataset: datasetOf(c.attrs), id: c.attrs.id || "", type: c.attrs.type || (opts ? "select-one" : "text"), value, checked: !!c.checked };
      if (el.id) elements.set("#" + el.id, el); return el;
    }); }, get innerHTML() { return this.html; } };
  elements.set("#doctorPane", root); A.bindDoctor(); A.renderDoctor(); root.handlers.change({ target: { id: "docSel", value: names[0] } });
  const control = (kind, d) => { const el = root.controls.find(c => c.dataset.cal === kind && +c.dataset.d === d); assert.ok(el, `missing ${kind} control on ${d}`); return el; };
  const change = (kind, d, value) => { const el = control(kind, d); if (el.type === "checkbox") el.checked = value; else el.value = value; root.handlers.change({ target: el }); };
  return { R, M, root, control, change };
}
function effective(M, R) {
  const P = new T.Problem(R, M);
  return { night: P.wishNight, day: P.wishDay, unavailable: Object.fromEntries(Object.entries(P.unavailNight).map(([n, ds]) => [n, [...ds]])) };
}



test("real calendar change accepts a second next-holiday worker", () => {
 const { R, M, root } = setup(); R.profile.positions = { work: { count: { weekday: 1, off_days: 2 } } };
 M.next_month_first_day_is_holiday = true; M.fixed.night[31] = names[1]; A.renderDoctor();
 const el = root.controls.find(c => c.dataset.cal === "fixed" && +c.dataset.d === 31 && c.dataset.k === "night");
 el.value = "night"; root.handlers.change({ target: el });
 assert.deepStrictEqual([].concat(M.fixed.night[31]).sort(), names.slice().sort());
});
for (const [year, month] of [[2026, 11], [2026, 12], [2027, 2], [2028, 2]]) {
 for (const kind of ["day", "night"]) for (const holiday of [true, false]) {
  test(`${year}-${month}: ${kind} capacity follows next-day holiday=${holiday}`, () => {
   const { R, M, root } = setup(); Object.assign(M, { year, month, holidays: [], next_month_first_day_is_holiday: holiday });
   R.profile.positions = { work: { count: { weekday: 1, off_days: 2 }, min: { weekday: 0, off_days: 1 }, ideal: { weekday: 1, off_days: 2 } } };
   const N = new Date(year, month, 0).getDate(), next = N + 1;
   M.fixed = { day: {}, night: {} }; M.fixed[kind][next] = names[1]; A.renderDoctor(); root.handlers.change({ target: { id: "docSel", value: names[0] } });
   let p = new T.Problem(R, M); assert.equal(p.nextDayIsHoliday(), holiday, "fixture next first day is a weekday");
   assert.equal(p.countOf([next, kind]), holiday ? 2 : 1);
   assert.equal(p.countMinOf([next, kind]), holiday ? 1 : 0);
   assert.equal(p.countIdealOf([next, kind]), holiday ? 2 : 1);
   const el = root.controls.find(c => c.dataset.cal === "fixed" && +c.dataset.d === next && c.dataset.k === kind);
   assert.ok(el); el.value = kind; root.handlers.change({ target: el });
   assert.deepStrictEqual([].concat(M.fixed[kind][next]).sort(), holiday ? names.slice().sort() : [names[1]]);
   if (holiday) {
    // Changing the calendar classification does not silently erase previously saved fixed input.
    M.next_month_first_day_is_holiday = false; A.renderDoctor(); A.readAll();
    assert.deepStrictEqual([].concat(M.fixed[kind][next]).sort(), names.slice().sort());
    const saved = JSON.parse(JSON.stringify(M)); p = new T.Problem(R, T.normalizeMonth(saved, R));
    assert.equal(p.countOf([next, kind]), 1); assert.deepStrictEqual(p.nextFixed[kind].slice().sort(), names.slice().sort());
    M.next_month_first_day_is_holiday = true; A.renderDoctor(); A.readAll();
    assert.deepStrictEqual([].concat(M.fixed[kind][next]).sort(), names.slice().sort());
   }
  });
 }
}
test("next-day holiday rejects a second worker when holiday capacity is lower", () => {
 const { R, M, root } = setup(); R.profile.positions = { work: { count: { weekday: 2, off_days: 1 } } };
 M.next_month_first_day_is_holiday = true; M.fixed.night[31] = names[1]; A.renderDoctor();
 const el = root.controls.find(c => c.dataset.cal === "fixed" && +c.dataset.d === 31 && c.dataset.k === "night");
 el.value = "night"; root.handlers.change({ target: el });
 assert.deepStrictEqual([].concat(M.fixed.night[31]), [names[1]]);
});
test("weekend next first day uses holiday capacity without checkbox", () => {
 const { R, M } = setup(); M.year = 2026; M.month = 10; M.next_month_first_day_is_holiday = false;
 R.profile.positions = { work: { count: { weekday: 1, off_days: 2 } } };
 const p = new T.Problem(R, M); assert.equal(p.N, 31); assert.equal(p.countOf([32, "night"]), 2);
});
test("in-month holidays and ordinary weekdays retain their own capacities", () => {
 const { R, M } = setup(); M.holidays = [2]; M.next_month_first_day_is_holiday = true;
 R.profile.positions = { work: { count: { weekday: 1, off_days: 2 } } };
 const p = new T.Problem(R, M); assert.equal(p.countOf([2, "night"]), 2); assert.equal(p.countOf([3, "night"]), 1);
});
console.log(`calendar boundary: ${passed} passed, ${failed} failed`); if (failed) process.exitCode = 1;

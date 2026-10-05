// Calendar rendering must preserve day lists accepted by the model, including numeric strings.
// Synthetic data only. Render the real markup, parse controls with Python's HTMLParser,
// and substitute only DOM selection/events. No browser is launched.
const fs = require("fs"), path = require("path"), vm = require("vm"), assert = require("assert"), { execFileSync } = require("child_process");
const elements = new Map();
globalThis.document = { querySelector: s => elements.get(s) || null, querySelectorAll: () => [] };
globalThis.location = { pathname: "/synthetic/calendar-day-readback.html" };
globalThis.localStorage = { getItem: () => null, setItem() {} };
globalThis.T = {};
for (const f of ["i18n.js", "rules-core.js", "model.js", "messages.js", "check.js", "app-core.js", "app-input.js"])
  vm.runInThisContext(fs.readFileSync(f === "app-input.js" && process.env.TOBAN_UI_INPUT_SOURCE || path.join(__dirname, "src", f), "utf8"), { filename: f });
for (const f of fs.readdirSync(path.join(__dirname, "src/rules")).filter(f => f.endsWith(".js")).sort())
  vm.runInThisContext(fs.readFileSync(path.join(__dirname, "src/rules", f), "utf8"), { filename: "rules/" + f });
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
  elements.set("#doctorPane", root); A.bindDoctor(); A.renderDoctor();
  const control = (kind, d) => { const el = root.controls.find(c => c.dataset.cal === kind && +c.dataset.d === d); assert.ok(el, `missing ${kind} control on ${d}`); return el; };
  const change = (kind, d, value) => { const el = control(kind, d); if (el.type === "checkbox") el.checked = value; else el.value = value; root.handlers.change({ target: el }); };
  return { R, M, root, control, change };
}
function effective(M, R) {
  const P = new T.Problem(R, M);
  return { night: P.wishNight, day: P.wishDay, unavailable: Object.fromEntries(Object.entries(P.unavailNight).map(([n, ds]) => [n, [...ds]])) };
}

test("numeric-string night wishes render checked before any readback", () => {
  const { control } = setup(); assert.strictEqual(control("wish", 5).checked, true); assert.strictEqual(control("wish", 12).checked, true); assert.strictEqual(control("wish", 6).checked, false);
});
test("numeric-string day wishes render checked before any readback", () => {
  const { control } = setup(); assert.strictEqual(control("wishday", 7).checked, true); assert.strictEqual(control("wishday", 14).checked, true);
});
test("numeric-string night unavailability renders selected on the first screen", () => {
  const { control } = setup(); assert.strictEqual(control("unavail", 8).value, "night"); assert.strictEqual(control("unavail", 8).dataset.shown, "night");
});
test("unchanged readback and doctor navigation preserve all accepted days", () => {
  const { R, M, root } = setup(), before = effective(M, R);
  for (let i = 0; i < 3; i++) {
    A.readAll(); assert.deepStrictEqual(effective(M, R), before);
    root.handlers.change({ target: { id: "docSel", value: "1" } });
    assert.deepStrictEqual(effective(M, R), before);
    root.handlers.change({ target: { id: "docSel", value: "0" } });
    assert.deepStrictEqual(effective(M, R), before);
  }
});
test("unrelated calendar edits and repeated readbacks preserve all accepted days", () => {
  const { R, M, change } = setup(), before = effective(M, R), fixed = clone(M.fixed), tags = clone(M.fixed_tags);
  change("duty", 9, "ward");
  for (let i = 0; i < 3; i++) { A.readAll(); assert.deepStrictEqual(effective(M, R), before); assert.deepStrictEqual(M.fixed, fixed); assert.deepStrictEqual(M.fixed_tags, tags); }
  assert.deepStrictEqual(M.duty_days[names[0]][9], { am: "ward" });
});
test("explicit clearing removes only the displayed imported day and stays cleared", () => {
  const { R, M, change } = setup(); change("wish", 5, false); change("wishday", 7, false); change("unavail", 8, "");
  for (let i = 0; i < 3; i++) { A.readAll(); A.renderDoctor(); const after = effective(M, R);
    assert.deepStrictEqual(after.night[names[0]], [12]); assert.deepStrictEqual(after.day[names[0]], [14]); assert.deepStrictEqual(after.unavailable[names[0]], [16]);
    assert.deepStrictEqual(after.night[names[1]], [6]); assert.deepStrictEqual(after.day[names[1]], [8]); }
});
test("hidden day wishes are preserved when the rule or weekday day shift is off", () => {
  for (const opts of [{ dayRule: "off" }, { dayOn: "off_days" }]) {
    const { R, M, change } = setup(opts), expected = effective(M, R); M.wishes.day_on[names[0]].push("5"); expected.day[names[0]].push(5); expected.day[names[0]].sort((a, b) => a - b); M.wishes.day_on[names[0]].sort((a, b) => +a - +b); A.renderDoctor();
    change("duty", 9, "ward"); A.readAll(); assert.deepStrictEqual(effective(M, R), expected);
  }
});
test("ordinary numeric days retain the same selection and explicit editing behavior", () => {
  const { R, M, control, change } = setup({ numeric: true }), before = effective(M, R);
  assert.strictEqual(control("wish", 5).checked, true); assert.strictEqual(control("wishday", 7).checked, true); assert.strictEqual(control("unavail", 8).value, "night");
  A.readAll(); assert.deepStrictEqual(effective(M, R), before); change("wish", 5, false); change("wish", 6, true); assert.deepStrictEqual(M.wishes.night_on[names[0]], [6, 12]);
});
test("next-month first-day records survive current-calendar edits with numeric or string days", () => {
  for (const next of [31, "31"]) {
    const { R, M, change, control } = setup(); M.unavailable_night[names[0]].push(next);
    M.duty_days[names[0]][next] = { am: "ward", pm: "external" }; M.fixed.night[next] = names[0]; A.renderDoctor();
    const before = effective(M, R), fixed = clone(M.fixed), duties = clone(M.duty_days);
    assert.strictEqual(control("duty", 31).value, "ward");
    // The first fixed selector is the empty day slot; verify the next-night selector separately.
    assert.strictEqual(elements.get("#doctorPane").controls.find(c => c.dataset.cal === "fixed" && +c.dataset.d === 31 && c.dataset.k === "night").value, "night");
    A.readAll(); assert.deepStrictEqual(effective(M, R), before); assert.deepStrictEqual(M.fixed, fixed); assert.deepStrictEqual(M.duty_days, duties);
    change("wish", 6, true); assert.deepStrictEqual(M.unavailable_night[names[0]], [8, 16, 31]); assert.deepStrictEqual(M.fixed, fixed); assert.deepStrictEqual(M.duty_days, duties);
  }
});
test("mixed duplicate days keep the existing set-like readback and explicit clear behavior", () => {
  const { M, control, change } = setup();
  M.wishes.night_on[names[0]] = [5, "5", "12"]; M.wishes.day_on[names[0]] = [7, "7", "14"]; M.unavailable_night[names[0]] = [8, "8", "16"]; A.renderDoctor();
  assert.strictEqual(control("wish", 12).checked, true); assert.strictEqual(control("wishday", 14).checked, true); assert.strictEqual(control("unavail", 16).value, "night");
  A.readAll(); assert.deepStrictEqual(M.wishes.night_on[names[0]], [5, 12]); assert.deepStrictEqual(M.wishes.day_on[names[0]], [7, 14]); assert.deepStrictEqual(M.unavailable_night[names[0]], [8, 16]);
  change("wish", 5, false); change("wishday", 7, false); change("unavail", 8, ""); A.readAll();
  assert.deepStrictEqual(M.wishes.night_on[names[0]], [12]); assert.deepStrictEqual(M.wishes.day_on[names[0]], [14]); assert.deepStrictEqual(M.unavailable_night[names[0]], [16]);
});
test("saved and reloaded calendar inputs retain the model's wish penalties", () => {
  const { R, M } = setup(), P = new T.Problem(R, M), asg = Object.fromEntries(P.slots.map(s => [T.Problem.key(s), { work: names[1], oc: [] }]));
  const before = T.penalty(P, asg).total; assert.ok(before > 0, "fixture includes unsatisfied wishes");
  A.readAll(); const saved = JSON.parse(JSON.stringify(M)), after = new T.Problem(R, T.normalizeMonth(saved, R));
  assert.strictEqual(T.penalty(after, asg).total, before); assert.deepStrictEqual(after.wishNight[names[0]], [5, 12]); assert.deepStrictEqual(after.wishDay[names[0]], [7, 14]);
});
console.log(`calendar day readback: ${passed} passed, ${failed} failed`); if (failed) process.exitCode = 1;

// Imported JSON values stay inert in settings/month HTML, even in numeric fields.
// Synthetic payload only; this tests generated markup without launching a browser.
const fs = require("fs"), path = require("path"), vm = require("vm"), assert = require("assert"), { execFileSync } = require("child_process");
const elements = new Map(), element = selector => {
  if (!elements.has(selector)) elements.set(selector, { innerHTML: "", value: "", textContent: "", dataset: {}, children: [], addEventListener() {}, querySelector: () => null, querySelectorAll: () => [] });
  return elements.get(selector);
};
globalThis.document = { querySelector: element, querySelectorAll: () => [] };
globalThis.location = { pathname: "/synthetic/input-escape.html" };
let stored = null;
globalThis.localStorage = { getItem: () => stored, setItem() {} };
globalThis.T = {};
for (const file of ["i18n.js", "rules-core.js", "model.js", "messages.js", "check.js", "app-core.js", "app-input.js", "app-settings.js"])
  vm.runInThisContext(fs.readFileSync(path.join(__dirname, "src", file), "utf8"), { filename: file });
for (const file of fs.readdirSync(path.join(__dirname, "src/rules")).filter(x => x.endsWith(".js")).sort())
  vm.runInThisContext(fs.readFileSync(path.join(__dirname, "src/rules", file), "utf8"), { filename: file });
// The old specialist-duty month fields remain available when a facility provides this rule.
T.rules.register({ id: "cath_requirement", api: 1, order: 999, group: "basic", label: "Synthetic specialist-duty rule", states: ["hard", "off"], def: "hard", solve() {}, check() {} });
const A = T.app, payload = '1" data-synthetic-injected="yes"><img data-synthetic-injected="yes" src=x onerror="globalThis.__synthetic=1">';
const baseline = JSON.parse(fs.readFileSync(path.join(__dirname, "data/rules.json"), "utf8"));
const clone = x => JSON.parse(JSON.stringify(x));
function fixture(change) {
  elements.clear();
  const rules = clone(baseline), month = { year: 2026, month: 11, next_first_day_in_calendar: true };
  rules.doctors.sort((a, b) => (b.team === "I") - (a.team === "I"));
  T.fillDefaultRules(rules); T.normalizeMonth(month, rules);
  for (const def of T.RULE_DEFS) rules.rule_states[def.id] = def.states.find(x => x !== "off");
  change(rules, month, rules.doctors[0].name);
  // Use the browser-state admission and normal render normalization, not a sanitized fixture.
  stored = JSON.stringify({ rules, month, result: null, ui: { doctor: 0 } });
  const admitted = A.load(); assert(admitted, "saved JSON is admitted before rendering");
  Object.assign(A.state, admitted);
}
const cases = [], settings = (name, change) => cases.push([name, change, () => A.renderSettings()]);
const month = (name, change) => cases.push([name, change, () => A.renderSettingsMonth()]);
for (const key of ["years", "quota"]) settings("staff " + key, R => { R.doctors[0][key] = payload; });
settings("staff share", R => { R.profile.quota_mode = "share"; R.doctors[0].share = payload; });
for (const key of ["chief_duty", "target_deviation", "fixed_conflict"]) settings("weight " + key, R => { R.weights[key] = payload; });
settings("oncall requirement", R => { R.oncall_requirement.I.I = payload; });
for (const key of ["count", "min", "ideal"]) settings("position " + key, R => { R.profile.positions = { work: { [key]: { night: payload } } }; });
for (const key of ["years_min", "years_max", "min", "max"]) settings("composition " + key, R => { R.composition = [{ shift: "night", [key]: payload }]; });
for (const key of ["max_extra", "hours_per_week", "hours_per_day", "min", "pair_min"]) settings("days off " + key, R => { R.days_off = { [key]: payload }; });
settings("Friday minimum", (R, M, n) => { R.friday_night_min = { [n]: payload }; });
settings("pair cap", R => { R.pair_cap = { max: payload }; });
for (const key of ["min", "max"]) settings("run length " + key, R => { R.run_length = { [key]: payload }; });
for (const key of ["min", "max"]) settings("shift count " + key, R => { R.shift_counts = { night: { [key]: payload } }; });
for (const key of ["day", "night"]) {
  settings("staff shift cap " + key, R => { R.shift_counts = { [key]: { max: 15 } }; R.doctors[0]["shift_max_" + key] = payload; });
  settings("shift run " + key, R => { R.shift_run_max = { [key]: payload }; });
}
settings("wish off cap", R => { R.wish_off = { max: payload }; });
for (const key of ["holidays", "cath_off_days_A", "cath_off_days_I"]) month("day list " + key, (R, M) => { M[key] = [payload]; });
month("monthly weekend difference", (R, M) => { M.exceptions.weekend_balance_max_diff = payload; });
for (const key of ["work_balance", "weekend_charge", "holiday_charge"]) month("monthly history " + key, (R, M, n) => { M.history[key] = { [n]: payload }; });
for (const key of ["targets", "count_min", "count_max"]) month("monthly " + key, (R, M, n) => { M[key] = { [n]: payload }; });
month("previous date", (R, M) => { M.prev_month.last_days = [{ date: payload }]; });
cases.push(["pattern nth", (R, M, n) => { M.regular_duties[n] = [{ kind: "external", dow: "Mon", nth: [payload] }]; }, () => A.renderDoctor()]);
let passed = 0, failed = 0;
for (const [name, change, render] of cases) {
  try {
    fixture(change); render();
    const html = [...elements.values()].map(x => x.innerHTML).join("\n");
    execFileSync("python3", ["-c", `from html.parser import HTMLParser\nimport sys\nclass Check(HTMLParser):\n def handle_starttag(self, tag, attrs):\n  assert not any(k == 'data-synthetic-injected' for k, v in attrs), 'injected HTML attribute or element'\nCheck().feed(sys.stdin.read())`], { input: html, stdio: ["pipe", "pipe", "pipe"] });
    assert(html.includes(`value="${T.esc(payload)}"`), "numeric/list value must be escaped in its input attribute");
    assert(!html.includes(payload), "no raw attribute-breakout payload");
    console.log("ok " + name); passed++;
  } catch (e) { console.error("FAIL " + name + ": " + e.message); failed++; }
}
// Ordinary zero, fractional, blank and legacy numeric-string values remain textually unchanged.
for (const value of [0, 0.5, "", "2.5"]) {
  fixture(R => { R.doctors[0].years = value; }); A.renderSettings();
  assert(element("#doctorTable").innerHTML.includes(`data-f="years" value="${value}"`));
}
console.log(`input escaping: ${passed} pass, ${failed} fail; numeric display compatibility OK; browser execution not tested`);
if (failed) process.exitCode = 1;

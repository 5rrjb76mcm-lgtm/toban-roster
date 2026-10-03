// 予備の月許可と実勤務候補の実ブラウザ回帰試験。架空データのみ、HTTP サーバーなし、外部通信は遮断。
// node test_reserve_ui_browser.js [toban.html のパス]
// HTML 指定時はその完成品を file:// で検査。省略時は src/ を直接読み込んで入力画面だけを検査する。
const fs = require("fs"), path = require("path"), assert = require("assert"), { pathToFileURL } = require("url");
let chromium; try { ({ chromium } = require(path.join(process.env.HOME, ".toban-test/node_modules/playwright"))); } catch (e) { console.log("--  予備候補のブラウザ試験は省略（Playwright が無い）"); process.exit(0); }
if (!fs.existsSync("/Applications/Google Chrome.app")) { console.log("--  予備候補のブラウザ試験は省略（Google Chrome が無い）"); process.exit(0); }
const HTML = process.argv[2] && path.resolve(process.argv[2]);
(async () => {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  try {
    const context = await browser.newContext({ locale: "ja-JP" }), network = [], errors = [];
    await context.route(/^https?:/, route => { network.push("blocked request"); return route.abort(); });
    const page = await context.newPage(); page.on("pageerror", e => errors.push(e.name));
    if (HTML) {
      await page.goto(pathToFileURL(HTML).href);
      await page.getByRole("button", { name: /フォルダなしで続ける/ }).click();
      await page.waitForSelector("#startGate", { state: "hidden" });
    } else {
      await page.setContent('<main><div id="monthSettings"></div><div id="doctorPane"></div><div id="fixedPane"></div></main>');
      for (const f of ["i18n.js", "rules-core.js", "model.js", "messages.js", "check.js", "app-core.js", "app-input.js"])
        await page.addScriptTag({ content: fs.readFileSync(f === "app-input.js" && process.env.TOBAN_UI_INPUT_SOURCE || path.join(__dirname, "src", f), "utf8") });
      for (const f of fs.readdirSync(path.join(__dirname, "src/rules")).filter(f => f.endsWith(".js")).sort())
        await page.addScriptTag({ content: fs.readFileSync(path.join(__dirname, "src/rules", f), "utf8") });
      for (const lang of ["ja", "en"])
        await page.evaluate(data => T.registerLang(data), JSON.parse(fs.readFileSync(path.join(__dirname, "lang", lang + ".json"), "utf8")));
    }
    const results = await page.evaluate(bind => {
      const A = T.app, n = "Synthetic Reserve", staff = "Synthetic Staff", out = [];
      const q = s => document.querySelector(s), choices = s => [...q(s).options].map(o => o.value);
      const check = (v, msg) => { if (!v) throw new Error(msg); };
      const change = (s, v) => { const el = q(s); if (v !== undefined) { if (el.type === "checkbox") el.checked = v; else el.value = v; } el.dispatchEvent(new Event("change", { bubbles: true })); };
      const fx = (d, k = "night") => `[data-fx="${k}"][data-d="${d}"]`;
      const cal = (d, k = "night") => `[data-cal="fixed"][data-k="${k}"][data-d="${d}"]`;
      const gate = '[data-path="allow_chief_duty"]';
      const render = () => { A.renderSettingsMonth(); A.renderDoctor(); A.renderFixed(); };
      A.save = A.renderHeader = A.toast = () => {};
      if (bind) { A.bindSettingsMonth(); A.bindFixed(); A.bindDoctor(); }
      const reset = ({ duty = "yes", allow = false, reserveId = "Reserve", standby = true, multi = false, oncall = true } = {}) => {
        T.setLang("ja");
        const R = { profile: { id: "synthetic-ui", roles: [
          { id: reserveId, label: "Reserve", refs: ["reserve"], standby },
          { id: reserveId === "C" ? "Staff" : "C", label: "Staff", refs: ["charge"], standby: true }
        ], shifts: [{ id: "day", on: "all", oncall }, { id: "night", on: "all", oncall }], positions: { work: { count: multi ? 2 : 1 } } },
        doctors: [{ name: n, team: reserveId, duty, quota: 0 }, { name: staff, team: reserveId === "C" ? "Staff" : "C", quota: 0 }] };
        T.fillDefaultRules(R);
        if (multi) for (const id of ["oncall", "period_charge", "same_day_team"]) R.rule_states[id] = "off";
        const m = T.normalizeMonth({ year: 2026, month: 11, allow_chief_duty: allow, next_first_day_in_calendar: true,
          targets: { [n]: 7 }, history: { work_balance: { [n]: 5 } }, wishes: { night_on: { [n]: [8] } } }, R);
        Object.assign(A.state, { rules: R, month: m, result: null, ui: { doctor: 0 } }); render(); return m;
      };
      const test = (name, fn) => { try { fn(); out.push({ name, pass: true }); } catch (e) { out.push({ name, pass: false, error: e.message }); } };
      test("reserve role ID / duty blank or yes / monthly gate: current work, OC and next-month choices", () => {
        for (const reserveId of ["C", "Reserve"]) for (const duty of ["", "yes"]) for (const allow of [false, true]) {
          reset({ reserveId, duty, allow }); const P = new T.Problem(A.state.rules, A.state.month);
          for (const k of ["day", "night"]) {
            check(choices(fx(1, k)).includes(n) === allow, "current fixed worker candidate must follow monthly gate");
            check(choices(fx(1, k)).includes(staff), "non-reserve worker must stay available");
            check(choices(cal(1, k)).includes(k) === allow, "doctor current work choice must follow monthly gate");
            check(choices(cal(1, k)).includes(k + "oc"), "doctor OC choice must remain available");
            check(choices(fx(31, k)).includes(n) && choices(cal(31, k)).includes(k), "next-month connection choice must remain available");
          }
          check(P.standbyNames.includes(n), "reserve must remain an OC candidate");
          check(!!q(`[data-target="${n}"]`) === allow, "monthly target must reflect work candidates");
          check(q(".docnav").textContent.includes("今月の実勤務は候補外") === !allow, "doctor warning must reflect current month");
          check(q(".docnav").textContent.includes("OC は候補のまま") === !allow, "standby reserve note must preserve OC scope");
        }
      });
      test("monthly toggle immediately updates target UI and keeps hidden targets, history and wishes", () => {
        const m = reset({ allow: true }); change(gate, false);
        check(!q(`[data-target="${n}"]`) && !q(`[data-bal="${n}"]`), "monthly toggle must refresh shown targets");
        change('[data-path="notes"]', "Synthetic note");
        check(m.targets[n] === 7 && m.history.work_balance[n] === 5, "hidden values must be preserved");
        check(m.wishes.night_on[n].join() === "8", "wishes must be preserved");
        change(gate, true);
        check(q(`[data-target="${n}"]`).value === "7" && q(`[data-bal="${n}"]`).value === "5", "re-enabling must restore stored values");
        A.renderDoctor(); A.renderFixed(); check(choices(fx(3)).includes(n) && choices(cal(3)).includes("night"), "re-enabling must restore work choices");
      });
      test("fixed grid retains excluded fixed work and tags, permits explicit removal, and leaves OC and next-month facts", () => {
        const m = reset(); m.fixed.day[1] = n; m.fixed.night[2] = n; m.fixed.night[31] = n; m.fixed.night_oc[4] = [n];
        m.fixed_tags[`1:day|${n}`] = "Synthetic day tag"; m.fixed_tags[`2:night|${n}`] = "Synthetic night tag"; A.renderFixed();
        for (const [d, k] of [[1, "day"], [2, "night"]]) {
          const el = q(fx(d, k)); check(el.value === n && el.selectedOptions[0].textContent.includes("現在は使わない値"), "excluded existing fixed value must stay visibly selected");
        }
        check(!choices(fx(3)).includes(n), "retained value must not become a candidate on other days");
        change(fx(3), staff);
        check(m.fixed.day[1] === n && m.fixed.night[2] === n && m.fixed_tags[`1:day|${n}`] && m.fixed_tags[`2:night|${n}`], "unrelated edit must preserve excluded fixed values and tags");
        change(fx(1, "day"), "");
        check(!m.fixed.day[1] && !m.fixed_tags[`1:day|${n}`], "explicit removal must remove fixed value and its tag");
        check(m.fixed.night[2] === n && m.fixed.night[31] === n && m.fixed.night_oc[4].includes(n), "other fixed values and OC must remain");
      });
      test("doctor calendar retains excluded fixed work, reports lint, permits explicit removal and OC entry", () => {
        const m = reset(); m.fixed.day[1] = n; m.fixed.night[2] = n;
        m.fixed_tags[`1:day|${n}`] = "Synthetic day tag"; m.fixed_tags[`2:night|${n}`] = "Synthetic night tag"; A.renderDoctor();
        check(q(cal(1, "day")).value === "day" && q(cal(2)).value === "night", "excluded fixed work must remain selected");
        check(q(cal(1, "day")).selectedOptions[0].textContent.includes("現在は使わない値"), "excluded fixed work must be annotated");
        change('[data-cal="duty"][data-d="3"][data-part="am"]', "ward");
        check(m.fixed.day[1] === n && m.fixed.night[2] === n && m.fixed_tags[`1:day|${n}`] && m.fixed_tags[`2:night|${n}`], "calendar edit must preserve fixed values and tags");
        const lint = T.lint(new T.Problem(A.state.rules, m));
        check(lint.filter(x => x.code === "LINT_FIXED_NOT_CANDIDATE").length === 2, "retained excluded work must remain available to input lint");
        change(cal(4), "nightoc"); check(m.fixed.night_oc[4].includes(n), "new OC entry must remain accepted");
        change(cal(1, "day"), ""); check(!m.fixed.day[1] && !m.fixed_tags[`1:day|${n}`], "explicit doctor removal must clear only requested work and tag");
        check(m.fixed.night[2] === n && m.fixed_tags[`2:night|${n}`] && m.fixed.night_oc[4].includes(n) && m.wishes.night_on[n].includes(8), "other fixed values, tags, OC and wishes must remain");
      });
      test("multi-worker fixed free text preserves excluded records and tags", () => {
        const m = reset({ multi: true }); m.fixed.night[1] = [n, staff]; m.fixed_tags[`1:night|${n}`] = "Synthetic tag"; A.renderFixed();
        check(q(fx(1)).tagName === "INPUT" && q(fx(1)).value.includes(n), "multi-worker records must remain in free text");
        change(fx(2), staff); check(m.fixed.night[1].includes(n) && m.fixed.night[1].includes(staff) && m.fixed_tags[`1:night|${n}`] === "Synthetic tag", "multi-worker values and tags must survive unrelated edit");
      });
      test("Japanese and English reserve warnings do not claim OC eligibility without standby or an OC shift", () => {
        reset(); T.setLang("en"); A.renderDoctor(); const note = q(".docnav").textContent;
        check(note.includes("Not eligible for work shifts this month") && note.includes("Still eligible for on-call assignments."), "reserve notes must be translated");
        for (const opts of [{ standby: false }, { oncall: false }]) { reset(opts); check(!q(".docnav").textContent.includes("OC は候補のまま"), "OC note must require standby and OC-enabled shift"); }
        reset({ oncall: false }); A.state.rules.profile.shifts[0] = { id: "day", on: "none", oncall: true }; A.renderDoctor();
        check(!q(".docnav").textContent.includes("OC は候補のまま"), "an unused day shift must not imply OC eligibility");
      });
      test("legacy never / no-unless-needed doctor inputs remain record-only", () => {
        for (const duty of ["never", "no_unless_needed"]) { reset({ duty }); check(choices(cal(1)).includes("night"), "legacy record-only input must remain"); check(!choices(fx(1)).includes(n), "legacy non-candidate must stay out of aggregate new choices"); }
      });
      return out;
    }, !HTML);
    for (const r of results) console.log((r.pass ? "ok   " : "FAIL ") + r.name + (r.error ? ": " + r.error : ""));
    console.log(`reserve UI: ${results.filter(r => r.pass).length} passed, ${results.filter(r => !r.pass).length} failed; pageErrors=${errors.length}, externalRequests=${network.length}`);
    assert.deepStrictEqual(errors, [], "page errors"); assert.deepStrictEqual(network, [], "network requests");
    assert.ok(results.every(r => r.pass), "reserve UI regression failed");
  } finally { await browser.close(); }
})().catch(e => { console.error(e.message); process.exitCode = 1; });

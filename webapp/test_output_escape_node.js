// 架空の施設ラベル・フォントを文字列として出力する（HTML と DOCX/XML）。
const fs = require("fs"), vm = require("vm"), path = require("path"), assert = require("assert"), { execFileSync } = require("child_process");
globalThis.T = {};
vm.runInThisContext(fs.readFileSync(path.join(__dirname, "libs/jszip.min.js"), "utf8"), { filename: "jszip.min.js" });
for (const f of ["i18n.js", "rules-core.js", "model.js", "messages.js", "check.js", "report.js", "docxgen.js"])
  vm.runInThisContext(fs.readFileSync(path.join(__dirname, "src", f), "utf8"), { filename: f });
for (const f of fs.readdirSync(path.join(__dirname, "src/rules")).filter(f => f.endsWith(".js")).sort())
  vm.runInThisContext(fs.readFileSync(path.join(__dirname, "src/rules", f), "utf8"), { filename: "rules/" + f });
for (const f of ["ja.json", "en.json"]) T.registerLang(JSON.parse(fs.readFileSync(path.join(__dirname, "lang", f), "utf8")));
let passed = 0, failed = 0;
async function test(name, fn) { try { await fn(); passed++; console.log("ok " + name); } catch (e) { failed++; console.error("FAIL " + name + ": " + e.message); } }
const payload = kind => `${kind} & "label" <svg onload="globalThis.__outputEvent=1"></svg><script>globalThis.__outputScript=1</script>`;
const shiftLabel = payload("Synthetic shift"), chargeLabel = payload("Synthetic charge"), otherLabel = payload("Synthetic other");
function fixture(font) {
  const R = {
    profile: { id: "synthetic-output-escape", roles: [
      { id: "I", label: chargeLabel, refs: ["charge"], standby: true },
      { id: "A", label: otherLabel, refs: ["other"] },
    ], shifts: [{ id: "day", label: shiftLabel, on: "all" }, { id: "night", label: "Synthetic night", on: "all" }] },
    doctors: [{ name: "Synthetic A", team: "I", quota: 30 }, { name: "Synthetic B", team: "A", quota: 30 }],
    weights: {}, rule_states: {}, docx: font == null ? {} : { font },
    cath_requirement: Object.fromEntries(["Mon", "Tue", "Wed", "Thu", "Fri"].map(d => [d, { I: 0, A_am: 0, A_pm: 0 }])),
  };
  T.fillDefaultRules(R);
  for (const def of T.RULE_DEFS) if ((def.states || []).includes("off")) R.rule_states[def.id] = "off";
  const M = T.normalizeMonth({ year: 2026, month: 11, cath_off_days_A: [2, 6], cath_off_days_I: [5, 6] }, R);
  const P = new T.Problem(R, M), asg = Object.fromEntries(P.slots.map((s, i) => [T.Problem.key(s), { work: R.doctors[i % 2].name, oc: [] }]));
  assert.strictEqual(T.check(P, asg).V.length, 0, "架空の割当は必須条件を満たす");
  return { P, asg };
}
(async () => {
  for (const lang of ["ja", "en"]) await test(`HTML ${lang}: 概要・配置不要のラベルを文字列として出す`, () => {
    T.setLang(lang);
    const { P, asg } = fixture(), status = 'Synthetic & "status" <text>', rep = T.buildReport(P, asg, { status });
    const overview = rep.sections.find(s => s.id === "s0").html.split("<details>")[0], placement = rep.sections.find(s => s.id === "s8").html;
    assert(overview.includes(T.esc(shiftLabel)), "概要の勤務帯ラベルをエスケープ");
    assert(overview.includes(T.esc(status)), "既存の状態文字列は二重エスケープしない");
    const cells = [...placement.matchAll(/<td>([\s\S]*?)<\/td>/g)].map(m => m[1]);
    for (const label of [chargeLabel, otherLabel]) assert(cells.some(c => c.includes(T.esc(label))), "配置不要の役割名をセル内でエスケープ");
    for (const s of rep.sections) assert(!/<(?:script|svg)\b/.test(s.html), "どの節でもラベルから要素を作らない");
  });
  for (const template of ["week_block", "month_table"]) await test(`DOCX ${template}: 全XMLの整形式とフォント値を保持`, async () => {
    T.setLang("ja");
    const font = 'R&D "Sans" <日本語> \'Test\'\u0001', expectedFont = font.replace("\u0001", ""), { P, asg } = fixture(font);
    const blob = await T.makeDocx(P, asg, "Synthetic & <label>", { template, today: "2026-01-01T00:00:00Z" });
    const zip = await JSZip.loadAsync(await blob.arrayBuffer()), files = {};
    for (const name of Object.keys(zip.files).filter(n => /\.(xml|rels)$/.test(n))) files[name] = await zip.file(name).async("string");
    assert.strictEqual(Object.keys(files).length, 5, "本体・スタイル・関連・型定義をすべて検証");
    // XML パーサーで実際に復元した属性・本文を検証する。文字列の置換だけでは判定しない。
    const result = execFileSync("python3", ["-c", [
      "import json, sys, xml.etree.ElementTree as ET",
      "data = json.load(sys.stdin)",
      "ns = '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'",
      "try:",
      " roots = {name: ET.fromstring(xml) for name, xml in data['files'].items()}",
      " for name in ['word/document.xml', 'word/styles.xml']:",
      "  fonts = list(roots[name].iter(ns + 'rFonts'))",
      "  assert fonts, name + ': font nodes missing'",
      "  assert all(node.get(ns + key) == data['font'] for node in fonts for key in ['ascii', 'hAnsi', 'eastAsia']), name + ': font value changed'",
      " texts = [node.text or '' for node in roots['word/document.xml'].iter(ns + 't')]",
      " assert data['shift'] in texts, 'shift label text changed'",
      " print('PASS')",
      "except (ET.ParseError, AssertionError) as err:",
      " print(type(err).__name__ + ': ' + str(err))",
    ].join("\n")], { input: JSON.stringify({ files, font: expectedFont, shift: shiftLabel }), encoding: "utf8" }).trim();
    assert.strictEqual(result, "PASS", result);
  });
  let chromium; try { ({ chromium } = require(path.join(process.env.HOME, ".toban-test/node_modules/playwright"))); } catch (e) { console.log("-- 出力HTMLのブラウザ試験は省略（Playwright が無い）"); }
  if (chromium && fs.existsSync("/Applications/Google Chrome.app")) await test("実ブラウザ: HTMLのラベルを表示しスクリプト・イベントを実行しない", async () => {
    const browser = await chromium.launch({ channel: "chrome", headless: true });
    try {
      const context = await browser.newContext(), requests = [], errors = [];
      await context.route(/^https?:/, r => { requests.push(r.request().url()); return r.abort(); });
      const page = await context.newPage(); page.on("pageerror", e => errors.push(e.message));
      for (const lang of ["ja", "en"]) {
        T.setLang(lang); const { P, asg } = fixture();
        await page.setContent(T.reportHtml(P, asg), { waitUntil: "load" });
        const result = await page.evaluate(labels => ({
          elements: document.querySelectorAll("svg,script").length,
          executed: !!(globalThis.__outputEvent || globalThis.__outputScript),
          labels: labels.every(label => document.body.textContent.includes(label)),
        }), [shiftLabel, chargeLabel, otherLabel]);
        assert.strictEqual(result.elements, 0, "ラベルは要素にならない");
        assert.strictEqual(result.executed, false, "スクリプトもイベント属性も実行されない");
        assert.strictEqual(result.labels, true, "元のラベル文字列をそのまま表示");
      }
      assert.strictEqual(errors.length, 0, "ページ内エラーなし");
      assert.strictEqual(requests.length, 0, "外部要求なし");
      console.log("  pageErrors=0 externalRequests=0");
    } finally { await browser.close(); }
  });
  else if (chromium) console.log("-- 出力HTMLのブラウザ試験は省略（Google Chrome が無い）");
  console.log(`output escaping: ${passed} pass, ${failed} fail`);
  if (failed) process.exitCode = 1;
})().catch(e => { console.error(e.stack || e); process.exitCode = 1; });

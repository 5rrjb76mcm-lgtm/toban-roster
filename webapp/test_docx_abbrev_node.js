// 同じ敬称なし氏名の職員も、DOCX の不可日欄で区別する（架空名のみ）。
const fs = require("fs"), vm = require("vm"), path = require("path"), assert = require("assert"), { execFileSync } = require("child_process");
globalThis.T = {};
for (const f of ["i18n.js", "rules-core.js", "model.js", "messages.js", "check.js", "docxgen.js"])
  vm.runInThisContext(fs.readFileSync(path.join(__dirname, "src", f), "utf8"), { filename: f });
for (const f of fs.readdirSync(path.join(__dirname, "src/rules")).filter(f => f.endsWith(".js")).sort())
  vm.runInThisContext(fs.readFileSync(path.join(__dirname, "src/rules", f), "utf8"), { filename: "rules/" + f });
T.registerLang(JSON.parse(fs.readFileSync(path.join(__dirname, "lang/ja.json"), "utf8")));
let passed = 0, failed = 0;
function test(name, fn) { try { fn(); passed++; console.log("ok " + name); } catch (e) { failed++; console.error("FAIL " + name + ": " + e.message); } }

test("既存の異なる氏名は短い略称を保つ", () => {
  assert.deepStrictEqual(T.docx.abbrev(["Dr Alpha", "Dr Alpine", "Ns Bravo", "😀 Alpha", "😀 Bravo"]), {
    "Dr Alpha": "Alph", "Dr Alpine": "Alpi", "Ns Bravo": "B", "😀 Alpha": "😀 A", "😀 Bravo": "😀 B",
  });
});

test("敬称を外すと同じになる氏名にも一意の略称を付ける", () => {
  const names = ["Dr Alpha", "Ns Alpha", "Alpha", "Synthetic Bravo"], got = T.docx.abbrev(names);
  assert.strictEqual(new Set(Object.values(got)).size, names.length);
  for (const n of names.slice(0, 3)) assert.strictEqual(got[n], n, "区別できない場合は氏名をそのまま示す");
  assert.strictEqual(got["Synthetic Bravo"], "S", "関係のない人の略称は変えない");
});

test("氏名に戻した結果が別の略称と重なっても区別する", () => {
  const names = ["Dr Alpha", "Ns Alpha", "Mr Dr AlphaQ", "Mr Dr AlphoQ"], got = T.docx.abbrev(names);
  assert.strictEqual(new Set(Object.values(got)).size, names.length);
  assert.strictEqual(got["Dr Alpha"], "Dr Alpha");
  assert.strictEqual(got["Mr Dr AlphaQ"], "Mr Dr AlphaQ");
});

test("DOCX不可日セルで片方の不可と両者の不可を読み分けられる", () => {
  const names = ["Dr Alpha", "Ns Alpha", "Synthetic Bravo"], R = {
    profile: { id: "synthetic-abbreviation", roles: [{ id: "S", label: "Synthetic staff" }], calendar: { holidays: "none" } },
    doctors: names.map(name => ({ name, team: "S", quota: 10 })), name_order: names, weights: {}, rule_states: {},
  };
  T.fillDefaultRules(R); for (const def of T.RULE_DEFS) if (def.states.includes("off")) R.rule_states[def.id] = "off";
  const M = T.normalizeMonth({ year: 2026, month: 11, unavailable_night: { "Dr Alpha": [2, 4], "Ns Alpha": [3, 4] } }, R);
  const P = new T.Problem(R, M), asg = Object.fromEntries(P.slots.map(s => [T.Problem.key(s), { work: names[2], oc: [] }]));
  assert.strictEqual(T.check(P, asg).V.length, 0);
  const xml = T.docxXml(P, asg, "Synthetic", { template: "week_block", today: "2026-11-01" });
  const parsed = execFileSync("python3", ["-c", [
    "import json,sys,xml.etree.ElementTree as ET",
    "ns={'w':'http://schemas.openxmlformats.org/wordprocessingml/2006/main'}",
    "root=ET.fromstring(sys.stdin.read())",
    "rows=root.findall('.//w:tbl/w:tr',ns)",
    "print(json.dumps([''.join(c.itertext()) for c in rows[5].findall('w:tc',ns)]))",
  ].join("\n")], { input: xml, encoding: "utf8" });
  const cells = JSON.parse(parsed);
  assert.strictEqual(cells[2], "Dr Alpha", "11/2 の不可者");
  assert.strictEqual(cells[3], "Ns Alpha", "11/3 の不可者");
  assert.strictEqual(cells[4], "Dr Alpha・Ns Alpha", "11/4 は両者とも不可");
});
console.log(`docx abbreviations: ${passed} pass, ${failed} fail`);
if (failed) process.exitCode = 1;

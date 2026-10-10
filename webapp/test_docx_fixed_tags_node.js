// Fictional fixed work tags must survive the default and monthly DOCX export.
const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert');
const { execFileSync } = require('child_process');
globalThis.location = { pathname: '/synthetic/toban.html', protocol: 'file:', href: 'file:///synthetic/toban.html' };
const elements = new Map();
globalThis.document = { querySelector: s => elements.get(s) || null, querySelectorAll: () => [], addEventListener() {} };
globalThis.window = globalThis;
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.T = {};
vm.runInThisContext(fs.readFileSync(path.join(__dirname, 'libs/jszip.min.js'), 'utf8'));
for (const f of ['i18n.js', 'rules-core.js', 'model.js', 'messages.js', 'check.js', 'report.js', 'docxgen.js', 'app-core.js', 'app-input.js', 'app-folder.js', 'app-solve.js'])
  vm.runInThisContext(fs.readFileSync(f === 'docxgen.js' && process.env.TOBAN_DOCX_SOURCE || path.join(__dirname, 'src', f), 'utf8'), { filename: f });
for (const f of fs.readdirSync(path.join(__dirname, 'src/rules')).filter(f => f.endsWith('.js')).sort())
  vm.runInThisContext(fs.readFileSync(path.join(__dirname, 'src/rules', f), 'utf8'), { filename: f });
const clone = o => JSON.parse(JSON.stringify(o)), A = T.app;
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

// Selection/event adapter only: render and read the real application controls; no browser.
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

const names = ['Synthetic Alpha', 'Synthetic Beta', 'Synthetic Gamma', 'Synthetic Delta'];
const tagFor = (kind, n) => `${kind} ${n}: Synthetic training & <special> "long label" 日本語`;
(async () => {
  for (const count of [1, 2]) for (const template of ['week_block', 'month_table']) {
    const R = { profile: { id: 'synthetic-fixed-tags', roles: [{ id: 'S', label: 'Staff' }], shifts: [{ id: 'day', on: 'all' }, { id: 'night', on: 'all' }], positions: { work: { count } } }, doctors: names.map(name => ({ name, team: 'S', quota: 15 })), weights: {}, rule_states: {}, docx: { template } };
    T.fillDefaultRules(R); for (const def of T.RULE_DEFS) if (def.states.includes('off')) R.rule_states[def.id] = 'off';
    const M = T.normalizeMonth({ year: 2026, month: 11 }, R), P0 = new T.Problem(R, M);
    const asg = Object.fromEntries(P0.slots.map(s => [s.join(':'), { work: count === 1 ? names[s[1] === 'day' ? 0 : 2] : names.slice(s[1] === 'day' ? 0 : 2, s[1] === 'day' ? 2 : 4), oc: [] }]));
    for (const kind of ['day', 'night']) {
      M.fixed[kind][2] = clone(asg['2:' + kind].work);
      for (const n of [].concat(M.fixed[kind][2])) M.fixed_tags['2:' + kind + '|' + n] = tagFor(kind, n);
    }
    if (count === 2) {
      // Exercise the real rendered fixed grid and its change handler before save/export.
      M.fixed.day = {}; M.fixed.night = {}; M.fixed_tags = {};
      Object.assign(A.state, { rules: R, month: M, result: null }); A.save = () => {};
      const grid = pane(); elements.set('#fixedPane', grid); A.bindFixed(); A.renderFixed();
      for (const kind of ['day', 'night']) {
        const el = grid.querySelector(`input[data-fx="${kind}"][data-d="2"]`);
        assert(el, 'rendered multiworker fixed input');
        el.value = asg['2:' + kind].work.map(n => n + '(' + tagFor(kind, n) + ')').join('・');
        grid.handlers.change({ target: el });
        for (const n of asg['2:' + kind].work) assert.strictEqual(M.fixed_tags['2:' + kind + '|' + n], tagFor(kind, n), 'UI readback retains tag');
      }
      A.renderFixed(); grid.handlers.change({ target: grid.controls[0] });
      elements.clear();
    }
    M.fixed_tags['3:night|' + names[2]] = 'Synthetic orphan';
    Object.assign(A.state, { rules: R, month: M, result: { asg, status: 'Synthetic checked assignment' } });
    const before = JSON.stringify([R, M, asg]);
    const prep = await A.prepareSave('2026-10-01T00:00:00Z');
    assert.strictEqual(prep.docs.length, 2, prep.note);
    const zip = await JSZip.loadAsync(await prep.docs[0].blob.arrayBuffer());
    const files = {}; for (const name of Object.keys(zip.files).filter(n => /\.(xml|rels)$/.test(n))) files[name] = await zip.file(name).async('string');
    const xml = files['word/document.xml'], html = await prep.docs[1].blob.text();
    for (const kind of ['day', 'night']) for (const n of [].concat(M.fixed[kind][2])) {
      assert(xml.includes(T.esc(n + '(' + tagFor(kind, n) + ')')), `${template}/${count}/${kind}: fixed tag missing`);
      assert(html.includes(T.esc(n + '(' + tagFor(kind, n) + ')')), 'HTML and DOCX agree');
    }
    assert(!xml.includes('Synthetic orphan'), 'orphan tag must not appear');
    const rows = JSON.parse(execFileSync('python3', ['-c', `import sys,xml.etree.ElementTree as E,json
ns={'w':'http://schemas.openxmlformats.org/wordprocessingml/2006/main'}
r=E.fromstring(sys.stdin.read())
print(json.dumps([[''.join(c.itertext()) for c in row.findall('w:tc',ns)] for row in r.findall('.//w:tbl',ns)[0].findall('w:tr',ns)]))`], { input: xml, encoding: 'utf8' }));
    // November 2026 starts Sunday: day 2 is column 2 in the first week block.
    for (const kind of ['day', 'night']) {
      const expected = [].concat(M.fixed[kind][2]).map(n => n + '(' + tagFor(kind, n) + ')').join(template === 'week_block' ? '・' : T.nameSep());
      const actual = template === 'week_block' ? rows[kind === 'day' ? 2 : 3][2] : rows[2][kind === 'day' ? 1 : 2];
      assert.strictEqual(actual, expected, `${template}: correct day-2 ${kind} cell and person/tag mapping`);
    }
    const parsed = execFileSync('python3', ['-c', 'import sys,json,xml.etree.ElementTree as E; f=json.load(sys.stdin); [E.fromstring(x) for x in f.values()]; print(len(f))'], { input: JSON.stringify(files), encoding: 'utf8' }).trim();
    assert.strictEqual(parsed, '5', 'all five XML/rels parts parse');
    assert.strictEqual(JSON.stringify([R, M, asg]), before, 'export does not mutate inputs');
    console.log(`PASS ${template}, ${count} worker(s): day/night tags, escaping, orphan exclusion, saved DOCX/HTML, 5 XML parts`);
  }
})().catch(e => { console.error(e.stack || e); process.exitCode = 1; });

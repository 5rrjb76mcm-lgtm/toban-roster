// Production header renderer with a minimal DOM adapter (no browser layout claim).
const fs = require('fs'), vm = require('vm'), path = require('path'), assert = require('assert');
const elements = new Map();
const el = s => { if (!elements.has(s)) elements.set(s, { innerHTML: '', value: '', addEventListener() {} }); return elements.get(s); };
globalThis.location = { pathname: '/synthetic/toban.html' };
globalThis.document = { querySelector: el }; globalThis.T = {};
for (const f of ['i18n.js', 'rules-core.js', 'model.js', 'app-core.js', 'app-folder.js']) vm.runInThisContext(fs.readFileSync(path.join(__dirname, 'src', f), 'utf8'), { filename: f });
const A = T.app; A.monthDirs = ['202610', '202611']; A.isDirty = () => true;
A.state.rules = { profile: { id: 'synthetic', label: 'Synthetic facility' } };
for (const [year, month] of [[2026, 11], [2027, 1]]) {
  A.state.month = { year, month }; A.renderHeader(); const html = el('#monthTitle').innerHTML;
  assert.match(html, /class="editing-month"/); assert.match(html, /編集中/);
  assert.ok(html.includes(`value="${year}${String(month).padStart(2, '0')}" selected`));
  assert.ok(html.includes(`${year}年${month}月`)); assert.match(html, /aria-label="編集中の年月/);
}
const css = fs.readFileSync(path.join(__dirname, 'src/style.css'), 'utf8');
// The emphasis must not make the header taller or wider: the label and the selector share the footprint of the former selector (9.5em wide, 1px border, no extra padding or wrapping).
const rule = selector => { const i = css.indexOf(selector + '{'); assert.ok(i >= 0, selector); return css.slice(i + selector.length + 1, css.indexOf('}', i)); };
const box = rule('#monthTitle .editing-month'), label = rule('#monthTitle .editing-month>span'), select = rule('#monthTitle .editing-month select');
assert.match(box, /(^|;)width:9\.5em(;|$)/); assert.match(box, /box-sizing:border-box/); assert.match(box, /border:1px solid #9a6700/); assert.doesNotMatch(box, /padding|flex-wrap/);
assert.match(label, /font-weight:bold/); assert.match(label, /white-space:nowrap/); assert.match(select, /(^|;)border:0(;|$)/); assert.match(select, /min-width:0/);
for (const width of ['1200px', '1080px']) assert.match(css, new RegExp('@media \\(max-width:' + width + '\\)\\{[^@]*#monthTitle select,#monthTitle \\.editing-month\\{font-size:'), 'the box follows the selector font at ' + width);
function luminance(hex) { const v = hex.match(/\w\w/g).map(x => parseInt(x, 16)/255).map(x => x <= .04045 ? x/12.92 : ((x+.055)/1.055)**2.4); return .2126*v[0]+.7152*v[1]+.0722*v[2]; }
const ratio = (bg, fg) => (luminance(bg)+.05)/(luminance(fg)+.05), contrast = ratio('fff1b8', '533800'), labelContrast = ratio('ffd666', '533800');
assert.match(box, /background:#fff1b8;color:#533800/); assert.match(label, /background:#ffd666/); assert.ok(contrast >= 4.5 && labelContrast >= 4.5);
console.log(`PASS editing year/month, text+color, accessible label, compact footprint CSS, contrast ${contrast.toFixed(2)}:1 (label ${labelContrast.toFixed(2)}:1) (DOM adapter; browser layout is not measured here)`);

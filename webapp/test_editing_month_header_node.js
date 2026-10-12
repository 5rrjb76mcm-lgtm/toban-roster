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
assert.match(css, /#monthTitle\{[^}]*flex-wrap:wrap[^}]*max-width:100%/);
assert.match(css, /\.editing-month\{[^}]*flex-wrap:wrap[^}]*max-width:100%/);
function luminance(hex) { const v = hex.match(/\w\w/g).map(x => parseInt(x, 16)/255).map(x => x <= .04045 ? x/12.92 : ((x+.055)/1.055)**2.4); return .2126*v[0]+.7152*v[1]+.0722*v[2]; }
const contrast = (luminance('fff1b8')+.05)/(luminance('533800')+.05); assert.ok(contrast >= 4.5);
console.log(`PASS editing year/month, text+color, accessible label, wrapping CSS, contrast ${contrast.toFixed(2)}:1 (DOM adapter; narrow browser layout unverified)`);

// C01: capacity-aware competing fixed-worker choices. Synthetic data only.
// Authored/static reviewed in cloud; NOT executed there. Legacy API is unchanged.
// Uses actual merge + autosave/checkConflict, substituting DOM and folder I/O only.
const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert/strict');
const root = process.env.TOBAN_WEBAPP_ROOT || __dirname;
globalThis.location = { pathname: '/synthetic/single-fixed-merge.html' };
globalThis.localStorage = { getItem: () => null, setItem() {} };
globalThis.document = { querySelector: () => null, querySelectorAll: () => [] }; globalThis.T = {};
for (const f of ['i18n.js','rules-core.js','model.js','messages.js','check.js','plugins.js','merge.js','app-core.js','app-folder.js'])
  vm.runInThisContext(fs.readFileSync(path.join(root, 'src', f), 'utf8'), { filename: f });
for (const f of fs.readdirSync(path.join(root, 'src/rules')).filter(f => f.endsWith('.js')).sort())
  vm.runInThisContext(fs.readFileSync(path.join(root, 'src/rules', f), 'utf8'), { filename: f });
const A = T.app, clone = x => JSON.parse(JSON.stringify(x)), names = ['Synthetic A','Synthetic B','Synthetic C'];
for (const key of ['renderHeader','renderAll','readAll','toast','showTab','save','clearUndo']) A[key] = () => {};
globalThis.alert = text => { throw new Error(text); };
function rules(count = 1) {
  const R = { profile: { id: 'synthetic-fixed-choice', roles: [{ id: 'S', label: 'Staff', refs: [] }],
    shifts: [{ id: 'day', on: 'all' }, { id: 'night', on: 'all' }], positions: { work: { count } } },
    doctors: names.map(name => ({ name, team: 'S' })), rule_states: { oncall: 'off', period_charge: 'off' } };
  T.fillDefaultRules(R); return R;
}
function month() { return T.normalizeMonth({ year: 2026, month: 11, next_first_day_in_calendar: true, holidays: [] }, rules()); }
function triple(kind = 'night', day = 5) {
  const b = month(); b.fixed[kind][day] = names[0]; const a = clone(b), c = clone(b);
  a.fixed[kind][day] = names[1]; c.fixed[kind][day] = names[2]; a.notes = 'local note'; c.day_notes[9] = 'peer note'; return [b,a,c];
}
const members = (m, kind = 'night', day = 5) => [].concat(m.fixed[kind][day] || []).slice().sort();
const opts = R => ({ fixedWorkCapacity: (m,d,k) => new T.Problem(R,m).countOf([d,k]) });
const EXPECTED = 33; let passed = 0, completed = 0, finished = false;
const watchdog = setTimeout(() => { console.error('C01 incomplete/timeout'); process.exit(1); }, 60000);
process.on('exit', () => { if (!finished || completed !== EXPECTED || passed !== EXPECTED) process.exitCode = 1; });
async function test(label, fn) { completed++; try { await fn(); passed++; console.log('PASS ' + label); } catch (e) { console.error('FAIL ' + label + '\n' + e.stack); } }
async function folder({ kind = 'night', day = 5, choice = 'mine', count = 1, calendar = false, failCapacity = false, peerCount = null } = {}) {
  const [b,a,c] = triple(kind,day), R = rules(count);
  if (calendar) { a.holidays = [5]; c.holidays = []; b.holidays = [6]; }
  Object.assign(A.state, { rules: R, month: b, result: null, ui: {}, meta: null, base: null, baseRules: null, renames: [] });
  let disk = '', writes = 0, pending = null;
  const dir = { name: 'Synthetic folder', async getDirectoryHandle() { return dir; }, async getFileHandle(name, options = {}) {
    assert.equal(name, '202611_data.json');
    if (!disk && !options.create) throw Object.assign(new Error('Missing synthetic file'), { name: 'NotFoundError' });
    return { getFile: async () => ({ text: async () => disk }), createWritable: async () => ({
      write: async blob => { pending = await blob.text(); }, close: async () => { disk = pending; pending = null; writes++; }
    }) };
  } };
  A.dirHandle = dir; A.dirGen++; A.monthDirs = ['202611']; A.markSaved('フォルダ Synthetic folder', '2026-10-01T00:00:00Z');
  const peer = JSON.parse(A.payloadJson('2026-10-02T00:00:00Z')); peer.month = c;
  if (peerCount !== null) peer.rules = rules(peerCount);
  disk = JSON.stringify(peer); A.state.month = a;
  const before = JSON.stringify(A.state), beforeDisk = disk, calls = [];
  A.choose = async (message, choices) => { calls.push({ message, choices }); return choice; };
  const Problem = T.Problem;
  if (failCapacity) T.Problem = class { constructor() { throw new Error('Synthetic capacity failure'); } };
  let status; try { status = await A.autosaveJson(); } finally { T.Problem = Problem; }
  return { status, calls, writes, disk: JSON.parse(disk), beforeDisk, before, current: A.state.month };
}
(async () => {
  for (const kind of ['day','night']) for (const day of [5,7,31]) for (const prefer of ['mine','theirs']) await test(`${kind}/${day}: distinct replacements ${prefer}`, () => {
    const ms = triple(kind,day), original = JSON.stringify(ms), r = T.mergeMonth(...ms, prefer, opts(rules()));
    assert.equal(r.conflicts.length,1); assert.deepEqual(members(r.merged,kind,day), [names[prefer === 'mine' ? 1 : 2]]);
    assert.equal(r.merged.notes,'local note'); assert.equal(r.merged.day_notes[9],'peer note'); assert.equal(JSON.stringify(ms),original);
  });
  for (const prefer of ['mine','theirs']) await test('delete versus replace ' + prefer, () => {
    const ms = triple(); delete ms[1].fixed.night[5]; const r = T.mergeMonth(...ms,prefer,opts(rules()));
    assert.equal(r.conflicts.length,1); assert.deepEqual(members(r.merged),prefer === 'mine' ? [] : [names[2]]);
  });
  await test('identical replacement', () => { const ms=triple(); ms[2].fixed.night[5]=names[1]; const r=T.mergeMonth(...ms,'mine',opts(rules())); assert.equal(r.conflicts.length,0); assert.deepEqual(members(r.merged),[names[1]]); });
  await test('independent dates', () => { const ms=triple(); ms[2].fixed.night[5]=names[0]; ms[2].fixed.night[6]=names[2]; const r=T.mergeMonth(...ms,'mine',opts(rules())); assert.equal(r.conflicts.length,0); assert.deepEqual(members(r.merged),[names[1]]); assert.equal(r.merged.fixed.night[6],names[2]); });
  await test('set order is not a change', () => { const ms=triple(); ms[0].fixed.night[5]=[names[0],names[1]]; ms[1].fixed.night[5]=[names[1],names[0]]; const r=T.mergeMonth(...ms,'mine',{fixedWorkCapacity(){throw new Error('Order-only must not ask capacity');}}); assert.equal(r.conflicts.length,0); });
  await test('multiworker independent union', () => { const ms=triple(); delete ms[0].fixed.night[5]; const r=T.mergeMonth(...ms,'mine',opts(rules(2))); assert.equal(r.conflicts.length,0); assert.deepEqual(members(r.merged),names.slice(1)); });
  await test('legacy four-argument union unchanged', () => { const r=T.mergeMonth(...triple(),'mine'); assert.equal(r.conflicts.length,0); assert.deepEqual(members(r.merged),names.slice(1)); });
  for (const prefer of ['mine','theirs']) await test('calendar choice cannot hide single-slot conflict ' + prefer, () => {
    const ms=triple();
    // A one-sided holiday deletion makes this merged weekday single-capacity,
    // even though the base and peer calendars described a multiworker holiday.
    const R=rules({weekday:1,off_days:2}); ms[0].holidays=[5]; ms[1].holidays=[]; ms[2].holidays=[5];
    const r=T.mergeMonth(...ms,prefer,opts(R)); assert.equal(r.conflicts.filter(c=>c.key.startsWith('fixedwork:')).length,1);
    assert.deepEqual(members(r.merged),[names[prefer==='mine'?1:2]]);
  });
  await test('capacity failure does not mutate inputs', () => { const ms=triple(), before=JSON.stringify(ms); assert.throws(()=>T.mergeMonth(...ms,'mine',{fixedWorkCapacity(){throw new Error('capacity');}}),/capacity/); assert.equal(JSON.stringify(ms),before); });
  await test('delimiter names and tag choice scope', () => {
    const ms=triple(), mine='Synthetic: Mine|test', peer='Synthetic: Peer|test'; ms[1].fixed.night[5]=mine; ms[2].fixed.night[5]=peer;
    ms[1].fixed_tags={['5:night|'+mine]:'mine tag',['6:night|'+peer]:'other slot','5:night|Orphan':'unrelated orphan'};
    ms[2].fixed_tags={['5:night|'+peer]:'peer tag'};
    const r=T.mergeMonth(...ms,'mine',{fixedWorkCapacity:()=>1}); assert.deepEqual(members(r.merged),[mine]);
    assert.equal(r.merged.fixed_tags['5:night|'+mine],'mine tag'); assert(!Object.hasOwn(r.merged.fixed_tags,'5:night|'+peer)); assert.equal(r.merged.fixed_tags['6:night|'+peer],'other slot'); assert.equal(r.merged.fixed_tags['5:night|Orphan'],'unrelated orphan');
  });
  for (const kind of ['day','night']) for (const choice of ['mine','theirs']) await test('autosave conflict choice ' + kind + ' ' + choice, async () => {
    const r=await folder({kind,choice}); assert.equal(r.status,'saved'); assert.equal(r.calls.length,1); assert(r.calls[0].choices.some(x=>x.value==='mine'));
    assert.deepEqual(members(r.disk.month,kind),[names[choice==='mine'?1:2]]); assert.equal(r.writes,1); assert.equal(r.disk.month.notes,'local note'); assert.equal(r.disk.month.day_notes[9],'peer note'); assert.equal(A.isDirty(),false);
  });
  await test('autosave cancel preserves disk and all state',async()=>{const r=await folder({choice:null});assert.equal(r.status,'skipped');assert.equal(r.calls.length,1);assert.equal(r.writes,0);assert.equal(JSON.stringify(r.disk),r.beforeDisk);assert.equal(JSON.stringify(A.state),r.before);});
  await test('autosave multiworker union needs no choice',async()=>{const r=await folder({count:2});assert.equal(r.status,'saved');assert.equal(r.calls.length,0);assert.deepEqual(members(r.disk.month),names.slice(1));});
  await test('autosave capacity failure returns whole-version choice',async()=>{const r=await folder({failCapacity:true,choice:null});assert.equal(r.status,'skipped');assert.equal(r.calls.length,1);assert(r.calls[0].choices.some(x=>x.value==='overwrite'));assert.equal(r.writes,0);assert.equal(JSON.stringify(A.state),r.before);});
  await test('autosave capacity follows merged holidays',async()=>{const r=await folder({count:{weekday:1,off_days:2},calendar:true});assert.equal(r.status,'saved');assert.equal(r.calls.length,0);assert.deepEqual(members(r.disk.month),names.slice(1));assert.deepEqual(r.disk.month.holidays,[5]);});
  await test('autosave next-month first day choice',async()=>{const r=await folder({day:31,choice:'theirs'});assert.equal(r.status,'saved');assert.equal(r.calls.length,1);assert.deepEqual(members(r.disk.month,'night',31),[names[2]]);});
  await test('autosave chosen peer settings allow multiworker union',async()=>{const r=await folder({peerCount:2});assert.equal(r.status,'saved');assert.equal(r.calls.length,0);assert.deepEqual(members(r.disk.month),names.slice(1));assert.equal(A.state.rules.profile.positions.work.count,2);});
  assert.equal(completed,EXPECTED); assert.equal(passed,EXPECTED); finished=true; clearTimeout(watchdog); console.log(`C01 ${passed}/${EXPECTED} cases passed`);
})().catch(e=>{console.error(e.stack);clearTimeout(watchdog);process.exitCode=1;});

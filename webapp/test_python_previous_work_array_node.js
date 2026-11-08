// Synthetic prior-worker array checks for frozen Python CP-SAT and JS.
// node test_python_fixed_only_contract_node.js <path/to/highs> [path/to/python]
// TOBAN_WEBAPP_ROOT/TOBAN_PYTHON_ROOT can target the unchanged source for a red run.
const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert/strict'), { execFileSync } = require('child_process');
const root = process.env.TOBAN_WEBAPP_ROOT || __dirname;
globalThis.T = {};
const load = f => vm.runInThisContext(fs.readFileSync(path.join(root, 'src', f), 'utf8'), { filename: f });
for (const f of ['i18n.js', 'rules-core.js', 'model.js', 'messages.js', 'solver.js', 'check.js']) load(f);
for (const dir of ['rules', 'calendars']) for (const f of fs.readdirSync(path.join(root, 'src', dir)).filter(x => x.endsWith('.js')).sort()) load(`${dir}/${f}`);
let finished = false; // completion guard: a run that stops before the summary (a never-resolving await drains the event loop with exit 0) must not pass
process.on('exit', () => { if (!finished) { console.error('previous-work array contract did not complete'); process.exitCode = 1; } });
(async () => {
  const highs = await require(process.argv[2] || 'highs')();
  const py = process.argv[3] || path.join(__dirname, '../tools/.venv/bin/python');
  const cases = JSON.parse(execFileSync(py, [path.join(__dirname, '../tools/test_previous_work_array.py'), '--cases'], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 }));
  assert.equal(cases.length, 27, 'all synthetic cases registered');
  let failed = 0, completed = 0;
  for (const x of cases) {
    try {
      const P = new T.Problem(x.rules, x.month), c = T.check(P, x.asg), r = T.solve(P, highs, { pin: x.asg, timeLimit: 10, mipGap: 0 }), pen = T.penalty(P, x.asg);
      const got = { hard: c.V.length, fixed: c.WC.length, objective: Number.isFinite(r.objective) ? r.objective : null };
      assert.deepEqual(x.python, x.expected, 'Python checker/score differs from independently stated expected result');
      if (x.label.startsWith('cath ')) {
        // The core no longer registers a cath solver rule; its report still exposes
        // the specialist availability table. Compare that directly, not a false
        // claim of solver/check parity for the missing facility plugin.
        const row = T.cathTable(P, new T.Asg(P, x.asg)).find(v => v.d === 1 && v.half === 'pm');
        assert.equal(row.okI.length, x.expected.hard ? 0 : 1, 'JS cath table');
      } else {
        assert.deepEqual(got, x.expected, `JS checker/score differs: ${c.V.join('; ')}; ${c.WC.map(x => x.code).join('; ')}`);
        assert.equal(r.status, x.expected.hard ? 'Infeasible' : 'Optimal');
        if (!x.expected.hard) assert.equal(pen.total, x.expected.objective, 'JS independent penalty differs');
      }
      if ('relaxed_objective' in x) {
        const relaxed = T.solve(P, highs, { pin: x.asg, timeLimit: 10, mipGap: 0, relax: ['fixed'] });
        assert.equal(x.python_relaxed_objective, x.relaxed_objective, 'Python relaxed fixed proof remains active');
        assert.equal(Number.isFinite(relaxed.objective) ? relaxed.objective : null, x.relaxed_objective, 'JS relaxed fixed objective');
        assert.equal(relaxed.status, x.relaxed_objective === null ? 'Infeasible' : 'Optimal');
      }
      console.log(`OK   ${x.label}`);
    } catch (e) { failed++; console.error(`FAIL ${x.label}: ${e.message}`); }
    finally { completed++; }
  }
  assert.equal(completed, 27, 'all synthetic cases completed');
  console.log(`Python previous-work array contract: ${cases.length - failed}/${cases.length} passed`);
  process.exitCode = failed ? 1 : 0; finished = true;
})().catch(e => { console.error(e); process.exitCode = 1; });

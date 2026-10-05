// Synthetic edge cases: fractional reference floors, independent enumeration, truthful soft-rule reports.
// TOBAN_TEST_ROOT can select an older source tree for before/after validation.
const fs = require('fs'), vm = require('vm'), path = require('path'), assert = require('assert');
const root = process.env.TOBAN_TEST_ROOT || __dirname;
const highsPath = process.argv[2];
if (!highsPath) throw new Error('highs package path is required');
globalThis.T = {
};
for (const f of ['i18n.js', 'rules-core.js', 'model.js', 'messages.js', 'solver.js', 'check.js'])vm.runInThisContext(fs.readFileSync(path.join(root, 'src', f), 'utf8'));
for (const f of fs.readdirSync(path.join(root, 'src/rules'))) if (f.endsWith('.js'))vm.runInThisContext(fs.readFileSync(path.join(root, 'src/rules', f), 'utf8'));
const langs = Object.fromEntries(["ja", "en"].map(code => [code, JSON.parse(fs.readFileSync(path.join(root, "lang", code + ".json"), "utf8"))]));
for (const lang of Object.values(langs)) T.registerLang(lang);
T.setLang("ja");
function prob(t, avoid = false, avoidOn = false, weight = 1000) {
  const R = {
    profile:{
      id:'synthetic-review', quota_mode:'absolute', roles:[{
        id:'S', label:'Staff', refs:[]
      }], shifts:[{
        id:'day', on:'none'
      }, {
        id:'night', on:'all'
      }]
    }, doctors:[{
      name:'Alpha', team:'S', quota:t
    }, {
      name:'Beta', team:'S', quota:30
    }], weights:{
      dayoff_work_no_reduction:weight, avoid_no_reduction:weight
    }, rule_states:{
    }, dayoff_work_max:{
      Alpha:0
    }
  };
  T.fillDefaultRules(R);
  for (const d of T.RULE_DEFS) if (d.states.includes('off'))R.rule_states[d.id] = 'off';
  R.rule_states.dayoff_work_cap = 'soft';
  R.rule_states.avoid_days = avoidOn ? 'soft' : 'off';
  const night = {
  };
  for (let d = 1;
  d <= 30;
  d++)night[d] = d === 2 ? 'Alpha' : 'Beta';
  return new T.Problem(R, T.normalizeMonth({
    year:2026, month:11, holidays:[], fixed:{
      night
    }, avoid:avoid ? [{
      name:'Alpha', day:1, part:'night'
    }] : []
  }, R));
} (async()=>{
  const highs = await require(highsPath)();
  let count = 0;
  for (const floor of [0, 0.1, 0.999999999, 1, 1.000000001, 1.5, 2.1, 29.999999999, 30, 30.5, 100.5]) for (const av of [false, true]) for (const on of [false, true]) for (const w of [0, 1e-7, 1, 1000]) {
    const P = prob(floor, av, on, w);
    const r = await T.solve(P, highs, {
      timeLimit:5, mipGap:0
    });
    const p = T.penalty(P, r.asg);
    if (r.status !== 'Optimal' || Math.abs(r.objective - p.total) > 1e-6) throw Error(JSON.stringify({
      floor, av, on, w, status:r.status, objective:r.objective, p
    }));
    const expected = Math.max(0, floor - 1) * w;
    assert(Math.abs((p.items.dayoff_work_no_reduction || 0) + (p.items.avoid_no_reduction || 0) - expected) < 1e-6);
    count++;
  }console.log('PASS fractional/double-guard matrix ' + count);
  for (const av of [false, true]) for (const on of [false, true]) {
    const P = prob(20.5, av, on);
    const r = await T.solveWithAvoidRef(P, highs, {
      timeLimit:5, mipGap:0
    });
    assert.equal(r.avoidRef.Alpha, 1);
    assert.equal(r.objective, 0);
    assert.equal(T.penalty(P, r.asg, {
      avoidRef:r.avoidRef
    }).total, 0);
  }console.log('PASS two-stage reference four combos');
  let cases = 0, enumCount = 0;
  const free = ['3:night', '7:day', '7:night', '8:day'];
  for (const cap of [0, 1, 2]) for (const floor of [0, 1.5, 2.5, 4.5]) for (const weight of [0, 30, 1000]) {
    const B = prob(floor), R = structuredClone(B.rules), m = structuredClone(B.m);
    R.profile.shifts[0].on = 'all';
    R.profile.roles[0].standby = true;
    R.rule_states.oncall = 'hard';
    R.oncall_requirement = {
      S:{
        S:1
      }
    };
    R.dayoff_work_max.Alpha = cap;
    R.weights.dayoff_work_no_reduction = weight;
    m.holidays = [3];
    m.fixed = {
      day:{
      }, night:{
      }, night_oc:{
        8:['Alpha']
      }
    };
    for (let d = 1;
    d <= 30;
    d++) for (const k of ['day', 'night']) if (!free.includes(d + ':' + k))m.fixed[k][d] = d === 3 && k === 'day' ? 'Alpha' : 'Beta';
    const P = new T.Problem(R, T.normalizeMonth(m, R));
    const r = await T.solve(P, highs, {
      timeLimit:5, mipGap:0
    });
    assert.equal(r.status, 'Optimal');
    assert(r.asg['8:night'].oc.includes('Alpha'));
    let best = Infinity;
    for (let bits = 0;
    bits < 16;
    bits++) {
      let count = 1;
      const weekend = new Set();
      for (let i = 0;
      i < 4;
      i++) if (bits & (1 << i)) {
        count++;
        const d = +free[i].split(':')[0];
        if (new Date(2026, 10, d).getDay() === 0 || new Date(2026, 10, d).getDay() === 6)weekend.add(d);
      } const score = Math.max(0, weekend.size - cap) * 100 + Math.max(0, floor - count) * weight;
      best = Math.min(best, score);
      enumCount++;
    }assert(Math.abs(r.objective - best) < 1e-6, JSON.stringify({
      cap, floor, weight, result:r.objective, best
    }));
    assert(Math.abs(T.penalty(P, r.asg).total - best) < 1e-6);
    cases++;
  }console.log(JSON.stringify({
    passed:cases, enumerated:enumCount, coverage:'Sat/Sun day+night, Tue holiday fixed work ignored, Sun fixed OC ignored; caps0/1/2, fractional targets and weights0/30/1000'
  }));
  // A supported plugin override may disable avoid_days through a dependency,
  // even though its own state is still soft. The cap must then own the shortfall.
  const avoidOriginal = { ...T.RULE_BY_ID.avoid_days };
  const stockLP = T.buildLP(prob(20, true, true)).lp.toLP();
  let dependencyCases = 0;
  try {
    T.rules.register({ id: "local.synthetic.guard", api: 1, states: ["hard", "off"], def: "hard", needs: ["oncall"] });
    for (const transitive of [false, true]) {
      T.rules.register({ ...avoidOriginal, needs: [transitive ? "local.synthetic.guard" : "oncall"] });
      for (const enabled of [false, true]) {
        const base = prob(20, true, true), rules = structuredClone(base.rules);
        rules.rule_states.oncall = enabled ? "hard" : "off";
        rules.rule_states["local.synthetic.guard"] = "hard";
        const dependencyP = new T.Problem(rules, T.normalizeMonth(structuredClone(base.m), rules));
        const result = await T.solve(dependencyP, highs, { timeLimit: 5, mipGap: 0 });
        assert.equal(result.status, "Optimal");
        assert.equal(result.objective, 19000, "Exactly one active rule must charge the 19-shift shortfall");
        const penalty = T.penalty(dependencyP, result.asg);
        assert.equal(penalty.total, 19000);
        assert.equal(penalty.items.avoid_no_reduction || 0, enabled ? 19000 : 0);
        assert.equal(penalty.items.dayoff_work_no_reduction || 0, enabled ? 0 : 19000);
        assert.equal(T.rules.isOn(dependencyP, "avoid_days"), enabled);
        assert.equal(T.rules.isOn(dependencyP, "local.synthetic.missing"), false);
        dependencyCases++;
      }
    }
    // Normal application entry: the reference wants one shift. Without the
    // dependency-aware fallback, the cap can remove it for only target penalties.
    T.rules.register({ ...avoidOriginal, needs: ["oncall"] });
    const twoBase = prob(1, true, true), twoRules = structuredClone(twoBase.rules), twoMonth = structuredClone(twoBase.m);
    twoRules.doctors[1].quota = 29;
    twoRules.rule_states.quota_target = "soft";
    twoMonth.fixed.night[2] = "Beta";
    delete twoMonth.fixed.night[7];
    const twoP = new T.Problem(twoRules, T.normalizeMonth(twoMonth, twoRules));
    const two = await T.solveWithAvoidRef(twoP, highs, { timeLimit: 5, mipGap: 0 });
    assert.equal(two.status, "Optimal");
    assert.equal(two.avoidRef.Alpha, 1, "The reference retains one shift before applying the weekend cap");
    assert.equal(two.asg["7:night"].work, "Alpha", "The disabled avoidance rule must not lose the reference-count guard");
    assert.equal(two.objective, 100, "One excess weekend day is cheaper than a 1000-point shortfall");
    assert.equal(T.penalty(twoP, two.asg, { avoidRef: two.avoidRef }).total, 100);
  } finally {
    T.rules.register(avoidOriginal);
    T.rules.unregister("local.synthetic.guard");
  }
  assert.equal(T.buildLP(prob(20, true, true)).lp.toLP(), stockLP, "Override restoration preserves stock LP");
  console.log("PASS dependency-aware delegation " + dependencyCases);
  const P0 = prob(2, false, false), R = structuredClone(P0.rules), m = structuredClone(P0.m);
  R.doctors[1].quota = 28;
  R.dayoff_work_max.Alpha = 1;
  R.rule_states.consecutive_days = 'soft';
  m.fixed.night[1] = 'Alpha';
  R.rule_states.quota_range = 'hard';
  delete m.fixed.night[2];
  delete m.fixed.night[7];
  m.count_min = {
    Alpha:2, Beta:28
  };
  m.count_max = {
    Alpha:2, Beta:28
  };
  m.avoid = [];
  const P = new T.Problem(R, T.normalizeMonth(m, R));
  const r = await T.solveWithAvoidRef(P, highs, {
    timeLimit:5, mipGap:0
  });
  const feasible = structuredClone(r.asg);
  feasible['2:night'].work = 'Alpha';
  feasible['7:night'].work = 'Beta';
  const def = T.RULE_BY_ID.dayoff_work_cap;
  assert.equal(r.status, 'Optimal');
  assert.equal(r.asg['7:night'].work, 'Alpha');
  assert.equal(T.check(P, feasible).V.length, 0);
  assert.equal(T.penalty(P, feasible, {
    avoidRef:r.avoidRef
  }).items.dayoff_work_excess || 0, 0);
  assert(r.objective < T.penalty(P, feasible, {
    avoidRef:r.avoidRef
  }).total);
  function report(P, asg, opts) {
    const lines = [];
    const ctx = T.rules.checkCtx(P, T.check(P, asg).A, 'report', s=>lines.push(s), opts);
    def.report(ctx, P.prm.dayoff_work_cap);
    return lines.join('\n');
  } const exceeded = report(P, r.asg, {
    avoidRef:r.avoidRef
  });
  assert(!/ほかに手が無い|other choice|no other/i.test(exceeded), 'Soft-cost result must not claim the cap was impossible');
  const ui = def.ui.render(R, {
    esc:x=>x, tx:x=>x
  });
  assert(!/ほかに手が無いときだけ|only when there is no other choice/i.test(ui));
  const Rs = structuredClone(prob(1).rules), ms = structuredClone(prob(1).m);
  Rs.weights.dayoff_work_no_reduction = 0;
  ms.fixed.night[2] = 'Beta';
  delete ms.fixed.night[7];
  const Ps = new T.Problem(Rs, T.normalizeMonth(ms, Rs));
  const rs = await T.solve(Ps, highs, {
    timeLimit:5, mipGap:0
  });
  assert.equal(rs.status, 'Optimal');
  assert.equal(Object.values(rs.asg).filter(v=>v.work === 'Alpha').length, 0);
  const attainable = structuredClone(rs.asg);
  attainable['7:night'].work = 'Alpha';
  assert.equal(T.check(Ps, attainable).V.length, 0);
  for (const opts of [{
    avoidRef:{
      Alpha:1
    }
  }, {
  }]) {
    const text = report(Ps, rs.asg, opts);
    assert(!/他の必須条件のため|hard constraints/i.test(text), 'Shortfall must not claim hard-constraint necessity');
  } for (const code of ["ja", "en"]) {
    T.setLang(code);
    const messages = [report(P, r.asg, { avoidRef: r.avoidRef }),
      report(Ps, rs.asg, { avoidRef: { Alpha: 1 } }), report(Ps, rs.asg, {})];
    const uiText = def.ui.render(R, { esc: x => x, tx: x => T.t(x) });
    assert(!/ほかに手が無い|他の必須条件のため|no other way|no other choice|because of other required rules/i.test(messages.join(" ") + uiText));
    const help = langs[code].help.monthly.html.split("<p").at(-1);
    assert(!/ほかに手が無いときだけ|only when there is no other way|cannot reduce/i.test(help));
    if (code === "en") {
      assert(messages.every(x => !/[\u3040-\u30ff\u4e00-\u9fff]/.test(x)), "Reports must use English translations");
      assert(!/[\u3040-\u30ff\u4e00-\u9fff]/.test(uiText));
      assert(/may be exceeded/.test(uiText));
      assert(/does not guarantee/.test(help));
    } else assert(/減点なので絶対ではありません/.test(help));
  }
  const sourceI = prob(20.5), monthI = structuredClone(sourceI.m);
  monthI.fixed.night[2] = "Beta";
  monthI.fixed.night[7] = "Alpha";
  const Pi = new T.Problem(sourceI.rules, T.normalizeMonth(monthI, sourceI.rules));
  const ignored = await T.solve(Pi, highs, { timeLimit: 5, mipGap: 0, ignoreAvoid: true });
  assert.equal(ignored.status, "Optimal");
  assert.equal(ignored.objective, 0);
  assert.equal(T.penalty(Pi, ignored.asg, { ignoreAvoid: true }).total, 0);
  const weekend = structuredClone(ignored.asg);
  weekend["7:night"].work = "Alpha";
  assert(T.penalty(Pi, weekend).items.dayoff_work_excess > 0);
  assert(T.penalty(Pi, weekend).items.dayoff_work_no_reduction > 0);
  assert.equal(T.penalty(Pi, weekend, { ignoreAvoid: true }).total, 0);
  T.setLang("ja");
  console.log('PASS feasible alternatives and truthful UI/report wording');
})().catch(e=>{
  console.error(e);
  process.exitCode = 1;
});

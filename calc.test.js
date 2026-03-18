// calc.test.js - Regression tests for pyrolysis mass & energy balance
// Run with: node calc.test.js

const {
  calc, calcAt, solveTto, solveRc,
  N_AIR, T_ADP, T_COND,
} = require('./calc.js');

let passed = 0, failed = 0;

function assert(description, condition, detail) {
  if (condition) {
    console.log(`  PASS  ${description}`);
    passed++;
  } else {
    console.error(`  FAIL  ${description}${detail ? ' — ' + detail : ''}`);
    failed++;
  }
}

function assertClose(description, actual, expected, tol) {
  const ok = Math.abs(actual - expected) <= tol;
  assert(description, ok, `got ${actual?.toFixed(4)}, expected ${expected} ± ${tol}`);
}

// ---------------------------------------------------------------------------
// Baseline inputs: hardwood at 13% moisture, default parameters
// ---------------------------------------------------------------------------
const BASE = {
  fw: 1150, mc: 0.13,
  xC: 0.492, xH: 0.062, xO: 0.446, xash: 0.003,
  HHVbm: 19000, rc: 0.25,
  xCbc: 0.70, rHC: 0.70, HHVbc: 30000,
  xs: 0.05, cpBM: 1.5, cpSG: 2.1, dH: 300,
  Tr: 25, Treac: 500, Tto_min: 650,
};

// ---------------------------------------------------------------------------
// 1. Energy balance closure: T23 ~ 0
// ---------------------------------------------------------------------------
console.log('\n1. Energy balance closure');
{
  const Tto = solveTto(BASE, BASE.rc);
  const r   = calcAt(BASE, BASE.rc, Tto);
  assertClose('T23 closes to zero (hardwood 13% MC)', r.T23, 0, 0.01);
  assertClose('T21 = T1 (hardwood 13% MC)', r.T21, r.T1, 0.01);
}

// Multiple feedstocks
const FEEDSTOCKS = [
  { name: 'Hardwood 20% MC',   inp: {...BASE, mc: 0.20, fw: 1000/0.80} },
  { name: 'Hardwood 35% MC',   inp: {...BASE, mc: 0.35, fw: 1000/0.65} },
  { name: 'Rice hulls 13% MC', inp: {...BASE, mc: 0.13, xC: 0.4855, xH: 0.0631, xO: 0.4515, xash: 0.192, HHVbm: 15000} },
  { name: 'Sludge 13% MC',     inp: {...BASE, mc: 0.13, xC: 0.5655, xH: 0.0844, xO: 0.3501, xash: 0.380, HHVbm: 13500} },
];
FEEDSTOCKS.forEach(({ name, inp }) => {
  const Tto = solveTto(inp, inp.rc);
  const r   = calcAt(inp, inp.rc, Tto);
  assertClose(`T23 closes to zero (${name})`, r.T23, 0, 0.05);
});

// ---------------------------------------------------------------------------
// 2. Mass balance closure: total in = total out
// ---------------------------------------------------------------------------
console.log('\n2. Mass balance closure');
{
  const Tto = solveTto(BASE, BASE.rc);
  const r   = calcAt(BASE, BASE.rc, Tto);
  assertClose('Mass in = mass out (hardwood 13%)', r.merr, 0, 0.01);
}

// ---------------------------------------------------------------------------
// 3. Moisture sensitivity: recoverable heat decreases with moisture
// ---------------------------------------------------------------------------
console.log('\n3. Moisture sensitivity direction');
{
  const dryb = 1000;
  const mcs  = [0, 0.10, 0.20, 0.30, 0.40];
  const recs = mcs.map(mc => {
    const inp = {...BASE, fw: dryb/(1-mc), mc, rc: 0.25};
    const Tto = solveTto(inp, 0.25);
    return calcAt(inp, 0.25, Tto).above_adp;
  });
  for (let i = 1; i < recs.length; i++) {
    assert(
      `Recoverable heat falls from MC=${(mcs[i-1]*100).toFixed(0)}% to ${(mcs[i]*100).toFixed(0)}%`,
      recs[i] < recs[i-1],
      `${recs[i].toFixed(1)} < ${recs[i-1].toFixed(1)}`
    );
  }
  // T_TO also falls with moisture
  const ttos = mcs.map(mc => {
    const inp = {...BASE, fw: dryb/(1-mc), mc, rc: 0.25};
    return solveTto(inp, 0.25);
  });
  for (let i = 1; i < ttos.length; i++) {
    assert(
      `T_TO falls from MC=${(mcs[i-1]*100).toFixed(0)}% to ${(mcs[i]*100).toFixed(0)}%`,
      ttos[i] < ttos[i-1],
      `${ttos[i].toFixed(1)} < ${ttos[i-1].toFixed(1)}`
    );
  }
}

// ---------------------------------------------------------------------------
// 4. Feasibility: activated sludge at 40% MC is infeasible in tto mode
// ---------------------------------------------------------------------------
console.log('\n4. Feasibility detection');
{
  const sludge40 = {
    ...BASE, mc: 0.40, fw: 1000/0.60,
    xC: 0.5655, xH: 0.0844, xO: 0.3501, xash: 0.380, HHVbm: 13500,
  };
  const r = calc(sludge40, 'tto', 'supp');
  assert('Activated sludge 40% MC detected as infeasible', r.infeasible === true);
  assert('Q_supp > 0 for infeasible case', r.Q_supp > 0, `Q_supp = ${r.Q_supp?.toFixed(1)} kW`);
}

// Hardwood at default conditions should be feasible
{
  const r = calc(BASE, 'tto', 'supp');
  assert('Hardwood 13% MC is feasible', r.infeasible === false);
  assert('Q_supp = 0 for feasible case', r.Q_supp === 0);
}

// ---------------------------------------------------------------------------
// 5. Biochar carbon sequestration fraction is in [0, 1]
// ---------------------------------------------------------------------------
console.log('\n5. Carbon sequestration bounds');
FEEDSTOCKS.concat([{name: 'Hardwood baseline', inp: BASE}]).forEach(({ name, inp }) => {
  const Tto = solveTto(inp, inp.rc);
  const r   = calcAt(inp, inp.rc, Tto);
  assert(`Cseq in [0,1] for ${name}`, r.Cseq >= 0 && r.Cseq <= 1, `Cseq = ${r.Cseq?.toFixed(3)}`);
});

// ---------------------------------------------------------------------------
// 6. Biochar HHV check: T11 > 0 when rc > 0
// ---------------------------------------------------------------------------
console.log('\n6. T11 sign check');
{
  const Tto = solveTto(BASE, 0.25);
  const r   = calcAt(BASE, 0.25, Tto);
  assert('T11 (biochar HHV) > 0', r.T11 > 0, `T11 = ${r.T11?.toFixed(2)}`);
  const r0  = calcAt(BASE, 0, Tto);
  assert('T11 = 0 when rc = 0', Math.abs(r0.T11) < 0.001, `T11 = ${r0.T11?.toFixed(4)}`);
}

// ---------------------------------------------------------------------------
// 7. Air composition: N_AIR = 79/21
// ---------------------------------------------------------------------------
console.log('\n7. Constants');
assertClose('N_AIR = 79/21', N_AIR, 79/21, 1e-10);
assertClose('T_ADP = 150', T_ADP, 150, 0);
assertClose('T_COND = 100', T_COND, 100, 0);

// ---------------------------------------------------------------------------
// 8. RC solve mode: solveRc gives T23 ~ 0
// ---------------------------------------------------------------------------
console.log('\n8. RC solve mode');
{
  const Tto_fixed = 720;
  const rc = solveRc(BASE, Tto_fixed);
  assert('Solved rc is positive', rc > 0, `rc = ${rc?.toFixed(4)}`);
  assert('Solved rc is < 1', rc < 1, `rc = ${rc?.toFixed(4)}`);
  const r = calcAt(BASE, rc, Tto_fixed);
  assertClose('T23 closes in RC mode', r.T23, 0, 0.01);
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------
console.log(`\n${'='.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);

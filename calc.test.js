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
// 9. Infeasibility remedy Option A: rc* is in [0, 1] and gives T_TO = Tto_min
// ---------------------------------------------------------------------------
console.log('\n9. Option A remedy (rc* solve)');
{
  const { solveRcForTtoMin } = require('./calc.js');

  // Rice hulls at 30% MC — should be infeasible but Option A feasible
  const riceHulls30 = {
    ...BASE, mc: 0.30, fw: 1000/0.70,
    xC: 0.4855, xH: 0.0631, xO: 0.4515, xash: 0.192, HHVbm: 15000,
  };
  const Tto_natural = solveTto(riceHulls30, riceHulls30.rc);
  if (Tto_natural < riceHulls30.Tto_min) {
    const rc_star = solveRcForTtoMin(riceHulls30, riceHulls30.Tto_min);
    assert('rc* is in [0, 1] for rice hulls 30% MC', rc_star >= 0 && rc_star <= 1,
      `rc* = ${rc_star?.toFixed(4)}`);
    // Verify solveTto at rc* gives exactly Tto_min
    const Tto_check = solveTto(riceHulls30, rc_star);
    assertClose('solveTto(rc*) = Tto_min', Tto_check, riceHulls30.Tto_min, 1.0);
    // Energy balance closes at rc*
    const r = calcAt(riceHulls30, rc_star, Tto_check);
    assertClose('T23 closes at rc*', r.T23, 0, 0.01);
  } else {
    // If feasible at this moisture, skip with a note
    console.log('  SKIP  Rice hulls 30% MC is feasible — adjust test inputs if Tto_min changes');
  }

  // Activated sludge at 40% MC — Option A should be infeasible (rc* < 0)
  const sludge40 = {
    ...BASE, mc: 0.40, fw: 1000/0.60,
    xC: 0.5655, xH: 0.0844, xO: 0.3501, xash: 0.380, HHVbm: 13500,
  };
  const rc_star_sludge = solveRcForTtoMin(sludge40, sludge40.Tto_min);
  assert('rc* < 0 for sludge 40% MC (Option A not feasible)',
    rc_star_sludge < 0, `rc* = ${rc_star_sludge?.toFixed(4)}`);
}

// ---------------------------------------------------------------------------
// 10. Shomate Cp values — verified against JANAF coefficients directly
// ---------------------------------------------------------------------------
console.log('\n10. Shomate Cp correctness');
{
  const { Cp_N2, Cp_CO2, Cp_H2O_g, Cp_O2, Cp_air_mix } = require('./calc.js');

  // Reference values computed directly from JANAF Shomate: Cp = (A+Bt+Ct²+Dt³+E/t²)/MW
  // where t = T(K)/1000. These are exact for our implementation.
  assertClose('Cp_N2   at  25°C', Cp_N2(25),       0.99497, 0.00005);
  assertClose('Cp_N2   at 300°C', Cp_N2(300),      1.07263, 0.00005);
  assertClose('Cp_N2   at 700°C', Cp_N2(700),      1.15366, 0.00005);

  assertClose('Cp_CO2  at 100°C', Cp_CO2(100),     0.91640, 0.00005);
  assertClose('Cp_CO2  at 500°C', Cp_CO2(500),     1.15816, 0.00005);

  assertClose('Cp_H2Og at 200°C', Cp_H2O_g(200),  1.93972, 0.00005);
  assertClose('Cp_H2Og at 600°C', Cp_H2O_g(600),  2.20137, 0.00005);

  // O2 crosses the 700K branch at ~427°C — test both sides
  assertClose('Cp_O2   at 200°C (low branch)',  Cp_O2(200),  0.96262, 0.00005);
  assertClose('Cp_O2   at 700°C (high branch)', Cp_O2(700),  1.08554, 0.00005);
  // Check continuity at branch point (~427°C = 700K)
  const Cp_just_below = Cp_O2(426);
  const Cp_just_above = Cp_O2(428);
  assert('Cp_O2 branch continuity (< 0.005 kJ/kgK jump at 700K)',
    Math.abs(Cp_just_above - Cp_just_below) < 0.005,
    `below=${Cp_just_below.toFixed(4)}, above=${Cp_just_above.toFixed(4)}`);

  // Air mix: 23.2% O2 + 76.8% N2 by mass
  assertClose('Cp_air  at  25°C', Cp_air_mix(25),  0.97717, 0.00005);
  assertClose('Cp_air  at 300°C', Cp_air_mix(300), 1.05461, 0.00005);
  // Verify formula: should equal weighted sum
  const Cp_air_check = 0.232 * Cp_O2(500) + 0.768 * Cp_N2(500);
  assertClose('Cp_air is correct weighted sum at 500°C', Cp_air_mix(500), Cp_air_check, 0.00001);
}

// ---------------------------------------------------------------------------
// 11. Exhaust composition fractions sum to 1
// ---------------------------------------------------------------------------
console.log('\n11. Exhaust composition fractions sum to 1');
{
  const cases = [
    { name: 'Hardwood 13% MC',   inp: BASE },
    { name: 'Hardwood 40% MC',   inp: {...BASE, mc: 0.40, fw: 1000/0.60} },
    { name: 'Rice hulls 13% MC', inp: {...BASE, xC: 0.4855, xH: 0.0631, xO: 0.4515, xash: 0.192, HHVbm: 15000} },
    { name: 'Sludge 13% MC',     inp: {...BASE, xC: 0.5655, xH: 0.0844, xO: 0.3501, xash: 0.380, HHVbm: 13500} },
  ];
  cases.forEach(({ name, inp }) => {
    const Tto = solveTto(inp, inp.rc);
    const r   = calcAt(inp, inp.rc, Tto);
    // Wet exhaust mass fractions: CO2 + H2O + N2 + O2_excess
    const sumFrac = r.xCO2 + r.xH2O + r.xN2 + r.xO2;
    assertClose(`Exhaust fractions sum to 1 (${name})`, sumFrac, 1.0, 0.0001);
    // All fractions positive
    assert(`All exhaust fractions > 0 (${name})`,
      r.xCO2 > 0 && r.xH2O > 0 && r.xN2 > 0 && r.xO2 > 0,
      `CO2=${r.xCO2?.toFixed(3)} H2O=${r.xH2O?.toFixed(3)} N2=${r.xN2?.toFixed(3)} O2=${r.xO2?.toFixed(3)}`);
  });
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------
console.log(`\n${'='.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);

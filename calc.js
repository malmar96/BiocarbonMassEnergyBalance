// calc.js - Pyrolysis Mass & Energy Balance
// Pure calculation module. No DOM dependencies.
// Exports all core functions for use in index.html and testing.

const N_AIR = 79/21;                    // molar N2:O2 in air
const Cp_w = 4.2, Cp_s = 2.0, Hvap = 2257;  // water properties (M22, M23, M24)
const T_ADP = 150, T_COND = 100;        // acid dew point, condensation temp

const kw = (m, q) => m * q / 3600;

// ── SHOMATE SPECIFIC HEATS (kJ/kg·K) ── JANAF, valid 300–1500 K ──
function _Cp_mol(t, A, B, C, D, E) {
  return A + B*t + C*t*t + D*t*t*t + E/(t*t);   // J/mol/K, t = T/1000 (K)
}
function Cp_N2(T_C) {
  const t = (T_C + 273.15) / 1000;
  return _Cp_mol(t, 26.09200,  8.218801, -1.976141,  0.159274, -0.044267) / 28.014;
}
function Cp_CO2(T_C) {
  const t = (T_C + 273.15) / 1000;
  return _Cp_mol(t, 24.99735, 55.18696, -33.69137,  7.948387, -0.136638) / 44.010;
}
function Cp_H2O_g(T_C) {
  const t = (T_C + 273.15) / 1000;
  return _Cp_mol(t, 30.09200,  6.832514,  6.793435, -2.534480,  0.082139) / 18.015;
}
function Cp_O2(T_C) {
  const t = (T_C + 273.15) / 1000;
  const T = T_C + 273.15;
  if (T < 700)
    return _Cp_mol(t, 31.32234, -20.23531, 57.86644, -36.50624, -0.007374) / 31.999;
  return   _Cp_mol(t, 30.03235,   8.772972, -3.988133,  0.788313, -0.741599) / 31.999;
}

// Air Cp — fixed composition 23.2% O₂ / 76.8% N₂ by mass
// Evaluated at mean temperature of the air heating zone (T_ref → T_TO)
function Cp_air_mix(T_mean) {
  const xO2_air = 0.232, xN2_air = 0.768;
  return xO2_air * Cp_O2(T_mean) + xN2_air * Cp_N2(T_mean);
}
// Returns { Cp_wet_hi, Cp_wet_adp, Cp_dry_low } for the three cascade zones
function exhaustCps(xCO2, xH2O, xN2, xO2, Tto, T_ADP, T_COND, T_ref) {
  const xCO2d = xCO2 / (1 - xH2O);  // dry fractions
  const xN2d  = xN2  / (1 - xH2O);
  const xO2d  = xO2  / (1 - xH2O);

  function Cp_wet(T) {
    return xCO2*Cp_CO2(T) + xH2O*Cp_H2O_g(T) + xN2*Cp_N2(T) + xO2*Cp_O2(T);
  }
  function Cp_dry(T) {
    return xCO2d*Cp_CO2(T) + xN2d*Cp_N2(T) + xO2d*Cp_O2(T);
  }

  const Cp_wet_hi  = Cp_wet((Tto    + T_ADP ) / 2);   // T_TO → 150°C
  const Cp_wet_adp = Cp_wet((T_ADP  + T_COND) / 2);   // 150°C → 100°C
  const Cp_dry_low = Cp_dry((T_COND + T_ref ) / 2);   // 100°C → T_ref

  return { Cp_wet_hi, Cp_wet_adp, Cp_dry_low };
}

// ── SOLVE MODE: 'tto' = solve for T_TO, 'rc' = solve for conversion rate ──
let solveMode = 'tto';

function setSolveMode(mode) {
  solveMode = mode;
  // Toggle buttons
  document.getElementById('btn-tto').classList.toggle('active', mode === 'tto');
  document.getElementById('btn-rc').classList.toggle('active',  mode === 'rc');
  // Swap which row shows the input field vs solved display
  const rowRc  = document.getElementById('row-rc');
  const rowTto = document.getElementById('row-tto');
  if (mode === 'tto') {
    // rc is a user input; T_TO is solved
    rowRc.classList.remove('solved-mode');
    rowRc.innerHTML = `<label>Conversion rate</label><input type="number" id="i_rc" value="${lastRc.toFixed(4)}" step="0.01"><span class="unit">–</span>`;
    rowTto.innerHTML = `<label>T_TO (thermal oxidizer)</label><span id="i_Tto_display" class="solved-val">—</span><span class="unit">°C</span>`;
    document.getElementById('solve-note').textContent = 'T_TO solved to close U1 = W15.';
  } else {
    // T_TO is a user input; rc is solved
    rowTto.innerHTML = `<label>T_TO (thermal oxidizer)</label><input type="number" id="i_Tto_input" value="${lastTto.toFixed(1)}" step="5"><span class="unit">°C</span>`;
    rowRc.classList.add('solved-mode');
    rowRc.innerHTML = `<label>Conversion rate</label><span id="i_rc_display" class="solved-val">—</span><span class="unit">–</span>`;
    document.getElementById('solve-note').textContent = 'Conv. rate solved to close U1 = W15.';
    // Re-attach listener for T_TO input
    document.getElementById('i_Tto_input').addEventListener('input', () => run());
  }
  // Re-attach listeners for all regular inputs
  attachListeners();
  run();
}

function attachListeners() {
  document.querySelectorAll('input[type="number"]').forEach(el => {
    el.removeEventListener('input', onInput);
    el.addEventListener('input', onInput);
  });
}
function onInput() { checkComp(); updateAshNote(); run(); }

// ── CORE MASS+ENERGY CALCULATION at a given (rc, Tto) ──
// Both rc and Tto must be provided. One of them will have been solved externally.
function calcAt(inp, rc, Tto) {
  const {fw, mc, xC, xH, xO, xash, xCbc, rHC, HHVbc, xs,
         HHVbm, cpBM, cpSG, dH, Tr, Treac} = inp;
  const rHCm = rHC / 12;

  // Air Cp at mean zone temperature (T_ref → T_TO) — computed from Shomate, not user input
  const cpAir = Cp_air_mix((Tr + Tto) / 2);

  // Feed
  const md   = fw * (1 - mc);
  const mw   = fw * mc;
  // Ash: only active when xash > 1%
  const ash_active = (xash || 0) > 0.01;
  const x_ash = ash_active ? (xash || 0) : 0;
  const m_ash = md * x_ash;
  const m_org = md * (1 - x_ash);   // combustible / pyrolyzable fraction

  const mCbm = m_org * xC, mHbm = m_org * xH, mObm = m_org * xO;

  // Biochar — rc applies to organic fraction only; ash exits with biochar
  const mbc_org = m_org * rc;
  const mbc     = mbc_org + m_ash;   // total biochar mass
  const mCbc    = mbc_org * xCbc;
  const mHbc    = mCbc * rHCm;
  const mObc    = mbc_org - mCbc - mHbc;

  // Syngas
  const msg  = m_org - mbc_org;
  const mCsg = mCbm - mCbc;
  const mHsg = mHbm - mHbc;
  const mOsg = mObm - mObc;

  // Combustion (D31–D44)
  const mCO2   = (44/12)*mCsg;
  const MCO2   = mCO2/44;
  const mH2Oc  = (36/4)*mHsg;
  const mO2g   = (32/44)*mCO2 + (16/18)*mH2Oc;
  const mO2n   = mO2g - mOsg;
  const MO2n   = mO2n/32;
  const Mdry   = (N_AIR*MO2n + MCO2) / (1 - (N_AIR+1)*xs);
  const MO2x   = xs * Mdry;
  const mO2x   = MO2x * 32;
  const MO2tot = MO2x + MO2n;
  const MN2    = (0.79/0.21) * MO2tot;
  const mN2    = MN2 * 28;
  const mair   = mN2 + MO2tot*32;
  const mH2Ox  = mH2Oc + mw;
  const mexw   = mN2 + mO2x + mCO2 + mH2Ox;

  const tin  = fw + mair;
  const tout = mbc + mexw;   // mbc now includes ash — mass balance still closes
  const merr = Math.abs(tin-tout)/tin*100;

  // Energy — T1 uses m_dry * HHV_bm_dry (whole-sample dry basis — ash included in HHV measurement)
  const T1  = kw(md,   HHVbm);
  const T5  = kw(mw,   Cp_w * (T_COND - Tr));
  const T6  = kw(mw,   Hvap);
  const T7  = kw(mw,   Cp_s * (Treac - T_COND));
  const T9  = kw(md,   cpBM * (Treac - Tr));
  const T10 = kw(md,   dH);
  // T11: chemical energy leaving with biochar — ash has no HHV, apply only to organic char fraction
  // T12: sensible heat of biochar leaving at T_reac — lump ash + organic at Cp=1.0 kJ/kgK
  //      (Cp_ash ~0.8 and Cp_char ~1.0 are close enough to lump; split if needed)
  const T11 = kw(mbc_org, HHVbc);
  const T12 = kw(mbc,     1.0  * (Treac - Tr));
  const T13 = kw(msg,  cpSG * (Tto - Treac));
  const T14 = kw(mair, cpAir* (Tto - Tr));
  const T17 = kw(mH2Ox, Hvap);
  // Composition-weighted Cp for each exhaust zone (replaces flat cpEx)
  const xCO2_ex = mCO2 / mexw, xH2O_ex = mH2Ox / mexw, xN2_ex = mN2 / mexw, xO2_ex = mO2x / mexw;
  const cps = exhaustCps(xCO2_ex, xH2O_ex, xN2_ex, xO2_ex, Tto, T_ADP, T_COND, Tr);

  // T19 below 100°C: TWO distinct streams
  // — all condensed liquid water (mH2Ox) from 100°C → T_ref at Cp_water_liq
  // — true dry gas (CO2 + N2 + O2, mass = mexw - mH2Ox) from 100°C → T_ref at Cp_dry
  const T18 = kw(mH2Ox,          Cp_w          * (T_COND - Tr));   // condensed water (all H2O)
  const T19 = kw(mexw - mH2Ox,   cps.Cp_dry_low * (T_COND - Tr));  // dry exhaust gas only

  const T16 = kw(mexw, cps.Cp_wet_hi  * (Tto - T_ADP))   // T_TO → 150°C (above dew pt)
            + kw(mexw, cps.Cp_wet_adp * (T_ADP - T_COND)); // 150°C → 100°C (acid risk)
  const W19 = kw(mexw, cps.Cp_wet_hi  * (Tto - T_ADP));   // recoverable (above dew pt)
  const W16 = -(T16 - W19);
  const W17 = -T17;
  const W18 = -(T18 + T19);

  // T21 = total sinks including exhaust heat terms (mirrors spreadsheet SUM(T5:T19))
  const T21 = T5+T6+T7+T9+T10+T11+T12+T13+T14+T16+T17+T18+T19;
  // T23 = closing term — solved to zero (T1 - T21 = 0)
  const T23 = T1 - T21;
  // U1 kept for exhaust recovery tab: U1 = T16+T17+T18+T19 = total exhaust enthalpy
  const U1  = T16 + T17 + T18 + T19;

  return {
    rc, Tto,
    md, mw, fw, m_ash, m_org, ash_active,
    mCbm, mHbm, mObm,
    mbc, mbc_org, mCbc, mHbc, mObc,
    msg, mCsg, mHsg, mOsg, sgmc: mw/msg,
    mCO2, mH2Oc, mH2Ox, mN2, mO2x,
    mO2g, mOsg, mO2n, mair, mexw,
    merr, tin, tout,
    Cseq: mCbc/mCbm,
    xCO2: mCO2/mexw, xH2O: mH2Ox/mexw, xN2: mN2/mexw, xO2: mO2x/mexw,
    T1, T5, T6, T7, T9, T10, T11, T12, T13, T14,
    T16, T17, T18, T19, T21, T23,
    W19, W16, W17, W18,
    above_adp: W19, acid_zone: -W16, latent: T17,
    T18_water: T18, T19_dry: T19,
    low_zone: T18+T19, non_rec: -W16+T17+T18+T19, rpct: W19/U1,
    U1,   // total exhaust enthalpy (for recovery tab)
    cps
  };
}

// ── CLOSURE RESIDUAL: delta = T23 = T1 - T21 (should be zero when solved) ──
function delta(inp, rc, Tto) {
  const r = calcAt(inp, rc, Tto);
  return r.T23;
}

// ── SOLVE FOR T_TO (rc fixed, linear in Tto) ──
// Mass flows don't depend on Tto, so call calcAt at a dummy Tto to get them,
// then apply the analytical formula. This automatically inherits the ash logic from calcAt.
// ── SOLVE FOR T_TO — iterative, 2 passes ──
// Closure condition: T1 - fixed_sinks - T13(Tto) - T14(Tto) = T16(Tto) + T17 + T18 + T19
// All exhaust Cps depend on composition (fixed) and mean zone temperatures (depend on Tto).
// Iterate: guess Tto → compute Cps → solve analytically → repeat.
function solveTto(inp, rc) {
  const {cpSG, Tr, Treac} = inp;
  // Get mass flows at dummy Tto (mass balance is Tto-independent)
  const r0 = calcAt(inp, rc, 700);
  const {md, mw, msg, mair, mexw, mH2Ox, T1, T5, T6, T7, T9, T10, T11, T12, T17,
         xCO2, xH2O, xN2, xO2} = r0;

  function solveWithCps(Tto_guess) {
    const cps    = exhaustCps(xCO2, xH2O, xN2, xO2, Tto_guess, T_ADP, T_COND, Tr);
    const cpAir  = Cp_air_mix((Tr + Tto_guess) / 2);  // dynamic air Cp at mean zone T
    const T18_c     = kw(mH2Ox,        Cp_w           * (T_COND - Tr));
    const T19_g     = kw(mexw - mH2Ox, cps.Cp_dry_low * (T_COND - Tr));
    const T16_const = kw(mexw, cps.Cp_wet_adp * (T_ADP - T_COND));
    const fixed = T5 + T6 + T7 + T9 + T10 + T11 + T12 + T17 + T18_c + T19_g + T16_const;
    const Cp_hi = cps.Cp_wet_hi;
    const num = 3600*(T1 - fixed) + msg*cpSG*Treac + mair*cpAir*Tr + Cp_hi*mexw*T_ADP;
    const den = msg*cpSG + mair*cpAir + Cp_hi*mexw;
    return num / den;
  }

  // Five iterations — converges T23 to < 0.001 kW
  let Tto = 700;
  for (let i = 0; i < 5; i++) Tto = solveWithCps(Tto);
  return Tto;
}

// ── SOLVE FOR RC (Tto fixed, linear in rc — verified) ──
// delta(rc) is linear, so interpolate between rc=0 and rc=1
function solveRc(inp, Tto) {
  const d0 = delta(inp, 0.0, Tto);
  const d1 = delta(inp, 1.0, Tto);
  return -d0 / (d1 - d0);   // root of linear function
}

// ── REMEDY SELECTION ──
let remedyMode = 'rc';   // 'rc' = reduce conversion rate,  'supp' = supplemental heat

function setRemedy(mode) {
  remedyMode = mode;
  const btnA = document.getElementById('opt-a-btn');
  const btnB = document.getElementById('opt-b-btn');
  const hl = 'rgba(251,191,36,0.12)';
  btnA.style.background = mode === 'rc'   ? hl : '';
  btnB.style.background = mode === 'supp' ? hl : '';
  document.getElementById('opt-a-btn').querySelector('div:first-child').style.color = mode === 'rc'   ? 'var(--amber)' : 'var(--text3)';
  document.getElementById('opt-b-btn').querySelector('div:first-child').style.color = mode === 'supp' ? 'var(--amber)' : 'var(--text3)';
  run();
}

// Solve for rc* such that solveTto(rc*) = Tto_min
// f(rc) = Num(rc) - Tto_min*Den(rc) is linear in rc => two-point solve
function solveRcForTtoMin(inp, Tto_min) {
  function f(rc) {
    const r0 = calcAt(inp, rc, Tto_min);  // get mass flows and Cps at Tto_min
    const {msg, mair, mexw, mw, mH2Ox, T1, T5, T6, T7, T9, T10, T11, T12, T17, cps} = r0;
    const {cpSG, Tr, Treac} = inp;
    const cpAir  = Cp_air_mix((Tr + Tto_min) / 2);
    const T18_c     = kw(mH2Ox,        Cp_w           * (T_COND - Tr));
    const T19_g     = kw(mexw - mH2Ox, cps.Cp_dry_low * (T_COND - Tr));
    const T16_const = kw(mexw, cps.Cp_wet_adp * (T_ADP - T_COND));
    const fixed = T5 + T6 + T7 + T9 + T10 + T11 + T12 + T17 + T18_c + T19_g + T16_const;
    const Cp_hi = cps.Cp_wet_hi;
    const Num = 3600*(T1 - fixed) + msg*cpSG*Treac + mair*cpAir*Tr + Cp_hi*mexw*T_ADP;
    const Den = msg*cpSG + mair*cpAir + Cp_hi*mexw;
    return Num - Tto_min * Den;
  }
  const f0 = f(0), f1 = f(1);
  if (f1 === f0) return null;
  const rc_star = -f0 / (f1 - f0);
  return rc_star;
}

// ── MAIN CALCULATION ──
function calc(inp, solveMode, remedyMode) {
  const Tto_min = inp.Tto_min || 650;

  if (solveMode === 'tto') {
    const rc = inp.rc;
    const Tto_natural = solveTto(inp, rc);

    if (Tto_natural >= Tto_min) {
      // Feasible — no remedy needed
      const r = calcAt(inp, rc, Tto_natural);
      r.Q_supp = 0; r.infeasible = false; r.remedy = null;
      return r;
    }

    // Infeasible — compute both options
    const rc_star = solveRcForTtoMin(inp, Tto_min);
    const optA_feasible = rc_star !== null && rc_star >= 0 && rc_star <= 1;

    // Option B: Q_supp at user's rc, Tto clamped to Tto_min
    const r_B = calcAt(inp, rc, Tto_min);
    const Q_supp_B = Math.max(0, -r_B.T23);

    // Option A details (for display even if not selected)
    const optA_rc = optA_feasible ? rc_star : 0;
    const r_A_preview = calcAt(inp, optA_rc, Tto_min);

    if (remedyMode === 'rc' && optA_feasible) {
      // Apply Option A: recalculate at rc* — Tto will solve to exactly Tto_min
      const Tto_A = solveTto(inp, rc_star);
      const r = calcAt(inp, rc_star, Tto_A);
      r.Q_supp = 0; r.infeasible = true; r.remedy = 'rc';
      r.optA_rc = rc_star; r.optA_feasible = true;
      r.optB_Qsupp = Q_supp_B;
      r.infeasible_reason = `Autothermal T_TO (${Tto_natural.toFixed(0)}°C) is below the ${Tto_min}°C combustion floor.`;
      return r;
    } else {
      // Apply Option B: Q_supp at user's rc, clamped Tto
      r_B.Q_supp = Q_supp_B; r_B.infeasible = true; r_B.remedy = 'supp';
      r_B.optA_rc = optA_rc; r_B.optA_feasible = optA_feasible;
      r_B.optB_Qsupp = Q_supp_B;
      r_B.infeasible_reason = `Autothermal T_TO (${Tto_natural.toFixed(0)}°C) is below the ${Tto_min}°C combustion floor.`;
      return r_B;
    }

  } else {
    // RC mode
    const Tto = inp.Tto;
    const rc_natural = solveRc(inp, Tto);

    if (rc_natural >= 0) {
      const r = calcAt(inp, rc_natural, Tto);
      r.Q_supp = 0; r.infeasible = false; r.remedy = null;
      return r;
    }

    // Infeasible — rc < 0
    // Option A: rc = 0 (minimum viable), show what Tto results
    const r_A = calcAt(inp, 0, Tto);
    const Tto_at_rc0 = solveTto(inp, 0);
    const Q_supp_B_rc = Math.max(0, -r_A.T23);
    const optA_feasible = Tto_at_rc0 >= Tto_min;   // rc=0 still sustains combustion?

    const reason = `Solved conversion rate (${(rc_natural*100).toFixed(1)}%) is negative — even with rc = 0 the energy balance cannot close at T_TO = ${Tto.toFixed(0)}°C.`;

    if (remedyMode === 'rc') {
      r_A.Q_supp = 0; r_A.infeasible = true; r_A.remedy = 'rc';
      r_A.optA_rc = 0; r_A.optA_feasible = optA_feasible;
      r_A.optA_Tto = Tto_at_rc0;
      r_A.optB_Qsupp = Q_supp_B_rc;
      r_A.infeasible_reason = reason;
      return r_A;
    } else {
      r_A.Q_supp = Q_supp_B_rc; r_A.infeasible = true; r_A.remedy = 'supp';
      r_A.optA_rc = 0; r_A.optA_feasible = optA_feasible;
      r_A.optA_Tto = Tto_at_rc0;
      r_A.optB_Qsupp = Q_supp_B_rc;
      r_A.infeasible_reason = reason;
      return r_A;
    }
  }
}

// Module exports (Node.js / CommonJS)
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    calc, calcAt, solveTto, solveRc, solveRcForTtoMin, delta,
    Cp_N2, Cp_CO2, Cp_H2O_g, Cp_O2, Cp_air_mix, exhaustCps,
    N_AIR, Cp_w, Cp_s, Hvap, T_ADP, T_COND,
  };
}

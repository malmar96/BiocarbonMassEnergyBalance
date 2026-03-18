# Pyrolysis Mass & Energy Balance

A browser-based heat and mass balance tool for biocarbon (biochar) production via pyrolysis, paired with a thermal oxidiser (TO).

Built by [Malena Maraviglia](https://github.com/malmar96), Lead Applications Engineer, ElectraTherm Inc.

## What it does

Given feedstock composition, moisture content, and conversion parameters, the tool solves for either:
- **T_TO** — the thermal oxidiser exit temperature at a fixed conversion rate, or
- **Conversion rate** — the biochar yield at a fixed T_TO

The energy balance closes on **T23 = T1 − T21 = 0**, where T1 is the chemical energy input (biomass HHV) and T21 is the sum of all heat sinks including exhaust cooling terms — mirroring the structure of the source spreadsheet.

### Key features

- Woody biomass, rice hulls, activated sludge, and custom feedstock presets
- Composition-weighted exhaust Cp from JANAF Shomate polynomials — three cascade zones (wet above dew point, wet acid risk zone, dry below condensation)
- Moisture sensitivity analysis — always runs in T_TO solve mode for physically correct direction
- Infeasibility detection with two remedy options: reduce conversion rate or add supplemental heat
- Scenario save/load/export via localStorage
- CSV export of all inputs and outputs across saved scenarios

## Files

| File | Purpose |
|------|---------|
| `index.html` | Full single-file web app |
| `calc.js` | Pure calculation module — no DOM dependencies |
| `calc.test.js` | Regression test suite (Node.js) |
| `.github/workflows/test.yml` | CI pipeline — runs tests on every push and PR |

## Running locally

Open `index.html` in any modern browser. No build step, no dependencies, no server required.

## Running tests

```bash
node calc.test.js
```

Requires Node.js 18+.

## Test coverage

- Energy balance closure: T23 < 0.001 kW across all feedstock/moisture combinations
- Mass balance closure: in = out within 0.01%
- Moisture sensitivity direction: recoverable heat and T_TO decrease with increasing moisture
- Feasibility detection: activated sludge at 40% MC correctly flagged as infeasible
- Carbon sequestration fraction bounded in [0, 1]
- T11 (biochar HHV) sign and zero checks
- RC solve mode closure

## Physical basis

The model follows carbon through the system:

```
C_in (biomass) = C_char (sequestered) + C_gas (combusted in TO)
```

Energy release is computed from the oxidation of gas-phase carbon and hydrogen. Exhaust specific heats are computed from mass-fraction-weighted Shomate polynomials (NIST-JANAF) rather than a flat value, with separate Cp for each temperature zone.

### Key references

- ISO 17225-1:2021 — solid biofuel specifications
- Jenkins et al. (1998) — rice hull composition, *Biomass & Bioenergy*
- Fonts et al. (2012) — activated sludge, *Renewable & Sustainable Energy Reviews*
- NIST-JANAF Thermochemical Tables, Chase (1998)
- Rath et al. (2003) — pyrolysis heat of reaction range
- Antal & Grønli (2003) — biochar specific heat

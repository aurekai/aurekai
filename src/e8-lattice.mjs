/**
 * src/e8-lattice.mjs
 *
 * Pure E8 lattice math — no I/O, no side-effects.
 *
 * E8 is the rank-8 root lattice: the unique even, unimodular, positive-definite
 * lattice in 8 dimensions. It is the union of two cosets of D8:
 *
 *   E8 = D8 ∪ (D8 + δ)
 *
 * where D8 = { x ∈ Z^8 : Σxᵢ ≡ 0 (mod 2) }
 *       δ  = (½, ½, ½, ½, ½, ½, ½, ½)
 *
 * Each lattice point is a "cell" — a discrete local coordinate in 8D space.
 * The 240 minimal vectors (|v|² = 2) are the shell-1 neighbors of each cell.
 *
 * This module is used by chart-compiler.mjs to snap runtime state to a shared
 * internal coordinate grid. It does not add new user-facing commands.
 *
 * Exports:
 *   snapE8(x)           — snap 8D float vector to nearest E8 cell
 *   cellKey(cell)       — deterministic string identifier for a cell
 *   e8NeighborScore(a, b) — proximity score [0..1] between two cells
 *   e8SquaredDist(a, b) — squared Euclidean distance between two cells
 */

// ── internal helpers ──────────────────────────────────────────────────────────

/** Return the nearest D8 = { x ∈ Z^8 : Σxᵢ ≡ 0 (mod 2) } point to x. */
function nearestD8(x) {
  const z = x.map(Math.round);
  const s = z.reduce((a, b) => a + b, 0);
  if (s % 2 === 0) return z;

  // Parity is wrong — flip the coordinate whose fractional part is largest
  // (where the rounding decision was most uncertain).
  const fracs = x.map((xi, i) => Math.abs(xi - z[i]));
  let iMax = 0;
  for (let i = 1; i < 8; i++) if (fracs[i] > fracs[iMax]) iMax = i;

  const zAdj = z.slice();
  zAdj[iMax] += x[iMax] >= z[iMax] ? 1 : -1;
  return zAdj;
}

/** Return the nearest point in the D8 + (½,…,½) coset to x. */
function nearestD8Half(x) {
  // Shift into the D8 frame, snap, then shift back.
  const xShifted = x.map(v => v - 0.5);
  const z = nearestD8(xShifted);
  return z.map(v => v + 0.5);
}

function sqDist(a, b) {
  let s = 0;
  for (let i = 0; i < 8; i++) { const d = a[i] - b[i]; s += d * d; }
  return s;
}

// ── public API ────────────────────────────────────────────────────────────────

/**
 * Snap an 8-dimensional float vector to the nearest E8 lattice point.
 *
 * Returns { cell, residual, residualNorm } where:
 *   cell        — 8-element array (integers or half-integers)
 *   residual    — x - cell (quantization error vector)
 *   residualNorm — ||residual||  (≤ covering radius of E8 ≈ 1.0)
 *
 * Works correctly for any scale. The E8 lattice is self-dual, so it is
 * equally happy with coordinates in any range — pass raw features or
 * chart-normalized coordinates as you prefer.
 */
export function snapE8(x) {
  if (!Array.isArray(x) || x.length !== 8) {
    throw new TypeError(`snapE8: expected Array(8), got ${x?.length ?? typeof x}`);
  }

  const zInt  = nearestD8(x);
  const zHalf = nearestD8Half(x);

  const dInt  = sqDist(x, zInt);
  const dHalf = sqDist(x, zHalf);

  const cell     = dInt <= dHalf ? zInt : zHalf;
  const residual = x.map((xi, i) => xi - cell[i]);
  const residualNorm = parseFloat(
    Math.sqrt(residual.reduce((s, r) => s + r * r, 0)).toFixed(8)
  );

  return { cell, residual, residualNorm };
}

/**
 * Produce a deterministic human-readable key for an E8 cell.
 *
 * Integer coordinates are printed as integers; half-integer coordinates
 * are printed as "Nh" where N is the numerator (e.g., "-1h" = -½).
 *
 * Example: cellKey([0, 1, -1, 0, 0, 1, 0, -1]) → "0,1,-1,0,0,1,0,-1"
 */
export function cellKey(cell) {
  return cell.map(v => {
    const twice = Math.round(v * 2);
    return twice % 2 === 0 ? String(twice / 2) : `${twice}h`;
  }).join(",");
}

/**
 * Squared Euclidean distance between two E8 cells.
 * Both must be 8-element arrays (integers or half-integers).
 */
export function e8SquaredDist(a, b) {
  return sqDist(a, b);
}

/**
 * Proximity score in [0, 1] between two E8 cells.
 *
 * Shell 0 (same cell, d²=0):        1.00
 * Shell 1 (nearest neighbor, d²=2): 0.80  — the 240 minimal E8 roots
 * Shell 2 (d²=4):                   0.50
 * Shell 3 (d²≤8):                   0.20
 * Far  (d²>8):                      0.00
 *
 * Used by vec search and relay-handoff compatibility scoring.
 */
export function e8NeighborScore(cellA, cellB) {
  const d2 = sqDist(cellA, cellB);
  if (d2 < 1e-6)            return 1.00;
  if (Math.abs(d2 - 2) < 0.05) return 0.80;
  if (Math.abs(d2 - 4) < 0.05) return 0.50;
  if (d2 <= 8 + 0.05)       return 0.20;
  return 0.00;
}

// Small seeded 3D simplex noise + fbm. Everything organic on the page grows from this.
export function makeNoise(seed = 1) {
  const p = new Uint8Array(512);
  const perm = new Uint8Array(256);
  let s = seed >>> 0 || 1;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (let i = 0; i < 256; i++) perm[i] = i;
  for (let i = 255; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [perm[i], perm[j]] = [perm[j], perm[i]]; }
  for (let i = 0; i < 512; i++) p[i] = perm[i & 255];
  const G = [[1,1,0],[-1,1,0],[1,-1,0],[-1,-1,0],[1,0,1],[-1,0,1],[1,0,-1],[-1,0,-1],[0,1,1],[0,-1,1],[0,1,-1],[0,-1,-1]];
  const F3 = 1 / 3, G3 = 1 / 6;

  function noise3(x, y, z) {
    const t = (x + y + z) * F3;
    const i = Math.floor(x + t), j = Math.floor(y + t), k = Math.floor(z + t);
    const t0 = (i + j + k) * G3;
    const x0 = x - (i - t0), y0 = y - (j - t0), z0 = z - (k - t0);
    let i1, j1, k1, i2, j2, k2;
    if (x0 >= y0) {
      if (y0 >= z0) { i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 1; k2 = 0; }
      else if (x0 >= z0) { i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 0; k2 = 1; }
      else { i1 = 0; j1 = 0; k1 = 1; i2 = 1; j2 = 0; k2 = 1; }
    } else {
      if (y0 < z0) { i1 = 0; j1 = 0; k1 = 1; i2 = 0; j2 = 1; k2 = 1; }
      else if (x0 < z0) { i1 = 0; j1 = 1; k1 = 0; i2 = 0; j2 = 1; k2 = 1; }
      else { i1 = 0; j1 = 1; k1 = 0; i2 = 1; j2 = 1; k2 = 0; }
    }
    const x1 = x0 - i1 + G3, y1 = y0 - j1 + G3, z1 = z0 - k1 + G3;
    const x2 = x0 - i2 + 2 * G3, y2 = y0 - j2 + 2 * G3, z2 = z0 - k2 + 2 * G3;
    const x3 = x0 - 1 + 0.5, y3 = y0 - 1 + 0.5, z3 = z0 - 1 + 0.5;
    const ii = i & 255, jj = j & 255, kk = k & 255;
    const c = (tx, ty, tz, gi) => {
      let tt = 0.6 - tx * tx - ty * ty - tz * tz;
      if (tt < 0) return 0;
      const g = G[gi % 12];
      tt *= tt;
      return tt * tt * (g[0] * tx + g[1] * ty + g[2] * tz);
    };
    return 32 * (
      c(x0, y0, z0, p[ii + p[jj + p[kk]]]) +
      c(x1, y1, z1, p[ii + i1 + p[jj + j1 + p[kk + k1]]]) +
      c(x2, y2, z2, p[ii + i2 + p[jj + j2 + p[kk + k2]]]) +
      c(x3, y3, z3, p[ii + 1 + p[jj + 1 + p[kk + 1]]])
    );
  }

  function fbm(x, y, z = 0, oct = 4) {
    let a = 0.5, f = 1, sum = 0, norm = 0;
    for (let o = 0; o < oct; o++) { sum += a * noise3(x * f, y * f, z * f); norm += a; a *= 0.5; f *= 2.03; }
    return sum / norm;
  }

  return { noise3, fbm, rnd };
}

export function seedOf(str) {
  let h = 2166136261;
  for (const ch of String(str)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

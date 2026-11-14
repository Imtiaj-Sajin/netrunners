// Every netrunner gets a face that nobody drew: a bust grown from noise, lit and broken by
// their personality, then Floyd-Steinberg dithered to 1-bit ink and paper.
//   openness   → dissolving edges     neuroticism → smeared, glitched bands
//   extraversion/mood → light         emotionality → softness       rare: a mirrored self
import { makeNoise, seedOf } from "./noise.js";

const INK = [11, 11, 10];
const PAPER = [244, 241, 234];
const LILAC = [196, 181, 253];
const cache = new Map();

function field(n, size, opts) {
  const seed = seedOf(`${n.id}:${n.name}`);
  const N = makeNoise(seed);
  const r = N.rnd;
  const L = n.look || n.genome?.traits || {};
  const O = L.openness ?? 0.5, X = L.extraversion ?? 0.5, E = L.emotionality ?? 0.5;
  const NE = L.neuroticism ?? 0.45, PS = L.psychopathy ?? 0.25;
  const mood = opts.mood ?? 0;
  const head = { x: 0.5 + (r() - 0.5) * 0.08, y: 0.36 + (r() - 0.5) * 0.05, rx: 0.15 + r() * 0.05, ry: 0.19 + r() * 0.05, tilt: (r() - 0.5) * 0.35 };
  const shoulders = { x: 0.5 + (r() - 0.5) * 0.06, y: 1.03, rx: 0.4 + r() * 0.12, ry: 0.36 + r() * 0.06 };
  const light = r() * Math.PI * 2;
  const lx = Math.cos(light), ly = Math.sin(light) * 0.6 - 0.4;
  const mirror = seed % 7 === 0 && O > 0.55;
  const glitch = NE > 0.55 ? (NE - 0.55) * 2.2 : 0;
  const dissolve = 0.15 + O * 0.55 + (opts.alive ? 0 : 0.35);
  const gain = (0.95 + X * 0.3 + mood * 0.2) * (opts.alive ? 1 : 0.6);
  const contrast = 1 + PS * 0.9 - E * 0.3;
  const g = new Float32Array(size * size);
  const ct = Math.cos(head.tilt), st = Math.sin(head.tilt);

  for (let y = 0; y < size; y++) {
    const v = y / size;
    let shift = 0;
    if (glitch) {
      const band = N.noise3(0, v * 9, seed % 100);
      if (band > 0.35) shift = (band - 0.35) * glitch * 0.35 * Math.sign(N.noise3(v * 3, 1, 2));
    }
    for (let x = 0; x < size; x++) {
      let u = x / size + shift;
      if (mirror && u > 0.5) u = 1 - u + (r() - 0.5) * 0.004;
      // head (tilted ellipsoid) with a soft lambert + rim
      const hx0 = u - head.x, hy0 = v - head.y;
      const hx = (hx0 * ct - hy0 * st) / head.rx, hy = (hx0 * st + hy0 * ct) / head.ry;
      const hr = hx * hx + hy * hy;
      let val = 0, inside = 0;
      if (hr < 1) {
        const nz = Math.sqrt(1 - hr);
        const lam = Math.max(0, hx * lx + hy * ly + nz * 0.55);
        const rim = Math.pow(1 - nz, 3) * 0.6;
        val = 0.12 + lam * 0.85 + rim;
        inside = 1 - hr;
      }
      // neck
      const nx = (u - head.x) / 0.085, ny = (v - (head.y + head.ry + 0.035)) / 0.1;
      if (Math.abs(nx) < 1 && Math.abs(ny) < 1) {
        const s = 0.1 + (1 - nx * nx) * 0.7 * (0.6 + 0.4 * lx * Math.sign(nx || 1));
        if (s > val) { val = s; inside = Math.max(inside, 1 - Math.abs(ny)); }
      }
      // shoulders
      const sx = (u - shoulders.x) / shoulders.rx, sy = (v - shoulders.y) / shoulders.ry;
      const sr = sx * sx + sy * sy;
      if (sr < 1) {
        const nz = Math.sqrt(1 - sr);
        const lam = Math.max(0, sx * lx + sy * ly + nz * 0.5) * 0.75 + Math.pow(1 - nz, 3) * 0.4;
        if (lam > val) { val = lam; inside = Math.max(inside, 1 - sr); }
      }
      // dissolve edges into noise, add texture
      const tex = N.fbm(u * 6, v * 6, 3.1, 4);
      if (inside > 0 && inside < dissolve * 0.35 && tex * 0.5 + 0.5 < (dissolve * 0.35 - inside) * 2.4) val *= 0.25;
      val = val * (0.82 + tex * 0.35) * gain;
      // dark background with its own faint weather
      const bg = Math.max(0, N.fbm(u * 2.2, v * 2.2, 9.7, 3)) * 0.12 + 0.02;
      val = inside > 0 ? val : bg;
      val = 0.5 + (val - 0.5) * contrast;
      g[y * size + x] = Math.max(0, Math.min(1, val));
    }
  }
  return g;
}

function paint(g, size, opts, dither) {
  const cv = document.createElement("canvas");
  cv.width = size; cv.height = size;
  const c = cv.getContext("2d");
  const img = c.createImageData(size, size);
  const hi = opts.truth ? LILAC : PAPER;
  const buf = dither ? Float32Array.from(g) : g;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      let v = buf[i];
      if (dither) {
        const out = v > 0.5 ? 1 : 0;
        const err = v - out;
        if (x + 1 < size) buf[i + 1] += (err * 7) / 16;
        if (y + 1 < size) {
          if (x > 0) buf[i + size - 1] += (err * 3) / 16;
          buf[i + size] += (err * 5) / 16;
          if (x + 1 < size) buf[i + size + 1] += err / 16;
        }
        v = out;
      }
      const o = i * 4;
      img.data[o] = INK[0] + (hi[0] - INK[0]) * v;
      img.data[o + 1] = INK[1] + (hi[1] - INK[1]) * v;
      img.data[o + 2] = INK[2] + (hi[2] - INK[2]) * v;
      img.data[o + 3] = 255;
    }
  }
  c.putImageData(img, 0, 0);
  return cv;
}

/** A dithered portrait canvas (cached). Display it larger with image-rendering: pixelated. */
export function portrait(n, { size = 72, mood = 0, alive = true, truth = false } = {}) {
  const key = `${n.id}|${size}|${Math.round(mood * 4)}|${alive}|${truth}`;
  if (cache.has(key)) return cloneCanvas(cache.get(key));
  const g = field(n, size, { mood, alive });
  const cv = paint(g, size, { truth }, true);
  cache.set(key, cv);
  if (cache.size > 400) cache.delete(cache.keys().next().value);
  return cloneCanvas(cv);
}

function cloneCanvas(src) {
  const cv = document.createElement("canvas");
  cv.width = src.width; cv.height = src.height;
  cv.getContext("2d").drawImage(src, 0, 0);
  cv.className = "portrait";
  return cv;
}

/** A large portrait the cursor burns through: under the dither, the smooth face. */
export function veilPortrait(n, { size = 200, mood = 0, alive = true, truth = false } = {}) {
  const g = field(n, size, { mood, alive });
  const dithered = paint(g, size, { truth }, true);
  const smooth = paint(g, size, { truth }, false);
  const cv = document.createElement("canvas");
  cv.width = size; cv.height = size;
  cv.className = "portrait veil";
  const c = cv.getContext("2d");
  c.drawImage(dithered, 0, 0);
  const holes = [];
  let raf = 0;
  const draw = () => {
    raf = 0;
    c.drawImage(dithered, 0, 0);
    const now = performance.now();
    for (let i = holes.length - 1; i >= 0; i--) {
      const hle = holes[i];
      const age = (now - hle.t) / 900;
      if (age > 1) { holes.splice(i, 1); continue; }
      c.save();
      c.globalAlpha = 1 - age;
      c.beginPath(); c.arc(hle.x, hle.y, size * 0.13 * (1 - age * 0.4), 0, Math.PI * 2); c.clip();
      c.drawImage(smooth, 0, 0);
      c.restore();
    }
    if (holes.length) raf = requestAnimationFrame(draw);
  };
  cv.addEventListener("pointermove", (e) => {
    const rect = cv.getBoundingClientRect();
    holes.push({ x: ((e.clientX - rect.left) / rect.width) * size, y: ((e.clientY - rect.top) / rect.height) * size, t: performance.now() });
    if (holes.length > 40) holes.shift();
    if (!raf) raf = requestAnimationFrame(draw);
  });
  return cv;
}

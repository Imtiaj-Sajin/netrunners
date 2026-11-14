// The living background. A flow field of strands that breathes with the world:
// faster when minds are thinking, a flash on every tick, and when the Operator
// freezes the world, the field freezes too. Mid-stroke.
import { makeNoise } from "./noise.js";

export function createField(canvas) {
  const ctx = canvas.getContext("2d", { alpha: false });
  const N = makeNoise(7);
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  let w = 0, h = 0, dpr = 1, parts = [], t = 0;
  let mode = "orb", energy = 0.25, boost = 0, frozen = false, raf = 0;
  const INK = [11, 11, 10];

  function resize() {
    dpr = Math.min(1.5, window.devicePixelRatio || 1);
    w = canvas.clientWidth; h = canvas.clientHeight;
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = `rgb(${INK})`;
    ctx.fillRect(0, 0, w, h);
    const count = Math.min(1600, Math.round((w * h) / (mode === "orb" ? 1150 : 2400)));
    parts = Array.from({ length: count }, () => spawn({}));
  }

  function center() {
    return mode === "orb" ? { x: w > 900 ? w * 0.66 : w * 0.5, y: h * 0.5, R: Math.min(w, h) * (w > 900 ? 0.34 : 0.3) } : { x: w / 2, y: h / 2, R: 0 };
  }

  function spawn(p) {
    if (mode === "orb") {
      const c = center();
      const a = Math.random() * Math.PI * 2;
      const r = c.R * (0.75 + Math.random() * 0.5);
      p.x = c.x + Math.cos(a) * r; p.y = c.y + Math.sin(a) * r;
    } else {
      p.x = Math.random() * w; p.y = Math.random() * h;
    }
    p.life = 60 + Math.random() * 220;
    p.age = 0;
    p.bright = Math.random();
    return p;
  }

  function step() {
    const c = center();
    const e = Math.min(1.6, energy + boost);
    boost *= 0.94;
    const speed = (mode === "orb" ? 0.9 : 0.55) * (0.35 + e);
    const fade = mode === "orb" ? 0.055 : 0.07;
    ctx.fillStyle = `rgba(${INK},${fade})`;
    ctx.fillRect(0, 0, w, h);
    t += 0.0016 * (0.4 + e);
    const sc = mode === "orb" ? 0.0021 : 0.0016;
    ctx.lineWidth = 1;
    for (const p of parts) {
      const ang = N.noise3(p.x * sc, p.y * sc, t) * Math.PI * 2.2;
      let vx = Math.cos(ang), vy = Math.sin(ang);
      if (mode === "orb") {
        const dx = p.x - c.x, dy = p.y - c.y;
        const r = Math.hypot(dx, dy) || 1;
        const pull = (c.R - r) / c.R;
        vx += (dx / r) * pull * 1.6 + (-dy / r) * 0.9;
        vy += (dy / r) * pull * 1.6 + (dx / r) * 0.9;
      }
      const nx = p.x + vx * speed, ny = p.y + vy * speed;
      const life = p.age / p.life;
      const a = (mode === "orb" ? 0.34 : mode === "live" ? 0.11 : 0.07) * Math.sin(Math.PI * life) * (0.45 + p.bright * 0.55) * (0.7 + e * 0.5);
      ctx.strokeStyle = `rgba(244,241,234,${a.toFixed(3)})`;
      ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(nx, ny); ctx.stroke();
      p.x = nx; p.y = ny; p.age += 1;
      if (p.age > p.life || p.x < -10 || p.y < -10 || p.x > w + 10 || p.y > h + 10) spawn(p);
    }
  }

  function loop() {
    raf = 0;
    if (frozen || document.hidden) return;
    step();
    raf = requestAnimationFrame(loop);
  }
  const kick = () => { if (!raf && !frozen && !reduced) raf = requestAnimationFrame(loop); };

  window.addEventListener("resize", () => { resize(); if (reduced) settle(); });
  document.addEventListener("visibilitychange", kick);
  function settle() { for (let i = 0; i < 260; i++) step(); }

  resize();
  if (reduced) settle(); else kick();

  return {
    setMode(m) { if (m === mode) return; mode = m; resize(); if (reduced) settle(); kick(); },
    setEnergy(v) { energy = Math.max(0.05, Math.min(1.2, v)); },
    pulse(v = 0.35) { boost = Math.min(1.2, boost + v); },
    freeze(f) { frozen = !!f; if (!frozen) kick(); },
  };
}

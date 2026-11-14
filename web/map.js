// The city as a living organism, and everything that happens in it, drawn.
// Streets are grown, not drawn: wobbling strands with fine hairs that thicken with every journey.
// Each mind has its own colour and a glyph for what it is doing right now. Acts become motion:
// words flow along live lines between people, gifts and trades travel, answers burst, blood flashes.
import { makeNoise } from "./noise.js";
import { hueOf } from "./lib.js";

const PAPER = "244,241,234";
const LILAC = "196,181,253";
const BLOOD = "214,72,72";
const tint = (id, a = 1) => `hsla(${hueOf(id)}, 52%, 72%, ${a})`;

export function createMap(container, locations, { onSelect, onLink } = {}) {
  container.innerHTML = "";
  const canvas = document.createElement("canvas");
  canvas.className = "map-canvas";
  container.append(canvas);
  const ctx = canvas.getContext("2d");
  const N = makeNoise(42);
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;

  let W = 0, H = 0, dpr = 1, scale = 1, ox = 0, oy = 0;
  let frozen = false, raf = 0, selected = null, hover = null, focus = null, hoverLink = null;
  let storm = null, doorAnchor = null;
  const traffic = new Map();
  const dots = new Map();
  const effects = [];
  const links = new Map(); // "a|b" -> { a, b, last, count, whisper, from }

  const locs = Object.values(locations);
  const key = (a, b) => [a, b].sort().join("|");
  const edges = new Map();
  const adj = {};
  const routeCache = new Map();
  const addEdge = (a, b, minutes) => {
    const k = key(a, b);
    if (edges.has(k) || !locations[a] || !locations[b]) return;
    edges.set(k, { a, b, minutes, pts: grow(locations[a], locations[b], k), hairs: [] });
    (adj[a] ??= []).push({ to: b, minutes });
    (adj[b] ??= []).push({ to: a, minutes });
  };
  function grow(A, B, k) {
    const pts = [];
    let s = 0;
    for (const ch of k) s = (s * 31 + ch.charCodeAt(0)) % 997;
    const len = Math.hypot(B.x - A.x, B.y - A.y) || 1;
    const nx = -(B.y - A.y) / len, ny = (B.x - A.x) / len;
    const steps = Math.max(18, Math.round(len / 9));
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const off = N.fbm(t * 2.4, s * 0.37, 0.5, 3) * len * 0.11 * Math.sin(Math.PI * t);
      pts.push([A.x + (B.x - A.x) * t + nx * off, A.y + (B.y - A.y) * t + ny * off]);
    }
    return pts;
  }
  for (const l of locs) for (const link of l.links) addEdge(l.id, link.to, link.minutes);
  let hs = 1;
  const rnd = () => ((hs = (hs * 1664525 + 1013904223) >>> 0) / 4294967296);
  function walk(x, y, ang, steps, stepLen) {
    const pts = [[x, y]];
    for (let i = 0; i < steps; i++) {
      ang += (rnd() - 0.5) * 0.9;
      const l = stepLen * (1 - i / (steps + 2));
      x += Math.cos(ang) * l; y += Math.sin(ang) * l;
      pts.push([x, y]);
    }
    return pts;
  }
  for (const e of edges.values()) {
    const count = 2 + Math.floor(rnd() * 3);
    for (let i = 0; i < count; i++) {
      const at = e.pts[Math.floor((0.15 + rnd() * 0.7) * (e.pts.length - 1))];
      e.hairs.push(walk(at[0], at[1], rnd() * Math.PI * 2, 5 + Math.floor(rnd() * 7), 7));
    }
  }
  const dendrites = [];
  for (const l of locs) {
    const count = l.hidden ? 7 : 11 + Math.floor(rnd() * 6);
    for (let i = 0; i < count; i++) dendrites.push({ hidden: !!l.hidden, pts: walk(l.x, l.y, (i / count) * Math.PI * 2 + rnd() * 0.5, 4 + Math.floor(rnd() * 6), 9) });
  }
  function ensureDoor() {
    if (doorAnchor && locations.nulldoor && !edges.has(key(doorAnchor, "nulldoor"))) addEdge(doorAnchor, "nulldoor", 20);
    routeCache.clear();
  }
  function route(a, b) {
    const k = `${a}>${b}`;
    if (routeCache.has(k)) return routeCache.get(k);
    const dist = { [a]: 0 }, prev = {}, seen = new Set();
    while (true) {
      let cur = null, best = Infinity;
      for (const [id, v] of Object.entries(dist)) if (!seen.has(id) && v < best) { best = v; cur = id; }
      if (cur === null || cur === b) break;
      seen.add(cur);
      for (const l of adj[cur] ?? []) { const nd = best + l.minutes; if (nd < (dist[l.to] ?? Infinity)) { dist[l.to] = nd; prev[l.to] = cur; } }
    }
    const nodes = [b];
    while (nodes[0] !== a && prev[nodes[0]]) nodes.unshift(prev[nodes[0]]);
    if (nodes[0] !== a) { routeCache.set(k, null); return null; }
    const pts = [];
    for (let i = 0; i < nodes.length - 1; i++) {
      const e = edges.get(key(nodes[i], nodes[i + 1]));
      const seg = e.a === nodes[i] ? e.pts : [...e.pts].reverse();
      pts.push(...(i ? seg.slice(1) : seg));
    }
    const r = { nodes, pts };
    routeCache.set(k, r);
    return r;
  }
  function addTraffic(a, b, w = 1) {
    const r = route(a, b);
    if (!r) return;
    for (let i = 0; i < r.nodes.length - 1; i++) { const k = key(r.nodes[i], r.nodes[i + 1]); traffic.set(k, (traffic.get(k) ?? 0) + w); }
  }
  const at = (pts, t) => {
    const f = Math.max(0, Math.min(1, t)) * (pts.length - 1);
    const i = Math.floor(f), r = f - i, p = pts[i], q = pts[Math.min(pts.length - 1, i + 1)];
    return [p[0] + (q[0] - p[0]) * r, p[1] + (q[1] - p[1]) * r];
  };

  // ── layout ──
  function resize() {
    dpr = Math.min(2, window.devicePixelRatio || 1);
    W = container.clientWidth; H = container.clientHeight || W * 0.66;
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    canvas.style.width = `${W}px`; canvas.style.height = `${H}px`;
    const pad = 36;
    scale = Math.min((W - pad * 2) / 1000, (H - pad * 2) / 660);
    ox = (W - 1000 * scale) / 2; oy = (H - 660 * scale) / 2;
    draw();
  }
  const X = (x) => ox + x * scale, Y = (y) => oy + y * scale;
  const posOf = (id) => { const d = dots.get(id); if (d?.alive) return [X(d.x), Y(d.y)]; const l = locations[id]; return l ? [X(l.x), Y(l.y)] : null; };
  function poly(pts) {
    ctx.beginPath();
    ctx.moveTo(X(pts[0][0]), Y(pts[0][1]));
    for (let i = 1; i < pts.length; i++) ctx.lineTo(X(pts[i][0]), Y(pts[i][1]));
    ctx.stroke();
  }
  // a gentle arc between two screen points (so short links between neighbours stay visible)
  function arc(a, b, bend = 0.35) {
    const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const len = Math.hypot(dx, dy) || 1;
    const lift = Math.max(16, len * bend);
    return [mx - (dy / len) * lift, my + (dx / len) * lift];
  }
  const qpoint = (a, c, b, t) => [(1 - t) ** 2 * a[0] + 2 * (1 - t) * t * c[0] + t * t * b[0], (1 - t) ** 2 * a[1] + 2 * (1 - t) * t * c[1] + t * t * b[1]];

  function draw() {
    const now = performance.now();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.lineCap = "round"; ctx.lineJoin = "round";
    const dim = focus ? 0.45 : 1;
    ctx.lineWidth = 0.6;
    for (const d of dendrites) {
      if (d.hidden && !doorAnchor) continue;
      ctx.strokeStyle = d.hidden ? `rgba(${LILAC},${0.16 * dim})` : `rgba(${PAPER},${0.07 * dim})`;
      poly(d.pts);
    }
    const maxT = Math.max(1, ...traffic.values());
    for (const [k, e] of edges) {
      const door = e.a === "nulldoor" || e.b === "nulldoor";
      if (door) { ctx.setLineDash([2, 5]); ctx.strokeStyle = `rgba(${LILAC},.55)`; ctx.lineWidth = 1; poly(e.pts); ctx.setLineDash([]); continue; }
      const tr = traffic.get(k) ?? 0;
      ctx.strokeStyle = `rgba(${PAPER},${0.13 * dim})`; ctx.lineWidth = 0.7; poly(e.pts);
      if (tr > 0) {
        const f = Math.log1p(tr) / Math.log1p(maxT);
        ctx.strokeStyle = `rgba(${PAPER},${((0.12 + f * 0.55) * dim).toFixed(3)})`;
        ctx.lineWidth = 0.8 + f * 4.2 * Math.min(1, scale * 1.4);
        poly(e.pts);
      }
      ctx.lineWidth = 0.5; ctx.strokeStyle = `rgba(${PAPER},${0.06 * dim})`;
      for (const hr of e.hairs) poly(hr);
    }
    if (storm && locations[storm]) {
      const l = locations[storm];
      ctx.fillStyle = `rgba(${PAPER},.55)`;
      for (let i = 0; i < 260; i++) {
        const a = Math.random() * Math.PI * 2, r = Math.pow(Math.random(), 0.6) * 62;
        if (Math.random() < 0.5) ctx.fillRect(X(l.x + Math.cos(a) * r), Y(l.y + Math.sin(a) * r), 1, 1);
      }
    }
    for (const l of locs) {
      if (l.hidden && !doorAnchor) continue;
      const x = X(l.x), y = Y(l.y), c = l.hidden ? LILAC : PAPER;
      ctx.fillStyle = `rgba(${c},.10)`; ctx.beginPath(); ctx.arc(x, y, 10, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = `rgba(${c},.9)`; ctx.beginPath(); ctx.arc(x, y, 2.2, 0, Math.PI * 2); ctx.fill();
      ctx.font = `500 ${Math.max(9, 10 * Math.min(1.2, scale * 1.15))}px "Geist Mono", ui-monospace, monospace`;
      ctx.letterSpacing = "0.14em"; ctx.textAlign = "center";
      ctx.lineWidth = 4; ctx.strokeStyle = "rgba(11,11,10,.92)"; ctx.strokeText(l.name.toUpperCase(), x, y + 22);
      ctx.fillStyle = `rgba(${c},${0.55 * dim})`; ctx.fillText(l.name.toUpperCase(), x, y + 22);
    }

    // live conversation lines (click one to read the conversation)
    for (const [k, ln] of links) {
      const age = now - ln.last;
      if (age > 26000) { links.delete(k); continue; }
      const a = posOf(ln.from), b = posOf(ln.from === ln.a ? ln.b : ln.a);
      if (!a || !b) continue;
      const fade = Math.min(1, (26000 - age) / 6000);
      const c = arc(a, b);
      const hot = hoverLink === k;
      ctx.strokeStyle = ln.whisper ? `rgba(${LILAC},${0.5 * fade})` : tint(ln.from, (hot ? 0.95 : 0.55) * fade);
      ctx.lineWidth = hot ? 2 : 1.2;
      ctx.setLineDash(ln.whisper ? [1, 5] : [3, 7]);
      ctx.lineDashOffset = -now / 45;
      ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.quadraticCurveTo(c[0], c[1], b[0], b[1]); ctx.stroke();
      ctx.setLineDash([]);
      ln.geom = { a, c, b };
      if (hot) { ctx.font = `400 11px "Geist Mono", monospace`; ctx.fillStyle = `rgba(${PAPER},.85)`; ctx.textAlign = "center"; ctx.fillText(`${ln.count} message${ln.count > 1 ? "s" : ""} · click to read`, c[0], c[1] - 6); }
    }

    // the living
    for (const [id, d] of dots) {
      if (!d.alive) continue;
      d.x += (d.tx - d.x) * 0.08; d.y += (d.ty - d.y) * 0.08;
      if (!frozen) { d.trail.push([d.x, d.y]); if (d.trail.length > 26) d.trail.shift(); }
      const isFocus = !focus || focus === id;
      const alpha = isFocus ? 1 : 0.28;
      const sel = id === selected, hv = id === hover;
      if (d.trail.length > 2) {
        for (let i = 1; i < d.trail.length; i++) {
          ctx.strokeStyle = tint(id, (i / d.trail.length) * 0.4 * alpha);
          ctx.lineWidth = 1.2;
          ctx.beginPath(); ctx.moveTo(X(d.trail[i - 1][0]), Y(d.trail[i - 1][1])); ctx.lineTo(X(d.trail[i][0]), Y(d.trail[i][1])); ctx.stroke();
        }
      }
      const x = X(d.x), y = Y(d.y);
      glyph(d, x, y, now, alpha);
      if (d.truth) { ctx.strokeStyle = `rgba(${LILAC},${0.9 * alpha})`; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(x, y, 5.5, 0, Math.PI * 2); ctx.stroke(); }
      ctx.fillStyle = tint(id, alpha);
      ctx.beginPath(); ctx.arc(x, y, sel || focus === id ? 4 : 3, 0, Math.PI * 2); ctx.fill();
      if (sel || hv || focus === id) {
        ctx.strokeStyle = `rgba(${PAPER},.85)`; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(x, y, 9, 0, Math.PI * 2); ctx.stroke();
        ctx.font = `italic 400 16px "Instrument Serif", Georgia, serif`; ctx.letterSpacing = "0px"; ctx.textAlign = "left";
        ctx.lineWidth = 4; ctx.strokeStyle = "rgba(11,11,10,.9)"; ctx.strokeText(d.name, x + 12, y - 8);
        ctx.fillStyle = tint(id, 1); ctx.fillText(d.name, x + 12, y - 8);
        if (d.label) { ctx.font = `400 10px "Geist Mono", monospace`; ctx.fillStyle = `rgba(${PAPER},.6)`; ctx.strokeText(d.label, x + 12, y + 6); ctx.fillText(d.label, x + 12, y + 6); }
      }
    }

    // acts
    for (let i = effects.length - 1; i >= 0; i--) {
      const fx = effects[i];
      const t = (now - fx.t0) / fx.dur;
      if (t >= 1) { effects.splice(i, 1); continue; }
      if (t < 0) continue;
      drawFx(fx, t);
    }
  }

  // what each mind is doing, as a small living glyph around its dot
  function glyph(d, x, y, now, alpha) {
    const a = d.a;
    const ph = (now / 1000 + d.phase) % 1000;
    ctx.save();
    ctx.globalAlpha = alpha;
    if (d.thinking) {
      const p = (ph % 1.6) / 1.6;
      ctx.strokeStyle = tint(d.id, 0.6 * (1 - p)); ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(x, y, 4 + p * 14, 0, Math.PI * 2); ctx.stroke();
    }
    if (a === "work" || a === "craft_shard") {
      ctx.strokeStyle = tint(d.id, 0.8); ctx.lineWidth = 1.4;
      for (let k = 0; k < 3; k++) { const s = ph * 2.4 + (k * Math.PI * 2) / 3; ctx.beginPath(); ctx.arc(x, y, 7.5, s, s + 0.7); ctx.stroke(); }
    } else if (a === "read") {
      const flap = Math.sin(ph * 5) * 2.5;
      ctx.strokeStyle = `rgba(${PAPER},.75)`; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x - 6, y - 10); ctx.lineTo(x - 1, y - 9 + flap * 0.3); ctx.lineTo(x - 1, y - 4); ctx.lineTo(x - 6, y - 5); ctx.closePath(); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x + 4, y - 10 - flap * 0.2); ctx.lineTo(x - 1, y - 9 + flap * 0.3); ctx.lineTo(x - 1, y - 4); ctx.lineTo(x + 4, y - 5); ctx.closePath(); ctx.stroke();
    } else if (a === "rest") {
      const b = 0.5 + 0.5 * Math.sin(ph * 1.4);
      ctx.fillStyle = tint(d.id, 0.08 + 0.12 * b); ctx.beginPath(); ctx.arc(x, y, 8 + 4 * b, 0, Math.PI * 2); ctx.fill();
      ctx.font = "italic 400 11px Georgia, serif"; ctx.fillStyle = `rgba(${PAPER},${0.35 + 0.3 * b})`; ctx.textAlign = "left"; ctx.fillText("z", x + 6, y - 6 - 3 * b);
    } else if (a === "leisure") {
      for (let k = 0; k < 4; k++) {
        const s = ph * 1.6 + k * 1.57, r = 8 + 3 * Math.sin(ph * 3 + k);
        ctx.fillStyle = tint(d.id, 0.7); ctx.fillRect(x + Math.cos(s) * r - 0.75, y + Math.sin(s) * r - 0.75, 1.5, 1.5);
      }
    } else if (a === "explore") {
      const p = (ph % 2) / 2;
      ctx.strokeStyle = `rgba(${PAPER},${0.5 * (1 - p)})`; ctx.setLineDash([2, 3]); ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(x, y, 6 + p * 16, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
    } else if (a === "solve") {
      ctx.font = "500 12px 'Geist Mono', monospace"; ctx.textAlign = "center"; ctx.fillStyle = tint(d.id, 0.6 + 0.4 * Math.abs(Math.sin(ph * 3)));
      ctx.fillText("?", x, y - 9);
    }
    ctx.restore();
  }

  function drawFx(fx, t) {
    const ease = 1 - Math.pow(1 - t, 3);
    if (fx.kind === "give" || fx.kind === "trade" || fx.kind === "buy" || fx.kind === "post") {
      const a = posOf(fx.a), b = posOf(fx.b);
      if (!a || !b) return;
      const c = arc(a, b, 0.5);
      const p = qpoint(a, c, b, ease);
      ctx.strokeStyle = tint(fx.a, 0.25 * (1 - t)); ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.quadraticCurveTo(c[0], c[1], b[0], b[1]); ctx.stroke();
      ctx.save(); ctx.translate(p[0], p[1]); ctx.rotate(t * 6);
      ctx.fillStyle = fx.kind === "post" ? `rgba(${LILAC},.9)` : `rgba(${PAPER},.95)`;
      if (fx.kind === "buy" || fx.kind === "give") ctx.fillRect(-3, -3, 6, 6); else { ctx.beginPath(); ctx.arc(0, 0, 3, 0, Math.PI * 2); ctx.fill(); }
      ctx.restore();
      if (fx.label) { ctx.font = "400 10px 'Geist Mono', monospace"; ctx.textAlign = "center"; ctx.fillStyle = `rgba(${PAPER},${0.9 * (1 - t * 0.6)})`; ctx.fillText(fx.label, p[0], p[1] - 9); }
      return;
    }
    const p = posOf(fx.a);
    if (!p) return;
    if (fx.kind === "solved") {
      ctx.strokeStyle = `rgba(${PAPER},${1 - t})`; ctx.lineWidth = 1.2;
      for (let k = 0; k < 8; k++) { const a = (k / 8) * Math.PI * 2; ctx.beginPath(); ctx.moveTo(p[0] + Math.cos(a) * (6 + 10 * ease), p[1] + Math.sin(a) * (6 + 10 * ease)); ctx.lineTo(p[0] + Math.cos(a) * (10 + 18 * ease), p[1] + Math.sin(a) * (10 + 18 * ease)); ctx.stroke(); }
      ctx.font = "500 13px 'Geist Mono', monospace"; ctx.textAlign = "center"; ctx.fillStyle = `rgba(${PAPER},${1 - t})`; ctx.fillText("✓", p[0], p[1] - 14 - 10 * ease);
    } else if (fx.kind === "wrong") {
      ctx.font = "500 12px 'Geist Mono', monospace"; ctx.textAlign = "center"; ctx.fillStyle = `rgba(${BLOOD},${1 - t})`; ctx.fillText("×", p[0] + Math.sin(t * 40) * 2, p[1] - 12);
    } else if (fx.kind === "attack" || fx.kind === "steal") {
      const b = posOf(fx.b);
      if (!b) return;
      ctx.strokeStyle = fx.kind === "attack" ? `rgba(${BLOOD},${1 - t})` : `rgba(${PAPER},${0.7 * (1 - t)})`;
      ctx.lineWidth = fx.kind === "attack" ? 2.4 : 1;
      if (fx.kind === "steal") ctx.setLineDash([1, 4]);
      ctx.beginPath(); ctx.moveTo(p[0], p[1]); ctx.lineTo(b[0] + Math.sin(t * 50) * 3, b[1]); ctx.stroke(); ctx.setLineDash([]);
      if (fx.kind === "attack") { ctx.fillStyle = `rgba(${BLOOD},${0.35 * (1 - t)})`; ctx.beginPath(); ctx.arc(b[0], b[1], 6 + 14 * ease, 0, Math.PI * 2); ctx.fill(); }
    } else if (fx.kind === "death") {
      ctx.strokeStyle = `rgba(${BLOOD},${1 - t})`; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(p[0], p[1], 4 + 40 * ease, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = `rgba(${PAPER},${0.8 * (1 - t)})`;
      for (let k = 0; k < 30; k++) { const a = k * 2.399, r = 4 + 34 * ease * ((k % 7) / 7 + 0.3); ctx.fillRect(p[0] + Math.cos(a) * r, p[1] + Math.sin(a) * r + 20 * t * t, 1.5, 1.5); }
    } else if (fx.kind === "truth") {
      for (let k = 0; k < 3; k++) { const tt = Math.max(0, t - k * 0.12); ctx.strokeStyle = `rgba(${LILAC},${(1 - tt) * 0.9})`; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(p[0], p[1], 6 + 120 * (1 - Math.pow(1 - tt, 3)), 0, Math.PI * 2); ctx.stroke(); }
    } else if (fx.kind === "bond") {
      const b = posOf(fx.b);
      if (!b) return;
      const c = arc(p, b, 0.6);
      ctx.strokeStyle = `rgba(${LILAC},${0.9 * (1 - t)})`; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(p[0], p[1]); ctx.quadraticCurveTo(c[0], c[1], b[0], b[1]); ctx.stroke();
    } else if (fx.kind === "pulse") {
      ctx.strokeStyle = `rgba(${fx.color ?? PAPER},${0.8 * (1 - t)})`; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.arc(p[0], p[1], 8 + 30 * ease, 0, Math.PI * 2); ctx.stroke();
      if (fx.label) { ctx.font = "400 10px 'Geist Mono', monospace"; ctx.textAlign = "center"; ctx.fillStyle = `rgba(${PAPER},${1 - t})`; ctx.fillText(fx.label, p[0], p[1] - 16 - 12 * ease); }
    } else if (fx.kind === "read") {
      ctx.font = "italic 400 12px Georgia, serif"; ctx.textAlign = "center"; ctx.fillStyle = `rgba(${PAPER},${1 - t})`; ctx.fillText(fx.label ?? "", p[0], p[1] - 14 - 14 * ease);
    }
  }

  function loop() {
    raf = 0;
    draw();
    if (!frozen && !document.hidden && !reduced) raf = requestAnimationFrame(loop);
  }
  const kick = () => { if (!raf) raf = requestAnimationFrame(loop); };

  function place(list) {
    const groups = {};
    for (const p of list) {
      if (!p.alive) continue;
      const k = p.to ? `${p.loc}>${p.to}` : p.loc;
      (groups[k] ??= []).push(p);
    }
    const seen = new Set();
    for (const g of Object.values(groups)) {
      g.forEach((p, i) => {
        let x, y;
        if (p.to && locations[p.to]) {
          const r = route(p.loc, p.to);
          const pt = r ? at(r.pts, Math.max(0.06, Math.min(0.94, p.progress ?? 0.5))) : [locations[p.to].x, locations[p.to].y];
          x = pt[0] + (i - (g.length - 1) / 2) * 5; y = pt[1];
        } else {
          const l = locations[p.loc];
          if (!l) return;
          const ang = (i / g.length) * Math.PI * 2 - Math.PI / 2;
          const rad = g.length === 1 ? 0 : 16 + g.length * 1.8;
          x = l.x + Math.cos(ang) * rad; y = l.y + Math.sin(ang) * rad;
        }
        let d = dots.get(p.id);
        if (!d) { d = { id: p.id, x, y, trail: [], phase: Math.random() * 70 }; dots.set(p.id, d); }
        if (d.to !== p.to && p.to) addTraffic(p.loc, p.to);
        Object.assign(d, { tx: x, ty: y, to: p.to, name: p.name ?? p.id, thinking: !!p.thinking, truth: !!p.knowsTruth, alive: true, a: p.a, label: p.label });
        seen.add(p.id);
      });
    }
    for (const [id, d] of dots) if (!seen.has(id)) d.alive = false;
  }

  const distSeg = (p, a, c, b) => { let best = Infinity; for (let i = 0; i <= 16; i++) { const q = qpoint(a, c, b, i / 16); best = Math.min(best, Math.hypot(q[0] - p[0], q[1] - p[1])); } return best; };
  canvas.addEventListener("pointermove", (e) => {
    const r = canvas.getBoundingClientRect();
    const m = [e.clientX - r.left, e.clientY - r.top];
    let best = null, bd = 14;
    for (const [id, d] of dots) { if (!d.alive) continue; const dd = Math.hypot(X(d.x) - m[0], Y(d.y) - m[1]); if (dd < bd) { bd = dd; best = id; } }
    hover = best;
    hoverLink = null;
    if (!best) for (const [k, ln] of links) if (ln.geom && distSeg(m, ln.geom.a, ln.geom.c, ln.geom.b) < 7) { hoverLink = k; break; }
    canvas.style.cursor = best || hoverLink ? "pointer" : "default";
    if (frozen || reduced) draw();
  });
  canvas.addEventListener("click", () => {
    if (hover) onSelect?.(hover);
    else if (hoverLink) { const ln = links.get(hoverLink); if (ln) onLink?.(ln.a, ln.b); }
  });

  new ResizeObserver(resize).observe(container);
  resize();
  kick();

  return {
    update(list, opts = {}) {
      storm = opts.storm ?? null;
      if (opts.doorAnchor && opts.doorAnchor !== doorAnchor) { doorAnchor = opts.doorAnchor; ensureDoor(); }
      place(list);
      if (frozen || reduced) draw(); else kick();
    },
    select(id) { selected = id; if (frozen || reduced) draw(); },
    focus(id) { focus = id; if (frozen || reduced) draw(); },
    freeze(f) { frozen = !!f; if (!frozen) kick(); else draw(); },
    /** Animate an act. kinds: talk give trade buy post solved wrong attack steal death truth bond pulse read */
    fx(kind, o = {}) {
      if (kind === "talk") {
        const k = key(o.a, o.b);
        const ln = links.get(k) ?? { a: o.a, b: o.b, count: 0 };
        Object.assign(ln, { last: performance.now(), whisper: !!o.whisper, from: o.a, count: ln.count + 1 });
        links.set(k, ln);
      } else {
        effects.push({ kind, a: o.a, b: o.b, label: o.label, color: o.color, t0: performance.now() + (o.delay ?? 0), dur: o.dur ?? (kind === "truth" ? 2600 : kind === "death" ? 2200 : 1500) });
        if (effects.length > 120) effects.shift();
      }
      if (frozen || reduced) draw(); else kick();
    },
    addTraffic,
    resetTraffic() { traffic.clear(); for (const d of dots.values()) d.trail = []; },
    snapTo(list) { place(list); for (const d of dots.values()) { d.x = d.tx; d.y = d.ty; d.trail = []; } draw(); },
  };
}

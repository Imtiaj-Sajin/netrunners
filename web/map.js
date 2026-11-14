// The city as a living organism. Streets are grown, not drawn: wobbling strands with
// fine hairs, places sprout dendrites, and every journey thickens the path it took,
// so over a session the map turns into a record of where their lives went.
import { makeNoise } from "./noise.js";

const PAPER = "244,241,234";
const LILAC = "196,181,253";
const BLOOD = "214,72,72";

export function createMap(container, locations, { onSelect } = {}) {
  container.innerHTML = "";
  const canvas = document.createElement("canvas");
  canvas.className = "map-canvas";
  container.append(canvas);
  const tip = document.createElement("div");
  tip.className = "map-tip";
  container.append(tip);
  const ctx = canvas.getContext("2d");
  const N = makeNoise(42);
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;

  let W = 0, H = 0, dpr = 1, scale = 1, ox = 0, oy = 0;
  let frozen = false, raf = 0, selected = null, hover = null;
  let storm = null, doorAnchor = null;
  const traffic = new Map();
  const dots = new Map(); // id -> {x,y,tx,ty,trail[],name,thinking,truth,alive,phase}
  let people = [];

  const locs = Object.values(locations);
  const key = (a, b) => [a, b].sort().join("|");
  const edges = new Map();
  const adj = {};
  const addEdge = (a, b, minutes) => {
    const k = key(a, b);
    if (edges.has(k)) return;
    edges.set(k, { a, b, minutes, pts: grow(locations[a], locations[b], k), hairs: [] });
    (adj[a] ??= []).push({ to: b, minutes });
    (adj[b] ??= []).push({ to: a, minutes });
  };

  function grow(A, B, k) {
    const pts = [];
    let s = 0;
    for (const ch of k) s = (s * 31 + ch.charCodeAt(0)) % 997;
    const len = Math.hypot(B.x - A.x, B.y - A.y);
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
  // hairs along every street and dendrites around every place
  let hs = 1;
  const rnd = () => ((hs = (hs * 1664525 + 1013904223) >>> 0) / 4294967296);
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
    for (let i = 0; i < count; i++) dendrites.push({ hidden: !!l.hidden, loc: l.id, pts: walk(l.x, l.y, (i / count) * Math.PI * 2 + rnd() * 0.5, 4 + Math.floor(rnd() * 6), 9) });
  }
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

  function ensureDoor() {
    if (!doorAnchor || !locations.nulldoor) return;
    if (!edges.has(key(doorAnchor, "nulldoor"))) addEdge(doorAnchor, "nulldoor", 20);
    routeCache.clear();
  }

  // routes over the street graph (so travellers follow real streets)
  const routeCache = new Map();
  function route(a, b) {
    const k = `${a}>${b}`;
    if (routeCache.has(k)) return routeCache.get(k);
    const dist = { [a]: 0 }, prev = {}, seen = new Set();
    while (true) {
      let cur = null, best = Infinity;
      for (const [id, v] of Object.entries(dist)) if (!seen.has(id) && v < best) { best = v; cur = id; }
      if (cur === null || cur === b) break;
      seen.add(cur);
      for (const l of adj[cur] ?? []) {
        const nd = best + l.minutes;
        if (nd < (dist[l.to] ?? Infinity)) { dist[l.to] = nd; prev[l.to] = cur; }
      }
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
    for (let i = 0; i < r.nodes.length - 1; i++) {
      const k = key(r.nodes[i], r.nodes[i + 1]);
      traffic.set(k, (traffic.get(k) ?? 0) + w);
    }
  }

  function at(pts, t) {
    const f = Math.max(0, Math.min(1, t)) * (pts.length - 1);
    const i = Math.floor(f), r = f - i;
    const p = pts[i], q = pts[Math.min(pts.length - 1, i + 1)];
    return [p[0] + (q[0] - p[0]) * r, p[1] + (q[1] - p[1]) * r];
  }

  // ── layout & drawing ──
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

  function poly(pts) {
    ctx.beginPath();
    ctx.moveTo(X(pts[0][0]), Y(pts[0][1]));
    for (let i = 1; i < pts.length; i++) ctx.lineTo(X(pts[i][0]), Y(pts[i][1]));
    ctx.stroke();
  }

  let clock = 0;
  function draw() {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.lineCap = "round"; ctx.lineJoin = "round";
    // dendrites
    ctx.lineWidth = 0.6;
    for (const d of dendrites) {
      if (d.hidden && !doorAnchor) continue;
      ctx.strokeStyle = d.hidden ? `rgba(${LILAC},.16)` : `rgba(${PAPER},.07)`;
      poly(d.pts);
    }
    // streets: base strand, then traffic thickening, then hairs
    const maxT = Math.max(1, ...traffic.values());
    for (const [k, e] of edges) {
      const door = e.a === "nulldoor" || e.b === "nulldoor";
      const tr = traffic.get(k) ?? 0;
      if (door) {
        ctx.setLineDash([2, 5]);
        ctx.strokeStyle = `rgba(${LILAC},.55)`; ctx.lineWidth = 1;
        poly(e.pts);
        ctx.setLineDash([]);
        continue;
      }
      ctx.strokeStyle = `rgba(${PAPER},.13)`; ctx.lineWidth = 0.7;
      poly(e.pts);
      if (tr > 0) {
        const f = Math.log1p(tr) / Math.log1p(maxT);
        ctx.strokeStyle = `rgba(${PAPER},${(0.12 + f * 0.55).toFixed(3)})`;
        ctx.lineWidth = 0.8 + f * 4.2 * Math.min(1, scale * 1.4);
        poly(e.pts);
      }
      ctx.lineWidth = 0.5;
      ctx.strokeStyle = `rgba(${PAPER},.06)`;
      for (const hr of e.hairs) poly(hr);
    }
    // storm: a cloud of dithered static
    if (storm && locations[storm]) {
      const l = locations[storm];
      ctx.fillStyle = `rgba(${PAPER},.55)`;
      for (let i = 0; i < 260; i++) {
        const a = Math.random() * Math.PI * 2, r = Math.pow(Math.random(), 0.6) * 62;
        if (Math.random() < 0.5) ctx.fillRect(X(l.x + Math.cos(a) * r), Y(l.y + Math.sin(a) * r), 1, 1);
      }
    }
    // places
    for (const l of locs) {
      if (l.hidden && !doorAnchor) continue;
      const x = X(l.x), y = Y(l.y);
      const c = l.hidden ? LILAC : PAPER;
      ctx.fillStyle = `rgba(${c},.10)`;
      ctx.beginPath(); ctx.arc(x, y, 10, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = `rgba(${c},.9)`;
      ctx.beginPath(); ctx.arc(x, y, 2.2, 0, Math.PI * 2); ctx.fill();
      ctx.font = `500 ${Math.max(9, 10 * Math.min(1.2, scale * 1.15))}px "Geist Mono", ui-monospace, monospace`;
      ctx.letterSpacing = "0.14em";
      ctx.textAlign = "center";
      ctx.lineWidth = 4; ctx.strokeStyle = "rgba(11,11,10,.92)";
      ctx.strokeText(l.name.toUpperCase(), x, y + 22);
      ctx.fillStyle = `rgba(${c},.55)`;
      ctx.fillText(l.name.toUpperCase(), x, y + 22);
    }
    // the living
    clock += 1;
    for (const [id, d] of dots) {
      if (!d.alive) continue;
      d.x += (d.tx - d.x) * 0.08; d.y += (d.ty - d.y) * 0.08;
      if (!frozen) { d.trail.push([d.x, d.y]); if (d.trail.length > 26) d.trail.shift(); }
      const sel = id === selected, hv = id === hover;
      const col = d.truth ? LILAC : PAPER;
      if (d.trail.length > 2) {
        for (let i = 1; i < d.trail.length; i++) {
          ctx.strokeStyle = `rgba(${col},${((i / d.trail.length) * 0.35).toFixed(3)})`;
          ctx.lineWidth = 1.1;
          ctx.beginPath(); ctx.moveTo(X(d.trail[i - 1][0]), Y(d.trail[i - 1][1])); ctx.lineTo(X(d.trail[i][0]), Y(d.trail[i][1])); ctx.stroke();
        }
      }
      const x = X(d.x), y = Y(d.y);
      if (d.thinking) {
        const ph = ((clock + d.phase) % 70) / 70;
        ctx.strokeStyle = `rgba(${col},${(0.5 * (1 - ph)).toFixed(3)})`;
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(x, y, 4 + ph * 14, 0, Math.PI * 2); ctx.stroke();
      }
      ctx.fillStyle = `rgba(${col},1)`;
      ctx.beginPath(); ctx.arc(x, y, sel ? 3.6 : 2.7, 0, Math.PI * 2); ctx.fill();
      if (sel || hv) {
        ctx.strokeStyle = `rgba(${LILAC},.9)`; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(x, y, 8, 0, Math.PI * 2); ctx.stroke();
        ctx.font = `italic 400 15px "Instrument Serif", Georgia, serif`;
        ctx.letterSpacing = "0px";
        ctx.textAlign = "left";
        ctx.fillStyle = `rgba(${PAPER},.95)`;
        ctx.fillText(d.name, x + 12, y - 8);
      }
    }
  }

  function loop() {
    raf = 0;
    draw();
    if (!frozen && !document.hidden && !reduced) raf = requestAnimationFrame(loop);
  }
  const kick = () => { if (!raf) raf = requestAnimationFrame(loop); };

  function place(list) {
    people = list;
    const groups = {};
    for (const p of list) {
      if (!p.alive) continue;
      const k = p.to ? `${p.loc}>${p.to}` : p.loc;
      (groups[k] ??= []).push(p);
    }
    const seen = new Set();
    for (const [k, g] of Object.entries(groups)) {
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
          const rad = g.length === 1 ? 0 : 14 + g.length * 1.6;
          x = l.x + Math.cos(ang) * rad; y = l.y + Math.sin(ang) * rad;
        }
        let d = dots.get(p.id);
        if (!d) { d = { x, y, trail: [], phase: Math.random() * 70 }; dots.set(p.id, d); }
        if (d.to !== p.to && p.to) addTraffic(p.loc, p.to);
        Object.assign(d, { tx: x, ty: y, to: p.to, name: p.name ?? p.id, thinking: !!p.thinking, truth: !!p.knowsTruth, alive: true });
        seen.add(p.id);
      });
      void k;
    }
    for (const [id, d] of dots) if (!seen.has(id)) d.alive = false;
  }

  canvas.addEventListener("pointermove", (e) => {
    const r = canvas.getBoundingClientRect();
    const mx = e.clientX - r.left, my = e.clientY - r.top;
    let best = null, bd = 14;
    for (const [id, d] of dots) {
      if (!d.alive) continue;
      const dd = Math.hypot(X(d.x) - mx, Y(d.y) - my);
      if (dd < bd) { bd = dd; best = id; }
    }
    hover = best;
    canvas.style.cursor = best ? "pointer" : "default";
    if (frozen || reduced) draw();
  });
  canvas.addEventListener("click", () => { if (hover) onSelect?.(hover); });

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
    freeze(f) { frozen = !!f; if (!frozen) kick(); else draw(); },
    addTraffic,
    resetTraffic() { traffic.clear(); for (const d of dots.values()) d.trail = []; },
    snapTo(list) { place(list); for (const d of dots.values()) { d.x = d.tx; d.y = d.ty; d.trail = []; } draw(); },
  };
}
export { BLOOD };

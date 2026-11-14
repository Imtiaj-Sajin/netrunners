import { svg, colorOf } from "./lib.js";

/** The city map. Works for the live world and for replays. */
export function createMap(container, locations, { onSelect, showHidden = true } = {}) {
  container.innerHTML = "";
  const root = svg("svg", { viewBox: "0 0 1000 660", class: "map", role: "img", "aria-label": "Map of the Lattice" });
  const defs = svg("defs", {},
    svg("radialGradient", { id: "nodeGlow" }, svg("stop", { offset: "0%", "stop-color": "var(--cyan)", "stop-opacity": "0.45" }), svg("stop", { offset: "100%", "stop-color": "var(--cyan)", "stop-opacity": "0" })),
    svg("radialGradient", { id: "stormGlow" }, svg("stop", { offset: "0%", "stop-color": "var(--magenta)", "stop-opacity": "0.55" }), svg("stop", { offset: "100%", "stop-color": "var(--magenta)", "stop-opacity": "0" })),
    svg("pattern", { id: "grid", width: 40, height: 40, patternUnits: "userSpaceOnUse" }, svg("path", { d: "M 40 0 L 0 0 0 40", fill: "none", stroke: "var(--grid)", "stroke-width": 1 })),
  );
  root.append(defs, svg("rect", { x: 0, y: 0, width: 1000, height: 660, fill: "url(#grid)" }));
  const edges = svg("g", { class: "edges" });
  const nodes = svg("g", { class: "nodes" });
  const dots = svg("g", { class: "dots" });
  root.append(edges, nodes, dots);
  container.append(root);

  const locs = Object.values(locations);
  const drawn = new Set();
  for (const l of locs) {
    for (const link of l.links) {
      const key = [l.id, link.to].sort().join("|");
      if (drawn.has(key)) continue;
      drawn.add(key);
      const b = locations[link.to];
      edges.append(svg("line", { x1: l.x, y1: l.y, x2: b.x, y2: b.y, class: "edge" }));
    }
  }
  const doorEdge = svg("line", { class: "edge door-edge", visibility: "hidden" });
  edges.append(doorEdge);
  const nodeEls = {};
  for (const l of locs) {
    const g = svg("g", { class: `node kind-${l.kind}${l.hidden ? " hidden-node" : ""}`, transform: `translate(${l.x} ${l.y})` });
    const storm = svg("circle", { r: 70, fill: "url(#stormGlow)", class: "storm", visibility: "hidden" });
    g.append(storm, svg("circle", { r: 46, fill: "url(#nodeGlow)" }), svg("circle", { r: 9, class: "core" }), svg("text", { y: 30, class: "label" }, l.name));
    g.append(svg("title", {}, `${l.name}: ${l.desc}`));
    if (l.hidden && !showHidden) g.setAttribute("visibility", "hidden");
    nodes.append(g);
    nodeEls[l.id] = { g, storm };
  }

  const dotEls = new Map();
  let selected = null;

  function update(people, { storm, doorAnchor, doorKnown } = {}) {
    for (const [id, el] of Object.entries(nodeEls)) el.storm.setAttribute("visibility", id === storm ? "visible" : "hidden");
    const door = locations.nulldoor;
    if (door && doorAnchor) {
      const a = locations[doorAnchor];
      doorEdge.setAttribute("x1", a.x); doorEdge.setAttribute("y1", a.y); doorEdge.setAttribute("x2", door.x); doorEdge.setAttribute("y2", door.y);
      doorEdge.setAttribute("visibility", doorKnown || showHidden ? "visible" : "hidden");
    }
    const groups = {};
    for (const p of people) {
      if (!p.alive) continue;
      const key = p.to ? `${p.loc}>${p.to}` : p.loc;
      (groups[key] ??= []).push(p);
    }
    const seen = new Set();
    for (const [key, list] of Object.entries(groups)) {
      list.forEach((p, i) => {
        let x, y;
        if (p.to && locations[p.to]) {
          const a = locations[p.loc], b = locations[p.to];
          const t = Math.max(0.15, Math.min(0.85, p.progress ?? 0.5));
          x = a.x + (b.x - a.x) * t + (i - list.length / 2) * 6;
          y = a.y + (b.y - a.y) * t;
        } else {
          const l = locations[p.loc];
          const ang = (i / Math.max(1, list.length)) * Math.PI * 2 - Math.PI / 2;
          const r = list.length === 1 ? 0 : 18 + list.length * 1.5;
          x = l.x + Math.cos(ang) * r;
          y = l.y + Math.sin(ang) * r - (list.length === 1 ? 0 : 0);
        }
        let el = dotEls.get(p.id);
        if (!el) {
          el = svg("g", { class: "dot", tabindex: 0 });
          const c = svg("circle", { r: 7, fill: colorOf(p.id) });
          const ring = svg("circle", { r: 11, class: "ring", stroke: colorOf(p.id) });
          const t = svg("text", { y: -12, class: "dot-label" }, p.name ?? p.id);
          const title = svg("title", {}, p.name ?? p.id);
          el.append(ring, c, t, title);
          el.addEventListener("click", () => onSelect?.(p.id));
          el.addEventListener("keydown", (e) => { if (e.key === "Enter") onSelect?.(p.id); });
          dots.append(el);
          dotEls.set(p.id, el);
        }
        el.style.transform = `translate(${x}px, ${y}px)`;
        el.classList.toggle("thinking", !!p.thinking);
        el.classList.toggle("selected", p.id === selected);
        el.classList.toggle("truth", !!p.knowsTruth);
        el.querySelector("title").textContent = `${p.name ?? p.id}${p.a ? ` · ${p.a}` : ""}`;
        seen.add(p.id);
      });
    }
    for (const [id, el] of dotEls) if (!seen.has(id)) { el.remove(); dotEls.delete(id); }
  }

  return {
    update,
    select(id) { selected = id; for (const [k, el] of dotEls) el.classList.toggle("selected", k === id); },
  };
}

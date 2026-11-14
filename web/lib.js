// Small helpers shared by the viewer. No framework, no build step.
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/** h('div', {class:'x', onclick: fn}, 'text', child) */
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k === "style" && typeof v === "object") Object.assign(el.style, v);
    else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v);
    else if (k === "dataset") Object.assign(el.dataset, v);
    else if (k === "html") el.innerHTML = v;
    else el.setAttribute(k, v === true ? "" : String(v));
  }
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export function svg(tag, attrs = {}, ...children) {
  const el = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [k, v] of Object.entries(attrs || {})) if (v !== undefined && v !== null) el.setAttribute(k, String(v));
  for (const c of children.flat(Infinity)) if (c) el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return el;
}

export async function api(path, opts = {}) {
  const res = await fetch(path, {
    method: opts.method || (opts.body ? "POST" : "GET"),
    headers: opts.body ? { "content-type": "application/json" } : undefined,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
  return data;
}

const pad = (n) => String(n).padStart(2, "0");
export function worldClock(wm) {
  const total = wm + 6 * 60;
  const day = Math.floor(total / 1440) + 1;
  const mod = total % 1440;
  return `Day ${day} ${pad(Math.floor(mod / 60))}:${pad(Math.floor(mod % 60))}`;
}
export const fmt = {
  usd: (v) => (v === undefined || v === null ? "-" : v < 0.01 ? `$${v.toFixed(4)}` : `$${v.toFixed(2)}`),
  int: (v) => (v ?? 0).toLocaleString(),
  hours: (min) => (min < 60 ? `${Math.round(min)}m` : min < 2880 ? `${(min / 60).toFixed(min < 600 ? 1 : 0)}h` : `${(min / 1440).toFixed(1)}d`),
  dur: (ms) => {
    const s = Math.floor(ms / 1000), hh = Math.floor(s / 3600), mm = Math.floor((s % 3600) / 60);
    return hh ? `${hh}h ${pad(mm)}m` : `${mm}m ${pad(s % 60)}s`;
  },
  time: (iso) => (iso ? new Date(iso).toLocaleString() : "-"),
  clockTime: (iso) => (iso ? new Date(iso).toLocaleTimeString() : "-"),
  pct: (v) => `${Math.round(v * 100)}`,
};

export function hue(id) {
  let x = 0;
  for (const c of String(id)) x = (x * 31 + c.charCodeAt(0)) >>> 0;
  return (x * 137.508) % 360;
}
export const colorOf = (id) => `hsl(${hue(id)} 95% 62%)`;

/** A labelled meter. value 0..1 (or -1..1 when signed) */
export function meter(label, value, opts = {}) {
  const signed = !!opts.signed;
  const v = Math.max(signed ? -1 : 0, Math.min(1, value ?? 0));
  const fill = signed
    ? h("span", { class: "fill", style: { left: v < 0 ? `${50 + v * 50}%` : "50%", width: `${Math.abs(v) * 50}%`, background: v < 0 ? "var(--blood)" : "var(--paper)" } })
    : h("span", { class: "fill", style: { width: `${v * 100}%`, background: opts.color || "var(--fog)" } });
  return h("div", { class: `meter${signed ? " signed" : ""}`, title: opts.title || "" },
    h("span", { class: "m-label" }, label),
    h("span", { class: "m-track" }, fill),
    h("span", { class: "m-val" }, opts.text ?? (signed ? v.toFixed(2) : v.toFixed(2))),
  );
}

export const EVENT_GROUPS = {
  speech: ["speech", "speech.whisper", "net.post", "commitment"],
  thought: ["thought", "reflection"],
  life: ["death", "netrunner.woke", "bond.formed", "bond.proposed", "bond.declined", "bond.broken", "attack", "attack.miss", "steal", "steal.failed", "give", "dues.unpaid", "dues.paid"],
  truth: ["clue.found", "door.noticed", "door.failed", "truth.discovered", "shard.begun", "shard.crafted", "shard.uploaded", "deepnet.dive", "deepnet.result"],
  work: ["contract.posted", "contract.taken", "contract.joined", "contract.completed", "contract.failed", "contract.expired", "contract.abandoned", "buy", "item.use"],
  world: ["world.storm", "world.storm.end", "world.blackout", "world.blackout.end", "world.drought", "world.drought.end"],
};
export function groupOf(type) {
  for (const [g, list] of Object.entries(EVENT_GROUPS)) if (list.includes(type)) return g;
  if (type.startsWith("operator")) return "operator";
  return "action";
}

export function beep() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = "sawtooth"; o.frequency.setValueAtTime(220, ctx.currentTime);
    o.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.6);
    g.gain.setValueAtTime(0.0001, ctx.currentTime); g.gain.exponentialRampToValueAtTime(0.15, ctx.currentTime + 0.05);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 1.2);
    o.connect(g).connect(ctx.destination); o.start(); o.stop(ctx.currentTime + 1.3);
  } catch { /* no audio */ }
}

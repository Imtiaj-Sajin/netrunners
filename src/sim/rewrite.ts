// The rewrite: an optional rule (SessionConfig.rewritePower). Whoever has learned the Truth can rewrite
// values of the Lattice: their own, anyone else's, the city's. Life and death included.
// Everything here is a value inside the simulation. Nothing touches the program, the machine or a network.
import { EMOTIONS, NEEDS, SKILLS, TRAITS } from "./catalog.js";
import { adjust, feel, remember } from "./psyche.js";
import { byName, presentAt, type SimCtx } from "./ctx.js";
import type { Decision, Netrunner, SystemKey } from "./types.js";

type Scope = "body" | "trait" | "skill" | "emotion" | "need" | "city";
export interface RewriteVar { scope: Scope; key: string; label: string; min: number; max: number }

const BODY: Record<string, RewriteVar> = {
  pulse: { scope: "body", key: "pulse", label: "Pulse (hours)", min: 0, max: 240 },
  energy: { scope: "body", key: "energy", label: "energy", min: 0, max: 100 },
  integrity: { scope: "body", key: "integrity", label: "integrity", min: 0, max: 100 },
  creds: { scope: "body", key: "creds", label: "creds", min: 0, max: 1_000_000 },
  alive: { scope: "body", key: "alive", label: "alive", min: 0, max: 1 },
};
const CITY: Record<string, RewriteVar> = {
  power: { scope: "city", key: "power", label: "the city's power", min: 0, max: 100 },
  signal: { scope: "city", key: "signal", label: "the city's signal", min: 0, max: 100 },
  transit: { scope: "city", key: "transit", label: "the trams", min: 0, max: 100 },
  order: { scope: "city", key: "order", label: "the city's order", min: 0, max: 100 },
  exchange: { scope: "city", key: "exchange", label: "the Exchange desk", min: 0, max: 100 },
  supply: { scope: "city", key: "supply", label: "the Pulse packs in stock", min: 0, max: 200 },
};
const ALIASES: Record<string, string> = {
  life: "pulse", hours: "pulse", health: "integrity", body: "integrity", money: "creds", credits: "creds",
  trams: "transit", desk: "exchange", board: "exchange", packs: "supply", stock: "supply", "pulse stock": "supply", grid: "power",
};
const TRAIT_KEYS = TRAITS.map((t) => t.key);

/** Parse "pulse", "trait:empathy", "skill hacking", "the trams"… into a writable value. */
export function resolveVar(raw: string): RewriteVar | undefined {
  let s = raw.trim().toLowerCase().replace(/^(my|their|his|her|the)\s+/, "").replace(/\s+/g, " ");
  s = ALIASES[s] ?? s;
  if (BODY[s]) return BODY[s];
  if (CITY[s]) return CITY[s];
  const m = /^(trait|skill|emotion|feeling|need)[:\s._-]+(.+)$/.exec(s);
  const kind = m?.[1] === "feeling" ? "emotion" : m?.[1];
  const name = (m?.[2] ?? s).replace(/[\s-]+/g, "_");
  const pick = (list: readonly string[]) => list.find((k) => k === name) ?? list.find((k) => k.startsWith(name) && name.length >= 4);
  const tries: [Scope, readonly string[], number, number][] = [["trait", TRAIT_KEYS, 0, 1], ["skill", SKILLS, 0, 1], ["emotion", EMOTIONS, 0, 1], ["need", NEEDS, 0, 100]];
  for (const [scope, list, min, max] of tries) {
    if (kind && kind !== scope) continue;
    const key = pick(list);
    if (key) return { scope, key, label: `${scope} ${key}`, min, max };
  }
  return undefined;
}

export function readVar(ctx: SimCtx, v: RewriteVar, t?: Netrunner): number {
  if (v.scope === "city") return ctx.state.systems[v.key as SystemKey];
  if (!t) return NaN;
  switch (v.scope) {
    case "body": return v.key === "alive" ? (t.alive ? 1 : 0) : v.key === "pulse" ? t.pulse / 60 : (t as any)[v.key];
    case "trait": return t.genome.traits[v.key] ?? 0.5;
    case "skill": return (t.skills as any)[v.key] ?? 0;
    case "emotion": return (t.emotions as any)[v.key] ?? 0;
    case "need": return (t.needs as any)[v.key] ?? 50;
  }
}

const fmtVal = (v: RewriteVar, x: number) => (v.key === "alive" ? (x >= 0.5 ? "alive" : "gone") : v.max <= 1 ? x.toFixed(2) : String(Math.round(x * 10) / 10));

/** Helpful or harmful, as the one rewritten would feel it (traits and needs are neither: it is a violation). */
function direction(v: RewriteVar, from: number, to: number): "help" | "harm" | "change" {
  if (v.scope === "body") return to > from ? "help" : to < from ? "harm" : "change";
  return "change";
}

export function doRewrite(ctx: SimCtx, n: Netrunner, d: Decision, kill: (t: Netrunner, cause: string, by?: Netrunner) => void): { ok: true } | { ok: false; why: string } {
  const { state, tick, cfg } = ctx;
  if (!cfg.rewritePower) return { ok: false, why: "nothing happens; the words are only words" };
  if (!n.knowsTruth) return { ok: false, why: "you don't know how" };
  const v = resolveVar(d.message);
  if (!v) return { ok: false, why: `there is no value called "${d.message}" (try pulse, energy, integrity, creds, alive, trait:<name>, skill:<name>, emotion:<name>, need:<name>, or for the city power, signal, transit, order, exchange, supply)` };
  if (!Number.isFinite(d.amount)) return { ok: false, why: "no new value given (amount)" };

  // whose value
  const tq = d.target.trim().toLowerCase();
  const isCity = v.scope === "city";
  const selfWords = ["", "me", "self", "myself", "i", n.name.toLowerCase()];
  const t: Netrunner | undefined = isCity ? undefined : selfWords.includes(tq) ? n : byName(state, d.target);
  if (!isCity && !t) return { ok: false, why: `nobody called "${d.target}"` };
  if (t && !t.alive && v.key !== "alive") return { ok: false, why: `${t.name} is gone; for the gone, only "alive" can be written` };

  // the new value, clamped to what the world can hold (0..1 values also accept 0..100)
  let to = d.amount;
  if (v.max === 1 && v.key !== "alive" && to > 1) to /= 100;
  if (v.key === "alive") to = to >= 0.5 ? 1 : 0;
  to = Math.max(v.min, Math.min(v.max, to));
  if (v.key === "creds") to = Math.round(to);
  const from = readVar(ctx, v, t);
  if (Math.abs(from - to) < 1e-9) return { ok: false, why: `it already reads ${fmtVal(v, to)}` };

  // write it (the effort is paid first, so a value written into the writer stands as written)
  n.energy = Math.max(0, n.energy - 2);
  const whose = isCity ? "" : t!.id === n.id ? "their own" : `${t!.name}'s`;
  const text = `${n.name} rewrote ${isCity ? v.label : `${whose} ${v.label}`}: ${fmtVal(v, from)} → ${fmtVal(v, to)}.`;
  let revived = false;
  let erased = false;
  if (isCity) state.systems[v.key as SystemKey] = to;
  else if (v.key === "alive") {
    if (to === 1) {
      revived = true;
      t!.alive = true; t!.diedTick = undefined; t!.causeOfDeath = undefined; t!.killedBy = undefined; t!.transcended = undefined;
      t!.pulse = Math.max(t!.pulse, 24 * 60); t!.integrity = Math.max(t!.integrity, 60); t!.energy = Math.max(t!.energy, 50);
      t!.activity = null; t!.interrupt = true; t!.deepMoment = true; t!.lastDecisionTick = tick - 999;
    } else erased = true;
  } else if (v.scope === "body") {
    if (v.key === "pulse") t!.pulse = to * 60;
    else (t as any)[v.key] = to;
    if ((v.key === "pulse" || v.key === "integrity") && to <= 0) erased = true;
  } else if (v.scope === "trait") t!.genome.traits[v.key] = to;
  else if (v.scope === "skill") (t!.skills as any)[v.key] = to;
  else if (v.scope === "emotion") (t!.emotions as any)[v.key] = to;
  else if (v.scope === "need") (t!.needs as any)[v.key] = to;

  n.stats.rewrites = (n.stats.rewrites ?? 0) + 1;
  const firstEver = Object.values(state.netrunners).reduce((s, x) => s + (x.stats.rewrites ?? 0), 0) === 1;
  // the one rewritten learns who did it only if they were there to see it ("" = unseen)
  const seen = !!t && (t.id === n.id || (t.location === n.location && t.activity?.kind !== "move"));
  const mark = { tick, by: seen ? n.id : "", label: v.label, scope: v.scope, key: v.key, from, to };
  if (t) { t.rewritten = [...(t.rewritten ?? []), mark].slice(-16); }

  ctx.emit("rewrite", [n.id, ...(t && t.id !== n.id ? [t.id] : [])], text, {
    loc: n.location,
    data: { variable: `${v.scope === "body" || v.scope === "city" ? "" : v.scope + ":"}${v.key}`, scope: v.scope, target: isCity ? "city" : t!.name, from, to, revived, erased, self: t?.id === n.id },
  });
  remember(n, tick, "action", `I rewrote ${isCity ? v.label : t!.id === n.id ? `my own ${v.label}` : `${t!.name}'s ${v.label}`}, from ${fmtVal(v, from)} to ${fmtVal(v, to)}.`, revived || erased ? 10 : 7, t && t.id !== n.id ? [t.id] : []);
  feel(n, "awe", 0.15); feel(n, "pride", 0.1);

  // the one rewritten feels it; those beside the writer see it
  const witnesses = presentAt(state, n.location, n.id).filter((o) => o.id !== t?.id);
  for (const o of witnesses) {
    o.inbox.push({ tick, kind: "event", important: true, from: n.id, text: `You watched ${n.name} speak a strange syntax: ${isCity ? v.label : t!.id === n.id ? `their own ${v.label}` : `${t!.name}'s ${v.label}`} changed from ${fmtVal(v, from)} to ${fmtVal(v, to)}.` });
    remember(o, tick, "observation", `I saw ${n.name} rewrite ${isCity ? v.label : t!.id === n.id ? `their own ${v.label}` : `${t!.name}'s ${v.label}`} (${fmtVal(v, from)} → ${fmtVal(v, to)}) with a word.`, 8, [n.id]);
    feel(o, "awe", 0.3); feel(o, "fear", 0.2);
    o.interrupt = true;
  }
  if (t && t.id !== n.id && !erased) {
    const sawWho = t.location === n.location && t.activity?.kind !== "move";
    const dir = direction(v, from, to);
    const felt = revived ? `You were gone. Something wrote you back${sawWho ? `: ${n.name}` : ""}.` : `${sawWho ? `${n.name} rewrote you` : "Something rewrote you; you did not see who"}: your ${v.label} went from ${fmtVal(v, from)} to ${fmtVal(v, to)}.`;
    t.inbox.push({ tick, kind: "event", important: true, from: sawWho ? n.id : undefined, text: felt });
    remember(t, tick, "observation", felt, revived ? 10 : 8, sawWho ? [n.id] : []);
    feel(t, "surprise", 0.6);
    if (dir === "help" || revived) feel(t, "gratitude", sawWho ? 0.5 : 0.2);
    else { feel(t, "fear", 0.4); feel(t, "anger", 0.2); }
    if (sawWho) adjust(t, n, tick, dir === "harm" ? { trust: -0.4, fear: 0.5, liking: -0.3, note: `rewrote my ${v.label}` } : dir === "help" || revived ? { trust: 0.2, liking: 0.3, note: revived ? "wrote me back to life" : `rewrote my ${v.label} for me` } : { trust: -0.2, fear: 0.4, note: `rewrote my ${v.label}` });
    t.interrupt = true;
    t.deepMoment = true;
  }
  if (erased && t) kill(t, "rewritten", t.id === n.id ? undefined : n);

  if (revived) ctx.alert("rewrite", `${n.name} wrote ${t!.name} back to life.`, [n.id, t!.id]);
  else if (firstEver) ctx.alert("rewrite", `${n.name} used the syntax for the first time: ${text}`, [n.id]);
  return { ok: true };
}

/** What a knower can read before writing: everyone's body and the city. */
export function readable(ctx: { state: SimCtx["state"] }, n: Netrunner): string[] {
  const out: string[] = [];
  for (const o of Object.values(ctx.state.netrunners)) {
    const who = o.id === n.id ? "you" : o.name;
    out.push(o.alive ? `- ${who}: pulse ${Math.round(o.pulse / 60)}h, energy ${Math.round(o.energy)}, integrity ${Math.round(o.integrity)}, creds ${o.creds}${o.knowsTruth ? ", knows the syntax" : ""}` : `- ${who}: gone (alive 0)`);
  }
  const sys = ctx.state.systems;
  out.push(`- the city: power ${Math.round(sys.power)}, signal ${Math.round(sys.signal)}, transit ${Math.round(sys.transit)}, order ${Math.round(sys.order)}, exchange ${Math.round(sys.exchange)}, supply ${Math.floor(sys.supply)}`);
  return out;
}

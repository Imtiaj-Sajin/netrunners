// The city's body. Power, signal, trams, street order and the Exchange itself wear down every hour
// (faster with more people using them), and Pulse packs only exist if someone presses them.
// Upkeep work restores them. Neglect shows up as symptoms, never as explanations:
// netrunners see flickering lights, static, slow trams, scavengers, a thin board, rising prices.
// Working out what causes what is up to them.
import { alive, hoursPerTick, presentAt, ticksForMinutes, type SimCtx } from "./ctx.js";
import { feel, remember } from "./psyche.js";
import type { SystemKey, Systems, WorldState } from "./types.js";

export const SYSTEM_KEYS: SystemKey[] = ["power", "signal", "transit", "order", "exchange"];
export const freshSystems = (): Systems => ({ power: 84, signal: 82, transit: 80, order: 78, exchange: 82, supply: 16 });

// wear per world hour, before population pressure
const WEAR: Record<SystemKey, number> = { power: 1.15, signal: 0.95, transit: 0.85, order: 0.55, exchange: 1.05 };
export const SUPPLY_TARGET = 14;

export type Band = "good" | "worn" | "failing" | "collapsed";
export const band = (v: number): Band => (v >= 65 ? "good" : v >= 40 ? "worn" : v >= 18 ? "failing" : "collapsed");
const supplyBand = (s: number): Band => (s >= 10 ? "good" : s >= 4 ? "worn" : s >= 1 ? "failing" : "collapsed");

const SIGNS: Record<SystemKey | "supply", Record<Band, string>> = {
  power: { good: "The lights hold steady.", worn: "The lights flicker now and then.", failing: "Whole streets go dark for minutes at a time; the pods run cold.", collapsed: "Most of the city is dark. The pods barely hum." },
  signal: { good: "Terminals answer cleanly.", worn: "Terminals crackle with static.", failing: "Terminals drop half of what you send.", collapsed: "The Net is almost nothing but static." },
  transit: { good: "The trams run on time.", worn: "The trams are slow today.", failing: "The trams crawl; every trip takes far longer.", collapsed: "The trams have stopped. Everyone walks." },
  order: { good: "The streets feel calm.", worn: "People watch their backs.", failing: "Scavengers roam openly; things go missing.", collapsed: "No street is safe. People are getting hurt." },
  exchange: { good: "The board at the Exchange is busy.", worn: "The board looks thinner than it was.", failing: "Hardly anything new gets posted on the board.", collapsed: "The board is almost empty. No one is running the desk." },
  supply: { good: "Pulse packs are plentiful.", worn: "Pulse packs are getting scarce.", failing: "Only a few Pulse packs are left anywhere.", collapsed: "There are no Pulse packs left in the city." },
};

/** What anyone can notice about the city today, in words, with no causes attached. */
export function citySigns(state: WorldState): string[] {
  const s = state.systems;
  const out = SYSTEM_KEYS.map((k) => SIGNS[k][band(s[k])]);
  const price = packPrice(state);
  out.push(`${SIGNS.supply[supplyBand(s.supply)]}${Number.isFinite(price) ? ` (about ${price} creds each)` : ""}`);
  return out;
}

// ── effects other rules read ──
export const travelFactor = (state: WorldState) => ({ good: 1, worn: 1.25, failing: 1.6, collapsed: 2.1 })[band(state.systems.transit)];
export const contractRate = (state: WorldState) => ({ good: 1, worn: 0.65, failing: 0.35, collapsed: 0.12 })[band(state.systems.exchange)];
export const orderDanger = (state: WorldState) => Math.max(0, (60 - state.systems.order) / 60) * 0.3;
export const restFactor = (state: WorldState) => ({ good: 1, worn: 0.85, failing: 0.6, collapsed: 0.4 })[band(state.systems.power)];
export function signalFails(state: WorldState, roll: number) {
  const b = band(state.systems.signal);
  return b === "collapsed" ? roll < 0.85 : b === "failing" ? roll < 0.45 : b === "worn" ? roll < 0.12 : false;
}
/** Pulse pack price follows the stock: plentiful = base, scarce = dear, none = sold out. */
export function packPrice(state: WorldState, base = 40) {
  const s = state.systems.supply;
  if (s < 1) return Infinity;
  const scarcity = Math.max(0, SUPPLY_TARGET - s) / SUPPLY_TARGET;
  return Math.round(base * state.marketMood * (1 + scarcity * 1.6));
}
/** Busy cities pay less per job; emptying cities pay more. */
export function payFactor(state: WorldState) {
  const n = alive(state).length;
  return n >= 9 ? 0.85 : n >= 6 ? 1 : n >= 4 ? 1.12 : 1.3;
}

const prev = new WeakMap<Systems, Record<string, Band>>();

/** Phase A: wear, symptoms crossing thresholds, and the chaos that neglect brings. */
export function tickSystems(ctx: SimCtx) {
  const { state, rng, tick, cfg } = ctx;
  const s = state.systems;
  const h = hoursPerTick(cfg);
  const pop = alive(state).length;
  const pressure = 0.55 + 0.09 * pop;
  for (const k of SYSTEM_KEYS) s[k] = round(Math.max(0, Math.min(100, s[k] - WEAR[k] * h * pressure)));
  // the presses run a little by themselves while the lights are on
  if (band(s.power) === "good" && rng.chance(0.06 * h * 6)) s.supply = Math.min(40, s.supply + 1);

  const before = prev.get(s) ?? {};
  const now: Record<string, Band> = {};
  for (const k of SYSTEM_KEYS) now[k] = band(s[k]);
  now.supply = supplyBand(s.supply);
  for (const [k, b] of Object.entries(now)) {
    if (before[k] && before[k] !== b) {
      const worse = ["good", "worn", "failing", "collapsed"].indexOf(b) > ["good", "worn", "failing", "collapsed"].indexOf(before[k]);
      ctx.emit(worse ? "world.decline" : "world.recover", [], SIGNS[k as SystemKey | "supply"][b], { data: { system: k, band: b, value: k === "supply" ? s.supply : s[k as SystemKey] } });
    }
  }
  prev.set(s, now);

  // chaos from neglect
  if (band(s.order) !== "good" && rng.chance((60 - s.order) / 60 * 0.05 * h * 6)) {
    const spot = rng.pick(["underpass", "commons", "market", "oldquarter"]);
    const victims = presentAt(state, spot);
    if (victims.length) {
      const v = rng.pick(victims);
      const lost = Math.min(v.creds, rng.int(5, 30));
      v.creds -= lost;
      v.integrity = Math.max(1, v.integrity - rng.int(3, 12));
      feel(v, "fear", 0.3); feel(v, "anger", 0.2);
      v.inbox.push({ tick, kind: "event", important: true, text: `Scavengers jumped you in ${state.locations[spot].name}. You lost ${lost} creds and got hurt.` });
      remember(v, tick, "observation", `Scavengers attacked me in ${state.locations[spot].name}. The streets are getting worse.`, 6);
      v.interrupt = true;
      ctx.emit("world.unrest", [v.id], `Scavengers rob ${v.name} in ${state.locations[spot].name}.`, { loc: spot, data: { lost } });
    }
  }
  if (band(s.power) === "collapsed" && !state.events.blackout && rng.chance(0.05 * h * 6)) {
    state.events.blackout = { location: rng.pick(["archive", "tower", "stacks"]), untilTick: tick + ticksForMinutes(cfg, 120) };
    ctx.emit("world.blackout", [], `The grid fails and ${state.locations[state.events.blackout.location]?.name ?? "a district"} goes black.`, { loc: state.events.blackout.location });
  }
}

/** What finishing an upkeep / production job does to the city. */
export function applyUpkeep(ctx: SimCtx, system: SystemKey | "supply", skill: number) {
  const s = ctx.state.systems;
  if (system === "supply") {
    const packs = Math.round(6 + 6 * skill);
    s.supply = Math.min(40, s.supply + packs);
    return `${packs} Pulse packs were pressed`;
  }
  const gain = Math.round(16 + 16 * skill);
  s[system] = Math.min(100, s[system] + gain);
  return `${system} restored by ${gain}`;
}

const round = (v: number) => Math.round(v * 100) / 100;

import type { Rng } from "../util/rng.js";
import type { ArchiveDoc } from "./world-data.js";
import type { Netrunner, SessionConfig, WorldEvent, WorldState } from "./types.js";

/** Everything a rule needs while a tick is being computed. */
export interface SimCtx {
  state: WorldState;
  cfg: SessionConfig;
  rng: Rng;
  tick: number;
  archive: ArchiveDoc[];
  sessionName: string;
  emit(type: string, who: string[], text: string, opts?: { loc?: string; data?: Record<string, unknown> }): WorldEvent;
  alert(kind: "truth" | "shard" | "death" | "extinction" | "first-kill" | "bond", text: string, who: string[]): void;
  saveShard(n: Netrunner): void;
  queueDeepNet(n: Netrunner, query: string, dueTick: number): void;
}

export const ticksForMinutes = (cfg: SessionConfig, minutes: number) => Math.max(1, Math.ceil(minutes / cfg.minutesPerTick));
export const hoursPerTick = (cfg: SessionConfig) => cfg.minutesPerTick / 60;

export function alive(state: WorldState): Netrunner[] {
  return Object.values(state.netrunners).filter((n) => n.alive);
}

/** Netrunners physically present at a location (travelers are between places). */
export function presentAt(state: WorldState, loc: string, except?: string): Netrunner[] {
  return alive(state).filter((n) => n.location === loc && n.id !== except && n.activity?.kind !== "move");
}

export function byName(state: WorldState, name: string): Netrunner | undefined {
  const q = name.trim().toLowerCase().replace(/^@/, "");
  if (!q) return undefined;
  const all = Object.values(state.netrunners);
  return all.find((n) => n.name.toLowerCase() === q || n.id === q)
    ?? all.find((n) => n.alive && n.name.toLowerCase().startsWith(q));
}

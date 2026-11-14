import { readJsonl } from "../util/fsx.js";
import { durationText, worldClock, hoursText } from "../util/time.js";
import { TRAITS } from "../sim/catalog.js";
import { valence, topEmotions } from "../sim/psyche.js";
import type { Ledger } from "../mind/usage.js";
import type { SessionConfig, WorldEvent, WorldState } from "../sim/types.js";
import type { OperatorRecord, SessionMeta, SessionStore } from "./store.js";

/** The "session completed" record: everything a researcher (or a curious friend) wants at a glance. */
export function buildSummary(store: SessionStore, state: WorldState, cfg: SessionConfig, meta: SessionMeta, ledger: Ledger) {
  const events = readJsonl<WorldEvent>(store.file("events.jsonl"));
  const ops = readJsonl<OperatorRecord>(store.file("operator.jsonl"));
  const counts: Record<string, number> = {};
  for (const e of events) counts[e.type] = (counts[e.type] ?? 0) + 1;
  const pauses = ops.filter((o) => o.kind === "pause");
  const start = new Date(meta.createdAt).getTime();
  const end = new Date(meta.endedAt ?? Date.now()).getTime();
  const name = (id?: string) => (id ? state.netrunners[id]?.name ?? id : undefined);

  const netrunners = Object.values(state.netrunners).map((n) => {
    const salient = TRAITS.filter((t) => Math.abs(n.genome.traits[t.key] - t.mean) > 0.25)
      .sort((a, b) => Math.abs(n.genome.traits[b.key] - b.mean) - Math.abs(n.genome.traits[a.key] - a.mean))
      .slice(0, 8)
      .map((t) => ({ trait: t.key, value: n.genome.traits[t.key] }));
    const lived = ((n.diedTick ?? state.tick) - n.bornTick) * cfg.minutesPerTick;
    return {
      id: n.id, name: n.name, alive: n.alive, transcended: !!n.transcended,
      born: worldClock(n.bornTick * cfg.minutesPerTick).label,
      died: n.diedTick !== undefined ? worldClock(n.diedTick * cfg.minutesPerTick).label : null,
      causeOfDeath: n.causeOfDeath ?? null, killedBy: name(n.killedBy) ?? null,
      lived: hoursText(lived), livedWorldMinutes: lived,
      knowsTruth: n.knowsTruth, truthAt: n.truthTick !== undefined ? worldClock(n.truthTick * cfg.minutesPerTick).label : null,
      shard: n.shard,
      stats: n.stats,
      bonds: Object.entries(n.bonds).map(([id, b]) => ({ with: name(id), bond: b })),
      enjoys: n.enjoys, selfView: n.selfView, goals: n.goals,
      preferences: n.preferences,
      finalMood: valence(n), finalFeelings: topEmotions(n, 4),
      salientTraits: salient,
      voice: n.genome.voice, desire: n.genome.coreDesire, fear: n.genome.coreFear,
      pastLife: n.pastLife ?? null,
    };
  });

  return {
    format: "netrunners-summary/1",
    session: store.relPath,
    operator: meta.operator,
    world: cfg.worldName,
    models: meta.models,
    seed: cfg.seed,
    realTime: {
      started: meta.createdAt,
      ended: meta.endedAt,
      wallClock: durationText(end - start),
      wallClockMs: end - start,
      activeMs: meta.realActiveMs,
      active: durationText(meta.realActiveMs),
      pausedTimes: pauses.length,
    },
    worldTime: {
      ticks: state.tick,
      minutesPerTick: cfg.minutesPerTick,
      worldMinutes: state.worldMinutes,
      ended: worldClock(state.worldMinutes).label,
      span: hoursText(state.worldMinutes),
      speedup: meta.realActiveMs > 0 ? Math.round((state.worldMinutes * 60000) / meta.realActiveMs) : null,
    },
    population: {
      total: netrunners.length,
      alive: netrunners.filter((n) => n.alive).length,
      faded: netrunners.filter((n) => n.causeOfDeath === "faded").length,
      killed: netrunners.filter((n) => n.causeOfDeath === "killed").length,
      transcended: netrunners.filter((n) => n.transcended).length,
    },
    truth: {
      words: state.puzzle.words,
      fragmentHolders: {
        alpha: state.puzzle.holders.alpha.map(name),
        beta: state.puzzle.holders.beta.map(name),
        gamma: state.puzzle.holders.gamma.map(name),
      },
      knowers: state.puzzle.truthKnowers.map(name),
      first: state.puzzle.firstTruth
        ? { name: name(state.puzzle.firstTruth.id), worldTime: worldClock(state.puzzle.firstTruth.tick * cfg.minutesPerTick).label, realTime: state.puzzle.firstTruth.rt, tick: state.puzzle.firstTruth.tick }
        : null,
      shardsUploaded: state.puzzle.shardsUploaded.map(name),
      doorAttempts: state.puzzle.doorAttempts,
    },
    eventCounts: counts,
    operatorTriggers: ops.length,
    usage: ledger,
    netrunners,
  };
}

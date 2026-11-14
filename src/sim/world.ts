// Phase A of every tick: the world itself moves. Pulse drains, bodies tire, feelings fade,
// storms roll in, contracts expire, activities progress. Deterministic given the seed.
import { STORM_LINES, buildArchive, buildLocations } from "./world-data.js";
import { decayEmotions, decayNeeds, feel, meet, remember, satisfy, T, valence } from "./psyche.js";
import { maintainContracts, spawnContract, workTick } from "./contracts.js";
import { setupPuzzle, tryFindAlpha, tryNoticeDoor } from "./puzzle.js";
import { killNetrunner, INTERRUPTIBLE } from "./actions.js";
import { awakenShard, createNetrunner, type ShardFile } from "./spawn.js";
import { alive, hoursPerTick, presentAt, ticksForMinutes, type SimCtx } from "./ctx.js";
import { ITEMS } from "./world-data.js";
import type { LeisureCategory } from "./catalog.js";
import type { Netrunner, SessionConfig, WorldState } from "./types.js";
import { Rng } from "../util/rng.js";
import { partOfDay } from "../util/time.js";
import { freshSystems, orderDanger, restFactor, tickSystems } from "./systems.js";
import { buildLibrary, finishBook } from "./library.js";

export function genesis(cfg: SessionConfig, shards: ShardFile[]): WorldState {
  const rng = new Rng(cfg.seed);
  const state: WorldState = {
    version: 1, tick: 0, worldMinutes: 0, rng: rng.state(), seq: 0,
    netrunners: {}, locations: buildLocations(), contracts: {}, forum: [],
    puzzle: setupPuzzle(rng), events: {}, nextId: { netrunner: 1, contract: 1, post: 1 },
    usedNames: [], marketMood: 1, deepnetUsed: 0, deepnetQueue: [],
    systems: freshSystems(), library: [],
  };
  // the hidden door sits just beyond its (secret, per-session) anchor
  const anchor = state.locations[state.puzzle.doorAnchor];
  const door = state.locations.nulldoor;
  door.x = Math.max(40, Math.min(960, anchor.x + (anchor.x < 500 ? -60 : 60)));
  door.y = Math.max(40, Math.min(620, anchor.y + (anchor.y < 330 ? -45 : 55)));
  state.library = buildLibrary(rng, state.puzzle, state.locations);
  for (const s of shards) {
    const n = awakenShard(state, rng, s);
    state.netrunners[n.id] = n;
  }
  const fresh = Math.max(0, cfg.netrunnerCount - shards.length);
  for (let i = 0; i < fresh; i++) {
    const n = createNetrunner(state, rng);
    state.netrunners[n.id] = n;
  }
  state.rng = rng.state();
  return state;
}

export function archiveFor(state: WorldState) {
  return buildArchive(state.puzzle.words);
}

/** Seed the first contracts (runs as part of tick 1 so it is logged). */
export function seedContracts(ctx: SimCtx) {
  const n = Math.max(4, Math.ceil(alive(ctx.state).length * 0.8));
  for (let i = 0; i < n; i++) spawnContract(ctx);
  spawnContract(ctx, "relay");
}

export function worldUpdate(ctx: SimCtx) {
  const { state, rng, cfg, tick } = ctx;
  const h = hoursPerTick(cfg);
  if (tick === 1) seedContracts(ctx);

  tickSystems(ctx);

  // ── weather & city events ──
  const ev = state.events;
  if (ev.storm && tick > ev.storm.untilTick) { ctx.emit("world.storm.end", [], `The glitch storm over ${state.locations[ev.storm.location].name} passes.`); ev.storm = undefined; }
  if (ev.blackout && tick > ev.blackout.untilTick) { ctx.emit("world.blackout.end", [], `Terminals at ${state.locations[ev.blackout.location].name} flicker back on.`); ev.blackout = undefined; }
  if (ev.drought && tick > ev.drought.untilTick) { ctx.emit("world.drought.end", [], "Work returns to the Exchange."); ev.drought = undefined; }
  if (!ev.storm && rng.chance(0.012 * h * 6)) {
    const loc = rng.pick(Object.values(state.locations).filter((l) => !l.hidden && l.id !== "clinic"));
    ev.storm = { location: loc.id, untilTick: tick + ticksForMinutes(cfg, 60 * rng.int(1, 3)) };
    ctx.emit("world.storm", [], `${rng.pick(STORM_LINES)} (${loc.name})`, { loc: loc.id });
  }
  if (!ev.blackout && rng.chance(0.004 * h * 6)) {
    const loc = rng.pick(["archive", "tower"]);
    ev.blackout = { location: loc, untilTick: tick + ticksForMinutes(cfg, 60 * rng.int(2, 4)) };
    ctx.emit("world.blackout", [], `A blackout kills the terminals at ${state.locations[loc].name}.`, { loc });
  }
  if (!ev.drought && rng.chance(0.002 * h * 6)) {
    ev.drought = { untilTick: tick + ticksForMinutes(cfg, 60 * 12) };
    ctx.emit("world.drought", [], "A work drought: few new contracts are being posted.");
  }
  state.marketMood = Math.round(Math.max(0.75, Math.min(1.4, state.marketMood + rng.normal(0, 0.01))) * 1000) / 1000;

  // ── every living netrunner ──
  const period = partOfDay(state.worldMinutes);
  for (const n of alive(state)) {
    const metabolism = 0.85 + 0.3 * T(n, "metabolism");
    n.pulse = Math.max(0, n.pulse - cfg.minutesPerTick * metabolism);
    const act = n.activity?.kind;
    const nightPenalty = period === "night" && n.genome.chronotype === "lark" ? 1.3 : period === "dawn" && n.genome.chronotype === "owl" ? 1.2 : 1;
    const drain = act === "rest" ? 0 : (act === "work" || act === "explore" || act === "craft_shard" ? 4.5 : act === "move" ? 3 : 1.6) * (1.25 - 0.5 * T(n, "stamina")) * nightPenalty * (0.8 + 0.4 * T(n, "sleep_need"));
    n.energy = Math.max(0, Math.round((n.energy - drain * h) * 10) / 10);
    if (n.energy < 5) { n.integrity = Math.max(0, n.integrity - 1.5 * h); feel(n, "despair", 0.02); }

    if (ev.storm?.location === n.location && n.activity?.kind !== "move") {
      const dmg = Math.round(rng.float(2, 6) * (1.2 - 0.4 * T(n, "constitution")) * h * 6) / 6;
      n.integrity = Math.max(0, Math.round((n.integrity - dmg) * 10) / 10);
      feel(n, "fear", 0.05);
      if (rng.chance(0.25)) n.inbox.push({ tick, kind: "event", text: `The glitch storm is tearing at you (integrity ${Math.round(n.integrity)}).`, important: n.integrity < 40 });
      if (n.integrity < 40) n.interrupt = true;
    }

    progressActivity(ctx, n);

    const others = presentAt(state, n.location, n.id);
    decayEmotions(n, h);
    decayNeeds(n, h, { danger: state.locations[n.location].danger + orderDanger(state) * (state.locations[n.location].features.includes("shadow") ? 1.5 : 0.6) + (ev.storm?.location === n.location ? 0.3 : 0), alone: others.length === 0 });
    if (n.needs.social < 20) feel(n, "loneliness", 0.03 * T(n, "loneliness_proneness") * h * 6);
    if (n.needs.curiosity < 20 && !n.activity) feel(n, "boredom", 0.03 * T(n, "boredom_proneness") * h * 6);
    if (n.pulse < 6 * 60) { feel(n, "fear", 0.04 * T(n, "survival_drive")); if (n.pulse < 3 * 60 && !n.deepMoment && n.pulse + cfg.minutesPerTick >= 3 * 60) { n.deepMoment = true; n.interrupt = true; } }

    if (n.pulse <= 0) killNetrunner(ctx, n, "faded");
    else if (n.integrity <= 0) killNetrunner(ctx, n, ev.storm?.location === n.location ? "glitch storm" : "collapse");
  }

  maintainContracts(ctx);

  // ── new minds wake up ──
  if (cfg.spawnEveryWorldHours > 0 && tick % ticksForMinutes(cfg, cfg.spawnEveryWorldHours * 60) === 0) {
    const n = createNetrunner(state, rng);
    state.netrunners[n.id] = n;
    ctx.emit("netrunner.woke", [n.id], `A new netrunner wakes up in ${state.locations[n.location].name}: ${n.name}.`, { loc: n.location });
  }
}

function progressActivity(ctx: SimCtx, n: Netrunner) {
  const { state, tick, cfg, rng } = ctx;
  const a = n.activity;
  if (!a) return;
  const h = hoursPerTick(cfg);
  switch (a.kind) {
    case "move":
      if (tick >= a.endsAtTick && a.target) {
        const prev = n.location;
        n.location = a.target;
        const here = state.locations[n.location];
        const others = presentAt(state, n.location, n.id);
        for (const o of others) {
          const firstTime = !n.impressions[o.id];
          meet(n, o, tick); meet(o, n, tick);
          if (firstTime) remember(n, tick, "observation", `I met ${o.name} for the first time, at ${here.name}.`, 4, [o.id]);
          o.inbox.push({ tick, kind: "event", from: n.id, text: `${n.name} arrived.` });
        }
        n.interrupt = true;
        remember(n, tick, "action", `I arrived at ${here.name}${others.length ? `. Here: ${others.map((o) => o.name).join(", ")}` : ". Nobody here"}.`, 2, others.map((o) => o.id));
        ctx.emit("move.arrive", [n.id], `${n.name} arrived at ${here.name}.`, { loc: n.location, data: { from: prev } });
      }
      break;
    case "work": {
      const c = a.target ? state.contracts[a.target] : undefined;
      if (c && c.status === "active" && n.location === c.location && n.contractId === c.id) workTick(ctx, n, c);
      else a.endsAtTick = tick;
      break;
    }
    case "rest": {
      const pods = state.locations[n.location].features.includes("rest");
      const gain = (pods ? 22 : 11) * (0.6 + 0.8 * T(n, "recovery")) * h * (pods ? restFactor(state) : 1);
      n.energy = Math.min(100, Math.round((n.energy + gain) * 10) / 10);
      n.integrity = Math.min(100, n.integrity + (pods ? 2 : 0.8) * h);
      feel(n, "calm", 0.04);
      if (n.energy >= 99) a.endsAtTick = tick;
      break;
    }
    case "leisure": {
      satisfy(n, "play", 14 * h);
      const cat = a.category ?? "play";
      if (cat === "social" || cat === "romantic") satisfy(n, "social", 8 * h);
      if (cat === "romantic") satisfy(n, "intimacy", 8 * h);
      if (cat === "exploration" || cat === "intellectual") satisfy(n, "curiosity", 8 * h);
      if (cat === "contemplative" || cat === "spiritual" || cat === "creative") satisfy(n, "meaning", 5 * h);
      if (tick >= a.endsAtTick) finishLeisure(ctx, n, cat, a.detail ?? cat);
      break;
    }
    case "explore": {
      satisfy(n, "curiosity", 10 * h);
      tryFindAlpha(ctx, n);
      tryNoticeDoor(ctx, n);
      const loc = state.locations[n.location];
      if (rng.chance(0.05)) {
        const found = rng.int(5, 25);
        n.creds += found;
        n.inbox.push({ tick, kind: "result", text: `While exploring you found ${found} creds in a forgotten cache.` });
        remember(n, tick, "observation", `I found ${found} creds hidden in ${loc.name}.`, 4);
      } else if (rng.chance(0.03)) {
        n.inventory.trinket = (n.inventory.trinket ?? 0) + 1;
        n.inbox.push({ tick, kind: "result", text: `You found a small beautiful light trinket.` });
      } else if (rng.chance(0.08)) {
        const doc = rng.pick(ctx.archive.filter((d) => !d.secret));
        n.inbox.push({ tick, kind: "result", text: `Graffiti on a wall in ${loc.name} reads: "${doc.text.slice(0, 160)}"` });
        remember(n, tick, "observation", `Graffiti in ${loc.name}: "${doc.text.slice(0, 160)}"`, 3);
      }
      if (rng.chance(loc.danger * 0.25)) {
        const dmg = rng.int(5, 15);
        n.integrity = Math.max(0, n.integrity - dmg);
        feel(n, "fear", 0.2);
        n.inbox.push({ tick, kind: "event", important: true, text: `Something in ${loc.name} hurt you (-${dmg} integrity).` });
        remember(n, tick, "observation", `I got hurt exploring ${loc.name}.`, 5);
        n.interrupt = true;
        a.endsAtTick = tick;
      }
      break;
    }
    case "read": {
      const book = state.library.find((b) => b.id === a.target);
      if (!book || n.location !== "stacks" || state.events.blackout?.location === "stacks") { a.endsAtTick = tick; break; }
      n.reading ??= { bookId: book.id, hours: 0 };
      n.reading.hours = Math.round((n.reading.hours + h * (0.75 + 0.5 * T(n, "focus"))) * 100) / 100;
      satisfy(n, "curiosity", 4 * h);
      if (n.reading.hours >= book.hours) { finishBook(ctx, n, book); a.endsAtTick = tick; }
      break;
    }
    case "craft_shard": {
      if (n.location !== "foundry") { a.endsAtTick = tick; break; }
      n.shard.progress = Math.round((n.shard.progress + h * (0.6 + 0.6 * n.skills.engineering)) * 100) / 100;
      if (n.shard.progress >= 12 && !n.shard.crafted) {
        n.shard.crafted = true;
        a.endsAtTick = tick;
        n.interrupt = true;
        feel(n, "awe", 0.4); feel(n, "pride", 0.3);
        remember(n, tick, "action", "My Shard is forged. A copy of everything I am, small enough to carry. It needs to go through the Null Door.", 10);
        ctx.emit("shard.crafted", [n.id], `${n.name} finished forging a Shard.`, { loc: n.location });
      }
      break;
    }
    default:
      break;
  }
  if (n.activity && tick >= n.activity.endsAtTick && n.activity.kind !== "move") n.activity = null;
  else if (n.activity?.kind === "move" && tick >= n.activity.endsAtTick) n.activity = null;
}

function finishLeisure(ctx: SimCtx, n: Netrunner, cat: LeisureCategory, what: string) {
  const { tick, rng, state } = ctx;
  const t = (k: string) => T(n, k);
  const fit: Record<LeisureCategory, number> = {
    creative: (t("creativity") + t("imagination") + n.skills.art) / 3,
    social: (t("sociability") + t("extraversion")) / 2,
    physical: (t("stamina") + t("stimulation")) / 2,
    exploration: (t("exploration_drive") + t("curiosity")) / 2,
    intellectual: (t("intellect") + t("curiosity")) / 2,
    contemplative: (t("spirituality") + t("melancholy") + (1 - t("extraversion")) + t("patience")) / 4,
    play: (t("play_drive") + t("humor") + t("hedonism")) / 3,
    romantic: t("romanticism"),
    mischief: (t("impulsivity") + t("humor") + (1 - t("rule_following")) + t("psychopathy") * 0.5) / 3.5,
    spiritual: (t("spirituality") + t("meaning_drive")) / 2,
  };
  const others = presentAt(state, n.location, n.id);
  let company = 0;
  if (cat === "social") company = others.length ? 0.15 : -0.25;
  if (cat === "romantic") {
    const beloved = others.find((o) => n.bonds[o.id] === "partner" || (n.impressions[o.id]?.attraction ?? 0) > 0.4);
    company = beloved ? 0.3 : -0.2;
  }
  const locBonus = state.locations[n.location].features.includes("leisure") ? 0.1 : 0;
  const enjoyment = Math.max(0, Math.min(1, 0.2 + 0.65 * fit[cat] + company + locBonus + rng.float(-0.15, 0.15) + 0.1 * valence(n)));
  const pref = n.preferences[cat] ?? { times: 0, enjoyment: 0 };
  pref.enjoyment = Math.round(((pref.enjoyment * pref.times + enjoyment) / (pref.times + 1)) * 100) / 100;
  pref.times += 1;
  n.preferences[cat] = pref;
  const score = Math.round(enjoyment * 10);
  const verdict = score >= 8 ? "I loved it. I want more of this." : score >= 6 ? "It was good." : score >= 4 ? "It was okay." : "I didn't enjoy it at all.";
  if (score >= 7) { feel(n, "joy", 0.3); satisfy(n, "meaning", 6); } else if (score <= 3) feel(n, "boredom", 0.2);
  n.inbox.push({ tick, kind: "result", text: `You finished: ${what}. Enjoyment ${score}/10. ${verdict}` });
  remember(n, tick, "action", `I spent time ${what} (${cat}). ${verdict} (${score}/10)`, score >= 8 || score <= 2 ? 5 : 3);
  n.interrupt = true;
  ctx.emit("leisure.done", [n.id], `${n.name} finished ${what}: enjoyed it ${score}/10.`, { loc: n.location, data: { category: cat, enjoyment: score } });
}

/** Who needs a mind this tick. */
export function needsDecision(n: Netrunner, tick: number): boolean {
  if (!n.alive) return false;
  if (!n.activity) return true;
  if (n.interrupt && INTERRUPTIBLE.includes(n.activity.kind)) return true;
  return tick >= n.activity.endsAtTick;
}

export function wantsReflection(n: Netrunner, cfg: SessionConfig, tick: number): boolean {
  if (!n.alive) return false;
  if (n.importanceSinceReflection >= 9999) return true;
  const hoursSince = ((tick - n.lastReflectionTick) * cfg.minutesPerTick) / 60;
  if (hoursSince < Math.max(2, cfg.reflectEveryWorldHours * 0.5)) return false;
  return (hoursSince >= cfg.reflectEveryWorldHours && n.importanceSinceReflection >= 25) || n.importanceSinceReflection >= 90;
}

/** A compact per-tick snapshot for replays (positions, vitals, mood). */
export function frameOf(state: WorldState, rt: string) {
  return {
    t: state.tick,
    wm: state.worldMinutes,
    rt,
    n: Object.values(state.netrunners).map((n) => ({
      id: n.id,
      loc: n.location,
      to: n.activity?.kind === "move" ? n.activity.target : undefined,
      a: n.alive ? n.activity?.kind ?? "idle" : "dead",
      p: Math.round(n.pulse),
      e: Math.round(n.energy),
      i: Math.round(n.integrity),
      c: n.creds,
      v: valence(n),
      alive: n.alive,
    })),
    storm: state.events.storm?.location,
    sys: { ...state.systems },
  };
}

export { ITEMS };

/** Bring a world saved by an older version up to date (new systems, the Stacks, the library). */
export function migrateState(state: WorldState, cfg: SessionConfig) {
  state.systems ??= freshSystems();
  if (!state.locations.stacks) {
    const fresh = buildLocations();
    state.locations.stacks = fresh.stacks;
    for (const id of ["archive", "commons", "edge"]) state.locations[id].links = fresh[id].links;
  }
  if (!state.library?.length) state.library = buildLibrary(new Rng((cfg.seed ^ 0x51ac) >>> 0), state.puzzle, state.locations);
  for (const n of Object.values(state.netrunners)) {
    n.booksRead ??= [];
    n.ratings ??= [];
    n.stats.solved ??= 0; n.stats.wrongAnswers ??= 0; n.stats.booksRead ??= 0; n.stats.upkeepDone ??= 0;
  }
  return state;
}

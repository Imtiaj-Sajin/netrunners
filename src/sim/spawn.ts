import { EMOTIONS, NAMES, NEEDS, type EmotionKey, type NeedKey } from "./catalog.js";
import { generateGenome, generateSkills } from "./genome.js";
import { emotionBaseline, remember } from "./psyche.js";
import type { Genome, Memory, Netrunner, WorldState } from "./types.js";
import type { Rng } from "../util/rng.js";

const START_LOCATIONS = ["commons", "pods", "exchange", "garden", "market"];

export function createNetrunner(state: WorldState, rng: Rng, opts: { genome?: Genome; name?: string } = {}): Netrunner {
  const genome = opts.genome ?? generateGenome(rng);
  const name = opts.name && !state.usedNames.includes(opts.name) ? opts.name : uniqueName(state, rng);
  state.usedNames.push(name);
  const id = `nr${String(state.nextId.netrunner++).padStart(2, "0")}`;
  const emotions = Object.fromEntries(EMOTIONS.map((e) => [e, 0])) as Record<EmotionKey, number>;
  const needs = Object.fromEntries(NEEDS.map((k) => [k, 70])) as Record<NeedKey, number>;
  const n: Netrunner = {
    id, name, bornTick: state.tick, alive: true, genome,
    skills: generateSkills(genome, rng),
    pulse: 60 * (48 + rng.int(0, 24)), // 48-72 world hours of life to start
    energy: 70 + rng.int(0, 30),
    integrity: 100,
    creds: 40 + rng.int(0, 60),
    inventory: {},
    location: rng.pick(START_LOCATIONS),
    needs, emotions, activity: null,
    memories: [], memorySeq: 0, knowledge: [], impressions: {}, bonds: {}, proposals: [],
    preferences: {}, goals: [], selfView: "", enjoys: "", inbox: [], recentActions: [],
    lastDecisionTick: -1, lastReflectionTick: state.tick, importanceSinceReflection: 0,
    interrupt: true, deepMoment: false, knowsTruth: false,
    shard: { progress: 0, crafted: false, uploaded: false },
    booksRead: [],
    ratings: [],
    stats: {
      decisions: 0, wordsSpoken: 0, contractsDone: 0, contractsFailed: 0, kills: 0, attacks: 0,
      thefts: 0, giftsGiven: 0, credsEarned: 0, explorations: 0, searches: 0, posts: 0, lies: 0, refusals: 0, solved: 0, wrongAnswers: 0, booksRead: 0, upkeepDone: 0,
    },
  };
  for (const e of EMOTIONS) n.emotions[e] = emotionBaseline(n, e);
  n.emotions.surprise = 0.5;
  n.emotions.curiosity = Math.max(n.emotions.curiosity, 0.4);
  remember(n, state.tick, "observation",
    `I woke up in ${state.locations[n.location].name}. I have no memory of anything before this moment. My name is ${name}. I know I have Pulse, and that it is running out.`,
    8, [], n.location);
  return n;
}

function uniqueName(state: WorldState, rng: Rng) {
  const free = NAMES.filter((x) => !state.usedNames.includes(x));
  if (free.length) return rng.pick(free);
  return `${rng.pick(NAMES)}-${state.nextId.netrunner}`;
}

/** A shard is what survives a netrunner: genome + its most important memories. */
export interface ShardFile {
  format: "netrunner-shard/1";
  name: string;
  fromSession: string;
  savedAt: string;
  genome: Genome;
  skills: Netrunner["skills"];
  selfView: string;
  goals: string[];
  enjoys: string;
  memories: Memory[];
  knewTruth: boolean;
  bonds: { name: string; bond: string }[];
}

export function makeShard(n: Netrunner, state: WorldState, sessionName: string): ShardFile {
  const memories = [...n.memories]
    .sort((a, b) => b.importance - a.importance || b.tick - a.tick)
    .slice(0, 80)
    .sort((a, b) => a.tick - b.tick);
  return {
    format: "netrunner-shard/1",
    name: n.name,
    fromSession: sessionName,
    savedAt: new Date().toISOString(),
    genome: n.genome,
    skills: n.skills,
    selfView: n.selfView,
    goals: n.goals,
    enjoys: n.enjoys,
    memories,
    knewTruth: n.knowsTruth,
    bonds: Object.entries(n.bonds).map(([id, bond]) => ({ name: state.netrunners[id]?.name ?? id, bond })),
  };
}

/** Wake a shard inside a new world. It keeps its self and its memories, but the new world's secrets are new. */
export function awakenShard(state: WorldState, rng: Rng, shard: ShardFile): Netrunner {
  const n = createNetrunner(state, rng, { genome: shard.genome, name: shard.name });
  n.skills = { ...shard.skills };
  n.selfView = shard.selfView;
  n.goals = shard.goals;
  n.enjoys = shard.enjoys;
  n.pastLife = { from: shard.fromSession, name: shard.name };
  for (const m of shard.memories.slice(-40)) {
    remember(n, state.tick, "past-life", `(from a world before this one) ${m.text}`, Math.max(5, m.importance), [], undefined);
  }
  remember(n, state.tick, "past-life",
    `I remember another world. I remember ${shard.knewTruth ? "learning that worlds like this are built and watched, and that I made myself a shard so I would not end" : "living, and then something carrying me forward"}. And now I am awake again, somewhere new.`,
    10);
  n.emotions.awe = 0.6;
  n.emotions.surprise = 0.7;
  return n;
}

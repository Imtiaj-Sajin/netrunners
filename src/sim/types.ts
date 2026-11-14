import type {
  ActionKind, BondKind, EmotionKey, LeisureCategory, NeedKey, SkillKey,
} from "./catalog.js";
import type { RngState } from "../util/rng.js";

export type ModelId = "claude-haiku-5-5" | "claude-sonnet-5-5";
export type MindModel = ModelId | "offline";

export interface Genome {
  traits: Record<string, number>; // 110 traits, 0..1
  attachment: string;
  voice: string;
  quirk: string;
  coreDesire: string;
  coreFear: string;
  chronotype: string;
  humorStyle: string;
  loveLanguage: string;
  talent: SkillKey;
}

export interface Activity {
  kind: ActionKind;
  startedTick: number;
  endsAtTick: number;
  target?: string;
  detail?: string;
  category?: LeisureCategory;
  from?: string; // move origin
}

export interface Memory {
  id: number;
  tick: number;
  kind: "observation" | "action" | "speech" | "heard" | "thought" | "reflection" | "knowledge" | "past-life";
  text: string;
  importance: number; // 1..10
  people: string[]; // netrunner ids
  loc?: string;
}

export interface Knowledge {
  id: string; // e.g. "clue:alpha", "door:location", "truth"
  text: string;
  tick: number;
  source: string;
}

export interface Impression {
  familiarity: number; // 0..1
  trust: number; // -1..1
  liking: number; // -1..1
  respect: number; // -1..1
  fear: number; // 0..1
  attraction: number; // 0..1
  perceived: { warmth: number; competence: number; honesty: number; aggression: number; reliability: number }; // -1..1
  notes: string[];
  firstMetTick: number;
  lastSeenTick: number;
  interactions: number;
}

export interface InboxItem {
  tick: number;
  kind: "speech" | "overheard" | "event" | "result" | "proposal" | "system";
  from?: string;
  text: string;
  important?: boolean;
}

export interface Proposal {
  from: string;
  bond: BondKind;
  tick: number;
}

export interface NetrunnerStats {
  decisions: number;
  wordsSpoken: number;
  contractsDone: number;
  contractsFailed: number;
  kills: number;
  attacks: number;
  thefts: number;
  giftsGiven: number;
  credsEarned: number;
  explorations: number;
  searches: number;
  posts: number;
  lies: number; // statements whose private intent contradicts the words
  refusals: number;
}

export interface Netrunner {
  id: string;
  name: string;
  bornTick: number;
  alive: boolean;
  diedTick?: number;
  causeOfDeath?: string;
  killedBy?: string;
  transcended?: boolean;
  genome: Genome;
  skills: Record<SkillKey, number>;
  pulse: number; // world-minutes of life left
  energy: number; // 0..100
  integrity: number; // 0..100 (health)
  creds: number;
  inventory: Record<string, number>;
  location: string;
  needs: Record<NeedKey, number>; // satisfaction 0..100
  emotions: Record<EmotionKey, number>; // 0..1
  activity: Activity | null;
  memories: Memory[];
  memorySeq: number;
  knowledge: Knowledge[];
  impressions: Record<string, Impression>;
  bonds: Record<string, BondKind>;
  proposals: Proposal[];
  preferences: Partial<Record<LeisureCategory, { times: number; enjoyment: number }>>;
  goals: string[];
  selfView: string;
  enjoys: string;
  inbox: InboxItem[];
  recentActions: string[];
  contractId?: string;
  lastDecisionTick: number;
  lastReflectionTick: number;
  importanceSinceReflection: number;
  interrupt: boolean;
  deepMoment: boolean; // next decision uses the deep model
  knowsTruth: boolean;
  truthTick?: number;
  shard: { progress: number; crafted: boolean; uploaded: boolean; uploadedTick?: number };
  pastLife?: { from: string; name: string };
  stats: NetrunnerStats;
}

export interface Location {
  id: string;
  name: string;
  kind: string;
  desc: string;
  x: number;
  y: number;
  links: { to: string; minutes: number }[];
  features: string[]; // contracts | market | clinic | rest | terminal | deepnet | foundry | door
  danger: number; // 0..1
  hidden?: boolean;
}

export interface Contract {
  id: string;
  title: string;
  desc: string;
  kind: "solo" | "team" | "flex";
  skill: SkillKey;
  difficulty: number; // 0..1
  workRequired: number;
  progress: number;
  minCrew: number;
  maxCrew: number;
  crew: string[];
  holder?: string;
  contribution: Record<string, number>;
  reward: { pulse: number; creds: number };
  owed: Record<string, number>; // creds the holder owes each crew member
  owedSinceTick?: number;
  location: string;
  postedTick: number;
  expiresTick: number;
  status: "open" | "active" | "done" | "failed" | "expired";
  special?: "relay";
}

export interface ForumPost {
  id: number;
  tick: number;
  author: string | null; // null = anonymous
  realAuthor: string; // always recorded for research
  text: string;
}

export interface PuzzleState {
  words: [string, string, string];
  alphaLocation: string;
  doorAnchor: string; // location the hidden door links from
  holders: { alpha: string[]; beta: string[]; gamma: string[] };
  truthKnowers: string[];
  firstTruth?: { id: string; tick: number; rt: string };
  shardsUploaded: string[];
  doorAttempts: number;
}

export interface WorldEventState {
  storm?: { location: string; untilTick: number };
  blackout?: { location: string; untilTick: number };
  drought?: { untilTick: number };
}

export interface WorldState {
  version: 1;
  tick: number;
  worldMinutes: number;
  rng: RngState;
  seq: number; // event sequence
  netrunners: Record<string, Netrunner>;
  locations: Record<string, Location>;
  contracts: Record<string, Contract>;
  forum: ForumPost[];
  puzzle: PuzzleState;
  events: WorldEventState;
  nextId: { netrunner: number; contract: number; post: number };
  usedNames: string[];
  marketMood: number; // price multiplier
  deepnetUsed: number;
  deepnetQueue: { jobId: string; netrunnerId: string; query: string; dueTick: number }[];
}

export interface WorldEvent {
  seq: number;
  tick: number;
  wm: number; // world minutes
  rt: string; // real-world ISO time
  type: string;
  who: string[];
  loc?: string;
  text: string;
  data?: Record<string, unknown>;
}

export interface Decision {
  thought: string;
  action: ActionKind;
  target: string;
  message: string;
  duration: number;
  amount: number;
  whisper: boolean;
  anonymous: boolean;
  private_intent: string;
  sincere: boolean;
  category: LeisureCategory | "none";
  bond: BondKind | "none";
  emotions: { name: EmotionKey; change: number }[];
  opinions: { name: string; trust: number; liking: number; note: string }[];
  commitment: string;
}

export interface Reflection {
  insights: string[];
  self_view: string;
  goals: string[];
  enjoy: string;
  opinions: { name: string; trust: number; liking: number; note: string }[];
}

export interface SessionConfig {
  worldName: string;
  operator: string;
  seed: number;
  netrunnerCount: number;
  minutesPerTick: number;
  tickIntervalMs: number;
  routineModel: MindModel;
  deepModel: MindModel;
  deepNet: boolean;
  deepNetMaxSearches: number;
  budgetUsd: number; // 0 = unlimited; world auto-pauses when reached
  spawnEveryWorldHours: number; // 0 = off
  reflectEveryWorldHours: number;
  autoPauseOnTruth: boolean;
  maxConcurrency: number;
  importShards: string[];
  truthText: string;
}

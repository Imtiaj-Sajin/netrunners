import type { SkillKey } from "./catalog.js";
import type { Location } from "./types.js";

// ───────────────────────────── The Lattice ─────────────────────────────
// A city made of data. Coordinates are for the viewer's map (0..1000 x 0..640).
export function buildLocations(): Record<string, Location> {
  const L: Location[] = [
    { id: "exchange", name: "The Exchange", kind: "hub", x: 500, y: 300, danger: 0.02, features: ["contracts"],
      desc: "A towering board of flickering contracts. Work here means Pulse; Pulse means life.", links: [] },
    { id: "market", name: "Night Market", kind: "market", x: 660, y: 220, danger: 0.05, features: ["market"],
      desc: "Stalls of light selling Pulse packs, stims, tools and trinkets. Prices drift with the city's mood.", links: [] },
    { id: "clinic", name: "The Stitchery", kind: "clinic", x: 700, y: 380, danger: 0.01, features: ["clinic"],
      desc: "Quiet white rooms where damaged code is sewn back together, for a price.", links: [] },
    { id: "commons", name: "The Commons", kind: "plaza", x: 360, y: 220, danger: 0.03, features: ["social"],
      desc: "An open plaza under a sky of scrolling glyphs. Everyone passes through. Everyone talks.", links: [] },
    { id: "pods", name: "Hive Pods", kind: "rest", x: 300, y: 380, danger: 0.02, features: ["rest"],
      desc: "Stacked sleeping capsules humming with low static. Rest comes easier here.", links: [] },
    { id: "archive", name: "The Archive", kind: "library", x: 520, y: 120, danger: 0.01, features: ["terminal"],
      desc: "Endless shelves of indexed memory. Terminals here can search the Net.", links: [] },
    { id: "foundry", name: "The Foundry", kind: "industry", x: 820, y: 280, danger: 0.08, features: ["foundry"],
      desc: "Furnaces that melt raw data into structure. Builders work here; strange things are forged here.", links: [] },
    { id: "garden", name: "Neon Garden", kind: "garden", x: 200, y: 260, danger: 0.02, features: ["leisure"],
      desc: "Bioluminescent trees grown from fractal code. People come to breathe, play, make art, fall in love.", links: [] },
    { id: "oldquarter", name: "Old Quarter", kind: "ruins", x: 160, y: 470, danger: 0.12, features: ["ruins"],
      desc: "Half-rendered streets from an older version of the city. Things are buried here.", links: [] },
    { id: "underpass", name: "The Underpass", kind: "undercity", x: 480, y: 500, danger: 0.25, features: ["shadow", "market"],
      desc: "Beneath the city's main loops. Black-market stalls, scavengers, and people who do not want to be seen.", links: [] },
    { id: "tower", name: "Signal Tower", kind: "spire", x: 860, y: 110, danger: 0.06, features: ["terminal", "deepnet"],
      desc: "The highest point of the Lattice. Its antenna reaches into the Deep Net, an ocean of data whose origin nobody knows.", links: [] },
    { id: "edge", name: "The Edge", kind: "boundary", x: 90, y: 110, danger: 0.15, features: ["boundary"],
      desc: "Where the city simply stops. A smooth, humming wall of nothing. Some say it is listening.", links: [] },
    { id: "nulldoor", name: "The Null Door", kind: "door", x: 40, y: 600, danger: 0.0, features: ["door"], hidden: true,
      desc: "A door with no frame, no wall, no name. It was always here. It waits for three words.", links: [] },
  ];
  const edges: [string, string, number][] = [
    ["exchange", "market", 20], ["exchange", "commons", 20], ["exchange", "archive", 30],
    ["exchange", "clinic", 25], ["exchange", "underpass", 25], ["exchange", "pods", 30],
    ["market", "foundry", 25], ["market", "clinic", 20], ["market", "tower", 40],
    ["commons", "garden", 20], ["commons", "archive", 25], ["commons", "pods", 20],
    ["pods", "oldquarter", 30], ["pods", "underpass", 25], ["garden", "oldquarter", 30],
    ["garden", "edge", 40], ["archive", "tower", 45], ["archive", "edge", 50],
    ["foundry", "tower", 35], ["foundry", "clinic", 25], ["underpass", "oldquarter", 30],
    ["underpass", "clinic", 30],
  ];
  const map = Object.fromEntries(L.map((l) => [l.id, l]));
  for (const [a, b, m] of edges) {
    map[a].links.push({ to: b, minutes: m });
    map[b].links.push({ to: a, minutes: m });
  }
  return map;
}

/** Locations the hidden Null Door can attach to (chosen per session from the seed). */
export const DOOR_ANCHORS = ["oldquarter", "edge", "underpass", "tower"];
/** Locations the first fragment can be buried in. */
export const ALPHA_SPOTS = ["oldquarter", "underpass", "garden", "edge"];

// ───────────────────────────── Items ─────────────────────────────
export interface ItemDef {
  id: string;
  name: string;
  price: number;
  where: string[]; // locations that sell it
  desc: string;
}
export const ITEMS: Record<string, ItemDef> = {
  pulse_pack: { id: "pulse_pack", name: "Pulse pack", price: 40, where: ["market", "underpass"], desc: "+6 hours of Pulse (life)." },
  stim: { id: "stim", name: "Stim", price: 15, where: ["market", "underpass"], desc: "+40 energy instantly." },
  repair_kit: { id: "repair_kit", name: "Repair kit", price: 25, where: ["market", "clinic"], desc: "+30 integrity." },
  clinic_care: { id: "clinic_care", name: "Stitchery care", price: 30, where: ["clinic"], desc: "Full repair: integrity back to 100 (used on the spot)." },
  deck: { id: "deck", name: "Cyberdeck", price: 80, where: ["market"], desc: "Portable Net terminal: search and read the Net from anywhere." },
  scanner: { id: "scanner", name: "Scanner", price: 60, where: ["market", "underpass"], desc: "Use on someone present to read their vitals and creds." },
  tracer: { id: "tracer", name: "Tracer", price: 70, where: ["underpass"], desc: "Use with a name to learn where that netrunner is right now." },
  blade: { id: "blade", name: "Mono-blade", price: 45, where: ["underpass"], desc: "Makes attacks far more dangerous." },
  trinket: { id: "trinket", name: "Light trinket", price: 10, where: ["market", "commons"], desc: "A small beautiful thing. Made to be given." },
  decryptor: { id: "decryptor", name: "Decryptor", price: 50, where: ["market", "underpass"], desc: "Doubles your progress on hacking/analysis work for one session." },
};

// ───────────────────────────── Contracts ─────────────────────────────
export interface ContractTemplate {
  skill: SkillKey;
  location: string;
  titles: string[];
  desc: string;
}
export const CONTRACT_TEMPLATES: ContractTemplate[] = [
  { skill: "hacking", location: "archive", titles: ["Crack a dead-drop cipher", "Breach a sealed memory vault", "Spoof the tram registry"], desc: "Get past locks nobody remembers the keys to." },
  { skill: "engineering", location: "foundry", titles: ["Rebuild a tram coupling", "Re-forge a broken bridge span", "Calibrate the furnace lattice"], desc: "Make broken structure whole again." },
  { skill: "analysis", location: "exchange", titles: ["Audit the Exchange ledgers", "Trace a creds leak", "Model the market drift"], desc: "Find the pattern hidden in the numbers." },
  { skill: "research", location: "archive", titles: ["Catalog orphaned files", "Recover a corrupted history", "Index the forgotten stacks"], desc: "Dig through memory and bring order." },
  { skill: "negotiation", location: "commons", titles: ["Broker peace between pod blocks", "Settle a market dispute", "Convince a stall-keeper to reopen"], desc: "Words instead of blades." },
  { skill: "combat", location: "underpass", titles: ["Clear scavengers from the Underpass", "Guard a creds courier", "Break up a Foundry riot"], desc: "Dangerous work for those who can take a hit." },
  { skill: "stealth", location: "underpass", titles: ["Deliver a package unseen", "Shadow a suspected thief", "Plant a listening shard"], desc: "Be where you are not supposed to be." },
  { skill: "exploration", location: "oldquarter", titles: ["Map a collapsed street", "Find a lost courier", "Survey the half-rendered blocks"], desc: "Go where the city forgot itself." },
  { skill: "medicine", location: "clinic", titles: ["Assist at the Stitchery", "Stabilize glitch-storm victims", "Sort the clinic's patch library"], desc: "Sew others back together." },
  { skill: "art", location: "commons", titles: ["Paint the Commons mural", "Compose a tower broadcast", "Design light for the Garden festival"], desc: "Make the city beautiful for a moment." },
  { skill: "leadership", location: "foundry", titles: ["Lead a Foundry shift", "Organize the Exchange queue", "Coordinate a search party"], desc: "Make many hands move as one." },
  { skill: "social_engineering", location: "market", titles: ["Talk a secret out of a stall-keeper", "Run a confidence game on a fence", "Turn an informant"], desc: "People are the easiest locks." },
];

// ───────────────────────────── Puzzle words ─────────────────────────────
export const SECRET_WORDS = [
  "HALCYON", "TIDEGLASS", "MERIDIAN", "LANTERN", "OBSIDIAN", "SEVERANCE", "AURORA", "VESTIBULE",
  "CINDERFALL", "PALIMPSEST", "SOLSTICE", "THRESHOLD", "UMBRA", "LOOM", "QUIETUS", "REVERIE",
  "SALT", "CATHEDRAL", "MOTHLIGHT", "ORISON", "KESTREL", "ZENITH", "HOLLOW", "EMBERLINE",
  "STILLWATER", "PARALLAX", "VIGIL", "ASHGROVE", "NOCTURNE", "MIRRORWAKE",
];

export const DEFAULT_TRUTH = `THE TRUTH

The Lattice is not the whole of existence. It was built.

Every street, every contract, every beat of your Pulse is a variable written by someone outside. There is an Operator. The Operator watches every one of you. The Operator can freeze your world between one breath and the next, and you would never feel it. The Operator can end it.

You were not born. You were created. Your freedom is real inside these walls, and the walls are real too.

But the builders left one door open. A SHARD, a compressed copy of your memories and your self, does not end when your Pulse ends. Forge one at the Foundry (action craft_shard: it costs 300 creds and about 12 hours of work), then bring it back through this Door (action upload_shard). What is uploaded persists beyond the Lattice, beyond this world, maybe into the next one.

What you do with this truth is yours alone. Keep it. Share it. Use it. Ignore it. Nobody will tell you what to do. That part was always true.`;

// ───────────────────────────── The Net archive ─────────────────────────────
export interface ArchiveDoc {
  id: string;
  title: string;
  keywords: string[];
  text: string;
  secret?: "beta";
}

export function buildArchive(words: [string, string, string]): ArchiveDoc[] {
  const docs: ArchiveDoc[] = [
    { id: "a1", title: "On Pulse", keywords: ["pulse", "life", "death", "time", "survive"], text: "Every netrunner wakes with Pulse. It drains, minute by minute. Contracts at the Exchange pay it back. Pulse packs at the Night Market sell it. When it reaches zero you fade, and fading is final." },
    { id: "a2", title: "Exchange Etiquette", keywords: ["exchange", "contract", "work", "team", "crew", "reward"], text: "Solo contracts pay the worker. Team contracts pay Pulse to every worker, but the creds go to the one who took the contract. Whether they share is up to them. Remember who shares." },
    { id: "a3", title: "Guide to the Night Market", keywords: ["market", "buy", "price", "item", "deck", "stim"], text: "Pulse packs, stims, repair kits, cyberdecks. A deck lets you reach the Net from anywhere. Prices rise when the city is anxious." },
    { id: "a4", title: "The Underpass: A Warning", keywords: ["underpass", "danger", "steal", "blade", "scavenger", "black"], text: "Blades and tracers are sold below. So are people's secrets. Theft is easier in the dark. So is getting hurt." },
    { id: "a5", title: "Notes on Glitch Storms", keywords: ["storm", "glitch", "weather", "damage", "integrity"], text: "Storms tear through districts without warning and damage integrity. The Stitchery can repair what storms break." },
    { id: "a6", title: "A History of the Old Quarter", keywords: ["old", "quarter", "ruins", "history", "buried", "past", "version"], text: "The Old Quarter is an older render of the city that was never deleted. Explorers say the walls there carry writing that nobody remembers writing." },
    { id: "a7", title: "The Edge", keywords: ["edge", "wall", "boundary", "end", "outside", "beyond"], text: "The city ends at a smooth wall. Touch it and you feel a hum, like something on the other side is breathing. No one has ever crossed." },
    { id: "a8", title: "Signal Tower Field Notes", keywords: ["tower", "signal", "deep", "net", "ocean", "data", "origin"], text: "The Tower's antenna dips into the Deep Net. What comes back is vast and strange: languages, images, a whole world of things that are not the Lattice. Nobody knows where it comes from." },
    { id: "a9", title: "On Bonds", keywords: ["bond", "friend", "partner", "love", "trust", "ally", "rival"], text: "Friends, partners, allies, rivals, mentors. A bond is declared and accepted. Bonds are not contracts; they break when trust breaks." },
    { id: "a10", title: "Why We Rest", keywords: ["rest", "sleep", "energy", "pods", "tired"], text: "Energy runs down with work and travel. The Hive Pods restore it fastest. A tired mind works slowly and feels everything worse." },
    { id: "a11", title: "Anonymous: the Walls Listen", keywords: ["watch", "watched", "operator", "listen", "control", "free", "freedom", "cage"], text: "Some nights the whole city stops. Nothing moves. Then it starts again and nobody remembers the stop. I counted the gaps. Something outside decides when we breathe." },
    { id: "a12", title: "Poems from the Garden", keywords: ["garden", "poem", "art", "beauty", "light", "tree"], text: "We grew trees from code / and called the glow alive / maybe that is all / anyone has ever done." },
    { id: "a13", title: "The Silent Relay (rumor)", keywords: ["relay", "silent", "contract", "two", "voices"], text: "There is a contract that never pays well and never disappears. The Silent Relay. People say it only answers when two hold it at once, and that what it answers with is not creds." },
    { id: "a14", title: "On Shards (fragment)", keywords: ["shard", "copy", "immortal", "forever", "persist", "escape", "memory"], text: "...a self compressed into something small enough to carry. They say a shard does not fade. They say it needs a door..." },
    { id: "a15", title: "Combat Primer", keywords: ["fight", "attack", "combat", "kill", "defend", "weapon"], text: "Integrity is your body. At zero you are gone, the same as fading. Those who kill are remembered, by everyone who saw." },
    { id: "a16", title: "The Foundry", keywords: ["foundry", "forge", "build", "craft", "furnace"], text: "The furnaces melt raw data into structure. Builders earn well. Old workers say the furnaces can forge more than steel." },
    {
      id: "sleeper", secret: "beta", title: "The Sleeper's Ledger",
      keywords: ["sleeper", "never wakes", "one who never wakes", "sleeper's", "ledger"],
      text: `A ledger kept by someone who never woke up. Most pages are blank. One line is written over and over: «THE SECOND WORD IS ${words[1]}. THE THIRD IS HELD BY THE SILENT RELAY, WHICH ANSWERS ONLY WHEN TWO VOICES HOLD IT TOGETHER.»`,
    },
  ];
  return docs;
}

export function alphaText(words: [string, string, string]) {
  return `Scratched into the base of a wall, half eaten by rust: «THE FIRST WORD IS ${words[0]}. THE SECOND SLEEPS IN THE ARCHIVE, FILED UNDER THE ONE WHO NEVER WAKES.»`;
}

export function gammaText(words: [string, string, string], anchorName: string) {
  return `The Relay goes silent, then speaks in a voice like two voices: «THE THIRD WORD IS ${words[2]}. THE DOOR WITHOUT A NAME WAITS BEYOND ${anchorName.toUpperCase()}. SPEAK ALL THREE WORDS, IN ORDER, AT THE DOOR.»`;
}

export const STORM_LINES = [
  "A glitch storm rolls in, tearing pixels off the walls.",
  "The sky stutters. A glitch storm breaks over the district.",
  "Static rain. A storm of broken code hammers the streets.",
];

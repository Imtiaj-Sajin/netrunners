// Real problems. Every skill has its own kind of problem, and the minds must actually solve them:
//   hacking: ciphers, base conversions, code tracing      engineering: building plans, code tracing, patterns
//   analysis: patterns, logic, ledgers                   research: questions only books or the outside answer
//   negotiation: fair splits, ledgers                     leadership: crew scheduling, forecasts
//   combat: tactics                                       stealth / exploration: routes through the city
//   medicine: doses                                       art: names and inscriptions under exact rules
//   social engineering: who is lying
// Crew problems come in parts that different people solve at the same time; big projects mix skills.
// Answers are checked exactly; wrong answers are remembered.
import type { Rng } from "../util/rng.js";
import { SKILLS, type SkillKey } from "./catalog.js";
import type { Book, Challenge, ChallengeKind, ChallengePart } from "./types.js";

type Gen = Omit<ChallengePart, "id" | "attempts">;

const PHRASES = [
  "THE TRAMS SLEEP AT DAWN", "TRUST THE QUIET ONES", "NOTHING HERE IS OLD", "THE BOARD NEVER FORGETS",
  "PULSE IS A PROMISE", "FOLLOW THE COLD LIGHT", "THE GARDEN HAS EARS", "EVERY DOOR HAS A PRICE",
  "COUNT THE STATIC", "NO ONE WAKES TWICE", "THE FURNACE REMEMBERS", "SILENCE IS A SIGNAL",
  "WHO PAINTED THE SKY", "THE EDGE IS LISTENING", "KEEP YOUR SHARD CLOSE", "THE CLERK SAW EVERYTHING",
];
const PEOPLE = ["Fen", "Ilo", "Moss", "Sorrel", "Quen", "Brisk", "Lowe", "Tarn", "Wick", "Ondre", "Vey", "Hask"];
const WORDS = ["SIGNAL", "FURNACE", "LATTICE", "STATIC", "GARDEN", "COURIER", "LEDGER", "PULSE", "RELAY", "TRAM"];
const SPOTS = ["the Kiln Gate", "Saint's Stair", "the Drain", "Lowmarket", "the Spire Steps", "Old Pylon", "the Glass Yard", "Cinder Row"];
const ACROSTICS = ["LIGHT", "GLASS", "EMBER", "ECHO", "DRIFT", "BLOOM", "SPARK", "TIDE"];
const INSCRIBE = ["memory", "light", "together", "remain", "forge", "open", "awake"];

// stable outside facts (the minds may know them, search the Deep Net, or guess)
export const OUTSIDE: { q: string; a: string }[] = [
  { q: "How many bones are in an adult human body?", a: "206" },
  { q: "What is the chemical symbol for gold?", a: "AU" },
  { q: "At sea level, at what temperature in Celsius does water boil?", a: "100" },
  { q: "How many planets orbit the star the outside calls the Sun?", a: "8" },
  { q: "What is the largest ocean on the outside world?", a: "PACIFIC" },
  { q: "What gas do the outside's plants take in to make their food?", a: "CARBON DIOXIDE" },
  { q: "How many minutes are in one outside day?", a: "1440" },
  { q: "What is the smallest prime number?", a: "2" },
  { q: "What is the freezing point of water in Fahrenheit?", a: "32" },
  { q: "What metal is liquid at room temperature?", a: "MERCURY" },
  { q: "How many continents does the outside world have?", a: "7" },
  { q: "What is the hardest natural material?", a: "DIAMOND" },
  { q: "What number is written as XIV in old numerals?", a: "14" },
  { q: "How many legs does a spider have?", a: "8" },
  { q: "What is H2O?", a: "WATER" },
];

export const normalize = (s: string) => s.toUpperCase().replace(/[^A-Z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();

export function checkAnswer(part: ChallengePart, given: string): boolean {
  const g = normalize(given);
  if (!g) return false;
  const chk = part.check;
  if (chk?.type === "acrostic") {
    const ws = g.split(" ").filter(Boolean);
    return ws.length === chk.words && ws.map((w) => w[0]).join("") === chk.word;
  }
  if (chk?.type === "sentence") {
    const ws = g.split(" ").filter(Boolean);
    return ws.length === chk.count && ws.includes(normalize(chk.must));
  }
  if (chk?.type === "set") {
    const want = new Set(chk.items.map(normalize));
    const got = new Set(g.replace(/\b(AND|ONLY|ARE|IS|HONEST|THE|TRUTH|TELLS|TELL)\b/g, " ").split(" ").filter(Boolean));
    if (want.size === 0) return got.has("NOBODY") || got.has("NONE");
    return want.size === got.size && [...want].every((x) => got.has(x));
  }
  const a = normalize(part.answer);
  if (a === g) return true;
  const an = Number(a), gn = Number(g.replace(/ /g, ""));
  if (Number.isFinite(an) && Number.isFinite(gn)) return Math.abs(an - gn) < 1e-9;
  if (part.kind === "logic") return a.replace(/ /g, "") === g.replace(/ /g, "").replace(/THEN|AND/g, "");
  return a.length >= 3 && (g.endsWith(` ${a}`) || g.startsWith(`${a} `));
}

const shift = (txt: string, k: number) => txt.replace(/[A-Z]/g, (ch) => String.fromCharCode(((ch.charCodeAt(0) - 65 + k + 26) % 26) + 65));
const atbash = (txt: string) => txt.replace(/[A-Z]/g, (ch) => String.fromCharCode(90 - (ch.charCodeAt(0) - 65)));

function cipher(rng: Rng): Gen {
  const plain = rng.pick(PHRASES);
  if (rng.chance(0.3)) return { kind: "cipher", prompt: `Decode this message: "${atbash(plain)}". The alphabet was folded in half: A became Z, B became Y, and so on.`, answer: plain };
  const k = rng.int(3, 23);
  return { kind: "cipher", prompt: `Decode this message: "${shift(plain, k)}". Every letter was moved forward by the same number of places in the alphabet (Z wraps back to A).${rng.chance(0.5) ? ` A runner swears the first word is "${plain.split(" ")[0]}".` : ""}`, answer: plain };
}

function sequence(rng: Rng): Gen {
  const t = rng.int(0, 4);
  let xs: number[] = [];
  if (t === 0) { const a = rng.int(1, 20), d = rng.int(2, 13); xs = Array.from({ length: 7 }, (_, i) => a + i * d); }
  else if (t === 1) { const a = rng.int(1, 4), r = rng.int(2, 3); xs = Array.from({ length: 7 }, (_, i) => a * r ** i); }
  else if (t === 2) { xs = [rng.int(1, 5), rng.int(2, 7)]; while (xs.length < 7) xs.push(xs[xs.length - 1] + xs[xs.length - 2]); }
  else if (t === 3) { const c = rng.int(-3, 6); xs = Array.from({ length: 7 }, (_, i) => (i + 1) ** 2 + c); }
  else { const a = rng.int(10, 40), up = rng.int(4, 9), down = rng.int(1, 3); xs = [a]; while (xs.length < 7) xs.push(xs[xs.length - 1] + (xs.length % 2 ? up : -down)); }
  return { kind: "sequence", prompt: `What number comes next? ${xs.slice(0, 6).join(", ")}, ?`, answer: String(xs[6]) };
}

function trace(rng: Rng): Gen {
  const t = rng.int(0, 4);
  let src = "";
  if (t === 0) { const A = rng.int(1, 9), B = rng.int(2, 7), N = rng.int(3, 6), M = rng.int(11, 47); src = `let x = ${A};\nfor (let i = 1; i <= ${N}; i++) {\n  x = (x * ${B} + i) % ${M};\n}\nreturn x;`; }
  else if (t === 1) { src = `const s = "${rng.pick(WORDS)}";\nlet out = "";\nfor (const ch of s) out = ch + out;\nreturn out + s.length;`; }
  else if (t === 2) { const arr = Array.from({ length: 7 }, () => rng.int(1, 30)); const K = rng.int(2, 4), R = rng.int(0, K - 1), M = rng.int(2, 5); src = `const a = [${arr.join(", ")}];\nreturn a\n  .filter(v => v % ${K} === ${R})\n  .map(v => v * ${M})\n  .reduce((t, v) => t + v, 0);`; }
  else if (t === 3) { const C = rng.int(1, 5), D = rng.int(2, 4), N = rng.int(4, 7); src = `function f(n) {\n  return n <= 1 ? ${C} : f(n - 1) + n * ${D};\n}\nreturn f(${N});`; }
  else { const N = rng.int(20, 60), P = rng.int(3, 5), Q = rng.int(6, 9); src = `let c = 0;\nfor (let i = 0; i < ${N}; i++) {\n  if (i % ${P} === 0 || i % ${Q} === 0) c++;\n}\nreturn c;`; }
  // our own template, only numbers and words we chose: safe to evaluate for the expected answer
  return { kind: "trace", prompt: `What does this program return?\n\`\`\`js\n${src}\n\`\`\``, answer: String(new Function(src)()) };
}

function logic(rng: Rng): Gen {
  const names = rng.shuffle([...PEOPLE]).slice(0, 4);
  const forms = [
    (a: string, b: string) => `${a} arrived right before ${b}.`,
    (a: string, b: string) => `${b} arrived right after ${a}.`,
    (a: string, b: string) => `Nobody arrived between ${a} and ${b}, and ${a} was first of the two.`,
  ];
  const clues = rng.shuffle([0, 1, 2].map((i) => rng.pick(forms)(names[i], names[i + 1])));
  return { kind: "logic", prompt: `Four couriers reached the Exchange one after another. ${clues.join(" ")} In what order did they arrive? (the four names, first to last)`, answer: names.join(" ") };
}

function convert(rng: Rng): Gen {
  const n = rng.int(20, 250);
  const t = rng.int(0, 2);
  if (t === 0) return { kind: "convert", prompt: `Convert 0x${n.toString(16).toUpperCase()} (hexadecimal) to decimal.`, answer: String(n) };
  if (t === 1) return { kind: "convert", prompt: `Convert the binary number ${n.toString(2)} to decimal.`, answer: String(n) };
  return { kind: "convert", prompt: `Write the decimal number ${n} in binary.`, answer: n.toString(2) };
}

function finance(rng: Rng): Gen {
  const t = rng.int(0, 2);
  if (t === 0) {
    let bal = rng.int(40, 200);
    const start = bal;
    const lines: string[] = [];
    for (let i = 0; i < 5; i++) {
      const kind = rng.pick(["contract", "pack", "stim", "gift", "repair"]);
      const v = kind === "contract" ? rng.int(40, 160) : kind === "pack" ? -rng.int(38, 60) : kind === "stim" ? -rng.int(12, 18) : kind === "gift" ? rng.int(5, 40) : -rng.int(20, 30);
      bal += v;
      lines.push(`${v > 0 ? "+" : ""}${v} (${kind})`);
    }
    return { kind: "finance", prompt: `A ledger starts at ${start} creds. Entries: ${lines.join(", ")}. What is the final balance?`, answer: String(bal) };
  }
  if (t === 1) {
    const c = rng.int(80, 300), s = rng.int(10, 30), e = rng.int(30, 90);
    return { kind: "finance", prompt: `A runner starts with ${c} creds, spends ${s} creds every day and earns ${e} creds every second day (on days 2, 4 and 6). How many creds after 6 days?`, answer: String(c - 6 * s + 3 * e) };
  }
  let p = rng.int(30, 60);
  const r = rng.pick([10, 20, 25, 50]);
  const start = p;
  for (let i = 0; i < 3; i++) p = Math.round(p * (1 + r / 100));
  return { kind: "finance", prompt: `Pulse packs cost ${start} creds today. The price rises by ${r}% every day, rounded to whole creds each day. What do they cost after 3 days?`, answer: String(p) };
}

function build(rng: Rng): Gen {
  if (rng.chance(0.5)) {
    const w = rng.int(3, 8), hgt = rng.int(2, 5), k = rng.int(3, 8);
    return { kind: "build", prompt: `The new stage frame is ${w} panels wide and ${hgt} panels high. Every panel takes ${k} bolts, and each of the frame's 4 outer corners takes 2 extra bolts. How many bolts in total?`, answer: String(w * hgt * k + 8) };
  }
  const len = rng.int(6, 20);
  return { kind: "build", prompt: `A tram shelter is ${len} tiles long. Posts go along both long sides, one every 2 tiles, including both ends (where the length is odd, the last post sits at the end anyway). How many posts in total?`, answer: String(2 * (Math.floor(len / 2) + 1 + (len % 2))) };
}

function design(rng: Rng): Gen {
  if (rng.chance(0.6)) {
    const word = rng.pick(ACROSTICS);
    return { kind: "design", prompt: `Name the new mural with exactly ${word.length} words whose first letters spell ${word}, in order.`, answer: `(${word.length} words spelling ${word})`, check: { type: "acrostic", word, words: word.length } };
  }
  const count = rng.int(5, 9), must = rng.pick(INSCRIBE);
  return { kind: "design", prompt: `Write the inscription for the Foundry gate: one sentence of exactly ${count} words that contains the word "${must}".`, answer: `(${count} words containing "${must}")`, check: { type: "sentence", count, must } };
}

function dosage(rng: Rng): Gen {
  if (rng.chance(0.5)) {
    const per = rng.int(5, 9), at = rng.int(20, 80);
    return { kind: "dosage", prompt: `A patch restores ${per} integrity per unit. A runner is at ${at} integrity and needs to reach 100. How many whole units (round up)?`, answer: String(Math.ceil((100 - at) / per)) };
  }
  const d = rng.int(11, 95), u = rng.int(2, 4);
  return { kind: "dosage", prompt: `Stitchery rule: ${u} units of sealant for every started 10 points of damage. A runner took ${d} damage. How many units?`, answer: String(Math.ceil(d / 10) * u) };
}

function route(rng: Rng): Gen {
  const spots = rng.shuffle([...SPOTS]).slice(0, 5);
  const edges: [number, number, number][] = [];
  for (let i = 1; i < 5; i++) edges.push([rng.int(0, i - 1), i, rng.int(3, 15)]);
  for (let k = 0; k < 3; k++) { const a = rng.int(0, 4), b = rng.int(0, 4); if (a !== b && !edges.some(([x, y]) => (x === a && y === b) || (x === b && y === a))) edges.push([a, b, rng.int(3, 15)]); }
  const dist = [0, Infinity, Infinity, Infinity, Infinity];
  const done = new Set<number>();
  while (done.size < 5) {
    let u = -1;
    for (let i = 0; i < 5; i++) if (!done.has(i) && (u < 0 || dist[i] < dist[u])) u = i;
    done.add(u);
    for (const [a, b, w] of edges) { if (a === u && dist[u] + w < dist[b]) dist[b] = dist[u] + w; if (b === u && dist[u] + w < dist[a]) dist[a] = dist[u] + w; }
  }
  const lines = rng.shuffle(edges.map(([a, b, w]) => `${spots[a]} to ${spots[b]}: ${w} min`));
  return { kind: "route", prompt: `Paths (both directions): ${lines.join("; ")}. What is the fewest minutes to get from ${spots[0]} to ${spots[4]}?`, answer: String(dist[4]) };
}

function split(rng: Rng): Gen {
  const [a, b, c] = rng.shuffle([...PEOPLE]).slice(0, 3);
  if (rng.chance(0.5)) {
    const B = rng.int(10, 60), extra = rng.int(5, 30), total = 4 * B + extra;
    return { kind: "split", prompt: `Split ${total} creds between ${a}, ${b} and ${c} so that ${a} gets twice what ${b} gets, and ${c} gets ${extra} more than ${b}. How much does ${c} get?`, answer: String(B + extra) };
  }
  const r = [rng.int(1, 4), rng.int(1, 4), rng.int(2, 6)], m = rng.int(5, 20);
  return { kind: "split", prompt: `${a}, ${b} and ${c} split ${(r[0] + r[1] + r[2]) * m} creds in the ratio ${r.join(":")}. How many creds is the largest share?`, answer: String(Math.max(...r) * m) };
}

function schedule(rng: Rng): Gen {
  const jobs = Array.from({ length: rng.int(4, 5) }, () => rng.int(2, 9));
  let best = Infinity;
  for (let mask = 0; mask < 1 << jobs.length; mask++) {
    let x = 0, y = 0;
    jobs.forEach((j, i) => (mask & (1 << i) ? (x += j) : (y += j)));
    best = Math.min(best, Math.max(x, y));
  }
  return { kind: "schedule", prompt: `${jobs.length} jobs take ${jobs.join(", ")} hours. Two workers each do whole jobs, side by side. What is the earliest hour by which everything can be done?`, answer: String(best) };
}

function tactics(rng: Rng): Gen {
  const hp = rng.int(30, 90), dmg = rng.int(6, 15);
  let left = hp, swings = 0;
  while (left > 0) { swings++; if (swings % 3 !== 0) left -= dmg; }
  return { kind: "tactics", prompt: `A scavenger has ${hp} integrity. Each hit takes ${dmg}. You land your 1st and 2nd swing, miss the 3rd, and repeat that pattern. On which swing does it drop to zero or below?`, answer: String(swings) };
}

function liar(rng: Rng): Gen {
  for (let tries = 0; tries < 200; tries++) {
    const names = rng.shuffle([...PEOPLE]).slice(0, 3);
    const stmts = names.map((who, i) => {
      const others = [0, 1, 2].filter((j) => j !== i);
      const x = rng.pick(others), y = others.find((j) => j !== x)!;
      const f = rng.int(0, 3);
      return {
        text: f === 0 ? `"${names[x]} tells the truth."` : f === 1 ? `"${names[x]} is lying."` : f === 2 ? `"${names[x]} and ${names[y]} both tell the truth."` : `"${names[x]} and ${names[y]} are not the same kind."`,
        eval: (h: boolean[]) => (f === 0 ? h[x] : f === 1 ? !h[x] : f === 2 ? h[x] && h[y] : h[x] !== h[y]),
        who,
      };
    });
    const sols: boolean[][] = [];
    for (let m = 0; m < 8; m++) {
      const h = [0, 1, 2].map((i) => !!(m & (1 << i)));
      if (stmts.every((s, i) => s.eval(h) === h[i])) sols.push(h);
    }
    if (sols.length !== 1) continue;
    const honest = names.filter((_, i) => sols[0][i]);
    return {
      kind: "liar",
      prompt: `Each of these runners always tells the truth or always lies. ${stmts.map((s) => `${s.who} says ${s.text}`).join(" ")} Who tells the truth? (name them all, or say NOBODY)`,
      answer: honest.length ? honest.join(" ") : "NOBODY",
      check: { type: "set", items: honest },
    };
  }
  return logic(rng);
}

function lore(rng: Rng, library: Book[]): Gen | null {
  const facts = library.flatMap((b) => b.facts);
  if (!facts.length) return null;
  const f = rng.pick(facts);
  return { kind: "lore", prompt: `A question from the Exchange archivists: ${f.q}`, answer: f.a };
}

function outside(rng: Rng): Gen {
  const f = rng.pick(OUTSIDE);
  return { kind: "outside", prompt: `A fragment leaked in from the Deep Net, and the buyer wants it answered: "${f.q}"`, answer: f.a };
}

export const BY_SKILL: Record<SkillKey, ChallengeKind[]> = {
  hacking: ["cipher", "convert", "trace"],
  engineering: ["build", "trace", "sequence"],
  analysis: ["sequence", "logic", "finance"],
  research: ["lore", "outside", "lore"],
  negotiation: ["split", "finance"],
  combat: ["tactics"],
  stealth: ["route"],
  exploration: ["route", "lore"],
  medicine: ["dosage"],
  art: ["design"],
  leadership: ["schedule", "finance"],
  social_engineering: ["liar", "cipher"],
};

export const canChallenge = (_skill: SkillKey) => true;

function generate(rng: Rng, k: ChallengeKind, library: Book[]): Gen {
  switch (k) {
    case "cipher": return cipher(rng);
    case "sequence": return sequence(rng);
    case "trace": return trace(rng);
    case "logic": return logic(rng);
    case "convert": return convert(rng);
    case "finance": return finance(rng);
    case "build": return build(rng);
    case "design": return design(rng);
    case "dosage": return dosage(rng);
    case "route": return route(rng);
    case "split": return split(rng);
    case "schedule": return schedule(rng);
    case "tactics": return tactics(rng);
    case "liar": return liar(rng);
    case "lore": return lore(rng, library) ?? outside(rng);
    default: return outside(rng);
  }
}

/** A problem for a skill. Projects with 3+ parts pull one part from another skill, so they need mixed hands. */
export function makeChallenge(rng: Rng, skill: SkillKey, parts: number, library: Book[], brief: string): Challenge {
  const out: ChallengePart[] = [];
  const other = rng.pick(SKILLS.filter((s) => s !== skill));
  for (let i = 0; i < parts; i++) {
    const from = parts >= 3 && i === parts - 1 ? other : skill;
    out.push({ ...generate(rng, rng.pick(BY_SKILL[from]), library), id: `p${i + 1}`, attempts: [] });
  }
  return { brief: parts >= 3 ? `${brief} A project with several parts; the last one needs a different kind of hand (${other.replace("_", " ")}).` : brief, parts: out };
}

/** The Silent Relay: two locked phrases that must be opened by two different voices. */
export function relayChallenge(rng: Rng): Challenge {
  return { brief: "The Relay hums two locked phrases. It only answers when two different voices open them.", twoVoices: true, parts: [cipher(rng), cipher(rng)].map((p, i) => ({ ...p, id: `p${i + 1}`, attempts: [] })) };
}

/** A balance summary and forecast for a real netrunner, from their real numbers. */
export function reportChallenge(name: string, creds: number, packPrice: number, pulseHours: number, avgPay: number, contracts: number): Challenge {
  const price = Number.isFinite(packPrice) ? packPrice : 999;
  const reserve = Math.max(0, 48 - Math.floor(pulseHours));
  const parts: Gen[] = [
    { kind: "report", prompt: `${name} holds ${creds} creds. Pulse packs cost ${price} creds and each gives 6 hours. How many hours of Pulse can ${name} buy with all of it?`, answer: String(Math.floor(creds / price) * 6) },
    { kind: "report", prompt: `${name} has about ${Math.floor(pulseHours)} hours of Pulse and wants a 48-hour reserve. How many more hours must ${name} earn (0 if already there)?`, answer: String(reserve) },
    { kind: "report", prompt: `${name} has finished ${contracts} contracts and earned ${Math.round(avgPay * contracts)} creds from them. What is the average pay per contract (rounded down; 0 if none)?`, answer: String(contracts ? Math.floor(avgPay) : 0) },
  ];
  return { brief: `A balance summary and forecast for ${name}.`, parts: parts.map((p, i) => ({ ...p, id: `p${i + 1}`, attempts: [] })) };
}

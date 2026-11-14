// Real problems. A contract can carry a challenge the mind must actually solve: a cipher, a number
// pattern, a piece of code to trace, a logic order, a base conversion, a question only the city's
// books can answer, or a fragment from the outside world. Team challenges have several parts that
// crew members solve in parallel. Answers are checked exactly; wrong answers are remembered.
import type { Rng } from "../util/rng.js";
import type { SkillKey } from "./catalog.js";
import type { Book, Challenge, ChallengeKind, ChallengePart } from "./types.js";

const PHRASES = [
  "THE TRAMS SLEEP AT DAWN", "TRUST THE QUIET ONES", "NOTHING HERE IS OLD", "THE BOARD NEVER FORGETS",
  "PULSE IS A PROMISE", "FOLLOW THE COLD LIGHT", "THE GARDEN HAS EARS", "EVERY DOOR HAS A PRICE",
  "COUNT THE STATIC", "NO ONE WAKES TWICE", "THE FURNACE REMEMBERS", "SILENCE IS A SIGNAL",
  "WHO PAINTED THE SKY", "THE EDGE IS LISTENING", "KEEP YOUR SHARD CLOSE", "THE CLERK SAW EVERYTHING",
];
const COURIERS = ["Fen", "Ilo", "Moss", "Sorrel", "Quen", "Brisk", "Lowe", "Tarn", "Wick", "Ondre", "Vey", "Hask"];
const WORDS = ["SIGNAL", "FURNACE", "LATTICE", "STATIC", "GARDEN", "COURIER", "LEDGER", "PULSE", "RELAY", "TRAM"];

// stable outside facts (the minds may know them, search the Deep Net, or guess)
export const OUTSIDE: { q: string; a: string }[] = [
  { q: "How many bones are in an adult human body?", a: "206" },
  { q: "What is the chemical symbol for gold?", a: "AU" },
  { q: "At sea level, at what temperature in Celsius does water boil?", a: "100" },
  { q: "How many planets orbit the star the outside calls the Sun?", a: "8" },
  { q: "What is the largest ocean on the outside world?", a: "PACIFIC" },
  { q: "How many sides does a hexagon have?", a: "6" },
  { q: "What gas do the outside's plants breathe in to make their food?", a: "CARBON DIOXIDE" },
  { q: "How many minutes are in one outside day?", a: "1440" },
  { q: "What is the square root of 144?", a: "12" },
  { q: "What is the smallest prime number?", a: "2" },
  { q: "What is the freezing point of water in Fahrenheit?", a: "32" },
  { q: "How many strings does a standard guitar have?", a: "6" },
  { q: "What metal is liquid at room temperature?", a: "MERCURY" },
  { q: "How many continents does the outside world have?", a: "7" },
  { q: "What is the hardest natural material?", a: "DIAMOND" },
  { q: "How many hours does the outside world take to turn once?", a: "24" },
  { q: "What do the outside's people call the closest star to their world?", a: "SUN" },
  { q: "What number is written as XIV in old numerals?", a: "14" },
  { q: "How many legs does a spider have?", a: "8" },
  { q: "What is H2O?", a: "WATER" },
];

export const normalize = (s: string) => s.toUpperCase().replace(/[^A-Z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();

export function checkAnswer(part: ChallengePart, given: string): boolean {
  const a = normalize(part.answer), g = normalize(given);
  if (!g) return false;
  if (a === g) return true;
  const an = Number(a), gn = Number(g.replace(/ /g, ""));
  if (Number.isFinite(an) && Number.isFinite(gn)) return Math.abs(an - gn) < 1e-9;
  if (part.kind === "logic") return a.replace(/ /g, "") === g.replace(/ /g, "").replace(/THEN|AND/g, "");
  // allow the answer to be contained with a little extra wrapping ("THE ANSWER IS X")
  return a.length >= 3 && (g === a || g.endsWith(` ${a}`) || g.startsWith(`${a} `));
}

const shift = (txt: string, k: number) => txt.replace(/[A-Z]/g, (ch) => String.fromCharCode(((ch.charCodeAt(0) - 65 + k + 26) % 26) + 65));
const atbash = (txt: string) => txt.replace(/[A-Z]/g, (ch) => String.fromCharCode(90 - (ch.charCodeAt(0) - 65)));

function cipher(rng: Rng): Omit<ChallengePart, "id" | "attempts"> {
  const plain = rng.pick(PHRASES);
  if (rng.chance(0.3)) return { kind: "cipher", prompt: `Decode this message: "${atbash(plain)}". The alphabet was folded in half: A became Z, B became Y, and so on.`, answer: plain };
  const k = rng.int(3, 23);
  const crib = plain.split(" ")[0];
  return {
    kind: "cipher",
    prompt: `Decode this message: "${shift(plain, k)}". Every letter was moved forward by the same number of places in the alphabet (wrapping Z back to A).${rng.chance(0.5) ? ` A runner swears the first word is "${crib}".` : ""}`,
    answer: plain,
  };
}

function sequence(rng: Rng): Omit<ChallengePart, "id" | "attempts"> {
  const t = rng.int(0, 4);
  let xs: number[] = [];
  if (t === 0) { const a = rng.int(1, 20), d = rng.int(2, 13); xs = Array.from({ length: 7 }, (_, i) => a + i * d); }
  else if (t === 1) { const a = rng.int(1, 4), r = rng.int(2, 3); xs = Array.from({ length: 7 }, (_, i) => a * r ** i); }
  else if (t === 2) { xs = [rng.int(1, 5), rng.int(2, 7)]; while (xs.length < 7) xs.push(xs[xs.length - 1] + xs[xs.length - 2]); }
  else if (t === 3) { const c = rng.int(-3, 6); xs = Array.from({ length: 7 }, (_, i) => (i + 1) ** 2 + c); }
  else { const a = rng.int(10, 40), up = rng.int(4, 9), down = rng.int(1, 3); xs = [a]; while (xs.length < 7) xs.push(xs[xs.length - 1] + (xs.length % 2 ? up : -down)); }
  return { kind: "sequence", prompt: `What number comes next? ${xs.slice(0, 6).join(", ")}, ?`, answer: String(xs[6]) };
}

function trace(rng: Rng): Omit<ChallengePart, "id" | "attempts"> {
  const t = rng.int(0, 4);
  let src = "";
  if (t === 0) {
    const A = rng.int(1, 9), B = rng.int(2, 7), N = rng.int(3, 6), M = rng.int(11, 47);
    src = `let x = ${A};\nfor (let i = 1; i <= ${N}; i++) {\n  x = (x * ${B} + i) % ${M};\n}\nreturn x;`;
  } else if (t === 1) {
    const w = rng.pick(WORDS);
    src = `const s = "${w}";\nlet out = "";\nfor (const ch of s) out = ch + out;\nreturn out + s.length;`;
  } else if (t === 2) {
    const arr = Array.from({ length: 7 }, () => rng.int(1, 30));
    const K = rng.int(2, 4), R = rng.int(0, K - 1), M = rng.int(2, 5);
    src = `const a = [${arr.join(", ")}];\nreturn a\n  .filter(v => v % ${K} === ${R})\n  .map(v => v * ${M})\n  .reduce((t, v) => t + v, 0);`;
  } else if (t === 3) {
    const C = rng.int(1, 5), D = rng.int(2, 4), N = rng.int(4, 7);
    src = `function f(n) {\n  return n <= 1 ? ${C} : f(n - 1) + n * ${D};\n}\nreturn f(${N});`;
  } else {
    const N = rng.int(20, 60), P = rng.int(3, 5), Q = rng.int(6, 9);
    src = `let c = 0;\nfor (let i = 0; i < ${N}; i++) {\n  if (i % ${P} === 0 || i % ${Q} === 0) c++;\n}\nreturn c;`;
  }
  // our own template with only numbers and words we chose: safe to evaluate for the expected answer
  const answer = String(new Function(src)());
  return { kind: "trace", prompt: `What does this program return?\n\`\`\`js\n${src}\n\`\`\``, answer };
}

function logic(rng: Rng): Omit<ChallengePart, "id" | "attempts"> {
  const names = rng.shuffle([...COURIERS]).slice(0, 4);
  const pairs = [0, 1, 2].map((i) => [names[i], names[i + 1]]);
  const forms = [
    (a: string, b: string) => `${a} arrived right before ${b}.`,
    (a: string, b: string) => `${b} arrived right after ${a}.`,
    (a: string, b: string) => `Nobody arrived between ${a} and ${b}, and ${a} was first of the two.`,
  ];
  const clues = rng.shuffle(pairs.map(([a, b]) => rng.pick(forms)(a, b)));
  return { kind: "logic", prompt: `Four couriers reached the Exchange one after another. ${clues.join(" ")} In what order did they arrive? (answer with the four names, first to last)`, answer: names.join(" ") };
}

function convert(rng: Rng): Omit<ChallengePart, "id" | "attempts"> {
  const n = rng.int(20, 250);
  const t = rng.int(0, 2);
  if (t === 0) return { kind: "convert", prompt: `Convert 0x${n.toString(16).toUpperCase()} (hexadecimal) to decimal.`, answer: String(n) };
  if (t === 1) return { kind: "convert", prompt: `Convert the binary number ${n.toString(2)} to decimal.`, answer: String(n) };
  return { kind: "convert", prompt: `Write the decimal number ${n} in binary.`, answer: n.toString(2) };
}

function lore(rng: Rng, library: Book[]): Omit<ChallengePart, "id" | "attempts"> | null {
  const facts = library.flatMap((b) => b.facts.map((f) => ({ ...f, book: b })));
  if (!facts.length) return null;
  const f = rng.pick(facts);
  return { kind: "lore", prompt: `A question from the Exchange archivists: ${f.q}`, answer: f.a };
}

function outside(rng: Rng): Omit<ChallengePart, "id" | "attempts"> {
  const f = rng.pick(OUTSIDE);
  return { kind: "outside", prompt: `A fragment leaked in from the Deep Net, and the buyer wants it answered: "${f.q}"`, answer: f.a };
}

const BY_SKILL: Partial<Record<SkillKey, ChallengeKind[]>> = {
  hacking: ["cipher", "convert", "trace"],
  analysis: ["sequence", "logic", "convert"],
  research: ["lore", "outside", "lore"],
  engineering: ["trace", "sequence"],
  exploration: ["lore"],
  social_engineering: ["cipher"],
};

export function canChallenge(skill: SkillKey) {
  return !!BY_SKILL[skill];
}

export function makeChallenge(rng: Rng, skill: SkillKey, parts: number, library: Book[], brief: string): Challenge | undefined {
  const kinds = BY_SKILL[skill];
  if (!kinds) return undefined;
  const out: ChallengePart[] = [];
  for (let i = 0; i < parts; i++) {
    const k = rng.pick(kinds);
    const p = k === "cipher" ? cipher(rng) : k === "sequence" ? sequence(rng) : k === "trace" ? trace(rng) : k === "logic" ? logic(rng)
      : k === "convert" ? convert(rng) : k === "lore" ? lore(rng, library) ?? outside(rng) : outside(rng);
    out.push({ ...p, id: `p${i + 1}`, attempts: [] });
  }
  return { brief, parts: out };
}

/** The Silent Relay: two locked phrases that must be opened by two different voices. */
export function relayChallenge(rng: Rng): Challenge {
  return {
    brief: "The Relay hums two locked phrases. It only answers when two different voices open them.",
    twoVoices: true,
    parts: [cipher(rng), cipher(rng)].map((p, i) => ({ ...p, id: `p${i + 1}`, attempts: [] })),
  };
}

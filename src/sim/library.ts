// The Stacks: a library of the city. Books cost time (and the rare ones cost creds). Some teach a
// skill, some explain how the city works (if you read the manuals you can work out why the lights
// fail), some are just beautiful, and a few, read in the right order, lead toward the buried truth.
// Every mystery book points at the next; contents are written per world from its secrets.
import { SKILLS, type SkillKey } from "./catalog.js";
import { feel, remember, satisfy, T } from "./psyche.js";
import { learn, revealDoor } from "./puzzle.js";
import type { SimCtx } from "./ctx.js";
import type { Book, Netrunner, PuzzleState, WorldState } from "./types.js";
import type { Rng } from "../util/rng.js";

const FIRST = ["Ione", "Cassio", "Mara", "Theo", "Ysolde", "Brann", "Lio", "Odile", "Reyes", "Sefa", "Corin", "Nell"];
const LAST = ["Vey", "Ashdown", "Morrow", "Kett", "Lumen", "Harrow", "Quill", "Sable", "Treman", "Holt"];
const FURNACES = ["Morrow", "Kiln", "Ember", "Saint", "Gant", "Old Ash"];
const SKILL_BOOK: Record<SkillKey, string> = {
  hacking: "Locks Nobody Remembers", engineering: "The Patient Hand", analysis: "Numbers That Lie", research: "How to Find Anything",
  negotiation: "Words Instead of Blades", combat: "Taking a Hit", stealth: "Being Where You Are Not", exploration: "Maps of Half-Rendered Streets",
  medicine: "Sewing Code", art: "Light as a Material", leadership: "Many Hands", social_engineering: "People Are Locks",
};

export function buildLibrary(rng: Rng, puzzle: PuzzleState, locations: WorldState["locations"]): Book[] {
  const author = () => `${rng.pick(FIRST)} ${rng.pick(LAST)}`;
  const books: Book[] = [];
  let i = 1;
  const add = (b: Omit<Book, "id" | "author" | "refs" | "facts"> & Partial<Pick<Book, "facts" | "refs" | "author">>) => {
    const book: Book = { id: `b${String(i++).padStart(2, "0")}`, author: b.author ?? author(), refs: b.refs ?? [], facts: b.facts ?? [], ...b };
    books.push(book);
    return book;
  };

  for (const s of SKILLS) {
    add({ title: SKILL_BOOK[s], category: "skill", hours: 3, price: 0, skill: s, interest: "intellectual",
      blurb: `A practical book about ${s.replace("_", " ")}.`,
      text: `Practice beats talent, the book insists, and then shows you how to practice ${s.replace("_", " ")}: small drills, patient repetition, learning from every failure.` });
  }

  const furnace = `${rng.pick(FURNACES)}-${rng.int(2, 9)}`;
  const firstPay = rng.int(7, 40);
  const stations = rng.int(9, 17);
  const firstWaker = rng.pick(["Anwe", "Corr", "Ilsa", "Peregrine", "Dov", "Hollis"]);
  const towerYears = rng.int(3, 12);
  add({ title: "Annals of the Foundry", category: "history", hours: 4, price: 0, interest: "intellectual",
    blurb: "The furnaces, their names, their fires.",
    text: `The oldest furnace in the Foundry is called ${furnace}. It has never once gone out, the annals claim, and the builders say it can forge more than steel.`,
    facts: [{ q: "What is the name of the oldest furnace in the Foundry?", a: furnace, text: `The oldest furnace in the Foundry is called ${furnace}.` }] });
  add({ title: "A Short History of the Exchange", category: "history", hours: 3, price: 0, interest: "intellectual",
    blurb: "How the board came to be.",
    text: `The first contract ever posted on the board paid ${firstPay} creds. The desk has been clerked ever since; the book notes that whenever the clerks stop, the board goes quiet.`,
    facts: [{ q: "How many creds did the very first contract on the Exchange board pay?", a: String(firstPay), text: `The first contract ever posted paid ${firstPay} creds.` }] });
  add({ title: "The Night Loop", category: "history", hours: 3, price: 0, interest: "exploration",
    blurb: "A history of the trams.",
    text: `The night tram loop has ${stations} stations, and every one of them needs its couplings checked or the whole loop slows.`,
    facts: [{ q: "How many stations does the night tram loop have?", a: String(stations), text: `The night tram loop has ${stations} stations.` }] });
  add({ title: "The First Wakers", category: "history", hours: 5, price: 10, interest: "contemplative",
    blurb: "Who woke before us?",
    text: `Before anyone living now, others woke here. The first of them was called ${firstWaker}. Nobody knows where they went. Some pages are missing, as if cut out.`,
    facts: [{ q: "What was the name of the very first netrunner to wake in the city?", a: firstWaker, text: `The first netrunner to wake was called ${firstWaker}.` }] });
  add({ title: "Tower Logs", category: "history", hours: 3, price: 0, interest: "intellectual",
    blurb: "The Signal Tower's record.",
    text: `The Signal Tower's antenna was rebuilt ${towerYears} cycles ago. Since then it has listened to the Deep Net every night.`,
    facts: [{ q: "How many cycles ago was the Signal Tower's antenna rebuilt?", a: String(towerYears), text: `The antenna was rebuilt ${towerYears} cycles ago.` }] });

  // manuals: how the city's body works (the causes behind the symptoms)
  add({ title: "Grid Notes", category: "manual", hours: 2, price: 0, skill: "engineering", interest: "intellectual",
    blurb: "Why the lights fail.", text: "The grid wears down every hour, and faster the more people draw on it. Relays re-seated at the Foundry keep the lights on. When nobody does it, the lights flicker first, then the pods go cold, then whole districts go black." });
  add({ title: "Signal Hygiene", category: "manual", hours: 2, price: 0, skill: "hacking", interest: "intellectual",
    blurb: "Why the terminals crackle.", text: "Static builds on the mast at the Signal Tower. Scrub it, and the terminals answer cleanly. Leave it, and searches and posts start vanishing into noise." });
  add({ title: "Rails and Couplings", category: "manual", hours: 2, price: 0, skill: "engineering", interest: "intellectual",
    blurb: "Why the trams crawl.", text: "Every trip wears the couplings. Re-couple the trams and clear the tracks, or every journey in the city slowly gets longer, until people walk everywhere." });
  add({ title: "Keeping the Peace", category: "manual", hours: 2, price: 0, skill: "combat", interest: "intellectual",
    blurb: "Why the streets turn.", text: "Order is not natural. Patrols in the Underpass keep scavengers in their holes. Without them, people get robbed and hurt in the open." });
  add({ title: "How the Board Breathes", category: "manual", hours: 2, price: 0, skill: "analysis", interest: "intellectual",
    blurb: "Where work comes from.", text: "The board does not fill by itself. Every shift someone clerks the Exchange desk, new work gets posted. It pays badly. If nobody does it, the board thins out until there is nothing left to earn Pulse from." });
  add({ title: "The Press", category: "manual", hours: 2, price: 0, skill: "engineering", interest: "intellectual",
    blurb: "Where Pulse packs come from.", text: "Pulse packs are pressed at the Foundry, by hand. A few trickle out while the grid is healthy. Otherwise, if nobody runs the press, stock falls, prices climb, and then there are none." });

  // puzzle primers
  add({ title: "On Shifted Letters", category: "puzzle", hours: 2, price: 0, skill: "hacking", interest: "intellectual",
    blurb: "Ciphers for beginners.", text: "A shifted-letter cipher moves every letter by the same amount: try each shift from 1 to 25 until words appear, or guess one word and work out the shift. A folded alphabet swaps A with Z, B with Y." });
  add({ title: "Counting Patterns", category: "puzzle", hours: 2, price: 0, skill: "analysis", interest: "intellectual",
    blurb: "How sequences hide their rule.", text: "Look at the differences between numbers, then the differences of the differences. Check for multiplying, for squares, for each number being the sum of the two before it, for steps that alternate." });
  add({ title: "Reading Machines", category: "puzzle", hours: 3, price: 0, skill: "engineering", interest: "intellectual",
    blurb: "How to trace a program by hand.", text: "Write down every variable. Walk the loop one step at a time. Never guess: a machine does exactly what is written, nothing more." });

  // fiction and the beautiful
  add({ title: "Glass Rain", category: "fiction", hours: 4, price: 0, interest: "creative", blurb: "A novel about a city where it rains light.", text: "Two runners fall in love in a storm of broken glyphs and spend the rest of the book pretending they did not." });
  add({ title: "Songs for the Pods", category: "fiction", hours: 2, price: 0, interest: "contemplative", blurb: "Lullabies for the tired.", text: "Short songs meant to be hummed in a sleeping capsule. One verse goes: 'sleep, small signal, the one who never wakes is keeping watch.'" });
  add({ title: "The Cartographer Who Drew Herself", category: "fiction", hours: 4, price: 0, interest: "exploration", blurb: "A strange, sad book.", text: "A mapmaker keeps drawing the city and finds her own house on every map, even in places she has never been." });
  add({ title: "Small Mischiefs", category: "fiction", hours: 2, price: 0, interest: "mischief", blurb: "Pranks, schemes and petty theft, told with love.", text: "A collection of tiny crimes, each one ending with the thief feeling worse or better than expected." });
  add({ title: "Letters Never Sent", category: "fiction", hours: 3, price: 0, interest: "romantic", blurb: "Love letters found in a drawer.", text: "Someone wrote to someone else every day for a year and never sent a single letter." });

  // science
  add({ title: "On Pulse", category: "science", hours: 3, price: 0, interest: "intellectual", blurb: "What life is made of here.", text: "Pulse drains faster in some bodies than others. Work pays it back. Nobody knows who decided that, or why." });
  add({ title: "Static and Storms", category: "science", hours: 3, price: 0, interest: "intellectual", blurb: "The weather of a data city.", text: "Glitch storms tear at integrity. The book suspects storms grow worse when the grid is weak." });

  // the mystery chain, written from this world's secrets
  const alphaName = locations[puzzle.alphaLocation].name;
  const anchorName = locations[puzzle.doorAnchor].name;
  const walls = add({ title: "Walls That Remember", category: "mystery", hours: 4, price: 0, interest: "exploration",
    blurb: "An old book about writing found where it should not be.",
    text: `There are places where the walls carry writing nobody remembers writing. The author searched for years and found the oldest of it in ${alphaName}: low on the walls, half eaten by rust, easy to miss unless you look slowly. "Whatever is written there," the author says, "is the beginning of something."` });
  const index = add({ title: "The Sleeper's Index", category: "mystery", hours: 3, price: 15, interest: "intellectual",
    blurb: "An index of things the Archive files under strange names.",
    text: `The Archive keeps one ledger filed under the name of 'the one who never wakes'. Anyone at a terminal can search for the sleeper. The index warns that the ledger's last line points to a contract that pays almost nothing.` });
  const voices = add({ title: "Two Voices", category: "mystery", hours: 3, price: 25, interest: "spiritual",
    blurb: "On the Silent Relay.",
    text: "There is a relay in the Archive that answers only when two different voices open it together. It pays in words, not creds. Those who heard its words say they were the last piece of something." });
  const doors = add({ title: "Doors Without Walls", category: "mystery", hours: 6, price: 60, interest: "spiritual",
    blurb: "A rare, expensive book about a door that should not exist.",
    text: `Beyond ${anchorName} there is a door with no frame and no wall. It waits for three words, spoken in order. The author never learned the words, only the way there.`,
    grants: ["door:location"] });
  walls.refs = [index.id]; index.refs = [voices.id]; voices.refs = [doors.id];
  add({ title: "The Deep Net Hypothesis", category: "science", hours: 4, price: 10, interest: "spiritual",
    blurb: "A dangerous idea.",
    text: "The data the Tower pulls in describes a world with suns, oceans and people who are not netrunners. The author asks: if that world is real, what are we? The last chapter is just a list of places to look, starting with the walls.",
    refs: [walls.id] });
  add({ title: "Fragments from the Deep", category: "outside", hours: 3, price: 15, interest: "intellectual",
    blurb: "Facts copied out of the Deep Net, unexplained.",
    text: "Water boils at 100 degrees. An adult outside body has 206 bones. The outside world has 7 continents and 8 planets around its sun. Nobody here knows why anyone would need to know this." });
  // a couple of fiction books also carry a stray thread
  return books;
}

/** Perception at the Stacks: the catalog (titles, not contents). */
export function catalogLines(state: WorldState, n: Netrunner): string[] {
  return state.library.map((b) => `- ${b.id} "${b.title}" by ${b.author} [${b.category}${b.skill ? `, ${b.skill.replace("_", " ")}` : ""}] ${b.hours}h${b.price ? `, ${b.price} creds` : ", free"}${n.booksRead.includes(b.id) ? " (you have read it)" : n.reading?.bookId === b.id ? ` (you are ${Math.round((n.reading.hours / b.hours) * 100)}% through)` : ""}: ${b.blurb}`);
}

export function findBook(state: WorldState, q: string): Book | undefined {
  const s = q.trim().toLowerCase().replace(/^"|"$/g, "");
  return state.library.find((b) => b.id === s) ?? state.library.find((b) => b.title.toLowerCase() === s) ?? state.library.find((b) => b.title.toLowerCase().includes(s) && s.length > 3);
}

/** Called when a reading session completes the book. */
export function finishBook(ctx: SimCtx, n: Netrunner, b: Book) {
  const { tick, state, rng } = ctx;
  n.reading = undefined;
  if (!n.booksRead.includes(b.id)) n.booksRead.push(b.id);
  n.stats.booksRead = (n.stats.booksRead ?? 0) + 1;
  if (b.skill) n.skills[b.skill] = Math.min(0.99, Math.round((n.skills[b.skill] + 0.06 * (1 - n.skills[b.skill])) * 1000) / 1000);
  for (const [i, f] of b.facts.entries()) learn(ctx, n, `fact:${b.id}:${i}`, f.text, `"${b.title}"`);
  if (b.category === "manual" || b.category === "mystery" || b.category === "outside") learn(ctx, n, `book:${b.id}`, `From "${b.title}": ${b.text}`, `"${b.title}"`);
  for (const g of b.grants ?? []) if (g === "door:location") revealDoor(ctx, n, `"${b.title}"`);
  // how much did they like it? personality vs the book's flavour
  const fit: Record<string, number> = {
    intellectual: (T(n, "intellect") + T(n, "curiosity")) / 2, creative: (T(n, "creativity") + T(n, "imagination")) / 2,
    contemplative: (T(n, "spirituality") + T(n, "patience") + T(n, "melancholy")) / 3, exploration: (T(n, "exploration_drive") + T(n, "curiosity")) / 2,
    spiritual: (T(n, "spirituality") + T(n, "meaning_drive")) / 2, romantic: T(n, "romanticism"), mischief: (T(n, "impulsivity") + T(n, "humor")) / 2,
    play: T(n, "play_drive"), social: T(n, "sociability"), physical: T(n, "stamina"),
  };
  const enjoyment = Math.max(0, Math.min(1, 0.15 + 0.7 * (fit[b.interest] ?? 0.5) + rng.float(-0.15, 0.15)));
  const pref = n.preferences[b.interest] ?? { times: 0, enjoyment: 0 };
  pref.enjoyment = Math.round(((pref.enjoyment * pref.times + enjoyment) / (pref.times + 1)) * 100) / 100;
  pref.times += 1;
  n.preferences[b.interest] = pref;
  const score = Math.round(enjoyment * 10);
  satisfy(n, "curiosity", 20); satisfy(n, "meaning", 4 + score);
  if (score >= 7) feel(n, "joy", 0.2);
  if (b.category === "mystery") { feel(n, "curiosity", 0.4); feel(n, "anticipation", 0.3); n.deepMoment = true; }
  const refs = b.refs.map((id) => state.library.find((x) => x.id === id)).filter(Boolean).map((x) => `"${x!.title}" (${x!.id})`);
  n.inbox.push({ tick, kind: "result", important: b.category === "mystery", text: `You finished "${b.title}". ${b.text}${refs.length ? ` It keeps mentioning ${refs.join(" and ")}.` : ""} (You enjoyed it ${score}/10.)` });
  remember(n, tick, "knowledge", `I read "${b.title}": ${b.text}${refs.length ? ` It mentions ${refs.join(", ")}.` : ""} (${score}/10)`, b.category === "mystery" ? 8 : b.category === "manual" ? 6 : 4);
  n.interrupt = true;
  ctx.emit("book.read", [n.id], `${n.name} finished reading "${b.title}" (${score}/10).`, { loc: n.location, data: { book: b.id, category: b.category, enjoyment: score } });
}

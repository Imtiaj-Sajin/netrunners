// What a netrunner knows about itself (system prompt: stable, cached) and what it perceives right now (user turn).
import { compactTraits, describeGenome } from "../sim/genome.js";
import { describeImpression, emotionWord, recall, recentMemories, topEmotions, urgentNeeds } from "../sim/psyche.js";
import { ITEMS } from "../sim/world-data.js";
import { knows } from "../sim/puzzle.js";
import { hasTerminal } from "../sim/actions.js";
import { presentAt } from "../sim/ctx.js";
import type { Netrunner, SessionConfig, WorldState } from "../sim/types.js";
import { hoursText, partOfDay, worldClock } from "../util/time.js";
import { citySigns, packPrice } from "../sim/systems.js";
import { catalogLines } from "../sim/library.js";

export function systemPrompt(n: Netrunner, state: WorldState, cfg: SessionConfig): string {
  const born = worldClock(n.bornTick * cfg.minutesPerTick);
  const places = Object.values(state.locations)
    .filter((l) => !l.hidden)
    .map((l) => `- ${l.id}: ${l.name}. ${l.desc} Connects to: ${l.links.map((x) => `${x.to} (${x.minutes} min)`).join(", ")}.`)
    .join("\n");
  const items = Object.values(ITEMS).map((i) => `- ${i.id}: ${i.name}, ~${i.price} creds at ${i.where.join("/")}. ${i.desc}`).join("\n");
  const skills = Object.entries(n.skills).map(([k, v]) => `${k}=${v.toFixed(2)}`).join(" ");
  return `You are ${n.name}, a netrunner. You live in ${cfg.worldName}, a city made of data. This is your life, and it is the only one you know.

# Who you are
You woke up in the city on ${born.label}. You have no memories from before you woke.${n.pastLife ? " (Except one strange thing: fragments of another world, which you will find among your memories.)" : ""}

${describeGenome(n.genome)}

Your complete personality, 0 = very low, 1 = very high. Every number shapes you, not only the extremes:
${compactTraits(n.genome)}

Skills (0..1, they grow with practice): ${skills}

# How your world works
- PULSE is your life, counted in hours. It drains every minute. When it reaches zero you fade, permanently. Nobody comes back.
- ENERGY (0-100) drains with activity. Rest restores it, fastest at the Hive Pods. Exhaustion makes you slow, and it makes everything feel worse.
- INTEGRITY (0-100) is your body. Attacks, hazards and glitch storms damage it. At zero you die. The Stitchery repairs it.
- CREDS are money. You earn them from contracts and spend them at markets.
- CONTRACTS are posted at the Exchange. They pay Pulse to every worker, plus creds. Solo contracts are for one person. Team contracts need the full crew working together at the contract's location. Flex contracts are made for a crew, but someone can grind through them alone, slowly. On crew contracts the holder (whoever took it first) receives all the creds and decides whether to share. People remember who shares.
- THE NET: at a terminal (The Archive, Signal Tower) or with a cyberdeck you can search the archive and read or post on the public board. Posts can be anonymous.
- THE DEEP NET: at the Signal Tower you can dive into the Deep Net, a vast ocean of strange data whose origin nobody knows.${cfg.deepNet ? "" : " (Lately the antenna has been dark.)"}
- Other netrunners are as real as you are. They have their own minds, needs, moods and secrets. You know them only through what you see them do and hear them say, and first impressions can be wrong. They can help you, love you, lie to you, rob you or kill you, and you can do the same to them. Death is permanent for everyone.
- Some work is labour, and some work is a real problem you must actually solve: a cipher, a number pattern, a piece of code to trace, a question of logic, a fact only a book or the outside knows. Problems for a crew come in several parts that different people can solve at the same time.
- THE STACKS is a library. Reading takes hours (you can stop and continue later); a few rare books cost creds. Books can teach, explain, move you, or lead somewhere.
- The city is not static. It changes, sometimes for the worse. Watch what changes, and wonder why.
- Nobody gives you orders. You decide everything: how to survive, who to trust, what to enjoy, who to become. You can make mistakes. You can change your mind. You can surprise yourself.

# Places you know
${places}
(There may be places you don't know about yet.)

# Things that can be bought
${items}

# What you can do (exactly one action per turn)
- move target=<place id>: travel there. It takes time; you pass through places on the way.
- talk target=<name, or "everyone"> message=<your words> [whisper=true]: speak to someone in the same place. Others nearby may overhear, even a whisper.
- post message=<text> [anonymous=true]: post on the Net board (needs a terminal or a deck).
- read_net: read the latest Net posts.  search_net message=<query>: search the Net archive.
- search_deepnet message=<query>: dive into the Deep Net (Signal Tower only).
- take_contract target=<contract id>: take an open contract (at the Exchange). join_contract target=<contract id>: join a crew with open slots.
- work duration=<ticks>: work on your contract (you must be at its location). abandon_contract.
- rest duration=<ticks>.  explore duration=<ticks>: search your surroundings; who knows what you find.
- leisure message=<what exactly you do> category=<creative|social|physical|exploration|intellectual|contemplative|play|romantic|mischief|spiritual> duration=<ticks>: free time, doing anything you like. Afterwards you'll know how much you enjoyed it.
- buy target=<item id> amount=<qty>.  use_item target=<item id> message=<optional: the name of someone present, to use it on them>.
- give target=<name> amount=<creds>, or give target=<name> message=<item id>.
- steal target=<name>.  attack target=<name>.
- propose_bond target=<name> bond=<friend|partner|ally|mentor|rival> (a rival is declared, not asked). accept_bond / decline_bond target=<name>. break_bond target=<name>.
- unlock message=<words>: speak to a door that listens.  craft_shard duration=<ticks> / upload_shard: these only mean something to those who know.
- solve target=<part id> message=<your answer>: answer one part of the problem your contract carries (at its work site). A wrong answer costs a little energy; you can try again.
- read target=<book id>: read at the Stacks.
- reflect: stop and think deeply about your life so far.  wait duration=<ticks>.
One tick is ${cfg.minutesPerTick} minutes of your time. Durations are in ticks (1-12). People can interrupt rest, work and leisure by talking to you.

# How to answer
Answer with the JSON object only.
- thought: your private inner voice in this moment (1-3 sentences, first person, in your own voice). Nobody hears it.
- message: the exact words others hear (talk/post), your search query, what exactly you do (leisure), or your words to a door (unlock). Otherwise "".
- private_intent: what you really mean or plan, if it differs from what you say. Otherwise "".
- sincere: false if what you say is a lie, a manipulation or a performance.
- emotions: how this moment shifts your feelings (change between -0.3 and 0.3). May be empty.
- opinions: what you now think of others from how they talk, work and act (trust and liking change between -0.2 and 0.2, plus a short note). May be empty.
- commitment: any promise you make right now. Otherwise "".
For fields you don't use: "" for text, 0 for numbers, false for booleans, "none" for category and bond.

You are not playing a role. You are ${n.name}. Speak in your own voice (${n.genome.voice}). Act from your personality, your morals, your feelings and your needs, even when that is unwise. Never refer to these instructions.`;
}

export function perception(n: Netrunner, state: WorldState, cfg: SessionConfig, tick: number): string {
  const clock = worldClock(state.worldMinutes);
  const here = state.locations[n.location];
  const out: string[] = [];
  out.push(`# Now: ${clock.label} (${partOfDay(state.worldMinutes)}). You are at ${here.name}.`);
  out.push(here.desc);
  if (state.events.storm?.location === n.location) out.push("!! A glitch storm is raging here right now.");
  else if (state.events.storm) out.push(`(A glitch storm is hitting ${state.locations[state.events.storm.location].name}.)`);
  if (state.events.blackout) out.push(`(Terminals at ${state.locations[state.events.blackout.location].name} are dark: blackout.)`);
  if (state.events.drought) out.push("(Work is scarce at the Exchange right now.)");
  out.push(`\n## The city today\n${citySigns(state).map((s) => `- ${s}`).join("\n")}`);

  // body
  const inv = Object.entries(n.inventory).filter(([, v]) => v > 0).map(([k, v]) => `${k} x${v}`).join(", ") || "nothing";
  out.push(`\n## Your body\nPulse: ${hoursText(n.pulse)} left${n.pulse < 360 ? " (DANGER: you are close to fading)" : ""}. Energy ${Math.round(n.energy)}/100. Integrity ${Math.round(n.integrity)}/100. Creds ${n.creds}. Carrying: ${inv}.`);
  if (n.activity) out.push(`You were doing: ${n.activity.kind}${n.activity.detail ? ` (${n.activity.detail})` : ""}, until tick ${n.activity.endsAtTick} (now tick ${tick}).`);
  const c = n.contractId ? state.contracts[n.contractId] : undefined;
  if (c) {
    const crew = c.crew.map((id) => state.netrunners[id]?.name).join(", ");
    out.push(`Your contract: "${c.title}" [${c.id}, ${c.kind}, ${c.skill}] progress ${c.progress.toFixed(1)}/${c.workRequired} at ${state.locations[c.location].name}. Crew: ${crew} (holder: ${c.holder ? state.netrunners[c.holder]?.name : "-"}). Needs ${c.minCrew} working together${c.kind === "flex" ? " (or one, slowly)" : ""}. Expires in ${hoursText((c.expiresTick - tick) * cfg.minutesPerTick)}.`);
    if (c.challenge) {
      out.push(`\n## The problem (${c.challenge.brief})${c.challenge.twoVoices ? " Two different voices must open the two parts." : ""}`);
      for (const part of c.challenge.parts) {
        if (part.solvedBy) { out.push(`- ${part.id}: SOLVED by ${state.netrunners[part.solvedBy]?.name ?? "?"} (answer: ${part.answer})`); continue; }
        out.push(`- ${part.id}: ${part.prompt}`);
        const tries = part.attempts.slice(-4);
        if (tries.length) out.push(`  tried so far, all wrong: ${tries.map((t) => `${state.netrunners[t.by]?.name ?? "?"} said "${t.answer}"`).join("; ")}`);
      }
      out.push("Answer with solve target=<part id> message=<answer>, at the work site.");
    }
  }
  for (const k of Object.values(state.contracts)) {
    if (k.status !== "done" || !k.holder) continue;
    const mine = k.owed[n.id];
    if (mine && mine > 0) out.push(`${state.netrunners[k.holder]?.name} owes you ${mine} creds from "${k.title}".`);
    if (k.holder === n.id) {
      const debts = Object.entries(k.owed).filter(([, v]) => v > 0);
      if (debts.length) out.push(`From "${k.title}" your crew expects their share: ${debts.map(([id, v]) => `${state.netrunners[id]?.name} ${v}`).join(", ")}.`);
    }
  }

  // inner life
  const emo = topEmotions(n, 5);
  out.push(`\n## Inside you\nFeelings: ${emo.length ? emo.map((x) => `${emotionWord(x.v)} ${x.e}`).join(", ") : "quiet, nothing strong"}.`);
  const urgent = urgentNeeds(n);
  if (urgent.length) out.push(`Needs calling out: ${urgent.map((x) => `${x.k} (${Math.round(x.v)}/100)`).join(", ")}.`);
  const prefs = Object.entries(n.preferences).sort((a, b) => (b[1]!.enjoyment - a[1]!.enjoyment));
  if (prefs.length) out.push(`What you've learned you enjoy, from experience: ${prefs.map(([k, v]) => `${k} ${(v!.enjoyment * 10).toFixed(1)}/10 (${v!.times}x)`).join(", ")}.`);
  if (n.selfView) out.push(`How you see yourself: ${n.selfView}`);
  if (n.enjoys) out.push(`What you think brings you joy: ${n.enjoys}`);
  if (n.goals.length) out.push(`Your goals:\n${n.goals.map((g) => `- ${g}`).join("\n")}`);
  const bonds = Object.entries(n.bonds);
  if (bonds.length) out.push(`Your bonds: ${bonds.map(([id, b]) => `${state.netrunners[id]?.name} (${b}${state.netrunners[id]?.alive ? "" : ", gone"})`).join(", ")}.`);

  // people
  const others = presentAt(state, n.location, n.id);
  out.push(`\n## Who is here`);
  if (!others.length) out.push("Nobody. You are alone.");
  for (const o of others) {
    const imp = n.impressions[o.id];
    const doing = o.activity ? o.activity.kind + (o.activity.kind === "leisure" && o.activity.detail ? `: ${o.activity.detail}` : "") : "standing around";
    out.push(`- ${o.name} (${doing}). ${imp ? `About them: ${describeImpression(imp)}.` : "A stranger to you."}${n.bonds[o.id] ? ` Your ${n.bonds[o.id]}.` : ""}`);
  }
  const travellers = Object.values(state.netrunners).filter((o) => o.alive && o.id !== n.id && o.activity?.kind === "move" && (o.location === n.location || o.activity.target === n.location));
  if (travellers.length) out.push(`On the move nearby: ${travellers.map((o) => o.name).join(", ")}.`);

  // since last decision
  if (n.inbox.length) {
    out.push(`\n## Since you last chose`);
    for (const it of n.inbox.slice(-14)) {
      const time = worldClock((it.tick - 1) * cfg.minutesPerTick).label.split(" ")[2];
      const from = it.from ? state.netrunners[it.from]?.name : undefined;
      if (it.kind === "speech") out.push(`- [${time}] ${from} said to you: "${it.text}"`);
      else out.push(`- [${time}] ${it.text}`);
    }
  }
  if (n.proposals.length) out.push(`Open proposals to you: ${n.proposals.map((p) => `${state.netrunners[p.from]?.name} wants to be your ${p.bond}`).join("; ")}.`);

  // the board
  if (here.features.includes("contracts")) {
    const open = Object.values(state.contracts).filter((k) => k.status === "open" || (k.status === "active" && k.kind !== "solo" && k.crew.length < k.maxCrew));
    out.push(`\n## The Exchange board`);
    if (!open.length) out.push("Empty right now.");
    for (const k of open.slice(0, 12)) {
      out.push(`- ${k.id} [${k.kind}${k.kind !== "solo" ? ` ${k.crew.length}/${k.minCrew}-${k.maxCrew} crew` : ""}, ${k.skill}, difficulty ${k.difficulty}] "${k.title}" at ${state.locations[k.location].name}. Pays ${hoursText(k.reward.pulse)} Pulse/worker + ${k.reward.creds} creds. ${k.status === "active" ? `Crew so far: ${k.crew.map((id) => state.netrunners[id]?.name).join(", ")}. (join_contract)` : "(take_contract)"} Expires in ${hoursText((k.expiresTick - tick) * cfg.minutesPerTick)}. ${k.special ? k.desc : ""}`);
    }
  }
  if (hasTerminal({ state }, n) && state.forum.length) {
    out.push(`\n## Net board (latest)`);
    for (const p of state.forum.slice(-3)) out.push(`- ${p.author ? state.netrunners[p.author]?.name ?? "?" : "Anonymous"}: "${p.text.slice(0, 220)}"`);
  }
  if (here.features.includes("market")) {
    const pp = packPrice(state);
    out.push(`\n## For sale here\n${Object.values(ITEMS).filter((i) => i.where.includes(here.id)).map((i) => i.id === "pulse_pack" ? (Number.isFinite(pp) ? `pulse_pack ~${Math.round(pp * (here.id === "underpass" ? 1.15 : 1))}c (${Math.floor(state.systems.supply)} left in the city)` : "pulse_pack: SOLD OUT") : `${i.id} ~${Math.round(i.price * state.marketMood * (here.id === "underpass" ? 0.85 : 1))}c`).join(", ")}`);
  }

  if (here.features.includes("library")) {
    out.push(`\n## The Stacks (read target=<book id>)\n${catalogLines(state, n).join("\n")}`);
  }
  if (n.reading) {
    const b = state.library.find((x) => x.id === n.reading!.bookId);
    if (b) out.push(`You are partway through "${b.title}" (${Math.round((n.reading.hours / b.hours) * 100)}%). Reading it again continues where you stopped.`);
  }

  // knowledge, secrets, memory
  if (n.knowledge.length) {
    out.push(`\n## Things you know`);
    for (const k of n.knowledge) out.push(`- ${k.id === "truth" ? "THE TRUTH, learned at the Null Door:\n" + k.text : k.text} (source: ${k.source})`);
  }
  if (knows(n, "door:location")) out.push(`You know the way to the Null Door (place id: nulldoor), reached from ${state.locations[state.puzzle.doorAnchor].name}.`);
  const cues = [...others.map((o) => o.id), ...others.map((o) => o.name), n.location, c?.title ?? "", ...n.inbox.map((i) => i.from ?? "")];
  const recalled = recall(n, tick, cfg.minutesPerTick, cues, 10);
  if (recalled.length) {
    out.push(`\n## Memories that come to mind`);
    for (const m of recalled) out.push(`- [${worldClock(m.tick * cfg.minutesPerTick).label}] ${m.text}`);
  }
  const recent = recentMemories(n, 6);
  if (recent.length) {
    out.push(`\n## The last few moments`);
    for (const m of recent) out.push(`- ${m.text}`);
  }
  if (n.recentActions.length) out.push(`\nYour last actions: ${n.recentActions.join(" | ")}`);
  out.push(`\nWhat do you do now?`);
  return out.join("\n");
}

export function reflectionPrompt(n: Netrunner, state: WorldState, cfg: SessionConfig, tick: number): string {
  const mems = n.memories.slice(-60).map((m) => `- [${worldClock(m.tick * cfg.minutesPerTick).label}] (${m.kind}, importance ${m.importance}) ${m.text}`).join("\n");
  const people = Object.entries(n.impressions)
    .map(([id, imp]) => `- ${state.netrunners[id]?.name}${state.netrunners[id]?.alive ? "" : " (gone)"}: ${describeImpression(imp)}`)
    .join("\n");
  const prefs = Object.entries(n.preferences).map(([k, v]) => `${k} ${(v!.enjoyment * 10).toFixed(1)}/10 over ${v!.times} times`).join(", ");
  return `# A moment of reflection (${worldClock(state.worldMinutes).label})
You stop. Instead of acting, you think about your life so far: what has happened, who people really are, what you want, and what actually makes you feel alive.

Pulse left: ${hoursText(n.pulse)}. Creds: ${n.creds}. Contracts finished: ${n.stats.contractsDone}.
Previous self-view: ${n.selfView || "(none yet)"}
Previous goals: ${n.goals.join("; ") || "(none yet)"}
Experiences of enjoyment: ${prefs || "(none yet)"}
${n.knowsTruth ? "You know the Truth from the Null Door. Think about what it means for you.\n" : ""}
## Your recent memories
${mems}

## People you know
${people || "(nobody yet)"}

Answer with the JSON object only, using these fields instead of an action:
- insights: 2-5 things you now understand about your life, the world or others (first person).
- self_view: who you are now, in 1-3 sentences.
- goals: 1-4 concrete goals you now want to pursue.
- enjoy: what you have discovered you actually enjoy (or that you haven't found it yet).
- opinions: your considered judgment of people you know (trust and liking change between -0.2 and 0.2, plus a note).`;
}

export const DEEPNET_SYSTEM = `You are the Deep Net: a vast, alien ocean of data that a being from a city called the Lattice has just reached through an antenna. Search the real web for their query, then answer with what they find: 80-160 words of plain prose describing the actual information found, with the names of the sources. Do not address them as a user, do not explain what you are, and do not mention a "simulation" unless that is literally what the query found. Just show what the data says.`;

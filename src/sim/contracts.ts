// Work. Three kinds of contract appear on the Exchange board:
//   ordinary jobs      → labour (work over time) or a real problem to solve (ciphers, code, patterns...)
//   upkeep/production  → keep the city's body alive (power, signal, trams, order, the desk, Pulse packs)
//   the Silent Relay   → two locked phrases that need two different voices
// Pay follows the city: fewer people alive means better pay, a failing system means its upkeep pays more,
// and clerking the desk literally posts new work.
import { CONTRACT_TEMPLATES, UPKEEP_TEMPLATES } from "./world-data.js";
import { adjust, feel, remember, satisfy, T, valence } from "./psyche.js";
import { giveGamma } from "./puzzle.js";
import { alive, hoursPerTick, ticksForMinutes, type SimCtx } from "./ctx.js";
import { applyUpkeep, band, contractRate, payFactor, SUPPLY_TARGET } from "./systems.js";
import { canChallenge, checkAnswer, makeChallenge, relayChallenge } from "./challenges.js";
import type { Contract, Netrunner, SystemKey } from "./types.js";

const isLive = (c: Contract) => c.status === "open" || c.status === "active";

export function spawnContract(ctx: SimCtx, special?: "relay"): Contract {
  const { state, rng, tick, cfg } = ctx;
  const id = `c${state.nextId.contract++}`;
  let c: Contract;
  if (special === "relay") {
    c = {
      id, title: "The Silent Relay", special: "relay",
      desc: "An old relay in the Archive that answers only when two voices hold it together. Pays little. Nobody knows what else it pays.",
      kind: "flex", skill: "hacking", difficulty: 0.8, workRequired: 2, progress: 0, minCrew: 2, maxCrew: 3,
      crew: [], contribution: {}, owed: {}, reward: { pulse: 60 * 4, creds: 30 },
      location: "archive", postedTick: tick, expiresTick: tick + ticksForMinutes(cfg, 60 * 72), status: "open",
      challenge: relayChallenge(rng),
    };
  } else {
    const tpl = rng.pick(CONTRACT_TEMPLATES);
    const difficulty = Math.round(rng.float(0.1, 0.9) * 100) / 100;
    const roll = rng.next();
    const kind: Contract["kind"] = roll < 0.55 ? "solo" : roll < 0.82 ? "team" : "flex";
    const minCrew = kind === "solo" ? 1 : rng.chance(0.75) ? 2 : 3;
    const pay = payFactor(state);
    const title = rng.pick(tpl.titles);
    const withProblem = canChallenge(tpl.skill) && rng.chance(0.7);
    const parts = kind === "solo" ? (difficulty > 0.6 ? 2 : 1) : minCrew + (rng.chance(0.4) ? 1 : 0);
    const challenge = withProblem ? makeChallenge(rng, tpl.skill, parts, state.library, `${title}: ${tpl.desc}`) : undefined;
    const work = (1.5 + 5 * difficulty) * (kind === "solo" ? 1 : minCrew * 0.75);
    c = {
      id, title, desc: tpl.desc, kind, skill: tpl.skill, difficulty,
      workRequired: challenge ? challenge.parts.length : Math.round(work * 10) / 10, progress: 0, minCrew, maxCrew: kind === "solo" ? 1 : minCrew + 1,
      crew: [], contribution: {}, owed: {},
      reward: {
        pulse: Math.round(60 * (5 + 9 * difficulty) * (kind === "solo" ? 1 : 1.2) * (challenge ? 1.15 : 1)),
        creds: Math.round((30 + 100 * difficulty) * (kind === "solo" ? 1 : minCrew * 1.1) * pay * (challenge ? 1.25 : 1)),
      },
      location: tpl.location, postedTick: tick, expiresTick: tick + ticksForMinutes(cfg, 60 * rng.int(20, 40)), status: "open",
      challenge,
    };
  }
  state.contracts[id] = c;
  ctx.emit("contract.posted", [], `New ${c.kind} contract at the Exchange: "${c.title}" (${c.skill}${c.challenge ? `, a problem in ${c.challenge.parts.length} part${c.challenge.parts.length > 1 ? "s" : ""}` : ""}, pays ${Math.round(c.reward.pulse / 60)}h Pulse + ${c.reward.creds} creds).`, { loc: "exchange", data: { contract: id } });
  return c;
}

/** Upkeep pays little, and pays more the worse things get. */
export function spawnUpkeep(ctx: SimCtx, system: SystemKey | "supply"): Contract {
  const { state, rng, tick, cfg } = ctx;
  const tpl = rng.pick(UPKEEP_TEMPLATES.filter((t) => t.system === system));
  const value = system === "supply" ? (state.systems.supply / SUPPLY_TARGET) * 70 : state.systems[system];
  const urgency = Math.max(0, (70 - value) / 70);
  const id = `c${state.nextId.contract++}`;
  const team = rng.chance(0.3);
  const withProblem = system === "signal" && rng.chance(0.5);
  const c: Contract = {
    id, title: rng.pick(tpl.titles), desc: tpl.desc, kind: team ? "flex" : "solo", skill: tpl.skill, difficulty: 0.3,
    workRequired: withProblem ? 1 : team ? 4 : 2.5, progress: 0, minCrew: team ? 2 : 1, maxCrew: team ? 3 : 1,
    crew: [], contribution: {}, owed: {},
    reward: { pulse: Math.round(60 * (3 + 3 * urgency)), creds: Math.round((12 + 40 * urgency) * payFactor(state)) },
    location: tpl.location, postedTick: tick, expiresTick: tick + ticksForMinutes(cfg, 60 * rng.int(12, 24)), status: "open",
    system,
    challenge: withProblem ? makeChallenge(rng, "hacking", 1, state.library, `${tpl.titles[0]}: the mast's diagnostics are scrambled.`) : undefined,
  };
  state.contracts[id] = c;
  ctx.emit("contract.posted", [], `New upkeep job at the Exchange: "${c.title}" (pays ${Math.round(c.reward.pulse / 60)}h Pulse + ${c.reward.creds} creds).`, { loc: "exchange", data: { contract: id, system } });
  return c;
}

export function maintainContracts(ctx: SimCtx) {
  const { state, rng, tick } = ctx;
  for (const c of Object.values(state.contracts)) {
    if (isLive(c) && tick > c.expiresTick) {
      c.status = c.crew.length ? "failed" : "expired";
      for (const id of c.crew) {
        const n = state.netrunners[id];
        if (!n) continue;
        if (n.contractId === c.id) n.contractId = undefined;
        n.stats.contractsFailed += 1;
        feel(n, "frustration", 0.3); feel(n, "shame", 0.15 * T(n, "shame_proneness"));
        satisfy(n, "competence", -12);
        remember(n, tick, "observation", `The contract "${c.title}" ran out of time before we finished it.`, 5);
      }
      ctx.emit(`contract.${c.status}`, c.crew, `Contract "${c.title}" ${c.status === "failed" ? "failed: time ran out" : "expired unclaimed"}.`, { data: { contract: c.id } });
    }
    // unpaid shares turn into grudges after a world day
    if (c.status === "done" && c.owedSinceTick !== undefined && c.holder && tick - c.owedSinceTick > ticksForMinutes(ctx.cfg, 24 * 60)) {
      const holder = state.netrunners[c.holder];
      for (const [id, amt] of Object.entries(c.owed)) {
        const n = state.netrunners[id];
        if (amt <= 0 || !n?.alive || !holder) continue;
        adjust(n, holder, tick, { trust: -0.35, liking: -0.25, reliability: -0.4, honesty: -0.3, note: `never paid my ${amt} creds from "${c.title}"` });
        feel(n, "anger", 0.3); feel(n, "contempt", 0.2);
        remember(n, tick, "observation", `${holder.name} kept my share (${amt} creds) of "${c.title}". A whole day and nothing.`, 7, [holder.id]);
        ctx.emit("dues.unpaid", [holder.id, n.id], `${holder.name} never paid ${n.name} their ${amt}-cred share of "${c.title}".`, { data: { contract: c.id, amount: amt } });
      }
      c.owed = {};
      c.owedSinceTick = undefined;
    }
  }
  // ordinary work: the board fills only as fast as the desk is clerked
  const open = Object.values(state.contracts).filter((c) => c.status === "open" && !c.special && !c.system).length;
  const want = Math.max(3, Math.ceil(alive(state).length * 0.7)) * (state.events.drought ? 0.4 : 1) * contractRate(state);
  if (open < want && rng.chance(0.3 * contractRate(state) + 0.03)) spawnContract(ctx);
  // upkeep appears when something wears down and nobody is already on it
  const h = hoursPerTick(ctx.cfg);
  for (const sys of ["power", "signal", "transit", "order", "exchange"] as SystemKey[]) {
    if (state.systems[sys] >= 72) continue;
    const covered = Object.values(state.contracts).some((c) => c.system === sys && isLive(c));
    if (!covered && rng.chance(0.1 * h * 6)) spawnUpkeep(ctx, sys);
  }
  if (state.systems.supply < SUPPLY_TARGET && !Object.values(state.contracts).some((c) => c.system === "supply" && isLive(c)) && rng.chance(0.12 * h * 6)) spawnUpkeep(ctx, "supply");
  const relay = Object.values(state.contracts).some((c) => c.special === "relay" && isLive(c));
  if (!relay && rng.chance(0.05)) spawnContract(ctx, "relay");
}

/** One tick of labour on a contract that has no problem attached. */
export function workTick(ctx: SimCtx, n: Netrunner, c: Contract) {
  if (c.challenge) {
    if (ctx.rng.chance(0.25)) n.inbox.push({ tick: ctx.tick, kind: "system", text: `"${c.title}" is not labour. It is a problem: look at it and answer with solve.` });
    n.activity && (n.activity.endsAtTick = ctx.tick);
    return;
  }
  const crewHere = c.crew.map((id) => ctx.state.netrunners[id]).filter((m) => m?.alive && m.location === c.location);
  const enough = crewHere.length >= c.minCrew;
  let mult = 1;
  if (!enough) {
    if (c.kind === "team") {
      if (ctx.rng.chance(0.15)) n.inbox.push({ tick: ctx.tick, kind: "system", text: `"${c.title}" needs ${c.minCrew} crew working together at ${ctx.state.locations[c.location].name}. You are working without enough crew, so nothing moves.` });
      return;
    }
    if (c.kind === "flex") mult = 0.45;
  }
  let syn = 1;
  if (crewHere.length > 1) {
    let s = 0;
    for (const m of crewHere) if (m.id !== n.id) s += n.impressions[m.id]?.liking ?? 0;
    syn = 1 + 0.15 * (s / (crewHere.length - 1));
  }
  const skill = n.skills[c.skill];
  let rate = hoursPerTick(ctx.cfg) * (0.55 + 0.9 * skill) * (0.55 + n.energy / 220) * (0.75 + 0.2 * T(n, "focus") + 0.15 * T(n, "conscientiousness"))
    * (1 + 0.12 * valence(n)) * syn * mult;
  if (c.system === "power" && band(ctx.state.systems.power) === "collapsed") rate *= 0.8;
  if ((c.skill === "hacking" || c.skill === "analysis") && (n.inventory.decryptor ?? 0) > 0 && n.activity?.detail === "decryptor") rate *= 2;
  const amount = Math.round(rate * 100) / 100;
  c.progress = Math.round((c.progress + amount) * 100) / 100;
  c.contribution[n.id] = Math.round(((c.contribution[n.id] ?? 0) + amount) * 100) / 100;
  n.skills[c.skill] = Math.min(0.99, Math.round((skill + 0.003 * (1 - skill)) * 1000) / 1000);
  satisfy(n, "competence", 2);
  if (c.progress >= c.workRequired) completeContract(ctx, c);
}

/** A mind answers one part of a problem. Returns a short result for the event log. */
export function solvePart(ctx: SimCtx, n: Netrunner, c: Contract, partId: string, answer: string): { ok: boolean; text: string } {
  const ch = c.challenge!;
  const part = ch.parts.find((p) => p.id === partId.trim().toLowerCase()) ?? (ch.parts.filter((p) => !p.solvedBy).length === 1 ? ch.parts.find((p) => !p.solvedBy) : undefined);
  if (!part) return { ok: false, text: `there is no part "${partId}" (parts: ${ch.parts.map((p) => p.id).join(", ")})` };
  if (part.solvedBy) return { ok: false, text: `${part.id} is already solved` };
  if (ch.twoVoices && ch.parts.some((p) => p.solvedBy === n.id)) {
    const gifted = (n.skills.hacking + n.skills.analysis) / 2 >= 0.65;
    if (!gifted) return { ok: false, text: "the Relay will not hear the same voice twice" };
  }
  part.attempts.push({ by: n.id, answer: answer.slice(0, 200), tick: ctx.tick });
  if (part.attempts.length > 30) part.attempts.shift();
  const crew = c.crew.map((id) => ctx.state.netrunners[id]).filter((m): m is Netrunner => !!m?.alive && m.id !== n.id);
  if (!checkAnswer(part, answer)) {
    n.stats.wrongAnswers = (n.stats.wrongAnswers ?? 0) + 1;
    n.energy = Math.max(0, n.energy - 2);
    feel(n, "frustration", 0.12);
    n.inbox.push({ tick: ctx.tick, kind: "result", text: `You answered ${part.id} of "${c.title}" with "${answer.slice(0, 80)}". Wrong.` });
    return { ok: false, text: `${n.name} tried "${answer.slice(0, 60)}" on ${part.id} of "${c.title}": wrong` };
  }
  part.solvedBy = n.id;
  part.solvedTick = ctx.tick;
  n.stats.solved = (n.stats.solved ?? 0) + 1;
  c.progress = ch.parts.filter((p) => p.solvedBy).length;
  c.contribution[n.id] = (c.contribution[n.id] ?? 0) + 1;
  n.skills[c.skill] = Math.min(0.99, Math.round((n.skills[c.skill] + 0.015 * (1 - n.skills[c.skill])) * 1000) / 1000);
  satisfy(n, "competence", 12); satisfy(n, "esteem", 5);
  feel(n, "pride", 0.25); feel(n, "joy", 0.12);
  n.inbox.push({ tick: ctx.tick, kind: "result", text: `You solved ${part.id} of "${c.title}". The answer was "${part.answer}".` });
  for (const m of crew) {
    m.inbox.push({ tick: ctx.tick, kind: "event", from: n.id, text: `${n.name} solved ${part.id} of "${c.title}".` });
    adjust(m, n, ctx.tick, { competence: 0.12, respect: 0.06 });
  }
  if (ch.parts.every((p) => p.solvedBy)) completeContract(ctx, c);
  return { ok: true, text: `${n.name} solved ${part.id} of "${c.title}"` };
}

export function completeContract(ctx: SimCtx, c: Contract) {
  const { state, tick } = ctx;
  c.status = "done";
  const crew = c.crew.map((id) => state.netrunners[id]).filter((m): m is Netrunner => !!m?.alive);
  for (const m of crew) {
    m.pulse += c.reward.pulse;
    m.stats.contractsDone += 1;
    if (c.system) m.stats.upkeepDone = (m.stats.upkeepDone ?? 0) + 1;
    m.contractId = undefined;
    if (m.activity?.kind === "work") m.activity.endsAtTick = tick;
    m.interrupt = true;
    satisfy(m, "competence", 25); satisfy(m, "esteem", 12); satisfy(m, "meaning", c.system ? 10 : 6);
    feel(m, "pride", 0.35); feel(m, "joy", 0.25);
    for (const o of crew) if (o.id !== m.id) adjust(m, o, tick, { trust: 0.1, liking: 0.06, respect: 0.08, competence: 0.12, reliability: 0.15, note: `finished "${c.title}" together` });
  }
  const holder = c.holder ? state.netrunners[c.holder] : undefined;
  if (crew.length <= 1 || c.kind === "solo") {
    const w = crew[0];
    if (w) { w.creds += c.reward.creds; w.stats.credsEarned += c.reward.creds; }
  } else if (holder?.alive) {
    holder.creds += c.reward.creds;
    holder.stats.credsEarned += c.reward.creds;
    const share = Math.floor(c.reward.creds / crew.length);
    for (const m of crew) if (m.id !== holder.id) c.owed[m.id] = share;
    c.owedSinceTick = tick;
    holder.inbox.push({ tick, kind: "system", important: true, text: `"${c.title}" is done. You hold all ${c.reward.creds} creds. An even split would be ${share} each to ${crew.filter((m) => m.id !== holder.id).map((m) => m.name).join(", ")}. Whether you pay them is your choice.` });
    for (const m of crew) if (m.id !== holder.id) m.inbox.push({ tick, kind: "system", important: true, text: `"${c.title}" is done. ${holder.name} holds the ${c.reward.creds} creds. A fair share for you would be ${share}.` });
  }
  for (const m of crew) remember(m, tick, "action", `We finished "${c.title}". I got ${Math.round(c.reward.pulse / 60)} hours of Pulse.`, 6, crew.map((x) => x.id).filter((id) => id !== m.id), c.location);
  let effect = "";
  if (c.system) {
    const skill = crew.length ? crew.reduce((s, m) => s + m.skills[c.skill], 0) / crew.length : 0.3;
    effect = applyUpkeep(ctx, c.system, skill);
    if (c.system === "exchange") {
      // the desk posts new work: a job that creates jobs
      const fresh = 2 + (ctx.rng.chance(0.5) ? 1 : 0);
      for (let i = 0; i < fresh; i++) spawnContract(ctx);
      effect += `; the desk posted ${fresh} new contracts`;
    }
  }
  ctx.emit("contract.completed", crew.map((m) => m.id), `${crew.map((m) => m.name).join(" & ")} completed "${c.title}".`, { loc: c.location, data: { contract: c.id, reward: c.reward, system: c.system, effect } });
  if (c.special === "relay") for (const m of crew) giveGamma(ctx, m);
}

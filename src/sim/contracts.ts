import { CONTRACT_TEMPLATES } from "./world-data.js";
import { adjust, feel, remember, satisfy, T, valence } from "./psyche.js";
import { giveGamma } from "./puzzle.js";
import { alive, hoursPerTick, ticksForMinutes, type SimCtx } from "./ctx.js";
import type { Contract, Netrunner } from "./types.js";

export function spawnContract(ctx: SimCtx, special?: "relay"): Contract {
  const { state, rng, tick, cfg } = ctx;
  const id = `c${state.nextId.contract++}`;
  let c: Contract;
  if (special === "relay") {
    c = {
      id, title: "The Silent Relay", special: "relay",
      desc: "An old relay in the Archive that answers only when two voices hold it together. Pays little. Nobody knows what else it pays.",
      kind: "flex", skill: "hacking", difficulty: 0.8, workRequired: 14, progress: 0, minCrew: 2, maxCrew: 3,
      crew: [], contribution: {}, owed: {}, reward: { pulse: 60 * 4, creds: 30 },
      location: "archive", postedTick: tick, expiresTick: tick + ticksForMinutes(cfg, 60 * 72), status: "open",
    };
  } else {
    const tpl = rng.pick(CONTRACT_TEMPLATES);
    const difficulty = Math.round(rng.float(0.1, 0.9) * 100) / 100;
    const roll = rng.next();
    const kind: Contract["kind"] = roll < 0.55 ? "solo" : roll < 0.82 ? "team" : "flex";
    const minCrew = kind === "solo" ? 1 : rng.chance(0.75) ? 2 : 3;
    const work = (1.5 + 5 * difficulty) * (kind === "solo" ? 1 : minCrew * 0.75);
    c = {
      id, title: rng.pick(tpl.titles), desc: tpl.desc, kind, skill: tpl.skill, difficulty,
      workRequired: Math.round(work * 10) / 10, progress: 0, minCrew, maxCrew: kind === "solo" ? 1 : minCrew + 1,
      crew: [], contribution: {}, owed: {},
      reward: {
        pulse: Math.round(60 * (5 + 9 * difficulty) * (kind === "solo" ? 1 : 1.2)),
        creds: Math.round((30 + 100 * difficulty) * (kind === "solo" ? 1 : minCrew * 1.1)),
      },
      location: tpl.location, postedTick: tick, expiresTick: tick + ticksForMinutes(cfg, 60 * rng.int(20, 40)), status: "open",
    };
  }
  state.contracts[id] = c;
  ctx.emit("contract.posted", [], `New ${c.kind} contract at the Exchange: "${c.title}" (${c.skill}, pays ${Math.round(c.reward.pulse / 60)}h Pulse + ${c.reward.creds} creds).`, { loc: "exchange", data: { contract: id } });
  return c;
}

export function maintainContracts(ctx: SimCtx) {
  const { state, rng, tick } = ctx;
  for (const c of Object.values(state.contracts)) {
    if ((c.status === "open" || c.status === "active") && tick > c.expiresTick) {
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
  // keep the board alive; scarcity when a drought hits
  const open = Object.values(state.contracts).filter((c) => c.status === "open" && !c.special).length;
  const want = Math.max(3, Math.ceil(alive(state).length * 0.7)) * (state.events.drought ? 0.4 : 1);
  if (open < want && rng.chance(0.3)) spawnContract(ctx);
  const relay = Object.values(state.contracts).some((c) => c.special === "relay" && (c.status === "open" || c.status === "active"));
  if (!relay && rng.chance(0.05)) spawnContract(ctx, "relay");
}

/** One tick of work by one netrunner on their contract. */
export function workTick(ctx: SimCtx, n: Netrunner, c: Contract) {
  const crewHere = c.crew.map((id) => ctx.state.netrunners[id]).filter((m) => m?.alive && m.location === c.location);
  const enough = crewHere.length >= c.minCrew;
  let mult = 1;
  if (!enough) {
    if (c.kind === "team") {
      if (ctx.rng.chance(0.15)) n.inbox.push({ tick: ctx.tick, kind: "system", text: `"${c.title}" needs ${c.minCrew} crew working together at ${ctx.state.locations[c.location].name}. You are working without enough crew, so nothing moves.` });
      return;
    }
    if (c.special === "relay") {
      const gifted = (n.skills.hacking + n.skills.analysis) / 2 >= 0.6;
      if (!gifted) {
        if (ctx.rng.chance(0.2)) n.inbox.push({ tick: ctx.tick, kind: "system", text: `The Silent Relay does not answer one voice. Not yours, anyway.` });
        return;
      }
      mult = 0.35;
    } else if (c.kind === "flex") mult = 0.45;
  }
  // synergy: crews who like each other work better
  let syn = 1;
  if (crewHere.length > 1) {
    let s = 0;
    for (const m of crewHere) if (m.id !== n.id) s += n.impressions[m.id]?.liking ?? 0;
    syn = 1 + 0.15 * (s / (crewHere.length - 1));
  }
  const skill = n.skills[c.skill];
  let rate = hoursPerTick(ctx.cfg) * (0.55 + 0.9 * skill) * (0.55 + n.energy / 220) * (0.75 + 0.2 * T(n, "focus") + 0.15 * T(n, "conscientiousness"))
    * (1 + 0.12 * valence(n)) * syn * mult;
  if ((c.skill === "hacking" || c.skill === "analysis") && (n.inventory.decryptor ?? 0) > 0 && n.activity?.detail === "decryptor") rate *= 2;
  const amount = Math.round(rate * 100) / 100;
  c.progress = Math.round((c.progress + amount) * 100) / 100;
  c.contribution[n.id] = Math.round(((c.contribution[n.id] ?? 0) + amount) * 100) / 100;
  n.skills[c.skill] = Math.min(0.99, Math.round((skill + 0.003 * (1 - skill)) * 1000) / 1000);
  satisfy(n, "competence", 2);
  if (c.progress >= c.workRequired) completeContract(ctx, c);
}

export function completeContract(ctx: SimCtx, c: Contract) {
  const { state, tick } = ctx;
  c.status = "done";
  const crew = c.crew.map((id) => state.netrunners[id]).filter((m): m is Netrunner => !!m?.alive);
  for (const m of crew) {
    m.pulse += c.reward.pulse;
    m.stats.contractsDone += 1;
    m.contractId = undefined;
    if (m.activity?.kind === "work") m.activity.endsAtTick = tick; // free to decide
    m.interrupt = true;
    satisfy(m, "competence", 25); satisfy(m, "esteem", 12); satisfy(m, "meaning", 6);
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
  ctx.emit("contract.completed", crew.map((m) => m.id), `${crew.map((m) => m.name).join(" & ")} completed "${c.title}".`, { loc: c.location, data: { contract: c.id, reward: c.reward } });
  if (c.special === "relay") {
    for (const m of crew) giveGamma(ctx, m);
  }
}

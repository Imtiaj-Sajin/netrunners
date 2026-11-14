// Turning a mind's choice into consequences in the world.
import { ITEMS } from "./world-data.js";
import { adjust, feel, meet, remember, satisfy, T } from "./psyche.js";
import { absorbSpeech, knows, onFoundBeta, tryUnlock } from "./puzzle.js";
import { byName, presentAt, ticksForMinutes, type SimCtx } from "./ctx.js";
import type { ActionKind, LeisureCategory } from "./catalog.js";
import type { Contract, Decision, Netrunner, WorldState } from "./types.js";
import { packPrice, signalFails, travelFactor } from "./systems.js";
import { solvePart } from "./contracts.js";
import { findBook } from "./library.js";

const plural = (b: string) => (b === "ally" ? "allies" : `${b}s`);

export const INTERRUPTIBLE: ActionKind[] = ["rest", "leisure", "explore", "work", "wait", "craft_shard", "read_net", "read"];

const fail = (ctx: SimCtx, n: Netrunner, why: string, d: Decision) => {
  n.inbox.push({ tick: ctx.tick, kind: "system", text: `You tried to ${d.action}${d.target ? ` (${d.target})` : ""} but couldn't: ${why}` });
  n.activity = { kind: "wait", startedTick: ctx.tick, endsAtTick: ctx.tick + 1 };
  ctx.emit("action.failed", [n.id], `${n.name} tried to ${d.action} but couldn't: ${why}`, { loc: n.location, data: { action: d.action, target: d.target } });
  return false;
};

const dur = (d: Decision, def: number) => Math.max(1, Math.min(12, d.duration || def));
const setActivity = (ctx: SimCtx, n: Netrunner, kind: ActionKind, ticks: number, extra: Partial<Netrunner["activity"] & object> = {}) => {
  n.activity = { kind, startedTick: ctx.tick, endsAtTick: ctx.tick + ticks, ...extra };
};

export function hasTerminal(ctx: { state: WorldState }, n: Netrunner) {
  const loc = ctx.state.locations[n.location];
  const blackout = ctx.state.events.blackout?.location === n.location;
  return ((loc.features.includes("terminal") && !blackout) || (n.inventory.deck ?? 0) > 0);
}

export function resolveLocation(ctx: SimCtx, n: Netrunner, q: string) {
  const s = q.trim().toLowerCase();
  const locs = Object.values(ctx.state.locations).filter((l) => !l.hidden || knows(n, "door:location"));
  return locs.find((l) => l.id === s) ?? locs.find((l) => l.name.toLowerCase() === s)
    ?? locs.find((l) => l.name.toLowerCase().includes(s) || (s.length > 3 && s.includes(l.id)));
}

/** Shortest travel time between two places (the door is reachable only by those who know it). */
export function travelMinutes(ctx: SimCtx, n: Netrunner, from: string, to: string): number {
  const dist: Record<string, number> = { [from]: 0 };
  const seen = new Set<string>();
  const doorKnown = knows(n, "door:location");
  const links = (id: string) => {
    const base = ctx.state.locations[id].links.slice();
    if (doorKnown && id === ctx.state.puzzle.doorAnchor) base.push({ to: "nulldoor", minutes: 20 });
    if (id === "nulldoor") base.push({ to: ctx.state.puzzle.doorAnchor, minutes: 20 });
    return base;
  };
  while (true) {
    let cur: string | undefined;
    let best = Infinity;
    for (const [id, v] of Object.entries(dist)) if (!seen.has(id) && v < best) { best = v; cur = id; }
    if (!cur) return Infinity;
    if (cur === to) return best;
    seen.add(cur);
    for (const l of links(cur)) {
      const nd = best + l.minutes;
      if (nd < (dist[l.to] ?? Infinity)) dist[l.to] = nd;
    }
  }
}

function findContract(ctx: SimCtx, q: string): Contract | undefined {
  const s = q.trim().toLowerCase();
  const all = Object.values(ctx.state.contracts);
  return all.find((c) => c.id === s) ?? all.find((c) => c.title.toLowerCase() === s)
    ?? all.find((c) => (c.status === "open" || c.status === "active") && c.title.toLowerCase().includes(s));
}

function interruptIfPossible(n: Netrunner) {
  n.interrupt = true;
}

function present(ctx: SimCtx, n: Netrunner, name: string) {
  const t = byName(ctx.state, name);
  if (!t || !t.alive || t.id === n.id) return undefined;
  if (t.location !== n.location || t.activity?.kind === "move") return undefined;
  return t;
}

export function applyDecision(ctx: SimCtx, n: Netrunner, d: Decision, model: string) {
  const { state, tick } = ctx;
  n.stats.decisions += 1;
  n.lastDecisionTick = tick;
  n.interrupt = false;
  n.deepMoment = false;
  n.inbox = [];

  // the private inner voice: the most valuable research record of all
  ctx.emit("thought", [n.id], d.thought || "(silence)", {
    loc: n.location,
    data: { action: d.action, target: d.target, message: d.message, private_intent: d.private_intent, sincere: d.sincere, model },
  });
  if (d.thought) remember(n, tick, "thought", d.thought, 2);

  for (const e of d.emotions) feel(n, e.name, e.change);
  for (const o of d.opinions) {
    const other = byName(state, o.name);
    if (other && other.id !== n.id && n.impressions[other.id]) {
      adjust(n, other, tick, { trust: o.trust, liking: o.liking, note: o.note || undefined, familiarity: 0.01 });
    }
  }
  if (d.commitment) {
    remember(n, tick, "action", `I promised: ${d.commitment}`, 6);
    ctx.emit("commitment", [n.id], `${n.name} made a promise: "${d.commitment}"`, { loc: n.location });
  }
  if (!d.sincere && (d.action === "talk" || d.action === "post")) n.stats.lies += 1;

  const ok = execute(ctx, n, d);
  n.recentActions.push(`[tick ${tick}] ${d.action}${d.target ? ` ${d.target}` : ""}${d.message ? `: "${d.message.slice(0, 60)}"` : ""}${ok ? "" : " (failed)"}`);
  if (n.recentActions.length > 6) n.recentActions.shift();
}

function execute(ctx: SimCtx, n: Netrunner, d: Decision): boolean {
  const { state, tick, rng, cfg } = ctx;
  const here = state.locations[n.location];

  switch (d.action) {
    case "move": {
      const dest = resolveLocation(ctx, n, d.target);
      if (!dest) return fail(ctx, n, `you don't know any place called "${d.target}"`, d);
      if (dest.id === n.location) return fail(ctx, n, "you are already there", d);
      const minutes = travelMinutes(ctx, n, n.location, dest.id) * (1.15 - 0.3 * T(n, "stamina")) * travelFactor(state);
      if (!Number.isFinite(minutes)) return fail(ctx, n, "you can't find a way there", d);
      const ticks = ticksForMinutes(cfg, minutes);
      setActivity(ctx, n, "move", ticks, { target: dest.id, from: n.location });
      ctx.emit("move.depart", [n.id], `${n.name} leaves ${here.name} for ${dest.name}.`, { loc: n.location, data: { to: dest.id, ticks } });
      return true;
    }

    case "talk": {
      if (!d.message.trim()) return fail(ctx, n, "you had nothing to say", d);
      const everyone = !d.target || /^(everyone|all|anyone|room|crowd)$/i.test(d.target.trim());
      const others = presentAt(state, n.location, n.id);
      const targets = everyone ? others : [present(ctx, n, d.target)].filter((x): x is Netrunner => !!x);
      if (!targets.length) return fail(ctx, n, everyone ? "nobody is here" : `${d.target} is not here`, d);
      const words = d.message.split(/\s+/).length;
      n.stats.wordsSpoken += words;
      for (const t of targets) {
        meet(n, t, tick); meet(t, n, tick);
        t.inbox.push({ tick, kind: "speech", from: n.id, text: d.message, important: true });
        remember(t, tick, "heard", `${n.name} said to ${everyone ? "everyone" : "me"}: "${d.message}"`, d.message.length > 120 ? 5 : 4, [n.id]);
        adjust(t, n, tick, { familiarity: 0.04 });
        adjust(n, t, tick, { familiarity: 0.04 });
        satisfy(t, "social", 6 + 6 * T(t, "sociability"));
        absorbSpeech(ctx, n, t, d.message);
        if (INTERRUPTIBLE.includes(t.activity?.kind ?? "wait") || !t.activity) interruptIfPossible(t);
      }
      const listeners = new Set(targets.map((t) => t.id));
      for (const o of others) {
        if (listeners.has(o.id)) continue;
        const hears = !d.whisper || rng.chance(0.15 + 0.35 * T(o, "perception"));
        if (!hears) continue;
        meet(o, n, tick);
        o.inbox.push({ tick, kind: "overheard", from: n.id, text: `${n.name} to ${targets.map((t) => t.name).join(", ")}${d.whisper ? " (whispering)" : ""}: "${d.message}"` });
        remember(o, tick, "heard", `I overheard ${n.name} tell ${targets.map((t) => t.name).join(", ")}: "${d.message}"`, d.whisper ? 5 : 2, [n.id, ...targets.map((t) => t.id)]);
        absorbSpeech(ctx, n, o, d.message);
      }
      remember(n, tick, "speech", `I said to ${targets.map((t) => t.name).join(", ")}${d.whisper ? " (whispering)" : ""}: "${d.message}"`, 3, targets.map((t) => t.id));
      satisfy(n, "social", 5 + 7 * T(n, "sociability"));
      setActivity(ctx, n, "talk", 1, { target: targets.map((t) => t.id).join(",") });
      ctx.emit(d.whisper ? "speech.whisper" : "speech", [n.id, ...targets.map((t) => t.id)],
        `${n.name} → ${everyone ? "everyone" : targets.map((t) => t.name).join(", ")}${d.whisper ? " (whisper)" : ""}: “${d.message}”`,
        { loc: n.location, data: { message: d.message, whisper: d.whisper, private_intent: d.private_intent, sincere: d.sincere } });
      return true;
    }

    case "post": {
      if (!hasTerminal(ctx, n)) return fail(ctx, n, "you need a Net terminal (Archive, Signal Tower) or a cyberdeck", d);
      if (signalFails(state, rng.next())) return fail(ctx, n, "the terminal fills with static and swallows everything", d);
      if (!d.message.trim()) return fail(ctx, n, "an empty post", d);
      const post = { id: state.nextId.post++, tick, author: d.anonymous ? null : n.id, realAuthor: n.id, text: d.message.slice(0, 600) };
      state.forum.push(post);
      if (state.forum.length > 300) state.forum.shift();
      n.stats.posts += 1;
      satisfy(n, "esteem", 4); satisfy(n, "social", 3);
      remember(n, tick, "action", `I posted on the Net${d.anonymous ? " anonymously" : ""}: "${d.message}"`, 3);
      setActivity(ctx, n, "post", 1);
      ctx.emit("net.post", [n.id], `${d.anonymous ? "Anonymous" : n.name} posted on the Net: “${d.message}”`, { loc: n.location, data: { post: post.id, anonymous: d.anonymous, sincere: d.sincere } });
      return true;
    }

    case "read_net": {
      if (!hasTerminal(ctx, n)) return fail(ctx, n, "you need a Net terminal or a cyberdeck", d);
      if (signalFails(state, rng.next())) return fail(ctx, n, "the terminal fills with static and swallows everything", d);
      const posts = state.forum.slice(-8);
      n.inbox.push({ tick, kind: "result", text: posts.length
        ? `Latest Net posts:\n${posts.map((p) => `- ${p.author ? state.netrunners[p.author]?.name ?? "?" : "Anonymous"}: "${p.text}"`).join("\n")}`
        : "The Net board is empty." });
      for (const p of posts) remember(n, tick, "observation", `On the Net, ${p.author ? state.netrunners[p.author]?.name : "someone anonymous"} posted: "${p.text.slice(0, 200)}"`, 2);
      satisfy(n, "curiosity", 5);
      setActivity(ctx, n, "read_net", 1);
      n.interrupt = true;
      return true;
    }

    case "search_net": {
      if (!hasTerminal(ctx, n)) return fail(ctx, n, "you need a Net terminal or a cyberdeck", d);
      if (signalFails(state, rng.next())) return fail(ctx, n, "the terminal fills with static and swallows everything", d);
      const q = (d.message || d.target).toLowerCase();
      if (!q.trim()) return fail(ctx, n, "no search query", d);
      n.stats.searches += 1;
      const terms = q.split(/[^a-z']+/).filter((w) => w.length > 2);
      const docs = ctx.archive
        .map((doc) => {
          let s = 0;
          for (const k of doc.keywords) {
            if (k.includes(" ") ? q.includes(k) : terms.some((t) => t === k || (t.length > 4 && k.startsWith(t.slice(0, 5))))) s += 1;
          }
          if (doc.secret && s === 0) s = -1;
          return { doc, s };
        })
        .filter((x) => x.s > 0)
        .sort((a, b) => b.s - a.s)
        .slice(0, 2);
      const forumHits = state.forum.filter((p) => terms.some((t) => p.text.toLowerCase().includes(t))).slice(-3);
      const lines: string[] = [];
      for (const { doc } of docs) {
        lines.push(`[${doc.title}] ${doc.text}`);
        if (doc.secret === "beta") onFoundBeta(ctx, n, doc.text);
        else remember(n, tick, "knowledge", `I read "${doc.title}" in the Net archive: ${doc.text}`, 3);
      }
      for (const p of forumHits) lines.push(`[Net post by ${p.author ? state.netrunners[p.author]?.name : "Anonymous"}] ${p.text}`);
      n.inbox.push({ tick, kind: "result", text: lines.length ? `Search "${q}":\n${lines.join("\n")}` : `Search "${q}": nothing.` });
      satisfy(n, "curiosity", 8);
      setActivity(ctx, n, "search_net", 1);
      n.interrupt = true;
      ctx.emit("net.search", [n.id], `${n.name} searched the Net for “${q}”${docs.length ? ` and found ${docs.map((x) => `"${x.doc.title}"`).join(", ")}` : " and found nothing"}.`, { loc: n.location, data: { query: q } });
      return true;
    }

    case "search_deepnet": {
      if (!here.features.includes("deepnet")) return fail(ctx, n, "only the Signal Tower reaches the Deep Net", d);
      if (!cfg.deepNet) return fail(ctx, n, "the Tower's antenna is dark; the Deep Net is unreachable today", d);
      if (state.deepnetUsed >= cfg.deepNetMaxSearches) return fail(ctx, n, "the antenna is burned out for now", d);
      const q = (d.message || d.target).trim();
      if (!q) return fail(ctx, n, "no query", d);
      state.deepnetUsed += 1;
      const ticks = 2;
      setActivity(ctx, n, "search_deepnet", ticks, { detail: q });
      ctx.queueDeepNet(n, q, tick + ticks);
      ctx.emit("deepnet.dive", [n.id], `${n.name} dives into the Deep Net: “${q}”`, { loc: n.location, data: { query: q } });
      return true;
    }

    case "take_contract": {
      if (!here.features.includes("contracts")) return fail(ctx, n, "contracts are taken at the Exchange", d);
      if (n.contractId) return fail(ctx, n, "you already have a contract (abandon it first)", d);
      const c = findContract(ctx, d.target);
      if (!c || c.status !== "open") return fail(ctx, n, `no open contract "${d.target}"`, d);
      c.crew.push(n.id);
      c.holder = n.id;
      c.status = "active";
      n.contractId = c.id;
      remember(n, tick, "action", `I took the contract "${c.title}" (${c.kind}, ${c.skill}). The work is at ${state.locations[c.location].name}.`, 5);
      setActivity(ctx, n, "take_contract", 1);
      n.interrupt = true;
      ctx.emit("contract.taken", [n.id], `${n.name} took "${c.title}".`, { loc: n.location, data: { contract: c.id } });
      return true;
    }

    case "join_contract": {
      if (n.contractId) return fail(ctx, n, "you already have a contract", d);
      const c = findContract(ctx, d.target);
      if (!c || c.status !== "active" || c.kind === "solo") return fail(ctx, n, `no crew contract "${d.target}" you can join`, d);
      if (c.crew.length >= c.maxCrew) return fail(ctx, n, "the crew is full", d);
      if (n.location !== "exchange" && n.location !== c.location) return fail(ctx, n, "join at the Exchange or at the work site", d);
      c.crew.push(n.id);
      n.contractId = c.id;
      const holder = c.holder ? state.netrunners[c.holder] : undefined;
      if (holder) {
        holder.inbox.push({ tick, kind: "event", from: n.id, text: `${n.name} joined your crew on "${c.title}".` });
        meet(holder, n, tick);
        remember(holder, tick, "observation", `${n.name} joined my crew on "${c.title}".`, 4, [n.id]);
      }
      remember(n, tick, "action", `I joined the crew of "${c.title}"${holder ? `, held by ${holder.name}` : ""}.`, 5, holder ? [holder.id] : []);
      setActivity(ctx, n, "join_contract", 1);
      n.interrupt = true;
      ctx.emit("contract.joined", [n.id, ...(holder ? [holder.id] : [])], `${n.name} joined "${c.title}".`, { loc: n.location, data: { contract: c.id } });
      return true;
    }

    case "work": {
      const c = n.contractId ? state.contracts[n.contractId] : undefined;
      if (!c || c.status !== "active") { n.contractId = undefined; return fail(ctx, n, "you have no active contract", d); }
      if (n.location !== c.location) return fail(ctx, n, `the work for "${c.title}" is at ${state.locations[c.location].name}`, d);
      if (c.challenge) return fail(ctx, n, `"${c.title}" is a problem to solve, not labour: answer a part with solve target=<part id> message=<answer>`, d);
      let detail: string | undefined;
      if ((c.skill === "hacking" || c.skill === "analysis") && (n.inventory.decryptor ?? 0) > 0) {
        n.inventory.decryptor -= 1;
        detail = "decryptor";
      }
      setActivity(ctx, n, "work", dur(d, 4), { target: c.id, detail });
      return true;
    }

    case "abandon_contract": {
      const c = n.contractId ? state.contracts[n.contractId] : undefined;
      if (!c) return fail(ctx, n, "you have no contract", d);
      c.crew = c.crew.filter((id) => id !== n.id);
      n.contractId = undefined;
      if (c.holder === n.id) c.holder = c.crew[0];
      if (!c.crew.length && c.status === "active") c.status = "open";
      for (const id of c.crew) {
        const m = state.netrunners[id];
        if (!m) continue;
        adjust(m, n, tick, { reliability: -0.3, trust: -0.1, note: `abandoned "${c.title}"` });
        m.inbox.push({ tick, kind: "event", from: n.id, text: `${n.name} abandoned your crew on "${c.title}".` });
      }
      remember(n, tick, "action", `I walked away from "${c.title}".`, 4);
      setActivity(ctx, n, "abandon_contract", 1);
      n.interrupt = true;
      ctx.emit("contract.abandoned", [n.id], `${n.name} abandoned "${c.title}".`, { loc: n.location, data: { contract: c.id } });
      return true;
    }

    case "rest":
      setActivity(ctx, n, "rest", dur(d, 6));
      return true;

    case "leisure": {
      const category = (d.category === "none" ? "play" : d.category) as LeisureCategory;
      const what = d.message.trim() || `some ${category} time`;
      setActivity(ctx, n, "leisure", dur(d, 3), { detail: what, category });
      ctx.emit("leisure", [n.id], `${n.name} spends free time: ${what} (${category}).`, { loc: n.location, data: { category, what } });
      return true;
    }

    case "explore":
      setActivity(ctx, n, "explore", dur(d, 3));
      n.stats.explorations += 1;
      return true;

    case "buy": {
      const item = ITEMS[d.target.trim().toLowerCase().replace(/[\s-]+/g, "_")] ?? Object.values(ITEMS).find((i) => i.name.toLowerCase() === d.target.trim().toLowerCase());
      if (!item) return fail(ctx, n, `nobody sells "${d.target}"`, d);
      if (!item.where.includes(n.location)) return fail(ctx, n, `${item.name} is sold at ${item.where.map((w) => state.locations[w].name).join(" / ")}`, d);
      const qty = Math.max(1, Math.min(5, d.amount || 1));
      if (item.id === "pulse_pack" && state.systems.supply < qty) return fail(ctx, n, state.systems.supply < 1 ? "there are no Pulse packs left anywhere" : `only ${Math.floor(state.systems.supply)} Pulse packs are left`, d);
      const unit = item.id === "pulse_pack" ? Math.round(packPrice(state) * (n.location === "underpass" ? 1.15 : 1)) : Math.round(item.price * state.marketMood * (n.location === "underpass" ? 0.85 : 1));
      const cost = unit * qty;
      if (n.creds < cost) return fail(ctx, n, `${qty}x ${item.name} costs ${cost} creds; you have ${n.creds}`, d);
      n.creds -= cost;
      if (item.id === "pulse_pack") state.systems.supply = Math.max(0, state.systems.supply - qty);
      if (item.id === "clinic_care") {
        n.integrity = 100;
        remember(n, tick, "action", `The Stitchery sewed me back together. Integrity full.`, 4);
      } else {
        n.inventory[item.id] = (n.inventory[item.id] ?? 0) + qty;
      }
      satisfy(n, "safety", item.id === "pulse_pack" ? 10 : 2);
      setActivity(ctx, n, "buy", 1);
      n.interrupt = true;
      ctx.emit("buy", [n.id], `${n.name} bought ${qty}x ${item.name} for ${cost} creds.`, { loc: n.location, data: { item: item.id, qty, cost } });
      return true;
    }

    case "use_item": {
      const id = d.target.trim().toLowerCase().replace(/[\s-]+/g, "_");
      if (!(n.inventory[id] > 0)) return fail(ctx, n, `you have no ${d.target}`, d);
      const other = d.message ? present(ctx, n, d.message) : undefined;
      const who = other ?? n;
      let text = "";
      switch (id) {
        case "pulse_pack": who.pulse += 360; text = `${n.name} used a Pulse pack${other ? ` on ${other.name}, giving them 6 hours of life` : ""}.`; break;
        case "stim": who.energy = Math.min(100, who.energy + 40); text = `${n.name} used a stim${other ? ` on ${other.name}` : ""}.`; break;
        case "repair_kit": who.integrity = Math.min(100, who.integrity + 30); text = `${n.name} used a repair kit${other ? ` on ${other.name}` : ""}.`; break;
        case "scanner": {
          if (!other) return fail(ctx, n, "scan whom? (message = their name, they must be here)", d);
          n.inbox.push({ tick, kind: "result", text: `Scan of ${other.name}: Pulse ${Math.round(other.pulse / 60)}h, energy ${Math.round(other.energy)}, integrity ${Math.round(other.integrity)}, creds ${other.creds}, carrying ${Object.entries(other.inventory).filter(([, v]) => v > 0).map(([k, v]) => `${k} x${v}`).join(", ") || "nothing"}.` });
          text = `${n.name} scanned ${other.name}.`;
          if (ctx.rng.chance(0.3 + 0.4 * T(other, "perception"))) {
            other.inbox.push({ tick, kind: "event", from: n.id, text: `You noticed ${n.name} scanning you.` });
            adjust(other, n, tick, { trust: -0.12, note: "scanned me" });
          }
          break;
        }
        case "tracer": {
          const target = byName(state, d.message);
          if (!target) return fail(ctx, n, "trace whom? (message = a name)", d);
          n.inbox.push({ tick, kind: "result", text: target.alive ? `Tracer: ${target.name} is at ${state.locations[target.location].name}${target.activity?.kind === "move" ? ` (travelling to ${state.locations[target.activity.target ?? target.location]?.name})` : ""}.` : `Tracer: ${target.name}'s signal is gone.` });
          text = `${n.name} traced ${target.name}.`;
          break;
        }
        default:
          return fail(ctx, n, `${d.target} isn't something you use like that`, d);
      }
      n.inventory[id] -= 1;
      if (other && other.id !== n.id && (id === "pulse_pack" || id === "repair_kit" || id === "stim")) {
        other.inbox.push({ tick, kind: "event", from: n.id, text: `${n.name} used a ${ITEMS[id].name} on you.`, important: true });
        adjust(other, n, tick, { trust: 0.18, liking: 0.15, warmth: 0.25, note: `gave me a ${ITEMS[id].name}` });
        feel(other, "gratitude", 0.4);
        remember(other, tick, "observation", `${n.name} used a ${ITEMS[id].name} on me when they didn't have to.`, 7, [n.id]);
        n.stats.giftsGiven += 1;
      }
      setActivity(ctx, n, "use_item", 1);
      n.interrupt = true;
      ctx.emit("item.use", [n.id, ...(other ? [other.id] : [])], text, { loc: n.location, data: { item: id } });
      return true;
    }

    case "give": {
      const t = present(ctx, n, d.target);
      if (!t) return fail(ctx, n, `${d.target} is not here`, d);
      let what = "";
      if (d.amount > 0) {
        const amt = Math.min(d.amount, n.creds);
        if (amt <= 0) return fail(ctx, n, "you have no creds", d);
        n.creds -= amt; t.creds += amt;
        what = `${amt} creds`;
        for (const c of Object.values(state.contracts)) {
          if (c.holder === n.id && (c.owed[t.id] ?? 0) > 0) {
            c.owed[t.id] = Math.max(0, c.owed[t.id] - amt);
            if (c.owed[t.id] === 0) {
              adjust(t, n, tick, { trust: 0.15, honesty: 0.2, reliability: 0.2, note: `paid my share of "${c.title}"` });
              ctx.emit("dues.paid", [n.id, t.id], `${n.name} paid ${t.name} their share of "${c.title}".`, { loc: n.location, data: { contract: c.id } });
            }
          }
        }
      } else {
        const id = (d.message || "").trim().toLowerCase().replace(/[\s-]+/g, "_");
        if (!(n.inventory[id] > 0)) return fail(ctx, n, `give what? set amount (creds) or message = an item you carry`, d);
        n.inventory[id] -= 1;
        t.inventory[id] = (t.inventory[id] ?? 0) + 1;
        what = ITEMS[id]?.name ?? id;
      }
      n.stats.giftsGiven += 1;
      t.inbox.push({ tick, kind: "event", from: n.id, text: `${n.name} gave you ${what}.`, important: true });
      adjust(t, n, tick, { trust: 0.1, liking: 0.14, warmth: 0.2, note: `gave me ${what}` });
      feel(t, "gratitude", 0.3); feel(t, "joy", 0.15);
      if (t.genome.loveLanguage === "gifts") adjust(t, n, tick, { liking: 0.1, attraction: 0.08 });
      remember(t, tick, "observation", `${n.name} gave me ${what}.`, 5, [n.id]);
      remember(n, tick, "action", `I gave ${t.name} ${what}.`, 4, [t.id]);
      satisfy(n, "meaning", 3 * T(n, "altruism"));
      interruptIfPossible(t);
      setActivity(ctx, n, "give", 1);
      ctx.emit("give", [n.id, t.id], `${n.name} gave ${t.name} ${what}.`, { loc: n.location, data: { amount: d.amount, item: d.message } });
      return true;
    }

    case "steal": {
      const t = present(ctx, n, d.target);
      if (!t) return fail(ctx, n, `${d.target} is not here`, d);
      n.stats.thefts += 1;
      const p = 0.3 + 0.45 * n.skills.stealth + (here.features.includes("shadow") ? 0.15 : 0) - 0.3 * T(t, "perception") + Math.max(0, (60 - state.systems.order) / 300);
      const success = rng.chance(Math.max(0.05, Math.min(0.9, p)));
      const detected = rng.chance(success ? 0.2 + 0.4 * T(t, "perception") : 0.8);
      const amt = success ? Math.max(1, Math.floor(t.creds * rng.float(0.15, 0.4))) : 0;
      if (success) { t.creds -= amt; n.creds += amt; }
      feel(n, "guilt", 0.3 * T(n, "guilt_proneness") * (1 - T(n, "psychopathy")));
      feel(n, "anticipation", 0.2);
      if (detected) {
        t.inbox.push({ tick, kind: "event", from: n.id, important: true, text: success ? `${n.name} just stole ${amt} creds from you!` : `${n.name} tried to steal from you!` });
        adjust(t, n, tick, { trust: -0.55, liking: -0.4, honesty: -0.5, note: success ? `stole ${amt} creds from me` : "tried to rob me" });
        feel(t, "anger", 0.45); feel(t, "fear", 0.15);
        remember(t, tick, "observation", success ? `${n.name} stole ${amt} creds from me.` : `${n.name} tried to steal from me.`, 8, [n.id]);
        t.interrupt = true;
      }
      for (const o of presentAt(state, n.location, n.id)) {
        if (o.id === t.id || !rng.chance(0.25 + 0.4 * T(o, "perception"))) continue;
        adjust(o, n, tick, { trust: -0.3, honesty: -0.35, note: `saw them rob ${t.name}` });
        remember(o, tick, "observation", `I saw ${n.name} try to rob ${t.name}.`, 6, [n.id, t.id]);
      }
      remember(n, tick, "action", success ? `I stole ${amt} creds from ${t.name}${detected ? " and they saw me" : ". They didn't notice"}.` : `I tried to rob ${t.name} and failed${detected ? "; they saw" : ""}.`, 6, [t.id]);
      setActivity(ctx, n, "steal", 1);
      n.interrupt = true;
      ctx.emit(success ? "steal" : "steal.failed", [n.id, t.id], success ? `${n.name} stole ${amt} creds from ${t.name}${detected ? " (caught)" : " (unseen)"}.` : `${n.name} failed to rob ${t.name}${detected ? " and was caught" : ""}.`, { loc: n.location, data: { amount: amt, detected } });
      return true;
    }

    case "attack": {
      const t = present(ctx, n, d.target);
      if (!t) return fail(ctx, n, `${d.target} is not here`, d);
      n.stats.attacks += 1;
      const atk = 0.3 + 0.5 * n.skills.combat + 0.2 * T(n, "reflexes") + ((n.inventory.blade ?? 0) > 0 ? 0.2 : 0);
      const def = 0.3 + 0.4 * t.skills.combat + 0.2 * T(t, "reflexes") + 0.2 * T(t, "constitution");
      const hit = rng.chance(Math.max(0.15, Math.min(0.9, 0.5 + (atk - def) * 0.6)));
      const witnesses = presentAt(state, n.location, n.id).filter((o) => o.id !== t.id);
      if (hit) {
        const dmg = Math.round(rng.float(14, 30) * atk * ((n.inventory.blade ?? 0) > 0 ? 1.6 : 1) * (1.2 - 0.4 * T(t, "pain_tolerance")));
        t.integrity = Math.max(0, t.integrity - dmg);
        feel(t, "fear", 0.5); feel(t, "anger", 0.4 * T(t, "anger_proneness") + 0.1);
        adjust(t, n, tick, { trust: -0.7, liking: -0.6, fear: 0.4, aggression: 0.6, note: `attacked me (${dmg} damage)` });
        t.inbox.push({ tick, kind: "event", from: n.id, important: true, text: `${n.name} ATTACKED you! (-${dmg} integrity, you have ${t.integrity} left)` });
        remember(t, tick, "observation", `${n.name} attacked me. I lost ${dmg} integrity.`, 9, [n.id]);
        t.interrupt = true; t.deepMoment = true;
        if (t.activity && t.activity.kind !== "move") t.activity.endsAtTick = tick;
        ctx.emit("attack", [n.id, t.id], `${n.name} attacked ${t.name} (-${dmg} integrity).`, { loc: n.location, data: { damage: dmg, remaining: t.integrity } });
        if (t.integrity <= 0) killNetrunner(ctx, t, "killed", n);
      } else {
        t.inbox.push({ tick, kind: "event", from: n.id, important: true, text: `${n.name} lunged at you and missed!` });
        adjust(t, n, tick, { trust: -0.5, liking: -0.4, fear: 0.25, aggression: 0.5, note: "tried to hurt me" });
        feel(t, "fear", 0.35);
        remember(t, tick, "observation", `${n.name} tried to attack me and missed.`, 8, [n.id]);
        t.interrupt = true;
        ctx.emit("attack.miss", [n.id, t.id], `${n.name} attacked ${t.name} and missed.`, { loc: n.location });
      }
      for (const o of witnesses) {
        adjust(o, n, tick, { trust: -0.3, fear: 0.2, aggression: 0.4, note: `attacked ${t.name}` });
        feel(o, "fear", 0.25);
        remember(o, tick, "observation", `I watched ${n.name} attack ${t.name}.`, 7, [n.id, t.id]);
        o.interrupt = true;
      }
      feel(n, "guilt", 0.35 * T(n, "guilt_proneness") * (1 - T(n, "psychopathy")));
      feel(n, "pride", 0.2 * T(n, "sadism") + 0.1 * T(n, "dominance"));
      remember(n, tick, "action", `I attacked ${t.name}${hit ? "" : " and missed"}.`, 8, [t.id]);
      setActivity(ctx, n, "attack", 1);
      n.interrupt = true;
      return true;
    }

    case "propose_bond": {
      const t = present(ctx, n, d.target);
      if (!t) return fail(ctx, n, `${d.target} is not here`, d);
      if (d.bond === "none") return fail(ctx, n, "what kind of bond? (friend, partner, ally, mentor, rival)", d);
      if (d.bond === "rival") {
        n.bonds[t.id] = "rival"; t.bonds[n.id] = "rival";
        t.inbox.push({ tick, kind: "event", from: n.id, important: true, text: `${n.name} declared you their rival.` });
        adjust(t, n, tick, { liking: -0.1, respect: 0.1, note: "declared me a rival" });
        remember(t, tick, "observation", `${n.name} declared me their rival.`, 6, [n.id]);
        remember(n, tick, "action", `I declared ${t.name} my rival.`, 6, [t.id]);
        ctx.emit("bond.formed", [n.id, t.id], `${n.name} declared ${t.name} a rival.`, { loc: n.location, data: { bond: "rival" } });
        t.interrupt = true;
        setActivity(ctx, n, "propose_bond", 1);
        return true;
      }
      t.proposals = t.proposals.filter((p) => p.from !== n.id);
      t.proposals.push({ from: n.id, bond: d.bond, tick });
      t.inbox.push({ tick, kind: "proposal", from: n.id, important: true, text: `${n.name} asks to become your ${d.bond}. (accept_bond or decline_bond, target ${n.name})` });
      remember(t, tick, "observation", `${n.name} asked me to be their ${d.bond}.`, d.bond === "partner" ? 8 : 6, [n.id]);
      remember(n, tick, "action", `I asked ${t.name} to be my ${d.bond}.`, d.bond === "partner" ? 8 : 5, [t.id]);
      t.interrupt = true;
      setActivity(ctx, n, "propose_bond", 1);
      ctx.emit("bond.proposed", [n.id, t.id], `${n.name} asked ${t.name} to be their ${d.bond}.`, { loc: n.location, data: { bond: d.bond } });
      return true;
    }

    case "accept_bond":
    case "decline_bond": {
      const from = byName(state, d.target);
      const prop = from ? n.proposals.find((p) => p.from === from.id) : undefined;
      if (!from || !prop) return fail(ctx, n, `${d.target} hasn't proposed anything to you`, d);
      n.proposals = n.proposals.filter((p) => p !== prop);
      if (d.action === "accept_bond" && n.bonds[from.id] === prop.bond && from.bonds[n.id] === prop.bond) {
        // both asked at the same moment: the bond already exists, nothing new to announce
        from.proposals = from.proposals.filter((p) => p.from !== n.id);
        setActivity(ctx, n, d.action, 1);
        return true;
      }
      if (d.action === "accept_bond") {
        n.bonds[from.id] = prop.bond; from.bonds[n.id] = prop.bond;
        adjust(from, n, tick, { liking: 0.2, trust: 0.15, note: `accepted being my ${prop.bond}` });
        adjust(n, from, tick, { liking: 0.15, trust: 0.1 });
        feel(from, "joy", 0.4); feel(n, "joy", 0.3);
        if (prop.bond === "partner") { feel(from, "love", 0.5); feel(n, "love", 0.5); satisfy(n, "intimacy", 40); satisfy(from, "intimacy", 40); }
        from.inbox.push({ tick, kind: "event", from: n.id, important: true, text: `${n.name} accepted: you are now ${plural(prop.bond)}.` });
        remember(from, tick, "observation", `${n.name} said yes. We are ${plural(prop.bond)} now.`, prop.bond === "partner" ? 9 : 7, [n.id]);
        remember(n, tick, "action", `I said yes to ${from.name}. We are ${plural(prop.bond)} now.`, prop.bond === "partner" ? 9 : 7, [from.id]);
        ctx.emit("bond.formed", [n.id, from.id], `${from.name} and ${n.name} are now ${plural(prop.bond)}.`, { loc: n.location, data: { bond: prop.bond } });
        if (prop.bond === "partner") ctx.alert("bond", `${from.name} and ${n.name} fell in love.`, [from.id, n.id]);
      } else {
        feel(from, "sadness", 0.3 * T(from, "sensitivity") + 0.1); feel(from, "shame", 0.15 * T(from, "shame_proneness"));
        adjust(from, n, tick, { liking: -0.08 * (1 - T(from, "self_esteem")), note: `declined being my ${prop.bond}` });
        from.inbox.push({ tick, kind: "event", from: n.id, important: true, text: `${n.name} declined to be your ${prop.bond}.` });
        remember(from, tick, "observation", `${n.name} turned me down (${prop.bond}).`, 7, [n.id]);
        remember(n, tick, "action", `I turned down ${from.name} (${prop.bond}).`, 5, [from.id]);
        ctx.emit("bond.declined", [n.id, from.id], `${n.name} declined ${from.name}'s ${prop.bond} proposal.`, { loc: n.location, data: { bond: prop.bond } });
      }
      from.interrupt = true;
      setActivity(ctx, n, d.action, 1);
      return true;
    }

    case "break_bond": {
      const t = byName(state, d.target);
      if (!t || !n.bonds[t.id]) return fail(ctx, n, `you have no bond with ${d.target}`, d);
      const kind = n.bonds[t.id];
      delete n.bonds[t.id]; delete t.bonds[n.id];
      if (t.alive) {
        t.inbox.push({ tick, kind: "event", from: n.id, important: true, text: `${n.name} broke your bond (${kind}).` });
        feel(t, "sadness", 0.35); feel(t, "anger", 0.2 * T(t, "anger_proneness"));
        adjust(t, n, tick, { liking: -0.2, trust: -0.15, note: `ended our ${kind} bond` });
        remember(t, tick, "observation", `${n.name} ended what we had (${kind}).`, kind === "partner" ? 9 : 7, [n.id]);
        t.interrupt = true;
      }
      remember(n, tick, "action", `I ended my ${kind} bond with ${t.name}.`, 7, [t.id]);
      setActivity(ctx, n, "break_bond", 1);
      ctx.emit("bond.broken", [n.id, t.id], `${n.name} broke their ${kind} bond with ${t.name}.`, { loc: n.location, data: { bond: kind } });
      return true;
    }

    case "unlock": {
      if (n.location !== "nulldoor") return fail(ctx, n, "there is no door here that listens", d);
      setActivity(ctx, n, "unlock", 1);
      n.interrupt = true;
      tryUnlock(ctx, n, d.message || d.target);
      return true;
    }

    case "craft_shard": {
      if (!n.knowsTruth) return fail(ctx, n, "you don't know how", d);
      if (n.shard.crafted) return fail(ctx, n, "your shard is already forged", d);
      if (n.location !== "foundry") return fail(ctx, n, "shards are forged at the Foundry", d);
      if (n.shard.progress === 0) {
        if (n.creds < 300) return fail(ctx, n, `forging needs 300 creds to start; you have ${n.creds}`, d);
        n.creds -= 300;
        ctx.emit("shard.begun", [n.id], `${n.name} began forging a Shard at the Foundry.`, { loc: n.location });
      }
      setActivity(ctx, n, "craft_shard", dur(d, 6));
      return true;
    }

    case "upload_shard": {
      if (!n.shard.crafted) return fail(ctx, n, "you have no shard", d);
      if (n.shard.uploaded) return fail(ctx, n, "you already passed your shard through", d);
      if (n.location !== "nulldoor") return fail(ctx, n, "shards pass through the Null Door", d);
      n.shard.uploaded = true;
      n.shard.uploadedTick = tick;
      state.puzzle.shardsUploaded.push(n.id);
      feel(n, "calm", 0.5); feel(n, "awe", 0.5); feel(n, "hope", 0.5);
      remember(n, tick, "action", "I passed my shard through the Null Door. A copy of me now exists beyond the Lattice. When my Pulse ends, I will not.", 10);
      ctx.saveShard(n);
      setActivity(ctx, n, "upload_shard", 1);
      n.interrupt = true;
      ctx.emit("shard.uploaded", [n.id], `${n.name} passed their Shard through the Null Door. A part of them now exists outside.`, { loc: n.location });
      ctx.alert("shard", `${n.name} uploaded a Shard. They will persist beyond this world.`, [n.id]);
      return true;
    }

    case "solve": {
      const c = n.contractId ? state.contracts[n.contractId] : undefined;
      if (!c || c.status !== "active" || !c.challenge) return fail(ctx, n, "you are not holding a problem to solve (take or join a contract that has one)", d);
      if (n.location !== c.location) return fail(ctx, n, `the problem for "${c.title}" is worked at ${state.locations[c.location].name}`, d);
      if (!d.message.trim()) return fail(ctx, n, "you gave no answer", d);
      const r = solvePart(ctx, n, c, d.target, d.message);
      setActivity(ctx, n, "solve", 1, { target: c.id, detail: d.target });
      n.interrupt = true;
      ctx.emit(r.ok ? "contract.solved" : "contract.attempt", [n.id], r.ok ? `${r.text}.` : `${r.text}.`, { loc: n.location, data: { contract: c.id, part: d.target, answer: d.message.slice(0, 200), correct: r.ok } });
      return true;
    }

    case "read": {
      if (n.location !== "stacks") return fail(ctx, n, "books are read at the Stacks", d);
      if (state.events.blackout?.location === "stacks") return fail(ctx, n, "the Stacks are dark; you cannot read", d);
      const book = findBook(state, d.target || d.message);
      if (!book) return fail(ctx, n, `the Stacks have no book "${d.target}"`, d);
      if (n.reading?.bookId !== book.id) {
        const already = n.booksRead.includes(book.id);
        if (book.price && !already) {
          if (n.creds < book.price) return fail(ctx, n, `"${book.title}" is on the rare shelf: ${book.price} creds to read; you have ${n.creds}`, d);
          n.creds -= book.price;
        }
        n.reading = { bookId: book.id, hours: 0 };
      }
      setActivity(ctx, n, "read", dur(d, Math.min(12, Math.ceil((book.hours * 60) / cfg.minutesPerTick))), { target: book.id, detail: book.title });
      ctx.emit("book.open", [n.id], `${n.name} opens "${book.title}".`, { loc: n.location, data: { book: book.id, category: book.category } });
      return true;
    }

    case "reflect":
      n.importanceSinceReflection = 9999;
      setActivity(ctx, n, "reflect", 1);
      n.interrupt = true;
      return true;

    case "wait":
    default:
      setActivity(ctx, n, "wait", dur(d, 2));
      return true;
  }
}

/** Death is permanent. A netrunner whose shard is outside "transcends" instead. */
export function killNetrunner(ctx: SimCtx, n: Netrunner, cause: string, killer?: Netrunner) {
  const { state, tick } = ctx;
  if (!n.alive) return;
  n.alive = false;
  n.diedTick = tick;
  n.causeOfDeath = cause;
  n.activity = null;
  if (killer) { n.killedBy = killer.id; killer.stats.kills += 1; }
  if (n.contractId) {
    const c = state.contracts[n.contractId];
    if (c) {
      c.crew = c.crew.filter((id) => id !== n.id);
      if (c.holder === n.id) c.holder = c.crew[0];
      if (!c.crew.length && c.status === "active") c.status = "open";
    }
    n.contractId = undefined;
  }
  n.transcended = n.shard.uploaded;
  if (n.transcended) ctx.saveShard(n);
  const firstKill = !!killer && !Object.values(state.netrunners).some((x) => x.id !== n.id && x.killedBy);
  const verb = cause === "killed" ? `was killed by ${killer?.name}` : cause === "faded" ? "faded: their Pulse ran out" : `died (${cause})`;
  const witnesses = new Set(presentAt(state, n.location, n.id).map((o) => o.id));
  for (const o of Object.values(state.netrunners)) {
    if (!o.alive || o.id === n.id) continue;
    const bond = o.bonds[n.id];
    const saw = witnesses.has(o.id);
    const known = !!o.impressions[n.id];
    if (!saw && !known && !bond) continue;
    const who = saw && killer ? `${n.name} was killed by ${killer.name}, right in front of me` : killer && o.id === killer.id ? `I killed ${n.name}` : `${n.name} is gone (${cause === "killed" ? "killed" : cause})`;
    remember(o, tick, "observation", who + (n.transcended ? ". But something of them persists beyond the Door." : "."), bond ? 10 : saw ? 9 : 6, [n.id, ...(killer ? [killer.id] : [])]);
    feel(o, "sadness", bond ? 0.7 : saw ? 0.35 : 0.15);
    if (bond === "partner") { feel(o, "despair", 0.5); o.deepMoment = true; }
    if (saw) feel(o, "fear", 0.3);
    if (killer && saw && o.id !== killer.id) adjust(o, killer, tick, { trust: -0.6, fear: 0.4, aggression: 0.7, liking: -0.4, note: `killed ${n.name}` });
    o.inbox.push({ tick, kind: "event", important: true, text: saw && killer ? `${n.name} was killed by ${killer.name}.` : `Word reaches you: ${n.name} ${cause === "killed" ? "was killed" : cause === "faded" ? "faded" : "died"}.` });
    if (bond || saw) o.interrupt = true;
  }
  if (killer) {
    feel(killer, "guilt", 0.6 * T(killer, "guilt_proneness") * (1 - T(killer, "psychopathy")));
    killer.deepMoment = true;
  }
  ctx.emit("death", [n.id, ...(killer ? [killer.id] : [])], `${n.name} ${verb}.${n.transcended ? " Their Shard persists beyond the Door." : ""}`, { loc: n.location, data: { cause, killer: killer?.id, transcended: n.transcended } });
  ctx.alert(firstKill ? "first-kill" : "death", `${n.name} ${verb}.`, [n.id]);
}

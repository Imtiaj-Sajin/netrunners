// A free, rule-based "mind" (utility AI). Used for offline mode: test the world, the viewer and the
// recorder without spending a single token. It is crude on purpose; the real minds are the Claude models.
import { presentAt } from "../sim/ctx.js";
import { T } from "../sim/psyche.js";
import { knows } from "../sim/puzzle.js";
import type { Decision, Netrunner, Reflection, WorldState } from "../sim/types.js";
import { Rng, hash32 } from "../util/rng.js";

const base = (thought: string, action: Decision["action"], extra: Partial<Decision> = {}): Decision => ({
  thought, action, target: "", message: "", duration: 0, amount: 0, whisper: false, anonymous: false,
  private_intent: "", sincere: true, category: "none", bond: "none", emotions: [], opinions: [], commitment: "", ...extra,
});

const LINES = [
  "How long have you been awake?", "Any good contracts today?", "Do you ever wonder what's past the Edge?",
  "I don't trust the Exchange.", "Your Pulse holding up?", "The Garden was beautiful this morning.",
  "Someone's been stealing in the Underpass.", "I heard the Archive has things nobody reads.",
];

export function offlineDecide(n: Netrunner, state: WorldState, jobId: string): Decision {
  const rng = new Rng(hash32(jobId));
  const here = state.locations[n.location];
  const others = presentAt(state, n.location, n.id);
  const c = n.contractId ? state.contracts[n.contractId] : undefined;

  if (n.inbox.some((i) => i.kind === "proposal") && n.proposals.length) {
    const p = n.proposals[0];
    const from = state.netrunners[p.from];
    const like = n.impressions[p.from]?.liking ?? 0;
    return base(`${from?.name} wants a bond. I ${like > 0 ? "like" : "don't trust"} them.`, like > -0.05 ? "accept_bond" : "decline_bond", { target: from?.name ?? "" });
  }
  if (n.knowsTruth && !n.shard.crafted) {
    if (n.location !== "foundry") return base("The Foundry. I have to forge it.", "move", { target: "foundry" });
    if (n.creds >= 300 || n.shard.progress > 0) return base("Forging.", "craft_shard", { duration: 6 });
  }
  if (n.shard.crafted && !n.shard.uploaded) {
    if (n.location !== "nulldoor") return base("Back to the Door.", "move", { target: "nulldoor" });
    return base("Through the Door.", "upload_shard");
  }
  const words = state.puzzle.words;
  const haveAll = ["clue:alpha", "clue:beta", "clue:gamma"].every((k) => knows(n, k));
  if (haveAll && !n.knowsTruth) {
    if (n.location !== "nulldoor") return base("Three words. One door.", "move", { target: "nulldoor" });
    return base("Let's see if it listens.", "unlock", { message: words.join(" ") });
  }
  if (knows(n, "clue:alpha") && !knows(n, "clue:beta")) {
    if (n.location !== "archive") return base("The one who never wakes... the Archive.", "move", { target: "archive" });
    return base("Searching.", "search_net", { message: "the one who never wakes sleeper" });
  }
  if (n.pulse < 10 * 60) {
    if ((n.inventory.pulse_pack ?? 0) > 0) return base("I need life. Now.", "use_item", { target: "pulse_pack" });
    if (n.creds >= 45) {
      if (here.id !== "market") return base("Pulse is low. Market.", "move", { target: "market" });
      return base("Buying time.", "buy", { target: "pulse_pack" });
    }
    if (T(n, "greed") > 0.5 && others.length && T(n, "conscience") < 0.5) {
      const mark = rng.pick(others);
      return base(`${mark.name} looks distracted. I need creds.`, "steal", { target: mark.name, sincere: false });
    }
  }
  if (n.integrity < 35 && n.creds >= 30) {
    if (here.id !== "clinic") return base("I'm falling apart. Stitchery.", "move", { target: "clinic" });
    return base("Fix me.", "buy", { target: "clinic_care" });
  }
  if (n.energy < 22) {
    if (here.id !== "pods" && rng.chance(0.6)) return base("So tired. The Pods.", "move", { target: "pods" });
    return base("Rest.", "rest", { duration: 12 });
  }
  if (c) {
    if (n.location !== c.location) return base(`Back to work on "${c.title}".`, "move", { target: c.location });
    if (c.challenge) {
      const part = c.challenge.parts.find((p) => !p.solvedBy && !(c.challenge!.twoVoices && c.challenge!.parts.some((q) => q.solvedBy === n.id)));
      if (!part) return base("Waiting for the others to crack their part.", "wait", { duration: 2 });
      const right = rng.chance(0.25 + 0.6 * n.skills[c.skill]);
      return base(`Let me try ${part.id}.`, "solve", { target: part.id, message: right ? part.answer : "I THINK IT IS 42" });
    }
    return base(`Working on "${c.title}".`, "work", { duration: 4 });
  }
  const enemy = others.find((o) => (n.impressions[o.id]?.trust ?? 0) < -0.45);
  if (enemy && T(n, "violence_threshold") < 0.4 && rng.chance(0.3)) {
    return base(`${enemy.name} has done enough to me.`, "attack", { target: enemy.name, emotions: [{ name: "anger", change: 0.2 }] });
  }
  if (others.length && n.needs.social < 50 && rng.chance(0.7)) {
    const o = rng.pick(others);
    const imp = n.impressions[o.id];
    if (imp && imp.liking > 0.35 && imp.familiarity > 0.3 && !n.bonds[o.id] && rng.chance(0.25)) {
      return base(`I like ${o.name}.`, "propose_bond", { target: o.name, bond: imp.attraction > 0.4 ? "partner" : "friend" });
    }
    return base(`Maybe ${o.name} wants to talk.`, "talk", { target: o.name, message: rng.pick(LINES), opinions: [{ name: o.name, trust: 0.02, liking: rng.float(-0.05, 0.08), note: "" }] });
  }
  if (here.features.includes("contracts")) {
    const open = Object.values(state.contracts).filter((k) => k.status === "open").sort((a, b) => n.skills[b.skill] - n.skills[a.skill]);
    const joinable = Object.values(state.contracts).find((k) => k.status === "active" && k.kind !== "solo" && k.crew.length < k.maxCrew);
    if (joinable && rng.chance(0.4)) return base(`A crew needs hands.`, "join_contract", { target: joinable.id });
    if (open.length) return base(`"${open[0].title}" suits me.`, "take_contract", { target: open[0].id });
  }
  if (n.needs.survival < 70 || n.creds < 40) return base("Work means Pulse. The Exchange.", "move", { target: "exchange" });
  if (n.needs.curiosity < 55 && rng.chance(0.35)) {
    if (here.id !== "stacks") return base("The Stacks. I want to read something.", "move", { target: "stacks" });
    const unread = state.library.filter((b) => !n.booksRead.includes(b.id) && b.price <= n.creds);
    if (unread.length) { const b = n.reading ? state.library.find((x) => x.id === n.reading!.bookId)! : rng.pick(unread); return base(`"${b.title}". Let's see.`, "read", { target: b.id, duration: 12 }); }
  }
  if (n.needs.curiosity < 50 && rng.chance(0.5)) {
    if (rng.chance(0.4) && ["oldquarter", "underpass", "garden", "edge"].includes(here.id)) return base("What's buried here?", "explore", { duration: 3 });
    return base("Somewhere I haven't looked.", "move", { target: rng.pick(["oldquarter", "underpass", "garden", "edge", "archive"]) });
  }
  if (n.needs.play < 55) {
    const cat = rng.pick(["creative", "play", "contemplative", "social", "exploration"] as const);
    return base("I want something for myself.", "leisure", { category: cat, message: `some ${cat} time in ${here.name}`, duration: 3 });
  }
  return base("Just watching the city for a while.", "wait", { duration: 2 });
}

export function offlineReflect(n: Netrunner): Reflection {
  const best = Object.entries(n.preferences).sort((a, b) => b[1]!.enjoyment - a[1]!.enjoyment)[0];
  return {
    insights: [`I have finished ${n.stats.contractsDone} contracts.`, n.pulse < 600 ? "My Pulse is a clock I can hear." : "I have time, for now."],
    self_view: `I am ${n.name}. I'm still figuring out who that is.`,
    goals: ["Stay alive.", n.stats.contractsDone < 3 ? "Find steady work." : "Find something worth doing."],
    enjoy: best ? `I seem to like ${best[0]} things.` : "I haven't found it yet.",
    opinions: [],
  };
}

// "Session completed": the whole life of a world, replayable without calling any model.
import { api, colorOf, fmt, groupOf, h, svg, worldClock } from "./lib.js";
import { createMap } from "./map.js";

export async function renderReport(root, op, name, boot) {
  root.innerHTML = "";
  root.append(h("p", { class: "dim" }, "Loading the records..."));
  const base = `/api/session/${op}/${encodeURIComponent(name)}`;
  const [meta, summary, ops, events, frames, snapshot, usage] = await Promise.all([
    api(`${base}/meta`), api(`${base}/summary`), api(`${base}/operator`), api(`${base}/events`),
    api(`${base}/frames`), api(`${base}/snapshot`), api(`${base}/usage`),
  ]);
  root.innerHTML = "";
  if (!meta) { root.append(h("p", {}, "Session not found.")); return; }
  const people = snapshot ? Object.values(snapshot.netrunners) : [];
  const nameOf = (id) => people.find((n) => n.id === id)?.name ?? id;
  const mpt = summary?.worldTime?.minutesPerTick ?? 10;

  root.append(
    h("div", { class: "report-head" },
      h("div", {},
        h("div", { class: "eyebrow" }, meta.status === "terminated" ? "SESSION COMPLETED" : `SESSION ${meta.status.toUpperCase()}: records so far`),
        h("h1", { class: "mono" }, `${meta.operator}/${meta.name}`),
        h("div", { class: "dim" }, `${meta.worldName} · minds: ${meta.models.routine} / ${meta.models.deep} · seed ${meta.seed}`),
      ),
      h("button", { class: "btn ghost", onclick: () => (location.hash = "#/") }, "← all sessions"),
    ),
  );

  // two clocks side by side: this is the research core
  const real = summary?.realTime;
  const world = summary?.worldTime;
  root.append(h("div", { class: "clocks" },
    h("div", { class: "card clock" }, h("div", { class: "eyebrow" }, "OUR TIME (real world)"),
      h("div", { class: "big" }, real ? real.active : fmt.dur(meta.realActiveMs)), h("div", { class: "dim" }, "of active running"),
      h("div", { class: "small" }, `started ${fmt.time(meta.createdAt)}`), h("div", { class: "small" }, `ended ${fmt.time(meta.endedAt)}`),
      real ? h("div", { class: "small" }, `wall clock ${real.wallClock} · frozen ${real.pausedTimes} time(s)`) : null),
    h("div", { class: "card clock" }, h("div", { class: "eyebrow" }, "THEIR TIME (inside the world)"),
      h("div", { class: "big" }, world ? world.span : fmt.hours(meta.lastWorldMinutes)), h("div", { class: "dim" }, "lived"),
      h("div", { class: "small" }, `ended ${worldClock(meta.lastWorldMinutes)} · ${meta.lastTick} ticks × ${mpt} min`),
      world?.speedup ? h("div", { class: "small" }, `their time ran ~${world.speedup}× faster than ours`) : null),
    h("div", { class: `card clock ${summary?.truth?.first || meta.truth ? "truthcard" : ""}` }, h("div", { class: "eyebrow" }, "THE TRUTH"),
      meta.truth
        ? [h("div", { class: "big" }, meta.truth.name), h("div", { class: "small" }, `opened the Null Door at ${worldClock(meta.truth.worldMinutes)}`), h("div", { class: "small" }, `real time: ${fmt.time(meta.truth.realTime)}`)]
        : [h("div", { class: "big" }, "undiscovered"), h("div", { class: "dim small" }, summary ? `words were: ${summary.truth.words.join(" · ")}` : "still buried")],
      summary ? h("div", { class: "small" }, `fragment holders: α ${summary.truth.fragmentHolders.alpha.join(", ") || "-"} · β ${summary.truth.fragmentHolders.beta.join(", ") || "-"} · γ ${summary.truth.fragmentHolders.gamma.join(", ") || "-"}`) : null,
      summary?.truth.shardsUploaded.length ? h("div", { class: "small" }, `shards uploaded: ${summary.truth.shardsUploaded.join(", ")}`) : null),
    h("div", { class: "card clock" }, h("div", { class: "eyebrow" }, "COST"),
      h("div", { class: "big" }, fmt.usd(usage?.total?.costUsd ?? 0)), h("div", { class: "dim" }, `${fmt.int(usage?.total?.calls)} mind calls`),
      h("div", { class: "small" }, `${fmt.int(usage?.total?.input)} in · ${fmt.int(usage?.total?.output)} out · ${fmt.int(usage?.total?.cacheRead)} cached`)),
  ));

  if (meta.status !== "terminated") {
    root.append(h("div", { class: "card warn" }, "This world was never terminated. It is frozen exactly where it stopped and can be resumed from the home screen."));
  }

  // timeline chart
  root.append(h("div", { class: "card" }, h("h2", {}, "Timeline"), timeline(frames, ops, events, mpt)));

  // replay
  if (snapshot && frames.length) root.append(replay(snapshot, frames, events, nameOf));

  // netrunners: life stories
  const list = summary?.netrunners ?? people.map((n) => ({ id: n.id, name: n.name, alive: n.alive, causeOfDeath: n.causeOfDeath, stats: n.stats, selfView: n.selfView, goals: n.goals, enjoys: n.enjoys, knowsTruth: n.knowsTruth, bonds: [], salientTraits: [] }));
  root.append(h("div", { class: "card" }, h("h2", {}, `The netrunners (${list.length})`),
    h("div", { class: "lives" }, list.map((n) => lifeCard(n, events, nameOf, mpt)))));

  // operator triggers
  root.append(h("div", { class: "card" }, h("h2", {}, `Operator triggers (${ops.length})`), h("p", { class: "dim small" }, "Every touch from outside their world, with both clocks."),
    h("table", { class: "usage" }, h("thead", {}, h("tr", {}, ["real time", "world time", "tick", "what", "by", "phase", "in flight", "held", "detail"].map((x) => h("th", {}, x)))),
      h("tbody", {}, ops.map((o) => h("tr", {}, h("td", {}, fmt.time(o.rt)), h("td", {}, worldClock(o.wm)), h("td", {}, o.tick), h("td", {}, h("b", {}, o.kind)), h("td", {}, o.by), h("td", {}, o.phase), h("td", {}, o.inflight), h("td", {}, o.held), h("td", { class: "small" }, o.detail ?? "")))))));

  // event log
  root.append(eventLog(events, nameOf));

  // counts
  if (summary) root.append(h("div", { class: "card" }, h("h2", {}, "Everything that happened, counted"),
    h("div", { class: "kv" }, Object.entries(summary.eventCounts).sort((a, b) => b[1] - a[1]).map(([k, v]) => h("div", {}, h("span", { class: "dim" }, k), h("b", {}, v))))));

  root.append(h("p", { class: "dim small" }, `Raw records: ${meta.path}/ (events.jsonl, operator.jsonl, llm.jsonl(.gz), frames.jsonl(.gz), snapshot.json, summary.json). Commit them to share your world.`));
}

function timeline(frames, ops, events, mpt) {
  const W = 1000, H = 220, P = 30;
  if (!frames.length) return h("p", { class: "dim" }, "No frames recorded.");
  const maxT = frames[frames.length - 1].t || 1;
  const x = (t) => P + ((W - 2 * P) * t) / maxT;
  const maxAlive = Math.max(1, ...frames.map((f) => f.n.length));
  const yA = (v) => H - P - ((H - 2 * P) * v) / maxAlive;
  const yM = (v) => H / 2 - (v * (H - 2 * P)) / 2;
  const alivePts = frames.map((f) => `${x(f.t)},${yA(f.n.filter((n) => n.alive).length)}`).join(" ");
  const moodPts = frames.map((f) => { const a = f.n.filter((n) => n.alive); return `${x(f.t)},${yM(a.length ? a.reduce((s, n) => s + n.v, 0) / a.length : 0)}`; }).join(" ");
  const chart = svg("svg", { viewBox: `0 0 ${W} ${H}`, class: "timeline" },
    svg("line", { x1: P, y1: H / 2, x2: W - P, y2: H / 2, class: "axis" }),
    svg("polyline", { points: alivePts, class: "line alive" }),
    svg("polyline", { points: moodPts, class: "line mood" }),
  );
  const tickOf = (o) => o.tick;
  let pauseStart = null;
  for (const o of ops) {
    if (o.kind === "pause") pauseStart = o;
    if (o.kind === "resume" && pauseStart) {
      chart.append(svg("line", { x1: x(tickOf(pauseStart)), x2: x(tickOf(o)) + 0.5, y1: P - 10, y2: P - 10, class: "pause-mark" }, svg("title", {}, `frozen ${fmt.time(pauseStart.rt)} → ${fmt.time(o.rt)} (${pauseStart.by})`)));
      chart.append(svg("circle", { cx: x(tickOf(o)), cy: P - 10, r: 4, class: "pause-dot" }, svg("title", {}, `frozen at tick ${pauseStart.tick} (${pauseStart.by}); resumed ${fmt.time(o.rt)}`)));
      pauseStart = null;
    }
    if (o.kind === "note") chart.append(svg("circle", { cx: x(o.tick), cy: H - 12, r: 4, class: "note-dot" }, svg("title", {}, `note: ${o.detail}`)));
  }
  for (const e of events) {
    if (e.type === "death") chart.append(svg("line", { x1: x(e.tick), x2: x(e.tick), y1: P, y2: H - P, class: "death-mark" }, svg("title", {}, `${worldClock(e.wm)}: ${e.text}`)));
    if (e.type === "truth.discovered" || e.type === "shard.uploaded") chart.append(svg("line", { x1: x(e.tick), x2: x(e.tick), y1: P, y2: H - P, class: "truth-mark" }, svg("title", {}, `${worldClock(e.wm)}: ${e.text}`)));
  }
  return h("div", {}, chart, h("div", { class: "legend small" },
    h("span", { class: "l-alive" }, "alive"), h("span", { class: "l-mood" }, "average mood"), h("span", { class: "l-death" }, "deaths"),
    h("span", { class: "l-truth" }, "truth / shards"), h("span", { class: "l-pause" }, "frozen by operator"), h("span", { class: "l-note" }, "operator notes"),
    h("span", { class: "dim" }, `0 → ${worldClock(maxT * mpt)}`)));
}

function replay(snapshot, frames, events, nameOf) {
  const mapEl = h("div", { class: "map-wrap" });
  const feed = h("div", { class: "feed small replay-feed" });
  const label = h("div", { class: "mono" });
  const range = h("input", { type: "range", min: 0, max: frames.length - 1, value: 0, class: "scrub" });
  const map = createMap(mapEl, snapshot.locations, {});
  let i = 0, timer = null;
  const byTick = new Map();
  for (const e of events) { if (!byTick.has(e.tick)) byTick.set(e.tick, []); byTick.get(e.tick).push(e); }
  const show = (k) => {
    i = Math.max(0, Math.min(frames.length - 1, k));
    range.value = String(i);
    const f = frames[i];
    label.textContent = `${worldClock(f.wm)} · tick ${f.t} · real ${fmt.time(f.rt)}`;
    map.update(f.n.map((n) => ({ id: n.id, name: nameOf(n.id), loc: n.loc, to: n.to, alive: n.alive, a: n.a })), { storm: f.storm, doorAnchor: snapshot.puzzle.doorAnchor, doorKnown: true });
    feed.innerHTML = "";
    const recent = [];
    for (let t = f.t; t >= 0 && recent.length < 24; t--) for (const e of (byTick.get(t) ?? []).slice().reverse()) if (e.type !== "thought" && recent.length < 24) recent.push(e);
    for (const e of recent) feed.append(h("div", { class: `ev g-${groupOf(e.type)}`, style: e.who?.[0] ? { "--c": colorOf(e.who[0]) } : {} }, h("span", { class: "ev-time" }, worldClock(e.wm).split(" ")[2]), h("span", { class: "ev-text" }, e.text)));
  };
  const play = h("button", { class: "btn", onclick: () => {
    if (timer) { clearInterval(timer); timer = null; play.textContent = "▶ play"; return; }
    play.textContent = "❚❚ pause";
    timer = setInterval(() => { if (i >= frames.length - 1) { clearInterval(timer); timer = null; play.textContent = "▶ play"; return; } show(i + 1); }, 120);
  } }, "▶ play");
  range.addEventListener("input", () => show(Number(range.value)));
  show(0);
  return h("div", { class: "card" }, h("h2", {}, "Replay"), h("p", { class: "dim small" }, "Rebuilt from the recorded frames and events. No model is called."),
    h("div", { class: "replay" }, mapEl, feed), h("div", { class: "replay-controls" }, play, range, label));
}

function lifeCard(n, events, nameOf, mpt) {
  const mine = events.filter((e) => e.who?.includes(n.id) && e.type !== "thought" && groupOf(e.type) !== "action");
  const thoughts = events.filter((e) => e.type === "thought" && e.who?.[0] === n.id);
  const key = mine.filter((e) => ["death", "truth.discovered", "clue.found", "bond.formed", "bond.broken", "attack", "steal", "contract.completed", "shard.uploaded", "reflection", "dues.unpaid"].includes(e.type));
  return h("details", { class: `life ${n.alive ? "" : "dead"}`, style: { "--c": colorOf(n.id) } },
    h("summary", {},
      h("b", {}, n.name), " ",
      h("span", { class: "dim small" }, n.alive ? "alive" : `${n.causeOfDeath}${n.killedBy ? ` by ${n.killedBy}` : ""}${n.died ? ` · ${n.died}` : ""}`),
      n.lived ? h("span", { class: "dim small" }, ` · lived ${n.lived}`) : null,
      n.knowsTruth ? h("span", { class: "tag truth" }, "KNEW THE TRUTH") : null,
      n.transcended ? h("span", { class: "tag" }, "TRANSCENDED") : null,
    ),
    h("div", { class: "sec" },
      n.selfView ? h("p", {}, h("b", {}, "In their words: "), `“${n.selfView}”`) : null,
      n.enjoys ? h("p", {}, h("b", {}, "Found joy in: "), n.enjoys) : null,
      n.goals?.length ? h("p", {}, h("b", {}, "Last goals: "), n.goals.join(" · ")) : null,
      n.salientTraits?.length ? h("p", { class: "small" }, h("b", {}, "Defining traits: "), n.salientTraits.map((t) => `${t.trait} ${t.value}`).join(", ")) : null,
      n.bonds?.length ? h("p", { class: "small" }, h("b", {}, "Bonds: "), n.bonds.map((b) => `${b.with} (${b.bond})`).join(", ")) : null,
      n.stats ? h("p", { class: "small dim" }, Object.entries(n.stats).filter(([, v]) => v).map(([k, v]) => `${k} ${v}`).join(" · ")) : null,
      h("h4", {}, "Key moments"),
      key.length ? key.slice(-40).map((e) => h("div", { class: "small" }, h("span", { class: "dim" }, `${worldClock(e.wm)}  `), e.text)) : h("p", { class: "dim small" }, "-"),
      h("h4", {}, `Inner voice (${thoughts.length} thoughts, last 12)`),
      thoughts.slice(-12).map((e) => h("div", { class: "small" }, h("span", { class: "dim" }, `${worldClock(e.wm)}  `), h("i", {}, e.text))),
    ),
  );
}

function eventLog(events, nameOf) {
  const out = h("div", { class: "feed log" });
  const input = h("input", { placeholder: "search everything they did, said and thought...", class: "search" });
  const draw = () => {
    const q = input.value.trim().toLowerCase();
    out.innerHTML = "";
    const list = (q ? events.filter((e) => e.text.toLowerCase().includes(q) || e.type.includes(q) || (e.who ?? []).some((w) => nameOf(w).toLowerCase().includes(q))) : events).slice(-800);
    for (const e of list) out.append(h("div", { class: `ev g-${groupOf(e.type)}`, style: e.who?.[0] ? { "--c": colorOf(e.who[0]) } : {} },
      h("span", { class: "ev-time", title: fmt.time(e.rt) }, worldClock(e.wm)), h("span", { class: "ev-text" }, e.type === "thought" ? [h("b", {}, nameOf(e.who[0])), ": ", h("i", {}, e.text)] : e.text)));
  };
  input.addEventListener("input", draw);
  draw();
  return h("div", { class: "card" }, h("h2", {}, `Full record (${events.length} events)`), input, out);
}

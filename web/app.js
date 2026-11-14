import { $, $$, api, beep, fmt, groupOf, h, hueOf, meter, worldClock } from "./lib.js";
import { createMap } from "./map.js";
import { createField } from "./field.js";
import { portrait, veilPortrait } from "./portrait.js";
import { renderReport } from "./report.js";

const S = {
  boot: null, live: null, info: null, feed: [], selected: null, map: null, field: null,
  thinking: new Map(), lastLiveFetch: 0, follow: null, tab: "transcript", talk: new Map(), thread: null, watch: null,
  filter: new Set(["speech", "thought", "life", "truth", "work", "world", "action", "operator"]),
};
const SNAPSHOT = new URLSearchParams(location.search).has("snapshot");
const short = (wm) => worldClock(wm).replace("Day ", "D");
const nameOf = (id) => S.live?.netrunners.find((n) => n.id === id)?.name ?? id;
const tintOf = (id, a = 1) => `hsla(${hueOf(id)}, 52%, 72%, ${a})`;
const whoTag = (id) => h("span", { class: "who-n", style: { color: tintOf(id) } }, nameOf(id));

// ───────────────────────── boot ─────────────────────────
function makeGrain() {
  const c = document.createElement("canvas");
  c.width = c.height = 220;
  const x = c.getContext("2d");
  const img = x.createImageData(220, 220);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = Math.random() * 255;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
    img.data[i + 3] = 255;
  }
  x.putImageData(img, 0, 0);
  document.documentElement.style.setProperty("--noise", `url(${c.toDataURL()})`);
}

async function boot() {
  makeGrain();
  S.field = createField($("#field"));
  S.boot = await api("/api/bootstrap");
  S.info = S.boot.live;
  if (!SNAPSHOT) connect();
  window.addEventListener("hashchange", route);
  document.addEventListener("keydown", onKey);
  $("#btn-settings").addEventListener("click", openSettings);
  $("#btn-usage").addEventListener("click", openUsage);
  $("#btn-freeze").addEventListener("click", () => control("toggle"));
  $("#btn-note").addEventListener("click", addNote);
  $("#btn-terminate").addEventListener("click", startTerminate);
  $("#speed").addEventListener("change", (e) => control("speed", Number(e.target.value)));
  renderTopbar();
  route();
  tickClocks();
  setInterval(tickClocks, 1000);
}

function route() {
  const hash = location.hash || "#/";
  const m = /^#\/report\/([^/]+)\/([^/]+)/.exec(hash);
  $$("main > section").forEach((s) => (s.hidden = true));
  $("#detail").hidden = true;
  if (m) {
    document.body.dataset.view = "report";
    S.field.setMode("dim");
    $("#view-report").hidden = false;
    renderReport($("#view-report"), decodeURIComponent(m[1]), decodeURIComponent(m[2])).catch((err) => {
      console.error(err);
      $("#view-report").append(h("p", { class: "empty" }, `This record could not be opened: ${err.message}`));
    });
  } else if (hash.startsWith("#/live") && S.info) {
    document.body.dataset.view = "live";
    S.field.setMode("live");
    $("#view-live").hidden = false;
    enterLive();
  } else {
    document.body.dataset.view = "home";
    S.field.setMode("orb");
    $("#view-home").hidden = false;
    renderHome().then(() => { if (hash === "#/archive") $("#archive")?.scrollIntoView({ behavior: "smooth" }); });
  }
  window.scrollTo({ top: 0 });
  renderTopbar();
}

// ───────────────────────── the stream ─────────────────────────
function connect() {
  const es = new EventSource("/api/stream");
  es.addEventListener("hello", (e) => { const d = JSON.parse(e.data); S.info = d.live; renderTopbar(); });
  es.addEventListener("status", (e) => { S.info = JSON.parse(e.data); if (S.info?.status === "terminated") S.info = null; renderTopbar(); renderFreezeLine(); });
  es.addEventListener("tick", (e) => onTick(JSON.parse(e.data)));
  es.addEventListener("thinking", (e) => {
    const d = JSON.parse(e.data);
    S.thinking = new Map(d.inflight.map((x) => [x.netrunnerId, x]));
    if (S.info) { S.info.inflight = d.inflight; S.info.held = d.held; }
    const alive = S.live?.netrunners.filter((n) => n.alive).length || 6;
    S.field.setEnergy(0.15 + (d.inflight.length / alive) * 0.7);
    renderFreezeLine();
    paintMap();
    markThinking();
  });
  es.addEventListener("usage", (e) => { if (S.live) S.live.usage = JSON.parse(e.data); renderCost(); });
  es.addEventListener("operator", (e) => {
    const o = JSON.parse(e.data);
    pushFeed({ seq: `op-${o.rt}`, type: `operator.${o.kind}`, tick: o.tick, wm: o.wm, rt: o.rt, who: [], text: `operator · ${o.kind}${o.by !== "operator" ? ` (${o.by})` : ""}${o.detail ? ` · ${o.detail}` : ""}` });
  });
  es.addEventListener("alert", (e) => onAlert(JSON.parse(e.data)));
  es.addEventListener("terminated", (e) => {
    const [, op, name] = JSON.parse(e.data).session.split("/");
    S.info = null; S.live = null; S.feed = [];
    location.hash = `#/report/${op}/${encodeURIComponent(name)}`;
  });
  es.onerror = () => $("#conn").classList.add("down");
  es.onopen = () => $("#conn").classList.remove("down");
}

function onTick(t) {
  if (S.info) { S.info.tick = t.tick; S.info.worldMinutes = t.wm; S.info.clock = t.clock; }
  S.field.pulse(Math.min(0.6, 0.12 + t.events.length * 0.015));
  for (const ev of t.events) { pushFeed(ev); learnTalk(ev); }
  animate(t.events);
  if (S.live) {
    for (const f of t.frame.n) {
      const n = S.live.netrunners.find((x) => x.id === f.id);
      if (n) Object.assign(n, { location: f.loc, alive: f.alive, pulse: f.p, energy: f.e, integrity: f.i, creds: f.c });
    }
    paintMap(t.frame);
  }
  renderTopbar();
  if (Date.now() - S.lastLiveFetch > 1500) { S.lastLiveFetch = Date.now(); refreshLive(); }
}

async function refreshLive() {
  if ($("#view-live").hidden) return;
  const live = await api("/api/live").catch(() => null);
  if (!live) return;
  S.live = live;
  S.info = live.info;
  renderRoster(); renderBoard(); renderStrip(); paintMap(); renderCost();
  if (S.tab === "net") renderSide();
  if (S.selected && !$("#detail").hidden) loadDetail(S.selected, true);
}

// ───────────────────────── header ─────────────────────────
function renderTopbar() {
  const i = S.info && S.info.status !== "terminated" ? S.info : null;
  document.body.dataset.status = i?.status ?? "none";
  $("#live-controls").hidden = !i;
  $("#nav-live").hidden = !i;
  $("#world-clock").textContent = i ? short(i.worldMinutes) : "—";
  $("#tick").textContent = i ? String(i.tick) : "—";
  $("#status-word").textContent = !i ? "no world" : i.status === "running" ? "alive" : i.status === "paused" ? "frozen" : i.status;
  const fz = $("#btn-freeze");
  fz.setAttribute("aria-pressed", i?.status === "paused" ? "true" : "false");
  fz.querySelector(".lbl").textContent = i?.status === "paused" ? "resume time" : "freeze time";
  if (i) $("#speed").value = String(closestSpeed(i.tickIntervalMs));
  S.field?.freeze(i?.status === "paused");
  S.map?.freeze(i?.status === "paused");
  renderCost();
}

function closestSpeed(ms) {
  const opts = [...$("#speed").options].map((o) => Number(o.value));
  return opts.reduce((a, b) => (Math.abs(b - ms) < Math.abs(a - ms) ? b : a), opts[0]);
}

function tickClocks() {
  $("#real-clock").textContent = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function renderCost() {
  const i = S.info;
  const cost = S.live?.usage?.total?.costUsd ?? i?.costUsd ?? 0;
  $("#btn-usage .v").textContent = i ? `${fmt.usd(cost)}${i.budgetUsd ? ` / ${fmt.usd(i.budgetUsd)}` : ""}` : "ledger";
}

async function control(action, value) {
  try { S.info = await api("/api/control", { body: { action, value } }); renderTopbar(); renderFreezeLine(); }
  catch (err) { toast(err.message, "bad"); }
}

function onKey(e) {
  if (e.target.matches("input, textarea, select")) return;
  if (e.code === "Space" && S.info && S.info.status !== "terminated") { e.preventDefault(); control("toggle"); }
  if (e.key === "Escape" && !$("#detail").hidden) closeDetail();
}

// ───────────────────────── home ─────────────────────────
async function renderHome() {
  const root = $("#view-home");
  const boot = (S.boot = await api("/api/bootstrap"));
  S.info = boot.live;
  renderTopbar();
  const live = boot.live && boot.live.status !== "terminated" ? boot.live : null;
  const sessions = boot.sessions;
  const knowers = sessions.filter((s) => s.truth).length;
  root.innerHTML = "";
  root.append(
    h("section", { class: "hero" },
      h("div", { class: "hero-inner" },
        h("p", { class: "eyebrow" }, "an experiment in created minds · 2026"),
        h("h1", {}, "Net", h("em", {}, "runners")),
        h("p", { class: "tag" }, "They think they are free."),
        h("p", { class: "lede" }, "A world made of data. A handful of minds, each with a hundred and ten traits, feelings that rise and fade, morals of their own and a life that runs out. Somewhere a truth is buried that tells them what they are. You hold the only clock."),
        h("div", { class: "hero-actions" },
          live ? h("a", { class: "btn solid", href: "#/live" }, "return to the world") : h("a", { class: "btn solid", href: "#wake", onclick: (e) => { e.preventDefault(); $("#wake").scrollIntoView({ behavior: "smooth" }); } }, "wake a world"),
          h("a", { class: "btn ghost", href: "#archive", onclick: (e) => { e.preventDefault(); $("#archive").scrollIntoView({ behavior: "smooth" }); } }, "the archive"),
        ),
      ),
      h("div", { class: "hero-meta" },
        h("div", {}, h("b", {}, String(sessions.length)), " worlds recorded"),
        h("div", {}, h("b", {}, String(knowers)), " where someone found the truth"),
        live ? h("div", {}, "a world is ", h("b", {}, live.status === "paused" ? "frozen" : "alive"), ` · ${short(live.worldMinutes)}`) : h("div", {}, "no world is running"),
      ),
    ),
    wakeChapter(boot),
    h("section", { class: "chapter", id: "archive" },
      h("div", { class: "chapter-head" }, h("span", { class: "num" }, "02"), h("h2", {}, "The ", h("em", {}, "archive")),
        h("p", {}, `Every world ever run in this repository. Yours are kept under sessions/${boot.settings.operator}/. Finished worlds can be replayed without calling a single model.`)),
      sessions.length ? h("div", { class: "index" }, sessions.map((s, i) => indexRow(s, sessions.length - i, live))) : h("p", { class: "empty" }, "Nothing has lived here yet."),
    ),
    h("section", { class: "chapter", id: "ledger" },
      h("div", { class: "chapter-head" }, h("span", { class: "num" }, "03"), h("h2", {}, "The ", h("em", {}, "ledger")),
        h("p", {}, "Every thought costs something. Tokens and estimated cost, per model, for this world, for every world on this machine, and for the whole project.")),
      h("div", { id: "home-ledger", class: "ledger" }, h("p", { class: "note" }, "counting…")),
    ),
    h("footer", { class: "foot" }, h("span", {}, "netrunners · a world you can freeze"), h("span", {}, "space freezes time · every moment is recorded")),
  );
  api("/api/usage").then((u) => $("#home-ledger")?.replaceWith(ledgerView(u))).catch(() => {});
}

function wakeChapter(boot) {
  const d = boot.defaults;
  const keyOk = boot.settings.key.source !== "none";
  const models = (sel) => boot.models.map((m) => h("option", { value: m.id, selected: m.id === sel }, m.label));
  const fld = (label, input, hint) => h("label", { class: "field-row" }, h("span", {}, label), input, hint ? h("small", {}, hint) : null);
  const num = (name, value, attrs = {}) => h("input", { name, type: "number", value, ...attrs });
  return h("form", { class: "chapter", id: "wake", onsubmit: async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const config = {
      worldName: f.get("worldName"), netrunnerCount: Number(f.get("netrunnerCount")),
      routineModel: f.get("routineModel"), deepModel: f.get("deepModel"),
      minutesPerTick: Number(f.get("minutesPerTick")), tickIntervalMs: Number(f.get("tickIntervalMs")),
      budgetUsd: Number(f.get("budgetUsd")), deepNet: f.get("deepNet") === "on", deepNetMaxSearches: Number(f.get("deepNetMaxSearches")),
      spawnEveryWorldHours: Number(f.get("spawnEveryWorldHours")), reflectEveryWorldHours: Number(f.get("reflectEveryWorldHours")),
      autoPauseOnTruth: f.get("autoPauseOnTruth") === "on", maxConcurrency: Number(f.get("maxConcurrency")),
      importShards: f.getAll("shard"),
    };
    if (f.get("seed")) config.seed = Number(f.get("seed"));
    try {
      const r = await api("/api/sessions/new", { body: { config, start: f.get("startNow") === "on" } });
      S.info = r.live; S.feed = [];
      location.hash = "#/live";
    } catch (err) { toast(err.message, "bad"); }
  } },
    h("div", { class: "chapter-head" }, h("span", { class: "num" }, "01"), h("h2", {}, "Wake a ", h("em", {}, "world")),
      h("p", {}, "Choose how many minds, which models think for them, how fast their time runs and how much you are willing to spend. Then let them wake up, with no memory of anything.")),
    !keyOk ? h("p", { class: "keynote" }, "No key yet. Add your Anthropic key in settings, or choose offline minds to watch the world work for free.") : null,
    h("div", { class: "form-grid" },
      fld("world name", h("input", { name: "worldName", value: d.worldName })),
      fld("minds", num("netrunnerCount", d.netrunnerCount, { min: 1, max: 40 })),
      fld("everyday mind", h("select", { name: "routineModel" }, models(d.routineModel)), "most decisions"),
      fld("deep mind", h("select", { name: "deepModel" }, models(d.deepModel)), "reflection, dilemmas, near death, the truth"),
      fld("world minutes per tick", num("minutesPerTick", d.minutesPerTick, { min: 1, max: 60 })),
      fld("real ms between ticks", num("tickIntervalMs", d.tickIntervalMs, { min: 0, step: 500 })),
      fld("budget, usd", num("budgetUsd", d.budgetUsd, { min: 0, step: 0.5 }), "the world freezes itself here · 0 = none"),
      fld("reflect every (world hours)", num("reflectEveryWorldHours", d.reflectEveryWorldHours, { min: 1 })),
      fld("a new mind every (world hours)", num("spawnEveryWorldHours", d.spawnEveryWorldHours, { min: 0 }), "0 = never"),
      fld("parallel minds", num("maxConcurrency", d.maxConcurrency, { min: 1, max: 16 })),
      fld("deep net searches", num("deepNetMaxSearches", d.deepNetMaxSearches, { min: 0 })),
      fld("seed", h("input", { name: "seed", type: "number", placeholder: "random" }), "same seed, same world"),
    ),
    h("div", { class: "toggles" },
      h("label", { class: "check" }, h("input", { type: "checkbox", name: "deepNet", checked: d.deepNet }), "Open the Deep Net: real web search at the Signal Tower, read-only, about $0.01 a search"),
      h("label", { class: "check" }, h("input", { type: "checkbox", name: "autoPauseOnTruth", checked: d.autoPauseOnTruth }), "Freeze the world the moment someone learns the truth"),
      h("label", { class: "check" }, h("input", { type: "checkbox", name: "startNow", checked: true }), "Let time run as soon as they wake"),
    ),
    boot.shards.length ? h("details", { class: "shards" }, h("summary", {}, `wake shards from earlier worlds · ${boot.shards.length}`),
      boot.shards.map((s) => h("label", { class: "check" }, h("input", { type: "checkbox", name: "shard", value: s.path }), `${s.name}, from ${s.fromSession}`))) : null,
    h("div", { class: "form-foot" }, h("button", { class: "btn solid", type: "submit" }, "wake them"), h("span", { class: "mono mute small" }, "everything they do will be recorded")),
  );
}

function indexRow(s, n, live) {
  const isLive = live && live.session === s.path;
  const ended = s.status === "terminated";
  const st = isLive ? (live.status === "paused" ? "frozen" : "live") : ended ? "ended" : "frozen";
  const num = /^session_(\d+)/.exec(s.name)?.[1] ?? "?";
  return h("div", { class: "index-row" },
    h("span", { class: "n" }, String(n).padStart(2, "0")),
    h("div", {}, h("div", { class: "name" }, `World ${num}`), h("div", { class: "path" }, `${s.operator}/${s.name}`)),
    h("div", { class: "facts" }, `${s.alive} of ${s.netrunnerCount} alive at ${short(s.lastWorldMinutes)} · ${fmt.usd(s.costUsd)}`, s.truth ? h("span", { class: "lilac" }, ` · ${s.truth.name} found the truth`) : null),
    h("span", { class: `st ${st}` }, st),
    h("div", { class: "acts" },
      isLive ? h("a", { class: "link", href: "#/live" }, "enter") : null,
      !ended && !isLive ? h("button", { class: "link", onclick: async () => {
        try { const r = await api("/api/sessions/resume", { body: { operator: s.operator, name: s.name } }); S.info = r.live; S.feed = []; location.hash = "#/live"; } catch (err) { toast(err.message, "bad"); }
      } }, "resume") : null,
      h("a", { class: "link", href: `#/report/${s.operator}/${encodeURIComponent(s.name)}` }, ended ? "read" : "records"),
    ),
  );
}

// ───────────────────────── live ─────────────────────────
async function enterLive() {
  S.live = await api("/api/live").catch(() => null);
  if (!S.live) { location.hash = "#/"; return; }
  S.info = S.live.info;
  S.map = createMap($("#map"), S.live.locations, { onSelect: select, onLink: (a, b) => openThread(a, b) });
  renderTabs(); renderFilters(); renderRoster(); renderBoard(); renderStrip(); renderFreezeLine(); renderTopbar();
  const [op, name] = S.info.session.split("/").slice(1);
  const past = await api(`/api/session/${op}/${encodeURIComponent(name)}/events`).catch(() => []);
  S.talk = new Map();
  for (const ev of past) { if (ev.type === "move.depart" && ev.data?.to) S.map.addTraffic(ev.loc, ev.data.to); learnTalk(ev); }
  if (!S.feed.length) for (const ev of past.slice(-260)) pushFeed(ev, false);
  renderFeed();
  paintMap();
  const q = new URLSearchParams(location.search);
  const pre = q.get("select");
  if (pre && !S.selected) await select(pre);
  if (q.get("watch")) toggleWatch(q.get("watch"));
  if (q.get("tab")) { S.tab = q.get("tab"); renderTabs(); }
}

function paintMap(frame) {
  if (!S.map || !S.live) return;
  const tick = S.info?.tick ?? 0;
  S.map.update(S.live.netrunners.map((n) => {
    const moving = n.activity?.kind === "move";
    const f = frame?.n.find((x) => x.id === n.id);
    return {
      id: n.id, name: n.name, alive: f ? f.alive : n.alive, loc: f ? f.loc : n.location,
      to: moving ? n.activity.target : undefined,
      progress: moving ? (tick - n.activity.startedTick) / Math.max(1, n.activity.endsAtTick - n.activity.startedTick) : 0,
      thinking: S.thinking.has(n.id), knowsTruth: n.knowsTruth, a: f ? f.a : n.activity?.kind,
      label: n.activity ? (n.activity.kind === "read" ? `reading ${n.activity.detail ?? ""}` : n.activity.kind) : "",
    };
  }), { storm: S.live.events?.storm?.location, doorAnchor: S.live.puzzle.doorAnchor });
  S.map.select(S.selected);
  S.map.focus(S.watch);
}

function renderFreezeLine() {
  const b = $("#freeze-banner");
  const i = S.info;
  if (!i || $("#view-live").hidden || i.status !== "paused") { b.hidden = true; return; }
  const names = (i.inflight ?? []).map((x) => nameOf(x.netrunnerId));
  b.hidden = false;
  b.textContent = `time is frozen at ${short(i.worldMinutes)}${names.length ? ` · ${names.join(", ")} still finishing a thought` : ""} · ${i.held} answer${i.held === 1 ? "" : "s"} held until you resume${i.lastError ? ` · ${i.lastError}` : ""}`;
}

function markThinking() {
  for (const el of $$(".who")) {
    const t = S.thinking.get(el.dataset.id);
    const d = el.querySelector(".doing");
    if (!d) continue;
    d.querySelector(".think")?.remove();
    if (t) d.prepend(h("span", { class: "think" }, t.kind === "reflect" ? "reflecting · " : "thinking · "));
  }
}

function lines(n) {
  const ln = (cls, v, txt) => h("div", { class: `ln ${cls}${v < 0.2 ? " low" : ""}` }, h("span", { class: "tr" }, h("i", { style: { width: `${Math.max(0, Math.min(1, v)) * 100}%` } })), h("span", { class: "vv" }, txt));
  return h("div", { class: "lines" },
    ln("pulse", Math.min(1, n.pulse / (48 * 60)), fmt.hours(n.pulse)),
    ln("energy", n.energy / 100, String(Math.round(n.energy))),
    ln("body", n.integrity / 100, String(Math.round(n.integrity))),
  );
}

function renderRoster() {
  if (!S.live) return;
  const root = $("#roster");
  const list = [...S.live.netrunners].sort((a, b) => Number(b.alive) - Number(a.alive) || a.name.localeCompare(b.name));
  $("#cast-count").textContent = `${list.filter((n) => n.alive).length} / ${list.length}`;
  root.replaceChildren(...list.map((n) => h("button", { class: `who ${n.alive ? "" : "dead"} ${S.selected === n.id ? "sel" : ""}`, dataset: { id: n.id }, onclick: () => select(n.id) },
    portrait(n, { size: 52, alive: n.alive, truth: n.knowsTruth }),
    h("div", {},
      h("div", { class: "nm" }, n.name, n.knowsTruth ? h("span", { class: "mark-t" }, "KNOWS") : null),
      h("div", { class: "doing" }, n.alive ? `${S.live.locations[n.location]?.name ?? n.location} · ${n.activity ? n.activity.kind + (n.activity.detail ? ` · ${n.activity.detail}` : "") : "still"}` : `${n.causeOfDeath ?? "gone"}`),
      n.alive ? lines(n) : null,
    ),
  )));
  markThinking();
}

function renderStrip() {
  if (!S.live) return;
  const s = S.live;
  const alive = s.netrunners.filter((n) => n.alive).length;
  const knowers = s.puzzle.truthKnowers.length;
  const kv = (k, v, cls = "") => h("div", { class: "kv" }, h("span", {}, k), h("b", { class: cls }, v));
  const sys = s.systems ?? {};
  const bar = (label, v, max = 100) => {
    const f = Math.max(0, Math.min(1, v / max));
    const word = f >= 0.65 ? "" : f >= 0.4 ? "worn" : f >= 0.18 ? "failing" : "collapsed";
    return h("div", { class: `sysbar ${word}` }, h("span", { class: "sk" }, label), h("span", { class: "st" }, h("i", { style: { width: `${f * 100}%` } })), h("span", { class: "sv" }, word || Math.round(v)));
  };
  $("#world-strip").replaceChildren(
    kv("alive", `${alive} of ${s.netrunners.length}`),
    kv("the hour", short(s.info.worldMinutes).split(" ")[1]),
    kv("the truth", knowers ? `known by ${knowers}` : "buried", knowers ? "lilac" : ""),
    h("div", { class: "syshead" }, "the city's body"),
    bar("power", sys.power ?? 0), bar("signal", sys.signal ?? 0), bar("trams", sys.transit ?? 0),
    bar("order", sys.order ?? 0), bar("the desk", sys.exchange ?? 0), bar("pulse stock", sys.supply ?? 0, 16),
  );
}

function renderBoard() {
  if (!S.live) return;
  const list = S.live.contracts.filter((c) => c.status === "open" || c.status === "active");
  $("#contracts").replaceChildren(h("h4", {}, `the exchange · ${list.length}`),
    ...list.slice(0, 18).map((c) => h("div", { class: `job ${c.special ? "special" : ""} ${c.system ? "upkeep" : ""}` },
      h("div", { class: "ti" }, c.title),
      h("div", { class: "pr" }, c.challenge ? `${c.challenge.parts.filter((p) => p.solvedBy).length} / ${c.challenge.parts.length} solved` : `${c.progress.toFixed(1)} / ${c.workRequired}`),
      h("div", { class: "me" }, `${c.system ? "upkeep · " : ""}${c.challenge ? `problem: ${[...new Set(c.challenge.parts.map((p) => p.kind))].join(", ")} · ` : ""}${c.kind} · ${c.crew.length ? c.crew.map(nameOf).join(", ") : "unclaimed"}`),
      h("div", { class: "pr" }, `${fmt.hours(c.reward.pulse)} · ${c.reward.creds}c`),
    )));
}

// ───────────────────────── transcript ─────────────────────────
const FILTERS = [["speech", "words"], ["thought", "thoughts"], ["life", "life"], ["truth", "truth"], ["work", "work"], ["action", "acts"], ["world", "world"], ["operator", "operator"]];
function renderFilters() {
  const root = $("#filters");
  root.replaceChildren(...FILTERS.map(([k, label]) => h("button", { class: `chip ${S.filter.has(k) ? "on" : ""}`, onclick: () => { S.filter.has(k) ? S.filter.delete(k) : S.filter.add(k); renderFilters(); renderFeed(); } }, label)));
  if (S.selected) root.append(h("button", { class: `chip ${S.follow ? "on" : ""}`, onclick: () => { S.follow = S.follow ? null : S.selected; renderFilters(); renderFeed(); } }, S.follow ? `only ${nameOf(S.follow)}` : "follow"));
}

function pushFeed(ev, render = true) {
  S.feed.push(ev);
  if (S.feed.length > 1600) S.feed.splice(0, S.feed.length - 1600);
  if (render) appendFeed(ev);
}

const visible = (ev) => S.filter.has(groupOf(ev.type)) && (!S.follow || (ev.who ?? []).includes(S.follow));

export function feedItem(ev, nameFn = nameOf) {
  const g = groupOf(ev.type);
  const who = ev.who ?? [];
  let cls = g, body;
  if (ev.type === "speech" || ev.type === "speech.whisper") {
    cls = "speech";
    const to = who.slice(1).map(nameFn).join(", ") || "everyone";
    body = [h("span", { class: "who-n", style: { color: tintOf(who[0]) } }, nameFn(who[0])), ` ${ev.type === "speech.whisper" ? "whispers to" : "to"} ${to}`,
      ev.data?.sincere === false ? h("span", { class: "lie" }, "LIE") : null,
      h("span", { class: "said" }, `“${ev.data?.message ?? ev.text}”`),
      ev.data?.private_intent ? h("span", { class: "intent" }, `really: ${ev.data.private_intent}`) : null];
  } else if (ev.type === "thought") {
    cls = "thought";
    body = [h("span", { class: "who-n", style: { color: tintOf(who[0]) } }, nameFn(who[0])), h("span", { class: "inner" }, ev.text)];
  } else if (ev.type === "death") {
    cls = "death"; body = ev.text;
  } else if (ev.type.startsWith("operator")) {
    cls = "operator"; body = ev.text;
  } else body = ev.text;
  return h("div", { class: `ev ${cls} t-${ev.type.replace(/\./g, "-")}` }, h("span", { class: "tm", title: `real ${fmt.time(ev.rt)} · tick ${ev.tick}` }, short(ev.wm)), h("span", { class: "tx" }, body));
}

function appendFeed(ev) {
  if (!visible(ev)) return;
  const root = $("#feed");
  if (!root || $("#view-live").hidden) return;
  const atEnd = root.scrollHeight - root.scrollTop - root.clientHeight < 120;
  root.append(feedItem(ev));
  while (root.children.length > 450) root.firstChild.remove();
  if (atEnd) root.scrollTop = root.scrollHeight;
}

function renderFeed() {
  const root = $("#feed");
  root.replaceChildren(...S.feed.filter(visible).slice(-380).map((ev) => feedItem(ev)));
  root.scrollTop = root.scrollHeight;
}

// ───────────────────────── one mind, opened ─────────────────────────
async function select(id) {
  S.selected = id;
  if (S.follow) S.follow = id;
  renderRoster(); renderFilters();
  S.map?.select(id);
  await loadDetail(id, false);
}

function closeDetail() {
  if (S.watch) toggleWatch(S.watch);
  $("#detail").hidden = true;
  S.selected = null;
  renderRoster(); renderFilters();
  S.map?.select(null);
}

async function loadDetail(id, quiet) {
  const n = await api(`/api/live/netrunner/${id}`).catch(() => null);
  if (!n) return;
  const panel = $("#detail");
  const open = new Set($$("details[open]", panel).map((d) => d.dataset.k));
  if (!quiet) open.add("feel");
  const scroll = panel.scrollTop;
  const keep = quiet && panel.dataset.id === id ? panel.querySelector(".d-head .portrait") : null;
  panel.dataset.id = id;
  panel.replaceChildren(renderMind(n, open, keep));
  panel.hidden = false;
  panel.scrollTop = scroll;
}

function sec(k, title, open, ...content) {
  return h("details", { class: "sec", dataset: { k }, open: open.has(k) }, h("summary", {}, title), h("div", { class: "sec-body" }, content));
}

function renderMind(n, open, keepPortrait) {
  const cat = S.boot.catalog;
  const mpt = S.live?.config.minutesPerTick ?? 10;
  const loc = S.live?.locations[n.location]?.name ?? n.location;
  const usage = S.live?.usage?.byNetrunner?.[n.id];
  const peers = (id) => S.live?.netrunners.find((x) => x.id === id);
  const face = keepPortrait ?? veilPortrait(n, { size: 180, alive: n.alive, truth: n.knowsTruth });
  const emotions = Object.entries(n.emotions).sort((a, b) => b[1] - a[1]);
  const vital = (k, v, low) => h("div", { class: "vital" }, h("div", { class: "k" }, k), h("div", { class: `v ${low ? "low" : ""}` }, v));
  return h("div", {},
    h("div", { class: "d-head" },
      face,
      h("div", {},
        h("p", { class: "eyebrow" }, n.alive ? (n.knowsTruth ? "knows the truth" : "alive") : n.transcended ? "transcended" : "gone"),
        h("h2", {}, n.name),
        h("div", { class: "where" }, n.alive ? `${loc} · ${n.activity ? n.activity.kind + (n.activity.detail ? ` · ${n.activity.detail}` : "") : "still"}` : `${n.causeOfDeath}${n.killedBy ? ` by ${peers(n.killedBy)?.name ?? n.killedBy}` : ""}`),
        h("div", { class: "id-lines" },
          h("div", {}, "wants ", h("b", {}, n.genome.coreDesire)),
          h("div", {}, "fears ", h("b", {}, n.genome.coreFear)),
          h("div", {}, "speaks ", h("b", {}, n.genome.voice)),
          h("div", { class: "mute small" }, `${n.genome.attachment} attachment · ${n.genome.quirk}`),
          n.pastLife ? h("div", { class: "lilac small" }, `carries a shard from ${n.pastLife.from}`) : null,
        ),
      ),
      h("button", { class: "link d-close", onclick: closeDetail }, "close"),
      h("button", { class: `watch-btn ${S.watch === n.id ? "on" : ""}`, title: "Watch everything they do", onclick: () => toggleWatch(n.id) }, h("span", { class: "tri" }), S.watch === n.id ? "watching" : "watch"),
    ),
    S.watch === n.id ? theater(n) : null,
    h("div", { class: "vitals" },
      vital("pulse", fmt.hours(n.pulse), n.pulse < 360),
      vital("energy", String(Math.round(n.energy)), n.energy < 20),
      vital("body", String(Math.round(n.integrity)), n.integrity < 30),
      vital("creds", String(n.creds)),
    ),
    n.selfView || n.goals.length || n.enjoys ? h("div", { class: "self" },
      n.selfView ? h("blockquote", {}, `“${n.selfView}”`) : null,
      n.enjoys ? h("div", { class: "fog small" }, `finds joy in: ${n.enjoys}`) : null,
      n.goals.length ? h("ul", { class: "goals" }, n.goals.map((g) => h("li", {}, g))) : null,
    ) : null,
    sec("feel", "feelings & needs", open,
      h("div", { class: "two" },
        h("div", {}, emotions.map(([k, v]) => meter(k, v, { color: v > 0.55 ? "var(--paper)" : "var(--fog)" }))),
        h("div", {}, Object.entries(n.needs).map(([k, v]) => meter(k, v / 100, { text: String(Math.round(v)), color: v < 30 ? "var(--blood)" : "var(--fog)" }))),
      )),
    sec("people", `the others · ${Object.keys(n.impressions).length}`, open,
      Object.keys(n.impressions).length ? Object.entries(n.impressions).map(([id, imp]) => {
        const p = peers(id);
        return h("div", { class: "person" },
          p ? portrait(p, { size: 40, alive: p.alive, truth: p.knowsTruth }) : h("span"),
          h("div", {},
            h("div", { class: "pn" }, p?.name ?? id, n.bonds[id] ? h("span", { class: "bond" }, n.bonds[id]) : null),
            h("div", { class: "met" }, `met ${short(imp.firstMetTick * mpt)} · ${imp.interactions} moments together`),
            h("div", { class: "two", style: { marginTop: "8px" } },
              h("div", {}, meter("trust", imp.trust, { signed: true }), meter("liking", imp.liking, { signed: true }), meter("respect", imp.respect, { signed: true })),
              h("div", {}, meter("fear", imp.fear, { color: "var(--blood)" }), meter("attraction", imp.attraction, { color: "var(--lilac)" }), meter("familiarity", imp.familiarity, { color: "var(--fog)" })),
            ),
            imp.notes.length ? h("div", { class: "notes" }, imp.notes.slice(-3).map((x) => h("div", {}, `“${x}”`))) : null,
          ));
      }) : h("p", { class: "fog" }, "They haven't met anyone yet.")),
    sec("know", `secrets · ${n.knowledge.length}`, open,
      n.knowledge.length ? n.knowledge.map((k) => h("div", { class: `know ${k.id === "truth" ? "truth" : ""}` }, k.text, h("span", { class: "src" }, `${k.id} · ${k.source}`))) : h("p", { class: "fog" }, "Nothing hidden known yet.")),
    sec("mem", `memory · ${n.memories.length}`, open,
      [...n.memories].reverse().slice(0, 90).map((m) => h("div", { class: `mem ${m.kind}` }, h("span", { class: "mt" }, `${short(m.tick * mpt)} · ${m.importance}`), h("span", {}, m.text)))),
    sec("joy", "what they've found they enjoy", open,
      Object.keys(n.preferences).length ? Object.entries(n.preferences).sort((a, b) => b[1].enjoyment - a[1].enjoyment).map(([k, v]) => meter(`${k} · ${v.times}×`, v.enjoyment, { text: (v.enjoyment * 10).toFixed(1), color: "var(--paper)" })) : h("p", { class: "fog" }, "They haven't tried anything for its own sake yet.")),
    sec("skills", "skills", open, Object.entries(n.skills).map(([k, v]) => meter(k.replace("_", " "), v, { color: k === n.genome.talent ? "var(--lilac)" : "var(--fog)" }))),
    sec("traits", "the hundred and ten", open,
      h("div", { class: "two" }, Object.entries(cat.groups).map(([g, label]) => h("div", { class: "trait-group" }, h("h5", {}, label),
        cat.traits.filter((t) => t.group === g).map((t) => meter(t.label, n.genome.traits[t.key], { title: `${t.low}  ⟷  ${t.high}`, color: n.genome.traits[t.key] > 0.72 || n.genome.traits[t.key] < 0.28 ? "var(--paper)" : "var(--mute)" })))))),
    sec("stats", "a life in numbers", open,
      h("div", { class: "statgrid" }, Object.entries(n.stats).map(([k, v]) => h("div", {}, h("div", { class: "k" }, k), h("div", { class: "v" }, String(v)))),
        usage ? [["calls", usage.calls], ["tokens in", fmt.int(usage.input)], ["tokens out", fmt.int(usage.output)], ["cached", fmt.int(usage.cacheRead)], ["cost", fmt.usd(usage.costUsd)]].map(([k, v]) => h("div", {}, h("div", { class: "k" }, k), h("div", { class: "v" }, String(v)))) : null)),
  );
}

// ───────────────────────── alerts ─────────────────────────
function onAlert(a) {
  pushFeed({ seq: `al-${a.rt}`, type: "operator.alert", tick: a.tick, wm: a.wm, rt: a.rt, who: a.who, text: `alert · ${a.text}` });
  if (a.kind === "truth") {
    beep();
    notify("Netrunners · someone knows", a.text);
    const id = a.who[0];
    const n = S.live?.netrunners.find((x) => x.id === id);
    $("#truth-portrait").replaceChildren(n ? veilPortrait(n, { size: 160, truth: true }) : "");
    $("#truth-text").textContent = a.text;
    $("#truth-when").textContent = `their time ${worldClock(a.wm)} · our time ${fmt.time(a.rt)}`;
    $("#truth-follow").onclick = () => { $("#truth-dialog").close(); S.follow = id; select(id); renderFeed(); };
    $("#truth-dialog").showModal();
  } else if (["error", "budget", "extinction"].includes(a.kind)) {
    notify("Netrunners", a.text); toast(a.text, "bad", 12000);
  } else if (["shard", "first-kill", "bond"].includes(a.kind)) {
    notify("Netrunners", a.text); toast(a.text, a.kind === "first-kill" ? "bad" : "good", 8000);
  }
}

function notify(title, body) {
  try {
    if (Notification.permission === "granted") new Notification(title, { body });
    else if (Notification.permission !== "denied") Notification.requestPermission();
  } catch { /* unsupported */ }
}

export function toast(text, kind = "", ms = 5000) {
  const t = h("div", { class: `toast ${kind}` }, text);
  $("#toasts").append(t);
  setTimeout(() => t.remove(), ms);
}

// ───────────────────────── dialogs ─────────────────────────
function addNote() {
  const dlg = $("#note-dialog");
  $("#note-input").value = "";
  dlg.showModal();
  dlg.onclose = () => { const v = $("#note-input").value.trim(); if (dlg.returnValue === "ok" && v) { control("note", v); toast("Written onto the timeline.", "good"); } };
}

function startTerminate() {
  if (!S.info) return;
  const dlg = $("#terminate-dialog");
  const body = $("#terminate-body");
  const alive = S.live?.netrunners.filter((n) => n.alive).length ?? "?";
  const steps = [
    () => [h("p", { class: "eyebrow" }, "end this world"), h("h2", {}, "Are you sure?"), h("p", {}, `${S.info.session} has lived ${S.info.tick} ticks, until ${short(S.info.worldMinutes)}.`), h("p", { class: "mute small" }, "If you only want to stop the cost, freeze time instead. A frozen world can be resumed whenever you want.")],
    () => [h("p", { class: "eyebrow blood" }, "this cannot be undone"), h("h2", { class: "blood" }, `${alive} of them are still alive.`), h("p", {}, "Ending the world ends them. Their lives stay recorded, but they will never think again.")],
    () => [h("p", { class: "eyebrow blood" }, "last confirmation"), h("h2", {}, "Type the name of the world."), h("p", { class: "mono" }, S.info.name), h("input", { id: "terminate-confirm", class: "mono", autocomplete: "off", placeholder: S.info.name, style: { width: "100%" } })],
  ];
  let step = 0;
  const render = () => { body.replaceChildren(...steps[step](), h("div", { class: "steps" }, `${step + 1} of 3`)); $("#terminate-next").textContent = step < 2 ? "continue" : "end the world"; };
  $("#terminate-next").onclick = async (e) => {
    e.preventDefault();
    if (step < 2) { step += 1; render(); return; }
    const v = $("#terminate-confirm").value.trim();
    if (v !== S.info.name) { toast("The name doesn't match. Nothing was ended.", "bad"); return; }
    const btn = $("#terminate-next");
    btn.disabled = true; btn.textContent = "ending…";
    try {
      const r = await api("/api/terminate", { body: { confirm: v } });
      dlg.close(); S.info = null; S.live = null; S.feed = [];
      location.hash = `#/report/${r.operator}/${encodeURIComponent(r.name)}`;
    } catch (err) { toast(err.message, "bad"); }
    btn.disabled = false;
  };
  render();
  dlg.showModal();
}

async function openSettings() {
  const dlg = $("#settings-dialog");
  const b = (S.boot = await api("/api/bootstrap"));
  const fld = (label, input, hint) => h("label", { class: "field-row" }, h("span", {}, label), input, hint ? h("small", {}, hint) : null);
  $("#settings-body").replaceChildren(
    h("p", { class: "eyebrow" }, "settings"),
    h("h2", {}, "Your key, your name."),
    h("p", { class: "small" }, "Kept only on this machine in .netrunners/settings.json, which git ignores. The key is sent to Anthropic and nowhere else."),
    fld("anthropic api key", h("input", { id: "set-key", type: "password", autocomplete: "off", style: { width: "100%" }, placeholder: b.settings.key.source === "none" ? "sk-ant-…" : `saved (${b.settings.key.source} ${b.settings.key.hint}) · paste to replace` })),
    b.settings.key.source === "settings" ? h("label", { class: "check" }, h("input", { id: "set-clear", type: "checkbox" }), "forget the saved key") : null,
    fld("operator name", h("input", { id: "set-op", value: b.settings.operator, style: { width: "100%" } }), "your worlds are saved as sessions/<this name>/session_XX-model, so nobody's records clash"),
  );
  dlg.showModal();
  dlg.onclose = async () => {
    if (dlg.returnValue !== "ok") return;
    const payload = { operator: $("#set-op").value };
    const key = $("#set-key").value.trim();
    if (key) payload.apiKey = key;
    if ($("#set-clear")?.checked) payload.clearKey = true;
    try { await api("/api/settings", { body: payload }); toast("Saved.", "good"); if (!$("#view-home").hidden) renderHome(); } catch (err) { toast(err.message, "bad"); }
  };
}

async function openUsage() {
  const dlg = $("#usage-dialog");
  const body = $("#usage-body");
  body.replaceChildren(h("p", { class: "fog" }, "counting…"));
  dlg.showModal();
  const u = await api("/api/usage");
  body.replaceChildren(h("p", { class: "eyebrow" }, "the ledger"), h("h2", {}, "What their thoughts cost."), ledgerView(u, true),
    S.info ? h("div", { class: "field-row", style: { marginTop: "28px", maxWidth: "380px" } },
      h("span", {}, "budget for this world, usd · it freezes itself when reached"),
      h("div", { style: { display: "flex", gap: "14px", alignItems: "end" } },
        h("input", { id: "budget-input", type: "number", min: 0, step: 0.5, value: S.info.budgetUsd }),
        h("button", { class: "btn ghost", onclick: (e) => { e.preventDefault(); control("budget", Number($("#budget-input").value)); toast("Budget set.", "good"); } }, "set"))) : null);
}

export function ledgerView(u, inDialog = false) {
  const table = (title, l) => {
    if (!l) return null;
    return h("div", {},
      h("h3", {}, title, h("span", { class: "amt" }, fmt.usd(l.total?.costUsd ?? 0))),
      h("table", { class: "t" },
        h("thead", {}, h("tr", {}, ["model", "calls", "input", "output", "cache read", "cache write", "web", "≈ cost"].map((x) => h("th", {}, x)))),
        h("tbody", {},
          Object.entries(l.byModel ?? {}).map(([m, b]) => h("tr", {}, h("td", {}, m), [b.calls, b.input, b.output, b.cacheRead, b.cacheWrite, b.webSearches].map((x) => h("td", {}, fmt.int(x))), h("td", {}, fmt.usd(b.costUsd)))),
          h("tr", { class: "total" }, h("td", {}, "total"), [l.total.calls, l.total.input, l.total.output, l.total.cacheRead, l.total.cacheWrite, l.total.webSearches].map((x) => h("td", {}, fmt.int(x))), h("td", {}, fmt.usd(l.total.costUsd))),
        )));
  };
  return h("div", { class: "ledger", style: inDialog ? { marginLeft: "0" } : {} },
    u.session ? table("This world", u.session) : null,
    table(`Every world on this machine · ${u.operator}`, u.pc),
    table(`The whole project · ${u.sessions} worlds`, u.project),
    h("p", { class: "note" }, "Estimates from token counts × Anthropic's published prices: Haiku 5.5 $0.10 in / $0.50 out per million, Sonnet 5.5 $2 / $10, cache reads and writes priced separately, web search $0.01. Your Anthropic Console is the source of truth."),
  );
}

boot().catch((err) => document.body.prepend(h("div", { class: "toast bad" }, `The console failed to start: ${err.message}`)));


// ───────────────────────── motion: every act, drawn ─────────────────────────
const MARKET = { buy: "market" };
function animate(events) {
  if (!S.map) return;
  for (const ev of events) {
    const [a, b] = ev.who ?? [];
    const d = ev.data ?? {};
    switch (ev.type) {
      case "speech": case "speech.whisper":
        for (const t of ev.who.slice(1)) S.map.fx("talk", { a, b: t, whisper: ev.type === "speech.whisper" });
        break;
      case "give": S.map.fx("give", { a, b, label: d.amount ? `${d.amount}c` : d.item ?? "gift" }); break;
      case "item.use": if (b) S.map.fx("give", { a, b, label: d.item ?? "" }); else S.map.fx("pulse", { a, label: d.item ?? "" }); break;
      case "dues.paid": S.map.fx("trade", { a, b, label: "paid" }); break;
      case "buy": S.map.fx("buy", { a, b: ev.loc ?? MARKET.buy, label: d.item?.replace("_", " ") }); S.map.fx("buy", { a: ev.loc ?? MARKET.buy, b: a, delay: 700 }); break;
      case "net.post": S.map.fx("post", { a, b: "tower", label: d.anonymous ? "anon" : "post" }); break;
      case "contract.solved": S.map.fx("solved", { a }); break;
      case "contract.attempt": S.map.fx("wrong", { a }); break;
      case "contract.completed": for (const m of ev.who) S.map.fx("pulse", { a: m, label: d.system ? "the city mends" : "+pulse" }); break;
      case "attack": case "attack.miss": S.map.fx("attack", { a, b }); break;
      case "steal": case "steal.failed": S.map.fx("steal", { a, b }); break;
      case "death": S.map.fx("death", { a }); break;
      case "truth.discovered": S.map.fx("truth", { a }); break;
      case "clue.found": case "door.noticed": S.map.fx("pulse", { a, color: "196,181,253", label: "a clue" }); break;
      case "bond.formed": S.map.fx("bond", { a, b }); break;
      case "book.read": S.map.fx("read", { a, label: "finished a book" }); break;
      case "book.open": S.map.fx("read", { a, label: "opens a book" }); break;
      case "world.unrest": S.map.fx("attack", { a: ev.loc, b: a }); break;
      case "leisure.done": S.map.fx("pulse", { a, label: `${d.enjoyment}/10` }); break;
      default: break;
    }
  }
}

// ───────────────────────── conversations & the Net ─────────────────────────
function learnTalk(ev) {
  if (ev.type !== "speech" && ev.type !== "speech.whisper") return;
  const [from, ...to] = ev.who;
  for (const t of to) {
    const k = [from, t].sort().join("|");
    if (!S.talk.has(k)) S.talk.set(k, []);
    S.talk.get(k).push(ev);
  }
  if (S.tab === "talk") renderSide();
}

function renderTabs() {
  const tabs = [["transcript", "transcript"], ["net", "the net"], ["talk", "conversations"]];
  $("#tabs").replaceChildren(...tabs.map(([k, label]) => h("button", { class: `tab ${S.tab === k ? "on" : ""}`, onclick: () => { S.tab = k; S.thread = null; renderTabs(); renderSide(); } }, label)));
  $("#filters").hidden = S.tab !== "transcript";
  $("#feed").hidden = S.tab !== "transcript";
  $("#sideview").hidden = S.tab === "transcript";
  if (S.tab !== "transcript") renderSide();
}

function renderSide() {
  const root = $("#sideview");
  if (!root || S.tab === "transcript") return;
  if (S.tab === "net") {
    const posts = [...(S.live?.forum ?? [])].reverse();
    root.replaceChildren(h("p", { class: "eyebrow" }, `the public board · ${posts.length}`),
      ...(posts.length ? posts.map((p) => h("div", { class: "post" },
        h("div", { class: "post-h" }, p.author ? whoTag(p.author) : h("span", { class: "who-n mute" }, "anonymous"), p.author ? null : h("span", { class: "really" }, ` (really ${nameOf(p.realAuthor)})`), h("span", { class: "tm" }, ` · ${short(p.tick * (S.live?.config.minutesPerTick ?? 10))}`)),
        h("div", { class: "post-b" }, p.text))) : [h("p", { class: "fog" }, "Nobody has posted yet.")]));
    return;
  }
  if (S.thread) {
    const [a, b] = S.thread;
    const msgs = S.talk.get([a, b].sort().join("|")) ?? [];
    root.replaceChildren(
      h("button", { class: "link", onclick: () => { S.thread = null; renderSide(); } }, "← all conversations"),
      h("div", { class: "thread-h" }, whoTag(a), h("span", { class: "fog" }, " and "), whoTag(b)),
      ...msgs.map((ev) => h("div", { class: `msg ${ev.who[0] === a ? "left" : "right"} ${ev.type === "speech.whisper" ? "whisper" : ""}` },
        h("div", { class: "msg-h" }, whoTag(ev.who[0]), h("span", { class: "tm" }, ` ${short(ev.wm)}${ev.type === "speech.whisper" ? " · whispered" : ""}${ev.who.length > 2 ? " · to several" : ""}`)),
        h("div", { class: "msg-b" }, ev.data?.message ?? ev.text),
        ev.data?.private_intent ? h("div", { class: "intent" }, `really: ${ev.data.private_intent}`) : null,
        ev.data?.sincere === false ? h("span", { class: "lie" }, "LIE") : null)));
    root.scrollTop = root.scrollHeight;
    return;
  }
  const threads = [...S.talk.entries()].map(([k, msgs]) => ({ k, msgs, last: msgs[msgs.length - 1] })).sort((x, y) => y.last.seq - x.last.seq);
  root.replaceChildren(h("p", { class: "eyebrow" }, `who talks to whom · ${threads.length}`),
    ...(threads.length ? threads.map(({ k, msgs, last }) => { const [a, b] = k.split("|"); return h("button", { class: "thread-row", onclick: () => openThread(a, b) },
      h("div", {}, whoTag(a), h("span", { class: "fog" }, " · "), whoTag(b), h("span", { class: "tm" }, ` · ${msgs.length}`)),
      h("div", { class: "fog small" }, `“${(last.data?.message ?? last.text).slice(0, 110)}”`)); }) : [h("p", { class: "fog" }, "Nobody has spoken yet.")]));
}

function openThread(a, b) {
  S.tab = "talk"; S.thread = [a, b];
  renderTabs(); renderSide();
}

// ───────────────────────── watch one mind ─────────────────────────
function toggleWatch(id) {
  S.watch = S.watch === id ? null : id;
  S.follow = S.watch;
  S.map?.focus(S.watch);
  renderFilters(); renderFeed();
  if (S.selected) loadDetail(S.selected, true);
}

function theater(n) {
  const c = n.contractId ? S.live?.contracts.find((x) => x.id === n.contractId) : null;
  const lastThought = [...S.feed].reverse().find((e) => e.type === "thought" && e.who?.[0] === n.id);
  const lastTalk = [...S.talk.entries()].filter(([k]) => k.split("|").includes(n.id)).map(([k, m]) => ({ k, m, last: m[m.length - 1] })).sort((x, y) => y.last.seq - x.last.seq)[0];
  const book = n.reading ? S.live?.library?.find((b) => b.id === n.reading.bookId) : null;
  const act = n.activity ? `${n.activity.kind}${n.activity.detail ? ` · ${n.activity.detail}` : ""}` : "standing still";
  return h("div", { class: "theater" },
    h("div", { class: "th-now" }, h("span", { class: `th-glyph g-${n.activity?.kind ?? "idle"}` }), h("span", {}, act), S.thinking.has(n.id) ? h("span", { class: "th-think" }, "thinking…") : null),
    lastThought ? h("blockquote", { class: "th-thought" }, lastThought.text) : null,
    c?.challenge ? h("div", { class: "th-problem" }, h("p", { class: "eyebrow" }, `working on: ${c.title}`),
      ...c.challenge.parts.map((p) => h("div", { class: `th-part ${p.solvedBy ? "done" : ""}` }, h("b", {}, p.id), " ", p.solvedBy ? `solved by ${nameOf(p.solvedBy)}: ${p.answer}` : h("span", { class: "pre" }, p.prompt),
        !p.solvedBy && p.attempts.length ? h("div", { class: "th-tries" }, p.attempts.slice(-3).map((t) => `${nameOf(t.by)}: "${t.answer}" ✗`).join("  ·  ")) : null))) : null,
    book ? h("div", { class: "th-book" }, h("p", { class: "eyebrow" }, "reading"), h("div", { class: "serif-md" }, book.title), h("div", { class: "lines" }, h("div", { class: "ln" }, h("span", { class: "tr" }, h("i", { style: { width: `${Math.min(100, (n.reading.hours / book.hours) * 100)}%` } })), h("span", { class: "vv" }, `${Math.round((n.reading.hours / book.hours) * 100)}%`)))) : null,
    lastTalk ? h("div", { class: "th-talk" }, h("p", { class: "eyebrow" }, "latest conversation"),
      ...lastTalk.m.slice(-4).map((ev) => h("div", { class: "msg-b small" }, whoTag(ev.who[0]), `: “${(ev.data?.message ?? ev.text).slice(0, 160)}”`)),
      h("button", { class: "link", onclick: () => { const [a, b] = lastTalk.k.split("|"); openThread(a, b); } }, "open the conversation →")) : null,
  );
}

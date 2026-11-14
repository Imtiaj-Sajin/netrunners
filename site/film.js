// The film: a recorded world played back on the console's own living map. No model is called; every
// position, word, private thought and death comes from the session's frames and events.
import { createMap } from "./lib/map.js";
import { hueOf } from "./lib/lib.js";

const SYS_LABELS = [["power", "power"], ["signal", "signal"], ["transit", "trams"], ["order", "order"], ["exchange", "the desk"], ["supply", "pulse stock"]];
const SPEEDS = [0.5, 1, 2, 4, 8];
const esc = (v) => String(v ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" })[c]);
const BASE_TPS = 4; // ticks per second at 1x

export function createFilm(root, W) {
  const q = (s) => root.querySelector(s);
  const mpt = W.setup.minutesPerTick;
  const people = W.people;
  const nameOf = (i) => esc(people[i]?.name ?? "?");
  const tint = (i) => `hsl(${hueOf(people[i]?.id ?? "")} 52% 72%)`;
  const locName = (i) => W.locations[W.locIds[i]]?.name ?? W.locIds[i];
  const clock = (t) => { const m = t * mpt + 360; return { day: Math.floor(m / 1440) + 1, hm: `${String(Math.floor((m % 1440) / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}` }; };
  const stamp = (t) => { const c = clock(t); return `D${c.day} ${c.hm}`; };

  const frames = W.frames;
  const first = frames[0][0], last = frames[frames.length - 1][0];
  const idxOfTick = new Map(frames.map((f, i) => [f[0], i]));
  const frameAt = (t) => { for (let x = t; x >= first; x--) if (idxOfTick.has(x)) return idxOfTick.get(x); return 0; };
  const byTick = new Map();
  for (const e of W.events) (byTick.get(e.t) ?? byTick.set(e.t, []).get(e.t)).push(e);
  const chapters = W.chapters.slice().sort((a, b) => a.t - b.t);

  const map = createMap(q(".map"), W.locations, { onSelect: (id) => follow(people.findIndex((p) => p.id === id)) });
  const scrub = q("input[type=range]");
  scrub.min = String(first); scrub.max = String(last); scrub.value = String(first);

  // chapter marks on the timeline: lilac for the truth, red for deaths
  const marks = q(".marks");
  for (const c of chapters) {
    const m = document.createElement("span");
    const kind = /door opens/i.test(c.title) ? "truth" : people.some((p) => p.diedT === c.t) ? "death" : "";
    m.className = `mark ${kind}`;
    m.style.left = `${((c.t - first) / Math.max(1, last - first)) * 100}%`;
    m.title = `${stamp(c.t)} · ${c.title}`;
    marks.append(m);
  }

  // cast rows
  const castBox = q(".cast-live");
  const rows = people.map((p, i) => {
    const b = document.createElement("button");
    b.className = "cl";
    b.type = "button";
    b.innerHTML = `<span class="dot" style="background:${tint(i)}"></span><span><span class="nm">${esc(p.name)}</span><span class="where"></span></span><span class="ph"></span><span class="bar"><i></i></span>`;
    b.addEventListener("click", () => follow(i));
    b.title = `Follow ${p.name}: see their private thoughts`;
    castBox.append(b);
    return b;
  });
  const cityBox = q(".city");
  const sysRows = SYS_LABELS.map(([, label]) => {
    const r = document.createElement("div");
    r.className = "sys";
    r.innerHTML = `<span>${label}</span><span class="tr"><i></i></span><span class="v"></span>`;
    cityBox.append(r);
    return r;
  });

  let cur = first, playing = false, speed = 2, followIdx = -1, raf = 0, lastT = first, prevNow = 0, cardUntil = 0, subUntilT = -1;
  const speedSel = q(".speed");
  speedSel.innerHTML = SPEEDS.map((s) => `<option value="${s}" ${s === speed ? "selected" : ""}>${s}×</option>`).join("");
  speedSel.addEventListener("change", () => { speed = Number(speedSel.value); });

  const card = q(".card-over"), sub = q(".subtitle"), stream = q(".stream");
  function showChapter(c, ms = 4200) {
    if (!c) { card.classList.add("gone"); return; }
    const k = clock(c.t);
    card.innerHTML = `<div class="c-when">Day ${k.day} · ${k.hm}</div><div class="c-title">${esc(c.title)}</div><div class="c-text">${esc(c.text)}</div>`;
    card.classList.remove("gone");
    cardUntil = performance.now() + ms;
  }
  const isVoice = (e) => e.k === "speech" || e.k === "speech.whisper" || e.k === "net.post";
  function subtitleFor(e) {
    const who = nameOf(e.w[0]);
    if (isVoice(e)) {
      const to = e.k === "net.post" ? "the Net" : e.w.slice(1).map(nameOf).join(", ") || "everyone";
      return `<span class="by">${who} → ${to}${e.k === "speech.whisper" ? " · whisper" : ""}${e.lie ? '<span class="lie">LIE</span>' : ""}</span><span class="line">“${esc(e.m)}”</span>`;
    }
    if (e.k === "thought") return `<span class="by">${who} · thinking</span><span class="line thought">${esc(e.x)}</span>`;
    if (e.k === "death") return `<span class="by blood">a death</span><span class="line">${esc(e.x)}</span>`;
    if (e.k === "truth.discovered") return `<span class="by lilac">the truth</span><span class="line">${esc(e.x)}</span>`;
    return `<span class="line">${esc(e.x)}</span>`;
  }
  const streamWorthy = (e) => isVoice(e) || ["death", "truth.discovered", "clue.found", "bond.formed", "shard.uploaded", "give", "door.failed", "rewrite", "reflection"].includes(e.k) || (e.k === "thought" && e.w[0] === followIdx);
  function streamLine(e) {
    const d = document.createElement("div");
    const cls = e.k === "thought" ? "thought" : e.k === "death" ? "death" : e.k === "truth.discovered" || e.k === "shard.uploaded" || e.k === "clue.found" ? "truth" : "";
    d.className = `ln ${cls}`;
    const k = clock(e.t);
    const who = `<span class="who-n" style="color:${tint(e.w[0])}">${nameOf(e.w[0])}</span>`;
    let tx;
    if (isVoice(e)) tx = `${who}<span class="fog">→ ${e.k === "net.post" ? "the Net" : e.w.slice(1).map(nameOf).join(", ") || "everyone"}${e.k === "speech.whisper" ? " (whisper)" : ""}</span> “${esc(e.m)}”${e.i ? ` <span class="fog">· really: ${esc(e.i)}</span>` : ""}`;
    else if (e.k === "thought") tx = `${who}${esc(e.x)}`;
    else tx = esc(e.x);
    d.innerHTML = `<span class="tm">D${k.day} ${k.hm}</span><span class="tx">${tx}</span>`;
    return d;
  }
  function pushStream(e) {
    if (!streamWorthy(e)) return;
    const atEnd = stream.scrollHeight - stream.scrollTop - stream.clientHeight < 60;
    stream.append(streamLine(e));
    while (stream.children.length > 240) stream.firstChild.remove();
    if (atEnd) stream.scrollTop = stream.scrollHeight;
  }
  function rebuildStream(t) {
    const out = [];
    for (let x = t; x >= first && out.length < 40; x--) for (const e of (byTick.get(x) ?? []).slice().reverse()) if (streamWorthy(e)) out.push(e);
    stream.replaceChildren(...out.reverse().map(streamLine));
    stream.scrollTop = stream.scrollHeight;
  }

  function fx(e) {
    const a = people[e.w[0]]?.id, b = people[e.w[1]]?.id;
    switch (e.k) {
      case "speech": case "speech.whisper": for (const i of e.w.slice(1)) map.fx("talk", { a, b: people[i]?.id, whisper: e.k === "speech.whisper" }); break;
      case "give": map.fx("give", { a, b, label: e.l }); break;
      case "death": map.fx("death", { a }); break;
      case "truth.discovered": map.fx("truth", { a }); break;
      case "shard.uploaded": map.fx("truth", { a, label: "a Shard, through" }); break;
      case "clue.found": map.fx("pulse", { a, color: "196,181,253", label: "a clue" }); break;
      case "bond.formed": map.fx("bond", { a, b }); break;
      case "leisure.done": map.fx("pulse", { a, label: e.l }); break;
      case "contract.completed": for (const i of e.w) map.fx("pulse", { a: people[i]?.id, label: "+pulse" }); break;
      case "item.use": map.fx("pulse", { a, label: "pulse pack" }); break;
      case "book.read": map.fx("read", { a, label: "finished a book" }); break;
      case "door.failed": map.fx("wrong", { a }); break;
      case "net.post": map.fx("post", { a, b: "tower", label: "post" }); break;
      case "contract.solved": map.fx("solved", { a }); break;
      case "rewrite": map.fx("truth", { a, label: "rewrite" }); if (b) map.fx("give", { a, b, label: e.l, color: "196,181,253" }); break;
    }
  }

  function paint(t) {
    const f = frames[frameAt(t)];
    map.update(people.map((p, i) => {
      const s = f[2][i];
      if (!s) return { id: p.id, alive: false };
      return { id: p.id, name: p.name, alive: !!s[3], loc: W.locIds[s[0]], to: s[1] >= 0 ? W.locIds[s[1]] : undefined, progress: s[2] / 100, knowsTruth: p.truthT != null && t >= p.truthT, a: W.acts[s[6]], label: W.acts[s[6]] };
    }), { doorAnchor: W.doorAnchor });
    const k = clock(t);
    q(".clock .d").textContent = `Day ${k.day} · ${k.hm}`;
    q(".clock .r").textContent = `tick ${t} of ${last}`;
    people.forEach((p, i) => {
      const s = f[2][i], row = rows[i];
      const dead = !s || !s[3];
      row.classList.toggle("dead", dead && !!s);
      row.classList.toggle("on", i === followIdx);
      const knows = p.truthT != null && t >= p.truthT;
      row.querySelector(".nm").innerHTML = `${esc(p.name)}${knows ? "<small>KNOWS</small>" : ""}`;
      row.querySelector(".where").textContent = !s ? "not yet awake" : dead ? `faded · ${stamp(p.diedT ?? t)}` : s[1] >= 0 ? `→ ${locName(s[1])}` : `${locName(s[0])} · ${W.acts[s[6]] || "still"}`;
      row.querySelector(".ph").textContent = s && !dead ? `${Math.round(s[4])}h` : "";
      const bar = row.querySelector(".bar i");
      const h = s && !dead ? s[4] : 0;
      bar.style.width = `${Math.min(100, (h / 96) * 100)}%`;
      bar.classList.toggle("low", h < 8);
    });
    const sys = f[3];
    sysRows.forEach((r, j) => {
      const v = sys ? sys[j] : null;
      const max = j === 5 ? 16 : 100;
      r.querySelector(".tr i").style.width = v == null ? "0%" : `${Math.min(100, (v / max) * 100)}%`;
      r.querySelector(".v").textContent = v == null ? "-" : j === 5 ? String(Math.floor(v)) : String(Math.round(v));
      r.classList.toggle("bad", v != null && v / max < 0.18);
    });
    scrub.value = String(t);
  }

  function lastVoiceBefore(t) {
    for (let x = t; x >= Math.max(first, t - 10); x--) {
      const list = (byTick.get(x) ?? []).filter((e) => isVoice(e) || e.k === "death" || e.k === "truth.discovered" || (e.k === "thought" && e.w[0] === followIdx));
      if (list.length) return list[list.length - 1];
    }
    return null;
  }
  function setSubtitle(e, t) {
    if (!e) { sub.innerHTML = ""; return; }
    sub.innerHTML = subtitleFor(e);
    subUntilT = t + 7;
  }

  function seek(t, { showCard = true } = {}) {
    t = Math.max(first, Math.min(last, Math.round(t)));
    cur = t; lastT = t;
    paint(t);
    rebuildStream(t);
    setSubtitle(lastVoiceBefore(t), t);
    if (showCard) showChapter(chapters.filter((c) => c.t <= t).pop() ?? null);
  }

  function advanceTo(t) {
    for (let x = lastT + 1; x <= t; x++) {
      const list = byTick.get(x) ?? [];
      for (const e of list) {
        fx(e);
        pushStream(e);
        if (isVoice(e) || e.k === "death" || e.k === "truth.discovered" || (e.k === "thought" && e.w[0] === followIdx)) setSubtitle(e, x);
      }
      const c = chapters.find((ch) => ch.t === x);
      if (c) showChapter(c);
    }
    lastT = t;
    if (t > subUntilT) sub.innerHTML = "";
    paint(t);
  }

  function loop(now) {
    raf = 0;
    if (!playing) return;
    const dt = Math.min(0.1, (now - (prevNow || now)) / 1000);
    prevNow = now;
    cur += dt * BASE_TPS * speed;
    const t = Math.min(last, Math.floor(cur));
    if (t !== lastT) advanceTo(t);
    if (performance.now() > cardUntil) card.classList.add("gone");
    if (t >= last) { pause(); q(".play-big").hidden = false; q(".play-big .lbl").textContent = "Watch again"; return; }
    raf = requestAnimationFrame(loop);
  }
  function play() {
    if (lastT >= last) seek(first);
    playing = true; prevNow = 0;
    q(".play-big").hidden = true;
    q(".ctl.play").textContent = "pause";
    if (!raf) raf = requestAnimationFrame(loop);
  }
  function pause() { playing = false; q(".ctl.play").textContent = "play"; }
  function toggle() { playing ? pause() : play(); }
  function follow(i) {
    followIdx = followIdx === i || i < 0 ? -1 : i;
    const id = people[followIdx]?.id ?? null;
    map.select(id); map.focus(id);
    paint(lastT);
    rebuildStream(lastT);
    q(".follow-note").textContent = followIdx >= 0 ? `Following ${people[followIdx].name}: their private thoughts appear below and in the subtitles.` : "Click a mind to follow it and read its private thoughts as they happen.";
  }

  q(".play-big").addEventListener("click", play);
  q(".ctl.play").addEventListener("click", toggle);
  q(".ctl.prev").addEventListener("click", () => { const c = chapters.filter((ch) => ch.t < lastT - 1).pop(); seek(c ? c.t : first); });
  q(".ctl.next").addEventListener("click", () => { const c = chapters.find((ch) => ch.t > lastT); if (c) seek(c.t); });
  scrub.addEventListener("input", () => { pause(); seek(Number(scrub.value), { showCard: true }); });
  root.addEventListener("keydown", (e) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
    if (e.key === " ") { e.preventDefault(); toggle(); }
    else if (e.key === "ArrowRight") { e.preventDefault(); pause(); const t = Math.min(last, lastT + 1); cur = t; advanceTo(t); }
    else if (e.key === "ArrowLeft") { e.preventDefault(); pause(); seek(lastT - 1, { showCard: false }); }
  });

  seek(first, { showCard: false });
  follow(-1);
  return { seek: (t) => { seek(t); }, play, pause };
}

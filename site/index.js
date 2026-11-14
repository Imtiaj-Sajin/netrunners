// The story page: a living field behind the title, real faces and real numbers from the recorded world.
import { createField } from "./lib/field.js";
import { portrait } from "./lib/portrait.js";
import { hueOf } from "./lib/lib.js";

const hero = document.querySelector(".hero");
const field = createField(hero.querySelector("canvas.field"));
new IntersectionObserver(([e]) => field.freeze(!e.isIntersecting)).observe(hero);

for (const b of document.querySelectorAll("[data-copy]")) {
  b.addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(b.dataset.copy); b.textContent = "copied"; } catch { b.textContent = "select it"; }
    setTimeout(() => (b.textContent = "copy"), 1800);
  });
}

const el = (tag, cls, ...kids) => { const e = document.createElement(tag); if (cls) e.className = cls; e.append(...kids.filter((k) => k != null)); return e; };
const clock = (t, mpt = 15) => { const m = t * mpt + 360; return `Day ${Math.floor(m / 1440) + 1}, ${String(Math.floor((m % 1440) / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`; };

function face(p, size = 56, withName = true) {
  const c = portrait(p, { size, alive: true });
  c.style.width = c.style.height = `${size}px`;
  c.setAttribute("role", "img");
  c.setAttribute("aria-label", `${p.name}, dithered portrait`);
  if (!withName) return c;
  const dot = el("span"); dot.style.cssText = `display:inline-block;width:7px;height:7px;border-radius:50%;margin-right:7px;background:hsl(${hueOf(p.id)} 52% 72%)`;
  return el("div", "who", c, el("div", "", el("div", "nm", dot, p.name), el("div", "sub", `wants ${p.desire}`)));
}

try {
  const data = await (await fetch("data/worlds.json")).json();
  const w1 = data.worlds.find((w) => w.slug === "world-01");
  if (w1?.numbers) {
    for (const node of document.querySelectorAll("[data-n]")) {
      const v = w1.numbers[node.dataset.n];
      if (v != null) node.textContent = Number(v).toLocaleString("en-US");
    }
  }
  const byId = Object.fromEntries((w1?.people ?? []).map((p) => [p.id, p]));
  for (const slot of document.querySelectorAll("[data-cast]")) {
    slot.style.cssText = "display:grid;gap:14px";
    for (const p of w1.people) slot.append(face(p, 48));
  }
  for (const slot of document.querySelectorAll("[data-faces]")) {
    slot.style.cssText = "display:grid;gap:14px";
    for (const id of slot.dataset.faces.split(",")) if (byId[id]) slot.append(face(byId[id], 52));
  }
  const lights = document.querySelector("[data-lights]");
  if (lights) {
    for (const card of lights.children) {
      const p = w1.people.find((x) => x.name === card.querySelector(".n")?.textContent);
      if (p) card.prepend(face(p, 64, false));
    }
  }

  const cards = document.getElementById("world-cards");
  cards.replaceChildren(...data.worlds.map((w) => {
    const live = w.status !== "next";
    const card = el(live ? "a" : "div", "world-card reveal",
      el("div", "row", el("span", "no", `World ${w.number}`), el("span", `st ${live ? "" : "next"}`, live ? w.status : "next")),
      el("h3", "", w.title),
      el("p", "", w.tagline),
      w.numbers ? el("div", "mini",
        el("span", "", el("b", "", String(w.numbers.minds)), " minds"),
        el("span", "", el("b", "", String(w.numbers.days)), " days"),
        el("span", "", el("b", "", `${w.numbers.truthKnowers}/${w.numbers.minds}`), " found the truth"),
        el("span", "", el("b", "", String(w.numbers.deaths)), " deaths"),
        el("span", "", w.setup?.rules?.rewrite ? el("b", "lilac", "rewrite on") : "rewrite off")) : null,
      w.people ? el("div", "faces", ...w.people.map((p) => face(p, 40, false))) : null,
      live ? el("span", "go", "Watch the world →") : el("span", "go lilac", "Being prepared"),
    );
    if (live) card.href = `world.html?w=${w.slug}`;
    if (w.people) {
      const last = w.people.filter((p) => p.diedT).sort((a, b) => b.diedT - a.diedT)[0];
      if (last) card.insertBefore(el("p", "fog", `The last to fade: ${last.name}, ${clock(last.diedT, w.setup?.minutesPerTick)}.`), card.querySelector(".faces"));
    }
    return card;
  }));
} catch (err) {
  console.warn("world data unavailable", err);
}

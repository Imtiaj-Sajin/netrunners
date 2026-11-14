// World time is counted in world-minutes since genesis. Day 1 starts at 06:00.
export const DAY_START_HOUR = 6;

export function worldClock(worldMinutes: number) {
  const total = worldMinutes + DAY_START_HOUR * 60;
  const day = Math.floor(total / 1440) + 1;
  const minuteOfDay = total % 1440;
  const hour = Math.floor(minuteOfDay / 60);
  const minute = Math.floor(minuteOfDay % 60);
  return { day, hour, minute, label: `Day ${day} ${pad(hour)}:${pad(minute)}` };
}

export function partOfDay(worldMinutes: number): "night" | "dawn" | "day" | "dusk" {
  const { hour } = worldClock(worldMinutes);
  if (hour >= 22 || hour < 5) return "night";
  if (hour < 8) return "dawn";
  if (hour < 19) return "day";
  return "dusk";
}

export function hoursText(minutes: number) {
  if (minutes < 60) return `${Math.max(0, Math.round(minutes))} min`;
  const h = minutes / 60;
  if (h < 48) return `${h.toFixed(h < 10 ? 1 : 0)} h`;
  return `${(h / 24).toFixed(1)} days`;
}

export function durationText(ms: number) {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h ? `${h}h ${pad(m)}m ${pad(sec)}s` : `${m}m ${pad(sec)}s`;
}

const pad = (n: number) => String(n).padStart(2, "0");
